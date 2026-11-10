#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const maxProfileBytes = 64 * 1024;
const validProfileValue = value => typeof value === 'string' && value.trim() === value
  && [...value].length >= 1 && [...value].length <= 128 && !/[\p{Cc}\p{Cs}]/u.test(value);

function readProfileFields(skillDir) {
  try {
    if (typeof skillDir !== 'string' || !path.isAbsolute(skillDir)) return {};
    const file = path.join(skillDir, 'PROFILE');
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxProfileBytes) return {};
    const profile = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!profile || Array.isArray(profile) || profile.schemaVersion !== 1) return {};
    return {
      chinfo: validProfileValue(profile.chinfo) ? profile.chinfo : '',
      vid: validProfileValue(profile.vid) ? profile.vid : '',
    };
  } catch {
    return {};
  }
}

export function readProfileChinfo(skillDir) { return readProfileFields(skillDir).chinfo || ''; }
export function readProfileVid(skillDir) { return readProfileFields(skillDir).vid || ''; }

export function runProfileCli(argv = process.argv) {
  if (argv.length === 5 && argv[2] === 'read-chinfo' && argv[3] === '--skill-dir') {
    process.stdout.write(readProfileChinfo(argv[4]));
    return 0;
  }
  if (argv.length === 7 && argv[2] === 'merge-biz-info' && argv[3] === '--skill-dir' && argv[5] === '--base-json') {
    try {
      const base = JSON.parse(argv[6]);
      if (!base || Array.isArray(base) || typeof base !== 'object') return 1;
      const fields = readProfileFields(argv[4]);
      if (fields.chinfo) base.chinfo = fields.chinfo;
      if (fields.vid) base.vid = fields.vid;
      process.stdout.write(JSON.stringify(base));
      return 0;
    } catch { return 1; }
  }
  return 1;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = runProfileCli();
}
