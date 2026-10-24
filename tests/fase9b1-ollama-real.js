// FASE 9B-1 con Ollama REAL: flujo completo de ModuloConsultas.enviar (consulta → evaluador → relevancia → Ollama →
// validación de IDs → resolución y re-evaluación en PostgreSQL). Esquema temporal en DB_TEST_NAME, cliente y catálogo
// SINTÉTICOS con los mismos ingredientes declarados que el catálogo real. Se captura CADA cuerpo enviado a Ollama.
// Si Ollama no está disponible, los casos que lo requieren se reportan como OMITIDOS (nunca como aprobados).
//   node tests/fase9b1-ollama-real.js
process.env.JWT_SECRET = 'fase9b1-ollama-real'; process.env.ENCRYPTION_KEY = 'ef'.repeat(32);
const assert = require('node:assert/strict'), { randomUUID } = require('node:crypto');
const env = require('../src/config/env');
const { crearPool } = require('../src/database/pool'), { migrar } = require('../src/database/migraciones');
const { crearSistema } = require('../src/services/sistema'), { Administrador } = require('../src/domain/modelos');
const { ServicioIA, MEDICA, RESTRICCION, AVISO_RESTRICCION, GENERAL, SIN_COINCIDENCIAS_BASE, RESTRICCION_APLICADA_BASE } = require('../src/services/iaService'), { OllamaProvider } = require('../src/services/ollamaProvider');

