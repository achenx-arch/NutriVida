// Script de datos iniciales. Ejecutar una sola vez con: npm run seed
// Crea el usuario administrador de NutriVida y un catálogo de productos de ejemplo.

require("./config/env");
const { crearSistema } = require("./services/sistema");
const { Administrador, Producto } = require("./domain/modelos");
const { hashPassword } = require("./security/auth");

const PRODUCTOS_EJEMPLO = [
  {
    nombre: "Barra NutriFit Avena y Miel",
    ingredientes: "Avena integral, miel, semillas de chía, almendras",
    valoresNutricionales: "180 kcal, 6g proteína, 4g fibra, sin azúcar añadida procesada",
    categoria: "Snacks saludables",
  },
  {
    nombre: "Batido NutriVida Verde Detox",
    ingredientes: "Espinaca, manzana verde, apio, jengibre, agua de coco",
    valoresNutricionales: "95 kcal, 3g fibra, bajo en sodio",
    categoria: "Bebidas funcionales",
  },
  {
    nombre: "Proteína Vegetal NutriVida",
    ingredientes: "Proteína de guisante, proteína de arroz, cacao natural",
    valoresNutricionales: "120 kcal por porción, 20g proteína, sin lactosa, sin gluten",
    categoria: "Suplementos",
  },
  {
    nombre: "Galletas NutriVida Fibra Activa",
    ingredientes: "Harina integral, linaza, avena, aceite de oliva",
    valoresNutricionales: "140 kcal, 5g fibra, sin azúcar refinada",
    categoria: "Snacks saludables",
  },
  {
    nombre: "Té Funcional NutriVida Control Glucémico",
    ingredientes: "Canela, hojas de moringa, stevia natural",
    valoresNutricionales: "5 kcal, sin azúcar, apto para diabéticos (consultar con médico)",
    categoria: "Bebidas funcionales",
  },
];

async function seed() {
  const sistema = crearSistema();
  const { repositorios } = sistema;
  try {
  const correoAdmin = (process.env.SEED_ADMIN_CORREO || "admin@nutrivida.com").toLowerCase();
  const yaExisteAdmin = await repositorios.usuarios.buscarPorCorreo(correoAdmin);

  if (!yaExisteAdmin) {
    const password = process.env.SEED_ADMIN_PASSWORD;
    if (!password || password.length < 8 || password === "define_una_contrasena_segura") {
      throw new Error("Define SEED_ADMIN_PASSWORD con al menos 8 caracteres antes de crear el administrador.");
    }
    const passwordHash = await hashPassword(password);
    await repositorios.usuarios.guardar(new Administrador({
      nombre: process.env.SEED_ADMIN_NOMBRE || "Administrador NutriVida",
      correo: correoAdmin,
      passwordHash,
      area: process.env.SEED_ADMIN_AREA || "Atención al cliente",
      perfilSalud: null,
      createdAt: new Date().toISOString(),
    }));
    console.log("Usuario administrador creado:", correoAdmin);
  } else {
    console.log("La cuenta ya existe; se conservan su rol y su contraseña.");
  }

  const productosExistentes = await repositorios.productos.listar();
  if (productosExistentes.length === 0) {
    for (const p of PRODUCTOS_EJEMPLO) await repositorios.productos.guardar(new Producto(p));
    console.log(`Se cargaron ${PRODUCTOS_EJEMPLO.length} productos de ejemplo.`);
  } else {
    console.log("Ya existen productos en el catálogo, no se duplican.");
  }

  console.log("\nListo. Ya puedes iniciar el servidor con: npm start");
  } finally { await sistema.cerrar(); }
}

seed().catch((err) => {
  console.error("No se completaron los datos iniciales. Revisa configuración y conexión.");
  process.exit(1);
});
