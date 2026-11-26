import path from 'node:path';
import {spawn as nativeSpawn,spawnSync as nativeSpawnSync} from 'node:child_process';
import {ensureReady,report,fail} from './preflight.mjs';

export function posix(p) {
  const value=p.replaceAll('\\','/');
  if(/^[a-zA-Z]:\//.test(value)) return '/'+value[0].toLowerCase()+value.slice(2);
  if(value.startsWith('//')) fail('UNC_PATH_NOT_IMPLEMENTED');
  return value;
}
export function shellArguments(script,args) {
  const a=[...args],base=path.win32.basename(script);
  const positions=base==='sandbox_config.sh'?[a[0]==='summary'?2:1]:
    base==='upload_screenshots.sh'?[2,3,4]:
    base==='project_inspector.sh'?(a[0]==='prepare-new'?[1]:a[0]==='scan'?[2]:[]):[];
  for(const i of positions) if(a[i])a[i]=posix(a[i]);
  const flags=new Set(['--project-path','--config-path','--file','--home-img','--shop-img','--pay-img','--key-file']);
  for(let i=0;i<a.length-1;i++)if(flags.has(a[i]))a[i+1]=posix(a[++i]);
  return [posix(script),...a];
}
function invocation(command,args,options) {
  if(command!=='bash') return {command,args,options};
  const c=ensureReady();
  // The caller's business environment wins except adapter-owned execution values.
  const env={...c.env,...(options.env||{})};
  for(const k of ['PATH','TEMP','TMP','TMPDIR','NODE_BINARY','MSYS_NO_PATHCONV','MSYS2_ARG_CONV_EXCL'])env[k]=c.env[k];
  for(const k of Object.keys(c.env))if(k.startsWith('ALIPAY_WINDOWS_'))env[k]=c.env[k];
  for(const k of Object.keys(env))if(k.toLowerCase()==='path'&&k!=='PATH')delete env[k];
  delete env.BASH_ENV;delete env.ENV;
  const mapped=shellArguments(args[0],args.slice(1));
  if(mapped.reduce((n,s)=>n+String(s).length+3,0)>28000)fail('COMMAND_LINE_TOO_LONG');
  return {command:c.bash,args:['--noprofile','--norc',...mapped],options:{...options,env,shell:false,windowsHide:true,maxBuffer:options.maxBuffer||16*1024*1024}};
}
export function nativeSandboxMarkers(stderr) {
  return String(stderr || '').replace(/^(ALIPAY_AIPAY_INTERNAL:SANDBOX_(?:CONFIG|PENDING)_PATH=)\/([a-zA-Z])\/(.*)$/gm,
    (_, prefix, drive, rest) => `${prefix}${drive.toUpperCase()}:/${rest}`);
}

export function spawnSync(command,args,options={}) {
  const i=invocation(command,args,options);
  const r=nativeSpawnSync(i.command,i.args,i.options);
  if(command === 'bash' && path.win32.basename(args[0]) === 'sandbox_config.sh' && typeof r.stderr === 'string') {
    r.stderr = nativeSandboxMarkers(r.stderr);
  }
  if(r.error) { report({reason:r.error.code==='ETIMEDOUT'?'EXECUTION_TIMEOUT':'EXECUTION_FAILED'}); }
  return r;
}
export function spawn(command,args,options={}) {
  const i=invocation(command,args,options);
  return nativeSpawn(i.command,i.args,i.options);
}
