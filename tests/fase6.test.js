const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
process.env.JWT_SECRET = 'fase6-sintetico';
process.env.ENCRYPTION_KEY = 'ab'.repeat(32);

const { crearPool } = require('../src/database/pool');
const { migrar } = require('../src/database/migraciones');
const { crearSistema } = require('../src/services/sistema');
const { crearApp } = require('../src/app');
const { Administrador, Empleado, Cliente } = require('../src/domain/modelos');
const { generarToken } = require('../src/security/auth');
const { validarCrearPedido, validarCambioEstado, validarFiltrosPedidos } = require('../src/security/pedidosValidacion');

test('FASE6 validaciones de entrada de pedidos', () => {
  const itemValido = { productoId: randomUUID(), cantidad: 2 };
  assert.equal(validarCrearPedido({ items: [itemValido] }).items.length, 1);
  assert.throws(() => validarCrearPedido({ items: [] }));
  assert.throws(() => validarCrearPedido({ items: [{ ...itemValido, cantidad: -1 }] }));
  assert.throws(() => validarCrearPedido({ items: [{ ...itemValido, cantidad: 0 }] }));
  assert.throws(() => validarCrearPedido({ items: [{ productoId: 'invalido', cantidad: 1 }] }));
  assert.throws(() => validarCambioEstado({ estado: 'ESTADO_INEXISTENTE' }));
  assert.equal(validarCambioEstado({ estado: 'CONFIRMADO' }).estado, 'CONFIRMADO');
  assert.throws(() => validarFiltrosPedidos({ desde: '2026-02-30' }));
  assert.throws(() => validarFiltrosPedidos({ desde: '2026-10-01', hasta: '2026-09-01' }));
});

