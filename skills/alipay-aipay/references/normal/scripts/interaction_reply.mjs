#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const internalPrefix = 'ALIPAY_AIPAY_INTERNAL:';
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const catalogPath = path.resolve(scriptDir, '../json/customer-messages.json');
const questionPattern = /[?？]|(?:吗|么|嘛|呢)$|是否|能否|可否|要不要|是不是|好了吗|完成了吗|为什么|为何|怎么|怎样|如何|什么意思|什么(?:方式|时候)?|哪个|哪种|何时|什么时候|多少|可不可以|能不能|行不行/u;
const englishQuestionPattern = /\b(?:can|could|would|should|why|how|what|when|whether)\b/iu;
const uncertaintyPattern = /可能|大概|也许|或许|不确定|说不好|看情况|再看看|考虑一下|好像|似乎|应该|有风险|有问题|担心|顾虑/u;
const englishUncertaintyPattern = /\b(?:maybe|perhaps|probably|possibly|unsure)\b/iu;
const rejectionPattern = /(?:不(?:是|需要|要|用|必|能|可|再)?|别|无(?:需|须|法))(?:再)?(?:继续|推进|执行|处理|开始|提交|确认|同意|允许|批准|创建|操作|往下|下一步|通过|完成)|不可以|不行|不同意|不确认|不允许|不批准|不通过|未确认|未完成|未通过|没(?:有)?完成|还没(?:有)?(?:好|完成|确认|准备)|拒绝|取消|停止|暂停|稍后|晚点|待会|等一下|等等|算了|否定/u;
const englishRejectionPattern = /\b(?:no|nope|not|don't|do\s+not|stop|cancel|wait|change)\b/iu;
const conditionalOrChangePattern = /如果|假如|要是|除非|只要|之后再|以后再|但是|不过|只是|前提|再说|(?:修改|调整|改一下|改成|换成|重选|重新选择)|先.{0,20}(?:再|然后)/u;
const affirmativeIntentPattern = /继续|推进|执行|开始|确认(?:无误)?|确定|同意|允许|批准|可以|没(?:有)?问题|无异议|通过|(?:已经|已)(?:完成|好了)|完成(?:了)?|搞定(?:了)?|弄好了|处理好了|就这么办|往下(?:走|做)|下一步|按(?:此|这个|该|当前)(?:方案)?(?:做|办|执行|推进|处理)|照(?:此|这个|该|当前)(?:方案)?(?:做|办|执行|推进|处理)/u;
const englishAffirmativeIntentPattern = /\b(?:ok(?:ay)?|yes|confirm(?:ed)?|continue|proceed|approve(?:d)?|go\s+ahead)\b/iu;
const simpleAffirmativePattern = /^(?:行|行的|行吧)$/u;
const englishAffirmativeReplies = new Set(['ok', 'okay', 'yes', 'y']);
const safePrefixes = ['那么就', '那就', '麻烦', '烦请', '嗯嗯', '好的', '我们', '请', '那', '就', '嗯', '我'];
const safeSuffixes = ['谢谢', '就行', '即可', '吧', '呀', '啊', '哈', '了'];

function affirmativeReplies() {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const replies = catalog.interactionReplySets?.affirmative;
  if (!Array.isArray(replies) || replies.length === 0 || replies.some((reply) => typeof reply !== 'string' || !reply)) {
    throw new Error('customer-messages affirmative 回复集合无效');
  }
  return new Set(replies.map(normalizeAffirmativeReply));
}

export function normalizeAffirmativeReply(value) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKC')
    .trim()
    .replace(/[。！!]+$/gu, '')
    .trim()
    .toLowerCase();
}

export function isAffirmativeReply(value) {
  const normalized = normalizeAffirmativeReply(value);
  if (normalized === '') return false;
  const replies = affirmativeReplies();
  let compact = normalized.replace(/[\s,，.。!！、;；:：]+/gu, '');
  const intentText = compact
    .replace(/(?:不需要|无需|不用)(?:再)?(?:修改|调整|改动|改|确认)/gu, '无异议')
    .replace(/没(?:有)?问题/gu, '无异议');
  if (
    questionPattern.test(intentText)
    || englishQuestionPattern.test(normalized)
    || uncertaintyPattern.test(intentText)
    || englishUncertaintyPattern.test(normalized)
    || rejectionPattern.test(intentText)
    || englishRejectionPattern.test(normalized)
    || conditionalOrChangePattern.test(intentText)
  ) return false;
  if (
    replies.has(normalized)
    || replies.has(compact)
    || simpleAffirmativePattern.test(compact)
    || affirmativeIntentPattern.test(compact)
    || englishAffirmativeIntentPattern.test(normalized)
  ) return true;

  let changed = true;
  while (changed && compact) {
    changed = false;
    for (const prefix of safePrefixes) {
      if (compact.startsWith(prefix)) {
        compact = compact.slice(prefix.length);
        changed = true;
        break;
      }
    }
    for (const suffix of safeSuffixes) {
      if (compact.endsWith(suffix)) {
        compact = compact.slice(0, -suffix.length);
        changed = true;
        break;
      }
    }
  }
  if (compact === '') return false;
  if (
    replies.has(compact)
    || simpleAffirmativePattern.test(compact)
    || affirmativeIntentPattern.test(compact)
    || englishAffirmativeIntentPattern.test(compact)
  ) return true;

  // Only collapse repeated Latin keystrokes after all negative/ambiguous guards.
  const deduplicatedLatin = compact.replace(/([a-z])\1+/gu, '$1');
  return englishAffirmativeReplies.has(deduplicatedLatin);
}

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

export function runInteractionReplyCli(argv = process.argv) {
  const { command, args } = parseArgs(argv);
  if (command !== 'confirm' || typeof args.reply !== 'string' || !args.reply) {
    throw new Error('用法: interaction_reply.mjs confirm --reply <用户原始回复> --input-id <本地用户输入幂等键>');
  }
  required(args, 'input-id');
  const decision = isAffirmativeReply(args.reply) ? 'CONFIRMED' : 'REJECTED';
  process.stderr.write(`${internalPrefix}REPLY_DECISION=${decision}\n`);
  if (decision === 'REJECTED') process.exitCode = 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    runInteractionReplyCli();
  } catch (error) {
    process.stderr.write(`${internalPrefix}REPLY_VALIDATION_ERROR=${String(error?.message || error).replace(/[\r\n]/gu, ' ')}\n`);
    process.exitCode = 1;
  }
}