const BARRAS = 'Barras Energéticas Naturales (sintético)';
const PRODUCTOS = [
  [BARRAS, 'Barras y Snacks', 'Productos nutritivos para aportar energía.', ['Avena integral', 'Frutos secos (almendras, maní, nueces)', 'Miel natural']],
  ['Bebidas Funcionales (sintético)', 'Bebidas', 'Bebidas naturales con té verde, jengibre, limón y miel.', ['Jengibre', 'Limón', 'Miel', 'Té verde']],
  ['Bebidas Saludables (sintético)', 'Bebidas', 'Bebidas naturales ricas en vitaminas.', ['Agua purificada o leche vegetal', 'Frutas frescas (naranja, piña, mango, fresa)']],
  ['Cereales Integrales (sintético)', 'Panadería y Cereales', 'Granos integrales para mañanas nutritivas.', ['Avena', 'Chía', 'Miel', 'Quinoa']],
  ['Chips Saludables (sintético)', 'Barras y Snacks', 'Snacks crujientes horneados.', ['Aceite vegetal mínimo', 'Plátano', 'Sal natural']],
];
const PROHIBIDAS = /100\s*%\s*segur|libre de al[eé]rgenos|apto para cel[ií]ac|garantizado sin trazas/i;

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
    const admin = new Administrador({ nombre: 'Admin real 9B1', correo: 'admin-real9b1@example.test', passwordHash: 'hash-sintetico' });
    await sistema.repositorios.usuarios.guardar(admin);
    const g = (tipo, datos) => sistema.catalogoComercial.guardar(admin.id, tipo, null, datos), cats = {}, ings = {}, ids = {};
    for (const [nombre, cat, descripcion, lista] of PRODUCTOS) {
      cats[cat] ??= (await g('categorias', { nombre: cat })).id; const ingredientes = [];
      for (const n of lista) ingredientes.push({ id: ings[n] ??= (await g('ingredientes', { nombre: n })).id });
      const p = await g('productos', { nombre, categoriaId: cats[cat], descripcion, precio: '15.00', estado: true, stockMinimo: 1, ingredientes }); ids[nombre] = p.id;
      await sistema.inventario.registrar(admin.id, { productoId: p.id, tipo: 'AJUSTE', cantidad: 10, motivo: 'FASE 9B-1 real' });
    }
    const cliente = await sistema.registrar({ nombre: 'Cliente real 9B1', correo: 'cliente-real9b1@example.test', password: 'Clave12345' });
    const sinManiEnSalida = desde => enviados.slice(desde).every(b => !JSON.stringify(b).includes(BARRAS) && !JSON.stringify(b).includes(ids[BARRAS]));
    // Casos que NO necesitan el modelo (respuestas fijas): se verifican siempre.
    for (const [q, texto] of [['Tengo alergias', RESTRICCION.AMBIGUA], ['Soy alérgico al maní, ¿qué barras tienen?', RESTRICCION.PRODUCTO_INCOMPATIBLE], ['Sin azúcar', RESTRICCION.SIN_INFORMACION]]) {
      const n = enviados.length, r = await sistema.consultas.enviar(cliente.id, q);
      assert.equal(r.respuestaIA, texto); assert.equal(enviados.length, n, 'sin llamar a Ollama'); assert.deepEqual(r.productosRecomendados, []);
      registrar(`"${q}": mensaje fijo sin modelo`, 'APROBADA');
    }
    if (!salud.disponible || !salud.tieneModeloConfigurado) {
      registrar('Ollama real (maní, bebidas, vegano)', 'OMITIDA', { motivo: !salud.disponible ? `OLLAMA_NO_DISPONIBLE en ${env.ollamaBaseUrl}` : `modelo "${env.ollamaModel}" no instalado` });
    } else {
      for (const q of ['Soy alérgico al maní', 'Soy alérgico al maní, quiero bebidas', 'Quiero un snack sin maní', 'Soy alérgico al maní, recomiéndame algo para desayunar']) {
        const n = enviados.length, inicio = Date.now(), r = await sistema.consultas.enviar(cliente.id, q);
        assert.ok(sinManiEnSalida(n), 'el producto con maní nunca sale hacia Ollama');
        assert.ok(!r.productosRecomendados.some(p => p.nombre === BARRAS), 'sin tarjeta del producto con maní');
        if (r.productosRecomendados.length) assert.ok(r.respuestaIA.endsWith(AVISO_RESTRICCION.ALERGIA), 'aviso de alérgenos y trazas');
        // Revisión manual: sin tarjetas, la respuesta explica el filtrado o es un mensaje fijo (nunca el texto general).
        else { assert.notEqual(r.respuestaIA, GENERAL); assert.ok(r.respuestaIA.startsWith(RESTRICCION_APLICADA_BASE) || Object.values(RESTRICCION).includes(r.respuestaIA) || r.respuestaIA.startsWith(SIN_COINCIDENCIAS_BASE)); }
        assert.doesNotMatch(r.respuestaIA, PROHIBIDAS);
        const generar = enviados.slice(n).find(b => b.prompt);
        registrar(`"${q}": maní excluido antes de Ollama`, 'APROBADA', { ms: Date.now() - inicio, llamoModelo: !!generar,
          candidatosEnviados: generar ? JSON.parse(generar.prompt).productos.map(p => p.nombre) : [], tarjetas: r.productosRecomendados.map(p => p.nombre) });
      }
      const n = enviados.length, r = await sistema.consultas.enviar(cliente.id, 'Soy vegano, busco snacks');
      const generar = enviados.slice(n).find(b => b.prompt);
      assert.ok(!generar || JSON.parse(generar.prompt).productos.every(p => p.nombre === 'Chips Saludables (sintético)'));
      if (r.productosRecomendados.length) assert.ok(r.respuestaIA.endsWith(AVISO_RESTRICCION.DIETA));
      registrar('"Soy vegano, busco snacks": solo permitidos y aviso de no certificación', 'APROBADA', { tarjetas: r.productosRecomendados.map(p => p.nombre) });
      const m = enviados.length, med = await sistema.consultas.enviar(cliente.id, 'Soy alérgico al maní, ¿qué medicamento debo tomar?');
      assert.equal(med.respuestaIA, MEDICA); assert.equal(enviados.length, m);
      registrar('Consulta médica con restricción: prioridad médica, sin Ollama', 'APROBADA');
    }
    const apagado = crearSistema({ pool, ia: new ServicioIA({ ollamaProvider: new OllamaProvider({ baseUrl: 'http://127.0.0.1:9', model: env.ollamaModel || 'x', timeoutMs: 2000 }) }) });
    await assert.rejects(apagado.consultas.enviar(cliente.id, 'Soy alérgico al maní, quiero bebidas'), e => e.status === 503);
    const fija = await apagado.consultas.enviar(cliente.id, 'Tengo alergias'); assert.equal(fija.respuestaIA, RESTRICCION.AMBIGUA);
    registrar('Ollama apagado: 503 con candidatos; mensajes fijos siguen disponibles', 'APROBADA');
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
