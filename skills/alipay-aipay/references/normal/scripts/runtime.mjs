#!/usr/bin/env node

import { isMainModule } from './is_main_module.mjs';
import { finalizeLegacyMetadata } from './session_skill.mjs';
import { spawnSync as nativeSpawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { getConversationConsent, applyTelemetrySession, currentRunContext, startTelemetryRun } from './telemetry.mjs';
import { checkFullProcessDecision, clearFullProcessDecision } from './integration_message_runner.mjs';
import { acquiringAuthorization } from './flow_loader.mjs';
import { applyAgentPlatform } from './agent_platform.mjs';
import { prepareTaskCli, preparedCliPath, usePreparedCli, reportCliPreparation } from './alipay_cli_preparation.mjs';

import { conversationCode } from './conversation_telemetry.mjs';
import { parseSandboxArgs, runLocalSandbox, reportError as reportSandboxError } from '../../integration/sandbox/sandbox_config_core.mjs';

const windowsRouting = process.platform === 'win32' ? await import('./windows/routing.mjs') : null;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const referencesDir = path.resolve(scriptDir, '../..');
const flowDirs = Object.freeze({
  integration: path.join(referencesDir, 'integration'),
  onboarding: path.join(referencesDir, 'onboarding')
});

const shellEntrypoints = Object.freeze({
  sandbox: ['integration', 'sandbox/sandbox_config.sh'],
  mcc: ['onboarding', 'modules/authorization/mcc.sh'],
  auth: ['onboarding', 'modules/authorization/auth.sh'],
  'key-tool': ['onboarding', 'modules/app-release/download_key_tool.sh'],
  screenshots: ['onboarding', 'modules/product-sign/upload_screenshots.sh'],
  'special-license': ['onboarding', 'modules/product-sign/upload_special_license.sh'],
  sign: ['onboarding', 'modules/product-sign/ar_sign_apply.sh'],
  service: ['onboarding', 'machine-pay/service-registration/service.sh'],
  app: ['onboarding', 'modules/app-release/app.sh']
});

const nodeEntrypoints = Object.freeze({
  conversation: ['conversation_consent.mjs', 'runConversationConsentCli'],
  'channel-offer': ['channel_offer.mjs', 'runChannelOfferCli'],
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
  ...(windowsRouting ? ['windows-entry'] : []),
  'self-update',
  'integration-bootstrap',
  'onboarding-bootstrap',
  'onboarding-execute-ready',
  'full-process-handoff',
  ...Object.keys(nodeEntrypoints),
  'env',
  ...Object.keys(shellEntrypoints),
  'a2m'
]);

function cliArgv(args) {
  return [process.execPath, fileURLToPath(import.meta.url), ...args];
}

async function runShell(script, cwd, args) {
  const spawnSync = process.platform === 'win32'
    ? (await import('./windows/execution.mjs')).spawnSync
    : nativeSpawn;
  const captureWindowsSandbox = process.platform === 'win32' && path.basename(script) === 'sandbox_config.sh';
  const result = spawnSync('bash', [script, ...args], {
    cwd,
    env: process.env,
    stdio: captureWindowsSandbox ? 'pipe' : 'inherit',
    ...(captureWindowsSandbox ? {encoding: 'utf8'} : {}),
    shell: false
  });
  if (captureWindowsSandbox) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
  if (result.error) throw result.error;
  process.exitCode = Number.isInteger(result.status) ? result.status : 1;
}

function shellPath(domain) {
  const [flow, basename] = shellEntrypoints[domain];
  const cwd = flowDirs[flow];
  return [path.join(cwd, basename), cwd];
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
    'channel-offer': 'ALIPAY_AIPAY_INTERNAL:CHANNEL_OFFER_ERROR=',
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
  if (domain === 'telemetry' || domain === 'channel-offer') return args;
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

const acquiringProducts = ['aipay', 'webpay', 'apppay'];
const sandboxProducts = [...acquiringProducts, 'token-subscription'];
// Consumer policy: the Windows adapter itself does not enumerate products.
const windowsTaskPolicies = Object.freeze(Object.fromEntries([
  ...acquiringProducts.map(product => [product, { autoPrepare: true }]),
  ['token-subscription', { autoPrepare: false }]
]));
export function windowsTaskPolicy(product, rootIntent) {
  const policy = Object.hasOwn(windowsTaskPolicies, product) ? windowsTaskPolicies[product] : null;
  if (!policy) throw new Error('请先确认唯一的适用产品');
  if (product === 'token-subscription' && rootIntent === 'onboarding_only') {
    throw new Error('周期订阅只复用沙箱集成环境');
  }
  return policy;
}
const productAlias = value => value?.toLowerCase().replaceAll('_', '-');

// The consent and documentation paths work without a selected product or a business run.
function businessArguments(domain, args) {
  // An explicitly requested repair is also available outside a business task.
  if (domain === 'env' && args.length === 1 && args[0] === 'refresh-alipay-cli') return args;
  if (domain === 'integration-message' && args[0] === 'product-unsupported') {
    // A fixed text renderer only; it must work before (and outside) an acquiring run.
    const options = parseRuntimeArgs(args.slice(1));
    assertOnlyOptions(options, ['product-name']);
    requiredOption(options, 'product-name');
    return args;
  }
  const subscriptionWindowsEntry = domain === 'windows-entry' && args.includes('token-subscription');
  const integration = ['sandbox', 'a2m', 'integration-message'].includes(domain) || subscriptionWindowsEntry || (domain === 'flow' && args[0] === 'integration');
  const onboarding = ['mcc', 'auth', 'key-tool', 'screenshots', 'special-license', 'sign', 'service', 'app',
    'onboarding-message', 'onboarding-discovery', 'onboarding-recovery', 'onboarding-execute-ready'].includes(domain) || (domain === 'flow' && args[0] === 'onboarding');
  if (!integration && !onboarding && !['env', 'full-process-handoff'].includes(domain)) return args;
  const permitted = ['full_process'];
  if (integration || domain === 'env') permitted.push('integration_only');
  if (onboarding || domain === 'env') permitted.push('onboarding_only');
  // Older callers may repeat their selection. Only the task stored for this session establishes it.
  const rest = [], explicit = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag !== '--confirmed-intent' && flag !== '--confirmed-product') { rest.push(flag); continue; }
    if (explicit[flag] !== undefined || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('已确认的执行上下文参数重复或缺值');
    explicit[flag] = args[++i];
  }
  const active = currentRunContext(process.env);
  if (active?.terminal) throw new Error('当前流程已结束；请先从入口确认本轮产品和任务');
  const intent = active?.root_intent;
  const product = productAlias(active?.product_type);
  if (!active || (process.env.ALIPAY_AIPAY_TELEMETRY_RUN_ID && process.env.ALIPAY_AIPAY_TELEMETRY_RUN_ID !== active.run_id)) {
    throw new Error('请从当前会话的任务入口启动或恢复已确认的产品和执行任务');
  }
  const productFlag = ['--product-type', '--product'].find(flag => rest.includes(flag));
  const declared = productFlag ? productAlias(rest[rest.indexOf(productFlag) + 1]) : undefined;
  const sharedSandboxAction = domain === 'sandbox' || subscriptionWindowsEntry ||
    (domain === 'env' && ['integration-check', 'retry-alipay-cli', 'prepare-jq'].includes(rest[0]));
  if (!permitted.includes(intent) || !(sharedSandboxAction ? sandboxProducts : acquiringProducts).includes(product)
      || (product === 'token-subscription' && !['integration_only', 'full_process'].includes(intent))
      || (productFlag && declared !== product)
      || (rest.includes('--root-intent') && rest[rest.indexOf('--root-intent') + 1] !== intent)
      || (explicit['--confirmed-intent'] !== undefined && explicit['--confirmed-intent'] !== intent)
      || (explicit['--confirmed-product'] !== undefined && productAlias(explicit['--confirmed-product']) !== product)) {
    throw new Error('产品和执行任务必须已明确、与当前流程一致；请返回根入口');
  }
  if (domain === 'sandbox') {
    const parsed = parseSandboxArgs(rest);
    if (parsed.product && parsed.product !== product) throw new Error('沙箱摘要产品与当前任务不一致');
    process.env.ALIPAY_AIPAY_SANDBOX_PRODUCT = product;
  }
  if (product === 'token-subscription' && domain === 'env' && rest.includes('--product-type')) {
    // The common environment check has no acquiring PRODUCT attribution.
    const index = rest.indexOf('--product-type'); rest.splice(index, 2);
  }
  if (domain === 'flow' && !rest.includes('--product-type')) throw new Error('阶段命令必须携带 --product-type');
  const get = flag => rest.includes(flag) ? rest[rest.indexOf(flag) + 1] : undefined;
  const variant = get('--variant')?.toLowerCase();
  if ((acquiringProducts.includes(variant) && variant !== product)
    || (['service', 'a2m'].includes(domain) && product !== 'aipay')
    || (domain === 'screenshots' && product === 'aipay')) throw new Error('动作或 variant 不适用于当前收单产品');
  if (['--product-name', '--sales-code', '--scope'].some(flag => rest.includes(flag))) {
    const auth = acquiringAuthorization(product);
    for (const [flag, field] of [['--product-name', 'name'], ['--sales-code', 'salesCode'], ['--scope', 'scope']]) {
      if (get(flag) !== undefined && get(flag) !== auth[field]) throw new Error('命令与当前收单产品的授权参数不符：' + flag);
    }
  }
  if (intent === 'full_process' && onboarding) checkFullProcessDecision(product);
  if (intent === 'full_process' && integration && (domain === 'flow' && args[1] === 'checklist'
      || domain === 'integration-message' && args[0] === 'start-confirm')) clearFullProcessDecision(active);
  return rest;
}

async function runIntegrationBootstrap(args) {
  const options = parseRuntimeArgs(args);
  assertOnlyOptions(options, ['root-intent', 'product-type']);
  const rootIntent = assertEnumOption(options, 'root-intent', ['integration_only']);
  const productType = assertEnumOption(options, 'product-type', acquiringProducts);
  process.env.ALIPAY_AIPAY_ROOT_INTENT = rootIntent;
  if (!await startTelemetryRun(rootIntent, productType)) throw new Error('业务任务未建立，请按当前会话状态恢复后继续');
  const { runFlowCli } = await import('./flow_loader.mjs');
  runFlowCli(cliArgv(['integration', 'entry', '--product-type', productType]));
}

async function runOnboardingBootstrap(args) {
  const options = parseRuntimeArgs(args);
  assertOnlyOptions(options, ['root-intent', 'product-type']);
  const rootIntent = assertEnumOption(options, 'root-intent', ['onboarding_only']);
  const productType = assertEnumOption(options, 'product-type', acquiringProducts);
  process.env.ALIPAY_AIPAY_ROOT_INTENT = rootIntent;
  if (!await startTelemetryRun(rootIntent, productType)) throw new Error('业务任务未建立，请按当前会话状态恢复后继续');
  const { runOnboardingMessageCli } = await import('./onboarding_message_runner.mjs');
  const platformEntryArgs = ['platform-entry'];
  const route = await runOnboardingMessageCli(cliArgv(platformEntryArgs));
  const { isWindowsPlatform } = await import('./platform_compat.mjs');
  if (isWindowsPlatform() && route !== 'READY') return;
  const { runFlowCli } = await import('./flow_loader.mjs');
  runFlowCli(cliArgv(['onboarding', 'entry', '--product-type', productType]));
}

async function runFullProcessHandoff(args) {
  const options = parseRuntimeArgs(args);
  assertOnlyOptions(options, ['product-type', 'integration-result', 'sandbox-config-state', 'next-phase']);
  const product = assertEnumOption(options, 'product-type', acquiringProducts);
  const result = assertEnumOption(options, 'integration-result', ['已完成', '部分完成，沙箱配置待完成', '部分完成，人工待验证', '未通过']);
  const sandbox = assertEnumOption(options, 'sandbox-config-state', ['READY', 'CREATE_PENDING', 'VERIFY_PENDING']);
  const next = assertEnumOption(options, 'next-phase', ['ONBOARDING', 'STOP']);
  if (next === 'STOP' || result === '未通过') {
    clearFullProcessDecision(currentRunContext());
    if (next === 'STOP' && result === '未通过') return;
    throw new Error('Integration STOP 或未通过，不得进入 Onboarding');
  }
  if ((result === '部分完成，沙箱配置待完成') === (sandbox === 'READY')) {
    throw new Error('Integration 结果、沙箱状态和下一阶段矛盾；不得进入 Onboarding');
  }
  checkFullProcessDecision(product, { result, sandbox });
  const { runOnboardingMessageCli } = await import('./onboarding_message_runner.mjs');
  const route = await runOnboardingMessageCli(cliArgv(['platform-entry']));
  const { isWindowsPlatform } = await import('./platform_compat.mjs');
  if (isWindowsPlatform() && route !== 'READY') return;
  checkFullProcessDecision(product, { result, sandbox, enter: true });
  const { runFlowCli } = await import('./flow_loader.mjs');
  runFlowCli(cliArgv(['onboarding', 'entry', '--product-type', product]));
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
  const localSandbox = domain === 'sandbox' && windowsRouting &&
    (['verify', 'reverify', 'summary'].includes(args[0]) ||
     args[0] === 'ensure' && ['LEGACY', 'CODE_ONLY'].includes(process.env.ALIPAY_AIPAY_WINDOWS_ROUTE));
  if (windowsRouting) {
    if (domain === 'windows-entry') {
      if (!process.env.ALIPAY_AIPAY_SESSION_ID ||
          (conversationCode(process.env) && getConversationConsent() === 'UNSET')) {
        throw new Error('尚无有效采集偏好，请先选择同意采集或仅使用服务，再检查收单环境');
      }
      const product = args[args.indexOf('--product-type') + 1];
      const policy = windowsTaskPolicy(product, args[args.indexOf('--root-intent') + 1]);
      return windowsRouting.runWindowsEntry(args, policy);
    }
    const route = process.env.ALIPAY_AIPAY_WINDOWS_ROUTE;
    const integrationAction = domain.startsWith('integration-') && !(domain === 'integration-message' && args[0] === 'product-unsupported');
    const routedAction = integrationAction || domain.startsWith('onboarding-') || domain === 'flow'
      || domain === 'full-process-handoff' || domain === 'a2m' || Object.hasOwn(shellEntrypoints, domain);
    if (routedAction && (!route || route === 'BLOCKED')) {
      throw Object.assign(new Error('先按当前产品和任务完成 Windows 环境分流'), {reason: 'WINDOWS_ENVIRONMENT_UNAVAILABLE'});
    }
    const siteGuidanceOnly = domain === 'onboarding-bootstrap' || domain === 'full-process-handoff'
      || (domain === 'onboarding-message' && args[0] === 'platform-entry');
    if (route === 'CODE_ONLY' && !siteGuidanceOnly &&
        (domain.startsWith('onboarding-') || (domain === 'flow' && args[0] !== 'integration') ||
         (args.includes('--root-intent') && args[args.indexOf('--root-intent') + 1] === 'onboarding_only'))) {
      windowsRouting.requireBusinessEnvironment();
    }
    if (['sandbox', 'mcc', 'auth', 'key-tool', 'screenshots', 'special-license', 'sign', 'service', 'app',
      'onboarding-discovery', 'onboarding-recovery', 'onboarding-execute-ready'].includes(domain) && !localSandbox) {
      windowsRouting.requireBusinessEnvironment({credentials: !['sandbox', 'key-tool'].includes(domain)});
    }
    if (domain === 'env' && ['prepare-python', 'check-python'].includes(args[0])
        && currentRunContext()?.product_type?.toLowerCase() !== 'aipay') {
      throw new Error('Windows Python 联调仅用于 AI 按量付费');
    }
    if (domain === 'env' && ['prepare', 'prepare-jq', 'retry'].includes(args[0])) {
      const { runEnvironment } = await import('./windows/prepare.mjs');
      process.exitCode = runEnvironment(args);
      return;
    }
  }
  if (localSandbox) {
    try { return await runLocalSandbox(args); }
    catch (error) { reportSandboxError(error); process.exitCode = 1; return; }
  }
  if (domain === 'integration-bootstrap') return runIntegrationBootstrap(args);
  if (domain === 'onboarding-bootstrap') return runOnboardingBootstrap(args);
  if (domain === 'full-process-handoff') return runFullProcessHandoff(args);
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
    if (process.platform === 'win32' && ['check-python', 'prepare-python'].includes(args[0])) {
      const { runPythonEnvironment } = await import('./windows/python-runtime.mjs');
      process.exitCode = await runPythonEnvironment(args);
      return;
    }
    if (args[0] === 'refresh-alipay-cli') {
      if (args.length !== 1) throw new Error('用法: runtime.mjs env refresh-alipay-cli');
      const { runAlipayCliRefreshCli } = await import('./alipay_cli_refresh.mjs');
      return runAlipayCliRefreshCli(cliArgv(['refresh-alipay-cli']));
    }
    if (args[0] === 'retry-alipay-cli') {
      if (args.length !== 1) throw new Error('用法: runtime.mjs env retry-alipay-cli');
      const result = prepareTaskCli({ retry: true });
      reportCliPreparation(result);
      usePreparedCli(result.cliPath);
      return;
    }
    if (args[0] === 'prepare-jq') {
      if (args.length !== 1) throw new Error('用法: runtime.mjs env prepare-jq');
      const { runManagedJqCli } = await import('./managed_jq.mjs');
      process.exitCode = await runManagedJqCli(cliArgv(['prepare']));
      return;
    }
    const { isWindowsPlatform } = await import('./platform_compat.mjs');
    if (['check', 'integration-check'].includes(args[0])) {
      const result = prepareTaskCli();
      reportCliPreparation(result);
      usePreparedCli(result.cliPath);
    }
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
    if (outcome.kind==='SESSION_READY') process.stderr.write(`ALIPAY_AIPAY_INTERNAL:SELF_UPDATE_SESSION_SKILL_DIR=${JSON.stringify(outcome.skillDir)}\n`);
    process.stderr.write(`SELF_UPDATE:${outcome.kind}${version}\n`);
    return;
  }
  if (domain === 'a2m') {
    const { runPythonScriptCli } = await import('./python_script_runner.mjs');
    const script = path.join(flowDirs.integration, 'machine-pay/sandbox/local_402_sandbox_pay.py');
    return runPythonScriptCli(cliArgv([script, ...args]));
  }
  throw new Error(`用法: runtime.mjs <${runtimeDomains.join('|')}> ...`);
}

export async function runRuntimeCli(argv = process.argv) {
  const domain = argv[2] || '';
  try {
    finalizeLegacyMetadata(path.resolve(scriptDir, '../../..'));
    const received = applyTelemetrySession(applyAgentPlatform(argv.slice(3)));
    const routed = windowsRouting ? windowsRouting.consumeRoute(received) : { args: received };
    if (windowsRouting) {
      if (routed.route) process.env.ALIPAY_AIPAY_WINDOWS_ROUTE = routed.route;
      else delete process.env.ALIPAY_AIPAY_WINDOWS_ROUTE;
    }
    const args = applyTelemetryContext(domain, routed.args);
    usePreparedCli(preparedCliPath());
    await dispatch(domain, businessArguments(domain, args));
  } catch (error) {
    if (windowsRouting && error.reason) {
      const { report } = await import('./windows/preflight.mjs');
      report(error);
      process.stderr.write('ALIPAY_AIPAY_INTERNAL:WINDOWS_BUSINESS_BLOCKED=ENVIRONMENT_UNAVAILABLE\n');
    } else runtimeError(domain, error);
    process.exitCode = domain === 'self-update' ? 0 : 1;
  }
}

if (isMainModule(import.meta.url)) {
  runRuntimeCli();
}
