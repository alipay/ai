#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const checklistPath = path.resolve(scriptDir, '../../integration/modules/checklist.md');
const productTypes = new Set(['aipay', 'webpay', 'apppay']);
const declarationPattern = /<!-- ALIPAY_AIPAY_CHECKLIST_PRODUCTS:([a-z,]+) -->\s*\n(## [^#\n].+)([\s\S]*?)(?=<!-- ALIPAY_AIPAY_CHECKLIST_PRODUCTS:|\s*$)/gu;

function checklistDeclarations(source) {
  const declarations = [];
  const declaredHeadings = new Set();
  for (const match of source.matchAll(declarationPattern)) {
    const products = match[1].split(',');
    const heading = match[2].slice(3).trim();
    if (products.some((product) => !productTypes.has(product)) || declaredHeadings.has(heading)) {
      throw new Error('checklist 产品声明非法或重复');
    }
    declaredHeadings.add(heading);
    declarations.push({
      products: new Set(products),
      heading,
      markdown: `${match[2]}${match[3]}`.trim()
    });
  }
  const allHeadings = [...source.matchAll(/^## ([^#].+)$/gmu)].map((match) => match[1]);
  if (allHeadings.length !== declarations.length || allHeadings.some((heading) => !declaredHeadings.has(heading))) {
    throw new Error('checklist 存在未声明产品范围的章节');
  }
  return declarations;
}

export function checklistForProduct(productType, source = fs.readFileSync(checklistPath, 'utf8')) {
  if (!productTypes.has(productType)) throw new Error('checklist product-type 非法');
  const applicable = checklistDeclarations(source).filter(({ products }) => products.has(productType));
  if (applicable.length === 0) throw new Error(`checklist 缺少 ${productType} 适用章节`);
  return {
    sections: applicable.map(({ heading }) => heading),
    markdown: applicable.map(({ markdown }) => markdown).join('\n\n')
  };
}
