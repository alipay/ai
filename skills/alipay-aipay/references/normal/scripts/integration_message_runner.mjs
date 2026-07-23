#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { renderMessage } from './render_customer_message.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const inspectorPath = path.join(scriptDir, 'project_route_inspector.sh');

const productVariants = {
  aipay: { variant: 'AIPAY', productName: '按量付费' },
  webpay: { variant: 'WEBPAY', productName: '网站支付' },
  apppay: { variant: 'APPPAY', productName: 'APP 支付' }
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
  'node_modules',
  'target',
  'vendor'
]);

function parseArgs(argv) {
  const command = argv[2];
  const args = {};
  for (let index = 3; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error(`未知参数 ${key}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`参数 ${key} 缺少取值`);
    args[key.slice(2)] = value;
    index += 1;
  }
  return { command, args };
}

function required(args, name) {
  const value = args[name];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`缺少参数 --${name}`);
  return value;
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
  return /^(?:帮我)?(?:新建|创建)(?:一个)?(?:默认)?(?:项目|目录)?$/u.test(input) ||
    /^(?:帮我)?(?:新建|创建)(?:一个)?默认项目$/u.test(input);
}

function hasDirectoryEntries(directory) {
  try {
    return safeReaddir(directory).length > 0;
  } catch {
    return true;
  }
}

function defaultNewProjectPath() {
  const homeInput = process.env.HOME || os.homedir() || '';
  if (!homeInput) throw new Error('无法确定用户目录；请提供明确的新项目路径');
  const homePath = normalizeBasePath(homeInput);
  const container = path.join(homePath, 'alipay-aipay-projects');
  if (fs.existsSync(container)) {
    const stat = fs.lstatSync(container);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('默认项目父目录不可用；请提供明确的新项目路径');
    }
  }
  for (let index = 1; index <= 50; index += 1) {
    const suffix = index === 1 ? '' : `-${index}`;
    const candidate = path.join(container, `pay-demo${suffix}`);
    if (!fs.existsSync(candidate)) return candidate;
    const stat = fs.lstatSync(candidate);
    if (stat.isDirectory() && !stat.isSymbolicLink() && !hasDirectoryEntries(candidate)) return candidate;
  }
  throw new Error('默认项目目录已被占用；请提供明确的新项目路径');
}

function parseNewProjectPath(input) {
  if (isDefaultNewProjectRequest(input)) return defaultNewProjectPath();
  const patterns = [
    /^(?:在)?(?:当前目录|当前项目|这个项目|这个仓库|这里)(?:下|里)?(?:新建|创建)(?:一个)?(?:项目|目录)?\s*(.+)$/u,
    /^(?:新建|创建)(?:一个)?(?:项目|目录)?(?:到|在)?(?:当前目录|当前项目|这个项目|这个仓库|这里)?(?:下|里)?\s*(.+)$/u
  ];
  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match?.[1]) return stripWrappingQuotes(match[1]);
  }
  return input;
}

function resolveAgainstBase(input, basePath) {
  const candidate = path.isAbsolute(input) ? path.resolve(input) : path.resolve(basePath, input);
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

function runResolveProject(args) {
  const intent = required(args, 'intent');
  if (!['existing', 'new'].includes(intent)) throw new Error('intent 非法，仅支持 existing、new');
  const basePath = normalizeBasePath(required(args, 'base-path'));
  const input = sanitizeProjectInput(required(args, 'project-input'));

  if (intent === 'existing') {
    const candidate = currentProjectAliases.has(input) ? basePath : resolveAgainstBase(input, basePath);
    const projectPath = fs.existsSync(candidate) ? fs.realpathSync(candidate) : candidate;
    if (!fs.existsSync(projectPath) || !fs.statSync(projectPath).isDirectory()) {
      throw new Error('现有项目路径不可访问；请提供当前目录内相对路径或实际存在的绝对路径');
    }
    if (!isRecognizableProjectRoot(projectPath)) {
      const prefix = currentProjectAliases.has(input)
        ? '当前目录不是可识别的项目根，不能直接作为现有项目扫描'
        : '该路径未识别到项目根标记，不能确认是服务端项目根';
      const searchBasePath = currentProjectAliases.has(input) ? basePath : projectPath;
      throw projectRootError(searchBasePath, prefix, basePath);
    }
    return JSON.stringify({
      projectPath,
      projectSelection: classifyExistingProject(projectPath, basePath, input),
      projectOrigin: 'EXISTING_PROJECT',
      projectOriginLabel: '现有项目'
    });
  }

  const newPathInput = sanitizeProjectInput(parseNewProjectPath(input));
  if (currentProjectAliases.has(newPathInput)) {
    throw new Error('新项目必须明确尚不存在或为空的子目录名');
  }
  const projectPath = resolveAgainstBase(newPathInput, basePath);
  const prepared = spawnSync('bash', [inspectorPath, 'prepare-new', projectPath], {
    encoding: 'utf8',
    shell: false
  });
  if (prepared.status !== 0) {
    const detail = (prepared.stderr || prepared.stdout || '').trim() || `退出码 ${prepared.status}`;
    throw new Error(`新项目路径检查失败：${detail}`);
  }
  const route = parseSingleJson(prepared.stdout, '新项目路径检查器');
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

function runStartConfirm(args) {
  const productType = required(args, 'product-type');
  const mapping = productVariants[productType];
  if (!mapping) throw new Error('product-type 非法，仅支持 aipay、webpay、apppay');

  const projectPath = required(args, 'project-path');
  const projectSelection = required(args, 'project-selection');
  const language = normalizeLanguage(required(args, 'language'));
  const framework = required(args, 'framework');
  const productName = args['product-name'] || mapping.productName;
  if (productName !== mapping.productName) throw new Error('product-name 与 product-type 不匹配');
  if (!path.isAbsolute(projectPath)) throw new Error('project-path 必须是绝对路径');

  const inspected = spawnSync('bash', [inspectorPath, 'scan', productType, projectPath, projectSelection], {
    encoding: 'utf8',
    shell: false
  });
  if (inspected.status !== 0) {
    const detail = (inspected.stderr || inspected.stdout || '').trim() || `退出码 ${inspected.status}`;
    throw new Error(`项目检查失败：${detail}`);
  }

  const route = parseSingleJson(inspected.stdout, '项目检查器');
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

  return renderMessage('integration.start.confirm', mapping.variant, {
    productName,
    projectPath,
    projectOriginLabel: route.projectOriginLabel,
    integrationStatus: route.integrationStatus,
    otherProducts: route.otherProducts,
    language,
    framework,
    nextFlow: 'integration'
  });
}

async function readStdin() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  return input.trim() ? JSON.parse(input) : {};
}

async function runChecklistResult(args) {
  const variant = required(args, 'variant');
  if (!['AIPAY', 'WEBPAY', 'APPPAY'].includes(variant)) throw new Error('variant 非法，仅支持 AIPAY、WEBPAY、APPPAY');
  const input = await readStdin();
  return renderMessage('integration.checklist.result', variant, input);
}

async function main() {
  const { command, args } = parseArgs(process.argv);
  if (command === 'resolve-project') {
    console.log(runResolveProject(args));
    return;
  }
  if (command === 'locate-projects') {
    console.log(runLocateProjects(args));
    return;
  }
  if (command === 'start-confirm') {
    console.log(runStartConfirm(args));
    return;
  }
  if (command === 'checklist-result') {
    console.log(await runChecklistResult(args));
    return;
  }
  throw new Error('用法: integration_message_runner.mjs <resolve-project|locate-projects|start-confirm|checklist-result> ...');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`INTEGRATION_MESSAGE_ERROR:${error.message}`);
    process.exitCode = 1;
  });
}
