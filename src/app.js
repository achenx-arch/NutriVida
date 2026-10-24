const express = require("express");
const {crearSeguridadHttp}=require("./middleware/seguridadHttp");
const path = require("path");
const { crearSistema } = require("./services/sistema");
const { errorHandler, rutaNoEncontrada } = require("./middleware/errorHandler");

function crearApp(sistema = crearSistema(), opciones = {}) {
  const app = express();
  const seguridad=crearSeguridadHttp(opciones.limites);
  app.disable("x-powered-by");
  app.use(seguridad.headers,seguridad.cors);
  app.use("/api",seguridad.general);
  app.use("/api/auth/login",seguridad.login);
  app.use("/api/auth/register",seguridad.registro);
  app.use("/api/consultas",(req,res,next)=>req.method==="POST"?seguridad.ia(req,res,next):next());
  app.use((req,res,next)=>{req.auditoria=sistema.auditoria;req.sesionRevocada=recurso=>sistema.repositorios.auditoria.sesionRevocada(recurso);next();});
  app.use(express.json({ limit: "50kb" }));
  app.use(express.static(path.join(__dirname, "..", "public")));
  app.use("/api/auth", require("./routes/auth.routes")(sistema));
  app.use("/api/perfil", require("./routes/perfil.routes")(sistema));
  app.use("/api/consultas", require("./routes/consultas.routes")(sistema));
  if(sistema.catalogoComercial){
    for(const tipo of ["productos","categorias","ingredientes"])app.use(`/api/${tipo}`,require("./routes/catalogoComercial.routes")(sistema,tipo));
  }else app.use("/api/productos", require("./routes/productos.routes")(sistema)); // Adaptador legado de pruebas JSON.

  if(sistema.inventario)app.use("/api/inventario",require("./routes/inventario.routes")(sistema));
  if(sistema.pedidos)app.use("/api/pedidos",require("./routes/pedidos.routes").crearRutasPedidos(sistema));
  if(sistema.historialConsumo)app.use("/api/historial-consumo",require("./routes/historial.routes").crearRutasHistorial(sistema));

  app.get("/api/salud", (req, res) => res.json({ estado: "ok", servicio: "NutriAsistente IA" }));
  app.use("/api", rutaNoEncontrada);
  app.use(errorHandler);
  return app;
}
module.exports = { crearApp };
