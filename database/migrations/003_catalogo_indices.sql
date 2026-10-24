-- FASE 4: mismas entidades y datos; unicidad normalizada y acceso al catálogo.
-- Si existen duplicados se aborta: nunca se renombran ni fusionan datos automáticamente.
CREATE UNIQUE INDEX categorias_nombre_normalizado_uq
 ON categorias(lower(regexp_replace(btrim(nombre),'[[:space:]]+',' ','g')));
CREATE UNIQUE INDEX ingredientes_nombre_normalizado_uq
 ON ingredientes(lower(regexp_replace(btrim(nombre),'[[:space:]]+',' ','g')));
CREATE INDEX productos_estado_nombre_idx ON productos(estado,lower(nombre),id_producto);
-- FK de categoría y ambos sentidos producto/ingrediente ya están indexados en 001.