test('FASE6 pedidos: carrito, precio histórico, confirmación, stock, cancelación, idempotencia y RBAC', async t => {
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

  const admin = new Administrador({ nombre: 'Admin', correo: 'admin6@example.test', passwordHash: 'hash-sintetico' });
  const empleado = new Empleado({ nombre: 'Empleado', correo: 'empleado6@example.test', passwordHash: 'hash-sintetico' });
  const cliente1 = new Cliente({ nombre: 'Cliente Uno', correo: 'cliente1@example.test', passwordHash: 'hash-sintetico' });
  const cliente2 = new Cliente({ nombre: 'Cliente Dos', correo: 'cliente2@example.test', passwordHash: 'hash-sintetico' });

  for (const u of [admin, empleado, cliente1, cliente2]) await sistema.repositorios.usuarios.guardar(u);

  const ta = generarToken(admin);
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

  const categoria = await sistema.catalogoComercial.guardar(admin.id, 'categorias', null, { nombre: 'Nutrición F6' });

  const crearProd = async (nombre, precio = '15.00', stockInicial = 10, estado = true) => {
    const p = await sistema.catalogoComercial.guardar(admin.id, 'productos', null, {
      nombre,
      categoriaId: categoria.id,
      estado,
      precio,
      stockMinimo: 2
    });
    if (stockInicial !== null) {
      await sistema.inventario.registrar(admin.id, {
        productoId: p.id,
        tipo: 'AJUSTE',
        cantidad: stockInicial,
        motivo: 'Stock inicial F6'
      });
    }
    return p;
  };

  const p1 = await crearProd('Granola Orgánica', '25.00', 10);
  const p2 = await crearProd('Barra Proteica', '10.00', 5);
  const pAgotado = await crearProd('Batido Fresa', '20.00', 0);
  const pInactivo = await crearProd('Bebida Inactiva', '12.00', null, false);

  await t.test('1. Producto inactivo o agotado rechazado al crear pedido', async () => {
    const rInactivo = await api('POST', '/pedidos', { items: [{ productoId: pInactivo.id, cantidad: 1 }] });
    assert.equal(rInactivo.status, 409);

    // Nota: Crear pedido PENDIENTE con producto agotado es permitido porque NO descuenta stock aún,
    // pero al CONFIRMAR se rechazará si no hay stock suficiente.
  });

  let idPedidoPrueba;
  await t.test('2. Creación de pedido PENDIENTE obtiene precio desde PostgreSQL y NO descuenta stock', async () => {
    // Frontend intenta enviar precio falso Q1.00; backend DEBE usar precio PostgreSQL (Q25.00 y Q10.00)
    const body = {
      items: [
        { productoId: p1.id, cantidad: 2, precioFalso: '1.00' },
        { productoId: p2.id, cantidad: 1 }
      ]
    };
    const r = await api('POST', '/pedidos', body, tc1);
    assert.equal(r.status, 201);
    assert.equal(r.data.pedido.estado, 'PENDIENTE');
    assert.equal(r.data.pedido.subtotal, '60.00'); // (25.00 * 2) + (10.00 * 1)
    assert.equal(r.data.pedido.total, '60.00');
    assert.equal(r.data.pedido.totalFormateado, 'Q 60.00');
    idPedidoPrueba = r.data.pedido.id;

    // Verificar que stock NO se descontó en estado PENDIENTE
    const invP1 = (await pool.query('SELECT cantidad FROM inventario WHERE id_producto = $1', [p1.id])).rows[0].cantidad;
    assert.equal(invP1, 10);
  });

  await t.test('3. Precio histórico: editar precio del producto NO modifica pedido PENDIENTE existente', async () => {
    // Editar precio de p1 a Q30.00
    await sistema.catalogoComercial.guardar(admin.id, 'productos', p1.id, { precio: '30.00' });

    const r = await api('GET', `/pedidos/${idPedidoPrueba}`, undefined, tc1);
    assert.equal(r.status, 200);
    assert.equal(r.data.pedido.subtotal, '60.00');
    const d1 = r.data.pedido.detalles.find(d => d.productoId === p1.id);
    assert.equal(d1.precioUnitario, '25.00');

    // Restaurar precio a Q25.00
    await sistema.catalogoComercial.guardar(admin.id, 'productos', p1.id, { precio: '25.00' });
  });

  await t.test('4. Confirmación de pedido descuenta stock atómicamente y crea movimiento SALIDA', async () => {
    const r = await api('PATCH', `/pedidos/${idPedidoPrueba}/estado`, { estado: 'CONFIRMADO' }, te);
    assert.equal(r.status, 200);
    assert.equal(r.data.pedido.estado, 'CONFIRMADO');

    // Verificar stock descontado
    const invP1 = (await pool.query('SELECT cantidad FROM inventario WHERE id_producto = $1', [p1.id])).rows[0].cantidad;
    const invP2 = (await pool.query('SELECT cantidad FROM inventario WHERE id_producto = $1', [p2.id])).rows[0].cantidad;
    assert.equal(invP1, 8); // 10 - 2
    assert.equal(invP2, 4); // 5 - 1

    // Movimientos de inventario registrados como SALIDA
    const movs = (await pool.query('SELECT * FROM movimientos_inventario WHERE motivo LIKE $1', [`%${idPedidoPrueba}%`])).rows;
    assert.equal(movs.length, 2);
    assert.ok(movs.every(m => m.tipo === 'SALIDA'));
  });

  await t.test('5. Idempotencia: confirmar repetidamente un pedido ya CONFIRMADO no duplica salidas de stock', async () => {
    const r = await api('PATCH', `/pedidos/${idPedidoPrueba}/estado`, { estado: 'CONFIRMADO' }, te);
    assert.equal(r.status, 200);
    assert.equal(r.data.pedido.estado, 'CONFIRMADO');

    // Verificar que stock se mantuvo intacto
    const invP1 = (await pool.query('SELECT cantidad FROM inventario WHERE id_producto = $1', [p1.id])).rows[0].cantidad;
    assert.equal(invP1, 8);
  });

  await t.test('6. Transición PENDIENTE -> CONFIRMADO falla con ROLLBACK TOTAL si falta stock en un producto', async () => {
    // pAgotado tiene 0 stock
    const ped = await api('POST', '/pedidos', { items: [{ productoId: p1.id, cantidad: 1 }, { productoId: pAgotado.id, cantidad: 1 }] }, tc1);
    const pid = ped.data.pedido.id;

    const rConf = await api('PATCH', `/pedidos/${pid}/estado`, { estado: 'CONFIRMADO' }, te);
    assert.equal(rConf.status, 409);

    // Ningún producto debe haber sufrido descuento
    const invP1 = (await pool.query('SELECT cantidad FROM inventario WHERE id_producto = $1', [p1.id])).rows[0].cantidad;
    assert.equal(invP1, 8);
  });

  await t.test('7. Cancelar pedido CONFIRMADO repone el stock (ENTRADA) exactamente una vez', async () => {
    const r = await api('PATCH', `/pedidos/${idPedidoPrueba}/estado`, { estado: 'CANCELADO' }, tc1);
    assert.equal(r.status, 200);
    assert.equal(r.data.pedido.estado, 'CANCELADO');

    // Stock reajustado
    const invP1 = (await pool.query('SELECT cantidad FROM inventario WHERE id_producto = $1', [p1.id])).rows[0].cantidad;
    const invP2 = (await pool.query('SELECT cantidad FROM inventario WHERE id_producto = $1', [p2.id])).rows[0].cantidad;
    assert.equal(invP1, 10); // 8 + 2
    assert.equal(invP2, 5);  // 4 + 1

    // Segunda cancelación: no repone stock de nuevo (idempotente)
    const r2 = await api('PATCH', `/pedidos/${idPedidoPrueba}/estado`, { estado: 'CANCELADO' }, tc1);
    assert.equal(r2.status, 200);
    const invP1_reiterado = (await pool.query('SELECT cantidad FROM inventario WHERE id_producto = $1', [p1.id])).rows[0].cantidad;
    assert.equal(invP1_reiterado, 10);
  });

  await t.test('8. Cancelar pedido PENDIENTE cambia estado a CANCELADO sin movimiento de inventario', async () => {
    const ped = await api('POST', '/pedidos', { items: [{ productoId: p1.id, cantidad: 3 }] }, tc1);
    const pid = ped.data.pedido.id;

    const r = await api('PATCH', `/pedidos/${pid}/estado`, { estado: 'CANCELADO' }, tc1);
    assert.equal(r.status, 200);

    const movs = (await pool.query('SELECT * FROM movimientos_inventario WHERE motivo LIKE $1', [`%${pid}%`])).rows;
    assert.equal(movs.length, 0); // Ningún movimiento registrado
  });

  await t.test('9. Transiciones avanzadas y denegación de saltos inválidos', async () => {
    const ped = await api('POST', '/pedidos', { items: [{ productoId: p1.id, cantidad: 1 }] }, tc1);
    const pid = ped.data.pedido.id;

    await api('PATCH', `/pedidos/${pid}/estado`, { estado: 'CONFIRMADO' }, te);
    await api('PATCH', `/pedidos/${pid}/estado`, { estado: 'EN_PREPARACION' }, te);
    await api('PATCH', `/pedidos/${pid}/estado`, { estado: 'LISTO' }, te);
    const rEnt = await api('PATCH', `/pedidos/${pid}/estado`, { estado: 'ENTREGADO' }, te);
    assert.equal(rEnt.status, 200);
    assert.equal(rEnt.data.pedido.estado, 'ENTREGADO');

    // Intento de regresar de ENTREGADO a PENDIENTE o CANCELADO rechazado (409)
    const rInvalido = await api('PATCH', `/pedidos/${pid}/estado`, { estado: 'PENDIENTE' }, te);
    assert.equal(rInvalido.status, 409);
  });

  await t.test('10. Aislamiento RBAC: cliente no puede ver ni modificar pedidos ajenos', async () => {
    const ped = await api('POST', '/pedidos', { items: [{ productoId: p1.id, cantidad: 1 }] }, tc1);
    const pid = ped.data.pedido.id;

    // Cliente 2 intenta ver pedido de Cliente 1 (403)
    const rGet = await api('GET', `/pedidos/${pid}`, undefined, tc2);
    assert.equal(rGet.status, 403);

    // Cliente 2 intenta cancelar pedido de Cliente 1 (403)
    const rPatch = await api('PATCH', `/pedidos/${pid}/estado`, { estado: 'CANCELADO' }, tc2);
    assert.equal(rPatch.status, 403);

    // Empleado y Admin pueden listar y acceder a todos los pedidos
    const rEmpList = await api('GET', '/pedidos', undefined, te);
    assert.equal(rEmpList.status, 200);
    assert.ok(rEmpList.data.pedidos.some(p => p.id === pid));
  });

  await t.test('11. Concurrencia de confirmaciones: solo una confirmación descuenta stock cuando las existencias son limitadas', async () => {
    // p2 tiene 5 existencias
    const p3 = await crearProd('SuperAlimento', '50.00', 3);

    const pedA = await api('POST', '/pedidos', { items: [{ productoId: p3.id, cantidad: 3 }] }, tc1);
    const pedB = await api('POST', '/pedidos', { items: [{ productoId: p3.id, cantidad: 3 }] }, tc2);

    // Intentar confirmar simultáneamente
    const res = await Promise.all([
      api('PATCH', `/pedidos/${pedA.data.pedido.id}/estado`, { estado: 'CONFIRMADO' }, te),
      api('PATCH', `/pedidos/${pedB.data.pedido.id}/estado`, { estado: 'CONFIRMADO' }, te)
    ]);

    const statuses = res.map(r => r.status).sort();
    assert.deepEqual(statuses, [200, 409]); // Una aprobada, una rechazada por stock

    const stockFinal = (await pool.query('SELECT cantidad FROM inventario WHERE id_producto = $1', [p3.id])).rows[0].cantidad;
    assert.equal(stockFinal, 0); // No debe quedar stock negativo
  });
  await t.test('RBAC antes de transición e idempotencia; los estados operativos son exclusivos del personal',async()=>{
    const id=(await api('POST','/pedidos',{items:[{productoId:p1.id,cantidad:1}]},tc1)).data.pedido.id;
    for(const estado of ['CONFIRMADO','EN_PREPARACION','LISTO','ENTREGADO']){
      assert.equal((await api('PATCH',`/pedidos/${id}/estado`,{estado},tc1)).status,403);
      assert.equal((await api('PATCH',`/pedidos/${id}/estado`,{estado},ta)).status,200);
      assert.equal((await api('PATCH',`/pedidos/${id}/estado`,{estado},tc1)).status,403);
    }
    assert.equal((await api('PATCH',`/pedidos/${id}/estado`,{estado:'CANCELADO'},tc1)).status,409);
    for(const token of [te,ta])assert.equal((await api('POST','/pedidos',{items:[{productoId:p1.id,cantidad:1}]},token)).status,403);
  });
  await t.test('Cancelación compensa producto inactivo una vez sin habilitar entradas manuales',async()=>{
    const id=(await api('POST','/pedidos',{items:[{productoId:p1.id,cantidad:1}]},tc1)).data.pedido.id;
    const stock=Number((await pool.query('SELECT cantidad FROM inventario WHERE id_producto=$1',[p1.id])).rows[0].cantidad);
    assert.equal((await api('PATCH',`/pedidos/${id}/estado`,{estado:'CONFIRMADO'},te)).status,200);
    await sistema.catalogoComercial.guardar(admin.id,'productos',p1.id,{estado:false});
    for(const token of [te,ta])assert.equal((await api('POST','/inventario/movimientos',{productoId:p1.id,tipo:'ENTRADA',cantidad:1,motivo:'No compensación'},token)).status,409);
    for(let n=0;n<2;n++)assert.equal((await api('PATCH',`/pedidos/${id}/estado`,{estado:'CANCELADO'},tc1)).status,200);
    assert.equal(Number((await pool.query('SELECT cantidad FROM inventario WHERE id_producto=$1',[p1.id])).rows[0].cantidad),stock);
    assert.equal((await pool.query("SELECT count(*)::int n FROM movimientos_inventario WHERE tipo='ENTRADA' AND motivo=$1",[`Reposición por cancelación de pedido #${id}`])).rows[0].n,1);
  });


  await t.test('RBAC 6.1: CLIENTE propietario no marca ningún estado operativo (403 antes de validar transición)', async () => {
    const id = (await api('POST', '/pedidos', { items: [{ productoId: p2.id, cantidad: 1 }] }, tc1)).data.pedido.id;
    const stockAntes = Number((await pool.query('SELECT cantidad FROM inventario WHERE id_producto=$1', [p2.id])).rows[0].cantidad);
    // Desde PENDIENTE, ENTREGADO sería además una transición inválida (409); RBAC responde primero.
    for (const estado of ['CONFIRMADO', 'EN_PREPARACION', 'LISTO', 'ENTREGADO']) {
      const r = await api('PATCH', `/pedidos/${id}/estado`, { estado }, tc1);
      assert.equal(r.status, 403, `CLIENTE no debe marcar ${estado}`);
      assert.equal(r.data.codigo, 'ACCESO_DENEGADO');
      assert.equal(typeof r.data.error, 'string');
    }
    const ped = (await pool.query('SELECT estado FROM pedidos WHERE id_pedido=$1', [id])).rows[0];
    assert.equal(ped.estado, 'PENDIENTE');
    assert.equal(Number((await pool.query('SELECT cantidad FROM inventario WHERE id_producto=$1', [p2.id])).rows[0].cantidad), stockAntes);
    assert.equal((await pool.query('SELECT count(*)::int n FROM movimientos_inventario WHERE motivo LIKE $1', [`%#${id}`])).rows[0].n, 0);
    // El cliente sí puede cancelar SU pedido pendiente.
    assert.equal((await api('PATCH', `/pedidos/${id}/estado`, { estado: 'CANCELADO' }, tc1)).status, 200);
  });

  for (const [rolNombre, token] of [['EMPLEADO', () => te], ['ADMINISTRADOR', () => ta]]) {
    await t.test(`RBAC 6.1: ${rolNombre} realiza PENDIENTE→CONFIRMADO→EN_PREPARACION→LISTO→ENTREGADO con un solo descuento`, async () => {
      const id = (await api('POST', '/pedidos', { items: [{ productoId: p2.id, cantidad: 1 }] }, tc1)).data.pedido.id;
      const stockAntes = Number((await pool.query('SELECT cantidad FROM inventario WHERE id_producto=$1', [p2.id])).rows[0].cantidad);
      for (const estado of ['CONFIRMADO', 'EN_PREPARACION', 'LISTO', 'ENTREGADO']) {
        const r = await api('PATCH', `/pedidos/${id}/estado`, { estado }, token());
        assert.equal(r.status, 200, `${rolNombre} → ${estado}`);
        assert.equal(r.data.pedido.estado, estado);
      }
      assert.equal(Number((await pool.query('SELECT cantidad FROM inventario WHERE id_producto=$1', [p2.id])).rows[0].cantidad), stockAntes - 1);
      const movs = (await pool.query('SELECT tipo FROM movimientos_inventario WHERE motivo LIKE $1', [`%#${id}`])).rows;
      assert.deepEqual(movs.map(m => m.tipo), ['SALIDA']);
      // Saltos inválidos siguen bloqueados por la máquina de estados, aun con rol autorizado.
      assert.equal((await api('PATCH', `/pedidos/${id}/estado`, { estado: 'CANCELADO' }, token())).status, 409);
    });
  }

  await t.test('RBAC 6.1: EMPLEADO cancela pedido EN_PREPARACION y repone exactamente una vez', async () => {
    const id = (await api('POST', '/pedidos', { items: [{ productoId: p2.id, cantidad: 2 }] }, tc1)).data.pedido.id;
    const stockAntes = Number((await pool.query('SELECT cantidad FROM inventario WHERE id_producto=$1', [p2.id])).rows[0].cantidad);
    assert.equal((await api('PATCH', `/pedidos/${id}/estado`, { estado: 'CONFIRMADO' }, te)).status, 200);
    assert.equal((await api('PATCH', `/pedidos/${id}/estado`, { estado: 'EN_PREPARACION' }, te)).status, 200);
    const [c1, c2] = await Promise.all([
      api('PATCH', `/pedidos/${id}/estado`, { estado: 'CANCELADO' }, te),
      api('PATCH', `/pedidos/${id}/estado`, { estado: 'CANCELADO' }, ta),
    ]);
    assert.deepEqual([c1.status, c2.status], [200, 200]);
    assert.equal(Number((await pool.query('SELECT cantidad FROM inventario WHERE id_producto=$1', [p2.id])).rows[0].cantidad), stockAntes);
    assert.equal((await pool.query("SELECT count(*)::int n FROM movimientos_inventario WHERE tipo='ENTRADA' AND motivo=$1", [`Reposición por cancelación de pedido #${id}`])).rows[0].n, 1);
  });

});

