param(
  [string]$ReleaseExecutable = '',
  [string]$Destination = ''
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$artifactRoot = [IO.Path]::GetFullPath((Join-Path $repositoryRoot 'artifacts'))
if (-not $ReleaseExecutable) {
  $ReleaseExecutable = Join-Path $repositoryRoot 'src-tauri\target\release\crumbtrail.exe'
}
if (-not $Destination) {
  $Destination = Join-Path $artifactRoot 'Crumbtrail_0.1.0_x64-bootstrapper.exe'
}
$ReleaseExecutable = [IO.Path]::GetFullPath($ReleaseExecutable)
$Destination = [IO.Path]::GetFullPath($Destination)
if (-not (Test-Path -LiteralPath $ReleaseExecutable -PathType Leaf)) {
  throw "Release executable not found: $ReleaseExecutable"
}
if (-not $Destination.StartsWith($artifactRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'The bootstrapper destination must remain inside the artifacts directory.'
}

New-Item -ItemType Directory -Force -Path $artifactRoot | Out-Null
Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue
$staging = Join-Path $artifactRoot '.iexpress-staging'
if (Test-Path -LiteralPath $staging) {
  $resolvedStaging = [IO.Path]::GetFullPath($staging)
  if (-not $resolvedStaging.StartsWith($artifactRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing to clear a staging directory outside artifacts.'
  }
  Remove-Item -LiteralPath $resolvedStaging -Recurse -Force
}
New-Item -ItemType Directory -Path $staging | Out-Null
Copy-Item -LiteralPath $ReleaseExecutable -Destination (Join-Path $staging 'Crumbtrail.exe')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'install.ps1') -Destination $staging
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'uninstall.ps1') -Destination $staging

$sedPath = Join-Path $staging 'Crumbtrail.sed'
$sed = @"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=0
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName=$Destination
FriendlyName=Crumbtrail 0.1.0
AppLaunched=powershell.exe -NoProfile -ExecutionPolicy Bypass -File install.ps1
PostInstallCmd=<None>
AdminQuietInstCmd=powershell.exe -NoProfile -ExecutionPolicy Bypass -File install.ps1
UserQuietInstCmd=powershell.exe -NoProfile -ExecutionPolicy Bypass -File install.ps1
SourceFiles=SourceFiles
[SourceFiles]
SourceFiles0=$staging\
[SourceFiles0]
%FILE0%=
%FILE1%=
%FILE2%=
[Strings]
FILE0=Crumbtrail.exe
FILE1=install.ps1
FILE2=uninstall.ps1
"@
[IO.File]::WriteAllText($sedPath, $sed, [Text.Encoding]::ASCII)
$iexpress = Start-Process -FilePath "$env:SystemRoot\System32\iexpress.exe" -ArgumentList @('/N', '/Q', $sedPath) -WindowStyle Hidden -Wait -PassThru
if (-not (Test-Path -LiteralPath $Destination -PathType Leaf)) {
  throw "IExpress could not create the bootstrapper (exit code $($iexpress.ExitCode))."
}
Write-Output $Destination
