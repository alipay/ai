#!/usr/bin/env node

import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { isWindowsPlatform } from './platform_compat.mjs';
import {
  buildWindowsOnboardingRedirectUrl,
  createMccContextReceipt,
  mccQualificationSummary,
  renderMessage
} from './render_customer_message.mjs';
import {
  currentRunContext,
  emitStageMetric,
  startTelemetryRun
} from './telemetry.mjs';

const internalPrefix = 'ALIPAY_AIPAY_INTERNAL:';
const productTypes = {
  aipay: { variant: 'AIPAY', productName: 'AI 按量付费' },
  webpay: { variant: 'WEBPAY', productName: 'AI 网页应用收款' },
  apppay: { variant: 'APPPAY', productName: 'AI 移动应用收款' }
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

const materialFieldsByCategory = Object.freeze({
  signing: ['APP名称', '首页截图', '商品页截图', '支付页截图', '特殊资质材料'],
  service: ['服务名称', '服务描述', '服务地址', '服务单价', '请求示例JSON'],
  application: ['应用平台和对应资料', 'iOS Bundle ID（bundleId）', 'Android 应用包名（appPackage）', 'Android 应用签名摘要（appSign）', '应用公钥']
});

const materialStates = {
  INITIAL: { variant: 'INITIAL', currentStatus: '待补充' },
  PARTIAL: { variant: 'PARTIAL', currentStatus: '部分已提供，待补充' },
  INVALID: { variant: 'INVALID', currentStatus: '校验失败，需更正' },
  APP_WEB_INITIAL: { variant: 'APP_WEB_INITIAL', currentStatus: '待补充' },
  APP_MOBILE_INITIAL: { variant: 'APP_MOBILE_INITIAL', currentStatus: '待补充' }
};

const directFieldAliases = new Map([
  ['APP名称', ['APP名称']],
  ['appName', ['APP名称']],
  ['首页截图', ['首页截图']],
  ['商品页截图', ['商品页截图']],
  ['支付页截图', ['支付页截图']],
  ['特殊资质材料', ['特殊资质材料']],
  ['特殊资质', ['特殊资质材料']],
  ['服务名称', ['服务名称']],
  ['serviceName', ['服务名称']],
  ['服务描述', ['服务描述']],
  ['serviceDesc', ['服务描述']],
  ['服务地址', ['服务地址']],
  ['资源 URL', ['服务地址']],
  ['资源URL', ['服务地址']],
  ['resourceUrl', ['服务地址']],
  ['服务单价', ['服务单价']],
  ['单次价格', ['服务单价']],
  ['pricing', ['服务单价']],
  ['请求示例JSON', ['请求示例JSON']],
  ['请求示例 JSON', ['请求示例JSON']],
  ['序列化 JSON 请求示例', ['请求示例JSON']],
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
    const name = key.slice(2);
    if (Object.prototype.hasOwnProperty.call(args, name)) throw new Error(`参数 ${key} 重复`);
    args[name] = value;
    index += 1;
  }
  return { command, args };
}

function required(args, name) {
  const value = args[name];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`缺少参数 --${name}`);
  return value;
}

