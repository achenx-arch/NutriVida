const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const DB_PATH = path.join(__dirname, "..", "..", "data", "db.json");

// Transacciones síncronas y reemplazo atómico: nunca se escribe medio documento.
function crearStore(archivo = DB_PATH) {
  const inicial = () => ({ usuarios: [], productos: [], consultas: [], interacciones: [], auditoria: [] });
  function leerTodo() {
    if (!fs.existsSync(archivo)) return inicial();
    const datos = JSON.parse(fs.readFileSync(archivo, "utf8"));
    if (!datos || typeof datos !== "object" || Array.isArray(datos)) throw new Error("Almacén de datos inválido.");
    for (const nombre of Object.keys(inicial())) {
      if (datos[nombre] === undefined) datos[nombre] = [];
      if (!Array.isArray(datos[nombre])) throw new Error(`Colección inválida: ${nombre}`);
    }
    return datos;
  }
  function guardarTodo(datos) {
    fs.mkdirSync(path.dirname(archivo), { recursive: true });
    const temporal = `${archivo}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporal, JSON.stringify(datos, null, 2), { flag: "wx" });
      fs.renameSync(temporal, archivo);
    } finally {
      if (fs.existsSync(temporal)) fs.unlinkSync(temporal);
    }
  }
  function transaccion(operacion) {
    const datos = leerTodo();
    const resultado = operacion(datos);
    if (resultado && typeof resultado.then === "function") throw new Error("La transacción debe ser síncrona.");
    guardarTodo(datos);
    return resultado;
  }
  const listar = (c) => leerTodo()[c] || [];
  return {
    leerTodo, transaccion, listar, generarId: () => crypto.randomUUID(),
    buscarPorId: (c, id) => listar(c).find((r) => r.id === id) || null,
    insertar: (c, registro) => transaccion((datos) => {
      const nuevo = { id: crypto.randomUUID(), ...registro };
      (datos[c] ||= []).push(nuevo);
      return nuevo;
    }),
    actualizar: (c, id, cambios) => transaccion((datos) => {
      const registro = datos[c]?.find((r) => r.id === id);
      return registro ? Object.assign(registro, cambios) : null;
    }),
    eliminar: (c, id) => transaccion((datos) => {
      const lista = datos[c] || [];
      datos[c] = lista.filter((r) => r.id !== id);
      return datos[c].length !== lista.length;
    }),
  };
}
module.exports = { ...crearStore(), crearStore };
