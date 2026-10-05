$ErrorActionPreference = 'Stop'
$TaskRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$AssignmentRoot = Join-Path $TaskRoot 'Assignment'
$StageRoot = Join-Path $TaskRoot ('.submission-staging-' + [Guid]::NewGuid().ToString('N'))
$StagingAssignment = Join-Path $StageRoot 'Assignment'
$ZipPath = Join-Path $TaskRoot 'level-5-certification-staging.zip'
$Utf8 = New-Object System.Text.UTF8Encoding($false)

function Assert-InTaskRoot([string] $Candidate) {
    $Resolved = [IO.Path]::GetFullPath($Candidate)
    if (-not $Resolved.StartsWith($TaskRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Path is outside the intended package workspace: $Resolved"
    }
    return $Resolved
}

Assert-InTaskRoot $StageRoot | Out-Null
Assert-InTaskRoot $ZipPath | Out-Null
if (-not (Test-Path -LiteralPath $AssignmentRoot -PathType Container)) { throw 'Assignment directory is missing' }
$RepositoryDir = Join-Path $AssignmentRoot 'repository'
New-Item -ItemType Directory -Path $RepositoryDir -Force | Out-Null
$GitLog = & git -C $TaskRoot log --date=iso-strict '--format=%H %aI %s' --stat 2>&1
if ($LASTEXITCODE -ne 0) { throw "Cannot export real git history: $GitLog" }
[IO.File]::WriteAllText((Join-Path $RepositoryDir 'git-log-export.txt'), (($GitLog -join "`n") + "`n"), $Utf8)
$GitHead = (& git -C $TaskRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve source Git revision' }

function Get-PackageFiles([string] $Directory) {
    foreach ($Entry in (Get-ChildItem -LiteralPath $Directory -Force)) {
        if ($Entry.Name -in @('node_modules', 'artifacts', '.git') -or $Entry.Name -match '^\.env($|\.)') { continue }
        if ($Entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Unsupported linked package source: $($Entry.FullName)" }
        if ($Entry.PSIsContainer) { Get-PackageFiles $Entry.FullName }
        else { $Entry }
    }
}

$SourceFiles = Get-PackageFiles $AssignmentRoot | Where-Object {
    $Relative = $_.FullName.Substring($AssignmentRoot.Length + 1).Replace('\', '/')
    $Relative -ne 'package-integrity.json' -and $Relative -notmatch '(^|/)(node_modules|artifacts|\.git)(/|$)' -and $Relative -notmatch '(^|/)\.env($|\.)'
} | Sort-Object FullName
$Hashes = [ordered]@{}
foreach ($SourceFile in $SourceFiles) {
    $Relative = $SourceFile.FullName.Substring($AssignmentRoot.Length + 1).Replace('\', '/')
    $SourceStream = [IO.File]::OpenRead($SourceFile.FullName)
    $Hasher = [Security.Cryptography.SHA256]::Create()
    try { $Hashes[$Relative] = [BitConverter]::ToString($Hasher.ComputeHash($SourceStream)).Replace('-', '').ToLowerInvariant() }
    finally { $SourceStream.Dispose(); $Hasher.Dispose() }
}
$Manifest = [ordered]@{
    schema_version = 1
    generated_at = [DateTime]::UtcNow.ToString('o')
    source_git_head = $GitHead
    hash_algorithm = 'sha256'
    note = 'Hashes identify the packaged source bytes. The manifest itself is excluded to avoid a self-reference.'
    files = $Hashes
}
[IO.File]::WriteAllText((Join-Path $AssignmentRoot 'package-integrity.json'), (($Manifest | ConvertTo-Json -Depth 10) + "`n"), $Utf8)

try {
    New-Item -ItemType Directory -Path $StagingAssignment -Force | Out-Null
    foreach ($Relative in $Hashes.Keys) {
        $Target = Join-Path $StagingAssignment $Relative
        New-Item -ItemType Directory -Path (Split-Path -Parent $Target) -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $AssignmentRoot $Relative) -Destination $Target
    }
    Copy-Item -LiteralPath (Join-Path $AssignmentRoot 'package-integrity.json') -Destination $StagingAssignment
    # Existing ZIP is a generated artifact at an explicitly verified workspace path.
    Assert-InTaskRoot $ZipPath | Out-Null
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    if (Test-Path -LiteralPath $ZipPath) { Remove-Item -LiteralPath $ZipPath -Force }
    [IO.Compression.ZipFile]::CreateFromDirectory($StageRoot, $ZipPath, [IO.Compression.CompressionLevel]::Optimal, $false)
    Write-Host "Wrote $ZipPath with $($Hashes.Count) source files and SHA-256 manifest."
} finally {
    $VerifiedStage = Assert-InTaskRoot $StageRoot
    if (Test-Path -LiteralPath $VerifiedStage) { Remove-Item -LiteralPath $VerifiedStage -Recurse -Force }
}
