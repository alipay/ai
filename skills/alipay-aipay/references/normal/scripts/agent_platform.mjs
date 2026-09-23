import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_PLATFORM_LENGTH = 40;
const ASCII_PLATFORM_RE = /^[a-z0-9.]{1,40}$/u;

export function normalizeAgentPlatform(value) {
  const normalizedInput = String(value || '').normalize('NFKC');
  if (/\p{C}/u.test(normalizedInput)) return 'unknown';
  const raw = normalizedInput.trim();
  if (!raw || [...raw].length > MAX_PLATFORM_LENGTH || /[\\/:@?#%]/u.test(raw)) return 'unknown';

  const normalized = raw.toLowerCase().replace(/[_\s-]/gu, '');
  if (normalized === 'claude') return 'claudecode';
  if (ASCII_PLATFORM_RE.test(normalized)) return normalized;
  return /[\p{L}\p{M}\p{N}]/u.test(raw) ? raw : 'unknown';
}

// Consume host context before dispatch so Node runners and Shell children share it.
export function applyAgentPlatform(args, env = process.env) {
  const remaining = [];
  let supplied = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== '--agent-platform') {
      remaining.push(args[index]);
      continue;
    }
    if (supplied) throw new Error('duplicate --agent-platform');
    const value = args[++index];
    if (value === undefined || value.startsWith('--')) throw new Error('missing --agent-platform value');
    supplied = true;
    env.ALIPAY_AIPAY_AGENT_PLATFORM = normalizeAgentPlatform(value);
  }
  return remaining;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.argv[2] !== 'normalize' || process.argv.length !== 4) {
    process.exitCode = 2;
  } else {
    process.stdout.write(normalizeAgentPlatform(process.argv[3]));
  }
}
