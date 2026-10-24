const { Cliente, BitacoraAuditoria } = require("../domain/modelos");
const { GestorSeguridad } = require("../security/GestorSeguridad");
const { hashPassword } = require("../security/auth");
const { validarRegistro, ErrorValidacion } = require("../security/validate");
const { ServicioIA } = require("./iaService");
const { crearRepositorios } = require("../repositories/crearRepositorios");

const { ErrorAplicacion } = require("../errors/ErrorAplicacion");
function errorHttp(mensaje, status) { return new ErrorAplicacion(mensaje, status); }
const { ModuloPerfilCliente, ModuloPerfilSalud } = require("./perfilService");
const { ModuloCatalogo } = require("./catalogoService");
const { ModuloConsultas } = require("./consultasService");

function crearSistema({ store, pool, persistencia, seguridad = new GestorSeguridad(), ia = new ServicioIA({ seguridad }) } = {}) {
  const acceso = crearRepositorios({ store, pool, persistencia, seguridad });
  const { repositorios } = acceso;
  const auditoria = new BitacoraAuditoria(repositorios.auditoria);
  return {
    repositorios, seguridad, ia, auditoria, persistencia: acceso.persistencia,
    comprobarPersistencia: acceso.comprobar, cerrar: acceso.cerrar,
    perfil: new ModuloPerfilSalud(repositorios, auditoria),
    catalogo: new ModuloCatalogo(repositorios, auditoria),
    catalogoComercial: repositorios.catalogoComercial ? new (require("./catalogoComercialService").CatalogoComercialService)(repositorios) : null,
    inventario: repositorios.inventario ? new (require("./inventarioService").InventarioService)(repositorios) : null,
    pedidos: repositorios.pedidos ? new (require("./pedidosService").ServicioPedidos)(repositorios.pedidos, repositorios.inventario) : null,
    historialConsumo: repositorios.historialConsumo ? new (require("./historialConsumoService").HistorialConsumoService)(repositorios.historialConsumo) : null,
    consultas: new ModuloConsultas(repositorios, seguridad, ia, auditoria),
    async registrar(datos) {
      const validos = validarRegistro(datos);
      const usuario = new Cliente({ ...validos, passwordHash: await hashPassword(validos.password) });
      await repositorios.usuarios.guardar(usuario);
      await auditoria.registrarAcceso(usuario, "registro_cuenta", "usuarios");
      return usuario;
    },
    async login({ correo, password }) {
      if (typeof correo !== "string" || typeof password !== "string" || !correo || !password) {
        throw new ErrorValidacion("Correo y contraseña son obligatorios.");
      }
      const usuario = await repositorios.usuarios.buscarPorCorreo(correo.toLowerCase().trim());
      const hashSimulado = "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";
      const valido = await require("../security/auth").compararPassword(password, usuario?.passwordHash || hashSimulado);
      if (!usuario || !valido) {
        await auditoria.registrarAcceso(null, "LOGIN_FALLIDO", "auth/login");
        throw errorHttp("Correo o contraseña incorrectos.", 401);
      }
      await auditoria.registrarAcceso(usuario, "LOGIN_EXITOSO", "usuarios");
      return usuario;
    },
  };
}

module.exports = { crearSistema, ModuloPerfilCliente, ModuloPerfilSalud, ModuloCatalogo, ModuloConsultas };
