// DIAGNÓSTICO de SOLO LECTURA: por qué una consulta del navegador no muestra tarjetas.
//   node database/scripts/diagnosticar-consulta-ia.js --correo <correo-del-cliente> [--ollama]
// No modifica datos: solo SELECT (usuario, perfil, catálogo, auditoría). No guarda conversaciones.
// Con --ollama llama al Ollama local con el MISMO contexto que la API (incluido el perfil solo si está autorizado),
// sin registrar textos. Nunca imprime correo, contraseñas, tokens, ni el contenido del perfil (solo sí/no).
const fs = require("node:fs"), path = require("node:path"), { createHash, randomUUID } = require("node:crypto");
const { crearPool } = require("../../src/database/pool");
const { crearSistema } = require("../../src/services/sistema");
const { crearContextoIA } = require("../../src/services/contextoIA");
const { opcionesSeleccion, hayRestricciones } = require("../../src/services/relevanciaIA");
const { esConsultaMedica, redactar } = require("../../src/services/iaService");
const CONSULTAS = ["¿Qué bebidas tienen disponibles?", "Busco un snack saludable", "Quiero algo para desayunar", "¿Qué bebidas saludables venden?"];
const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };

(async () => {
  const correlacion = randomUUID().slice(0, 8), salida = { correlacion, soloLectura: true };
  // 1) Versión del código en disco (huella de los archivos del flujo de IA).
  const raiz = path.join(__dirname, "../..");
  salida.codigoEnDisco = Object.fromEntries(["src/services/relevanciaIA.js", "src/services/iaService.js", "src/services/consultasService.js"].map(f => {
    const b = fs.readFileSync(path.join(raiz, f)); return [f, { sha256: createHash("sha256").update(b).digest("hex").slice(0, 12), modificado: fs.statSync(path.join(raiz, f)).mtime.toISOString() }];
  }));
  salida.respaldoImplementadoEnDisco = fs.readFileSync(path.join(raiz, "src/services/consultasService.js"), "utf8").includes("consulta_ia_respaldo_backend");
  const pool = crearPool(), sistema = crearSistema({ pool });
  try {
    const correo = arg("--correo");
    const cliente = correo ? await sistema.repositorios.usuarios.buscarPorCorreo(correo) : null;
    if (!cliente) throw Object.assign(new Error("CLIENTE_NO_ENCONTRADO"), { codigo: "CLIENTE_NO_ENCONTRADO (usa --correo)" });
    const perfil = cliente.autorizaContextoIA === true ? cliente.perfilCliente : null;
    const lleno = v => typeof v === "string" && v.trim().length > 0;
    // 2) Condiciones del cliente que afectan el respaldo (solo sí/no; nunca el contenido).
    salida.cliente = { id: String(cliente.id).slice(0, 8), rol: cliente.rol, autorizaContextoIA: cliente.autorizaContextoIA === true,
      perfilAutorizadoConAlergias: !!(perfil && lleno(perfil.alergias)), perfilAutorizadoConCondiciones: !!(perfil && lleno(perfil.condicionesMedicas)) };
    // 3) Las 4 consultas del navegador por el MISMO camino que ModuloConsultas.enviar.
    salida.consultas = [];
    for (const consulta of CONSULTAS) {
      const sel = await sistema.repositorios.productos.seleccionarCandidatosIA(consulta);
      const contexto = crearContextoIA({ consulta, perfil, productos: sel.candidatos });
      const opciones = opcionesSeleccion(sel, { consulta, perfil });
      const r = { consulta, medica: esConsultaMedica(consulta), restriccionEnConsulta: hayRestricciones(consulta), seleccion: sel.tipo,
        candidatos: sel.candidatos.length, puntuaciones: sel.puntuaciones.filter(x => x.puntos > 0).map(x => `${x.producto.nombre}=${x.puntos}`),
        respaldoPreparado: opciones.respaldo ? opciones.respaldo.length : 0, respaldoOmitido: opciones.respaldoOmitido || null };
      if (process.argv.includes("--ollama") && !r.medica) {
        try {
          const d = await sistema.ia.generarRecomendacionDetallada(contexto, opciones);
          const tarjetas = d.tipo === "RECOMENDACION" && d.productoIds.length ? await sistema.repositorios.productos.resolverRecomendados(d.productoIds) : [];
          Object.assign(r, { tipoFinal: d.tipo, idsDevueltos: d.productoIds.length, respaldoBackend: d.respaldoBackend === true, tarjetas: tarjetas.length,
            textoFinalEsGeneral: (tarjetas.length ? redactar("RECOMENDACION", tarjetas) : d.texto).startsWith("Puedo ayudarte") });
        } catch (e) { r.errorIA = e.codigo || "FALLA_SERVICIO"; }
      }
      salida.consultas.push(r);
    }
    // 4) Últimas consultas reales del cliente (24 h): solo acciones y horas de auditoría por consulta.
    const filas = (await pool.query(`SELECT a.recurso_accedido, a.accion, a.fecha FROM auditoria a
       WHERE a.id_usuario=$1 AND a.accion LIKE 'consulta_ia%' AND a.fecha > now() - interval '24 hours' ORDER BY a.fecha DESC LIMIT 60`, [cliente.id])).rows;
    const porConsulta = new Map();
    for (const f of filas) { const k = f.recurso_accedido.split("/")[1]?.slice(0, 8); if (!porConsulta.has(k)) porConsulta.set(k, { consulta: k, fecha: f.fecha.toISOString(), acciones: [] }); porConsulta.get(k).acciones.push(f.accion); }
    salida.consultasRecientes = [...porConsulta.values()];
    salida.eventosRespaldoUltimas24h = filas.filter(f => f.accion === "consulta_ia_respaldo_backend").length;
  } catch (e) { salida.error = e.codigo || e.code || e.message; process.exitCode = 1; }
  finally { await pool.end(); }
  console.log(JSON.stringify(salida, null, 1));
})();
