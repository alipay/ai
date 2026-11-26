import { isMainModule } from '../is_main_module.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const directory = path.dirname(fileURLToPath(import.meta.url));
export function loadPolicy(dependency, read = fs.readFileSync) {
  try {
    const policy = JSON.parse(read(path.join(directory,'policy.json'),'utf8'));
    const asset = dependency === 'Git Bash' ? policy?.git : policy?.jq;
    if (!asset || typeof asset !== 'object' || typeof asset.url !== 'string' ||
      typeof asset.sha256 !== 'string' || (dependency === 'Git Bash' && typeof asset.version !== 'string')) {
      throw new Error('incomplete policy');
    }
    return policy;
  }
  catch { fail('POLICY_UNAVAILABLE',dependency); }
}
const slash = p => p.replaceAll('\\','/');
let invocationContext;
import {fail, run, checkWritable} from './host.mjs';
export {fail, run, checkWritable} from './host.mjs';
import {businessStateDirectory} from '../telemetry.mjs';
import {findGitBash} from './git-discovery.mjs';
import {requireWindowsX64Node} from './architecture.mjs';

export function stateRoot() {
  const root=path.join(process.env.LOCALAPPDATA || path.join(os.homedir(),'AppData/Local'),'alipay-aipay-new/windows');
  if(fs.existsSync(root)&&fs.lstatSync(root).isSymbolicLink()) fail('STORAGE_FAILED');
  fs.mkdirSync(root,{recursive:true}); return root;
}
// Match the existing environment policy: reuse a working jq; the managed
// installer is version-pinned only when jq is absent or unusable.
export function locateJq() {
  const systemPath=Object.entries(process.env).find(([k])=>k.toLowerCase()==='path')?.[1]||'';
  const candidates=[path.join(os.homedir(),'.local/bin/jq.exe'),
    ...systemPath.split(path.delimiter).filter(p=>path.isAbsolute(p)).map(p=>path.join(p,'jq.exe'))];
  return candidates.find(file=>fs.existsSync(file) &&
    run(file,['--version']).status===0 &&
    run(file,['-n','-e','--arg','value','ok','$value == "ok"']).status===0);
}
export function requireSupportedNode(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number);
  if (major < 18 || (major === 18 && minor < 17)) fail('DEPENDENCY_VERSION', 'Node');
}

export function locate() {
  if(process.platform!=='win32') fail('WINDOWS_ADAPTER_REQUIRES_WINDOWS');
  requireSupportedNode();
  requireWindowsX64Node();
  const foundGit=findGitBash();
  if(!foundGit) fail('DEPENDENCY_MISSING','Git Bash');
  const {bash,git,version:gitVersion}=foundGit;
  const bin=path.join(os.homedir(),'.local/bin');
  const cli=path.join(bin,'alipay-cli.exe'),jq=locateJq();
  if(!jq) fail('DEPENDENCY_MISSING','jq');
  if(!fs.existsSync(cli)) fail('DEPENDENCY_MISSING','alipay-cli');
  return executionContext({bash,git,gitVersion,cli,jq},process.env);
}

function executionContext(tools, sourceEnv, nativePath) {
  const {bash,git,cli,jq}=tools;
  const bin=path.join(os.homedir(),'.local/bin');
  const env={...sourceEnv};
  const oldPath=Object.entries(env).find(([k])=>k.toLowerCase()==='path')?.[1]||'';
  for(const k of Object.keys(env)) if(k.toLowerCase()==='path') delete env[k];
  env.PATH=nativePath || [path.join(directory,'bin'),path.dirname(bash),path.join(git,'usr/bin'),path.dirname(process.execPath),bin,oldPath].join(path.delimiter);
  delete env.ALIPAY_AIPAY_TEST_PLATFORM; delete env.ALIPAY_AIPAY_TEST_MODE;
  delete env.BASH_ENV; delete env.ENV; delete env.SHELLOPTS;
  env.MSYS_NO_PATHCONV='1';env.MSYS2_ARG_CONV_EXCL='*';
  env.ALIPAY_WINDOWS_CLI_RUNNER=slash(path.join(directory,'cli-process.mjs'));
  env.ALIPAY_WINDOWS_NODE=slash(process.execPath);
  env.ALIPAY_WINDOWS_JQ=slash(jq);
  env.ALIPAY_WINDOWS_CLI=slash(cli);
  env.ALIPAY_WINDOWS_CREDENTIALS_DIR=slash(path.join(os.homedir(),'.alipay-cli/credentials'));
  env.ALIPAY_WINDOWS_LOGS_DIR=slash(path.join(process.env.APPDATA||path.join(os.homedir(),'AppData/Roaming'),'alipay-cli/data/logs'));
  env.ALIPAY_WINDOWS_CLI_ENTRY=slash(path.join(directory,'bin/alipay-cli'));
  env.ALIPAY_WINDOWS_ACCESS_SCRIPT=slash(path.join(directory,'access-native.mjs'));
  env.NODE_BINARY='node';
  return {...tools,env};
}

