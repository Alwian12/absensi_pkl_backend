@echo off
echo Stopping any running node processes...
taskkill /F /IM node.exe 2>nul
taskkill /F /IM nodemon.exe 2>nul
timeout /t 2 /nobreak >nul
echo.
echo Starting backend server...
node server.js
pause
