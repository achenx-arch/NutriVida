const { ErrorAplicacion } = require("../../errors/ErrorAplicacion");
const { transaccion } = require("../../database/transaccion");
function traducir(err) {
  if(err instanceof ErrorAplicacion) return err;
  if(err.code==="23505") return new ErrorAplicacion("Ya existe un registro con esos datos únicos.",409,"DATO_DUPLICADO");
  if(["23503","23514","23502","22P02","22001"].includes(err.code)) return new ErrorAplicacion("Los datos no cumplen las reglas de integridad.",400,"DATOS_INVALIDOS");
  if(["ECONNREFUSED","ECONNRESET","ETIMEDOUT","EPIPE","57P01","57P02","57P03","53300"].includes(err.code) || String(err.code||"").startsWith("08"))
    return new ErrorAplicacion("El almacenamiento no está disponible temporalmente.",503,"DB_NO_DISPONIBLE");
  return new ErrorAplicacion("No se pudo completar la operación de almacenamiento.",500,"DB_ERROR");
}
class Base {
  constructor(pool,seguridad){ this.pool=pool;this.seguridad=seguridad; }
  async query(sql,params=[]){ try{return await this.pool.query(sql,params);}catch(err){throw traducir(err);} }
  async tx(fn, db = null){try{return await transaccion(this.pool,fn,db);}catch(err){throw traducir(err);} }
}
const iso=v=>v instanceof Date?v.toISOString():v;
module.exports={Base,iso,traducir};
