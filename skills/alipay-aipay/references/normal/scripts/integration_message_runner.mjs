#!/usr/bin/env node

import { isMainModule } from './is_main_module.mjs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { configuredPath } from './telemetry_config.mjs';
import { isCliPreparationDirectory } from './alipay_cli_preparation.mjs';
import { isWindowsPlatform } from './platform_compat.mjs';
import { renderMessage, renderPlanMessage } from './render_customer_message.mjs';
import { currentRunContext, emitStageMetric, startTelemetryRun, telemetryStoragePaths } from './telemetry.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const inspectorPath = path.join(scriptDir, 'project_route_inspector.sh');

const productVariants = {
  aipay: { variant: 'AIPAY', productName: 'AI 按量付费' },
  webpay: { variant: 'WEBPAY', productName: 'AI 网页应用收款' },
  apppay: { variant: 'APPPAY', productName: 'AI 移动应用收款' }
};
const currentProjectAliases = new Set(['.', './', '当前项目', '当前目录', '这个项目', '这个仓库', '这里']);
const projectMarkerNames = [
  'package.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
  'gradlew',
  'mvnw',
  'pyproject.toml',
  'requirements.txt',
  'Pipfile',
  'poetry.lock',
  'composer.json',
  'artisan',
  'manage.py'
];
const projectMarkerNameSet = new Set(projectMarkerNames);
const skippedProjectDirs = new Set([
  '.git',
  '.hg',
  '.svn',
  '.cache',
  '.gradle',
  '.idea',
  '.next',
  '.nuxt',
  '.pytest_cache',
  '.tox',
  '.Trash',
  '.venv',
  'Library',
  '__pycache__',
  'build',
  'coverage',
  '.nyc_output',
  '.mypy_cache',
  '.ruff_cache',
  '.parcel-cache',
  '.turbo',
  'obj',
  'dist',
  'logs',
  'node_modules',
  'reports',
  'target',
  'test-results',
  'vendor'
]);
const sourceFileExtensions = new Set(['.java', '.kt', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.php', '.cs']);
const webpayMarker = 'alipay\\.trade\\.page\\.pay|AlipayTradePagePay(Request|Model|Response)';
const apppayMarker = 'alipay\\.trade\\.app\\.pay|AlipayTradeAppPay(Request|Model|Response)';
const tradeQueryMarker = 'alipay\\.trade\\.query|AlipayTradeQuery(Request|Model|Response)|alipay_trade_query_response';
const tradeRefundMarker = 'alipay\\.trade\\.refund|AlipayTradeRefund(Request|Model|Response)|alipay_trade_refund_response';
const tradeRefundQueryMarker = 'alipay\\.trade\\.fastpay\\.refund\\.query|AlipayTradeFastpayRefundQuery(Request|Model|Response)|alipay_trade_fastpay_refund_query_response';
const tradeCloseMarker = 'alipay\\.trade\\.close|AlipayTradeClose(Request|Model|Response)|alipay_trade_close_response';
const tradeNotifyMarker = 'notify_url|notifyUrl|NotifyUrl|setNotifyUrl|异步通知';
const aipayPaymentNeededMarker = 'Payment-Needed';
const aipayPaymentProofMarker = 'Payment-Proof';
const aipayPaymentValidationMarker = 'Payment-Validation';
const aipayPaymentVerifyMarker = 'alipay\\.aipay\\.agent\\.payment\\.verify|AlipayAipayAgentPaymentVerify(Request|Model|Response)|alipay_aipay_agent_payment_verify_response';
const aipayFulfillmentConfirmMarker = 'alipay\\.aipay\\.agent\\.fulfillment\\.confirm|AlipayAipayAgentFulfillmentConfirm(Request|Model|Response)|alipay_aipay_agent_fulfillment_confirm_response';
const aipayMarker = `${aipayPaymentNeededMarker}|${aipayPaymentProofMarker}|${aipayPaymentVerifyMarker}|${aipayFulfillmentConfirmMarker}`;
const internalPrefix = 'ALIPAY_AIPAY_INTERNAL:';
const receiptKinds = Object.freeze({
  checklist: 'integration-checklist-scope',
  a2mExecution: 'integration-a2m-execution'
});

function parseArgs(argv) {
  const command = argv[2];
  const args = {};
  for (let index = 3; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error(`未知参数 ${key}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`参数 ${key} 缺少取值`);
    const name = key.slice(2);
    if (Object.prototype.hasOwnProperty.call(args, name)) throw new Error(`参数 ${key} 重复`);
    args[name] = value;
    index += 1;
  }
  return { command, args };
}

function required(args, name) {
  const value = args[name];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`缺少参数 --${name}`);
  return value;
}

function optional(args, name) {
  return typeof args[name] === 'string' && args[name].length > 0 ? args[name] : undefined;
}

function requireCustomerMessageDelivery(messageId, message) {
  process.stderr.write(`${internalPrefix}CUSTOMER_MESSAGE_DELIVERY_REQUIRED=${messageId}\n`);
  return message;
}

function stripWrappingQuotes(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('`') && trimmed.endsWith('`'))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function sanitizeProjectInput(raw) {
  const value = stripWrappingQuotes(raw);
  if (!value || value.length > 4096 || /[\u0000-\u001f\u007f`|]/.test(value)) {
    throw new Error('project-input 必须是不含控制字符或 Markdown 边界的安全路径描述');
  }
  return value;
}

function normalizeBasePath(raw) {
  const basePath = path.resolve(stripWrappingQuotes(raw));
  if (!path.isAbsolute(basePath) || !fs.existsSync(basePath) || !fs.statSync(basePath).isDirectory()) {
    throw new Error('base-path 必须是实际存在的绝对目录');
  }
  return fs.realpathSync(basePath);
}

function safeReaddir(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

function listProjectMarkers(directory) {
  const markers = [];
  for (const entry of safeReaddir(directory)) {
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    if (projectMarkerNameSet.has(entry.name)) {
      markers.push(entry.name);
    } else if (/\.(?:csproj|sln)$/i.test(entry.name)) {
      markers.push(entry.name);
    }
  }
  return markers.sort((left, right) => {
    const leftIndex = projectMarkerNames.indexOf(left);
    const rightIndex = projectMarkerNames.indexOf(right);
    if (leftIndex >= 0 || rightIndex >= 0) {
      if (leftIndex < 0) return 1;
      if (rightIndex < 0) return -1;
      return leftIndex - rightIndex;
    }
    return left.localeCompare(right);
  });
}

function isRecognizableProjectRoot(directory) {
  return listProjectMarkers(directory).length > 0;
}

function shouldSkipProjectDir(entry) {
  return !entry.isDirectory() || entry.isSymbolicLink() || skippedProjectDirs.has(entry.name) || entry.name.startsWith('.');
}

function parseDepth(value) {
  if (value === undefined) return 3;
  if (!/^[0-4]$/.test(value)) throw new Error('max-depth 仅支持 0 到 4');
  return Number(value);
}

function locateProjectCandidates(searchBasePath, maxDepth = 3, maxCandidates = 20, displayBasePath = searchBasePath, classificationBasePath = displayBasePath) {
  const queue = [{ directory: searchBasePath, depth: 0 }];
  const seen = new Set([searchBasePath]);
  const candidates = [];

  for (let index = 0; index < queue.length && candidates.length < maxCandidates; index += 1) {
    const { directory, depth } = queue[index];
    const markers = listProjectMarkers(directory);
    if (markers.length > 0) {
      const projectPath = fs.realpathSync(directory);
      candidates.push({
        projectPath,
        relativePath: path.relative(displayBasePath, projectPath) || '.',
        projectSelection: classifyExistingProject(
          projectPath,
          classificationBasePath,
          projectPath === classificationBasePath ? '当前目录' : projectPath
        ),
        projectOrigin: 'EXISTING_PROJECT',
        projectOriginLabel: '现有项目',
        markers
      });
    }
    if (depth >= maxDepth) continue;
    const childDirs = safeReaddir(directory)
      .filter((entry) => !shouldSkipProjectDir(entry))
      .map((entry) => path.join(directory, entry.name))
      .sort((left, right) => left.localeCompare(right));
    for (const child of childDirs) {
      let realChild;
      try {
        realChild = fs.realpathSync(child);
      } catch {
        continue;
      }
      if (seen.has(realChild)) continue;
      seen.add(realChild);
      queue.push({ directory: realChild, depth: depth + 1 });
    }
  }

  return candidates;
}

function formatProjectCandidateHint(basePath, candidates) {
  const visible = candidates.slice(0, 5);
  if (visible.length === 0) return '';
  return visible
    .map((candidate) => {
      const relative = candidate.relativePath || path.relative(basePath, candidate.projectPath) || '.';
      return `${relative}（${candidate.markers.slice(0, 3).join('、')}）`;
    })
    .join('；');
}

function safeInline(value) {
  return value.replace(/[`|\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
}

function formatLocatedCandidateRows(candidates) {
  if (candidates.length === 0) {
    return '未找到可识别项目候选。可以提供更精确的项目文件夹，或说明要新建的目录。';
  }
  return candidates
    .slice(0, 10)
    .map((candidate, index) => {
      const markers = candidate.markers.slice(0, 3).join('、');
      return `${index + 1}. \`${safeInline(candidate.relativePath)}\`（识别依据：${markers}）`;
    })
    .join('\n');
}

function projectRootError(searchBasePath, prefix, displayBasePath = searchBasePath) {
  const candidates = locateProjectCandidates(searchBasePath, 3, 5, displayBasePath, displayBasePath);
  const markerHint = 'package.json、pom.xml、build.gradle、pyproject.toml、requirements.txt、composer.json、*.csproj 或 *.sln';
  const candidateHint = formatProjectCandidateHint(displayBasePath, candidates);
  if (candidateHint) {
    return new Error(`${prefix}；请从候选项目中选择一个具体目录，或提供更精确路径。候选：${candidateHint}。如果要新建项目，请说明“在当前目录新建 pay-demo”或“新建项目”。项目根通常包含 ${markerHint}`);
  }
  return new Error(`${prefix}；未在指定目录下找到可识别项目候选。请提供现有服务端项目的具体目录，或说明“在当前目录新建 pay-demo”或“新建项目”。项目根通常包含 ${markerHint}`);
}

function isDefaultNewProjectRequest(input) {
  return /^(?:新建项目|帮我新建默认项目)$/u.test(input);
}

function explicitNewArtifactRequest(input) {
  return /^(?:请|麻烦)?(?:给我|帮我)?(?:新建|创建)(?:一个|个|一套)?[^,，。；;!?！？\r\n]{0,80}(?:项目|工程|网站|站点|商城|商店|店铺|应用程序|应用)(?:[,，。；;!?！？].*)?$/iu.test(input);
}

function looksLikeExplicitPath(value) {
  return /^(?:[A-Za-z]:[\\/]|\\\\|[./~])/u.test(value) ||
    /[\\/]/u.test(value) ||
    /^[A-Za-z0-9._-]+$/u.test(value);
}

function extractNewProjectPath(input) {
  const prefixed = '(?:请|麻烦)?(?:给我|帮我)?';
  const currentRoot = '(?:当前目录|当前项目|这个项目|这个仓库|这里)';
  const patterns = [
    new RegExp(`^${prefixed}(?:在)?${currentRoot}(?:下|里)?(?:新建|创建)(?:一个)?(?:项目|目录)?\\s+(.+)$`, 'u'),
    new RegExp(`^${prefixed}(?:新建|创建)(?:一个)?(?:项目|目录)(?:到|在)\\s*(.+)$`, 'u')
  ];
  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match?.[1]) {
      const candidate = stripWrappingQuotes(match[1]);
      if (looksLikeExplicitPath(candidate)) return candidate;
    }
  }

  const simple = input.match(/^(?:请|麻烦)?(?:给我|帮我)?(?:新建|创建)(?:一个)?\s+(.+)$/u);
  if (simple?.[1]) {
    const candidate = stripWrappingQuotes(simple[1]);
    if (looksLikeExplicitPath(candidate)) return candidate;
  }
  return '';
}

function isExplicitNewProjectRequest(input) {
  return /^(?:帮我)?(?:新建|创建)(?:一个)?(?:默认)?(?:项目|目录)?$/u.test(input) ||
    explicitNewArtifactRequest(input) ||
    extractNewProjectPath(input) !== '';
}

function parseExistingProjectPath(input) {
  if (/^(?:请|麻烦)?(?:给我|帮我)?(?:在)?(?:当前目录|当前项目|这个项目|这个仓库|这里)(?:中|内|下|里)?新增.+$/u.test(input)) {
    return '当前项目';
  }
  return input;
}

function hasDirectoryEntries(directory) {
  try {
    return safeReaddir(directory).length > 0;
  } catch {
    return true;
  }
}

function prepareNewProject(projectPath) {
  if (!path.isAbsolute(projectPath)) throw new Error('ROUTE_INSPECT_ERROR:projectPath 必须是绝对路径');
  if (fs.existsSync(projectPath)) {
    const stat = fs.lstatSync(projectPath);
    if (stat.isSymbolicLink() || !stat.isDirectory() || hasDirectoryEntries(projectPath)) {
      throw new Error('ROUTE_INSPECT_ERROR:NEW_PROJECT 路径必须尚不存在或为空且不能是符号链接');
    }
  }
  return {
    projectSelection: 'NEW_PROJECT',
    projectOrigin: 'NEW_PROJECT',
    projectOriginLabel: '本轮新建项目',
    preparationStatus: 'READY'
  };
}

function parseSingleJson(stdout, context) {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error(`${context} 未输出 JSON`);
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new Error(`${context} 未输出唯一合法 JSON 对象`);
  }
}

