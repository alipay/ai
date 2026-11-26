import fs from 'node:fs';
import { renderMessage } from './render_customer_message.mjs';
import { setConversationConsent, getConversationConsent, markConversationNotice } from './telemetry.mjs';
import { conversationTelemetryEnabled } from './conversation_telemetry.mjs';

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
  if (!text) return null;
  const clauses = text.split(/[,，。.!！;；\n]|但是|不过|但/u).map(part => part.replace(/\s+/gu, '')).filter(Boolean);
  const subject = '(?:我(?:们)?(?:明确)?|本人)?';
  const actor = '(?:你们|你|支付宝|本Skill|Skill)?';
  const action = '(?:采集|收集|记录)(?:(?:并|和|及)(?:上报|上传|使用))?';
  const object = '(?:(?:我的|我们的|本次|当前)?(?:会话|对话|聊天)(?:信息|内容|记录|数据)?)?';
  const allow = new RegExp(`^${subject}(?:确认|同意|允许|授权|接受|可以)${actor}${action}${object}$`, 'u');
  const refusalVerb = '(?:不同意|不允许|不授权|不接受|不希望|不想|不愿意|不需要|不要|不用(?:了)?|无需|拒绝|禁止|停止)';
  const deny = new RegExp(`^${subject}(?:${refusalVerb}(?:${actor}${action}${object})?|(?:别|不)${actor}${action}${object})$`, 'u');
  let consent = false;
  let refusal = false;
  let acknowledge = false;
  let other = false;
  for (const clause of clauses) {
    const part = clause.replace(/^请/u, '');
    if (deny.test(part) || /^(?:我)?(?:仅|只)(?:使用|用)(?:内测版Skill|内测版|服务)$/u.test(part)) refusal = true;
    else if (allow.test(part) || /^(?:我)?同意$/u.test(part)) consent = true;
    // Short replies refer only to the delivered collection notice, never business approval.
    else if (/^(?:我)?确认$/u.test(part)) acknowledge = true;
    else if (/^(?:我)?(?:希望)?继续使用(?:内测版Skill|内测版|服务)$/u.test(part)) continue;
    // An unrelated request can accompany a refusal. Unresolved privacy language
    // can change the meaning of the choice (e.g. a condition on collection).
    else if (/如果|假如|除非|前提|只要|(?:他说|她说|对方说|用户说|举例|比如|例如)|[“”「」『』"'‘’].*(?:同意|拒绝|允许|授权|采集)|(?:同意|拒绝|允许|授权|采集).*[“”「」『』"'‘’]/u.test(part)) return null;
    else if (/(?:采集|收集|记录|授权)(?:并上报)?(?:(?:我的|本次)?(?:会话|对话|聊天)|数据)|采集|撤回|后悔|改主意|开玩笑|不确定|也许|可能|考虑|再说|随便|反悔/u.test(part)) return null;
    else other = true;
  }
  if (refusal) return consent ? null : 'DENIED';
  return !other && (consent || acknowledge) ? 'GRANTED' : null;
}

export function runConversationConsentCli(argv = process.argv, {
  decisionMarker = 'CONVERSATION_DECISION',
  noticeId = 'conversation.notice',
  clarifyId = 'conversation.consent.clarify'
} = {}) {
  const action = argv[2];
  if (action === 'status' && argv.length === 3) {
    const state = conversationTelemetryEnabled() ? 'LOCAL' : 'DISABLED';
    process.stderr.write(internalPrefix + 'CONVERSATION_CAPTURE=' + state + '\n');
    process.stderr.write(internalPrefix + 'CONVERSATION_CONSENT=' + getConversationConsent() + '\n');
    return;
  }
  if (action === 'notice' && !conversationTelemetryEnabled()) {
    process.stderr.write(internalPrefix + 'CONVERSATION_CAPTURE=DISABLED\n');
    return;
  }
  if (action === 'notice' && argv.length === 3) {
    deliver(noticeId);
    if (!markConversationNotice()) process.stderr.write(internalPrefix + 'CONVERSATION_CONSENT=UNAVAILABLE\n');
    return;
  }
  if (action === 'consent') {
    const args = new Map();
    for (let i = 3; i < argv.length; i++) {
      const key = argv[i];
      if (!['--reply', '--reply-stdin', '--input-id'].includes(key) || args.has(key)) {
        throw new Error('无效或重复的采集选择参数');
      }
      if (key === '--reply-stdin') args.set(key, true);
      else {
        const value = argv[++i];
        if (!value || value.startsWith('--')) throw new Error('采集选择参数缺少值');
        args.set(key, value);
      }
    }
    if (!args.get('--input-id') || args.has('--reply') === args.has('--reply-stdin')) {
      throw new Error('需要 --input-id 和一种采集选择输入方式');
    }
    const reply = args.has('--reply-stdin') ? fs.readFileSync(0, 'utf8') : args.get('--reply');
    const decision = parseConversationConsent(reply);
    if (!decision) {
      process.stderr.write(`${internalPrefix}${decisionMarker}=UNCONFIRMED\n`);
      deliver(clarifyId);
      return;
    }
    const saved = setConversationConsent({ decision, inputId: args.get('--input-id') });
    // Respect the current persisted choice on retries of an earlier reply.
    const effective = saved?.decision || 'UNAVAILABLE';
    const outcome = { DENIED: 'SERVICE_ONLY', GRANTED: 'CONFIRMED', UNSET: 'UNCONFIRMED' };
    process.stderr.write(`${internalPrefix}${decisionMarker}=${outcome[effective] ?? 'UNAVAILABLE'}\n`);
    process.stderr.write(`${internalPrefix}CONVERSATION_CONSENT=${effective}\n`);
    return;
  }
  throw new Error('用法: runtime.mjs conversation <status|notice|consent>');
}
