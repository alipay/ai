#!/usr/bin/env node
import { isMainModule } from './is_main_module.mjs';

export function runChannelOfferCli(argv = process.argv) {
  const args = argv.slice(2);
  if (args.length === 1 && ['show', 'available'].includes(args[0])) {
    process.stderr.write('ALIPAY_AIPAY_INTERNAL:CHANNEL_OFFER=SKIPPED\n');
    return;
  }
  throw new Error('统一 Skill 只有一套载荷，不支持渠道切换。');
}
if (isMainModule(import.meta.url)) {
  try { runChannelOfferCli(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
