const env=require("../config/env");
const {ErrorAplicacion}=require("../errors/ErrorAplicacion");
function crearRepositorios({store,seguridad,pool,persistencia=env.persistencia}={}){
 if(pool || (!store && persistencia==="postgres")){
  const conexion=pool||require("../database/pool").crearPool();
  return {repositorios:require("./postgres").crearRepositoriosPostgres(conexion,seguridad),
   persistencia:"postgres", comprobar:async()=>{try{await conexion.query("SELECT 1");}catch(err){throw require("./postgres/base").traducir(err);}},cerrar:()=>conexion.end()};
 }
 if(!store && persistencia!=="json")throw new ErrorAplicacion("PERSISTENCE_DRIVER debe ser json o postgres.",503,"PERSISTENCIA_INVALIDA");
 const r=require("./index");const fuente=store||require("../data/store");
 const repositorios={usuarios:new r.RepositorioUsuarios(fuente,seguridad),productos:new r.RepositorioProductos(fuente),
  consultas:new r.RepositorioConsultas(fuente,seguridad),auditoria:new r.RepositorioAuditoria(fuente)};
 repositorios.interacciones=new r.RepositorioInteracciones(fuente,seguridad,repositorios.consultas);
 return {repositorios,persistencia:"json",comprobar:async()=>{},cerrar:async()=>{}};
}
module.exports={crearRepositorios};
