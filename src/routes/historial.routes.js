const express = require('express');
const { autenticarUsuario, requerirRol } = require('../security/auth');
const { ErrorAplicacion } = require('../errors/ErrorAplicacion');

function crearRutasHistorial(sistema) {
  const router = express.Router();
  const servicioHistorial = sistema.historialConsumo;
  const auth = autenticarUsuario(sistema.repositorios.usuarios);

  // "Mi consumo" es exclusivo de CLIENTE; la identidad sale del JWT, nunca de la solicitud.
  router.get('/', auth, requerirRol('CLIENTE'), async (req, res, next) => {
    try {
      for (const campo of ['categoria', 'busqueda']) {
        if (req.query[campo] !== undefined && (typeof req.query[campo] !== 'string' || req.query[campo].length > 120))
          throw new ErrorAplicacion(`${campo} debe ser texto de máximo 120 caracteres.`, 400, 'DATOS_INVALIDOS');
      }
      const page = req.query.page ? Math.max(1, Number(req.query.page) || 1) : 1;
      const limit = req.query.limit ? Math.min(100, Math.max(1, Number(req.query.limit) || 20)) : 20;
      const categoria = req.query.categoria ? String(req.query.categoria).trim() : undefined;
      const busqueda = req.query.busqueda ? String(req.query.busqueda).trim() : undefined;

      const resultado = await servicioHistorial.obtenerHistorialConsumo(req.usuario, {
        page,
        limit,
        categoria,
        busqueda
      });

      res.status(200).json({ ok: true, ...resultado });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { crearRutasHistorial };
