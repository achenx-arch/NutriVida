// Autenticación: hashing de contraseñas (RNF-04) y emisión/verificación
// de tokens de sesión (JWT). El middleware protege cada endpoint que
// accede a datos del cliente o funciones administrativas (RNF-03).

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const env = require("../config/env");
const { normalizarRol, tienePermiso } = require("../domain/roles");

const {createHash,randomUUID}=require("crypto");
const {UUID}=require("./validate");
const {ErrorAplicacion}=require("../errors/ErrorAplicacion");
const huellaToken=token=>"sesion/"+createHash("sha256").update(token).digest("hex");
const SALT_ROUNDS = 10;
const TOKEN_EXPIRA_EN = "8h";

async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

async function compararPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function generarToken(usuario) {
  return jwt.sign(
    { sub: usuario.id, rol: normalizarRol(usuario.rol), nombre: usuario.nombre },
    env.jwtSecret,
    { expiresIn: TOKEN_EXPIRA_EN, algorithm: "HS256", jwtid: randomUUID() }
  );
}

/** Middleware: exige un token válido en el header Authorization: Bearer <token> */
function autenticar(req,res,next) {
 const match=/^Bearer ([^\s]+)$/.exec(req.headers.authorization||"");
 if(!match)return next(new ErrorAplicacion("No autenticado. Se requiere un token válido.",401,"NO_AUTENTICADO"));
 try{
  const payload=jwt.verify(match[1],env.jwtSecret,{algorithms:["HS256"]});
  if(!payload||typeof payload!=="object"||typeof payload.sub!=="string"||!UUID.test(payload.sub)||!Number.isInteger(payload.exp))throw new Error("JWT_INVALIDO");
  req.usuario={id:payload.sub};req.huellaSesion=huellaToken(match[1]);
 }catch{return next(new ErrorAplicacion("Token inválido o expirado.",401,"TOKEN_INVALIDO"));}
 next();
}
function denegar(req,next){
 const error=new ErrorAplicacion("No tienes permisos para esta acción.",403,"ACCESO_DENEGADO");
 Promise.resolve(req.auditoria?.registrarAcceso(req.usuario,"ACCESO_DENEGADO","api/protegida")).then(()=>next(error),next);
}
function requerirRoles(...roles){
 return (req,res,next)=>roles.includes(normalizarRol(req.usuario?.rol))?next():denegar(req,next);
}
function requerirRol(rol){return requerirRoles(normalizarRol(rol));}

// Resolver la cuenta evita que roles obsoletos de JWT concedan permisos.
function autenticarUsuario(repositorio) {
  return (req, res, next) => autenticar(req, res, async (fallo) => {
    if(fallo) return next(fallo);
    try {
      const usuario = await repositorio.buscarPorId(req.usuario.id);
      if (!usuario || usuario.estado === false || !["CLIENTE","EMPLEADO","ADMINISTRADOR"].includes(normalizarRol(usuario.rol)) || await req.sesionRevocada?.(req.huellaSesion))
        return next(new ErrorAplicacion("La sesión ya no es válida.",401,"SESION_INVALIDA"));
      req.usuario = usuario;
      next();
    } catch (err) { next(err); }
  });
}
function requerirPermiso(permiso) {
  return (req, res, next) => {
    if (!tienePermiso(req.usuario, permiso)) return denegar(req,next);
    next();
  };
}

module.exports = { hashPassword, compararPassword, generarToken, autenticar, autenticarUsuario, requerirRol, requerirPermiso, requerirRoles, requireAnyRole:requerirRoles, huellaToken };
