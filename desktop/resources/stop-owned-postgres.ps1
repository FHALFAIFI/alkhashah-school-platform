# Stops PostgreSQL servers that belong to a Father's App installation, and nothing else:
# a postgres.exe qualifies only if FathersApp.exe sits three levels above its bin folder
# (<install>\resources\pgsql\bin\postgres.exe). Uses that installation's own pg_ctl with the
# data directory from the postmaster's command line (fast shutdown, wait). Never kills.
$ErrorActionPreference = 'SilentlyContinue'
Get-CimInstance Win32_Process -Filter "Name='postgres.exe'" | ForEach-Object {
  $exe = $_.ExecutablePath
  if (-not $exe) { return }
  $bin = Split-Path $exe
  $install = Split-Path (Split-Path (Split-Path $bin))
  if (-not (Test-Path -LiteralPath (Join-Path $install 'FathersApp.exe'))) { return }
  $cmd = $_.CommandLine
  $data = $null
  if ($cmd -match '-D\s+"([^"]+)"') { $data = $Matches[1] } elseif ($cmd -match '-D\s+(\S+)') { $data = $Matches[1] }
  if (-not $data) { return }
  & (Join-Path $bin 'pg_ctl.exe') stop -D $data -m fast -w -t 60 | Out-Null
}
