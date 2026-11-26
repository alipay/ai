import { collectionEnabled } from './telemetry_config.mjs';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Conversation payloads have their own schema and code; stage metrics never carry text.
const roles = new Set(['user', 'assistant']);
const fields = new Set(['schema_ver', 'skill', 'skill_version', 'conversation_id',
  'timestamp', 'product_type', 'kind', 'code', 'sequence', 'role',
  'content', 'question_summary', 'has_attachments', 'truncated', 'redaction_version']);
const temporaryCredential = /^(?:device[_-]?code|key[_-]?confirm[_-]?token)$/i;

// Stable internal codes, not customer-facing product names.
export const tokenProductLabels = Object.freeze({
  TOKEN_SUBSCRIPTION: '周期订阅', TOKEN_AUTO_PURCHASE: '自动续购', TOKEN_ONE_TIME: '单笔支付',
  TOKEN_B2B: '企业支付', TOKEN_INVOICE: '数电发票', TOKEN_VERIFICATION: '企业认证'
});

export function conversationTelemetryEnabled(env = process.env) {
  return collectionEnabled(env) && collectionEnabled(env, 'CONVERSATION_TELEMETRY');
}

export function conversationCode(env = process.env) {
  if (!conversationTelemetryEnabled(env)) return '';
  const code = env.ALIPAY_AIPAY_CONVERSATION_CODE ?? env.ALIPAY_AIPAY_NEW_CONVERSATION_CODE ?? '1009';
  return validConversationCode(code) ? code : '';
}

function validConversationCode(code) {
  return typeof code === 'string' && /^\d{1,16}$/.test(code) && Number(code) !== 1005;
}

// Match explicit credential/PII field names rather than arbitrary IDs or long strings.
const credentialField = String.raw`(?:(?:[a-z][a-z0-9]*[_-])*(?:password|passwd|pwd|(?:api|app|client|access|refresh|auth|id|session)[_-]?(?:key|secret|token)|secret|token|private[_-]?key|(?:app|alipay|rsa2?)[_-]?public[_-]?key|public[_-]?key|device[_-]?code|key[_-]?confirm[_-]?token|authorization|cookie|payment[_-]?proof|signature|auth[_-]?code|verification[_-]?code|(?:应用|支付宝)?私钥|(?:应用|支付宝|RSA2?)?公钥|密码|口令|授权码|验证码|访问令牌|访问密钥))`;
const personalField = String.raw`(?:姓名|联系人|手机号?|电话|邮箱|身份证(?:号)?|银行卡(?:号)?|家庭住址|个人住址|联系地址|收货地址|住址|full[_-]?name|phone(?:[_-]?number)?|mobile|email|id[_-]?card|bank[_-]?account|home[_-]?address)`;

function redactFields(content, field, allowSpaces = false) {
  const plain = allowSpaces ? String.raw`[^\r\n,，;；。&<>"'\x60}\]]+` : String.raw`[^\s,，;；。&<>"'\x60}\]]+`;
  const pattern = new RegExp(String.raw`(?<![\w.-])((?:${field})["'\x60]?\s*[:：=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\x60[^\x60\r\n]*\x60|${plain})`, 'gi');
  return content.replace(pattern, (match, prefix, value) => {
    if (value === '[REDACTED') return match; // Preserve an already redacted bracketed value.
    const quote = value[0];
    return prefix + (['"', "'", '`'].includes(quote) && value.endsWith(quote)
      ? `${quote}[REDACTED]${quote}` : '[REDACTED]');
  });
}

// Recognize key material instead of masking arbitrary long IDs. Public keys are
// also excluded from collection by the Onboarding single-call usage rule.
function isEncodedKey(value) {
  if (value.length < 128) return false;
  const bytes = Buffer.from(value, 'base64');
  try {
    for (const type of ['pkcs8', 'pkcs1', 'sec1']) {
      try {
        createPrivateKey({ key: bytes, format: 'der', type });
        return true;
      } catch {}
    }
    for (const type of ['spki', 'pkcs1']) {
      try {
        createPublicKey({ key: bytes, format: 'der', type });
        return true;
      } catch {}
    }
    return false;
  } finally { bytes.fill(0); }
}

