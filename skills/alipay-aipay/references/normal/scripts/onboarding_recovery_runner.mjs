#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { isAffirmativeReply } from './interaction_reply.mjs';

const internalPrefix = 'ALIPAY_AIPAY_INTERNAL:';
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const onboardingScriptsDir = path.resolve(scriptDir, '../../onboarding/modules/scripts');

function parseArgs(argv) {
  const command = argv[2];
  const args = {};
  for (let index = 3; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`未知参数 ${token}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`参数 ${token} 缺少取值`);
    const name = token.slice(2);
    if (Object.prototype.hasOwnProperty.call(args, name)) throw new Error(`参数 ${token} 重复`);
    args[name] = value;
    index += 1;
  }
  return { command, args };
}

function required(args, name) {
  const value = args[name];
  if (typeof value !== 'string' || !value) throw new Error(`缺少参数 --${name}`);
  return value;
}

function assertRegisteredReply(args, kind) {
  required(args, 'input-id');
  if (!isAffirmativeReply(required(args, 'reply'))) {
    process.stderr.write(`${internalPrefix}RECOVERY_INPUT_REJECTED=${kind}\n`);
    process.exitCode = 2;
    return false;
  }
  return true;
}

function runScript(scriptName, argv, env = process.env) {
  const result = spawnSync('bash', [path.join(onboardingScriptsDir, scriptName), ...argv], {
    cwd: onboardingScriptsDir,
    env,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  process.exitCode = result.status === null ? 1 : result.status;
}

function runAuthConfirm(args) {
  if (!assertRegisteredReply(args, 'AUTH_PENDING')) return;
  const context = [
    ['scope', required(args, 'scope')],
    ['sales-code', required(args, 'sales-code')],
    ['mcc-code', required(args, 'mcc-code')],
    ['product-name', required(args, 'product-name')],
    ['mcc-name', required(args, 'mcc-name')],
    ['mcc-context-receipt', required(args, 'mcc-context-receipt')]
  ].flatMap(([name, value]) => [`--${name}`, value]);
  runScript('auth.sh', ['confirm', ...context]);
}

function runApplicationKeyRecovery(args) {
  if (!assertRegisteredReply(args, 'APPLICATION_KEY_PENDING')) return;
  const mode = required(args, 'mode');
  const productType = required(args, 'product-type');
  if (!['aipay', 'webpay', 'apppay'].includes(productType)) {
    throw new Error('product-type 仅支持 aipay、webpay 或 apppay');
  }
  if (!['verify-key', 'verify-key-and-audit'].includes(mode)) {
    throw new Error('mode 仅支持 verify-key 或 verify-key-and-audit');
  }
  const argv = [mode, '--product-type', productType, required(args, 'app-id')];
  if (args['public-key'] !== undefined) argv.push(args['public-key']);
  runScript('app.sh', argv, { ...process.env, ALIPAY_AIPAY_RECOVERY_QUERY_ONCE: '1' });
}

export function runOnboardingRecoveryCli(argv = process.argv) {
  const { command, args } = parseArgs(argv);
  if (command === 'auth-confirm') return runAuthConfirm(args);
  if (command === 'application-key') return runApplicationKeyRecovery(args);
  throw new Error('用法: onboarding_recovery_runner.mjs <auth-confirm|application-key> --reply <明确完成表达> --input-id <本地用户输入幂等键> ...');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runOnboardingRecoveryCli();
  } catch (error) {
    process.stderr.write(`${internalPrefix}RECOVERY_RUNNER_ERROR=${String(error?.message || error).replace(/[\r\n]/gu, ' ')}\n`);
    process.exitCode = 1;
  }
}
