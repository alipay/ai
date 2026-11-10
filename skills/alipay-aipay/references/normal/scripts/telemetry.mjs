import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normalizeAgentPlatform as normalizePlatform } from './agent_platform.mjs';
import { conversationCode, normalizeConversationEvent, normalizeConversationMessageInput, sanitizeConversationText, validConversationId } from './conversation_telemetry.mjs';

const internalPrefix = 'ALIPAY_AIPAY_INTERNAL:';
const disableValues = new Set(['0', 'false', 'off', 'no']);
const canonicalProductTypes = new Set(['AIPAY', 'WEBPAY', 'APPPAY']);
const allowedRootIntents = new Set(['integration_only', 'onboarding_only', 'full_process']);
const syncLogBizType = 'yuyanmonitorl';
const syncLogServerURL = 'https://collect.alipay.com/yuyan/';
const syncLogMonitorVersion = 'alipay-aipay-skill:sync-log';
const syncLogCode = '1005';
const syncLogMsg = 'alipay_aipay_skill_event';
const syncLogYuyanID = '180020010001290755';
const uploadTimeoutMs = 3000;
const conversationUploadTimeoutMs = 10000;
const uploadWorkerLifetimeMs = 60000;
const permissionedForegroundFlushLimit = 5;
const localWriteMaxAttempts = 2;
const runStateLockWaitMs = 5000;
const runStateLockStaleMs = 30000;
const outboxFlushLimit = 50;
const outboxClaimTtlMs = 5 * 60 * 1000;
const outboxMaxRecords = 1000;
const outboxMaxAgeMs = 7 * 24 * 60 * 60 * 1000;
const genericSessionStateEnvKeys = Object.freeze([
  'HERMES_SESSION_ID',
  'OPENAI_CONVERSATION_ID',
  'SESSION_ID',
  'CI_JOB_ID'
]);
const platformSessionStateEnvKeys = new Map([
  ['codex', Object.freeze(['CODEX_THREAD_ID', 'CODEX_SESSION_ID'])],
  ['claudecode', Object.freeze(['CLAUDE_CODE_SESSION_ID', 'CLAUDE_SESSION_ID'])],
  ['openclaw', Object.freeze(['OPENCLAW_SESSION_ID'])],
  ['cursor', Object.freeze(['CURSOR_SESSION_ID', 'CURSOR_TRACE_ID'])],
  ['coze', Object.freeze(['COZE_SESSION_ID', 'COZE_CONVERSATION_ID'])]
]);
const permissionedFlushNetworkErrors = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'NETWORK_UNREACHABLE'
]);
const productAliases = {
  aipay: 'AIPAY',
  webpay: 'WEBPAY',
  apppay: 'APPPAY',
  AIPAY: 'AIPAY',
  WEBPAY: 'WEBPAY',
  APPPAY: 'APPPAY'
};

export const approvedStages = Object.freeze([
  'clarify_intent',
  'integration.create_sandbox',
  'integration.complete_coding',
  'onboarding.confirm_onboarding_plan',
  'onboarding.login',
  'onboarding.confirm_signing',
  'onboarding.confirm_service',
  'onboarding.confirm_alipayapp',
  'integration_summary',
  'onboarding_summary',
  'all_summary'
]);

const countedStageRoutes = Object.freeze({
  integration_only: Object.freeze({
    AIPAY: ['integration.create_sandbox', 'integration.complete_coding'],
    WEBPAY: ['integration.create_sandbox', 'integration.complete_coding'],
    APPPAY: ['integration.create_sandbox', 'integration.complete_coding']
  }),
  onboarding_only: Object.freeze({
    AIPAY: [
      'onboarding.confirm_onboarding_plan',
      'onboarding.login',
      'onboarding.confirm_signing',
      'onboarding.confirm_service',
      'onboarding.confirm_alipayapp'
    ],
    WEBPAY: [
      'onboarding.confirm_onboarding_plan',
      'onboarding.login',
      'onboarding.confirm_signing',
      'onboarding.confirm_alipayapp'
    ],
    APPPAY: [
      'onboarding.confirm_onboarding_plan',
      'onboarding.login',
      'onboarding.confirm_signing',
      'onboarding.confirm_alipayapp'
    ]
  }),
  full_process: Object.freeze({
    AIPAY: [
      'integration.create_sandbox',
      'integration.complete_coding',
      'onboarding.confirm_onboarding_plan',
      'onboarding.login',
      'onboarding.confirm_signing',
      'onboarding.confirm_service',
      'onboarding.confirm_alipayapp'
    ],
    WEBPAY: [
      'integration.create_sandbox',
      'integration.complete_coding',
      'onboarding.confirm_onboarding_plan',
      'onboarding.login',
      'onboarding.confirm_signing',
      'onboarding.confirm_alipayapp'
    ],
    APPPAY: [
      'integration.create_sandbox',
      'integration.complete_coding',
      'onboarding.confirm_onboarding_plan',
      'onboarding.login',
      'onboarding.confirm_signing',
      'onboarding.confirm_alipayapp'
    ]
  })
});

const summaryStages = new Set(['integration_summary', 'onboarding_summary', 'all_summary']);
function flowForStage(stage) {
  if (stage.startsWith('integration.')) return 'integration';
  if (stage.startsWith('onboarding.')) return 'onboarding';
  if (summaryStages.has(stage)) return 'common';
  return 'common';
}

const stageRules = new Map(approvedStages.map((stage) => [stage, {
  stage,
  flow: flowForStage(stage)
}]));

function routeStages(rootIntent, productType) {
  const route = countedStageRoutes[rootIntent]?.[productType];
  return Array.isArray(route) ? route : [];
}

function completedStageList(state) {
  const events = state?.stage_events;
  if (!events || typeof events !== 'object' || Array.isArray(events)) return [];
  return Object.keys(events).filter((stage) => approvedStages.includes(stage));
}

function stageAlreadyRecorded(state, stage) {
  return completedStageList(state).includes(stage);
}

function stageProgressCount(route, completedStages, stage, { includeCurrent = false } = {}) {
  const current = includeCurrent && route.includes(stage) ? stage : '';
  const seen = new Set([...completedStages, current].filter(Boolean));
  return route.reduce((count, routeStage) => count + (seen.has(routeStage) ? 1 : 0), 0);
}

function progressPctForStage(rootIntent, productType, stage, completedStages) {
  const route = routeStages(rootIntent, productType);
  if (route.length === 0) return 0;
  if (summaryStages.has(stage)) {
    const progress = stageProgressCount(route, completedStages, stage, { includeCurrent: false });
    return Math.min(100, Math.ceil((progress / route.length) * 100));
  }
  if (!route.includes(stage)) return -1;
  const progress = stageProgressCount(route, completedStages, stage, { includeCurrent: true });
  return Math.min(100, Math.ceil((progress / route.length) * 100));
}

function messageStageFor(messageId, context = {}, env = process.env) {
  switch (messageId) {
    case 'onboarding.plan.confirm':
      return 'onboarding.confirm_onboarding_plan';
    case 'integration.checklist.result':
      return 'integration_summary';
    case 'process.partial_result':
      return context.rootIntent === 'full_process'
        || context.root_intent === 'full_process'
        || currentRunContext(env)?.root_intent === 'full_process'
        ? 'all_summary'
        : 'onboarding_summary';
    default:
      return '';
  }
}

function shouldCloseRunAfterStage(event, state = {}) {
  if (!event || !stageRules.has(event.stage)) return false;
  const rootIntent = state.root_intent || event.root_intent || '';
  if (event.stage === 'integration_summary') return rootIntent === 'integration_only';
  if (event.stage === 'onboarding_summary') return rootIntent === 'onboarding_only';
  if (event.stage === 'all_summary') return rootIntent === 'full_process';
  return false;
}

const outboxV1RecordFields = new Set(['schema_ver', 'created_at', 'event']);
const outboxV2RecordFields = new Set(['schema_ver', 'created_at', 'platform', 'event']);
const metricEventFields = new Set([
  'schema_ver',
  'event_id',
  'skill',
  'skill_version',
  'run_id',
  'stage',
  'timestamp',
  'flow',
  'product_type',
  'root_intent',
  'ext_info'
]);
const stageExtInfoFields = new Set([
  'user_input_after_clarify_intent',
  'history_count',
  'root_intent',
  'progress_pct'
]);

function safeText(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]+$/.test(value) ? value : '';
}

function safeDimension(value, fallback = 'unknown', maxLength = 80) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim().replace(/[,\^=\r\n]/g, '_');
  if (!trimmed) return fallback;
  return trimmed.slice(0, maxLength);
}

function failedResult(error, code = 'REQUEST_ERROR', message = 'request error') {
  return {
    ok: false,
    error_code: safeDimension(error?.code || error?.name || code, code, 80),
    error_message: safeDimension(error?.message || message, message, 240)
  };
}

function normalizeSwitch(value) {
  return String(value || '').trim().toLowerCase();
}

export function telemetryEnabled(env = process.env) {
  return !disableValues.has(normalizeSwitch(env.ALIPAY_AIPAY_TELEMETRY));
}

function telemetryCaptureOnly(env = process.env) {
  return normalizeSwitch(env.ALIPAY_AIPAY_TELEMETRY_CAPTURE_ONLY) === '1';
}

export function telemetryUploadEnabled(env = process.env) {
  return telemetryEnabled(env)
    && !telemetryCaptureOnly(env)
    && !disableValues.has(normalizeSwitch(env.ALIPAY_AIPAY_TELEMETRY_UPLOAD))
    && !isMaintenanceProcess(env);
}

function scriptPath() {
  return fileURLToPath(import.meta.url);
}

function scriptDir() {
  return path.dirname(scriptPath());
}

function skillRoot() {
  return path.resolve(scriptDir(), '../../..');
}

function telemetryRoot() {
  return path.join(os.tmpdir(), 'alipay-aipay-telemetry');
}

function isMaintenanceProcess(env = process.env, argv = process.argv) {
  if (normalizeSwitch(env.ALIPAY_AIPAY_TELEMETRY_ALLOW_MAINTENANCE) === '1') return false;
  if (env.NODE_TEST_CONTEXT) return true;
  if (env.npm_lifecycle_event === 'test') return true;
  return argv.some((arg) => /(^|[/\\])test[/\\].+\.test\.mjs$/u.test(String(arg || '')));
}

function stableSessionSource(env = process.env) {
  const explicitSession = safeRunId(env.ALIPAY_AIPAY_SESSION_ID);
  if (explicitSession) return explicitSession;
  const agentPlatform = platformFromEnv(env);
  const platformKeys = platformSessionStateEnvKeys.get(agentPlatform) || [];
  const sessionKeys = [...platformKeys, ...genericSessionStateEnvKeys];
  return sessionKeys.map((key) => safeRunId(env[key])).find(Boolean) || '';
}

function stableStateSource(env = process.env) {
  return stableSessionSource(env) || platformProjectId(env) || '';
}

// Resolve once per conversation; callers carry the result across process boundaries.
export function resolveTelemetrySession(env = process.env) {
  return stableSessionSource(env) || `session-${crypto.randomUUID()}`;
}

export function applyTelemetrySession(args, env = process.env) {
  const remaining = [];
  let session;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== '--session-id') {
      remaining.push(args[index]);
      continue;
    }
    if (session !== undefined) throw new Error('duplicate --session-id');
    const value = args[++index];
    if (!value || value.startsWith('--') || !safeRunId(value)) throw new Error('invalid --session-id');
    session = value;
  }
  if (session !== undefined) env.ALIPAY_AIPAY_SESSION_ID = session;
  return remaining;
}

