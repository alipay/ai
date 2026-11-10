param([ValidateSet('check', 'prepare', 'repair')][string]$Mode = 'check', [switch]$RequireNpm)

# The only pre-Node entry. No runtime/business dispatch, telemetry, elevation,
# ExecutionPolicy override, or persistent PATH change belongs in this script.
function Invoke-NodeProbe([string]$Executable) {
    if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { return $null }
    $process = New-Object System.Diagnostics.Process
    try {
        $process.StartInfo.FileName = $Executable
        $process.StartInfo.Arguments = '-p "JSON.stringify({version:process.versions.node,platform:process.platform,arch:process.arch,executable:process.execPath})"'
        $process.StartInfo.UseShellExecute = $false
        $process.StartInfo.CreateNoWindow = $true
        $process.StartInfo.RedirectStandardOutput = $true
        $process.StartInfo.RedirectStandardError = $true
        if (-not $process.Start()) { return $null }
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(5000)) { $process.Kill(); return $null }
        if ($process.ExitCode -ne 0) { return $null }
        $value = $stdout.Result | ConvertFrom-Json -ErrorAction Stop
        if ($value.platform -ne 'win32' -or $value.arch -ne 'x64' -or
            $value.version -notmatch '^([0-9]+)\.[0-9]+\.[0-9]+$' -or [int]$Matches[1] -lt 18 -or
            -not [IO.Path]::IsPathRooted($value.executable)) { return $null }
        if ($RequireNpm) {
            $bin = Split-Path -Parent $value.executable
            foreach ($tool in @('npm', 'npx')) {
                $entry = Join-Path $bin ('node_modules/npm/bin/' + $tool + '-cli.js')
                if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) { return $null }
                $probe = New-Object System.Diagnostics.Process
                try {
                    $probe.StartInfo.FileName = $value.executable
                    $probe.StartInfo.Arguments = '"' + $entry + '" --version'
                    $probe.StartInfo.UseShellExecute = $false
                    $probe.StartInfo.CreateNoWindow = $true
                    $probe.StartInfo.RedirectStandardOutput = $true
                    $probe.StartInfo.RedirectStandardError = $true
                    if (-not $probe.Start()) { return $null }
                    $out = $probe.StandardOutput.ReadToEndAsync()
                    $err = $probe.StandardError.ReadToEndAsync()
                    if (-not $probe.WaitForExit(5000)) { $probe.Kill(); return $null }
                    if ($probe.ExitCode -ne 0 -or $out.Result.Trim() -notmatch '^\d+\.\d+\.\d+') { return $null }
                } finally { $probe.Dispose() }
            }
        }
        return $value
    } catch { return $null } finally { $process.Dispose() }
}

function Find-LocalNode([string]$Root) {
    $candidates = @()
    $candidates += @(Get-Command node.exe -CommandType Application -All -ErrorAction SilentlyContinue | ForEach-Object { $_.Source })
    foreach ($directory in @($env:ProgramFiles, $env:LOCALAPPDATA)) {
        if ($directory) {
            $candidates += (Join-Path $directory 'nodejs/node.exe')
            $candidates += (Join-Path $directory 'Programs/nodejs/node.exe')
        }
    }
    if ($env:NVM_SYMLINK) { $candidates += (Join-Path $env:NVM_SYMLINK 'node.exe') }
    if (Test-Path -LiteralPath $Root -PathType Container) {
        $candidates += @(Get-ChildItem -LiteralPath $Root -Directory -Filter 'node-*' -ErrorAction SilentlyContinue |
            ForEach-Object { Get-ChildItem -LiteralPath $_.FullName -Directory -Filter 'node-v*-win-x64' -ErrorAction SilentlyContinue } |
            ForEach-Object { Join-Path $_.FullName 'node.exe' })
    }
    foreach ($candidate in @($candidates | Select-Object -Unique)) {
        $found = Invoke-NodeProbe $candidate
        if ($null -ne $found) { return $found }
    }
    return $null
}

function Receive-NodeFile([string]$Uri, [string]$Destination) {
    # URLs are constructed only from the official index and a validated version.
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $ProgressPreference = 'SilentlyContinue'
    for ($attempt = 0; $attempt -lt 2; $attempt++) {
        try {
            Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $Destination -TimeoutSec 30 -ErrorAction Stop | Out-Null
            return
        } catch {
            $network = $_.Exception -is [Net.WebException]
            $status = $_.Exception.Response.StatusCode
            $transient = ($network -and -not $status) -or ([int]$status -ge 500) -or ([int]$status -eq 429)
            if ($attempt -ge 1 -or -not $transient) { throw 'DOWNLOAD_FAILED' }
            Start-Sleep -Seconds 1
        }
    }
}

