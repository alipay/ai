#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultSkillDir = path.resolve(scriptDir, '../../..');
const npmQueryTimeoutMs = 5 * 1000;
const installTimeoutMs = 60 * 1000;
const outputLimitBytes = 64 * 1024;
const selfUpdateTargetEnv = 'ALIPAY_AIPAY_SELF_UPDATE_TARGET';
const selfUpdateTransactionEnv = 'ALIPAY_AIPAY_SELF_UPDATE_TRANSACTION';

function installTimeoutBudget() {
  if (process.env.ALIPAY_AIPAY_TEST_MODE !== '1') return installTimeoutMs;
  const value = Number(process.env.ALIPAY_AIPAY_SELF_UPDATE_TEST_INSTALL_TIMEOUT_MS);
  return Number.isInteger(value) && value >= 50 && value <= installTimeoutMs ? value : installTimeoutMs;
}

function appendBounded(current, chunk) {
  const combined = current + chunk.toString('utf8');
  return combined.length > outputLimitBytes ? combined.slice(-outputLimitBytes) : combined;
}

async function terminateProcessTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      timeout: 2 * 1000,
      windowsHide: true,
    });
    try { child.kill('SIGKILL'); } catch {}
    return;
  }

  try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  await delay(250);
  try { process.kill(-child.pid, 'SIGKILL'); } catch {}
}

function packageManagerCommand(command, args) {
  if (process.platform !== 'win32') return { command, args, detached: true };

  const allowedCommands = new Set(['npm', 'npx']);
  const safeToken = /^[A-Za-z0-9@./=+_-]+$/u;
  if (!allowedCommands.has(command) || args.some((arg) => !safeToken.test(arg))) {
    throw new Error('unsafe Windows package-manager command');
  }
  // A user-directory Node need not be present on the host PATH.
  // Use its bundled toolchain and retain the existing cmd fallback otherwise.
  const moduleName = command === 'npm' ? 'npm-cli.js' : 'npx-cli.js';
  const bundled = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', moduleName);
  if (isRegularFile(bundled)) return {command:process.execPath,args:[bundled,...args],detached:false};
  return {
    command: process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', [`${command}.cmd`, ...args].join(' ')],
    detached: false,
  };
}

export function packageManagerEnvironment(env, {windows=process.platform==='win32',node=process.execPath} = {}) {
  if (!windows) return env;
  const child={...env};
  const oldPath=Object.entries(child).find(([key])=>key.toLowerCase()==='path')?.[1] || '';
  for (const key of Object.keys(child)) if (key.toLowerCase()==='path') delete child[key];
  child.PATH=[path.dirname(node),oldPath].join(';');
  return child;
}

function spawnPackageManager(command, args, { timeout, env = process.env }) {
  return new Promise((resolve) => {
    let invocation;
    try {
      invocation = packageManagerCommand(command, args);
    } catch (error) {
      resolve({ status: null, signal: null, stdout: '', stderr: '', error });
      return;
    }

    let child;
    try {
      child = spawn(invocation.command, invocation.args, {
        detached: invocation.detached,
        env: packageManagerEnvironment(env),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      resolve({ status: null, signal: null, stdout: '', stderr: '', error });
      return;
    }

    let stdout = '';
    let stderr = '';
    let finished = false;
    let timedOut = false;
    let closed = false;
    let timer;
    let closeResolve;
    const closedPromise = new Promise((done) => { closeResolve = done; });

    child.stdout?.on('data', (chunk) => { stdout = appendBounded(stdout, chunk); });
    child.stderr?.on('data', (chunk) => { stderr = appendBounded(stderr, chunk); });

    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ ...result, stdout, stderr });
    };

    child.once('error', (error) => {
      if (!timedOut) finish({ status: null, signal: null, error });
    });
    child.once('close', (status, signal) => {
      closed = true;
      closeResolve();
      if (!timedOut) finish({ status, signal, error: null });
    });

    timer = setTimeout(() => {
      timedOut = true;
      void (async () => {
        await terminateProcessTree(child);
        if (!closed) await Promise.race([closedPromise, delay(2 * 1000)]);
        const error = new Error(`package manager timed out after ${timeout}ms`);
        error.code = 'ETIMEDOUT';
        finish({ status: null, signal: 'SIGKILL', error });
      })();
    }, timeout);
  });
}

