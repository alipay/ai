#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const normalDir = path.resolve(scriptDir, '..');
const catalogPath = path.join(normalDir, 'customer-messages.json');
const policyPath = path.join(normalDir, 'policy-rules.json');
const mccReferencePath = path.join(normalDir, '../onboarding/modules/mcc-reference.md');
const sensitiveNamePattern = /(private.?key|public.?key|token|password|payment.?proof|signature|authorization|full.?response)/i;
const sensitiveValuePattern = /-----BEGIN (?:RSA )?(?:PRIVATE|PUBLIC) KEY-----|Payment-Proof:\s*\S+|Authorization:\s*Bearer\s+\S+|["'](?:password|passwd|secret|api[_-]?key|access[_-]?token)["']\s*:/i;
const placeholderPattern = /\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g;
const allowedVariableTypes = new Set([
  'command', 'enum', 'enumList', 'existingPath', 'mccCode', 'officialTemporaryUrl', 'path',
  'runtimeUrl', 'sandboxCredential', 'sandboxTableRows', 'singleLine', 'string'
]);

function allowedVariableNames(definitions) {
  return [...definitions.values()]
    .filter((definition) => !definition.derived)
    .map((definition) => definition.name)
    .join('、') || '无';
}

function cloneInputVariable(definition) {
  const cloned = {
    name: definition.name,
    type: definition.type,
    required: Boolean(definition.required)
  };
  if (Array.isArray(definition.values)) cloned.values = [...definition.values];
  if (definition.urlKind) cloned.urlKind = definition.urlKind;
  if (definition.derived) cloned.derived = true;
  return cloned;
}

function setVariableRule(variables, name, updates) {
  const variable = variables.find((entry) => entry.name === name);
  if (!variable) return;
  Object.assign(variable, updates);
  if (updates.values) variable.values = [...updates.values];
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadMccRecords() {
  const records = new Map();
  let primaryCode = '';
  for (const line of fs.readFileSync(mccReferencePath, 'utf8').split(/\r?\n/)) {
    const heading = line.match(/一级类目 code:\s*\*\*(A\d{4})\*\*/);
    if (heading) {
      primaryCode = heading[1];
      continue;
    }
    if (!primaryCode || !/^\|.*\|$/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 4 || !/^B\d{4}$/.test(cells[1])) continue;
    records.set(`${primaryCode}_${cells[1]}`, { name: cells[0], qualification: cells[3] });
  }
  return records;
}

function authorizationProduct(policy, predicate) {
  const products = policy.authorizationProducts || [];
  return products.find(predicate);
}

function validateUrl(value, policy, urlKind, expected = {}) {
  if (/[\u0000-\u0020\u007f`()\[\]<>|]/.test(value)) {
    throw new Error('officialTemporaryUrl 包含不允许的 Markdown 边界');
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('officialTemporaryUrl 不是合法 URL');
  }
  const allowed = policy.temporaryUrlAllowlist[urlKind];
  if (!allowed || parsed.protocol !== 'https:' || parsed.hostname !== allowed.host || parsed.pathname !== allowed.path || parsed.username || parsed.password || parsed.port || parsed.hash) {
    throw new Error(`officialTemporaryUrl 不符合 ${urlKind} allowlist`);
  }
  if (urlKind === 'authorization') {
    const required = allowed.requiredQueryParams || ['deviceCode', 'productCode', 'mccCode'];
    const optional = allowed.optionalQueryParams || [];
    const allowedKeys = new Set([...required, ...optional]);
    const actualKeys = [...parsed.searchParams.keys()];
    if (actualKeys.some((key) => !allowedKeys.has(key))) throw new Error('authorization URL 包含未允许的查询参数');
    for (const key of required) {
      if (parsed.searchParams.getAll(key).length !== 1 || !parsed.searchParams.get(key)) {
        throw new Error('authorization URL 缺少必要查询参数或参数重复');
      }
    }
    for (const key of optional) {
      if (parsed.searchParams.getAll(key).length > 1) throw new Error('authorization URL 可选参数重复');
    }
    const productCode = parsed.searchParams.get('productCode');
    if (!authorizationProduct(policy, (product) => product.salesCode === productCode)) {
      throw new Error('authorization URL productCode 不是受支持产品');
    }
    if (!/^A\d{4}_B\d{4}$/.test(parsed.searchParams.get('mccCode'))) {
      throw new Error('authorization URL mccCode 格式无效');
    }
    for (const [key, expectedValue] of Object.entries(expected)) {
      if (expectedValue !== undefined && parsed.searchParams.get(key) !== expectedValue) {
        throw new Error(`authorization URL ${key} 与当前授权上下文不一致`);
      }
    }
  }
  if (urlKind === 'publicKeyConfirmation') {
    const required = allowed.requiredQueryParams || ['keyConfirmToken'];
    const optional = allowed.optionalQueryParams || [];
    const allowedKeys = new Set([...required, ...optional]);
    const actualKeys = [...parsed.searchParams.keys()];
    if (actualKeys.some((key) => !allowedKeys.has(key))) throw new Error('publicKeyConfirmation URL 包含未允许的查询参数');
    for (const key of required) {
      if (parsed.searchParams.getAll(key).length !== 1 || !parsed.searchParams.get(key)) {
        throw new Error('publicKeyConfirmation URL 缺少必要查询参数或参数重复');
      }
    }
    for (const key of optional) {
      if (parsed.searchParams.getAll(key).length > 1) throw new Error('publicKeyConfirmation URL 可选参数重复');
    }
    if (/[\r\n]/.test(parsed.searchParams.get('keyConfirmToken'))) throw new Error('publicKeyConfirmation URL keyConfirmToken 无效');
  }
  return parsed;
}

export function validateAuthorizationContext(input) {
  const policy = loadJson(policyPath);
  const required = ['productName', 'salesCode', 'scope', 'mccCode', 'mccName'];
  for (const key of required) {
    if (typeof input[key] !== 'string' || !input[key]) throw new Error(`授权上下文缺少 ${key}`);
  }
  const product = authorizationProduct(policy, (entry) => entry.salesCode === input.salesCode);
  if (!product || product.productName !== input.productName || product.scope !== input.scope) {
    throw new Error('产品名称、salesCode 和 scope 不属于同一固定产品映射');
  }
  const record = loadMccRecords().get(input.mccCode);
  if (!record || record.name !== input.mccName) throw new Error('MCC 名称和编码不匹配当前参考表');
  if (input.deviceCode !== undefined && (typeof input.deviceCode !== 'string' || !input.deviceCode || /[\r\n]/.test(input.deviceCode))) {
    throw new Error('本次授权 deviceCode 无效');
  }
  if (input.officialUrl !== undefined) {
    if (typeof input.deviceCode !== 'string' || !input.deviceCode || /[\r\n]/.test(input.deviceCode)) {
      throw new Error('本次授权 deviceCode 无效');
    }
    if (typeof input.officialUrl !== 'string' || !input.officialUrl) throw new Error('缺少本次授权 URL');
    validateUrl(input.officialUrl, policy, 'authorization', {
      deviceCode: input.deviceCode,
      productCode: input.salesCode,
      mccCode: input.mccCode,
      ...(input.platform ? { platform: input.platform } : {})
    });
  }
  return { product, record };
}

export function buildAuthorizationUrl(input) {
  validateAuthorizationContext(input);
  if (typeof input.deviceCode !== 'string' || !input.deviceCode || /[\r\n]/.test(input.deviceCode)) {
    throw new Error('本次授权 deviceCode 无效');
  }
  if (input.platform !== undefined && (typeof input.platform !== 'string' || /[\r\n]/.test(input.platform))) {
    throw new Error('授权 platform 无效');
  }
  const url = new URL('https://aipay.alipay.com/cli-auth');
  url.searchParams.set('deviceCode', input.deviceCode);
  url.searchParams.set('productCode', input.salesCode);
  url.searchParams.set('mccCode', input.mccCode);
  if (input.platform && input.platform !== 'unknown') url.searchParams.set('platform', input.platform);
  const value = url.toString();
  validateAuthorizationContext({ ...input, officialUrl: value });
  return value;
}

function validateValue(definition, value, policy) {
  if (value === undefined || value === null || value === '') {
    if (definition.required) throw new Error(`缺少必填变量 ${definition.name}`);
    return '不在本轮范围';
  }
  if (typeof value !== 'string') throw new Error(`变量 ${definition.name} 必须是字符串`);
  if (value.includes('{{') || value.includes('}}') || /<INTERNAL_/i.test(value)) {
    throw new Error(`变量 ${definition.name} 包含禁止内容`);
  }
  if (definition.type !== 'sandboxCredential' && sensitiveValuePattern.test(value)) {
    throw new Error(`变量 ${definition.name} 包含可复用敏感内容`);
  }
  switch (definition.type) {
    case 'enum':
      if (!definition.values.includes(value)) {
        throw new Error(`变量 ${definition.name} 不在允许枚举中；允许值：${definition.values.join('、')}`);
      }
      break;
    case 'enumList': {
      const items = value.split('、');
      if (items.some((item) => !item || !definition.values.includes(item)) || new Set(items).size !== items.length) {
        throw new Error(`变量 ${definition.name} 包含未允许或重复的列表项；允许值：${definition.values.join('、')}`);
      }
      break;
    }
    case 'mccCode':
      if (!/^A\d{4}_B\d{4}$/.test(value)) throw new Error(`变量 ${definition.name} 不是合法 MCC 编码`);
      break;
    case 'officialTemporaryUrl':
      validateUrl(value, policy, definition.urlKind);
      break;
    case 'runtimeUrl': {
      if (value.length > 4096 || /[\u0000-\u0020\u007f`()\[\]<>|]/.test(value)) {
        throw new Error(`变量 ${definition.name} 必须是不含空白、控制字符或 Markdown 边界的 URL`);
      }
      let parsed;
      try { parsed = new URL(value); } catch { throw new Error(`变量 ${definition.name} 不是合法 URL`); }
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`变量 ${definition.name} 只允许 HTTP(S) URL`);
      if (parsed.username || parsed.password) throw new Error(`变量 ${definition.name} 禁止 URL 用户信息`);
      break;
    }
    case 'sandboxCredential':
      if (value.length > 256 || /[\r\n]/.test(value)) throw new Error(`变量 ${definition.name} 不是合法沙箱凭据`);
      break;
    case 'sandboxTableRows':
      if (value.length > 4096 || !value.split('\n').every((line) => /^\| [^|]+ \| [^|]+ \|$/.test(line))) {
        throw new Error(`变量 ${definition.name} 不是合法沙箱摘要行`);
      }
      break;
    case 'existingPath':
      if (value.length > 4096 || /[\u0000-\u001f\u007f`|]/.test(value) || !path.isAbsolute(value) || !fs.existsSync(value)) {
        throw new Error(`变量 ${definition.name} 必须是安全且实际存在的绝对路径`);
      }
      break;
    case 'path':
      if (value.length > 4096 || /[\u0000-\u001f\u007f`|]/.test(value) || !path.isAbsolute(value)) {
        throw new Error(`变量 ${definition.name} 必须是安全绝对路径`);
      }
      break;
    case 'singleLine':
      if (value.length > 1000 || /[\u0000-\u001f\u007f|`]/.test(value) || /https?:\/\//i.test(value)) {
        throw new Error(`变量 ${definition.name} 必须是不含控制字符、Markdown 代码边界或 URL 的安全单行文本`);
      }
      break;
    case 'command':
      if (value.length > 2000 || /[\u0000-\u001f\u007f`]/.test(value)) {
        throw new Error(`变量 ${definition.name} 必须是安全单行命令`);
      }
      break;
    case 'string':
      if (value.length > 12000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
        throw new Error(`变量 ${definition.name} 包含不允许的控制字符或内容过长`);
      }
      break;
    default:
      throw new Error(`变量 ${definition.name} 使用未知类型 ${definition.type}`);
  }
  return value;
}

