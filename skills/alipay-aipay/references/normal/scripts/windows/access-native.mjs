import {checkWritable} from './host.mjs';
try { if(process.argv.length!==3)throw new Error('Writable target required');checkWritable(process.argv[2]); }
catch(e){process.stderr.write('ALIPAY_AIPAY_INTERNAL:WINDOWS_STORAGE_ERROR='+(e.reason||'STORAGE_FAILED')+'\n');process.exitCode=78;}
