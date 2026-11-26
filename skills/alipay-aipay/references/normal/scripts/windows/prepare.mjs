import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {refreshWindowsCli} from './cli-install.mjs';
import {findGitBash} from './git-discovery.mjs';
import {findWinget} from './winget.mjs';
import {installGitOfficial} from './git-install.mjs';
import {powershell} from './host.mjs';
import {loadPolicy,run,stateRoot,ensureReady,locateJq,fail,report} from './preflight.mjs';
export function installGitWithWinget({env=process.env,execute=run,discover=findGitBash,beforeAttempt=()=>{}}={}) {
  const command=findWinget({env,execute});
  if(!command)fail('WINGET_UNAVAILABLE','Git Bash');
  beforeAttempt();
  const result=execute(command,['install','--id','Git.Git','--exact','--source','winget','--scope','user',
    '--silent','--disable-interactivity','--accept-package-agreements','--accept-source-agreements'],{env,timeout:0});
  if(result.error||result.status!==0||!discover({env}))fail('GIT_INSTALL_FAILED','Git Bash');
}
export function installAsset(name,asset,{bin=path.join(os.homedir(),'.local/bin'),
  curl=path.join(process.env.SystemRoot||'C:/Windows','System32/curl.exe'),execute=run}={}) {
  fs.mkdirSync(bin,{recursive:true});
  const target=path.join(bin,name+'.exe');
  const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
  const temporary=path.join(bin,name+'-'+crypto.randomUUID()+'.download');
  const backup=path.join(bin,name+'-'+crypto.randomUUID()+'.backup');
  let moved=false,committed=false;
  try {
    const r=execute(curl,['--compressed','--fail','--silent','--show-error','--location','--proto','=https','--proto-redir','=https','--connect-timeout','10','--output',temporary,asset.url],{timeout:0});
    if(r.status!==0)fail('DOWNLOAD_FAILED',name);
    if(hash(fs.readFileSync(temporary))!==asset.sha256)fail('INTEGRITY_FAILED',name);
    if(fs.existsSync(target)){fs.renameSync(target,backup);moved=true;}
    fs.renameSync(temporary,target);
    if(execute(target,name==='jq'?['--version']:['version']).status!==0)fail('EXECUTION_FAILED',name);
    committed=true;
  }catch(error){
    if(moved&&!committed){
      try {if(fs.existsSync(target))fs.unlinkSync(target);fs.renameSync(backup,target);moved=false;}
      catch {fail('INSTALL_ROLLBACK_FAILED',name);}
    }
    throw error;
  }finally{
    if(fs.existsSync(temporary))fs.unlinkSync(temporary);
    if(committed&&moved&&fs.existsSync(backup))fs.unlinkSync(backup);
  }
}
// Each call checks the installed tools and tries each missing dependency's
// official source once. The Skill bounds retries within the current loading.
export function prepareDependencies({authorized=false,root,
  gitReady=()=>findGitBash(),jqReady=()=>locateJq(),
  cliReady=()=>{const cli=path.join(os.homedir(),'.local/bin/alipay-cli.exe');return fs.existsSync(cli)&&run(cli,['version']).status===0;},
  installWinget=installGitWithWinget,installOfficial=installGitOfficial,
  prepareJq=()=>{const asset=loadPolicy('jq').jq;requireAssetDownloader();installAsset('jq',asset);},
  prepareCli=()=>{powershell();if(refreshWindowsCli()!=='READY')fail('CLI_INSTALL_FAILED','alipay-cli');}
}={}) {
  if(!authorized) fail('PREPARATION_AUTHORIZATION_REQUIRED');
  const missing=[];
  if(!gitReady())missing.push('Git Bash');
  if(!jqReady())missing.push('jq');
  if(!cliReady())missing.push('alipay-cli');
  process.stderr.write('ALIPAY_AIPAY_INTERNAL:WINDOWS_ENV_MISSING='+JSON.stringify(missing)+'\n');
  if(missing.includes('Git Bash')) {
    try {
      installWinget();
    } catch(error) {
      if(!['WINGET_UNAVAILABLE','GIT_INSTALL_FAILED'].includes(error.reason)) throw error;
      if(!gitReady()) installOfficial({root});
    }
    if(!gitReady()) fail('GIT_VERIFY_FAILED','Git Bash');
  }
  if(missing.includes('jq')) {
    prepareJq();
    if(!jqReady()) fail('EXECUTION_FAILED','jq');
  }
  if(missing.includes('alipay-cli')) {
    prepareCli();
    if(!cliReady()) fail('CLI_INSTALL_FAILED','alipay-cli');
  }
}
function requireAssetDownloader() {
  const curl=path.join(process.env.SystemRoot||'C:/Windows','System32/curl.exe');
  if(!fs.existsSync(curl))fail('DEPENDENCY_MISSING','curl');
}
export function prepare({authorized=false}={}) {
  if(!authorized) fail('PREPARATION_AUTHORIZATION_REQUIRED');
  const root=stateRoot();
  prepareDependencies({authorized,root});
  return ensureReady();
}
export function parseEnvironmentRequest(args, route=process.env.ALIPAY_AIPAY_WINDOWS_ROUTE) {
  const [mode,...rest]=args;
  const options={};
  for(let i=0;i<rest.length;i+=2) {
    if(!['--product-type','--authorized','--repair-confirmed','--root-intent'].includes(rest[i])||rest[i+1]===undefined||Object.hasOwn(options,rest[i]))fail('ENVIRONMENT_ARGUMENT_INVALID');
    options[rest[i]]=rest[i+1];
  }
  if(options['--product-type']&&!['aipay','webpay','apppay'].includes(options['--product-type']))fail('ENVIRONMENT_ARGUMENT_INVALID');
  for (const key of ['--authorized','--repair-confirmed']) {
    if (options[key] !== undefined && !['true','false'].includes(options[key])) fail('ENVIRONMENT_ARGUMENT_INVALID');
  }
  if (mode === 'retry' && options['--repair-confirmed'] !== 'true') fail('PREPARATION_AUTHORIZATION_REQUIRED');
  const recovering = mode === 'retry' || (mode === 'prepare' && (route==='BLOCKED' || options['--repair-confirmed'] === 'true'));
  if (recovering && (!['integration_only','onboarding_only','full_process'].includes(options['--root-intent']) ||
      route !== 'BLOCKED')) fail('ENVIRONMENT_ARGUMENT_INVALID');
  if (!recovering && options['--root-intent'] !== undefined) fail('ENVIRONMENT_ARGUMENT_INVALID');
  return {mode,options,recovering};
}
export function runEnvironment(args) {
  const {mode,options,recovering}=parseEnvironmentRequest(args);
  try {
    if(['prepare','prepare-jq'].includes(mode))prepare({authorized:options['--authorized']==='true'});
    else if(['check','integration-check','retry'].includes(mode))ensureReady({retry:mode==='retry'&&options['--repair-confirmed']==='true'});
    else fail('ENVIRONMENT_ARGUMENT_INVALID');
    console.log('CLI_ENV:READY');
    if (recovering) process.stderr.write('ALIPAY_AIPAY_INTERNAL:WINDOWS_ROUTE=' +
      JSON.stringify({rootIntent:options['--root-intent'],route:'READY'}) + '\n');
    return 0;
  }catch(e){report(e);return 78;}
}