// This snapshot is inherited only by children of a fully checked invocation.
// It contains execution paths, never login, consent, run or authorization facts.
export function snapshotExecutionContext(context) {
  const files=[context.bash,path.join(context.git,'cmd/git.exe'),
    path.join(context.git,'usr/bin/cygpath.exe'),context.cli,context.jq];
  return JSON.stringify({schemaVersion:1,ownerPid:process.pid,directory,node:process.execPath,
    tools:{bash:context.bash,git:context.git,gitVersion:context.gitVersion,cli:context.cli,jq:context.jq},
    nativePath:context.env.PATH,temporary:context.env.TEMP,
    businessStateDir:context.env.ALIPAY_AIPAY_BUSINESS_STATE_DIR,
    files:files.map(file=>{const stat=fs.statSync(file);return {file,size:stat.size,mtimeMs:stat.mtimeMs};})});
}

export function inheritedExecutionContext(env=process.env) {
  try {
    const snapshot=JSON.parse(env.ALIPAY_WINDOWS_EXECUTION_CONTEXT || 'null');
    if(snapshot?.schemaVersion!==1 || snapshot.directory!==directory || snapshot.node!==process.execPath ||
        !Number.isInteger(snapshot.ownerPid) || snapshot.ownerPid<=0 ||
        !['bash','git','cli','jq'].every(key=>typeof snapshot.tools?.[key]==='string') ||
        typeof snapshot.nativePath!=='string' || typeof snapshot.temporary!=='string' ||
        typeof snapshot.businessStateDir!=='string' || snapshot.files?.length!==5) return null;
    process.kill(snapshot.ownerPid,0);
    const expected=[snapshot.tools.bash,path.join(snapshot.tools.git,'cmd/git.exe'),
      path.join(snapshot.tools.git,'usr/bin/cygpath.exe'),snapshot.tools.cli,snapshot.tools.jq];
    if(!snapshot.files.every((saved,index)=>{
      if(saved.file!==expected[index]) return false;
      const stat=fs.statSync(saved.file);
      return stat.isFile() && stat.size===saved.size && stat.mtimeMs===saved.mtimeMs;
    })) return null;
    const temporary=fs.lstatSync(snapshot.temporary);
    if(!temporary.isDirectory() || temporary.isSymbolicLink()) return null;
    const context=executionContext(snapshot.tools,env,snapshot.nativePath);
    context.env=privateChildEnvironment({...context.env,
      ALIPAY_AIPAY_BUSINESS_STATE_DIR:env.ALIPAY_AIPAY_BUSINESS_STATE_DIR || snapshot.businessStateDir},snapshot.temporary);
    return context;
  } catch { return null; }
}
function writable(directoryPath) {
  if(!fs.existsSync(directoryPath)) fs.mkdirSync(directoryPath,{recursive:true});
  if(fs.lstatSync(directoryPath).isSymbolicLink()) fail('STORAGE_FAILED');
  const p=path.join(directoryPath,'.aipay-probe-'+crypto.randomUUID());
  try { fs.writeFileSync(p,'probe',{flag:'wx'});fs.renameSync(p,p+'.moved');fs.unlinkSync(p+'.moved'); }
  catch { fail('STORAGE_FAILED'); }
}
// Telemetry defaults live under the account's home, independently of scratch.
// Preserve explicit overrides without turning defaults into consent isolation.
export function privateChildEnvironment(env, temporary) {
  return {...env, ALIPAY_AIPAY_BUSINESS_STATE_DIR:businessStateDirectory(env),
    TEMP: temporary, TMP: temporary, TMPDIR: slash(temporary)};
}

