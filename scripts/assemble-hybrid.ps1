# Assemble hybrid demo videos: Imagine opener (6s) + live Playwright webm.
# Requires ffmpeg on PATH. Converts webm→mp4 intermediate then concat.
#
# Usage (from repo root):
#   powershell -File scripts/assemble-hybrid.ps1

$ErrorActionPreference = "Stop"
$outDir = Join-Path $PSScriptRoot "..\docs\screenshots\demo-videos" | Resolve-Path
$ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
if (-not $ffmpeg) {
  Write-Error "ffmpeg not found on PATH. Install ffmpeg, then re-run."
}

function Assemble-Pair([string]$opener, [string]$live, [string]$output) {
  $openerPath = Join-Path $outDir $opener
  $livePath = Join-Path $outDir $live
  $outPath = Join-Path $outDir $output
  if (-not (Test-Path $openerPath)) { Write-Warning "skip missing $opener"; return }
  if (-not (Test-Path $livePath)) { Write-Warning "skip missing $live"; return }

  $tmpLive = Join-Path $outDir ("_tmp_" + [IO.Path]::GetFileNameWithoutExtension($live) + ".mp4")
  $list = Join-Path $outDir ("_concat_" + [IO.Path]::GetFileNameWithoutExtension($output) + ".txt")

  # Normalize live webm to mp4 (same family as opener) for concat demuxer.
  & ffmpeg -y -i $livePath -vf "scale=1440:900:force_original_aspect_ratio=decrease,pad=1440:900:(ow-iw)/2:(oh-ih)/2" -r 30 -c:v libx264 -pix_fmt yuv420p -an $tmpLive
  # Re-encode opener to matching geometry/fps (cannot always -c copy across sources).
  $tmpOpen = Join-Path $outDir ("_tmp_open_" + [IO.Path]::GetFileNameWithoutExtension($opener) + ".mp4")
  & ffmpeg -y -i $openerPath -vf "scale=1440:900:force_original_aspect_ratio=decrease,pad=1440:900:(ow-iw)/2:(oh-ih)/2" -r 30 -c:v libx264 -pix_fmt yuv420p -an $tmpOpen

  @"
file '$($tmpOpen -replace '\\','/')'
file '$($tmpLive -replace '\\','/')'
"@ | Set-Content -Path $list -Encoding ascii

  & ffmpeg -y -f concat -safe 0 -i $list -c copy $outPath
  Remove-Item $tmpLive, $tmpOpen, $list -ErrorAction SilentlyContinue
  Write-Host "wrote $outPath"
}

Assemble-Pair "opener-code.mp4" "live-code.webm" "hybrid-code.mp4"
Assemble-Pair "opener-math.mp4" "live-math.webm" "hybrid-math.mp4"
Assemble-Pair "opener-fallback.mp4" "live-fallback.webm" "hybrid-fallback.mp4"

Write-Host "Done. Outputs in $outDir"