function isRegularFile(file) {
  try {
    const stat = fs.lstatSync(file);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function isRecoverableSkillRoot(skillDir) {
  try {
    const root = fs.lstatSync(skillDir);
    return root.isDirectory()
      && !root.isSymbolicLink()
      && isRegularFile(path.join(skillDir, 'SKILL.md'))
      && isRegularFile(path.join(skillDir, 'references', 'normal', 'scripts', 'self_update.mjs'));
  } catch {
    return false;
  }
}

function parseArgs(argv) {
  if (argv[2] !== 'check') throw new Error('用法: self_update.mjs check [--skill-dir <absolutePath>]');
  let skillDir = defaultSkillDir;
  for (let index = 3; index < argv.length; index += 1) {
    if (argv[index] === '--skill-dir' && argv[index + 1]) {
      skillDir = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`未知参数 ${argv[index]}`);
  }
  if (!path.isAbsolute(skillDir)) throw new Error('--skill-dir 必须是绝对路径');
  const resolved = fs.realpathSync(skillDir);
  const currentRoot = fs.realpathSync(defaultSkillDir);
  if (resolved !== currentRoot || !isRecoverableSkillRoot(resolved)) {
    throw new Error('--skill-dir 必须绑定当前运行中的 Skill 根目录');
  }
  return resolved;
}

function parseVersion(value) {
  const raw = value.trim().replace(/^v/u, '');
  const match = raw.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u);
  if (!match || raw.length > 256) return null;
  const prerelease = match[4]?.split('.') || [];
  const build = raw.includes('+') ? raw.split('+')[1].split('.') : [];
  if (![match[1], match[2], match[3]].every((value) => Number.isSafeInteger(Number(value)))) return null;
  if (prerelease.some((value) => !value || (/^\d+$/u.test(value) && value.length > 1 && value[0] === '0'))) return null;
  if (build.some((value) => !value)) return null;
  return { raw, major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease };
}

function compareIdentifiers(left, right) {
  const leftNumeric = /^\d+$/u.test(left);
  const rightNumeric = /^\d+$/u.test(right);
  if (leftNumeric && rightNumeric) return Number(left) - Number(right);
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return left.localeCompare(right);
}

function compareVersions(left, right) {
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] - right[key];
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return left.prerelease.length === right.prerelease.length ? 0 : left.prerelease.length === 0 ? 1 : -1;
  }
  for (let index = 0; index < Math.max(left.prerelease.length, right.prerelease.length); index += 1) {
    if (left.prerelease[index] === undefined) return -1;
    if (right.prerelease[index] === undefined) return 1;
    const compared = compareIdentifiers(left.prerelease[index], right.prerelease[index]);
    if (compared !== 0) return compared;
  }
  return 0;
}

export function skillVersionKind(value, channel) {
  if (typeof value !== 'string') return null;
  const parsed = parseVersion(value);
  if (!parsed) return null;
  const suffix = parsed.prerelease.join('.');
  if (suffix === (channel === 'pre' ? 'pre' : '')) return 'release';
  const pattern = channel === 'pre' ? /^pre-beta(?:\d+|\.\d+)?$/u : /^beta(?:\d+|\.\d+)?$/u;
  return pattern.test(suffix) ? 'beta' : null;
}

function readVersionFile(skillDir) {
  try {
    const file = path.join(skillDir, 'VERSION');
    return isRegularFile(file) ? parseVersion(fs.readFileSync(file, 'utf8')) : null;
  } catch {
    return null;
  }
}

function readLocalVersion(skillDir) {
  try {
    const versionFile = path.join(skillDir, 'VERSION');
    const skillFile = path.join(skillDir, 'SKILL.md');
    const runtimeEntry = path.join(skillDir, 'references', 'runtime-entry.md');
    if (![versionFile, skillFile, runtimeEntry].every(isRegularFile)) return null;
    return parseVersion(fs.readFileSync(versionFile, 'utf8'));
  } catch {
    return null;
  }
}

