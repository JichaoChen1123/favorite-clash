@echo off
chcp 65001 >nul
pushd "%~dp0.."
"%~dp0..\.venv\Scripts\python.exe" -B "%~dp0..\scripts\backup_history.py"
if errorlevel 1 echo 备份失败，请保留上方提示。
popd
pause
