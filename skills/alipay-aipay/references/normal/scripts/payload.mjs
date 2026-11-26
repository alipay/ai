// Code integrity is independent of mutable installation attribution.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readSkillVersion } from './profile.mjs';
export function payloadFiles(root, { legacy = false } = {}) {
  const files = {};
  const walk = relative => {
    const file = path.join(root, relative), stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw Error('Skill 载荷不允许符号链接');
    if (stat.isDirectory()) for (const name of fs.readdirSync(file).sort()) walk(relative + '/' + name);
    else if (stat.isFile()) files[relative] = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    else throw Error('Skill 载荷含非普通文件');
  };
  for (const entry of legacy ? ['SKILL.md', 'VERSION', 'references'] : ['SKILL.md', 'references']) walk(entry);
  if (legacy && fs.existsSync(path.join(root, 'PROFILE'))) walk('PROFILE');
  return files;
}
export function sameFiles(a, b) {
  return a && b && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => a[key] === b[key]);
}
export function verifyIdentity(root, version = readSkillVersion(root)) {
  if (readSkillVersion(root) !== version || fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8').match(/^name:\s*(\S+)\s*$/m)?.[1] !== 'alipay-aipay') throw Error('Skill 身份或版本不一致');
  for (const name of ['references/runtime-entry.md', 'references/normal/scripts/runtime.mjs']) {
    const stat = fs.lstatSync(path.join(root, name));
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Skill 入口不完整');
  }
  return version;
}
export function verifyInstalled(root) {
  const version = verifyIdentity(root);
  const file = path.join(root, '.skill-install.json');
  if (fs.existsSync(file)) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error('安装收据不是普通文件');
    const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (receipt.name !== '@alipay/alipay-aipay' || receipt.version !== version || !sameFiles(receipt.files, payloadFiles(root))) throw Error('安装载荷验证失败');
  }
  return version;
}
