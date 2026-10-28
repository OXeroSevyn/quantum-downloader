@echo off
set SCRIPT_DIR=%~dp0
set MANIFEST_PATH=%SCRIPT_DIR%quantum_host.json

echo Registering Quantum Downloader for Chrome, Edge, and Brave...
REG ADD "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.quantum.downloader" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f
REG ADD "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.quantum.downloader" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f
REG ADD "HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.quantum.downloader" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f
REG ADD "HKCU\Software\Mozilla\NativeMessagingHosts\com.quantum.downloader" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f

echo.
echo [OK] Quantum Downloader Native Messaging Registered Successfully!
pause
