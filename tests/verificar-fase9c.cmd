@echo off
REM FASE 9C: verificacion real (PostgreSQL y Ollama locales) del resumen limitado de compras ENTREGADAS, usado solo con
REM el consentimiento de historial (autoriza_historial_ia), y regresiones de FASE 9A, 9B-1 y 9B-2.
REM PARTE A: pruebas que levantan su PROPIA instancia temporal de la API (esquemas nv_test_* en nutrivida_test_db,
REM          cuentas SINTETICAS). No escriben en nutrivida_db, no usan tu cuenta ni cambian tus consentimientos.
REM PARTE B: comprobacion SOLO INFORMATIVA del servidor principal (npm start, puerto 3000). Que la parte A pase NO
REM          demuestra que localhost:3000 ejecute el codigo nuevo: se compara la hora de inicio del proceso con la
REM          ultima modificacion del codigo backend (diagnosticar-servidor.cmd).
REM Sin migraciones: no aplica cambios de esquema a nutrivida_db. El catalogo real solo se LEE.
setlocal
chcp 65001 >nul
cd /d "%~dp0.."
set "OUT=docs\evidencias\fase9c"
if not exist "%OUT%" mkdir "%OUT%"
set "RES=%OUT%\resumen.log"
> "%RES%" echo FASE 9C - %DATE% %TIME%
>> "%RES%" echo === PARTE A: instancias temporales de la API ===
certutil -hashfile data\db.json SHA256 > "%OUT%\db-json-antes.log" 2>&1

echo [1/9] FASE 9C: resumen de pedidos ENTREGADOS, consentimiento, aislamiento, privacidad y relevancia (fase9c.test.js) ...
call npm.cmd run test:fase9c > "%OUT%\fase9c-test.log" 2>&1
>> "%RES%" echo fase9c-historial-consentimiento-privacidad-relevancia EXIT=%ERRORLEVEL%
echo [2/9] Suite completa (npm test) ...
call npm.cmd test > "%OUT%\npm-test.log" 2>&1
>> "%RES%" echo npm-test EXIT=%ERRORLEVEL%
echo [3/9] Regresiones FASE 9A, FASE 9B-1, FASE 9B-2 y relevancia ...
call npm.cmd run test:fase9a > "%OUT%\fase9a.log" 2>&1
>> "%RES%" echo fase9a EXIT=%ERRORLEVEL%
call npm.cmd run test:fase9b1 > "%OUT%\fase9b1.log" 2>&1
>> "%RES%" echo fase9b1 EXIT=%ERRORLEVEL%
call npm.cmd run test:fase9b2 > "%OUT%\fase9b2.log" 2>&1
>> "%RES%" echo fase9b2 EXIT=%ERRORLEVEL%
call npm.cmd run test:ia-relevancia > "%OUT%\ia-relevancia.log" 2>&1
>> "%RES%" echo ia-relevancia EXIT=%ERRORLEVEL%
echo [4/9] Navegador: FASE 9C (consentimiento de historial y recomendaciones) y FASE 9B-2 ...
call npm.cmd run test:browser:fase9c > "%OUT%\navegador-fase9c.log" 2>&1
>> "%RES%" echo navegador-fase9c EXIT=%ERRORLEVEL%
call npm.cmd run test:browser:fase9b2 > "%OUT%\navegador-fase9b2.log" 2>&1
>> "%RES%" echo navegador-fase9b2 EXIT=%ERRORLEVEL%
REM Sincronizacion del consentimiento (correccion del defecto heredado de FASE 9A): cargas tardias, guardados en vuelo y fallos.
call npm.cmd run test:browser:fase9b2:consentimiento > "%OUT%\navegador-fase9b2-consentimiento.log" 2>&1
>> "%RES%" echo navegador-fase9b2-consentimiento EXIT=%ERRORLEVEL%
echo [5/9] Navegador: regresiones FASE 9B-1, FASE 9A y tarjetas ...
call npm.cmd run test:browser:fase9b1 > "%OUT%\navegador-fase9b1.log" 2>&1
>> "%RES%" echo navegador-fase9b1 EXIT=%ERRORLEVEL%
call npm.cmd run test:browser:fase9a > "%OUT%\navegador-fase9a.log" 2>&1
>> "%RES%" echo navegador-fase9a EXIT=%ERRORLEVEL%
call npm.cmd run test:browser:ia-tarjetas > "%OUT%\navegador-ia-tarjetas.log" 2>&1
>> "%RES%" echo navegador-ia-tarjetas EXIT=%ERRORLEVEL%
echo [6/9] Ollama real: FASE 9C, FASE 9B-2 y FASE 9B-1 (esquemas temporales) ...
call npm.cmd run test:fase9c:ollama > "%OUT%\fase9c-ollama-real.log" 2>&1
>> "%RES%" echo fase9c-ollama-real EXIT=%ERRORLEVEL%
call npm.cmd run test:fase9b2:ollama > "%OUT%\fase9b2-ollama-real.log" 2>&1
>> "%RES%" echo fase9b2-ollama-real EXIT=%ERRORLEVEL%
call npm.cmd run test:fase9b1:ollama > "%OUT%\fase9b1-ollama-real.log" 2>&1
>> "%RES%" echo fase9b1-ollama-real EXIT=%ERRORLEVEL%
echo [7/9] Catalogo real con Ollama real (solo lectura, sin perfil) ...
call npm.cmd run ia:productos-reales > "%OUT%\ia-productos-reales.log" 2>&1
>> "%RES%" echo ia-productos-reales EXIT=%ERRORLEVEL%
echo [8/9] Integridad historica, conversaciones heredadas y data/db.json ...
call npm.cmd run db:verificar-importacion > "%OUT%\verificar-importacion.log" 2>&1
>> "%RES%" echo verificar-importacion EXIT=%ERRORLEVEL%
node tests\conversaciones-heredadas.js > "%OUT%\conversaciones-heredadas.log" 2>&1
>> "%RES%" echo conversaciones-heredadas EXIT=%ERRORLEVEL%
certutil -hashfile data\db.json SHA256 > "%OUT%\db-json-despues.log" 2>&1
fc /b "%OUT%\db-json-antes.log" "%OUT%\db-json-despues.log" >nul
>> "%RES%" echo db-json-sin-cambios EXIT=%ERRORLEVEL%

