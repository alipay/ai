#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import process from 'node:process';
import {verifySessionSkill, readSessionSkill} from './session_skill.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isWindowsPlatform } from './platform_compat.mjs';
import { renderMessage } from './render_customer_message.mjs';

const marker = 'ALIPAY_AIPAY_INTERNAL:CHANNEL_OFFER=';
const explicitPre = /(?:安装并使用|安装并用|安装|使用|切换到?|切到|转到|换到|换成|改用|改成|选择|试用|试试|体验|启用|用|装|我要|我选|给我)(?:这个|该|一下|下)?(?:内测版|预发版|alipay-aipay-pre)|(?:内测版|预发版|alipay-aipay-pre).{0,6}(?:我想|我要|请)(?:安装|使用|切换|试用|体验)|\b(?:use|install|switch\s+to|try)\s+(?:the\s+)?(?:pre(?:view)?\s+version|alipay-aipay-pre)\b/iu;
const negativePre = /(?:不(?:准备|希望|打算|需要|愿意|想要|想|要|允许|授权|接受)?|别|不要|无需|无须|暂不|先不|取消|拒绝|禁止)\s*(?:给我|帮我|让我)?\s*(?:安装|切换到?|切到|使用|选择|试用|用|装)?\s*(?:内测版|预发版)|(?:内测版|预发版)\s*(?:不用|不要|算了)|\b(?:no|not|don't|cancel)\b/iu;
const stableChoice = /(?:^|[，,。;；\s])(?:继续|使用|保持|选择|留在)(?:当前)?(?:的)?(?:正式版|稳定版)|(?:正式版|稳定版).{0,8}(?:继续|就好|即可)|\bstable\b/iu;
const uncertain = /[?？]|(?:吗|么|呢)$|是否|能否|可否|能不能|可不可以|要不要|是不是|多久|多少钱|如何|有没有|如果|假如|考虑|可能|也许|了解|介绍|区别|什么|怎么|为什么|之后再|以后再|稍后再|\b(?:if|maybe|perhaps|what|why|how|whether)\b/iu;
const exactConfirm = /^(?:确认|确定|同意|是的|yes|confirm)$/iu;
const contextualConfirm = /^(?:(?:好|好的|可以|没问题)[，,\s]*)?(?:我)?(?:确认|确定|同意)(?:[，,\s]*(?:请|现在)?(?:帮我|给我)?(?:安装|装|装上|使用|切换|切过去|用上)(?:一下|吧)?(?:内测版|预发版)?)?$|^(?:(?:好|好的|可以|没问题)[，,\s]*(?:就)?)?按你说的(?:安装|装|切换|用)(?:内测版|预发版)?(?:吧)?$/iu;
const contextualInstall = /^(?:(?:好|好的|可以|没问题)[，,\s]*)?(?:请|现在)?(?:帮我|给我)?(?:安装|装|装上|切换|切过去|用上)(?:一下)?(?:吧)?$/u;
const genericStable = /^(?:继续|OK|1|照原任务继续)$/iu;
const reportedChoice = /(?:朋友|同事|别人|有人|文档|示例|命令|文案).{0,8}(?:说|写|提到|包含|是)|(?:他|她|他们|用户|客户)(?:回复|说的|说过|写的|提到|问).{0,20}(?:确认|内测版|预发版)|我(?:说的是|问的是|写的是).{0,20}(?:确认|内测版|预发版)/u;
const deniedConfirmation = /(?:不|没|未)\s*(?:想|要|曾|有|说|表示)?\s*(?:确认|确定|决定|同意|说过).{0,12}(?:内测版|预发版)|(?:没|未)\s*说.{0,8}(?:使用|安装|切换).{0,4}(?:内测版|预发版)|(?:内测版|预发版).{0,8}(?:还没|尚未|未|没)(?:确认|决定)/u;
const unclearIntent = /(?:你|您)(?:刚才|之前)?(?:说|建议|推荐).{0,15}(?:内测版|预发版)|(?:内测版|预发版).{0,10}(?:先不|暂不|以后|之后|稍后|再说)|(?:不要|不想|别|拒绝)[^，,。；;\n]{0,12}(?:安装|使用|切换)[^，,。；;\n]{0,8}(?:内测版|预发版)/u;

function hasExplicitPreChoice(value) {
  return value.split(/[,，。;；\n]|但是|不过|但/u).some(clause => {
    const match = explicitPre.exec(clause);
    if (!match) return false;
    // Accept a request from the speaker, not a mention in a report or history.
    return /^(?:(?:请|麻烦|我|我们|本人|想要|想|希望|决定|确认|确定|同意|帮我|给我|好的|好|那|就|直接|现在|马上|可以|没问题|please)|\s)*$/iu.test(clause.slice(0, match.index));
  });
}

export function decideChannelOffer(reply) {
  if (typeof reply !== 'string' || !reply.trim()) return 'UNDECIDED';
  const normalized = reply.normalize('NFKC').trim().replace(/^【([^【】]+)】([。！!]*)$/u, '$1$2').replace(/[。！!]+$/gu, '').trim();
  if (uncertain.test(normalized) || /(?:之前|前)(?:先|需要|要)|(?:安装|使用|切换).*(?:失败了?|出错|报错|未成功)/u.test(normalized)) return 'UNDECIDED';
  if (reportedChoice.test(normalized)) return 'UNDECIDED';
  if (deniedConfirmation.test(normalized)) return 'UNDECIDED';
  const choice = normalized.replace(/[“”"'`]/gu, '');
  const rejectsPre = negativePre.test(choice);
  if (!rejectsPre && unclearIntent.test(choice)) return 'UNDECIDED';
  const wantsPre = hasExplicitPreChoice(rejectsPre ? choice.replace(negativePre, '') : choice)
    || exactConfirm.test(choice) || contextualConfirm.test(choice) || contextualInstall.test(choice);
  const wantsStable = rejectsPre || stableChoice.test(choice);
  // A remaining denial must never become permission through a positive substring.
  const remaining = choice.replace(/没问题/gu, '')
    .replace(/(?:不使用|不要|不用|不选)(?:正式版|稳定版)/gu, '')
    .replace(/(?:不同意|不允许|不要|拒绝|禁止)(?:采集|收集|记录)(?:(?:我的|本次|当前)?(?:会话|对话|聊天)(?:信息|内容|记录|数据)?)?/gu, '');
  if (wantsPre && /不|没|未|别|禁止|拒绝|取消|停止|无需|无须/u.test(remaining)) return 'UNDECIDED';
  if (wantsPre && wantsStable) return 'UNDECIDED';
  if (wantsPre) return 'PRE';
  if (wantsStable || genericStable.test(choice)) return 'STABLE';
  return 'UNDECIDED';
}

function regularFile(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}

// Discovery never creates shims, downloads Node, or edits the parent PATH.
export function packageManagerInvocation(tool, args, {
  node = process.execPath, env = process.env, windows = process.platform === 'win32',
  isFile = regularFile, readdir = dir => fs.readdirSync(dir, {withFileTypes: true}),
} = {}) {
  if (!['npm', 'npx'].includes(tool) || args.some(arg => !/^[A-Za-z0-9@./=+_-]+$/u.test(arg))) throw new Error('invalid package-manager invocation');
  if (!windows) return {command: tool, args, env};
  const moduleName = tool === 'npm' ? 'npm-cli.js' : 'npx-cli.js';
  const pathKey = Object.keys(env).find(key => key.toUpperCase() === 'PATH') || 'PATH';
  const dirs = [...new Set([path.dirname(node), env.APPDATA && path.join(env.APPDATA, 'npm'),
    ...(env[pathKey] || '').split(';')].filter(dir => dir && path.isAbsolute(dir)))];
  const candidates = [
    env.npm_execpath && path.join(path.dirname(env.npm_execpath), moduleName),
    ...dirs.map(dir => path.join(dir, 'node_modules', 'npm', 'bin', moduleName)),
    path.join(path.dirname(node), '..', 'node_modules', 'npm', 'bin', moduleName),
  ];
  const childEnv = {...env, [pathKey]: [path.dirname(node), ...dirs].join(';')};
  const findModule = () => {
    for (const candidate of candidates) {
      if (candidate && path.isAbsolute(candidate) && isFile(candidate)) return {command: node, args: [candidate, ...args], env: childEnv};
    }
    return null;
  };
  const found = findModule();
  if (found) return found;
  // Reuse npm obtained by an earlier npx invocation, limited to known cache roots.
  const cacheRoots = [env.npm_config_cache,
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'npm-cache'),
    env.APPDATA && path.join(env.APPDATA, 'npm-cache')];
  candidates.length = 0;
  for (const root of new Set(cacheRoots.filter(root => root && path.isAbsolute(root)))) {
    try {
      for (const entry of readdir(path.join(root, '_npx')).filter(e => e.isDirectory() && /^[a-f0-9]+$/u.test(e.name)).slice(0, 32)) {
        candidates.push(path.join(root, '_npx', entry.name, 'node_modules', 'npm', 'bin', moduleName));
      }
    } catch { /* Cache is optional. */ }
  }
  const cached = findModule();
  if (cached) return cached;
  for (const dir of dirs) {
    if (isFile(path.join(dir, `${tool}.cmd`))) return {
      command: env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', `${tool}.cmd ${args.join(' ')}`], env: childEnv,
    };
  }
  return null;
}

const single = value => Array.isArray(value) && value.length === 1 ? value[0] : value;
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
export function parsePublishedPre(stdout) {
  let metadata;
  try { metadata = single(JSON.parse(stdout)); } catch { return {status: 'CHECK_FAILED', reason: 'INVALID_METADATA'}; }
  const packageVersion = single(metadata?.version);
  if (typeof packageVersion !== 'string' || !versionPattern.test(packageVersion) ||
      !packageVersion.split('.').map(Number).every(Number.isSafeInteger)) return {status: 'CHECK_FAILED', reason: 'INVALID_METADATA'};
  const value = single(single(metadata?.alipayAipayChannels)?.pre);
  if (value === undefined) return {status: 'UNAVAILABLE', reason: 'PRE_CHANNEL_MISSING'};
  const match = typeof value === 'string' ? /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-pre$/u.exec(value) : null;
  if (!match) return {status: 'CHECK_FAILED', reason: 'INVALID_METADATA'};
  const [major, minor, patch] = match.slice(1).map(Number);
  if (![major, minor, patch].every(Number.isSafeInteger)) return {status: 'CHECK_FAILED', reason: 'INVALID_METADATA'};
  return major > 1 || (major === 1 && (minor > 7 || (minor === 7 && patch >= 4)))
    ? {status: 'AVAILABLE', packageVersion, preVersion: value} : {status: 'UNAVAILABLE', reason: 'PRE_VERSION_TOO_OLD'};
}
export const publishedPreFromMetadata = stdout => parsePublishedPre(stdout).status;

export function registryMetadata() {
  return new Promise((resolve, reject) => {
    const request = https.get('https://registry.npmjs.org/@alipay%2falipay-aipay/latest',
      {headers: {accept: 'application/json'}}, response => {
        if (response.statusCode !== 200) { response.resume(); reject(new Error('REGISTRY_HTTP_ERROR')); return; }
        let data = ''; let bytes = 0;
        response.setEncoding('utf8');
        response.on('data', chunk => {
          bytes += Buffer.byteLength(chunk);
          if (bytes > 256 * 1024) request.destroy(new Error('METADATA_TOO_LARGE'));
          else data += chunk;
        });
        response.on('error', reject);
        response.on('end', () => resolve(data));
      });
    const timer = setTimeout(() => request.destroy(new Error('REGISTRY_TIMEOUT')), 10000);
    request.on('error', reject);
    request.on('close', () => clearTimeout(timer));
  });
}

export async function publishedWindowsPreAvailable({
  run = spawnSync, readRegistry = registryMetadata,
  invocationOptions = {windows: process.platform === 'win32'},
} = {}) {
  const invocation = packageManagerInvocation('npm', ['view', '@alipay/alipay-aipay@latest', 'version', 'alipayAipayChannels', '--json'], invocationOptions);
  if (invocation) {
    let result;
    try { result = run(invocation.command, invocation.args,
      {env: invocation.env, encoding: 'utf8', timeout: 10000, maxBuffer: 64 * 1024, windowsHide: true, shell: false}); } catch { /* Try the official registry once. */ }
    if (result && !result.error && result.status === 0) return parsePublishedPre(result.stdout);
  }
  try { return parsePublishedPre(await readRegistry()); }
  catch { return {status: 'CHECK_FAILED', reason: 'REGISTRY_UNREACHABLE'}; }
}

const installReceiptPrefix = 'ALIPAY_AIPAY_INTERNAL:CHANNEL_INSTALL_RESULT=';
const sessionReceiptPrefix = 'ALIPAY_AIPAY_INTERNAL:CHANNEL_SESSION_RESULT=';
const sourceSkillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export function channelInstallTarget(skillDir = sourceSkillDir, {home = os.homedir()} = {}) {
  const session = readSessionSkill(skillDir, {home, channel:'stable'});
  if (session) skillDir = session.targetDir;
  const parent = path.dirname(skillDir);
  if (path.basename(parent) !== 'skills') return null;
  return ({'.codex': 'codex', '.claude': 'claude', '.agents': 'agents'})[path.basename(path.dirname(parent))] || null;
}

export function verifyChannelInstall(stderr, published, {home = os.homedir(), target = null, betaOrigin = null} = {}) {
  try {
    const sessionLines=stderr.split(/\r?\n/u).filter(line=>line.startsWith(sessionReceiptPrefix));
    const lines = stderr.split(/\r?\n/u).filter(line => line.startsWith(installReceiptPrefix));
    if (sessionLines.length) {
      if (sessionLines.length !== 1 || lines.length) throw new Error('receipt');
      const receipt=JSON.parse(sessionLines[0].slice(sessionReceiptPrefix.length));
      const targets=target?[target]:['codex','claude','agents'];
      if (!targets.some(name=>receipt.targetDir===path.join(fs.realpathSync(home),`.${name}`,'skills','alipay-aipay-pre'))) throw new Error('target');
      verifySessionSkill(receipt,{home,channel:'pre',version:published.preVersion,packageVersion:published.packageVersion,
        targetDir:receipt.targetDir});
      const originFile=path.join(receipt.skillDir,'references/normal/json/npm-origin.json');
      if (betaOrigin) {
        const origin=JSON.parse(fs.readFileSync(originFile,'utf8'));
        if (origin.packageVersion!==published.packageVersion || origin.distTag!=='beta') throw new Error('origin');
      } else if (fs.existsSync(originFile)) throw new Error('unexpected beta');
      return {status:'SESSION_READY',skillDir:receipt.skillDir,preVersion:receipt.version};
    }
    if (lines.length !== 1) throw new Error('receipt');
    const receipt = JSON.parse(lines[0].slice(installReceiptPrefix.length));
    if (receipt.channel !== 'pre' || receipt.version !== published.preVersion ||
        typeof receipt.skillDir !== 'string' || !path.isAbsolute(receipt.skillDir)) throw new Error('receipt');
    const skillDir = fs.realpathSync(receipt.skillDir);
    const homeDir = fs.realpathSync(home);
    const targets = target ? [target] : ['codex', 'claude', 'agents'];
    if (!targets.some(name => {
      try { return skillDir === fs.realpathSync(path.join(homeDir, `.${name}`, 'skills', 'alipay-aipay-pre')); }
      catch { return false; }
    })) throw new Error('target');
    for (const file of ['SKILL.md', 'VERSION', 'references/runtime-entry.md', 'references/normal/json/release-channel.json',
      'references/normal/scripts/runtime.mjs', 'references/normal/scripts/preview_runtime.mjs']) {
      const stat = fs.lstatSync(path.join(skillDir, file));
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('incomplete');
    }
    if (fs.readFileSync(path.join(skillDir, 'VERSION'), 'utf8').trim() !== published.preVersion ||
        JSON.parse(fs.readFileSync(path.join(skillDir, 'references/normal/json/release-channel.json'), 'utf8')).channel !== 'pre') throw new Error('version');
    const originFile = path.join(skillDir, 'references/normal/json/npm-origin.json');
    if (betaOrigin) {
      const origin = JSON.parse(fs.readFileSync(originFile, 'utf8'));
      if (origin.packageVersion !== published.packageVersion || origin.distTag !== 'beta') throw new Error('origin');
    } else if (fs.existsSync(originFile)) throw new Error('unexpected beta');
    return {status: 'INSTALLED', skillDir, preVersion: published.preVersion};
  } catch { return {status: 'VERIFY_FAILED', reason: 'INSTALLED_SKILL_MISMATCH'}; }
}

export function classifyInstallFailure(output) {
  if (/\b(?:EPERM|EACCES|EBUSY)\b/u.test(output)) return 'INSTALL_PATH_BLOCKED';
  if (/\b(?:ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH)\b/u.test(output)) return 'INSTALL_NETWORK_FAILED';
  return 'INSTALL_PROCESS_FAILED';
}

// Bound both the process tree and the wait for inherited stdio handles to close.
export function runPreInstaller(invocation, {
  spawnProcess = spawn, killTree = null, timeoutMs = 120000, closeGraceMs = 2000,
} = {}) {
  return new Promise(resolve => {
    let child;
    try {
      child = spawnProcess(invocation.command, invocation.args, {env: invocation.env,
        windowsHide: true, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe']});
    } catch { resolve({status:'INSTALL_FAILED', reason:'INSTALL_PROCESS_FAILED'}); return; }
    let stdout = '', stderr = '', timedOut = false, finished = false, graceTimer;
    const finish = outcome => {
      if (finished) return;
      finished = true;
      clearTimeout(timer); clearTimeout(graceTimer);
      resolve(outcome);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (killTree) killTree(child);
        else if (process.platform === 'win32' && child.pid) spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {stdio:'ignore', timeout:2000, windowsHide:true});
        else if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
        child.kill('SIGKILL');
      } catch { /* Still return a bounded failure if termination is denied. */ }
      if (finished) return;
      graceTimer = setTimeout(() => {
        child.stdout?.destroy(); child.stderr?.destroy(); child.unref?.();
        finish({status:'INSTALL_FAILED', reason:'INSTALL_TIMEOUT'});
      }, closeGraceMs);
    }, timeoutMs);
    child.stdout?.on('data', chunk => { stdout = (stdout + chunk).slice(-1024 * 1024); });
    child.stderr?.on('data', chunk => { stderr = (stderr + chunk).slice(-1024 * 1024); });
    child.on('error', () => finish({status:'INSTALL_FAILED', reason:'INSTALL_PROCESS_FAILED'}));
    child.on('close', code => finish(!timedOut && code === 0 ? {status:'INSTALLED', stderr}
      : {status:'INSTALL_FAILED', reason: timedOut ? 'INSTALL_TIMEOUT' : classifyInstallFailure(stdout + '\n' + stderr)}));
  });
}

export async function installWindowsPre(reply, {
  query = publishedWindowsPreAvailable, install = runPreInstaller,
  verify = verifyChannelInstall, target = channelInstallTarget(),
  invocationOptions = {windows: process.platform === 'win32'},
} = {}) {
  if (decideChannelOffer(reply) !== 'PRE') return {status: 'UNDECIDED', reason:'EXPLICIT_PRE_REQUIRED'};
  const published = await query();
  if (published.status !== 'AVAILABLE') return published;
  const spec = `@alipay/alipay-aipay@${published.packageVersion}`;
  const targetArgs = target ? ['--target', target] : [];
  const invocation = packageManagerInvocation('npx', ['-y', spec, 'install', '--channel', 'pre', ...targetArgs], invocationOptions)
    || packageManagerInvocation('npm', ['exec', '--yes', '--package', spec, '--', 'alipay-aipay', 'install', '--channel', 'pre', ...targetArgs], invocationOptions);
  if (!invocation) return {status: 'INSTALL_FAILED', reason:'NPM_TOOLCHAIN_MISSING'};
  invocation.env = {...invocation.env, ALIPAY_AIPAY_CHANNEL_OFFER_INSTALL: '1'};
  const installed = await install(invocation);
  if (installed.status !== 'INSTALLED') return installed;
  return verify(installed.stderr || '', published, {target});
}

function report(outcome) {
  if (outcome.reason) process.stderr.write(`ALIPAY_AIPAY_INTERNAL:CHANNEL_OFFER_REASON=${outcome.reason}\n`);
  if (outcome.preVersion) process.stderr.write(`ALIPAY_AIPAY_INTERNAL:CHANNEL_OFFER_PRE_VERSION=${outcome.preVersion}\n`);
  if (['INSTALLED','SESSION_READY'].includes(outcome.status) && outcome.skillDir) process.stderr.write(`ALIPAY_AIPAY_INTERNAL:CHANNEL_OFFER_SKILL_DIR=${JSON.stringify(outcome.skillDir)}\n`);
  process.stderr.write(`${marker}${outcome.status}\n`);
}

export async function runChannelOfferCli(argv = process.argv) {
  const action = argv[2];
  if (action === 'show' && argv.length === 3) {
    if (!isWindowsPlatform()) {
      process.stderr.write(`${marker}SKIPPED\n`);
      return;
    }
    process.stdout.write(`${renderMessage('startup.windows.pre_offer', 'DEFAULT', {})}\n`);
    process.stderr.write(`${marker}WAITING\n`);
    return;
  }
  if (action === 'decide' && argv.length === 5 && argv[3] === '--reply' && isWindowsPlatform()) {
    process.stderr.write(`${marker}${decideChannelOffer(argv[4])}\n`);
    return;
  }
  if (action === 'available' && argv.length === 3 && isWindowsPlatform()) {
    report(await publishedWindowsPreAvailable());
    return;
  }
  if (action === 'install' && argv.length === 5 && argv[3] === '--reply' && isWindowsPlatform()) {
    const outcome = await installWindowsPre(argv[4]);
    report(outcome);
    if (!['INSTALLED','SESSION_READY'].includes(outcome.status)) process.exitCode = 1;
    return;
  }
  throw new Error('用法: runtime.mjs channel-offer show | decide --reply <用户原始回复> | available | install --reply <用户原始回复>');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await runChannelOfferCli();
  } catch (error) {
    process.stderr.write(`ALIPAY_AIPAY_INTERNAL:CHANNEL_OFFER_ERROR=${String(error?.message || error).replace(/[\r\n]/gu, ' ')}\n`);
    process.exitCode = 1;
  }
}
