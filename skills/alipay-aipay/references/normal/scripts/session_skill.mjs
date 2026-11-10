// Windows install fallback. Code-only copies live outside Agent discovery roots;
// no global install record, credentials, telemetry or business state is copied.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';

const receiptName = '.session-skill.json';
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z.-]+)?$/u;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function sessionSkillRoot(home = os.homedir()) {
  return path.join(fs.realpathSync(home), '.alipay-aipay', 'session-skills');
}
function plain(file, directory = false) {
  const s = fs.lstatSync(file);
  if (s.isSymbolicLink() || !(directory ? s.isDirectory() : s.isFile())) throw Error('Unsafe session Skill path');
}
function privateRoot(home) {
  const root = sessionSkillRoot(home);
  for (const dir of [path.dirname(root), root]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, {mode:0o700});
    plain(dir, true);
  }
  return root;
}
function filesUnder(root) {
  const files = {};
  const walk = relative => {
    const file = path.join(root, relative);
    const s = fs.lstatSync(file);
    if (s.isSymbolicLink()) throw Error('Symlinks are not allowed in session Skills');
    if (s.isDirectory()) {
      for (const name of fs.readdirSync(file).sort()) walk(relative ? relative+'/'+name : name);
    } else if (s.isFile()) files[relative] = digest(fs.readFileSync(file));
    else throw Error('Non-regular session Skill file');
  };
  for (const entry of ['SKILL.md','VERSION','references']) walk(entry);
  if (fs.existsSync(path.join(root,'PROFILE'))) walk('PROFILE');
  return files;
}
function identity(root, channel, version) {
  if (!['stable','pre'].includes(channel) || !semver.test(version)) throw Error('Invalid session Skill identity');
  for (const name of ['SKILL.md','VERSION','references/runtime-entry.md','references/normal/scripts/runtime.mjs',
    'references/normal/scripts/self_update.mjs','references/normal/scripts/session_skill.mjs','references/normal/json/release-channel.json']) plain(path.join(root,name));
  if (channel==='pre') plain(path.join(root,'references/normal/scripts/preview_runtime.mjs'));
  if (fs.readFileSync(path.join(root,'VERSION'),'utf8').trim() !== version ||
      JSON.parse(fs.readFileSync(path.join(root,'references/normal/json/release-channel.json'),'utf8')).channel !== channel ||
      fs.readFileSync(path.join(root,'SKILL.md'),'utf8').match(/^name:\s*(\S+)\s*$/m)?.[1] !==
        (channel==='pre'?'alipay-aipay-pre':'alipay-aipay')) throw Error('Session Skill identity mismatch');
}

export function createSessionSkill({sourceDir, channel, version, packageVersion, targetDir, profileContent, home = os.homedir()}) {
  identity(sourceDir, channel, version);
  if (!semver.test(packageVersion) || !path.isAbsolute(targetDir)) throw Error('Invalid session install source');
  const root = privateRoot(home);
  const skillDir = path.join(root, `${channel}-${version}-${randomUUID()}`);
  fs.mkdirSync(skillDir, {mode:0o700});
  try {
    for (const entry of ['SKILL.md','VERSION','references']) fs.cpSync(path.join(sourceDir,entry),path.join(skillDir,entry),{recursive:true,errorOnExist:true,force:false});
    const selectedProfile = profileContent === undefined ? readProfile(targetDir) : profileContent;
    if (selectedProfile !== null && selectedProfile !== undefined) {
      if (!(Buffer.isBuffer(selectedProfile) || selectedProfile instanceof Uint8Array) || selectedProfile.length > 64 * 1024) throw Error('Invalid PROFILE content');
      fs.writeFileSync(path.join(skillDir,'PROFILE'),selectedProfile,{flag:'wx',mode:0o600});
    }
    const manifest = filesUnder(skillDir);
    const receipt = {schemaVersion:1, scope:'session', channel, version, packageVersion,
      skillDir:fs.realpathSync(skillDir), targetDir:path.resolve(targetDir)};
    fs.writeFileSync(path.join(skillDir,receiptName),JSON.stringify({...receipt,manifest}),{flag:'wx',mode:0o600});
    verifySessionSkill(receipt,{home,channel,version,packageVersion,targetDir});
    return receipt;
  } catch (error) {
    fs.rmSync(skillDir,{recursive:true,force:true});
    throw error;
  }
}

function readProfile(skillDir) {
  const file=path.join(skillDir,'PROFILE');
  if (!fs.existsSync(file)) return null;
  plain(file);
  const stat=fs.lstatSync(file);
  if (stat.size > 64 * 1024) throw Error('PROFILE is too large');
  return fs.readFileSync(file);
}

export function verifySessionSkill(receipt, {home = os.homedir(), channel, version, packageVersion, targetDir} = {}) {
  if (!receipt || receipt.schemaVersion!==1 || receipt.scope!=='session' || !['stable','pre'].includes(receipt.channel) || !semver.test(receipt.version||'') || !path.isAbsolute(receipt.skillDir||'') ||
      !path.isAbsolute(receipt.targetDir||'') || !semver.test(receipt.packageVersion||'')) throw Error('Invalid session receipt');
  const root=sessionSkillRoot(home), dir=receipt.skillDir;
  plain(path.dirname(root),true); plain(root,true); plain(dir,true);
  if (path.dirname(dir)!==root || fs.realpathSync(dir)!==dir ||
      !new RegExp(`^${receipt.channel}-[0-9A-Za-z.+-]+-[0-9a-f-]{36}$`,'u').test(path.basename(dir))) throw Error('Invalid session location');
  for (const [key,value] of Object.entries({channel,version,packageVersion,targetDir:targetDir && path.resolve(targetDir)})) {
    if (value!==undefined && receipt[key]!==value) throw Error('Session receipt context mismatch');
  }
  plain(path.join(dir,receiptName));
  const saved=JSON.parse(fs.readFileSync(path.join(dir,receiptName),'utf8'));
  for (const key of ['schemaVersion','scope','channel','version','packageVersion','skillDir','targetDir']) {
    if (saved[key]!==receipt[key]) throw Error('Session receipt mismatch');
  }
  identity(dir,receipt.channel,receipt.version);
  if (JSON.stringify(filesUnder(dir))!==JSON.stringify(saved.manifest)) throw Error('Session Skill content mismatch');
  return receipt;
}

export function readSessionSkill(skillDir, options = {}) {
  const file=path.join(skillDir,receiptName);
  if (!fs.existsSync(file)) return null;
  plain(file);
  const {manifest,...receipt}=JSON.parse(fs.readFileSync(file,'utf8'));
  if (receipt.skillDir!==fs.realpathSync(skillDir)) throw Error('Session root mismatch');
  return verifySessionSkill(receipt,options);
}
