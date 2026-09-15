#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { isWindowsPlatform } from './platform_compat.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const allowedScript = path.resolve(scriptDir, '../../integration/modules/scripts/local_402_sandbox_pay.py');

function commandRuns(command, args) {
  const result = spawnSync(command, args, { stdio: 'ignore', shell: false });
  return result.status === 0;
}

function resolvePython() {
  const candidates = isWindowsPlatform()
    ? [
        { command: 'py', prefix: ['-3'] },
        { command: 'python', prefix: [] },
        { command: 'python3', prefix: [] }
      ]
    : [
        { command: 'python3', prefix: [] },
        { command: 'python', prefix: [] }
      ];
  return candidates.find(({ command, prefix }) => commandRuns(command, [...prefix, '--version'])) || null;
}

export function runPythonScriptCli(argv = process.argv) {
  const scriptInput = argv[2];
  if (!scriptInput) throw new Error('缺少 Python 脚本路径');
  const resolvedScript = path.resolve(scriptInput);
  if (resolvedScript !== allowedScript || !fs.existsSync(resolvedScript) || fs.lstatSync(resolvedScript).isSymbolicLink()) {
    throw new Error('只允许执行 Skill 内置的 AI 按量付费沙箱测试脚本');
  }

  const python = resolvePython();
  if (!python) throw new Error('未找到可用的 Python 3 运行时');
  const result = spawnSync(python.command, [...python.prefix, resolvedScript, ...argv.slice(3)], {
    stdio: 'inherit',
    shell: false
  });
  if (result.error) throw result.error;
  process.exitCode = Number.isInteger(result.status) ? result.status : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runPythonScriptCli();
  } catch (error) {
    console.error(`PYTHON_RUNNER_ERROR:${error.message}`);
    process.exitCode = 1;
  }
}
