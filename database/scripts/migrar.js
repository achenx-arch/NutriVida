const {ejecutar}=require("./comun");
ejecutar(require("../../src/database/migraciones").migrar);
