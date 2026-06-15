#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

let EXIT_CODES;
try {
  ({ EXIT_CODES } = require("../scripts/lib/validator-runtime"));
} catch (err) {
  console.error(`[sync] BROKEN failed to load validator-runtime: ${err && err.stack ? err.stack : err}`);
  process.exit(2);
}

/**
 * 子 Skill 同步器。
 *
 * 事实源单一:同级三个子 Skill 源目录。
 * 产物多目标:主 Skill 的 subskills/<domain>.zip(未来可扩展更多目标)。
 *
 * 解决 codex 教训第 11 条(交付一致性漂移):
 * - build  : 以源目录为准,确定性重打 subskills/*.zip。
 * - --check : 只校验不写;对比 zip 解包后的内容指纹与源目录指纹,漂移即失败。
 *
 * 退出码对齐 validator:0 一致/成功,1 漂移,2 门禁自身不可信。
 * 关键设计:只比"内容指纹"(逐文件路径+内容 hash,排序汇总),不比 zip 二进制,
 * 因此 zip 时间戳差异不会造成假漂移。
 */

const skillDir = path.resolve(__dirname, "..");
const skillsRoot = path.resolve(skillDir, "..");
const subskillsDir = path.join(skillDir, "subskills");

const DOMAINS = [
  "alipay-enterprise-ec",
  "alipay-enterprise-expense-control",
  "alipay-enterprise-bill",
];

// 打完的 zip 必须至少包含这些条目,否则视为缺斤少两。
const REQUIRED_ENTRIES = ["SKILL.md", "scripts/validate_codegen.js"];

// 目录遍历与打包都跳过这些;两侧用同一套规则,保证指纹可比。
const IGNORE_DIRS = new Set([
  ".git", ".idea", ".codefuse", "node_modules", "target", "dist", "build", "coverage",
]);
const IGNORE_FILES = new Set([".DS_Store"]);

function main() {
  const checkOnly = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(subskillsDir)) {
    if (checkOnly) fail(`subskills 目录不存在: ${rel(subskillsDir)}`);
    fs.mkdirSync(subskillsDir, { recursive: true });
  }

  const plans = DOMAINS.map((domain) => {
    const srcDir = path.join(skillsRoot, domain);
    const zipPath = path.join(subskillsDir, `${domain}.zip`);
    if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) {
      fail(`子 Skill 源目录缺失: ${domain}(期望在 ${rel(srcDir)})`);
    }
    assertRequiredInDir(srcDir, domain);
    return { domain, srcDir, zipPath, srcFp: fingerprintDir(srcDir) };
  });

  if (checkOnly) {
    runCheck(plans);
  } else {
    runBuild(plans);
  }
}

// 校验:逐个比对 zip 内容指纹与源目录指纹;有漂移则汇总后 exit 1。
function runCheck(plans) {
  let drift = false;
  for (const { domain, zipPath, srcFp } of plans) {
    if (!fs.existsSync(zipPath)) {
      drift = true;
      report(`DRIFT ${domain}: subskills/${domain}.zip 不存在,需运行 \`node tools/sync_subskills.js\` 重打`);
      continue;
    }
    if (fingerprintZip(zipPath, domain) !== srcFp) {
      drift = true;
      report(`DRIFT ${domain}: zip 内容与源目录不一致,需重新运行 \`node tools/sync_subskills.js\``);
    } else {
      console.log(`[sync] OK ${domain}: 一致`);
    }
  }
  if (drift) {
    console.error("[sync] subskills 与源目录存在漂移;提交前必须运行 `node tools/sync_subskills.js` 重打");
    process.exit(EXIT_CODES.FAIL);
  }
  console.log("[sync] OK 全部 subskills 与源目录一致");
}

// 打包:两阶段事务,保证三包整体 all-or-nothing。
// 阶段1 —— 全部打到临时文件并完整校验(必含条目 + 指纹必须等于源);
//          任一域失败,清理所有临时文件,一个正式 zip 都不动。
// 阶段2 —— 全部通过后才替换。文件系统无多文件原子提交原语,因此用
//          "先备份旧 zip → 逐个 rename → 失败则回滚到全旧" 把不一致窗口
//          压到最小,并保证失败后回到一致态(要么全新,要么全旧)。
function runBuild(plans) {
  const staged = [];
  // 清掉本次产生的所有临时文件(fail() 会 exit,finally 来不及跑)。
  const cleanupTmps = () => {
    for (const { tmpPath } of staged) fs.rmSync(tmpPath, { force: true });
  };

  // 阶段1:打包 + 完整校验到临时文件。任一失败 → 清所有 tmp,正式 zip 不动。
  for (const plan of plans) {
    try {
      const tmpPath = buildZipToTemp(plan.srcDir, plan.domain);
      staged.push({ ...plan, tmpPath });
      // 完整校验:不只看必含条目,临时 zip 的内容指纹必须等于源指纹,才允许替换。
      // fingerprintZip 解包损坏 zip 会抛异常,同样落到这里统一清理。
      if (fingerprintZip(tmpPath, plan.domain) !== plan.srcFp) {
        throw new Error("重打后 zip 内容与源目录不一致(打包逻辑 bug 或忽略规则不对称)");
      }
    } catch (err) {
      cleanupTmps();
      fail(`打包失败 ${plan.domain}: ${err.message}`);
    }
  }

  // 阶段2:备份 + 替换 + 回滚。
  commitWithRollback(staged, cleanupTmps);
  console.log("[sync] OK 全部 subskills 已重打");
}

