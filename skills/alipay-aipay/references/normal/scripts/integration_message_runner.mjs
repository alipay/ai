#!/usr/bin/env node

import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { isWindowsPlatform } from './platform_compat.mjs';
import { renderMessage } from './render_customer_message.mjs';
import { currentRunContext, emitStageMetric, startTelemetryRun, telemetryEnabled } from './telemetry.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const inspectorPath = path.join(scriptDir, 'project_route_inspector.sh');

const productVariants = {
  aipay: { variant: 'AIPAY', productName: 'AI 按量付费' },
  webpay: { variant: 'WEBPAY', productName: 'AI 网页应用收款' },
  apppay: { variant: 'APPPAY', productName: 'AI 移动应用收款' }
};
const currentProjectAliases = new Set(['.', './', '当前项目', '当前目录', '这个项目', '这个仓库', '这里']);
const projectMarkerNames = [
  'package.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
  'gradlew',
  'mvnw',
  'pyproject.toml',
  'requirements.txt',
  'Pipfile',
  'poetry.lock',
  'composer.json',
  'artisan',
  'manage.py'
];
const projectMarkerNameSet = new Set(projectMarkerNames);
const skippedProjectDirs = new Set([
  '.git',
  '.hg',
  '.svn',
  '.cache',
  '.gradle',
  '.idea',
  '.next',
  '.nuxt',
  '.pytest_cache',
  '.tox',
  '.Trash',
  '.venv',
  'Library',
  '__pycache__',
  'build',
  'coverage',
  'dist',
  'logs',
  'node_modules',
  'reports',
  'target',
  'test-results',
  'vendor'
]);
const sourceFileExtensions = new Set(['.java', '.kt', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.php', '.cs']);
const snapshotConfigExtensions = new Set([
  '.config', '.conf', '.csproj', '.fsproj', '.ini', '.properties', '.sln', '.toml', '.vbproj', '.xml', '.yaml', '.yml'
]);
const snapshotConfigNames = new Set([
  ...projectMarkerNames,
  '.alipay-sandbox.json',
  '.gitignore',
  'composer.lock',
  'dockerfile',
  'gemfile',
  'gemfile.lock',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock'
].map((name) => name.toLowerCase()));
const webpayMarker = 'alipay\\.trade\\.page\\.pay|AlipayTradePagePay(Request|Model|Response)';
const apppayMarker = 'alipay\\.trade\\.app\\.pay|AlipayTradeAppPay(Request|Model|Response)';
const tradeQueryMarker = 'alipay\\.trade\\.query|AlipayTradeQuery(Request|Model|Response)|alipay_trade_query_response';
const tradeRefundMarker = 'alipay\\.trade\\.refund|AlipayTradeRefund(Request|Model|Response)|alipay_trade_refund_response';
const tradeRefundQueryMarker = 'alipay\\.trade\\.fastpay\\.refund\\.query|AlipayTradeFastpayRefundQuery(Request|Model|Response)|alipay_trade_fastpay_refund_query_response';
const tradeCloseMarker = 'alipay\\.trade\\.close|AlipayTradeClose(Request|Model|Response)|alipay_trade_close_response';
const tradeNotifyMarker = 'notify_url|notifyUrl|NotifyUrl|setNotifyUrl|异步通知';
const aipayPaymentNeededMarker = 'Payment-Needed';
const aipayPaymentProofMarker = 'Payment-Proof';
const aipayPaymentValidationMarker = 'Payment-Validation';
const aipayPaymentVerifyMarker = 'alipay\\.aipay\\.agent\\.payment\\.verify|AlipayAipayAgentPaymentVerify(Request|Model|Response)|alipay_aipay_agent_payment_verify_response';
const aipayFulfillmentConfirmMarker = 'alipay\\.aipay\\.agent\\.fulfillment\\.confirm|AlipayAipayAgentFulfillmentConfirm(Request|Model|Response)|alipay_aipay_agent_fulfillment_confirm_response';
const aipayMarker = `${aipayPaymentNeededMarker}|${aipayPaymentProofMarker}|${aipayPaymentVerifyMarker}|${aipayFulfillmentConfirmMarker}`;
const internalPrefix = 'ALIPAY_AIPAY_INTERNAL:';
const receiptKinds = Object.freeze({
  checklist: 'integration-checklist-scope',
  a2mExecution: 'integration-a2m-execution'
});

function parseArgs(argv) {
  const command = argv[2];
  const args = {};
  for (let index = 3; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error(`未知参数 ${key}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`参数 ${key} 缺少取值`);
    const name = key.slice(2);
    if (Object.prototype.hasOwnProperty.call(args, name)) throw new Error(`参数 ${key} 重复`);
    args[name] = value;
    index += 1;
  }
  return { command, args };
}

function required(args, name) {
  const value = args[name];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`缺少参数 --${name}`);
  return value;
}

function optional(args, name) {
  return typeof args[name] === 'string' && args[name].length > 0 ? args[name] : undefined;
}

function requireCustomerMessageDelivery(messageId, message) {
  process.stderr.write(`${internalPrefix}CUSTOMER_MESSAGE_DELIVERY_REQUIRED=${messageId}\n`);
  return message;
}

function stripWrappingQuotes(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('`') && trimmed.endsWith('`'))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function sanitizeProjectInput(raw) {
  const value = stripWrappingQuotes(raw);
  if (!value || value.length > 4096 || /[\u0000-\u001f\u007f`|]/.test(value)) {
    throw new Error('project-input 必须是不含控制字符或 Markdown 边界的安全路径描述');
  }
  return value;
}

function normalizeBasePath(raw) {
  const basePath = path.resolve(stripWrappingQuotes(raw));
  if (!path.isAbsolute(basePath) || !fs.existsSync(basePath) || !fs.statSync(basePath).isDirectory()) {
    throw new Error('base-path 必须是实际存在的绝对目录');
  }
  return fs.realpathSync(basePath);
}

function safeReaddir(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

function listProjectMarkers(directory) {
  const markers = [];
  for (const entry of safeReaddir(directory)) {
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    if (projectMarkerNameSet.has(entry.name)) {
      markers.push(entry.name);
    } else if (/\.(?:csproj|sln)$/i.test(entry.name)) {
      markers.push(entry.name);
    }
  }
  return markers.sort((left, right) => {
    const leftIndex = projectMarkerNames.indexOf(left);
    const rightIndex = projectMarkerNames.indexOf(right);
    if (leftIndex >= 0 || rightIndex >= 0) {
      if (leftIndex < 0) return 1;
      if (rightIndex < 0) return -1;
      return leftIndex - rightIndex;
    }
    return left.localeCompare(right);
  });
}

function isRecognizableProjectRoot(directory) {
  return listProjectMarkers(directory).length > 0;
}

function shouldSkipProjectDir(entry) {
  return !entry.isDirectory() || entry.isSymbolicLink() || skippedProjectDirs.has(entry.name) || entry.name.startsWith('.');
}

function parseDepth(value) {
  if (value === undefined) return 3;
  if (!/^[0-4]$/.test(value)) throw new Error('max-depth 仅支持 0 到 4');
  return Number(value);
}

function locateProjectCandidates(searchBasePath, maxDepth = 3, maxCandidates = 20, displayBasePath = searchBasePath, classificationBasePath = displayBasePath) {
  const queue = [{ directory: searchBasePath, depth: 0 }];
  const seen = new Set([searchBasePath]);
  const candidates = [];

  for (let index = 0; index < queue.length && candidates.length < maxCandidates; index += 1) {
    const { directory, depth } = queue[index];
    const markers = listProjectMarkers(directory);
    if (markers.length > 0) {
      const projectPath = fs.realpathSync(directory);
      candidates.push({
        projectPath,
        relativePath: path.relative(displayBasePath, projectPath) || '.',
        projectSelection: classifyExistingProject(
          projectPath,
          classificationBasePath,
          projectPath === classificationBasePath ? '当前目录' : projectPath
        ),
        projectOrigin: 'EXISTING_PROJECT',
        projectOriginLabel: '现有项目',
        markers
      });
    }
    if (depth >= maxDepth) continue;
    const childDirs = safeReaddir(directory)
      .filter((entry) => !shouldSkipProjectDir(entry))
      .map((entry) => path.join(directory, entry.name))
      .sort((left, right) => left.localeCompare(right));
    for (const child of childDirs) {
      let realChild;
      try {
        realChild = fs.realpathSync(child);
      } catch {
        continue;
      }
      if (seen.has(realChild)) continue;
      seen.add(realChild);
      queue.push({ directory: realChild, depth: depth + 1 });
    }
  }

  return candidates;
}

function formatProjectCandidateHint(basePath, candidates) {
  const visible = candidates.slice(0, 5);
  if (visible.length === 0) return '';
  return visible
    .map((candidate) => {
      const relative = candidate.relativePath || path.relative(basePath, candidate.projectPath) || '.';
      return `${relative}（${candidate.markers.slice(0, 3).join('、')}）`;
    })
    .join('；');
}

function safeInline(value) {
  return value.replace(/[`|\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
}

function formatLocatedCandidateRows(candidates) {
  if (candidates.length === 0) {
    return '未找到可识别项目候选。可以提供更精确的项目文件夹，或说明要新建的目录。';
  }
  return candidates
    .slice(0, 10)
    .map((candidate, index) => {
      const markers = candidate.markers.slice(0, 3).join('、');
      return `${index + 1}. \`${safeInline(candidate.relativePath)}\`（识别依据：${markers}）`;
    })
    .join('\n');
}

function projectRootError(searchBasePath, prefix, displayBasePath = searchBasePath) {
  const candidates = locateProjectCandidates(searchBasePath, 3, 5, displayBasePath, displayBasePath);
  const markerHint = 'package.json、pom.xml、build.gradle、pyproject.toml、requirements.txt、composer.json、*.csproj 或 *.sln';
  const candidateHint = formatProjectCandidateHint(displayBasePath, candidates);
  if (candidateHint) {
    return new Error(`${prefix}；请从候选项目中选择一个具体目录，或提供更精确路径。候选：${candidateHint}。如果要新建项目，请说明“在当前目录新建 pay-demo”或“新建项目”。项目根通常包含 ${markerHint}`);
  }
  return new Error(`${prefix}；未在指定目录下找到可识别项目候选。请提供现有服务端项目的具体目录，或说明“在当前目录新建 pay-demo”或“新建项目”。项目根通常包含 ${markerHint}`);
}

function isDefaultNewProjectRequest(input) {
  return /^(?:新建项目|帮我新建默认项目)$/u.test(input);
}

function explicitNewArtifactRequest(input) {
  return /^(?:请|麻烦)?(?:给我|帮我)?(?:新建|创建)(?:一个|个|一套)?[^,，。；;!?！？\r\n]{0,80}(?:项目|工程|网站|站点|商城|商店|店铺|应用程序|应用)(?:[,，。；;!?！？].*)?$/iu.test(input);
}

function looksLikeExplicitPath(value) {
  return /^(?:[A-Za-z]:[\\/]|\\\\|[./~])/u.test(value) ||
    /[\\/]/u.test(value) ||
    /^[A-Za-z0-9._-]+$/u.test(value);
}

function extractNewProjectPath(input) {
  const prefixed = '(?:请|麻烦)?(?:给我|帮我)?';
  const currentRoot = '(?:当前目录|当前项目|这个项目|这个仓库|这里)';
  const patterns = [
    new RegExp(`^${prefixed}(?:在)?${currentRoot}(?:下|里)?(?:新建|创建)(?:一个)?(?:项目|目录)?\\s+(.+)$`, 'u'),
    new RegExp(`^${prefixed}(?:新建|创建)(?:一个)?(?:项目|目录)(?:到|在)\\s*(.+)$`, 'u')
  ];
  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match?.[1]) {
      const candidate = stripWrappingQuotes(match[1]);
      if (looksLikeExplicitPath(candidate)) return candidate;
    }
  }

  const simple = input.match(/^(?:请|麻烦)?(?:给我|帮我)?(?:新建|创建)(?:一个)?\s+(.+)$/u);
  if (simple?.[1]) {
    const candidate = stripWrappingQuotes(simple[1]);
    if (looksLikeExplicitPath(candidate)) return candidate;
  }
  return '';
}

function isExplicitNewProjectRequest(input) {
  return /^(?:帮我)?(?:新建|创建)(?:一个)?(?:默认)?(?:项目|目录)?$/u.test(input) ||
    explicitNewArtifactRequest(input) ||
    extractNewProjectPath(input) !== '';
}

function parseExistingProjectPath(input) {
  if (/^(?:请|麻烦)?(?:给我|帮我)?(?:在)?(?:当前目录|当前项目|这个项目|这个仓库|这里)(?:中|内|下|里)?新增.+$/u.test(input)) {
    return '当前项目';
  }
  return input;
}

function hasDirectoryEntries(directory) {
  try {
    return safeReaddir(directory).length > 0;
  } catch {
    return true;
  }
}

function prepareNewProject(projectPath) {
  if (!path.isAbsolute(projectPath)) throw new Error('ROUTE_INSPECT_ERROR:projectPath 必须是绝对路径');
  if (fs.existsSync(projectPath)) {
    const stat = fs.lstatSync(projectPath);
    if (stat.isSymbolicLink() || !stat.isDirectory() || hasDirectoryEntries(projectPath)) {
      throw new Error('ROUTE_INSPECT_ERROR:NEW_PROJECT 路径必须尚不存在或为空且不能是符号链接');
    }
  }
  return {
    projectSelection: 'NEW_PROJECT',
    projectOrigin: 'NEW_PROJECT',
    projectOriginLabel: '本轮新建项目',
    preparationStatus: 'READY'
  };
}

function parseSingleJson(stdout, context) {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error(`${context} 未输出 JSON`);
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new Error(`${context} 未输出唯一合法 JSON 对象`);
  }
}

