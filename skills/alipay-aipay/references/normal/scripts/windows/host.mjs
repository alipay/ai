import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';

export function fail(reason, dependency = '') { throw Object.assign(new Error(reason), {reason, dependency}); }
export function run(command,args,options={}) {
  return spawnSync(command,args,{encoding:'utf8',windowsHide:true,shell:false,timeout:15000,maxBuffer:4*1024*1024,...options});
}
export function powershell() {
  const root=process.env.SystemRoot || 'C:\\Windows';
  const command=path.join(root,'System32/WindowsPowerShell/v1.0/powershell.exe');
  if(!fs.existsSync(command)) fail('DEPENDENCY_MISSING','PowerShell');
  return command;
}
export function psEnv(env=process.env) {
  return Object.fromEntries(Object.entries(env).filter(([k])=>k.toLowerCase()!=='psmodulepath'));
}
export function checkWritable(target) {
  let stat;
  try { stat=fs.lstatSync(target); } catch { fail('STORAGE_FAILED','missing target'); }
  if(stat.isSymbolicLink()||path.resolve(target)===path.parse(target).root)fail('STORAGE_FAILED','unsafe target');
  if(stat.isDirectory()) {
    const probe=path.join(target,'.aipay-probe-'+crypto.randomUUID());
    try { fs.writeFileSync(probe,'',{flag:'wx'});fs.unlinkSync(probe); }
    catch { try { fs.unlinkSync(probe); } catch {} fail('STORAGE_FAILED','directory not writable'); }
  } else if(stat.isFile()) {
    try { fs.accessSync(target,fs.constants.W_OK); }
    catch { fail('STORAGE_FAILED','file not writable'); }
  } else fail('STORAGE_FAILED','unsupported target');
}