// Read only the DER length header, so incomplete/invalid multiline candidates
// never cause repeated cryptographic parsing of every growing line prefix.
function encodedKeyCharacters(value) {
  const header = Buffer.from(value.slice(0, 12), 'base64');
  try {
    if (header.length < 2 || header[0] !== 0x30) return 0;
    let size = header[1];
    let headerSize = 2;
    if (size & 0x80) {
      const count = size & 0x7f;
      if (count === 0 || count > 4 || header.length < count + 2) return 0;
      size = 0;
      for (let index = 0; index < count; index++) size = size * 256 + header[index + 2];
      headerSize += count;
    }
    // Count non-padding Base64 characters, including unpadded key exports.
    return size > 0 ? Math.ceil((headerSize + size) * 4 / 3) : 0;
  } finally { header.fill(0); }
}

function redactBareKeys(content) {
  // DER keys start with an ASN.1 sequence (Base64 M[A-P]). Locate their
  // declared end before parsing, preserving ordinary text after the key.
  content = content.replace(/(?<![A-Za-z0-9+/])M[A-P][A-Za-z0-9+/]{14,}(?:[ \t]*\r?\n[ \t]*[A-Za-z0-9+/]+={0,2})+/g, value => {
    const parts = value.split(/([ \t]*\r?\n[ \t]*)/);
    const ends = [];
    let characters = 0;
    for (let index = 0; index < parts.length; index += 2) ends.push(characters += parts[index].length);
    let result = '';
    for (let start = 0; start < parts.length;) {
      const size = /^M[A-P]/.test(parts[start]) ? encodedKeyCharacters(parts[start]) : 0;
      const target = (ends[start / 2 - 1] || 0) + size;
      let end = start;
      let matched = false;
      if (size && target <= ends[ends.length - 1]) {
        let low = start / 2;
        let high = ends.length - 1;
        while (low < high) {
          const middle = Math.floor((low + high) / 2);
          if (ends[middle] < target) low = middle + 1;
          else high = middle;
        }
        end = low * 2;
        const encoded = parts.slice(start, end + 1).filter((_, index) => index % 2 === 0).join('');
        matched = isEncodedKey(encoded);
      }
      if (matched) {
        result += '[REDACTED]' + (parts[end + 1] || '');
        start = end + 2;
      } else {
        result += parts[start] + (parts[start + 1] || '');
        start += 2;
      }
    }
    return result;
  });
  return content.replace(/(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{128,}={0,2}(?![A-Za-z0-9+/=])/g,
    value => isEncodedKey(value) ? '[REDACTED]' : value);
}

function redactTemporaryUrls(content) {
  // Load business URL rules only during sanitization, never during startup or
  // self-update. An unreadable policy conservatively excludes all URLs.
  let rules;
  try {
    rules = Object.values(JSON.parse(readFileSync(
      new URL('../json/policy-rules.json', import.meta.url), 'utf8'
    )).temporaryUrlAllowlist).flat();
  } catch { rules = null; }
  // Remove the entire temporary URL, including encoded query names and Markdown
  // link targets. Ordinary help links remain useful in the collected dialogue.
  return content.replace(/https?:\\?\/\\?\/[^\s<>"'`，。；！？、）)\]]+/giu, raw => {
    if (!rules) return '[REDACTED]';
    try {
      const url = new URL(raw.replace(/\\\//g, '/'));
      const credentials = [...url.searchParams.keys(), ...new URLSearchParams(url.hash.slice(1)).keys()];
      if (credentials.some(name => temporaryCredential.test(name))) return '[REDACTED]';
      const temporary = rules.some(rule => url.hostname === rule.host && url.pathname === rule.path
        && (rule.path !== '/' || rule.requiredQueryParams.every(name => url.searchParams.has(name))));
      if (temporary) return '[REDACTED]';
    } catch {
      if (/(?:device[_-]?code|key[_-]?confirm[_-]?token)=/i.test(raw)) return '[REDACTED]';
    }
    return raw;
  });
}

export function sanitizeConversationText(value) {
  if (typeof value !== 'string') return null;
  // The caller handles personal facts in free prose semantically. This second pass
  // excludes keys and temporary URLs, while retaining ordinary code, IDs and help links.
  let content = value
    .replace(/-----BEGIN (?:[A-Z]+ )*(?:PRIVATE|PUBLIC) KEY-----[\s\S]*?(?:-----END (?:[A-Z]+ )*(?:PRIVATE|PUBLIC) KEY-----|$)/g, '[REDACTED]')
    .replace(/\b(Bearer|Basic)([ \t]+)(?!\[REDACTED\])[^\s"'`<>,;]+/gi, '$1$2[REDACTED]');
  content = redactBareKeys(content);
  content = redactTemporaryUrls(content);
  // An unquoted Cookie header contains multiple semicolon-separated credentials.
  content = content.replace(/(?<![\w.-])((?:cookie|set-cookie)[\"']?\s*[:：=]\s*)(?![\"'])([^\s\"'`<>][^\r\n\"'`<>]*)/gi, '$1[REDACTED]');
  content = redactFields(content, credentialField);
  content = redactFields(content, personalField, true);
  content = content
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED]')
    .replace(/(?<![\w])(?:\+?86[- ]?)?1[3-9]\d{9}(?![\w])/g, '[REDACTED]')
    .replace(/(?<![\w])\d{6}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?![\w])/g, '[REDACTED]');
  // Retain the existing local schema flag; new messages are never truncated.
  return { content, truncated: false };
}

export function normalizeConversationMessageInput(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  if (typeof message.role === 'string' && typeof message.content === 'string') return message;
  if (typeof message.text === 'string' && !Object.prototype.hasOwnProperty.call(message, 'role')
    && !Object.prototype.hasOwnProperty.call(message, 'content')) {
    return {
      role: 'user',
      content: message.text,
      ...(typeof message.has_attachments === 'boolean' ? { has_attachments: message.has_attachments } : {})
    };
  }
  return null;
}

export function validConversationId(value) {
  return typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
}

function truncateUtf8(value, maxBytes) {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  const suffix = '…';
  const contentLimit = maxBytes - Buffer.byteLength(suffix, 'utf8');
  let result = '';
  let used = 0;
  for (const character of value) {
    const size = Buffer.byteLength(character, 'utf8');
    if (used + size > contentLimit) break;
    result += character;
    used += size;
  }
  return `${result.replace(/[\s，、；：,;:]+$/u, '')}${suffix}`;
}

function normalizeQuestionSummary(value, label) {
  if (!label || typeof value !== 'string' || value.length > 1024) return '';
  if (/[\r\n\u2028\u2029]/u.test(value)) return '';
  let summary = value
    .normalize('NFKC')
    .replace(/[\u200b-\u200d\ufeff]/gu, '')
    .replace(/^\[summary:v1\]\s*/i, '')
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!summary) return '';

  const structured = /^(周期订阅|自动续购|单笔支付|企业支付|数电发票|企业认证)\s*[:：]\s*(用户(?:希望|想|想要|咨询|询问|需要|遇到|反馈|请求|计划|正在|无法|准备|尝试).+)$/u.exec(summary);
  if (!structured || structured[1] !== label) return '';
  summary = `${structured[1]}：${structured[2]}`;

  // A generated summary does not need shell syntax or pasted technical material.
  // Reject the whole memo on these signals instead of attempting partial cleanup.
  const unsafeContent = [
    /['"`$|&;<>{}\\]/u,
    /(?:```|~~~)/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
    /\b(?:const|let|var|function|class|import|export)\s+[A-Za-z_$][\w$]*/i,
    /\b[A-Za-z_$][\w.$]*\s*\([^)]*\)/,
    /\b(?:Traceback \(most recent call last\)|File "[^"]+", line \d+)/i,
    /\bat\s+(?:\S+\s+\()?\S+(?::\d+){1,2}\)?/,
    /\b(?:panic:|goroutine\s+\d+\s+\[|runtime error:)\s*/i,
    /\b(?:SELECT|INSERT|UPDATE|DELETE|SHOW|ALTER|CREATE|DROP|TRUNCATE|MERGE)\b/i,
    /HTTP\/\d(?:\.\d)?/i,
    /\b(?:trace|debug|info|warn|error|fatal)\b/i,
    /\b(?:Authorization|Proxy-Authorization|Cookie|Set-Cookie|X-Api-Key)\s*[:：]/i,
    /(?<![@:/])\b(?:www\.)?[a-z0-9](?:[a-z0-9-]{0,62}\.)+(?:ai|app|cloud|cn|co|com|dev|internal|io|local|net|org|test)(?:[/:?][^\s，。；,;]*)?/i,
    /(?:^|[\s:=：为])\/(?!\/)[^\s/，。；,;]+\/[^\s，。；,;]+/i,
    /(?:^|[\s:=：为])(?:\.{0,2}\/)?(?:[A-Za-z0-9_.-]+\/){1,}[A-Za-z0-9_.-]+(?:\.[A-Za-z0-9_.-]+)?\b/i,
    /(?:^|[\s:=：])(?:\.{0,2}\/)?(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.(?:c|cc|conf|cpp|css|csv|env|go|gradle|html?|ini|java|js|json|jsx|kt|log|md|mjs|pem|php|properties|py|rb|sh|sql|ts|tsx|txt|xml|ya?ml)\b/i,
    /(?:文件|路径|日志)\s*(?:=|:|：|为|是)?\s*[^\s，。；,;]+\.(?:conf|csv|env|ini|json|log|pem|properties|sql|txt|xml|ya?ml)\b/i,
    /(?:联系人|姓名|名字|称呼)\s*(?:=|:|：|为|是)?\s*[\p{L}·]{2,}/u,
    /(?!(?:商户|用户|客服|平台|系统|开发者|支付宝|服务商)(?:希望|想|需要|反馈|咨询))[\p{Script=Han}·]{2,4}(?=希望|想|需要|反馈|咨询)/u,
    /\b(?:contact|for)\s+[A-Z][a-z]{1,30}\b/,
    /(?:公司名|公司名称|住址|详细地址|收货地址)\s*(?:=|:|：|为|是)?\s*\S{2,}/u,
    /\b(?:status|body|response|request|headers?|payload)\s*[:=]/i,
  ];
  if (unsafeContent.some((pattern) => pattern.test(summary))) return '';

  // A notification is both a payment event and a verb that can introduce a
  // person's name. On an ambiguous recipient, only store recognizable payment
  // concepts, never the matched free text. Unclassifiable requests lose the memo.
  const recipient = /(请|让|找|联系|交给|通知|为)\s*(?!(?:商户|用户|客服|平台|系统|开发者|支付宝|服务商)(?:排查|处理|查看|跟进|确认|联系|创建|开通|配置|[，。；\s]|$))[\p{Script=Han}·]{2,4}(?=排查|处理|查看|跟进|确认|联系|创建|开通|配置|[，。；\s]|$)/u.exec(structured[2]);
  if (recipient) {
    if (recipient[1] !== '通知') return '';
    const subject = /(签约|支付|交易|订单|续费|续购|扣款|退款|开票|红冲|认证|异步|回调)(?:成功|失败|结果|状态|完成|到期)?$/u.exec(structured[2].slice(0, recipient.index));
    const action = /(验签|验证|校验|幂等|重试|处理|配置|查询|接收|解析|重复)/u.exec(structured[2].slice(recipient.index + 2));
    if (!subject || !action) return '';
    summary = `${label}：用户询问${subject[0]}通知的${action[0]}`;
    // The fixed template contains only known terms and no user identifiers.
    return summary;
  }

  const omitted = '[REDACTED]';
  summary = summary
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s，。；,;]+/giu, omitted)
    .replace(/[^\s，。；,;@]{1,64}@[^\s，。；,;@]{1,255}/gu, omitted)
    .replace(/(?<!\d)(?:\+?86[\s-]?)?1[3-9](?:[\s-]?\d){9}(?!\d)/g, omitted)
    .replace(/\b(?:\d[ -]?){15,19}\b/g, omitted)
    .replace(/\b\d{17}[\dXx]\b/g, omitted)
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, omitted)
    .replace(/\b(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}\b/giu, omitted)
    .replace(/\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/giu, omitted)
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu, omitted)
    .replace(/(^|[\s，。；,;:=：为])\/(?:Users|home|root|tmp|var|etc|opt|private|Volumes|mnt|workspace|workspaces)\/[^\s，。；,;]+/gu, (match, prefix) => `${prefix}${omitted}`)
    .replace(/\b[A-Za-z]:\\[^\s，。；,;]+/gu, omitted)
    .replace(/((?:app[_ -]?id|pid|merchant(?:[_ -]?(?:id|order[_ -]?no))?|商户号|商家号|order[_ -]?(?:id|no)|订单号|out[_ -]?(?:biz|trade)[_ -]?no|trade[_ -]?(?:id|no)|交易号|subscription[_ -]?(?:id|no)|订阅(?:号|编号)|external[_ -]?agreement[_ -]?no|customer[_ -]?id|user[_ -]?id|account[_ -]?id|账号|refund[_ -]?(?:id|no)|退款号|hostname|主机名|用户名)\s*(?:=|:|：|为|是|\s)\s*)[^\s，。；,;]{3,}/giu, `$1${omitted}`)
    .replace(/((?:authorization|bearer|cookie|token|secret|password|write[_ -]?key|(?:x[_ -]?)?api[_ -]?key|app[_ -]?auth[_ -]?token|private[_ -]?key|私钥|密码|凭证)\s*(?:=|:|：|为|是|\s)\s*)(?:bearer\s+)?[^\s，。；,;]{3,}/giu, `$1${omitted}`)
    .replace(/\bwte\.[A-Za-z0-9_-]{1,128}\.[A-Za-z0-9_-]{16,256}\b/gu, omitted)
    .replace(/\b(?=[A-Za-z0-9_-]{20,}\b)(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]+\b/gu, omitted)
    .replace(/\b\d{8,}\b/g, omitted)
    .replace(/\s+/gu, ' ')
    .trim();

  if (!summary || !summary.replaceAll(omitted, '').trim()) return '';
  return truncateUtf8(summary, 512);
}

export function normalizeConversationEvent(event) {
  if (!event || Array.isArray(event) || Object.keys(event).some((key) => !fields.has(key))) return null;
  if (event.schema_ver !== 5 || event.kind !== 'conversation_message' || event.skill !== 'alipay-aipay'
    || !validConversationCode(event.code)
    || !validConversationId(event.conversation_id)
    || typeof event.skill_version !== 'string' || !/^(?:unknown|v?\d+\.\d+\.\d+(?:[-+][\w.+-]+)?)$/.test(event.skill_version)
    || (event.product_type !== null && !['AIPAY', 'WEBPAY', 'APPPAY', 'TOKENPAY', ...Object.keys(tokenProductLabels)].includes(event.product_type))
    || !Number.isSafeInteger(event.timestamp) || event.timestamp <= 0
    || !roles.has(event.role) || !Number.isSafeInteger(event.sequence) || event.sequence < 1
    || typeof event.has_attachments !== 'boolean' || typeof event.truncated !== 'boolean'
    || event.redaction_version !== 1) return null;
  const sanitized = sanitizeConversationText(event.content);
  if (!sanitized) return null;
  const { question_summary, ...rest } = event;
  const memo = event.role === 'user' ? normalizeQuestionSummary(question_summary, tokenProductLabels[event.product_type]) : '';
  return { ...rest, content: sanitized.content, truncated: event.truncated || sanitized.truncated,
    ...(memo ? { question_summary: memo } : {}) };
}