test('Carrito: aislamiento entre cuentas, salida limpia y nombres tratados como texto',()=>{
 const vm=require('node:vm'),fs=require('node:fs'),almacen=new Map(),nodos=new Map();
 const nodo=()=>({textContent:'',value:'',append(){},replaceChildren(){},setAttribute(){},addEventListener(){},set innerHTML(v){throw Error('HTML dinámico prohibido');}});
 const ctx=vm.createContext({window:{},document:{getElementById:id=>{if(!nodos.has(id))nodos.set(id,nodo());return nodos.get(id);},createElement:nodo},localStorage:{getItem:k=>almacen.get(k),setItem:(k,v)=>almacen.set(k,v)},console});
 vm.runInContext(fs.readFileSync(require('path').join(__dirname,'../public/carrito.js'),'utf8'),ctx);
 const c=ctx.window.NutriVidaCarrito,a={id:randomUUID(),rol:'CLIENTE'},b={id:randomUUID(),rol:'CLIENTE'},p={id:randomUUID(),nombre:'<img src=x>',precio:'5.00'};
 c.sesion(a);c.agregarAlCarrito(p);c.actualizarCantidad(p.id,3);assert.equal(c.leerCarrito()[0].cantidad,3);
 c.sesion(null);assert.equal(c.leerCarrito().length,0);c.sesion(b);assert.equal(c.leerCarrito().length,0);
 c.sesion(a);assert.equal(c.leerCarrito()[0].nombre,p.nombre);c.eliminarDelCarrito(p.id);assert.equal(c.leerCarrito().length,0);
});