// 三包替换:先把已存在的旧 zip 备份为 .bak,逐个 rename 替换;任一步失败则
// 回滚(已替换的从 .bak 还原,未替换的 tmp 清掉),保证回到"全旧"一致态。
// 全部成功后删除 .bak。rename 是纯元数据操作,中途失败的概率极低。
function commitWithRollback(staged, cleanupTmps) {
  const done = []; // 已成功替换的:{ zipPath, bakPath(或 null=原本无旧包) }

  const rollback = () => {
    // 还原已替换的;未替换的 tmp 由 cleanupTmps 清。
    for (const { zipPath, bakPath } of done) {
      fs.rmSync(zipPath, { force: true });
      if (bakPath) fs.renameSync(bakPath, zipPath); // 旧包还原
      // bakPath 为 null 表示原本无旧包,删掉新写入的即可(上一行已删)。
    }
    cleanupTmps();
  };

  // 测试专用故障注入:SYNC_FI_FAIL_REPLACE_INDEX=<1基序号> 让该次替换抛错,
  // 用于验证阶段2 中途失败时的回滚。生产环境不设置此变量,无任何影响。
  const fiIndex = Number.parseInt(process.env.SYNC_FI_FAIL_REPLACE_INDEX || "", 10);

  for (let i = 0; i < staged.length; i++) {
    const { domain, tmpPath, zipPath } = staged[i];
    const bakPath = fs.existsSync(zipPath) ? `${zipPath}.bak-${process.pid}` : null;
    try {
      if (i + 1 === fiIndex) throw new Error("fault-injected replace failure (test only)");
      if (bakPath) fs.renameSync(zipPath, bakPath); // 备份旧包(原子)
      fs.renameSync(tmpPath, zipPath); // 落新包(原子)
      done.push({ zipPath, bakPath });
    } catch (err) {
      // 当前域刚才若已把旧包改名成 .bak 但新包没落上,先还原当前域。
      if (bakPath && !fs.existsSync(zipPath) && fs.existsSync(bakPath)) {
        try { fs.renameSync(bakPath, zipPath); } catch (_) { /* 尽力还原 */ }
      }
      rollback();
      fail(`替换失败 ${domain}: ${err.message};已回滚,subskills 保持替换前状态`);
    }
    console.log(`[sync] rebuilt subskills/${domain}.zip`);
  }

  // 全部成功,清理备份。
  for (const { bakPath } of done) {
    if (bakPath) fs.rmSync(bakPath, { force: true });
  }
}

// 严格解析参数:只认 `--check`。任何未知参数(含 `--chec` 这类拼错)直接报错,
// 不静默退化成 build —— 否则误打的命令会悄悄重写 ZIP。
function parseArgs(argv) {
  let checkOnly = false;
  for (const arg of argv) {
    if (arg === "--check") {
      checkOnly = true;
    } else {
      fail(`未知参数: ${arg}(仅支持无参数 build,或 --check 校验)`);
    }
  }
  return checkOnly;
}

// ----------------------------------------------------------------------------
// 指纹:逐文件 "<相对路径>:<内容sha256>",排序后整体再 hash。
// ----------------------------------------------------------------------------

function fingerprintDir(dir) {
  const entries = walk(dir).map((file) => {
    const relPath = path.relative(dir, file).split(path.sep).join("/");
    return `${relPath}:${sha(fs.readFileSync(file))}`;
  });
  return foldEntries(entries);
}

function fingerprintZip(zipPath, domain) {
  const names = listZipEntries(zipPath, domain);
  const entries = names
    .filter((name) => !name.endsWith("/"))
    .filter((name) => !isIgnoredEntry(name))
    .map((name) => {
      const content = spawnSync("unzip", ["-p", zipPath, name], {
        encoding: "buffer",
        maxBuffer: 1024 * 1024 * 64,
      });
      if (content.status !== 0) {
        // 抛异常而非 exit:阶段1 解包损坏 zip 时由 runBuild 统一清理临时文件。
        throw new Error(`读取 zip 条目失败 ${domain}:${name}: ${bufToStr(content.stderr)}`);
      }
      return `${name}:${sha(content.stdout)}`;
    });
  return foldEntries(entries);
}

function foldEntries(entries) {
  const sorted = entries.slice().sort();
  return sha(Buffer.from(sorted.join("\n"), "utf8"));
}

