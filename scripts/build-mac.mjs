import { packager } from '@electron/packager';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distMacDir = path.join(rootDir, 'dist-mac');
const stagingDir = path.join(distMacDir, 'staging');
const dmgStagingDir = path.join(distMacDir, 'dmg-root');

async function buildMac() {
  console.log('🚀 Starting Quantum Downloader macOS build pipeline...');

  // 1. Ensure clean dist-mac directory
  if (fs.existsSync(distMacDir)) {
    fs.rmSync(distMacDir, { recursive: true, force: true });
  }
  fs.mkdirSync(distMacDir, { recursive: true });
  fs.mkdirSync(stagingDir, { recursive: true });
  fs.mkdirSync(dmgStagingDir, { recursive: true });

  // 2. Package macOS .app with @electron/packager
  console.log('📦 Packaging macOS .app bundle using @electron/packager (darwin-x64)...');
  const appPaths = await packager({
    dir: rootDir,
    name: 'Quantum Downloader',
    platform: 'darwin',
    arch: 'x64',
    out: stagingDir,
    overwrite: true,
    prune: true,
    ignore: [
      /^\/dist-package/,
      /^\/dist-mac/,
      /^\/src/,
      /^\/electron/,
      /^\/\.git/,
      /^\/scripts/,
      /^\/\.vscode/,
      /^\/\.agents/,
    ],
    extraResource: [path.join(rootDir, 'bin')],
    appBundleId: 'com.quantum.downloader',
    appCategoryType: 'public.app-category.utilities',
  });

  const sourceAppPath = path.join(appPaths[0], 'Quantum Downloader.app');
  const targetAppPath = path.join(dmgStagingDir, 'Quantum Downloader.app');
  const finalAppCopy = path.join(distMacDir, 'Quantum Downloader.app');

  console.log(`✅ Packaged macOS App: ${sourceAppPath}`);

  // 3. Copy app to DMG staging directory and standalone app directory
  console.log('📂 Staging macOS bundle files...');
  fs.cpSync(sourceAppPath, targetAppPath, { recursive: true });
  fs.cpSync(sourceAppPath, finalAppCopy, { recursive: true });

  // Add Installation Guide & Applications shortcut text in the DMG
  const guideText = `=====================================================
Quantum Downloader - macOS Installation Instructions
=====================================================

1. Drag "Quantum Downloader.app" into your Applications folder:
   /Applications

2. If macOS displays a message saying "Quantum Downloader cannot be opened because it is from an unidentified developer":
   - Open System Settings -> Privacy & Security
   - Scroll down to "Security" and click "Open Anyway"
   
   OR simply run this one-time command in macOS Terminal:
   xattr -cr "/Applications/Quantum Downloader.app"

3. Universal Companion Browser Extension:
   - Load the "extension" folder into Chrome, Edge, Brave, or Firefox via developer mode (Load Unpacked).
   - Local Acceleration Bridge operates at 127.0.0.1:52345.

Enjoy high-speed multi-threaded acceleration!
`;
  fs.writeFileSync(path.join(dmgStagingDir, 'INSTALL_INSTRUCTIONS.txt'), guideText, 'utf-8');

  // 4. Build .dmg Apple Disk Image using Windows COM IMAPI2FS (ISO9660 + Joliet + UDF)
  console.log('💿 Generating Quantum Downloader.dmg Apple Disk Image...');
  const dmgOutputFile = path.join(distMacDir, 'Quantum Downloader.dmg');
  
  const psScript = `
Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

public class StreamHelper {
    public static void CopyIStreamToFile(object comStream, string destPath) {
        IStream stream = (IStream)comStream;
        using (FileStream fs = new FileStream(destPath, FileMode.Create, FileAccess.Write)) {
            byte[] buffer = new byte[65536];
            IntPtr pcbRead = Marshal.AllocHGlobal(sizeof(int));
            try {
                while (true) {
                    stream.Read(buffer, buffer.Length, pcbRead);
                    int read = Marshal.ReadInt32(pcbRead);
                    if (read <= 0) break;
                    fs.Write(buffer, 0, read);
                }
            } finally {
                Marshal.FreeHGlobal(pcbRead);
            }
        }
    }
}
"@

$fsi = New-Object -ComObject IMAPI2FS.MsftFileSystemImage
$fsi.ChooseImageDefaultsForMediaType(12)
$fsi.FileSystemsToCreate = 7 # ISO9660 (1) + Joliet (2) + UDF (4)
$fsi.VolumeName = "QuantumDownloader"
$fsi.Root.AddTree("${dmgStagingDir.replace(/\\/g, '\\\\')}", $false)

$resultImage = $fsi.CreateResultImage()
[StreamHelper]::CopyIStreamToFile($resultImage.ImageStream, "${dmgOutputFile.replace(/\\/g, '\\\\')}")
`;

  fs.writeFileSync(path.join(distMacDir, 'build_dmg_helper.ps1'), psScript, 'utf-8');
  execSync(`powershell -ExecutionPolicy Bypass -File "${path.join(distMacDir, 'build_dmg_helper.ps1')}"`, { stdio: 'inherit' });
  fs.unlinkSync(path.join(distMacDir, 'build_dmg_helper.ps1'));

  // 5. Create Quantum Downloader-macOS.zip archive
  console.log('🗜️ Creating Quantum Downloader-macOS.zip archive...');
  const zipOutputFile = path.join(distMacDir, 'Quantum Downloader-macOS.zip');
  execSync(`powershell -Command "Compress-Archive -Path '${finalAppCopy.replace(/\\/g, '\\\\')}' -DestinationPath '${zipOutputFile.replace(/\\/g, '\\\\')}' -Force"`, { stdio: 'inherit' });

  // 6. Write Markdown Documentation in dist-mac
  fs.writeFileSync(path.join(distMacDir, 'README_MAC.md'), `# Quantum Downloader for macOS

This folder contains the complete macOS release package for **Quantum Downloader**:

## Contents:
1. **\`Quantum Downloader.dmg\`** (~100MB)
   - Apple Disk Image installer.
   - Double-click to mount as a volume, then drag \`Quantum Downloader.app\` to \`/Applications\`.

2. **\`Quantum Downloader-macOS.zip\`**
   - Direct compressed archive of the application.
   - Unzip anywhere on your Mac and run immediately.

3. **\`Quantum Downloader.app\`**
   - Fully unpacked macOS Application Bundle (x64 Intel & Rosetta 2 on Apple Silicon).

## Gatekeeper First-Launch Tip:
Since this build is created outside Apple's paid Developer ID program, macOS Gatekeeper may ask for confirmation on first launch.
To launch:
- Right-click \`Quantum Downloader.app\` and click **Open**, then click **Open**.
OR
- Run in Terminal:
\`\`\`bash
xattr -cr "/Applications/Quantum Downloader.app"
\`\`\`
`, 'utf-8');

  // 7. Clean up staging folders
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.rmSync(dmgStagingDir, { recursive: true, force: true });

  console.log('\n🎉 macOS Build Completed Successfully!');
  console.log(`📁 Destination Folder: ${distMacDir}`);
  console.log(`💿 Disk Image: ${dmgOutputFile} (${(fs.statSync(dmgOutputFile).size / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`🗜️ Zip Archive: ${zipOutputFile} (${(fs.statSync(zipOutputFile).size / 1024 / 1024).toFixed(1)} MB)`);
}

buildMac().catch(err => {
  console.error('❌ Build failed:', err);
  process.exit(1);
});
