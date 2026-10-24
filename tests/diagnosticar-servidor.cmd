@echo off
REM Solo lectura: indica si el servidor Node en el puerto 3000 se inicio ANTES de la ultima modificacion del codigo.
REM Si es asi, el navegador recibe HTML/JS nuevos (archivos estaticos) pero rutas antiguas: reinicia el servidor.
chcp 65001 >nul
cd /d "%~dp0.."
powershell -NoProfile -Command "$c=Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if(-not $c){'Ningun proceso escucha en el puerto 3000'; exit}; $p=Get-Process -Id $c.OwningProcess; $ult=(Get-ChildItem src -Recurse -Filter *.js | Sort-Object LastWriteTime -Descending | Select-Object -First 1); 'Servidor: ' + $p.ProcessName + ' PID ' + $p.Id + ' iniciado ' + $p.StartTime.ToString('yyyy-MM-dd HH:mm:ss'); 'Ultimo cambio de codigo backend: ' + $ult.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss') + ' (' + $ult.Name + ')'; if($p.StartTime -lt $ult.LastWriteTime){'RESULTADO: el servidor es ANTERIOR al codigo actual. Detenlo (Ctrl+C) y vuelve a ejecutar npm start.'} else {'RESULTADO: el servidor ejecuta el codigo actual.'}"
pause
