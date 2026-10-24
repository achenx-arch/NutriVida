// FASE 9B-2 con Ollama REAL: datos alimentarios guardados + consentimiento de perfil en el flujo completo de
// ModuloConsultas.enviar. Esquema temporal en DB_TEST_NAME, cliente y catálogo SINTÉTICOS. Se captura cada cuerpo enviado
// a Ollama. Si Ollama no está disponible, los casos que lo requieren se reportan como OMITIDOS (nunca como aprobados).
//   node tests/fase9b2-ollama-real.js
process.env.JWT_SECRET = 'fase9b2-ollama-real'; process.env.ENCRYPTION_KEY = 'ab'.repeat(32);
const assert = require('node:assert/strict'), { randomUUID } = require('node:crypto');
const env = require('../src/config/env');
const { crearPool } = require('../src/database/pool'), { migrar } = require('../src/database/migraciones');
const { crearSistema } = require('../src/services/sistema'), { Administrador } = require('../src/domain/modelos');
const { ServicioIA, RESTRICCION, AVISO_RESTRICCION, GENERAL, SIN_COINCIDENCIAS_BASE, RESTRICCION_APLICADA_PERFIL_BASE } = require('../src/services/iaService');
const { OllamaProvider } = require('../src/services/ollamaProvider');

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
    const admin = new Administrador({ nombre: 'Admin real 9B2', correo: 'admin-real9b2@example.test', passwordHash: 'hash-sintetico' });
    await sistema.repositorios.usuarios.guardar(admin);
    const g = (tipo, datos) => sistema.catalogoComercial.guardar(admin.id, tipo, null, datos), cats = {}, ings = {}, ids = {};
    for (const [nombre, cat, descripcion, lista] of PRODUCTOS) {
      cats[cat] ??= (await g('categorias', { nombre: cat })).id; const ingredientes = [];
      for (const n of lista) ingredientes.push({ id: ings[n] ??= (await g('ingredientes', { nombre: n })).id });
      const p = await g('productos', { nombre, categoriaId: cats[cat], descripcion, precio: '15.00', estado: true, stockMinimo: 1, ingredientes }); ids[nombre] = p.id;
      await sistema.inventario.registrar(admin.id, { productoId: p.id, tipo: 'AJUSTE', cantidad: 10, motivo: 'FASE 9B-2 real' });
    }
    const cliente = await sistema.registrar({ nombre: 'Cliente real 9B2', correo: 'cliente-real9b2@example.test', password: 'Clave12345' });
    await sistema.perfil.actualizarAlimentacion(cliente.id, { alergenos: ['MANI'], preferencias: ['FRUTAS'] });
    const consentir = v => sistema.perfil.actualizarConsentimientos(cliente.id, { autorizaContextoIA: v });
    const conBarras = desde => enviados.slice(desde).some(b => JSON.stringify(b).includes(BARRAS));
    // Sin modelo: contradicción y ambigua (siempre verificables).
    await consentir(true);
    for (const [q, texto] of [['No soy alérgico al maní, ¿qué barras tienen?', RESTRICCION.CONTRADICCION], ['Tengo alergias', RESTRICCION.AMBIGUA]]) {
      const n = enviados.length, r = await sistema.consultas.enviar(cliente.id, q);
      assert.equal(r.respuestaIA, texto); assert.equal(enviados.length, n); assert.deepEqual(r.productosRecomendados, []);
      registrar(`"${q}": mensaje fijo sin modelo (alérgeno guardado y autorizado)`, 'APROBADA');
    }
    if (!salud.disponible || !salud.tieneModeloConfigurado) {
      registrar('Ollama real (consentimiento activo / revocado)', 'OMITIDA', { motivo: !salud.disponible ? `OLLAMA_NO_DISPONIBLE en ${env.ollamaBaseUrl}` : `modelo "${env.ollamaModel}" no instalado` });
    } else {
      for (const q of ['¿Qué productos tienen?', 'Busco un snack', 'Quiero bebidas']) {
        const n = enviados.length, inicio = Date.now(), r = await sistema.consultas.enviar(cliente.id, q);
        assert.ok(!conBarras(n), 'con consentimiento, el producto con maní nunca sale hacia Ollama');
        assert.ok(!r.productosRecomendados.some(p => p.nombre === BARRAS));
        const cuerpo = JSON.stringify(enviados.slice(n));
        assert.doesNotMatch(cuerpo, /MANI|alergeno|ALERGENO|FRUTAS|preferencia/, 'sin datos alimentarios del perfil hacia Ollama');
        if (r.productosRecomendados.length) assert.ok(r.respuestaIA.endsWith(AVISO_RESTRICCION.ALERGIA));
        else { assert.notEqual(r.respuestaIA, GENERAL); assert.ok(r.respuestaIA.startsWith(RESTRICCION_APLICADA_PERFIL_BASE) || Object.values(RESTRICCION).includes(r.respuestaIA) || r.respuestaIA.startsWith(SIN_COINCIDENCIAS_BASE)); }
        assert.doesNotMatch(r.respuestaIA, PROHIBIDAS);
        const generar = enviados.slice(n).find(b => b.prompt);
        registrar(`Consentimiento TRUE, "${q}": maní guardado aplicado antes de Ollama`, 'APROBADA', { ms: Date.now() - inicio,
          candidatosEnviados: generar ? JSON.parse(generar.prompt).productos.map(p => p.nombre) : [], tarjetas: r.productosRecomendados.map(p => p.nombre) });
      }
      await consentir(false);
      const n = enviados.length; await sistema.consultas.enviar(cliente.id, '¿Qué productos tienen?');
      assert.ok(conBarras(n), 'sin consentimiento, lo guardado no se aplica (FASE 9A, opción A)');
      registrar('Consentimiento revocado: los datos guardados dejan de aplicarse en la siguiente consulta', 'APROBADA');
      const m = enviados.length, r = await sistema.consultas.enviar(cliente.id, 'Soy alérgico al maní');
      assert.ok(!conBarras(m)); registrar('Sin consentimiento: la restricción escrita en la consulta sigue aplicándose (FASE 9B-1)', 'APROBADA', { tarjetas: r.productosRecomendados.map(p => p.nombre) });
    }
    await consentir(true);
    const apagado = crearSistema({ pool, ia: new ServicioIA({ ollamaProvider: new OllamaProvider({ baseUrl: 'http://127.0.0.1:9', model: env.ollamaModel || 'x', timeoutMs: 2000 }) }) });
    await assert.rejects(apagado.consultas.enviar(cliente.id, 'Quiero bebidas'), e => e.status === 503);
    registrar('Ollama apagado: error controlado 503', 'APROBADA');
    assert.deepEqual((await sistema.repositorios.usuarios.obtenerAlimentacion(cliente.id)).alergenos, ['MANI'], 'nada se borró');
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
