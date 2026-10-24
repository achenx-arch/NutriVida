const { Producto, Consulta, Interaccion } = require("../domain/modelos");
const { RepositorioUsuarios } = require("./usuarios");

class RepositorioProductos {
  constructor(store) { this.store = store; }
  listar() { return this.store.listar("productos").map((p) => new Producto(p)); }
  buscarPorId(id) { const p = this.store.buscarPorId("productos", id); return p ? new Producto(p) : null; }
  guardar(producto) {
    if (this.store.buscarPorId("productos", producto.id)) this.store.actualizar("productos", producto.id, { ...producto });
    else this.store.insertar("productos", { ...producto });
    return producto;
  }
  eliminar(id) { return this.store.eliminar("productos", id); }
}

class RepositorioConsultas {
  constructor(store, seguridad) { this.store = store; this.seguridad = seguridad; }
  aRegistro(consulta) { return { ...consulta, texto: this.seguridad.cifrarDatoSensible(consulta.texto), versionCifrado: 2 }; }
  desdeRegistro(r) {
    return r ? new Consulta({ ...r, texto: r.versionCifrado === 2 ? this.seguridad.descifrarDatoSensible(r.texto) : r.texto }) : null;
  }
  crear(consulta) { this.store.insertar("consultas", this.aRegistro(consulta)); return consulta; }
  buscarPorId(id) { return this.desdeRegistro(this.store.buscarPorId("consultas", id)); }
  listar() { return this.store.listar("consultas").map((r) => this.desdeRegistro(r)); }
}

class RepositorioInteracciones {
  constructor(store, seguridad, consultas) { this.store = store; this.seguridad = seguridad; this.consultas = consultas; }
  aRegistro(interaccion) {
    return { ...interaccion, consulta: this.seguridad.cifrarDatoSensible(interaccion.consulta),
      respuestaIA: this.seguridad.cifrarDatoSensible(interaccion.respuestaIA), versionCifrado: 2 };
  }
  desdeRegistro(r) {
    return new Interaccion({ ...r, consulta: this.seguridad.descifrarDatoSensible(r.consulta),
      respuestaIA: this.seguridad.descifrarDatoSensible(r.respuestaIA) });
  }
  listar() { return this.store.listar("interacciones").map((r) => this.desdeRegistro(r)); }
  listarPorCliente(id) { return this.listar().filter((i) => i.clienteId === id).sort((a, b) => b.fecha.localeCompare(a.fecha)); }
  registrar(interaccion, consulta) {
    const r = this.aRegistro(interaccion);
    const c = this.consultas.aRegistro(consulta);
    this.store.transaccion((datos) => {
      const index = datos.consultas.findIndex((item) => item.id === consulta.id);
      if (index < 0 || datos.consultas[index].clienteId !== interaccion.clienteId || interaccion.consultaId !== consulta.id) {
        throw new Error("La interacción no corresponde a una consulta existente.");
      }
      if (datos.interacciones.some((i) => i.consultaId === consulta.id)) throw new Error("La consulta ya tiene una interacción registrada.");
      datos.consultas[index] = c;
      datos.interacciones.push(r);
    });
    return interaccion;
  }
  marcarRevisada(consultaId) {
    return this.store.transaccion((datos) => {
      const i = datos.interacciones.find((r) => r.consultaId === consultaId);
      if (!i) return null;
      i.revisada = true;
      return this.desdeRegistro(i);
    });
  }
}

class RepositorioAuditoria {
  constructor(store) { this.store = store; }
  sesionRevocada(recurso) { return this.store.listar("auditoria").some(e=>e.accion==="LOGOUT" && e.recursoAccedido===recurso); }
  guardar(evento) { return this.store.insertar("auditoria", evento); }
  listar() { return this.store.listar("auditoria").sort((a, b) => b.fecha.localeCompare(a.fecha)); }
}

// Migración en una sola escritura: conserva ids, fechas, respuestas y revisión.
function migrarDatos(store, repositorios) {
  if (store.leerTodo().versionEsquema === 2) return;
  store.transaccion((datos) => {
    datos.usuarios = datos.usuarios.map((u) => repositorios.usuarios.aRegistro(repositorios.usuarios.desdeRegistro(u)));
    const existentes = new Set(datos.interacciones.map((i) => i.consultaId));
    datos.consultas = datos.consultas.map((r) => {
      const consulta = repositorios.consultas.desdeRegistro(r);
      if (r.estado !== "PENDIENTE" && !existentes.has(r.id)) {
        datos.interacciones.push(repositorios.interacciones.aRegistro(new Interaccion({
          consultaId: r.id, clienteId: r.clienteId, consulta: consulta.texto,
          respuestaIA: r.respuestaIA, fecha: r.fecha, revisada: r.revisada,
        })));
      }
      return repositorios.consultas.aRegistro(consulta);
    });
    datos.versionEsquema = 2;
  });
}

module.exports = { RepositorioUsuarios, RepositorioProductos, RepositorioConsultas,
  RepositorioInteracciones, RepositorioAuditoria, migrarDatos };
