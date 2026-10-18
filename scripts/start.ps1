param(
    [ValidateRange(1, 65535)][int]$Port = 8787,
    [switch]$NoBrowser,
    [string]$DataDir
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'server-state.ps1')
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$runtimeDir = Join-Path $projectRoot '.runtime'
$pythonExe = Join-Path $projectRoot '.venv\Scripts\python.exe'
$helperFile = Join-Path $PSScriptRoot 'run_server.py'
$indexFile = Join-Path $projectRoot 'frontend\dist\index.html'
if (!(Test-Path -LiteralPath $pythonExe) -or !(Test-Path -LiteralPath $indexFile)) {
    throw '缺少运行环境或页面构建，请先查看 README 中的安装步骤。'
}
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
$stateFile = Get-ClashStateFile -ProjectRoot $projectRoot -Port $Port
$baseUrl = "http://127.0.0.1:$Port"
$lock = $null
$envNames = @('CLASH_MODEL', 'CLASH_REASONING_EFFORT', 'CLASH_DATA_DIR', 'WHISPER_CACHE_DIR', 'WHISPER_MODEL', 'CLASH_ALLOWED_HOSTS', 'CODEX_BINARY')
$previousEnv = @{}
foreach ($name in $envNames) { $previousEnv[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
    try { $lock = [IO.File]::Open((Join-Path $runtimeDir "start-$Port.lock"), 'OpenOrCreate', 'ReadWrite', 'None') }
    catch { throw "另一个启动操作正在处理端口 $Port，请稍后重试。" }
    $health = Get-ClashHealth -BaseUrl $baseUrl
    if ($health -and $health.app -eq 'favorite-clash' -and $health.status -eq 'ok') {
        Write-Host "应用已运行：$baseUrl"
        if (!$NoBrowser) { Start-Process $baseUrl }
        return
    }
    if (Test-Path -LiteralPath $stateFile) {
        $record = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
        $owned = Get-ClashOwnedProcess -State $record -ProjectRoot $projectRoot -Port $Port
        if ($owned) { $owned.Dispose(); throw "已记录的实例仍在运行，但健康检查未通过。请查看端口 $Port 的日志，未启动重复实例。" }
    }
    if (!$DataDir) {
        if ($Port -ne 8787) { $DataDir = Join-Path $runtimeDir "data-$Port" }
        elseif ($previousEnv['CLASH_DATA_DIR']) { $DataDir = $previousEnv['CLASH_DATA_DIR'] }
        else { $DataDir = Join-Path $projectRoot 'data' }
    }
    $dataPath = [IO.Path]::GetFullPath($DataDir)
    if ($Port -ne 8787) {
        $productionPaths = @([IO.Path]::GetFullPath((Join-Path $projectRoot 'data')))
        $productionState = Get-ClashStateFile -ProjectRoot $projectRoot -Port 8787
        if (Test-Path -LiteralPath $productionState) {
            $production = Get-Content -LiteralPath $productionState -Raw | ConvertFrom-Json
            if ($production.data_dir) { $productionPaths += [IO.Path]::GetFullPath([string]$production.data_dir) }
        }
        foreach ($productionPath in $productionPaths) {
            if ($dataPath.TrimEnd('\', '/') -eq $productionPath.TrimEnd('\', '/')) { throw '备用端口必须使用独立数据目录，不能打开正式实例的数据。' }
        }
    }
    # Prefer the app-bundled CLI over an older global npm installation.
    # Explicit CODEX_BINARY supplied by the caller keeps precedence.
    if (!$previousEnv['CODEX_BINARY']) {
        $bundledRoot = Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin'
        if (Test-Path -LiteralPath $bundledRoot) {
            $bundled = Get-ChildItem -LiteralPath $bundledRoot -Directory |
                ForEach-Object { Get-Item -LiteralPath (Join-Path $_.FullName 'codex.exe') -ErrorAction SilentlyContinue } |
                Sort-Object LastWriteTime -Descending | Select-Object -First 1
            if ($bundled) { $env:CODEX_BINARY = $bundled.FullName }
        }
    }
    $env:CLASH_DATA_DIR = $dataPath
    $env:CLASH_MODEL = 'gpt-6.1-sol'
    $env:CLASH_REASONING_EFFORT = 'high'
    $env:WHISPER_CACHE_DIR = Join-Path $projectRoot '.cache\whisper-models'
    $smallModel = Get-ChildItem -LiteralPath (Join-Path $env:WHISPER_CACHE_DIR 'models--Systran--faster-whisper-small\snapshots') -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'model.bin') } | Select-Object -First 1
    if ($smallModel) { $env:WHISPER_MODEL = $smallModel.FullName }
    $remoteConfig = Join-Path $runtimeDir 'remote.json'
    if (Test-Path -LiteralPath $remoteConfig) {
        $remote = Get-Content -LiteralPath $remoteConfig -Raw | ConvertFrom-Json
        if ($remote.hostname -match '^[a-z0-9.-]+\.ts\.net$') { $env:CLASH_ALLOWED_HOSTS = $remote.hostname }
    }
    $token = [Guid]::NewGuid().ToString('N')
    $logPrefix = if ($Port -eq 8787) { 'server' } else { "server-$Port" }
    $arguments = @('-u', ('"{0}"' -f $helperFile), '--port', "$Port", '--state', ('"{0}"' -f $stateFile), '--token', $token, '--data-dir', ('"{0}"' -f $dataPath))
    $launcher = Start-Process -FilePath $pythonExe -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDir "$logPrefix.stdout.log") -RedirectStandardError (Join-Path $runtimeDir "$logPrefix.stderr.log")
    $deadline = (Get-Date).AddSeconds(35)
    do {
        Start-Sleep -Milliseconds 350
        $launcher.Refresh()
        if ($launcher.HasExited) { throw "启动失败，请查看 .runtime\$logPrefix.stderr.log。" }
        if (Test-Path -LiteralPath $stateFile) {
            $record = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
            if ($record.instance_token -eq $token) {
                $owned = Get-ClashOwnedProcess -State $record -ProjectRoot $projectRoot -Port $Port
                if ($owned) {
                    $owned.Dispose()
                    $health = Get-ClashHealth -BaseUrl $baseUrl
                    if ($health -and $health.app -eq 'favorite-clash' -and $health.status -eq 'ok') {
                        Write-Host "已启动：$baseUrl"
                        Write-Host "数据目录：$dataPath"
                        if (!$NoBrowser) { Start-Process $baseUrl }
                        return
                    }
                }
            }
        }
    } while ((Get-Date) -lt $deadline)
    throw "后台实例已创建但暂未通过健康检查，请查看 .runtime\$logPrefix.stderr.log；可运行 stop.ps1 -Port $Port 安全停止。"
} finally {
    if ($lock) { $lock.Dispose() }
    foreach ($name in $envNames) { [Environment]::SetEnvironmentVariable($name, $previousEnv[$name], 'Process') }
}
