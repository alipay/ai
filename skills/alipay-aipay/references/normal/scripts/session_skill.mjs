// Windows fallback stays outside Agent discovery roots and keeps attribution.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { payloadFiles, sameFiles, verifyIdentity, verifyInstalled } from './payload.mjs';
import { mergeProfile, readProfile, validVersion } from './profile.mjs';
const receiptName = '.session-skill.json';
export function sessionSkillRoot(home = os.homedir()) { return path.join(fs.realpathSync(home), '.alipay-aipay', 'session-skills'); }
function plain(file, directory = false) {
  const s = fs.lstatSync(file);
  if (s.isSymbolicLink() || !(directory ? s.isDirectory() : s.isFile())) throw Error('Unsafe session Skill path');
}
export function createSessionSkill({ sourceDir, channel = 'stable', version, packageVersion, targetDir, profileContent, legacyBridge = false, home = os.homedir() }) {
  if (channel !== 'stable' || !validVersion(packageVersion) || !path.isAbsolute(targetDir)) throw Error('Invalid session source');
  verifyIdentity(sourceDir, version);
  const root = sessionSkillRoot(home);
  for (const dir of [path.dirname(root), root]) { fs.mkdirSync(dir, { mode: 0o700, recursive: true }); plain(dir, true); }
  const skillDir = path.join(root, `stable-${version}-${randomUUID()}`);
  fs.mkdirSync(skillDir, { mode: 0o700 });
  try {
    for (const entry of ['SKILL.md', 'references']) fs.cpSync(path.join(sourceDir, entry), path.join(skillDir, entry), { recursive: true, errorOnExist: true, force: false });
    const prior = profileContent === undefined ? readProfile(targetDir) : JSON.parse(Buffer.from(profileContent).toString('utf8'));
    fs.writeFileSync(path.join(skillDir, 'PROFILE'), JSON.stringify(mergeProfile(prior, { version }), null, 2) + '\n', { mode: 0o600 });
    if (legacyBridge) fs.writeFileSync(path.join(skillDir, 'VERSION'), version + '\n', { mode: 0o600 });
    const receipt = { schemaVersion: legacyBridge ? 1 : 2, scope: 'session', channel: 'stable', version, packageVersion,
      skillDir: fs.realpathSync(skillDir), targetDir: path.resolve(targetDir) };
    const manifest = payloadFiles(skillDir, { legacy: legacyBridge });
    fs.writeFileSync(path.join(skillDir, receiptName), JSON.stringify({ ...receipt, manifest }), { flag: 'wx', mode: 0o600 });
    verifySessionSkill(receipt, { home, version, packageVersion, targetDir });
    return receipt;
  } catch (error) { fs.rmSync(skillDir, { recursive: true, force: true }); throw error; }
}
export function verifySessionSkill(receipt, { home = os.homedir(), channel, version, packageVersion, targetDir } = {}) {
  if (!receipt || ![1, 2].includes(receipt.schemaVersion) || receipt.scope !== 'session' || receipt.channel !== 'stable' || !validVersion(receipt.version) || !validVersion(receipt.packageVersion)
    || !path.isAbsolute(receipt.skillDir || '') || !path.isAbsolute(receipt.targetDir || '')) throw Error('Invalid session receipt');
  const root = sessionSkillRoot(home), dir = receipt.skillDir;
  plain(path.dirname(root), true); plain(root, true); plain(dir, true);
  if (path.dirname(dir) !== root || fs.realpathSync(dir) !== dir || !/^stable-[0-9A-Za-z.+-]+-[0-9a-f-]{36}$/u.test(path.basename(dir))) throw Error('Invalid session location');
  for (const [key, value] of Object.entries({ channel, version, packageVersion, targetDir: targetDir && path.resolve(targetDir) })) if (value !== undefined && receipt[key] !== value) throw Error('Session context mismatch');
  plain(path.join(dir, receiptName));
  const saved = JSON.parse(fs.readFileSync(path.join(dir, receiptName), 'utf8'));
  for (const key of ['schemaVersion', 'scope', 'channel', 'version', 'packageVersion', 'skillDir', 'targetDir']) if (saved[key] !== receipt[key]) throw Error('Session receipt mismatch');
  verifyIdentity(dir, receipt.version);
  if (!sameFiles(payloadFiles(dir, { legacy: receipt.schemaVersion === 1 }), saved.manifest)) throw Error('Session content mismatch');
  if (receipt.schemaVersion === 1 && fs.readFileSync(path.join(dir, 'VERSION'), 'utf8').trim() !== receipt.version) throw Error('Legacy version mismatch');
  return receipt;
}
export function readSessionSkill(skillDir, options = {}) {
  const file = path.join(skillDir, receiptName);
  if (!fs.existsSync(file)) return null;
  plain(file);
  const { manifest, ...receipt } = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (receipt.skillDir !== fs.realpathSync(skillDir)) throw Error('Session root mismatch');
  return verifySessionSkill(receipt, options);
}
export function finalizeLegacyMetadata(skillDir, options = {}) {
  const file = path.join(skillDir, 'VERSION');
  if (!fs.existsSync(file)) return;
  plain(file);
  const version = verifyInstalled(skillDir);
  if (fs.readFileSync(file, 'utf8').trim() !== version) throw Error('过渡 VERSION 与 PROFILE 不一致；保留文件并停止版本迁移');
  const receipt = readSessionSkill(skillDir, options);
  if (receipt?.schemaVersion === 1) {
    const updated = { ...receipt, schemaVersion: 2, manifest: payloadFiles(skillDir) };
    const tmp = path.join(skillDir, receiptName + '.' + randomUUID() + '.tmp');
    fs.writeFileSync(tmp, JSON.stringify(updated), { flag: 'wx', mode: 0o600 });
    fs.renameSync(tmp, path.join(skillDir, receiptName));
    verifySessionSkill({ ...receipt, schemaVersion: 2 }, options);
  }
  fs.unlinkSync(file);
}
