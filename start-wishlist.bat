@echo off
title Judi's Wishlist
cd /d "%~dp0"

echo.
echo ================================================
echo   Judi's Wishlist - Starting...
echo ================================================
echo.

REM Check if venv exists
if not exist "venv\Scripts\python.exe" (
    echo ERROR: Virtual environment not found!
    echo.
    echo Please run setup first:
    echo   1. Open Command Prompt in this folder
    echo   2. Run: python -m venv venv
    echo   3. Run: venv\Scripts\pip install Flask
    echo.
    pause
    exit /b 1
)

REM Check if Flask is installed
venv\Scripts\python.exe -c "import flask" 2>nul
if errorlevel 1 (
    echo Flask not installed. Installing now...
    venv\Scripts\pip install Flask
    if errorlevel 1 (
        echo.
        echo ERROR: Failed to install Flask!
        pause
        exit /b 1
    )
)

echo Starting server...
echo.

REM Run the app (NOT minimized so errors are visible)
venv\Scripts\python.exe app.py

REM If we get here, the app crashed or was closed
echo.
echo ================================================
echo   Server stopped.
echo ================================================
echo.
pause
