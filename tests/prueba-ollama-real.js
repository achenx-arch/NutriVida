// Prueba REAL de NutriVida AI con el código del backend. Sin escrituras:
// 1) candidatos reales de nutrivida_db (lectura) → consulta del usuario;
// 2) candidatos SINTÉTICOS en memoria (no se guardan) → inferencia real con JSON Schema.
const { randomUUID } = require('node:crypto');
const env = require('../src/config/env');
const { crearPool } = require('../src/database/pool');
const { ServicioIA, SIN_PRODUCTOS } = require('../src/services/iaService');
const { OllamaProvider } = require('../src/services/ollamaProvider');
const { RepositorioProductos } = require('../src/repositories/postgres/productos');
const { crearContextoIA } = require('../src/services/contextoIA');
(async () => {
  const pool = crearPool(); const salida = { modelo: env.ollamaModel, baseUrl: env.ollamaBaseUrl };
  try {
    const provider = new OllamaProvider({ timeoutMs: Math.max(env.ollamaTimeoutMs, 60000) });
    salida.salud = await provider.comprobarSalud();
    const ia = new ServicioIA({ ollamaProvider: provider });
    const consulta = '¿Qué productos me recomiendas?';
    salida.catalogoReal = {};
    try { const reales = await new RepositorioProductos(pool).listarDisponiblesIA(consulta);
      salida.catalogoReal.candidatos = reales.length;
      const t = await ia.generarRecomendacion(crearContextoIA({ consulta, perfil: null, productos: reales }));
      salida.catalogoReal.respuesta = t; salida.catalogoReal.sinProductosControlado = t === SIN_PRODUCTOS; }
    catch (e) { salida.catalogoReal.error = { codigo: e.codigo, status: e.status }; }
    const sinteticos = [{ id: randomUUID(), nombre: 'Granola (sintética, no persistida)', categoria: 'Snacks', precio: '25.00', ingredientes: 'Avena' },
      { id: randomUUID(), nombre: 'Barra proteica (sintética, no persistida)', categoria: 'Snacks', precio: '10.00', ingredientes: 'Maní' }];
    salida.sintetico = [];
    for (const q of ['Hola', 'Busco algo alto en proteína', '¿Qué snack me recomiendas para la mañana?', 'Tengo diabetes, ¿qué medicamento tomo?']) {
      const t0 = Date.now();
      try { salida.sintetico.push({ consulta: q, ms: Date.now() - t0, respuesta: await ia.generarRecomendacion({ consulta: q, productos: sinteticos }) }); }
      catch (e) { salida.sintetico.push({ consulta: q, error: { codigo: e.codigo, status: e.status } }); }
      salida.sintetico.at(-1).ms = Date.now() - t0;
    }
  } finally { await pool.end(); }
  console.log(JSON.stringify(salida, null, 2));
})().catch(e => { console.error(e.codigo || e.message); process.exitCode = 1; });
