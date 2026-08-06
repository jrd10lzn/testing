@echo off
setlocal

python -m pip install --upgrade pyinstaller
python -m PyInstaller --noconsole --onefile --name LanzadorLocalhost server_launcher.py

echo.
echo Ejecutable generado en dist\LanzadorLocalhost.exe
pause
