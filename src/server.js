async function iniciar(){
 const env=require("./config/env");
 const {crearSistema}=require("./services/sistema");
 const sistema=crearSistema();
 try {
  await sistema.comprobarPersistencia();
  const server=require("./app").crearApp(sistema).listen(env.port,()=>{
   console.log(`NutriVida disponible en http://localhost:${env.port}; persistencia: ${sistema.persistencia}`);
  });
  server.on("error",async()=>{console.error("ARRANQUE_FALLIDO: no se pudo abrir el servidor.");await sistema.cerrar();process.exitCode=1;});
  for(const evento of ["SIGINT","SIGTERM"])process.once(evento,()=>server.close(async()=>{await sistema.cerrar();}));
 }catch(err){await sistema.cerrar();throw err;}
}
iniciar().catch(err=>{
 console.error(["DB_NO_CONFIGURADA","DB_NO_DISPONIBLE","PERSISTENCIA_INVALIDA"].includes(err.codigo)?`${err.codigo}: ${err.message}`:"ARRANQUE_FALLIDO: revisa la configuración y disponibilidad de la base.");
 process.exitCode=1;
});
