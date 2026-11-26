import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { isMainModule } from '../../normal/scripts/is_main_module.mjs';
import { renderMessage } from '../../normal/scripts/render_customer_message.mjs';

export const sandboxGateway = 'https://openapi-sandbox.dl.alipaydev.com/gateway.do';
const sandboxSummaryProducts = Object.freeze({ aipay: 'AI 按量付费', webpay: 'AI 网页应用收款',
  apppay: 'AI 移动应用收款' });
export class SandboxError extends Error {
  constructor(code, fields = []) { super(code); this.code = code; this.fields = fields; }
}
const fail = (code, fields) => { throw new SandboxError(code, fields); };
const present = value => typeof value === 'string' && value.trim().length > 0;
export function exists(file) {
  try { fs.lstatSync(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
}
export function configPath(project) {
  if (!path.isAbsolute(project) || /[\r\n\0]/u.test(project)) fail('INVALID_PROJECT_PATH');
  const stat = fs.lstatSync(project);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('INVALID_PROJECT_PATH');
  return path.join(project, '.alipay-sandbox.json');
}
export function readRegular(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) fail('UNSAFE_SOURCE_FILE');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(fd);
    if (opened.ino !== stat.ino || opened.dev !== stat.dev) fail('UNSAFE_SOURCE_FILE');
    return fs.readFileSync(fd, 'utf8');
  } finally { fs.closeSync(fd); }
}
export function readJson(file) {
  const text = readRegular(file);
  try { return JSON.parse(text); } catch { fail('INVALID_JSON'); }
}
export function validateConfig(data) {
  const app = data?.appIds?.[0], partner = data?.sandboxAccounts?.partner, buyer = data?.sandboxAccounts?.user;
  const required = {
    'appIds[0].appId': app?.appId, 'appIds[0].appPrivateKey': app?.appPrivateKey,
    'appIds[0].appPrivatePkcsKey': app?.appPrivatePkcsKey, 'appIds[0].appPublicKey': app?.appPublicKey,
    'appIds[0].alipayPublicKey': app?.alipayPublicKey, 'sandboxAccounts.partner.userId': partner?.userId,
    ...Object.fromEntries(['userId', 'email', 'logonPassword', 'payPassword'].map(k => [`sandboxAccounts.user.${k}`, buyer?.[k]]))
  };
  const missing = Object.keys(required).filter(k => !present(required[k]));
  if (!Array.isArray(data?.appIds) || missing.length) fail('MISSING_FIELDS', missing);
  return data;
}

