// Private per-run MCC review and retry state. The matcher alone uses the text.
import fs from 'node:fs';
import path from 'node:path';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { currentRunContext } from '../../../normal/scripts/telemetry.mjs';
import { parseMccSemanticTerms } from '../../../normal/scripts/onboarding_message_runner.mjs';

const [action, root, ttlSeconds, scope, product, salesCode, retryLimit] = process.argv.slice(2);
const ttl = Number(ttlSeconds);
const now = Math.floor(Date.now() / 1000);
const stateName = /^(.+)\.(?:aipay|webpay|apppay)\.I\d+\.(?:(agent-reviews|semantic-retries)|selection\.(v4\.)?([A-Za-z0-9_-]{32,128}))\.json$/u;
const safeComponent = value => /^[A-Za-z0-9_.-]+$/u.test(value || '');
const fresh = timestamp => Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= ttl;
const newState = () => ({ schemaVersion: 2, salt: randomBytes(32).toString('hex'), entries: [] });

function read(file) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    if (!fs.fstatSync(fd).isFile()) throw Error('invalid state');
    return JSON.parse(fs.readFileSync(fd, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function write(file, state) {
  const tmp = file + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

async function locked(file, work) {
  const lock = file + '.lock';
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      fs.mkdirSync(lock, { mode: 0o700 });
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      await delay(50);
      continue;
    }
    try { return work(); } finally { fs.rmdirSync(lock); }
  }
  throw Error('MCC cache busy');
}

function token(state, file, kind, ...parts) {
  return createHmac('sha256', Buffer.from(state.salt, 'hex'))
    .update(JSON.stringify([path.basename(file), kind, ...parts])).digest('hex');
}

function retryValues(state, file, inputId, query, terms) {
  const inputKey = token(state, file, 'input', inputId);
  const queryKey = token(state, file, 'query', inputKey, query);
  return { inputKey, queryKey, termKeys: terms.map(term => token(state, file, 'term', inputKey, term)).sort() };
}

function migrateLegacy(state, file, kind, fileScope) {
  const next = newState();
  const session = process.env.ALIPAY_AIPAY_SESSION_ID;
  if (session && currentRunContext()?.run_id === fileScope)
    next.ownerKey = token(next, file, 'owner', session);
  for (const entry of state.entries || []) {
    if (typeof entry.inputId !== 'string' || !entry.inputId) continue;
    if (kind === 'agent-reviews') {
      next.entries.push({ inputKey: token(next, file, 'input', entry.inputId), updatedAtEpoch: now });
    } else if (Number.isFinite(entry.updatedAtEpoch) && typeof entry.query === 'string' && Number.isInteger(entry.count)) {
      const fields = retryValues(next, file, entry.inputId, entry.query,
        parseMccSemanticTerms({ 'semantic-terms-json': JSON.stringify(entry.semanticTerms || []) }));
      next.entries.push({ ...fields, count: entry.count, updatedAtEpoch: entry.updatedAtEpoch });
    }
  }
  return next;
}

// The catalog TTL controls freshness of official MCC data. Active runs keep
// their retry limit even after that TTL. Only a verified change of run in
// the owning host conversation can retire its review/retry ledger.
function pastRun(state, file, fileScope) {
  const session = process.env.ALIPAY_AIPAY_SESSION_ID;
  if (!session || !state.ownerKey || !state.entries?.length ||
      state.entries.some(e => fresh(e.updatedAtEpoch))) return false;
  const current = currentRunContext();
  return current && state.ownerKey === token(state, file, 'owner', session) &&
    (current.run_id !== fileScope || current.terminal);
}

async function prune() {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const match = stateName.exec(entry.name);
    if (!match) continue;
    const file = path.join(root, entry.name);
    let old;
    try { old = read(file); } catch { continue; }
    if (!old) continue;
    if (match[4]) {
      // V4 uses its own filename. Never remove a selection snapshot a new
      // process may currently be writing to the same destination.
      if (!match[3] && old.schemaVersion === 3) fs.rmSync(file, { force: true });
      else if (match[3] && !fresh(old.createdAtEpoch)) {
        await locked(file, () => {
          const snapshot = read(file);
          if (snapshot && !fresh(snapshot.createdAtEpoch)) fs.rmSync(file, { force: true });
        });
      }
      continue;
    }
    if (old.schemaVersion !== 1 && !pastRun(old, file, match[1])) continue;
    await locked(file, () => {
      const state = read(file);
      if (!state) return;
      if (state.schemaVersion === 1) write(file, migrateLegacy(state, file, match[2], match[1]));
      else if (pastRun(state, file, match[1])) fs.rmSync(file, { force: true });
    });
  }
}