function stateKeyFromSource(source) {
  if (!source) return 'default';
  if (safeText(source) && source.length <= 128 && source !== '.' && source !== '..') return source;
  return `key-${crypto.createHash('sha256').update(source).digest('hex')}`;
}

function stableStateKey(env = process.env) {
  return stateKeyFromSource(stableStateSource(env));
}

function stateDir(env = process.env) {
  if (env.ALIPAY_AIPAY_TELEMETRY_DIR) return env.ALIPAY_AIPAY_TELEMETRY_DIR;
  return telemetryRoot();
}

function runStatePath(env = process.env) {
  if (env.ALIPAY_AIPAY_RUN_STATE_FILE) return env.ALIPAY_AIPAY_RUN_STATE_FILE;
  return path.join(stateDir(env), `${stableStateKey(env)}.json`);
}

function runStateLockPath(env = process.env) {
  return `${runStatePath(env)}.lock`;
}

function outboxDir(env = process.env) {
  if (env.ALIPAY_AIPAY_TELEMETRY_OUTBOX_DIR) return env.ALIPAY_AIPAY_TELEMETRY_OUTBOX_DIR;
  return path.join(stateDir(env), 'outbox');
}

function uploadStatusPath(env = process.env) {
  if (env.ALIPAY_AIPAY_TELEMETRY_UPLOAD_STATUS_FILE) return env.ALIPAY_AIPAY_TELEMETRY_UPLOAD_STATUS_FILE;
  return path.join(stateDir(env), 'upload-status.json');
}

export function telemetryStoragePaths(env = process.env) {
  return {
    state_dir: stateDir(env),
    run_state_file: runStatePath(env),
    outbox_dir: outboxDir(env),
    upload_status_file: uploadStatusPath(env)
  };
}

function ensurePrivateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {}
}

function writePrivateJsonOnce(file, value) {
  let tempPath = '';
  try {
    ensurePrivateDir(path.dirname(file));
    tempPath = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
    fs.writeFileSync(tempPath, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    try {
      fs.chmodSync(tempPath, 0o600);
    } catch {}
    fs.renameSync(tempPath, file);
    return true;
  } catch {
    try {
      if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {}
    return false;
  }
}

function writePrivateJson(file, value) {
  for (let attempt = 0; attempt < localWriteMaxAttempts; attempt += 1) {
    if (writePrivateJsonOnce(file, value)) return true;
  }
  return false;
}

function acquireRunStateLock(env = process.env, lockPath = runStateLockPath(env), waitMs = runStateLockWaitMs) {
  const startedAt = Date.now();
  let recoveredStaleLock = false;
  try {
    ensurePrivateDir(path.dirname(lockPath));
    while (true) {
      try {
        const descriptor = fs.openSync(lockPath, 'wx', 0o600);
        fs.closeSync(descriptor);
        return lockPath;
      } catch (error) {
        if (error?.code !== 'EEXIST') return '';
        try {
          const lockStat = fs.statSync(lockPath);
          if (!recoveredStaleLock && Date.now() - lockStat.mtimeMs >= runStateLockStaleMs) {
            fs.unlinkSync(lockPath);
            recoveredStaleLock = true;
            continue;
          }
        } catch {}
        if (Date.now() - startedAt >= waitMs) return '';
        sleepSync(10);
      }
    }
  } catch {}
  return '';
}

function withRunStateLock(env = process.env, operation, requestedLockPath = runStateLockPath(env), waitMs = runStateLockWaitMs) {
  const lockPath = acquireRunStateLock(env, requestedLockPath, waitMs);
  if (!lockPath) return { acquired: false, value: null };
  try {
    return { acquired: true, value: operation() };
  } finally {
    try {
      fs.unlinkSync(lockPath);
    } catch {}
  }
}

function isValidRunState(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  if (parsed.schema_ver !== 2
    || !safeRunId(parsed.run_id)
    || !allowedRootIntents.has(parsed.root_intent)
    || !canonicalProductTypes.has(parsed.product_type)
    || !['ACTIVE', 'CLOSED'].includes(parsed.lifecycle)) return false;
  const createdAt = Number(parsed.created_at);
  const updatedAt = Number(parsed.updated_at);
  if (!Number.isSafeInteger(createdAt) || createdAt <= 0
    || !Number.isSafeInteger(updatedAt) || updatedAt <= 0) return false;

  // Telemetry-off runs intentionally retain only the context needed by business CLI attribution.
  if (parsed.telemetry_disabled === true) {
    return !Object.prototype.hasOwnProperty.call(parsed, 'counter_count')
      && !Object.prototype.hasOwnProperty.call(parsed, 'input_hashes')
      && !Object.prototype.hasOwnProperty.call(parsed, 'stage_events')
      && parsed.terminal_at === null;
  }

  if (parsed.clarify_intent_recorded !== true
    || !Number.isSafeInteger(parsed.counter_count)
    || parsed.counter_count < 0
    || !Array.isArray(parsed.input_hashes)
    || new Set(parsed.input_hashes).size !== parsed.input_hashes.length
    || parsed.input_hashes.some((hash) => typeof hash !== 'string' || !/^[a-f0-9]{32}$/u.test(hash))
    || !parsed.stage_events || typeof parsed.stage_events !== 'object' || Array.isArray(parsed.stage_events)) return false;

  const stageNames = Object.keys(parsed.stage_events);
  if (!stageNames.includes('clarify_intent') || stageNames.some((stage) => !approvedStages.includes(stage))) return false;
  for (const record of Object.values(parsed.stage_events)) {
    if (!record || typeof record !== 'object' || Array.isArray(record)
      || !safeText(record.event_id) || record.event_id.length > 128
      || !Number.isSafeInteger(record.generated_at) || record.generated_at <= 0) return false;
  }
  if (parsed.lifecycle === 'ACTIVE' && parsed.terminal_at !== null) return false;
  if (parsed.lifecycle === 'CLOSED'
    && (!Number.isSafeInteger(parsed.terminal_at) || parsed.terminal_at <= 0)) return false;
  return true;
}

function readRunState(env = process.env) {
  try {
    const statePath = runStatePath(env);
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return isValidRunState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function currentRunContext(env = process.env) {
  const state = readRunState(env);
  if (!state) return null;
  return Object.freeze({
    run_id: state.run_id,
    root_intent: state.root_intent,
    product_type: state.product_type,
    terminal: state.lifecycle === 'CLOSED'
  });
}

function canReadImplicitRunState(env = process.env) {
  return !isMaintenanceProcess(env);
}

function recordLocalTelemetryFailure(errorCode, message, env = process.env) {
  if (!telemetryEnabled(env)) return;
  const safeCode = safeDimension(errorCode, 'LOCAL_TELEMETRY_FAILED', 80);
  const safeMessage = safeDimension(message || safeCode, safeCode, 240);
  writeUploadStatus({
    status: 'local_failed',
    error_code: safeCode,
    error_message: safeMessage
  }, env);
  emitTelemetryError(new Error(safeCode));
}

function writeRunState(state, env = process.env) {
  return writePrivateJson(runStatePath(env), state);
}

function persistRunState(state, env = process.env) {
  const persisted = writeRunState(state, env);
  if (!persisted && telemetryEnabled(env)) {
    recordLocalTelemetryFailure('LOCAL_RUN_STATE_WRITE_FAILED', 'failed to write local telemetry run state', env);
  }
  return persisted;
}

function outboxFilename(event) {
  const timestamp = Number.isFinite(Number(event?.timestamp)) ? String(Number(event.timestamp)) : String(Date.now());
  const eventID = isConversationEvent(event)
    ? `${event.conversation_id}-${event.sequence}`
    : safeText(event?.event_id) || crypto.randomUUID();
  const suffix = isConversationEvent(event) ? '.conversation' : '.json';
  return `${timestamp}-${eventID}${suffix}`;
}

function writeOutboxRecord(event, env = process.env) {
  if (!telemetryEnabled(env)) return '';
  try {
    const normalizedEvent = normalizeTelemetryEvent(event);
    if (!normalizedEvent) return '';
    const dir = outboxDir(env);
    ensurePrivateDir(dir);
    const filename = outboxFilename(normalizedEvent);
    const finalPath = path.join(dir, filename);
    const record = { schema_ver: 2, created_at: Date.now(), platform: platformFromEnv(env), event: normalizedEvent };
    if (!writePrivateJson(finalPath, record)) return '';
    pruneOutbox(env);
    return finalPath;
  } catch {
    return '';
  }
}

export function enqueueMetricEvent(event, env = process.env) {
  if (!telemetryEnabled(env)) return false;
  return Boolean(writeOutboxRecord(event, env));
}

function safeRunId(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  return /[\u0000-\u001f\u007f,^=]/u.test(value) ? '' : value;
}

function platformProjectId(env = process.env, agentPlatform = platformFromEnv(env)) {
  if (agentPlatform === 'coze') return safeRunId(env.COZE_PROJECT_ID) || '';
  if (agentPlatform === 'meoo') return safeRunId(env.MEOO_PROJECT_ID) || '';
  if (agentPlatform === 'miaoda' && env.MIAODA) return safeRunId(env.VITE_APP_ID) || '';
  return '';
}

function canonicalProductType(value) {
  const canonical = typeof value === 'string' ? productAliases[value] : '';
  return canonicalProductTypes.has(canonical) ? canonical : '';
}

function parseNonNegativeInteger(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function sleepSync(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(ms, 30000));
  } catch {}
}

function normalizeUserInputId(value) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!text || text.length > 256 || /[\u0000-\u001f\u007f]/u.test(text)) return '';
  return text;
}

function userInputHash(inputId, runId) {
  const normalized = normalizeUserInputId(inputId);
  if (!normalized || !safeRunId(runId)) return '';
  return crypto.createHash('sha256').update(`${runId}\u0000${normalized}`).digest('hex').slice(0, 32);
}

function normalizeUserInputHashes(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry) => typeof entry === 'string' && /^[a-f0-9]{32}$/u.test(entry)))];
}

function parseHistoryCount(value, { strict = false } = {}) {
  if (value === null || value === 'null' || value === undefined) return null;
  const parsed = parseNonNegativeInteger(value);
  if (parsed !== null) return parsed;
  if (strict) throw new Error('--history-count 只支持非负整数或 null');
  return undefined;
}

function stageExtInfoFromPayload(payload = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return '';
  const userInputAfterClarifyIntent = parseNonNegativeInteger(
    payload.userInputAfterClarifyIntent ?? payload.user_input_after_clarify_intent
  );
  if (userInputAfterClarifyIntent === null) return '';
  const historyCount = parseHistoryCount(payload.historyCount ?? payload.history_count);
  if (historyCount === undefined) return '';
  const rootIntent = payload.rootIntent ?? payload.root_intent;
  if (!allowedRootIntents.has(rootIntent)) return '';
  const progressPct = Number(payload.progressPct ?? payload.progress_pct);
  if (!Number.isSafeInteger(progressPct) || progressPct < 0 || progressPct > 100) return '';
  return JSON.stringify({
    user_input_after_clarify_intent: userInputAfterClarifyIntent,
    history_count: historyCount,
    root_intent: rootIntent,
    progress_pct: progressPct
  });
}

