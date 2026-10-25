# Standalone, debug-signed Ghost Battle APK. No uploads or global environment changes.
# Toolchain prerequisites and signature limitations: README.md.
[CmdletBinding()]
param(
    [ValidateSet('arm64-v8a', 'x86_64')]
    [string]$Architecture = 'arm64-v8a'
)

$ErrorActionPreference = 'Stop'
$projectDirectory = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$toolchainDirectory = if ($env:GHOST_ANDROID_TOOLCHAIN) { $env:GHOST_ANDROID_TOOLCHAIN } else { Join-Path $projectDirectory '.tools/android-toolchain' }
$onnxPath = Join-Path $projectDirectory 'assets/models/yoloxpose_tiny_416_raw.onnx'
$assetDirectory = Join-Path $projectDirectory 'android/app/src/yoloLab/assets'
$assetPath = Join-Path $assetDirectory 'yoloxpose_tiny_416_raw.onnx'
$expectedOnnxHash = 'C88DE48A61688F02A9387AAEFA4B14298C7AE9891E8E3E1396B7E07239A993BE'
$licenses = @(
    @{ Source = (Join-Path $projectDirectory 'assets/licenses/MMPose-LICENSE.txt'); Hash = 'AA2C6F3408169B96E5547C875DEB481C91502514C1885FA0ACB4B596C8909CB9'; Name = 'mmpose-license.txt' },
    @{ Source = (Join-Path $projectDirectory 'assets/licenses/onnxruntime-1.22.0-LICENSE.txt'); Hash = '2F07C72751AED99790B8A4869CF2311DF85A860B22DED05FA22803587A48922C'; Name = 'onnxruntime-license.txt' }
)
if (-not (Test-Path -LiteralPath $onnxPath)) {
    throw "Missing locally exported YOLO model: $onnxPath. See docs/ATTRIBUTION.md."
}
if ((Get-FileHash -LiteralPath $onnxPath -Algorithm SHA256).Hash -ne $expectedOnnxHash) {
    throw 'Locally exported YOLO model SHA-256 mismatch; refusing to package.'
}
New-Item -ItemType Directory -Path $assetDirectory -Force | Out-Null
Copy-Item -LiteralPath $onnxPath -Destination $assetPath -Force
if ((Get-FileHash -LiteralPath $assetPath -Algorithm SHA256).Hash -ne $expectedOnnxHash) {
    throw 'Staged YOLO model SHA-256 mismatch.'
}
foreach ($license in $licenses) {
    if (-not (Test-Path -LiteralPath $license.Source)) {
        throw "Missing third-party license text: $($license.Source). See docs/ATTRIBUTION.md."
    }
    if ((Get-FileHash -LiteralPath $license.Source -Algorithm SHA256).Hash -ne $license.Hash) {
        throw "Third-party license SHA-256 mismatch: $($license.Source)"
    }
    Copy-Item -LiteralPath $license.Source -Destination (Join-Path $assetDirectory $license.Name) -Force
}
$javaDirectory = Join-Path $toolchainDirectory 'java/jdk-17.0.20.1+1'
$sdkDirectory = Join-Path $toolchainDirectory 'sdk'
foreach ($requiredPath in @(
    (Join-Path $javaDirectory 'bin/javac.exe'),
    (Join-Path $sdkDirectory 'platforms/android-36/android.jar'),
    (Join-Path $sdkDirectory 'build-tools/36.0.0/aapt2.exe'),
    (Join-Path $sdkDirectory 'ndk/27.1.12297006/source.properties'),
    (Join-Path $sdkDirectory 'cmake/3.30.5/bin/cmake.exe')
)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Missing local Android build prerequisite: $requiredPath. See README.md."
    }
}

$buildEnvironment = @{
    JAVA_HOME = $javaDirectory
    ANDROID_HOME = $sdkDirectory
    ANDROID_SDK_ROOT = $sdkDirectory
    # Keep transformed C++ header paths below old SDK Ninja's Windows limit.
    GRADLE_USER_HOME = (Join-Path $projectDirectory '.tools/g')
    PUSHPVP_ANDROID_LAB = 'true'
    EXPO_PUBLIC_ENABLE_DETECTOR_LAB = 'false'
    EXPO_PUBLIC_ENABLE_YOLO_LAB = 'true'
    NODE_ENV = 'production'
}
$previousEnvironment = @{}
foreach ($name in $buildEnvironment.Keys) {
    $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
# Metro copies current assets but leaves files from an older entry point behind.
# Clear only verified generated resources; keep original artwork and native caches.
$generatedResources = Join-Path $projectDirectory 'android/app/build/generated/res/react/release'
if (Test-Path -LiteralPath $generatedResources) {
    $resolvedGeneratedResources = (Resolve-Path -LiteralPath $generatedResources).Path
    $expectedBuildRoot = [System.IO.Path]::GetFullPath((Join-Path $projectDirectory 'android/app/build')) + [System.IO.Path]::DirectorySeparatorChar
    if (-not $resolvedGeneratedResources.StartsWith($expectedBuildRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
        $resolvedGeneratedResources -ne [System.IO.Path]::GetFullPath($generatedResources)) {
        throw 'Generated-resource cleanup escaped the intended Android build directory.'
    }
    if ((Get-Item -LiteralPath $resolvedGeneratedResources).Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        throw 'Refusing generated-resource cleanup through a reparse point.'
    }
    Remove-Item -LiteralPath $resolvedGeneratedResources -Recurse -Force
}
Push-Location (Join-Path $projectDirectory 'android')
try {
    foreach ($name in $buildEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $buildEnvironment[$name], 'Process')
    }
    & .\gradlew.bat :app:assembleRelease --no-daemon --max-workers=2 '-PpushpvpLocalLab=true' "-PreactNativeArchitectures=$Architecture"
    if ($LASTEXITCODE -ne 0) { throw "Android compilation failed (exit $LASTEXITCODE)." }
    $apkPath = Join-Path $projectDirectory 'android/app/build/outputs/apk/release/app-release.apk'
    if (-not (Test-Path -LiteralPath $apkPath)) { throw 'Build returned without the expected APK.' }
    & (Join-Path $sdkDirectory 'build-tools/36.0.0/apksigner.bat') verify $apkPath
    if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
    & (Join-Path $sdkDirectory 'build-tools/36.0.0/zipalign.exe') -c -P 16 4 $apkPath
    if ($LASTEXITCODE -ne 0) { throw 'APK ZIP alignment verification failed.' }
    $badging = & (Join-Path $sdkDirectory 'build-tools/36.0.0/aapt.exe') dump badging $apkPath
    if ($LASTEXITCODE -ne 0 -or -not ($badging -match "^package: name='com.pushpvp.ghostbattle' ")) {
        throw 'APK does not have the isolated local lab application ID.'
    }
    Write-Output "Ghost Battle APK (not installed or uploaded): $apkPath"
}
finally {
    foreach ($name in $previousEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process')
    }
    Pop-Location
}
