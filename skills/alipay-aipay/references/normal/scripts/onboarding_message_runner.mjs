#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { renderMessage } from './render_customer_message.mjs';

const productTypes = {
  aipay: { variant: 'AIPAY', productName: '按量付费' },
  webpay: { variant: 'WEBPAY', productName: '网站支付' },
  apppay: { variant: 'APPPAY', productName: 'APP 支付' }
};

const signingStatusMap = {
  NOT_SIGNED: '未签约',
  SIGN_SUBMITTED: '已提交待生效',
  SIGNED_EFFECTIVE: '已生效',
  OTHER_STATUS: '其他状态待核验',
  QUERY_FAILED: '查询失败',
  FAILED: '查询失败',
  ERROR: '查询失败'
};

const serviceFlowMap = {
  'FLOW:CREATE_NEW': '无已有服务',
  'FLOW:SELECT': '已有服务候选',
  QUERY_FAILED: '查询失败',
  'FLOW:ERROR': '查询失败',
  ERROR: '查询失败'
};

const applicationFlowMap = {
  'FLOW:CREATE_NEW': '无同类型应用',
  'FLOW:SELECT': '有上线应用可复用',
  'FLOW:PENDING_APPLICATIONS': '仅有未上线应用',
  QUERY_FAILED: '查询失败',
  'FLOW:ERROR': '查询失败',
  ERROR: '查询失败'
};

const categoryNames = {
  signing: '签约材料',
  service: '服务资料',
  application: '应用资料'
};

const materialStates = {
  INITIAL: { variant: 'INITIAL', currentStatus: '待补充' },
  PARTIAL: { variant: 'PARTIAL', currentStatus: '部分已提供，待补充' },
  INVALID: { variant: 'INVALID', currentStatus: '校验失败，需更正' },
  APP_MOBILE_INITIAL: { variant: 'APP_MOBILE_INITIAL', currentStatus: '待补充' }
};

const directFieldAliases = new Map([
  ['APP名称', ['APP名称']],
  ['appName', ['APP名称']],
  ['首页截图', ['首页截图']],
  ['商品页截图', ['商品页截图']],
  ['支付页截图', ['支付页截图']],
  ['服务名称', ['服务名称']],
  ['serviceName', ['服务名称']],
  ['服务描述', ['服务描述']],
  ['serviceDesc', ['服务描述']],
  ['服务地址', ['服务地址']],
  ['resourceUrl', ['服务地址']],
  ['服务单价', ['服务单价']],
  ['pricing', ['服务单价']],
  ['请求示例JSON', ['请求示例JSON']],
  ['请求示例 JSON', ['请求示例JSON']],
  ['schemaUrl', ['请求示例JSON']],
  ['应用平台和对应资料', ['应用平台和对应资料']],
  ['mobilePlatform', ['应用平台和对应资料']],
  ['iOS Bundle ID（bundleId）', ['iOS Bundle ID（bundleId）']],
  ['iOS Bundle ID', ['iOS Bundle ID（bundleId）']],
  ['bundleId', ['iOS Bundle ID（bundleId）']],
  ['Android 应用包名（appPackage）', ['Android 应用包名（appPackage）']],
  ['Android 应用包名', ['Android 应用包名（appPackage）']],
  ['appPackage', ['Android 应用包名（appPackage）']],
  ['Android 应用签名摘要（appSign）', ['Android 应用签名摘要（appSign）']],
  ['Android 应用签名摘要', ['Android 应用签名摘要（appSign）']],
  ['appSign', ['Android 应用签名摘要（appSign）']],
  ['应用公钥', ['应用公钥']],
  ['publicKey', ['应用公钥']]
]);

