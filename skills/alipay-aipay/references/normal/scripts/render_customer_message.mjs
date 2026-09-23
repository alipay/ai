#!/usr/bin/env node

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { currentRunContext, emitMessageMetric } from './telemetry.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const normalDir = path.resolve(scriptDir, '..');
const jsonDir = path.join(normalDir, 'json');
const catalogPath = path.join(jsonDir, 'customer-messages.json');
const policyPath = path.join(jsonDir, 'policy-rules.json');
const sensitiveNamePattern = /(private.?key|public.?key|token|password|payment.?proof|signature|authorization|full.?response)/i;
const sensitiveValuePattern = /-----BEGIN (?:RSA )?(?:PRIVATE|PUBLIC) KEY-----|Payment-Proof:\s*\S+|Authorization:\s*Bearer\s+\S+|["'](?:password|passwd|secret|api[_-]?key|access[_-]?token)["']\s*:/i;
const placeholderPattern = /\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g;
const allowedVariableTypes = new Set([
  'applicationCandidates',
  'command', 'customerErrorDetails', 'customerErrorText', 'enum', 'enumList', 'existingPath', 'mccCode', 'officialTemporaryUrl', 'path',
  'runtimeUrl', 'sandboxCredential', 'sandboxTableRows', 'serviceCandidates', 'mccCandidates', 'singleLine', 'string'
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

function keyToolManualUrl(policy) {
  const value = policy.officialUrls?.keyToolManual;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('policy-rules.json 缺少合法 officialUrls.keyToolManual');
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'opendocs.alipay.com'
      || parsed.pathname !== '/isv/02kipk' || parsed.search || parsed.hash
      || parsed.username || parsed.password || parsed.port) {
    throw new Error('policy-rules.json officialUrls.keyToolManual 不符合固定官方地址约束');
  }
  return value;
}

function derivedCatalogText(definitions, name) {
  const definition = definitions.get(name);
  const values = definition?.values;
  if (!definition?.derived || definition.type !== 'string'
      || !Array.isArray(values) || values.length !== 1
      || typeof values[0] !== 'string' || !values[0]) {
    throw new Error(`消息目录缺少合法派生文案 ${name}`);
  }
  return values[0];
}

function allowedRepliesFor(catalog, message) {
  if (!message.allowedReplySet) return message.allowedReplies || [];
  const replies = catalog.interactionReplySets?.[message.allowedReplySet];
  if (!Array.isArray(replies) || replies.length === 0 || replies.some((reply) => typeof reply !== 'string' || !reply)) {
    throw new Error(`${message.messageId}: allowedReplySet 无效`);
  }
  return replies;
}

function safeMccDisplayText(value, fieldName) {
  const normalized = typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim()
    : value;
  if (typeof normalized !== 'string' || normalized.length === 0
      || /[|`]/u.test(normalized) || /https?:\/\//iu.test(normalized)
      || normalized.includes('{{') || normalized.includes('}}') || /<INTERNAL_/iu.test(normalized)
      || sensitiveValuePattern.test(normalized)) {
    throw new Error(`${fieldName} 不是安全的 MCC 展示文本`);
  }
  return normalized;
}

function normalizeQualificationGroups(groups, { allowEmpty = true } = {}) {
  if (groups === undefined || groups === null) return [];
  if (!Array.isArray(groups)) throw new Error('qualificationGroups 必须是数组');
  if (!allowEmpty && groups.length === 0) throw new Error('特殊资质类目缺少 qualificationGroups');
  return groups.map((group, groupIndex) => {
    if (!group || typeof group !== 'object' || Array.isArray(group)) {
      throw new Error(`qualificationGroups[${groupIndex}] 必须是对象`);
    }
    if (!Array.isArray(group.qualifications)) {
      throw new Error(`qualificationGroups[${groupIndex}].qualifications 必须是数组`);
    }
    return {
      qualifications: group.qualifications.map((qualification, qualificationIndex) => {
        if (!qualification || typeof qualification !== 'object' || Array.isArray(qualification)) {
          throw new Error(`qualificationGroups[${groupIndex}].qualifications[${qualificationIndex}] 必须是对象`);
        }
        const attaType = qualification.attaType === null || qualification.attaType === undefined || qualification.attaType === ''
          ? null
          : safeMccDisplayText(String(qualification.attaType), '资质材料类型');
        const qualName = safeMccDisplayText(String(qualification.qualName || ''), '资质名称');
        const normalized = { attaType, qualName };
        for (const [source, target] of [['qualId', 'qualId'], ['qualType', 'qualType'], ['status', 'status']]) {
          if (qualification[source] !== undefined && qualification[source] !== null && qualification[source] !== '') {
            normalized[target] = safeMccDisplayText(String(qualification[source]), `资质字段 ${source}`);
          }
        }
        return normalized;
      })
    };
  }).filter((group) => group.qualifications.length > 0);
}

function qualificationGroupSummary(group) {
  return group.qualifications
    .map((qualification) => qualification.attaType
      ? `${qualification.qualName}（需上传材料）`
      : `${qualification.qualName}（无需上传，按文字条件核验）`)
    .join(' + ');
}

export function mccQualificationSummary(input) {
  const needSpecialQual = input.needSpecialQual === true;
  const groups = normalizeQualificationGroups(input.qualificationGroups);
  if (!needSpecialQual && groups.length === 0) return '无需特殊资质';
  if (needSpecialQual && groups.length === 0) return '需要特殊资质，但当前查询未返回具体资质要求';
  return `可任选一种资质组合：${groups.map((group, index) => `${index + 1}. ${qualificationGroupSummary(group)}`).join('；')}`;
}

function normalizeMccContextPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('MCC 上下文回执载荷无效');
  const schema = payload.schema_ver;
  if (schema !== 1) throw new Error('MCC 上下文回执版本无效');
  const normalized = {
    schema_ver: 1,
    product_type: safeMccDisplayText(String(payload.product_type || ''), '产品类型'),
    sales_code: safeMccDisplayText(String(payload.sales_code || ''), '产品码'),
    mcc_code: safeMccDisplayText(String(payload.mcc_code || ''), 'MCC 编码'),
    mcc_name: safeMccDisplayText(String(payload.mcc_name || ''), 'MCC 名称'),
    need_special_qual: payload.need_special_qual === true,
    qualification_groups: normalizeQualificationGroups(payload.qualification_groups)
  };
  if (normalized.qualification_groups.some((group) => group.qualifications.length === 0)) {
    throw new Error('MCC 上下文回执包含空特殊资质组合');
  }
  if (normalized.need_special_qual !== (normalized.qualification_groups.length > 0)) {
    throw new Error('MCC 上下文回执特殊资质标记与资质组合不一致');
  }
  if (!['aipay', 'webpay', 'apppay'].includes(normalized.product_type)) throw new Error('MCC 上下文回执产品类型无效');
  const policy = loadJson(policyPath);
  const product = authorizationProduct(policy, (entry) => entry.salesCode === normalized.sales_code);
  if (!product) {
    throw new Error('MCC 上下文回执产品码无效');
  }
  if (productTypeForProductName(product.productName) !== normalized.product_type) {
    throw new Error('MCC 上下文回执产品类型和产品码不一致');
  }
  if (!/^A\d{4}_B\d{4}$/u.test(normalized.mcc_code)) throw new Error('MCC 上下文回执 MCC 编码无效');
  if (payload.mcc_description !== undefined && payload.mcc_description !== null && payload.mcc_description !== '') {
    normalized.mcc_description = safeMccDisplayText(String(payload.mcc_description), 'MCC 描述');
  }
  if (payload.run_id !== undefined && payload.run_id !== null && payload.run_id !== '') {
    const runId = String(payload.run_id);
    if (/[\u0000-\u001f\u007f,^=]/u.test(runId)) throw new Error('MCC 上下文回执 run_id 无效');
    normalized.run_id = runId;
  }
  return normalized;
}

export function createMccContextReceipt(input) {
  const payload = normalizeMccContextPayload(input);
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const digest = createHash('sha256').update(encoded).digest('base64url');
  return `AIPAY_MCC_CONTEXT_V1.${encoded}.${digest}`;
}

export function verifyMccContextReceipt(receipt) {
  if (typeof receipt !== 'string' || !receipt.startsWith('AIPAY_MCC_CONTEXT_V1.')) {
    throw new Error('MCC 上下文回执格式无效');
  }
  const parts = receipt.split('.');
  if (parts.length !== 3 || !parts[1] || !parts[2]) throw new Error('MCC 上下文回执格式无效');
  const digest = createHash('sha256').update(parts[1]).digest('base64url');
  if (digest !== parts[2]) throw new Error('MCC 上下文回执校验失败');
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new Error('MCC 上下文回执载荷不是合法 JSON');
  }
  return normalizeMccContextPayload(payload);
}

function activeMccRunId(env = process.env) {
  const explicit = env.ALIPAY_AIPAY_RUN_ID || env.ALIPAY_AIPAY_FLOW_RUN_ID || '';
  const candidate = explicit || currentRunContext(env)?.run_id || '';
  if (typeof candidate !== 'string' || !candidate || /[\u0000-\u001f\u007f,^=]/u.test(candidate)) return '';
  return candidate;
}

function normalizeExpectedMccRunId(value) {
  if (value === undefined || value === null || value === '') return '';
  const candidate = String(value);
  if (/[\u0000-\u001f\u007f,^=]/u.test(candidate)) throw new Error('MCC 上下文期望 run_id 无效');
  return candidate;
}

function expectedMccRunIdFromContext(context = {}) {
  return normalizeExpectedMccRunId(
    context.mccRunId
      || context.expectedMccRunId
      || context.mcc_run_id
      || context.expected_mcc_run_id
      || ''
  );
}

function assertCurrentMccRun(receiptPayload, env = process.env, expectedRunId = '') {
  const currentRunId = normalizeExpectedMccRunId(expectedRunId) || activeMccRunId(env);
  if (receiptPayload.run_id && receiptPayload.run_id !== currentRunId) {
    throw new Error('MCC 上下文回执不属于当前 run');
  }
}

function signingMccContext(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('签约 MCC 上下文必须是对象');
  const productType = String(input.productType || '');
  const salesCode = String(input.salesCode || '');
  const mccCode = String(input.mccCode || '');
  const receiptPayload = verifyMccContextReceipt(input.mccContextReceipt);
  assertCurrentMccRun(receiptPayload);
  const policy = loadJson(policyPath);
  const product = authorizationProduct(policy, (entry) => entry.salesCode === salesCode);
  if (!product || productTypeForProductName(product.productName) !== productType
      || receiptPayload.product_type !== productType
      || receiptPayload.sales_code !== salesCode
      || receiptPayload.mcc_code !== mccCode) {
    throw new Error('特殊资质上下文与当前产品或 MCC 不一致');
  }
  const groups = receiptPayload.qualification_groups;
  const requiresSpecialQualification = receiptPayload.need_special_qual === true || groups.length > 0;
  if (receiptPayload.need_special_qual === true && groups.length === 0) {
    throw new Error('当前 MCC 要求特殊资质，但查询结果没有可选择的资质组合');
  }
  const rawGroupIndex = input.qualificationGroupIndex;
  if (!requiresSpecialQualification) {
    if (rawGroupIndex !== undefined && rawGroupIndex !== null && rawGroupIndex !== '') {
      throw new Error('当前 MCC 无特殊资质时不得指定资质组合');
    }
    return { receiptPayload, expectedLicenseTypes: [] };
  }
  const groupIndex = Number(rawGroupIndex);
  if (!Number.isInteger(groupIndex) || groupIndex < 1 || groupIndex > groups.length) {
    throw new Error('特殊资质组合序号无效');
  }
  const expectedLicenseTypes = groups[groupIndex - 1].qualifications
    .filter((qualification) => qualification.attaType)
    .map((qualification) => qualification.attaType);
  return { receiptPayload, expectedLicenseTypes };
}

export function validateSpecialLicenseUploadRequest(input) {
  const expectedLicenseTypes = specialLicenseTypesForUploadRequest(input);
  if (!Array.isArray(input.licenseTypes)
      || input.licenseTypes.some((value) => typeof value !== 'string' || !value || /[\u0000-\u001f\u007f]/u.test(value))
      || JSON.stringify(input.licenseTypes) !== JSON.stringify(expectedLicenseTypes)) {
    throw new Error('待上传特殊资质类型与所选 MCC 资质组合不一致');
  }
  return true;
}

export function specialLicenseTypesForUploadRequest(input) {
  const { expectedLicenseTypes } = signingMccContext({
    ...input,
    salesCode: input?.salesCode || verifyMccContextReceipt(input?.mccContextReceipt).sales_code,
    mccCode: input?.mccCode || verifyMccContextReceipt(input?.mccContextReceipt).mcc_code
  });
  if (expectedLicenseTypes.length === 0) throw new Error('所选资质组合没有需要上传的材料');
  return expectedLicenseTypes;
}

export function validateSigningSpecialLicenseContext(input) {
  const { expectedLicenseTypes } = signingMccContext(input);
  if (!Array.isArray(input.specialLicense)) throw new Error('specialLicense 必须是数组');
  const normalized = input.specialLicense.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)
        || Object.keys(item).sort().join(',') !== 'licensePic,licenseType'
        || typeof item.licenseType !== 'string' || !item.licenseType
        || typeof item.licensePic !== 'string' || !item.licensePic
        || /[\u0000-\u001f\u007f]/u.test(item.licenseType)
        || /[\u0000-\u001f\u007f]/u.test(item.licensePic)) {
      throw new Error('specialLicense 项必须且只能包含安全的 licenseType 和 licensePic');
    }
    return { licenseType: item.licenseType, licensePic: item.licensePic };
  });
  if (JSON.stringify(normalized.map((item) => item.licenseType)) !== JSON.stringify(expectedLicenseTypes)) {
    throw new Error('specialLicense 与所选 MCC 资质组合不一致');
  }
  return true;
}

function authorizationProduct(policy, predicate) {
  const products = policy.authorizationProducts || [];
  return products.find(predicate);
}

function productTypeForProductName(productName) {
  return {
    'AI 按量付费': 'aipay',
    'AI 网页应用收款': 'webpay',
    'AI 移动应用收款': 'apppay'
  }[productName] || '';
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
  if (urlKind === 'windowsOnboardingRedirect') {
    const required = allowed.requiredQueryParams || ['from', 'reason', 'platform_id'];
    const allowedKeys = new Set(required);
    const actualKeys = [...parsed.searchParams.keys()];
    if (actualKeys.some((key) => !allowedKeys.has(key))) throw new Error('windowsOnboardingRedirect URL 包含未允许的查询参数');
    for (const key of required) {
      if (parsed.searchParams.getAll(key).length !== 1 || !parsed.searchParams.get(key)) {
        throw new Error('windowsOnboardingRedirect URL 缺少必要查询参数或参数重复');
      }
    }
    if (parsed.searchParams.get('from') !== 'alipay-aipay-skill') {
      throw new Error('windowsOnboardingRedirect URL from 无效');
    }
    if (parsed.searchParams.get('reason') !== 'alipay-aipay-skill-onboarding-not-support-windows') {
      throw new Error('windowsOnboardingRedirect URL reason 无效');
    }
    if (/[\u0000-\u001f\u007f,^=]/u.test(parsed.searchParams.get('platform_id'))) {
      throw new Error('windowsOnboardingRedirect URL platform_id 无效');
    }
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
  if (!/^A\d{4}_B\d{4}$/u.test(input.mccCode)) throw new Error('MCC 编码格式无效');
  safeMccDisplayText(input.mccName, 'MCC 名称');
  if (typeof input.mccContextReceipt !== 'string' || input.mccContextReceipt.length === 0) {
    throw new Error('MCC 授权上下文必须提供本轮 MCC_CONTEXT_RECEIPT');
  }
  const receipt = verifyMccContextReceipt(input.mccContextReceipt);
  assertCurrentMccRun(receipt);
  const expectedProductType = productTypeForProductName(product.productName);
  if (receipt.product_type !== expectedProductType
      || receipt.sales_code !== input.salesCode
      || receipt.mcc_code !== input.mccCode
      || receipt.mcc_name !== input.mccName) {
    throw new Error('MCC 上下文回执与授权参数不一致');
  }
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
  return { product, mccContext: receipt };
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

export function buildWindowsOnboardingRedirectUrl(platformId) {
  if (typeof platformId !== 'string' || !platformId || /[\u0000-\u001f\u007f,^=]/u.test(platformId)) {
    throw new Error('Windows 产品开通引导缺少合法的当前流程 run_id');
  }
  const url = new URL('https://aipay.alipay.com/');
  url.searchParams.set('from', 'alipay-aipay-skill');
  url.searchParams.set('reason', 'alipay-aipay-skill-onboarding-not-support-windows');
  url.searchParams.set('platform_id', platformId);
  const value = url.toString();
  validateUrl(value, loadJson(policyPath), 'windowsOnboardingRedirect');
  return value;
}

function validateValue(definition, value, policy) {
  if (value === undefined || value === null || value === '') {
    if (definition.required) throw new Error(`缺少必填变量 ${definition.name}`);
    if (definition.type === 'applicationCandidates' || definition.type === 'serviceCandidates' || definition.type === 'customerErrorDetails') return [];
    return '不在本轮范围';
  }
  if (definition.type === 'applicationCandidates' || definition.type === 'serviceCandidates' || definition.type === 'mccCandidates' || definition.type === 'customerErrorDetails') {
    if (!Array.isArray(value)) throw new Error(`变量 ${definition.name} 必须是候选数组`);
    if (definition.type === 'customerErrorDetails') {
      if (value.length > 100) throw new Error(`变量 ${definition.name} 错误详情数量超过安全上限`);
      return value.map((item) => {
        if (typeof item !== 'string' || !item || item.length > 1000 || /[\r\n]/.test(item)
            || item.includes('{{') || item.includes('}}') || /<INTERNAL_/i.test(item) || sensitiveValuePattern.test(item)) {
          throw new Error(`变量 ${definition.name} 包含不安全的错误详情`);
        }
        return escapeMarkdownText(item);
      });
    }
    return value;
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
      if ((definition.name !== 'mccQualification' && value.length > 1000)
          || /[\u0000-\u001f\u007f|`]/.test(value) || /https?:\/\//i.test(value)) {
        throw new Error(`变量 ${definition.name} 必须是不含控制字符、Markdown 代码边界或 URL 的安全单行文本`);
      }
      break;
    case 'command':
      if (value.length > 2000 || /[\u0000-\u001f\u007f`]/.test(value)) {
        throw new Error(`变量 ${definition.name} 必须是安全单行命令`);
      }
      break;
    case 'customerErrorText':
      if (value.length > 1000 || /[\r\n]/.test(value)) throw new Error(`变量 ${definition.name} 不是安全单行错误文本`);
      value = escapeMarkdownText(value);
      break;
    case 'string':
      if (definition.name === 'mccContextReceipt') {
        verifyMccContextReceipt(value);
        break;
      }
      if (value.length > 12000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
        throw new Error(`变量 ${definition.name} 包含不允许的控制字符或内容过长`);
      }
      break;
    default:
      throw new Error(`变量 ${definition.name} 使用未知类型 ${definition.type}`);
  }
  return value;
}

function escapeMarkdownText(value) {
  return value
    .replace(/([\\`\[\]<>])/g, '\\$1')
    .replace(/\|/g, '\\|');
}

function appKeySaveLine(appId, savePath) {
  if (typeof savePath !== 'string' || savePath === '') return '';
  if (savePath.length > 1000 || /[\u0000-\u001f\u007f`|]/u.test(savePath) || /https?:\/\//i.test(savePath)) {
    throw new Error('支付宝公钥保存路径必须是安全单行路径');
  }
  return `当前 appId: ${appId} 对应的支付宝公钥保存在:${savePath}`;
}

function candidateText(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (!['string', 'number', 'boolean'].includes(typeof value)) throw new Error('候选字段必须是可显示的标量');
  const text = String(value);
  if (text.length > 4096 || text.includes('{{') || text.includes('}}') || /<INTERNAL_/i.test(text) || sensitiveValuePattern.test(text)) {
    throw new Error('候选字段包含禁止内容或过长');
  }
  return escapeMarkdownText(text.replace(/[\u0000-\u001f\u007f]/g, ' '));
}

function validateCandidateKeys(candidate, allowedKeys) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('候选项必须是 JSON 对象');
  for (const key of Object.keys(candidate)) {
    if (!allowedKeys.has(key)) throw new Error(`候选项包含未知字段 ${key}`);
  }
}

function applicationCandidateTable(variantName, candidates) {
  const allowedKeys = new Set(['appId', 'appName', 'status']);
  for (const candidate of candidates) validateCandidateKeys(candidate, allowedKeys);
  const online = candidates.filter((candidate) => candidate.status === 'ON_LINE');
  const pending = candidates.filter((candidate) => candidate.status !== 'ON_LINE');
  if (variantName === 'EMPTY' && candidates.length !== 0) throw new Error('应用空列表消息与候选事实不一致');
  if (variantName === 'PENDING_ONLY' && (pending.length === 0 || online.length !== 0)) throw new Error('应用未上线列表消息与候选事实不一致');
  if (variantName === 'ONLINE_WITH_OPTIONAL_PENDING' && online.length === 0) throw new Error('应用上线列表消息缺少可复用候选');
  for (const candidate of online) {
    if (typeof candidate.appId !== 'string' || !candidate.appId || /[\u0000-\u001f\u007f]/.test(candidate.appId)) {
      throw new Error('可复用应用候选 appId 缺失或包含控制字符');
    }
  }
  if (variantName === 'EMPTY') return '';
  const table = (rows, onlineTable) => [
    onlineTable ? '| 应用ID | 应用名称 | 状态 |' : '| 应用ID | 应用名称 | 实际状态 |',
    onlineTable ? '|--------|----------|------|' : '|--------|----------|----------|',
    ...rows.map((candidate) => `| ${candidateText(candidate.appId, '未知')} | ${candidateText(candidate.appName, '未知')} | ${onlineTable ? '已上线' : candidateText(candidate.status, '未知')} |`)
  ];
  if (variantName === 'PENDING_ONLY') return table(pending, false).join('\n');
  const lines = table(online, true);
  if (pending.length > 0) {
    lines.push('', '另有以下尚未上线的同类型应用，当前不可复用：', '', ...table(pending, false), '', '新建前请结合以上状态避免重复创建。');
  }
  return lines.join('\n');
}

function serviceCandidateTable(variantName, candidates) {
  const allowedKeys = new Set(['serviceId', 'serviceName', 'serviceDesc', 'pricing', 'serviceStatus', 'status', 'resourceUrl']);
  for (const candidate of candidates) {
    validateCandidateKeys(candidate, allowedKeys);
    if (typeof candidate.serviceId !== 'string' || !candidate.serviceId || /[\u0000-\u001f\u007f]/.test(candidate.serviceId)) {
      throw new Error('服务候选 serviceId 缺失或包含控制字符');
    }
  }
  if (variantName === 'EMPTY' && candidates.length !== 0) throw new Error('服务空列表消息与候选事实不一致');
  if (variantName === 'DEFAULT' && candidates.length === 0) throw new Error('服务候选消息缺少候选事实');
  if (variantName === 'EMPTY') return '';
  const statusDisplay = (candidate) => {
    const status = candidate.serviceStatus ?? candidate.status ?? '未知';
    return { ACTIVE: '已上线', PENDING: '审核中', REJECTED: '审核拒绝' }[status] || candidateText(status, '未知');
  };
  const pricingDisplay = (candidate) => {
    if (candidate.pricing === undefined || candidate.pricing === null || candidate.pricing === '' || candidate.pricing === '未知') {
      return '未知';
    }
    return `${candidateText(candidate.pricing, '未知')}元/次`;
  };
  return [
    '| 服务ID | 服务名称 | 描述 | 价格 | 实际状态 | 服务地址 |',
    '|--------|----------|------|------|----------|----------|',
    ...candidates.map((candidate) => `| ${candidateText(candidate.serviceId, '未知')} | ${candidateText(candidate.serviceName, '未知')} | ${candidateText(candidate.serviceDesc, '无描述')} | ${pricingDisplay(candidate)} | ${statusDisplay(candidate)} | ${candidateText(candidate.resourceUrl, '未知')} |`)
  ].join('\n');
}

function normalizedProductType(value) {
  const raw = String(value || '').toLowerCase();
  return ['aipay', 'webpay', 'apppay'].includes(raw) ? raw : '';
}

function mccCandidateTable(variantName, candidates, expectedProductType = '') {
  const allowedKeys = new Set(['mccCode', 'mccName', 'applicableBusinesses', 'qualification', 'needSpecialQual', 'qualificationGroups', 'mccContextReceipt']);
  const productType = normalizedProductType(expectedProductType);
  for (const candidate of candidates) {
    validateCandidateKeys(candidate, allowedKeys);
    if (typeof candidate.mccCode !== 'string' || !/^A\d{4}_B\d{4}$/.test(candidate.mccCode)) {
      throw new Error('MCC 候选 mccCode 缺失或格式无效');
    }
    safeMccDisplayText(candidate.mccName, 'MCC 候选名称');
    safeMccDisplayText(candidate.applicableBusinesses, 'MCC 候选适用商家');
    safeMccDisplayText(candidate.qualification, 'MCC 候选特殊资质');
    normalizeQualificationGroups(candidate.qualificationGroups);
    if (typeof candidate.mccContextReceipt !== 'string' || candidate.mccContextReceipt.length === 0) {
      throw new Error('MCC 候选必须携带本轮上下文回执');
    }
    const receipt = verifyMccContextReceipt(candidate.mccContextReceipt);
    assertCurrentMccRun(receipt);
    const candidateGroups = normalizeQualificationGroups(candidate.qualificationGroups);
    const expectedQualification = mccQualificationSummary({
      needSpecialQual: receipt.need_special_qual,
      qualificationGroups: receipt.qualification_groups
    });
    if (receipt.mcc_code !== candidate.mccCode
        || receipt.mcc_name !== candidate.mccName
        || (receipt.mcc_description || '') !== candidate.applicableBusinesses) {
      throw new Error('MCC 候选上下文回执与候选不一致');
    }
    if ((productType && receipt.product_type !== productType)
        || JSON.stringify(candidateGroups) !== JSON.stringify(receipt.qualification_groups)
        || candidate.qualification !== expectedQualification) {
      throw new Error('MCC 候选产品或特殊资质与上下文回执不一致');
    }
  }
  if (variantName !== 'DEFAULT') throw new Error(`onboarding.mcc.candidates 不支持 variant ${variantName}`);
  if (candidates.length === 0 || candidates.length > 8) throw new Error('MCC 候选数量必须在 1 到 8 之间');
  return [
    '| 序号 | MCC 二级类目 | 适用商家 | 特殊资质 |',
    '|---|---|---|---|',
    ...candidates.map((candidate, index) => `| ${index + 1} | ${candidateText(candidate.mccName, '未知')}（\`${candidate.mccCode}\`） | ${candidateText(candidate.applicableBusinesses, '未知')} | ${candidate.qualification === '-' ? '当前查询未返回特殊资质说明' : candidateText(candidate.qualification, '未知')} |`)
  ].join('\n');
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
  const expectedProducts = { AIPAY: 'AI 按量付费', WEBPAY: 'AI 网页应用收款', APPPAY: 'AI 移动应用收款' };
  if (expectedProducts[variantName] !== variables.productName) {
    throw new Error('integration.start.confirm variant 与产品不匹配');
  }
  if (variables.nextFlow !== 'integration') {
    throw new Error('integration.start.confirm 只能进入支付产品-代码开发');
  }
}

function validateSandboxEnvironmentRows(variables) {
  const expectedLabels = [
    '沙箱支付宝应用ID（appID）',
    '沙箱买家测试账号',
    '沙箱买家登录密码',
    '沙箱买家支付密码'
  ];
  const rows = variables.environmentRows.split('\n').map((line) => {
    const match = /^\| ([^|]+) \| ([^|]+) \|$/u.exec(line);
    return match ? { label: match[1], value: match[2] } : null;
  });
  if (rows.length !== expectedLabels.length
      || rows.some((row, index) => !row || row.label !== expectedLabels[index] || !row.value.trim())) {
    throw new Error('sandbox.environment.summary 必须按固定顺序传入四项已校验沙箱字段');
  }
}

function validateWriteConfirmation(variantName, variables, normalized) {
  const common = ['sessionSummary', 'subjectSummary', 'productName', 'actionTypes'];
  const service = ['serviceId', 'serviceName', 'serviceDescription', 'serviceUrl', 'servicePricing', 'serviceSchema'];
  const definitions = {
    SERVICE_UPDATE_ONLY: { actions: '服务修改', product: 'AI 按量付费', required: ['serviceId', 'serviceName', 'serviceDescription', 'serviceUrl', 'servicePricing', 'serviceSchema'], allowed: [...common, ...service] }
  };
  const rule = definitions[variantName];
  if (!rule) throw new Error(`onboarding.write.confirm 不支持 variant ${variantName}`);
  if (variables.actionTypes !== rule.actions) throw new Error('写确认 variant 与 actionTypes 不匹配');
  if (rule.product && variables.productName !== rule.product) throw new Error('服务写确认只适用于 AI 按量付费');
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
  if (productName === 'AI 按量付费') {
    return [
      '4. AI 按量付费 `serviceId`：把沙箱 `api_mock_service_id` 替换为真实 `serviceId`，`serviceId` 获取方式是：登录支付宝 AI 付站点（https://aipay.alipay.com/?from=alipay-aipay-skill） → 控制台 → 服务管理 → 复制审核已通过的目标服务 ID。',
      '5. AI 按量付费商户标识：`seller_id`/`seller_unique_id` 填收款商户 PID/2088，PID 获取方式是：登录支付宝商家平台（https://b.alipay.com/page/portal/home） → 点击头像 → 复制账户名下方 2088 开头的商家 ID；`seller_app_id` 填生产 `appId`。',
      '6. AI 按量付费验收：A2M 不使用 `notify_url`；上线前用生产应用私钥重新签名 402 账单，并验证 `Payment-Proof`、金额/订单/资源一致、`trade_no` 防重复履约和 `alipay.aipay.agent.fulfillment.confirm` 异步回执。'
    ];
  }
  if (productName === 'AI 移动应用收款') {
    return [
      '4. AI 移动应用收款 `notify_url`：生成生产 `orderStr` 时传入商家已部署的公网 HTTPS `notify_url`；未传不会触发异步通知。',
      '5. AI 移动应用收款验收：`notify_url` 完成验签，校验 `app_id`/`out_trade_no`/`total_amount`/`trade_status`，幂等处理并返回 `success`；支付结果以异步通知或 `alipay.trade.query` 补偿查询为准。客户端 SDK 使用服务端 `orderStr` 调起支付，客户端结果只做展示，不能作为付款成功依据。'
    ];
  }
  return [
    '4. AI 网页应用收款 `notify_url`：生产下单时传入商家已部署的公网 HTTPS `notify_url`；该地址是商家后端通知地址，不是支付宝生成的 URL。',
    '5. AI 网页应用收款验收：`notify_url` 完成验签，校验 `app_id`/`out_trade_no`/`total_amount`/`trade_status`，幂等处理并返回 `success`；支付结果以异步通知或 `alipay.trade.query` 补偿查询为准，同步回跳或前台页面不能作为付款成功依据。',
    '6. AI 网页应用收款限制：如需解除 AI 网页应用收款的收款限制，请前往 支付宝商家平台 - 签约管理 补全收款信息：https://b.alipay.com/page/ar-center/ar-manage'
  ];
}

function productionConfigSourceLines() {
  return [
    '1. 产品开通确认：前往支付宝 AI 付站点查看产品开通情况（https://aipay.alipay.com/?from=alipay-aipay-skill）。',
    '2. 应用上线确认：前往支付宝 AI 付站点“一站式接入 → 选择产品 → 密钥配置”，确认目标支付宝应用“已上线”。',
    '3. 替换项目中支付宝应用配置为生产：把生产环境的支付宝应用配置写入业务系统环境变量、受保护配置文件或密钥管理系统。确保 appId、应用私钥、支付宝公钥同属一套生产环境支付宝应用，同时修改项目中的支付宝网关为生产网关：https://openapi.alipay.com/gateway.do。'
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
      '- 如找不到配置替换位置，可以试试对 Agent 说：“我要上线了，帮我找一下项目里支付宝生产配置应该改哪些地方”。让 Agent 定位文件/变量名，但不要把生产应用私钥、账号密码、支付凭证或未脱敏通知内容直接发给 Agent。'
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
    '- 如找不到配置替换位置，可以试试对 Agent 说：“我要上线了，帮我找一下项目里支付宝生产配置应该改哪些地方”。让 Agent 定位文件/变量名，但不要把生产应用私钥、账号密码、支付凭证或未脱敏通知内容直接发给 Agent。'
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
      throw new Error(`onboarding.discovery.summary/${variantName} 禁止传入 serviceStatus 字段；AI 网页应用收款和 AI 移动应用收款的服务市场由模板固定为“无需处理”，请从 JSON 删除 serviceStatus 字段；允许变量：signingStatus、applicationStatus`);
    }
  }
}

