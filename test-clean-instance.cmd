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
REM --------------------------------------------------

set "FOLDER="

:parse
if "%~1"=="" goto args_done

if /I "%~1"=="--folder" (
    set "FOLDER=%~2"
    shift
)

shift
goto parse

:args_done

echo Using workspace:
echo   %FOLDER%
echo.

echo Cleaning previous test environment...
rmdir /s /q "%TEMP%\vscode-clean" 2>nul
rmdir /s /q "%TEMP%\vscode-clean-extensions" 2>nul

echo Installing extension and launching VS Code...
code ^
    --extensions-dir "%TEMP%\vscode-clean-extensions" ^
    --install-extension ".\rendercv-vscode-0.0.1.vsix" && ^
code ^
    --user-data-dir "%TEMP%\vscode-clean" ^
    --extensions-dir "%TEMP%\vscode-clean-extensions" ^
    "%FOLDER%" && ^
color 07 && echo. && echo Done! && endlocal

:end