function hasValue(variables, name) {
  return typeof variables[name] === 'string' && variables[name].length > 0;
}

function normalizeServicePricing(value) {
  if (/[\r\n\t]/.test(value)) {
    throw new Error('服务单价与 service.sh 校验规则不一致；请使用数字金额，模板会追加“元/次”单位');
  }
  const match = value.match(/^ *([0-9]+(?:\.[0-9]+)?) *(?:元\/次)? *$/u);
  if (!match || Number(match[1]) < 0.01) {
    throw new Error('服务单价与 service.sh 校验规则不一致；请使用数字金额，模板会追加“元/次”单位');
  }
  return match[1];
}

function validateServicePayload(variables, normalized) {
  normalized.servicePricing = normalizeServicePricing(variables.servicePricing);
  let schema;
  try { schema = JSON.parse(variables.serviceSchema); } catch { throw new Error('服务请求示例不是合法 JSON'); }
  normalized.serviceSchema = JSON.stringify(schema);
  if (normalized.serviceSchema.includes('```')) throw new Error('服务请求示例包含 Markdown 代码围栏');
}

function validateServiceCreateSummary(variantName, variables, normalized) {
  if (variantName !== 'DEFAULT') throw new Error(`service.create.summary 不支持 variant ${variantName}`);
  for (const name of ['serviceName', 'serviceDescription', 'serviceUrl', 'servicePricing', 'serviceSchema']) {
    if (!hasValue(variables, name)) throw new Error(`服务创建摘要缺少 ${name}`);
  }
  validateServicePayload(variables, normalized);
}

function validateIntegrationStart(variantName, variables) {
  const expectedProducts = { AIPAY: '按量付费', WEBPAY: '网站支付', APPPAY: 'APP 支付' };
  if (expectedProducts[variantName] !== variables.productName) {
    throw new Error('integration.start.confirm variant 与产品不匹配');
  }
  if (variables.nextFlow !== 'integration') {
    throw new Error('integration.start.confirm 只能进入支付产品-代码开发');
  }
}

