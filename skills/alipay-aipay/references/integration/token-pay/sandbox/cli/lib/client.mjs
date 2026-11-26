export const ORIGIN = 'https://subscription.dl.alipaydev.com';
export const PREFIX = '/subscribecore/api/sandbox/cashier';
export class CliError extends Error {
  constructor(code, message, exitCode = 3, details = {}) {
    super(message); Object.assign(this, { code, exitCode, details });
  }
}
export function requireValue(condition, message, code = 'INVALID_ARGUMENT', exitCode = 2) {
  if (!condition) throw new CliError(code, message, exitCode);
}
export const id = v => typeof v === 'string' && /^\d{19}$/.test(v);
export const merchant = v => typeof v === 'string' && /^\d{16}$/.test(v);
export const operationId = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(v);
export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) =>
    [k, /private.?key|public.?key|secret|token|authorization|signature|^sign$|jump_schema|alipay_schema|cookie/i.test(k) ? '[REDACTED]' : redact(v)]));
  if (typeof value === 'string') {
    // Message bodies may themselves be JSON or form-encoded notifications.
    if (/^\s*[\[{]/.test(value)) { try { return JSON.stringify(redact(JSON.parse(value))); } catch {} }
    return value.replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, '[REDACTED]')
      .replace(/(?:https?:\/\/|alipays:\/\/)[^\s"<>]+/g, '[REDACTED]')
      .replace(/((?:sign|token|secret|private_key|authorization)(?:=|%3[dD]))[^&\s]+/gi, '$1[REDACTED]');
  }
  return value;
}
export class SandboxClient {
  constructor({ fetchImpl = globalThis.fetch, merchantId, timeout = 35000 } = {}) {
    this.fetch = fetchImpl; this.merchantId = merchantId; this.timeout = timeout;
  }
  async call(path, body, { authorization = false } = {}) {
    const mutation = body !== undefined;
    let response, envelope;
    try {
      response = await this.fetch(ORIGIN + (authorization ? '' : PREFIX) + path, {
        method: mutation ? 'POST' : 'GET', redirect: 'error', credentials: 'omit',
        headers: { Accept: 'application/json', ...(mutation ? { 'Content-Type': 'application/json' } : {}),
          ...(this.merchantId ? { 'X-Sandbox-Merchant-Id': this.merchantId } : {}) },
        ...(mutation ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(this.timeout),
      });
      // Do not print HTML, gateway bodies, credentials, or arbitrary upstream errors.
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Invalid content type');
      envelope = await response.json();
    } catch {
      throw new CliError(mutation ? 'OUTCOME_UNKNOWN' : 'TRANSPORT_ERROR',
        mutation ? '写请求结果未知，请先查询同一资源；不要直接重试。' : '无法取得有效沙箱响应。', mutation ? 4 : 3,
        { nextAction: mutation ? 'QUERY_BEFORE_RETRY' : 'CHECK_CONNECTIVITY' });
    }
    if (!response.ok || envelope?.success !== true) {
      const raw = envelope?.error?.code || envelope?.resultCode;
      const code = typeof raw === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(raw) ? raw : 'SANDBOX_REQUEST_FAILED';
      throw new CliError(code, '沙箱请求未成功；按错误码核对状态。', mutation ? 4 : 3,
        { httpStatus: response.status, nextAction: mutation ? 'QUERY_BEFORE_RETRY' : 'INSPECT_CONFIGURATION' });
    }
    requireValue(envelope.data && typeof envelope.data === 'object' && !Array.isArray(envelope.data), '沙箱响应缺少数据。', 'INVALID_RESPONSE', mutation ? 4 : 3);
    return envelope.data;
  }
  async health() {
    const value = await this.call('/health');
    requireValue(value.environment === 'sandboxstable' && value.version === '1', '沙箱环境或协议版本不匹配。', 'ENVIRONMENT_MISMATCH', 3);
    return value;
  }
  async identify(subscriptionId) {
    requireValue(id(subscriptionId), '订阅 ID 必须是 19 位数字字符串。');
    const data = await this.call(`/subscriptions/${subscriptionId}/identity`);
    requireValue(data.subscriptionId === subscriptionId && merchant(data.merchantId) && data.environment === 'sandboxstable' && data.version === '1', '订阅归属响应不匹配。', 'INVALID_RESPONSE', 3);
    requireValue(!this.merchantId || data.merchantId === this.merchantId, '订阅不属于指定商户。', 'MERCHANT_MISMATCH', 3);
    this.merchantId = data.merchantId;
    return data;
  }
  async subscription(subscriptionId, suffix = '', body) {
    const value = await this.call(`/subscriptions/${subscriptionId}${suffix}`, body);
    requireValue(value.subscriptionId === subscriptionId && (value.merchantId == null || value.merchantId === this.merchantId), '返回资源与请求不匹配。', 'INVALID_RESPONSE', body === undefined ? 3 : 4);
    return value;
  }
}
export function validateOperation(view, selection, allowAlias = false) {
  const alias = allowAlias && selection?.type === 'operationId' && selection.id === view.subscriptionId
    && view.externalAgreementNo === view.subscriptionId && view.action === 'SIGN_ONLY' && view.scenario === 'REVERT_CANCEL' && operationId(view.operationId);
  requireValue(typeof view.canConfirm === 'boolean' && typeof view.simulated === 'boolean' && typeof view.subscriptionStatus === 'string'
    && ['PAY', 'PAY_AND_SIGN', 'SIGN_ONLY'].includes(view.action), '操作响应不完整。', 'INVALID_RESPONSE', 3);
  if (selection) requireValue((alias || view[selection.type] === selection.id)
    && (selection.type !== 'operationId' || view.action === 'SIGN_ONLY' && !view.paymentOrderId), '返回操作与指定操作不匹配。', 'OPERATION_MISMATCH', 3);
  requireValue(view.action !== 'SIGN_ONLY' || operationId(view.operationId) && !view.paymentOrderId && view.amountMinor === '0', '仅签约响应不符合契约。', 'INVALID_RESPONSE', 3);
  requireValue(typeof view.amountMinor === 'string' && /^\d+$/.test(view.amountMinor) && view.currency === 'CNY'
    && operationId(view.action === 'SIGN_ONLY' ? view.operationId : view.paymentOrderId), '操作单号或金额无效。', 'INVALID_RESPONSE', 3);
  return view;
}
export function validateClock(value) {
  requireValue(value.scope === 'SUBSCRIPTION' && typeof value.bound === 'boolean'
    && Number.isSafeInteger(value.version) && value.version >= 0 && Number.isSafeInteger(value.frozenTime) && value.frozenTime > 0
    && (!value.bound || ['READY', 'ADVANCING', 'FAILED'].includes(value.status))
    && (!['ADVANCING', 'FAILED'].includes(value.status) || operationId(value.operationId) && Number.isSafeInteger(value.targetTime)),
    '时钟必须是有效的订阅维度快照。', 'INVALID_CLOCK', 3);
  return value;
}
