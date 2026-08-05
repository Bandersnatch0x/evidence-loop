[CmdletBinding()]
param(
    [ValidateSet("shell", "install", "check", "dev")]
    [string]$Action = "shell",
    [string]$EnvFile = "",
    [string]$Dns = "8.8.8.8",
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$image = "wslc-ai-dev:latest"
$nodeModulesVolume = "evidence-ring-node-modules"
$projectPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$agentHome = "E:\WSL\agent-home"
$claudeHome = Join-Path $agentHome "claude"
$codexHome = Join-Path $agentHome "codex"
$mavenHome = Join-Path $agentHome "maven"

foreach ($path in @($claudeHome, $codexHome, $mavenHome)) {
    New-Item -ItemType Directory -Force -Path $path | Out-Null
}

if ($EnvFile -ne "") {
    $EnvFile = [System.IO.Path]::GetFullPath($EnvFile)
    if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
        throw "Environment file not found: $EnvFile"
    }
}

$imageExists = (& wslc images | Select-String -SimpleMatch "wslc-ai-dev" -Quiet)
if (-not $imageExists) {
    throw "WSLC image '$image' is not installed."
}

$volumeList = & wslc volume list | Out-String
$volumeExists = $volumeList -match [regex]::Escape($nodeModulesVolume)
if (-not $volumeExists -and -not $DryRun) {
    & wslc volume create $nodeModulesVolume
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create WSLC volume '$nodeModulesVolume'."
    }

    & wslc run --rm --user root -v "${nodeModulesVolume}:/workspace/node_modules" $image /bin/bash -lc "chown -R dev:dev /workspace/node_modules"
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to initialize WSLC volume '$nodeModulesVolume'."
    }
}

$arguments = @(
    "run", "--rm",
    "--dns", $Dns,
    "-v", "${projectPath}:/workspace",
    "-v", "${nodeModulesVolume}:/workspace/node_modules",
    "-v", "${claudeHome}:/home/dev/.claude",
    "-v", "${codexHome}:/home/dev/.codex",
    "-v", "${mavenHome}:/home/dev/.m2",
    "-w", "/workspace"
)

if ($EnvFile -ne "") {
    $arguments += @("--env-file", $EnvFile)
}

$command = switch ($Action) {
    "install" { "npm ci" }
    "check" { "npm run check" }
    "dev" { "npm run dev" }
    default { "" }
}

if ($Action -eq "shell" -or $Action -eq "dev") {
    $arguments += @("-i", "-t")
}

if ($Action -eq "dev") {
    $arguments += @("-p", "4180:4180")
}

$arguments += $image
if ($Action -eq "shell") {
    $arguments += "/bin/bash"
} else {
    $arguments += @("/bin/bash", "-lc", $command)
}

if ($DryRun) {
    [pscustomobject]@{
        Action = $Action
        Image = $image
        ProjectPath = $projectPath
        Workspace = "/workspace"
        NodeModulesVolume = $nodeModulesVolume
        VolumeExists = $volumeExists
        EnvFile = $EnvFile
        Dns = $Dns
        Command = "wslc $($arguments -join ' ')"
    }
    exit 0
}

& wslc @arguments
exit $LASTEXITCODE
