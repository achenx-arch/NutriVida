const fs=require("node:fs");const path=require("node:path");const {spawnSync}=require("node:child_process");
const jar=process.env.PLANTUML_JAR;
if(!jar || !fs.existsSync(jar)){console.error("Configura PLANTUML_JAR con el validador local; no es una dependencia de la aplicación.");process.exitCode=1;}
else{
 const carpeta=path.resolve(__dirname,"../../docs/uml");
 const archivos=fs.readdirSync(carpeta).filter(n=>/^[1-5][. -]/.test(n)&&/\.(txt|puml)$/.test(n)).map(n=>path.join(carpeta,n));
 if(archivos.length!==5)throw new Error("Se requieren cinco diagramas oficiales.");
 const resultado=spawnSync("java",["-jar",jar,"-checkonly","-charset","UTF-8",...archivos],{encoding:"utf8"});
 if(resultado.error||resultado.status!==0){console.error(resultado.stderr||"VALIDACION_UML_FALLIDA");process.exitCode=1;}
 else console.log("5 diagramas PlantUML válidos.");
}
