import { mkdir, open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { SandboxClient, CliError, requireValue, id, merchant, operationId, validateOperation, validateClock, redact } from './client.mjs';
import { parsePaymentLink } from './payment-link.mjs';

const COMMANDS = {
  doctor: [], authorize: ['merchant-id', 'app-id'],
  'operation resolve': ['input', 'subscription-id', 'payment-order-id', 'operation-id'],
  'operation confirm': ['input', 'subscription-id', 'payment-order-id', 'operation-id'],
  'subscription inspect': ['subscription-id'],
  'messages list': ['subscription-id', 'offset', 'limit'],
  'agreement inspect': ['subscription-id'],
  'agreement unsign': ['subscription-id', 'expected-version'],
  renewal: ['subscription-id', 'payment-order-id', 'request-id'],
  'refund inspect': ['subscription-id', 'refund-order-id'],
  'refund confirm': ['subscription-id', 'refund-order-id'],
  'refund retry-notifications': ['subscription-id', 'refund-order-id'],
  'clock inspect': ['subscription-id'],
  'clock bind': ['subscription-id'],
  'clock advance': ['subscription-id', 'to', 'request-id', 'expected-version', 'wait', 'wait-timeout-ms', 'poll-ms'],
  'clock resume': ['subscription-id', 'operation-id', 'expected-version', 'wait', 'wait-timeout-ms', 'poll-ms'],
};
const GLOBAL = ['json', 'merchant-id', 'timeout-ms', 'journal'];
const BOOLEAN = new Set(['json', 'wait']);
const HELP = {
  name: 'alipay-subscription-sandbox', version: '0.1.0', schemaVersion: 1,
  commands: COMMANDS, globalOptions: GLOBAL,
  notes: ['JSON 输出默认开启；ID 全部使用字符串，金额为分。',
    '--input 接受本地文件或 - (stdin)，不接受 URL；不会打开支付链接。',
    'confirm 必须提供本次操作 ID 或本次响应文件；不自动挑选待支付单。',
    'clock advance --to 必须为带时区的 ISO 时间或毫秒时间戳。',
    'clock resume 必须提供 --operation-id 与 --expected-version。',
    '--wait 只继续同一时钟推进；WAITING_PAYMENT 时退出并交接，不自动付款。',
    'exit: 0 成功，2 参数错误，3 查询/协议失败，4 写入结果需核对，5 等待/阻塞。'],
};
function parseArgs(args) {
  const words = [], options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) { words.push(arg); continue; }
    const key = arg.slice(2);
    requireValue(key && !Object.hasOwn(options, key), '选项重复或格式无效。');
    if (BOOLEAN.has(key)) options[key] = true;
    else { requireValue(args[i + 1] !== undefined && !args[i + 1].startsWith('--'), `--${key} 缺少值。`); options[key] = args[++i]; }
  }
  const command = words.join(' ');
  requireValue(Object.hasOwn(COMMANDS, command), '未知命令，请运行 help。');
  const allowed = new Set([...GLOBAL, ...COMMANDS[command]]);
  for (const key of Object.keys(options)) requireValue(allowed.has(key), `该命令不支持 --${key}。`);
  if (options['merchant-id']) requireValue(merchant(options['merchant-id']), '商户 PID 必须是 16 位数字字符串。');
  return { command, options };
}
function integer(value, fallback, min, max, label) {
  if (value === undefined) return fallback;
  requireValue(/^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) >= min && Number(value) <= max, `${label} 超出范围。`);
  return Number(value);
}
function requestId(value) {
  const result = value || randomUUID();
  requireValue(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(result), 'request-id 必须是 UUID。');
  return result;
}
function targetTime(value) {
  requireValue(typeof value === 'string' && (/^\d{13}$/.test(value) || /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value)), '--to 需为毫秒时间戳或带时区的 ISO 时间。');
  const time = /^\d+$/.test(value) ? Number(value) : Date.parse(value);
  requireValue(Number.isSafeInteger(time) && time > 0 && time < 253402300800000, '目标时间无效。');
  return time;
}
async function readInput(path, stdin) {
  try {
    let input;
    if (path === '-') {
      const chunks = []; let size = 0;
      for await (const chunk of stdin) { size += Buffer.byteLength(chunk); requireValue(size <= 65536, '输入超过 64 KiB。'); chunks.push(Buffer.from(chunk)); }
      input = Buffer.concat(chunks).toString('utf8');
    } else {
      const file = await open(path, 'r');
      try {
        requireValue((await file.stat()).isFile() && (await file.stat()).size <= 65536, '输入必须是最多 64 KiB 的文件。');
        input = await file.readFile('utf8');
      } finally { await file.close(); }
    }
    return parsePaymentLink(input);
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError('INVALID_INPUT', '无法读取或解析本次支付/签约长链；请核对完整响应、字符串 ID 和链接类型。', 2);
  }
}
async function appendJournal(path, record) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const file = await open(path, 'a', 0o600);
  try { await file.chmod(0o600); await file.writeFile(JSON.stringify(redact(record)) + '\n'); await file.sync(); }
  finally { await file.close(); }
}
export async function execute(command, o, deps = {}) {
  const timeout = integer(o['timeout-ms'], 35000, 100, 120000, 'timeout-ms');
  const client = new SandboxClient({ fetchImpl: deps.fetchImpl, merchantId: o['merchant-id'], timeout });
  const journal = resolve(deps.cwd || process.cwd(), o.journal || '.alipay-aipay-new/token-pay/sandbox-cli/journal.jsonl');
  const context = { command, journal };
  const write = async (suffix, body, subId, authorization = false) => {
    const record = { schemaVersion: 1, eventId: randomUUID(), at: new Date().toISOString(), command,
      subscriptionId: subId, merchantId: client.merchantId, path: suffix, request: body };
    context.lastWrite = { eventId: record.eventId, subscriptionId: subId, request: body };
    // Persist intent before the HTTP mutation; failed disk writes must not mutate the sandbox.
    try { await appendJournal(journal, { ...record, phase: 'intent' }); }
    catch { throw new CliError('JOURNAL_WRITE_FAILED', '无法保存操作记录，未发送此写请求。', 3); }
    let value;
    try {
      value = authorization ? await client.call(suffix, body, { authorization: true }) : await client.subscription(subId, suffix, body);
    } catch (error) {
      try { await appendJournal(journal, { ...record, phase: 'unconfirmed', code: error.code || 'UNKNOWN' }); } catch {}
      throw error;
    }
    try { await appendJournal(journal, { ...record, phase: 'response', status: value.status, operationId: value.operationId, version: value.version }); }
    catch { throw new CliError('JOURNAL_WRITE_FAILED_AFTER_REQUEST', '已发送写请求，但无法保存回执；请查询核对。', 4); }
    return value;
  };
  try {
    // Validate all local mutation arguments before any network requests.
    let subId = o['subscription-id'], selection;
    if (command.startsWith('operation ')) {
      requireValue(!(o['payment-order-id'] && o['operation-id']), '支付单和签约操作只能指定一个。');
      if (o.input) {
        requireValue(!subId && !o['payment-order-id'] && !o['operation-id'], '--input 不与显式资源 ID 混用。');
        const parsed = await readInput(o.input, deps.stdin || process.stdin);
        subId = parsed.subscriptionId;
        selection = parsed.operationId ? { type: 'operationId', id: parsed.operationId } : { type: 'paymentOrderId', id: parsed.paymentOrderId };
      } else if (o['payment-order-id'] || o['operation-id']) {
        selection = o['payment-order-id'] ? { type: 'paymentOrderId', id: o['payment-order-id'] } : { type: 'operationId', id: o['operation-id'] };
      }
      requireValue(command !== 'operation confirm' || selection, '确认操作必须提供本次支付单、签约操作或输入文件。');
      if (selection) requireValue(operationId(selection.id), '操作单号无效。');
    }
    if (!['doctor', 'authorize'].includes(command)) requireValue(id(subId), '需要 --subscription-id，且必须是 19 位数字字符串。');
    if (command === 'authorize') requireValue(merchant(o['merchant-id']) && merchant(o['app-id']), '登记需要 16 位 merchant-id 和 app-id。');
    if (command.startsWith('refund ')) requireValue(typeof o['refund-order-id'] === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(o['refund-order-id']), '需要有效的 refund-order-id。');
    if (command === 'agreement unsign') requireValue(/^[a-f0-9]{64}$/.test(o['expected-version'] || ''), '解约需提供 agreement inspect 返回的 expected-version。');
    const expected = command.startsWith('clock ') ? integer(o['expected-version'], undefined, 0, Number.MAX_SAFE_INTEGER, 'expected-version') : undefined;
    if (command === 'clock resume') requireValue(operationId(o['operation-id']) && expected !== undefined, '继续推进需要 operation-id 和 expected-version。');
    const target = command === 'clock advance' ? targetTime(o.to) : undefined;
    const reqId = ['clock advance', 'renewal'].includes(command) ? requestId(o['request-id']) : undefined;
    if (command === 'renewal' && o['payment-order-id']) requireValue(id(o['payment-order-id']), '续费支付单必须为 19 位数字字符串。');
    const offset = integer(o.offset, 0, 0, 10000, 'offset');
    const limit = integer(o.limit, 20, 1, 20, 'limit');
    const waitMs = integer(o['wait-timeout-ms'], 60000, 100, 600000, 'wait-timeout-ms');
    const pollMs = integer(o['poll-ms'], 1000, 100, 10000, 'poll-ms');
    await client.health();
    if (command === 'doctor') return { environment: 'sandboxstable', protocolVersion: '1', transport: 'HTTP', accountCredentialsVerified: false, merchantIntegrationVerified: false };
    if (command === 'authorize') {
      const value = await write('/nexuspaycommon/api/sandbox/merchant-authorizations', { merchantId: o['merchant-id'], appId: o['app-id'] }, undefined, true);
      requireValue(value.environment === 'sandboxstable' && value.merchantId === o['merchant-id'] && value.appId === o['app-id'] && value.status === 'AUTHORIZED' && typeof value.created === 'boolean', '登记回执不匹配，请核对状态。', 'INVALID_RESPONSE', 4);
      return { merchantId: value.merchantId, appId: value.appId, status: value.status, created: value.created };
    }
    await client.identify(subId);
    const get = suffix => client.subscription(subId, suffix);
    const mutate = (suffix, body) => write(suffix, body, subId);
    if (command.startsWith('operation ')) {
      let view = validateOperation(await get(selection ? `?${selection.type}=${encodeURIComponent(selection.id)}` : ''), selection, true);
      if (command === 'operation resolve') return view;
      if (view.simulated && view.completedAt && !view.canConfirm) return { ...view, alreadyCompleted: true };
      requireValue(view.canConfirm, '该操作当前不可确认，请查询状态。', 'OPERATION_BLOCKED', 5);
      const type = view.action === 'SIGN_ONLY' ? 'operationId' : 'paymentOrderId';
      const canonical = { type, id: view[type] };
      view = await mutate('/confirm', { [type]: canonical.id });
      try { return validateOperation(view, canonical); }
      catch { throw new CliError('INVALID_RESPONSE', '确认已发送但回执不匹配，请查询同一操作。', 4); }
    }
    if (command === 'subscription inspect') return get('/details');
    if (command === 'messages list') return get(`/messages?offset=${offset}&limit=${limit}`);
    if (command.startsWith('agreement ')) {
      const value = await get('/agreement');
      if (command === 'agreement inspect') return value;
      requireValue(value.version === o['expected-version'], '协议版本已变化，需重新查询。', 'VERSION_CONFLICT', 3);
      requireValue(value.canUnsign === true && value.status === 'SIGNED', '当前协议不可解约。', 'AGREEMENT_BLOCKED', 5);
      return mutate('/agreement', { version: value.version });
    }
    if (command === 'renewal') return mutate('/renewal', { requestId: reqId, ...(o['payment-order-id'] ? { paymentOrderId: o['payment-order-id'] } : {}) });
    if (command.startsWith('refund ')) {
      const suffix = `/refunds/${encodeURIComponent(o['refund-order-id'])}`;
      const validate = (v, exitCode = 3) => {
        requireValue(v.refundOrderId === o['refund-order-id'] && v.currency === 'CNY' && typeof v.amountMinor === 'string' && /^\d+$/.test(v.amountMinor)
          && typeof v.canConfirm === 'boolean' && typeof v.simulated === 'boolean' && typeof v.status === 'string', '退款回执不匹配。', 'INVALID_RESPONSE', exitCode); return v;
      };
      const value = validate(await get(suffix));
      if (command === 'refund inspect') return value;
      if (command === 'refund confirm' && value.simulated && value.completedAt && !value.canConfirm) return { ...value, alreadyCompleted: true };
      requireValue(command === 'refund confirm' ? value.canConfirm : value.canRetryNotification === true, '当前退款不支持该操作。', 'REFUND_BLOCKED', 5);
      return validate(await mutate(suffix + (command === 'refund confirm' ? '/confirm' : '/notifications/retry'), {}), 4);
    }
    const clock = async () => validateClock(await get('/test-clock'));
    const clockWrite = async (action, body) => {
      const value = await mutate(`/test-clock/${action}`, body);
      try { return validateClock(value); } catch { throw new CliError('INVALID_CLOCK', '时钟请求已发送但回执无效，请查询时钟。', 4); }
    };
    let current = await clock();
    if (command === 'clock inspect') return current;
    if (command === 'clock bind') return current.bound ? { ...current, alreadyBound: true } : clockWrite('bind', {});
    requireValue(current.bound, '请先绑定测试时钟。', 'CLOCK_NOT_BOUND', 3);
    requireValue(expected === undefined || expected === current.version, '时钟版本已变化，请重新查询。', 'VERSION_CONFLICT', 3);
    if (command === 'clock advance') {
      requireValue(current.status === 'READY' && target > current.frozenTime, '时钟必须就绪且目标晚于当前业务时间。', 'CLOCK_NOT_READY', 3);
      current = await clockWrite('advance', { targetTime: target, requestId: reqId, expectedVersion: current.version });
      requireValue(current.targetTime === target && current.operationId === reqId, '推进回执目标或请求编号不匹配，请查询时钟。', 'CLOCK_TARGET_MISMATCH', 4);
    } else {
      requireValue(['ADVANCING', 'FAILED'].includes(current.status) && current.operationId === o['operation-id']
        && (current.status === 'FAILED' || current.executionMode === 'REQUEST'), '该推进已变化或由后台执行，不能继续。', 'CLOCK_OPERATION_MISMATCH', 3);
      current = await clockWrite('resume', { operationId: current.operationId, expectedVersion: current.version });
      requireValue(current.operationId === o['operation-id'], '继续推进回执与指定操作不匹配。', 'CLOCK_OPERATION_MISMATCH', 4);
    }
    const pinned = { operationId: current.operationId, targetTime: current.targetTime };
    const deadline = Date.now() + waitMs;
    while (true) {
      requireValue(current.operationId === pinned.operationId && current.targetTime === pinned.targetTime, '时钟已切换到其他操作，停止等待。', 'CLOCK_OPERATION_MISMATCH', 5);
      if (current.status === 'READY' && current.frozenTime >= pinned.targetTime) return current;
      if (current.pauseReason === 'WAITING_PAYMENT') throw new CliError('WAITING_PAYMENT', '推进等待付款，先查询并确认对应支付单，再继续同一推进。', 5, { clock: current, nextAction: 'RESOLVE_PAYMENT' });
      if (current.status === 'FAILED') throw new CliError('CLOCK_FAILED', '推进失败；查询原因后可显式 resume。', 5, { clock: current, nextAction: 'INSPECT_AND_RESUME' });
      if (!o.wait) return current;
      if (Date.now() >= deadline) throw new CliError('WAIT_TIMEOUT', '等待超时；未取消服务端推进。', 5, { clock: current, nextAction: 'INSPECT_CLOCK' });
      await (deps.sleep || sleep)(Math.min(pollMs, Math.max(0, deadline - Date.now())));
      current = await clock();
      if (current.operationId !== pinned.operationId || current.targetTime !== pinned.targetTime) continue;
      if (current.status === 'ADVANCING' && current.executionMode === 'REQUEST' && current.pauseReason === 'CONTINUE') {
        if (Date.now() >= deadline) continue;
        current = await clockWrite('resume', { operationId: pinned.operationId, expectedVersion: current.version });
      }
    }
  } catch (error) {
    if (!(error instanceof CliError)) throw new CliError('LOCAL_ERROR', '本地执行失败，请检查文件权限和运行环境。', context.lastWrite ? 4 : 3, context);
    error.details = { ...context, ...error.details };
    throw error;
  }
}
export async function run(args, deps = {}) {
  const stdout = deps.stdout || process.stdout;
  try {
    if (!args.length || args.includes('--help') || args[0] === 'help') { stdout.write(JSON.stringify(HELP, null, 2) + '\n'); return 0; }
    if (args.length === 1 && args[0] === '--version') { stdout.write('0.1.0\n'); return 0; }
    const { command, options } = parseArgs(args);
    const data = await execute(command, options, deps);
    stdout.write(JSON.stringify(redact({ schemaVersion: 1, ok: true, environment: 'sandboxstable', command, data })) + '\n');
    return 0;
  } catch (error) {
    const known = error instanceof CliError;
    const exitCode = known ? error.exitCode : 3;
    stdout.write(JSON.stringify(redact({ schemaVersion: 1, ok: false, environment: 'sandboxstable', error: {
      code: known ? error.code : 'LOCAL_ERROR', message: known ? error.message : '本地执行失败。', exitCode,
      ...(known ? error.details : {}),
    } })) + '\n');
    return exitCode;
  }
}
