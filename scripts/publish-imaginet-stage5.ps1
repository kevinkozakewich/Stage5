$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$env:GIT_AUTHOR_NAME = 'Kevin Kozakewich'
$env:GIT_COMMITTER_NAME = 'Kevin Kozakewich'
$env:GIT_AUTHOR_EMAIL = 'kevin.kozakewich@improving.com'
$env:GIT_COMMITTER_EMAIL = 'kevin.kozakewich@improving.com'

Write-Host "Active GitHub account:"
gh auth status

$active = (gh api user --jq .login)
if ($active -ne 'ImaginetKevinK') {
  Write-Host ""
  Write-Host "Switch to ImaginetKevinK first:"
  Write-Host "  gh auth login --hostname github.com --git-protocol https --web"
  Write-Host "  gh auth switch   # pick ImaginetKevinK"
  exit 1
}

if (-not (gh repo view ImaginetKevinK/Stage5 2>$null)) {
  gh repo create ImaginetKevinK/Stage5 --public --description "Stage 5 delegated trigger delivery certification"
}

git remote set-url origin https://github.com/ImaginetKevinK/Stage5.git
git push -u origin main
Write-Host "Published: https://github.com/ImaginetKevinK/Stage5"