const managedEntrypoints = {
  'product.unsupported': {
    command: 'node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" integration-message product-unsupported --product-name <产品名>',
    reason: 'runner 托管，禁手写。'
  },
  'product.clarify': {
    command: 'node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message product-clarify，或代码开发上下文使用同一入口执行 integration-message product-clarify',
    reason: 'runner 托管，禁直调 renderer。'
  },
  'onboarding.enterprise.unsupported': {
    command: 'node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message enterprise-unsupported --variant <ONBOARDING_ONLY|FULL_PROCESS>',
    reason: 'Onboarding runner 托管。'
  },
  'onboarding.windows.redirect': {
    command: 'node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message platform-entry',
    reason: 'runner 按真实平台输出。'
  },
  'integration.start.confirm': {
    command: 'node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" integration-message start-confirm --root-intent <integration_only|full_process> --product-type <aipay|webpay|apppay> --project-path <absPath> --project-selection <CURRENT_PROJECT|OTHER_PROJECT|PREPARED_NEW_PROJECT> --language <language> --framework <framework>',
    reason: '绑定同次项目扫描事实。'
  },
  'integration.checklist.result': {
    command: 'node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" integration-message checklist-result --variant <AIPAY|WEBPAY|APPPAY> --project-path <absPath> --scope-receipt <receipt> --overall-result <result> --failed-items <items> --manual-items <items> ...',
    reason: 'runner 校验 scope 并执行最终 audit。'
  },
  'integration.project_candidates.select': {
    command: 'node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" integration-message locate-projects --base-path <absDir> --search-input <current|relativeSubdir|absDir> --format message',
    reason: 'runner 轻量定位候选。'
  },
  'onboarding.mcc.clarify': {
    command: 'node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message mcc-clarify --product-type <aipay|webpay|apppay> --root-intent <onboarding_only|full_process>',
    reason: 'runner 绑定产品。'
  },
  'onboarding.mcc.no_match': {
    command: 'node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" mcc resolve-plan --query <business-description> --product-type <aipay|webpay|apppay> --root-intent <onboarding_only|full_process>',
    reason: 'mcc.sh 查询当前产品支持的 MCC 树和详情后托管输出无匹配恢复。'
  },
  'onboarding.mcc.candidates': {
    command: 'node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" mcc resolve-plan --query <business-description> --product-type <aipay|webpay|apppay> --root-intent <onboarding_only|full_process>',
    reason: 'mcc.sh 绑定当前产品支持类目、详情、候选快照和特殊资质。'
  },
  'onboarding.discovery.summary': {
    command: 'node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-discovery run --product-type <aipay|webpay|apppay> --sales-code <SALES_CODE>',
    reason: 'runner 执行发现并输出摘要。'
  },
  'onboarding.plan.confirm': {
    command: 'node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" mcc resolve-plan --query <经营描述|MCC编码> --product-type <aipay|webpay|apppay>，或已持有唯一动态 MCC 回执时使用 onboarding-message plan-confirm --root-intent <onboarding_only|full_process> --product-type <...> --mcc-code <...> --mcc-name <...> --mcc-qualification <...> --mcc-context-receipt <...>',
    reason: 'mcc.sh 绑定当前产品支持类目、详情和特殊资质；plan-confirm 只用于已验证唯一事实。'
  },
  'materials.category.collect': {
    command: 'node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message material-collect --category <signing|service|application> --state <INITIAL|PARTIAL|INVALID|APP_WEB_INITIAL|APP_MOBILE_INITIAL> --product-type <aipay|webpay|apppay> [--missing-fields <字段列表>] [--special-qualification-json <qualificationGroups>]',
    reason: 'runner 归一化“签约资料”“AI 网页应用收款签约截图”“mobilePlatform”等别名。'
  },
  'service.create.summary': {
    command: 'node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message service-create-summary --service-name <name> --service-description <desc> --service-url <url> --service-pricing <amount> --service-schema <json>',
    reason: 'runner 托管服务创建摘要。'
  },
  'onboarding.write.confirm': {
    command: 'node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message service-update-confirm --session-summary <summary> --subject-summary <summary> --service-id <id> --service-name <name> --service-description <desc> --service-url <url> --service-pricing <amount> --service-schema <json>',
    reason: 'runner 绑定服务修改摘要。'
  },
  'signing.operation.result': {
    command: 'node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message signing-result --actual-status <status> [--fee-display <fee>] --next-action <action>',
    reason: 'Onboarding runner 托管。'
  },
  'service.operation.result': {
    command: 'node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message service-result --service-id <id> --actual-result <result>',
    reason: 'Onboarding runner 托管。'
  },
  'application.harmony.manual_create': {
    command: 'node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message application-harmony-manual-create',
    reason: 'Onboarding runner 托管。'
  },
  'application.reuse.no_key': {
    command: 'node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message application-reuse-no-key --app-id <appId>',
    reason: 'runner 绑定 appId。'
  },
  'application.operation.result': {
    command: 'node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message application-result --app-id <id> --actual-status <status> [--next-action <action>] [--app-key-save-path <path>]',
    reason: 'Onboarding runner 托管；人工配置下一步目录固定。'
  },
  'application.candidates.facts': {
    command: 'node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message application-candidates --application-type <WEBAPP|MOBILEAPP> --candidates-json <APP_CANDIDATES_JSON> [--selection-state <initial|invalid>]',
    reason: 'runner 绑定候选快照。'
  },
  'application.candidate.select': {
    command: 'node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message application-candidates --application-type <WEBAPP|MOBILEAPP> --candidates-json <APP_CANDIDATES_JSON> [--selection-state <initial|invalid>]',
    reason: 'runner 绑定候选快照。'
  },
  'application.candidate.invalid': {
    command: 'node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message application-candidates --application-type <WEBAPP|MOBILEAPP> --candidates-json <APP_CANDIDATES_JSON> --selection-state invalid',
    reason: 'runner 绑定非空候选快照。'
  },
  'service.candidates.facts': {
    command: 'node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message service-candidates --candidates-json <SERVICE_CANDIDATES_JSON> [--selection-state <initial|invalid>]',
    reason: 'runner 绑定服务候选。'
  },
  'service.candidate.invalid': {
    command: 'node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message service-candidates --candidates-json <SERVICE_CANDIDATES_JSON> --selection-state invalid',
    reason: 'runner 绑定非空服务候选。'
  },
  'service.candidate.select': {
    command: 'node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message service-candidates --candidates-json <SERVICE_CANDIDATES_JSON> [--selection-state <initial|invalid>]',
    reason: 'runner 绑定服务候选。'
  },
  'process.partial_result': {
    command: 'node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" onboarding-message closeout --product-type <aipay|webpay|apppay> --root-intent <onboarding_only|full_process> --signing-result <result> --application-result <result> --remaining-actions <actions> [--integration-result <result>] [--service-result <result>]',
    reason: 'runner 合并最终收口，禁手写。'
  },
  'sandbox.android.client': {
    command: 'node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" integration-message sandbox-android-client',
    reason: 'Integration runner 托管。'
  },
  'auth.page': {
    command: 'node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" auth init --defer-open --scope <scope> --sales-code <code> --mcc-code <code> --product-name <name> --mcc-name <name> --mcc-context-receipt <receipt>，页面 stdout 独立送达后使用同一入口执行 auth open ...',
    reason: 'auth.sh 绑定上下文和 URL。',
    allowedCallers: ['auth.sh']
  },
  'auth.open.manual': {
    command: 'node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" auth manual-open',
    reason: 'auth.sh 托管手动打开提示。',
    allowedCallers: ['auth.sh']
  },
  'auth.pending': {
    command: 'node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" auth wait|confirm [--scope <scope> --sales-code <code> --mcc-code <code> --product-name <name> --mcc-name <name> --mcc-context-receipt <receipt>]',
    reason: 'auth.sh 实际查询结果。',
    allowedCallers: ['auth.sh']
  },
  'auth.expired': {
    command: 'node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" auth confirm [--scope <scope> --sales-code <code> --mcc-code <code> --product-name <name> --mcc-name <name> --mcc-context-receipt <receipt>]',
    reason: 'auth.sh 实际查询结果。',
    allowedCallers: ['auth.sh']
  },
  'auth.mismatch': {
    command: 'node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" auth mismatch --defer-open [--scope <scope> --sales-code <code> --mcc-code <code> --product-name <name> --mcc-name <name> --mcc-context-receipt <receipt>]，页面 stdout 独立送达后使用同一入口执行 auth open ...',
    reason: 'auth.sh 托管 mismatch 恢复。',
    allowedCallers: ['auth.sh']
  },
  'error.mcp.auth': {
    command: '由 onboarding modules/scripts/error_handler.sh 根据实际认证错误和 logout 结果托管输出',
    reason: 'error_handler.sh 托管。',
    allowedCallers: ['error_handler.sh']
  },
  'error.mcp.service': {
    command: '由 onboarding modules/scripts/error_handler.sh 根据实际服务错误托管输出',
    reason: 'error_handler.sh 托管。',
    allowedCallers: ['error_handler.sh']
  },
  'error.backend': {
    command: '由 onboarding modules/scripts/error_handler.sh 根据实际后端错误托管输出',
    reason: 'error_handler.sh 托管。',
    allowedCallers: ['error_handler.sh']
  },
  'error.service.unstable': {
    command: '由 onboarding modules/scripts/error_handler.sh 根据实际服务错误托管输出',
    reason: 'error_handler.sh 托管。',
    allowedCallers: ['error_handler.sh']
  },
  'error.cli': {
    command: '由 onboarding modules/scripts/error_handler.sh 根据实际 CLI 错误托管输出',
    reason: 'error_handler.sh 托管。',
    allowedCallers: ['error_handler.sh']
  },
  'application.key.page': {
    command: 'node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" app key --product-type <aipay|webpay|apppay> --defer-open <appId> <publicKey>，页面 stdout 独立送达后使用同一入口执行 app open-key-page <appId>',
    reason: 'app.sh 校验 URL 并托管页面。',
    allowedCallers: ['app.sh']
  },
  'application.key.pending': {
    command: 'node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" app verify-key --product-type <aipay|webpay|apppay> <appId> [publicKey] 或使用同一入口执行 app verify-key-and-audit --product-type <aipay|webpay|apppay> <appId> [publicKey]',
    reason: 'app.sh 实际查询结果。',
    allowedCallers: ['app.sh']
  },
  'key_tool.download.result': {
    command: 'node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" key-tool [downloadDir]',
    reason: 'download_key_tool.sh 托管。',
    allowedCallers: ['download_key_tool.sh']
  },
  'key_tool.download.fallback': {
    command: 'node "<SKILL_DIR>/references/normal/scripts/runtime.mjs" key-tool [downloadDir]',
    reason: 'download_key_tool.sh 托管。',
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
      SERVICE_INITIAL: '待补充',
      APP_WEB_INITIAL: '待补充',
      APP_MOBILE_INITIAL: '待补充',
      PARTIAL: '部分已提供，待补充',
      INVALID: '校验失败，需更正'
    }[variantName];
    if (!expectedStatus) throw new Error(`${messageId} 不支持 variant ${variantName}`);
    setVariableRule(inputVariables, 'currentStatus', { values: [expectedStatus] });
    variantRules.push(`${variantName} 的 currentStatus 固定为“${expectedStatus}”。`);
    if (variantName === 'SERVICE_INITIAL') {
      setVariableRule(inputVariables, 'categoryName', { values: ['服务资料'] });
      setVariableRule(inputVariables, 'missingFields', { values: ['服务名称、服务描述、服务地址、服务单价、请求示例JSON'] });
      variantRules.push('SERVICE_INITIAL 只允许 categoryName=服务资料 且收集全部五项服务资料。');
    } else if (variantName === 'APP_WEB_INITIAL') {
      setVariableRule(inputVariables, 'categoryName', { values: ['应用资料'] });
      setVariableRule(inputVariables, 'missingFields', { values: ['应用公钥'] });
      variantRules.push('APP_WEB_INITIAL 只允许收集应用公钥。');
    } else if (variantName === 'APP_MOBILE_INITIAL') {
      setVariableRule(inputVariables, 'categoryName', { values: ['应用资料'] });
      setVariableRule(inputVariables, 'missingFields', { values: ['应用平台和对应资料、应用公钥'] });
      variantRules.push('APP_MOBILE_INITIAL 只允许一次收集应用平台对应资料和应用公钥。');
    } else if (variantName === 'INITIAL') {
      const missingFields = inputVariables.find((variable) => variable.name === 'missingFields');
      if (missingFields?.values) missingFields.values = missingFields.values.filter((value) => value !== '应用平台和对应资料');
      variantRules.push('移动应用首次收集必须使用 APP_MOBILE_INITIAL。');
    }
  }

  if (messageId === 'service.create.summary' || messageId === 'onboarding.write.confirm') {
    setVariableRule(inputVariables, 'servicePricing', {
      format: '纯数字金额，例如 0.08；模板负责追加“元/次”，不要传入单位。'
    });
  }

  if (messageId === 'application.operation.result') {
    if (variantName === 'ALIPAY_PUBLIC_KEY_MANUAL_CONFIGURATION') {
      setVariableRule(inputVariables, 'actualStatus', { values: ['需人工配置'] });
      setVariableRule(inputVariables, 'nextAction', { required: false });
      setVariableRule(inputVariables, 'appKeySavePath', { required: false });
      variantRules.push('支付宝公钥本地导出失败使用该变体；下一步由消息目录固定，禁止通过 nextAction 传入 URL 或自由文案。');
    } else {
      setVariableRule(inputVariables, 'nextAction', { required: true });
    }
  }

  if (messageId === 'onboarding.write.confirm' && variantName === 'SERVICE_UPDATE_ONLY') {
    for (const requiredName of ['serviceId', 'serviceName', 'serviceDescription', 'serviceUrl', 'servicePricing', 'serviceSchema']) {
      setVariableRule(inputVariables, requiredName, { required: true });
    }
    setVariableRule(inputVariables, 'productName', { values: ['AI 按量付费'] });
    setVariableRule(inputVariables, 'actionTypes', { values: ['服务修改'] });
    variantRules.push('SERVICE_UPDATE_ONLY 只用于 AI 按量付费服务修改；签约提交、服务创建、应用创建和应用提审不得进入该确认消息。');
  }

  return {
    schemaVersion: 1,
    messageId,
    variant: variantName,
    owner: message.owner,
    blocking: Boolean(message.blocking),
    replyMode: message.replyMode || 'exact',
    allowedReplies: allowedRepliesFor(catalog, message),
    inputHintType: message.inputHintType || null,
    postRenderHintType: message.postRenderHintType || null,
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
  let manualKeyToolUrl = '';
  try {
    manualKeyToolUrl = keyToolManualUrl(policy);
  } catch (error) {
    errors.push(error.message);
  }

  const inputHints = catalog.interactionPrompts || {};
  if (typeof inputHints.confirmInputHint !== 'string' || !inputHints.confirmInputHint) {
    errors.push('缺少统一确认输入提示');
  }
  if (typeof inputHints.planAdjustmentHint !== 'string' || !inputHints.planAdjustmentHint) {
    errors.push('缺少统一方案调整提示');
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
    let allowedReplies = [];
    try {
      allowedReplies = allowedRepliesFor(catalog, message);
    } catch (error) {
      errors.push(error.message);
    }
    if (messages.has(message.messageId)) errors.push(`重复 messageId: ${message.messageId}`);
    messages.set(message.messageId, message);
    if (!['catalog_owned', 'script_owned'].includes(message.owner)) errors.push(`${message.messageId}: owner 无效`);
    if (message.blocking && allowedReplies.length > 0 && !['confirm', 'authorizationComplete', 'publicKeyConfirmationComplete', 'complete'].includes(message.inputHintType)) {
      errors.push(`${message.messageId}: 阻塞回复消息必须声明合法 inputHintType`);
    }
    if (message.postRenderHintType !== undefined && !['planAdjustment', 'scanReturn'].includes(message.postRenderHintType)) {
      errors.push(`${message.messageId}: postRenderHintType 无效`);
    }
    if (message.postRenderHintType && (message.blocking || JSON.stringify(message.allowedReplies || []) !== '[]')) {
      errors.push(`${message.messageId}: postRenderHintType 只允许用于非阻塞且无回复枚举的消息`);
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
      for (const value of variable.values || []) {
        if (typeof value !== 'string') continue;
        for (const match of value.matchAll(/https:\/\/[^\s)`），。；：]+/g)) {
          if (!officialUrls.has(match[0])) errors.push(`${message.messageId}: 变量 ${variable.name} 静态 URL 未登记 ${match[0]}`);
        }
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
      if (manualKeyToolUrl && template.includes(manualKeyToolUrl)) {
        errors.push(`${message.messageId}/${variantName}: 密钥工具手动地址必须使用 {{keyToolManual}}，禁止在消息模板内复制 URL`);
      }
      if (/<INTERNAL_/i.test(template)) errors.push(`${message.messageId}/${variantName}: 模板包含内部标签`);
      if (message.blocking && allowedReplies.length > 0 && /(?:回复|输入)\s*`?1`?/.test(template)) {
        errors.push(`${message.messageId}/${variantName}: 阻塞输入提示必须由 renderer 统一追加`);
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

export function renderMessage(messageId, variantName, variables, telemetryContext = {}) {
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
  if (messageId === 'application.candidates.facts') {
    normalized.candidateTable = applicationCandidateTable(variantName, variables.applicationCandidates);
  }
  if (definitions.has('keyToolManual')) normalized.keyToolManual = keyToolManualUrl(policy);
  if (definitions.has('keyToolFormatHint')) {
    normalized.keyToolFormatHint = derivedCatalogText(definitions, 'keyToolFormatHint');
  }
  if (messageId === 'service.candidates.facts') {
    normalized.candidateTable = serviceCandidateTable(variantName, variables.serviceCandidates);
  }
  if (messageId === 'onboarding.mcc.candidates') {
    normalized.candidateTable = mccCandidateTable(variantName, variables.mccCandidates, telemetryContext.productType);
  }
  if (messageId === 'application.operation.result') {
    if (variantName === 'ALIPAY_PUBLIC_KEY_MANUAL_CONFIGURATION') {
      if (variables.actualStatus !== '需人工配置') {
        throw new Error('支付宝公钥人工配置结果必须使用 actualStatus=需人工配置');
      }
      if (variables.nextAction !== undefined && variables.nextAction !== '') {
        throw new Error('支付宝公钥人工配置下一步由消息目录固定，禁止传入 nextAction');
      }
      if (variables.appKeySavePath !== undefined && variables.appKeySavePath !== '') {
        throw new Error('需人工配置表示支付宝公钥未本地保存，禁止传入保存路径');
      }
      normalized.manualConfigurationNextAction = definitions.get('manualConfigurationNextAction')?.values?.[0] || '';
      if (!normalized.manualConfigurationNextAction) throw new Error('application.operation.result 缺少支付宝公钥人工配置下一步');
    } else if (!variables.nextAction) {
      throw new Error('application.operation.result 默认变体必须传入 nextAction');
    }
    if (variables.actualStatus === '已上线且配置完整' && (variables.appKeySavePath === undefined || variables.appKeySavePath === '')) {
      throw new Error('application.operation.result 在已上线且配置完整时必须传入支付宝公钥保存路径');
    }
    normalized.appKeySaveLine = appKeySaveLine(normalized.appId, variables.appKeySavePath);
  }
  if (messageId === 'sandbox.environment.summary') validateSandboxEnvironmentRows(variables);
  if (messageId === 'error.backend') {
    normalized.errorSceneLine = variables.errorScene || variables.errorSpecific
      ? `📋 错误场景：${variables.errorScene ? normalized.errorScene : '未知'} / ${variables.errorSpecific ? normalized.errorSpecific : '未知'}`
      : '';
    normalized.checkedErrorsBlock = normalized.checkedErrors.length > 0
      ? ['📋 详细校验错误：', ...normalized.checkedErrors.map((detail) => `  - ${detail}`)].join('\n')
      : '';
    normalized.bizTipsLine = variables.bizTips ? `💡 提示：${normalized.bizTips}` : '';
    normalized.appMaxLine = variables.appMax === 'YES'
      ? '📌 处理建议：当前主体下应用数量已达到上限，无法继续新建应用。请优先复用已有上线应用；如必须新建，请前往支付宝开放平台处理应用配额或联系支付宝技术支持。'
      : '';
  }
  if (messageId === 'error.cli') {
    normalized.bizTipsLine = variables.bizTips ? `💡 ${normalized.bizTips}` : '';
    normalized.checkedErrorsBlock = normalized.checkedErrors.length > 0
      ? ['📋 详细校验错误：', ...normalized.checkedErrors.map((detail) => `  - ${detail}`)].join('\n')
      : '';
  }
  const hasMccInput =
    variables.mccCode !== undefined ||
    variables.mccName !== undefined ||
    variables.mccQualification !== undefined ||
    variables.mccContextReceipt !== undefined;
  if (hasMccInput) {
    if (!definitions.has('mccCode') || !definitions.has('mccName')) throw new Error(`${messageId} 的 MCC 变量声明不完整`);
    const dynamicReceipt = variables.mccContextReceipt
      ? verifyMccContextReceipt(variables.mccContextReceipt)
      : null;
    if (!dynamicReceipt) throw new Error('MCC 消息必须提供本轮 MCC_CONTEXT_RECEIPT');
    assertCurrentMccRun(dynamicReceipt, process.env, expectedMccRunIdFromContext(telemetryContext));
    const expectedReceiptProductType = messageId === 'onboarding.plan.confirm'
      ? { AIPAY: 'aipay', WEBPAY: 'webpay', APPPAY: 'apppay' }[variantName]
      : '';
    if (expectedReceiptProductType && dynamicReceipt.product_type !== expectedReceiptProductType) {
      throw new Error('MCC 上下文回执与方案产品不一致');
    }
    if (dynamicReceipt.mcc_code !== variables.mccCode || dynamicReceipt.mcc_name !== variables.mccName) {
      throw new Error('MCC 上下文回执与消息变量不一致');
    }
    normalized.mccName = dynamicReceipt.mcc_name;
    normalized.mccCode = dynamicReceipt.mcc_code;
    if (definitions.has('mccQualification') && variables.mccQualification !== undefined) {
      const expectedQualification = mccQualificationSummary({
        needSpecialQual: dynamicReceipt.need_special_qual,
        qualificationGroups: dynamicReceipt.qualification_groups
      });
      if (variables.mccQualification !== expectedQualification) throw new Error('MCC 特殊资质不匹配动态上下文回执');
      normalized.mccQualification = expectedQualification;
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
      officialUrl: variables.officialUrl,
      mccContextReceipt: variables.mccContextReceipt
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
    if (variantName === 'AIPAY' && !variables.sandboxResult) throw new Error('AI 按量付费 checklist 缺少沙箱联调结果');
    if (variantName !== 'AIPAY' && variables.sandboxResult) throw new Error('非 AI 按量付费 checklist 禁止传入 AI 按量付费沙箱结果');
    if (variantName === 'WEBPAY' && !variables.webpayExperienceResult) throw new Error('AI 网页应用收款 checklist 缺少沙箱体验实际结果');
    if (variantName !== 'WEBPAY' && variables.webpayExperienceResult) throw new Error('非 AI 网页应用收款 checklist 禁止传入 AI 网页应用收款沙箱体验结果');
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
    if (sandboxPending && variantName === 'AIPAY' && variables.sandboxResult !== 'AI 按量付费沙箱服务端联调未通过') {
      throw new Error('沙箱配置未完成时 AI 按量付费联调不得标记通过');
    }
    if (sandboxPending && variantName === 'WEBPAY' && variables.webpayExperienceResult !== '未提供浏览器付款入口或完整操作指引，需先补齐') {
      throw new Error('沙箱配置未完成时 AI 网页应用收款不得标记已交付付款体验');
    }
    if (variantName === 'AIPAY' && variables.overallResult === '通过' && variables.sandboxResult !== 'AI 按量付费沙箱服务端联调通过') {
      throw new Error('AI 按量付费代码开发通过必须有沙箱服务端联调通过结论');
    }
    if (variantName === 'WEBPAY' && variables.overallResult === '通过' && variables.webpayExperienceResult === '未提供浏览器付款入口或完整操作指引，需先补齐') {
      throw new Error('AI 网页应用收款未交付付款入口时不得标记代码开发通过');
    }
    if (manualOnly) {
      normalized.failedItems = `人工待验证项未完成：${normalized.manualItems}`;
    }
  }
  if (messageId === 'materials.category.collect') {
    const expectedStatus = {
      INITIAL: '待补充',
      SERVICE_INITIAL: '待补充',
      APP_WEB_INITIAL: '待补充',
      APP_MOBILE_INITIAL: '待补充',
      PARTIAL: '部分已提供，待补充',
      INVALID: '校验失败，需更正'
    }[variantName];
    if (!expectedStatus || variables.currentStatus !== expectedStatus) {
      throw new Error('materials.category.collect variant 与材料状态不匹配');
    }
    const isServiceInitial = variantName === 'SERVICE_INITIAL';
    if (isServiceInitial && (
      variables.categoryName !== '服务资料'
      || variables.missingFields !== '服务名称、服务描述、服务地址、服务单价、请求示例JSON'
    )) {
      throw new Error('SERVICE_INITIAL 只允许收集全部五项服务资料');
    }
    const isWebInitial = variantName === 'APP_WEB_INITIAL';
    if (isWebInitial && (variables.categoryName !== '应用资料' || variables.missingFields !== '应用公钥')) {
      throw new Error('APP_WEB_INITIAL 只允许收集应用公钥');
    }
    const isMobileInitial = variantName === 'APP_MOBILE_INITIAL';
    if (isMobileInitial && (variables.categoryName !== '应用资料' || variables.missingFields !== '应用平台和对应资料、应用公钥')) {
      throw new Error('APP_MOBILE_INITIAL 只允许一次收集应用平台对应资料和应用公钥');
    }
    if (variantName === 'INITIAL' && variables.missingFields.split('、').includes('应用平台和对应资料')) {
      throw new Error('移动应用首次收集必须使用 APP_MOBILE_INITIAL');
    }
    normalized.missingFields = normalized.missingFields.replace(
      '应用平台和对应资料',
      '平台字段（IOS=bundleId；ANDROID=appPackage+appSign；ALL=bundleId+appPackage+appSign）'
    );
    normalized.paymentPageHint = variables.missingFields.split('、').includes('支付页截图')
      ? definitions.get('paymentPageHint')?.values?.[0] || ''
      : '';
    normalized.serviceUrlHint = variantName === 'INVALID'
      && variables.categoryName === '服务资料'
      && variables.missingFields.split('、').includes('服务地址')
      ? definitions.get('serviceUrlHint')?.values?.[0] || ''
      : '';
    normalized.servicePricingHint = variantName === 'INVALID'
      && variables.categoryName === '服务资料'
      && variables.missingFields.split('、').includes('服务单价')
      ? definitions.get('servicePricingHint')?.values?.[0] || ''
      : '';
    normalized.specialQualificationHint = variables.specialQualificationHint || '';
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
    if (variables.productName === 'AI 按量付费' && variables.serviceResult === '无需处理') {
      throw new Error('AI 按量付费产品开通不能把服务市场标记为无需处理');
    }
    if (variables.productName !== 'AI 按量付费' && variables.serviceResult !== '无需处理') {
      throw new Error('AI 网页应用收款或 AI 移动应用收款的服务市场结果必须为无需处理');
    }
    const expectedServiceComplete = variables.productName === 'AI 按量付费'
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
  if (messageId === 'application.operation.result' || messageId === 'process.partial_result' || messageId === 'error.backend' || messageId === 'error.cli') {
    rendered = normalizeProcessPartialResultSpacing(rendered);
  }
  if (message.blocking && allowedRepliesFor(catalog, message).length > 0) {
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
  if (message.postRenderHintType) {
    const hintKeys = {
      planAdjustment: 'planAdjustmentHint',
      scanReturn: 'scanReturnHint'
    };
    const hintKey = hintKeys[message.postRenderHintType];
    if (!hintKey) throw new Error(`${messageId} 的 postRenderHintType 非法`);
    const hint = catalog.interactionPrompts?.[hintKey];
    if (!hint) throw new Error(`缺少 ${hintKey}`);
    rendered = `${rendered}\n\n${hint}`;
  }
  emitMessageMetric(messageId, variantName, variables, telemetryContext);
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

function inputJsonArg(argv = process.argv) {
  const index = argv.indexOf('--input-json');
  if (index < 0) return null;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error('参数 --input-json 缺少取值');
  try {
    return JSON.parse(value);
  } catch {
    throw new Error('--input-json 必须是合法 JSON 对象');
  }
}

export async function runRenderCustomerMessageCli(argv = process.argv) {
  if (argv.includes('--check-catalog')) {
    const errors = validateCatalog();
    if (errors.length) throw new Error(errors.join('\n'));
    console.log('customer message catalog: OK');
    return;
  }
  if (argv.includes('--validate-authorization-context')) {
    validateAuthorizationContext(await readStdin());
    console.log('authorization context: OK');
    return;
  }
  if (argv.includes('--validate-special-license-request')) {
    validateSpecialLicenseUploadRequest(await readStdin());
    console.log('special license request: OK');
    return;
  }
  if (argv.includes('--resolve-special-license-types')) {
    console.log(JSON.stringify(specialLicenseTypesForUploadRequest(await readStdin())));
    return;
  }
  if (argv.includes('--validate-signing-special-license-context')) {
    validateSigningSpecialLicenseContext(await readStdin());
    console.log('signing special license context: OK');
    return;
  }
  if (argv.includes('--build-authorization-url')) {
    console.log(buildAuthorizationUrl(await readStdin()));
    return;
  }
  if (argv.includes('--schema')) {
    const schemaIndex = argv.indexOf('--schema');
    const messageId = argv[2] === '--schema' ? argv[schemaIndex + 1] : argv[2];
    const variantIndex = argv.indexOf('--variant');
    const variant = variantIndex >= 0 ? argv[variantIndex + 1] : 'DEFAULT';
    if (!messageId || messageId.startsWith('--')) throw new Error('用法: render_customer_message.mjs --schema <messageId> [--variant NAME]');
    console.log(JSON.stringify(getMessageSchema(messageId, variant), null, 2));
    return;
  }
  const messageId = argv[2];
  const variantIndex = argv.indexOf('--variant');
  const variant = variantIndex >= 0 ? argv[variantIndex + 1] : 'DEFAULT';
  if (!messageId) throw new Error('用法: render_customer_message.mjs <messageId> [--variant NAME]');
  assertManagedCliAllowed(messageId);
  const variables = inputJsonArg(argv) ?? await readStdin();
  console.log(renderMessageWithFallback(messageId, variant, variables));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runRenderCustomerMessageCli().catch((error) => {
    console.error('当前步骤的标准消息无法安全生成，已停止后续动作。请按 MESSAGE_RENDER_ERROR 的具体原因修正输入；若消息目录或脚本缺失，再检查 Skill 文件完整性。');
    console.error(`MESSAGE_RENDER_ERROR:${error.message}`);
    process.exitCode = 1;
  });
}
