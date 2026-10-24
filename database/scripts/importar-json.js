const {ejecutar,origen,fallo}=require("./comun");
if(!process.argv.includes("--confirmar-corte")){
 fallo(new Error("DETENER_ESCRITURAS_Y_USAR_CONFIRMAR_CORTE"));
}else ejecutar(pool=>require("../../src/database/importacion").importarJson(pool,origen()));
