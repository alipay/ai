#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const installUrl = 'https://opengw.alipay.com/alipaycli/install';
const internalPrefix = 'ALIPAY_AIPAY_INTERNAL:';
const refreshTimeoutMs = 60 * 1000;
const verifyTimeoutMs = 5 * 1000;

function refreshTimeoutBudget() {
  if (process.env.ALIPAY_AIPAY_TEST_MODE !== '1') return refreshTimeoutMs;
  const value = Number(process.env.ALIPAY_AIPAY_CLI_REFRESH_TEST_TIMEOUT_MS);
  return Number.isInteger(value) && value >= 50 && value <= refreshTimeoutMs ? value : refreshTimeoutMs;
}

function cleanChildEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.PLATFORM;
  delete env.PLATFORM_ID;
  delete env.PRODUCT;
  delete env.ALIPAYCLI_BIZ_INFO;
  return env;
}

function homeDir() {
  const home = process.env.HOME || os.homedir();
  if (typeof home !== 'string' || !path.isAbsolute(home) || home === path.parse(home).root) {
    return '';
  }
  return home;
}

function isPermissionFailure(text = '') {
  return /permission denied|operation not permitted|EACCES|EPERM|access denied/iu.test(text);
}

function isNetworkFailure(status, text = '') {
  const networkCurlStatuses = new Set([5, 6, 7, 18, 28, 35, 52, 55, 56, 92]);
  return networkCurlStatuses.has(Number(status)) ||
    /could not resolve|failed to connect|connection (?:refused|reset)|timed? out|timeout|network|socket|tls|ssl|fetch failed|ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN/iu.test(text);
}

function emit(kind) {
  process.stderr.write(`${internalPrefix}ALIPAY_CLI_REFRESH=${kind}\n`);
}

function commandOutput(result) {
  return `${result.stdout || ''}\n${result.stderr || ''}\n${result.error?.message || ''}`;
}

function verifyAlipayCli(binDir) {
  const command = path.join(binDir, process.platform === 'win32' ? 'alipay-cli.cmd' : 'alipay-cli');
  const result = spawnSync(command, ['version'], {
    encoding: 'utf8',
    env: cleanChildEnv({ PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}` }),
    shell: false,
    stdio: 'ignore',
    timeout: verifyTimeoutMs
  });
  return result.status === 0;
}

export function runAlipayCliRefreshCli(argv = process.argv) {
  if (argv.length !== 3 || argv[2] !== 'refresh-alipay-cli') {
    console.error('用法: node alipay_cli_refresh.mjs refresh-alipay-cli');
    process.exitCode = 1;
    return;
  }

  const home = homeDir();
  if (!home) {
    emit('FAILED');
    return;
  }

  const binDir = path.join(home, '.local', 'bin');
  try {
    fs.mkdirSync(binDir, { recursive: true, mode: 0o755 });
  } catch (error) {
    emit(isPermissionFailure(error?.message || '') ? 'RETRY_WITH_LOCAL_FS_PERMISSION' : 'FAILED');
    return;
  }

  const timeout = refreshTimeoutBudget();
  const curl = spawnSync('curl', ['-fsSL', '--connect-timeout', '10', '--max-time', '60', installUrl], {
    encoding: 'utf8',
    env: cleanChildEnv(),
    maxBuffer: 30 * 1024 * 1024,
    shell: false,
    timeout
  });
  if (curl.error || curl.status !== 0) {
    const output = commandOutput(curl);
    emit(isNetworkFailure(curl.status, output) ? 'RETRY_WITH_NETWORK' : 'FAILED');
    return;
  }

  const installEnv = cleanChildEnv({
    ALIPAY_CLI_BIN: binDir,
    ALIPAY_CLI_SKIP_VERIFY: 'true',
    PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`
  });
  const bash = spawnSync('bash', [], {
    input: curl.stdout,
    encoding: 'utf8',
    env: installEnv,
    maxBuffer: 30 * 1024 * 1024,
    shell: false,
    timeout
  });
  if (bash.error || bash.status !== 0) {
    const output = commandOutput(bash);
    if (isNetworkFailure(bash.status, output)) emit('RETRY_WITH_NETWORK');
    else if (isPermissionFailure(output)) emit('RETRY_WITH_LOCAL_FS_PERMISSION');
    else emit('FAILED');
    return;
  }

  emit(verifyAlipayCli(binDir) ? 'READY' : 'VERIFY_FAILED');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runAlipayCliRefreshCli();
}