export function inspectLocal(root) {
  const context=locate();
  const temporary=path.join(root,'tmp');fs.mkdirSync(temporary,{recursive:true});
  context.env = privateChildEnvironment(context.env, temporary);
  context.discovered={git:{executable:path.win32.join(context.git,'cmd/git.exe'),version:context.gitVersion}};
  for(const [exe,args,name] of [[context.cli,['version'],'alipay-cli'],[context.jq,['-n','-e','--arg','v','猫 $HOME "x"','$v == "猫 $HOME \\"x\\""'],'jq']]) {
    // jq round-trip is checked in the Bash probe below; this native check verifies launch/version.
    const r=run(exe,name==='jq'?['--version']:args,{env:context.env});
    if(r.status!==0||!r.stdout.trim()) fail('EXECUTION_FAILED',name);
    context.discovered[name==='alipay-cli'?'cli':name]={executable:exe,version:r.stdout.trim()};
  }
  const r=run(context.bash,['--noprofile','--norc',slash(path.join(directory,'probe.sh'))],{env:context.env});
  if(r.status!==0||r.stdout.trim()!=='WINDOWS_PROBE:READY') fail('SHELL_TRANSPORT_FAILED');
  writable(temporary);
  for(const tool of Object.values(context.discovered)) tool.verifiedAt=new Date().toISOString();
  return context;
}
export function checkCredentialsWritable() {
  const target=path.join(os.homedir(),'.alipay-cli/credentials');
  fs.mkdirSync(target,{recursive:true});
  checkWritable(target);
}
export function ensureReady({retry=false}={}) {
  if(!retry) {
    const env=invocationContext
      ? {...process.env,ALIPAY_WINDOWS_EXECUTION_CONTEXT:invocationContext.env.ALIPAY_WINDOWS_EXECUTION_CONTEXT}
      : process.env;
    const inherited=inheritedExecutionContext(env);
    if(inherited) return inherited;
  }
  const context=inspectLocal(stateRoot());
  context.env.ALIPAY_WINDOWS_EXECUTION_CONTEXT=snapshotExecutionContext(context);
  invocationContext=context;return context;
}
export function applyReady(options) {
  // Do not change the gateway's TEMP, telemetry switches or business context.
  return ensureReady(options);
}
export function resultError(error) {
  const needsSetup = error.reason === 'DEPENDENCY_MISSING' ||
    (error.reason === 'EXECUTION_FAILED' && error.dependency === 'alipay-cli');
  const reason=error.reason || error.code || 'CHECK_FAILED';
  const recovery=reason==='NO_COMPATIBLE_EXECUTION_MAPPING'?'USE_SUPPORTED_PLATFORM_OR_SITE':
    (reason==='DEPENDENCY_MISSING' && error.dependency==='curl')?'RESTORE_WINDOWS_CURL_THEN_RECHECK':
    needsSetup?'PREPARE_MISSING_DEPENDENCIES':
    reason==='DOWNLOAD_FAILED'?'RESTORE_NETWORK_THEN_REPAIR':
    ['INTEGRITY_FAILED','SIGNATURE_FAILED'].includes(reason)?'VERIFY_OFFICIAL_ASSET_BEFORE_REPAIR':
    reason==='USER_SCOPE_REQUIRED'?'USE_NON_ELEVATED_SESSION':
    reason==='PERMISSION_PROBE_FAILED'?'CHECK_WINDOWS_PERMISSION_PROBE_THEN_RECHECK':
    reason==='STORAGE_FAILED'?'REPAIR_LOCAL_ENVIRONMENT_THEN_RECHECK':
    'INSPECT_FAILURE_THEN_RECHECK';
  return {status:needsSetup?'NEEDS_SETUP':'BLOCKED',reason,dependency:error.dependency||'',recovery,validationCoverage:'NOT_VERIFIED'};
}
export function report(error) {
  const r=resultError(error);
  process.stderr.write('ALIPAY_AIPAY_INTERNAL:WINDOWS_ENV_RESULT='+JSON.stringify(r)+'\n');

}
if (isMainModule(import.meta.url)) {
  try {
    const c=ensureReady();
    if(process.argv[2]==='shell-env') {
      const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
      // Only explicit adapter-owned values. Business context and credentials never appear here.
      for(const k of ['PATH','TEMP','TMP','TMPDIR','ALIPAY_AIPAY_BUSINESS_STATE_DIR','ALIPAY_AIPAY_TELEMETRY_DIR','ALIPAY_AIPAY_NEW_TELEMETRY_DIR','ALIPAY_WINDOWS_EXECUTION_CONTEXT','ALIPAY_WINDOWS_NODE','ALIPAY_WINDOWS_JQ','ALIPAY_WINDOWS_CLI','ALIPAY_WINDOWS_CREDENTIALS_DIR','ALIPAY_WINDOWS_LOGS_DIR','ALIPAY_WINDOWS_CLI_ENTRY','ALIPAY_WINDOWS_CLI_RUNNER','ALIPAY_WINDOWS_ACCESS_SCRIPT','NODE_BINARY','MSYS_NO_PATHCONV','MSYS2_ARG_CONV_EXCL']) {
        const v=k==='PATH'?c.env[k].split(';').map(p=>slash(p).replace(/^([a-zA-Z]):/,(_,d)=>'/'+d.toLowerCase())).join(':'):c.env[k];
        if(v!==undefined) console.log('export '+k+'='+quote(v));
      }
    } else console.error('ALIPAY_AIPAY_INTERNAL:WINDOWS_ENV_RESULT='+JSON.stringify({status:'READY',validationCoverage:'NOT_VERIFIED'}));
  }catch(e){report(e);process.exitCode=78;}
}
