#Requires -RunAsAdministrator
param(
    [int]$Port = 37891
)

$exe = Join-Path $PSScriptRoot "resources\AudioSidecar.exe"

if (-not (Test-Path $exe)) {
    Write-Error "AudioSidecar.exe not found at $exe. Build the sidecar first:`n  cd AudioSidecar`n  dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o ../resources/"
    exit 1
}

& $exe --install --port $Port
