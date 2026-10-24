@echo off
REM Verificacion FASES 6-8 en Windows (Ollama, PostgreSQL y navegador reales).
REM Solo lee nutrivida_db; las pruebas usan esquemas temporales nv_test_* en DB_TEST_NAME.
setlocal
chcp 65001 >nul
cd /d "%~dp0.."
set "OUT=docs\evidencias\verificacion-fase6-8"
if not exist "%OUT%" mkdir "%OUT%"

echo [1/7] Ollama en localhost:11434 ...
curl.exe -s -m 5 http://localhost:11434/api/tags > "%OUT%\ollama-tags.json" 2>&1

echo [2/7] Suite completa (npm test). Puede tardar unos minutos ...
call npm.cmd test > "%OUT%\npm-test.log" 2>&1
>> "%OUT%\npm-test.log" echo EXIT=%ERRORLEVEL%

echo [3/7] Navegador FASES 6-8 (incluye NutriVida AI con Ollama real) ...
call npm.cmd run test:browser:fase6-8 > "%OUT%\navegador-fase6-8.log" 2>&1
>> "%OUT%\navegador-fase6-8.log" echo EXIT=%ERRORLEVEL%

echo [4/7] Navegador FASES 4-5 (regresion) ...
call npm.cmd run test:browser:fase5 > "%OUT%\navegador-fase4-5.log" 2>&1
>> "%OUT%\navegador-fase4-5.log" echo EXIT=%ERRORLEVEL%

echo [5/7] UML (requiere PLANTUML_JAR) ...
call npm.cmd run uml:validar > "%OUT%\uml.log" 2>&1
>> "%OUT%\uml.log" echo EXIT=%ERRORLEVEL%

echo [6/7] PostgreSQL, solo lectura ...
node tests\estado-postgres.js > "%OUT%\postgres.json" 2>&1

echo [7/7] Reinicio del servidor con el mecanismo oficial (npm start) ...
:esperar
netstat -ano | findstr /R /C:":3000 .*LISTENING" >nul
if not errorlevel 1 (
  echo.
  echo   Hay un servidor VIEJO escuchando en el puerto 3000.
  echo   Ve a la ventana donde lo iniciaste y detenlo con Ctrl+C.
  echo   Luego vuelve aqui y presiona una tecla.
  pause >nul
  goto esperar
)
start "NutriVida servidor" cmd /k npm.cmd start
echo.
echo Listo. Resultados en %OUT%
echo El servidor nuevo se abrio en otra ventana: http://localhost:3000
echo Avisale a Claude para que revise los resultados.
pause
