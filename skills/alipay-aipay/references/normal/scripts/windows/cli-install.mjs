import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';

export const installCommand = String.raw`
$ErrorActionPreference = 'Stop'
$env:ALIPAY_CLI_BIN = "$HOME\.local\bin"
$env:ALIPAY_CLI_SKIP_VERIFY = 'true'
try {
  Invoke-RestMethod -UseBasicParsing -Uri 'https://opengw.alipay.com/alipaycli/install_ps1' -TimeoutSec 20 -ErrorAction Stop | Invoke-Expression
  if ($null -ne $global:LASTEXITCODE -and $global:LASTEXITCODE -ne 0) { exit 1 }
} catch {
  $code = $_.Exception.Data['InstallerExitCode']
  if ($code -in @(3, 4, 5)) { exit ([int]$code) }
  if ($_.Exception -is [System.Net.WebException]) { exit 3 }
  if ($_.Exception -is [System.UnauthorizedAccessException]) { exit 4 }
  exit 1
}
`;

export function refreshWindowsCli({env = process.env, home = os.homedir(), run = spawnSync} = {}) {
  const childEnv = {...env};
  // Keep business context and installer overrides out of the official install.
  for (const key of Object.keys(childEnv)) {
    if (['PLATFORM', 'PLATFORM_ID', 'PRODUCT', 'ALIPAYCLI_BIZ_INFO', 'PSMODULEPATH',
      'ALIPAY_CLI_BIN', 'ALIPAY_CLI_SKIP_VERIFY', 'ALIPAY_CLI_VERSION',
      'ALIPAY_CLI_CHANNEL', 'ALIPAY_CLI_MANIFEST_URL',
      'ALIPAY_CLI_AFTS_MANIFEST_BASE'].includes(key.toUpperCase())) delete childEnv[key];
  }
  const command = path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const options = {env: childEnv, encoding: 'utf8', shell: false, windowsHide: true,
    maxBuffer: 30 * 1024 * 1024};
  try {
    const result = run(command, ['-NoProfile', '-NonInteractive', '-Command', installCommand], options);
    const output = `${result.stdout || ''}\n${result.stderr || ''}\n${result.error?.message || ''}`;
    if (result.error || result.status !== 0) {
      if (result.status === 3) return 'RETRY_WITH_NETWORK';
      if (result.status === 4) return 'RETRY_WITH_LOCAL_FS_PERMISSION';
      if (result.status === 5) return 'VERIFY_FAILED';
      if (result.error?.code === 'ETIMEDOUT' ||
          /could not resolve|failed to connect|connection (?:refused|reset)|timed? out|timeout|network|socket|tls|ssl|ENOTFOUND|ECONNREFUSED|EAI_AGAIN/iu.test(output)) return 'RETRY_WITH_NETWORK';
      if (/permission denied|operation not permitted|EACCES|EPERM|access denied/iu.test(output)) return 'RETRY_WITH_LOCAL_FS_PERMISSION';
      return 'FAILED';
    }
    const verify = run(path.join(home, '.local', 'bin', 'alipay-cli.exe'), ['version'],
      {...options, stdio: 'ignore', timeout: 5000});
    return !verify.error && verify.status === 0 ? 'READY' : 'VERIFY_FAILED';
  } catch {
    return 'FAILED';
  }
}