echo [9/9] PARTE B: servidor principal npm start (puerto 3000), solo informativo ...
>> "%RES%" echo === PARTE B: servidor principal (informativo) ===
call tests\diagnosticar-servidor.cmd < nul > "%OUT%\diagnostico-servidor.log" 2>&1
powershell -NoProfile -Command "try{$r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 http://127.0.0.1:3000/api/salud; 'GET /api/salud -> ' + $r.StatusCode}catch{'Servidor en 3000 no disponible: ' + $_.Exception.Message}" >> "%OUT%\diagnostico-servidor.log" 2>&1
>> "%RES%" echo diagnostico-servidor (informativo, ver diagnostico-servidor.log)
findstr /c:"ANTERIOR al codigo actual" "%OUT%\diagnostico-servidor.log" >nul && (>> "%RES%" echo ATENCION: el servidor de npm start [puerto 3000] NO ejecuta el codigo actual de FASE 9C. Detenlo con Ctrl+C y ejecuta npm start antes de probar manualmente.)
echo.
type "%RES%"
echo.
findstr /c:"ATENCION" "%RES%" >nul && echo IMPORTANTE: reinicia npm start antes de probar manualmente la personalizacion en el navegador.
REM Resultado global: solo la PARTE A es obligatoria. Debe haber %ESPERADAS% lineas "EXIT=0" y ninguna con otro codigo.
REM La PARTE B no escribe lineas EXIT, por eso no influye. Sin parentesis dentro de textos echo.
set "ESPERADAS=19"
set "CODIGO=0"
set "APROBADAS=0"
for /f %%n in ('findstr /c:" EXIT=0" "%RES%" ^| find /c /v ""') do set "APROBADAS=%%n"
findstr /r /c:" EXIT=[1-9]" /c:" EXIT=-" "%RES%" >nul && set "CODIGO=1"
if not "%APROBADAS%"=="%ESPERADAS%" set "CODIGO=1"
if "%CODIGO%"=="0" >> "%RES%" echo RESULTADO GLOBAL PARTE A: APROBADO, %APROBADAS% de %ESPERADAS% comprobaciones con codigo 0
if not "%CODIGO%"=="0" >> "%RES%" echo RESULTADO GLOBAL PARTE A: FALLIDO, %APROBADAS% de %ESPERADAS% comprobaciones con codigo 0
echo.
findstr /c:"RESULTADO GLOBAL" "%RES%"
echo Listo. Resultados y capturas en %OUT%. Avisale a Claude.
pause
exit /b %CODIGO%
