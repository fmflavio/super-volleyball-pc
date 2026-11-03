@echo off
chcp 65001 >nul
title Super Volley Ball (Mega Drive / Genesis) - PC Windows Edition
cd /d "%~dp0"

if exist "SuperVolleyBall.exe" (
    start "" "SuperVolleyBall.exe"
) else (
    start "" "index.html"
)
