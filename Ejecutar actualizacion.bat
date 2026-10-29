@echo off
rem Queda atendiendo el boton "Actualizar" de la app y actualiza sola cada hora.
cd /d "%~dp0"
".venv\Scripts\python.exe" worker\actualizar.py --escuchar
