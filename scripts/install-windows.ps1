$ErrorActionPreference = 'Stop'
try {
    if ([Environment]::OSVersion.Platform -ne 'Win32NT') { throw 'This installer requires Windows.' }
    if (-not [Environment]::Is64BitOperatingSystem) { throw 'Windows x64 is required.' }
    Set-Location (Split-Path $PSScriptRoot -Parent)
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
        if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
            throw 'Install Node.js LTS (22.12 or later) from https://nodejs.org and run this file again.'
        }
        Write-Host 'Installing Node.js LTS using Windows Package Manager...'
        & winget.exe install --id OpenJS.NodeJS.LTS --exact --source winget --accept-source-agreements --accept-package-agreements
        if ($LASTEXITCODE -ne 0) { throw 'Node.js installation failed.' }
        $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    }
    $version = & node.exe -p 'process.versions.node'
    if ($LASTEXITCODE -ne 0 -or [version]$version -lt [version]'22.12.0') {
        throw 'Upgrade Node.js to the current LTS version at https://nodejs.org and retry.'
    }
    Remove-Item Env:ELECTRON_SKIP_BINARY_DOWNLOAD -ErrorAction SilentlyContinue
    Write-Host 'Installing locked dependencies (Internet required)...'
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    Write-Host 'Building the Windows x64 installer...'
    & npm.cmd run dist:win -- --publish never
    if ($LASTEXITCODE -ne 0) { throw 'Windows packaging failed. Please share the output above.' }
    $installer = Get-ChildItem -LiteralPath 'release' -Filter '*Setup*.exe' |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $installer) { throw 'Build finished but no NSIS installer was found.' }
    Write-Host ('Opening installation wizard: ' + $installer.FullName)
    $process = Start-Process -FilePath $installer.FullName -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw ('Installer exited with code ' + $process.ExitCode) }
    Write-Host 'Installation wizard completed. Open DevAtlas from the Start menu.'
} catch {
    Write-Host ('ERROR: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
