// Task-scoped preparation of the external Alipay CLI. Local reference and
// project commands only reuse a saved path; they never invoke the installer.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { currentRunContext, telemetryStoragePaths } from './telemetry.mjs';
import { readSkillVersion, validVersion } from './profile.mjs';
import { isMainModule } from './is_main_module.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultSkillDir = path.resolve(scriptDir, '../../..');
const kinds = new Set(['RUNNING', 'READY', 'RETRY_WITH_NETWORK', 'RETRY_WITH_LOCAL_FS_PERMISSION', 'FAILED', 'VERIFY_FAILED']);

function recordKey(value) {
  return createHash('sha256').update(JSON.stringify({ runId: value.runId, skillDir: value.skillDir,
    skillVersion: value.skillVersion })).digest('hex');
}

function isPreparationRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 6
    && Object.keys(value).every(key => ['runId', 'skillDir', 'skillVersion', 'cliPath', 'kind', 'attempts'].includes(key))
    && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(value.runId)
    && validVersion(value.skillVersion)
    && [value.skillDir, value.cliPath].every(item => typeof item === 'string' && path.isAbsolute(item) && path.resolve(item) === item)
    && ['alipay-cli', 'alipay-cli.exe'].includes(path.basename(value.cliPath))
    && kinds.has(value.kind) && [1, 2].includes(value.attempts);
}

// Only this exact private record format may be excluded from a project snapshot.
// Unknown files, nested directories and symlinks must still expose a misplaced
// state directory instead of silently hiding merchant code or configuration.
export function isCliPreparationDirectory(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true }).every(entry => {
      const match = /^([a-f0-9]{64})\.json(?:\.retry|\.[a-f0-9-]{36}\.tmp)?$/u.exec(entry.name);
      if (!entry.isFile() || !match) return false;
      const file = path.join(directory, entry.name);
      if (fs.lstatSync(file).size > 4096) return false;
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      return isPreparationRecord(value) && recordKey(value) === match[1]
        && (!entry.name.endsWith('.retry') || value.kind === 'RUNNING' && value.attempts === 2);
    });
  } catch { return false; }
}

function context(env, skillDir, platform) {
  const run = currentRunContext(env);
  if (!run || run.terminal) throw Error('CLI 准备缺少当前活动任务');
  const canonical = fs.realpathSync(skillDir);
  const binding = { runId: run.run_id, skillDir: canonical, skillVersion: readSkillVersion(canonical) };
  const key = recordKey(binding);
  const file = path.join(telemetryStoragePaths(env).run_state_file + '.cli-preparation', key + '.json');
  const home = platform === 'win32' ? os.homedir() : env.HOME || os.homedir();
  const cliPath = path.join(home, '.local/bin', platform === 'win32' ? 'alipay-cli.exe' : 'alipay-cli');
  return { binding, file, cliPath };
}

