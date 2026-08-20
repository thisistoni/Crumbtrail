$ErrorActionPreference = 'Stop'

$localAppData = [Environment]::GetFolderPath('LocalApplicationData')
$programsRoot = [IO.Path]::GetFullPath([IO.Path]::Combine($localAppData, 'Programs'))
$installRoot = [IO.Path]::GetFullPath([IO.Path]::Combine($programsRoot, 'Crumbtrail'))
$expectedPrefix = $programsRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not $installRoot.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'The uninstall directory is outside the per-user Programs folder.'
}

$installedExe = Join-Path $installRoot 'Crumbtrail.exe'
Get-Process -Name Crumbtrail -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.Path -and ([IO.Path]::GetFullPath($_.Path) -eq $installedExe)) {
    Stop-Process -Id $_.Id
  }
}

$shortcutPath = Join-Path ([Environment]::GetFolderPath('Programs')) 'Crumbtrail.lnk'
Remove-Item -LiteralPath $shortcutPath -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Crumbtrail' -Recurse -Force -ErrorAction SilentlyContinue

$cleanup = Join-Path ([IO.Path]::GetTempPath()) "crumbtrail-uninstall-$PID.ps1"
$quotedRoot = $installRoot.Replace("'", "''")
$cleanupScript = @"
Start-Sleep -Milliseconds 800
`$target = [IO.Path]::GetFullPath('$quotedRoot')
`$programs = [IO.Path]::GetFullPath([IO.Path]::Combine([Environment]::GetFolderPath('LocalApplicationData'), 'Programs')).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (`$target.StartsWith(`$programs, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path `$target -Leaf) -eq 'Crumbtrail') {
  Remove-Item -LiteralPath `$target -Recurse -Force -ErrorAction SilentlyContinue
}
Remove-Item -LiteralPath `$PSCommandPath -Force -ErrorAction SilentlyContinue
"@
[IO.File]::WriteAllText($cleanup, $cleanupScript, [Text.UTF8Encoding]::new($false))
Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $cleanup)
