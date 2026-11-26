/**
 * Parse an Alipay subscription schema locally. This never opens the schema or performs network requests.
 * Returned text is untrusted display data; render it with textContent, never innerHTML.
 */
export function parsePaymentLink(input) {
  if (typeof input !== 'string' || !input.trim())
    throw new Error(
      '请粘贴支付宝支付长链或包含 alipay_jump_schema 的返回 JSON。',
    );
  if (new TextEncoder().encode(input).length > 64 * 1024)
    throw new Error('内容超过 64 KiB，请只粘贴支付长链或单次接口返回。');
  let schema = input.trim();
  let response = {};
  if (schema.startsWith('{') || schema.startsWith('[')) {
    response = parseObject(schema, '接口返回 JSON');
    if (!Object.hasOwn(response, 'alipay_jump_schema')) {
      const candidates = Object.values(response).filter(
        (value) =>
          isObject(value) && Object.hasOwn(value, 'alipay_jump_schema'),
      );
      if (candidates.length !== 1)
        throw new Error(
          '返回 JSON 中需要有唯一的 alipay_jump_schema，支持一层响应包装。',
        );
      response = candidates[0];
    }
    schema = stringField(response, 'alipay_jump_schema', '支付长链');
    if (!schema) throw new Error('返回 JSON 中没有有效的 alipay_jump_schema。');
  }
  let url;
  try {
    url = new URL(schema);
  } catch {
    throw new Error('支付或签约长链格式无效，请检查是否完整复制。');
  }
  const signOnly =
    url.protocol === 'https:' &&
    url.hostname === 'render.alipay.com' &&
    url.pathname === '/p/c/mdeduct-landing';
  if (/^https?:$/.test(url.protocol) && !signOnly)
    throw new Error(
      '暂不解析 HTTP/HTTPS 短链，请粘贴 alipay_jump_schema 支付或签约长链。',
    );
  if (
    (!signOnly &&
      (url.protocol !== 'alipays:' ||
        url.hostname !== 'platformapi' ||
        url.pathname !== '/startApp')) ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  ) {
    throw new Error(
      '支付长链格式不支持，请粘贴接口返回的 alipay_jump_schema。',
    );
  }
  const outer = parseParams(url.search.slice(1), '支付长链参数');
  if (signOnly) {
    if (oneParam(outer, 'mode', '签约长链') !== 'next' || outer.has('orderStr'))
      throw new Error('签约长链参数无效。');
  } else if (
    oneParam(outer, 'appId', '支付长链') !== '60000157' ||
    outer.has('scheme')
  ) {
    throw new Error(
      '这不是支持的订阅支付长链，请粘贴接口返回的 alipay_jump_schema。',
    );
  }
  const parameter = signOnly ? 'scheme' : 'orderStr';
  const order = oneParam(outer, parameter, '支付长链');
  if (!order)
    throw new Error(`支付长链缺少 ${parameter}，请检查是否完整复制。`);
  const params = parseParams(order, parameter);
  if (
    signOnly &&
    oneParam(params, 'method', '签约参数') !== 'alipay.user.agreement.page.sign'
  ) {
    throw new Error('签约长链不是订阅协议签约请求。');
  }
  const bizText = oneParam(params, 'biz_content', 'orderStr');
  if (!bizText) throw new Error('支付长链缺少 biz_content，无法读取订阅信息。');
  const biz = parseObject(bizText, 'biz_content');
  const business = nestedObject(biz, 'business_params');
  const saas = nestedObject(business, 'subscriptionSaasInfo');
  const agreement = signOnly ? biz : nestedObject(biz, 'agreement_sign_params');
  const passBack = nestedObject(agreement, 'pass_back_params');
  const subscriptionId = matchingId(
    [
      stringField(saas, 'subscriptionId', '订阅 ID'),
      stringField(passBack, 'subscription_id', '订阅 ID'),
      stringField(response, 'subscription_id', '订阅 ID'),
    ],
    '订阅 ID',
    true,
  );
  const selectionLabel = signOnly ? '签约操作 ID' : '支付单 ID';
  const selectedId = matchingId(
    [
      stringField(
        biz,
        signOnly ? 'external_agreement_no' : 'out_trade_no',
        selectionLabel,
      ),
      stringField(response, 'order_no', selectionLabel),
    ],
    selectionLabel,
    false,
  );
  if (signOnly && !selectedId) throw new Error('签约长链中没有签约操作 ID。');
  if (!selectedId)
    throw new Error('这类链接没有支付单 ID，请手工填写操作 ID 查询签约操作。');
  const amount = stringField(biz, 'total_amount', '支付金额');
  if (amount && !/^\d+(?:\.\d{1,2})?$/.test(amount))
    throw new Error('支付金额格式无效，应为元单位的金额字符串。');
  const expiresAt = matchingText(
    [
      stringField(response, 'schema_effective_end', '链接有效期'),
      stringField(biz, 'time_expire', '链接有效期'),
    ],
    '链接有效期',
  );
  return {
    subscriptionId,
    ...(signOnly
      ? { operationId: selectedId }
      : { paymentOrderId: selectedId }),
    appId: oneParam(params, 'app_id', 'orderStr'),
    productName: stringField(biz, 'subject', '商品名称'),
    amount,
    expiresAt,
  };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseObject(value, label) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} 格式无效，请检查 JSON 是否完整。`);
  }
  if (!isObject(parsed)) throw new Error(`${label} 必须是 JSON 对象。`);
  return parsed;
}

function nestedObject(parent, key) {
  if (
    !Object.hasOwn(parent, key) ||
    parent[key] === null ||
    parent[key] === undefined ||
    parent[key] === ''
  )
    return {};
  if (typeof parent[key] === 'string') return parseObject(parent[key], key);
  if (isObject(parent[key])) return parent[key];
  throw new Error(`${key} 必须是 JSON 对象或 JSON 字符串。`);
}

function stringField(object, key, label) {
  if (
    !Object.hasOwn(object, key) ||
    object[key] === null ||
    object[key] === undefined
  )
    return '';
  if (typeof object[key] !== 'string')
    throw new Error(`${label} 必须是字符串，请勿将长 ID 转成数字。`);
  return object[key];
}

function parseParams(value, label) {
  // URLSearchParams otherwise tolerates broken escapes and replaces malformed UTF-8 silently.
  try {
    decodeURIComponent(value);
  } catch {
    throw new Error(`${label} 的 URI 编码损坏，请重新复制完整长链。`);
  }
  return new URLSearchParams(value);
}

function oneParam(params, key, label) {
  const values = params.getAll(key);
  if (values.length > 1)
    throw new Error(`${label} 包含重复的 ${key}，无法确定要使用的内容。`);
  return values[0] || '';
}

function matchingId(values, label, required) {
  const result = matchingText(values, label);
  if (!result && required) throw new Error(`支付长链中没有${label}。`);
  if (values.some((value) => value && !/^[0-9]{19}$/.test(value)))
    throw new Error(`${label} 必须是 19 位数字字符串。`);
  return result;
}

function matchingText(values, label) {
  const present = values.filter(Boolean);
  if (new Set(present).size > 1)
    throw new Error(`${label}在长链和返回数据中不一致，请核对后重新粘贴。`);
  return present[0] || '';
}