async function run() {
  if (!path.isAbsolute(root) || !Number.isSafeInteger(ttl) || ttl < 0) throw Error('invalid root or TTL');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  if (!fs.lstatSync(root).isDirectory()) throw Error('invalid root');
  if (action === 'prune') return prune();
  if (!safeComponent(scope) || !['aipay', 'webpay', 'apppay'].includes(product) || !/^I\d+$/u.test(salesCode))
    throw Error('invalid cache scope');
  if (action === 'selection-write') {
    const receipt = process.argv[9] || '';
    const digest = /^AIPAY_MCC_SELECTION_V1\.(?:A\d{4}_B\d{4},){0,7}A\d{4}_B\d{4}\.([A-Za-z0-9_-]{43})$/u.exec(receipt)?.[1];
    const catalog = JSON.parse(fs.readFileSync(0, 'utf8'));
    if (!digest || !Array.isArray(catalog) || catalog.length < 1 || catalog.length > 8)
      throw Error('invalid candidate snapshot');
    const file = path.join(root, [scope, product, salesCode, 'selection.v4', digest, 'json'].join('.'));
    return locked(file, () => write(file, {
      schemaVersion: 4, productType: product, salesCode, selectionReceipt: receipt,
      createdAtEpoch: now, catalog
    }));
  }
  const retry = action === 'retry';
  const boundReview = ['review-start', 'review-repair', 'review-result'].includes(action);
  if (!retry && !boundReview && action !== 'review-mark') throw Error('invalid cache action');
  const [inputId, query, rawTerms, catalogDigest, rawCodes] = fs.readFileSync(0, 'utf8').split('\0');
  if (!inputId) throw Error('missing input identity');
  const kind = retry ? 'semantic-retries' : 'agent-reviews';
  const file = path.join(root, [scope, product, salesCode, kind, 'json'].join('.'));
  return locked(file, () => {
    let state = read(file) || newState();
    if (state.schemaVersion === 1) state = migrateLegacy(state, file, kind, scope);
    if (state.schemaVersion !== 2 || !/^[0-9a-f]{64}$/u.test(state.salt) || !Array.isArray(state.entries))
      throw Error('invalid state');
    const session = process.env.ALIPAY_AIPAY_SESSION_ID;
    if (!state.ownerKey && session) state.ownerKey = token(state, file, 'owner', session);
    const inputKey = token(state, file, 'input', inputId);
    const previous = state.entries.find(e => e.inputKey === inputKey);
    if (boundReview) {
      if (!query || !/^[0-9a-f]{64}$/u.test(catalogDigest || '')) throw Error('missing review evidence');
      const terms = parseMccSemanticTerms({ 'semantic-terms-json': rawTerms });
      const contextKey = token(state, file, 'review', inputKey, query, terms, catalogDigest);
      if (action === 'review-start') {
        if (previous) return 1;
        state.entries.push({ inputKey, contextKey, phase: 'review', updatedAtEpoch: now });
      } else {
        if (!previous || previous.contextKey !== contextKey) return 2;
        if (action === 'review-repair') {
          if (previous.phase !== 'review') return 2;
          previous.phase = 'repair';
        } else {
          const codes = JSON.parse(rawCodes);
          if (!Array.isArray(codes) || codes.length > 8 || new Set(codes).size !== codes.length
              || codes.some(code => !/^A\d{4}_B\d{4}$/u.test(code))) throw Error('invalid result');
          const resultKey = token(state, file, 'result', contextKey, codes);
          if (previous.phase === 'result') return previous.resultKey === resultKey ? 0 : 2;
          if (!['review', 'repair'].includes(previous.phase)) return 2;
          previous.phase = 'result';
          previous.resultKey = resultKey;
        }
        previous.updatedAtEpoch = now;
      }
      write(file, state);
      return 0;
    }
    if (!retry && previous) return 1;
    if (retry) {
      const fields = retryValues(state, file, inputId, query, parseMccSemanticTerms({ 'semantic-terms-json': rawTerms }));
      if (previous && (previous.queryKey !== fields.queryKey || previous.count >= Number(retryLimit))) return 2;
      if (previous && (fields.termKeys.length <= previous.termKeys.length ||
          previous.termKeys.some(term => !fields.termKeys.includes(term)))) return 3;
      const count = (previous?.count || 0) + 1;
      state.entries = state.entries.filter(e => e.inputKey !== inputKey);
      state.entries.push({ ...fields, count, updatedAtEpoch: now });
      write(file, state);
      process.stdout.write(String(count));
    } else {
      state.entries.push({ inputKey, updatedAtEpoch: now });
      write(file, state);
    }
    return 0;
  });
}

try { process.exitCode = (await run()) || 0; }
catch { process.exitCode = 2; }