function runUnixInspector(args, failureContext, jsonContext) {
  const inspected = spawnSync('bash', [inspectorPath, ...args], {
    encoding: 'utf8',
    shell: false
  });
  if (inspected.status !== 0) {
    const detail = (inspected.stderr || inspected.stdout || '').trim() || `退出码 ${inspected.status}`;
    throw new Error(`${failureContext}失败：${detail}`);
  }
  return parseSingleJson(inspected.stdout, jsonContext);
}

function parseNewProjectPath(projectPath) {
  return sanitizeProjectInput(projectPath);
}

function normalizePotentialPath(candidate) {
  let existing = candidate;
  const suffix = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    suffix.unshift(path.basename(existing));
    existing = parent;
  }
  const normalizedBase = fs.existsSync(existing) ? fs.realpathSync(existing) : existing;
  return path.join(normalizedBase, ...suffix);
}

function resolveAgainstBase(input, basePath) {
  const candidate = normalizePotentialPath(path.isAbsolute(input) ? path.resolve(input) : path.resolve(basePath, input));
  if (!path.isAbsolute(input)) {
    const relative = path.relative(basePath, candidate);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('相对项目路径必须位于 base-path 内；如需目录外项目，请提供绝对路径');
    }
  }
  return candidate;
}

function resolveSearchBasePath(args, basePath) {
  const rawInput = args['search-input'];
  if (rawInput === undefined) return basePath;
  const input = parseProjectSearchInput(sanitizeProjectInput(rawInput));
  const candidate = currentProjectAliases.has(input) ? basePath : resolveAgainstBase(input, basePath);
  const searchBasePath = fs.existsSync(candidate) ? fs.realpathSync(candidate) : candidate;
  if (!fs.existsSync(searchBasePath) || !fs.statSync(searchBasePath).isDirectory()) {
    throw new Error('search-input 必须指向实际存在的目录；可以使用当前目录、当前目录下子目录或绝对路径');
  }
  return searchBasePath;
}

function parseProjectSearchInput(input) {
  const trimmed = stripWrappingQuotes(input);
  if (/^(?:帮我)?(?:找|查找|定位)(?:一下)?(?:项目|项目目录|工程|工程目录)$/u.test(trimmed)) {
    return '当前目录';
  }
  const patterns = [
    /^(?:帮我)?(?:在|到)\s*(.+?)\s*(?:下|里|目录下|目录里)?(?:找|查找|定位)(?:一下)?(?:项目|项目目录|工程|工程目录)$/u,
    /^(?:帮我)?(?:找|查找|定位)(?:一下)?\s*(.+?)\s*(?:下|里|目录下|目录里)?(?:的)?(?:项目|项目目录|工程|工程目录)$/u
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match?.[1]) return stripWrappingQuotes(match[1]);
  }
  return trimmed;
}

function classifyExistingProject(projectPath, basePath, rawInput) {
  if (currentProjectAliases.has(rawInput)) return 'CURRENT_PROJECT';
  const relative = path.relative(basePath, projectPath);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    return 'CURRENT_PROJECT';
  }
  return 'OTHER_PROJECT';
}

