#!/usr/bin/env node
// One mutable metadata object. Every writer merges only explicitly supplied fields.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isMainModule } from './is_main_module.mjs';
import { acquireMetadataLock, releaseMetadataLock } from './metadata_lock.mjs';
export const MAX_PROFILE_BYTES = 64 * 1024;
export function validVersion(value) {
  return typeof value === 'string' && value.length <= 256 && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.test(value);
}
export function validAttribution(value) {
  return typeof value === 'string' && value.trim() === value && [...value].length >= 1 && [...value].length <= 128 && !/[\p{Cc}\p{Cs}]/u.test(value);
}
export function readProfile(skillDir) {
  const file = path.join(skillDir, 'PROFILE');
  let stat;
  try { stat = fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_PROFILE_BYTES) throw Error('PROFILE 必须是至多 64 KiB 的普通文件');
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('PROFILE 必须是 JSON 对象；请保留原文件并恢复后重试');
  return value;
}
export function readSkillVersion(skillDir) {
  const version = readProfile(skillDir).version;
  if (!validVersion(version)) throw Error('PROFILE.version 不是合法 Skill SemVer');
  return version;
}
export function mergeProfile(previous, updates) {
  const next = { ...previous };
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue;
    if (key === 'version' && !validVersion(value)) throw Error('非法 version');
    if (['chinfo', 'vid'].includes(key) && !validAttribution(value)) throw Error('非法 --' + key);
    next[key] = value;
  }
  if (Buffer.byteLength(JSON.stringify(next)) > MAX_PROFILE_BYTES) throw Error('PROFILE 内容过大');
  return next;
}
export function updateProfile(skillDir, updates) {
  const lock = acquireMetadataLock(skillDir);
  const tmp = path.join(skillDir, '.PROFILE.' + randomUUID() + '.tmp');
  try {
    const next = mergeProfile(readProfile(skillDir), updates);
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, path.join(skillDir, 'PROFILE'));
    return next;
  } finally {
    try { fs.rmSync(tmp, { force: true }); }
    finally { releaseMetadataLock(lock); }
  }
}
export function runProfileCli(argv = process.argv) {
  const [action, flag, dir, baseFlag, raw] = argv.slice(2);
  if (flag !== '--skill-dir' || !path.isAbsolute(dir || '')) return 1;
  if (action === 'read-version' && argv.length === 5) { process.stdout.write(readSkillVersion(dir)); return 0; }
  if (action === 'merge-biz-info' && baseFlag === '--base-json' && argv.length === 7) {
    const base = JSON.parse(raw);
    if (!base || typeof base !== 'object' || Array.isArray(base)) return 1;
    let profile = {};
    try { profile = readProfile(dir); } catch { /* Attribution is optional; never erase a valid base. */ }
    for (const key of ['chinfo', 'vid']) if (validAttribution(profile[key])) base[key] = profile[key];
    process.stdout.write(JSON.stringify(base)); return 0;
  }
  return 1;
}
if (isMainModule(import.meta.url)) {
  try { process.exitCode = runProfileCli(); } catch { process.exitCode = 1; }
}
