const {origen,fallo}=require("./comun");
try{console.log(JSON.stringify({valido:true,resumen:require("../../src/database/importacion").leerFuente(origen()).resumen}));}catch(err){fallo(err);}
