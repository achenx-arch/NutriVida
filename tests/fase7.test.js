const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
process.env.JWT_SECRET = 'fase7-sintetico';
process.env.ENCRYPTION_KEY = 'ab'.repeat(32);

const { crearPool } = require('../src/database/pool');
const { migrar } = require('../src/database/migraciones');
const { crearSistema } = require('../src/services/sistema');
const { crearApp } = require('../src/app');
const { Administrador, Empleado, Cliente } = require('../src/domain/modelos');
const { generarToken } = require('../src/security/auth');

test('FASE7 historial de consumo: derivación exclusiva de pedidos ENTREGADOS, agregación y privacidad por JWT', async t => {
  const id = randomUUID().replaceAll('-', '');
  const schema = 'nv_test_' + id;
  const control = 'nv_test_control_' + id;

  const gestor = crearPool({ pruebas: true });
  await gestor.query(`CREATE SCHEMA ${schema}`);
  const pool = crearPool({ pruebas: true, schema });
  let server;

  t.after(async () => {
    if (server) await new Promise(r => server.close(r));
    await pool.end();
    try {
      await gestor.query(`DROP SCHEMA ${schema} CASCADE`);
      await gestor.query(`DROP SCHEMA IF EXISTS ${control} CASCADE`);
    } finally {
      await gestor.end();
    }
  });

  await migrar(pool, { esquemaControl: control });
  const sistema = crearSistema({ pool });

  const admin = new Administrador({ nombre: 'Admin F7', correo: 'admin7@example.test', passwordHash: 'hash-sintetico' });
  const empleado = new Empleado({ nombre: 'Empleado F7', correo: 'empleado7@example.test', passwordHash: 'hash-sintetico' });
  const cliente1 = new Cliente({ nombre: 'Cliente Consumo 1', correo: 'c1_f7@example.test', passwordHash: 'hash-sintetico' });
  const cliente2 = new Cliente({ nombre: 'Cliente Consumo 2', correo: 'c2_f7@example.test', passwordHash: 'hash-sintetico' });

  for (const u of [admin, empleado, cliente1, cliente2]) await sistema.repositorios.usuarios.guardar(u);

  const te = generarToken(empleado);
  const tc1 = generarToken(cliente1);
  const tc2 = generarToken(cliente2);

  server = crearApp(sistema).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));

  const api = async (method, url, body, token = tc1) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api${url}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: r.status, data: await r.json() };
  };

  const catSnacks = await sistema.catalogoComercial.guardar(admin.id, 'categorias', null, { nombre: 'Snacks F7' });
  const catBebidas = await sistema.catalogoComercial.guardar(admin.id, 'categorias', null, { nombre: 'Bebidas F7' });

  const crearProducto = async (nombre, catId, precio = '20.00', stock = 50) => {
    const p = await sistema.catalogoComercial.guardar(admin.id, 'productos', null, {
      nombre,
      categoriaId: catId,
      estado: true,
      precio,
      stockMinimo: 5
    });
    await sistema.inventario.registrar(admin.id, {
      productoId: p.id,
      tipo: 'AJUSTE',
      cantidad: stock,
      motivo: 'Stock F7'
    });
    return p;
  };

  const granola = await crearProducto('Granola Crujiente', catSnacks.id, '25.00');
  const almendras = await crearProducto('Almendras Tostadas', catSnacks.id, '30.00');
  const jugoVerde = await crearProducto('Jugo Verde Detox', catBebidas.id, '15.00');

  // Helper para crear un pedido y llevarlo a un estado determinado
  const crearYTransicionarPedido = async (tokenCliente, items, estadoFinal) => {
    const resCrear = await api('POST', '/pedidos', { items }, tokenCliente);
    const pid = resCrear.data.pedido.id;

    if (estadoFinal === 'PENDIENTE') return pid;

    if (estadoFinal === 'CANCELADO') {
      await api('PATCH', `/pedidos/${pid}/estado`, { estado: 'CANCELADO' }, tokenCliente);
      return pid;
    }

    // PENDIENTE -> CONFIRMADO
    await api('PATCH', `/pedidos/${pid}/estado`, { estado: 'CONFIRMADO' }, te);
    if (estadoFinal === 'CONFIRMADO') return pid;

    // CONFIRMADO -> EN_PREPARACION
    await api('PATCH', `/pedidos/${pid}/estado`, { estado: 'EN_PREPARACION' }, te);
    if (estadoFinal === 'EN_PREPARACION') return pid;

    // EN_PREPARACION -> LISTO
    await api('PATCH', `/pedidos/${pid}/estado`, { estado: 'LISTO' }, te);
    if (estadoFinal === 'LISTO') return pid;

    // LISTO -> ENTREGADO
    await api('PATCH', `/pedidos/${pid}/estado`, { estado: 'ENTREGADO' }, te);
    return pid;
  };

  await t.test('1. Cliente sin compras entregadas devuelve historial vacío', async () => {
    const r = await api('GET', '/historial-consumo', undefined, tc1);
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.historial, []);
    assert.equal(r.data.resumen.totalProductosDistintos, 0);
    assert.equal(r.data.resumen.totalUnidadesConsumidas, 0);
  });

  await t.test('2. Pedidos en estados PENDIENTE, CONFIRMADO, EN_PREPARACION, LISTO, CANCELADO NO aparecen en historial', async () => {
    await crearYTransicionarPedido(tc1, [{ productoId: granola.id, cantidad: 2 }], 'PENDIENTE');
    await crearYTransicionarPedido(tc1, [{ productoId: almendras.id, cantidad: 1 }], 'CONFIRMADO');
    await crearYTransicionarPedido(tc1, [{ productoId: jugoVerde.id, cantidad: 3 }], 'EN_PREPARACION');
    await crearYTransicionarPedido(tc1, [{ productoId: granola.id, cantidad: 1 }], 'LISTO');
    await crearYTransicionarPedido(tc1, [{ productoId: almendras.id, cantidad: 5 }], 'CANCELADO');

    const r = await api('GET', '/historial-consumo', undefined, tc1);
    assert.equal(r.status, 200);
    assert.equal(r.data.historial.length, 0); // Ninguno entregado aún
  });

  await t.test('3. Pedido ENTREGADO contabiliza correctamente el consumo', async () => {
    await crearYTransicionarPedido(tc1, [
      { productoId: granola.id, cantidad: 4 },
      { productoId: jugoVerde.id, cantidad: 2 }
    ], 'ENTREGADO');

    const r = await api('GET', '/historial-consumo', undefined, tc1);
    assert.equal(r.status, 200);
    assert.equal(r.data.historial.length, 2);

    const itemGranola = r.data.historial.find(h => h.productoId === granola.id);
    assert.ok(itemGranola);
    assert.equal(itemGranola.cantidadTotal, 4);
    assert.equal(itemGranola.numeroCompras, 1);
    assert.equal(itemGranola.categoria, 'Snacks F7');

    assert.equal(r.data.resumen.totalProductosDistintos, 2);
    assert.equal(r.data.resumen.totalUnidadesConsumidas, 6);
    assert.equal(r.data.resumen.totalComprasRealizadas, 1);
  });

  await t.test('4. Múltiples pedidos ENTREGADOS agregan cantidades del mismo producto y recalculan totales', async () => {
    await crearYTransicionarPedido(tc1, [
      { productoId: granola.id, cantidad: 3 }
    ], 'ENTREGADO');

    const r = await api('GET', '/historial-consumo', undefined, tc1);
    assert.equal(r.status, 200);

    const itemGranola = r.data.historial.find(h => h.productoId === granola.id);
    assert.equal(itemGranola.cantidadTotal, 7); // 4 + 3
    assert.equal(itemGranola.numeroCompras, 2);  // 2 pedidos entregados que contienen Granola

    assert.equal(r.data.resumen.totalComprasRealizadas, 2);
    assert.equal(r.data.resumen.totalUnidadesConsumidas, 9); // 6 de antes + 3 nuevos
  });

  await t.test('5. Privacidad estricta: Cliente 2 solo ve su propio historial y no puede acceder al de Cliente 1', async () => {
    // Cliente 2 compra 10 unidades de Jugo Verde
    await crearYTransicionarPedido(tc2, [{ productoId: jugoVerde.id, cantidad: 10 }], 'ENTREGADO');

    const r1 = await api('GET', '/historial-consumo', undefined, tc1);
    const r2 = await api('GET', '/historial-consumo', undefined, tc2);

    assert.equal(r1.data.resumen.totalUnidadesConsumidas, 9);
    assert.equal(r2.data.resumen.totalUnidadesConsumidas, 10);
    assert.equal(r2.data.resumen.totalComprasRealizadas, 1);

    // Intento del cliente 2 de pasar id_usuario arbitrario en querystring no afecta el resultado (se deriva del JWT)
    const rInyeccion = await api('GET', `/historial-consumo?usuarioId=${cliente1.id}`, undefined, tc2);
    assert.equal(rInyeccion.data.resumen.totalUnidadesConsumidas, 10); // Sigue devolviendo los datos de Cliente 2
  });

  await t.test('6. Servicio reutilizable obtenerHistorialConsumo está disponible para FASE 8', async () => {
    const res = await sistema.historialConsumo.obtenerHistorialConsumo(cliente1);
    assert.equal(res.resumen.totalUnidadesConsumidas, 9);
    assert.ok(res.historial.length > 0);
  });

  await t.test('7.1 Un pedido ENTREGADO con dos productos cuenta como UNA compra global', async () => {
    const c3 = new Cliente({ nombre: 'Cliente Consumo 3', correo: 'c3_f7@example.test', passwordHash: 'hash-sintetico' });
    await sistema.repositorios.usuarios.guardar(c3);
    const tc3 = generarToken(c3);
    await crearYTransicionarPedido(tc3, [{ productoId: granola.id, cantidad: 1 }, { productoId: almendras.id, cantidad: 2 }], 'ENTREGADO');
    const r = await api('GET', '/historial-consumo', undefined, tc3);
    assert.equal(r.status, 200);
    assert.equal(r.data.historial.length, 2);
    assert.ok(r.data.historial.every(h => h.numeroCompras === 1));
    assert.equal(r.data.resumen.totalComprasRealizadas, 1); // no 2 (suma por producto)
    assert.equal(r.data.resumen.totalUnidadesConsumidas, 3);
    assert.ok(r.data.historial.every(h => h.fuenteUltimaFecha === 'FECHA_PEDIDO' && h.ultimaFecha));
  });

  await t.test('7.3 Mi consumo es exclusivo de CLIENTE autenticado y valida filtros', async () => {
    assert.equal((await api('GET', '/historial-consumo', undefined, te)).status, 403);
    assert.equal((await api('GET', '/historial-consumo', undefined, generarToken(admin))).status, 403);
    assert.equal((await api('GET', '/historial-consumo', undefined, null)).status, 401);
    assert.equal((await api('GET', '/historial-consumo?busqueda=' + 'x'.repeat(121), undefined, tc1)).status, 400);
    const r = await api('GET', '/historial-consumo?busqueda=Granola', undefined, tc1);
    assert.equal(r.status, 200);
    assert.ok(r.data.historial.every(h => h.producto.includes('Granola')));
  });

});

