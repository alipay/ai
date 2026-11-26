import {fail} from './host.mjs';

export function requireWindowsX64Node({platform = process.platform, arch = process.arch} = {}) {
  if (platform !== 'win32') fail('WINDOWS_ADAPTER_REQUIRES_WINDOWS');
  if (arch !== 'x64') fail('NO_COMPATIBLE_EXECUTION_MAPPING', arch);
}
