@echo off
chcp 65001 >nul
title Voice Chat Server
echo ============================================================
echo   กำลังเริ่มต้น Realistic Roleplay Voice Server...
echo ============================================================
cd /d "%~dp0\server"
node server.js
pause
