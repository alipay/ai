#!/usr/bin/env node

const windowsEnvironmentRunner = process.platform === 'win32'
  ? (await import('./windows/prepare.mjs')).runEnvironment
  : null;

import { isMainModule } from './is_main_module.mjs';
import process from 'node:process';

import { checkCliEnvironment, isWindowsPlatform } from './platform_compat.mjs';

export function runAlipayCliEnvCli(argv = process.argv) {
  if (windowsEnvironmentRunner && !(argv[2] === 'integration-check' && ['LEGACY', 'CODE_ONLY'].includes(process.env.ALIPAY_AIPAY_WINDOWS_ROUTE))) {
    process.exitCode = windowsEnvironmentRunner(argv.slice(2));
    return;
  }

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

if (isMainModule(import.meta.url)) {
  runAlipayCliEnvCli();
}