function selfUpdateNetworkRestricted() {
  return /^(1|true|yes|on)$/iu.test(process.env.ALIPAY_AIPAY_SELF_UPDATE_NETWORK_RESTRICTED || '');
}

function packageManagerFailureKind(result) {
  if (result?.error?.code === 'ENOENT') return 'local';
  const raw = [
    result?.error?.code,
    result?.error?.message,
    result?.stderr,
    result?.stdout,
  ].filter(Boolean).join('\n');
  if (/ETIMEDOUT|ESOCKETTIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONN(?:RESET|REFUSED|ABORTED)|EHOSTUNREACH|ENETUNREACH|network access[^]*(?:denied|blocked)|getaddrinfo|could not resolve|fetch failed|socket hang up|TLS handshake|503 Service Unavailable|502 Bad Gateway|504 Gateway Timeout/iu.test(raw)) {
    return 'network';
  }
  return 'check';
}

function readChannel(skillDir) {
  const source = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  const declaredName = source.match(/^name:\s*(\S+)\s*$/m)?.[1];
  const identity = declaredName === 'alipay-aipay-pre' ? 'pre' : 'stable';
  const channelFile = path.join(skillDir, 'references', 'normal', 'json', 'release-channel.json');
  if (!fs.existsSync(channelFile) && identity === 'stable') return 'stable';
  if (!isRegularFile(channelFile)) throw new Error('invalid release channel');
  const channel = JSON.parse(fs.readFileSync(channelFile, 'utf8')).channel;
  if (!['stable', 'pre'].includes(channel) || channel !== identity) throw new Error('invalid release channel');
  return channel;
}

async function npmLatest(channel) {
  if (selfUpdateNetworkRestricted()) return { ok: false, reason: 'skipped-network-restricted' };
  try {
    const result = await spawnPackageManager('npm', ['view', '@alipay/alipay-aipay@latest', 'version', 'alipayAipayChannels', '--json'], {
      timeout: npmQueryTimeoutMs,
    });
    if (result.status !== 0 || result.error) return { ok: false, reason: packageManagerFailureKind(result) };
    const decoded = JSON.parse(result.stdout);
    const packageVersion = typeof decoded?.version === 'string' ? parseVersion(decoded.version) : null;
    const value = decoded?.alipayAipayChannels?.[channel];
    const version = typeof value === 'string' ? parseVersion(value) : null;
    return packageVersion && version && skillVersionKind(version.raw, channel) === 'release' ? { ok: true, version, packageVersion } : { ok: false, reason: 'check' };
  } catch {
    return { ok: false, reason: 'check' };
  }
}

function transactionArtifacts(skillDir, transactionId, channel) {
  const parent = path.dirname(skillDir);
  const skillName = channel === 'pre' ? 'alipay-aipay-pre' : 'alipay-aipay';
  return {
    staging: path.join(parent, `.${skillName}-install-${transactionId}`),
    backup: path.join(parent, `.${skillName}-backup-${transactionId}`),
  };
}

function removeTransactionPath(target) {
  try { fs.rmSync(target, { recursive: true, force: true }); } catch {}
}

function reconcileInstallTransaction(skillDir, transactionId, channel) {
  const artifacts = transactionArtifacts(skillDir, transactionId, channel);
  if (isRecoverableSkillRoot(artifacts.backup)) {
    try {
      removeTransactionPath(skillDir);
      fs.renameSync(artifacts.backup, skillDir);
    } catch {}
  }
  removeTransactionPath(artifacts.staging);
  return { version: readLocalVersion(skillDir), backupPresent: fs.existsSync(artifacts.backup) };
}

