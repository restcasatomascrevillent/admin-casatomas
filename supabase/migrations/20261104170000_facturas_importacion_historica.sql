set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261104170000_facturas_importacion_historica — Importación histórica (04/11/2026)
-- ===========================================================================
-- Las facturas del histórico ya están pasadas a JSON (facturas-conocimiento,
-- INSTRUCCIONES-EXTRACCION.md) y se cargan con su PDF desde el panel
-- (Facturas › Importación histórica) por la Edge Function
-- `importar-factura-historica`, SIN volver a pasar el OCR.
--
-- QUÉ HACE
--   1. facturas.local text NULL ('casa_tomas' | 'touza'): a qué local va
--      dirigida la factura según el destinatario impreso. NULL = no consta
--      (todas las subidas por OCR, de momento). Con índice.
--   2. facturas.import_clave text NULL UNIQUE: clave de la importación
--      («zip2026:R123.pdf#0»). Hace idempotente la importación: si se reanuda
--      o se repite, la función ve que esa clave ya está y no crea otra factura.
--   3. productos_factura: lo que VALE lo recibido aunque venga con descuento o
--      regalado (petición del dueño, 04/11/2026):
--        · descuento_pct numeric NULL: % de descuento impreso en la línea.
--        · importe_bruto numeric NULL: valor antes de descuento
--          (cantidad × precio_unitario). Se rellena aunque el total sea 0
--          (regalo con precio impreso).
--        · importe_bruto_estimado boolean NOT NULL DEFAULT false: true si la
--          línea no traía precio y el bruto sale del precio al que ese
--          proveedor cobró el artículo en otras facturas.
--      El `total` de la línea sigue siendo el impreso (0 si es regalo): estas
--      columnas no cambian ningún total ni el historial de precios.
--
-- Solo añade columnas que admiten NULL o tienen DEFAULT: no toca filas ni
-- triggers existentes. Idempotente (IF NOT EXISTS).
-- ===========================================================================

alter table public.facturas
  add column if not exists local text null,
  add column if not exists import_clave text null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'facturas_local_valido') then
    alter table public.facturas
      add constraint facturas_local_valido check (local is null or local in ('casa_tomas', 'touza'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'facturas_import_clave_unica') then
    alter table public.facturas
      add constraint facturas_import_clave_unica unique (import_clave);
  end if;
end $$;

create index if not exists idx_facturas_local on public.facturas (local);

comment on column public.facturas.local is
  'Local destinatario impreso: casa_tomas | touza. NULL = no consta. Lo rellena la importación histórica.';
comment on column public.facturas.import_clave is
  'Clave de la importación histórica (p. ej. zip2026:R123.pdf#0). UNIQUE: reimportar es seguro.';

alter table public.productos_factura
  add column if not exists descuento_pct numeric null,
  add column if not exists importe_bruto numeric null,
  add column if not exists importe_bruto_estimado boolean not null default false;

comment on column public.productos_factura.descuento_pct is
  '% de descuento impreso en la línea (NULL si no lo hay).';
comment on column public.productos_factura.importe_bruto is
  'Valor antes de descuento = cantidad × precio. Se rellena también en regalos (total 0).';
comment on column public.productos_factura.importe_bruto_estimado is
  'true si importe_bruto sale del precio de referencia del proveedor (la línea no traía precio).';
