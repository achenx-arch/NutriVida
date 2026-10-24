const { randomUUID } = require("crypto");
const { compararPassword } = require("../security/auth");
const { sanearTexto, validarConsulta, validarPerfilSalud, validarProducto } = require("../security/validate");
const { RolUsuario, normalizarRol, permisosDe } = require("./roles");

const EstadoConsulta = Object.freeze({ PENDIENTE: "PENDIENTE", RESPONDIDA: "RESPONDIDA", ERROR: "ERROR" });

class PerfilCliente {
  constructor(datos = {}) {
    this.id = datos.id || randomUUID();
    Object.assign(this, validarPerfilSalud(datos));
  }
  validar() {
    Object.assign(this, validarPerfilSalud(this));
    return true;
  }
}

// Alias temporal: misma identidad de clase, sin renombrar el campo JSON.
const PerfilSalud = PerfilCliente;

class Usuario {
  constructor(datos = {}) {
    this.id = datos.id || randomUUID();
    this.nombre = datos.nombre;
    this.correo = datos.correo;
    this.passwordHash = datos.passwordHash;
    Object.defineProperty(this, "rolPersistido", { value: datos.rol });
    this.rol = normalizarRol(datos.rol);
    this.createdAt = datos.createdAt || new Date().toISOString();
    this.autorizaContextoIA = datos.autorizaContextoIA === true;
    this.autorizaHistorialIA = datos.autorizaHistorialIA === true; // FASE 9A: aún sin uso en la IA
    this.perfilSalud = datos.perfilSalud ? new PerfilCliente(datos.perfilSalud) : null;
  }
  get perfilCliente() { return this.perfilSalud; }
  autenticar(password) { return compararPassword(password, this.passwordHash); }
  actualizarPerfil(datos) {
    this.perfilSalud = new PerfilCliente({ ...datos, id: this.perfilSalud?.id });
    this.perfilSalud.validar();
    return this.perfilSalud;
  }
  datosPublicos() {
    return { id: this.id, nombre: this.nombre, correo: this.correo, rol: this.rol, permisos: permisosDe(this) };
  }
}

class Cliente extends Usuario {
  constructor(datos = {}) { super({ ...datos, rol: RolUsuario.CLIENTE }); }
  enviarConsulta(texto) {
    const consulta = new Consulta({ clienteId: this.id, texto });
    consulta.sanear();
    consulta.validarLongitud();
    return consulta;
  }
  verHistorial(repositorioInteracciones) { return repositorioInteracciones.listarPorCliente(this.id); }
}

class PersonalNutriVida extends Usuario {
  constructor(datos = {}) {
    super({ ...datos, rol: datos.rol || RolUsuario.PERSONAL_NUTRIVIDA });
    this.area = sanearTexto(datos.area || "Atención al cliente");
  }
  async gestionarCatalogo(repositorio, accion, datos) {
    switch (accion) {
      case "crear": return repositorio.guardar(new Producto(datos));
      case "editar": {
        const producto = await repositorio.buscarPorId(datos.id);
        if (!producto) return null;
        producto.actualizar(datos);
        return repositorio.guardar(producto);
      }
      case "eliminar": return repositorio.eliminar(datos.id);
      default: throw new Error("Operación de catálogo desconocida.");
    }
  }
  revisarConsulta(id, repositorioInteracciones) { return repositorioInteracciones.marcarRevisada(id); }
}

class Empleado extends PersonalNutriVida {
  constructor(datos = {}) { super({ ...datos, rol: RolUsuario.EMPLEADO }); }
}
class Administrador extends PersonalNutriVida {
  constructor(datos = {}) { super({ ...datos, rol: RolUsuario.ADMINISTRADOR }); }
}

class Producto {
  constructor(datos = {}) {
    this.id = datos.id || randomUUID();
    this.actualizar(datos);
  }
  actualizar(datos) { Object.assign(this, validarProducto(datos)); }
}

class Consulta {
  constructor(datos = {}) {
    this.id = datos.id || randomUUID();
    this.clienteId = datos.clienteId;
    this.texto = datos.texto;
    this.fecha = datos.fecha || new Date().toISOString();
    this.estado = datos.estado || EstadoConsulta.PENDIENTE;
  }
  sanear() { this.texto = sanearTexto(this.texto); return this.texto; }
  validarLongitud() { validarConsulta(this.texto); return true; }
}

class Interaccion {
  constructor(datos = {}) {
    this.id = datos.id || randomUUID();
    this.consultaId = datos.consultaId;
    this.clienteId = datos.clienteId;
    this.consulta = datos.consulta;
    this.respuestaIA = datos.respuestaIA ?? null;
    this.fecha = datos.fecha || new Date().toISOString();
    this.revisada = datos.revisada || false;
  }
  registrar(repositorio, consulta) { return repositorio.registrar(this, consulta); }
}

class BitacoraAuditoria {
  constructor(repositorio, datos = {}) {
    Object.defineProperty(this, "repositorio", { value: repositorio });
    this.id = datos.id || randomUUID();
    this.usuarioId = datos.usuarioId;
    this.accion = datos.accion;
    this.recursoAccedido = datos.recursoAccedido;
    this.fecha = datos.fecha || new Date().toISOString();
  }
  async registrarAcceso(usuario, accion, recursoAccedido) {
    const evento = new BitacoraAuditoria(this.repositorio, {
      usuarioId: typeof usuario === "string" ? usuario : usuario?.id ?? null, accion, recursoAccedido,
    });
    await this.repositorio.guardar({ ...evento });
    return evento;
  }
}

module.exports = { Usuario, Cliente, PersonalNutriVida, Empleado, Administrador, PerfilCliente, PerfilSalud, Producto, Consulta, Interaccion,
  BitacoraAuditoria, RolUsuario, EstadoConsulta };