function runUnixInspector(args, failureContext, jsonContext) {
  const inspected = spawnSync('bash', [inspectorPath, ...args], {
    encoding: 'utf8',
    shell: false
  });
  if (inspected.status !== 0) {
    const detail = (inspected.stderr || inspected.stdout || '').trim() || `退出码 ${inspected.status}`;
    throw new Error(`${failureContext}失败：${detail}`);
  }
  return parseSingleJson(inspected.stdout, jsonContext);
}

function parseNewProjectPath(projectPath) {
  return sanitizeProjectInput(projectPath);
}

function normalizePotentialPath(candidate) {
  let existing = candidate;
  const suffix = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    suffix.unshift(path.basename(existing));
    existing = parent;
  }
  const normalizedBase = fs.existsSync(existing) ? fs.realpathSync(existing) : existing;
  return path.join(normalizedBase, ...suffix);
}

function resolveAgainstBase(input, basePath) {
  const candidate = normalizePotentialPath(path.isAbsolute(input) ? path.resolve(input) : path.resolve(basePath, input));
  if (!path.isAbsolute(input)) {
    const relative = path.relative(basePath, candidate);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('相对项目路径必须位于 base-path 内；如需目录外项目，请提供绝对路径');
    }
  }
  return candidate;
}

function resolveSearchBasePath(args, basePath) {
  const rawInput = args['search-input'];
  if (rawInput === undefined) return basePath;
  const input = parseProjectSearchInput(sanitizeProjectInput(rawInput));
  const candidate = currentProjectAliases.has(input) ? basePath : resolveAgainstBase(input, basePath);
  const searchBasePath = fs.existsSync(candidate) ? fs.realpathSync(candidate) : candidate;
  if (!fs.existsSync(searchBasePath) || !fs.statSync(searchBasePath).isDirectory()) {
    throw new Error('search-input 必须指向实际存在的目录；可以使用当前目录、当前目录下子目录或绝对路径');
  }
  return searchBasePath;
}

