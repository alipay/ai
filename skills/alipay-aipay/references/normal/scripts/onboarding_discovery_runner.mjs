#!/usr/bin/env node

import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { renderDiscoverySummary } from './onboarding_message_runner.mjs';
import { currentRunContext, emitStageMetric, telemetryEnabled } from './telemetry.mjs';

const internalPrefix = 'ALIPAY_AIPAY_INTERNAL:';
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const onboardingScriptsDir = path.resolve(scriptDir, '../../onboarding/modules/scripts');
const scriptPaths = Object.freeze({
  signing: path.join(onboardingScriptsDir, 'query_sign_status.sh'),
  service: path.join(onboardingScriptsDir, 'service.sh'),
  application: path.join(onboardingScriptsDir, 'app.sh')
});
const productSalesCodes = Object.freeze({
  aipay: 'I1080300001000160457',
  webpay: 'I1080300001000041203',
  apppay: 'I1080300001000041313'
});
const signStatuses = new Set(['NOT_SIGNED', 'SIGN_SUBMITTED', 'SIGNED_EFFECTIVE', 'OTHER_STATUS']);
const authSignReuseReceiptPrefix = 'AIPAY_SIGN_REUSE_V1.';
const signFlowByProduct = Object.freeze({
  aipay: Object.freeze({ notSigned: 'FLOW:AI_PAY_NOT_SIGNED', signed: 'FLOW:AI_PAY_SIGNED' }),
  webpay: Object.freeze({ notSigned: 'FLOW:PC_WEB_NOT_SIGNED', signed: 'FLOW:PC_WEB_SIGNED' }),
  apppay: Object.freeze({ notSigned: 'FLOW:APP_NOT_SIGNED', signed: 'FLOW:APP_SIGNED' })
});
const serviceFlows = new Set(['FLOW:CREATE_NEW', 'FLOW:SELECT']);
const applicationFlows = new Set(['FLOW:CREATE_NEW', 'FLOW:SELECT', 'FLOW:PENDING_APPLICATIONS']);

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

function internalLines(stderr) {
  return String(stderr || '')
    .split(/\r?\n/u)
    .filter((line) => line.startsWith(internalPrefix))
    .map((line) => line.slice(internalPrefix.length));
}

function uniqueValue(lines, prefix) {
  const values = lines.filter((line) => line.startsWith(prefix)).map((line) => line.slice(prefix.length));
  return values.length === 1 ? values[0] : '';
}

function uniqueFlow(lines, allowed) {
  const values = lines.filter((line) => line.startsWith('FLOW:') && allowed.has(line));
  return values.length === 1 ? values[0] : '';
}

function allowedSignFlowValues(productType) {
  const flows = signFlowByProduct[productType];
  return new Set([flows.notSigned, flows.signed, 'FLOW:OTHER_STATUS']);
}

function normalizeSignFlow(value) {
  if (typeof value !== 'string' || value.length === 0) return '';
  return value.startsWith('FLOW:') ? value : `FLOW:${value}`;
}

function legalSignReuseDescription(productType) {
  const flows = signFlowByProduct[productType];
  return [
    `NOT_SIGNED + ${flows.notSigned}`,
    `SIGNED_EFFECTIVE + ${flows.signed}`,
    `SIGN_SUBMITTED + ${flows.signed}`,
    'OTHER_STATUS + FLOW:OTHER_STATUS'
  ].join('；');
}

function assertValidSignReuse({ productType, salesCode, signStatus, flow }) {
  if (!productSalesCodes[productType]) {
    throw new Error('签约复用 productType 非法，仅支持 aipay、webpay、apppay');
  }
  if (salesCode !== productSalesCodes[productType]) {
    throw new Error(`签约复用 salesCode 与 productType 不匹配；${productType} 必须使用 ${productSalesCodes[productType]}`);
  }
  const normalizedFlow = normalizeSignFlow(flow);
  if (!signStatuses.has(signStatus) || !allowedSignFlowValues(productType).has(normalizedFlow)) {
    throw new Error(`签约复用状态或 flow 非法；允许组合：${legalSignReuseDescription(productType)}`);
  }
  const flows = signFlowByProduct[productType];
  const validPair =
    (signStatus === 'NOT_SIGNED' && normalizedFlow === flows.notSigned)
    || ((signStatus === 'SIGNED_EFFECTIVE' || signStatus === 'SIGN_SUBMITTED') && normalizedFlow === flows.signed)
    || (signStatus === 'OTHER_STATUS' && normalizedFlow === 'FLOW:OTHER_STATUS');
  if (!validPair) {
    throw new Error(`签约复用 status/flow 组合矛盾；允许组合：${legalSignReuseDescription(productType)}`);
  }
  return { signStatus, flow: normalizedFlow };
}