function readState(ctx) {
  try {
    const stat = fs.lstatSync(ctx.file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw Error('invalid CLI preparation state');
    const value = JSON.parse(fs.readFileSync(ctx.file, 'utf8'));
    if (!isPreparationRecord(value) || Object.entries(ctx.binding).some(([key, expected]) => value[key] !== expected)
        || value.cliPath !== ctx.cliPath) throw Error('invalid CLI preparation state');
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function saveState(file, value) {
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
    fs.renameSync(temp, file);
  } finally { fs.rmSync(temp, { force: true }); }
}

// Reading this path has no installation or process-execution side effects.
export function preparedCliPath({ env = process.env, skillDir = defaultSkillDir, platform = process.platform } = {}) {
  if (platform === 'win32' && env.ALIPAY_AIPAY_WINDOWS_ROUTE !== 'READY') return '';
  try {
    const ctx = context(env, skillDir, platform);
    const state = readState(ctx);
    return state?.kind === 'READY' && fs.statSync(ctx.cliPath).isFile() ? ctx.cliPath : '';
  } catch { return ''; }
}

export function usePreparedCli(cliPath, env = process.env) {
  if (!cliPath) return;
  const directory = path.dirname(cliPath);
  env.PATH = [directory, ...(env.PATH || '').split(path.delimiter).filter(item => item !== directory)].join(path.delimiter);
}

function versionProbeEnvironment(env, platform) {
  const childEnv = { ...env };
  for (const key of Object.keys(childEnv)) {
    const name = platform === 'win32' ? key.toUpperCase() : key;
    if (['PLATFORM', 'PLATFORM_ID', 'PRODUCT', 'ALIPAYCLI_BIZ_INFO'].includes(name)) delete childEnv[key];
  }
  return childEnv;
}

export function prepareTaskCli({ retry = false, env = process.env, skillDir = defaultSkillDir,
  platform = process.platform, run = spawnSync } = {}) {
  if (platform === 'win32' && env.ALIPAY_AIPAY_WINDOWS_ROUTE !== 'READY') return { kind: 'SKIPPED', cliPath: '' };
  let ctx, state;
  try {
    ctx = context(env, skillDir, platform);
    fs.mkdirSync(path.dirname(ctx.file), { recursive: true, mode: 0o700 });
    state = readState(ctx);
    if (state?.kind === 'READY') {
      const verified = run(ctx.cliPath, ['version'], { env: versionProbeEnvironment(env, platform), stdio: 'ignore', shell: false, timeout: 5000 });
      if (!verified.error && verified.status === 0) return { kind: 'READY', cliPath: ctx.cliPath };
      state = { ...state, kind: 'VERIFY_FAILED' };
      saveState(ctx.file, state);
    }
    if (state && (!retry || state.attempts >= 2 || state.kind === 'RUNNING')) {
      return { kind: state.kind, cliPath: '' };
    }
    const next = { ...ctx.binding, cliPath: ctx.cliPath, kind: 'RUNNING', attempts: (state?.attempts || 0) + 1 };
    // Claim each attempt before installation, including when two preparation
    // entries arrive together. An interrupted attempt is never auto-replayed.
    const claim = state ? ctx.file + '.retry' : ctx.file;
    try { fs.writeFileSync(claim, JSON.stringify(next), { mode: 0o600, flag: 'wx' }); }
    catch (error) {
      if (error.code === 'EEXIST') return { kind: 'RUNNING', cliPath: '' };
      throw error;
    }
    if (state) saveState(ctx.file, next);
    const result = run(process.execPath, [path.join(scriptDir, 'alipay_cli_refresh.mjs'), 'refresh-alipay-cli'], {
      env, encoding: 'utf8', shell: false, timeout: platform === 'win32' ? 0 : 135000, maxBuffer: 1024 * 1024
    });
    const markers = String(result.stderr || '').match(/^ALIPAY_AIPAY_INTERNAL:ALIPAY_CLI_REFRESH=(\w+)$/gm) || [];
    let kind = !result.error && result.status === 0 && markers.length === 1
      ? markers[0].split('=').at(-1) : 'FAILED';
    if (!kinds.has(kind) || kind === 'RUNNING') kind = 'FAILED';
    if (kind === 'READY') {
      const verified = run(ctx.cliPath, ['version'], { env: versionProbeEnvironment(env, platform), stdio: 'ignore', shell: false, timeout: 5000 });
      if (verified.error || verified.status !== 0) kind = 'VERIFY_FAILED';
    }
    saveState(ctx.file, { ...next, kind });
    return { kind, cliPath: kind === 'READY' ? ctx.cliPath : '' };
  } catch {
    // No reliable attempt record means no further automatic installation.
    return { kind: 'STATE_UNAVAILABLE', cliPath: '' };
  }
}

export function reportCliPreparation(result, stream = process.stderr) {
  stream.write(`ALIPAY_AIPAY_INTERNAL:ALIPAY_CLI_PREPARATION=${result.kind}\n`);
}

if (isMainModule(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== 'prepare') process.exitCode = 1;
  else {
    const result = prepareTaskCli();
    reportCliPreparation(result);
    if (result.cliPath) process.stdout.write(result.cliPath);
  }
}
