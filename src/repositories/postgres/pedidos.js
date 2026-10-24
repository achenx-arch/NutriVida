const { Base, iso } = require('./base');
const { randomUUID } = require('crypto');
const { ErrorAplicacion } = require('../../errors/ErrorAplicacion');

const fallo = (m, s = 409) => { throw new ErrorAplicacion(m, s); };

const ESTADOS_VALIDOS = ['PENDIENTE', 'CONFIRMADO', 'EN_PREPARACION', 'LISTO', 'ENTREGADO', 'CANCELADO'];

const TRANSICIONES_PERMITIDAS = {
  PENDIENTE: ['CONFIRMADO', 'CANCELADO'],
  CONFIRMADO: ['EN_PREPARACION', 'CANCELADO'],
  EN_PREPARACION: ['LISTO', 'CANCELADO'],
  LISTO: ['ENTREGADO', 'CANCELADO'],
  ENTREGADO: [],
  CANCELADO: [],
};

const dtoPedido = (p, detalles = []) => ({
  id: String(p.id_pedido),
  clienteId: p.id_cliente,
  cliente: p.cliente_nombre ? `${p.cliente_nombre} ${p.cliente_apellido || ''}`.trim() : undefined,
  clienteCorreo: p.cliente_correo || undefined,
  estado: p.estado,
  subtotal: Number(p.subtotal).toFixed(2),
  total: Number(p.total).toFixed(2),
  totalFormateado: `Q ${Number(p.total).toFixed(2)}`,
  fechaPedido: iso(p.fecha_pedido),
  fechaActualizacion: iso(p.fecha_actualizacion),
  detalles: detalles.map(d => ({
    id: String(d.id_detalle),
    productoId: d.id_producto,
    producto: d.producto_nombre || d.producto,
    cantidad: d.cantidad,
    precioUnitario: Number(d.precio_unitario).toFixed(2),
    precioFormateado: `Q ${Number(d.precio_unitario).toFixed(2)}`,
    subtotal: Number(d.subtotal).toFixed(2),
    subtotalFormateado: `Q ${Number(d.subtotal).toFixed(2)}`
  }))
});

class RepositorioPedidos extends Base {
  async crear(clienteId, items, { db: txDb = null } = {}) {
    if (!Array.isArray(items) || items.length === 0) {
      fallo('El pedido debe incluir al menos un producto.', 400);
    }

    return this.tx(async db => {
      // Verificar cliente activo
      const u = (await db.query(
        'SELECT u.estado,r.nombre rol FROM usuarios u JOIN roles r USING(id_rol) WHERE id_usuario = $1',
        [clienteId]
      )).rows[0];
      if (!u || !u.estado) fallo('Usuario no encontrado o inactivo.', 401);
      if(u.rol!=='CLIENTE')fallo('Solo CLIENTE puede crear pedidos.',403);

      let subtotalAcumulado = 0;
      const detallesParaInsertar = [];

      for (const item of items) {
        if (!item.productoId || !Number.isInteger(item.cantidad) || item.cantidad <= 0) {
          fallo('Cada ítem del pedido debe especificar un productoId válido y una cantidad entera positiva.', 400);
        }

        // Consultar producto desde PostgreSQL (fuente autoritativa de precio)
        const p = (await db.query(
          `SELECT p.id_producto, p.nombre, p.precio, p.estado, c.estado as categoria_activa
           FROM productos p
           JOIN categorias c USING(id_categoria)
           WHERE p.id_producto = $1`,
          [item.productoId]
        )).rows[0];

        if (!p) fallo(`Producto ${item.productoId} no encontrado.`, 404);
        if (!p.estado || !p.categoria_activa || Number(p.precio) <= 0) {
          fallo(`El producto "${p.nombre}" no está activo o comercialmente disponible para compra.`, 409);
        }

        const precioUnitario = Number(p.precio);
        const subtotalItem = Number((precioUnitario * item.cantidad).toFixed(2));
        subtotalAcumulado += subtotalItem;

        detallesParaInsertar.push({
          productoId: p.id_producto,
          nombre: p.nombre,
          cantidad: item.cantidad,
          precioUnitario,
          subtotal: subtotalItem
        });
      }

      subtotalAcumulado = Number(subtotalAcumulado.toFixed(2));

      // Crear pedido (estado PENDIENTE)
      const pedidoRes = (await db.query(
        `INSERT INTO pedidos(id_cliente, estado, subtotal, total, fecha_pedido, fecha_actualizacion)
         VALUES($1, 'PENDIENTE', $2, $2, clock_timestamp(), clock_timestamp())
         RETURNING *`,
        [clienteId, subtotalAcumulado]
      )).rows[0];

      const detallesResultado = [];
      for (const det of detallesParaInsertar) {
        const detRes = (await db.query(
          `INSERT INTO detalle_pedido(id_pedido, id_producto, cantidad, precio_unitario, subtotal)
           VALUES($1, $2, $3, $4, $5)
           RETURNING *`,
          [pedidoRes.id_pedido, det.productoId, det.cantidad, det.precioUnitario, det.subtotal]
        )).rows[0];
        detallesResultado.push({ ...detRes, producto_nombre: det.nombre });
      }

      // Auditoría
      await db.query(
        `INSERT INTO auditoria(id_auditoria, id_usuario, accion, entidad, id_entidad, datos_nuevos, fecha)
         VALUES($1, $2, 'CREAR_PEDIDO', 'pedidos', $3, $4, clock_timestamp())`,
        [
          randomUUID(),
          clienteId,
          String(pedidoRes.id_pedido),
          JSON.stringify({ estado: 'PENDIENTE', total: subtotalAcumulado, items: items.length })
        ]
      );

      return dtoPedido(pedidoRes, detallesResultado);
    }, txDb);
  }

