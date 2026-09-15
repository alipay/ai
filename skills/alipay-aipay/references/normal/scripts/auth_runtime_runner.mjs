#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import process from 'node:process';

const internalPrefix = 'ALIPAY_AIPAY_INTERNAL:';
const autoMismatchFlows = new Set(['SCOPE_MISMATCH', 'MCC_MISMATCH']);

function runAuthScript(script, cwd, args, stdio) {
  const result = spawnSync('bash', [script, ...args], {
    cwd,
    env: process.env,
    encoding: stdio === 'pipe' ? 'utf8' : undefined,
    stdio,
    shell: false
  });
  if (result.error) throw result.error;
  return result;
}

function authFlowValues(stderr) {
  const prefix = `${internalPrefix}AUTH_FLOW:`;
  return String(stderr || '')
    .split(/\r?\n/u)
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length));
}

function withoutIntermediateFlow(stderr, flow) {
  const marker = `${internalPrefix}AUTH_FLOW:${flow}`;
  const source = String(stderr || '');
  return source.split(/\r?\n/u).filter((line) => line !== marker).join('\n');
}

export function runAuthRuntime(script, cwd, args) {
  if (args[0] !== 'init') {
    const result = runAuthScript(script, cwd, args, 'inherit');
    return Number.isInteger(result.status) ? result.status : 1;
  }

  const initial = runAuthScript(script, cwd, args, 'pipe');
  const initialStatus = Number.isInteger(initial.status) ? initial.status : 1;
  const flows = authFlowValues(initial.stderr);
  const flow = flows.length === 1 ? flows[0] : '';
  const canAutoRecover = initialStatus === 1
    && initial.signal === null
    && autoMismatchFlows.has(flow)
    && String(initial.stdout || '').trim() === '';

  if (!canAutoRecover) {
    process.stdout.write(initial.stdout || '');
    process.stderr.write(initial.stderr || '');
    return initialStatus;
  }

  process.stderr.write(withoutIntermediateFlow(initial.stderr, flow));
  process.stderr.write(`${internalPrefix}AUTH_AUTO_MISMATCH=${flow}\n`);
  const recovered = runAuthScript(script, cwd, ['mismatch', ...args.slice(1)], 'inherit');
  return Number.isInteger(recovered.status) ? recovered.status : 1;
}
