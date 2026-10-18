@echo off
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
"%~dp0.venv\Scripts\python.exe" -B "%~dp0scripts\finalize_update.py"
set "activation_exit=%errorlevel%"
pause
exit /b %activation_exit%
