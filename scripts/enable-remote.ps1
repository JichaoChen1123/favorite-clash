$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$tailscaleExe = 'C:\Program Files\Tailscale\tailscale.exe'
if (!(Test-Path -LiteralPath $tailscaleExe)) {
    throw '请先安装并登录 Tailscale：https://tailscale.com/download/windows'
}
$statusText = & $tailscaleExe status --json
if ($LASTEXITCODE -ne 0) { throw '无法访问 Tailscale 服务。请在本人 Windows 桌面直接运行此入口；若仍提示拒绝访问，请用管理员终端运行 scripts\enable-remote.ps1。' }
$status = $statusText | ConvertFrom-Json
if ($status.BackendState -ne 'Running') { throw '请先打开 Tailscale 并登录，与手机使用同一账号。' }
$dnsName = $status.Self.DNSName.TrimEnd('.')
if ($dnsName -notmatch '^[a-z0-9.-]+\.ts\.net$') { throw '暂未获得 Tailscale 域名，请检查 MagicDNS 设置。' }
$runtimeDir = Join-Path $projectRoot '.runtime'
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
@{hostname=$dnsName; url="https://$dnsName"} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeDir 'remote.json') -Encoding UTF8
& $tailscaleExe serve --bg http://127.0.0.1:8787
if ($LASTEXITCODE -ne 0) { throw 'Tailscale Serve 尚未启用，请按其提示在账号页面启用 HTTPS 后重试。' }
Write-Host "私人地址：https://$dnsName"
Write-Host '请停止并重新启动本应用以读取允许访问的域名。手机连接 Tailscale 后打开上述地址。'
Write-Host '若你的 Tailscale 网络还有其他成员，需要在管理后台将本服务访问规则限制为自己的设备。'
