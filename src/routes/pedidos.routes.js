const express = require('express');
const {identificador}=require('../security/catalogoValidacion');
const { autenticarUsuario, requerirRol } = require('../security/auth');
const { validarCrearPedido, validarFiltrosPedidos, validarCambioEstado } = require('../security/pedidosValidacion');

function crearRutasPedidos(sistema) {
  const router = express.Router();
  const servicioPedidos = sistema.pedidos;
  const auth = autenticarUsuario(sistema.repositorios.usuarios);

  router.post('/', auth, requerirRol('CLIENTE'), async (req, res, next) => {
    try {
      const { items } = validarCrearPedido(req.body);
      const pedido = await servicioPedidos.crearPedido(req.usuario, items);
      res.status(201).json({ ok: true, pedido });
    } catch (err) {
      next(err);
    }
  });

  router.get('/', auth, async (req, res, next) => {
    try {
      const filtros = validarFiltrosPedidos(req.query);
      const resultado = await servicioPedidos.listarPedidos(req.usuario, filtros);
      res.status(200).json({ ok: true, ...resultado });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', auth, async (req, res, next) => {
    try {
      const pedido = await servicioPedidos.obtenerPedido(req.usuario, identificador(req.params.id));
      res.status(200).json({ ok: true, pedido });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id/estado', auth, async (req, res, next) => {
    try {
      const { estado } = validarCambioEstado(req.body);
      const pedido = await servicioPedidos.cambiarEstado(req.usuario, identificador(req.params.id), estado);
      res.status(200).json({ ok: true, pedido });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { crearRutasPedidos };