test('RBAC 6.1 unitario: autorización por rol independiente de la máquina de estados', () => {
  const { autorizarCambioEstado } = require('../src/services/pedidosService');
  for (const estado of ['CONFIRMADO', 'EN_PREPARACION', 'LISTO', 'ENTREGADO']) {
    assert.throws(() => autorizarCambioEstado({ rol: 'CLIENTE' }, estado), e => e.status === 403);
    assert.equal(autorizarCambioEstado({ rol: 'EMPLEADO' }, estado), 'EMPLEADO');
    assert.equal(autorizarCambioEstado({ rol: 'ADMINISTRADOR' }, estado), 'ADMINISTRADOR');
    assert.equal(autorizarCambioEstado({ rol: 'PERSONAL_NUTRIVIDA' }, estado), 'EMPLEADO'); // alias legado
  }
  assert.equal(autorizarCambioEstado({ rol: 'CLIENTE' }, 'CANCELADO'), 'CLIENTE');
  for (const rol of [undefined, null, 'INVITADO', 'cliente']) assert.throws(() => autorizarCambioEstado({ rol }, 'CANCELADO'), e => e.status === 403);
  assert.throws(() => autorizarCambioEstado({ rol: 'CLIENTE' }, 'PENDIENTE'), e => e.status === 403);
  assert.equal(autorizarCambioEstado({ rol: 'ADMINISTRADOR' }, 'PENDIENTE'), 'ADMINISTRADOR'); // luego 409 por la máquina de estados
});

