const path=require("node:path");
const {crearPool}=require("../../src/database/pool");
const origen=()=>path.resolve(process.argv.find(a=>a.startsWith("--archivo="))?.slice(10)||path.join(__dirname,"../../data/db.json"));
function fallo(err){
 const codigo=err.codigo || (/^[A-Z][A-Z_]+$/.test(err.message||"")?err.message:"OPERACION_DB_FALLIDA");
 console.error(codigo);
 process.exitCode=1;
}
async function ejecutar(fn){let pool;try{pool=crearPool();console.log(JSON.stringify(await fn(pool)));}catch(err){fallo(err);}finally{if(pool)await pool.end();}}
module.exports={origen,fallo,ejecutar};
