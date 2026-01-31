@echo off
title Judi's Wishlist - Setup
cd /d "%~dp0"

echo.
echo ================================================
echo   Judi's Wishlist - First Time Setup
echo ================================================
echo.

REM Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo ================================================
    echo   ERROR: Python is not installed!
    echo ================================================
    echo.
    echo Python is required to run this app.
    echo.
    echo HOW TO INSTALL PYTHON:
    echo.
    echo   1. Go to: https://www.python.org/downloads/
    echo.
    echo   2. Click the big yellow "Download Python" button
    echo.
    echo   3. Run the installer
    echo.
    echo   4. IMPORTANT: Check the box that says:
    echo      [x] "Add Python to PATH"
    echo.
    echo   5. Click "Install Now"
    echo.
    echo   6. After installation, RESTART your computer
    echo.
    echo   7. Run this setup.bat again
    echo.
    echo ================================================
    echo.
    echo Press any key to open the Python download page...
    pause >nul
    start https://www.python.org/downloads/
    exit /b 1
)

echo Python found:
python --version
echo.

REM Create virtual environment if it doesn't exist
if not exist "venv" (
    echo Creating virtual environment...
    python -m venv venv
    if errorlevel 1 (
        echo.
        echo ERROR: Failed to create virtual environment!
        echo.
        echo Try running this command manually:
        echo   python -m venv venv
        echo.
        pause
        exit /b 1
    )
    echo Virtual environment created successfully.
) else (
    echo Virtual environment already exists.
)

echo.
echo Installing dependencies...
venv\Scripts\pip install --upgrade pip
venv\Scripts\pip install Flask==3.0.0 requests==2.31.0

if errorlevel 1 (
    echo.
    echo ERROR: Failed to install dependencies!
    echo.
    pause
    exit /b 1
)

echo.
echo ================================================
echo   Setup Complete!
echo ================================================
echo.
echo You can now run "start-wishlist.bat" to start the app.
echo.
pause
