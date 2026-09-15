import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import process from 'node:process';

export function runtimePlatform(env = process.env) {
  const testPlatform = env.ALIPAY_AIPAY_TEST_MODE === '1' ? env.ALIPAY_AIPAY_TEST_PLATFORM : '';
  return ['darwin', 'linux', 'win32'].includes(testPlatform) ? testPlatform : process.platform;
}

export function isWindowsPlatform(env = process.env) {
  return runtimePlatform(env) === 'win32';
}

export function commandRuns(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: 'ignore',
    shell: false,
    env: options.env || process.env
  });
  return result.status === 0;
}

export function currentNodeAvailable(env = process.env) {
  return Boolean(process.execPath && fs.existsSync(process.execPath));
}

export function checkCliEnvironment(options = {}) {
  const env = options.env || process.env;
  const requireJq = options.requireJq ?? !isWindowsPlatform(env);
  const requireAlipayCli = options.requireAlipayCli ?? true;
  const missing = [];

  if (!currentNodeAvailable(env)) missing.push('node');
  if (requireJq && (
    !commandRuns('jq', ['--version'], { env }) ||
    !commandRuns('jq', ['-n', '-e', '--arg', 'value', 'ok', '$value == "ok"'], { env })
  )) missing.push('jq');
  if (requireAlipayCli && !commandRuns('alipay-cli', ['version'], { env })) missing.push('alipay-cli');

  return missing;
}
