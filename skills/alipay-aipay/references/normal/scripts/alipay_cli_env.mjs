#!/usr/bin/env node

import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkCliEnvironment, isWindowsPlatform } from './platform_compat.mjs';

export function runAlipayCliEnvCli(argv = process.argv) {
  const mode = argv[2];
  if (!['check', 'integration-check'].includes(mode) || argv.length !== 3) {
    console.error('用法: node alipay_cli_env.mjs <check|integration-check>');
    process.exitCode = 1;
    return;
  }

  const windows = isWindowsPlatform();
  const missing = checkCliEnvironment({
    requireJq: !windows,
    requireAlipayCli: !windows
  });

  if (missing.length === 0) {
    console.log('CLI_ENV:READY');
    return;
  }

  console.log('CLI_ENV:NEEDS_SETUP');
  console.log(`CLI_ENV_MISSING=${missing.join(',')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runAlipayCliEnvCli();
}
