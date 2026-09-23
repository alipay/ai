#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { applyTelemetrySession, currentRunContext, startTelemetryRun } from './telemetry.mjs';
import { applyAgentPlatform } from './agent_platform.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const referencesDir = path.resolve(scriptDir, '../..');
const flowDirs = Object.freeze({
  integration: path.join(referencesDir, 'integration'),
  onboarding: path.join(referencesDir, 'onboarding')
});

const shellEntrypoints = Object.freeze({
  sandbox: ['integration', 'sandbox_config.sh'],
  mcc: ['onboarding', 'mcc.sh'],
  auth: ['onboarding', 'auth.sh'],
  'key-tool': ['onboarding', 'download_key_tool.sh'],
  screenshots: ['onboarding', 'upload_screenshots.sh'],
  'special-license': ['onboarding', 'upload_special_license.sh'],
  sign: ['onboarding', 'ar_sign_apply.sh'],
  service: ['onboarding', 'service.sh'],
  app: ['onboarding', 'app.sh']
});

const nodeEntrypoints = Object.freeze({
  telemetry: ['telemetry.mjs', 'runTelemetryCli'],
  flow: ['flow_loader.mjs', 'runFlowCli'],
  'onboarding-message': ['onboarding_message_runner.mjs', 'runOnboardingMessageCli'],
  'integration-message': ['integration_message_runner.mjs', 'runIntegrationMessageCli'],
  render: ['render_customer_message.mjs', 'runRenderCustomerMessageCli'],
  reply: ['interaction_reply.mjs', 'runInteractionReplyCli'],
  'integration-context': ['integration_context_runner.mjs', 'runIntegrationContextCli'],
  'onboarding-discovery': ['onboarding_discovery_runner.mjs', 'runOnboardingDiscoveryCli'],
  'onboarding-recovery': ['onboarding_recovery_runner.mjs', 'runOnboardingRecoveryCli']
});

export const runtimeDomains = Object.freeze([
  'self-update',
  'integration-bootstrap',
  'onboarding-bootstrap',
  'onboarding-execute-ready',
  ...Object.keys(nodeEntrypoints),
  'env',
  ...Object.keys(shellEntrypoints),
  'a2m'
]);

function cliArgv(args) {
  return [process.execPath, fileURLToPath(import.meta.url), ...args];
}

function runShell(script, cwd, args) {
  const result = spawnSync('bash', [script, ...args], {
    cwd,
    env: process.env,
    stdio: 'inherit',
    shell: false
  });
  if (result.error) throw result.error;
  process.exitCode = Number.isInteger(result.status) ? result.status : 1;
}

function shellPath(domain) {
  const [flow, basename] = shellEntrypoints[domain];
  const cwd = flowDirs[flow];
  return [path.join(cwd, 'modules/scripts', basename), cwd];
}

function runtimeError(domain, error) {
  const message = String(error?.message || error).replace(/[\r\n]/gu, ' ');
  if (domain === 'self-update') return process.stderr.write('SELF_UPDATE:CHECK_FAILED\n');
  if (domain === 'render') {
    process.stderr.write('当前步骤的标准消息无法安全生成，已停止后续动作。请按 MESSAGE_RENDER_ERROR 的具体原因修正输入；若消息目录或脚本缺失，再检查 Skill 文件完整性。\n');
    process.stderr.write(`MESSAGE_RENDER_ERROR:${message}\n`);
    return;
  }
  const prefixes = {
    flow: 'FLOW_LOADER_ERROR:',
    'onboarding-message': 'ONBOARDING_MESSAGE_ERROR:',
    'integration-message': 'INTEGRATION_MESSAGE_ERROR:',
    reply: 'ALIPAY_AIPAY_INTERNAL:REPLY_VALIDATION_ERROR=',
    'integration-context': 'ALIPAY_AIPAY_INTERNAL:INTEGRATION_CONTEXT_ERROR=',
    'onboarding-discovery': 'ALIPAY_AIPAY_INTERNAL:DISCOVERY_RUNNER_ERROR=',
    'onboarding-recovery': 'ALIPAY_AIPAY_INTERNAL:RECOVERY_RUNNER_ERROR=',
    a2m: 'PYTHON_RUNNER_ERROR:'
  };
  process.stderr.write(`${prefixes[domain] || 'ALIPAY_AIPAY_INTERNAL:RUNTIME_ERROR='}${message}\n`);
}

function parseRuntimeArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) throw new Error(`未知参数 ${token}`);
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`参数 ${token} 缺少取值`);
    const name = token.slice(2);
    if (Object.prototype.hasOwnProperty.call(parsed, name)) throw new Error(`参数 ${token} 重复`);
    parsed[name] = value;
    index += 1;
  }
  return parsed;
}

function requiredOption(options, name) {
  const value = options[name];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`缺少参数 --${name}`);
  return value;
}

function assertOnlyOptions(options, allowedNames) {
  const allowed = new Set(allowedNames);
  const unknown = Object.keys(options).filter((name) => !allowed.has(name));
  if (unknown.length > 0) throw new Error(`未知参数 --${unknown[0]}`);
}

function assertEnumOption(options, name, allowedValues, { required = true } = {}) {
  if (!Object.prototype.hasOwnProperty.call(options, name)) {
    if (required) throw new Error(`缺少参数 --${name}`);
    return '';
  }
  const value = requiredOption(options, name);
  if (!allowedValues.includes(value)) {
    throw new Error(`参数 --${name} 非法，仅支持 ${allowedValues.join('、')}`);
  }
  return value;
}

function applyTelemetryContext(domain, args) {
  if (domain === 'telemetry') return args;
  const remaining = [];
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token !== '--telemetry-run-id' && token !== '--telemetry-history-count') {
      remaining.push(token);
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`参数 ${token} 缺少取值`);
    if (Object.prototype.hasOwnProperty.call(values, token)) throw new Error(`参数 ${token} 重复`);
    values[token] = value;
    index += 1;
  }
  if (values['--telemetry-run-id'] !== undefined) {
    process.env.ALIPAY_AIPAY_TELEMETRY_RUN_ID = values['--telemetry-run-id'];
  } else {
    const activeRun = currentRunContext(process.env);
    if (activeRun && !activeRun.terminal) process.env.ALIPAY_AIPAY_TELEMETRY_RUN_ID = activeRun.run_id;
  }
  if (values['--telemetry-history-count'] !== undefined) {
    const historyCount = values['--telemetry-history-count'];
    if (historyCount !== 'null' && !/^(?:0|[1-9]\d*)$/u.test(historyCount)) {
      throw new Error('--telemetry-history-count 只支持非负整数或 null');
    }
    process.env.ALIPAY_AIPAY_TELEMETRY_HISTORY_COUNT = historyCount;
  } else if (!process.env.ALIPAY_AIPAY_TELEMETRY_HISTORY_COUNT) {
    process.env.ALIPAY_AIPAY_TELEMETRY_HISTORY_COUNT = 'null';
  }
  return remaining;
}

async function runIntegrationBootstrap(args) {
  const options = parseRuntimeArgs(args);
  assertOnlyOptions(options, ['root-intent', 'product-type']);
  const rootIntent = assertEnumOption(options, 'root-intent', ['integration_only']);
  const productType = assertEnumOption(options, 'product-type', ['aipay', 'webpay', 'apppay'], { required: false });
  process.env.ALIPAY_AIPAY_ROOT_INTENT = rootIntent;
  await startTelemetryRun(rootIntent, productType);
  const { runFlowCli } = await import('./flow_loader.mjs');
  runFlowCli(cliArgv(['integration', 'entry']));
}

async function runOnboardingBootstrap(args) {
  const options = parseRuntimeArgs(args);
  assertOnlyOptions(options, ['root-intent', 'product-type']);
  const rootIntent = assertEnumOption(options, 'root-intent', ['onboarding_only']);
  const productType = assertEnumOption(options, 'product-type', ['aipay', 'webpay', 'apppay'], { required: false });
  process.env.ALIPAY_AIPAY_ROOT_INTENT = rootIntent;
  await startTelemetryRun(rootIntent, productType);
  const { runOnboardingMessageCli } = await import('./onboarding_message_runner.mjs');
  const platformEntryArgs = ['platform-entry'];
  await runOnboardingMessageCli(cliArgv(platformEntryArgs));
  const { isWindowsPlatform } = await import('./platform_compat.mjs');
  if (isWindowsPlatform()) return;
  const { runFlowCli } = await import('./flow_loader.mjs');
  runFlowCli(cliArgv(['onboarding', 'entry']));
}