function validateWriteConfirmation(variantName, variables, normalized) {
  const common = ['sessionSummary', 'subjectSummary', 'productName', 'actionTypes'];
  const service = ['serviceId', 'serviceName', 'serviceDescription', 'serviceUrl', 'servicePricing', 'serviceSchema'];
  const definitions = {
    SERVICE_UPDATE_ONLY: { actions: '服务修改', product: '按量付费', required: ['serviceId', 'serviceName', 'serviceDescription', 'serviceUrl', 'servicePricing', 'serviceSchema'], allowed: [...common, ...service] }
  };
  const rule = definitions[variantName];
  if (!rule) throw new Error(`onboarding.write.confirm 不支持 variant ${variantName}`);
  if (variables.actionTypes !== rule.actions) throw new Error('写确认 variant 与 actionTypes 不匹配');
  if (rule.product && variables.productName !== rule.product) throw new Error('服务写确认只适用于按量付费');
  for (const name of rule.required) {
    if (!hasValue(variables, name)) throw new Error(`写确认缺少 ${name}`);
  }
  const allowed = new Set(rule.allowed);
  for (const [name, value] of Object.entries(variables)) {
    if (value !== undefined && value !== null && value !== '' && !allowed.has(name)) {
      throw new Error(`写确认包含当前动作不适用的变量 ${name}`);
    }
  }

  validateServicePayload(variables, normalized);
}

function productionSpecificLines(productName) {
  if (productName === '按量付费') {
    return [
      '3. 按量付费 `serviceId`：把沙箱 `api_mock_service_id` 替换为真实 `serviceId`，`serviceId` 获取方式是：登录支付宝 AI 付站点（https://aipay.alipay.com/?from=alipay-aipay-skill） → 控制台 → 服务管理 → 复制审核已通过的目标服务 ID。',
      '4. 按量付费商户标识：`seller_id`/`seller_unique_id` 填收款商户 PID/2088，PID 获取方式是：登录支付宝商家平台（https://b.alipay.com/page/portal/home） → 点击头像 → 复制账户名下方 2088 开头的商家 ID；`seller_app_id` 填生产 `appId`。',
      '5. 按量付费验收：A2M 不使用 `notify_url`；上线前用生产应用私钥重新签名 402 账单，并验证 `Payment-Proof`、金额/订单/资源一致、`trade_no` 防重复履约和 `alipay.aipay.agent.fulfillment.confirm` 异步回执。'
    ];
  }
  if (productName === 'APP 支付') {
    return [
      '3. APP 支付 `notify_url`：生成生产 `orderStr` 时传入商家已部署的公网 HTTPS `notify_url`；未传不会触发异步通知。',
      '4. APP 支付验收：`notify_url` 完成验签，校验 `app_id`/`out_trade_no`/`total_amount`/`trade_status`，幂等处理并返回 `success`；支付结果以异步通知或 `alipay.trade.query` 补偿查询为准。客户端 SDK 使用服务端 `orderStr` 调起支付，客户端结果只做展示，不能作为付款成功依据。'
    ];
  }
  return [
    '3. 网站支付 `notify_url`：生产下单时传入商家已部署的公网 HTTPS `notify_url`；该地址是商家后端通知地址，不是支付宝生成的 URL。',
    '4. 网站支付验收：`notify_url` 完成验签，校验 `app_id`/`out_trade_no`/`total_amount`/`trade_status`，幂等处理并返回 `success`；支付结果以异步通知或 `alipay.trade.query` 补偿查询为准，同步回跳或前台页面不能作为付款成功依据。'
  ];
}

function productionConfigSourceLines() {
  return [
    '1. 确认上线条件：前往支付宝 AI 付站点（https://aipay.alipay.com/?from=alipay-aipay-skill）查看产品开通情况。如本次流程新建应用，进入一站式接入 → 选择产品 → 密钥配置，确认应用“已上线”。',
    '2. 替换到项目：把生产环境的应用配置写入业务系统生产环境变量、受保护配置文件或密钥管理系统，确保 `appId`、应用公钥、应用私钥、支付宝公钥同属一套生产应用并修改生产网关为 `https://openapi.alipay.com/gateway.do`。'
  ];
}

function productionReadinessBlock(productName, context) {
  const statusLines = [];
  if (!context.productBranchesComplete) {
    statusLines.push('- 还不能正式收款，产品签约、服务市场或应用发布仍有上表待办。');
  }
  if (context.integrationResult === '不在本轮执行范围') {
    statusLines.push('- 本轮只完成产品开通流程收口，不代表业务系统已经具备收款代码；先完成支付产品-代码开发、项目部署和生产参数验收。');
  } else if (context.integrationResult === '部分完成，沙箱配置待完成') {
    statusLines.push('- 代码开发仍有沙箱配置缺口；可继续产品开通流程，但不能进入真实生产收款。');
  } else if (context.integrationResult === '部分完成，人工待验证') {
    statusLines.push('- 代码开发还有人工待验证项；完成后才能判断是否可进入真实生产上线。');
  }
  if (statusLines.length > 0) {
    return [
      '【当前状态】',
      ...statusLines,
      '',
      '【上线前有以下关键点】',
      ...productionConfigSourceLines(),
      ...productionSpecificLines(productName),
      '',
      '【提示】',
      '- 如找不到配置替换位置，可以试试对 Agent 说：“我要上线了，帮我找一下项目里支付宝生产配置应该改哪些地方”。让 Agent 定位文件/变量名，但不要把生产应用私钥、账号密码、支付凭证或未脱敏通知内容直接发给 Agent。',
      '',
      '【其他】',
      '- 生产首单、退款或对账验收由商家在生产环境自行安排。'
    ].join('\n');
  }
  return [
    '【当前状态】',
    '- 代码开发和产品开通流程已完成，但当前 Agent 没有替你切生产配置，也不会默认发起真实生产交易。',
    '',
    '【上线前有以下关键点】',
    ...productionConfigSourceLines(),
    ...productionSpecificLines(productName),
    '',
    '【提示】',
    '- 如找不到配置替换位置，可以试试对 Agent 说：“我要上线了，帮我找一下项目里支付宝生产配置应该改哪些地方”。让 Agent 定位文件/变量名，但不要把生产应用私钥、账号密码、支付凭证或未脱敏通知内容直接发给 Agent。',
    '',
    '【其他】',
    '- 生产首单、退款或对账验收由商家在生产环境自行安排。'
  ].join('\n');
}

function normalizeProcessPartialResultSpacing(rendered) {
  const lines = [];
  let previousBlank = false;
  for (const rawLine of rendered.split('\n')) {
    const line = rawLine.trimEnd();
    const blank = line === '';
    if (blank && previousBlank) continue;
    lines.push(line);
    previousBlank = blank;
  }
  return lines.join('\n').trimEnd();
}

