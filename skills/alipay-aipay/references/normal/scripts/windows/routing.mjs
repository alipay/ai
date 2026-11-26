import {applyReady, checkCredentialsWritable, report, resultError} from './preflight.mjs';
import {prepare} from './prepare.mjs';

const intents = ['integration_only', 'onboarding_only', 'full_process'];
const prefix = 'ALIPAY_AIPAY_INTERNAL:';

// Report local capability only; each product owns its business fallback.
function codeOnlyFailure(error) {
  if (error.reason === 'SHELL_TRANSPORT_FAILED' && error.dependency !== 'Node') return true;
  if (error.reason === 'NOT_GIT_BASH' && error.dependency === 'ALIPAY_GIT_BASH') return true;
  if (error.dependency === 'Node') return false;
  const tools = ['Git Bash', 'git', 'jq', 'alipay-cli', 'cli', 'curl', 'PowerShell'];
  if (!tools.includes(error.dependency)) return false;
  return ['DEPENDENCY_MISSING', 'DEPENDENCY_VERSION', 'EXECUTION_FAILED',
    'WINGET_UNAVAILABLE', 'GIT_INSTALL_FAILED', 'GIT_VERIFY_FAILED', 'CLI_INSTALL_FAILED',
    'DOWNLOAD_FAILED', 'INTEGRITY_FAILED', 'SIGNATURE_FAILED',
    'USER_SCOPE_REQUIRED', 'POLICY_UNAVAILABLE'].includes(error.reason);
}

// This is a routing result, never proof of a successful payment or onboarding.
export function selectRoute({rootIntent = '', authorized = false, repair = false, siteSelected = false} = {}, {check = applyReady, prepareTools = prepare} = {}) {
  if (rootIntent && !intents.includes(rootIntent)) throw new Error('非法 Windows 根意图');
  if (siteSelected) return emit({rootIntent,route:'LEGACY',reason:'USER_SELECTED_SITE'});
  let error;
  try {
    check({retry: repair});
    return emit({rootIntent, route: 'READY'});
  } catch (e) { error = e; }
  if (authorized) {
    // Prepare missing tools once per source and report the actual failure.
    try {
      const cliUnusable = error.reason === 'EXECUTION_FAILED' && error.dependency === 'alipay-cli';
      if (error.reason === 'DEPENDENCY_MISSING' || cliUnusable) {
        prepareTools({authorized: true});
        return emit({rootIntent, route: 'READY'});
      }
    } catch (e) { error = e; }
  }
  report(error);
  const route = error.reason === 'NO_COMPATIBLE_EXECUTION_MAPPING' ? 'LEGACY' :
    codeOnlyFailure(error) ? 'CODE_ONLY' : 'BLOCKED';
  return emit({rootIntent, route, ...resultError(error)});
}

function emit(result) {
  process.stderr.write(prefix + 'WINDOWS_ROUTE=' + JSON.stringify(result) + '\n');
  return result;
}

export function runWindowsEntry(args, { autoPrepare = false } = {}, services) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!['--root-intent', '--product-type', '--prepare-authorized', '--repair-confirmed','--site-selected'].includes(key) ||
        value === undefined || options[key] !== undefined) throw new Error('Windows 入口参数非法');
    options[key] = value;
  }
  if (!intents.includes(options['--root-intent'])) throw new Error('必须先识别三种根意图之一');
  if (!/^[a-z][a-z0-9-]*$/u.test(options['--product-type'] || '')) throw new Error('请先确认唯一的适用产品');
  for (const key of ['--prepare-authorized', '--repair-confirmed','--site-selected']) {
    if (options[key] !== undefined && !['true', 'false'].includes(options[key])) throw new Error('Windows 入口布尔参数非法');
  }
  return selectRoute({rootIntent: options['--root-intent'],
    authorized: options['--prepare-authorized'] === undefined ? autoPrepare : options['--prepare-authorized'] === 'true', repair: options['--repair-confirmed'] === 'true',
    siteSelected:options['--site-selected']==='true'}, services);
}

// LEGACY/CODE_ONLY can only disable operations. READY is never a capability token.
export function consumeRoute(args) {
  const remaining = [];
  let route;
  let seen = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--windows-route') { remaining.push(args[i]); continue; }
    if (seen || !['READY','LEGACY','CODE_ONLY','BLOCKED'].includes(args[i + 1])) throw new Error('Windows 分流参数非法');
    seen = true;
    route = args[++i];
  }
  return {args: remaining, route};
}

// Native Node messages, telemetry and project inspection do not depend on Bash.
// READY is never trusted as proof; the actual business executor checks again.
export function requireBusinessEnvironment({credentials = false} = {}) {
  if (['LEGACY','CODE_ONLY','BLOCKED'].includes(process.env.ALIPAY_AIPAY_WINDOWS_ROUTE)) {
    const error = Object.assign(new Error('WINDOWS_ENVIRONMENT_UNAVAILABLE'), {reason: 'WINDOWS_ENVIRONMENT_UNAVAILABLE'});
    throw error;
  }
  const context=applyReady();
  if (credentials) checkCredentialsWritable();
  return context;
}

export function onboardingRoute({ siteFallback = false } = {}) {
  if (process.env.ALIPAY_AIPAY_WINDOWS_ROUTE === 'CODE_ONLY') return siteFallback ? 'LEGACY' : 'BLOCKED';
  if (['LEGACY','BLOCKED'].includes(process.env.ALIPAY_AIPAY_WINDOWS_ROUTE)) return process.env.ALIPAY_AIPAY_WINDOWS_ROUTE;
  try { requireBusinessEnvironment(); return 'READY'; }
  catch (error) { report(error); return 'BLOCKED'; }
}