function optional(args, name) {
  return typeof args[name] === 'string' && args[name].length > 0 ? args[name] : undefined;
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

function runPlatformEntry(args = {}) {
  if (!isWindowsPlatform()) return '';
  const runContext = currentRunContext();
  if (runContext?.terminal) {
    throw new Error('Windows 产品开通引导缺少有效的当前 Onboarding run context');
  }
  const rootIntent = runContext?.root_intent || process.env.ALIPAY_AIPAY_ROOT_INTENT || process.env.ROOT_INTENT || '';
  if (!['onboarding_only', 'full_process'].includes(rootIntent)) {
    throw new Error('Windows 产品开通引导缺少有效的当前 Onboarding run context');
  }
  const platformId = platformIdFromEnv(process.env)
    || runContext?.run_id
    || '';
  if (!platformId) {
    throw new Error('Windows 产品开通引导缺少有效的当前 Onboarding run context');
  }
  return renderMessage('onboarding.windows.redirect', 'DEFAULT', {
    officialUrl: buildWindowsOnboardingRedirectUrl(platformId)
  });
}

function platformIdFromEnv(env = process.env) {
  const candidate = env.COZE_PROJECT_ID
    || env.MEOO_PROJECT_ID
    || (env.MIAODA ? env.VITE_APP_ID || env.PLATFORM_ID || '' : '');
  return typeof candidate === 'string' && candidate && !/[\u0000-\u001f\u007f,^=]/u.test(candidate)
    ? candidate
    : '';
}

function parseJsonArg(args, name, label) {
  const raw = required(args, name);
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${label} 必须是合法 JSON`);
  }
}

function runProductClarify() {
  return renderMessage('product.clarify', 'DEFAULT', {});
}

function runEnterpriseUnsupported(args) {
  const variant = required(args, 'variant');
  if (!['ONBOARDING_ONLY', 'FULL_PROCESS'].includes(variant)) {
    throw new Error('variant 非法，仅支持 ONBOARDING_ONLY、FULL_PROCESS');
  }
  return renderMessage(
    'onboarding.enterprise.unsupported',
    variant,
    {}
  );
}

async function runMccClarify(args) {
  const productType = required(args, 'product-type');
  const product = productFor({ ...args, 'product-type': productType });
  const rootIntent = required(args, 'root-intent');
  if (!['onboarding_only', 'full_process'].includes(rootIntent)) {
    throw new Error('root-intent 仅支持 onboarding_only、full_process');
  }
  await startTelemetryRun(rootIntent, productType);
  return renderMessage('onboarding.mcc.clarify', 'DEFAULT', {
    productName: product.productName
  }, { productType });
}

function normalizeUnicode(value) {
  return String(value).normalize('NFKC').toLocaleLowerCase('zh-CN');
}

function normalizeSearch(value) {
  return normalizeUnicode(value)
    .replace(/[\p{P}\p{S}\p{Z}\s]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

function assertMccQuery(query) {
  if (/[\u0000-\u001f\u007f]/u.test(query)) throw new Error('query 包含控制字符或过长');
  const normalizedQuery = normalizeSearch(query);
  const normalizedLength = [...normalizedQuery.replace(/\s+/gu, '')].length;
  if (normalizedLength > 500) throw new Error('query 包含控制字符或过长');
  if (normalizedLength < 2) throw new Error('query 过短，无法执行确定性 MCC 检索');
  return normalizedQuery;
}

const mccSelectionReceiptPrefix = 'AIPAY_MCC_SELECTION_V1.';

function activeMccRunId(env = process.env) {
  const candidate = env.ALIPAY_AIPAY_RUN_ID
    || env.ALIPAY_AIPAY_FLOW_RUN_ID
    || currentRunContext(env)?.run_id
    || '';
  return typeof candidate === 'string' && candidate && !/[\u0000-\u001f\u007f,^=]/u.test(candidate) ? candidate : '';
}

function captureMccRunContext(env = process.env) {
  return Object.freeze({ runId: activeMccRunId(env) });
}

function productSalesCode(productType) {
  return {
    aipay: 'I1080300001000160457',
    webpay: 'I1080300001000041203',
    apppay: 'I1080300001000041313'
  }[productType] || '';
}

function mccCandidateFromRecord(record, productType = '', mccRunContext = captureMccRunContext()) {
  const qualification = record.qualification ?? mccQualificationSummary(record);
  const candidate = {
    mccCode: record.code,
    mccName: record.name,
    applicableBusinesses: record.applicableBusinesses,
    qualification
  };
  if (record.dynamic) {
    candidate.needSpecialQual = record.needSpecialQual === true;
    candidate.qualificationGroups = record.qualificationGroups || [];
  }
  const hasCompleteQualificationFacts = record.needSpecialQual !== true
    || (Array.isArray(record.qualificationGroups) && record.qualificationGroups.length > 0);
  if (productType && record.dynamic && hasCompleteQualificationFacts) {
    candidate.mccContextReceipt = createMccContextReceipt({
      schema_ver: 1,
      product_type: productType,
      sales_code: productSalesCode(productType),
      mcc_code: record.code,
      mcc_name: record.name,
      mcc_description: record.applicableBusinesses,
      need_special_qual: record.needSpecialQual === true,
      qualification_groups: record.qualificationGroups || [],
      run_id: mccRunContext.runId || undefined
    });
  }
  return {
    ...candidate
  };
}

function dynamicMccRecordsFromCatalog(rawCatalog) {
  let catalog;
  try {
    catalog = typeof rawCatalog === 'string' ? JSON.parse(rawCatalog) : rawCatalog;
  } catch {
    throw new Error('mcc-catalog-json 必须是合法 JSON');
  }
  if (!Array.isArray(catalog) || catalog.length === 0) {
    throw new Error('mcc-catalog-json 必须是非空数组');
  }
  const records = new Map();
  const refs = new Set();
  for (const item of catalog) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('mcc-catalog-json 项必须是对象');
    const code = String(item.mccCode || item.code || '').toUpperCase();
    const name = String(item.mccName || item.name || '');
    const applicableBusinesses = String(item.mccDescription || item.applicableBusinesses || '');
    if (!/^A\d{4}_B\d{4}$/u.test(code)) throw new Error(`动态 MCC 编码非法：${code}`);
    if (!name || !applicableBusinesses) throw new Error(`动态 MCC ${code} 缺少名称或描述`);
    if (typeof item.needSpecialQual !== 'boolean') throw new Error(`动态 MCC ${code} 缺少布尔型 needSpecialQual`);
    if (!Array.isArray(item.qualificationGroups)) throw new Error(`动态 MCC ${code} 的 qualificationGroups 必须是数组`);
    if (records.has(code)) throw new Error(`动态 MCC 重复：${code}`);
    const ref = item.mccRef == null ? '' : String(item.mccRef);
    if (ref && !/^mcc-\d+$/u.test(ref)) throw new Error(`动态 MCC ${code} 的 mccRef 非法`);
    if (ref && refs.has(ref)) throw new Error(`动态 MCC 目录引用重复：${ref}`);
    if (ref) refs.add(ref);
    const needSpecialQual = item.needSpecialQual;
    const qualificationGroups = item.qualificationGroups;
    records.set(code, {
      code,
      name,
      applicableBusinesses,
      needSpecialQual,
      qualificationGroups,
      qualification: mccQualificationSummary({ needSpecialQual, qualificationGroups }),
      ref: ref || undefined,
      dynamic: true
    });
  }
  return records;
}

function recordsForArgs(args) {
  const catalog = optional(args, 'mcc-catalog-json');
  if (catalog === undefined) {
    throw new Error('mcc-resolve-plan 必须提供 mcc.sh 从当前 MCC 查询事实生成的 --mcc-catalog-json');
  }
  return dynamicMccRecordsFromCatalog(catalog);
}

function sortedMccRecords(records) {
  return [...records.values()].sort((left, right) => left.code.localeCompare(right.code));
}

function mccAgentRefEntries(records) {
  const refs = new Map();
  sortedMccRecords(records).forEach((record, index) => {
    const ref = record.ref || `mcc-${index + 1}`;
    if (refs.has(ref)) throw new Error(`动态 MCC 目录引用重复：${ref}`);
    refs.set(ref, record.code);
  });
  return refs;
}

function mccCatalogForAgent(records) {
  const refsByCode = new Map([...mccAgentRefEntries(records)].map(([ref, code]) => [code, ref]));
  return sortedMccRecords(records).map((record) => ({
    ref: refsByCode.get(record.code),
    mccName: record.name,
    mccDescription: record.applicableBusinesses
  }));
}

function parseAgentCandidateRefs(args, records) {
  if (!Object.prototype.hasOwnProperty.call(args, 'agent-candidate-refs-json')) {
    return { provided: false, codes: [] };
  }
  const raw = args['agent-candidate-refs-json'];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('agent-candidate-refs-json 必须是合法 JSON 字符串数组');
  }
  if (!Array.isArray(parsed) || parsed.length > 8 || parsed.some((ref) => typeof ref !== 'string')) {
    throw new Error('agent-candidate-refs-json 必须是最多 8 项的 JSON 字符串数组');
  }
  const refs = mccAgentRefEntries(records);
  const codes = [];
  for (const ref of parsed) {
    if (!refs.has(ref) || codes.includes(refs.get(ref))) {
      throw new Error('agent-candidate-refs-json 只能引用本轮 queryMcc 返回的唯一 MCC 目录引用');
    }
    codes.push(refs.get(ref));
  }
  return { provided: true, codes };
}

function mccTableSummary(records) {
  const entries = [...records.values()]
    .map((record) => [
      record.code,
      record.name,
      record.applicableBusinesses,
      record.qualification,
      JSON.stringify(record.qualificationGroups || [])
    ].join('\t'))
    .sort()
    .join('\n');
  return {
    recordCount: records.size,
    sha256: createHash('sha256').update(entries).digest('hex')
  };
}

function normalizeMccCode(value, records) {
  const raw = normalizeUnicode(value).trim().toUpperCase();
  if (/^A\d{4}_B\d{4}$/u.test(raw)) return records.has(raw) ? raw : '';
  if (!/^B\d{4}$/u.test(raw)) return '';
  const matches = [...records.keys()].filter((code) => code.endsWith(`_${raw}`));
  if (matches.length > 1) return '';
  return matches[0] || '';
}

function directMccCode(query, records) {
  const raw = normalizeUnicode(query).trim().toUpperCase();
  if (!/^(?:A\d{4}_)?B\d{4}$/u.test(raw)) return { isCode: false, matches: [] };
  if (/^A\d{4}_B\d{4}$/u.test(raw)) {
    return { isCode: true, matches: records.has(raw) ? [raw] : [] };
  }
  return { isCode: true, matches: [...records.keys()].filter((code) => code.endsWith(`_${raw}`)) };
}

function directMccName(query, records) {
  const normalizedQuery = assertMccQuery(query);
  return sortedMccRecords(records)
    .filter((record) => normalizeSearch(record.name) === normalizedQuery)
    .map((record) => record.code)
    .slice(0, 8);
}

function createMccSelectionReceipt(productType, query, result, mccRunContext = captureMccRunContext()) {
  const codes = result.mergedCandidateCodes.join(',');
  const table = result.mccTableSummary;
  const binding = [
    mccRunContext.runId,
    productType,
    assertMccQuery(query),
    table.sha256,
    table.recordCount,
    codes
  ].join('\n');
  return `${mccSelectionReceiptPrefix}${codes}.${createHash('sha256').update(binding).digest('base64url')}`;
}

function resolveMccSelection(productType, query, selectedInput, receipt, records, mccRunContext) {
  const candidateCodes = mccSelectionReceiptCodes(productType, query, receipt, records, mccRunContext);
  if (!candidateCodes) {
    const semanticStatus = typeof receipt === 'string' && receipt.startsWith(mccSelectionReceiptPrefix)
      ? 'SELECTION_RECEIPT_STALE'
      : 'SELECTION_RECEIPT_INVALID';
    const refreshed = resolveMccResultFromRecords(
      query,
      productType,
      records,
      semanticStatus,
      mccRunContext
    );
    return {
      ...refreshed,
      matchType: refreshed.matchType === 'NONE' ? 'NONE' : 'MULTIPLE',
      semanticStatus
    };
  }
  const currentTable = mccTableSummary(records);
  const selectedCode = normalizeMccCode(selectedInput, records);
  if (!selectedCode || !candidateCodes.includes(selectedCode)) {
    return {
      matchType: 'MULTIPLE',
      semanticStatus: 'SELECTION_INVALID',
      deterministicCandidateCodes: [],
      deterministicStrongCandidateCodes: [],
      deterministicWeakCandidateCodes: [],
      agentCandidateCodes: [],
      mergedCandidateCodes: candidateCodes,
      mccTableSummary: currentTable,
      candidates: candidateCodes.map((code) => mccCandidateFromRecord(records.get(code), productType, mccRunContext))
    };
  }
  const candidate = mccCandidateFromRecord(records.get(selectedCode), productType, mccRunContext);
  return {
    matchType: 'UNIQUE',
    semanticStatus: 'NOT_REQUIRED_SELECTION',
    deterministicCandidateCodes: [],
    deterministicStrongCandidateCodes: [],
    deterministicWeakCandidateCodes: [],
    agentCandidateCodes: [],
    mergedCandidateCodes: [selectedCode],
    mccTableSummary: currentTable,
    candidates: [candidate]
  };
}

function mccSelectionReceiptCodes(productType, query, receipt, records, mccRunContext = captureMccRunContext()) {
  if (typeof receipt !== 'string' || !receipt.startsWith(mccSelectionReceiptPrefix)) return null;
  const body = receipt.slice(mccSelectionReceiptPrefix.length);
  const separator = body.lastIndexOf('.');
  const candidateCodes = separator > 0 ? body.slice(0, separator).split(',') : [];
  const currentTable = mccTableSummary(records);
  if (candidateCodes.length < 1 || candidateCodes.length > 8
    || new Set(candidateCodes).size !== candidateCodes.length
    || candidateCodes.some((code) => !records.has(code))
    || receipt !== createMccSelectionReceipt(productType, query, {
      mergedCandidateCodes: candidateCodes,
      mccTableSummary: currentTable
    }, mccRunContext)) {
    return null;
  }
  return candidateCodes;
}

function resolveMccResultFromRecords(
  query,
  productType,
  records,
  semanticStatus,
  mccRunContext = captureMccRunContext(),
  agentReview = { provided: false, codes: [] }
) {
  const directCode = directMccCode(query, records);
  if (directCode.isCode) {
    if (directCode.matches.length === 1) {
      const code = directCode.matches[0];
      const candidate = mccCandidateFromRecord(records.get(code), productType, mccRunContext);
      return {
        matchType: 'UNIQUE',
        semanticStatus: 'NOT_REQUIRED_DIRECT_CODE',
        deterministicCandidateCodes: [code],
        deterministicStrongCandidateCodes: [code],
        deterministicWeakCandidateCodes: [],
        agentCandidateCodes: [],
        mergedCandidateCodes: [code],
        mccTableSummary: mccTableSummary(records),
        candidates: [candidate]
      };
    }
    const finalCodes = directCode.matches.slice(0, 8);
    return {
      matchType: finalCodes.length === 0 ? 'NONE' : 'MULTIPLE',
      semanticStatus: finalCodes.length === 0 ? 'DYNAMIC_CATALOG_CODE_NOT_FOUND' : 'DYNAMIC_CATALOG_CODE_AMBIGUOUS',
      deterministicCandidateCodes: finalCodes,
      deterministicStrongCandidateCodes: finalCodes,
      deterministicWeakCandidateCodes: [],
      agentCandidateCodes: [],
      mergedCandidateCodes: finalCodes,
      mccTableSummary: mccTableSummary(records),
      candidates: finalCodes.map((code) => mccCandidateFromRecord(records.get(code), productType, mccRunContext))
    };
  }

  const exactNameCodes = directMccName(query, records);
  if (exactNameCodes.length > 0) {
    const candidates = exactNameCodes.map((code) => mccCandidateFromRecord(records.get(code), productType, mccRunContext));
    return {
      matchType: candidates.length === 1 ? 'UNIQUE' : 'MULTIPLE',
      semanticStatus: 'NOT_REQUIRED_EXACT_NAME',
      deterministicCandidateCodes: exactNameCodes,
      deterministicStrongCandidateCodes: exactNameCodes,
      deterministicWeakCandidateCodes: [],
      agentCandidateCodes: [],
      mergedCandidateCodes: exactNameCodes,
      mccTableSummary: mccTableSummary(records),
      candidates
    };
  }

  if (!agentReview.provided) {
    return {
      matchType: 'NONE',
      semanticStatus: semanticStatus || 'AGENT_CATALOG_REVIEW_REQUIRED',
      deterministicCandidateCodes: [],
      deterministicStrongCandidateCodes: [],
      deterministicWeakCandidateCodes: [],
      agentCandidateCodes: [],
      mergedCandidateCodes: [],
      mccTableSummary: mccTableSummary(records),
      candidates: [],
      agentReview: {
        required: true,
        attempt: 1,
        maxAttempts: 2,
        reason: 'NATURAL_LANGUAGE_MATCH',
        instructions: {
          keepExplicitConstraints: true,
          keepUnspecifiedDimensionsOpen: true,
          excludeContradictions: true,
          rankByRelevance: true,
          maxCandidates: 8
        },
        catalog: mccCatalogForAgent(records)
      }
    };
  }

  const finalCodes = agentReview.codes;
  const candidates = finalCodes.map((code) => mccCandidateFromRecord(records.get(code), productType, mccRunContext));
  return {
    matchType: candidates.length === 1 ? 'UNIQUE' : candidates.length === 0 ? 'NONE' : 'MULTIPLE',
    semanticStatus: semanticStatus || 'AGENT_CATALOG_REVIEW_USED',
    deterministicCandidateCodes: [],
    deterministicStrongCandidateCodes: [],
    deterministicWeakCandidateCodes: [],
    agentCandidateCodes: finalCodes,
    mergedCandidateCodes: finalCodes,
    mccTableSummary: mccTableSummary(records),
    candidates
  };
}

function renderPlanConfirm(productType, mccCandidate, mccRunContext = captureMccRunContext()) {
  const product = productFor({ 'product-type': productType });
  const variables = {
    mccCode: mccCandidate.mccCode,
    mccName: mccCandidate.mccName,
    mccQualification: mccCandidate.qualification
  };
  if (mccCandidate.mccContextReceipt) variables.mccContextReceipt = mccCandidate.mccContextReceipt;
  return renderMessage('onboarding.plan.confirm', product.variant, variables, { productType, runId: mccRunContext.runId, mccRunId: mccRunContext.runId });
}

function requireCustomerMessageDelivery(messageId, message) {
  process.stderr.write(`${internalPrefix}CUSTOMER_MESSAGE_DELIVERY_REQUIRED=${messageId}\n`);
  return message;
}

async function runPlanConfirm(args) {
  const rootIntent = required(args, 'root-intent');
  if (!['onboarding_only', 'full_process'].includes(rootIntent)) {
    throw new Error('root-intent 仅支持 onboarding_only、full_process');
  }
  const productType = required(args, 'product-type');
  productFor({ ...args, 'product-type': productType });
  await startTelemetryRun(rootIntent, productType);
  const mccRunContext = captureMccRunContext();
  return requireCustomerMessageDelivery('onboarding.plan.confirm', renderPlanConfirm(productType, {
    mccCode: required(args, 'mcc-code'),
    mccName: required(args, 'mcc-name'),
    qualification: required(args, 'mcc-qualification'),
    mccContextReceipt: optional(args, 'mcc-context-receipt')
  }, mccRunContext));
}

async function runMccResolvePlan(args) {
  const productType = required(args, 'product-type');
  productFor({ ...args, 'product-type': productType });
  const rootIntent = required(args, 'root-intent');
  if (!['onboarding_only', 'full_process'].includes(rootIntent)) {
    throw new Error('root-intent 仅支持 onboarding_only、full_process');
  }
  await startTelemetryRun(rootIntent, productType);
  const mccRunContext = captureMccRunContext();
  const query = required(args, 'query');
  const selected = optional(args, 'select');
  const selectionReceipt = optional(args, 'selection-receipt');
  const selectionState = optional(args, 'selection-state');
  if (args['semantic-terms-json'] !== undefined) {
    throw new Error('mcc-resolve-plan 不再接受 --semantic-terms-json；自然语言只使用一次受限目录判断');
  }
  if ((selected === undefined) !== (selectionReceipt === undefined)) {
    throw new Error('--select 与 --selection-receipt 必须同时提供');
  }
  if (selectionState !== undefined && selectionState !== 'STALE') {
    throw new Error('--selection-state 仅支持 STALE');
  }
  if (selectionState === 'STALE' && selected !== undefined) {
    throw new Error('STALE 选择状态不得继续套用旧选择');
  }
  if (args['agent-mcc-status'] !== undefined || args['agent-mcc-codes'] !== undefined) {
    throw new Error('mcc-resolve-plan 不再接受 --agent-mcc-status 或 --agent-mcc-codes；MCC 匹配只使用本轮动态 catalog');
  }
  const records = recordsForArgs(args);
  const agentReview = parseAgentCandidateRefs(args, records);
  let result = selected === undefined
    ? resolveMccResultFromRecords(query, productType, records, undefined, mccRunContext, agentReview)
    : resolveMccSelection(productType, query, selected, selectionReceipt, records, mccRunContext);
  if (selectionState === 'STALE') {
    result = {
      ...result,
      matchType: result.matchType === 'NONE' ? 'NONE' : 'MULTIPLE',
      semanticStatus: 'SELECTION_RECEIPT_STALE'
    };
  }
  const { candidates: _internalCandidates, ...controlResult } = result;
  process.stderr.write(`ALIPAY_AIPAY_INTERNAL:MCC_RESOLUTION=${JSON.stringify(controlResult)}\n`);
  if (result.matchType === 'UNIQUE') {
    if (result.candidates[0].mccContextReceipt) {
      process.stderr.write(`ALIPAY_AIPAY_INTERNAL:MCC_CONTEXT_RECEIPT=${result.candidates[0].mccContextReceipt}\n`);
    }
    return requireCustomerMessageDelivery(
      'onboarding.plan.confirm',
      renderPlanConfirm(productType, result.candidates[0], mccRunContext)
    );
  }
  if (result.matchType === 'NONE') {
    return renderMessage('onboarding.mcc.no_match', 'DEFAULT', {}, { productType });
  }
  process.stderr.write(`ALIPAY_AIPAY_INTERNAL:MCC_SELECTION_RECEIPT=${createMccSelectionReceipt(productType, query, result, mccRunContext)}\n`);
  return renderMessage('onboarding.mcc.candidates', 'DEFAULT', {
    mccCandidates: result.candidates
  }, { productType, runId: mccRunContext.runId, mccRunId: mccRunContext.runId });
}

async function runMccMatchCodes(args) {
  const productType = required(args, 'product-type');
  productFor({ ...args, 'product-type': productType });
  const rootIntent = required(args, 'root-intent');
  if (!['onboarding_only', 'full_process'].includes(rootIntent)) {
    throw new Error('root-intent 仅支持 onboarding_only、full_process');
  }
  await startTelemetryRun(rootIntent, productType);
  const query = required(args, 'query');
  if (args['semantic-terms-json'] !== undefined) {
    throw new Error('mcc-match-codes 不再接受 --semantic-terms-json；自然语言只使用一次受限目录判断');
  }
  if (args['agent-mcc-status'] !== undefined || args['agent-mcc-codes'] !== undefined) {
    throw new Error('mcc-match-codes 不接受 --agent-mcc-status 或 --agent-mcc-codes；MCC 匹配只使用本轮动态 catalog');
  }
  const records = recordsForArgs(args);
  const agentReview = parseAgentCandidateRefs(args, records);
  const mccRunContext = captureMccRunContext();
  const result = resolveMccResultFromRecords(query, productType, records, undefined, mccRunContext, agentReview);
  const { candidates: _internalCandidates, ...controlResult } = result;
  process.stderr.write(`ALIPAY_AIPAY_INTERNAL:MCC_RESOLUTION=${JSON.stringify(controlResult)}\n`);
  return '';
}

function runMccValidateSelectionCache(args) {
  const productType = required(args, 'product-type');
  productFor({ ...args, 'product-type': productType });
  const records = recordsForArgs(args);
  if (args['semantic-terms-json'] !== undefined) {
    throw new Error('mcc-validate-selection-cache 不再接受 --semantic-terms-json');
  }
  const mccRunContext = captureMccRunContext();
  if (!mccSelectionReceiptCodes(
    productType,
    required(args, 'query'),
    required(args, 'selection-receipt'),
    records,
    mccRunContext
  )) {
    throw new Error('MCC 候选详情缓存与本轮选择回执不一致');
  }
  return '';
}

export function renderDiscoverySummary(productType, input) {
  const product = productFor({ 'product-type': productType });
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
  let fields;
  if (directFieldAliases.has(raw)) fields = directFieldAliases.get(raw);
  else if (category === 'signing' && /签约.*截图/.test(raw)) fields = ['首页截图', '商品页截图', '支付页截图'];
  else if (/首页.*截图/.test(raw)) fields = ['首页截图'];
  else if (/商品.*截图/.test(raw)) fields = ['商品页截图'];
  else if (/支付.*截图/.test(raw)) fields = ['支付页截图'];
  else if (category === 'signing' && /特殊.*资质/.test(raw)) fields = ['特殊资质材料'];
  else if (category === 'signing' && /^(?:截图|三张截图|3张截图)$/.test(raw)) fields = ['首页截图', '商品页截图', '支付页截图'];
  else if (/服务.*价格|服务.*单价/.test(raw)) fields = ['服务单价'];
  else if (/请求.*示例.*JSON/i.test(raw)) fields = ['请求示例JSON'];
  else if (/iOS.*Bundle/i.test(raw)) fields = ['iOS Bundle ID（bundleId）'];
  else if (/Android.*包名/i.test(raw)) fields = ['Android 应用包名（appPackage）'];
  else if (/Android.*签名/i.test(raw)) fields = ['Android 应用签名摘要（appSign）'];

  const allowed = materialFieldsByCategory[category] || [];
  if (!fields || fields.some((field) => !allowed.includes(field))) {
    throw new Error(`材料字段不适用于 ${category}：${raw}；允许字段：${allowed.join('、')}`);
  }
  return fields;
}

function specialQualificationMaterialHint(raw) {
  if (raw === undefined) return '';
  let groups;
  try {
    groups = JSON.parse(raw);
  } catch {
    throw new Error('special-qualification-json 必须是合法 JSON');
  }
  if (!Array.isArray(groups) || groups.length === 0) return '';
  const lines = [
    '特殊资质要求：',
    '- 以下资质组合任选一种；选择某一组合后，必须同时提供该组合内全部所需材料。',
    '- 请先选择一个资质组合；如所选组合包含需上传材料，请【按该组合列出的顺序】提供特殊资质材料。'
  ];
  let renderedGroups = 0;
  for (const [groupIndex, group] of groups.entries()) {
    if (!group || typeof group !== 'object' || !Array.isArray(group.qualifications)) {
      throw new Error('special-qualification-json 每个组合必须包含 qualifications 数组');
    }
    let uploadIndex = 0;
    const parts = group.qualifications.map((qualification) => {
      const qualName = String(qualification?.qualName || '').replace(/[\u0000-\u001f\u007f|`]/gu, ' ').trim();
      if (!qualName) throw new Error('special-qualification-json 存在空资质名称');
      const attaType = qualification?.attaType === null || qualification?.attaType === undefined || qualification?.attaType === ''
        ? ''
        : String(qualification.attaType).replace(/[\u0000-\u001f\u007f|`]/gu, ' ').trim();
      if (!attaType) return `${qualName}（无需上传，按文字条件核验）`;
      uploadIndex += 1;
      return `${qualName}（第 ${uploadIndex} 份特殊资质材料）`;
    });
    if (parts.length === 0) continue;
    renderedGroups += 1;
    lines.push(`- 资质组合 ${groupIndex + 1}：${parts.join(' + ')}`);
  }
  if (renderedGroups === 0) return '';
  lines.push('- 如选择的组合只包含“无需上传”的文字条件，请在回复中说明选择该组合并确认满足该文字条件。');
  return lines.join('\n');
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
  const productType = required(args, 'product-type');
  productFor({ ...args, 'product-type': productType });
  const category = required(args, 'category');
  const categoryName = categoryNames[category];
  if (!categoryName) throw new Error('category 非法，仅支持 signing、service、application');

  const state = required(args, 'state').toUpperCase().replace(/-/g, '_');
  const stateRule = materialStates[state];
  if (!stateRule) throw new Error('state 非法，仅支持 INITIAL、PARTIAL、INVALID、APP_WEB_INITIAL、APP_MOBILE_INITIAL');

  if (state === 'APP_WEB_INITIAL' || state === 'APP_MOBILE_INITIAL') {
    if (category !== 'application') throw new Error(`${state} 只适用于 application 类别`);
    if (state === 'APP_WEB_INITIAL' && productType === 'apppay') {
      throw new Error('APP_WEB_INITIAL 只适用于 aipay、webpay');
    }
    if (state === 'APP_MOBILE_INITIAL' && productType !== 'apppay') {
      throw new Error('APP_MOBILE_INITIAL 只适用于 apppay');
    }
    return renderMessage('materials.category.collect', stateRule.variant, {
      categoryName: '应用资料',
      currentStatus: stateRule.currentStatus,
      missingFields: state === 'APP_WEB_INITIAL' ? '应用公钥' : '应用平台和对应资料、应用公钥'
    }, { productType });
  }

  const input = optional(args, 'missing-fields') !== undefined
    ? { missingFields: args['missing-fields'] }
    : await readStdin();
  const variant = state === 'INITIAL' && category === 'service'
    ? 'SERVICE_INITIAL'
    : stateRule.variant;
  const missingFields = normalizeMissingFields(category, input.missingFields);
  if (category === 'application' && productType !== 'apppay') {
    const incompatibleFields = missingFields.split('、').filter((field) => field !== '应用公钥');
    if (incompatibleFields.length > 0) {
      throw new Error(`${productType} 的应用资料只允许应用公钥`);
    }
  }
  return renderMessage('materials.category.collect', variant, {
    categoryName,
    currentStatus: stateRule.currentStatus,
    missingFields,
    specialQualificationHint: category === 'signing'
      ? specialQualificationMaterialHint(optional(args, 'special-qualification-json'))
      : ''
  }, { productType });
}

function renderApplicationCandidates(applicationType, applicationCandidates, selectionState = 'initial', includeIntro = selectionState === 'initial') {
  const onlineCount = applicationCandidates.filter((candidate) => candidate?.status === 'ON_LINE').length;
  const variant = applicationCandidates.length === 0
    ? 'EMPTY'
    : onlineCount === 0
      ? 'PENDING_ONLY'
      : 'ONLINE_WITH_OPTIONAL_PENDING';
  const candidateFacts = renderMessage('application.candidates.facts', variant, { applicationType, applicationCandidates });
  const facts = includeIntro
    ? `${renderMessage('application.configuration.intro', 'DEFAULT', {})}\n\n${candidateFacts}`
    : candidateFacts;
  if (applicationCandidates.length === 0) return facts;
  const selectionVariant = `${onlineCount === 0 ? 'PENDING' : 'ONLINE'}_${applicationType === 'WEBAPP' ? 'WEB' : 'MOBILE'}_OR_NEW`;
  const selection = renderMessage('application.candidate.select', selectionVariant, {});
  const message = selectionState === 'initial'
    ? `${facts}\n\n${selection}`
    : `${facts}\n\n${renderMessage('application.candidate.invalid', 'DEFAULT', {})}\n\n${selection}`;
  return message;
}

async function runApplicationCandidates(args) {
  const applicationType = required(args, 'application-type');
  if (!['WEBAPP', 'MOBILEAPP'].includes(applicationType)) throw new Error('application-type 非法，仅支持 WEBAPP、MOBILEAPP');
  const selectionState = optional(args, 'selection-state') ?? 'initial';
  if (!['initial', 'invalid'].includes(selectionState)) throw new Error('selection-state 非法，仅支持 initial、invalid');
  const applicationCandidates = optional(args, 'candidates-json') !== undefined
    ? parseJsonArg(args, 'candidates-json', '应用候选输入')
    : await readStdin();
  if (!Array.isArray(applicationCandidates)) throw new Error('应用候选输入必须是 JSON 数组');
  canonicalCandidates(applicationCandidates);
  if (selectionState === 'invalid' && applicationCandidates.length === 0) {
    throw new Error('应用候选为空时不得使用 invalid 选择状态');
  }
  const message = renderApplicationCandidates(applicationType, applicationCandidates, selectionState);
  return applicationCandidates.length === 0
    ? message
    : requireCustomerMessageDelivery('application.candidate.select', message);
}

async function runServiceCandidates(args) {
  const selectionState = optional(args, 'selection-state') ?? 'initial';
  if (!['initial', 'invalid'].includes(selectionState)) {
    throw new Error('selection-state 非法，仅支持 initial、invalid');
  }
  const serviceCandidates = optional(args, 'candidates-json') !== undefined
    ? parseJsonArg(args, 'candidates-json', '服务候选输入')
    : await readStdin();
  if (!Array.isArray(serviceCandidates)) throw new Error('服务候选输入必须是 JSON 数组');
  if (selectionState === 'invalid' && serviceCandidates.length === 0) {
    throw new Error('服务候选为空时不得使用 invalid 选择状态');
  }
  const variant = serviceCandidates.length === 0 ? 'EMPTY' : 'DEFAULT';
  const facts = renderMessage('service.candidates.facts', variant, { serviceCandidates });
  if (serviceCandidates.length === 0) return facts;
  const selection = renderMessage('service.candidate.select', 'DEFAULT', {});
  if (selectionState === 'initial') return `${facts}\n\n${selection}`;
  const invalid = renderMessage('service.candidate.invalid', 'DEFAULT', {});
  return `${facts}\n\n${invalid}\n\n${selection}`;
}

function canonicalCandidates(candidates) {
  if (!Array.isArray(candidates)) throw new Error('应用候选快照必须是 JSON 数组');
  const allowedKeys = new Set(['appId', 'appName', 'status']);
  const seenIds = new Set();
  const rows = candidates.map((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('应用候选快照项必须是 JSON 对象');
    }
    const keys = Object.keys(candidate);
    if (keys.some((key) => !allowedKeys.has(key))
        || !['appId', 'appName', 'status'].every((key) => Object.prototype.hasOwnProperty.call(candidate, key))) {
      throw new Error('应用候选快照项必须且只能包含 appId、appName、status');
    }
    if (![candidate.appId, candidate.appName, candidate.status].every((value) => typeof value === 'string')) {
      throw new Error('应用候选快照字段必须是字符串');
    }
    if (candidate.appId && candidate.appId !== '未知') {
      if (seenIds.has(candidate.appId)) throw new Error(`应用候选快照包含重复 appId: ${candidate.appId}`);
      seenIds.add(candidate.appId);
    }
    return {
      appId: candidate.appId,
      appName: candidate.appName,
      status: candidate.status
    };
  });
  return JSON.stringify(rows.sort((left, right) => {
    const leftValue = JSON.stringify(left);
    const rightValue = JSON.stringify(right);
    return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
  }));
}

async function runApplicationRecheck(args) {
  const applicationType = required(args, 'application-type');
  if (!['WEBAPP', 'MOBILEAPP'].includes(applicationType)) throw new Error('application-type 非法，仅支持 WEBAPP、MOBILEAPP');
  const input = optional(args, 'previous-candidates-json') !== undefined || optional(args, 'current-candidates-json') !== undefined
    ? {
        previousCandidates: parseJsonArg(args, 'previous-candidates-json', '上一轮应用候选快照'),
        currentCandidates: parseJsonArg(args, 'current-candidates-json', '当前应用候选快照')
      }
    : await readStdin();
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('应用候选重查输入必须是 JSON 对象');
  const previousCanonical = canonicalCandidates(input.previousCandidates);
  const currentCanonical = canonicalCandidates(input.currentCandidates);
  // Rendering both snapshots applies the same content and sensitivity checks even on the silent path.
  renderApplicationCandidates(applicationType, input.previousCandidates, 'initial', false);
  const output = renderApplicationCandidates(applicationType, input.currentCandidates, 'initial', false);
  if (previousCanonical === currentCanonical) {
    process.stderr.write(`${internalPrefix}APPLICATION_RECHECK_RESULT=UNCHANGED\n`);
    return '';
  }
  const result = input.currentCandidates.length === 0 ? 'CHANGED_EMPTY' : 'CHANGED_NONEMPTY';
  process.stderr.write(`${internalPrefix}APPLICATION_RECHECK_RESULT=${result}\n`);
  process.stderr.write(`${internalPrefix}APPLICATION_RECHECK_MESSAGE=READY\n`);
  return output;
}

function closeoutInputFromArgs(args) {
  const retiredArgs = [
    'input-json',
    'product-name',
    'process-result-title',
    'application-operation-actual-status',
    'application-operation-app-id',
    'application-operation-next-action',
    'application-operation-app-key-save-path',
    'next-flow-reminder'
  ].filter((name) => Object.prototype.hasOwnProperty.call(args, name));
  if (retiredArgs.length > 0) {
    throw new Error(`closeout 已移除旧参数：${retiredArgs.map((name) => `--${name}`).join('、')}`);
  }
  const productType = required(args, 'product-type');
  const product = productFor({ 'product-type': productType });
  const rootIntent = required(args, 'root-intent');
  if (!['onboarding_only', 'full_process'].includes(rootIntent)) {
    throw new Error('root-intent 非法，仅支持 onboarding_only、full_process');
  }
  if (productType !== 'aipay' && Object.prototype.hasOwnProperty.call(args, 'service-result')) {
    throw new Error('webpay/apppay closeout 的 service-result 由 runner 派生，禁止传入 --service-result');
  }
  if (rootIntent === 'onboarding_only' && Object.prototype.hasOwnProperty.call(args, 'integration-result')) {
    throw new Error('onboarding_only closeout 的 integration-result 由 runner 派生，禁止传入 --integration-result');
  }
  const signingResult = required(args, 'signing-result');
  const applicationResult = required(args, 'application-result');
  const remainingActions = required(args, 'remaining-actions');
  const serviceResult = productType === 'aipay' ? required(args, 'service-result') : '无需处理';
  const integrationResult = rootIntent === 'onboarding_only'
    ? '不在本轮执行范围'
    : required(args, 'integration-result');
  const manualVerificationItems = optional(args, 'manual-verification-items');
  const hasManualVerificationItems = manualVerificationItems !== undefined && manualVerificationItems !== '无';
  const serviceComplete = productType === 'aipay'
    ? ['已复用', '创建成功，状态未取得', '修改成功，状态未取得', '已完成'].includes(serviceResult)
    : true;
  const branchesComplete = signingResult === '已生效'
    && serviceComplete
    && applicationResult === '已上线且配置完整'
    && remainingActions === '无'
    && !hasManualVerificationItems;
  const input = {
    productName: product.productName,
    processResultTitle: branchesComplete ? '支付产品-产品开通已完成' : '流程进展',
    integrationResult,
    signingResult,
    serviceResult,
    applicationResult,
    remainingActions,
    nextFlowReminder: rootIntent === 'onboarding_only'
      ? '还需完成支付产品-代码开发，才能在业务系统中实际发起支付。'
      : '代码开发已在本轮执行；后续只按上表实际待办继续。'
  };
  const optionalMapping = {
    'sandbox-config-state': 'sandboxConfigState',
    'sandbox-summary': 'sandboxSummary',
    'manual-verification-items': 'manualVerificationItems'
  };
  for (const [argName, fieldName] of Object.entries(optionalMapping)) {
    if (Object.prototype.hasOwnProperty.call(args, argName)) input[fieldName] = argName === 'sandbox-summary' ? optional(args, argName) : required(args, argName);
  }
  return input;
}

async function runCloseout(args) {
  const variables = closeoutInputFromArgs(args);
  if (args['product-type'] === 'aipay'
    && ['已复用', '创建成功，状态未取得', '修改成功，状态未取得', '已完成'].includes(args['service-result'])) {
    emitStageMetric('onboarding.confirm_service');
  }
  const rendered = renderMessage('process.partial_result', 'DEFAULT', variables);
  return rendered;
}

function runServiceCreateSummary(args) {
  return renderMessage('service.create.summary', 'DEFAULT', {
    serviceName: required(args, 'service-name'),
    serviceDescription: required(args, 'service-description'),
    serviceUrl: required(args, 'service-url'),
    servicePricing: required(args, 'service-pricing'),
    serviceSchema: required(args, 'service-schema')
  });
}

function runServiceUpdateConfirm(args) {
  return renderMessage('onboarding.write.confirm', 'SERVICE_UPDATE_ONLY', {
    sessionSummary: required(args, 'session-summary'),
    subjectSummary: required(args, 'subject-summary'),
    productName: 'AI 按量付费',
    actionTypes: '服务修改',
    serviceId: required(args, 'service-id'),
    serviceName: required(args, 'service-name'),
    serviceDescription: required(args, 'service-description'),
    serviceUrl: required(args, 'service-url'),
    servicePricing: required(args, 'service-pricing'),
    serviceSchema: required(args, 'service-schema')
  });
}

function runHarmonyManualCreate() {
  return renderMessage('application.harmony.manual_create', 'DEFAULT', {});
}

function runApplicationReuseNoKey(args) {
  return renderMessage('application.reuse.no_key', 'DEFAULT', {
    appId: required(args, 'app-id')
  });
}

function runSigningResult(args) {
  const variables = {
    actualStatus: required(args, 'actual-status'),
    nextAction: required(args, 'next-action')
  };
  const feeDisplay = optional(args, 'fee-display');
  if (feeDisplay !== undefined) variables.feeDisplay = feeDisplay;
  return renderMessage('signing.operation.result', feeDisplay === undefined ? 'WITHOUT_FEE' : 'WITH_FEE', variables);
}

function runServiceResult(args) {
  return renderMessage('service.operation.result', 'DEFAULT', {
    serviceId: required(args, 'service-id'),
    actualResult: required(args, 'actual-result')
  });
}

function runApplicationResult(args) {
  const actualStatus = required(args, 'actual-status');
  if (actualStatus === '需人工配置') {
    if (optional(args, 'next-action') !== undefined) throw new Error('需人工配置的下一步由消息目录固定，不接收 --next-action');
    if (optional(args, 'app-key-save-path') !== undefined) throw new Error('需人工配置表示支付宝公钥未本地保存，禁止传入 --app-key-save-path');
    return requireCustomerMessageDelivery('application.operation.result', renderMessage('application.operation.result', 'ALIPAY_PUBLIC_KEY_MANUAL_CONFIGURATION', {
      appId: required(args, 'app-id'),
      actualStatus
    }));
  }
  const variables = {
    appId: required(args, 'app-id'),
    actualStatus,
    nextAction: required(args, 'next-action')
  };
  const appKeySavePath = optional(args, 'app-key-save-path');
  if (appKeySavePath !== undefined) variables.appKeySavePath = appKeySavePath;
  return requireCustomerMessageDelivery('application.operation.result', renderMessage('application.operation.result', 'DEFAULT', variables));
}

export async function runOnboardingMessageCli(argv = process.argv) {
  const { command, args } = parseArgs(argv);
  if (command === 'platform-entry') {
    const message = runPlatformEntry(args);
    if (message) console.log(message);
    return;
  }
  if (command === 'product-clarify') {
    console.log(runProductClarify());
    return;
  }
  if (command === 'enterprise-unsupported') {
    console.log(runEnterpriseUnsupported(args));
    return;
  }
  if (command === 'mcc-clarify') {
    console.log(await runMccClarify(args));
    return;
  }
  if (command === 'mcc-resolve-plan') {
    const message = await runMccResolvePlan(args);
    if (message) console.log(message);
    return;
  }
  if (command === 'mcc-match-codes') {
    const message = await runMccMatchCodes(args);
    if (message) console.log(message);
    return;
  }
  if (command === 'mcc-validate-selection-cache') {
    const message = runMccValidateSelectionCache(args);
    if (message) console.log(message);
    return;
  }
  if (command === 'plan-confirm') {
    console.log(await runPlanConfirm(args));
    return;
  }
  if (command === 'material-collect') {
    console.log(await runMaterialCollect(args));
    return;
  }
  if (command === 'application-candidates') {
    console.log(await runApplicationCandidates(args));
    return;
  }
  if (command === 'service-candidates') {
    console.log(await runServiceCandidates(args));
    return;
  }
  if (command === 'application-recheck') {
    const message = await runApplicationRecheck(args);
    if (message) console.log(message);
    return;
  }
  if (command === 'closeout') {
    console.log(await runCloseout(args));
    return;
  }
  if (command === 'service-create-summary') {
    console.log(runServiceCreateSummary(args));
    return;
  }
  if (command === 'service-update-confirm') {
    console.log(runServiceUpdateConfirm(args));
    return;
  }
  if (command === 'application-harmony-manual-create') {
    console.log(runHarmonyManualCreate());
    return;
  }
  if (command === 'application-reuse-no-key') {
    console.log(runApplicationReuseNoKey(args));
    return;
  }
  if (command === 'signing-result') {
    console.log(runSigningResult(args));
    return;
  }
  if (command === 'service-result') {
    console.log(runServiceResult(args));
    return;
  }
  if (command === 'application-result') {
    console.log(runApplicationResult(args));
    return;
  }
  throw new Error('用法: onboarding_message_runner.mjs <platform-entry|product-clarify|enterprise-unsupported|mcc-resolve-plan|mcc-match-codes|mcc-validate-selection-cache|plan-confirm|mcc-clarify|material-collect|application-candidates|service-candidates|application-recheck|closeout|service-create-summary|service-update-confirm|application-harmony-manual-create|application-reuse-no-key|signing-result|service-result|application-result> ...');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runOnboardingMessageCli().catch((error) => {
    console.error(`ONBOARDING_MESSAGE_ERROR:${error.message}`);
    process.exitCode = 1;
  });
}
