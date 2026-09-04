[CmdletBinding()]
param([string]$ComfyUIRoot, [switch]$Yes)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$expectedSha = '200B17F16FBDF2AFBD4F5C70B8390D57225BD2671EC17DFE162AD0E866DFF66C'
$url = 'https://github.com/simsim9-stack/ComfyUI-MiniMaxH3-PreviewOverride/raw/refs/heads/main/minivae/taeh3_decoder.safetensors'
if ([string]::IsNullOrWhiteSpace($ComfyUIRoot)) {
    $ComfyUIRoot = @(
        (Join-Path $env:USERPROFILE 'Desktop\ComfyUI_windows_portable\ComfyUI'),
        (Join-Path $env:USERPROFILE 'ComfyUI_windows_portable\ComfyUI'),
        (Join-Path $env:USERPROFILE 'ComfyUI')
    ) | Where-Object { Test-Path (Join-Path $_ 'main.py') -PathType Leaf } | Select-Object -First 1
}
if ([string]::IsNullOrWhiteSpace($ComfyUIRoot)) { $ComfyUIRoot = Read-Host 'Enter the full ComfyUI path' }
$root = [IO.Path]::GetFullPath($ComfyUIRoot.Trim('"'))
if (-not (Test-Path (Join-Path $root 'main.py') -PathType Leaf)) { throw "Invalid ComfyUI folder: $root" }
$dir = Join-Path $root 'models\vae_approx'
$target = Join-Path $dir 'taeh3_decoder.safetensors'
New-Item -ItemType Directory -Path $dir -Force | Out-Null
if (Test-Path -LiteralPath $target -PathType Leaf) {
    $hash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToUpperInvariant()
    if ($hash -eq $expectedSha) {
        Write-Host 'H3 TAEHV Preview Decoder is already installed correctly.' -ForegroundColor Green
        exit 0
    }
    if (-not $Yes) {
        $answer = (Read-Host "taeh3_decoder.safetensors already exists with a different hash. Replace it with the Velvet Vice version? Type YES").Trim().ToUpperInvariant()
        if ($answer -ne 'YES') { throw 'Cancelled. The existing file was left unchanged.' }
    }
}
if (-not $Yes -and -not (Test-Path -LiteralPath $target)) {
    $answer = (Read-Host 'Download the H3 TAEHV Preview Decoder (about 37.6 MB, MIT)? Type YES').Trim().ToUpperInvariant()
    if ($answer -ne 'YES') { throw 'Cancelled.' }
}
$temp = "$target.download-$PID"
try {
    Write-Host 'Downloading H3 TAEHV Preview Decoder ...' -ForegroundColor Cyan
    Invoke-WebRequest -Uri $url -OutFile $temp -UseBasicParsing
    $hash = (Get-FileHash -LiteralPath $temp -Algorithm SHA256).Hash.ToUpperInvariant()
    if ($hash -ne $expectedSha) { throw "Hash verification failed. Expected $expectedSha, got $hash" }
    Move-Item -LiteralPath $temp -Destination $target -Force
    Write-Host "SUCCESS: $target" -ForegroundColor Green
    Write-Host 'Restart ComfyUI completely afterwards.' -ForegroundColor Yellow
} finally {
    if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue }
}
