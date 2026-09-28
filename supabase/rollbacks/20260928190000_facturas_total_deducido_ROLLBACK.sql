-- Rollback de migrations/20260928190000_facturas_total_deducido.sql
-- NO APLICAR salvo para deshacer esa migracion si ya se aplico.
--
-- ---------------------------------------------------------------------------
-- AVISO 1 -- LA MIGRACION QUE REVIERTE NO ESTA APLICADA (2026-09-28)
-- ---------------------------------------------------------------------------
--   Esta escrita y commiteada, pero no se ha ejecutado ni en produccion ni en
--   local. Ejecutar este rollback hoy no hace nada util: los tres `drop ... if
--   exists` no encuentran nada y el fichero termina sin error y sin efecto.
--
-- ---------------------------------------------------------------------------
-- AVISO 2 -- QUE SE PIERDE (y que no)
-- ---------------------------------------------------------------------------
--   Se pierde SABER QUE TOTALES NO SE LEYERON DEL PAPEL. Los importes en si
--   NO se tocan: `facturas.total` queda exactamente igual antes y despues, y
--   ninguna fila se borra. Lo que desaparece es la etiqueta que los separa.
--
--   Consecuencia practica: un total calculado por `procesar-factura` sumando
--   las lineas (porque el bloque de totales estaba recortado) pasa a ser
--   indistinguible de uno impreso en la factura. Si ese documento llevaba un
--   desglose de IVA que no se veia, el importe guardado es la BASE y se queda
--   ahi, contando como total en gastos, sin nada que lo advierta en la tabla.
--
--   NO se pierde del todo: el aviso `total_deducido` que `procesar-factura`
--   deja en `facturas.alertas_validacion` sobrevive a este rollback (es otra
--   columna y no se toca). Sigue siendo recuperable con:
--
--     select id, numero_documento, proveedor, fecha, total,
--            a ->> 'mensaje'         as aviso,
--            a -> 'detalle' ->> 'metodo' as metodo
--       from public.facturas f,
--            lateral jsonb_array_elements(f.alertas_validacion) a
--      where a ->> 'codigo' = 'total_deducido'
--      order by f.fecha desc;
--
--   Guarda el resultado ANTES de ejecutar esto si piensas volver a aplicar la
--   migracion: el backfill de la migracion marca 'leido' todo lo que tenga
--   total, asi que al reaplicarla las filas deducidas volverian etiquetadas
--   como LEIDAS —que es peor que no tener la columna—. Hay que repasarlas con
--   la consulta de arriba y devolverles el 'deducido' a mano:
--
--     update public.facturas f
--        set total_origen = 'deducido'
--      where exists (
--        select 1 from jsonb_array_elements(f.alertas_validacion) a
--         where a ->> 'codigo' = 'total_deducido'
--      );
--
-- ---------------------------------------------------------------------------
-- AVISO 3 -- ORDEN CON EL FRONTEND Y CON LA EDGE FUNCTION
-- ---------------------------------------------------------------------------
--   `supabase/functions/procesar-factura/index.ts` ESCRIBE `total_origen` en
--   su insert, y `src/hooks/useFacturas.ts` la pide por nombre en su
--   `.select(...)`. Si se borra la columna sin revertir antes esos dos:
--     · cada subida de documento falla con
--       `column "total_origen" of relation "facturas" does not exist`
--       (PGRST204) -- y el frontend lo pinta como `{success:false}`, asi que
--       parece que no se guardo nada;
--     · la pantalla de facturas falla al cargar con un 42703 de PostgREST.
--   Revertir PRIMERO el codigo (o redesplegar la edge function sin ese
--   campo), y solo DESPUES ejecutar esto.
--
--   No toca `subtotal`, ni `iva`, ni `alertas_validacion`, ni
--   `productos_factura`, ni ninguna politica RLS, funcion, vista o trigger.

begin;

drop index if exists public.idx_facturas_total_deducido;

alter table public.facturas
  drop constraint if exists facturas_total_deducido_exige_total;
alter table public.facturas
  drop constraint if exists facturas_total_origen_valido;

alter table public.facturas
  drop column if exists total_origen;

commit;