function parseProjectSearchInput(input) {
  const trimmed = stripWrappingQuotes(input);
  if (/^(?:帮我)?(?:找|查找|定位)(?:一下)?(?:项目|项目目录|工程|工程目录)$/u.test(trimmed)) {
    return '当前目录';
  }
  const patterns = [
    /^(?:帮我)?(?:在|到)\s*(.+?)\s*(?:下|里|目录下|目录里)?(?:找|查找|定位)(?:一下)?(?:项目|项目目录|工程|工程目录)$/u,
    /^(?:帮我)?(?:找|查找|定位)(?:一下)?\s*(.+?)\s*(?:下|里|目录下|目录里)?(?:的)?(?:项目|项目目录|工程|工程目录)$/u
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match?.[1]) return stripWrappingQuotes(match[1]);
  }
  return trimmed;
}

function classifyExistingProject(projectPath, basePath, rawInput) {
  if (currentProjectAliases.has(rawInput)) return 'CURRENT_PROJECT';
  const relative = path.relative(basePath, projectPath);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    return 'CURRENT_PROJECT';
  }
  return 'OTHER_PROJECT';
}

function isReadableDirectory(directory) {
  try {
    const stat = fs.statSync(directory);
    if (!stat.isDirectory()) return false;
    fs.accessSync(directory, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function projectFiles(projectPath) {
  const files = [];
  const stack = [projectPath];
  while (stack.length > 0) {
    const directory = stack.pop();
    for (const entry of safeReaddir(directory)) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!entry.isSymbolicLink() && !skippedProjectDirs.has(entry.name)) stack.push(entryPath);
        continue;
      }
      if (entry.isSymbolicLink() || !entry.isFile()) continue;
      files.push(entryPath);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function sourceFiles(projectPath, files = projectFiles(projectPath)) {
  return files.filter((file) => sourceFileExtensions.has(path.extname(file).toLowerCase()));
}

function isSnapshotConfigFile(file) {
  const basename = path.basename(file).toLowerCase();
  return snapshotConfigNames.has(basename)
    || /^\.env(?:\.|$)/u.test(basename)
    || /^(?:appsettings(?:\.[^.]+)*|config|jsconfig|launchsettings|settings|tsconfig(?:\.[^.]+)*)\.json$/u.test(basename)
    || snapshotConfigExtensions.has(path.extname(basename));
}

function projectSnapshot(projectPath) {
  if (!path.isAbsolute(projectPath) || !isReadableDirectory(projectPath)) {
    throw new Error('项目快照路径必须是可访问的绝对目录');
  }
  const canonicalPath = fs.realpathSync(projectPath);
  const files = projectFiles(canonicalPath);
  const sources = sourceFiles(canonicalPath, files);
  const tracked = new Set([...sources, ...files.filter(isSnapshotConfigFile)]);
  const hash = crypto.createHash('sha256');
  const contents = new Map();
  hash.update(`project=${canonicalPath}\n`);
  for (const file of [...tracked].sort((left, right) => left.localeCompare(right))) {
    const stat = fs.statSync(file);
    const relative = path.relative(canonicalPath, file);
    const content = fs.readFileSync(file);
    contents.set(file, content);
    hash.update(`${relative}\0${stat.size}\0`);
    hash.update(content);
    hash.update('\n');
  }
  return { canonicalPath, sources, contents, fingerprint: hash.digest('hex') };
}

function projectSnapshotFingerprint(projectPath) {
  return projectSnapshot(projectPath).fingerprint;
}

function encodeReceipt(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeReceipt(value, expectedKind) {
  if (typeof value !== 'string' || !value) throw new Error('缺少 receipt');
  let payload;
  try {
    payload = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw new Error('receipt 不是合法编码');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.schema_ver !== 1 || payload.kind !== expectedKind) {
    throw new Error('receipt 类型或版本非法');
  }
  return payload;
}

function scanPattern(files, pattern) {
  const regex = new RegExp(pattern);
  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (regex.test(stripSourceComments(content, path.extname(file).toLowerCase()))) return file;
  }
  return '';
}

function stripSourceComments(content, extension) {
  if (extension === '.py') {
    content = content.replace(/(^|\n)[ \t]*(?:[rubf]{0,2})?(?:"""[\s\S]*?"""|'''[\s\S]*?''')[ \t]*(?:#[^\r\n]*)?(?=\r?$)/gimu,
      (token) => token.replace(/[^\r\n]/gu, ' '));
  }
  const hashComments = extension === '.py' || extension === '.php';
  const tokens = hashComments
    ? /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->|\/\/[^\r\n]*|#[^\r\n]*/gu
    : /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->|\/\/[^\r\n]*/gu;
  return content.replace(tokens, (token) => {
    const comment = token.startsWith('//') || token.startsWith('/*') || token.startsWith('<!--')
      || (hashComments && token.startsWith('#'));
    return comment ? token.replace(/[^\r\n]/gu, ' ') : token;
  });
}

function implementationSourceFiles(projectPath, files = sourceFiles(projectPath), contents = null) {
  const testDirectories = new Set([
    '__fixtures__', '__tests__', 'fixtures', 'spec', 'specs', 'test', 'testfixtures', 'tests'
  ]);
  const generatedDirectories = new Set([
    '.generated', 'bin', 'gen', 'generated', 'generated-sources', 'generated-src', 'obj', 'out'
  ]);
  return files.filter((file) => {
    const relative = path.relative(projectPath, file);
    const parts = relative.split(path.sep);
    const lowerParts = parts.map((part) => part.toLowerCase());
    const basename = path.basename(file);
    const lowerBasename = basename.toLowerCase();
    const testDirectory = lowerParts.some((part) => testDirectories.has(part)
      || /^(?:.*[._-])?(?:integration|unit|functional|acceptance|e2e)?tests?$/u.test(part));
    const generatedDirectory = lowerParts.some((part) => generatedDirectories.has(part));
    const testFile = /(?:^|[._-])(?:test|tests|spec|specs)(?:[._-]|$)/u.test(lowerBasename)
      || /(?:Test|Tests|Spec|Specs)\.[^.]+$/u.test(basename)
      || lowerBasename === 'conftest.py';
    const generatedFile = /^generated/u.test(lowerBasename)
      || /(?:^|[._-])generated(?:[._-]|$)/u.test(lowerBasename)
      || /\.(?:g|designer)\.[^.]+$/u.test(lowerBasename)
      || /_pb2(?:_grpc)?\.py$/u.test(lowerBasename);
    let generatedHeader = false;
    try {
      const content = contents?.get(file)?.toString('utf8') ?? fs.readFileSync(file, 'utf8');
      generatedHeader = /^\s*(?:(?:\/\/|#|\/\*+|\*)\s*)?(?:<auto-generated|@generated\b|code generated by|generated by .{0,120}do not edit|this file was generated)/imu
        .test(content.slice(0, 4096));
    } catch {
      generatedHeader = true;
    }
    return !testDirectory && !generatedDirectory && !testFile && !generatedFile && !generatedHeader;
  });
}

function firstCodePatternMatch(files, pattern, contents = null) {
  const regex = new RegExp(pattern, 'iu');
  for (const file of files) {
    let content;
    try {
      content = contents?.get(file)?.toString('utf8') ?? fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const lines = stripSourceComments(content, path.extname(file).toLowerCase()).split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
      if (regex.test(lines[index])) {
        return { file, line: index + 1 };
      }
    }
  }
  return null;
}

function firstContentPatternMatch(file, content, pattern) {
  const match = new RegExp(pattern, 'iu').exec(content);
  if (!match) return null;
  return { file, line: content.slice(0, match.index).split(/\r?\n/u).length };
}

function auditFinding(projectPath, code, message, match = null) {
  const finding = { code, message };
  if (match) {
    finding.path = path.relative(projectPath, match.file).replace(/[\u0000-\u001f\u007f]/gu, '?');
    finding.line = match.line;
  }
  return finding;
}

const implementationRequiredPatterns = Object.freeze({
  AIPAY: [
    ['AIPAY_PAYMENT_NEEDED_MISSING', aipayPaymentNeededMarker, '缺少 Payment-Needed 账单响应'],
    ['AIPAY_PAYMENT_PROOF_MISSING', aipayPaymentProofMarker, '缺少 Payment-Proof 接收处理'],
    ['AIPAY_VERIFY_MISSING', aipayPaymentVerifyMarker, '缺少 alipay.aipay.agent.payment.verify 验付调用'],
    ['AIPAY_CONFIRM_MISSING', aipayFulfillmentConfirmMarker, '缺少 alipay.aipay.agent.fulfillment.confirm 履约确认'],
    ['AIPAY_VALIDATION_MISSING', aipayPaymentValidationMarker, '缺少 Payment-Validation 成功回执'],
    ['AIPAY_ACTIVE_CHECK_MISSING', '\\bactive\\b|getActive\\(|\\.Active\\b', '缺少验付 active 字段处理'],
    ['AIPAY_ORDER_CHECK_MISSING', 'out_trade_no|outTradeNo|OutTradeNo', '缺少商户订单号处理'],
    ['AIPAY_RESOURCE_CHECK_MISSING', 'resource_id|resourceId|ResourceId', '缺少资源标识处理']
  ],
  WEBPAY: [
    ['WEBPAY_CREATE_MISSING', webpayMarker, '缺少 alipay.trade.page.pay 下单入口'],
    ['TRADE_QUERY_MISSING', tradeQueryMarker, '缺少 alipay.trade.query 交易查询'],
    ['TRADE_REFUND_MISSING', tradeRefundMarker, '缺少 alipay.trade.refund 退款'],
    ['REFUND_QUERY_MISSING', tradeRefundQueryMarker, '缺少 alipay.trade.fastpay.refund.query 退款查询'],
    ['TRADE_CLOSE_MISSING', tradeCloseMarker, '缺少 alipay.trade.close 关闭交易'],
    ['TRADE_NOTIFY_MISSING', tradeNotifyMarker, '缺少异步通知处理入口']
  ],
  APPPAY: [
    ['APPPAY_CREATE_MISSING', apppayMarker, '缺少 alipay.trade.app.pay 下单入口'],
    ['TRADE_QUERY_MISSING', tradeQueryMarker, '缺少 alipay.trade.query 交易查询'],
    ['TRADE_REFUND_MISSING', tradeRefundMarker, '缺少 alipay.trade.refund 退款'],
    ['REFUND_QUERY_MISSING', tradeRefundQueryMarker, '缺少 alipay.trade.fastpay.refund.query 退款查询'],
    ['TRADE_CLOSE_MISSING', tradeCloseMarker, '缺少 alipay.trade.close 关闭交易'],
    ['TRADE_NOTIFY_MISSING', tradeNotifyMarker, '缺少异步通知处理入口']
  ]
});

export function inspectImplementation(variant, projectPath, snapshot = null) {
  if (!Object.prototype.hasOwnProperty.call(implementationRequiredPatterns, variant)) {
    throw new Error('implementation audit variant 非法，仅支持 AIPAY、WEBPAY、APPPAY');
  }
  if (!path.isAbsolute(projectPath) || !isReadableDirectory(projectPath)) {
    throw new Error('implementation audit 项目路径必须是可访问的绝对目录');
  }
  const currentSnapshot = snapshot || projectSnapshot(projectPath);
  const canonicalPath = currentSnapshot.canonicalPath;
  if (canonicalPath !== fs.realpathSync(projectPath)) throw new Error('implementation audit 项目快照路径不匹配');
  const files = implementationSourceFiles(canonicalPath, currentSnapshot.sources, currentSnapshot.contents);
  const findings = [];

  for (const [code, pattern, message] of implementationRequiredPatterns[variant]) {
    if (!firstCodePatternMatch(files, pattern, currentSnapshot.contents)) {
      findings.push(auditFinding(canonicalPath, code, message));
    }
  }

  const commonTradeRelevance = [tradeQueryMarker, tradeRefundMarker, tradeRefundQueryMarker, tradeCloseMarker, tradeNotifyMarker].join('|');
  const targetRelevancePattern = variant === 'AIPAY'
    ? aipayMarker
    : `${variant === 'WEBPAY' ? webpayMarker : apppayMarker}|${commonTradeRelevance}`;
  const criticalTodoPattern = '(?:TODO|FIXME)[\\s\\S]{0,240}(?:支付|订单|验付|验签|退款|履约|持久|幂等|payment|order|verify|signature|refund|fulfill|persist|idempot)';
  const fixedResourceFallbackPattern = '(?:resourceIdVerified|resource_id_verified|verifiedResourceId)\\s*=[\\s\\S]{0,240}(?:\\?\\?|\\|\\||\\bor\\b|\\?)[\\s\\S]{0,160}(?:RESOURCE_PATH|ResourcePath|resource\\.path)';
  const proofTradeFallbackPattern = '(?:fulfillmentTradeNo|fulfillment_trade_no)\\s*=[\\s\\S]{0,240}(?:\\?\\?|\\|\\||\\bor\\b|\\?)[\\s\\S]{0,160}(?:tradeNo|trade_no)';
  const mockBypassPattern = '(?:if|when)[\\s\\S]{0,240}(?:mock|test|sandbox)[\\s\\S]{0,320}(?:return\\s+true|bypass|skip|跳过)';

  for (const file of files) {
    let content;
    try {
      content = currentSnapshot.contents.get(file)?.toString('utf8') ?? fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const codeContent = stripSourceComments(content, path.extname(file).toLowerCase());
    const targetRelevant = new RegExp(targetRelevancePattern, 'iu').test(codeContent);
    const checks = [];
    if (targetRelevant || /alipay|支付宝|Payment-Proof/iu.test(codeContent)) {
      checks.push(['PAYMENT_VERIFICATION_BYPASS', mockBypassPattern, '存在测试/沙箱条件下直接绕过支付验签的生产代码']);
    }
    if (targetRelevant) {
      checks.push(['PAYMENT_CRITICAL_TODO', criticalTodoPattern, '支付关键控制仍保留 TODO/FIXME']);
    }
    for (const [code, pattern, message] of checks) {
      const match = firstContentPatternMatch(
        file,
        code === 'PAYMENT_CRITICAL_TODO' ? content : codeContent,
        pattern
      );
      if (match) findings.push(auditFinding(canonicalPath, code, message, match));
    }

    if (variant === 'AIPAY') {
      const blockChecks = [
        ['AIPAY_FIXED_RESOURCE_FALLBACK', fixedResourceFallbackPattern, 'A2M 验付字段缺失时回退到固定资源'],
        ['AIPAY_UNVERIFIED_TRADE_FALLBACK', proofTradeFallbackPattern, '履约交易号回退到未经验付响应确认的 Proof 字段']
      ];
      for (const [code, pattern, message] of blockChecks) {
        const match = firstContentPatternMatch(file, codeContent, pattern);
        if (match) findings.push(auditFinding(canonicalPath, code, message, match));
      }
    }

    const cwdConfig = /(?:process\.cwd\(\)|getcwd\(\)|Directory\.GetCurrentDirectory\(\)|System\.getProperty\(["']user\.dir["']\))[\s\S]{0,240}\.alipay-sandbox\.json|\.alipay-sandbox\.json[\s\S]{0,240}(?:process\.cwd\(\)|getcwd\(\)|Directory\.GetCurrentDirectory\(\)|System\.getProperty\(["']user\.dir["']\))/iu;
    const cwdMatch = cwdConfig.exec(codeContent);
    if (cwdMatch) {
      const line = codeContent.slice(0, cwdMatch.index).split(/\r?\n/u).length;
      findings.push(auditFinding(canonicalPath, 'SANDBOX_CONFIG_CWD_DEPENDENCY',
        '.alipay-sandbox.json 依赖进程当前目录定位', { file, line }));
    }

    const certificateExecution = /certificateExecute|certificate_execute|certExecute|ExecuteCertificate|ExecuteCert/iu.test(codeContent);
    const publicKeyConfiguration = /alipayPublicKey|alipay_public_key|AlipayPublicKey|setAlipayPublicKey/iu.test(codeContent);
    const completeCertificateConfiguration = [
      /appCertPublicKey|app_cert_public_key|AppCertPublicKey/iu,
      /alipayCertPublicKeyRSA2|alipay_cert_public_key|AlipayCertPublicKey/iu,
      /rootCert|root_cert|RootCert/iu
    ].every((pattern) => pattern.test(codeContent));
    if (certificateExecution && publicKeyConfiguration && !completeCertificateConfiguration) {
      const match = firstCodePatternMatch(
        [file], 'certificateExecute|certificate_execute|certExecute|ExecuteCertificate|ExecuteCert', currentSnapshot.contents);
      findings.push(auditFinding(canonicalPath, 'CERTIFICATE_MODE_MISMATCH',
        '公钥配置模式调用了证书执行 API，但未配置完整证书链', match));
    }
  }

  findings.sort((left, right) => `${left.code}:${left.path || ''}:${left.line || 0}`
    .localeCompare(`${right.code}:${right.path || ''}:${right.line || 0}`));
  return { projectPath: canonicalPath, variant, findings };
}

function scanProjectRoute(productType, projectPath, projectSelection) {
  if (!['aipay', 'webpay', 'apppay'].includes(productType)) {
    throw new Error('ROUTE_INSPECT_ERROR:productType 非法');
  }
  if (!['CURRENT_PROJECT', 'OTHER_PROJECT', 'PREPARED_NEW_PROJECT'].includes(projectSelection)) {
    throw new Error('ROUTE_INSPECT_ERROR:projectSelection 非法');
  }
  if (!path.isAbsolute(projectPath)) throw new Error('ROUTE_INSPECT_ERROR:projectPath 必须是绝对路径');
  if (!isReadableDirectory(projectPath)) throw new Error('ROUTE_INSPECT_ERROR:项目路径不可访问');

  const projectOrigin = projectSelection === 'PREPARED_NEW_PROJECT' ? 'NEW_PROJECT' : 'EXISTING_PROJECT';
  const projectOriginLabel = projectSelection === 'PREPARED_NEW_PROJECT' ? '本轮新建项目' : '现有项目';
  const targetMarker = productType === 'aipay' ? aipayMarker : productType === 'webpay' ? webpayMarker : apppayMarker;
  const files = sourceFiles(projectPath);
  const otherProducts = [];

  if (scanPattern(files, webpayMarker) && productType !== 'webpay') otherProducts.push('AI 网页应用收款');
  if (scanPattern(files, apppayMarker) && productType !== 'apppay') otherProducts.push('AI 移动应用收款');
  if (scanPattern(files, aipayMarker) && productType !== 'aipay') otherProducts.push('AI 按量付费');

  const otherProductsText = otherProducts.length > 0 ? otherProducts.join(',') : '无';
  let integrationStatus;
  let evidence;

  if (!scanPattern(files, targetMarker)) {
    if (otherProductsText === '无') {
      integrationStatus = 'NO_PAYMENT';
      evidence = projectSelection === 'PREPARED_NEW_PROJECT'
        ? '固定检查器扫描本轮已初始化的新项目，未发现目标产品或其他受支持支付代码'
        : '固定检查器未发现目标产品或其他受支持支付代码';
    } else {
      integrationStatus = 'OTHER_PRODUCT_ONLY';
      evidence = '固定检查器只发现其他受支持支付产品代码';
    }
  } else {
    const requiredPatterns = productType === 'aipay'
      ? [aipayPaymentNeededMarker, aipayPaymentProofMarker, aipayPaymentVerifyMarker, aipayFulfillmentConfirmMarker, aipayPaymentValidationMarker]
      : productType === 'webpay'
        ? [webpayMarker, tradeQueryMarker, tradeRefundMarker, tradeRefundQueryMarker, tradeCloseMarker, tradeNotifyMarker]
        : [apppayMarker, tradeQueryMarker, tradeRefundMarker, tradeRefundQueryMarker, tradeCloseMarker, tradeNotifyMarker];
    const missing = requiredPatterns.filter((pattern) => !scanPattern(files, pattern));
    integrationStatus = 'TARGET_PARTIAL';
    evidence = missing.length === 0
      ? '固定检查器逐项发现目标产品入口及全部核心接口标记，但静态扫描不能证明配置、安全、测试和 checklist 完成；必须进入 Integration 验证分支'
      : '固定检查器发现目标产品代码，但至少一个核心接口标记缺失；不得按完整集成路由';
  }

  return {
    projectSelection,
    projectOrigin,
    projectOriginLabel,
    integrationStatus,
    evidence,
    otherProducts: otherProductsText
  };
}

function runResolveProject(args) {
  const intent = required(args, 'intent');
  if (!['existing', 'new'].includes(intent)) throw new Error('intent 非法，仅支持 existing、new');
  const basePath = normalizeBasePath(required(args, 'base-path'));
  const input = sanitizeProjectInput(required(args, 'project-input'));
  if (args['target-path'] !== undefined) {
    throw new Error('参数 --target-path 已移除；现有项目和新建项目都使用 --project-path 传递真实路径');
  }
  const pathInput = sanitizeProjectInput(required(args, 'project-path'));

  if (intent === 'existing') {
    if (isExplicitNewProjectRequest(input)) {
      throw new Error('明确新建项目请求必须使用 --intent new，不能改用当前项目');
    }
    const existingInput = parseExistingProjectPath(pathInput);
    const candidate = currentProjectAliases.has(existingInput) ? basePath : resolveAgainstBase(existingInput, basePath);
    const projectPath = fs.existsSync(candidate) ? fs.realpathSync(candidate) : candidate;
    if (!fs.existsSync(projectPath) || !fs.statSync(projectPath).isDirectory()) {
      throw new Error('现有项目路径不可访问；请提供当前目录内相对路径或实际存在的绝对路径');
    }
    if (!isRecognizableProjectRoot(projectPath)) {
      const prefix = currentProjectAliases.has(existingInput)
        ? '当前目录不是可识别的项目根，不能直接作为现有项目扫描'
        : '该路径未识别到项目根标记，不能确认是服务端项目根';
      const searchBasePath = currentProjectAliases.has(existingInput) ? basePath : projectPath;
      throw projectRootError(searchBasePath, prefix, basePath);
    }
    return JSON.stringify({
      projectPath,
      projectSelection: classifyExistingProject(projectPath, basePath, existingInput),
      projectOrigin: 'EXISTING_PROJECT',
      projectOriginLabel: '现有项目'
    });
  }

  const newPathInput = parseNewProjectPath(pathInput);
  if (currentProjectAliases.has(newPathInput)) {
    throw new Error('新项目必须明确尚不存在或为空的子目录名');
  }
  const projectPath = resolveAgainstBase(newPathInput, basePath);
  const route = isWindowsPlatform()
    ? prepareNewProject(projectPath)
    : runUnixInspector(['prepare-new', projectPath], '新项目路径检查', '新项目路径检查器');
  return JSON.stringify({ projectPath, ...route });
}

function runLocateProjects(args) {
  const basePath = normalizeBasePath(required(args, 'base-path'));
  const searchBasePath = resolveSearchBasePath(args, basePath);
  const maxDepth = parseDepth(args['max-depth']);
  const format = args.format || 'json';
  if (!['json', 'message'].includes(format)) throw new Error('format 仅支持 json 或 message');
  const candidates = locateProjectCandidates(searchBasePath, maxDepth, 20, basePath, basePath);
  if (format === 'message') {
    return renderMessage('integration.project_candidates.select', 'DEFAULT', {
      searchBasePath,
      candidateRows: formatLocatedCandidateRows(candidates)
    });
  }
  return JSON.stringify({
    basePath,
    searchBasePath,
    maxDepth,
    candidates,
    nextAction: '请选择一个候选项目目录作为现有项目，或说明要新建的目录，例如“在当前目录新建 pay-demo”或“新建项目”。'
  });
}

function normalizeLanguage(input) {
  const value = input.trim();
  const compact = value.toLowerCase().replace(/[\s_.-]+/g, '');
  if (compact === 'java') return 'Java';
  if (compact === 'python' || compact === 'py' || compact === 'python3') return 'Python';
  if (compact === 'nodejs' || compact === 'node' || compact === 'javascript' || compact === 'js') return 'Node.js';
  if (compact === 'c#' || compact === 'csharp' || compact === 'dotnet' || compact === 'net') return 'C#';
  if (compact === 'php') return 'PHP';
  throw new Error('服务端语言非法，仅支持 Java、Python、Node.js、C#、PHP');
}

const existingProjectFrameworkFallback = '沿用现有项目结构';
const defaultFrameworks = Object.freeze({
  Java: 'Spring Boot',
  PHP: 'Laravel',
  Python: 'FastAPI',
  'C#': 'ASP.NET Core',
  'Node.js': 'Express'
});
const frameworkSources = new Set([
  'EXPLICIT',
  'DEFAULT_NEW_PROJECT',
  'PROJECT_INFERRED',
  'PROJECT_STRUCTURE_FALLBACK'
]);

function readProjectMarker(projectPath, relativePath) {
  const file = path.join(projectPath, relativePath);
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) return '';
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function readProjectJson(projectPath, relativePath) {
  const content = readProjectMarker(projectPath, relativePath);
  if (!content) return null;
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function dependencyNames(manifest) {
  const names = new Set();
  for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'require', 'require-dev']) {
    const dependencies = manifest?.[key];
    if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) continue;
    for (const name of Object.keys(dependencies)) names.add(name.toLowerCase());
  }
  return names;
}

function firstMatchingFramework(names, rules) {
  for (const [framework, matches] of rules) {
    if (matches.some((name) => names.has(name) || [...names].some((item) => item.startsWith(`${name}/`)))) {
      return framework;
    }
  }
  return '';
}

function inferFramework(projectPath, language) {
  if (language === 'Node.js') {
    return firstMatchingFramework(dependencyNames(readProjectJson(projectPath, 'package.json')), [
      ['NestJS', ['@nestjs/core']],
      ['Next.js', ['next']],
      ['Express', ['express']],
      ['Fastify', ['fastify']],
      ['Koa', ['koa']],
      ['Hono', ['hono']]
    ]);
  }
  if (language === 'PHP') {
    return firstMatchingFramework(dependencyNames(readProjectJson(projectPath, 'composer.json')), [
      ['Laravel', ['laravel/framework']],
      ['Symfony', ['symfony/framework-bundle', 'symfony/http-kernel']]
    ]);
  }
  if (language === 'Java') {
    const content = [
      readProjectMarker(projectPath, 'pom.xml'),
      readProjectMarker(projectPath, 'build.gradle'),
      readProjectMarker(projectPath, 'build.gradle.kts')
    ].join('\n').toLowerCase();
    if (/spring-boot|org\.springframework\.boot/u.test(content)) return 'Spring Boot';
    if (/io\.quarkus|quarkus-/u.test(content)) return 'Quarkus';
    if (/io\.micronaut|micronaut-/u.test(content)) return 'Micronaut';
    return '';
  }
  if (language === 'Python') {
    const content = [
      readProjectMarker(projectPath, 'pyproject.toml'),
      readProjectMarker(projectPath, 'requirements.txt'),
      readProjectMarker(projectPath, 'Pipfile')
    ].join('\n').toLowerCase();
    if (/(^|[^a-z])django([^a-z]|$)/u.test(content)) return 'Django';
    if (/(^|[^a-z])fastapi([^a-z]|$)/u.test(content)) return 'FastAPI';
    if (/(^|[^a-z])flask([^a-z]|$)/u.test(content)) return 'Flask';
    return '';
  }
  if (language === 'C#') {
    const content = safeReaddir(projectPath)
      .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name.toLowerCase().endsWith('.csproj'))
      .map((entry) => readProjectMarker(projectPath, entry.name))
      .join('\n').toLowerCase();
    if (/microsoft\.net\.sdk\.web|microsoft\.aspnetcore/u.test(content)) return 'ASP.NET Core';
    return '';
  }
  return '';
}

function sanitizeFramework(value) {
  const framework = value.trim();
  if (!framework || framework.length > 120 || /[\u0000-\u001f\u007f|`]/u.test(framework) || /https?:\/\//iu.test(framework)) {
    throw new Error('framework 必须是安全的单行框架名称');
  }
  return framework;
}

function deriveFramework(projectPath, projectSelection, language) {
  if (projectSelection === 'NEW_PROJECT' || projectSelection === 'PREPARED_NEW_PROJECT') {
    return { framework: defaultFrameworks[language], frameworkSource: 'DEFAULT_NEW_PROJECT' };
  }
  const inferred = inferFramework(projectPath, language);
  return {
    framework: inferred || existingProjectFrameworkFallback,
    frameworkSource: inferred ? 'PROJECT_INFERRED' : 'PROJECT_STRUCTURE_FALLBACK'
  };
}

function resolveFramework(args, projectPath, projectSelection, language) {
  const suppliedFramework = typeof args.framework === 'string' && args.framework.length > 0
    ? sanitizeFramework(args.framework)
    : '';
  const suppliedSource = typeof args['framework-source'] === 'string' ? args['framework-source'] : '';
  if (suppliedSource && !frameworkSources.has(suppliedSource)) {
    throw new Error('framework-source 非法，仅支持 EXPLICIT、DEFAULT_NEW_PROJECT、PROJECT_INFERRED、PROJECT_STRUCTURE_FALLBACK');
  }

  if (!suppliedSource) {
    return suppliedFramework
      ? { framework: suppliedFramework, frameworkSource: 'EXPLICIT' }
      : deriveFramework(projectPath, projectSelection, language);
  }
  if (!suppliedFramework) throw new Error('framework-source 必须与 framework 同时提供');
  if (suppliedSource === 'EXPLICIT') {
    return { framework: suppliedFramework, frameworkSource: suppliedSource };
  }

  const derived = deriveFramework(projectPath, projectSelection, language);
  if (derived.framework !== suppliedFramework || derived.frameworkSource !== suppliedSource) {
    throw new Error('framework 与当前项目推导事实不一致');
  }
  return derived;
}

function runFrameworkResolve(args) {
  const language = normalizeLanguage(required(args, 'language'));
  const projectSelection = required(args, 'project-selection');
  if (!['NEW_PROJECT', 'PREPARED_NEW_PROJECT', 'CURRENT_PROJECT', 'OTHER_PROJECT'].includes(projectSelection)) {
    throw new Error('project-selection 非法，仅支持 CURRENT_PROJECT、OTHER_PROJECT、NEW_PROJECT、PREPARED_NEW_PROJECT');
  }
  let projectPath = '';
  if (projectSelection === 'CURRENT_PROJECT' || projectSelection === 'OTHER_PROJECT') {
    projectPath = fs.realpathSync(required(args, 'project-path'));
    if (!isReadableDirectory(projectPath)) throw new Error('现有项目路径不可访问');
  }
  const resolved = resolveFramework(args, projectPath, projectSelection, language);
  return JSON.stringify({ language, ...resolved });
}

function startConfirmationFacts(args) {
  const rootIntent = required(args, 'root-intent');
  if (!['integration_only', 'full_process'].includes(rootIntent)) {
    throw new Error('root-intent 仅支持 integration_only、full_process');
  }
  const productType = required(args, 'product-type');
  const mapping = productVariants[productType];
  if (!mapping) throw new Error('product-type 非法，仅支持 aipay、webpay、apppay');

  const projectPath = required(args, 'project-path');
  const projectSelection = required(args, 'project-selection');
  const language = normalizeLanguage(required(args, 'language'));
  const { framework, frameworkSource } = resolveFramework(args, projectPath, projectSelection, language);
  const productName = args['product-name'] || mapping.productName;
  if (productName !== mapping.productName) throw new Error('product-name 与 product-type 不匹配');
  if (!path.isAbsolute(projectPath)) throw new Error('project-path 必须是绝对路径');

  const route = isWindowsPlatform()
    ? scanProjectRoute(productType, projectPath, projectSelection)
    : runUnixInspector(['scan', productType, projectPath, projectSelection], '项目检查', '项目检查器');
  if (route.projectSelection !== projectSelection) throw new Error('项目检查结果与本轮 projectSelection 不一致');
  const existing = projectSelection === 'CURRENT_PROJECT' || projectSelection === 'OTHER_PROJECT';
  const preparedNew = projectSelection === 'PREPARED_NEW_PROJECT';
  if (
    !(preparedNew && route.projectOrigin === 'NEW_PROJECT' && route.projectOriginLabel === '本轮新建项目') &&
    !(existing && route.projectOrigin === 'EXISTING_PROJECT' && route.projectOriginLabel === '现有项目')
  ) {
    throw new Error('项目来源与本轮项目选择不一致');
  }
  if (!['TARGET_PARTIAL', 'OTHER_PRODUCT_ONLY', 'NO_PAYMENT'].includes(route.integrationStatus)) {
    throw new Error('项目集成状态不允许发起代码开发确认');
  }
  if (typeof route.evidence !== 'string' || typeof route.otherProducts !== 'string') {
    throw new Error('项目检查结果缺少必要事实字段');
  }

  return {
    rootIntent,
    productType,
    variant: mapping.variant,
    productName,
    projectPath: fs.realpathSync(projectPath),
    projectSelection,
    language,
    framework,
    frameworkSource,
    route
  };
}

function renderStartConfirmation(facts) {
  return renderMessage('integration.start.confirm', facts.variant, {
    productName: facts.productName,
    projectPath: facts.projectPath,
    projectOriginLabel: facts.route.projectOriginLabel,
    integrationStatus: facts.route.integrationStatus,
    otherProducts: facts.route.otherProducts,
    language: facts.language,
    framework: facts.framework,
    nextFlow: 'integration'
  });
}

export async function createStartConfirmation(args) {
  const facts = startConfirmationFacts(args);
  await startTelemetryRun(facts.rootIntent, facts.productType);
  return renderStartConfirmation(facts);
}

export function createChecklistScopeReceipt(productType, projectPath) {
  const variant = productVariants[productType]?.variant;
  if (!variant) throw new Error('checklist scope product-type 非法');
  const snapshot = projectSnapshot(projectPath);
  return encodeReceipt({
    schema_ver: 1,
    kind: receiptKinds.checklist,
    variant,
    project_path: snapshot.canonicalPath,
    project_fingerprint: snapshot.fingerprint
  });
}

function validateChecklistScopeReceipt(receipt, expectedVariant, expectedProjectPath, snapshot) {
  const payload = decodeReceipt(receipt, receiptKinds.checklist);
  const canonicalExpectedPath = fs.realpathSync(expectedProjectPath);
  return payload.variant === expectedVariant
    && payload.project_path === canonicalExpectedPath
    && snapshot.canonicalPath === canonicalExpectedPath
    && snapshot.fingerprint === payload.project_fingerprint;
}

function a2mExecutionFacts(args) {
  const projectPath = fs.realpathSync(required(args, 'project-path'));
  if (!isReadableDirectory(projectPath)) throw new Error('A2M 联调项目路径不可访问');
  const method = required(args, 'http-method').toUpperCase();
  if (!['GET', 'POST'].includes(method)) throw new Error('http-method 仅支持 GET 或 POST');
  let serviceUrl;
  try {
    serviceUrl = new URL(required(args, 'service-url'));
  } catch {
    throw new Error('service-url 不是合法 URL');
  }
  if (!['http:', 'https:'].includes(serviceUrl.protocol) || serviceUrl.username || serviceUrl.password || serviceUrl.hash) {
    throw new Error('service-url 只允许不含凭据和 fragment 的 HTTP(S) URL');
  }
  let requestBodyHash = '';
  const requestBodyFile = args['request-body-file'];
  if (method === 'POST') {
    if (!requestBodyFile || !path.isAbsolute(requestBodyFile)) throw new Error('POST 必须传入绝对 --request-body-file');
    const stat = fs.lstatSync(requestBodyFile);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('request-body-file 必须是普通文件且不能是符号链接');
    requestBodyHash = crypto.createHash('sha256').update(fs.readFileSync(requestBodyFile)).digest('hex');
  } else if (requestBodyFile !== undefined) {
    throw new Error('GET 禁止传入 request-body-file');
  }
  return {
    project_path: projectPath,
    project_fingerprint: projectSnapshotFingerprint(projectPath),
    service_url: serviceUrl.href,
    http_method: method,
    request_body_sha256: requestBodyHash
  };
}

function a2mExecutionReceipt(facts, state = 'READY') {
  return encodeReceipt({
    schema_ver: 1,
    kind: receiptKinds.a2mExecution,
    state,
    ...facts
  });
}

export function guardA2mExecution(args) {
  const facts = a2mExecutionFacts(args);
  const priorReceipt = args['prior-receipt'];
  if (!priorReceipt) return { decision: 'RUN', receipt: a2mExecutionReceipt(facts) };
  const prior = decodeReceipt(priorReceipt, receiptKinds.a2mExecution);
  const unchanged = ['project_path', 'project_fingerprint', 'service_url', 'http_method', 'request_body_sha256']
    .every((key) => prior[key] === facts[key]);
  if (!unchanged) return { decision: 'RUN', receipt: a2mExecutionReceipt(facts) };
  if (prior.state === 'PASSED') return { decision: 'REUSE_PASSED', receipt: priorReceipt };
  if (prior.state === 'FAILED') return { decision: 'BLOCK_UNCHANGED', receipt: priorReceipt };
  return { decision: 'UNKNOWN_PREVIOUS_EXECUTION', receipt: priorReceipt };
}

export function completeA2mExecution(receipt, outcome) {
  if (!['PASSED', 'FAILED', 'INTERRUPTED'].includes(outcome)) {
    throw new Error('outcome 仅支持 PASSED、FAILED、INTERRUPTED');
  }
  const prior = decodeReceipt(receipt, receiptKinds.a2mExecution);
  if (prior.state !== 'READY') throw new Error('A2M execution receipt 已经终态化');
  const { schema_ver, kind, state, ...facts } = prior;
  void schema_ver;
  void kind;
  void state;
  return a2mExecutionReceipt(facts, outcome);
}

function runContextRequired(args) {
  const missingItems = required(args, 'missing-items');
  return renderMessage('integration.context.required', missingItems === '项目路径' ? 'PROJECT_PATH_ONLY' : 'DEFAULT', {
    missingItems
  });
}

function runProductClarify() {
  return renderMessage('product.clarify', 'DEFAULT', {});
}

function runProductUnsupported(args) {
  return renderMessage('product.unsupported', 'DEFAULT', {
    productName: required(args, 'product-name')
  });
}

function runWindowsSandboxSetup() {
  return renderMessage('sandbox.windows.manual_setup', 'DEFAULT', {});
}

function runLocalAcceptanceNotice() {
  return renderMessage('integration.local_acceptance.notice', 'DEFAULT', {});
}

function runA2mTestStart() {
  return renderMessage('a2m.test.start', 'DEFAULT', {});
}

function runSandboxAndroidClient() {
  return renderMessage('sandbox.android.client', 'DEFAULT', {});
}

function runServiceNotReady(args) {
  return renderMessage('integration.service.not_ready', 'DEFAULT', {
    recoveryAction: required(args, 'recovery-action')
  });
}

function runSafetyCloseout(args) {
  const variant = required(args, 'variant');
  if (!['AIPAY', 'WEBPAY', 'APPPAY'].includes(variant)) throw new Error('variant 非法，仅支持 AIPAY、WEBPAY、APPPAY');
  return requireCustomerMessageDelivery('integration.safety.closeout', renderMessage('integration.safety.closeout', variant, {
    acceptanceSummary: required(args, 'acceptance-summary')
  }));
}

function runWindowsSandboxSummary(args) {
  const summary = renderMessage('sandbox.environment.summary', 'DEFAULT', {
    productName: required(args, 'product-name'),
    configPath: required(args, 'config-path'),
    environmentRows: required(args, 'environment-rows')
  });
  const reminder = renderMessage('sandbox.environment.reminder', 'WINDOWS', {});
  emitStageMetric('integration.create_sandbox');
  return requireCustomerMessageDelivery('sandbox.environment.summary', `${summary}\n\n${reminder}`);
}

async function readStdin() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  return input.trim() ? JSON.parse(input) : {};
}

function checklistInputFromArgs(args) {
  const mapping = {
    'overall-result': 'overallResult',
    'failed-items': 'failedItems',
    'manual-items': 'manualItems',
    'sandbox-result': 'sandboxResult',
    'webpay-experience-result': 'webpayExperienceResult',
    'sandbox-config-state': 'sandboxConfigState',
    'blocking-defect-state': 'blockingDefectState',
    'execution-mode': 'executionMode',
    'next-flow-reminder': 'nextFlowReminder'
  };
  const hasTypedInput = Object.keys(mapping).some((name) => Object.prototype.hasOwnProperty.call(args, name));
  if (!hasTypedInput) return null;

  const input = {};
  for (const [argName, fieldName] of Object.entries(mapping)) {
    if (Object.prototype.hasOwnProperty.call(args, argName)) input[fieldName] = args[argName];
  }
  for (const requiredName of [
    'overall-result',
    'failed-items',
    'manual-items',
    'sandbox-config-state',
    'blocking-defect-state',
    'execution-mode',
    'next-flow-reminder'
  ]) {
    required(args, requiredName);
  }
  return input;
}

async function runChecklistResult(args) {
  const variant = required(args, 'variant');
  if (!['AIPAY', 'WEBPAY', 'APPPAY'].includes(variant)) throw new Error('variant 非法，仅支持 AIPAY、WEBPAY、APPPAY');
  if (telemetryEnabled()) {
    const run = currentRunContext();
    if (!run?.run_id || run.terminal || run.product_type !== variant.toUpperCase()
      || !['integration_only', 'full_process'].includes(run.root_intent)) {
      throw new Error('checklist 必须在当前产品匹配的 active integration run 内执行');
    }
  }
  if (Object.prototype.hasOwnProperty.call(args, 'implementation-audit-receipt')) {
    throw new Error('implementation-audit-receipt 已废弃');
  }
  const finalizesAuditFindings = Object.prototype.hasOwnProperty.call(args, 'finalize-audit-findings');
  if (finalizesAuditFindings && args['finalize-audit-findings'] !== 'true') {
    throw new Error('finalize-audit-findings 只允许 true');
  }
  const scopeReceipt = required(args, 'scope-receipt');
  const projectPath = required(args, 'project-path');
  const snapshot = projectSnapshot(projectPath);
  if (!validateChecklistScopeReceipt(scopeReceipt, variant, projectPath, snapshot)) {
    throw new Error('项目在当前 checklist 开始后发生变化，或产品不匹配；必须重新进入 checklist 阶段并重跑受影响检查');
  }
  const input = checklistInputFromArgs(args) || await readStdin();
  const audit = inspectImplementation(variant, projectPath, snapshot);
  if (audit.findings.length === 0 && finalizesAuditFindings) {
    throw new Error('finalize-audit-findings 仅用于收口实际 audit findings');
  }
  if (audit.findings.length > 0) {
    if (args['finalize-audit-findings'] !== 'true') {
      process.stderr.write(`${internalPrefix}CHECKLIST_AUDIT=${JSON.stringify({
        state: 'REPAIR_REQUIRED',
        findings: audit.findings
      })}\n`);
      return null;
    }
    const auditItems = audit.findings.map((finding) => {
      const location = finding.path ? `（${finding.path}${finding.line ? `:${finding.line}` : ''}）` : '';
      return `${finding.message}${location}`;
    }).join('；');
    input.overallResult = '未通过';
    input.blockingDefectState = 'PRESENT';
    input.failedItems = input.failedItems && input.failedItems !== '无'
      ? `${input.failedItems}；${auditItems}`
      : auditItems;
    if (input.executionMode === '完整接入') {
      input.nextFlowReminder = '代码开发校验通过后将自动进入支付产品-产品开通；未通过时停留在代码开发。';
    }
  }
  emitStageMetric('integration.complete_coding');
  const rendered = renderMessage('integration.checklist.result', variant, input);
  return requireCustomerMessageDelivery('integration.checklist.result', rendered);
}

export async function runIntegrationMessageCli(argv = process.argv) {
  const { command, args } = parseArgs(argv);
  if (command === 'resolve-project') {
    console.log(runResolveProject(args));
    return;
  }
  if (command === 'locate-projects') {
    console.log(runLocateProjects(args));
    return;
  }
  if (command === 'start-confirm') {
    console.log(await createStartConfirmation(args));
    process.stderr.write(`${internalPrefix}CUSTOMER_MESSAGE_DELIVERY_REQUIRED=integration.start.confirm\n`);
    return;
  }
  if (command === 'framework-resolve') {
    console.log(runFrameworkResolve(args));
    return;
  }
  if (command === 'a2m-execution-guard') {
    process.stderr.write(`${internalPrefix}A2M_EXECUTION=${JSON.stringify(guardA2mExecution(args))}\n`);
    return;
  }
  if (command === 'a2m-execution-result') {
    const receipt = completeA2mExecution(required(args, 'receipt'), required(args, 'outcome'));
    process.stderr.write(`${internalPrefix}A2M_EXECUTION=${JSON.stringify({ decision: 'RECORDED', receipt })}\n`);
    return;
  }
  if (command === 'context-required') {
    console.log(runContextRequired(args));
    return;
  }
  if (command === 'product-clarify') {
    console.log(runProductClarify());
    return;
  }
  if (command === 'product-unsupported') {
    console.log(runProductUnsupported(args));
    return;
  }
  if (command === 'windows-sandbox-setup') {
    console.log(runWindowsSandboxSetup());
    return;
  }
  if (command === 'local-acceptance-notice') {
    console.log(runLocalAcceptanceNotice());
    return;
  }
  if (command === 'a2m-test-start') {
    console.log(runA2mTestStart());
    return;
  }
  if (command === 'sandbox-android-client') {
    console.log(runSandboxAndroidClient());
    return;
  }
  if (command === 'service-not-ready') {
    console.log(runServiceNotReady(args));
    return;
  }
  if (command === 'safety-closeout') {
    console.log(runSafetyCloseout(args));
    return;
  }
  if (command === 'windows-sandbox-summary') {
    console.log(runWindowsSandboxSummary(args));
    return;
  }
  if (command === 'checklist-result') {
    const rendered = await runChecklistResult(args);
    if (rendered !== null) console.log(rendered);
    return;
  }
  throw new Error('用法: integration_message_runner.mjs <resolve-project|locate-projects|framework-resolve|start-confirm|a2m-execution-guard|a2m-execution-result|context-required|product-clarify|product-unsupported|windows-sandbox-setup|local-acceptance-notice|a2m-test-start|sandbox-android-client|service-not-ready|safety-closeout|windows-sandbox-summary|checklist-result> ...');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runIntegrationMessageCli().catch((error) => {
    console.error(`INTEGRATION_MESSAGE_ERROR:${error.message}`);
    process.exitCode = 1;
  });
}
