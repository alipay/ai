#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { checklistForProduct } from './checklist_sections.mjs';
import { createChecklistScopeReceipt } from './integration_message_runner.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const referencesDir = path.resolve(scriptDir, '../..');
const productTypes = new Set(['aipay', 'webpay', 'apppay']);
const flowDefinitions = Object.freeze({
  integration: {
    source: path.join(referencesDir, 'integration/flow.md'),
    prefix: 'INTEGRATION',
    sharedGuard: 'INTEGRATION-GUARDS',
    productGuards: { aipay: 'INTEGRATION-GUARDS-AIPAY' }
  },
  onboarding: {
    source: path.join(referencesDir, 'onboarding/flow.md'),
    prefix: 'ONBOARDING',
    sharedGuard: 'ONBOARDING-GUARDS-SHARED'
  }
});

function definitionFor(flow) {
  const definition = flowDefinitions[flow];
  if (!definition) throw new Error('flow 仅支持 integration 或 onboarding');
  return definition;
}

function marker(name, boundary) {
  return `<!-- ALIPAY_AIPAY_FLOW:${name}:${boundary} -->`;
}

function countOccurrences(source, needle) {
  let count = 0;
  let offset = 0;
  while ((offset = source.indexOf(needle, offset)) >= 0) {
    count += 1;
    offset += needle.length;
  }
  return count;
}

function extractGeneratedBlock(source, name) {
  const startMarker = `<!-- GENERATED:${name}:START -->`;
  const endMarker = `<!-- GENERATED:${name}:END -->`;
  if (countOccurrences(source, startMarker) !== 1 || countOccurrences(source, endMarker) !== 1) {
    throw new Error(`生成护栏区块 ${name} 必须且只能有一组 START/END marker`);
  }
  const start = source.indexOf(startMarker) + startMarker.length;
  const end = source.indexOf(endMarker, start);
  if (end < start) throw new Error(`生成护栏区块 ${name} marker 顺序非法`);
  const block = source.slice(start, end).trim();
  if (!block) throw new Error(`生成护栏区块 ${name} 不能为空`);
  return block;
}

export function extractFlowBlock(source, name) {
  const startMarker = marker(name, 'START');
  const endMarker = marker(name, 'END');
  if (countOccurrences(source, startMarker) !== 1 || countOccurrences(source, endMarker) !== 1) {
    throw new Error(`flow 区块 ${name} 必须且只能有一组 START/END marker`);
  }
  const start = source.indexOf(startMarker) + startMarker.length;
  const end = source.indexOf(endMarker, start);
  if (end < start) throw new Error(`flow 区块 ${name} marker 顺序非法`);
  const block = source.slice(start, end).trim();
  if (!block) throw new Error(`flow 区块 ${name} 不能为空`);
  return block;
}

function flowSource(flow) {
  return fs.readFileSync(definitionFor(flow).source, 'utf8');
}

export function flowBlockNames(flow) {
  const source = flowSource(flow);
  const names = [];
  for (const match of source.matchAll(/<!-- ALIPAY_AIPAY_FLOW:([A-Z_]+):START -->/gu)) {
    if (!names.includes(match[1])) names.push(match[1]);
  }
  for (const name of names) extractFlowBlock(source, name);
  return names;
}

function phaseName(flow, blockName) {
  const prefix = `${definitionFor(flow).prefix}_`;
  if (!blockName.startsWith(prefix)) throw new Error(`flow 区块前缀非法：${blockName}`);
  return blockName.slice(prefix.length).toLowerCase().replaceAll('_', '-');
}

function phaseBlockName(flow, phase) {
  return `${definitionFor(flow).prefix}_${phase.toUpperCase().replaceAll('-', '_')}`;
}

function declaredProducts(block) {
  const matches = [...block.matchAll(/<!-- ALIPAY_AIPAY_PRODUCTS:([a-z,]+) -->/gu)];
  if (matches.length > 1) throw new Error('每个 flow 阶段最多声明一次 ALIPAY_AIPAY_PRODUCTS');
  if (matches.length === 0) return null;
  const products = matches[0][1].split(',');
  if (products.some((product) => !productTypes.has(product))) throw new Error('flow 阶段产品声明非法');
  return new Set(products);
}

function filterProductSections(source, productType) {
  const sectionPattern = /<!-- ALIPAY_AIPAY_PRODUCT:([a-z,]+):START -->([\s\S]*?)<!-- ALIPAY_AIPAY_PRODUCT:END -->/gu;
  const filtered = source.replace(sectionPattern, (_, list, body) => {
    const products = list.split(',');
    if (products.some((product) => !productTypes.has(product))) throw new Error('flow 产品区块声明非法');
    return !productType || products.includes(productType) ? body.trim() : '';
  });
  if (/ALIPAY_AIPAY_PRODUCT:/u.test(filtered)) throw new Error('flow 产品区块 marker 不完整或发生嵌套');
  return filtered;
}

