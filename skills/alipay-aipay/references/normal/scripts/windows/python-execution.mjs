import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {checkWritable} from './host.mjs';

// Pin tempfile itself: environment variables alone allow Python to fall back to
// another directory if the writable directory becomes unavailable.
const bootstrap = [
  'import os, runpy, sys, tempfile',
  'tempfile.tempdir = sys.argv[1]',
  'sys.argv = sys.argv[2:]',
  'sys.path[0] = os.path.dirname(sys.argv[0])',
  'runpy.run_path(sys.argv[0], run_name="__main__")'
].join('\n');

// The caller has already validated the single registered A2M script path.
export function runWindowsPython(python, script, args, {
  env = process.env, tempRoot = os.tmpdir(), checkDirectory = checkWritable, spawn = spawnSync,
  cleanup = directory => fs.rmSync(directory, {recursive: true, force: true})
} = {}) {
  const temporary = fs.mkdtempSync(path.join(path.resolve(tempRoot), 'alipay-aipay-a2m-'));
  try {
    // Confirm the fresh directory is writable before launching Python. Its
    // inherited permissions remain intact for Python and curl output.
    checkDirectory(temporary);
    const childEnv = Object.fromEntries(Object.entries(env)
      .filter(([key]) => !['TEMP', 'TMP', 'TMPDIR'].includes(key.toUpperCase())));
    Object.assign(childEnv, {TEMP: temporary, TMP: temporary, TMPDIR: temporary});
    return spawn(python.command, [...python.prefix, '-c', bootstrap, temporary, script, ...args], {
      env: childEnv, stdio: 'inherit', shell: false, windowsHide: true
    });
  } finally {
    // Clean only this invocation's scratch directory; never replay the payment.
    try { cleanup(temporary); }
    catch { process.stderr.write('ALIPAY_AIPAY_INTERNAL:WINDOWS_A2M_SCRATCH_CLEANUP=FAILED\n'); }
  }
}
