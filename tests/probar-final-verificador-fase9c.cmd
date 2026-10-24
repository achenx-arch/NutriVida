@echo off
REM Prueba AISLADA del bloque final de tests\verificar-fase9c.cmd (no ejecuta pruebas, no usa BD ni Ollama).
REM 1) Reproduce la linea ATENCION anterior, con "(FASE 9C)" dentro de un bloque && ( ... ).
REM 2) Ejecuta la linea ATENCION corregida, copiada tal cual del verificador.
REM 3) Ejecuta el calculo del RESULTADO GLOBAL, copiado tal cual del verificador, sobre resumenes sinteticos en %TEMP%.
REM El diagnostico sintetico simula un servidor ANTERIOR para ejecutar tambien la rama ATENCION.
REM No modifica docs\evidencias ni el verificador.
setlocal
set "T=%TEMP%\nv-fase9c-final"
if not exist "%T%" mkdir "%T%"
echo RESULTADO: el servidor es ANTERIOR al codigo actual.> "%T%\diagnostico-servidor.log"

echo === 1. Linea ANTERIOR, se espera el error "No se esperaba . en este momento." ===
> "%T%\vieja.cmd" echo @echo off
>> "%T%\vieja.cmd" echo set "OUT=%T%"
>> "%T%\vieja.cmd" echo set "RES=%T%\res-vieja.log"
>> "%T%\vieja.cmd" echo findstr /c:"ANTERIOR al codigo actual" "%%OUT%%\diagnostico-servidor.log" ^>nul ^&^& (^>^> "%%RES%%" echo ATENCION: el servidor de npm start [puerto 3000] NO ejecuta el codigo actual (FASE 9C^). Detenlo con Ctrl+C y ejecuta npm start antes de probar manualmente.^)
>> "%T%\vieja.cmd" echo echo LINEA-VIEJA-SUPERADA
cmd /d /c "%T%\vieja.cmd"

echo === 2 y 3. Bloque final ACTUAL del verificador ===
powershell -NoProfile -Command "$l=Get-Content -LiteralPath 'tests\verificar-fase9c.cmd'; $a=($l|Select-String -SimpleMatch 'findstr /c:\"ANTERIOR al codigo actual\"').LineNumber; $i=($l|Select-String -SimpleMatch 'REM Resultado global').LineNumber; $f=($l|Select-String -SimpleMatch 'findstr /c:\"RESULTADO GLOBAL\"').LineNumber; @('@echo off','setlocal','set \"OUT=%T%\"','set \"RES=%%~1\"') + $l[$a-1] + 'echo LINEA-NUEVA-SUPERADA' + $l[($i-1)..($f-1)] + 'exit /b %%CODIGO%%' | Set-Content -Encoding ascii -LiteralPath '%T%\final.cmd'"

set "OK19=%T%\ok19.log"
> "%OK19%" echo === PARTE A ===
for /l %%i in (1,1,19) do >> "%OK19%" echo prueba%%i EXIT=0
>> "%OK19%" echo === PARTE B: servidor principal (informativo) ===
copy /y "%OK19%" "%T%\uno-falla.log" >nul
>> "%T%\uno-falla.log" echo ia-productos-reales EXIT=1
> "%T%\falta-una.log" echo === PARTE A ===
for /l %%i in (1,1,18) do >> "%T%\falta-una.log" echo prueba%%i EXIT=0

set "FALLOS=0"
call "%T%\final.cmd" "%OK19%" & call :espera 0 "19 de 19 EXIT=0"
call "%T%\final.cmd" "%T%\uno-falla.log" & call :espera 1 "una prueba con EXIT=1"
call "%T%\final.cmd" "%T%\falta-una.log" & call :espera 1 "solo 18 lineas EXIT=0"
echo.
if "%FALLOS%"=="0" (echo PRUEBA AISLADA: APROBADA) else (echo PRUEBA AISLADA: FALLIDA)
exit /b %FALLOS%

:espera
if "%ERRORLEVEL%"=="%~1" (echo   OK: %~2 devuelve %~1) else (echo   ERROR: %~2 devolvio %ERRORLEVEL%, se esperaba %~1& set "FALLOS=1")
exit /b 0