function validateVariantInputShape(messageId, variantName, variables) {
  if (messageId === 'onboarding.discovery.summary') {
    if (variantName === 'AIPAY') {
      if (!hasValue(variables, 'serviceStatus')) {
        throw new Error('onboarding.discovery.summary/AIPAY 缺少 serviceStatus 字段；允许变量：signingStatus、serviceStatus、applicationStatus');
      }
      return;
    }
    if (Object.prototype.hasOwnProperty.call(variables, 'serviceStatus')) {
      throw new Error(`onboarding.discovery.summary/${variantName} 禁止传入 serviceStatus 字段；网站支付和 APP 支付的服务市场由模板固定为“无需处理”，请从 JSON 删除 serviceStatus 字段；允许变量：signingStatus、applicationStatus`);
    }
  }
}

const managedEntrypoints = {
  'integration.start.confirm': {
    command: 'node ../normal/scripts/integration_message_runner.mjs start-confirm --product-type <aipay|webpay|apppay> --project-path <absPath> --project-selection <CURRENT_PROJECT|OTHER_PROJECT|PREPARED_NEW_PROJECT> --language <language> --framework <framework>',
    reason: '代码开发启动确认必须绑定同一次 project_route_inspector.sh scan 的项目来源、代码状态和其他支付产品，禁止手写项目扫描事实。'
  },
  'integration.checklist.result': {
    command: 'node ../normal/scripts/integration_message_runner.mjs checklist-result --variant <AIPAY|WEBPAY|APPPAY>',
    reason: '最终 checklist 结论必须由 runner 统一接收最终证据并调用 renderer，同一次代码开发只输出一次。'
  },
  'integration.project_candidates.select': {
    command: 'node ../normal/scripts/integration_message_runner.mjs locate-projects --base-path <absDir> --search-input <current|relativeSubdir|absDir> --format message',
    reason: '项目候选目录必须由 runner 轻量定位项目标记后统一输出，禁止手写候选列表或扫描整个大目录。'
  },
  'onboarding.mcc.clarify': {
    command: 'node ../normal/scripts/onboarding_message_runner.mjs mcc-clarify --product-type <aipay|webpay|apppay>',
    reason: '产品已明确但 MCC/经营类目不明确时由 runner 绑定产品名称，禁止手写经营类目补问。'
  },
  'onboarding.discovery.summary': {
    command: 'node ../normal/scripts/onboarding_message_runner.mjs discovery-summary --product-type <aipay|webpay|apppay>',
    reason: '运行时只传脚本原始 signStatus/serviceFlow/appFlow，由 runner 映射枚举并处理网站支付/APP 支付禁用 serviceStatus 的变体规则。'
  },
  'materials.category.collect': {
    command: 'node ../normal/scripts/onboarding_message_runner.mjs material-collect --category <signing|service|application> --state <INITIAL|PARTIAL|INVALID|APP_MOBILE_INITIAL>',
    reason: '运行时禁止手写 categoryName/currentStatus/missingFields；runner 会归一化“签约资料”“网站支付签约截图”“mobilePlatform”等常见别名后再调用 renderer。'
  },
  'process.partial_result': {
    command: 'node ../normal/scripts/onboarding_message_runner.mjs closeout',
    reason: '产品开通 Step 6 最终收口必须由 runner 统一合并代码开发状态、产品开通分支状态和最近应用分支结果，避免 Agent 手写或重复输出下一步。'
  },
  'auth.page': {
    command: 'bash modules/scripts/auth.sh init --scope <scope> --sales-code <code> --mcc-code <code> --product-name <name> --mcc-name <name>',
    reason: '授权页必须由 auth.sh 绑定本次 CLI deviceCode、固定产品/MCC 上下文、URL 白名单和受控 opener。',
    allowedCallers: ['auth.sh']
  },
  'auth.pending': {
    command: 'bash modules/scripts/auth.sh confirm [--scope <scope> --sales-code <code> --mcc-code <code> --product-name <name> --mcc-name <name>]',
    reason: '授权待完成状态只能来自本轮 auth.sh confirm 对 CLI 授权状态的实际查询。',
    allowedCallers: ['auth.sh']
  },
  'auth.expired': {
    command: 'bash modules/scripts/auth.sh confirm [--scope <scope> --sales-code <code> --mcc-code <code> --product-name <name> --mcc-name <name>]',
    reason: '授权过期状态只能来自本轮 auth.sh confirm 对 CLI 授权状态的实际查询。',
    allowedCallers: ['auth.sh']
  },
  'auth.mismatch': {
    command: 'bash modules/scripts/auth.sh mismatch [--scope <scope> --sales-code <code> --mcc-code <code> --product-name <name> --mcc-name <name>]',
    reason: 'scope 或 MCC 不匹配必须由 auth.sh 执行 logout 与重新授权链路，不能只输出提示。',
    allowedCallers: ['auth.sh']
  },
  'application.key.page': {
    command: 'bash modules/scripts/app.sh key <appId> <publicKey>',
    reason: '公钥确认页必须由 app.sh 调用 createKeyConfirmPage 后校验官方 URL 并受控打开。',
    allowedCallers: ['app.sh']
  },
  'key_tool.download.result': {
    command: 'bash modules/scripts/download_key_tool.sh [downloadDir]',
    reason: '密钥工具下载成功消息必须来自下载脚本的实际下载路径、跳转校验和安装包校验结果。',
    allowedCallers: ['download_key_tool.sh']
  },
  'key_tool.download.fallback': {
    command: 'bash modules/scripts/download_key_tool.sh [downloadDir]',
    reason: '密钥工具下载失败或不支持时必须由下载脚本统一给出官方手动下载兜底。',
    allowedCallers: ['download_key_tool.sh']
  }
};

function publicManagedEntrypoint(messageId) {
  const managed = managedEntrypoints[messageId];
  if (!managed) return null;
  return { command: managed.command, reason: managed.reason };
}

function addManagedEntrypointHint(messageId, error) {
  const managed = managedEntrypoints[messageId];
  if (!managed) return error;
  return new Error(`${error.message}；该消息运行时应使用托管入口：${managed.command}；${managed.reason}`);
}

function assertManagedCliAllowed(messageId) {
  const managed = managedEntrypoints[messageId];
  if (!managed) return;
  const caller = process.env.ALIPAY_AIPAY_RENDERER_MANAGED_CALLER || '';
  if (managed.allowedCallers?.includes(caller)) return;
  throw new Error(`${messageId} 由托管入口输出，禁止直接调用 renderer；请使用托管入口：${managed.command}；${managed.reason}`);
}