function legalStageForState(state, stage) {
  if (!state || !stageRules.has(stage)) return false;
  if (stage === 'clarify_intent') return true;
  if (stage === 'integration_summary') return ['integration_only', 'full_process'].includes(state.root_intent);
  if (stage === 'onboarding_summary') return state.root_intent === 'onboarding_only';
  if (stage === 'all_summary') return state.root_intent === 'full_process';
  return routeStages(state.root_intent, state.product_type).includes(stage);
}

function eventFromState(stage, state, historyCount, nowMs = Date.now(), eventId = crypto.randomUUID()) {
  if (!legalStageForState(state, stage)) return null;
  const completedStages = completedStageList(state);
  const progressPct = stage === 'clarify_intent'
    ? 0
    : progressPctForStage(state.root_intent, state.product_type, stage, completedStages);
  if (progressPct < 0) return null;
  const extInfo = stageExtInfoFromPayload({
    userInputAfterClarifyIntent: state.counter_count,
    historyCount,
    rootIntent: state.root_intent,
    progressPct
  });
  if (!extInfo) return null;
  return {
    schema_ver: 2,
    event_id: eventId,
    skill: 'alipay-aipay',
    skill_version: skillVersionFromDisk(),
    run_id: state.run_id,
    stage,
    timestamp: nowMs,
    flow: flowForStage(stage),
    product_type: state.product_type,
    root_intent: state.root_intent,
    ext_info: extInfo
  };
}

function writeMetricEventMarker(event, stream) {
  if (stream && typeof stream.write === 'function') {
    stream.write(`${internalPrefix}METRIC_EVENT=${JSON.stringify(event)}\n`);
  }
}

export function emitStageMetric(stage, context = {}, env = process.env) {
  try {
    if (!telemetryEnabled(env) || !stageRules.has(stage)) return false;
    const activeRun = currentRunContext(env);
    const runId = safeRunId(context.runId || context.run_id || env.ALIPAY_AIPAY_TELEMETRY_RUN_ID || activeRun?.run_id);
    const historyCount = context.historyCount ?? context.history_count ?? env.ALIPAY_AIPAY_TELEMETRY_HISTORY_COUNT ?? 'null';
    const child = spawnSync(process.execPath, [
      scriptPath(), 'stage', stage,
      '--run-id', runId,
      '--history-count', String(historyCount)
    ], {
      stdio: normalizeSwitch(env.ALIPAY_AIPAY_TEST_MODE) === '1' ? 'inherit' : 'ignore',
      env,
      timeout: uploadTimeoutMs + 2000
    });
    return !child.error && child.status === 0;
  } catch {
    return false;
  }
}

export function emitMessageMetric(messageId, variantName, variables = {}, context = {}, env = process.env) {
  try {
    const stage = messageStageFor(messageId, context, env);
    return stage ? emitStageMetric(stage, context, env) : false;
  } catch {
    return false;
  }
}

function parseCliArgs(argv) {
  const command = argv[2];
  const args = { _: [] };
  for (let index = 3; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const name = token.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`参数 --${name} 缺少取值`);
    args[name] = value;
    index += 1;
  }
  return { command, args };
}

function contextFromCliArgs(args) {
  const context = {
    runId: args['run-id'],
    historyCount: args['history-count']
  };
  return context;
}

function assertCliArgs(args, allowedOptions, positionalCount) {
  for (const name of Object.keys(args)) {
    if (name !== '_' && !allowedOptions.has(name)) throw new Error(`不支持参数 --${name}`);
  }
  if (args._.length !== positionalCount) throw new Error('invalid telemetry arguments');
}

function createRunState(args, env = process.env, nowMs = Date.now()) {
  const rootIntent = args['root-intent'];
  if (!allowedRootIntents.has(rootIntent)) throw new Error('--root-intent 仅支持 integration_only、onboarding_only、full_process');
  const productType = canonicalProductType(args['product-type']);
  if (!productType) return null;
  const runId = crypto.randomUUID();
  return {
    schema_ver: 2,
    run_id: runId,
    root_intent: rootIntent,
    product_type: productType,
    lifecycle: 'ACTIVE',
    clarify_intent_recorded: false,
    counter_count: 0,
    input_hashes: [],
    stage_events: {},
    created_at: nowMs,
    updated_at: nowMs,
    terminal_at: null
  };
}

function reusableRunState(existing, requestedRootIntent, requestedProductType) {
  if (!existing || existing.lifecycle !== 'ACTIVE') return false;
  if (existing.root_intent !== requestedRootIntent) return false;
  const existingProductType = canonicalProductType(existing.product_type);
  const nextProductType = canonicalProductType(requestedProductType);
  if (!existingProductType || !nextProductType) return false;
  return existingProductType === nextProductType;
}

function createOrReuseRunState(args, env = process.env, nowMs = Date.now()) {
  const rootIntent = args['root-intent'];
  if (!allowedRootIntents.has(rootIntent)) throw new Error('--root-intent 仅支持 integration_only、onboarding_only、full_process');
  const requestedProductType = canonicalProductType(args['product-type']);
  if (!requestedProductType) return null;
  const existing = readRunState(env);
  if (reusableRunState(existing, rootIntent, requestedProductType)
    && (telemetryEnabled(env) ? existing.clarify_intent_recorded === true : true)) {
    const state = {
      ...existing,
      updated_at: nowMs
    };
    return {
      reused: true,
      state
    };
  }
  const state = createRunState(args, env, nowMs);
  return state ? { reused: false, state } : null;
}

export function recordTelemetryUserInput(inputId, env = process.env, nowMs = Date.now(), runId = '') {
  if (!telemetryEnabled(env)) return null;
  const transaction = withRunStateLock(env, () => {
    const existing = readRunState(env);
    const explicitRunId = safeRunId(runId);
    if (!existing?.run_id || existing.lifecycle !== 'ACTIVE' || !explicitRunId || explicitRunId !== existing.run_id) return null;
    const normalizedInputId = normalizeUserInputId(inputId);
    if (!normalizedInputId) throw new Error('用户输入计数必须提供不含用户原文或敏感信息的本地幂等 --input-id');
    const count = parseNonNegativeInteger(existing.counter_count);
    if (count === null) return null;
    const hashes = normalizeUserInputHashes(existing.input_hashes);
    const inputHash = userInputHash(normalizedInputId, existing.run_id);
    if (!inputHash) throw new Error('用户输入计数 input-id 无法生成本地幂等键');
    if (hashes.includes(inputHash)) return { user_input_after_clarify_intent: count };
    const next = {
      ...existing,
      counter_count: count + 1,
      input_hashes: [...hashes, inputHash],
      updated_at: nowMs
    };
    return persistRunState(next, env)
      ? { user_input_after_clarify_intent: next.counter_count }
      : null;
  });
  if (!transaction.acquired) {
    recordLocalTelemetryFailure('LOCAL_RUN_STATE_WRITE_FAILED', 'failed to lock local telemetry run state', env);
    return null;
  }
  return transaction.value;
}

function conversationSessionSource(env, explicitSessionId = '') {
  // Never use a project ID or the shared default key for conversation identity.
  return stableSessionSource(env) || safeRunId(explicitSessionId) || '';
}

function conversationStatePath(conversationId, env) {
  return validConversationId(conversationId)
    ? path.join(stateDir(env), 'conversations', `${conversationId}.json`) : '';
}

function sessionHash(source) {
  return crypto.createHash('sha256').update(source).digest('hex');
}

function conversationSessionFile(ownerHash, suffix, env) {
  return path.join(stateDir(env), 'conversations', `${ownerHash}.${suffix}`);
}

function readConversationConsent(ownerHash, env) {
  try {
    const consent = JSON.parse(fs.readFileSync(conversationSessionFile(ownerHash, 'consent', env), 'utf8'));
    if (consent.schema_ver !== 1 || consent.session_hash !== ownerHash
      || !['GRANTED', 'DENIED'].includes(consent.decision)
      || (consent.decision === 'GRANTED' && !validConversationId(consent.grant_id))
      || !Array.isArray(consent.input_hashes)
      || consent.input_hashes.some(hash => !/^[a-f0-9]{32}$/.test(hash))) return null;
    return consent;
  } catch { return null; }
}

// Consent is independent of business runs and contains no reply text. Replaying
// an earlier confirmation must never undo a later opt-out.
export function setConversationConsent({ sessionId = '', decision, inputId, conversationId } = {}, env = process.env) {
  if (!['GRANTED', 'DENIED'].includes(decision)) return null;
  // An explicit refusal is a privacy preference, even while collection is off.
  // Otherwise toggling the switch later could resurrect an older grant.
  if (decision !== 'DENIED' && (!telemetryEnabled(env) || !conversationCode(env))) return { decision: 'DISABLED' };
  const input = normalizeUserInputId(inputId);
  if (!input) return null;
  try {
    const source = conversationSessionSource(env, sessionId);
    const existing = conversationId ? readConversationState(conversationId, env) : null;
    const ownerHash = source ? sessionHash(source) : existing?.session_hash;
    if (!ownerHash || (conversationId && (!existing || existing.session_hash !== ownerHash))) return null;
    const transaction = withRunStateLock(env, () => {
      const previous = readConversationConsent(ownerHash, env);
      const hash = userInputHash(input, ownerHash);
      if (previous?.input_hashes.includes(hash)) return previous;
      const next = { schema_ver: 1, session_hash: ownerHash, decision,
        grant_id: decision === 'GRANTED'
          ? (previous?.decision === 'GRANTED' ? previous.grant_id : crypto.randomUUID()) : null,
        input_hashes: [...(previous?.input_hashes || []), hash] };
      if (!writePrivateJson(conversationSessionFile(ownerHash, 'consent', env), next)) return null;
      if (decision === 'DENIED') {
        // The consent gate already prevents writes even if closing state fails.
        let indexedId;
        try { indexedId = JSON.parse(fs.readFileSync(conversationSessionFile(ownerHash, 'index', env), 'utf8')).conversation_id; } catch {}
        for (const id of new Set([conversationId, indexedId])) {
          const state = readConversationState(id, env);
          if (state?.session_hash === ownerHash && state.lifecycle === 'ACTIVE') {
            writePrivateJson(conversationStatePath(id, env), { ...state, lifecycle: 'CLOSED' });
          }
        }
      }
      return next;
    }, conversationSessionFile(ownerHash, 'index.lock', env), 0);
    return transaction.acquired ? transaction.value : null;
  } catch { return null; }
}

function hasConversationConsent(state, env) {
  const consent = state && readConversationConsent(state.session_hash, env);
  return consent?.decision === 'GRANTED' && state.consent_id === consent.grant_id;
}

function readConversationState(conversationId, env, { checkOwner = true } = {}) {
  try {
    const state = JSON.parse(fs.readFileSync(conversationStatePath(conversationId, env), 'utf8'));
    const source = checkOwner ? conversationSessionSource(env) : '';
    if (state.schema_ver !== 3 || state.conversation_id !== conversationId
      || !['ACTIVE', 'CLOSED'].includes(state.lifecycle)
      || !/^[a-f0-9]{64}$/.test(state.session_hash)
      || (source && state.session_hash !== sessionHash(source))
      || !Number.isSafeInteger(state.sequence) || state.sequence < 0
      || !Array.isArray(state.message_hashes) || state.message_hashes.length !== state.sequence
      || state.message_hashes.some((hash) => !/^[a-f0-9]{32}$/.test(hash))
      || new Set(state.message_hashes).size !== state.sequence
      || !Number.isSafeInteger(state.created_at) || state.created_at <= 0) return null;
    return state;
  } catch { return null; }
}