function decodeBase64UrlJson(value) {
  const normalized = value.replace(/-/gu, '+').replace(/_/gu, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

function parseSignReuseReceipt(receipt, productType, salesCode) {
  if (typeof receipt !== 'string' || !receipt.startsWith(authSignReuseReceiptPrefix)) {
    throw new Error('签约复用回执格式非法；必须使用 AUTH_SIGN_REUSE_RECEIPT 原值');
  }
  let parsed;
  try {
    parsed = decodeBase64UrlJson(receipt.slice(authSignReuseReceiptPrefix.length));
  } catch {
    throw new Error('签约复用回执无法解析；必须使用 AUTH_SIGN_REUSE_RECEIPT 原值');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('签约复用回执内容非法');
  }
  const unknownKeys = Object.keys(parsed).filter((key) => ![
    'schema_ver',
    'product_type',
    'sales_code',
    'sign_status',
    'flow'
  ].includes(key));
  if (unknownKeys.length > 0) throw new Error(`签约复用回执包含未知字段：${unknownKeys.join('、')}`);
  if (parsed.schema_ver !== 1) throw new Error('签约复用回执版本非法；当前仅支持 schema_ver=1');
  if (parsed.product_type !== productType) throw new Error('签约复用回执与当前 product-type 不匹配');
  if (parsed.sales_code !== salesCode) throw new Error('签约复用回执与当前 sales-code 不匹配');
  const validated = assertValidSignReuse({
    productType,
    salesCode,
    signStatus: parsed.sign_status,
    flow: parsed.flow
  });
  return {
    query_status: 'SUCCESS',
    source: 'AUTH_REUSE',
    sign_status: validated.signStatus,
    flow: validated.flow
  };
}

function parseArray(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function runScript(script, args) {
  return new Promise((resolve) => {
    const child = spawn('bash', [script, ...args], {
      cwd: onboardingScriptsDir,
      env: { ...process.env, ALIPAY_AIPAY_SUPPRESS_AUTH_LOGOUT: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => resolve({ status: null, stdout, stderr, spawnError: error }));
    child.on('close', (status) => resolve({ status, stdout, stderr, spawnError: null }));
  });
}

function failedBranch(result, extra = {}) {
  return {
    query_status: 'QUERY_FAILED',
    ...extra,
    customer_output: result.stdout.trim() ? true : false
  };
}

function signingBranch(result, productType) {
  const lines = internalLines(result.stderr);
  const signStatus = uniqueValue(lines, 'SIGN_STATUS=');
  const flow = uniqueFlow(lines, allowedSignFlowValues(productType));
  if (result.status !== 0 || !signStatuses.has(signStatus) || !flow) return failedBranch(result);
  try {
    const validated = assertValidSignReuse({
      productType,
      salesCode: productSalesCodes[productType],
      signStatus,
      flow
    });
    return { query_status: 'SUCCESS', source: 'QUERY', sign_status: validated.signStatus, flow: validated.flow };
  } catch {
    return failedBranch(result);
  }
}

function reusedSigningBranch(args, productType) {
  const salesCode = productSalesCodes[productType];
  const receipt = args['reuse-sign-receipt'];
  const signStatus = args['reuse-sign-status'];
  const flow = args['reuse-sign-flow'];
  if (receipt === undefined && signStatus === undefined && flow === undefined) return null;
  if (receipt !== undefined) {
    const fromReceipt = parseSignReuseReceipt(receipt, productType, salesCode);
    if (signStatus !== undefined || flow !== undefined) {
      if (signStatus === undefined || flow === undefined) {
        throw new Error('签约复用旧双参数必须同时提供 --reuse-sign-status 与 --reuse-sign-flow');
      }
      const fromLegacy = assertValidSignReuse({ productType, salesCode, signStatus, flow });
      if (fromLegacy.signStatus !== fromReceipt.sign_status || fromLegacy.flow !== fromReceipt.flow) {
        throw new Error('签约复用回执与旧双参数冲突，禁止降级复用');
      }
    }
    return fromReceipt;
  }
  if (signStatus === undefined || flow === undefined) {
    throw new Error('签约复用旧双参数必须同时提供 --reuse-sign-status 与 --reuse-sign-flow');
  }
  const validated = assertValidSignReuse({ productType, salesCode, signStatus, flow });
  return { query_status: 'SUCCESS', source: 'AUTH_REUSE', sign_status: validated.signStatus, flow: validated.flow };
}

function serviceBranch(result) {
  const lines = internalLines(result.stderr);
  const candidates = parseArray(uniqueValue(lines, 'SERVICE_CANDIDATES_JSON='));
  const flow = uniqueFlow(lines, serviceFlows);
  if (result.status !== 0 || !candidates || !flow) return failedBranch(result, { applicable: true });
  return { query_status: 'SUCCESS', applicable: true, flow, candidates };
}

function applicationBranch(result) {
  const lines = internalLines(result.stderr);
  const candidates = parseArray(uniqueValue(lines, 'APP_CANDIDATES_JSON='));
  const applicationType = uniqueValue(lines, 'APPLICATION_TYPE=');
  const flow = uniqueFlow(lines, applicationFlows);
  if (result.status !== 0 || !candidates || !['WEBAPP', 'MOBILEAPP'].includes(applicationType) || !flow) {
    return failedBranch(result);
  }
  return { query_status: 'SUCCESS', application_type: applicationType, flow, candidates };
}

function authBlockerFlows(result) {
  return internalLines(result.stderr).filter((line) => [
    'AUTH_FLOW:AUTH_REQUIRED',
    'AUTH_FLOW:SCOPE_MISMATCH',
    'AUTH_FLOW:MCC_MISMATCH'
  ].includes(line));
}

function hasAuthBlocker(result) {
  return authBlockerFlows(result).length > 0;
}

function authRecoveryAction(results) {
  const flows = new Set(results.flatMap(authBlockerFlows));
  if (flows.has('AUTH_FLOW:SCOPE_MISMATCH') || flows.has('AUTH_FLOW:MCC_MISMATCH')) return 'MISMATCH';
  if (flows.has('AUTH_FLOW:AUTH_REQUIRED')) return 'INIT';
  return '';
}

function hasLocalFsRecovery(result) {
  return internalLines(result.stderr).includes('CLI_FLOW:RETRY_WITH_LOCAL_FS_PERMISSION');
}

function hasNetworkRecovery(result) {
  return internalLines(result.stderr).some((line) =>
    line.startsWith('NETWORK_RETRY_EXHAUSTED=') && line.endsWith(':RETRY_WITH_NETWORK'));
}

function emitEnvelope(envelope) {
  process.stderr.write(`${internalPrefix}DISCOVERY_RESULT=${JSON.stringify(envelope)}\n`);
}

async function runDiscovery(args) {
  const productType = required(args, 'product-type');
  if (!productSalesCodes[productType]) throw new Error('product-type 非法，仅支持 aipay、webpay、apppay');
  if (telemetryEnabled()) {
    const run = currentRunContext();
    if (!run?.run_id || run.terminal || run.product_type !== productType.toUpperCase()
      || !['onboarding_only', 'full_process'].includes(run.root_intent)) {
      throw new Error('discovery 必须在当前产品匹配的 active onboarding run 内执行');
    }
  }
  const salesCode = required(args, 'sales-code');
  if (salesCode !== productSalesCodes[productType]) throw new Error('sales-code 与 product-type 不匹配');
  const reusedSigning = reusedSigningBranch(args, productType);

  const signingPromise = reusedSigning
    ? Promise.resolve(null)
    : runScript(scriptPaths.signing, ['--sales-code', salesCode, '--product-type', productType]);
  const servicePromise = productType === 'aipay'
    ? runScript(scriptPaths.service, ['list'])
    : Promise.resolve(null);
  const applicationPromise = runScript(scriptPaths.application, [
    'list', '--product-type', productType, '--sales-code', salesCode
  ]);
  const [signingResult, serviceResult, applicationResult] = await Promise.all([
    signingPromise,
    servicePromise,
    applicationPromise
  ]);

  const executedResults = [signingResult, serviceResult, applicationResult].filter(Boolean);
  const recoveryAction = authRecoveryAction(executedResults);
  const globalBlocker = recoveryAction ? 'AUTHORIZATION_INVALID' : '';
  const retryWithLocalFs = !globalBlocker && executedResults.some(hasLocalFsRecovery);
  const retryWithNetwork = !globalBlocker && !retryWithLocalFs && executedResults.some(hasNetworkRecovery);
  const envelope = {
    schema_ver: 1,
    product_type: productType,
    signing: reusedSigning || signingBranch(signingResult, productType),
    service: productType === 'aipay'
      ? serviceBranch(serviceResult)
      : { query_status: 'NOT_APPLICABLE', applicable: false },
    application: applicationBranch(applicationResult)
  };
  if (envelope.signing.query_status === 'SUCCESS'
    && (envelope.signing.sign_status === 'SIGNED_EFFECTIVE' || envelope.signing.sign_status === 'SIGN_SUBMITTED')) {
    emitStageMetric('onboarding.confirm_signing');
  }
  if (globalBlocker) {
    envelope.global_blocker = globalBlocker;
    envelope.auth_recovery_action = recoveryAction;
  }
  emitEnvelope(envelope);
  if (retryWithLocalFs) {
    process.stderr.write(`${internalPrefix}DISCOVERY_FLOW:RETRY_WITH_LOCAL_FS_PERMISSION\n`);
  } else if (retryWithNetwork) {
    process.stderr.write(`${internalPrefix}DISCOVERY_FLOW:RETRY_WITH_NETWORK\n`);
  }

  const customerOutputResults = retryWithLocalFs
    ? []
    : globalBlocker
      ? executedResults.filter(hasAuthBlocker)
      : executedResults;
  const customerOutputs = customerOutputResults
    .map((result) => result.stdout.trim())
    .filter(Boolean);
  let uniqueCustomerOutputs = [...new Set(customerOutputs)];
  if (globalBlocker) uniqueCustomerOutputs = uniqueCustomerOutputs.slice(0, 1);
  if (!globalBlocker && !retryWithLocalFs) {
    uniqueCustomerOutputs.push(renderDiscoverySummary(productType, {
      signStatus: envelope.signing.query_status === 'SUCCESS' ? envelope.signing.sign_status : 'QUERY_FAILED',
      serviceFlow: envelope.service.query_status === 'SUCCESS' ? envelope.service.flow : 'QUERY_FAILED',
      appFlow: envelope.application.query_status === 'SUCCESS' ? envelope.application.flow : 'QUERY_FAILED'
    }));
  }
  if (uniqueCustomerOutputs.length > 0) process.stdout.write(`${uniqueCustomerOutputs.join('\n\n')}\n`);
  return globalBlocker || retryWithLocalFs || retryWithNetwork ? 2 : 0;
}

export async function runOnboardingDiscoveryCli(argv = process.argv) {
  const { command, args } = parseArgs(argv);
  if (command !== 'run') {
    throw new Error('用法: onboarding_discovery_runner.mjs run --product-type <aipay|webpay|apppay> --sales-code <code> [--reuse-sign-receipt <AUTH_SIGN_REUSE_RECEIPT> | --reuse-sign-status <status> --reuse-sign-flow <flow>]');
  }
  process.exitCode = await runDiscovery(args);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runOnboardingDiscoveryCli().catch((error) => {
    process.stderr.write(`${internalPrefix}DISCOVERY_RUNNER_ERROR=${String(error?.message || error).replace(/[\r\n]/gu, ' ')}\n`);
    process.exitCode = 1;
  });
}
