set client_encoding = 'UTF8';
-- ===========================================================================
-- Restricciones en Bebidas y Cocteles (2/3) · tarea 40b3221d · 2026-11-02
-- ===========================================================================
--
-- PROBLEMA (revisión QA, A de la PO): la API aceptaba en "Bebidas" y
-- "Cocteles" datos imposibles que el panel nunca manda: nombre vacío, precio
-- negativo, infinito o NaN, categoría vacía, alérgenos que no son una lista
-- de textos, imagen_url que no es https y textos sin límite.
--
-- VA DESPUÉS DE 20261101220000_restricciones_platos_vinos.sql (1/3): usa su
-- función public.alergenos_bien_formados(jsonb). Si no existe, se cancela.
-- Sigue la PLANTILLA de 20261101180000_restricciones_novedades_espacios.sql
-- (3/3): NOT VALID → recuento con RAISE → VALIDATE, todo en una transacción.
--
-- REGLAS (las dos tablas)
--   *_nombre_valido     NOT NULL, algún carácter que no sea espacio, ≤ 150
--   *_categoria_valida  NOT NULL, algún carácter que no sea espacio, ≤ 100
--   *_precio_valido     NOT NULL, 0 ≤ precio ≤ 9999.99. NaN e ±Infinity no
--                       pasan: en Postgres NaN es mayor que cualquier número.
--   *_imagen_url_https  NULL o 'https://…' sin espacios, ≤ 2048
--   *_textos_maximos    máximos del resto de textos (tabla de abajo)
-- Solo "Cocteles":
--   cocteles_alergenos_validos  public.alergenos_bien_formados(alergenos_oficiales):
--                       NULL o array JSON de textos no vacíos de ≤ 100.
-- "Bebidas" no tiene columna de alérgenos.
--
-- MÁXIMOS (los mismos que LIMITES_CARTA en src/lib/limites-carta.ts; la
-- prueba PGlite los compara). Entre paréntesis, el más largo en la demo el
-- 01/11/2026. Suposiciones de la tarea, que Pablo puede cambiar: nombre 150,
-- descripción 2.000, precio 0–9.999,99.
--   nombre, nombre_en, nombre_fr ................ 150  (45)
--   categoria, categoria_en, categoria_fr ........ 100  (17)
--   descripcion, descripcion_en, descripcion_fr .. 2000 (105)
--   tamano (Bebidas) .............................  30  (4)
--   tipo (Bebidas) ............................... 100  (22)
--   tag (Bebidas) ................................  50  (11)
--   base (Cocteles) .............................. 100  (11)
--   ingredientes, ingredientes_en/_fr (Cocteles) . 2000 (91)
--   preparacion (Cocteles) ....................... 2000 (vacío)
--   alergenos_notas (Cocteles) ...................  500 (vacío)
--
-- DECISIONES
--   · Precio 0 se admite en la BD: que 0 € no valga lo exige el formulario
--     («Exigir precio válido en vinos y bebidas»).
--   · Precio NULL se rechaza: el panel siempre lo manda y la web imprimiría
--     «null €».
--   · «Solo espacios» con [[:space:]] (también tabuladores y saltos de línea).
--
-- Filas que incumplen (ejecutar ANTES de aplicar; en producción se le pasa el
-- resultado a Pablo antes de su «sí»):
--   select 'Bebidas' tabla, id, nombre from public."Bebidas"
--    where not coalesce(nombre ~ '[^[:space:]]' and char_length(nombre) <= 150, false)
--       or not coalesce(categoria ~ '[^[:space:]]' and char_length(categoria) <= 100, false)
--       or not coalesce(precio_eur >= 0 and precio_eur <= 9999.99, false)
--       or not (imagen_url is null or (imagen_url ~ '^https://[^[:space:]]+$' and char_length(imagen_url) <= 2048))
--       or greatest(char_length(descripcion), char_length(descripcion_en), char_length(descripcion_fr)) > 2000
--       or greatest(char_length(nombre_en), char_length(nombre_fr)) > 150
--       or greatest(char_length(categoria_en), char_length(categoria_fr), char_length(tipo)) > 100
--       or char_length(tamano) > 30 or char_length(tag) > 50
--   union all
--   select 'Cocteles', id, nombre from public."Cocteles"
--    where not coalesce(nombre ~ '[^[:space:]]' and char_length(nombre) <= 150, false)
--       or not coalesce(categoria ~ '[^[:space:]]' and char_length(categoria) <= 100, false)
--       or not coalesce(precio_eur >= 0 and precio_eur <= 9999.99, false)
--       or not (imagen_url is null or (imagen_url ~ '^https://[^[:space:]]+$' and char_length(imagen_url) <= 2048))
--       or not public.alergenos_bien_formados(alergenos_oficiales)
--       or greatest(char_length(descripcion), char_length(descripcion_en), char_length(descripcion_fr),
--                   char_length(ingredientes), char_length(ingredientes_en), char_length(ingredientes_fr),
--                   char_length(preparacion)) > 2000
--       or greatest(char_length(nombre_en), char_length(nombre_fr)) > 150
--       or greatest(char_length(categoria_en), char_length(categoria_fr), char_length(base)) > 100
--       or char_length(alergenos_notas) > 500;
-- Demo (sfonaclosuafvlhutkon) y producción (haqmmdfdzzatdnrrcgez), solo
-- lectura, 01-11-2026: 0 filas.
--
-- Las funciones que escriben en estas tablas no se ven afectadas:
-- traducir-contenido solo escribe *_en/*_fr (muy por debajo de los máximos);
-- rebuild-webs y chat-web solo leen.
--
-- Idempotente (DROP IF EXISTS + ADD). Rollback:
--   supabase/rollbacks/20261102120000_restricciones_bebidas_cocteles_ROLLBACK.sql
-- ===========================================================================

begin;

-- 0. Requisito: la función de alérgenos de la 1/3 ---------------------------
do $$
begin
  if to_regprocedure('public.alergenos_bien_formados(jsonb)') is null then
    raise exception 'Falta public.alergenos_bien_formados(jsonb): aplica antes 20261101220000_restricciones_platos_vinos.sql.';
  end if;
end $$;

-- 1. Reglas NOT VALID -------------------------------------------------------
-- Bebidas
alter table public."Bebidas" drop constraint if exists bebidas_nombre_valido;
alter table public."Bebidas" add constraint bebidas_nombre_valido
  check (nombre is not null and nombre ~ '[^[:space:]]' and char_length(nombre) <= 150) not valid;

alter table public."Bebidas" drop constraint if exists bebidas_categoria_valida;
alter table public."Bebidas" add constraint bebidas_categoria_valida
  check (categoria is not null and categoria ~ '[^[:space:]]' and char_length(categoria) <= 100) not valid;

alter table public."Bebidas" drop constraint if exists bebidas_precio_valido;
alter table public."Bebidas" add constraint bebidas_precio_valido
  check (precio_eur is not null and precio_eur >= 0 and precio_eur <= 9999.99) not valid;

alter table public."Bebidas" drop constraint if exists bebidas_imagen_url_https;
alter table public."Bebidas" add constraint bebidas_imagen_url_https
  check (imagen_url is null or (imagen_url ~ '^https://[^[:space:]]+$' and char_length(imagen_url) <= 2048)) not valid;

alter table public."Bebidas" drop constraint if exists bebidas_textos_maximos;
alter table public."Bebidas" add constraint bebidas_textos_maximos
  check (coalesce(char_length(descripcion), 0)    <= 2000
     and coalesce(char_length(descripcion_en), 0) <= 2000
     and coalesce(char_length(descripcion_fr), 0) <= 2000
     and coalesce(char_length(nombre_en), 0)      <= 150
     and coalesce(char_length(nombre_fr), 0)      <= 150
     and coalesce(char_length(categoria_en), 0)   <= 100
     and coalesce(char_length(categoria_fr), 0)   <= 100
     and coalesce(char_length(tamano), 0)         <= 30
     and coalesce(char_length(tipo), 0)           <= 100
     and coalesce(char_length(tag), 0)            <= 50) not valid;

-- Cocteles
alter table public."Cocteles" drop constraint if exists cocteles_nombre_valido;
alter table public."Cocteles" add constraint cocteles_nombre_valido
  check (nombre is not null and nombre ~ '[^[:space:]]' and char_length(nombre) <= 150) not valid;

alter table public."Cocteles" drop constraint if exists cocteles_categoria_valida;
alter table public."Cocteles" add constraint cocteles_categoria_valida
  check (categoria is not null and categoria ~ '[^[:space:]]' and char_length(categoria) <= 100) not valid;

alter table public."Cocteles" drop constraint if exists cocteles_precio_valido;
alter table public."Cocteles" add constraint cocteles_precio_valido
  check (precio_eur is not null and precio_eur >= 0 and precio_eur <= 9999.99) not valid;

alter table public."Cocteles" drop constraint if exists cocteles_imagen_url_https;
alter table public."Cocteles" add constraint cocteles_imagen_url_https
  check (imagen_url is null or (imagen_url ~ '^https://[^[:space:]]+$' and char_length(imagen_url) <= 2048)) not valid;

alter table public."Cocteles" drop constraint if exists cocteles_alergenos_validos;
alter table public."Cocteles" add constraint cocteles_alergenos_validos
  check (public.alergenos_bien_formados(alergenos_oficiales)) not valid;

alter table public."Cocteles" drop constraint if exists cocteles_textos_maximos;
alter table public."Cocteles" add constraint cocteles_textos_maximos
  check (coalesce(char_length(descripcion), 0)     <= 2000
     and coalesce(char_length(descripcion_en), 0)  <= 2000
     and coalesce(char_length(descripcion_fr), 0)  <= 2000
     and coalesce(char_length(nombre_en), 0)       <= 150
     and coalesce(char_length(nombre_fr), 0)       <= 150
     and coalesce(char_length(categoria_en), 0)    <= 100
     and coalesce(char_length(categoria_fr), 0)    <= 100
     and coalesce(char_length(ingredientes), 0)    <= 2000
     and coalesce(char_length(ingredientes_en), 0) <= 2000
     and coalesce(char_length(ingredientes_fr), 0) <= 2000
     and coalesce(char_length(preparacion), 0)     <= 2000
     and coalesce(char_length(alergenos_notas), 0) <= 500
     and coalesce(char_length(base), 0)            <= 100) not valid;

-- 2. Filas que incumplen: si hay, se cancela todo con un mensaje claro --------
do $$
declare
  r record;
  incumplen int;
  resumen text := '';
begin
  for r in
    select c.conrelid::regclass::text as tabla, c.conname
      from pg_constraint c
     where c.conrelid in ('public."Bebidas"'::regclass, 'public."Cocteles"'::regclass)
       and c.conname in ('bebidas_nombre_valido', 'bebidas_categoria_valida', 'bebidas_precio_valido',
                         'bebidas_imagen_url_https', 'bebidas_textos_maximos',
                         'cocteles_nombre_valido', 'cocteles_categoria_valida', 'cocteles_precio_valido',
                         'cocteles_imagen_url_https', 'cocteles_alergenos_validos', 'cocteles_textos_maximos')
     order by 1, 2
  loop
    execute format('select count(*) from %s where not coalesce(%s, true)', r.tabla,
      (select regexp_replace(pg_get_constraintdef(oid), '^CHECK \((.*)\)( NOT VALID)?$', '\1')
         from pg_constraint where conname = r.conname and conrelid = r.tabla::regclass))
      into incumplen;
    if incumplen > 0 then
      resumen := resumen || format(E'\n  %s.%s: %s fila(s)', r.tabla, r.conname, incumplen);
    end if;
  end loop;
  if resumen <> '' then
    raise exception 'Hay filas que incumplen las nuevas restricciones; corrígelas y vuelve a aplicar la migración:%', resumen
      using hint = 'La consulta para listarlas está en la cabecera de 20261102120000_restricciones_bebidas_cocteles.sql.';
  end if;
end $$;

-- 3. VALIDATE ---------------------------------------------------------------
alter table public."Bebidas"  validate constraint bebidas_nombre_valido;
alter table public."Bebidas"  validate constraint bebidas_categoria_valida;
alter table public."Bebidas"  validate constraint bebidas_precio_valido;
alter table public."Bebidas"  validate constraint bebidas_imagen_url_https;
alter table public."Bebidas"  validate constraint bebidas_textos_maximos;
alter table public."Cocteles" validate constraint cocteles_nombre_valido;
alter table public."Cocteles" validate constraint cocteles_categoria_valida;
alter table public."Cocteles" validate constraint cocteles_precio_valido;
alter table public."Cocteles" validate constraint cocteles_imagen_url_https;
alter table public."Cocteles" validate constraint cocteles_alergenos_validos;
alter table public."Cocteles" validate constraint cocteles_textos_maximos;

commit;