async function installVersion(skillDir, packageVersion, channel) {
  const transactionId = randomUUID();
  const timeout = installTimeoutBudget();
  let result;
  try {
    result = await spawnPackageManager(
      'npx',
      ['-y', `@alipay/alipay-aipay@${packageVersion.raw}`, 'install-current', '--channel', channel],
      {
        timeout,
        env: {
          ...process.env,
          [selfUpdateTargetEnv]: skillDir,
          [selfUpdateTransactionEnv]: transactionId,
        },
      },
    );
  } catch {
    result = { status: null, error: new Error('package manager check failed'), stdout: '', stderr: '' };
  }
  let session=null;
  if (process.platform==='win32' && result.status===0 && !result.error) {
    const lines=result.stderr.split(/\r?\n/u).filter(line=>line.startsWith('ALIPAY_AIPAY_INTERNAL:SELF_UPDATE_SESSION_RESULT='));
    if (lines.length===1) {
      try {
        const receipt=JSON.parse(lines[0].slice('ALIPAY_AIPAY_INTERNAL:SELF_UPDATE_SESSION_RESULT='.length));
        const {verifySessionSkill}=await import('./session_skill.mjs');
        session=verifySessionSkill(receipt,{channel,packageVersion:packageVersion.raw,targetDir:skillDir});
      } catch { /* An invalid receipt never permits a session switch. */ }
    }
  }
  const reconciled = reconcileInstallTransaction(skillDir, transactionId, channel);
  return {
    ok: result.status === 0 && !result.error,
    reason: result.status === 0 && !result.error ? 'ok' : packageManagerFailureKind(result),
    ...reconciled,
    session,
  };
}

function reportOutcome(outcome) {
  const version = outcome.version ? `=${outcome.version.raw}` : '';
  if (outcome.kind==='SESSION_READY') process.stderr.write(`ALIPAY_AIPAY_INTERNAL:SELF_UPDATE_SESSION_SKILL_DIR=${JSON.stringify(outcome.skillDir)}\n`);
  process.stderr.write(`SELF_UPDATE:${outcome.kind}${version}\n`);
}

export async function runSelfUpdateCli(argv = process.argv) {
  const skillDir = parseArgs(argv);
  const channel = readChannel(skillDir);
  if (fs.existsSync(path.join(skillDir,'.session-skill.json'))) {
    const {readSessionSkill}=await import('./session_skill.mjs');
    readSessionSkill(skillDir,{channel});
    return {kind:'CURRENT',version:readLocalVersion(skillDir)};
  }
  const local = readLocalVersion(skillDir);
  const installedVersion = readVersionFile(skillDir);
  const kind = skillVersionKind(installedVersion?.raw, channel);
  // A developer-installed beta is pinned, including when its entry is damaged.
  if (kind === 'beta') return local ? { kind: 'CURRENT', version: local } : { kind: 'VERIFY_FAILED' };
  if (installedVersion && !kind) return { kind: 'CHECK_FAILED' };
  const checked = await npmLatest(channel);
  if (!checked.ok) {
    const current = readLocalVersion(skillDir);
    if (current && (!local || compareVersions(current, local) > 0)) return { kind: 'UPDATED', version: current };
    if (checked.reason === 'skipped-network-restricted') return { kind: 'SKIPPED_NETWORK_RESTRICTED' };
    if (checked.reason === 'network') return { kind: 'RETRY_WITH_NETWORK' };
    return { kind: 'CHECK_FAILED' };
  }

  const latest = checked.version;
  if (local && compareVersions(local, latest) >= 0) return { kind: 'CURRENT', version: local };

  const installed = await installVersion(skillDir, checked.packageVersion, channel);
  if (installed.session && installed.session.version===latest.raw) {
    return {kind:'SESSION_READY',version:latest,skillDir:installed.session.skillDir};
  }
  if (installed.backupPresent) return { kind: 'INSTALL_FAILED' };
  const updated = installed.version || readLocalVersion(skillDir);
  if (installed.ok && updated && readChannel(skillDir) === channel && compareVersions(updated, latest) >= 0) return { kind: 'UPDATED', version: updated };
  if (installed.reason === 'network') return { kind: 'RETRY_WITH_NETWORK' };
  if (installed.reason === 'local') return { kind: 'CHECK_FAILED' };
  return { kind: installed.ok ? 'VERIFY_FAILED' : 'INSTALL_FAILED' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    reportOutcome(await runSelfUpdateCli());
  } catch {
    reportOutcome({ kind: 'CHECK_FAILED' });
  }
}