function cleanDirectives(block, productType, sharedGuard) {
  return filterProductSections(block, productType)
    .replace(/<!-- GENERATED:([A-Z0-9-]+):START -->([\s\S]*?)<!-- GENERATED:\1:END -->/gu,
      (_, name, body) => name !== sharedGuard && name.startsWith('ONBOARDING-GUARDS-') ? body.trim() : '')
    .replace(/<!-- ALIPAY_AIPAY_PRODUCTS:[a-z,]+ -->/gu, '')
    .replace(/<!-- ALIPAY_AIPAY_STAGE:[a-z0-9._-]+(?: products=[a-z,]+)? -->/gu, '')
    .trim();
}

export function flowPhaseNames(flow, { productType } = {}) {
  if (productType !== undefined && !productTypes.has(productType)) throw new Error('product-type 非法');
  const source = flowSource(flow);
  const coreName = `${definitionFor(flow).prefix}_CORE`;
  return flowBlockNames(flow)
    .filter((name) => name !== coreName && !name.includes('_FRAGMENT_'))
    .filter((name) => {
      const products = declaredProducts(extractFlowBlock(source, name));
      return !products || !productType || products.has(productType);
    })
    .map((name) => phaseName(flow, name));
}

export function loadFlowBundle(flow, phase, { productType } = {}) {
  if (productType !== undefined && !productTypes.has(productType)) throw new Error('product-type 非法');
  const definition = definitionFor(flow);
  const source = flowSource(flow);
  const blockName = phaseBlockName(flow, phase);
  if (!flowBlockNames(flow).includes(blockName) || blockName.includes('_FRAGMENT_')) {
    throw new Error(`${flow} phase 非法；允许值：${flowPhaseNames(flow, { productType }).join('、')}`);
  }
  const phaseBlock = extractFlowBlock(source, blockName);
  const products = declaredProducts(phaseBlock);
  if (products && productType && !products.has(productType)) {
    throw new Error(`${flow} ${phase} phase 不适用于 ${productType}`);
  }
  const loadsCore = (flow === 'integration' && phase === 'development')
    || (flow === 'onboarding' && phase === 'execute');
  const blocks = loadsCore
    ? [extractFlowBlock(source, `${definition.prefix}_CORE`), phaseBlock]
    : [phaseBlock];
  if (flow === 'integration' && phase === 'checklist') {
    if (!productType) throw new Error('integration checklist phase 缺少 product-type');
    blocks.push(`## 当前产品适用校验清单\n\n${checklistForProduct(productType).markdown}`);
  }
  return [
    `<!-- ALIPAY_AIPAY_REFERENCE_BUNDLE flow=${flow} phase=${phase}; 仅供内部执行，禁止对客 -->`,
    extractGeneratedBlock(source, definition.sharedGuard),
    productType && definition.productGuards?.[productType]
      ? extractGeneratedBlock(source, definition.productGuards[productType])
      : '',
    ...blocks.map((block) => cleanDirectives(block, productType, definition.sharedGuard)).filter(Boolean)
  ].filter(Boolean).join('\n\n');
}

function productFromRoute(route) {
  return route.match(/(?:^|_)(aipay|webpay|apppay)(?:_|$)/u)?.[1];
}

export function flowBundlesForRoute(route) {
  const productType = productFromRoute(route);
  let flows;
  if (route === 'full_process_first_wait') return [];
  if (route.startsWith('full_process_')) flows = ['integration', 'onboarding'];
  else if (route.startsWith('integration_')) flows = ['integration'];
  else if (route.startsWith('onboarding_')) flows = ['onboarding'];
  else throw new Error(`无法从 route 派生 flow：${route}`);
  if (route.endsWith('_first_wait')) flows = [flows[0]];
  return flows.flatMap((flow) => {
    const availablePhases = flowPhaseNames(flow, { productType });
    const phases = route.endsWith('_first_wait') ? [availablePhases[0]] : availablePhases;
    return phases.map((phase) => ({
      flow,
      phase,
      productType,
      source: loadFlowBundle(flow, phase, { productType })
    }));
  });
}

function parseOptions(argv) {
  const options = {};
  for (let index = 4; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`未知参数 ${token}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`参数 ${token} 缺少取值`);
    const name = token.slice(2);
    if (Object.prototype.hasOwnProperty.call(options, name)) throw new Error(`参数 ${token} 重复`);
    options[name] = value;
    index += 1;
  }
  return options;
}

export function runFlowCli(argv = process.argv) {
  const flow = argv[2];
  const phase = argv[3];
  if (!flow || !phase) throw new Error('用法: flow_loader.mjs <integration|onboarding> <phase> [阶段参数]');
  const options = parseOptions(argv);
  const productType = options['product-type'];
  if (flow === 'integration' && phase === 'checklist') {
    const projectPath = options['project-path'];
    if (!projectPath) throw new Error('integration checklist phase 缺少 --project-path');
    if (!productType) throw new Error('integration checklist phase 缺少 --product-type');
    process.stderr.write(`ALIPAY_AIPAY_INTERNAL:CHECKLIST_SCOPE_RECEIPT=${createChecklistScopeReceipt(productType, projectPath)}\n`);
  }
  const source = flowSource(flow);
  process.stdout.write(`${loadFlowBundle(flow, phase, { productType })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runFlowCli();
  } catch (error) {
    console.error(`FLOW_LOADER_ERROR:${error.message}`);
    process.exitCode = 1;
  }
}
