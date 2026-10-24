const { ErrorAplicacion } = require("../errors/ErrorAplicacion");
function errorHttp(mensaje, status) { return new ErrorAplicacion(mensaje, status); }
const { Cliente, Interaccion, EstadoConsulta } = require("../domain/modelos");
const { Permiso, tienePermiso } = require("../domain/roles");
const { crearContextoIA } = require("./contextoIA");
const { redactar, esConsultaMedica, AVISO_RESTRICCION, respuestaRestriccion } = require("./iaService");
const { opcionesSeleccion, seleccionarCandidatos } = require("./relevanciaIA");
const { prepararConsulta, requiereAvisoAlergenos, combinarRestricciones, contradicciones } = require("./evaluadorAlimentario");
const { restriccionesDePerfil } = require("./catalogoAlimentacion");

class ModuloConsultas {
  constructor(repositorios, seguridad, ia, auditoria) {
    this.repos = repositorios; this.seguridad = seguridad; this.ia = ia; this.auditoria = auditoria;
  }
  presentar(consulta, interaccion) {
    return { ...consulta, respuestaIA: interaccion?.respuestaIA ?? null,
      revisada: interaccion?.revisada ?? false, interaccionId: interaccion?.id ?? null };
  }
  async enviar(clienteId, texto) {
    const cliente = await this.repos.usuarios.buscarPorId(clienteId);
    if (!(cliente instanceof Cliente)) throw errorHttp("Solo un cliente puede enviar consultas.", 403);
    const consulta = cliente.enviarConsulta(this.seguridad.validarEntrada(texto));
    await this.repos.consultas.crear(consulta);
    let respuesta;
    let errorIA;
    let productosRecomendados = [];
    let respaldoBackend = false;
    let restricciones = [];
    try {
      // Candidatos por relevancia (src/services/relevanciaIA.js): solo elegibles con coincidencia real (máx. 5);
      // consulta general → muestra determinista por categorías; sin coincidencias → no se llama al modelo.
      // Consentimiento de PERFIL leído en ESTA solicitud (una revocación previa se respeta en la siguiente consulta).
      // El consentimiento de historial (autoriza_historial_ia) habilita SOLO el bono de relevancia de FASE 9C (ver abajo).
      const perfilAutorizado = cliente.autorizaContextoIA === true ? cliente.perfilCliente : null;
      // FASE 9B-1 — Orden: (1) consulta médica (ServicioIA responde sin modelo y sin interpretar nada más);
      // (2) restricciones declaradas en ESTA consulta (nunca las del perfil: eso es FASE 9B-2); (3) elegibles de
      // PostgreSQL; (4-5) evaluador y exclusión; (6-7) relevancia SOLO entre permitidos, máx. 5; (8) Ollama.
      // Los términos de la restricción no suman relevancia ("snack sin maní" busca "snack").
      const medica = esConsultaMedica(consulta.texto);
      const preparada = medica ? { restricciones: [], negadas: [], ambigua: false, consultaRelevancia: consulta.texto } : prepararConsulta(consulta.texto);
      // FASE 9B-2 (opción A): datos alimentarios guardados SOLO con autoriza_contexto_ia === true, leído en ESTA solicitud.
      // autoriza_historial_ia no sustituye a este consentimiento. Sin consentimiento, NO se leen. Uso exclusivo del backend:
      // nunca se envían a Ollama (crearContextoIA mantiene la lista blanca de FASE 9A).
      let restriccionesPerfil = [], preferencias = [];
      if (!medica && cliente.autorizaContextoIA === true && this.repos.usuarios.obtenerAlimentacion) {
        const guardada = await this.repos.usuarios.obtenerAlimentacion(cliente.id);
        restriccionesPerfil = restriccionesDePerfil(guardada); preferencias = guardada.preferencias;
      }
      // Unión conservadora consulta + perfil (ninguna anula a la otra). Los términos de la consulta siguen sin sumar relevancia.
      restricciones = combinarRestricciones(preparada.restricciones, restriccionesPerfil);
      const negadasPerfil = contradicciones(preparada.negadas, restriccionesPerfil);
      let seleccion;
      // Ambigua: se pide aclaración aunque haya alérgenos guardados (decisión 2). Contradicción: mensaje fijo (decisión 3).
      if (preparada.ambigua) seleccion = { tipo: "RESTRICCION_AMBIGUA", candidatos: [], categorias: [], restricciones: [], excluidos: [] };
      else if (negadasPerfil.length) seleccion = { tipo: "CONTRADICCION_PERFIL", candidatos: [], categorias: [], restricciones, excluidos: [] };
      else if (this.repos.productos.seleccionarCandidatosIA) {
        // FASE 9C: resumen limitado de compras ENTREGADAS solo con autoriza_historial_ia === true (independiente del perfil).
        // Se lee después de las salidas sin modelo (médica, ambigua, contradicción) y solo influye en el orden por relevancia.
        const historial = medica ? null : await this.leerHistorialAutorizado(cliente);
        seleccion = await this.repos.productos.seleccionarCandidatosIA(preparada.consultaRelevancia, { restricciones, preferencias, historial });
      }
      else {
        // Repositorio JSON (sin selección propia): mismas reglas puras sobre la lista disponible.
        const texto = restricciones.length ? preparada.consultaRelevancia : consulta.texto;
        const lista = await (this.repos.productos.listarDisponiblesIA ? this.repos.productos.listarDisponiblesIA(texto) : this.repos.productos.listar());
        seleccion = restricciones.length ? seleccionarCandidatos(lista, preparada.consultaRelevancia, undefined, { restricciones, preferencias })
          : { tipo: "GENERAL", categorias: [], candidatos: lista };
      }
      const contexto = crearContextoIA({
        consulta: consulta.texto,
        perfil: perfilAutorizado, // crearContextoIA aplica la lista blanca (sin condiciones médicas ni alergias)
        productos: seleccion.candidatos,
      });
      // Sin coincidencias → sin modelo; consulta específica sin restricciones → respaldo del backend (relevanciaIA.js).
      // Uso SOLO en el backend (nunca se envía a Ollama): alergias/condiciones del perfil autorizado hacen que el
      // respaldo automático se abstenga.
      const opcionesIA = opcionesSeleccion(seleccion, { consulta: consulta.texto, perfil: perfilAutorizado });
      if (this.ia.generarRecomendacionDetallada) {
        const r = await this.ia.generarRecomendacionDetallada(contexto, opcionesIA);
        respuesta = r.texto;
        respaldoBackend = r.respaldoBackend === true;
        if (r.tipo === "RECOMENDACION" && r.productoIds.length && this.repos.productos.resolverRecomendados) {
          // Los IDs (ya validados) se resuelven OTRA VEZ en PostgreSQL; un producto que dejó de estar
          // disponible no se muestra y el texto se redacta solo con los productos resueltos.
          // FASE 9B-1: con restricciones, cada producto se RE-EVALÚA con los datos frescos antes de crear la tarjeta.
          productosRecomendados = await this.repos.productos.resolverRecomendados(r.productoIds, { restricciones });
          respuesta = redactar("RECOMENDACION", productosRecomendados);
          if (restricciones.length && !productosRecomendados.length)
            respuesta = respuestaRestriccion({ tipo: "SIN_CANDIDATOS_RESTRICCION", motivo: "INCOMPATIBLE" }).texto;
        }
        // Aviso prudente: una recomendación bajo restricción nunca es garantía ni certificación.
        if (restricciones.length && r.tipo === "RECOMENDACION" && (productosRecomendados.length || !this.repos.productos.resolverRecomendados))
          respuesta += " " + (requiereAvisoAlergenos(restricciones) ? AVISO_RESTRICCION.ALERGIA : AVISO_RESTRICCION.DIETA);
      } else respuesta = await this.ia.generarRecomendacion(contexto);
      consulta.estado = EstadoConsulta.RESPONDIDA;
    } catch (err) {
      consulta.estado = EstadoConsulta.ERROR;
      // Una promesa puede rechazarse sin Error (incluso con undefined).
      // Siempre conservar un error real para auditar y devolver el fallo.
      errorIA = err instanceof Error ? err : new ErrorAplicacion(
        "El servicio de IA no pudo procesar la solicitud en este momento.", 503, "FALLA_SERVICIO"
      );
    }
    const interaccion = new Interaccion({ consultaId: consulta.id, clienteId,
      consulta: consulta.texto, respuestaIA: respuesta, fecha: consulta.fecha });
    // Consulta e Interaccion se confirman juntas, incluso ante error controlado de IA.
    await interaccion.registrar(this.repos.interacciones, consulta);
    await this.auditoria.registrarAcceso(cliente, errorIA ? "consulta_ia_error" : "consulta_ia", `consultas/${consulta.id}`);
    // Trazabilidad del respaldo del backend: solo acción y recurso (sin texto de la consulta ni datos del perfil).
    if (!errorIA && respaldoBackend) await this.auditoria.registrarAcceso(cliente, "consulta_ia_respaldo_backend", `consultas/${consulta.id}`);
    if (errorIA) throw errorIA;
    // productosRecomendados: solo en la respuesta en vivo (no se persiste; el historial muestra texto).
    return { ...this.presentar(consulta, interaccion), productosRecomendados };
  }
  // FASE 9C: el historial de compras se consulta ÚNICAMENTE con autoriza_historial_ia === true (leído en esta solicitud
  // desde PostgreSQL para el cliente del JWT). autoriza_contexto_ia no lo sustituye. Si la lectura falla, la recomendación
  // continúa SIN personalización por historial (no es necesario para la seguridad alimentaria). El resumen no se persiste,
  // no se registra ni se audita su contenido, y nunca se envía a Ollama.
  async leerHistorialAutorizado(cliente) {
    if (cliente.autorizaHistorialIA !== true || !this.repos.historialConsumo?.resumenIA) return null;
    try { return await this.repos.historialConsumo.resumenIA(cliente.id); }
    catch { console.error("HISTORIAL_IA_NO_DISPONIBLE: la recomendación continúa sin personalización por historial."); return null; }
  }
  async historial(clienteId) {
    const cliente = await this.repos.usuarios.buscarPorId(clienteId);
    if (!(cliente instanceof Cliente)) throw errorHttp("Solo un cliente puede consultar su historial.", 403);
    const interacciones = new Map((await cliente.verHistorial(this.repos.interacciones)).map((i) => [i.consultaId, i]));
    await this.auditoria.registrarAcceso(cliente, "consulta_historial_propio", `usuarios/${clienteId}/consultas`);
    return (await (this.repos.consultas.listarPorCliente ? this.repos.consultas.listarPorCliente(clienteId) : this.repos.consultas.listar())).filter((c) => c.clienteId === clienteId)
      .sort((a, b) => b.fecha.localeCompare(a.fecha)).map((c) => this.presentar(c, interacciones.get(c.id)));
  }
  async listarAdministracion(personalId) {
    const personal = await this.repos.usuarios.buscarPorId(personalId);
    if (!tienePermiso(personal, Permiso.REVISAR_CONSULTAS)) throw errorHttp("No tienes permisos para esta acción.", 403);
    const usuarios = new Map((await this.repos.usuarios.listar()).map((u) => [u.id, u.nombre]));
    const interacciones = new Map((await this.repos.interacciones.listar()).map((i) => [i.consultaId, i]));
    await this.auditoria.registrarAcceso(personal, "consulta_historial_clientes", "consultas");
    return (await this.repos.consultas.listar()).sort((a, b) => b.fecha.localeCompare(a.fecha))
      .map((c) => ({ ...this.presentar(c, interacciones.get(c.id)), clienteNombre: usuarios.get(c.clienteId) || "Desconocido" }));
  }
  async revisar(personalId, consultaId) {
    const personal = await this.repos.usuarios.buscarPorId(personalId);
    if (!tienePermiso(personal, Permiso.REVISAR_CONSULTAS)) throw errorHttp("No tienes permisos para esta acción.", 403);
    const consulta = await this.repos.consultas.buscarPorId(consultaId);
    if (!consulta) throw errorHttp("Consulta no encontrada.", 404);
    const interaccion = await personal.revisarConsulta(consultaId, this.repos.interacciones);
    if (!interaccion) throw errorHttp("La consulta todavía está pendiente.", 409);
    await this.auditoria.registrarAcceso(personal, "revision_consulta", `consultas/${consultaId}`);
    return this.presentar(consulta, interaccion);
  }
}

module.exports = { ModuloConsultas };
