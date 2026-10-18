# Shared instance identity checks. Compatible with Windows PowerShell 5.1.
function Get-ClashStateFile {
    param([string]$ProjectRoot, [int]$Port)
    $file = if ($Port -eq 8787) { 'server.json' } else { "server-$Port.json" }
    Join-Path (Join-Path $ProjectRoot '.runtime') $file
}

function Get-ClashHealth {
    param([string]$BaseUrl)
    try {
        $request = [Net.HttpWebRequest]::Create("$BaseUrl/api/health")
        $request.Proxy = $null
        $request.Timeout = 2500
        $request.ReadWriteTimeout = 2500
        $response = $request.GetResponse()
        try {
            $reader = New-Object IO.StreamReader($response.GetResponseStream())
            try { $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
        } finally { $response.Dispose() }
    } catch { $null }
}

function Get-ClashOwnedProcess {
    param($State, [string]$ProjectRoot, [int]$Port)
    if ($State.version -ne 2 -or $State.app -ne 'favorite-clash' -or $State.project_root -ne $ProjectRoot -or [int]$State.port -ne $Port -or $State.instance_token -notmatch '^[a-f0-9]{32}$' -or [int]$State.pid -le 0 -or !$State.executable -or !$State.process_start_utc_ticks) {
        throw '后台记录缺少可验证的实例身份，未停止任何程序。请勿用旧记录管理新进程。'
    }
    $process = Get-Process -Id ([int]$State.pid) -ErrorAction SilentlyContinue
    if (!$process) { return $null }
    try {
        # Acquiring Handle keeps this process object alive while its identity is checked.
        $null = $process.Handle
        $actualPath = [IO.Path]::GetFullPath($process.Path)
        $recordedPath = [IO.Path]::GetFullPath([string]$State.executable)
        $actualTicks = $process.StartTime.ToUniversalTime().Ticks.ToString()
        if ($actualPath -ne $recordedPath -or $actualTicks -ne [string]$State.process_start_utc_ticks) {
            throw '记录的 PID 已被复用或进程身份不匹配，未停止任何程序。'
        }
        return $process
    } catch {
        $process.Dispose()
        throw
    }
}
