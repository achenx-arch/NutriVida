const {validarSolicitud}=require("../middleware/validarSolicitud");
const express = require("express");
const { autenticarUsuario, requerirRol, requerirPermiso } = require("../security/auth");
const { RolUsuario, Permiso } = require("../domain/roles");

module.exports = function crearRutasConsultas(sistema) {
  const router = express.Router();
  router.use(autenticarUsuario(sistema.repositorios.usuarios));
  router.post("/", requerirRol(RolUsuario.CLIENTE), validarSolicitud("consulta"), async (req, res, next) => {
    try { res.json({ consulta: await sistema.consultas.enviar(req.usuario.id, req.body?.texto) }); } catch (err) { next(err); }
  });
  router.get("/", requerirRol(RolUsuario.CLIENTE), validarSolicitud(), async (req, res, next) => {
    try { res.json({ consultas: await sistema.consultas.historial(req.usuario.id) }); } catch (err) { next(err); }
  });
  router.get("/admin", requerirPermiso(Permiso.REVISAR_CONSULTAS), validarSolicitud(), async (req, res, next) => {
    try { res.json({ consultas: await sistema.consultas.listarAdministracion(req.usuario.id) }); } catch (err) { next(err); }
  });
  router.put("/:id/revisar", requerirPermiso(Permiso.REVISAR_CONSULTAS), validarSolicitud("vacio",{id:true}), async (req, res, next) => {
    try { res.json({ consulta: await sistema.consultas.revisar(req.usuario.id, req.params.id) }); } catch (err) { next(err); }
  });
  return router;
};
