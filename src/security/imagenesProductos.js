// Imágenes de productos: SOLO archivos locales en public/images/productos/ (decisión aprobada).
// PostgreSQL guarda únicamente la ruta /images/productos/<slug>.<ext>; nunca binarios ni Base64.
const fs = require("node:fs");
const path = require("node:path");
const env = require("../config/env");

const PREFIJO = "/images/productos/";
const MAX_BYTES = 2 * 1024 * 1024;
// slug seguro: minúsculas, dígitos y guiones simples; UNA sola extensión permitida (sin SVG).
const NOMBRE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.(?:webp|png|jpe?g)$/;
const RUTA = /^\/images\/productos\/([a-z0-9]+(?:-[a-z0-9]+)*\.(?:webp|png|jpe?g))$/;
const MAX_NOMBRE = 100;

const directorio = () => path.resolve(env.imagenesProductosDir);

// Devuelve los datos del archivo si es un archivo regular (no enlace) dentro del directorio, o null.
function archivoSeguro(nombre) {
  if (typeof nombre !== "string" || nombre.length > MAX_NOMBRE || !NOMBRE.test(nombre)) return null;
  const base = directorio();
  const ruta = path.join(base, nombre);
  if (path.dirname(ruta) !== base) return null;
  let info;
  try { info = fs.lstatSync(ruta); } catch { return null; }
  if (!info.isFile() || info.isSymbolicLink() || info.size === 0 || info.size > MAX_BYTES) return null;
  try { if (path.dirname(fs.realpathSync(ruta)) !== fs.realpathSync(base)) return null; } catch { return null; }
  return { nombre, url: PREFIJO + nombre, bytes: info.size };
}

// Valida el valor que llega del cliente. null/"" → sin imagen. Lanza mediante `fallo` si no es válido.
function validarRutaImagen(valor, fallo) {
  if (valor === null || valor === "") return null;
  if (typeof valor !== "string" || valor.length > PREFIJO.length + MAX_NOMBRE) fallo("La imagen debe ser una ruta local /images/productos/<nombre>.webp|png|jpg.");
  const m = RUTA.exec(valor);
  if (!m) fallo("La imagen debe ser una ruta local /images/productos/<nombre>.webp|png|jpg (sin URLs externas, SVG ni rutas relativas).");
  if (!archivoSeguro(m[1])) fallo("La imagen seleccionada no existe en /images/productos/.");
  return PREFIJO + m[1];
}

// Listado de solo lectura para administración: solo archivos que pasarían la validación.
function listarImagenes() {
  let nombres;
  try { nombres = fs.readdirSync(directorio()); } catch { return []; }
  return nombres.map(archivoSeguro).filter(Boolean).sort((a, b) => a.nombre.localeCompare(b.nombre));
}

// Para respuestas: devuelve la ruta solo si sigue siendo una imagen local válida y existente; si no, null (fallback).
function rutaImagenSegura(valor) {
  const m = typeof valor === "string" ? RUTA.exec(valor) : null;
  return m && archivoSeguro(m[1]) ? PREFIJO + m[1] : null;
}

module.exports = { validarRutaImagen, listarImagenes, rutaImagenSegura, PREFIJO, MAX_BYTES };
