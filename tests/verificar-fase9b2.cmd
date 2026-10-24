@echo off
REM FASE 9B-2: verificacion real (PostgreSQL y Ollama locales) de "Mi alimentacion" y su uso con consentimiento.
REM PARTE A: pruebas que levantan su PROPIA instancia temporal de la API (esquemas nv_test_* en nutrivida_test_db,
REM          cuentas SINTETICAS). No escriben en nutrivida_db, no usan tu cuenta ni cambian tus consentimientos.
REM PARTE B: comprobacion SOLO INFORMATIVA del servidor principal (npm start, puerto 3000). Que la parte A pase NO
REM          demuestra que localhost:3000 ejecute el codigo nuevo: se compara la hora de inicio del proceso con la
REM          ultima modificacion del codigo backend (diagnosticar-servidor.cmd).
REM Sin migraciones: no aplica cambios de esquema a nutrivida_db. El catalogo real solo se LEE.
setlocal
chcp 65001 >nul
cd /d "%~dp0.."
set "OUT=docs\evidencias\fase9b2"
if not exist "%OUT%" mkdir "%OUT%"
set "RES=%OUT%\resumen.log"
> "%RES%" echo FASE 9B-2 - %DATE% %TIME%
>> "%RES%" echo === PARTE A: instancias temporales de la API ===
certutil -hashfile data\db.json SHA256 > "%OUT%\db-json-antes.log" 2>&1

echo [1/9] Persistencia, seguridad, consentimiento, seguridad alimentaria y relevancia (fase9b2.test.js) ...
call npm.cmd run test:fase9b2 > "%OUT%\fase9b2-test.log" 2>&1
>> "%RES%" echo fase9b2-persistencia-consentimiento-evaluador-relevancia EXIT=%ERRORLEVEL%
echo [2/9] Suite completa (npm test) ...
call npm.cmd test > "%OUT%\npm-test.log" 2>&1
>> "%RES%" echo npm-test EXIT=%ERRORLEVEL%
echo [3/9] Regresiones FASE 9A, FASE 9B-1 y relevancia ...
call npm.cmd run test:fase9a > "%OUT%\fase9a.log" 2>&1
>> "%RES%" echo fase9a EXIT=%ERRORLEVEL%
call npm.cmd run test:fase9b1 > "%OUT%\fase9b1.log" 2>&1
>> "%RES%" echo fase9b1 EXIT=%ERRORLEVEL%
call npm.cmd run test:ia-relevancia > "%OUT%\ia-relevancia.log" 2>&1
>> "%RES%" echo ia-relevancia EXIT=%ERRORLEVEL%
echo [4/9] Navegador: Mi alimentacion, consentimiento y recomendaciones ...
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
echo [6/9] Ollama real: FASE 9B-2 y FASE 9B-1 (esquemas temporales) ...
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
findstr /c:"ANTERIOR al codigo actual" "%OUT%\diagnostico-servidor.log" >nul && (>> "%RES%" echo ATENCION: el servidor de npm start [puerto 3000] NO ejecuta el codigo de FASE 9B-2. Detenlo con Ctrl+C y ejecuta npm start antes de probar manualmente.)
echo.
type "%RES%"
echo.
findstr /c:"ATENCION" "%RES%" >nul && echo IMPORTANTE: reinicia npm start antes de probar manualmente "Mi alimentacion" en el navegador.
echo Listo. Resultados y capturas en %OUT%. Avisale a Claude.
pause
