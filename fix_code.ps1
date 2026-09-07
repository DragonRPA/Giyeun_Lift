$ErrorActionPreference = 'Stop'

# Function to replace patterns in files
function Replace-InFile {
    param(
        [string]$Path,
        [string]$Pattern,
        [string]$Replacement
    )
    Get-ChildItem -Path $Path -Recurse -Include *.tsx,*.ts,*.jsx,*.js | ForEach-Object {
        $content = Get-Content -Raw -Path $_.FullName
        $newContent = $content -replace $Pattern, $Replacement
        if ($newContent -ne $content) {
            Write-Host "Updating $($_.FullName)"
            Set-Content -Path $_.FullName -Value $newContent -Encoding UTF8
        }
    }
}

$basePath = "d:/01.AntiGravity/Giyuen_Lift"

# 1. Fix stray style braces
Replace-InFile -Path $basePath -Pattern 'style=\{\{ \{' -Replacement 'style={{'

# 2. Replace object literal status assignments using = with :
Replace-InFile -Path $basePath -Pattern '(\bstatus)\s*=\s*(["\'\`])' -Replacement '${1}: ${2}'

# 3. Replace let status = with let status: for type annotations
Replace-InFile -Path $basePath -Pattern '(let\s+status)\s*=' -Replacement '${1}:'

# 4. Add async keyword to Promise constructors in googleDriveBackup.ts
Get-ChildItem -Path $basePath -Recurse -Include *.ts,*.tsx | Where-Object { $_.Name -eq 'googleDriveBackup.ts' } | ForEach-Object {
    $file = $_.FullName
    $content = Get-Content -Raw -Path $file
    $newContent = $content -replace '(new\s+Promise\s*\()\s*\(\s*([^,]+)\s*,\s*([^\)]+)\)\s*=>\s*\{', '$1 async ($2, $3) => {'
    if ($newContent -ne $content) {
        Write-Host "Updating async Promise in $file"
        Set-Content -Path $file -Value $newContent -Encoding UTF8
    }
}

Write-Host "All replacements completed."
