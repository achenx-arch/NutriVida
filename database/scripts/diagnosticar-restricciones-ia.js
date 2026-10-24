// DIAGNÓSTICO DE SOLO LECTURA (FASE 9B-1): flujo completo de restricciones alimentarias con el catálogo REAL.
//   node database/scripts/diagnosticar-restricciones-ia.js [--ollama]
// Para cada consulta muestra: detección de restricciones, productos elegibles, resultado del evaluador por producto,
// relevancia, candidatos permitidos, si se llamaría a Ollama, respuesta final y tarjetas. Usa el MISMO camino que
// ModuloConsultas.enviar. Transacción READ ONLY: no guarda consultas, conversaciones ni auditoría. Sin datos de usuarios.
// Sin --ollama no contacta al modelo (indica qué ocurriría si el modelo no eligiera productos).
const { crearPool } = require("../../src/database/pool");
const { RepositorioProductos } = require("../../src/repositories/postgres/productos");
const { crearContextoIA } = require("../../src/services/contextoIA");
const { opcionesSeleccion } = require("../../src/services/relevanciaIA");
const { prepararConsulta, evaluarProducto, requiereAvisoAlergenos } = require("../../src/services/evaluadorAlimentario");
const { ServicioIA, esConsultaMedica, redactar, AVISO_RESTRICCION, RESTRICCION, respuestaRestriccion, restriccionAplicada, sinCoincidencias, GENERAL, MEDICA } = require("../../src/services/iaService");
const CONSULTAS = ["Tengo alergias", "Busco algo sin gluten", "Quiero productos veganos", "Quiero un snack sin maní", "Soy alérgico al maní", "¿Qué bebidas tienen disponibles?"];

(async () => {
  const pool = crearPool(), db = await pool.connect(), salida = { soloLectura: true, ollama: process.argv.includes("--ollama"), consultas: [] };
  try {
    await db.query("BEGIN READ ONLY");
    const repo = new RepositorioProductos(db), ia = new ServicioIA();
    // Elegibles reales (activos, categoría activa, precio > 0, existencia > 0): una búsqueda sin coincidencias puntúa a todos.
    const elegibles = (await repo.seleccionarCandidatosIA("zzqxw")).puntuaciones.map(x => x.producto.nombre);
    salida.elegibles = elegibles;
    for (const consulta of CONSULTAS) {
      const medica = esConsultaMedica(consulta), pc = medica ? { restricciones: [], ambigua: false, consultaRelevancia: consulta } : prepararConsulta(consulta);
      const r = { consulta, medica, deteccion: { restricciones: pc.restricciones.map(x => x.codigo + "/" + x.severidad + (x.termino ? ":" + x.termino : "")), ambigua: pc.ambigua, textoParaRelevancia: pc.consultaRelevancia } };
      let sel;
      if (pc.ambigua) sel = { tipo: "RESTRICCION_AMBIGUA", candidatos: [], categorias: [], restricciones: [], excluidos: [], puntuaciones: [] };
      else {
        sel = await repo.seleccionarCandidatosIA(pc.consultaRelevancia, { restricciones: pc.restricciones });
        r.elegibles = elegibles.length;
        r.evaluador = pc.restricciones.length ? (sel.excluidos || []).map(x => ({ producto: x.producto.nombre, estado: x.estado, motivos: [...new Set(x.motivos.map(m => m.regla + (m.termino ? ":" + m.termino : "")))] })) : "sin restricciones: no se filtra";
      }
      r.relevancia = { tipo: sel.tipo, motivo: sel.motivo || null, puntuaciones: (sel.puntuaciones || []).filter(x => x.puntos > 0).map(x => `${x.producto.nombre}=${x.puntos}`) };
      r.candidatosPermitidos = sel.candidatos.map(p => p.nombre);
      r.candidatosConConflicto = pc.restricciones.length ? sel.candidatos.filter(p => evaluarProducto(p, pc.restricciones).estado !== "SIN_CONFLICTO_DETECTADO").map(p => p.nombre) : [];
      const opciones = opcionesSeleccion(sel, { consulta, perfil: null });
      r.llamariaOllama = !medica && !opciones.respuestaFija && !opciones.sinCoincidencias && sel.candidatos.length > 0;
      r.respaldo = opciones.respaldo ? "preparado" : (opciones.respaldoOmitido || "no aplica");
      if (medica) r.respuestaSinModelo = MEDICA;
      else if (opciones.respuestaFija) r.respuestaSinModelo = respuestaRestriccion(opciones.respuestaFija).texto;
      else if (opciones.sinCoincidencias) r.respuestaSinModelo = sinCoincidencias(opciones.sinCoincidencias.categorias);
      else r.siElModeloNoEligeProductos = opciones.respaldo ? "respaldo del backend (tarjetas de candidatos)" : opciones.restriccionAplicada ? restriccionAplicada(opciones.restriccionAplicada) : GENERAL;
      if (salida.ollama && r.llamariaOllama) {
        try {
          const d = await ia.generarRecomendacionDetallada(crearContextoIA({ consulta, perfil: null, productos: sel.candidatos }), opciones);
          let texto = d.texto, tarjetas = [];
          if (d.tipo === "RECOMENDACION" && d.productoIds.length) {
            tarjetas = await repo.resolverRecomendados(d.productoIds, { restricciones: pc.restricciones }); texto = redactar("RECOMENDACION", tarjetas);
            if (pc.restricciones.length && !tarjetas.length) texto = RESTRICCION.SIN_CANDIDATOS;
            if (pc.restricciones.length && tarjetas.length) texto += " " + (requiereAvisoAlergenos(pc.restricciones) ? AVISO_RESTRICCION.ALERGIA : AVISO_RESTRICCION.DIETA);
          }
          Object.assign(r, { tipoFinal: d.tipo, respaldoBackend: d.respaldoBackend === true, respuestaFinal: texto, tarjetas: tarjetas.map(t => t.nombre) });
        } catch (e) { r.errorIA = e.codigo || "FALLA_SERVICIO"; }
      }
      salida.consultas.push(r);
    }
    await db.query("ROLLBACK");
  } catch (e) { salida.error = e.codigo || e.code || e.message; process.exitCode = 1; }
  finally { db.release(); await pool.end(); }
  console.log(JSON.stringify(salida, null, 1));
})();