export function getMessageSchema(messageId, variantName = 'DEFAULT') {
  const catalog = loadJson(catalogPath);
  const message = catalog.messages.find((entry) => entry.messageId === messageId);
  if (!message) throw new Error(`未知 messageId ${messageId}`);
  if (message.owner !== 'catalog_owned') throw new Error(`${messageId} 由脚本直接输出，没有 renderer 输入 schema`);
  const acceptsRuntimeChecklistVariant =
    messageId === 'integration.checklist.result' &&
    ['AIPAY', 'WEBPAY', 'APPPAY'].includes(variantName);
  if (!acceptsRuntimeChecklistVariant && !message.variants?.[variantName]) {
    throw new Error(`${messageId} 不支持 variant ${variantName}`);
  }

  let inputVariables = (message.variables || [])
    .filter((definition) => !definition.derived)
    .map(cloneInputVariable);
  const variantRules = [];

  if (messageId === 'onboarding.discovery.summary') {
    if (variantName === 'AIPAY') {
      setVariableRule(inputVariables, 'serviceStatus', { required: true });
      variantRules.push('AIPAY 必须传入 serviceStatus。');
    } else if (['WEBPAY', 'APPPAY'].includes(variantName)) {
      inputVariables = inputVariables.filter((variable) => variable.name !== 'serviceStatus');
      variantRules.push('WEBPAY/APPPAY 禁止传入 serviceStatus；服务市场由模板固定为“无需处理”。');
    }
  }

  if (messageId === 'materials.category.collect') {
    const expectedStatus = {
      INITIAL: '待补充',
      APP_MOBILE_INITIAL: '待补充',
      PARTIAL: '部分已提供，待补充',
      INVALID: '校验失败，需更正'
    }[variantName];
    if (!expectedStatus) throw new Error(`${messageId} 不支持 variant ${variantName}`);
    setVariableRule(inputVariables, 'currentStatus', { values: [expectedStatus] });
    variantRules.push(`${variantName} 的 currentStatus 固定为“${expectedStatus}”。`);
    if (variantName === 'APP_MOBILE_INITIAL') {
      setVariableRule(inputVariables, 'categoryName', { values: ['应用资料'] });
      setVariableRule(inputVariables, 'missingFields', { values: ['应用平台和对应资料'] });
      variantRules.push('APP_MOBILE_INITIAL 只允许 categoryName=应用资料 且 missingFields=应用平台和对应资料。');
    } else {
      const missingFields = inputVariables.find((variable) => variable.name === 'missingFields');
      if (missingFields?.values) {
        missingFields.values = missingFields.values.filter((value) => value !== '应用平台和对应资料');
      }
      variantRules.push('应用平台首次收集必须使用 APP_MOBILE_INITIAL，不得在其他变体传入“应用平台和对应资料”。');
    }
  }

  if (messageId === 'service.create.summary' || messageId === 'onboarding.write.confirm') {
    setVariableRule(inputVariables, 'servicePricing', {
      format: '纯数字金额，例如 0.08；模板负责追加“元/次”，不要传入单位。'
    });
  }

  if (messageId === 'onboarding.write.confirm' && variantName === 'SERVICE_UPDATE_ONLY') {
    for (const requiredName of ['serviceId', 'serviceName', 'serviceDescription', 'serviceUrl', 'servicePricing', 'serviceSchema']) {
      setVariableRule(inputVariables, requiredName, { required: true });
    }
    setVariableRule(inputVariables, 'productName', { values: ['按量付费'] });
    setVariableRule(inputVariables, 'actionTypes', { values: ['服务修改'] });
    variantRules.push('SERVICE_UPDATE_ONLY 只用于按量付费服务修改；签约提交、服务创建、应用创建和应用提审不得进入该确认消息。');
  }

  return {
    schemaVersion: 1,
    messageId,
    variant: variantName,
    owner: message.owner,
    blocking: Boolean(message.blocking),
    replyMode: message.replyMode || 'exact',
    allowedReplies: message.allowedReplies || [],
    inputHintType: message.inputHintType || null,
    managedEntrypoint: publicManagedEntrypoint(messageId),
    inputVariables,
    variantRules
  };
}

