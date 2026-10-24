const { ErrorAplicacion } = require('../errors/ErrorAplicacion');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const ESTADOS = ['PENDIENTE', 'CONFIRMADO', 'EN_PREPARACION', 'LISTO', 'ENTREGADO', 'CANCELADO'];

function fallo(msg, code = 400) {
  throw new ErrorAplicacion(msg, code, 'DATOS_INVALIDOS');
}

function esFechaCalendarValida(cadena) {
  if (typeof cadena !== 'string' || !FECHA_REGEX.test(cadena)) return false;
  const d = new Date(cadena + 'T00:00:00Z');
  if (isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === cadena;
}

function validarCrearPedido(body) {
  if (!body || typeof body !== 'object') fallo('El cuerpo debe ser un objeto JSON.');
  if (!Array.isArray(body.items) || body.items.length === 0) {
    fallo('Debe proporcionar al menos un producto en items.');
  }

  const items = [];
  for (const item of body.items) {
    if (!item || typeof item !== 'object') fallo('Cada item debe ser un objeto.');
    if (!item.productoId || typeof item.productoId !== 'string' || !UUID_REGEX.test(item.productoId)) {
      fallo('productoId debe ser un UUID válido.');
    }
    if (!Number.isInteger(item.cantidad) || item.cantidad <= 0 || item.cantidad > 1000) {
      fallo('cantidad debe ser un número entero estrictamente positivo (máximo 1000).');
    }
    items.push({ productoId: item.productoId, cantidad: item.cantidad });
  }

  return { items };
}

function validarFiltrosPedidos(q = {}) {
  const f = {};
  if (q.page !== undefined) {
    const p = Number(q.page);
    if (!Number.isInteger(p) || p < 1) fallo('page debe ser un número entero mayor a 0.');
    f.page = p;
  } else f.page = 1;

  if (q.limit !== undefined) {
    const l = Number(q.limit);
    if (!Number.isInteger(l) || l < 1 || l > 100) fallo('limit debe ser entre 1 y 100.');
    f.limit = l;
  } else f.limit = 20;

  if (q.estado) {
    if (typeof q.estado !== 'string' || !ESTADOS.includes(q.estado.toUpperCase())) {
      fallo('estado de filtro inválido.');
    }
    f.estado = q.estado.toUpperCase();
  }

  if (q.clienteId) {
    if (typeof q.clienteId !== 'string' || !UUID_REGEX.test(q.clienteId)) {
      fallo('clienteId debe ser un UUID válido.');
    }
    f.clienteId = q.clienteId;
  }

  if (q.desde) {
    if (!esFechaCalendarValida(q.desde)) {
      fallo('desde debe ser una fecha YYYY-MM-DD válida.');
    }
    f.desde = q.desde;
  }

  if (q.hasta) {
    if (!esFechaCalendarValida(q.hasta)) {
      fallo('hasta debe ser una fecha YYYY-MM-DD válida.');
    }
    f.hasta = q.hasta;
  }

  if (f.desde && f.hasta && f.desde > f.hasta) {
    fallo('La fecha "desde" no puede ser posterior a "hasta".');
  }

  return f;
}

function validarCambioEstado(body) {
  if (!body || typeof body !== 'object') fallo('El cuerpo debe ser un objeto JSON.');
  if (!body.estado || typeof body.estado !== 'string' || !ESTADOS.includes(body.estado.toUpperCase())) {
    fallo('Debe especificar un estado válido.');
  }
  return { estado: body.estado.toUpperCase() };
}

module.exports = {
  validarCrearPedido,
  validarFiltrosPedidos,
  validarCambioEstado
};