async function runOnboardingExecuteReady(args) {
  const options = parseRuntimeArgs(args);
  assertOnlyOptions(options, ['product-type']);
  const productType = assertEnumOption(options, 'product-type', ['aipay', 'webpay', 'apppay']);
  const { runFlowCli } = await import('./flow_loader.mjs');
  runFlowCli(cliArgv(['onboarding', 'execute', '--product-type', productType]));
  return dispatch('env', ['check', '--product-type', productType]);
}

async function dispatch(domain, args) {
  if (domain === 'integration-bootstrap') return runIntegrationBootstrap(args);
  if (domain === 'onboarding-bootstrap') return runOnboardingBootstrap(args);
  if (domain === 'onboarding-execute-ready') return runOnboardingExecuteReady(args);
  if (domain === 'auth') {
    const [script, cwd] = shellPath(domain);
    const { runAuthRuntime } = await import('./auth_runtime_runner.mjs');
    process.exitCode = runAuthRuntime(script, cwd, args);
    return;
  }
  if (shellEntrypoints[domain]) {
    const [script, cwd] = shellPath(domain);
    return runShell(script, cwd, args);
  }
  if (nodeEntrypoints[domain]) {
    const [moduleName, exportName] = nodeEntrypoints[domain];
    const result = await (await import(`./${moduleName}`))[exportName](cliArgv(args));
    if (domain === 'telemetry') process.exitCode = result;
    return;
  }
  if (domain === 'env') {
    if (args[0] === 'refresh-alipay-cli') {
      if (args.length !== 1) throw new Error('用法: runtime.mjs env refresh-alipay-cli');
      const { runAlipayCliRefreshCli } = await import('./alipay_cli_refresh.mjs');
      return runAlipayCliRefreshCli(cliArgv(['refresh-alipay-cli']));
    }
    if (args[0] === 'prepare-jq') {
      if (args.length !== 1) throw new Error('用法: runtime.mjs env prepare-jq');
      const { runManagedJqCli } = await import('./managed_jq.mjs');
      process.exitCode = await runManagedJqCli(cliArgv(['prepare']));
      return;
    }
    const { isWindowsPlatform } = await import('./platform_compat.mjs');
    if (!isWindowsPlatform()) {
      return runShell(path.join(scriptDir, 'alipay_cli_env.sh'), path.dirname(scriptDir), args);
    }
    const { runAlipayCliEnvCli } = await import('./alipay_cli_env.mjs');
    return runAlipayCliEnvCli(cliArgv(args));
  }
  if (domain === 'self-update') {
    const { runSelfUpdateCli } = await import('./self_update.mjs');
    const outcome = await runSelfUpdateCli(cliArgv(args));
    const version = outcome.version ? `=${outcome.version.raw}` : '';
    process.stderr.write(`SELF_UPDATE:${outcome.kind}${version}\n`);
    return;
  }
  if (domain === 'a2m') {
    const { runPythonScriptCli } = await import('./python_script_runner.mjs');
    const script = path.join(flowDirs.integration, 'modules/scripts/local_402_sandbox_pay.py');
    return runPythonScriptCli(cliArgv([script, ...args]));
  }
  throw new Error(`用法: runtime.mjs <${runtimeDomains.join('|')}> ...`);
}

export async function runRuntimeCli(argv = process.argv) {
  const domain = argv[2] || '';
  try {
    await dispatch(domain, applyTelemetryContext(domain, applyTelemetrySession(applyAgentPlatform(argv.slice(3)))));
  } catch (error) {
    runtimeError(domain, error);
    process.exitCode = domain === 'self-update' ? 0 : 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runRuntimeCli();
}
