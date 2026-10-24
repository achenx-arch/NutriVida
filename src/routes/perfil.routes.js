const {validarSolicitud}=require("../middleware/validarSolicitud");
const express = require("express");
const { autenticarUsuario, requerirRol } = require("../security/auth");

module.exports = function crearRutasPerfil(sistema) {
  const router = express.Router();
  router.use(autenticarUsuario(sistema.repositorios.usuarios), requerirRol("CLIENTE"));
  router.get("/", validarSolicitud(), async (req, res, next) => {
    try { res.json({ perfilSalud: await sistema.perfil.obtener(req.usuario.id), consentimientos: await sistema.perfil.consentimientos(req.usuario.id) }); } catch (err) { next(err); }
  });
  // FASE 9A: el usuario sale SOLO del JWT; el cuerpo admite únicamente los dos booleanos.
  router.put("/consentimiento", validarSolicitud("consentimiento"), async (req, res, next) => {
    try { res.json({ consentimientos: await sistema.perfil.actualizarConsentimientos(req.usuario.id, req.body) }); } catch (err) { next(err); }
  });
  // FASE 9B-2: datos alimentarios estructurados (preferencias, restricciones y alérgenos). Usuario solo del JWT.
  router.get("/alimentacion", validarSolicitud(), async (req, res, next) => {
    try { res.json(await sistema.perfil.alimentacion(req.usuario.id)); } catch (err) { next(err); }
  });
  router.put("/alimentacion", validarSolicitud("alimentacion"), async (req, res, next) => {
    try { res.json(await sistema.perfil.actualizarAlimentacion(req.usuario.id, req.body)); } catch (err) { next(err); }
  });
  router.put("/", validarSolicitud("perfil"), async (req, res, next) => {
    try { res.json({ perfilSalud: await sistema.perfil.actualizar(req.usuario.id, req.body || {}) }); } catch (err) { next(err); }
  });
  return router;
};