function parseArgs(argv) {
  const command = argv[2];
  const args = {};
  for (let index = 3; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error(`未知参数 ${key}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`参数 ${key} 缺少取值`);
    args[key.slice(2)] = value;
    index += 1;
  }
  return { command, args };
}

function required(args, name) {
  const value = args[name];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`缺少参数 --${name}`);
  return value;
}

function productFor(args) {
  const productType = required(args, 'product-type');
  const mapping = productTypes[productType];
  if (!mapping) throw new Error('product-type 非法，仅支持 aipay、webpay、apppay');
  return mapping;
}

function normalizeEnum(value, map, label) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`缺少 ${label}`);
  const normalized = map[value];
  if (!normalized) throw new Error(`${label} 不在允许脚本标记中；允许值：${Object.keys(map).join('、')}`);
  return normalized;
}

async function readStdin() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  return input.trim() ? JSON.parse(input) : {};
}

async function runMccClarify(args) {
  const product = productFor(args);
  return renderMessage('onboarding.mcc.clarify', 'DEFAULT', {
    productName: product.productName
  });
}

async function runDiscoverySummary(args) {
  const product = productFor(args);
  const input = await readStdin();
  const variables = {
    signingStatus: normalizeEnum(input.signStatus, signingStatusMap, 'signStatus'),
    applicationStatus: normalizeEnum(input.appFlow, applicationFlowMap, 'appFlow')
  };
  if (product.variant === 'AIPAY') {
    variables.serviceStatus = normalizeEnum(input.serviceFlow, serviceFlowMap, 'serviceFlow');
  }
  return renderMessage('onboarding.discovery.summary', product.variant, variables);
}

function splitFieldInput(value) {
  if (Array.isArray(value)) return value.flatMap((item) => splitFieldInput(item));
  if (typeof value !== 'string') throw new Error('missingFields 必须是字符串或字符串数组');
  return value
    .split(/[、,，\n]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeMaterialField(category, raw) {
  if (directFieldAliases.has(raw)) return directFieldAliases.get(raw);
  if (category === 'signing' && /签约.*截图/.test(raw)) return ['首页截图', '商品页截图', '支付页截图'];
  if (/首页.*截图/.test(raw)) return ['首页截图'];
  if (/商品.*截图/.test(raw)) return ['商品页截图'];
  if (/支付.*截图/.test(raw)) return ['支付页截图'];
  if (category === 'signing' && /^(?:截图|三张截图|3张截图)$/.test(raw)) return ['首页截图', '商品页截图', '支付页截图'];
  if (/服务.*价格|服务.*单价/.test(raw)) return ['服务单价'];
  if (/请求.*示例.*JSON/i.test(raw)) return ['请求示例JSON'];
  if (/iOS.*Bundle/i.test(raw)) return ['iOS Bundle ID（bundleId）'];
  if (/Android.*包名/i.test(raw)) return ['Android 应用包名（appPackage）'];
  if (/Android.*签名/i.test(raw)) return ['Android 应用签名摘要（appSign）'];
  throw new Error(`材料字段不在允许范围：${raw}`);
}

function normalizeMissingFields(category, missingFields) {
  const normalized = [];
  for (const raw of splitFieldInput(missingFields)) {
    for (const field of normalizeMaterialField(category, raw)) {
      if (!normalized.includes(field)) normalized.push(field);
    }
  }
  if (normalized.length === 0) throw new Error('缺少 missingFields');
  return normalized.join('、');
}

async function runMaterialCollect(args) {
  const category = required(args, 'category');
  const categoryName = categoryNames[category];
  if (!categoryName) throw new Error('category 非法，仅支持 signing、service、application');

  const state = required(args, 'state').toUpperCase().replace(/-/g, '_');
  const stateRule = materialStates[state];
  if (!stateRule) throw new Error('state 非法，仅支持 INITIAL、PARTIAL、INVALID、APP_MOBILE_INITIAL');

  if (state === 'APP_MOBILE_INITIAL') {
    if (category !== 'application') throw new Error('APP_MOBILE_INITIAL 只适用于 application 类别');
    return renderMessage('materials.category.collect', stateRule.variant, {
      categoryName: '应用资料',
      currentStatus: stateRule.currentStatus,
      missingFields: '应用平台和对应资料'
    });
  }

  const input = await readStdin();
  return renderMessage('materials.category.collect', stateRule.variant, {
    categoryName,
    currentStatus: stateRule.currentStatus,
    missingFields: normalizeMissingFields(category, input.missingFields)
  });
}

function normalizeCloseoutInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('closeout 输入必须是 JSON 对象');
  }
  const variables = { ...input };
  if (variables.applicationOperation !== undefined) {
    const operation = variables.applicationOperation;
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
      throw new Error('applicationOperation 必须是 JSON 对象');
    }
    const allowedOperationKeys = new Set(['appId', 'actualStatus', 'nextAction']);
    for (const key of Object.keys(operation)) {
      if (!allowedOperationKeys.has(key)) throw new Error(`applicationOperation 包含未知字段 ${key}`);
    }
    variables.applicationOperationAppId = operation.appId;
    variables.applicationOperationActualStatus = operation.actualStatus;
    variables.applicationOperationNextAction = operation.nextAction;
    delete variables.applicationOperation;
  }
  for (const key of [
    'sandboxConfigState',
    'manualVerificationItems',
    'applicationOperationAppId',
    'applicationOperationActualStatus',
    'applicationOperationNextAction'
  ]) {
    if (variables[key] === '') delete variables[key];
  }
  return variables;
}

async function runCloseout() {
  return renderMessage('process.partial_result', 'DEFAULT', normalizeCloseoutInput(await readStdin()));
}

async function main() {
  const { command, args } = parseArgs(process.argv);
  if (command === 'mcc-clarify') {
    console.log(await runMccClarify(args));
    return;
  }
  if (command === 'discovery-summary') {
    console.log(await runDiscoverySummary(args));
    return;
  }
  if (command === 'material-collect') {
    console.log(await runMaterialCollect(args));
    return;
  }
  if (command === 'closeout') {
    console.log(await runCloseout());
    return;
  }
  throw new Error('用法: onboarding_message_runner.mjs <mcc-clarify|discovery-summary|material-collect|closeout> ...');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`ONBOARDING_MESSAGE_ERROR:${error.message}`);
    process.exitCode = 1;
  });
}
