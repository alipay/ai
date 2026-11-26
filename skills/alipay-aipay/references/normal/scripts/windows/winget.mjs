import path from 'node:path';
import {run} from './host.mjs';

// App execution aliases can be runnable even when fs.existsSync returns false.
// Probe only; installing remains the caller's authorized, bounded operation.
export function findWinget({env=process.env,execute=run}={}) {
  const alias=env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA,'Microsoft/WindowsApps/winget.exe');
  for(const command of [...new Set([alias,'winget.exe'].filter(Boolean))]) {
    const result=execute(command,['--version'],{env,timeout:5000});
    if(!result.error && result.status===0) return command;
  }
  return null;
}
