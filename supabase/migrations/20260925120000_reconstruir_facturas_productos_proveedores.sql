-- ===========================================================================
-- Reconstruccion de esquema: facturas, productos_factura, proveedores
-- Proyecto Supabase: jeamoczmbfsnwkfjxcyo
-- Generada: 2026-09-25
-- ===========================================================================
--
-- PROBLEMA
--   Ninguna de las migraciones locales de este repositorio contiene un
--   CREATE TABLE de `facturas`, `productos_factura` ni `proveedores`. Lo
--   unico que existe son ALTER TABLE que dan por hecho que las tres ya
--   existen (el mas antiguo, sobre facturas, es
--   20260208165757_add_drive_link_to_facturas.sql). Tampoco existe en
--   ningun fichero el cuerpo de `verificar_duplicado_factura`, que varias
--   migraciones referencian (REVOKE/GRANT, ALTER FUNCTION ... SET
--   search_path) pero ninguna crea.
--
--   Consecuencia: un `supabase db reset`, o una branch/entorno nuevo
--   arrancado desde este repositorio, no crea estas tablas y todo lo que
--   depende de ellas falla en cascada (indices, RLS, triggers, las
--   funciones del chatbot de facturas, `validar_cordura_factura`, etc.).
--
-- METODO
--   Todo lo que sigue se leyo de PRODUCCION en modo exclusivamente lectura
--   (SELECT), via el endpoint de Management API de Supabase
--   (POST /v1/projects/jeamoczmbfsnwkfjxcyo/database/query), consultando
--   information_schema.columns, pg_constraint, pg_indexes, pg_policies,
--   pg_trigger, pg_proc (pg_get_functiondef/pg_get_triggerdef/
--   pg_get_constraintdef), pg_class/pg_attribute (comment) y
--   pg_sequences. No se ha escrito nada contra produccion. No se ha dado
--   por bueno ningun nombre de columna citado en el encargo o en el
--   codigo de la app sin confirmarlo antes contra el catalogo real.
--
--   Se comprobo tambien `supabase_migrations.schema_migrations`: la
--   version mas antigua registrada es 20251113153132. Las tres tablas ya
--   reciben ALTER TABLE en 20260208165757, y no hay ninguna version
--   "huerfana" (presente en schema_migrations pero sin fichero local)
--   anterior a esa fecha que pueda corresponder a su creacion -- a
--   diferencia de casos como 20260221161756 o 20260224154346, que SI son
--   una version real aplicada por dashboard/MCP y nunca exportada. Osea:
--   esto no es "se aplico y no se exporto", es "nunca paso por el flujo
--   de migraciones": lo mas probable es que las tres tablas se crearan a
--   mano (Table Editor / SQL Editor) antes de que este proyecto empezara
--   a usar `supabase migration`. Por eso esta cabecera no cita una
--   version de origen como las otras reconstrucciones del repo: no la
--   hay.
--
--   (Aparte, sin relacion con estas 3 tablas: schema_migrations tiene HOY
--   dos versiones sin fichero local, 20260925150523 y 20260925154109 --
--   no son mias, no las he tocado, se deja constancia por si es de
--   utilidad para quien coordine a los otros agentes de esta sesion.)
--
-- ALCANCE DE ESTE FICHERO
--   Las 3 tablas del encargo (columnas, tipos, defaults, PK/FK/UNIQUE/
--   CHECK, indices, RLS, triggers) + el cuerpo completo de
--   `verificar_duplicado_factura`.
--
--   Los triggers de `facturas` y `proveedores` (trigger_facturas_updated,
--   trigger_proveedores_updated) y el de `productos_factura`
--   (trigger_historial_precios) SI existen en produccion, pero las
--   funciones que ejecutan -- `actualizar_updated_at()` y
--   `actualizar_historial_precios()` -- TAMPOCO tienen CREATE FUNCTION en
--   ningun fichero del repo: mismo problema que las 3 tablas, un peldano
--   mas abajo. Sin ellas, CREATE TRIGGER falla ("function does not
--   exist"), asi que se incluyen aqui para que la reconstruccion
--   funcione de verdad, no solo la parte pedida. OJO: `actualizar_updated_at()`
--   tambien la usa HOY el trigger `trigger_productos_catalogo_updated` de
--   `productos_catalogo`, una tabla fuera de este encargo (y que, por lo
--   visto en 20260918084909, tiene el mismo sintoma: probablemente
--   tampoco tenga CREATE TABLE en el repo). No se toca `productos_catalogo`
--   aqui -- queda anotado para quien continue este trabajo.
--
--   `normalizar_proveedor()`, `normalizar_nombre_producto()` (usadas por
--   las columnas generadas) y `can_read_section()` / `can_write_section()`
--   (usadas por las policies) NO se redefinen aqui: ya tienen su
--   CREATE FUNCTION real en 20260221161214_enable_unaccent_and_normalization_functions.sql
--   (mas los fixes 20260221161355 y 20260221161434) y en
--   20260918120000_rls_por_permisos_de_seccion.sql respectivamente.
--
-- ADVERTENCIA -- NO APLICAR CONTRA LA BASE ACTUAL
--   Las tres tablas y la funcion YA EXISTEN en produccion. Este fichero
--   NO debe ejecutarse contra el proyecto real: su valor es servir de
--   CREATE TABLE que hoy no existe en ningun sitio, para que un
--   `supabase db reset` o una branch/entorno nuevo reproduzcan el
--   esquema real desde cero. Es idempotente donde Postgres lo permite
--   (CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION) y usa
--   DROP ... IF EXISTS antes de las policies y los triggers porque
--   Postgres no soporta "CREATE POLICY IF NOT EXISTS" ni
--   "CREATE TRIGGER IF NOT EXISTS": si esto se ejecuta por error contra
--   la base real, las tablas y la funcion quedan intactas (no-op), y las
--   policies/triggers se sueltan y se vuelven a crear IDENTICOS -- hay un
--   instante sin la policy/trigger durante esa transaccion, por eso
--   "inofensivo" no es lo mismo que "recomendable": no hay ningun motivo
--   para correr esto contra produccion.
--
-- RIESGO RESIDUAL QUE ESTE FICHERO NO CIERRA (decirlo, no esconderlo)
--   Su timestamp (20260925120000) es el que se me asigno para no chocar
--   con los otros dos agentes de esta sesion (130000 y 140000), NO la
--   fecha real de creacion de estas tablas. Un `supabase db reset` real
--   desde cero seguiria fallando: las ALTER TABLE de
--   20260208165757_add_drive_link_to_facturas.sql (y varias otras,
--   fechadas entre febrero y septiembre de 2026) se reproducirian ANTES
--   que este fichero y darian "relation facturas does not exist", porque
--   este CREATE TABLE queda al final de la linea temporal, no al
--   principio. Arreglar eso de verdad exige mover este fichero (o
--   consolidar las ALTER TABLE posteriores) a una fecha anterior a
--   20260208165757 -- fuera del territorio que tengo asignado en esta
--   sesion (solo ficheros `20260925120000_*`), asi que no se hace aqui.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. TABLA facturas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.facturas (
  id                        BIGSERIAL PRIMARY KEY,
  tipo                      VARCHAR(20)  NOT NULL
                               CHECK (tipo IN ('factura', 'albaran')),
  proveedor                 VARCHAR(255),
  cif                       VARCHAR(50),
  numero_documento          VARCHAR(100) NOT NULL,
  fecha                     DATE         NOT NULL,
  subtotal                  NUMERIC(10,2),
  iva                       NUMERIC(10,2),
  total                     NUMERIC(10,2),
  observaciones             TEXT,
  procesado_en              TIMESTAMP DEFAULT now(),
  created_at                TIMESTAMP DEFAULT now(),
  updated_at                TIMESTAMP DEFAULT now(),
  embedding_observaciones   vector(1536),
  embedding                 vector(1536),
  drive_url                 TEXT,
  resumen                   TEXT,
  proveedor_normalizado     VARCHAR
                               GENERATED ALWAYS AS (normalizar_proveedor(proveedor)) STORED,
  verificada                BOOLEAN DEFAULT false,
  archivo_path              TEXT,
  alertas_validacion        JSONB,
  CONSTRAINT unique_documento UNIQUE (numero_documento, proveedor)
);

-- Nota de orden: en produccion faltan las posiciones ordinales 17-22 de
-- esta tabla (nombre_archivo, estado, pagado, fecha_pago, metodo_pago,
-- notas_internas) -- se anadieron y se volvieron a quitar entre
-- 20260208165757 y 20260208172549. No se recrean aqui: el objetivo es el
-- esquema REAL de hoy, no el historial de columnas que ya no existen.

CREATE INDEX IF NOT EXISTS idx_facturas_tipo
  ON public.facturas (tipo);
CREATE INDEX IF NOT EXISTS idx_facturas_proveedor
  ON public.facturas (proveedor);
CREATE INDEX IF NOT EXISTS idx_facturas_fecha
  ON public.facturas (fecha DESC);
CREATE INDEX IF NOT EXISTS idx_facturas_fecha_tipo
  ON public.facturas (fecha DESC, tipo);
CREATE INDEX IF NOT EXISTS idx_facturas_procesado
  ON public.facturas (procesado_en DESC);
CREATE INDEX IF NOT EXISTS idx_facturas_embedding_hnsw
  ON public.facturas USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_facturas_drive_url
  ON public.facturas (drive_url)
  WHERE drive_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_facturas_proveedor_normalizado
  ON public.facturas (proveedor_normalizado);
CREATE INDEX IF NOT EXISTS idx_facturas_alertas_pendientes
  ON public.facturas (fecha DESC)
  WHERE alertas_validacion IS NOT NULL
    AND jsonb_array_length(alertas_validacion) > 0;
CREATE INDEX IF NOT EXISTS idx_facturas_sin_original
  ON public.facturas (procesado_en DESC)
  WHERE drive_url IS NULL AND archivo_path IS NULL;

COMMENT ON TABLE public.facturas IS
  'Almacena facturas y albaranes procesados por OCR';
COMMENT ON COLUMN public.facturas.tipo IS
  'Tipo de documento: factura o albaran';
COMMENT ON COLUMN public.facturas.subtotal IS
  'NULL para albaranes, valor para facturas';
COMMENT ON COLUMN public.facturas.iva IS
  'NULL para albaranes, valor para facturas';
COMMENT ON COLUMN public.facturas.total IS
  'NULL para albaranes, valor para facturas';
COMMENT ON COLUMN public.facturas.drive_url IS
  'URL del documento en Google Drive para acceso directo desde el admin panel';
COMMENT ON COLUMN public.facturas.archivo_path IS
  'Ruta del PDF/imagen original dentro del bucket privado facturas-originales. Fallback de drive_url mientras Google Drive no este configurado.';
COMMENT ON COLUMN public.facturas.alertas_validacion IS
  'Anomalias de importes detectadas por procesar-factura al cargar el documento (descuadres linea/cabecera, precios desproporcionados frente al historico). NULL o [] = sin anomalias. Es un aviso para revision humana, no bloquea el guardado.';


-- ---------------------------------------------------------------------------
-- 2. TABLA productos_factura
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.productos_factura (
  id                   BIGSERIAL PRIMARY KEY,
  factura_id           BIGINT NOT NULL
                          REFERENCES public.facturas(id) ON DELETE CASCADE,
  nombre               VARCHAR(500) NOT NULL,
  cantidad             NUMERIC(10,3) NOT NULL DEFAULT 1,
  unidad               VARCHAR(50) DEFAULT 'unidades',
  precio_unitario      NUMERIC(10,2),
  total                NUMERIC(10,2),
  created_at           TIMESTAMP DEFAULT now(),
  embedding            vector(1536),
  nombre_normalizado   VARCHAR
                          GENERATED ALWAYS AS (normalizar_nombre_producto(nombre)) STORED
);

-- Nota: en produccion existio tambien una FK "fk_factura" idéntica a
-- productos_factura_factura_id_fkey; se elimino en
-- 20260301172007_remove_duplicate_fk_factura_constraint.sql. No se
-- recrea aqui a proposito: solo queda la que sigue viva hoy.

CREATE INDEX IF NOT EXISTS idx_productos_factura_id
  ON public.productos_factura (factura_id);
CREATE INDEX IF NOT EXISTS idx_productos_nombre
  ON public.productos_factura (nombre);
CREATE INDEX IF NOT EXISTS idx_productos_nombre_lower
  ON public.productos_factura (lower(nombre));
CREATE INDEX IF NOT EXISTS idx_productos_embedding
  ON public.productos_factura USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_productos_proveedor_normalizado
  ON public.productos_factura (nombre_normalizado);
-- (el nombre del indice anterior es enganoso -- indexa nombre_normalizado,
-- no nada de proveedores -- pero es el nombre real en produccion y se
-- reconstruye tal cual.)

COMMENT ON TABLE public.productos_factura IS
  'Líneas de productos de cada factura/albarán';
COMMENT ON COLUMN public.productos_factura.precio_unitario IS
  'NULL para albaranes';
COMMENT ON COLUMN public.productos_factura.total IS
  'NULL para albaranes';


-- ---------------------------------------------------------------------------
-- 3. TABLA proveedores
-- ---------------------------------------------------------------------------
-- Nota: no hay ninguna FK entre `facturas`/`productos_factura` y
-- `proveedores`. `facturas.proveedor` es texto libre (VARCHAR(255)); el
-- cruce con este catalogo se hace por nombre/CIF a nivel de aplicacion o
-- de vista (vista_proveedores_resumen, vista_gastos_proveedor_mes), no
-- por integridad referencial en el esquema.
CREATE TABLE IF NOT EXISTS public.proveedores (
  id          BIGSERIAL PRIMARY KEY,
  nombre      VARCHAR(255) NOT NULL UNIQUE,
  cif         VARCHAR(50) UNIQUE,
  direccion   TEXT,
  telefono    VARCHAR(50),
  email       VARCHAR(255),
  categoria   VARCHAR(100),
  notas       TEXT,
  activo      BOOLEAN DEFAULT true,
  created_at  TIMESTAMP DEFAULT now(),
  updated_at  TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proveedores_cif
  ON public.proveedores (cif);
CREATE INDEX IF NOT EXISTS idx_proveedores_nombre
  ON public.proveedores (nombre);
-- (idx_proveedores_cif e idx_proveedores_nombre son redundantes con los
-- indices unicos proveedores_cif_key / proveedores_nombre_key que ya crea
-- el UNIQUE de arriba -- redundantes pero reales en produccion, se
-- reconstruyen tal cual, sin "corregir" el esquema.)

COMMENT ON TABLE public.proveedores IS
  'Catálogo de proveedores del restaurante';


-- ---------------------------------------------------------------------------
-- 4. Funciones de trigger que tambien faltaban en el repo
--    (actualizar_updated_at, actualizar_historial_precios)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.actualizar_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.actualizar_historial_precios()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Solo para facturas con precio
  IF (SELECT tipo FROM facturas WHERE id = NEW.factura_id) = 'factura'
     AND NEW.precio_unitario IS NOT NULL THEN

    INSERT INTO historial_precios (
      producto_nombre,
      proveedor,
      precio,
      fecha,
      factura_id
    )
    SELECT
      NEW.nombre,
      f.proveedor,
      NEW.precio_unitario,
      f.fecha,
      NEW.factura_id
    FROM facturas f
    WHERE f.id = NEW.factura_id;
  END IF;

  RETURN NEW;
END;
$function$;

-- Triggers (CREATE TRIGGER no admite IF NOT EXISTS en Postgres: se quita
-- y se vuelve a crear identico).
DROP TRIGGER IF EXISTS trigger_facturas_updated ON public.facturas;
CREATE TRIGGER trigger_facturas_updated
  BEFORE UPDATE ON public.facturas
  FOR EACH ROW EXECUTE FUNCTION actualizar_updated_at();

DROP TRIGGER IF EXISTS trigger_proveedores_updated ON public.proveedores;
CREATE TRIGGER trigger_proveedores_updated
  BEFORE UPDATE ON public.proveedores
  FOR EACH ROW EXECUTE FUNCTION actualizar_updated_at();

DROP TRIGGER IF EXISTS trigger_historial_precios ON public.productos_factura;
CREATE TRIGGER trigger_historial_precios
  AFTER INSERT ON public.productos_factura
  FOR EACH ROW EXECUTE FUNCTION actualizar_historial_precios();


-- ---------------------------------------------------------------------------
-- 5. Row Level Security
--    Estado real de hoy (post 20260918084909 + 20260918120000): RLS
--    activada en las 3 tablas, sin policy para anon, acceso de
--    authenticated atado al permiso de seccion 'facturas' del panel
--    (can_read_section/can_write_section), acceso total para
--    service_role. CREATE POLICY no admite IF NOT EXISTS: se sigue el
--    mismo patron DROP IF EXISTS + CREATE que ya usa 20260918120000.
-- ---------------------------------------------------------------------------
ALTER TABLE public.facturas          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.productos_factura ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proveedores       ENABLE ROW LEVEL SECURITY;

-- facturas
DROP POLICY IF EXISTS "facturas_select_seccion" ON public.facturas;
CREATE POLICY "facturas_select_seccion" ON public.facturas
  FOR SELECT TO authenticated
  USING (public.can_read_section('facturas'));

DROP POLICY IF EXISTS "facturas_insert_seccion" ON public.facturas;
CREATE POLICY "facturas_insert_seccion" ON public.facturas
  FOR INSERT TO authenticated
  WITH CHECK (public.can_write_section('facturas'));

DROP POLICY IF EXISTS "facturas_update_seccion" ON public.facturas;
CREATE POLICY "facturas_update_seccion" ON public.facturas
  FOR UPDATE TO authenticated
  USING (public.can_write_section('facturas'))
  WITH CHECK (public.can_write_section('facturas'));

DROP POLICY IF EXISTS "facturas_delete_seccion" ON public.facturas;
CREATE POLICY "facturas_delete_seccion" ON public.facturas
  FOR DELETE TO authenticated
  USING (public.can_write_section('facturas'));

DROP POLICY IF EXISTS "facturas_service_role" ON public.facturas;
CREATE POLICY "facturas_service_role" ON public.facturas
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- productos_factura (mismo permiso de seccion que facturas: 'facturas')
DROP POLICY IF EXISTS "productos_factura_select_seccion" ON public.productos_factura;
CREATE POLICY "productos_factura_select_seccion" ON public.productos_factura
  FOR SELECT TO authenticated
  USING (public.can_read_section('facturas'));

DROP POLICY IF EXISTS "productos_factura_insert_seccion" ON public.productos_factura;
CREATE POLICY "productos_factura_insert_seccion" ON public.productos_factura
  FOR INSERT TO authenticated
  WITH CHECK (public.can_write_section('facturas'));

DROP POLICY IF EXISTS "productos_factura_update_seccion" ON public.productos_factura;
CREATE POLICY "productos_factura_update_seccion" ON public.productos_factura
  FOR UPDATE TO authenticated
  USING (public.can_write_section('facturas'))
  WITH CHECK (public.can_write_section('facturas'));

DROP POLICY IF EXISTS "productos_factura_delete_seccion" ON public.productos_factura;
CREATE POLICY "productos_factura_delete_seccion" ON public.productos_factura
  FOR DELETE TO authenticated
  USING (public.can_write_section('facturas'));

DROP POLICY IF EXISTS "productos_factura_service_role" ON public.productos_factura;
CREATE POLICY "productos_factura_service_role" ON public.productos_factura
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- proveedores (mismo permiso de seccion que facturas: 'facturas')
DROP POLICY IF EXISTS "proveedores_select_seccion" ON public.proveedores;
CREATE POLICY "proveedores_select_seccion" ON public.proveedores
  FOR SELECT TO authenticated
  USING (public.can_read_section('facturas'));

DROP POLICY IF EXISTS "proveedores_insert_seccion" ON public.proveedores;
CREATE POLICY "proveedores_insert_seccion" ON public.proveedores
  FOR INSERT TO authenticated
  WITH CHECK (public.can_write_section('facturas'));

DROP POLICY IF EXISTS "proveedores_update_seccion" ON public.proveedores;
CREATE POLICY "proveedores_update_seccion" ON public.proveedores
  FOR UPDATE TO authenticated
  USING (public.can_write_section('facturas'))
  WITH CHECK (public.can_write_section('facturas'));

DROP POLICY IF EXISTS "proveedores_delete_seccion" ON public.proveedores;
CREATE POLICY "proveedores_delete_seccion" ON public.proveedores
  FOR DELETE TO authenticated
  USING (public.can_write_section('facturas'));

DROP POLICY IF EXISTS "proveedores_service_role" ON public.proveedores;
CREATE POLICY "proveedores_service_role" ON public.proveedores
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);


-- ---------------------------------------------------------------------------
-- 6. verificar_duplicado_factura -- cuerpo completo recuperado de
--    pg_get_functiondef contra produccion. SECURITY DEFINER (por eso
--    20260918084909 le quito EXECUTE a public/anon: devuelve la fila
--    entera de `facturas` via row_to_json). search_path fijado a
--    'public' por 20260922200000. Se reproducen aqui las mismas
--    REVOKE/GRANT para que la funcion quede bloqueada igual que en
--    produccion desde el momento en que se crea, sin depender de que
--    20260918084909 se ejecute despues (ver aviso de orden en la
--    cabecera).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verificar_duplicado_factura(
  p_numero_documento character varying,
  p_proveedor        character varying,
  p_fecha            date,
  p_total            numeric
)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  factura_existente RECORD;
  resultado json;
BEGIN
  RAISE NOTICE 'Buscando: % | % | % | %', p_numero_documento, p_proveedor, p_fecha, p_total;

  -- 1. Buscar SOLO por número de documento (más confiable)
  SELECT * INTO factura_existente
  FROM facturas
  WHERE LOWER(TRIM(numero_documento)) = LOWER(TRIM(p_numero_documento))
  LIMIT 1;

  IF FOUND THEN
    RAISE NOTICE 'Duplicado encontrado por número: %', factura_existente.id;
    SELECT json_build_object(
      'es_duplicado', true,
      'motivo', 'numero_documento',
      'factura_existente', row_to_json(factura_existente)
    ) INTO resultado;
    RETURN resultado;
  END IF;

  -- 2. Buscar por proveedor PARCIAL + fecha + total
  -- Usa ILIKE para búsqueda parcial
  SELECT * INTO factura_existente
  FROM facturas
  WHERE (
    LOWER(proveedor) LIKE '%' || LOWER(TRIM(p_proveedor)) || '%'
    OR LOWER(TRIM(p_proveedor)) LIKE '%' || LOWER(proveedor) || '%'
  )
  AND fecha = p_fecha
  AND ABS(total - p_total) < 0.01
  LIMIT 1;

  IF FOUND THEN
    RAISE NOTICE 'Duplicado encontrado por datos: %', factura_existente.id;
    SELECT json_build_object(
      'es_duplicado', true,
      'motivo', 'datos_coincidentes',
      'factura_existente', row_to_json(factura_existente)
    ) INTO resultado;
    RETURN resultado;
  END IF;

  -- No es duplicado
  RAISE NOTICE 'No es duplicado';
  SELECT json_build_object(
    'es_duplicado', false,
    'motivo', null,
    'factura_existente', null
  ) INTO resultado;

  RETURN resultado;
END;
$function$;

REVOKE ALL ON FUNCTION public.verificar_duplicado_factura(character varying, character varying, date, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verificar_duplicado_factura(character varying, character varying, date, numeric) TO authenticated, service_role;

COMMIT;

-- ===========================================================================
-- QUE COMPRUEBA ESTO -- ejecutar contra produccion (solo lectura) para
-- validar que la reconstruccion de arriba coincide columna a columna.
-- ===========================================================================
--
--   select table_name, ordinal_position, column_name, data_type,
--          character_maximum_length, numeric_precision, numeric_scale,
--          column_default, is_nullable, is_generated, generation_expression
--   from information_schema.columns
--   where table_schema = 'public'
--     and table_name in ('facturas', 'productos_factura', 'proveedores')
--   order by table_name, ordinal_position;
--
--   select conrelid::regclass, conname, contype, pg_get_constraintdef(oid)
--   from pg_constraint
--   where conrelid in ('public.facturas'::regclass,
--                       'public.productos_factura'::regclass,
--                       'public.proveedores'::regclass);
--
--   select pg_get_functiondef(
--     'public.verificar_duplicado_factura(character varying, character varying, date, numeric)'::regprocedure
--   );
--
-- La comparacion columna a columna completa (que no falta ninguna, que
-- los tipos coinciden exactamente) se entrego en el informe de esta
-- sesion, no en este fichero.
--
-- ===========================================================================
-- ROLLBACK
-- ===========================================================================
--   Ver 20260925120000_reconstruir_facturas_productos_proveedores_rollback.sql
--   (fichero separado, en comentarios -- no se ejecuta solo). Recuerda:
--   las tablas y la funcion siguen existiendo en produccion aunque se
--   "deshaga" esta reconstruccion en un entorno local; el rollback solo
--   tiene sentido contra una base creada a partir de este mismo fichero.
-- ===========================================================================
