#Requires -RunAsAdministrator

$exe = Join-Path $PSScriptRoot "resources\AudioSidecar.exe"

if (-not (Test-Path $exe)) {
    Write-Error "AudioSidecar.exe not found at $exe."
    exit 1
}

& $exe --uninstall
