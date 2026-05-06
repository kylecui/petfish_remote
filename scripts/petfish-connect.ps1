<#
.SYNOPSIS
    petfish-connect.ps1 — Manage the petfish-remote connector daemon on Windows.

.DESCRIPTION
    PowerShell-native alternative to petfish-connect.sh for Windows.
    Uses Start-Process -WindowStyle Hidden to run the connector as a background process.

.EXAMPLE
    .\petfish-connect.ps1 start .\connector.yaml
    .\petfish-connect.ps1 stop
    .\petfish-connect.ps1 restart .\connector.yaml
    .\petfish-connect.ps1 status
    .\petfish-connect.ps1 logs
#>

param(
    [Parameter(Position = 0)]
    [ValidateSet('start', 'stop', 'restart', 'status', 'logs', 'setup', 'help')]
    [string]$Command = 'help',

    [Parameter(Position = 1)]
    [string]$ConfigPath,

    [string]$Token,
    [string]$ProjectId,
    [string]$ProjectName,
    [string]$ProjectPath,
    [string]$Server = 'https://remote.petfish.ai',
    [string]$Output
)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PetfishDir = Split-Path -Parent $ScriptDir
$ConnectorJs = Join-Path $PetfishDir 'dist\connector\main.js'
$PidDir = $env:TEMP
$LogDir = $env:TEMP

function Get-Slug {
    param([string]$Path)
    $resolved = Resolve-Path $Path -ErrorAction SilentlyContinue
    if ($resolved) { $dir = Split-Path -Parent $resolved }
    else { $dir = Split-Path -Parent $Path }
    $name = Split-Path -Leaf $dir
    return ($name -replace '[^a-zA-Z0-9-]', '-').ToLower()
}

function Get-PidFile {
    param([string]$Config)
    $slug = Get-Slug $Config
    return Join-Path $PidDir "petfish-connector-$slug.pid"
}

function Get-LogFile {
    param([string]$Config)
    $slug = Get-Slug $Config
    return Join-Path $LogDir "petfish-connector-$slug.log"
}

function Test-Running {
    param([string]$PidFile)
    if (-not (Test-Path $PidFile)) { return $false }
    $pid = [int](Get-Content $PidFile -Raw).Trim()
    try {
        $proc = Get-Process -Id $pid -ErrorAction Stop
        return ($proc -ne $null -and -not $proc.HasExited)
    }
    catch {
        Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
        return $false
    }
}

function Invoke-Start {
    param([string]$Config)

    if (-not $Config) { $Config = Join-Path (Get-Location) 'connector.yaml' }
    if (-not (Test-Path $Config)) {
        Write-Error "connector.yaml not found at: $Config"
        return
    }

    $Config = Resolve-Path $Config

    if (-not (Test-Path $ConnectorJs)) {
        Write-Error "Connector not built. Run: cd $PetfishDir; npm run build"
        return
    }

    $pidFile = Get-PidFile $Config
    $logFile = Get-LogFile $Config

    if (Test-Running $pidFile) {
        $existingPid = (Get-Content $pidFile -Raw).Trim()
        Write-Host "Connector already running (PID $existingPid)"
        Write-Host "Use '.\petfish-connect.ps1 stop' first, or '.\petfish-connect.ps1 restart'"
        return
    }

    $nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (-not $nodeExe) {
        Write-Error "Node.js not found in PATH. Install Node.js >= 20."
        return
    }

    $opencodePid = ''
    $ocProc = Get-Process -Name 'opencode' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($ocProc) { $opencodePid = $ocProc.Id.ToString() }

    Write-Host "><(((^> petfish-connect: starting daemon"
    Write-Host "   config: $Config"
    Write-Host "   log: $logFile"
    Write-Host "   opencode PID: $(if ($opencodePid) { $opencodePid } else { 'none' })"

    $env:OPENCODE_PID = $opencodePid

    $proc = Start-Process -FilePath $nodeExe `
        -ArgumentList "`"$ConnectorJs`" `"$Config`"" `
        -WindowStyle Hidden `
        -RedirectStandardOutput $logFile `
        -RedirectStandardError "$logFile.err" `
        -PassThru

    $proc.Id | Out-File -FilePath $pidFile -Encoding ascii -NoNewline

    Start-Sleep -Seconds 2

    if ($proc.HasExited) {
        Write-Error "Connector process died immediately. Check log: $logFile"
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
        return
    }

    $logContent = if (Test-Path $logFile) { Get-Content $logFile -Raw } else { '' }
    if ($logContent -match 'Registration accepted') {
        Write-Host "   status: ✅ registered with server"
    }
    else {
        Write-Host "   status: ⏳ connecting (check '.\petfish-connect.ps1 status' in a few seconds)"
    }

    Write-Host "   PID: $($proc.Id)"
    Write-Host ""
    Write-Host "Connector is running in background (survives terminal close)."
    Write-Host "To stop: .\petfish-connect.ps1 stop"
}

