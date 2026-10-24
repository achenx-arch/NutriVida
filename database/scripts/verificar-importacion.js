const {origen}=require("./comun");
const {crearPool}=require("../../src/database/pool");
// Integridad histórica estricta + CAMBIO_POSTERIOR_AUDITADO (ver src/database/importacion.js).
(async()=>{
 const pool=crearPool();
 try{console.log(JSON.stringify(await require("../../src/database/importacion").verificarImportacion(pool,origen()),null,1));}
 catch(err){
  const codigo=err.codigo||(/^[A-Z][A-Z_]+$/.test(err.message||"")?err.message:"OPERACION_DB_FALLIDA");
  console.error(codigo);
  if(err.conflictos)console.error(JSON.stringify({conflictos:err.conflictos,cambiosPosteriores:err.cambiosPosteriores},null,1));
  process.exitCode=1;
 }finally{await pool.end();}
})();