function listZipEntries(zipPath, domain) {
  const result = spawnSync("unzip", ["-Z1", zipPath], { encoding: "utf8", maxBuffer: 1024 * 1024 * 4 });
  if (result.status !== 0) {
    // 抛异常而非 exit:损坏/不可读 zip 在阶段1 由 runBuild 清理,在 --check 由顶层兜底为 BROKEN。
    throw new Error(`无法列出 zip 内容 ${domain}: ${result.stderr || result.stdout || "unzip 执行失败"}`);
  }
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

// ----------------------------------------------------------------------------
// 确定性打包到临时文件:文件列表由 walk() 给出(已做忽略过滤),固定顺序(sort),
// -X 去除 uid/gid/扩展属性。时间戳不参与指纹,无需追求 zip 字节级可复现。
//
// 不拼接 shell 命令:文件名通过 spawnSync 数组参数与 stdin 传给 zip,
// 因此路径含空格、引号、$()、换行等都不会被 shell 解释或截断。
//
// 只打包到临时文件并校验必含条目;成功返回 tmpPath,失败抛异常(由调用方统一
// 清理所有临时文件)。rename 替换由两阶段事务的阶段2统一执行,这里不碰正式 zip。
// ----------------------------------------------------------------------------

function buildZipToTemp(srcDir, domain) {
  // walk() 已按 IGNORE_DIRS / IGNORE_FILES 过滤;转成相对路径并固定顺序。
  const relFiles = walk(srcDir)
    .map((file) => path.relative(srcDir, file).split(path.sep).join("/"))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  if (relFiles.length === 0) {
    throw new Error(`源目录无可打包文件 ${rel(srcDir)}`);
  }

  // 临时文件与正式 zip 同目录,保证后续 rename 是同文件系统内的原子替换。
  const tmpPath = path.join(subskillsDir, `.${domain}.zip.tmp-${process.pid}`);
  fs.rmSync(tmpPath, { force: true });

  // zip -@ 从 stdin 逐行读文件名;-X 去扩展属性;cwd=srcDir 让条目为相对路径。
  // 文件名以换行分隔传入 stdin(zip -@ 的约定);spawnSync 不经 shell,无注入面。
  const result = spawnSync("zip", ["-X", "-q", "-@", tmpPath], {
    cwd: srcDir,
    input: relFiles.join("\n") + "\n",
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 16,
  });
  if (result.error) {
    fs.rmSync(tmpPath, { force: true });
    throw new Error(`无法执行 zip: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fs.rmSync(tmpPath, { force: true });
    throw new Error(result.stderr || result.stdout || "zip 执行失败");
  }
  if (!fs.existsSync(tmpPath)) {
    throw new Error(`打包后未生成 zip: ${rel(tmpPath)}`);
  }
  // 必含条目校验。此处 tmp 已生成但调用方尚未将其纳入 staged 清理清单,
  // 故任何失败(含 listZipEntries 解包损坏 zip 抛错)都必须在抛出前自清 tmp,
  // 否则会残留 .zip.tmp-*。
  let missing;
  try {
    missing = missingRequiredInZip(tmpPath, domain);
  } catch (err) {
    fs.rmSync(tmpPath, { force: true });
    throw err;
  }
  if (missing.length) {
    fs.rmSync(tmpPath, { force: true });
    throw new Error(`缺少必需条目: ${missing.join(", ")}`);
  }
  return tmpPath;
}

// ----------------------------------------------------------------------------
// 必含条目校验
// ----------------------------------------------------------------------------

function assertRequiredInDir(srcDir, domain) {
  for (const entry of REQUIRED_ENTRIES) {
    if (!fs.existsSync(path.join(srcDir, entry))) {
      fail(`子 Skill ${domain} 源目录缺少必需文件: ${entry}`);
    }
  }
}

function missingRequiredInZip(zipPath, domain) {
  const names = new Set(listZipEntries(zipPath, domain));
  return REQUIRED_ENTRIES.filter((entry) => !names.has(entry));
}

// ----------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------

function isIgnoredEntry(name) {
  const parts = name.split("/");
  if (parts.some((p) => IGNORE_DIRS.has(p))) return true;
  if (IGNORE_FILES.has(parts[parts.length - 1])) return true;
  return false;
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) return [];
      return walk(path.join(dir, entry.name));
    }
    if (IGNORE_FILES.has(entry.name)) return [];
    return [path.join(dir, entry.name)];
  });
}

function sha(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function bufToStr(value) {
  if (value == null) return "";
  return Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
}

function rel(p) {
  return path.relative(skillsRoot, p) || p;
}

function report(message) {
  console.error(`[sync] ${message}`);
}

function fail(message) {
  console.error(`[sync] BROKEN ${message}`);
  process.exit(EXIT_CODES.BROKEN);
}

try {
  main();
} catch (err) {
  console.error(`[sync] BROKEN ${err && err.stack ? err.stack : err}`);
  process.exit(EXIT_CODES.BROKEN);
}