function Invoke-Stop {
    param([string]$Config)

    if (-not $Config) { $Config = Join-Path (Get-Location) 'connector.yaml' }
    $pidFile = Get-PidFile $Config

    if (-not (Test-Running $pidFile)) {
        Write-Host "Connector is not running."
        $orphans = Get-Process -Name 'node' -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -match 'connector[/\\]main\.js' }
        if ($orphans) {
            Write-Host "WARNING: Found orphaned connector process(es):"
            $orphans | ForEach-Object { Write-Host "  PID $($_.Id): $($_.CommandLine)" }
            Write-Host "Kill with: Stop-Process -Id <pid>"
        }
        return
    }

    $pid = [int](Get-Content $pidFile -Raw).Trim()
    Write-Host "Stopping connector (PID $pid)..."

    try {
        Stop-Process -Id $pid -Force -ErrorAction Stop
    }
    catch {
        Write-Host "Process already exited."
    }

    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    Write-Host "Stopped."
}

function Invoke-Status {
    param([string]$Config)

    if (-not $Config) { $Config = Join-Path (Get-Location) 'connector.yaml' }
    $pidFile = Get-PidFile $Config
    $logFile = Get-LogFile $Config

    Write-Host "><(((^> PetFish Remote Connector Status"
    Write-Host ""

    if (Test-Running $pidFile) {
        $pid = (Get-Content $pidFile -Raw).Trim()
        Write-Host "  Status: RUNNING (PID $pid)"
        Write-Host "  PID file: $pidFile"
        Write-Host "  Log file: $logFile"
        Write-Host ""
        Write-Host "  Recent log:"
        if (Test-Path $logFile) {
            Get-Content $logFile -Tail 5 | ForEach-Object { Write-Host "    $_" }
        }
    }
    else {
        Write-Host "  Status: STOPPED"
        if (Test-Path $logFile) {
            Write-Host "  Last log entries:"
            Get-Content $logFile -Tail 5 | ForEach-Object { Write-Host "    $_" }
        }
    }
}

function Invoke-Logs {
    param([string]$Config)

    if (-not $Config) { $Config = Join-Path (Get-Location) 'connector.yaml' }
    $logFile = Get-LogFile $Config

    if (-not (Test-Path $logFile)) {
        Write-Error "No log file found at: $logFile"
        return
    }

    Get-Content $logFile -Tail 50
}

function Invoke-Setup {
    if (-not $Token) {
        Write-Error "Token required. Get one from /start in Telegram bot.`nUsage: .\petfish-connect.ps1 setup -Token <token> -ProjectId <id>"
        return
    }
    if (-not $ProjectId) {
        $ProjectId = Split-Path -Leaf (Get-Location)
    }
    if (-not $ProjectName) { $ProjectName = $ProjectId }
    if (-not $ProjectPath) { $ProjectPath = (Get-Location).Path }
    if (-not $Output) { $Output = Join-Path (Get-Location) 'connector.yaml' }

    $hostname = $env:COMPUTERNAME

    Write-Host "><(((^> petfish-connect: registering with server..."
    Write-Host "   server: $Server"
    Write-Host "   project: $ProjectId ($ProjectName)"
    Write-Host "   path: $ProjectPath"

    $body = @{
        token       = $Token
        projectId   = $ProjectId
        projectName = $ProjectName
        projectPath = $ProjectPath
        hostname    = $hostname
    } | ConvertTo-Json

    try {
        $resp = Invoke-RestMethod -Uri "$Server/api/register" -Method POST -ContentType 'application/json' -Body $body
    }
    catch {
        Write-Error "Registration failed: $_"
        return
    }

    if (-not $resp.connectorToken) {
        Write-Error "No connectorToken in response: $($resp | ConvertTo-Json -Compress)"
        return
    }

    $yaml = @"
connectorId: auto
serverUrl: "$($resp.serverUrl)"
token: "$($resp.connectorToken)"
reconnectIntervalMs: 5000
maxReconnectIntervalMs: 60000

projects:
  - id: $ProjectId
    path: $ProjectPath
    opencodeBin: opencode
"@

    Set-Content -Path $Output -Value $yaml -Encoding UTF8
    Write-Host ""
    Write-Host "   ✅ Registration successful!"
    Write-Host "   Config written to: $Output"
    Write-Host ""
    Write-Host "Start the connector with:"
    Write-Host "  .\petfish-connect.ps1 start $Output"
}

switch ($Command) {
    'start'   { Invoke-Start $ConfigPath }
    'stop'    { Invoke-Stop $ConfigPath }
    'restart' {
        Invoke-Stop $ConfigPath
        Start-Sleep -Seconds 1
        Invoke-Start $ConfigPath
    }
    'status'  { Invoke-Status $ConfigPath }
    'logs'    { Invoke-Logs $ConfigPath }
    'setup'   { Invoke-Setup }
    'help'    {
        Write-Host "Usage: .\petfish-connect.ps1 {setup|start|stop|restart|status|logs} [connector.yaml]"
        Write-Host ""
        Write-Host "Commands:"
        Write-Host "  setup   - Register with server and generate connector.yaml"
        Write-Host "  start   - Start connector as hidden background process"
        Write-Host "  stop    - Stop running connector"
        Write-Host "  restart - Stop and start"
        Write-Host "  status  - Show if running + recent log"
        Write-Host "  logs    - Show last 50 log lines"
        Write-Host ""
        Write-Host "Setup example:"
        Write-Host "  .\petfish-connect.ps1 setup -Token <token> -ProjectId my-project"
    }
}