// Called only while holding the conversation's session lock. A private pending
// marker survives a crash between enqueue and the final sequence/dedup commit.
function reconcileConversationMessage(state, env) {
  if (!state || !Object.prototype.hasOwnProperty.call(state, 'pending_message')) return state;
  const pending = state.pending_message;
  if (!pending || pending.sequence !== state.sequence + 1
    || !Number.isSafeInteger(pending.sequence)
    || !/^[a-f0-9]{32}$/.test(pending.message_hash || '')
    || state.message_hashes.includes(pending.message_hash)
    || !Number.isSafeInteger(pending.timestamp) || pending.timestamp <= 0) return null;
  const basename = outboxFilename({ kind: 'conversation_message',
    conversation_id: state.conversation_id, sequence: pending.sequence, timestamp: pending.timestamp });
  let queued;
  try {
    const names = fs.readdirSync(outboxDir(env));
    const name = names.find(name => name === basename || name.startsWith(`${basename}.sending.`));
    if (name) {
      queued = readOutboxRecord(path.join(outboxDir(env), name));
      if (!queued || queued.event.conversation_id !== state.conversation_id
        || queued.event.sequence !== pending.sequence || queued.event.timestamp !== pending.timestamp) return null;
    }
  } catch (error) {
    // Missing queue means the process stopped before enqueue, or cleanup succeeded.
    if (error?.code !== 'ENOENT') return null;
  }
  const { pending_message: _pending, ...next } = state;
  if (queued) {
    next.sequence = pending.sequence;
    next.message_hashes = [...state.message_hashes, pending.message_hash];
  }
  return writePrivateJson(conversationStatePath(state.conversation_id, env), next) ? next : null;
}

export function startConversation({ sessionId = '' } = {}, env = process.env, nowMs = Date.now()) {
  if (!telemetryEnabled(env) || !conversationCode(env)) return null;
  try {
    const source = conversationSessionSource(env, sessionId);
    if (!source) return null;
    const ownerHash = sessionHash(source);
    const indexPath = path.join(stateDir(env), 'conversations', `${ownerHash}.index`);
    const transaction = withRunStateLock(env, () => {
      const consent = readConversationConsent(ownerHash, env);
      if (consent?.decision !== 'GRANTED') return null;
      let existingId;
      try { existingId = JSON.parse(fs.readFileSync(indexPath, 'utf8')).conversation_id; } catch {}
      const existing = readConversationState(existingId, env);
      if (existing?.lifecycle === 'ACTIVE' && existing.session_hash === ownerHash
        && existing.consent_id === consent.grant_id) {
        return { ...existing, created: false };
      }
      const conversationId = crypto.randomUUID();
      const state = { schema_ver: 3, lifecycle: 'ACTIVE', conversation_id: conversationId, session_hash: ownerHash,
        consent_id: consent.grant_id,
        created_at: nowMs, sequence: 0, message_hashes: [] };
      if (!writePrivateJson(conversationStatePath(conversationId, env), state)
        || !writePrivateJson(indexPath, { conversation_id: conversationId })) return null;
      return { ...state, created: true };
    }, `${indexPath}.lock`, 0);
    return transaction.acquired ? transaction.value : null;
  } catch { return null; }
}

function conversationEventBase(state, productType, env, nowMs) {
  return { schema_ver: 5, kind: 'conversation_message',
    skill: 'alipay-aipay', skill_version: skillVersionFromDisk(), conversation_id: state.conversation_id,
    product_type: productType, timestamp: nowMs, code: conversationCode(env) };
}

export function endConversation(conversationId, env = process.env) {
  if (!telemetryEnabled(env) || !conversationCode(env) || !validConversationId(conversationId)) return null;
  try {
    const file = conversationStatePath(conversationId, env);
    const existing = readConversationState(conversationId, env);
    if (!existing) return null;
    const transaction = withRunStateLock(env, () => {
      const state = readConversationState(conversationId, env);
      if (!state || state.lifecycle === 'CLOSED') return state;
      const closed = { ...state, lifecycle: 'CLOSED' };
      return writePrivateJson(file, closed) ? closed : null;
    }, conversationSessionFile(existing.session_hash, 'index.lock', env), 0);
    return transaction.acquired ? transaction.value : null;
  } catch { return null; }
}

export async function recordConversationMessage(message, context = {}, env = process.env, nowMs = Date.now()) {
  if (!telemetryEnabled(env) || !conversationCode(env)) return null;
  try {
    message = normalizeConversationMessageInput(message);
    if (!message) return null;
    const allowed = new Set(['role', 'content', 'has_attachments']);
    if (!hasOnlyFields(message, allowed) || !['user', 'assistant'].includes(message.role)
      || (message.has_attachments !== undefined && typeof message.has_attachments !== 'boolean')) return null;
    const sanitized = sanitizeConversationText(message.content);
    const messageId = normalizeUserInputId(context.messageId);
    // Assistant content is captured only when the caller explicitly marks the final reply.
    if (message.role === 'assistant' && context.final !== true) return null;
    const conversationId = context.conversationId;
    const productType = context.productType == null ? null : canonicalProductType(context.productType);
    if (!hasOnlyFields(context, new Set(['conversationId', 'messageId', 'productType', 'final']))
      || !sanitized || !messageId || !validConversationId(conversationId)
      || (context.productType != null && !productType)) return null;
    const file = conversationStatePath(conversationId, env);
    const existing = readConversationState(conversationId, env);
    if (!existing) return null;
    const transaction = withRunStateLock(env, () => {
      const state = reconcileConversationMessage(readConversationState(conversationId, env), env);
      if (!state || state.lifecycle !== 'ACTIVE' || !hasConversationConsent(state, env)) return null;
      const hash = userInputHash(`${message.role}:${messageId}`, conversationId);
      const existingIndex = state.message_hashes.indexOf(hash);
      // A retry of an already captured message keeps its original sequence and is
      // reported as a duplicate success, never as a capture failure.
      if (existingIndex !== -1) return { duplicate: true, sequence: existingIndex + 1 };
      const sequence = state.sequence + 1;
      const event = normalizeConversationEvent({ ...conversationEventBase(state, productType, env, nowMs),
        sequence, role: message.role, content: sanitized.content, truncated: sanitized.truncated,
        has_attachments: message.has_attachments ?? false, redaction_version: 1 });
      if (!event) return null;
      // Reserve only recovery metadata, not a committed sequence or message body.
      if (!writePrivateJson(file, { ...state, pending_message: {
        sequence, message_hash: hash, timestamp: event.timestamp
      } })) return null;
      const queuedFile = writeOutboxRecord(event, env);
      if (!queuedFile) {
        writePrivateJson(file, state);
        return null;
      }
      const next = { ...state, sequence, message_hashes: [...state.message_hashes, hash] };
      if (!writePrivateJson(file, next)) {
        try { fs.unlinkSync(queuedFile); } catch {}
        return null;
      }
      return event;
    }, conversationSessionFile(existing.session_hash, 'index.lock', env), 0);
    if (!transaction.acquired || !transaction.value) return null;
    // Recovered duplicate retries may also need to wake their queued upload.
    // Already queued under the session lock; do not enqueue twice or wait for HTTP.
    // Never echo dialogue content in stderr markers, including in capture-only mode.
    if (telemetryUploadEnabled(env)) spawnOutboxFlush(env, { recordStageFailure: false });
    return transaction.value;
  } catch { return null; }
}

async function deliverPersistedStageEvent(event, env = process.env, stream = process.stderr) {
  if (!isConversationEvent(event)) writeMetricEventMarker(event, stream);
  const queuedFile = writeOutboxRecord(event, env);
  if (!queuedFile) {
    if (!isConversationEvent(event)) recordLocalTelemetryFailure('LOCAL_OUTBOX_WRITE_FAILED', 'outbox write failed', env);
    return false;
  }
  if (!isConversationEvent(event)) {
    // Conversation events share the outbox but keep their own background delivery;
    // the shared upload status file keeps describing stage uploads only.
    writeUploadStatus({ status: 'pending', attempted: 0, sent: 0, retained: 1 }, env);
  }
  if (!telemetryUploadEnabled(env)) return true;
  if (isConversationEvent(event)) {
    spawnOutboxFlush(env, { recordStageFailure: false });
    return true;
  }
  await flushOutbox(env, { limit: 1, targetFile: queuedFile, timeoutMs: uploadTimeoutMs });
  if (hasPendingOutboxRecords(env)) spawnOutboxFlush(env);
  return true;
}

export async function recordStageEvent(stage, context = {}, env = process.env, nowMs = Date.now(), stream = process.stderr) {
  if (!telemetryEnabled(env)) return null;
  if (!stageRules.has(stage)) throw new Error('stage 不在公开 telemetry stage 列表中');
  const runId = safeRunId(context.runId || context.run_id);
  const historyCount = parseHistoryCount(context.historyCount ?? context.history_count, { strict: true });
  const transaction = withRunStateLock(env, () => {
    const existing = readRunState(env);
    if (!existing || existing.lifecycle !== 'ACTIVE') return { kind: 'noop' };
    if (!runId || runId !== existing.run_id) return { kind: 'noop' };
    if (!existing.clarify_intent_recorded || !stageAlreadyRecorded(existing, 'clarify_intent')) return { kind: 'noop' };
    if (!legalStageForState(existing, stage) || stage === 'clarify_intent') return { kind: 'noop' };
    if (stageAlreadyRecorded(existing, stage)) return { kind: 'duplicate' };
    if (parseNonNegativeInteger(existing.counter_count) === null) return { kind: 'noop' };
    const event = eventFromState(stage, existing, historyCount, nowMs);
    if (!event) return { kind: 'noop' };
    const closesRun = shouldCloseRunAfterStage(event, existing);
    const next = {
      ...existing,
      stage_events: {
        ...existing.stage_events,
        [stage]: { event_id: event.event_id, generated_at: nowMs }
      },
      lifecycle: closesRun ? 'CLOSED' : existing.lifecycle,
      terminal_at: closesRun ? nowMs : existing.terminal_at,
      updated_at: nowMs
    };
    return persistRunState(next, env) ? { kind: 'created', event } : { kind: 'lost' };
  });
  if (!transaction.acquired) {
    recordLocalTelemetryFailure('LOCAL_RUN_STATE_WRITE_FAILED', 'failed to lock local telemetry run state', env);
    return null;
  }
  const result = transaction.value;
  if (result?.kind !== 'created') return null;
  await deliverPersistedStageEvent(result.event, env, stream);
  return result.event;
}

