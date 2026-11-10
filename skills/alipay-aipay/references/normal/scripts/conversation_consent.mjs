import { renderMessage } from './render_customer_message.mjs';
import { setConversationConsent } from './telemetry.mjs';

const internalPrefix = 'ALIPAY_AIPAY_INTERNAL:';

function deliver(messageId) {
  const body = renderMessage(messageId, 'DEFAULT', {});
  if (!body.trim()) throw new Error('采集说明正文为空');
  process.stdout.write(`${body}\n`);
  process.stderr.write(`${internalPrefix}CUSTOMER_MESSAGE_DELIVERY_REQUIRED=${messageId}\n`);
}

// Match complete declarations, never an affirmative substring inside a denial,
// question, condition, quotation, or a description of somebody else's choice.
export function parseConversationConsent(value) {
  if (typeof value !== 'string') return null;
  let text = value.normalize('NFKC').trim();
  text = text.replace(/^【([^【】]+)】([。.!！;；]*)$/u, '$1$2');
  if (!text || /[?？]|吗|么|嘛|是否|能否|可否|如果|假如|除非|前提|只要|也许|可能|不确定|考虑|再说|行吧|随便|或者|还是|先.*再/u.test(text)) return null;
  const clauses = text.split(/[,，。.!！;；\n]|但是|不过|但/u).map(part => part.replace(/\s+/gu, '')).filter(Boolean);
  const subject = '(?:我(?:们)?(?:明确)?|本人)?';
  const actor = '(?:你们|你|支付宝|本Skill|Skill)?';
  const action = '(?:采集|收集|记录)(?:(?:并|和|及)(?:上报|上传|使用))?';
  const object = '(?:(?:我的|我们的|本次|当前)?(?:会话|对话|聊天)(?:信息|内容|记录|数据)?)?';
  const allow = new RegExp(`^${subject}(?:确认|同意|允许|授权|接受|可以)${actor}${action}${object}$`, 'u');
  const deny = new RegExp(`^${subject}(?:不同意|不允许|不授权|不接受|不希望|不想|不愿意|不需要|不要|不用|无需|拒绝|禁止|停止|别|不)${actor}${action}${object}$`, 'u');
  let grant = false;
  let refusal = false;
  let confirm = false;
  for (const clause of clauses) {
    const part = clause.replace(/^请/u, '');
    if (deny.test(part) || /^(?:我)?(?:仅|只)(?:使用|用)(?:内测版Skill|内测版|服务)$/u.test(part)) refusal = true;
    else if (allow.test(part)) grant = true;
    // Short replies refer only to the delivered collection notice, never business approval.
    else if (/^(?:我)?(?:确认|同意)$/u.test(part)) confirm = true;
    else if (/^(?:我)?(?:希望)?继续使用(?:内测版Skill|内测版|服务)$/u.test(part)) continue;
    else return null;
  }
  if (grant && refusal) return null;
  if (refusal) return 'DENIED';
  return grant || confirm ? 'GRANTED' : null;
}

export function runConversationConsentCli(argv = process.argv, {
  decisionMarker = 'CONVERSATION_DECISION',
  noticeId = 'conversation.notice',
  clarifyId = 'conversation.consent.clarify'
} = {}) {
  const action = argv[2];
  if (action === 'notice' && argv.length === 3) return deliver(noticeId);
  if (action === 'consent') {
    const args = new Map();
    for (let i = 3; i < argv.length; i += 2) {
      if (!['--reply', '--input-id'].includes(argv[i]) || args.has(argv[i]) || typeof argv[i + 1] !== 'string') {
        throw new Error('conversation consent 只接受 --reply 与 --input-id');
      }
      args.set(argv[i], argv[i + 1]);
    }
    if (!args.get('--input-id')) throw new Error('conversation consent 缺少 --input-id');
    // A generic business confirmation (1/OK/继续) is not consent to collection.
    const decision = parseConversationConsent(args.get('--reply'));
    if (!decision) {
      process.stderr.write(`${internalPrefix}${decisionMarker}=UNCONFIRMED\n`);
      deliver(clarifyId);
      return;
    }
    const saved = setConversationConsent({ decision, inputId: args.get('--input-id') });
    // Respect the current persisted choice on retries of an earlier reply.
    const effective = saved?.decision || 'UNAVAILABLE';
    const serviceOnly = effective === 'DENIED' || (effective !== 'GRANTED' && decision === 'DENIED');
    process.stderr.write(`${internalPrefix}${decisionMarker}=${serviceOnly ? 'SERVICE_ONLY' : 'CONFIRMED'}\n`);
    process.stderr.write(`${internalPrefix}CONVERSATION_CONSENT=${effective}\n`);
    return;
  }
  throw new Error('用法: runtime.mjs conversation <notice|consent>');
}
