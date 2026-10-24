// FASE 9C con Ollama REAL: el historial de compras ENTREGADAS solo ajusta la relevancia en el backend y NUNCA sale hacia
// Ollama. Esquema temporal en DB_TEST_NAME con cliente, catálogo y pedidos SINTÉTICOS; se captura cada cuerpo enviado.
// Si Ollama no está disponible, los casos que lo requieren se reportan como OMITIDOS (nunca como aprobados).
//   node tests/fase9c-ollama-real.js
process.env.JWT_SECRET = 'fase9c-ollama-real'; process.env.ENCRYPTION_KEY = 'ab'.repeat(32);
const assert = require('node:assert/strict'), { randomUUID } = require('node:crypto');
const env = require('../src/config/env');
const { crearPool } = require('../src/database/pool'), { migrar } = require('../src/database/migraciones');
const { crearSistema } = require('../src/services/sistema'), { Administrador } = require('../src/domain/modelos');
const { ServicioIA, RESTRICCION } = require('../src/services/iaService'), { OllamaProvider } = require('../src/services/ollamaProvider');

const BEBF = 'Bebidas Funcionales (sintético 9C)', BEBS = 'Bebidas Saludables (sintético 9C)', BARRAS = 'Barras con maní (sintético 9C)';
(async () => {
  const id = randomUUID().replaceAll('-', ''), schema = 'nv_test_' + id, control = 'nv_test_control_' + id;
  const gestor = crearPool({ pruebas: true }), pool = crearPool({ pruebas: true, schema }), resultados = []; let creado = false;
  const registrar = (caso, estado, detalle = {}) => { resultados.push({ caso, estado, ...detalle }); console.log(`${estado === 'APROBADA' ? '✔' : estado === 'OMITIDA' ? '↷' : '✘'} ${caso}`); };
  try {
    await gestor.query(`CREATE SCHEMA ${schema}`); creado = true; await migrar(pool, { esquemaControl: control });
    const enviados = [];
    const real = new OllamaProvider({ timeoutMs: Math.max(env.ollamaTimeoutMs, 60000), transporte: async (url, opts) => { if (opts?.body) enviados.push(JSON.parse(opts.body)); return fetch(url, opts); } });
    const salud = await new OllamaProvider().comprobarSalud();
    const sistema = crearSistema({ pool, ia: new ServicioIA({ ollamaProvider: real }) });
    const admin = new Administrador({ nombre: 'Admin real 9C', correo: 'admin-real9c@example.test', passwordHash: 'hash-sintetico' });
    await sistema.repositorios.usuarios.guardar(admin);
    const g = (tipo, datos) => sistema.catalogoComercial.guardar(admin.id, tipo, null, datos), cats = {}, ings = {}, ids = {};
    for (const [nombre, cat, descripcion, lista] of [[BEBF, 'Bebidas', 'Bebidas naturales con té verde y limón.', ['Té verde', 'Limón']],
      [BEBS, 'Bebidas', 'Bebidas naturales ricas en vitaminas.', ['Agua purificada', 'Frutas frescas (naranja, piña)']],
      [BARRAS, 'Barras y Snacks', 'Barras nutritivas.', ['Avena integral', 'Frutos secos (almendras, maní)']]]) {
      cats[cat] ??= (await g('categorias', { nombre: cat })).id; const ingredientes = [];
      for (const n of lista) ingredientes.push({ id: ings[n] ??= (await g('ingredientes', { nombre: n })).id });
      const p = await g('productos', { nombre, categoriaId: cats[cat], descripcion, precio: '15.00', estado: true, stockMinimo: 1, ingredientes }); ids[nombre] = p.id;
      await sistema.inventario.registrar(admin.id, { productoId: p.id, tipo: 'AJUSTE', cantidad: 10, motivo: 'FASE 9C real' });
    }
    const cliente = await sistema.registrar({ nombre: 'Cliente real 9C', correo: 'cliente-real9c@example.test', password: 'Clave12345' });
    for (const [estado, prod] of [['ENTREGADO', BEBS], ['ENTREGADO', BEBS], ['ENTREGADO', BARRAS], ['PENDIENTE', BEBF], ['CANCELADO', BEBF]]) {
      const db = await pool.connect();
      try { await db.query('BEGIN'); const r = await db.query("INSERT INTO pedidos(id_cliente,estado,subtotal,total,fecha_pedido) VALUES($1,$2,15,15,CURRENT_TIMESTAMP - interval '5 days') RETURNING id_pedido", [cliente.id, estado]);
        await db.query('INSERT INTO detalle_pedido(id_pedido,id_producto,cantidad,precio_unitario,subtotal) VALUES($1,$2,1,15,15)', [r.rows[0].id_pedido, ids[prod]]); await db.query('COMMIT'); }
      catch (e) { await db.query('ROLLBACK'); throw e; } finally { db.release(); }
    }
    const consentir = c => sistema.perfil.actualizarConsentimientos(cliente.id, c);
    const sinHistorial = desde => { const t = JSON.stringify(enviados.slice(desde)); return !/pedido|historial|compra|recurrente|frecuente|cliente-real9c/i.test(t); };
    // Sin modelo: restricción explícita sobre un producto comprado (historial autorizado) → mensaje fijo.
    await consentir({ autorizaHistorialIA: true });
    let n = enviados.length, r = await sistema.consultas.enviar(cliente.id, 'Soy alérgico al maní, ¿qué barras tienen?');
    assert.equal(r.respuestaIA, RESTRICCION.PRODUCTO_INCOMPATIBLE); assert.equal(enviados.length, n); assert.deepEqual(r.productosRecomendados, []);
    registrar('Restricción explícita prevalece sobre un producto comprado (sin modelo)', 'APROBADA');
    if (!salud.disponible || !salud.tieneModeloConfigurado) {
      registrar('Ollama real (historial autorizado / retirado)', 'OMITIDA', { motivo: !salud.disponible ? `OLLAMA_NO_DISPONIBLE en ${env.ollamaBaseUrl}` : `modelo "${env.ollamaModel}" no instalado` });
    } else {
      n = enviados.length; let t0 = Date.now(); r = await sistema.consultas.enviar(cliente.id, '¿Qué bebidas tienen?');
      const conHist = JSON.parse(enviados.slice(n).find(b => b.prompt).prompt);
      assert.deepEqual(conHist.productos.map(p => p.nombre), [BEBS, BEBF], 'historial autorizado: BEBS (2 entregas) primero');
      assert.ok(sinHistorial(n), 'ninguna información de compras en el cuerpo enviado a Ollama');
      assert.deepEqual(Object.keys(conHist).sort(), ['consulta', 'perfil', 'productos']);
      assert.ok(r.productosRecomendados.every(p => [BEBF, BEBS].includes(p.nombre)), 'tarjetas solo de candidatos válidos');
      registrar('Historial autorizado: orden de candidatos ajustado en el backend; Ollama sin compras', 'APROBADA', { ms: Date.now() - t0, candidatos: conHist.productos.map(p => p.nombre), tarjetas: r.productosRecomendados.map(p => p.nombre) });
      await consentir({ autorizaHistorialIA: false });
      n = enviados.length; t0 = Date.now(); r = await sistema.consultas.enviar(cliente.id, '¿Qué bebidas tienen?');
      const sinHist = JSON.parse(enviados.slice(n).find(b => b.prompt).prompt);
      assert.deepEqual(sinHist.productos.map(p => p.nombre), [BEBF, BEBS], 'retirado: sin personalización');
      registrar('Historial retirado: la siguiente consulta no usa compras', 'APROBADA', { ms: Date.now() - t0, tarjetas: r.productosRecomendados.map(p => p.nombre) });
    }
    const apagado = crearSistema({ pool, ia: new ServicioIA({ ollamaProvider: new OllamaProvider({ baseUrl: 'http://127.0.0.1:9', model: env.ollamaModel || 'x', timeoutMs: 2000 }) }) });
    await consentir({ autorizaHistorialIA: true });
    await assert.rejects(apagado.consultas.enviar(cliente.id, '¿Qué bebidas tienen?'), e => e.status === 503);
    registrar('Ollama apagado con historial autorizado: error controlado 503', 'APROBADA');
    const estados = (await pool.query('SELECT estado, count(*)::int n FROM pedidos WHERE id_cliente=$1 GROUP BY estado ORDER BY estado', [cliente.id])).rows;
    assert.deepEqual(estados, [{ estado: 'CANCELADO', n: 1 }, { estado: 'ENTREGADO', n: 3 }, { estado: 'PENDIENTE', n: 1 }], 'pedidos intactos');
  } catch (e) { registrar('Error inesperado', 'FALLIDA', { error: e.message }); }
  finally {
    await pool.end();
    try { if (creado) { await gestor.query(`DROP SCHEMA ${schema} CASCADE`); await gestor.query(`DROP SCHEMA IF EXISTS ${control} CASCADE`); } } finally { await gestor.end(); }
  }
  const resumen = { modelo: env.ollamaModel, aprobadas: resultados.filter(r => r.estado === 'APROBADA').length, omitidas: resultados.filter(r => r.estado === 'OMITIDA').length,
    fallidas: resultados.filter(r => r.estado === 'FALLIDA').length, datos: 'sintéticos en DB_TEST_NAME (esquema temporal)', resultados };
  console.log(JSON.stringify(resumen, null, 1));
  if (resumen.fallidas) process.exitCode = 1;
})();
