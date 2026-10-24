const { Usuario, Cliente, PersonalNutriVida, Empleado, Administrador, RolUsuario } = require("../domain/modelos");
const { ErrorAplicacion } = require("../errors/ErrorAplicacion");

class RepositorioUsuarios {
  constructor(store, seguridad) { this.store = store; this.seguridad = seguridad; }
  desdeRegistro(registro) {
    if (!registro || registro.estado === false) return null;
    const datos = { ...registro };
    if (datos.perfilSalud) {
      datos.perfilSalud = { ...datos.perfilSalud };
      for (const campo of ["condicionesMedicas", "alergias"]) {
        datos.perfilSalud[campo] = this.seguridad.descifrarDatoSensible(datos.perfilSalud[campo]) || "";
      }
      if (datos.perfilSalud.versionCifrado === 2) {
        datos.perfilSalud.objetivoNutricional = this.seguridad.descifrarDatoSensible(datos.perfilSalud.objetivoNutricional) || "";
      }
    }
    switch (datos.rol) {
      case RolUsuario.PERSONAL_NUTRIVIDA: return new PersonalNutriVida(datos);
      case RolUsuario.EMPLEADO: return new Empleado(datos);
      case RolUsuario.ADMINISTRADOR: return new Administrador(datos);
      case RolUsuario.CLIENTE: return new Cliente(datos);
      default: return new Usuario(datos); // Rol desconocido: no conceder permisos.
    }
  }
  buscarPorId(id) { return this.desdeRegistro(this.store.buscarPorId("usuarios", id)); }
  buscarPorCorreo(correo) { return this.desdeRegistro(this.store.listar("usuarios").find((u) => u.correo === correo)); }
  listar() { return this.store.listar("usuarios").map((r) => this.desdeRegistro(r)); }
  aRegistro(usuario) {
    const registro = { ...usuario, rol: usuario.rolPersistido ?? usuario.rol };
    if (usuario.perfilSalud) {
      registro.perfilSalud = { id: usuario.perfilSalud.id, versionCifrado: 2 };
      for (const campo of ["condicionesMedicas", "alergias", "objetivoNutricional"]) {
        registro.perfilSalud[campo] = this.seguridad.cifrarDatoSensible(usuario.perfilSalud[campo]);
      }
    }
    return registro;
  }
  guardar(usuario) {
    const registro = this.aRegistro(usuario);
    this.store.transaccion((datos) => {
      if (datos.usuarios.some((u) => u.correo === usuario.correo && u.id !== usuario.id)) {
        throw new ErrorAplicacion("Ya existe una cuenta registrada con ese correo.", 409);
      }
      const i = datos.usuarios.findIndex((u) => u.id === usuario.id);
      if (i < 0) datos.usuarios.push(registro); else datos.usuarios[i] = registro;
    });
    return usuario;
  }
}

module.exports = { RepositorioUsuarios };