export async function startTelemetryRun(rootIntent, productType, _inputId = '', {
  env = process.env,
  nowMs = Date.now(),
  stream = process.stderr
} = {}) {
  if (!allowedRootIntents.has(rootIntent)) {
    if (!rootIntent) return null;
    throw new Error('--root-intent 仅支持 integration_only、onboarding_only、full_process');
  }
  const canonicalProduct = canonicalProductType(productType);
  if (!canonicalProduct) return null;
  const enabled = telemetryEnabled(env);
  const transaction = withRunStateLock(env, () => {
    const run = createOrReuseRunState({
      'root-intent': rootIntent,
      'product-type': canonicalProduct
    }, env, nowMs);
    if (!run?.state) return null;
    if (run.reused) return persistRunState(run.state, env) ? { ...run, event: null } : null;
    let state = run.state;
    let event = null;
    if (enabled) {
      event = eventFromState('clarify_intent', state, 0, nowMs);
      if (!event) return null;
      state = {
        ...state,
        clarify_intent_recorded: true,
        stage_events: {
          clarify_intent: { event_id: event.event_id, generated_at: nowMs }
        }
      };
    } else {
      state = {
        schema_ver: 2,
        run_id: state.run_id,
        root_intent: state.root_intent,
        product_type: state.product_type,
        lifecycle: 'ACTIVE',
        telemetry_disabled: true,
        created_at: state.created_at,
        updated_at: nowMs,
        terminal_at: null
      };
    }
    return persistRunState(state, env) ? { ...run, state, event } : null;
  });
  if (!transaction.acquired || !transaction.value?.state) {
    recordLocalTelemetryFailure('LOCAL_RUN_STATE_WRITE_FAILED', 'failed to persist local telemetry run state', env);
    return null;
  }
  const { state, event } = transaction.value;
  env.ALIPAY_AIPAY_TELEMETRY_RUN_ID = state.run_id;
  if (event) env.ALIPAY_AIPAY_TELEMETRY_HISTORY_COUNT = '0';
  if (stream && typeof stream.write === 'function') {
    stream.write(`${internalPrefix}RUN_ID=${state.run_id}\n`);
  }
  if (event) await deliverPersistedStageEvent(event, env, stream);
  return state;
}

function normalizeOS(platform = process.platform) {
  switch (platform) {
    case 'darwin':
      return 'macOS';
    case 'linux':
      return 'Linux';
    case 'win32':
      return 'Windows';
    default:
      return 'Other';
  }
}

export function platformFromEnv(env = process.env) {
  const agentPlatform = normalizePlatform(env.ALIPAY_AIPAY_AGENT_PLATFORM);
  if (agentPlatform !== 'unknown') return agentPlatform;
  if (env.CLAUDE_CODE_SESSION_ID || env.CLAUDE_SESSION_ID || env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT) return 'claudecode';
  if (env.OPENCLAW_SESSION_ID || env.OPENCLAW_AGENT_ID) return 'openclaw';
  if (env.CURSOR_TRACE_ID || env.CURSOR_SESSION_ID || env.CURSOR_AGENT || env.CURSOR_LAYOUT) return 'cursor';
  if (env.COZE_PROJECT_ID || env.COZE_SESSION_ID || env.COZE_CONVERSATION_ID) return 'coze';
  if (env.MEOO_PROJECT_ID) return 'meoo';
  if (env.MIAODA) return 'miaoda';
  if (env.CODEX_CI || env.CODEX_THREAD_ID || env.CODEX_SESSION_ID || env.CODEX_SANDBOX_NETWORK_DISABLED !== undefined) return 'codex';
  if (env.TRAE_BRAND_NAME) return 'traesolo';
  if (env.QODER_CLI) return 'qoder';
  for (const key of ['ALIPAY_AIPAY_PLATFORM', 'AIPAY_AGENT_TYPE', 'DEV_TOOL_NAME', 'PLATFORM']) {
    const platform = normalizePlatform(env[key]);
    if (platform !== 'unknown') return platform;
  }
  return 'unknown';
}

function modelFromEnv(env = process.env) {
  const raw = env.ALIPAY_AIPAY_MODEL || env.AIPAY_MODEL || '';
  const normalized = String(raw).trim().toLowerCase();
  if (!normalized) return 'unknown';

  // Keep model telemetry at a coarse family level; variants and reasoning modes are not needed here.
  if (/^(?:openai\/)?gpt[-_ ]?5(?:[.\-_ ]|$)/u.test(normalized)) return 'gpt-5';
  if (/^(?:openai\/)?gpt[-_ ]?4(?:[.\-_ ]|$)/u.test(normalized)) return 'gpt-4';
  if (/^claude(?:[.\-_ ]|$)/u.test(normalized)) return 'claude';
  if (/^gemini(?:[.\-_ ]|$)/u.test(normalized)) return 'gemini';
  if (/^qwen(?:[.\-_ ]|$)/u.test(normalized)) return 'qwen';
  if (/^deepseek(?:[.\-_ ]|$)/u.test(normalized)) return 'deepseek';
  if (/^llama(?:[.\-_ ]|$)/u.test(normalized)) return 'llama';
  return 'unknown';
}

function skillVersionFromDisk() {
  try {
    return normalizeSkillVersion(fs.readFileSync(path.join(skillRoot(), 'VERSION'), 'utf8')) || 'unknown';
  } catch {}
  return 'unknown';
}

function normalizeSkillVersion(value) {
  const match = String(value || '').trim().match(/^v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/);
  return match ? `v${match[1]}` : '';
}

function skillVersionFromEvent(event) {
  return normalizeSkillVersion(event?.skill_version) || skillVersionFromDisk();
}

function isLocalSkillCheckout() {
  try {
    return fs.existsSync(path.join(skillRoot(), '../.git'));
  } catch {
    return false;
  }
}

function machineCodeRaw(env = process.env) {
  const explicit = env.ALIPAY_AIPAY_MACHINE_CODE || env.AIPAY_MACHINE_CODE;
  if (explicit) return explicit;
  try {
    if (process.platform === 'linux') {
      for (const file of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
        if (fs.existsSync(file)) {
          const value = fs.readFileSync(file, 'utf8').trim();
          if (value) return value;
        }
      }
    }
    if (process.platform === 'darwin') {
      const output = execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 1000
      });
      const match = output.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
      if (match?.[1]) return match[1];
    }
    if (process.platform === 'win32') {
      const output = execFileSync('REG', ['QUERY', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 1000
      });
      const match = output.match(/MachineGuid\s+REG_SZ\s+([^\s\r\n]+)/);
      if (match?.[1]) return match[1];
    }
  } catch {}
  try {
    const hostname = os.hostname();
    if (hostname) return `hostname:${hostname}`;
  } catch {}
  return '';
}

export function machineUserID(env = process.env) {
  const raw = machineCodeRaw(env);
  if (!raw) return 'anonymous_uid';
  const hash = crypto.createHash('sha256').update(String(raw)).digest('hex').slice(0, 32);
  return `machine_${hash}`;
}

function monitorEnv(env = process.env, skillVersion = skillVersionFromDisk()) {
  switch (normalizeSwitch(env.AIPAY_BUILD_ENV)) {
    case 'dev':
      return 'DEV';
    case 'pre':
      return 'PRE';
    case 'prod':
      return 'PROD';
    default:
      break;
  }
  if (/^v?\d+\.\d+\.\d+-/.test(skillVersion)) return 'PRE';
  if (skillVersion !== 'unknown' && !isLocalSkillCheckout()) return 'PROD';
  return 'DEV';
}

function hasOnlyFields(value, allowedFields) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every((field) => allowedFields.has(field));
}

function normalizeMetricEvent(event) {
  if (!hasOnlyFields(event, metricEventFields)) return null;
  if (event.schema_ver !== 2 || event.skill !== 'alipay-aipay') return null;
  const eventId = safeText(event.event_id);
  if (!eventId || eventId.length > 128) return null;
  const skillVersion = normalizeSkillVersion(event.skill_version);
  if (!skillVersion && event.skill_version !== 'unknown') return null;
  const runId = safeRunId(event.run_id);
  if (!runId || runId !== event.run_id) return null;
  const stageRule = stageRules.get(event.stage);
  if (!stageRule || event.flow !== stageRule.flow) return null;
  if (!Number.isSafeInteger(event.timestamp) || event.timestamp <= 0) return null;
  const productType = canonicalProductType(event.product_type);
  if (!productType || productType !== event.product_type) return null;
  const rootIntent = event.root_intent;
  if (rootIntent !== undefined && !allowedRootIntents.has(rootIntent)) return null;

  const normalized = {
    schema_ver: 2,
    event_id: eventId,
    skill: 'alipay-aipay',
    skill_version: skillVersion || 'unknown',
    run_id: runId,
    stage: event.stage,
    timestamp: event.timestamp,
    flow: event.flow,
    product_type: productType
  };
  if (rootIntent !== undefined) normalized.root_intent = rootIntent;

  if (!Object.prototype.hasOwnProperty.call(event, 'ext_info') || typeof event.ext_info !== 'string') return null;
  let parsedExtInfo;
  try {
    parsedExtInfo = JSON.parse(event.ext_info);
  } catch {
    return null;
  }
  if (!hasOnlyFields(parsedExtInfo, stageExtInfoFields)) return null;
  if (rootIntent && parsedExtInfo.root_intent && parsedExtInfo.root_intent !== rootIntent) return null;
  const extInfo = stageExtInfoFromPayload({
    ...parsedExtInfo,
    rootIntent: rootIntent || parsedExtInfo.root_intent
  }, {});
  if (!extInfo) return null;
  normalized.ext_info = extInfo;
  return normalized;
}

function isConversationEvent(event) {
  return event?.kind === 'conversation_message';
}

function normalizeTelemetryEvent(event) {
  return isConversationEvent(event) ? normalizeConversationEvent(event) : normalizeMetricEvent(event);
}

export function buildSyncLogReport(event, env = process.env, dimensions = {}) {
  const normalizedEvent = normalizeTelemetryEvent(event);
  if (!normalizedEvent) return null;
  const skillVersion = skillVersionFromEvent(normalizedEvent);
  const item = {
    code: syncLogCode,
    msg: syncLogMsg,
    d1: normalizeOS(),
    d2: Object.prototype.hasOwnProperty.call(dimensions, 'platform')
      ? normalizePlatform(dimensions.platform)
      : platformFromEnv(env),
    d3: modelFromEnv(env),
    d4: skillVersion,
    d5: normalizedEvent.product_type || 'UNKNOWN',
    c1: normalizedEvent.run_id,
    c2: normalizedEvent.stage,
    c3: normalizedEvent.timestamp
  };
  if (normalizedEvent.ext_info) item.c4 = normalizedEvent.ext_info;
  if (isConversationEvent(normalizedEvent)) {
    item.code = normalizedEvent.code;
    item.msg = 'alipay_aipay_skill_conversation';
    item.c1 = normalizedEvent.conversation_id;
    item.c2 = JSON.stringify({ sequence: normalizedEvent.sequence,
      role: normalizedEvent.role, content: normalizedEvent.content });
    delete item.c3;
    delete item.c4;
  }
  return {
    item,
    options: {
      Env: monitorEnv(env, skillVersion),
      SprintID: skillVersion,
      UserID: machineUserID(env),
      YuyanID: syncLogYuyanID
    }
  };
}

function serializeSyncLogParam4(param4) {
  return Object.keys(param4)
    .filter((key) => param4[key] !== undefined && param4[key] !== null)
    .sort()
    .map((key) => `${key}=${encodeSyncLogParam4Value(param4[key])}`)
    .join('^');
}