export function validateCatalog() {
  const catalog = loadJson(catalogPath);
  const policy = loadJson(policyPath);
  const errors = [];
  const messages = new Map();
  const policyIds = new Set(policy.rules.map((rule) => rule.policyId));
  const officialUrls = new Set(Object.values(policy.officialUrls));

  const inputHints = catalog.interactionPrompts || {};
  if (typeof inputHints.confirmInputHint !== 'string' || !inputHints.confirmInputHint) {
    errors.push('缺少统一确认输入提示');
  }
  if (typeof inputHints.authorizationCompletionInputHint !== 'string' || !inputHints.authorizationCompletionInputHint) {
    errors.push('缺少统一授权完成输入提示');
  }
  if (typeof inputHints.publicKeyConfirmationCompletionInputHint !== 'string' || !inputHints.publicKeyConfirmationCompletionInputHint) {
    errors.push('缺少统一应用公钥确认完成输入提示');
  }
  if (typeof inputHints.completionInputHint !== 'string' || !inputHints.completionInputHint) {
    errors.push('缺少统一完成输入提示');
  }

  const productNames = new Set();
  const salesCodes = new Set();
  for (const product of policy.authorizationProducts || []) {
    if (!product.productName || !product.salesCode || !product.scope) errors.push('authorizationProducts 存在不完整映射');
    if (productNames.has(product.productName)) errors.push(`authorizationProducts 重复 productName: ${product.productName}`);
    if (salesCodes.has(product.salesCode)) errors.push(`authorizationProducts 重复 salesCode: ${product.salesCode}`);
    productNames.add(product.productName);
    salesCodes.add(product.salesCode);
  }

  for (const message of catalog.messages) {
    if (messages.has(message.messageId)) errors.push(`重复 messageId: ${message.messageId}`);
    messages.set(message.messageId, message);
    if (!['catalog_owned', 'script_owned'].includes(message.owner)) errors.push(`${message.messageId}: owner 无效`);
    if (message.blocking && JSON.stringify(message.allowedReplies) === '["1"]' && !['confirm', 'authorizationComplete', 'publicKeyConfirmationComplete', 'complete'].includes(message.inputHintType)) {
      errors.push(`${message.messageId}: 单一确认消息必须声明合法 inputHintType`);
    }
    for (const id of message.requiredPolicyIds || []) {
      if (!policyIds.has(id)) errors.push(`${message.messageId}: 未知 policyId ${id}`);
    }
    const variableNames = new Set((message.variables || []).map((variable) => variable.name));
    for (const variable of message.variables || []) {
      if (!allowedVariableTypes.has(variable.type)) errors.push(`${message.messageId}: 未知变量类型 ${variable.type}`);
      if (variable.derived && variable.required) errors.push(`${message.messageId}: 派生变量不得声明为必填输入`);
      if (variable.derived && (!Array.isArray(variable.values) || variable.values.length !== 1)) {
        errors.push(`${message.messageId}: 派生变量必须声明唯一目录值`);
      }
      if (sensitiveNamePattern.test(variable.name) && !['officialTemporaryUrl', 'sandboxCredential'].includes(variable.type)) {
        errors.push(`${message.messageId}: 禁止的敏感变量名 ${variable.name}`);
      }
    }
    if (message.replyMode && !['exact', 'freeform', 'runtime_enum'].includes(message.replyMode)) errors.push(`${message.messageId}: replyMode 无效`);
    if (message.owner === 'script_owned') {
      if (!message.scriptSource || !message.snapshotId || message.variants) {
        errors.push(`${message.messageId}: script_owned 必须只有 scriptSource/snapshotId`);
      }
      continue;
    }
    if (!message.variants || Object.keys(message.variants).length === 0) {
      errors.push(`${message.messageId}: catalog_owned 缺少 variants`);
      continue;
    }
    for (const [variantName, variant] of Object.entries(message.variants)) {
      if (!Array.isArray(variant.templateLines)) errors.push(`${message.messageId}/${variantName}: templateLines 必须是数组`);
      const template = (variant.templateLines || []).join('\n');
      for (const match of template.matchAll(placeholderPattern)) {
        if (!variableNames.has(match[1])) errors.push(`${message.messageId}/${variantName}: 未声明变量 ${match[1]}`);
      }
      for (const match of template.matchAll(/https:\/\/[^\s)`），。；：]+/g)) {
        if (!officialUrls.has(match[0])) errors.push(`${message.messageId}/${variantName}: 静态 URL 未登记 ${match[0]}`);
      }
      if (/<INTERNAL_/i.test(template)) errors.push(`${message.messageId}/${variantName}: 模板包含内部标签`);
      if (message.blocking && JSON.stringify(message.allowedReplies) === '["1"]' && /(?:回复|输入)\s*`?1`?/.test(template)) {
        errors.push(`${message.messageId}/${variantName}: 单一确认输入提示必须由 renderer 统一追加`);
      }
    }
  }

  for (const message of catalog.messages) {
    if (message.fallbackMessageId && !messages.has(message.fallbackMessageId)) {
      errors.push(`${message.messageId}: fallback 不存在 ${message.fallbackMessageId}`);
    }
    const seen = new Set([message.messageId]);
    let current = message;
    while (current?.fallbackMessageId) {
      if (seen.has(current.fallbackMessageId)) {
        errors.push(`${message.messageId}: fallback 存在环`);
        break;
      }
      seen.add(current.fallbackMessageId);
      current = messages.get(current.fallbackMessageId);
    }
  }
  return errors;
}

export function renderMessage(messageId, variantName, variables) {
  const catalog = loadJson(catalogPath);
  const policy = loadJson(policyPath);
  const message = catalog.messages.find((entry) => entry.messageId === messageId);
  if (!message) throw new Error(`未知 messageId ${messageId}`);
  if (message.owner !== 'catalog_owned') throw new Error(`${messageId} 由脚本直接输出，禁止 renderer 复制`);
  const catalogVariantName = messageId === 'integration.checklist.result'
    ? `${variantName}_${variables.overallResult === '通过' ? 'PASSED' : 'INCOMPLETE'}`
    : variantName;
  const variant = message.variants[catalogVariantName];
  if (!variant) throw new Error(`${messageId} 不支持 variant ${variantName}`);
  const definitions = new Map(message.variables.map((definition) => [definition.name, definition]));
  const normalized = {};
  try {
    for (const key of Object.keys(variables)) {
      if (!definitions.has(key)) throw new Error(`出现未声明变量 ${key}；允许变量：${allowedVariableNames(definitions)}`);
      if (definitions.get(key).derived) throw new Error(`派生变量 ${key} 只能由 renderer 生成`);
    }
    validateVariantInputShape(messageId, variantName, variables);
    for (const definition of message.variables) {
      normalized[definition.name] = definition.derived ? '' : validateValue(definition, variables[definition.name], policy);
    }
  } catch (error) {
    throw addManagedEntrypointHint(messageId, error);
  }
  const hasMccInput =
    variables.mccCode !== undefined ||
    variables.mccName !== undefined ||
    variables.mccQualification !== undefined;
  if (hasMccInput) {
    if (!definitions.has('mccCode') || !definitions.has('mccName')) throw new Error(`${messageId} 的 MCC 变量声明不完整`);
    const record = loadMccRecords().get(variables.mccCode);
    if (!record || record.name !== variables.mccName) throw new Error('MCC 名称和编码不匹配当前参考表');
    normalized.mccName = record.name;
    normalized.mccCode = variables.mccCode;
    if (definitions.has('mccQualification') && variables.mccQualification !== undefined) {
      if (record.qualification !== variables.mccQualification) throw new Error('MCC 特殊资质不匹配当前参考表');
      normalized.mccQualification = record.qualification === '-' ? '当前类目参考表未列出' : record.qualification;
    }
  }
  if (messageId === 'auth.page') {
    const product = authorizationProduct(policy, (entry) => entry.productName === variables.productName);
    if (!product) throw new Error('授权消息产品不在固定映射中');
    validateAuthorizationContext({
      productName: variables.productName,
      salesCode: product.salesCode,
      scope: product.scope,
      mccCode: variables.mccCode,
      mccName: variables.mccName,
      deviceCode: variables.deviceCode,
      officialUrl: variables.officialUrl
    });
  }
  if (messageId === 'integration.start.confirm') {
    validateIntegrationStart(variantName, variables);
    normalized.integrationStatus = {
      TARGET_PARTIAL: '已发现目标产品相关代码，需要继续核验或补全',
      OTHER_PRODUCT_ONLY: '未发现目标产品代码，已检测到其他支付能力',
      NO_PAYMENT: '未发现支付代码'
    }[variables.integrationStatus];
  }
  if (messageId === 'integration.checklist.result') {
    const sandboxPending = variables.sandboxConfigState !== 'READY';
    const hasBlockingDefect = variables.blockingDefectState === 'PRESENT';
    if (variantName === 'AIPAY' && !variables.sandboxResult) throw new Error('按量付费 checklist 缺少沙箱联调结果');
    if (variantName !== 'AIPAY' && variables.sandboxResult) throw new Error('非按量付费 checklist 禁止传入按量付费沙箱结果');
    if (variantName === 'WEBPAY' && !variables.webpayExperienceResult) throw new Error('网站支付 checklist 缺少沙箱体验实际结果');
    if (variantName !== 'WEBPAY' && variables.webpayExperienceResult) throw new Error('非网站支付 checklist 禁止传入网站支付沙箱体验结果');
    const hasFailedItems = variables.failedItems !== '无';
    const hasManualItems = variables.manualItems !== '无';
    const manualOnly = !hasFailedItems && hasManualItems;
    const expectedReminder = variables.executionMode === '仅代码开发'
      ? '正式上线前还需完成支付产品-产品开通。'
      : sandboxPending && variables.overallResult === '部分通过' && !hasBlockingDefect
        ? '沙箱配置尚未完成，但不阻塞本轮继续支付产品-产品开通；完成配置后再进行沙箱测试。'
        : !sandboxPending && variables.overallResult === '部分通过' && !hasBlockingDefect && manualOnly
          ? '代码开发自动校验已完成，仍有人工待验证项；本轮继续产品开通。'
          : '代码开发校验通过后将自动进入支付产品-产品开通；未通过时停留在代码开发。';
    if (variables.nextFlowReminder !== expectedReminder) throw new Error('代码开发执行模式与后续衔接不一致');
    if (variables.overallResult === '通过' && (hasFailedItems || hasManualItems)) {
      throw new Error('代码开发结果为通过时不得存在未通过项或人工待验证项');
    }
    if (variables.overallResult === '部分通过' && !hasFailedItems && !hasManualItems) {
      throw new Error('代码开发结果为部分通过时必须存在未通过项或人工待验证项');
    }
    if (variables.overallResult === '未通过' && !hasFailedItems) {
      throw new Error('代码开发结果为未通过时必须列出未通过项');
    }
    if (variables.overallResult === '通过' && hasBlockingDefect) {
      throw new Error('代码开发通过时不得存在其他阻塞缺口');
    }
    if (variables.overallResult !== '通过' && !sandboxPending && !hasBlockingDefect && !manualOnly) {
      throw new Error('沙箱已就绪且没有阻塞缺口时，非通过结果只能来自人工待验证项');
    }
    if (variables.overallResult === '未通过' && !hasBlockingDefect) {
      throw new Error('代码开发未通过时必须登记其他阻塞缺口');
    }
    if (sandboxPending && variables.overallResult === '通过') {
      throw new Error('沙箱配置未完成时不得标记代码开发通过');
    }
    if (sandboxPending && !hasFailedItems) {
      throw new Error('沙箱配置未完成时必须列入未通过或部分通过项');
    }
    if (sandboxPending && variantName === 'AIPAY' && variables.sandboxResult !== '按量付费沙箱服务端联调未通过') {
      throw new Error('沙箱配置未完成时按量付费联调不得标记通过');
    }
    if (sandboxPending && variantName === 'WEBPAY' && variables.webpayExperienceResult !== '未提供浏览器付款入口或完整操作指引，需先补齐') {
      throw new Error('沙箱配置未完成时网站支付不得标记已交付付款体验');
    }
    if (variantName === 'AIPAY' && variables.overallResult === '通过' && variables.sandboxResult !== '按量付费沙箱服务端联调通过') {
      throw new Error('按量付费代码开发通过必须有沙箱服务端联调通过结论');
    }
    if (variantName === 'WEBPAY' && variables.overallResult === '通过' && variables.webpayExperienceResult === '未提供浏览器付款入口或完整操作指引，需先补齐') {
      throw new Error('网站支付未交付付款入口时不得标记代码开发通过');
    }
  }
  if (messageId === 'materials.category.collect') {
    const expectedStatus = {
      INITIAL: '待补充',
      APP_MOBILE_INITIAL: '待补充',
      PARTIAL: '部分已提供，待补充',
      INVALID: '校验失败，需更正'
    }[variantName];
    if (!expectedStatus || variables.currentStatus !== expectedStatus) {
      throw new Error('materials.category.collect variant 与材料状态不匹配');
    }
    const isMobileInitial = variantName === 'APP_MOBILE_INITIAL';
    if (isMobileInitial && (variables.categoryName !== '应用资料' || variables.missingFields !== '应用平台和对应资料')) {
      throw new Error('APP_MOBILE_INITIAL 只允许收集应用平台和对应资料');
    }
    if (!isMobileInitial && variables.missingFields.split('、').includes('应用平台和对应资料')) {
      throw new Error('应用平台首次收集必须使用 APP_MOBILE_INITIAL');
    }
    normalized.paymentPageHint = variables.missingFields.split('、').includes('支付页截图')
      ? definitions.get('paymentPageHint')?.values?.[0] || ''
      : '';
  }
  if (messageId === 'process.partial_result') {
    const statusQueryHintDefinition = definitions.get('statusQueryHint');
    const statusQueryHint = statusQueryHintDefinition?.values?.[0];
    if (!statusQueryHintDefinition?.derived || !statusQueryHint) {
      throw new Error('process.partial_result 缺少受控状态查询提示');
    }
    normalized.statusQueryHint =
      variables.signingResult === '已提交，等待生效' && variables.applicationResult === '已提交审核，等待上线'
        ? statusQueryHint
        : '';
    const onboardingOnly = variables.integrationResult === '不在本轮执行范围';
    const onboardingReminder = '还需完成支付产品-代码开发，才能在业务系统中实际发起支付。';
    if (onboardingOnly !== (variables.nextFlowReminder === onboardingReminder)) {
      throw new Error('process.partial_result 的代码开发结果与后续衔接不一致');
    }
    normalized.nextFlowReminderLine = onboardingOnly ? `后续衔接：${normalized.nextFlowReminder}` : '';
    const hasManualVerificationItems =
      typeof variables.manualVerificationItems === 'string' &&
      variables.manualVerificationItems !== '' &&
      variables.manualVerificationItems !== '无';
    const applicationOperationFields = [
      'applicationOperationAppId',
      'applicationOperationActualStatus',
      'applicationOperationNextAction'
    ];
    const providedApplicationOperationFields = applicationOperationFields.filter((name) =>
      typeof variables[name] === 'string' && variables[name] !== ''
    );
    if (providedApplicationOperationFields.length !== 0 && providedApplicationOperationFields.length !== applicationOperationFields.length) {
      throw new Error('应用分支操作结果必须同时传入 appId、实际状态和下一步');
    }
    if (providedApplicationOperationFields.length === applicationOperationFields.length) {
      if (onboardingOnly) {
        throw new Error('onboarding_only 不合并应用操作结果；请按应用模块原规则输出');
      }
      if (variables.applicationOperationActualStatus !== variables.applicationResult) {
        throw new Error('应用分支操作实际状态与应用发布结果不一致');
      }
      if (variables.applicationResult === '已上线且配置完整') {
        normalized.applicationOperationBlock = '';
      } else if ([
        '已创建，待设置公钥',
        '公钥待确认',
        '已提交审核，等待上线',
        '需人工配置',
        '失败',
        '结果未知'
      ].includes(variables.applicationResult)) {
        normalized.applicationOperationBlock = [
          '应用分支结果：',
          `- 应用 \`${normalized.applicationOperationAppId}\` 的实际状态：${normalized.applicationOperationActualStatus}。`,
          `- 应用分支下一步：${normalized.applicationOperationNextAction}`,
          '- 待审核、待设置公钥或待人工配置时不会表述为应用发布完成。'
        ].join('\n');
      } else {
        throw new Error('当前应用分支结果不允许合并应用操作结果');
      }
    } else {
      normalized.applicationOperationBlock = '';
    }
    if (onboardingOnly) {
      if (variables.sandboxConfigState !== undefined) throw new Error('onboarding_only 禁止传入代码开发沙箱状态');
      if (hasManualVerificationItems) throw new Error('onboarding_only 禁止传入代码开发人工待验证项');
      normalized.manualVerificationLine = '';
      normalized.sandboxRecoveryHint = '';
    } else if (variables.integrationResult === '已完成') {
      if (variables.sandboxConfigState !== 'READY') throw new Error('完整代码开发结果必须绑定 READY 沙箱状态');
      if (hasManualVerificationItems) throw new Error('代码开发已完成时禁止传入人工待验证项');
      normalized.manualVerificationLine = '';
      normalized.sandboxRecoveryHint = '';
    } else if (variables.integrationResult === '部分完成，沙箱配置待完成') {
      if (hasManualVerificationItems) throw new Error('沙箱待配置结果不通过人工待验证项表达');
      normalized.sandboxRecoveryHint = {
        CREATE_PENDING: '沙箱配置待完成：请对 Agent 说：“重新创建并配置沙箱”。',
        VERIFY_PENDING: '沙箱配置待完成：请对 Agent 说：“重新创建并配置沙箱”。'
      }[variables.sandboxConfigState];
      if (!normalized.sandboxRecoveryHint) throw new Error('沙箱待配置结果必须绑定 CREATE_PENDING 或 VERIFY_PENDING');
      if (variables.remainingActions === '无') throw new Error('沙箱待配置时必须保留剩余待办');
      normalized.manualVerificationLine = '';
    } else if (variables.integrationResult === '部分完成，人工待验证') {
      if (variables.sandboxConfigState !== 'READY') throw new Error('人工待验证结果必须绑定 READY 沙箱状态');
      if (!hasManualVerificationItems) throw new Error('人工待验证结果必须列出人工待验证项');
      normalized.manualVerificationLine = `人工待验证：${normalized.manualVerificationItems}`;
      normalized.sandboxRecoveryHint = '';
    } else {
      throw new Error('full_process 进入产品开通收口时只允许已完成、沙箱待配置或人工待验证');
    }
    if (variables.productName === '按量付费' && variables.serviceResult === '无需处理') {
      throw new Error('按量付费产品开通不能把服务市场标记为无需处理');
    }
    if (variables.productName !== '按量付费' && variables.serviceResult !== '无需处理') {
      throw new Error('网站支付或 APP 支付的服务市场结果必须为无需处理');
    }
    const expectedServiceComplete = variables.productName === '按量付费'
      ? ['已复用', '创建成功，状态未取得', '修改成功，状态未取得', '已完成'].includes(variables.serviceResult)
      : variables.serviceResult === '无需处理';
    const productBranchesComplete =
      variables.signingResult === '已生效' &&
      expectedServiceComplete &&
      variables.applicationResult === '已上线且配置完整';
    const branchesComplete =
      productBranchesComplete &&
      variables.remainingActions === '无' &&
      !hasManualVerificationItems;
    normalized.productionReadinessBlock = productionReadinessBlock(variables.productName, {
      productBranchesComplete,
      integrationResult: variables.integrationResult
    });
    const declaresComplete = variables.processResultTitle === '支付产品-产品开通已完成';
    if (branchesComplete !== declaresComplete) {
      throw new Error('process.partial_result 的总结果与分支完成条件不一致');
    }
    if (!branchesComplete && variables.remainingActions === '无') {
      throw new Error('process.partial_result 存在未完成分支时必须列出剩余待办');
    }
  }
  if (messageId === 'service.create.summary') validateServiceCreateSummary(variantName, variables, normalized);
  if (messageId === 'onboarding.write.confirm') validateWriteConfirmation(variantName, variables, normalized);
  let rendered = variant.templateLines.join('\n').replace(placeholderPattern, (_, name) => normalized[name]);
  if (messageId === 'process.partial_result') {
    rendered = normalizeProcessPartialResultSpacing(rendered);
  }
  if (message.blocking && JSON.stringify(message.allowedReplies) === '["1"]') {
    const hintKeys = {
      confirm: 'confirmInputHint',
      authorizationComplete: 'authorizationCompletionInputHint',
      publicKeyConfirmationComplete: 'publicKeyConfirmationCompletionInputHint',
      complete: 'completionInputHint'
    };
    const hintKey = hintKeys[message.inputHintType] || '';
    if (!hintKey) throw new Error(`${messageId} 缺少合法 inputHintType`);
    const hint = catalog.interactionPrompts?.[hintKey];
    if (!hint) throw new Error(`缺少 ${hintKey}`);
    rendered = `${rendered}\n\n${hint}`;
  }
  return rendered;
}

