set client_encoding = 'UTF8';
-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261005120000_ocr_trabajos_multipagina.sql
-- ===========================================================================
-- No es una migración (ver supabase/rollbacks/README.md). Se ejecuta A MANO:
--   npx supabase db query --linked -f supabase/rollbacks/20261005120000_ocr_trabajos_multipagina_ROLLBACK.sql
--
-- ANTES: volver a desplegar la versión anterior de procesar-factura (la que no
-- escribe pagina/orden/albaran_ref ni paginas/ocr_trabajo_id) y retirar
-- ocr-trabajo; si no, las subidas fallan con «column … does not exist».
-- (procesar-factura nueva reintenta sin esas columnas, pero ocr-trabajo no.)
--
-- Qué hace:
--   · Quita el cron «reanudar-trabajos-ocr» y las 10 funciones ocr_*.
--   · Quita la política de Storage facturas_originales_pendientes_insert. Los
--     ficheros ya subidos bajo pendientes/ NO se borran (SQL no puede borrar
--     objetos de Storage; limpiarlos desde el panel de Supabase si se quiere).
--   · Quita ocr_trabajos y ocr_trabajo_paginas (se pierde el historial de
--     trabajos: solo trazabilidad, ningún dato contable).
--   · Quita las columnas nuevas de facturas y productos_factura. SE PIERDE el
--     orden y el albarán de origen de las líneas (las líneas en sí se quedan).
--   · facturas_sustituciones (las copias de las facturas sustituidas) SE
--     CONSERVA a propósito: es lo único que permite deshacer una sustitución.
--     Su FK a ocr_trabajos se quita con la tabla. Si de verdad se quiere
--     borrar, descomentar el DROP del final.
--   · NO deshace las sustituciones hechas (las facturas 39/54 se quedan con
--     los datos nuevos). Para restaurar una a mano: ver la consulta comentada
--     al final.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

select cron.unschedule('reanudar-trabajos-ocr')
 where exists (select 1 from cron.job where jobname = 'reanudar-trabajos-ocr');

drop function if exists public.reanudar_trabajos_ocr();
drop function if exists public.ocr_despachar(uuid);
drop function if exists public.ocr_reclamar_pagina(bigint, integer);
drop function if exists public.ocr_cerrar_pagina(bigint, jsonb, jsonb, jsonb, jsonb, integer, integer, integer, integer, integer, integer, numeric, jsonb, text);
drop function if exists public.ocr_fallo_pagina(bigint, text);
drop function if exists public.ocr_reclamar_consolidacion(uuid, integer);
drop function if exists public.ocr_pedir_relectura(uuid, jsonb);
drop function if exists public.ocr_terminar_trabajo(uuid, text, jsonb, bigint, text, jsonb);
drop function if exists public.ocr_factura_existente(text, text, text, date, numeric);
drop function if exists public.ocr_sustituir_factura(bigint, uuid, uuid, jsonb, jsonb, jsonb, text);

drop policy if exists facturas_originales_pendientes_insert on storage.objects;

alter table public.facturas drop constraint if exists facturas_ocr_trabajo_unico;
alter table public.facturas drop constraint if exists facturas_ocr_trabajo_fk;
alter table public.facturas_sustituciones drop constraint if exists facturas_sustituciones_trabajo_id_fkey;

drop table if exists public.ocr_trabajo_paginas;
drop table if exists public.ocr_trabajos;

drop index if exists public.productos_factura_factura_orden_idx;
alter table public.productos_factura
  drop constraint if exists productos_factura_pagina_rango,
  drop constraint if exists productos_factura_orden_pos,
  drop column if exists pagina,
  drop column if exists orden,
  drop column if exists albaran_ref;
alter table public.facturas
  drop constraint if exists facturas_paginas_rango,
  drop column if exists paginas,
  drop column if exists ocr_trabajo_id;

-- drop table if exists public.facturas_sustituciones;   -- ver la cabecera

commit;

select 'ocr_trabajos_multipagina: revertida' as resultado,
       to_regclass('public.ocr_trabajos') is null as sin_tablas,
       (select count(*) from cron.job where jobname = 'reanudar-trabajos-ocr') = 0 as sin_cron,
       to_regclass('public.facturas_sustituciones') is not null as copias_conservadas;

-- Restaurar A MANO la cabecera de una factura sustituida (ejemplo, id 54),
-- desde su copia más reciente. Las líneas se restauran igual desde
-- productos_antes (sin embedding: habría que regenerarlo) y el historial desde
-- historial_antes. Revisar antes de ejecutar:
--   select id, sustituida_at, resumen_antes, resumen_despues
--     from public.facturas_sustituciones where factura_id = 54 order by id desc;
