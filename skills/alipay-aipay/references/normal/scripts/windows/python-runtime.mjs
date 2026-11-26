import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {run, fail, checkWritable} from './host.mjs';
import {findWinget} from './winget.mjs';

const script = fileURLToPath(new URL('../../../integration/machine-pay/sandbox/local_402_sandbox_pay.py', import.meta.url));
const probe = 'import json, os, runpy, sys; assert sys.version_info.major == 3 and sys.platform == "win32"; sys.path.insert(0, os.path.dirname(sys.argv[1])); runpy.run_path(sys.argv[1], run_name="__alipay_probe__"); print(json.dumps({"executable":sys.executable,"version":list(sys.version_info[:3])}))';

export function findWindowsPython({env = process.env, execute = run, exists = fs.existsSync, list = fs.readdirSync} = {}) {
  const probeEnv = Object.fromEntries(Object.entries(env).filter(([key]) =>
    !['PYTHON_MANAGER_AUTOMATIC_INSTALL', 'PYLAUNCHER_ALLOW_INSTALL', 'PYLAUNCHER_ALWAYS_INSTALL'].includes(key.toUpperCase())));
  probeEnv.PYTHON_MANAGER_AUTOMATIC_INSTALL = '0';
  const candidates = [{command: 'py', prefix: ['-3']}, {command: 'python', prefix: []}, {command: 'python3', prefix: []}];
  const roots = [env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Programs/Python'), env.ProgramFiles && path.win32.join(env.ProgramFiles, 'Python')].filter(Boolean);
  for (const root of roots) {
    let names = [];
    try { names = list(root).filter(name => /^Python3\d+$/i.test(name)).sort().reverse(); } catch {}
    for (const name of names) candidates.push({command: path.win32.join(root, name, 'python.exe'), prefix: []});
  }
  for (const candidate of candidates) {
    const result = execute(candidate.command, [...candidate.prefix, '-c', probe, script], {env: probeEnv, timeout: 10000});
    if (result.status !== 0) continue;
    try {
      const value = JSON.parse(result.stdout);
      if (value.version?.[0] === 3 && path.win32.isAbsolute(value.executable) && exists(value.executable)) {
        return {command: value.executable, prefix: []};
      }
    } catch {}
  }
  return null;
}

export function prepareWindowsPython({authorized = false, find = findWindowsPython,
  execute = run, env = process.env, root, checkRoot = checkWritable} = {}) {
  const existing = find({env});
  if (existing) return existing;
  if (!authorized) fail('DEPENDENCY_MISSING', 'Python 3');
  checkRoot(root);
  const winget = findWinget({env,execute});
  if (!winget) fail('MANUAL_PYTHON_INSTALL_REQUIRED', 'Python 3');
  const result = execute(winget, ['install', '--id', 'Python.Python.3.14', '--exact', '--source', 'winget',
    '--scope', 'user', '--architecture', 'x64', '--silent', '--disable-interactivity',
    '--accept-package-agreements', '--accept-source-agreements'], {env, timeout: 0});
  if (result.status !== 0) fail('PYTHON_INSTALL_FAILED', 'Python 3');
  const python = find({env});
  if (!python) fail('PYTHON_VERIFY_FAILED', 'Python 3');
  return python;
}

export async function runPythonEnvironment(args) {
  const [mode, ...rest] = args;
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!['--authorized', '--repair-confirmed'].includes(rest[i]) ||
        !['true', 'false'].includes(rest[i + 1]) || options[rest[i]] !== undefined) fail('ENVIRONMENT_ARGUMENT_INVALID');
    options[rest[i]] = rest[i + 1];
  }
  if (!['check-python', 'prepare-python'].includes(mode) || (mode === 'check-python' && rest.length)) fail('ENVIRONMENT_ARGUMENT_INVALID');
  const {stateRoot, report} = await import('./preflight.mjs');
  try {
    // Delay all filesystem state until installation is actually necessary.
    const found = findWindowsPython();
    if (!found) {
      if (mode === 'check-python' || options['--authorized'] !== 'true') fail('DEPENDENCY_MISSING', 'Python 3');
      prepareWindowsPython({authorized: true,
        root: stateRoot(), checkRoot: checkWritable});
    }
    process.stderr.write('ALIPAY_AIPAY_INTERNAL:PYTHON_ENV=READY\n');
    return 0;
  } catch (error) { report(error); return 78; }
}