export function renderMessageWithFallback(messageId, variantName, variables) {
  const catalog = loadJson(catalogPath);
  const messages = new Map(catalog.messages.map((entry) => [entry.messageId, entry]));
  let currentId = messageId;
  let currentVariant = variantName;
  let isFallback = false;
  const visited = new Set();
  let lastError;
  while (currentId) {
    if (visited.has(currentId)) throw new Error(`fallback 存在环: ${currentId}`);
    visited.add(currentId);
    try {
      const message = messages.get(currentId);
      if (!message) throw new Error(`未知 messageId ${currentId}`);
      const allowed = new Set((message.variables || []).map((definition) => definition.name));
      const scopedVariables = isFallback
        ? Object.fromEntries(Object.entries(variables).filter(([key]) => allowed.has(key)))
        : variables;
      return renderMessage(currentId, currentVariant, scopedVariables);
    } catch (error) {
      lastError = error;
      const fallbackId = messages.get(currentId)?.fallbackMessageId;
      if (!fallbackId) throw lastError;
      currentId = fallbackId;
      currentVariant = 'DEFAULT';
      isFallback = true;
    }
  }
  throw lastError || new Error('消息无法渲染且没有可执行 fallback');
}

async function readStdin() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  return input.trim() ? JSON.parse(input) : {};
}

