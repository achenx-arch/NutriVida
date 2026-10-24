const {validarSolicitud}=require("../middleware/validarSolicitud");
const express = require("express");
const { generarToken, autenticarUsuario } = require("../security/auth");

module.exports = function crearRutasAuth(sistema) {
  const router = express.Router();
  function responder(res, usuario, status = 200) {
    res.status(status).json({ token: generarToken(usuario), usuario: usuario.datosPublicos() });
  }
  router.post("/register", validarSolicitud("registro"), async (req, res, next) => {
    try { responder(res, await sistema.registrar(req.body || {}), 201); } catch (err) { next(err); }
  });
  router.post("/login", validarSolicitud("login"), async (req, res, next) => {
    try { responder(res, await sistema.login(req.body || {})); } catch (err) { next(err); }
  });
  router.post("/logout",autenticarUsuario(sistema.repositorios.usuarios),validarSolicitud(),async(req,res,next)=>{
    try{await sistema.auditoria.registrarAcceso(req.usuario,"LOGOUT",req.huellaSesion);res.status(204).send();}catch(e){next(e);}
  });
  return router;
};