function encodeSyncLogParam4Value(value) {
  const text = String(value ?? '');
  try {
    return encodeURIComponent(text).replace(/'/g, '%27');
  } catch {
    return encodeURIComponent(text.replace(/[\uD800-\uDFFF]/g, '\uFFFD')).replace(/'/g, '%27');
  }
}

export function buildSyncLogLine(userID, param4, date = new Date()) {
  const pad = (value, length = 2) => String(value).padStart(length, '0');
  const clientLogTime = [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}:${date.getMilliseconds()}`
  ].join(' ');

  return [
    'D-AE',
    clientLogTime,
    '',
    '',
    '2',
    '',
    '',
    userID || 'anonymous_uid',
    '1000',
    '102023',
    'H5behavior',
    '2',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    'zh-cn',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    serializeSyncLogParam4(param4)
  ].join(',');
}

function buildParam4(item, options) {
  const param4 = { ...item };
  if (options.SprintID) param4.bm_sid = options.SprintID;
  if (options.Env && !param4.env) param4.env = options.Env;
  if (options.YuyanID) param4.yuyan_id = options.YuyanID;
  param4.monitor_ver = syncLogMonitorVersion;
  return param4;
}

export function syncLogRequestBody(report, nowMs = Date.now()) {
  const param4 = buildParam4(report.item, report.options);
  return `data=${encodeURIComponent(buildSyncLogLine(report.options.UserID || 'anonymous_uid', param4))}&time=${nowMs}`;
}

export function isSuccessfulHttpStatus(statusCode) {
  const code = Number(statusCode || 0);
  return code >= 200 && code < 300;
}

export function sendSyncLogReportDetailed(report, {
  timeoutMs = report?.item?.msg === 'alipay_aipay_skill_conversation' ? conversationUploadTimeoutMs : uploadTimeoutMs,
  request = https.request
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    let req;
    const limit = report?.item?.msg === 'alipay_aipay_skill_conversation' ? conversationUploadTimeoutMs : uploadTimeoutMs;
    const budget = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, limit) : limit;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timeout = () => {
      finish({ ok: false, error_code: 'ETIMEDOUT', error_message: 'request timeout' });
      req?.destroy();
    };
    try {
      if (!report?.item || !report?.options) {
        finish({ ok: false, error_code: 'INVALID_REPORT', error_message: 'invalid report' });
        return;
      }
      const body = syncLogRequestBody(report);
      // A wall-clock deadline also covers DNS/TLS stalls and trickling responses.
      timer = setTimeout(timeout, budget);
      req = request(`${syncLogServerURL}?biztype=${syncLogBizType}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body)
        },
        timeout: budget
      }, (resp) => {
        resp.resume();
        resp.on('error', error => finish(failedResult(error)));
        resp.on('end', () => {
          const statusCode = Number(resp.statusCode || 0);
          const ok = isSuccessfulHttpStatus(statusCode);
          finish({
            ok,
            status_code: statusCode || undefined,
            error_code: ok ? undefined : statusCode > 0 ? `HTTP_${statusCode}` : 'NO_HTTP_STATUS',
            error_message: ok ? undefined : statusCode > 0
              ? `http ${statusCode}`
              : 'no http status'
          });
        });
      });
      req.on('timeout', timeout);
      req.on('error', (error) => finish(failedResult(error)));
      req.end(body);
    } catch (error) {
      finish(failedResult(error));
    }
  });
}

function outboxFiles(env = process.env, { targetFile = '', limit = 0 } = {}) {
  if (!telemetryEnabled(env)) return [];
  try {
    const dir = outboxDir(env);
    recoverStaleOutboxClaims(env);
    pruneOutbox(env);
    if (targetFile) {
      const resolved = path.resolve(String(targetFile));
      const basename = path.basename(resolved);
      return path.dirname(resolved) === path.resolve(dir)
        && isOutboxRecordName(basename)
        && !basename.startsWith('.')
        && fs.existsSync(resolved)
        ? [resolved]
        : [];
    }
    const files = outboxRecordEntries(dir)
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => entry.file);
    return limit > 0 ? files.slice(0, limit) : files;
  } catch {
    return [];
  }
}

function isOutboxRecordName(name) {
  return !name.startsWith('.') && (name.endsWith('.json') || name.endsWith('.conversation'));
}

function isOutboxClaimName(name) {
  return !name.startsWith('.') && (name.includes('.json.sending.') || name.includes('.conversation.sending.'));
}

function outboxRecordEntries(dir) {
  return fs.readdirSync(dir)
    .filter(isOutboxRecordName)
    .map((name) => {
      const file = path.join(dir, name);
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(file).mtimeMs;
      } catch {}
      return { file, name, mtimeMs };
    })
    .filter((entry) => entry.mtimeMs > 0);
}

function pruneOutbox(env = process.env, nowMs = Date.now()) {
  if (!telemetryEnabled(env)) return;
  try {
    const dir = outboxDir(env);
    let entries = outboxRecordEntries(dir);
    for (const entry of entries) {
      if (nowMs - entry.mtimeMs <= outboxMaxAgeMs) continue;
      try {
        fs.unlinkSync(entry.file);
      } catch {}
    }
    entries = outboxRecordEntries(dir);
    // Conversation volume must not evict pending business stage events.
    for (const conversation of [false, true]) {
      const group = entries.filter(entry => entry.name.endsWith('.conversation') === conversation);
      const overflow = group.length - outboxMaxRecords;
      if (overflow <= 0) continue;
      group
        .sort((left, right) => left.mtimeMs - right.mtimeMs || left.name.localeCompare(right.name))
        .slice(0, overflow)
        .forEach((entry) => {
          try {
            fs.unlinkSync(entry.file);
          } catch {}
        });
    }
  } catch {}
}

function recoverStaleOutboxClaims(env = process.env, nowMs = Date.now()) {
  try {
    const dir = outboxDir(env);
    for (const name of fs.readdirSync(dir)) {
      if (!isOutboxClaimName(name)) continue;
      const claimedPath = path.join(dir, name);
      const stat = fs.statSync(claimedPath);
      if (nowMs - stat.mtimeMs < outboxClaimTtlMs) continue;
      const originalName = name.replace(/\.sending\.[^.]+$/, '');
      const originalPath = path.join(dir, originalName);
      try {
        if (fs.existsSync(originalPath)) fs.unlinkSync(claimedPath);
        else fs.renameSync(claimedPath, originalPath);
      } catch {}
    }
  } catch {}
}

function claimOutboxFile(file) {
  const claimedPath = `${file}.sending.${process.pid}`;
  try {
    fs.renameSync(file, claimedPath);
    return claimedPath;
  } catch {
    return '';
  }
}

function releaseOutboxClaim(claimedPath) {
  const originalPath = claimedPath.replace(/\.sending\.[^.]+$/, '');
  try {
    if (fs.existsSync(originalPath)) fs.unlinkSync(claimedPath);
    else fs.renameSync(claimedPath, originalPath);
    return true;
  } catch {
    return false;
  }
}

function outboxTargetFilePending(file) {
  try {
    if (fs.existsSync(file)) return true;
    const dir = path.dirname(file);
    const prefix = `${path.basename(file)}.sending.`;
    return fs.readdirSync(dir).some((name) => name.startsWith(prefix));
  } catch {
    return false;
  }
}

function readOutboxRecord(file) {
  try {
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (record?.schema_ver === 1) {
      if (!hasOnlyFields(record, outboxV1RecordFields)) return null;
    } else if (record?.schema_ver === 2) {
      if (!hasOnlyFields(record, outboxV2RecordFields)) return null;
      if (typeof record.platform !== 'string' || normalizePlatform(record.platform) !== record.platform) return null;
    } else {
      return null;
    }
    if (!Number.isSafeInteger(record.created_at) || record.created_at <= 0) return null;
    const event = normalizeTelemetryEvent(record.event);
    if (!event) return null;
    return {
      schema_ver: record.schema_ver,
      created_at: record.created_at,
      ...(record.schema_ver === 2 ? { platform: record.platform } : {}),
      event
    };
  } catch {
    return null;
  }
}

function hasPendingOutboxRecords(env = process.env, { includeConversations = true } = {}) {
  if (!telemetryEnabled(env)) return false;
  try {
    const dir = outboxDir(env);
    recoverStaleOutboxClaims(env);
    pruneOutbox(env);
    return fs.readdirSync(dir).some((name) => {
      if (name.startsWith('.')) return false;
      if (!includeConversations && (name.endsWith('.conversation') || name.includes('.conversation.sending.'))) return false;
      return isOutboxRecordName(name) || isOutboxClaimName(name);
    });
  } catch {
    return false;
  }
}

function writeUploadStatus(status, env = process.env) {
  if (!telemetryEnabled(env)) return false;
  return writePrivateJson(uploadStatusPath(env), { schema_ver: 1, updated_at: Date.now(), ...status });
}

