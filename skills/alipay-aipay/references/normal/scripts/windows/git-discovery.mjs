import fs from 'node:fs';
import path from 'node:path';
import {run, fail} from './host.mjs';
function managedGitVersion() {
  try { return JSON.parse(fs.readFileSync(new URL('./policy.json',import.meta.url),'utf8')).git.version; }
  catch { return ''; }
}

export function gitCandidates(env = process.env) {
  if (env.ALIPAY_GIT_BASH) return [env.ALIPAY_GIT_BASH];
  const managedVersion = env.LOCALAPPDATA ? managedGitVersion() : '';
  const candidates = [
    path.win32.join(env.ProgramFiles || 'C:/Program Files', 'Git/bin/bash.exe'),
    ...(env.LOCALAPPDATA ? [path.win32.join(env.LOCALAPPDATA, 'Programs/Git/bin/bash.exe'),
      ...(managedVersion ? [path.win32.join(env.LOCALAPPDATA, `Programs/Git-Aipay-${managedVersion}/bin/bash.exe`)] : [])] : [])
  ];
  const search = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] || '';
  for (const directory of search.split(';').filter(p => path.win32.isAbsolute(p))) {
    candidates.push(path.win32.join(directory, 'bash.exe'));
    if (['cmd', 'bin'].includes(path.win32.basename(directory).toLowerCase())) {
      candidates.push(path.win32.join(directory, '../bin/bash.exe'));
    }
  }
  return [...new Set(candidates.map(p => path.win32.normalize(p)))];
}

export function findGitBash({env = process.env, exists = fs.existsSync, execute = run} = {}) {
  const cleanEnv = {...env};
  delete cleanEnv.BASH_ENV; delete cleanEnv.ENV; delete cleanEnv.SHELLOPTS;
  for (const candidate of gitCandidates(env)) {
    if (!path.win32.isAbsolute(candidate) || !exists(candidate)) continue;
    // Require a Git for Windows layout before running bash. System32/WSL bash
    // and unrelated MSYS installations are not candidates for this adapter.
    const directory = path.win32.dirname(candidate);
    const git = path.win32.basename(path.win32.dirname(directory)).toLowerCase() === 'usr'
      ? path.win32.resolve(directory, '../..') : path.win32.resolve(directory, '..');
    const bash = path.win32.join(git, 'bin/bash.exe');
    const gitExe = path.win32.join(git, 'cmd/git.exe');
    if (![bash, gitExe, path.win32.join(git, 'usr/bin/cygpath.exe')].every(exists)) continue;
    const version = execute(gitExe, ['--version'], {env: cleanEnv, timeout: 5000});
    if (version.status !== 0 || !/^git version \d[^\r\n]*\.windows\.\d+/m.test(version.stdout || '')) continue;
    const probe = execute(bash, ['--noprofile', '--norc', '-c',
      'case "$(uname -s)" in MINGW*|MSYS*) exit 0;; *) exit 1;; esac'], {env: cleanEnv, timeout: 5000});
    const converted=probe.status===0 ? execute(path.win32.join(git,'usr/bin/cygpath.exe'),['-w','/'],{env:cleanEnv,timeout:5000}) : null;
    if (converted?.status === 0 && path.win32.isAbsolute(converted.stdout?.trim() || '')) return {bash, git,version:version.stdout.trim()};
  }
  if (env.ALIPAY_GIT_BASH) fail('NOT_GIT_BASH', 'ALIPAY_GIT_BASH');
  return null;
}
