// Diagnóstico de SOLO LECTURA de IMPORTACION_CONFLICTO. No escribe, no restaura ni reimporta.
// Compara cada registro heredado de data/db.json con PostgreSQL usando las mismas reglas que
// verificarImportacion(), pero informa TODAS las diferencias en lugar de detenerse en la primera.
// Hashes y datos cifrados se muestran solo como igual/distinto y huella SHA-256 corta.
const { createHash } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const { leerFuente } = require("../../src/database/importacion");
const { origen } = require("./comun");
const { crearPool } = require("../../src/database/pool");
const fecha = v => new Date(v).toISOString();
const huella = v => v == null ? null : "sha256:" + createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v)).digest("hex").slice(0, 12);
const SENSIBLES = new Set(["password_hash"]);
const normalizar = v => v instanceof Date ? v.toISOString() : v;
const propias = (o, c) => Object.fromEntries(c.filter(k => Object.hasOwn(o, k)).map(k => [k, o[k]]));
function mostrar(tabla, col, v) {
  if (SENSIBLES.has(col)) return huella(v);
  if (col === "datos_legado" && (tabla === "perfil_cliente" || tabla === "conversaciones_ia") && v && typeof v === "object")
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === "string" && /^[a-f0-9]{24}:/i.test(x) ? huella(x) : x]));
  return v;
}
(async () => {
  const fuente = leerFuente(origen()), { datos, porConsulta } = fuente;
  const pool = crearPool(), db = await pool.connect(), diferencias = [];
  try {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const roles = new Map((await db.query("SELECT nombre,id_rol FROM roles")).rows.map(r => [r.nombre, String(r.id_rol)]));
    const nombreRol = new Map([...roles].map(([n, i]) => [i, n]));
    const comparar = async (tabla, pk, esperado) => {
      const actual = (await db.query(`SELECT * FROM ${tabla} WHERE ${pk}=$1`, [esperado[pk]])).rows[0];
      if (!actual) return diferencias.push({ tabla, id: esperado[pk], problema: "FALTA_EN_POSTGRESQL" });
      const campos = [];
      for (const [col, val] of Object.entries(esperado)) {
        let a = normalizar(actual[col]); let e = val ?? null;
        if (col === "id_rol") { a = String(a); e = String(e); }
        if (!isDeepStrictEqual(a, e)) campos.push({ campo: col,
          dbJson: col === "id_rol" ? nombreRol.get(e) : mostrar(tabla, col, e), postgresql: col === "id_rol" ? nombreRol.get(a) : mostrar(tabla, col, a) });
      }
      if (campos.length) diferencias.push({ tabla, id: esperado[pk], campos });
    };
    // Mismos registros esperados que src/database/importacion.js (columnas no mencionadas = NULL).
    const cols = { usuarios: ["apellido", "fecha_actualizacion"], perfil_cliente: ["telefono", "fecha_nacimiento", "observaciones", "autoriza_contexto_ia", "fecha_actualizacion"],
      productos: ["descripcion", "precio", "stock_minimo", "imagen_url", "fecha_creacion", "fecha_actualizacion", "valores_nutricionales"],
      conversaciones_ia: ["titulo", "fecha_actualizacion"], auditoria: ["datos_anteriores", "datos_nuevos", "ip"] };
    const conNulos = (t, o) => ({ ...Object.fromEntries(cols[t].map(c => [c, null])), ...o });
    for (const u of datos.usuarios) {
      await comparar("usuarios", "id_usuario", conNulos("usuarios", { id_usuario: u.id, id_rol: roles.get(u.rol === "PERSONAL_NUTRIVIDA" ? "EMPLEADO" : u.rol),
        nombre: u.nombre, correo: u.correo, password_hash: u.passwordHash, estado: true, fecha_creacion: fecha(u.createdAt),
        datos_legado: { ...propias(u, ["area"]), rol_origen: u.rol } }));
      if (u.perfilSalud) await comparar("perfil_cliente", "id_perfil", conNulos("perfil_cliente", { id_perfil: u.perfilSalud.id, id_usuario: u.id,
        datos_legado: propias(u.perfilSalud, ["condicionesMedicas", "alergias", "objetivoNutricional", "versionCifrado"]) }));
    }
    for (const p of datos.productos) {
      const cat = (await db.query("SELECT id_categoria FROM categorias WHERE nombre=$1", [p.categoria])).rows[0];
      await comparar("productos", "id_producto", conNulos("productos", { id_producto: p.id, id_categoria: cat ? cat.id_categoria : "CATEGORIA_FALTANTE",
        nombre: p.nombre, estado: false, datos_legado: propias(p, ["ingredientes", "valoresNutricionales"]) }));
    }
    const conversaciones = [];
    for (const q of datos.consultas) {
      const i = porConsulta.get(q.id);
      const antes = diferencias.length;
      await comparar("conversaciones_ia", "id_conversacion", conNulos("conversaciones_ia", { id_conversacion: q.id, id_usuario: q.clienteId,
        fecha_inicio: fecha(q.fecha), estado: q.estado, revisada: i?.revisada ?? null, id_interaccion_origen: i?.id ?? null,
        datos_legado: { versionCifrado: q.versionCifrado, ...(i ? { consultaInteraccionCifrada: i.consulta, fechaInteraccion: i.fecha, versionCifradoInteraccion: i.versionCifrado } : {}) } }));
      const esperados = [{ tipo: "USUARIO", contenido: q.texto, fecha: fecha(q.fecha), version_cifrado: 2 }];
      if (i?.respuestaIA != null) esperados.push({ tipo: "ASISTENTE", contenido: i.respuestaIA, fecha: fecha(i.fecha), version_cifrado: 2 });
      const conversacionIdentica = diferencias.length === antes;
      const guardados = (await db.query("SELECT tipo,contenido,fecha,version_cifrado FROM mensajes_ia WHERE id_conversacion=$1 ORDER BY id_mensaje", [q.id])).rows
        .map(m => ({ ...m, fecha: normalizar(m.fecha) }));
      const mensajesIguales = isDeepStrictEqual(guardados, esperados);
      if (!mensajesIguales) diferencias.push({ tabla: "mensajes_ia", id: q.id, problema: "MENSAJES_DISTINTOS",
        dbJson: esperados.map(m => ({ tipo: m.tipo, contenido: huella(m.contenido), fecha: m.fecha })), postgresql: guardados.map(m => ({ tipo: m.tipo, contenido: huella(m.contenido), fecha: m.fecha })) });
      conversaciones.push({ id: q.id.slice(0, 8), conversacionIdentica, mensajesIdenticos: mensajesIguales });
    }
    for (const a of datos.auditoria) {
      const partes = a.recursoAccedido.split("/");
      const simple = partes.length === 2 && ["usuarios", "productos", "consultas"].includes(partes[0]) && /^[0-9a-f-]{36}$/i.test(partes[1]);
      await comparar("auditoria", "id_auditoria", conNulos("auditoria", { id_auditoria: a.id, id_usuario: a.usuarioId, accion: a.accion, recurso_accedido: a.recursoAccedido,
        entidad: simple ? partes[0] : null, id_entidad: simple ? partes[1] : null, fecha: fecha(a.fecha) }));
    }
    // Auditoría POSTERIOR (no importada) que pueda explicar cada diferencia.
    const importadas = datos.auditoria.map(a => a.id);
    for (const d of diferencias) {
      const uid = d.tabla === "perfil_cliente" ? datos.usuarios.find(u => u.perfilSalud?.id === d.id)?.id : d.id;
      // Ventana alrededor de la fecha exacta de cada diferencia (fecha_actualizacion actual); sin límite fijo de 30.
      const tabla = { usuarios: "usuarios", perfil_cliente: "perfil_cliente", productos: "productos", conversaciones_ia: "conversaciones_ia", auditoria: "auditoria" }[d.tabla];
      const pk = { usuarios: "id_usuario", perfil_cliente: "id_perfil", productos: "id_producto", conversaciones_ia: "id_conversacion", auditoria: "id_auditoria" }[d.tabla];
      const ref = tabla ? (await db.query(`SELECT * FROM ${tabla} WHERE ${pk}=$1`, [d.id])).rows[0]?.fecha_actualizacion : null;
      d.fechaReferencia = normalizar(ref) || null;
      const filtro = `NOT (id_auditoria = ANY($2::uuid[])) AND (id_entidad=$1::text OR recurso_accedido LIKE '%'||$1::text||'%' OR id_usuario::text=$1::text)`;
      d.auditoriaPosterior = ref
        ? (await db.query(`SELECT accion, entidad, fecha, recurso_accedido FROM auditoria WHERE ${filtro}
            AND fecha BETWEEN $3::timestamptz - interval '60 seconds' AND $3::timestamptz + interval '60 seconds' ORDER BY fecha`, [uid, importadas, ref])).rows
        : (await db.query(`SELECT accion, entidad, fecha, recurso_accedido FROM auditoria WHERE ${filtro} ORDER BY fecha DESC LIMIT 30`, [uid, importadas])).rows;
      d.auditoriaPosterior = d.auditoriaPosterior.map(r => ({ ...r, fecha: normalizar(r.fecha),
        desfaseMs: ref ? new Date(r.fecha) - new Date(ref) : undefined }));
    }
    await db.query("ROLLBACK");
    console.log(JSON.stringify({ archivo: "data/db.json", sha256: fuente.sha256.slice(0, 16), totalDiferencias: diferencias.length, conversacionesHeredadas: conversaciones, diferencias }, null, 2));
  } finally { db.release(); await pool.end(); }
})().catch(e => { console.error(e.codigo || e.message); process.exitCode = 1; });
