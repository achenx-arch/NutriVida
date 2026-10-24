@echo off
REM Verificacion de la correccion FASE 8 (RESPUESTA_INVALIDA). Solo lectura sobre nutrivida_db.
setlocal
chcp 65001 >nul
cd /d "%~dp0.."
set "OUT=docs\evidencias\verificacion-fase8"
if not exist "%OUT%" mkdir "%OUT%"

echo [1/6] Pruebas FASE 8 ...
call npm.cmd run test:fase8 > "%OUT%\fase8-test.log" 2>&1
>> "%OUT%\fase8-test.log" echo EXIT=%ERRORLEVEL%

echo [2/6] Suite completa (npm test) ...
call npm.cmd test > "%OUT%\npm-test.log" 2>&1
>> "%OUT%\npm-test.log" echo EXIT=%ERRORLEVEL%

echo [3/6] Ollama real con el codigo del backend (sin escrituras) ...
node tests\prueba-ollama-real.js > "%OUT%\ollama-real.json" 2>&1

echo [4/6] Conversaciones heredadas frente a data\db.json (solo lectura) ...
call npm.cmd run db:verificar-importacion > "%OUT%\verificar-importacion.log" 2>&1
>> "%OUT%\verificar-importacion.log" echo EXIT=%ERRORLEVEL%

echo [5/6] Estado PostgreSQL (solo lectura) ...
node tests\estado-postgres.js > "%OUT%\postgres.json" 2>&1

echo [6/6] Reinicio del servidor (npm start) ...
:esperar
netstat -ano | findstr /R /C:":3000 .*LISTENING" >nul
if not errorlevel 1 (
  echo.
  echo   Hay un servidor escuchando en el puerto 3000.
  echo   Detenlo con Ctrl+C en su ventana y luego presiona una tecla aqui.
  pause >nul
  goto esperar
)
start "NutriVida servidor" cmd /k npm.cmd start
echo.
echo Listo. Resultados en %OUT%
pause
