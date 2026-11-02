set client_encoding = 'UTF8';
-- ===========================================================================
-- Restricciones en Novedades y espacios_reserva (3/3) · 2026-11-01
-- ===========================================================================
--
-- PROBLEMA (revisión QA, A de la PO): la API aceptaba datos imposibles en
-- `novedades` y `espacios_reserva` (título vacío, «hasta» antes de «desde»,
-- capacidad negativa, nombre vacío, textos sin límite). El panel ya lo evitaba,
-- pero cualquier llamada directa a PostgREST con un token válido no.
--
-- DECISIÓN: CHECK en la BD con los mismos máximos que los formularios del
-- panel (src/lib/limites-textos.ts). Máximos (suposición de la tarea; Pablo
-- puede cambiarlos): nombre/título 150, descripción 2.000, etiqueta 40.
--
--   novedades
--     · titulo: 1–150 caracteres y no solo espacios.
--     · titulo_en/_fr: hasta 150.  descripcion(+_en/_fr): hasta 2.000.
--     · badge_text(+_en/_fr): hasta 40.
--     · fecha_fin IS NULL OR fecha_fin >= fecha_inicio.
--   espacios_reserva
--     · nombre: 1–150 caracteres y no solo espacios.  descripcion: hasta 2.000.
--     · capacidad_maxima >= 0.
--
-- PLANTILLA para las migraciones con datos de esta tanda (la siguen
-- «Restricciones en Bebidas y Cocteles (2/3)» y «… Platos y Vinos (1/3)»):
--   1. ADD CONSTRAINT … NOT VALID: desde ya rechaza filas nuevas o editadas,
--      sin mirar las que ya hay.
--   2. Se cuentan las filas que incumplen. Si hay alguna, la migración ENTERA
--      se cancela (RAISE) diciendo cuántas y de qué regla: nada queda a medias.
--      Se corrigen con la consulta de abajo y se vuelve a aplicar.
--   3. VALIDATE CONSTRAINT: comprueba las filas viejas y deja la regla firme.
--
-- Filas que incumplen (ejecutar ANTES de aplicar; en producción se le pasa el
-- resultado a Pablo antes de su «sí»):
--   select 'novedades' tabla, id::text, titulo nombre from public.novedades
--    where titulo !~ '\S' or char_length(titulo) > 150
--       or char_length(titulo_en) > 150 or char_length(titulo_fr) > 150
--       or char_length(descripcion) > 2000 or char_length(descripcion_en) > 2000
--       or char_length(descripcion_fr) > 2000
--       or char_length(badge_text) > 40 or char_length(badge_text_en) > 40
--       or char_length(badge_text_fr) > 40
--       or fecha_fin < fecha_inicio
--   union all
--   select 'espacios_reserva', id::text, nombre from public.espacios_reserva
--    where nombre !~ '\S' or char_length(nombre) > 150
--       or char_length(descripcion) > 2000 or capacidad_maxima < 0;
-- Demo (sfonaclosuafvlhutkon) el 01-11-2026: 0 filas.
--
-- Las funciones que escriben en estas tablas (traducir-contenido solo
-- devuelve texto; format-novedad no escribe en la BD; reservas-web y
-- emails-reserva solo leen espacios_reserva) no se ven afectadas.
--
-- Idempotente (DROP IF EXISTS + ADD). Rollback:
--   supabase/rollbacks/20261101180000_restricciones_novedades_espacios_ROLLBACK.sql
-- ===========================================================================

begin;

-- 1. Reglas NOT VALID -------------------------------------------------------
alter table public.novedades drop constraint if exists novedades_titulo_valido;
alter table public.novedades add constraint novedades_titulo_valido
  check (titulo ~ '\S' and char_length(titulo) <= 150) not valid;

alter table public.novedades drop constraint if exists novedades_titulos_traducidos_longitud;
alter table public.novedades add constraint novedades_titulos_traducidos_longitud
  check (coalesce(char_length(titulo_en), 0) <= 150 and coalesce(char_length(titulo_fr), 0) <= 150) not valid;

alter table public.novedades drop constraint if exists novedades_descripciones_longitud;
alter table public.novedades add constraint novedades_descripciones_longitud
  check (coalesce(char_length(descripcion), 0) <= 2000
     and coalesce(char_length(descripcion_en), 0) <= 2000
     and coalesce(char_length(descripcion_fr), 0) <= 2000) not valid;

alter table public.novedades drop constraint if exists novedades_etiquetas_longitud;
alter table public.novedades add constraint novedades_etiquetas_longitud
  check (coalesce(char_length(badge_text), 0) <= 40
     and coalesce(char_length(badge_text_en), 0) <= 40
     and coalesce(char_length(badge_text_fr), 0) <= 40) not valid;

alter table public.novedades drop constraint if exists novedades_fechas_en_orden;
alter table public.novedades add constraint novedades_fechas_en_orden
  check (fecha_fin is null or fecha_fin >= fecha_inicio) not valid;

alter table public.espacios_reserva drop constraint if exists espacios_reserva_nombre_valido;
alter table public.espacios_reserva add constraint espacios_reserva_nombre_valido
  check (nombre ~ '\S' and char_length(nombre) <= 150) not valid;

alter table public.espacios_reserva drop constraint if exists espacios_reserva_descripcion_longitud;
alter table public.espacios_reserva add constraint espacios_reserva_descripcion_longitud
  check (coalesce(char_length(descripcion), 0) <= 2000) not valid;

alter table public.espacios_reserva drop constraint if exists espacios_reserva_capacidad_no_negativa;
alter table public.espacios_reserva add constraint espacios_reserva_capacidad_no_negativa
  check (capacidad_maxima >= 0) not valid;

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
     where c.conrelid in ('public.novedades'::regclass, 'public.espacios_reserva'::regclass)
       and c.conname in ('novedades_titulo_valido', 'novedades_titulos_traducidos_longitud',
                         'novedades_descripciones_longitud', 'novedades_etiquetas_longitud',
                         'novedades_fechas_en_orden', 'espacios_reserva_nombre_valido',
                         'espacios_reserva_descripcion_longitud', 'espacios_reserva_capacidad_no_negativa')
     order by 1, 2
  loop
    execute format('select count(*) from %s where not (%s)', r.tabla,
      (select regexp_replace(pg_get_constraintdef(oid), '^CHECK \((.*)\)( NOT VALID)?$', '\1')
         from pg_constraint where conname = r.conname and conrelid = r.tabla::regclass))
      into incumplen;
    if incumplen > 0 then
      resumen := resumen || format(E'\n  %s.%s: %s fila(s)', r.tabla, r.conname, incumplen);
    end if;
  end loop;
  if resumen <> '' then
    raise exception 'Hay filas que incumplen las nuevas restricciones; corrígelas y vuelve a aplicar la migración:%', resumen
      using hint = 'La consulta para listarlas está en la cabecera de 20261101180000_restricciones_novedades_espacios.sql.';
  end if;
end $$;

-- 3. VALIDATE ---------------------------------------------------------------
alter table public.novedades validate constraint novedades_titulo_valido;
alter table public.novedades validate constraint novedades_titulos_traducidos_longitud;
alter table public.novedades validate constraint novedades_descripciones_longitud;
alter table public.novedades validate constraint novedades_etiquetas_longitud;
alter table public.novedades validate constraint novedades_fechas_en_orden;
alter table public.espacios_reserva validate constraint espacios_reserva_nombre_valido;
alter table public.espacios_reserva validate constraint espacios_reserva_descripcion_longitud;
alter table public.espacios_reserva validate constraint espacios_reserva_capacidad_no_negativa;

commit;
