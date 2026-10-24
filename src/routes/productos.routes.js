const {validarSolicitud}=require("../middleware/validarSolicitud");
const express = require("express");
const { autenticarUsuario, requerirRol, requerirPermiso } = require("../security/auth");
const { RolUsuario, Permiso } = require("../domain/roles");

module.exports = function crearRutasProductos(sistema) {
  const router = express.Router();
  router.use(autenticarUsuario(sistema.repositorios.usuarios));
  router.get("/", validarSolicitud(), async (req, res, next) => {
    try { res.json({ productos: await sistema.catalogo.listar() }); } catch (err) { next(err); }
  });
  router.use(requerirPermiso(Permiso.GESTIONAR_CATALOGO));
  router.post("/", validarSolicitud("producto"), async (req, res, next) => {
    try { res.status(201).json({ producto: await sistema.catalogo.gestionar(req.usuario.id, "crear", req.body || {}) }); } catch (err) { next(err); }
  });
  router.put("/:id", validarSolicitud("producto",{id:true}), async (req, res, next) => {
    try { res.json({ producto: await sistema.catalogo.gestionar(req.usuario.id, "editar", { ...req.body, id: req.params.id }) }); } catch (err) { next(err); }
  });
  router.delete("/:id", validarSolicitud("vacio",{id:true}), async (req, res, next) => {
    try {
      await sistema.catalogo.gestionar(req.usuario.id, "eliminar", { id: req.params.id });
      res.status(204).send();
    } catch (err) { next(err); }
  });
  return router;
};