async function main() {
  if (process.argv.includes('--check-catalog')) {
    const errors = validateCatalog();
    if (errors.length) throw new Error(errors.join('\n'));
    console.log('customer message catalog: OK');
    return;
  }
  if (process.argv.includes('--validate-authorization-context')) {
    validateAuthorizationContext(await readStdin());
    console.log('authorization context: OK');
    return;
  }
  if (process.argv.includes('--build-authorization-url')) {
    console.log(buildAuthorizationUrl(await readStdin()));
    return;
  }
  if (process.argv.includes('--schema')) {
    const schemaIndex = process.argv.indexOf('--schema');
    const messageId = process.argv[2] === '--schema' ? process.argv[schemaIndex + 1] : process.argv[2];
    const variantIndex = process.argv.indexOf('--variant');
    const variant = variantIndex >= 0 ? process.argv[variantIndex + 1] : 'DEFAULT';
    if (!messageId || messageId.startsWith('--')) throw new Error('用法: render_customer_message.mjs --schema <messageId> [--variant NAME]');
    console.log(JSON.stringify(getMessageSchema(messageId, variant), null, 2));
    return;
  }
  const messageId = process.argv[2];
  const variantIndex = process.argv.indexOf('--variant');
  const variant = variantIndex >= 0 ? process.argv[variantIndex + 1] : 'DEFAULT';
  if (!messageId) throw new Error('用法: render_customer_message.mjs <messageId> [--variant NAME]');
  assertManagedCliAllowed(messageId);
  const variables = await readStdin();
  console.log(renderMessageWithFallback(messageId, variant, variables));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('当前步骤的标准消息无法安全生成，已停止后续动作。请按 MESSAGE_RENDER_ERROR 的具体原因修正输入；若消息目录或脚本缺失，再检查 Skill 文件完整性。');
    console.error(`MESSAGE_RENDER_ERROR:${error.message}`);
    process.exitCode = 1;
  });
}
