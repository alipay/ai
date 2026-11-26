import {spawnSync} from 'node:child_process';
import {ensureReady} from './preflight.mjs';
try {
  const {cli,env}=ensureReady();
  const args=process.argv.slice(2);
  if(args[0]==='file'&&args[1]==='upload'&&/^\/[a-zA-Z]\//.test(args[2]||''))args[2]=args[2][1]+':'+args[2].slice(2);
  if(args.reduce((n,a)=>n+a.length+3,0)>28000)throw new Error('COMMAND_LINE_TOO_LONG');
  const r=spawnSync(cli,args,{env,stdio:'inherit',windowsHide:true,shell:false});
  if(r.error)process.stderr.write('ALIPAY_AIPAY_INTERNAL:WINDOWS_CLI_ERROR='+r.error.code+'; result may be unknown; do not replay writes\n');
  process.exitCode=r.status??124;
}catch(e){process.stderr.write('ALIPAY_AIPAY_INTERNAL:WINDOWS_CLI_ERROR='+e.message+'\n');process.exitCode=78;}
