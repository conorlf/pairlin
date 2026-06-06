param(
    [Parameter(Mandatory=$true)]
    [string]$Message
)

$root = $PSScriptRoot
$sub = Join-Path $root "embrace-my-style"

# Commit and push embrace-my-style
Set-Location $sub
git add .
if (git status --porcelain) {
    git commit -m $Message
    if ($LASTEXITCODE -ne 0) { Write-Error "Commit failed in embrace-my-style"; exit 1 }
}
git push
if ($LASTEXITCODE -ne 0) { Write-Error "Push failed in embrace-my-style"; exit 1 }

# Commit and push pairlin (submodule pointer + anything else)
Set-Location $root
git add .
if (git status --porcelain) {
    git commit -m $Message
    if ($LASTEXITCODE -ne 0) { Write-Error "Commit failed in pairlin"; exit 1 }
}
git push
if ($LASTEXITCODE -ne 0) { Write-Error "Push failed in pairlin"; exit 1 }
