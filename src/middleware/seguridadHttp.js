const helmet=require("helmet");
const cors=require("cors");
const {rateLimit}=require("express-rate-limit");
const env=require("../config/env");
const {ErrorAplicacion}=require("../errors/ErrorAplicacion");
function crearSeguridadHttp(opciones={}) {
 const crear=(limit,windowMs=15*60*1000)=>rateLimit({windowMs,limit,standardHeaders:"draft-8",legacyHeaders:false,
  handler:(req,res,next)=>next(new ErrorAplicacion("Demasiadas solicitudes. Intenta de nuevo más tarde.",429,"LIMITE_SOLICITUDES"))});
 const origenes=env.corsOrigins;
 return {
  headers:helmet({contentSecurityPolicy:{directives:{"style-src":["'self'"],"img-src":["'self'"],"upgrade-insecure-requests":env.produccion?[]:null}},strictTransportSecurity:env.produccion?undefined:false}),
  cors:cors({origin:(origen,cb)=>cb(null,!!origen&&origenes.includes(origen)),credentials:false,methods:["GET","POST","PUT","PATCH","DELETE"],allowedHeaders:["Content-Type","Authorization"]}),
  general:crear(opciones.general??600),login:crear(opciones.login??30),registro:crear(opciones.registro??20),ia:crear(opciones.ia??30,60000)
 };
}
module.exports={crearSeguridadHttp};
