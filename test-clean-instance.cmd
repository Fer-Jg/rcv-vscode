@echo off
setlocal
color 0A

echo ==================================================
echo  VS Code Clean Extension Test Environment
echo ==================================================
echo.

rmdir /s /q "%TEMP%\vscode-clean" 2>nul & rmdir /s /q "%TEMP%\vscode-clean-extensions" 2>nul & code --extensions-dir "%TEMP%\vscode-clean-extensions" --install-extension ".\rendercv-vscode-0.0.1.vsix" && code --user-data-dir "%TEMP%\vscode-clean" --extensions-dir "%TEMP%\vscode-clean-extensions" && color 07 && echo Done! && endlocal