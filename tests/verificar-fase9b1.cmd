@echo off
REM FASE 9B-1: verificacion real (PostgreSQL y Ollama locales) del evaluador de restricciones alimentarias.
REM Las pruebas usan nutrivida_test_db con esquemas temporales nv_test_* y cuentas SINTETICAS.
REM El catalogo real de nutrivida_db solo se LEE (transaccion READ ONLY). No crea migraciones, no cambia
REM perfiles, consentimientos, productos, ingredientes, precios, inventario, pedidos ni conversaciones.
setlocal
chcp 65001 >nul
cd /d "%~dp0.."
set "OUT=docs\evidencias\fase9b1"
if not exist "%OUT%" mkdir "%OUT%"
set "RES=%OUT%\resumen.log"
> "%RES%" echo FASE 9B-1 - %DATE% %TIME%
certutil -hashfile data\db.json SHA256 > "%OUT%\db-json-antes.log" 2>&1

echo [1-4/10] Evaluador, deteccion, integracion con relevancia y respaldo (fase9b1.test.js) ...
call npm.cmd run test:fase9b1 > "%OUT%\fase9b1-test.log" 2>&1
>> "%RES%" echo fase9b1-evaluador-deteccion-relevancia-respaldo-api EXIT=%ERRORLEVEL%
echo [5/10] Suite completa (npm test) ...
call npm.cmd test > "%OUT%\npm-test.log" 2>&1
>> "%RES%" echo npm-test EXIT=%ERRORLEVEL%
echo [6/10] Regresion de relevancia, respaldo y consentimientos ...
call npm.cmd run test:ia-relevancia > "%OUT%\ia-relevancia.log" 2>&1
>> "%RES%" echo ia-relevancia EXIT=%ERRORLEVEL%
call npm.cmd run test:fase9a > "%OUT%\fase9a.log" 2>&1
>> "%RES%" echo fase9a EXIT=%ERRORLEVEL%
echo [7/10] HTTP: diagnostico del servidor en ejecucion (si esta abierto) ...
REM Las pruebas HTTP reales (POST /api/consultas) se ejecutan en el paso 1 contra una instancia temporal de la API.
REM Aqui solo se informa si el servidor de desarrollo (puerto 3000) ejecuta el codigo actual (reinicialo si no).
call tests\diagnosticar-servidor.cmd < nul > "%OUT%\diagnostico-servidor.log" 2>&1
powershell -NoProfile -Command "try{$r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 http://127.0.0.1:3000/api/salud; 'GET /api/salud -> ' + $r.StatusCode}catch{'Servidor en 3000 no disponible: ' + $_.Exception.Message}" >> "%OUT%\diagnostico-servidor.log" 2>&1
>> "%RES%" echo diagnostico-servidor (informativo, ver diagnostico-servidor.log)
REM Las pruebas manuales en el navegador usan el servidor de npm start: si es anterior al codigo, responde con la logica vieja.
findstr /c:"ANTERIOR al codigo actual" "%OUT%\diagnostico-servidor.log" >nul && (>> "%RES%" echo ATENCION: el servidor de npm start [puerto 3000] ejecuta codigo ANTERIOR a FASE 9B-1. Detenlo con Ctrl+C y ejecuta npm start antes de probar manualmente.)
echo [8/10] Navegador: restricciones, tarjetas y regresiones ...
call npm.cmd run test:browser:fase9b1 > "%OUT%\navegador-fase9b1.log" 2>&1
>> "%RES%" echo navegador-fase9b1 EXIT=%ERRORLEVEL%
call npm.cmd run test:browser:ia-tarjetas > "%OUT%\navegador-ia-tarjetas.log" 2>&1
>> "%RES%" echo navegador-ia-tarjetas EXIT=%ERRORLEVEL%
call npm.cmd run test:browser:fase9a > "%OUT%\navegador-fase9a.log" 2>&1
>> "%RES%" echo navegador-fase9a EXIT=%ERRORLEVEL%
echo [9/10] Ollama real: flujo completo (esquema temporal) y catalogo real (solo lectura) ...
call npm.cmd run test:fase9b1:ollama > "%OUT%\fase9b1-ollama-real.log" 2>&1
>> "%RES%" echo fase9b1-ollama-real EXIT=%ERRORLEVEL%
call npm.cmd run ia:productos-reales > "%OUT%\ia-productos-reales.log" 2>&1
>> "%RES%" echo ia-productos-reales EXIT=%ERRORLEVEL%
REM Flujo completo de los 6 casos de la revision manual con el catalogo REAL (solo lectura) y Ollama real.
call npm.cmd run ia:diagnosticar-restricciones -- --ollama > "%OUT%\diagnostico-restricciones.log" 2>&1
>> "%RES%" echo diagnostico-restricciones-6-casos EXIT=%ERRORLEVEL%
echo [10/10] Integridad historica, conversaciones heredadas y data/db.json ...
call npm.cmd run db:verificar-importacion > "%OUT%\verificar-importacion.log" 2>&1
>> "%RES%" echo verificar-importacion EXIT=%ERRORLEVEL%
node tests\conversaciones-heredadas.js > "%OUT%\conversaciones-heredadas.log" 2>&1
>> "%RES%" echo conversaciones-heredadas EXIT=%ERRORLEVEL%
certutil -hashfile data\db.json SHA256 > "%OUT%\db-json-despues.log" 2>&1
fc /b "%OUT%\db-json-antes.log" "%OUT%\db-json-despues.log" >nul
>> "%RES%" echo db-json-sin-cambios EXIT=%ERRORLEVEL%
echo.
type "%RES%"
echo.
findstr /c:"ATENCION" "%RES%" >nul && echo IMPORTANTE: reinicia npm start antes de repetir tus pruebas manuales en el navegador.
echo Listo. Resultados y capturas en %OUT%. Avisale a Claude.
pause