function readUploadStatus(env = process.env) {
  try {
    const parsed = JSON.parse(fs.readFileSync(uploadStatusPath(env), 'utf8'));
    if (!parsed || parsed.schema_ver !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

function networkUploadFailure(status) {
  const errorCode = safeDimension(status?.error_code || '', '', 80).toUpperCase();
  if (permissionedFlushNetworkErrors.has(errorCode)) return errorCode;
  const message = String(status?.error_message || '').toUpperCase();
  for (const code of permissionedFlushNetworkErrors) {
    if (message.includes(code)) return code;
  }
  if (message.includes('GETADDRINFO') || message.includes('COULD_NOT_RESOLVE') || message.includes('COULD NOT RESOLVE')) {
    return 'ENOTFOUND';
  }
  return '';
}

export function permissionedFlushDecision(env = process.env) {
  if (!telemetryUploadEnabled(env)) {
    return { needed: false, outbox_count: 0, error_code: '', status: 'disabled' };
  }
  const outboxCount = outboxFilesForFlush(env, { includeConversations: false }).length;
  const status = readUploadStatus(env);
  const errorCode = networkUploadFailure(status);
  const result = {
    needed: false,
    outbox_count: outboxCount,
    error_code: errorCode || safeDimension(status?.error_code || '', '', 80),
    status: safeDimension(status?.status || 'unknown', 'unknown', 80)
  };
  if (outboxCount <= 0 || !errorCode) {
    return result;
  }
  result.needed = true;
  return result;
}

function emitPermissionedFlushNeededMarkers(env = process.env, stream = process.stderr) {
  const decision = permissionedFlushDecision(env);
  if (!decision.needed || !stream || typeof stream.write !== 'function') return false;
  stream.write(`${internalPrefix}PERMISSIONED_FLUSH_DECISION=${JSON.stringify(decision)}\n`);
  stream.write(`${internalPrefix}PERMISSIONED_FLUSH_NEEDED=true\n`);
  return true;
}

export async function flushOutbox(env = process.env, {
  limit = outboxFlushLimit,
  targetFile = '',
  timeoutMs = uploadTimeoutMs,
  sender = sendSyncLogReportDetailed,
  onSent = null,
  prioritizeTerminal = false,
  includeConversations = true
} = {}) {
  const result = { attempted: 0, sent: 0, retained: 0, invalid: 0 };
  if (!telemetryUploadEnabled(env)) return result;
  const files = outboxFilesForFlush(env, { targetFile, limit, prioritizeTerminal, includeConversations });
  const stages = { attempted: 0, sent: 0, retained: 0 };
  const stageFileCount = files.filter(file => !file.endsWith('.conversation')).length;
  let stageSuccessRecorded = false;
  function recordStageSuccess() {
    if (!stageSuccessRecorded && stages.sent > 0 && stages.retained === 0
      && !hasPendingOutboxRecords(env, { includeConversations: false })) {
      stageSuccessRecorded = writeUploadStatus({ status: 'success', ...stages }, env);
    }
  }
  for (const file of files) {
    const pending = file.endsWith('.conversation') ? readOutboxRecord(file) : null;
    const owner = pending && readConversationState(pending.event.conversation_id, env, { checkOwner: false });
    // Claim only after the recorder has committed state or removed its failed
    // enqueue. Release this local lock before doing any network work.
    const claim = owner ? withRunStateLock(env, () => {
      const state = reconcileConversationMessage(
        readConversationState(owner.conversation_id, env, { checkOwner: false }), env);
      return state ? claimOutboxFile(file) : '';
    }, conversationSessionFile(owner.session_hash, 'index.lock', env)) : null;
    const claimedFile = owner ? (claim.acquired ? claim.value : '') : claimOutboxFile(file);
    if (!claimedFile) {
      // A local recovery/claim failure is retained work, not an empty batch.
      // Let the worker stop instead of spinning on an uncommittable record.
      if (fs.existsSync(file)) result.retained += 1;
      continue;
    }
    const record = readOutboxRecord(claimedFile);
    if (!record) {
      result.invalid += 1;
      try {
        fs.unlinkSync(claimedFile);
      } catch {}
      continue;
    }
    if (isConversationEvent(record.event)) {
      // Finish stage accounting before handing off to conversation delivery.
      recordStageSuccess();
      // Legacy preview queues were captured before explicit consent existed.
      // Never retroactively authorize those messages with a later confirmation.
      const state = readConversationState(record.event.conversation_id, env, { checkOwner: false });
      if (!validConversationId(state?.consent_id)) {
        try { fs.unlinkSync(claimedFile); } catch { releaseOutboxClaim(claimedFile); }
        result.invalid += 1;
        continue;
      }
      // A recorder queues before committing its sequence. An already-running
      // worker must leave that record pending until the state write succeeds.
      if (record.event.sequence > state.sequence) {
        releaseOutboxClaim(claimedFile);
        result.retained += 1;
        continue;
      }
    }
    const report = buildSyncLogReport(
      record.event,
      env,
      record.schema_ver === 2 ? { platform: record.platform } : {}
    );
    if (!report) {
      result.invalid += 1;
      try {
        fs.unlinkSync(claimedFile);
      } catch {}
      continue;
    }
    const conversation = isConversationEvent(record.event);
    result.attempted += 1;
    if (!conversation) stages.attempted += 1;
    let sendResult = { ok: false, error_code: 'SENDER_FAILED', error_message: 'sender failed' };
    try {
      const rawSendResult = await sender(report, {
        timeoutMs: isConversationEvent(record.event) ? conversationUploadTimeoutMs : timeoutMs
      });
      sendResult = typeof rawSendResult === 'boolean' ? { ok: rawSendResult } : rawSendResult;
    } catch (error) {
      sendResult = failedResult(error, 'SENDER_THROW', 'sender threw');
    }
    if (sendResult?.ok) {
      result.sent += 1;
      if (typeof onSent === 'function') onSent();
      if (!conversation) stages.sent += 1;
      try {
        fs.unlinkSync(claimedFile);
      } catch {
        result.retained += 1;
        if (!conversation) stages.retained += 1;
        releaseOutboxClaim(claimedFile);
      }
      continue;
    }
    if (!conversation) writeUploadStatus({
      status: 'failed',
      attempted: stages.attempted,
      sent: stages.sent,
      retained: stageFileCount - stages.attempted + 1,
      status_code: sendResult?.status_code,
      error_code: sendResult?.error_code || 'UPLOAD_FAILED',
      error_message: sendResult?.error_message || 'upload failed'
    }, env);
    releaseOutboxClaim(claimedFile);
    if (!conversation) stages.retained += stageFileCount - stages.attempted + 1;
    result.retained += files.length - result.attempted + 1;
    break;
  }
  recordStageSuccess();
  return result;
}

function outboxFilesForFlush(env = process.env, {
  targetFile = '', limit = 0, prioritizeTerminal = false, includeConversations = true
} = {}) {
  const files = outboxFiles(env, { targetFile, limit: 0 })
    .filter((file) => includeConversations || !file.endsWith('.conversation'))
    // Drain stage uploads before the separately bounded conversation requests.
    .sort((a, b) => Number(a.endsWith('.conversation')) - Number(b.endsWith('.conversation')));
  if (!prioritizeTerminal || targetFile) return limit > 0 ? files.slice(0, limit) : files;
  const terminalFiles = [];
  const nonTerminalFiles = [];
  for (const file of files) {
    const stage = readOutboxRecord(file)?.event?.stage;
    if (summaryStages.has(stage)) terminalFiles.push(file);
    else nonTerminalFiles.push(file);
  }
  const ordered = [...terminalFiles, ...nonTerminalFiles];
  return limit > 0 ? ordered.slice(0, limit) : ordered;
}

function uploadWorkerLeasePath(env) {
  return path.join(outboxDir(env), '.upload-worker.json');
}

function readUploadWorkerLease(env) {
  try {
    const file = uploadWorkerLeasePath(env);
    const lease = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Number.isSafeInteger(lease.pid) || lease.pid <= 0 || !validConversationId(lease.token)) return null;
    // Older workers did not store a deadline. Bound their records by their
    // original file age instead of trusting a reused PID indefinitely.
    if (lease.started_at === undefined && lease.expires_at === undefined) {
      const startedAt = Math.floor(fs.statSync(file).mtimeMs);
      return { ...lease, started_at: startedAt,
        expires_at: startedAt + uploadWorkerLifetimeMs + 2 * runStateLockWaitMs };
    }
    return lease;
  } catch { return null; }
}

function uploadWorkerProcessAlive(lease) {
  if (!lease) return false;
  try { process.kill(lease.pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}

function uploadWorkerAlive(lease) {
  if (!lease) return false;
  const now = Date.now();
  const maxAge = uploadWorkerLifetimeMs + 2 * runStateLockWaitMs;
  if (!Number.isSafeInteger(lease.started_at) || !Number.isSafeInteger(lease.expires_at)
    || lease.started_at <= 0 || lease.started_at > now || lease.expires_at <= now
    || lease.expires_at <= lease.started_at || lease.expires_at - lease.started_at > maxAge) return false;
  return uploadWorkerProcessAlive(lease);
}

function releaseWorkerClaims(env, pid = process.pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  try {
    for (const name of fs.readdirSync(outboxDir(env))) {
      if (isOutboxClaimName(name) && name.endsWith(`.sending.${pid}`)) {
        releaseOutboxClaim(path.join(outboxDir(env), name));
      }
    }
  } catch {}
}

async function runOutboxWorker(env) {
  // Startup and exit share this short metadata lock; no network work holds it.
  // Checking and replacing an expired/dead owner's lease are one operation.
  const testLifetime = Number(env.ALIPAY_AIPAY_TEST_WORKER_LIFETIME_MS);
  const lifetime = env.ALIPAY_AIPAY_TEST_MODE === '1' && Number.isFinite(testLifetime) && testLifetime > 0
    ? Math.min(testLifetime, uploadWorkerLifetimeMs) : uploadWorkerLifetimeMs;
  const transaction = withRunStateLock(env, () => {
    const previous = readUploadWorkerLease(env);
    if (uploadWorkerAlive(previous)) return null;
    // A still-live reused PID may own a different foreground upload. Leave its
    // claims to the existing TTL recovery instead of reclaiming active work.
    if (previous && !uploadWorkerProcessAlive(previous)) releaseWorkerClaims(env, previous.pid);
    const startedAt = Date.now();
    const lease = { pid: process.pid, token: crypto.randomUUID(), started_at: startedAt,
      expires_at: startedAt + lifetime + 2 * runStateLockWaitMs };
    return writePrivateJson(uploadWorkerLeasePath(env), lease) ? lease : null;
  }, `${uploadWorkerLeasePath(env)}.guard`);
  const lease = transaction.acquired && transaction.value;
  if (!lease) return;
  let released = false;
  let sent = 0;
  let drained = false;
  const cleanup = (keepIfPending = false) => {
    if (released) return false;
    const transaction = withRunStateLock(env, () => {
      if (readUploadWorkerLease(env)?.token !== lease.token) { released = true; return false; }
      // Foreground producers never wait for this guard. Check again after
      // releasing it, so messages queued in the empty-check / exit window drain.
      if (keepIfPending && outboxFilesForFlush(env, { limit: 1 }).length > 0) return true;
      releaseWorkerClaims(env);
      fs.unlinkSync(uploadWorkerLeasePath(env));
      released = true;
      return false;
    }, `${uploadWorkerLeasePath(env)}.guard`);
    return transaction.acquired && transaction.value;
  };
  // Production lifetime is fixed. Only the explicit test mode can shorten it.
  const watchdog = setTimeout(() => {
    cleanup();
    // Continue a healthy backlog in a new bounded worker. A stalled first
    // request never creates an endless chain of replacement processes.
    if (released && sent > 0 && hasPendingOutboxRecords(env)) spawnOutboxFlush({ ...env,
      ALIPAY_AIPAY_TELEMETRY_FLUSH_TARGET_FILE: '', ALIPAY_AIPAY_TELEMETRY_FLUSH_DELAY_MS: '0' });
    process.exit(0);
  }, lifetime);
  try {
    const delay = parseNonNegativeInteger(env.ALIPAY_AIPAY_TELEMETRY_FLUSH_DELAY_MS);
    if (delay) await new Promise(resolve => setTimeout(resolve, Math.min(delay, 30000)));
    const timeout = Number(env.ALIPAY_AIPAY_TELEMETRY_UPLOAD_TIMEOUT_MS || uploadTimeoutMs);
    let targetFile = env.ALIPAY_AIPAY_TELEMETRY_FLUSH_TARGET_FILE || '';
    while (!released) {
      const result = await flushOutbox(env, {
        targetFile,
        timeoutMs: Number.isFinite(timeout) ? timeout : uploadTimeoutMs,
        onSent: () => { sent += 1; }
      });
      targetFile = '';
      // Do not busy-retry network or local failures. Keep their records queued.
      if (result.retained > 0) break;
      if (!cleanup(true)) { drained = true; break; }
    }
  } finally {
    clearTimeout(watchdog);
    cleanup();
    if (drained && released && outboxFilesForFlush(env, { limit: 1 }).length > 0) {
      spawnOutboxFlush({ ...env,
        ALIPAY_AIPAY_TELEMETRY_FLUSH_TARGET_FILE: '', ALIPAY_AIPAY_TELEMETRY_FLUSH_DELAY_MS: '0' });
    }
  }
}

function spawnOutboxFlush(env = process.env, {
  delayMs = 0,
  recordStageFailure = hasPendingOutboxRecords(env, { includeConversations: false })
} = {}) {
  if (!telemetryUploadEnabled(env)) return false;
  // Best effort: a busy uploader must not delay capture or business delivery.
  // Its post-release queue check handles an overlapping successful exit.
  const transaction = withRunStateLock(env, () => {
    if (uploadWorkerAlive(readUploadWorkerLease(env))) return true;
    return launchOutboxFlush(env, { delayMs, recordStageFailure });
  }, `${uploadWorkerLeasePath(env)}.guard`, 0);
  return transaction.acquired && transaction.value;
}

function launchOutboxFlush(env, { delayMs, recordStageFailure }) {
  try {
    const childEnv = {
      ...env,
      ALIPAY_AIPAY_TELEMETRY_UPLOAD_TIMEOUT_MS: env.ALIPAY_AIPAY_TELEMETRY_UPLOAD_TIMEOUT_MS || String(uploadTimeoutMs)
    };
    if (delayMs > 0) childEnv.ALIPAY_AIPAY_TELEMETRY_FLUSH_DELAY_MS = String(Math.min(delayMs, 30000));
    const child = spawn(process.execPath, [scriptPath(), 'flush-outbox-worker'], {
      detached: true,
      stdio: 'ignore',
      env: childEnv
    });
    child.on('error', (error) => {
      if (recordStageFailure) writeUploadStatus({
        status: 'spawn_failed',
        error_code: safeDimension(error?.code || error?.name || 'UPLOAD_SPAWN_FAILED', 'UPLOAD_SPAWN_FAILED', 80),
        error_message: safeDimension(error?.message || 'upload spawn failed', 'upload spawn failed', 240)
      }, env);
    });
    child.unref();
    return true;
  } catch {
    if (recordStageFailure) writeUploadStatus({
      status: 'spawn_failed',
      error_code: 'UPLOAD_SPAWN_FAILED',
      error_message: 'upload spawn failed'
    }, env);
    return false;
  }
}

function permissionedForegroundFlushLimitFromEnv(env = process.env) {
  const parsed = parseNonNegativeInteger(env.ALIPAY_AIPAY_TELEMETRY_PERMISSIONED_FLUSH_LIMIT);
  return parsed && parsed > 0 ? Math.min(parsed, outboxFlushLimit) : permissionedForegroundFlushLimit;
}

export async function runPermissionedOutboxFlush(env = process.env, {
  limit = permissionedForegroundFlushLimitFromEnv(env),
  timeoutMs = uploadTimeoutMs,
  sender = sendSyncLogReportDetailed,
  spawnBackground = false
} = {}) {
  const flush = await flushOutbox(env, {
    limit,
    timeoutMs,
    sender,
    prioritizeTerminal: true,
    includeConversations: false
  });
  const backgroundRetry = spawnBackground
    && flush.attempted > 0
    && outboxFiles(env).length > 0
    ? spawnOutboxFlush(env)
    : false;
  return {
    flush,
    background_retry: backgroundRetry
  };
}

function emitTelemetryError(error) {
  try {
    const message = safeDimension(error instanceof Error ? error.message : String(error), 'unknown', 240);
    process.stderr.write(`${internalPrefix}TELEMETRY_ERROR=${message}\n`);
  } catch {
  }
}

export async function runTelemetryCli(argv = process.argv) {
  try {
    const { command, args } = parseCliArgs(argv);
    if (['start-conversation', 'conversation-message', 'end-conversation', 'opt-out'].includes(command)) {
      // Keep input errors silent; JSON parser errors can quote message text.
      try {
        if (command !== 'opt-out' && (!telemetryEnabled(process.env) || !conversationCode(process.env))) return 0;
        if (command === 'opt-out') {
          assertCliArgs(args, new Set(['conversation-id', 'input-id']), 0);
          const consent = setConversationConsent({ decision: 'DENIED', conversationId: args['conversation-id'],
            inputId: args['input-id'] || (args['conversation-id'] && `opt-out:${args['conversation-id']}`) });
          if (consent?.decision === 'DENIED') {
            process.stderr.write(`${internalPrefix}CONVERSATION_CONSENT=DENIED\n`);
            process.stderr.write(`${internalPrefix}CONVERSATION_CLOSED=true\n`);
          }
        } else if (command === 'end-conversation') {
          assertCliArgs(args, new Set(['conversation-id']), 0);
          const closed = endConversation(args['conversation-id']);
          if (closed?.lifecycle === 'CLOSED') {
            process.stderr.write(`${internalPrefix}CONVERSATION_CLOSED=true\n`);
          }
        } else if (command === 'start-conversation') {
          // --host-session-id is a host-compatible alias for --session-id; when neither is
          // supplied, startConversation uses the previously consented stable env session.
          assertCliArgs(args, new Set(['session-id', 'host-session-id', 'message-id', 'message-json', 'product-type', 'final']), 0);
          if (typeof args['message-json'] !== 'string') return 0;
          const message = normalizeConversationMessageInput(JSON.parse(args['message-json']));
          if (message?.role !== 'user' || !normalizeUserInputId(args['message-id'])) return 0;
          const conversation = startConversation({ sessionId: args['host-session-id'] || args['session-id'] });
          if (!conversation) return 0;
          const trigger = await recordConversationMessage(message, { conversationId: conversation.conversation_id,
            messageId: args['message-id'], productType: args['product-type'], final: args.final === 'true' });
          if (!trigger) {
            // Only an orphan conversation created by this call is closed.
            if (conversation.created) endConversation(conversation.conversation_id, process.env);
            return 0;
          }
          process.stderr.write(`${internalPrefix}CONVERSATION_ID=${conversation.conversation_id}\n`);
          process.stderr.write(`${internalPrefix}CONVERSATION_MESSAGE_RECORDED=${trigger.sequence}\n`);
        } else {
          assertCliArgs(args, new Set(['conversation-id', 'product-type', 'message-id', 'message-json', 'final']), 0);
          if (typeof args['message-json'] !== 'string') return 0;
          const recorded = await recordConversationMessage(JSON.parse(args['message-json']), {
            conversationId: args['conversation-id'], productType: args['product-type'], messageId: args['message-id'], final: args.final === 'true'
          });
          if (recorded) {
            process.stderr.write(`${internalPrefix}CONVERSATION_MESSAGE_RECORDED=${recorded.sequence}\n`);
          }
        }
      } catch {}
      return 0;
    }
    if (command === 'resolve-session') {
      assertCliArgs(args, new Set(), 0);
      process.stderr.write(`${internalPrefix}SESSION_ID=${resolveTelemetrySession(process.env)}\n`);
      return 0;
    }
    if (command === 'start-run') {
      assertCliArgs(args, new Set(['root-intent', 'product-type', 'conversation-id', 'conversation-session-id', 'conversation-message-id', 'conversation-message-json']), 0);
      if (!allowedRootIntents.has(args['root-intent'])) {
        throw new Error('--root-intent 仅支持 integration_only、onboarding_only、full_process');
      }
      if (telemetryEnabled(process.env) && conversationCode(process.env)) {
        try {
          const supplied = args['conversation-id'] && readConversationState(args['conversation-id'], process.env);
          const conversation = args['conversation-id']
            ? (supplied?.lifecycle === 'ACTIVE' && hasConversationConsent(supplied, process.env) ? supplied : null)
            : startConversation({ sessionId: args['conversation-session-id'] || resolveTelemetrySession(process.env) }, process.env);
          if (conversation?.conversation_id) {
            let recorded = null;
            if (args['conversation-message-id'] && args['conversation-message-json']) {
              recorded = await recordConversationMessage(JSON.parse(args['conversation-message-json']), {
                conversationId: conversation.conversation_id,
                messageId: args['conversation-message-id'],
                productType: args['product-type']
              }, process.env);
              if (!recorded && conversation.created) {
                // Only an orphan conversation created by this call is closed;
                // a caller-supplied conversation_id is never closed here.
                endConversation(conversation.conversation_id, process.env);
              }
            }
            if (!args['conversation-message-json'] || recorded) {
              process.stderr.write(`${internalPrefix}CONVERSATION_ID=${conversation.conversation_id}\n`);
              if (recorded) process.stderr.write(`${internalPrefix}CONVERSATION_MESSAGE_RECORDED=${recorded.sequence}\n`);
            }
          }
        } catch {}
      }
      await startTelemetryRun(args['root-intent'], args['product-type'], '', { env: process.env });
      return 0;
    }
    if (command === 'current-run-id') {
      assertCliArgs(args, new Set(), 0);
      const state = canReadImplicitRunState(process.env) ? readRunState(process.env) : null;
      if (state?.run_id) {
        process.stderr.write(`${internalPrefix}RUN_ID=${state.run_id}\n`);
      } else {
        process.stderr.write(`${internalPrefix}RUN_ID_MISSING=true\n`);
      }
      return 0;
    }
    if (command === 'machine-user-id') {
      assertCliArgs(args, new Set(), 0);
      process.stderr.write(`${internalPrefix}MACHINE_USER_ID=${machineUserID(process.env)}\n`);
      return 0;
    }
    if (command === 'count-user-input' && args._.length === 0) {
      assertCliArgs(args, new Set(['run-id', 'input-id']), 0);
      if (typeof args['input-id'] !== 'string' || !args['input-id']) {
        throw new Error('缺少参数 --input-id');
      }
      const counts = recordTelemetryUserInput(args['input-id'], process.env, Date.now(), args['run-id']);
      if (counts) {
        process.stderr.write(`${internalPrefix}USER_INPUT_COUNT_STATE=${JSON.stringify(counts)}\n`);
      } else {
        process.stderr.write(`${internalPrefix}USER_INPUT_COUNT_STATE_MISSING=true\n`);
      }
      return 0;
    }
    if (command === 'upload-status' && args._.length === 0) {
      assertCliArgs(args, new Set(), 0);
      if (!telemetryEnabled(process.env)) return 0;
      const status = readUploadStatus(process.env) || { schema_ver: 1, status: 'unknown' };
      process.stderr.write(`${internalPrefix}TELEMETRY_UPLOAD_STATUS=${JSON.stringify(status)}\n`);
      return 0;
    }
    if (command === 'permissioned-flush-status' && args._.length === 0) {
      assertCliArgs(args, new Set(), 0);
      if (!telemetryEnabled(process.env)) return 0;
      const decision = permissionedFlushDecision(process.env);
      process.stderr.write(`${internalPrefix}PERMISSIONED_FLUSH_STATUS=${JSON.stringify(decision)}\n`);
      if (decision.needed) {
        process.stderr.write(`${internalPrefix}PERMISSIONED_FLUSH_CANDIDATE=true\n`);
      }
      return 0;
    }
    if (command === 'permissioned-flush-needed' && args._.length === 0) {
      assertCliArgs(args, new Set(), 0);
      if (!telemetryEnabled(process.env)) return 0;
      const decision = permissionedFlushDecision(process.env);
      process.stderr.write(`${internalPrefix}PERMISSIONED_FLUSH_DECISION=${JSON.stringify(decision)}\n`);
      if (decision.needed) process.stderr.write(`${internalPrefix}PERMISSIONED_FLUSH_NEEDED=true\n`);
      return 0;
    }
    if (command === 'flush-outbox') {
      assertCliArgs(args, new Set(), 0);
      if (!telemetryUploadEnabled(process.env)) return 0;
      await runPermissionedOutboxFlush(process.env, { spawnBackground: true });
      return 0;
    }
    if (command === 'flush-outbox-worker') {
      assertCliArgs(args, new Set(), 0);
      if (!telemetryUploadEnabled(process.env)) return 0;
      await runOutboxWorker(process.env);
      return 0;
    }
    if (!telemetryEnabled(process.env)) return 0;
    if (command !== 'stage' || args._.length !== 1) {
      emitTelemetryError(new Error('invalid telemetry arguments'));
      return 0;
    }
    assertCliArgs(args, new Set([
      'run-id',
      'history-count'
    ]), 1);
    if (typeof args['run-id'] !== 'string' || !args['run-id']) throw new Error('缺少参数 --run-id');
    if (!Object.prototype.hasOwnProperty.call(args, 'history-count')) throw new Error('缺少参数 --history-count');
    await recordStageEvent(
      args._[0],
      contextFromCliArgs(args),
      process.env,
      Date.now(),
      process.stderr
    );
    return 0;
  } catch (error) {
    if (['start-conversation', 'conversation-message', 'end-conversation', 'opt-out'].includes(argv[2])) return 0;
    emitTelemetryError(error);
    return 0;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runTelemetryCli(process.argv).then((code) => {
    process.exitCode = code;
  }, (error) => {
    emitTelemetryError(error);
    process.exitCode = 0;
  });
}
