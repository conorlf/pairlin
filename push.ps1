param(
    [Parameter(Mandatory=$true)]
    [string]$Message
)

$root = $PSScriptRoot
$sub = Join-Path $root "embrace-my-style"

# Push embrace-my-style
Set-Location $sub
git add .
git commit -m $Message
if ($LASTEXITCODE -ne 0) { Write-Error "Commit failed in embrace-my-style"; exit 1 }
git push
if ($LASTEXITCODE -ne 0) { Write-Error "Push failed in embrace-my-style"; exit 1 }

# Update pairlin submodule pointer
Set-Location $root
git add embrace-my-style
git commit -m "update submodule: $Message"
git push
