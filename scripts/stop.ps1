param([ValidateRange(1, 65535)][int]$Port = 8787)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'server-state.ps1')
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$stateFile = Get-ClashStateFile -ProjectRoot $projectRoot -Port $Port
if (!(Test-Path -LiteralPath $stateFile)) { Write-Host '没有由启动入口记录的后台进程。'; return }
$state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
$owned = Get-ClashOwnedProcess -State $state -ProjectRoot $projectRoot -Port $Port
if (!$owned) {
    Remove-Item -LiteralPath $stateFile
    Write-Host '应用已停止，已清理过期记录。'
    return
}
try {
    # Keep the verified process handle open; never search for or stop other Python processes.
    $stopFile = Join-Path (Split-Path -Parent $stateFile) ("server-stop-{0}.request" -f $state.instance_token)
    [IO.File]::WriteAllText($stopFile, [string]$state.instance_token)
    if (!$owned.WaitForExit(12000)) {
        # Kill only the held, verified instance if graceful shutdown cannot finish.
        $owned.Kill()
        if (!$owned.WaitForExit(5000)) { throw '该实例暂未退出，请查看日志。' }
    }
    # A newer startup must never have its state removed by an older stop operation.
    if (Test-Path -LiteralPath $stateFile) {
        $current = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
        if ($current.instance_token -eq $state.instance_token) { Remove-Item -LiteralPath $stateFile }
    }
    if (Test-Path -LiteralPath $stopFile) { Remove-Item -LiteralPath $stopFile }
    Write-Host '应用已停止。下次启动后可重试未完成任务。'
} finally { $owned.Dispose() }