export function protectConfig(project) {
  const file = configPath(project), ignore = path.join(project, '.gitignore');
  const repo = spawnSync('git', ['-C', project, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' });
  if (repo.status === 0) {
    const tracked = spawnSync('git', ['-C', project, 'ls-files', '--error-unmatch', '--', '.alipay-sandbox.json'], { encoding: 'utf8' });
    if (tracked.status === 0) fail('CONFIG_TRACKED');
    if (tracked.error || tracked.status !== 1) fail('FILE_PROTECTION_FAILED');
  } else if (repo.error && repo.error.code !== 'ENOENT') fail('FILE_PROTECTION_FAILED');
  let text = exists(ignore) ? readRegular(ignore) : '';
  const ignored = repo.status === 0 ? spawnSync('git', ['-C', project, 'check-ignore', '-q', '--', '.alipay-sandbox.json']) : null;
  if (ignored && (ignored.error || ![0, 1].includes(ignored.status))) fail('FILE_PROTECTION_FAILED');
  // A later negation can override a rule already present in .gitignore.
  const additions = ['/.alipay-sandbox.json', '/.alipay-sandbox.*'].filter(line => ignored?.status === 1 || !text.split(/\r?\n/u).includes(line));
  if (additions.length) {
    const fd = fs.openSync(ignore, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW || 0), 0o644);
    try { fs.writeFileSync(fd, (text && !text.endsWith('\n') ? '\n' : '') + additions.join('\n') + '\n'); }
    finally { fs.closeSync(fd); }
  }
  if (repo.status === 0 && spawnSync('git', ['-C', project, 'check-ignore', '-q', '--', '.alipay-sandbox.json']).status !== 0) fail('FILE_PROTECTION_FAILED');
  if (exists(file)) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) fail('UNSAFE_CONFIG_FILE');
    if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
    fs.accessSync(file, fs.constants.R_OK | fs.constants.W_OK);
  }
  return file;
}
export function verifyConfig(project) {
  const file = configPath(project);
  const data = validateConfig(readJson(file));
  protectConfig(project);
  return data;
}
export function persistConfig(project, data) {
  validateConfig(data);
  const file = protectConfig(project);
  if (exists(file)) fail('CONFIG_EXISTS');
  const temp = path.join(project, `.alipay-sandbox.${randomUUID()}.tmp`);
  try {
    const fd = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(data) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    // Exclusive publication: even a concurrent creator must never be overwritten.
    fs.linkSync(temp, file);
  } finally { fs.rmSync(temp, { force: true }); }
  protectConfig(project);
  return file;
}
const control = text => process.stderr.write(`ALIPAY_AIPAY_INTERNAL:${text}\n`);
export function reportReady(project, action) {
  if (action) control(`SANDBOX_ENSURE_ACTION=${action}`);
  control(`SANDBOX_CONFIG_PATH=${configPath(project)}`);
  control('FLOW:SANDBOX_CONFIG_READY');
}
function errorDetail(error) {
  const code = error instanceof SandboxError ? error.code : 'LOCAL_OPERATION_FAILED';
  const fields = error instanceof SandboxError && error.fields.length ? ` ${error.fields.join(',')}` : '';
  return `${code}${fields}`;
}
export function reportError(error) {
  process.stderr.write(`SANDBOX_ERROR:${errorDetail(error)}\n`);
}
export function reportPending(project, variant, error) {
  if (error) control(`SANDBOX_PENDING_REASON=${errorDetail(error)}`);
  if (process.env.ALIPAY_AIPAY_SANDBOX_PRODUCT !== 'token-subscription') {
    process.stdout.write(renderMessage('sandbox.configuration.pending', variant, {}) + '\n');
    control('CUSTOMER_MESSAGE_DELIVERY_REQUIRED=sandbox.configuration.pending');
  }
  control(`SANDBOX_PENDING_PATH=${configPath(project)}`);
  control(`FLOW:SANDBOX_CONFIG_PENDING_${variant === 'CREATE' ? 'CREATE' : 'VERIFY'}`);
}
export function summaryInput(project, product) {
  if (!Object.hasOwn(sandboxSummaryProducts, product)) fail('INVALID_PRODUCT');
  const data = verifyConfig(project), buyer = data.sandboxAccounts.user;
  const hidden = '已写入本地配置文件，默认不在对话中展开';
  const rows = [['沙箱支付宝应用ID（appID）', data.appIds[0].appId]];
  rows.push(['沙箱买家测试账号', buyer.email], ['沙箱买家登录密码', product === 'webpay' ? buyer.logonPassword : hidden],
    ['沙箱买家支付密码', product === 'webpay' ? buyer.payPassword : hidden]);
  const safe = value => String(value).replace(/[|\r\n]/gu, ' ');
  return { productName: sandboxSummaryProducts[product], configPath: configPath(project),
    environmentRows: rows.map(([key, value]) => `| ${key} | ${safe(value)} |`).join('\n') };
}
export function parseSandboxArgs(args) {
  const [mode, ...rest] = args;
  let product = '', project, legacyLanguage;
  if (mode === 'summary') [product, project, legacyLanguage] = rest;
  else if (['ensure', 'reverify', 'create', 'verify'].includes(mode)) [project, legacyLanguage] = rest;
  else fail('INVALID_ARGUMENTS');
  if (rest.length < (mode === 'summary' ? 2 : 1) || rest.length > (mode === 'summary' ? 3 : 2)) fail('INVALID_ARGUMENTS');
  if (legacyLanguage !== undefined && !['java', 'python', 'python3', 'py', 'nodejs', 'node',
    'javascript', 'js', 'c#', 'csharp', 'dotnet', 'net', 'php', 'go', 'golang']
    .includes(legacyLanguage.toLowerCase().replace(/[ ._-]/gu, ''))) fail('INVALID_ARGUMENTS');
  if (mode === 'summary' && !Object.hasOwn(sandboxSummaryProducts, product)) fail('INVALID_PRODUCT');
  configPath(project || '');
  return { mode, project, product };
}
// Native Node path for local operations, including Windows LEGACY/CODE_ONLY.
export async function runLocalSandbox(args) {
  const { mode, project, product } = parseSandboxArgs(args);
  if (mode === 'summary') {
    const input = summaryInput(project, product);
    process.stdout.write(renderMessage('sandbox.environment.summary', 'DEFAULT', input) + '\n');
    process.stdout.write(renderMessage('sandbox.environment.reminder', 'DEFAULT', {}) + '\n');
    control('CUSTOMER_MESSAGE_DELIVERY_REQUIRED=sandbox.environment.summary');
    control(`SANDBOX_CONFIG_PATH=${configPath(project)}`);
    control('FLOW:SANDBOX_CONFIGURED');
  } else if (mode === 'verify') { verifyConfig(project); reportReady(project); }
  else if (['ensure', 'reverify'].includes(mode)) {
    try {
      if (mode === 'ensure' && !exists(configPath(project))) { reportPending(project, 'CREATE'); return; }
      verifyConfig(project); reportReady(project, 'VERIFIED');
    } catch (error) { reportPending(project, 'VERIFY', error); }
  } else fail('CREATE_REQUIRES_CLI');
}
if (isMainModule(import.meta.url)) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === 'validate') validateConfig(JSON.parse(fs.readFileSync(0, 'utf8')));
    else if (command === 'persist') persistConfig(args[0], JSON.parse(fs.readFileSync(0, 'utf8')));
    else if (command === 'prepare-create') {
      const file = configPath(args[0]);
      if (exists(file)) fail('CONFIG_EXISTS');
      protectConfig(args[0]);
    } else if (command === 'parse') parseSandboxArgs(args);
    else await runLocalSandbox([command, ...args]);
  } catch (error) { reportError(error); process.exitCode = 1; }
}
