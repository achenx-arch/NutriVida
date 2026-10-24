const {RepositorioUsuarios}=require("./usuarios");
const {RepositorioProductos}=require("./productos");
const {RepositorioConsultas}=require("./consultas");
const {RepositorioInteracciones}=require("./interacciones");
const {RepositorioAuditoria}=require("./auditoria");
const {RepositorioPedidos}=require("./pedidos");
const {RepositorioHistorialConsumo}=require("./historialConsumo");

function crearRepositoriosPostgres(pool,seguridad){
 return {
  inventario:new (require("./inventario").RepositorioInventario)(pool,seguridad),
  catalogoComercial:new (require("./catalogoComercial").RepositorioCatalogoComercial)(pool,seguridad),
  pedidos:new RepositorioPedidos(pool,seguridad),
  historialConsumo:new RepositorioHistorialConsumo(pool,seguridad),
  usuarios:new RepositorioUsuarios(pool,seguridad),
  productos:new RepositorioProductos(pool,seguridad),
  consultas:new RepositorioConsultas(pool,seguridad),
  interacciones:new RepositorioInteracciones(pool,seguridad),
  auditoria:new RepositorioAuditoria(pool,seguridad)
 };
}
module.exports={crearRepositoriosPostgres};
