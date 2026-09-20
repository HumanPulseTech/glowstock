param(
    [string]$Sdk = "$env:LOCALAPPDATA\Android\Sdk",
    [string]$Java = 'C:\Program Files\Android\Android Studio\jbr'
)
$ErrorActionPreference = 'Stop'
$env:JAVA_HOME = $Java
$env:PATH = "$Java\bin;$env:PATH"
$tools = Join-Path $Sdk 'build-tools\36.0.0'
$platform = Join-Path $Sdk 'platforms\android-36\android.jar'
$build = Join-Path $PSScriptRoot 'build'
$signing = Join-Path $PSScriptRoot 'signing'
New-Item -ItemType Directory -Force $build, "$build\classes", "$build\dex", $signing | Out-Null
function Run([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Build failed: $Program ($LASTEXITCODE)" }
}
Run "$tools\aapt2.exe" @('compile','--dir',"$PSScriptRoot\res",'-o',"$build\resources.zip")
Run "$tools\aapt2.exe" @('link','-o',"$build\unsigned.apk",'--manifest',"$PSScriptRoot\AndroidManifest.xml",'-I',$platform,"$build\resources.zip")
$sources = @(Get-ChildItem "$PSScriptRoot\src" -Recurse -Filter '*.java' | ForEach-Object FullName)
Run "$Java\bin\javac.exe" (@('-encoding','UTF-8','-source','8','-target','8','-classpath',$platform,'-d',"$build\classes") + $sources)
Run "$Java\bin\jar.exe" @('cf',"$build\classes.jar",'-C',"$build\classes",'.')
Run "$tools\d8.bat" @('--lib',$platform,'--min-api','26','--output',"$build\dex","$build\classes.jar")
Run "$Java\bin\jar.exe" @('uf',"$build\unsigned.apk",'-C',"$build\dex",'classes.dex')
Run "$tools\zipalign.exe" @('-f','-p','4',"$build\unsigned.apk","$build\aligned.apk")
# Local testing certificate only; retain it for compatible updates of this APK.
$key = Join-Path $signing 'glowstock-local.jks'
if (-not (Test-Path $key)) {
    Run "$Java\bin\keytool.exe" @('-genkeypair','-keystore',$key,'-storepass','android','-keypass','android','-alias','glowstock-local','-keyalg','RSA','-keysize','2048','-validity','10000','-dname','CN=GlowStock Local Test,O=GlowStock,C=FR')
}
Run "$tools\apksigner.bat" @('sign','--ks',$key,'--ks-key-alias','glowstock-local','--ks-pass','pass:android','--key-pass','pass:android','--out',"$build\GlowStock-1.0.1.apk","$build\aligned.apk")
Run "$tools\apksigner.bat" @('verify','--verbose',"$build\GlowStock-1.0.1.apk")
Write-Output "APK: $build\GlowStock-1.0.1.apk"
