# Provenance report: Authenticode status of every bundled executable/DLL.
#   pwsh desktop/scripts/signature-report.ps1 <dir> <out.json>
# Hard requirements (exit 1 otherwise): Node.js signed by the OpenJS Foundation and the
# app-local VC++ runtime DLLs signed by Microsoft. Everything else (PostgreSQL, Poppler,
# Chrome Headless Shell, Electron/app) is reported exactly as found.
param([string]$Root, [string]$Out)
$rows = Get-ChildItem -LiteralPath $Root -Recurse -File -Include *.exe,*.dll | ForEach-Object {
  $sig = Get-AuthenticodeSignature -LiteralPath $_.FullName
  [pscustomobject]@{
    file    = $_.FullName.Substring($Root.Length).TrimStart('\')
    status  = "$($sig.Status)"
    signer  = if ($sig.SignerCertificate) { $sig.SignerCertificate.GetNameInfo('SimpleName', $false) } else { "" }
    sha256  = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLower()
  }
}
$rows | ConvertTo-Json -Depth 3 | Out-File -Encoding utf8 $Out
$summary = $rows | Group-Object { ($_.file -split '\\')[0] + ' :: ' + $(if ($_.status -eq 'Valid') { $_.signer } else { $_.status }) } | Sort-Object Name | ForEach-Object { "{0,5}  {1}" -f $_.Count, $_.Name }
$summary | ForEach-Object { Write-Host $_ }
if ($env:GITHUB_STEP_SUMMARY) { "### Authenticode provenance`n``````n$($summary -join "`n")`n``````" | Out-File -Append $env:GITHUB_STEP_SUMMARY }
$fail = @()
function Require($pattern, $signer) {
  $m = $rows | Where-Object { $_.file -like $pattern }
  if (-not $m) { $script:fail += "no file matches $pattern"; return }
  foreach ($r in $m) { if ($r.status -ne 'Valid' -or $r.signer -notlike "*$signer*") { $script:fail += "$($r.file): $($r.status) '$($r.signer)' (expected $signer)" } }
}
Require 'node\node.exe' 'OpenJS'
# PostgreSQL: reported, not required — whether EDB signs the zip binaries is recorded, not assumed.
$pgSig = $rows | Where-Object { $_.file -like 'pgsql\bin\postgres.exe' } | Select-Object -First 1
Write-Host "postgres.exe: $($pgSig.status) '$($pgSig.signer)'"
Require 'pgsql\bin\vcruntime140.dll' 'Microsoft'
Require 'node\vcruntime140.dll' 'Microsoft'
if ($fail.Count) { $fail | ForEach-Object { Write-Host "PROVENANCE FAIL: $_" }; exit 1 }
Write-Host "provenance requirements met"
