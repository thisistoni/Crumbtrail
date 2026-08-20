$ErrorActionPreference = 'Stop'

$localAppData = [Environment]::GetFolderPath('LocalApplicationData')
$programsRoot = [IO.Path]::GetFullPath([IO.Path]::Combine($localAppData, 'Programs'))
$installRoot = [IO.Path]::GetFullPath([IO.Path]::Combine($programsRoot, 'Crumbtrail'))
$expectedPrefix = $programsRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not $installRoot.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'The installation directory is outside the per-user Programs folder.'
}

New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
$installedExe = Join-Path $installRoot 'Crumbtrail.exe'
$uninstaller = Join-Path $installRoot 'uninstall.ps1'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Crumbtrail.exe') -Destination $installedExe -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'uninstall.ps1') -Destination $uninstaller -Force

$startMenu = [Environment]::GetFolderPath('Programs')
$shortcutPath = Join-Path $startMenu 'Crumbtrail.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $installedExe
$shortcut.WorkingDirectory = $installRoot
$shortcut.IconLocation = "$installedExe,0"
$shortcut.Description = 'Create polished process guides'
$shortcut.Save()

$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Crumbtrail'
New-Item -Path $uninstallKey -Force | Out-Null
$uninstallCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$uninstaller`""
New-ItemProperty -Path $uninstallKey -Name DisplayName -Value 'Crumbtrail' -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name DisplayVersion -Value '0.1.0' -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name Publisher -Value 'Crumbtrail contributors' -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name InstallLocation -Value $installRoot -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name DisplayIcon -Value "$installedExe,0" -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name UninstallString -Value $uninstallCommand -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name QuietUninstallString -Value $uninstallCommand -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name NoModify -Value 1 -PropertyType DWord -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name NoRepair -Value 1 -PropertyType DWord -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name EstimatedSize -Value ([int]((Get-Item $installedExe).Length / 1KB)) -PropertyType DWord -Force | Out-Null

Start-Process -FilePath $installedExe