test('Frontend FASE 6 conectado: navegación CLIENTE, carrito, pedidos y sin dependencias inexistentes', () => {
  const fs = require('node:fs'), path = require('node:path');
  const pub = f => fs.readFileSync(path.join(__dirname, '../public', f), 'utf8');
  const html = pub('index.html'), catalogo = pub('catalogo.js'), carrito = pub('carrito.js'), pedidos = pub('pedidos.js');
  const orden = ['carrito.js', 'pedidos.js', 'catalogo.js', 'app.js'].map(f => html.indexOf(`<script src="${f}">`));
  assert.ok(orden.every(i => i > 0) && orden.every((v, i, a) => i === 0 || a[i - 1] < v), 'scripts conectados en orden');
  for (const id of ['cartPanel', 'cartItemsList', 'cartCheckoutBtn', 'ordersPanel', 'pedidosList'])
    assert.ok(html.includes(`id="${id}"`), 'falta ' + id);
  const menuCliente = catalogo.match(/\[\["home","Inicio"\][^;]*\]\]/)?.[0] || '';
  for (const etiqueta of ['Inicio', 'Catálogo', 'Mi carrito', 'Mis pedidos', 'Mi consumo', 'NutriVida AI', 'Mi perfil'])
    assert.ok(menuCliente.includes(`"${etiqueta}"`), 'menú CLIENTE sin ' + etiqueta);
  assert.ok(html.includes('id="logoutBtn"'), 'Cerrar sesión');
  assert.ok(catalogo.includes('Agregar al carrito') && /rol==="CLIENTE"&&\["CON_EXISTENCIA","BAJO_STOCK"\]\.includes\(p\.disponibilidad\)/.test(catalogo));
  assert.ok(catalogo.includes('window.nutrividaNavegar=navegar') && carrito.includes("window.nutrividaNavegar('orders')"));
  for (const [nombre, src] of [['catalogo', catalogo], ['carrito', carrito], ['pedidos', pedidos]]) {
    assert.ok(!src.includes('NutriVidaApp'), nombre + ' usa dependencia inexistente');
    assert.ok(!/innerHTML\s*=/.test(src), nombre + ' usa innerHTML');
  }
  assert.ok(!/localStorage\.(get|set)Item\(\s*['"]/.test(carrito), 'clave de carrito compartida');
});