  async obtenerPorId(idPedido, usuarioId = null, rol = 'CLIENTE') {
    return this.tx(async db => {
      await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      const p = (await db.query(
        `SELECT p.*, u.nombre as cliente_nombre, u.apellido as cliente_apellido, u.correo as cliente_correo
         FROM pedidos p
         JOIN usuarios u ON p.id_cliente = u.id_usuario
         WHERE p.id_pedido = $1`,
        [idPedido]
      )).rows[0];

      if (!p) fallo('Pedido no encontrado.', 404);

      if (rol === 'CLIENTE' && p.id_cliente !== usuarioId) {
        fallo('No tienes permiso para acceder a este pedido.', 403);
      }

      const detalles = (await db.query(
        `SELECT d.*, pr.nombre as producto_nombre
         FROM detalle_pedido d
         JOIN productos pr USING(id_producto)
         WHERE d.id_pedido = $1
         ORDER BY d.id_detalle`,
        [idPedido]
      )).rows;

      return dtoPedido(p, detalles);
    });
  }

  async listar(f = {}, usuarioId, rol = 'CLIENTE') {
    return this.tx(async db => {
      await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      const args = [];
      const conds = [];

      const addCond = (sql, val) => {
        args.push(val);
        conds.push(sql.replace('?', `$${args.length}`));
      };

      if (rol === 'CLIENTE') {
        addCond('p.id_cliente = ?', usuarioId);
      } else if (f.clienteId) {
        addCond('p.id_cliente = ?', f.clienteId);
      }

      if (f.estado) {
        if (!ESTADOS_VALIDOS.includes(f.estado)) fallo('Estado de pedido inválido.', 400);
        addCond('p.estado = ?', f.estado);
      }

      if (f.desde) {
        addCond("p.fecha_pedido >= (?::date::timestamp AT TIME ZONE 'America/Guatemala')", f.desde);
      }
      if (f.hasta) {
        addCond("p.fecha_pedido < ((?::date+1)::timestamp AT TIME ZONE 'America/Guatemala')", f.hasta);
      }

      const where = conds.length ? ' WHERE ' + conds.join(' AND ') : '';
      const from = ' FROM pedidos p JOIN usuarios u ON p.id_cliente = u.id_usuario';

      const total = Number((await db.query('SELECT count(*) n' + from + where, args)).rows[0].n);

      const limit = Number(f.limit) || 20;
      const page = Number(f.page) || 1;
      args.push(limit, (page - 1) * limit);

      const rows = (await db.query(
        `SELECT p.*, u.nombre as cliente_nombre, u.apellido as cliente_apellido, u.correo as cliente_correo` +
        from + where +
        ` ORDER BY p.fecha_pedido DESC, p.id_pedido DESC LIMIT $${args.length - 1} OFFSET $${args.length}`,
        args
      )).rows;

      const pedidosDTO = [];
      for (const p of rows) {
        const detalles = (await db.query(
          `SELECT d.*, pr.nombre as producto_nombre
           FROM detalle_pedido d
           JOIN productos pr USING(id_producto)
           WHERE d.id_pedido = $1
           ORDER BY d.id_detalle`,
          [p.id_pedido]
        )).rows;
        pedidosDTO.push(dtoPedido(p, detalles));
      }

      return {
        pedidos: pedidosDTO,
        paginacion: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit) || 1
        }
      };
    });
  }

  async transicionarEstado(idPedido, nuevoEstado, usuarioId, rol, inventarioRepo) {
    if(!['CLIENTE','EMPLEADO','ADMINISTRADOR'].includes(rol) || (rol==='CLIENTE' && nuevoEstado!=='CANCELADO')) fallo('No tienes permiso para esta operación de pedido.',403);
    if (!ESTADOS_VALIDOS.includes(nuevoEstado)) {
      fallo(`Estado inválido: ${nuevoEstado}`, 400);
    }

    return this.tx(async db => {
      // Bloquear pedido
      const p = (await db.query(
        'SELECT * FROM pedidos WHERE id_pedido = $1 FOR UPDATE',
        [idPedido]
      )).rows[0];

      if (!p) fallo('Pedido no encontrado.', 404);

      if (rol === 'CLIENTE' && p.id_cliente !== usuarioId) {
        fallo('No tienes permiso para modificar este pedido.', 403);
      }

      const estadoActual = p.estado;

      // Idempotencia: si ya está en el estado deseado, no hacer nada
      if (estadoActual === nuevoEstado) {
        const detalles = (await db.query(
          `SELECT d.*, pr.nombre as producto_nombre FROM detalle_pedido d JOIN productos pr USING(id_producto) WHERE d.id_pedido = $1`,
          [idPedido]
        )).rows;
        return dtoPedido(p, detalles);
      }

      // Validar máquina de estados
      const permitidas = TRANSICIONES_PERMITIDAS[estadoActual] || [];
      if (!permitidas.includes(nuevoEstado)) {
        fallo(`Transición inválida de ${estadoActual} a ${nuevoEstado}.`, 409);
      }

      // 1. PENDIENTE -> CONFIRMADO (Descuenta inventario)
      if (estadoActual === 'PENDIENTE' && nuevoEstado === 'CONFIRMADO') {
        const detalles = (await db.query(
          'SELECT * FROM detalle_pedido WHERE id_pedido = $1',
          [idPedido]
        )).rows;

        // Orden determinista por id_producto para prevenir deadlocks
        detalles.sort((a, b) => a.id_producto.localeCompare(b.id_producto));

        for (const item of detalles) {
          // Utiliza la lógica segura de inventario de FASE 5
          await inventarioRepo.registrar(
            usuarioId,
            {
              productoId: item.id_producto,
              tipo: 'SALIDA',
              cantidad: item.cantidad,
              motivo: `Descuento por confirmación de pedido #${idPedido}`
            },
            { db, omitePermisos: true }
          );
        }
      }

      // 2. (CONFIRMADO | EN_PREPARACION | LISTO) -> CANCELADO (Repone inventario exactamente una vez)
      if (['CONFIRMADO', 'EN_PREPARACION', 'LISTO'].includes(estadoActual) && nuevoEstado === 'CANCELADO') {
        const detalles = (await db.query(
          'SELECT * FROM detalle_pedido WHERE id_pedido = $1',
          [idPedido]
        )).rows;

        detalles.sort((a, b) => a.id_producto.localeCompare(b.id_producto));

        for (const item of detalles) {
          await inventarioRepo.registrar(
            usuarioId,
            {
              productoId: item.id_producto,
              tipo: 'ENTRADA',
              cantidad: item.cantidad,
              motivo: `Reposición por cancelación de pedido #${idPedido}`
            },
            { db, omitePermisos: true, compensacionPedido: { pedidoId: idPedido, detalleId: item.id_detalle } }
          );
        }
      }

      // Actualizar estado del pedido
      const actualizado = (await db.query(
        `UPDATE pedidos
         SET estado = $2, fecha_actualizacion = clock_timestamp()
         WHERE id_pedido = $1
         RETURNING *`,
        [idPedido, nuevoEstado]
      )).rows[0];

      // Auditoría de cambio de estado
      await db.query(
        `INSERT INTO auditoria(id_auditoria, id_usuario, accion, entidad, id_entidad, datos_anteriores, datos_nuevos, fecha)
         VALUES($1, $2, 'CAMBIAR_ESTADO_PEDIDO', 'pedidos', $3, $4, $5, clock_timestamp())`,
        [
          randomUUID(),
          usuarioId,
          String(idPedido),
          JSON.stringify({ estado: estadoActual }),
          JSON.stringify({ estado: nuevoEstado })
        ]
      );

      const detallesActuales = (await db.query(
        `SELECT d.*, pr.nombre as producto_nombre FROM detalle_pedido d JOIN productos pr USING(id_producto) WHERE d.id_pedido = $1`,
        [idPedido]
      )).rows;

      return dtoPedido(actualizado, detallesActuales);
    });
  }
}

module.exports = { RepositorioPedidos };
