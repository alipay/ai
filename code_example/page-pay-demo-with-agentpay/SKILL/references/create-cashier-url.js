#!/usr/bin/env node
'use strict';

const http = require('http');
const https = require('https');

const ALLOWED_ZODIAC_SIGNS = [
  '白羊座',
  '金牛座',
  '双子座',
  '巨蟹座',
  '狮子座',
  '处女座',
  '天秤座',
  '天蝎座',
  '射手座',
  '摩羯座',
  '水瓶座',
  '双鱼座',
];

function usage() {
  return [
    'Usage:',
    '  node references/create-cashier-url.js --endpoint http://localhost:3000/pay --zodiac 白羊座',
    '',
    `Allowed zodiac signs: ${ALLOWED_ZODIAC_SIGNS.join('、')}`,
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    endpoint: undefined,
    zodiac: undefined,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--endpoint') {
      options.endpoint = requiredValue(argv, ++i, arg);
    } else if (arg === '--zodiac' || arg === '--zodiac-sign') {
      options.zodiac = requiredValue(argv, ++i, arg).trim();
    } else {
      throw new Error(`未知参数: ${arg}`);
    }
  }

  if (!options.help && !options.endpoint) {
    throw new Error('必须传入 --endpoint');
  }
  if (!options.help && !ALLOWED_ZODIAC_SIGNS.includes(options.zodiac)) {
    throw new Error(`--zodiac 必须是以下值之一：${ALLOWED_ZODIAC_SIGNS.join('、')}`);
  }

  return options;
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} 需要一个参数值`);
  }
  return value;
}

function postForm(endpoint, zodiac) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint);
    const body = new URLSearchParams({ zodiac_sign: zodiac }).toString();
    const transport = url.protocol === 'https:' ? https : http;

    const req = transport.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks = [];
        res.setEncoding('utf8');
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const responseBody = chunks.join('');
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`下单接口返回 HTTP ${res.statusCode}: ${responseBody.slice(0, 500)}`));
            return;
          }
          resolve(responseBody);
        });
      }
    );

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#([0-9]+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function readAttribute(tag, name) {
  const quoted = new RegExp(`\\b${name}\\s*=\\s*(['"])(.*?)\\1`, 'i').exec(tag);
  if (quoted) {
    return decodeHtmlEntities(quoted[2]);
  }

  const unquoted = new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, 'i').exec(tag);
  return unquoted ? decodeHtmlEntities(unquoted[1]) : null;
}

function extractFormInputs(formHtml) {
  const inputs = [];
  const inputRegex = /<input\b[^>]*>/gi;
  let match;

  while ((match = inputRegex.exec(formHtml)) !== null) {
    const tag = match[0];
    const name = readAttribute(tag, 'name');
    if (!name) {
      continue;
    }
    inputs.push([name, readAttribute(tag, 'value') || '']);
  }

  return inputs;
}

function extractCashierUrl(formHtml) {
  const formMatch = /<form\b[^>]*>/i.exec(formHtml);
  if (!formMatch) {
    throw new Error('下单接口未返回支付宝表单');
  }

  const action = readAttribute(formMatch[0], 'action');
  if (!action) {
    throw new Error('无法从支付宝表单中提取 action URL');
  }

  const inputs = extractFormInputs(formHtml);
  if (inputs.length === 0) {
    throw new Error('无法从支付宝表单中提取隐藏字段');
  }

  const query = new URLSearchParams();
  for (const [name, value] of inputs) {
    query.append(name, value);
  }

  const separator = action.includes('?') ? '&' : '?';
  return {
    cashierUrl: `${action}${separator}${query.toString()}`,
    inputs,
  };
}

function extractOutTradeNo(inputs) {
  const bizContent = inputs.find(([name]) => name === 'biz_content');
  if (!bizContent) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(bizContent[1]);
    return parsed.out_trade_no;
  } catch {
    return undefined;
  }
}

function buildResultEndpoint(endpoint) {
  const url = new URL(endpoint);
  if (url.pathname.endsWith('/pay')) {
    url.pathname = `${url.pathname.slice(0, -4)}/fortune-result`;
  } else {
    url.pathname = '/fortune-result';
  }
  url.search = '';
  return url.toString();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const formHtml = await postForm(options.endpoint, options.zodiac);

  const { cashierUrl, inputs } = extractCashierUrl(formHtml);
  const output = {
    cashier_url: cashierUrl,
    zodiac_sign: options.zodiac,
    result_endpoint: buildResultEndpoint(options.endpoint),
  };
  const outTradeNo = extractOutTradeNo(inputs);
  if (outTradeNo) {
    output.out_trade_no = outTradeNo;
  }

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error && (error.stack || error.message) ? (error.stack || error.message) : String(error));
  process.exit(1);
});