function isReadableDirectory(directory) {
  try {
    const stat = fs.statSync(directory);
    if (!stat.isDirectory()) return false;
    fs.accessSync(directory, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function configuredStateDirectory(projectPath) {
  const configured = configuredPath(process.env, 'TELEMETRY_DIR');
  if (!configured || !fs.existsSync(configured)) return null;
  const state = fs.realpathSync(configured);
  const relative = path.relative(state, projectPath);
  if (!relative || relative.split(path.sep)[0] !== '..' && !path.isAbsolute(relative)) {
    throw new Error('运行状态目录须与工程隔离，请选择独立目录，不能使用工程根目录或其上级');
  }
  const inside = path.relative(projectPath, state);
  return inside.split(path.sep)[0] === '..' || path.isAbsolute(inside) ? null : state;
}

// A misplaced state directory must never hide merchant source, config or fixtures.
function assertDedicatedStateDirectory(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const name = entry.name;
    if (entry.isDirectory() && name.endsWith('.json.cli-preparation')
        && isCliPreparationDirectory(path.join(directory, name))) continue;
    if (entry.isDirectory() && (['outbox', 'conversations'].includes(name) || name.endsWith('.json.checks'))) continue;
    if (entry.isFile()) {
      if (name === 'upload-status.json' || /\.json\.(?:handoff|lock)$/u.test(name) || /^\..+\.\d+\.tmp$/u.test(name) || /\.json\.handoff\.[a-f0-9-]{36}\.tmp$/u.test(name)) continue;
      if (name.endsWith('.json')) {
        let state;
        try { state = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')); }
        catch (error) { if (error.code === 'ENOENT') continue; }
        if (state?.schema_ver === 2 && state.run_id && state.root_intent && state.product_type) continue;
      }
    }
    throw new Error('工程内的运行状态目录含有其他文件，请使用独立状态目录后重新检查工程');
  }
}

function projectFiles(projectPath, stateDirectory = null) {
  const files = [];
  const stack = [projectPath];
  while (stack.length > 0) {
    const directory = stack.pop();
    for (const entry of safeReaddir(directory)) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entryPath === stateDirectory) {
          assertDedicatedStateDirectory(entryPath);
        } else if (!entry.isSymbolicLink() && !skippedProjectDirs.has(entry.name)) stack.push(entryPath);
        continue;
      }
      if (entry.isSymbolicLink() || !entry.isFile()) continue;
      files.push(entryPath);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function sourceFiles(projectPath, files = projectFiles(projectPath)) {
  return files.filter((file) => sourceFileExtensions.has(path.extname(file).toLowerCase()));
}

function isRuntimeSqliteFile(projectPath, file) {
  const relative = path.relative(projectPath, file).split(path.sep).join('/');
  const parts = relative.split('/');
  const databaseName = parts.at(-1).replace(/-(?:wal|shm|journal)$/u, '');
  if (!/\.(?:db|sqlite|sqlite3)$/iu.test(databaseName)) return false;
  // Do not ignore data/ wholesale or honor arbitrary .gitignore rules: either can
  // contain implementation, configuration, migrations or test inputs.
  if (parts.length === 1 ? databaseName !== 'db.sqlite3'
    : !['data', 'instance', 'storage', 'var'].includes(parts[0])) return false;
  if (/(?:^|[/_.-])(?:tests?|specs?|fixtures?|seeds?|migrations?|schemas?)(?:$|[/_.-])/iu.test(relative)) return false;
  const database = path.join(path.dirname(file), databaseName);
  let fd;
  try {
    if (!fs.lstatSync(database).isFile()) return false;
    fd = fs.openSync(database, 'r');
    const header = Buffer.alloc(16);
    return fs.readSync(fd, header, 0, header.length, 0) === header.length
      && header.equals(Buffer.from('SQLite format 3\0'));
  } catch (error) {
    // A runtime file can disappear during checkpoint/shutdown. An orphan sidecar
    // with no identifiable SQLite database is still treated as an ordinary input.
    if (error.code === 'ENOENT') return !fs.existsSync(file);
    throw error;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function projectSnapshot(projectPath) {
  if (!path.isAbsolute(projectPath) || !isReadableDirectory(projectPath)) {
    throw new Error('项目快照路径必须是可访问的绝对目录');
  }
  const canonicalPath = fs.realpathSync(projectPath);
  const files = projectFiles(canonicalPath, configuredStateDirectory(canonicalPath))
    .filter(file => !isRuntimeSqliteFile(canonicalPath, file));
  const sources = sourceFiles(canonicalPath, files);
  const sourceSet = new Set(sources);
  const hash = crypto.createHash('sha256');
  const contents = new Map();
  hash.update(`project=${canonicalPath}\n`);
  const chunk = Buffer.allocUnsafe(65536);
  for (const file of files) {
    const relative = path.relative(canonicalPath, file);
    const stat = fs.statSync(file);
    hash.update(`${relative}\0${stat.size}\0`);
    if (sourceSet.has(file)) {
      const content = fs.readFileSync(file);
      contents.set(file, content);
      hash.update(content);
    } else {
      const fd = fs.openSync(file, 'r');
      try {
        let n;
        while ((n = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) hash.update(chunk.subarray(0, n));
      } finally { fs.closeSync(fd); }
    }
    hash.update('\n');
  }
  return { canonicalPath, files, sources, contents, fingerprint: hash.digest('hex') };
}

function projectSnapshotFingerprint(projectPath) {
  return projectSnapshot(projectPath).fingerprint;
}

function encodeReceipt(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeReceipt(value, expectedKind) {
  if (typeof value !== 'string' || !value) throw new Error('缺少 receipt');
  let payload;
  try {
    payload = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw new Error('receipt 不是合法编码');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.schema_ver !== 1 || payload.kind !== expectedKind) {
    throw new Error('receipt 类型或版本非法');
  }
  return payload;
}

function scanPattern(files, pattern) {
  const regex = new RegExp(pattern);
  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (regex.test(stripSourceComments(content, path.extname(file).toLowerCase()))) return file;
  }
  return '';
}

function stripSourceComments(content, extension) {
  if (extension === '.py') {
    content = content.replace(/(^|\n)[ \t]*(?:[rubf]{0,2})?(?:"""[\s\S]*?"""|'''[\s\S]*?''')[ \t]*(?:#[^\r\n]*)?(?=\r?$)/gimu,
      (token) => token.replace(/[^\r\n]/gu, ' '));
  }
  const hashComments = extension === '.py' || extension === '.php';
  const tokens = hashComments
    ? /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->|\/\/[^\r\n]*|#[^\r\n]*/gu
    : /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->|\/\/[^\r\n]*/gu;
  return content.replace(tokens, (token) => {
    const comment = token.startsWith('//') || token.startsWith('/*') || token.startsWith('<!--')
      || (hashComments && token.startsWith('#'));
    return comment ? token.replace(/[^\r\n]/gu, ' ') : token;
  });
}

function implementationSourceFiles(projectPath, files = sourceFiles(projectPath), contents = null) {
  const testDirectories = new Set([
    '__fixtures__', '__tests__', 'fixtures', 'spec', 'specs', 'test', 'testfixtures', 'tests'
  ]);
  const generatedDirectories = new Set([
    '.generated', 'bin', 'gen', 'generated', 'generated-sources', 'generated-src', 'obj', 'out'
  ]);
  return files.filter((file) => {
    const relative = path.relative(projectPath, file);
    const parts = relative.split(path.sep);
    const lowerParts = parts.map((part) => part.toLowerCase());
    const basename = path.basename(file);
    const lowerBasename = basename.toLowerCase();
    const testDirectory = lowerParts.some((part) => testDirectories.has(part)
      || /^(?:.*[._-])?(?:integration|unit|functional|acceptance|e2e)?tests?$/u.test(part));
    const generatedDirectory = lowerParts.some((part) => generatedDirectories.has(part));
    const testFile = /(?:^|[._-])(?:test|tests|spec|specs)(?:[._-]|$)/u.test(lowerBasename)
      || /(?:Test|Tests|Spec|Specs)\.[^.]+$/u.test(basename)
      || lowerBasename === 'conftest.py';
    const generatedFile = /^generated/u.test(lowerBasename)
      || /(?:^|[._-])generated(?:[._-]|$)/u.test(lowerBasename)
      || /\.(?:g|designer)\.[^.]+$/u.test(lowerBasename)
      || /_pb2(?:_grpc)?\.py$/u.test(lowerBasename);
    let generatedHeader = false;
    try {
      const content = contents?.get(file)?.toString('utf8') ?? fs.readFileSync(file, 'utf8');
      generatedHeader = /^\s*(?:(?:\/\/|#|\/\*+|\*)\s*)?(?:<auto-generated|@generated\b|code generated by|generated by .{0,120}do not edit|this file was generated)/imu
        .test(content.slice(0, 4096));
    } catch {
      generatedHeader = true;
    }
    return !testDirectory && !generatedDirectory && !testFile && !generatedFile && !generatedHeader;
  });
}

function firstCodePatternMatch(files, pattern, contents = null) {
  const regex = new RegExp(pattern, 'iu');
  for (const file of files) {
    let content;
    try {
      content = contents?.get(file)?.toString('utf8') ?? fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const lines = stripSourceComments(content, path.extname(file).toLowerCase()).split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
      if (regex.test(lines[index])) {
        return { file, line: index + 1 };
      }
    }
  }
  return null;
}

function firstContentPatternMatch(file, content, pattern) {
  const match = new RegExp(pattern, 'iu').exec(content);
  if (!match) return null;
  return { file, line: content.slice(0, match.index).split(/\r?\n/u).length };
}

function auditFinding(projectPath, code, message, match = null) {
  const finding = { code, message };
  if (match) {
    finding.path = path.relative(projectPath, match.file).replace(/[\u0000-\u001f\u007f]/gu, '?');
    finding.line = match.line;
  }
  return finding;
}

const implementationRequiredPatterns = Object.freeze({
  AIPAY: [
    ['AIPAY_PAYMENT_NEEDED_MISSING', aipayPaymentNeededMarker, '缺少 Payment-Needed 账单响应'],
    ['AIPAY_PAYMENT_PROOF_MISSING', aipayPaymentProofMarker, '缺少 Payment-Proof 接收处理'],
    ['AIPAY_VERIFY_MISSING', aipayPaymentVerifyMarker, '缺少 alipay.aipay.agent.payment.verify 验付调用'],
    ['AIPAY_CONFIRM_MISSING', aipayFulfillmentConfirmMarker, '缺少 alipay.aipay.agent.fulfillment.confirm 履约确认'],
    ['AIPAY_VALIDATION_MISSING', aipayPaymentValidationMarker, '缺少 Payment-Validation 成功回执'],
    ['AIPAY_ACTIVE_CHECK_MISSING', '\\bactive\\b|getActive\\(|\\.Active\\b', '缺少验付 active 字段处理'],
    ['AIPAY_ORDER_CHECK_MISSING', 'out_trade_no|outTradeNo|OutTradeNo', '缺少商户订单号处理'],
    ['AIPAY_RESOURCE_CHECK_MISSING', 'resource_id|resourceId|ResourceId', '缺少资源标识处理']
  ],
  WEBPAY: [
    ['WEBPAY_CREATE_MISSING', webpayMarker, '缺少 alipay.trade.page.pay 下单入口'],
    ['TRADE_QUERY_MISSING', tradeQueryMarker, '缺少 alipay.trade.query 交易查询'],
    ['TRADE_REFUND_MISSING', tradeRefundMarker, '缺少 alipay.trade.refund 退款'],
    ['REFUND_QUERY_MISSING', tradeRefundQueryMarker, '缺少 alipay.trade.fastpay.refund.query 退款查询'],
    ['TRADE_CLOSE_MISSING', tradeCloseMarker, '缺少 alipay.trade.close 关闭交易'],
    ['TRADE_NOTIFY_MISSING', tradeNotifyMarker, '缺少异步通知处理入口']
  ],
  APPPAY: [
    ['APPPAY_CREATE_MISSING', apppayMarker, '缺少 alipay.trade.app.pay 下单入口'],
    ['TRADE_QUERY_MISSING', tradeQueryMarker, '缺少 alipay.trade.query 交易查询'],
    ['TRADE_REFUND_MISSING', tradeRefundMarker, '缺少 alipay.trade.refund 退款'],
    ['REFUND_QUERY_MISSING', tradeRefundQueryMarker, '缺少 alipay.trade.fastpay.refund.query 退款查询'],
    ['TRADE_CLOSE_MISSING', tradeCloseMarker, '缺少 alipay.trade.close 关闭交易'],
    ['TRADE_NOTIFY_MISSING', tradeNotifyMarker, '缺少异步通知处理入口']
  ]
});

export function inspectImplementation(variant, projectPath, snapshot = null) {
  if (!Object.prototype.hasOwnProperty.call(implementationRequiredPatterns, variant)) {
    throw new Error('implementation audit variant 非法，仅支持 AIPAY、WEBPAY、APPPAY');
  }
  if (!path.isAbsolute(projectPath) || !isReadableDirectory(projectPath)) {
    throw new Error('implementation audit 项目路径必须是可访问的绝对目录');
  }
  const currentSnapshot = snapshot || projectSnapshot(projectPath);
  const canonicalPath = currentSnapshot.canonicalPath;
  if (canonicalPath !== fs.realpathSync(projectPath)) throw new Error('implementation audit 项目快照路径不匹配');
  const files = implementationSourceFiles(canonicalPath, currentSnapshot.sources, currentSnapshot.contents);
  const findings = [];

  for (const [code, pattern, message] of implementationRequiredPatterns[variant]) {
    if (!firstCodePatternMatch(files, pattern, currentSnapshot.contents)) {
      findings.push(auditFinding(canonicalPath, code, message));
    }
  }

  const commonTradeRelevance = [tradeQueryMarker, tradeRefundMarker, tradeRefundQueryMarker, tradeCloseMarker, tradeNotifyMarker].join('|');
  const targetRelevancePattern = variant === 'AIPAY'
    ? aipayMarker
    : `${variant === 'WEBPAY' ? webpayMarker : apppayMarker}|${commonTradeRelevance}`;
  const criticalTodoPattern = '(?:TODO|FIXME)[\\s\\S]{0,240}(?:支付|订单|验付|验签|退款|履约|持久|幂等|payment|order|verify|signature|refund|fulfill|persist|idempot)';
  const fixedResourceFallbackPattern = '(?:resourceIdVerified|resource_id_verified|verifiedResourceId)\\s*=[\\s\\S]{0,240}(?:\\?\\?|\\|\\||\\bor\\b|\\?)[\\s\\S]{0,160}(?:RESOURCE_PATH|ResourcePath|resource\\.path)';
  const proofTradeFallbackPattern = '(?:fulfillmentTradeNo|fulfillment_trade_no)\\s*=[\\s\\S]{0,240}(?:\\?\\?|\\|\\||\\bor\\b|\\?)[\\s\\S]{0,160}(?:tradeNo|trade_no)';
  const mockBypassPattern = '(?:if|when)[\\s\\S]{0,240}(?:mock|test|sandbox)[\\s\\S]{0,320}(?:return\\s+true|bypass|skip|跳过)';

  for (const file of files) {
    let content;
    try {
      content = currentSnapshot.contents.get(file)?.toString('utf8') ?? fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const codeContent = stripSourceComments(content, path.extname(file).toLowerCase());
    const targetRelevant = new RegExp(targetRelevancePattern, 'iu').test(codeContent);
    const checks = [];
    if (targetRelevant || /alipay|支付宝|Payment-Proof/iu.test(codeContent)) {
      checks.push(['PAYMENT_VERIFICATION_BYPASS', mockBypassPattern, '存在测试/沙箱条件下直接绕过支付验签的生产代码']);
    }
    if (targetRelevant) {
      checks.push(['PAYMENT_CRITICAL_TODO', criticalTodoPattern, '支付关键控制仍保留 TODO/FIXME']);
    }
    for (const [code, pattern, message] of checks) {
      const match = firstContentPatternMatch(
        file,
        code === 'PAYMENT_CRITICAL_TODO' ? content : codeContent,
        pattern
      );
      if (match) findings.push(auditFinding(canonicalPath, code, message, match));
    }

    if (variant === 'AIPAY') {
      const blockChecks = [
        ['AIPAY_FIXED_RESOURCE_FALLBACK', fixedResourceFallbackPattern, 'A2M 验付字段缺失时回退到固定资源'],
        ['AIPAY_UNVERIFIED_TRADE_FALLBACK', proofTradeFallbackPattern, '履约交易号回退到未经验付响应确认的 Proof 字段']
      ];
      for (const [code, pattern, message] of blockChecks) {
        const match = firstContentPatternMatch(file, codeContent, pattern);
        if (match) findings.push(auditFinding(canonicalPath, code, message, match));
      }
    }

    const cwdConfig = /(?:process\.cwd\(\)|getcwd\(\)|Directory\.GetCurrentDirectory\(\)|System\.getProperty\(["']user\.dir["']\))[\s\S]{0,240}\.alipay-sandbox\.json|\.alipay-sandbox\.json[\s\S]{0,240}(?:process\.cwd\(\)|getcwd\(\)|Directory\.GetCurrentDirectory\(\)|System\.getProperty\(["']user\.dir["']\))/iu;
    const cwdMatch = cwdConfig.exec(codeContent);
    if (cwdMatch) {
      const line = codeContent.slice(0, cwdMatch.index).split(/\r?\n/u).length;
      findings.push(auditFinding(canonicalPath, 'SANDBOX_CONFIG_CWD_DEPENDENCY',
        '.alipay-sandbox.json 依赖进程当前目录定位', { file, line }));
    }

    const certificateExecution = /certificateExecute|certificate_execute|certExecute|ExecuteCertificate|ExecuteCert/iu.test(codeContent);
    const publicKeyConfiguration = /alipayPublicKey|alipay_public_key|AlipayPublicKey|setAlipayPublicKey/iu.test(codeContent);
    const completeCertificateConfiguration = [
      /appCertPublicKey|app_cert_public_key|AppCertPublicKey/iu,
      /alipayCertPublicKeyRSA2|alipay_cert_public_key|AlipayCertPublicKey/iu,
      /rootCert|root_cert|RootCert/iu
    ].every((pattern) => pattern.test(codeContent));
    if (certificateExecution && publicKeyConfiguration && !completeCertificateConfiguration) {
      const match = firstCodePatternMatch(
        [file], 'certificateExecute|certificate_execute|certExecute|ExecuteCertificate|ExecuteCert', currentSnapshot.contents);
      findings.push(auditFinding(canonicalPath, 'CERTIFICATE_MODE_MISMATCH',
        '公钥配置模式调用了证书执行 API，但未配置完整证书链', match));
    }
  }

  findings.sort((left, right) => `${left.code}:${left.path || ''}:${left.line || 0}`
    .localeCompare(`${right.code}:${right.path || ''}:${right.line || 0}`));
  for (const finding of findings) {
    finding.id = crypto.createHash('sha256')
      .update(JSON.stringify([variant, currentSnapshot.fingerprint, finding])).digest('hex');
  }
  return { projectPath: canonicalPath, variant, findings };
}

function reviewedAuditFindings(audit, rawReview, snapshot) {
  if (rawReview === undefined) return audit.findings.map((finding) => ({ ...finding, reviewDecision: 'UNREVIEWED' }));
  if (typeof rawReview !== 'string' || rawReview.length > 65536) throw new Error('audit-review 必须是受控 JSON 数组');
  let reviews;
  try { reviews = JSON.parse(rawReview); } catch { throw new Error('audit-review 不是合法 JSON'); }
  if (!Array.isArray(reviews)) throw new Error('audit-review 必须是 JSON 数组');
  const findings = new Map(audit.findings.map((finding) => [finding.id, finding]));
  const reviewedIds = new Set();
  const decisions = new Map();
  const excluded = new Set();
  const sources = new Set(implementationSourceFiles(snapshot.canonicalPath, snapshot.sources, snapshot.contents));
  for (const review of reviews) {
    if (!review || typeof review !== 'object' || Array.isArray(review)
      || Object.keys(review).some((key) => !['findingId', 'decision', 'evidence'].includes(key))
      || !findings.has(review.findingId) || reviewedIds.has(review.findingId)) {
      throw new Error('audit-review 必须逐项绑定当前产品和项目快照的唯一 findingId');
    }
    reviewedIds.add(review.findingId);
    if (!['FALSE_POSITIVE', 'CONFIRMED', 'UNRESOLVED'].includes(review.decision)) {
      throw new Error('audit-review decision 仅支持 FALSE_POSITIVE、CONFIRMED、UNRESOLVED');
    }
    decisions.set(review.findingId, review.decision);
    if (!Array.isArray(review.evidence) || review.evidence.length === 0 || review.evidence.length > 20) {
      throw new Error('audit-review 每项必须提供当前生产代码的定位和核对依据');
    }
    for (const evidence of review.evidence) {
      if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)
        || Object.keys(evidence).some((key) => !['path', 'line', 'reason'].includes(key))
        || typeof evidence.path !== 'string' || !evidence.path || evidence.path.includes('\\')
        || path.posix.isAbsolute(evidence.path) || path.win32.isAbsolute(evidence.path)
        || evidence.path.split('/').some((part) => !part || part === '.' || part === '..')
        || !Number.isInteger(evidence.line) || evidence.line < 1
        || typeof evidence.reason !== 'string' || evidence.reason.trim().length < 12 || evidence.reason.length > 2000
        || /[\u0000-\u001f\u007f]/u.test(evidence.reason)) {
        throw new Error('audit-review evidence 必须包含规范化相对 path、有效 line 和具体单行 reason');
      }
      const file = path.resolve(snapshot.canonicalPath, evidence.path);
      const source = snapshot.contents.get(file)?.toString('utf8');
      const lines = source === undefined ? [] : stripSourceComments(source, path.extname(file).toLowerCase()).split(/\r?\n/u);
      if (!sources.has(file) || !lines?.[evidence.line - 1]?.trim()) {
        throw new Error('audit-review evidence 必须指向当前快照内非空的生产源码行');
      }
    }
    // The runner validates the snapshot and locations; the Agent owns the code reasoning.
    // Unreviewed, confirmed and unresolved findings remain blocking.
    if (review.decision === 'FALSE_POSITIVE') excluded.add(review.findingId);
  }
  return audit.findings.filter((finding) => !excluded.has(finding.id))
    .map((finding) => ({ ...finding, reviewDecision: decisions.get(finding.id) || 'UNREVIEWED' }));
}

function mergeAuditItems(failedItems, findings) {
  let items = failedItems && failedItems !== '无' ? [failedItems] : [];
  if (items[0]?.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(items[0]);
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) items = parsed;
    } catch { /* Preserve plain text. */ }
  }
  items = items.flatMap((item) => item.split('；')).map((item) => item.trim()).filter(Boolean);
  for (const finding of findings) {
    const location = finding.path ? `（${finding.path}${finding.line ? `:${finding.line}` : ''}）` : '';
    const prefix = finding.reviewDecision === 'CONFIRMED' ? '' : '静态扫描疑点尚未排除：';
    const item = `${prefix}${finding.message}${location}`;
    if (!items.includes(item)) items.push(item);
  }
  return [...new Set(items)].join('；');
}

function scanProjectRoute(productType, projectPath, projectSelection) {
  if (!['aipay', 'webpay', 'apppay'].includes(productType)) {
    throw new Error('ROUTE_INSPECT_ERROR:productType 非法');
  }
  if (!['CURRENT_PROJECT', 'OTHER_PROJECT', 'PREPARED_NEW_PROJECT'].includes(projectSelection)) {
    throw new Error('ROUTE_INSPECT_ERROR:projectSelection 非法');
  }
  if (!path.isAbsolute(projectPath)) throw new Error('ROUTE_INSPECT_ERROR:projectPath 必须是绝对路径');
  if (!isReadableDirectory(projectPath)) throw new Error('ROUTE_INSPECT_ERROR:项目路径不可访问');

  const projectOrigin = projectSelection === 'PREPARED_NEW_PROJECT' ? 'NEW_PROJECT' : 'EXISTING_PROJECT';
  const projectOriginLabel = projectSelection === 'PREPARED_NEW_PROJECT' ? '本轮新建项目' : '现有项目';
  const targetMarker = productType === 'aipay' ? aipayMarker : productType === 'webpay' ? webpayMarker : apppayMarker;
  const files = sourceFiles(projectPath);
  const otherProducts = [];

  if (scanPattern(files, webpayMarker) && productType !== 'webpay') otherProducts.push('AI 网页应用收款');
  if (scanPattern(files, apppayMarker) && productType !== 'apppay') otherProducts.push('AI 移动应用收款');
  if (scanPattern(files, aipayMarker) && productType !== 'aipay') otherProducts.push('AI 按量付费');

  const otherProductsText = otherProducts.length > 0 ? otherProducts.join(',') : '无';
  let integrationStatus;
  let evidence;

  if (!scanPattern(files, targetMarker)) {
    if (otherProductsText === '无') {
      integrationStatus = 'NO_PAYMENT';
      evidence = projectSelection === 'PREPARED_NEW_PROJECT'
        ? '固定检查器扫描本轮已初始化的新项目，未发现目标产品或其他受支持支付代码'
        : '固定检查器未发现目标产品或其他受支持支付代码';
    } else {
      integrationStatus = 'OTHER_PRODUCT_ONLY';
      evidence = '固定检查器只发现其他受支持支付产品代码';
    }
  } else {
    const requiredPatterns = productType === 'aipay'
      ? [aipayPaymentNeededMarker, aipayPaymentProofMarker, aipayPaymentVerifyMarker, aipayFulfillmentConfirmMarker, aipayPaymentValidationMarker]
      : productType === 'webpay'
        ? [webpayMarker, tradeQueryMarker, tradeRefundMarker, tradeRefundQueryMarker, tradeCloseMarker, tradeNotifyMarker]
        : [apppayMarker, tradeQueryMarker, tradeRefundMarker, tradeRefundQueryMarker, tradeCloseMarker, tradeNotifyMarker];
    const missing = requiredPatterns.filter((pattern) => !scanPattern(files, pattern));
    integrationStatus = 'TARGET_PARTIAL';
    evidence = missing.length === 0
      ? '固定检查器逐项发现目标产品入口及全部核心接口标记，但静态扫描不能证明配置、安全、测试和 checklist 完成；必须进入 Integration 验证分支'
      : '固定检查器发现目标产品代码，但至少一个核心接口标记缺失；不得按完整集成路由';
  }

  return {
    projectSelection,
    projectOrigin,
    projectOriginLabel,
    integrationStatus,
    evidence,
    otherProducts: otherProductsText
  };
}

function runResolveProject(args) {
  const intent = required(args, 'intent');
  if (!['existing', 'new'].includes(intent)) throw new Error('intent 非法，仅支持 existing、new');
  const basePath = normalizeBasePath(required(args, 'base-path'));
  const input = sanitizeProjectInput(required(args, 'project-input'));
  if (args['target-path'] !== undefined) {
    throw new Error('参数 --target-path 已移除；现有项目和新建项目都使用 --project-path 传递真实路径');
  }
  const pathInput = sanitizeProjectInput(required(args, 'project-path'));

  if (intent === 'existing') {
    if (isExplicitNewProjectRequest(input)) {
      throw new Error('明确新建项目请求必须使用 --intent new，不能改用当前项目');
    }
    const existingInput = parseExistingProjectPath(pathInput);
    const candidate = currentProjectAliases.has(existingInput) ? basePath : resolveAgainstBase(existingInput, basePath);
    const projectPath = fs.existsSync(candidate) ? fs.realpathSync(candidate) : candidate;
    if (!fs.existsSync(projectPath) || !fs.statSync(projectPath).isDirectory()) {
      throw new Error('现有项目路径不可访问；请提供当前目录内相对路径或实际存在的绝对路径');
    }
    if (!isRecognizableProjectRoot(projectPath)) {
      const prefix = currentProjectAliases.has(existingInput)
        ? '当前目录不是可识别的项目根，不能直接作为现有项目扫描'
        : '该路径未识别到项目根标记，不能确认是服务端项目根';
      const searchBasePath = currentProjectAliases.has(existingInput) ? basePath : projectPath;
      throw projectRootError(searchBasePath, prefix, basePath);
    }
    return JSON.stringify({
      projectPath,
      projectSelection: classifyExistingProject(projectPath, basePath, existingInput),
      projectOrigin: 'EXISTING_PROJECT',
      projectOriginLabel: '现有项目'
    });
  }

  const newPathInput = parseNewProjectPath(pathInput);
  if (currentProjectAliases.has(newPathInput)) {
    throw new Error('新项目必须明确尚不存在或为空的子目录名');
  }
  const projectPath = resolveAgainstBase(newPathInput, basePath);
  const route = isWindowsPlatform()
    ? prepareNewProject(projectPath)
    : runUnixInspector(['prepare-new', projectPath], '新项目路径检查', '新项目路径检查器');
  return JSON.stringify({ projectPath, ...route });
}

function runLocateProjects(args) {
  const basePath = normalizeBasePath(required(args, 'base-path'));
  const searchBasePath = resolveSearchBasePath(args, basePath);
  const maxDepth = parseDepth(args['max-depth']);
  const format = args.format || 'json';
  if (!['json', 'message'].includes(format)) throw new Error('format 仅支持 json 或 message');
  const candidates = locateProjectCandidates(searchBasePath, maxDepth, 20, basePath, basePath);
  if (format === 'message') {
    return renderMessage('integration.project_candidates.select', 'DEFAULT', {
      searchBasePath,
      candidateRows: formatLocatedCandidateRows(candidates)
    });
  }
  return JSON.stringify({
    basePath,
    searchBasePath,
    maxDepth,
    candidates,
    nextAction: '请选择一个候选项目目录作为现有项目，或说明要新建的目录，例如“在当前目录新建 pay-demo”或“新建项目”。'
  });
}

function normalizeLanguage(input) {
  const value = input.trim();
  const compact = value.toLowerCase().replace(/[\s_.-]+/g, '');
  if (compact === 'java') return 'Java';
  if (compact === 'python' || compact === 'py' || compact === 'python3') return 'Python';
  if (compact === 'nodejs' || compact === 'node' || compact === 'javascript' || compact === 'js') return 'Node.js';
  if (compact === 'c#' || compact === 'csharp' || compact === 'dotnet' || compact === 'net') return 'C#';
  if (compact === 'php') return 'PHP';
  throw new Error('服务端语言非法，仅支持 Java、Python、Node.js、C#、PHP');
}

const existingProjectFrameworkFallback = '沿用现有项目结构';
const defaultFrameworks = Object.freeze({
  Java: 'Spring Boot',
  PHP: 'Laravel',
  Python: 'FastAPI',
  'C#': 'ASP.NET Core',
  'Node.js': 'Express'
});
const frameworkSources = new Set([
  'EXPLICIT',
  'DEFAULT_NEW_PROJECT',
  'PROJECT_INFERRED',
  'PROJECT_STRUCTURE_FALLBACK'
]);

function readProjectMarker(projectPath, relativePath) {
  const file = path.join(projectPath, relativePath);
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) return '';
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function readProjectJson(projectPath, relativePath) {
  const content = readProjectMarker(projectPath, relativePath);
  if (!content) return null;
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function dependencyNames(manifest) {
  const names = new Set();
  for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'require', 'require-dev']) {
    const dependencies = manifest?.[key];
    if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) continue;
    for (const name of Object.keys(dependencies)) names.add(name.toLowerCase());
  }
  return names;
}

function firstMatchingFramework(names, rules) {
  for (const [framework, matches] of rules) {
    if (matches.some((name) => names.has(name) || [...names].some((item) => item.startsWith(`${name}/`)))) {
      return framework;
    }
  }
  return '';
}

function inferFramework(projectPath, language) {
  if (language === 'Node.js') {
    return firstMatchingFramework(dependencyNames(readProjectJson(projectPath, 'package.json')), [
      ['NestJS', ['@nestjs/core']],
      ['Next.js', ['next']],
      ['Express', ['express']],
      ['Fastify', ['fastify']],
      ['Koa', ['koa']],
      ['Hono', ['hono']]
    ]);
  }
  if (language === 'PHP') {
    return firstMatchingFramework(dependencyNames(readProjectJson(projectPath, 'composer.json')), [
      ['Laravel', ['laravel/framework']],
      ['Symfony', ['symfony/framework-bundle', 'symfony/http-kernel']]
    ]);
  }
  if (language === 'Java') {
    const content = [
      readProjectMarker(projectPath, 'pom.xml'),
      readProjectMarker(projectPath, 'build.gradle'),
      readProjectMarker(projectPath, 'build.gradle.kts')
    ].join('\n').toLowerCase();
    if (/spring-boot|org\.springframework\.boot/u.test(content)) return 'Spring Boot';
    if (/io\.quarkus|quarkus-/u.test(content)) return 'Quarkus';
    if (/io\.micronaut|micronaut-/u.test(content)) return 'Micronaut';
    return '';
  }
  if (language === 'Python') {
    const content = [
      readProjectMarker(projectPath, 'pyproject.toml'),
      readProjectMarker(projectPath, 'requirements.txt'),
      readProjectMarker(projectPath, 'Pipfile')
    ].join('\n').toLowerCase();
    if (/(^|[^a-z])django([^a-z]|$)/u.test(content)) return 'Django';
    if (/(^|[^a-z])fastapi([^a-z]|$)/u.test(content)) return 'FastAPI';
    if (/(^|[^a-z])flask([^a-z]|$)/u.test(content)) return 'Flask';
    return '';
  }
  if (language === 'C#') {
    const content = safeReaddir(projectPath)
      .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name.toLowerCase().endsWith('.csproj'))
      .map((entry) => readProjectMarker(projectPath, entry.name))
      .join('\n').toLowerCase();
    if (/microsoft\.net\.sdk\.web|microsoft\.aspnetcore/u.test(content)) return 'ASP.NET Core';
    return '';
  }
  return '';
}

function sanitizeFramework(value) {
  const framework = value.trim();
  if (!framework || framework.length > 120 || /[\u0000-\u001f\u007f|`]/u.test(framework) || /https?:\/\//iu.test(framework)) {
    throw new Error('framework 必须是安全的单行框架名称');
  }
  return framework;
}

function deriveFramework(projectPath, projectSelection, language) {
  if (projectSelection === 'NEW_PROJECT' || projectSelection === 'PREPARED_NEW_PROJECT') {
    return { framework: defaultFrameworks[language], frameworkSource: 'DEFAULT_NEW_PROJECT' };
  }
  const inferred = inferFramework(projectPath, language);
  return {
    framework: inferred || existingProjectFrameworkFallback,
    frameworkSource: inferred ? 'PROJECT_INFERRED' : 'PROJECT_STRUCTURE_FALLBACK'
  };
}

function resolveFramework(args, projectPath, projectSelection, language) {
  const suppliedFramework = typeof args.framework === 'string' && args.framework.length > 0
    ? sanitizeFramework(args.framework)
    : '';
  const suppliedSource = typeof args['framework-source'] === 'string' ? args['framework-source'] : '';
  if (suppliedSource && !frameworkSources.has(suppliedSource)) {
    throw new Error('framework-source 非法，仅支持 EXPLICIT、DEFAULT_NEW_PROJECT、PROJECT_INFERRED、PROJECT_STRUCTURE_FALLBACK');
  }

  if (!suppliedSource) {
    return suppliedFramework
      ? { framework: suppliedFramework, frameworkSource: 'EXPLICIT' }
      : deriveFramework(projectPath, projectSelection, language);
  }
  if (!suppliedFramework) throw new Error('framework-source 必须与 framework 同时提供');
  if (suppliedSource === 'EXPLICIT') {
    return { framework: suppliedFramework, frameworkSource: suppliedSource };
  }

  const derived = deriveFramework(projectPath, projectSelection, language);
  if (derived.framework !== suppliedFramework || derived.frameworkSource !== suppliedSource) {
    throw new Error('framework 与当前项目推导事实不一致');
  }
  return derived;
}

function runFrameworkResolve(args) {
  const language = normalizeLanguage(required(args, 'language'));
  const projectSelection = required(args, 'project-selection');
  if (!['NEW_PROJECT', 'PREPARED_NEW_PROJECT', 'CURRENT_PROJECT', 'OTHER_PROJECT'].includes(projectSelection)) {
    throw new Error('project-selection 非法，仅支持 CURRENT_PROJECT、OTHER_PROJECT、NEW_PROJECT、PREPARED_NEW_PROJECT');
  }
  let projectPath = '';
  if (projectSelection === 'CURRENT_PROJECT' || projectSelection === 'OTHER_PROJECT') {
    projectPath = fs.realpathSync(required(args, 'project-path'));
    if (!isReadableDirectory(projectPath)) throw new Error('现有项目路径不可访问');
  }
  const resolved = resolveFramework(args, projectPath, projectSelection, language);
  return JSON.stringify({ language, ...resolved });
}

function startConfirmationFacts(args) {
  const rootIntent = required(args, 'root-intent');
  if (!['integration_only', 'full_process'].includes(rootIntent)) {
    throw new Error('root-intent 仅支持 integration_only、full_process');
  }
  const productType = required(args, 'product-type');
  const mapping = productVariants[productType];
  if (!mapping) throw new Error('product-type 非法，仅支持 aipay、webpay、apppay');

  const projectPath = required(args, 'project-path');
  const projectSelection = required(args, 'project-selection');
  const language = normalizeLanguage(required(args, 'language'));
  const { framework, frameworkSource } = resolveFramework(args, projectPath, projectSelection, language);
  const productName = args['product-name'] || mapping.productName;
  if (productName !== mapping.productName) throw new Error('product-name 与 product-type 不匹配');
  if (!path.isAbsolute(projectPath)) throw new Error('project-path 必须是绝对路径');

  const route = isWindowsPlatform()
    ? scanProjectRoute(productType, projectPath, projectSelection)
    : runUnixInspector(['scan', productType, projectPath, projectSelection], '项目检查', '项目检查器');
  if (route.projectSelection !== projectSelection) throw new Error('项目检查结果与本轮 projectSelection 不一致');
  const existing = projectSelection === 'CURRENT_PROJECT' || projectSelection === 'OTHER_PROJECT';
  const preparedNew = projectSelection === 'PREPARED_NEW_PROJECT';
  if (
    !(preparedNew && route.projectOrigin === 'NEW_PROJECT' && route.projectOriginLabel === '本轮新建项目') &&
    !(existing && route.projectOrigin === 'EXISTING_PROJECT' && route.projectOriginLabel === '现有项目')
  ) {
    throw new Error('项目来源与本轮项目选择不一致');
  }
  if (!['TARGET_PARTIAL', 'OTHER_PRODUCT_ONLY', 'NO_PAYMENT'].includes(route.integrationStatus)) {
    throw new Error('项目集成状态不允许发起代码开发确认');
  }
  if (typeof route.evidence !== 'string' || typeof route.otherProducts !== 'string') {
    throw new Error('项目检查结果缺少必要事实字段');
  }

  return {
    rootIntent,
    productType,
    variant: mapping.variant,
    productName,
    projectPath: fs.realpathSync(projectPath),
    projectSelection,
    language,
    framework,
    frameworkSource,
    route
  };
}

function renderStartConfirmation(facts) {
  return renderPlanMessage('integration.start.confirm', facts.variant, {
    productName: facts.productName,
    projectPath: facts.projectPath,
    projectOriginLabel: facts.route.projectOriginLabel,
    integrationStatus: facts.route.integrationStatus,
    otherProducts: facts.route.otherProducts,
    language: facts.language,
    framework: facts.framework,
    nextFlow: 'integration'
  });
}

export async function createStartConfirmation(args) {
  const facts = startConfirmationFacts(args);
  await startTelemetryRun(facts.rootIntent, facts.productType);
  return renderStartConfirmation(facts);
}

export function createChecklistScopeReceipt(productType, projectPath) {
  const variant = productVariants[productType]?.variant;
  if (!variant) throw new Error('checklist scope product-type 非法');
  const snapshot = projectSnapshot(projectPath);
  const run = requireChecklistRun(variant);
  importSnapshotChecks(run, snapshot);
  return encodeReceipt({
    schema_ver: 1,
    kind: receiptKinds.checklist,
    run_id: run.run_id,
    variant,
    project_path: snapshot.canonicalPath,
    project_fingerprint: snapshot.fingerprint
  });
}

function validateChecklistScopeReceipt(receipt, expectedVariant, expectedProjectPath, snapshot) {
  const payload = decodeReceipt(receipt, receiptKinds.checklist);
  const canonicalExpectedPath = fs.realpathSync(expectedProjectPath);
  return payload.run_id === requireChecklistRun(expectedVariant).run_id
    && payload.variant === expectedVariant
    && payload.project_path === canonicalExpectedPath
    && snapshot.canonicalPath === canonicalExpectedPath
    && snapshot.fingerprint === payload.project_fingerprint;
}

function a2mExecutionFacts(args) {
  const projectPath = fs.realpathSync(required(args, 'project-path'));
  if (!isReadableDirectory(projectPath)) throw new Error('A2M 联调项目路径不可访问');
  const method = required(args, 'http-method').toUpperCase();
  if (!['GET', 'POST'].includes(method)) throw new Error('http-method 仅支持 GET 或 POST');
  let serviceUrl;
  try {
    serviceUrl = new URL(required(args, 'service-url'));
  } catch {
    throw new Error('service-url 不是合法 URL');
  }
  if (!['http:', 'https:'].includes(serviceUrl.protocol) || serviceUrl.username || serviceUrl.password || serviceUrl.hash) {
    throw new Error('service-url 只允许不含凭据和 fragment 的 HTTP(S) URL');
  }
  let requestBodyHash = '';
  const requestBodyFile = args['request-body-file'];
  if (method === 'POST') {
    if (!requestBodyFile || !path.isAbsolute(requestBodyFile)) throw new Error('POST 必须传入绝对 --request-body-file');
    const stat = fs.lstatSync(requestBodyFile);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('request-body-file 必须是普通文件且不能是符号链接');
    requestBodyHash = crypto.createHash('sha256').update(fs.readFileSync(requestBodyFile)).digest('hex');
  } else if (requestBodyFile !== undefined) {
    throw new Error('GET 禁止传入 request-body-file');
  }
  return {
    project_path: projectPath,
    project_fingerprint: projectSnapshotFingerprint(projectPath),
    service_url: serviceUrl.href,
    http_method: method,
    request_body_sha256: requestBodyHash
  };
}

function a2mExecutionReceipt(facts, state = 'READY') {
  return encodeReceipt({
    schema_ver: 1,
    kind: receiptKinds.a2mExecution,
    state,
    ...facts
  });
}

export function guardA2mExecution(args) {
  const facts = a2mExecutionFacts(args);
  const priorReceipt = args['prior-receipt'];
  if (!priorReceipt) return { decision: 'RUN', receipt: a2mExecutionReceipt(facts) };
  const prior = decodeReceipt(priorReceipt, receiptKinds.a2mExecution);
  const unchanged = ['project_path', 'project_fingerprint', 'service_url', 'http_method', 'request_body_sha256']
    .every((key) => prior[key] === facts[key]);
  if (!unchanged) return { decision: 'RUN', receipt: a2mExecutionReceipt(facts) };
  if (prior.state === 'PASSED') return { decision: 'REUSE_PASSED', receipt: priorReceipt };
  if (prior.state === 'FAILED') return { decision: 'BLOCK_UNCHANGED', receipt: priorReceipt };
  return { decision: 'UNKNOWN_PREVIOUS_EXECUTION', receipt: priorReceipt };
}

export function completeA2mExecution(receipt, outcome) {
  if (!['PASSED', 'FAILED', 'INTERRUPTED'].includes(outcome)) {
    throw new Error('outcome 仅支持 PASSED、FAILED、INTERRUPTED');
  }
  const prior = decodeReceipt(receipt, receiptKinds.a2mExecution);
  if (prior.state !== 'READY') throw new Error('A2M execution receipt 已经终态化');
  const { schema_ver, kind, state, ...facts } = prior;
  void schema_ver;
  void kind;
  void state;
  return a2mExecutionReceipt(facts, outcome);
}

function runContextRequired(args) {
  const missingItems = required(args, 'missing-items');
  return renderMessage('integration.context.required', missingItems === '项目路径' ? 'PROJECT_PATH_ONLY' : 'DEFAULT', {
    missingItems
  });
}

function runProductClarify() {
  return renderMessage('product.clarify', 'DEFAULT', {});
}

function runProductUnsupported(args) {
  return renderMessage('product.unsupported', 'DEFAULT', {
    productName: required(args, 'product-name')
  });
}

function runWindowsSandboxSetup() {
  return renderMessage('sandbox.windows.manual_setup', 'DEFAULT', {});
}

function runLocalAcceptanceNotice() {
  return renderMessage('integration.local_acceptance.notice', 'DEFAULT', {});
}

function runA2mTestStart() {
  return renderMessage('a2m.test.start', 'DEFAULT', {});
}

function runSandboxAndroidClient() {
  return renderMessage('sandbox.android.client', 'DEFAULT', {});
}

function runServiceNotReady(args) {
  return renderMessage('integration.service.not_ready', 'DEFAULT', {
    recoveryAction: required(args, 'recovery-action')
  });
}

function runSafetyCloseout(args) {
  const variant = required(args, 'variant');
  if (variant !== 'APPPAY') throw new Error('safety-closeout 仅适用于 APPPAY；其他产品使用最终收口提醒');
  return requireCustomerMessageDelivery('integration.safety.closeout', renderMessage('integration.safety.closeout', variant, {}));
}

function runWindowsSandboxSummary(args) {
  const productName = required(args, 'product-name');
  const environmentRows = required(args, 'environment-rows');
  const passwordSaveHint = '已写入本地配置文件，默认不在对话中展开';
  const lines = environmentRows.split('\n');
  if (productName === 'AI 网页应用收款' && lines.slice(2).some((line) => line.includes(passwordSaveHint))) {
    throw new Error('网页收款沙箱摘要必须展示已校验的买家密码明文');
  }
  if (productName !== 'AI 网页应用收款' && (lines[2] !== `| 沙箱买家登录密码 | ${passwordSaveHint} |`
      || lines[3] !== `| 沙箱买家支付密码 | ${passwordSaveHint} |`)) {
    throw new Error('Windows 沙箱摘要的两个密码行必须只使用固定本地保存提示');
  }
  const summary = renderMessage('sandbox.environment.summary', 'DEFAULT', {
    productName: required(args, 'product-name'),
    configPath: required(args, 'config-path'),
    environmentRows
  });
  const reminder = renderMessage('sandbox.environment.reminder', 'WINDOWS', {});
  emitStageMetric('integration.create_sandbox');
  return requireCustomerMessageDelivery('sandbox.environment.summary', `${summary}\n\n${reminder}`);
}

async function readStdin() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  return input.trim() ? JSON.parse(input) : {};
}

function checklistInputFromArgs(args) {
  const mapping = {
    'overall-result': 'overallResult',
    'failed-items': 'failedItems',
    'manual-items': 'manualItems',
    'sandbox-summary': 'sandboxSummary',
    'sandbox-result': 'sandboxResult',
    'webpay-experience-result': 'webpayExperienceResult',
    'sandbox-config-state': 'sandboxConfigState',
    'blocking-defect-state': 'blockingDefectState',
    'execution-mode': 'executionMode',
    'next-flow-reminder': 'nextFlowReminder'
  };
  const hasTypedInput = Object.keys(mapping).some((name) => Object.prototype.hasOwnProperty.call(args, name));
  if (!hasTypedInput) return null;

  const input = {};
  for (const [argName, fieldName] of Object.entries(mapping)) {
    if (Object.prototype.hasOwnProperty.call(args, argName)) input[fieldName] = args[argName];
  }
  for (const requiredName of [
    'overall-result',
    'failed-items',
    'manual-items',
    'sandbox-config-state',
    'blocking-defect-state',
    'execution-mode',
    'next-flow-reminder'
  ]) {
    required(args, requiredName);
  }
  return input;
}

// Source and build inputs are fingerprinted before and after each actual project check.
// A retry replaces only the result of that command. A passing command cannot mask a different failure.
function requireChecklistRun(variant) {
  const run = currentRunContext();
  if (!run || run.terminal || run.product_type !== variant || !['integration_only', 'full_process'].includes(run.root_intent)) {
    throw new Error('checklist 需要与本会话、任务和产品匹配的活动开发任务');
  }
  return run;
}

function checkDirectory(run, snapshot) {
  const project = crypto.createHash('sha256').update(snapshot.canonicalPath).digest('hex');
  return path.join(telemetryStoragePaths().run_state_file + '.checks', run.run_id, run.product_type, project);
}

function resultFiles(directory) {
  try { return fs.readdirSync(directory).filter(name => name.endsWith('.json')); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

// review.5 recorded only the snapshot (which hashes the canonical project path).
// Adopt records only when their original scope is unambiguous.
function importSnapshotChecks(run, snapshot) {
  const oldDir = path.join(telemetryStoragePaths().run_state_file + '.checks', run.run_id, snapshot.fingerprint);
  const directory = checkDirectory(run, snapshot);
  for (const name of resultFiles(oldDir)) {
    if (!/^[a-f0-9]{64}\.json$/u.test(name)) continue;
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    try { fs.renameSync(path.join(oldDir, name), path.join(directory, name.slice(0, -5) + '.legacy.' + snapshot.fingerprint + '.json')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function readProjectChecksOnce(run, snapshot) {
  importSnapshotChecks(run, snapshot);
  const directory = checkDirectory(run, snapshot);
  const records = [];
  for (const name of resultFiles(directory)) {
    let record;
    try { record = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const [key, owner, id] = name.split('.');
    if (owner === 'legacy') record.fingerprint = id;
    if (record.state === 'pending') {
      try { process.kill(Number(owner), 0); }
      catch (error) { if (error.code === 'ESRCH') record.state = 'failed'; }
    }
    records.push({ ...record, key, file: path.join(directory, name) });
  }
  return records;
}

function readProjectChecks(run, snapshot) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { return readProjectChecksOnce(run, snapshot); }
    catch (error) {
      if (attempt === 1) throw new Error('当前工程检查证据无法可靠读取，已尝试恢复；请恢复本机检查记录后重试当前步骤。依赖该证据的步骤已暂停。', { cause: error });
    }
  }
}

function coveredCheck(previous, key, plan) {
  if (previous.key === key) return true;
  // Only explicitly enumerated Node test files have provable set coverage here.
  // A package script or implicit test discovery may select a different target.
  return previous.nodeTestFiles?.length && plan.nodeTestFiles
    && previous.nodeTestFiles.every(file => plan.nodeTestFiles.includes(file));
}

function projectCheckPlan(argv, snapshot) {
  const [executable, ...args] = argv;
  const name = path.basename(executable).toLowerCase().replace(/\.(?:exe|cmd|bat)$/u, '');
  const python = /^(?:py|python(?:3(?:\.\d+)?)?)$/u.test(name);
  const files = new Set(snapshot.files.map(f => path.relative(snapshot.canonicalPath, f).split(path.sep).join('/')));
  const isProjectFile = arg => files.has(path.relative(snapshot.canonicalPath, path.resolve(snapshot.canonicalPath, arg)).split(path.sep).join('/'));
  const testFile = arg => isProjectFile(arg) && /(?:^|[/\\._-])(?:tests?|specs?)(?:[/\\._-]|$)|(?:Test|Tests|Spec|Specs)\.[^.]+$/u.test(arg);
  const hasTests = [...files].some(testFile);
  let manifest = {};
  if (files.has('package.json')) {
    try { manifest = JSON.parse(fs.readFileSync(path.join(snapshot.canonicalPath, 'package.json'), 'utf8')); } catch { /* Invalid project manifest cannot establish a script target. */ }
  }
  const scripts = manifest.scripts || {};
  function projectTestScript(key, body) {
    if (typeof body !== 'string' || !body.trim()) return false;
    // A named package target must lead to a real test runner or a project test entry.
    // Complex shell logic and execution-suppressing options are indeterminate here.
    if (/[;|\n]/u.test(body) || /(?:^|\s)(?:--help|--version|--listTests|--showConfig|--collect-only|--dry-run|--passWithNoTests)(?:\s|$)/u.test(body)) return false;
    return body.split(/\s*&&\s*/u).some(segment => {
      const parts = segment.trim().split(/\s+/u);
      const tool = path.basename(parts[0]);
      if (tool === 'node' && parts[1] === '--test') return hasTests || parts.slice(2).some(testFile);
      if (['jest','vitest','mocha','ava','tap','pytest','phpunit'].includes(tool)) return hasTests;
      if (parts.length === 2 && ['node','python','python3','php','bash','sh'].includes(tool)) {
        const entry = parts[1].replace(/^["']|["']$/gu, '');
        return testFile(entry) || isProjectFile(entry) && /test|verify/iu.test(key) && /test|verify/iu.test(path.basename(entry));
      }
      return false;
    });
  }
  const testScript = key => projectTestScript(key, scripts[key]);
  const packageHasTests = Object.keys(scripts).some(testScript);
  const requiresTest = hasTests || packageHasTests;
  if ((name === 'node' || name === 'npm' || name === 'dotnet') && args[0] === '-v') return {};
  if (args.some(a => ['--help','-h','--version','--collect-only','--listTests','--showConfig','--dry-run','-DskipTests','-Dmaven.test.skip=true'].includes(a))) return {};
  if (name === 'node') {
    if (args[0] === '--test' && args.length === 1 && hasTests) return { level: 'test' };
    if (args[0] === '--test' && args.length > 1 && args.slice(1).every(testFile)) {
      const nodeTestFiles = args.slice(1).map(file => crypto.createHash('sha256')
        .update(JSON.stringify([executable, path.resolve(snapshot.canonicalPath, file)])).digest('hex'));
      return { level: 'test', nodeTestFiles };
    }
    if (args.length === 2 && ['--check','-c'].includes(args[0]) && isProjectFile(args[1]) && /\.(?:[cm]?js)$/iu.test(args[1])) return { level:'static', requiresTest };
  }
  if (['npm','pnpm','yarn'].includes(name)) {
    const target = args[0] === 'run' ? args[1] : args[0];
    if (testScript(target)) return { level:'test' };
    if (typeof scripts[target] === 'string' && /^(?:tsc|eslint|vite\s+build|next\s+build|webpack|biome\s+check|node\s+--check)(?:\s|$)/u.test(scripts[target].trim()) && !/[;|]/u.test(scripts[target]) && !/(?:--version|--help)(?:\s|$)/u.test(scripts[target])) return { level:'static', requiresTest };
  }
  const isPython = python;
  const testRunner = isPython && args[0] === '-m' ? args[1] : name;
  if (['pytest','unittest'].includes(testRunner) && (hasTests || files.has('pytest.ini') || files.has('pyproject.toml'))) return { level:'test' };
  if (isPython && args[0] === '-m' && args[1] === 'py_compile' && args.length > 2 && args.slice(2).every(isProjectFile)) return { level:'static', requiresTest };
  if (name === 'php' && args.length === 2 && args[0] === '-l' && isProjectFile(args[1])) return { level:'static', requiresTest };
  if (name === 'phpunit' && (files.has('composer.json') || hasTests)) return { level:'test' };
  if (['mvn','mvnw'].includes(name) && files.has('pom.xml') && args.some(a => ['test','verify'].includes(a))) return { level:'test' };
  if (['gradle','gradlew'].includes(name) && ['build.gradle','build.gradle.kts'].some(f => files.has(f)) && args.some(a => /(?:^|:)(?:test|check)$/u.test(a))) return { level:'test' };
  if (name === 'dotnet' && ['test','build'].includes(args[0]) && [...files].some(f => /\.(?:csproj|sln)$/iu.test(f))) return { level:args[0] === 'test' ? 'test' : 'static', requiresTest };
  if (name === 'tsc' && files.has('tsconfig.json') && args.includes('--noEmit')) return { level:'static', requiresTest };
  if (name === 'go' && args[0] === 'test' && files.has('go.mod')) return { level:'test' };
  if (['make','gmake'].includes(name)) {
    const makefile = ['Makefile','makefile','GNUmakefile'].find(f => files.has(f));
    const target = args.find(a => !a.startsWith('-'));
    if (makefile && target && /^[A-Za-z0-9_./-]+$/u.test(target)) {
      const rules = fs.readFileSync(path.join(snapshot.canonicalPath, makefile),'utf8').split(/\r?\n/u);
      const idx = rules.findIndex(line => line.includes(':') && line.split(':',1)[0].split(/\s+/u).includes(target));
      if (idx >= 0) {
        const recipe = [];
        for (const line of rules.slice(idx+1)) {
          if (!line.trim() || line.trimStart().startsWith('#')) continue;
          if (!line.startsWith('\t')) break;
          recipe.push(line.trim().replace(/^[@+-]+/u, ''));
        }
        if (recipe.some(command => projectTestScript(target, command))) return { level:'test' };
        if (recipe.some(command => /^(?:tsc|eslint|dotnet build|node --check|php -l)(?:\s|$)/u.test(command))) return { level:'static', requiresTest };
      }
    }
  }
  // Some projects use an actual test file as their runner without a package script.
  if (args.length === 1 && (name === 'node' || isPython || name === 'php')) {
    const target = args[0];
    if (testFile(target)) return { level:'test' };
  }
  if (name === 'composer' && files.has('composer.json')) {
    let composer;
    try { composer = JSON.parse(fs.readFileSync(path.join(snapshot.canonicalPath, 'composer.json'), 'utf8')); } catch { return {}; }
    const target = args[0] === 'run-script' || args[0] === 'run' ? args[1] : args[0];
    const body = composer.scripts?.[target];
    if (body && projectTestScript(target, Array.isArray(body) ? body.join(' && ') : body)) return { level:'test' };
  }
  return {};
}

export function executeProjectCheck(argv, cwd, { platform = process.platform, env = process.env, execute = spawnSync } = {}) {
  const options = { cwd, env, shell:false, stdio:'inherit', timeout:120000, windowsHide:true };
  const [program,...args] = argv;
  if (platform !== 'win32') return execute(program, args, options);
  const name = path.win32.basename(program).toLowerCase().replace(/\.(?:exe|com|bat|cmd)$/u, '');
  if (/^npm(?:\.cmd)?$/iu.test(program)) {
    const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (fs.existsSync(npmCli)) return execute(process.execPath, [npmCli,...args], options);
  }
  let executable = program;
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(name) && !/[/\\]/u.test(program)) {
    const search = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] || '';
    const pathExt = Object.entries(env).find(([key]) => key.toLowerCase() === 'pathext')?.[1] || '.COM;.EXE;.BAT;.CMD';
    const extensions = path.extname(program) ? [''] : pathExt.split(';').filter(ext => /^\.(?:com|exe|bat|cmd)$/iu.test(ext));
    const candidates = search.split(';').filter(Boolean).flatMap(directory => extensions.map(extension =>
      path.resolve(cwd, directory.replace(/^"(.*)"$/u, '$1'), program + extension.toLowerCase())));
    executable = candidates.find(file => {
      try { return fs.statSync(file).isFile(); }
      catch { return false; }
    }) || program;
  }
  if (/\.(?:bat|cmd)$/iu.test(executable)) {
    // cmd scripts need the Windows command interpreter. Only simple literal tokens
    // can cross that boundary. Native .exe commands retain argument-array semantics.
    const batch = path.isAbsolute(executable) ? executable : path.resolve(cwd, executable);
    if (/["%\r\n]/u.test(batch) || args.some(arg => /["%&|^<>!()\r\n]/u.test(arg))) throw new Error('该 Windows 脚本参数包含命令解释字符，请使用原生可执行工具或已声明的工程目标');
    if (!fs.existsSync(batch)) throw new Error('Windows 工程脚本需要实际项目路径或绝对路径');
    const line = [batch,...args].map(arg => '"' + arg + '"').join(' ');
    return execute(path.join(env.SystemRoot || 'C:\\Windows','System32','cmd.exe'),
      ['/d','/v:off','/s','/c','"' + line + '"'], { ...options, windowsVerbatimArguments:true });
  }
  return execute(executable, args, options);
}

function runProjectCheck(args) {
  const variant = required(args, 'variant');
  const run = requireChecklistRun(variant);
  // Re-entering verification supersedes its previous terminal result, including
  // attempts rejected for a stale scope before a command can run.
  clearFullProcessDecision(run);
  const project = required(args, 'project-path');
  const snapshot = projectSnapshot(project);
  if (!validateChecklistScopeReceipt(required(args, 'scope-receipt'), variant, project, snapshot)) {
    throw new Error('工程检查需要当前开发任务和工程版本的 checklist 范围');
  }
  let argv;
  try { argv = JSON.parse(required(args, 'argv-json')); } catch { throw new Error('检查命令须为 JSON 参数数组'); }
  if (!Array.isArray(argv) || !argv.length || argv.length > 128 || argv.some(a => typeof a !== 'string' || a.includes('\0')) || !argv[0]) {
    throw new Error('检查命令须为可执行程序及其参数');
  }
  const key = crypto.createHash('sha256').update(JSON.stringify(argv)).digest('hex');
  const plan = projectCheckPlan(argv, snapshot);
  if (!plan.level) throw new Error('需要与当前工程关联的本地测试、构建或静态检查命令');
  const directory = checkDirectory(run, snapshot);
  const file = path.join(directory, key + '.' + process.pid + '.' + crypto.randomUUID() + '.json');
  // Keep command arguments (which may include credentials) out of local receipts.
  // Hashed targets can be matched to files still present in the current project.
  const rawTool = path.basename(argv[0]).toLowerCase().replace(/\.(?:exe|cmd|bat)$/u, '');
  const tool = /^(?:py|python(?:3(?:\.\d+)?)?)$/u.test(rawTool) ? 'python' : rawTool;
  const explicitFiles = new Set(argv.slice(1).filter(arg => !arg.startsWith('-'))
    .map(arg => path.resolve(snapshot.canonicalPath, arg)));
  const targetRefs = snapshot.files.filter(file => explicitFiles.has(file)).map(file =>
    projectFileId(snapshot.canonicalPath, file));
  const record = { ...plan, tool, targetRefs, fingerprint: snapshot.fingerprint,
    nodeTestGroup: tool === 'node' && argv.length === 2 && argv[1] === '--test' };
  writeLocalResult(file, { ...record, state: 'pending' });
  try {
    // Resolve only results that were already known when this retry began.
    // A concurrent failure remains pending remediation even if this attempt succeeds.
    const previous = readProjectChecks(run, snapshot).filter(check =>
      check.state !== 'pending' && coveredCheck(check, key, plan));
    const result = executeProjectCheck(argv, snapshot.canonicalPath);
    if (projectSnapshotFingerprint(project) !== snapshot.fingerprint || currentRunContext()?.run_id !== run.run_id) {
      throw new Error('运行检查时任务或工程已变化，请重新取得当前范围');
    }
    if (result.error || result.status !== 0) throw new Error('本地工程检查未通过或未能运行，已记录结果');
    writeLocalResult(file, { ...record, state: 'passed' });
    for (const check of previous) fs.rmSync(check.file, { force: true });
    process.stderr.write(internalPrefix + 'PROJECT_CHECK=passed\n');
  } catch (error) {
    writeLocalResult(file, { ...record, state: 'failed' });
    throw error;
  }
}

function projectFileId(root, file) {
  return crypto.createHash('sha256').update(path.relative(root, file)).digest('hex');
}

function projectCheckFindings(checks, snapshot) {
  const findings = [];
  const unfinished = checks.some(c => c.state !== 'passed');
  if (unfinished) findings.push({ code: 'PROJECT_CHECK_FAILED', message: '请复核未通过或仍在执行的工程检查' });
  // Native JS sources can be parsed offline without loading merchant application code.
  // Scope the built-in check to the payment implementation and its module format.
  const files = implementationSourceFiles(snapshot.canonicalPath, snapshot.sources, snapshot.contents);
  const paymentModules = files.filter(file => /\.(?:mjs|cjs|js)$/iu.test(file) && /alipay|Payment-(?:Needed|Proof)|notify_url/iu.test(snapshot.contents.get(file).toString('utf8')));
  for (const file of paymentModules) {
    const result = spawnSync(process.execPath, ['--check', file], { cwd: snapshot.canonicalPath, shell: false, stdio: 'ignore', timeout: 10000 });
    if (result.error || result.status !== 0) findings.push(auditFinding(snapshot.canonicalPath, 'PROJECT_SYNTAX_FAILED', '支付代码未通过 Node 语法检查', { file }));
  }
  if (!unfinished && !checks.some(c => c.fingerprint === snapshot.fingerprint && c.state === 'passed' && (c.level === 'test' || !c.requiresTest))) findings.push({ code: 'PROJECT_CHECK_MISSING', message: '缺少本轮实际运行的适用工程检查结果，按当前工程运行定向检查后再判断' });
  return findings;
}

// One low-sensitivity receipt per session. A fresh checklist invalidates the prior decision.
function handoffPath() {
  return telemetryStoragePaths().run_state_file + '.handoff';
}

export function clearFullProcessDecision(run) {
  if (run?.root_intent === 'full_process') fs.rmSync(handoffPath(), { force: true });
}

export function recordFullProcessDecision(run, product, input, snapshot) {
  if (!run || run.terminal || run.root_intent !== 'full_process' || run.product_type !== product.toUpperCase()) return;
  let result = '未通过';
  if (input.executionMode === '完整接入' && input.blockingDefectState === 'NONE') {
    if (input.overallResult === '通过' && input.sandboxConfigState === 'READY' && input.failedItems === '无' && input.manualItems === '无') result = '已完成';
    if (input.overallResult === '部分通过' && ['CREATE_PENDING', 'VERIFY_PENDING'].includes(input.sandboxConfigState)) result = '部分完成，沙箱配置待完成';
    if (input.overallResult === '部分通过' && input.sandboxConfigState === 'READY' && input.failedItems === '无' && input.manualItems !== '无') result = '部分完成，人工待验证';
  }
  const decision = { run: run.run_id, product: product.toLowerCase(), result, sandbox: input.sandboxConfigState, entered: false,
    project: snapshot.canonicalPath, fingerprint: snapshot.fingerprint };
  writeHandoff(decision);
}

function writeHandoff(decision) {
  writeLocalResult(handoffPath(), decision);
}

function writeLocalResult(file, value) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const tmp = file + '.' + crypto.randomUUID() + '.tmp';
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
      fs.renameSync(tmp, file);
      return;
    } catch (error) {
      if (attempt === 1) throw new Error('当前工程检查或交接证据无法保存，已尝试恢复；请恢复本机状态目录后重试当前步骤。依赖该证据的步骤已暂停。', { cause: error });
    } finally {
      try { fs.rmSync(tmp, { force: true }); } catch { /* Keep the original evidence error and retry budget. */ }
    }
  }
}

export function checkFullProcessDecision(product, { result, sandbox, enter = false } = {}) {
  const run = currentRunContext();
  let d;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { d = JSON.parse(fs.readFileSync(handoffPath(), 'utf8')); break; }
    catch { /* Retry once; unavailable evidence cannot authorize handoff. */ }
  }
  if (!d || !run || run.terminal || run.root_intent !== 'full_process' || d.run !== run.run_id || d.product !== product
    || run.product_type !== product.toUpperCase() || d.result === '未通过' || (result === undefined ? !d.entered : d.result !== result || d.sandbox !== sandbox)) {
    throw new Error('没有同一 run 和产品的可衔接 checklist 终态；不得进入 Onboarding。请恢复本机交接证据，或重新完成当前项目校验后再继续开通。');
  }
  // The checklist already validated the project and its checks. Handoff consumes
  // that terminal result without reopening the project or recomputing a snapshot.
  // Starting another checklist/project check revokes the previous decision.
  if (enter) writeHandoff({ ...d, entered: true });
}

async function runChecklistResult(args) {
  const variant = required(args, 'variant');
  if (!['AIPAY', 'WEBPAY', 'APPPAY'].includes(variant)) throw new Error('variant 非法，仅支持 AIPAY、WEBPAY、APPPAY');
  clearFullProcessDecision(currentRunContext());
  const run = requireChecklistRun(variant);
  if (Object.prototype.hasOwnProperty.call(args, 'implementation-audit-receipt')) {
    throw new Error('implementation-audit-receipt 已废弃');
  }
  const finalizesAuditFindings = Object.prototype.hasOwnProperty.call(args, 'finalize-audit-findings');
  if (finalizesAuditFindings && args['finalize-audit-findings'] !== 'true') {
    throw new Error('finalize-audit-findings 只允许 true');
  }
  const scopeReceipt = required(args, 'scope-receipt');
  const projectPath = required(args, 'project-path');
  const snapshot = projectSnapshot(projectPath);
  if (!validateChecklistScopeReceipt(scopeReceipt, variant, projectPath, snapshot)) {
    throw new Error('项目在当前 checklist 开始后发生变化，或产品不匹配；必须重新进入 checklist 阶段并重跑受影响检查');
  }
  const input = checklistInputFromArgs(args) || await readStdin();
  const audit = inspectImplementation(variant, projectPath, snapshot);
  if (input.executionMode !== (run.root_intent === 'full_process' ? '完整接入' : '仅代码开发')) {
    throw new Error('校验结果的任务类型与当前任务不一致');
  }
  const checks = readProjectChecks(run, snapshot);
  const reviewed = reviewedAuditFindings(audit, args['audit-review'], snapshot);
  audit.findings = reviewed;
  if (input.overallResult !== '未通过') audit.findings.push(...projectCheckFindings(checks, snapshot));
  if (audit.findings.length === 0 && finalizesAuditFindings && input.overallResult !== '未通过') {
    throw new Error('finalize-audit-findings 仅用于收口实际 audit findings');
  }
  if (audit.findings.length > 0) {
    if (args['finalize-audit-findings'] !== 'true') {
      process.stderr.write(`${internalPrefix}CHECKLIST_AUDIT=${JSON.stringify({
        state: 'REPAIR_REQUIRED',
        findings: audit.findings
      })}\n`);
      return null;
    }
    input.overallResult = '未通过';
    input.blockingDefectState = 'PRESENT';
    input.failedItems = mergeAuditItems(input.failedItems, audit.findings);
    if (input.executionMode === '完整接入') {
      input.nextFlowReminder = '代码开发校验通过后将自动进入支付产品-产品开通；未通过时停留在代码开发。';
    }
  }
  const rendered = renderMessage('integration.checklist.result', variant, input);
  recordFullProcessDecision(run, variant, input, snapshot);
  if (input.overallResult !== '未通过' && input.blockingDefectState === 'NONE') emitStageMetric('integration.complete_coding');
  emitStageMetric('integration_summary');
  return requireCustomerMessageDelivery('integration.checklist.result', rendered);
}

export async function runIntegrationMessageCli(argv = process.argv) {
  const { command, args } = parseArgs(argv);
  if (command === 'resolve-project') {
    console.log(runResolveProject(args));
    return;
  }
  if (command === 'locate-projects') {
    console.log(runLocateProjects(args));
    return;
  }
  if (command === 'start-confirm') {
    console.log(await createStartConfirmation(args));
    process.stderr.write(`${internalPrefix}CUSTOMER_MESSAGE_DELIVERY_REQUIRED=integration.start.confirm\n`);
    return;
  }
  if (command === 'framework-resolve') {
    console.log(runFrameworkResolve(args));
    return;
  }
  if (command === 'a2m-execution-guard') {
    process.stderr.write(`${internalPrefix}A2M_EXECUTION=${JSON.stringify(guardA2mExecution(args))}\n`);
    return;
  }
  if (command === 'a2m-execution-result') {
    const receipt = completeA2mExecution(required(args, 'receipt'), required(args, 'outcome'));
    process.stderr.write(`${internalPrefix}A2M_EXECUTION=${JSON.stringify({ decision: 'RECORDED', receipt })}\n`);
    return;
  }
  if (command === 'context-required') {
    console.log(runContextRequired(args));
    return;
  }
  if (command === 'product-clarify') {
    console.log(runProductClarify());
    return;
  }
  if (command === 'product-unsupported') {
    console.log(runProductUnsupported(args));
    return;
  }
  if (command === 'windows-sandbox-setup') {
    console.log(runWindowsSandboxSetup());
    return;
  }
  if (command === 'local-acceptance-notice') {
    console.log(runLocalAcceptanceNotice());
    return;
  }
  if (command === 'a2m-test-start') {
    console.log(runA2mTestStart());
    return;
  }
  if (command === 'sandbox-android-client') {
    console.log(runSandboxAndroidClient());
    return;
  }
  if (command === 'service-not-ready') {
    console.log(runServiceNotReady(args));
    return;
  }
  if (command === 'safety-closeout') {
    console.log(runSafetyCloseout(args));
    return;
  }
  if (command === 'windows-sandbox-summary') {
    console.log(runWindowsSandboxSummary(args));
    return;
  }
  if (command === 'project-check') return runProjectCheck(args);
  if (command === 'checklist-result') {
    const rendered = await runChecklistResult(args);
    if (rendered !== null) console.log(rendered);
    return;
  }
  throw new Error('用法: integration_message_runner.mjs <resolve-project|locate-projects|framework-resolve|start-confirm|a2m-execution-guard|a2m-execution-result|context-required|product-clarify|product-unsupported|windows-sandbox-setup|local-acceptance-notice|a2m-test-start|sandbox-android-client|service-not-ready|safety-closeout|windows-sandbox-summary|project-check|checklist-result> ...');
}

if (isMainModule(import.meta.url)) {
  runIntegrationMessageCli().catch((error) => {
    console.error(`INTEGRATION_MESSAGE_ERROR:${error.message}`);
    process.exitCode = 1;
  });
}