function Install-UserNode([string]$Root) {
    $staging = Join-Path $Root ('node-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $staging -ErrorAction Stop | Out-Null
    $complete = $false
    try {
        $indexFile = Join-Path $staging 'index.json'
        Receive-NodeFile 'https://nodejs.org/dist/index.json' $indexFile
        $releases = @(Get-Content -LiteralPath $indexFile -Raw | ConvertFrom-Json)
        $release = $releases | Where-Object {
            $_.lts -is [string] -and $_.lts.Length -gt 0 -and $_.version -match '^v[0-9]+\.[0-9]+\.[0-9]+$' -and
            [version]$_.version.Substring(1) -ge [version]'18.0.0' -and $_.files -contains 'win-x64-zip'
        } | Sort-Object { [version]$_.version.Substring(1) } -Descending | Select-Object -First 1
        if ($null -eq $release) { throw 'NO_LTS_ASSET' }
        $name = 'node-' + $release.version + '-win-x64'
        $zipName = $name + '.zip'
        $base = 'https://nodejs.org/dist/' + $release.version + '/'
        $checksums = Join-Path $staging 'SHASUMS256.txt'
        Receive-NodeFile ($base + 'SHASUMS256.txt') $checksums
        $pattern = '^([0-9a-fA-F]{64})\s+' + [regex]::Escape($zipName) + '$'
        $lines = @(Get-Content -LiteralPath $checksums | Where-Object { $_ -match $pattern })
        if ($lines.Count -ne 1 -or $lines[0] -notmatch $pattern) { throw 'INTEGRITY_FAILED' }
        $expected = $Matches[1]
        $archive = Join-Path $staging $zipName
        Receive-NodeFile ($base + $zipName) $archive
        if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ine $expected) { throw 'INTEGRITY_FAILED' }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [IO.Compression.ZipFile]::ExtractToDirectory($archive, $staging)
        $node = Invoke-NodeProbe (Join-Path $staging ($name + '/node.exe'))
        if ($null -eq $node -or $node.version -ne $release.version.Substring(1)) { throw 'VERIFY_FAILED' }
        Remove-Item -LiteralPath $indexFile, $checksums, $archive -Force
        $complete = $true
        return $node
    } finally {
        if (-not $complete) { Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue }
    }
}

function Invoke-NodeBootstrap([string]$Action, [string]$Root) {
    $found = Find-LocalNode $Root
    if ($null -ne $found) { return @{status='READY'; nodePath=$found.executable; version=$found.version} }
    if ($Action -eq 'check') { return @{status='NEEDS_SETUP'; reason='NODE_MISSING_OR_UNSUPPORTED'} }
    New-Item -ItemType Directory -Path $Root -Force -ErrorAction Stop | Out-Null
    if ((Get-Item -LiteralPath $Root).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'UNSAFE_DIRECTORY' }
    $lock = $null
    try {
        try { $lock = [IO.File]::Open((Join-Path $Root 'node.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
        catch { throw 'ENVIRONMENT_BUSY' }
        $stateFile = Join-Path $Root 'node-environment.json'
        $state = @{prepareAttempts=0; repairAttempts=0}
        if (Test-Path -LiteralPath $stateFile) {
            try {
                $loaded = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
                foreach ($key in @('prepareAttempts', 'repairAttempts')) {
                    if ($loaded.$key -isnot [int] -and $loaded.$key -isnot [long]) { throw 'invalid' }
                    if ($loaded.$key -lt 0) { throw 'invalid' }
                    $state[$key] = $loaded.$key
                }
            } catch { throw 'ENVIRONMENT_STATE_INVALID' }
        }
        if (($Action -eq 'repair' -and $state.repairAttempts -ge 1) -or
            ($Action -eq 'prepare' -and ($state.prepareAttempts -ge 1 -or $state.repairAttempts -ge 1))) { throw 'RETRY_BUDGET_EXHAUSTED' }
        $state.prepareAttempts++
        if ($Action -eq 'repair') { $state.repairAttempts++ }
        [IO.File]::WriteAllText($stateFile, ($state | ConvertTo-Json -Compress))
        $found = Install-UserNode $Root
        return @{status='READY'; nodePath=$found.executable; version=$found.version}
    } finally { if ($null -ne $lock) { $lock.Dispose() } }
}

if ($MyInvocation.InvocationName -ne '.') {
    $ErrorActionPreference = 'Stop'
    try {
        $localData = $env:LOCALAPPDATA
        if (-not $localData) { $localData = [Environment]::GetFolderPath('LocalApplicationData') }
        if (-not $localData -or -not [IO.Path]::IsPathRooted($localData)) { throw 'STORAGE_FAILED' }
        $result = Invoke-NodeBootstrap $Mode (Join-Path $localData 'alipay-aipay-pre/bootstrap')
    } catch {
        $reason = [string]$_.Exception.Message
        if ($reason -notmatch '^(DOWNLOAD_FAILED|NO_LTS_ASSET|INTEGRITY_FAILED|VERIFY_FAILED|UNSAFE_DIRECTORY|ENVIRONMENT_BUSY|ENVIRONMENT_STATE_INVALID|RETRY_BUDGET_EXHAUSTED|UNSUPPORTED_PLATFORM|ARCHITECTURE_CHECK_FAILED|STORAGE_FAILED)$') { $reason = 'SETUP_FAILED' }
        $result = @{status='BLOCKED'; reason=$reason}
    }
    [Console]::Error.WriteLine('ALIPAY_AIPAY_INTERNAL:NODE_BOOTSTRAP=' + ($result | ConvertTo-Json -Compress))
    if ($result.status -ne 'READY') { exit 78 }
}
