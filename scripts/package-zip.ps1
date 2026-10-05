$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Assignment = Join-Path $Root 'Assignment'
$Staging = Join-Path $Root '.submission-staging\Assignment'
$ZipPath = Join-Path $Root 'level-5-certification-staging.zip'

if (Test-Path (Join-Path $Root '.submission-staging')) {
  Remove-Item (Join-Path $Root '.submission-staging') -Recurse -Force
}
New-Item -ItemType Directory -Path $Staging -Force | Out-Null
robocopy $Assignment $Staging /E /XD node_modules artifacts /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit $LASTEXITCODE" }

if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
Compress-Archive -Path $Staging -DestinationPath $ZipPath -Force
Remove-Item (Join-Path $Root '.submission-staging') -Recurse -Force
Write-Host "Wrote $ZipPath (rename to level-5-certification.zip for handoff if desired)"
