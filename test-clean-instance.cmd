@echo off
setlocal
color 0A

echo ==================================================
echo  VS Code Clean Extension Test Environment
echo ==================================================
echo.

REM --------------------------------------------------
REM Parse optional arguments
REM Usage:
REM   test-clean-instance.cmd
REM   test-clean-instance.cmd --folder "C:\Projects\MyProject"
REM   test-clean-instance.cmd --vsix ".\rendercv-vscode-0.5.0.vsix"
REM --------------------------------------------------

set "FOLDER="
set "VSIX="

:parse
if "%~1"=="" goto args_done

if /I "%~1"=="--folder" (
    set "FOLDER=%~2"
    shift
)

if /I "%~1"=="--vsix" (
    set "VSIX=%~2"
    shift
)

shift
goto parse

:args_done

if defined VSIX goto vsix_selected
call :find_latest_vsix

:vsix_selected

if not defined VSIX (
    color 0C
    echo No VSIX file with a version suffix was found in:
    echo   %CD%
    echo.
    echo Pass one explicitly with:
    echo   test-clean-instance.cmd --vsix "path\to\extension.vsix"
    color 07
    exit /b 1
)

if not exist "%VSIX%" (
    color 0C
    echo VSIX file not found:
    echo   %VSIX%
    color 07
    exit /b 1
)

echo Using workspace:
echo   %FOLDER%
echo.
echo Using VSIX:
echo   %VSIX%
echo.

echo Cleaning previous test environment...
rmdir /s /q "%TEMP%\vscode-clean" 2>nul
rmdir /s /q "%TEMP%\vscode-clean-extensions" 2>nul

echo Installing extension and launching VS Code...
code ^
    --extensions-dir "%TEMP%\vscode-clean-extensions" ^
    --install-extension "%VSIX%" && ^
code ^
    --user-data-dir "%TEMP%\vscode-clean" ^
    --extensions-dir "%TEMP%\vscode-clean-extensions" ^
    "%FOLDER%" && ^
color 07 && echo. && echo Done! && endlocal

goto end

:find_latest_vsix
for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -Path (Get-Location) -Filter '*.vsix' -File | ForEach-Object { $match = [regex]::Match($_.BaseName, '(?<version>\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$'); if ($match.Success) { [pscustomobject]@{ FullName = $_.FullName; Version = [version]($match.Groups['version'].Value -replace '[-+].*$', '') } } } | Sort-Object Version -Descending | Select-Object -First 1 -ExpandProperty FullName"`) do set "VSIX=%%I"
exit /b 0

:end