test('Mi consumo conectado: consumo.js consulta sin usuarioId y renderiza solo con textContent', async () => {
  const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
  const nodos = new Map(), urls = [];
  const nodo = () => { const n = { textContent: '', value: '', disabled: false, className: '', hijos: [], listeners: {},
    append(...h) { n.hijos.push(...h); }, replaceChildren(...h) { n.hijos = [...h]; },
    addEventListener(t, f) { n.listeners[t] = f; } };
    Object.defineProperty(n, 'innerHTML', { set() { throw new Error('innerHTML prohibido'); } }); return n; };
  const datos = { resumen: { totalComprasRealizadas: 1, totalUnidadesConsumidas: 3, totalProductosDistintos: 2, categoriaMasConsumida: '<b>Snacks</b>' },
    historial: [{ producto: '<img src=x onerror=alert(1)>', categoria: 'Snacks', cantidadTotal: 3, numeroCompras: 1, ultimaFecha: '2026-09-30T12:00:00.000Z', precioPromedioFormateado: 'Q 10.00' }],
    paginacion: { page: 1, pages: 1 } };
  const ctx = vm.createContext({ window: {}, URLSearchParams, Date, console,
    document: { getElementById: id => { if (!nodos.has(id)) nodos.set(id, nodo()); return nodos.get(id); }, createElement: () => nodo() },
    apiFetch: async url => { urls.push(url); return datos; } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/consumo.js'), 'utf8'), ctx);
  const consumo = ctx.window.NutriVidaConsumo;
  await consumo.cargarHistorialConsumo(1);
  assert.equal(urls.length, 0, 'sin sesión CLIENTE no consulta');
  consumo.sesion({ id: randomUUID(), rol: 'EMPLEADO' }); await consumo.cargarHistorialConsumo(1);
  assert.equal(urls.length, 0, 'EMPLEADO no usa Mi consumo');
  const cliente = { id: randomUUID(), rol: 'CLIENTE' };
  consumo.sesion(cliente); await consumo.cargarHistorialConsumo(1);
  assert.equal(urls.length, 1);
  assert.ok(urls[0].startsWith('/historial-consumo?'));
  assert.ok(!urls[0].includes(cliente.id) && !/usuario/i.test(urls[0]), 'no envía identidad arbitraria');
  const tarjeta = nodos.get('consumoList').hijos[0];
  const textos = tarjeta.hijos.map(h => h.textContent);
  assert.equal(textos[0], datos.historial[0].producto); // texto literal, no HTML
  assert.ok(textos.includes('Snacks') && textos.some(t => t.includes('3 unidades') && t.includes('1 compras')));
  assert.ok(textos.some(t => t.startsWith('Último pedido (fecha de creación):')));
  assert.ok(nodos.get('consumoResumen').textContent.includes('1 compras'));
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8'), catalogo = fs.readFileSync(path.join(__dirname, '../public/catalogo.js'), 'utf8');
  assert.ok(html.includes('id="consumptionPanel"') && html.includes('<script src="consumo.js">'));
  assert.ok(catalogo.includes('["consumption","Mi consumo"]'));
});
