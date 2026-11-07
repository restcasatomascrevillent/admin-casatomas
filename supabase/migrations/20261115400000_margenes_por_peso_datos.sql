set client_encoding = 'UTF8';
-- ============================================================================
-- 20261115400000_margenes_por_peso_datos — Revisión del producto de compra de
-- los artículos que se venden AL PESO (07/11/2026)
-- ----------------------------------------------------------------------------
-- Para «Márgenes de carta › Por peso» se revisaron los 36 platos activos de
-- Casa Tomás con unidad de peso (100 g, kg, 50 g, 30 g, 10 g) frente a las
-- líneas de compra de su producto (calibre y variedad). Correcciones:
--   1. «Chuletón ternera» (70 €/kg) estaba con «Lomo de vaca con hueso»
--      (2251, 34 €/kg, el lomo de VACA de Embajadores). El chuletón de ternera
--      sale del «Lomo de ternera» con hueso (300: LOMO TERNERA C/H, Embajadores y
--      Central de Carnes Madrid Norte, ~21 €/kg).
--   2. «Calamar Bahía plancha» (70 €/kg) estaba con «Calamar» (221), cuyas
--      compras son calamar CONGELADO de Marruecos (2P/3P, lanzal) a 9-10 €/kg:
--      no es calamar de bahía fresco. Se quita y queda «sin datos» con el motivo.
-- El resto está bien mapeado (gamba roja N1 de Alicante, carabinero, cigala,
-- percebe gallego, caviar Oscietra por lata del mismo tamaño…).
--
-- IDEMPOTENTE y no pisa lo corregido a mano: solo toca filas con origen
-- 'estimado' y artículos no revisados.
-- Rollback: supabase/rollbacks/20261115400000_margenes_por_peso_datos_ROLLBACK.sql
-- ============================================================================

-- 1. Chuletón ternera → Lomo de ternera (con hueso).
update public.escandallo_platos e
   set producto_id = 300,
       nota = 'se vende al peso: 1 kg de lomo de ternera con hueso (antes: lomo de vaca, 20261115400000)',
       updated_at = now()
 where e.plato_id = '111e2e2d-5357-47c2-baf2-3e7a72ea4579'
   and e.producto_id = 2251
   and e.origen = 'estimado'
   and exists (select 1 from public.productos_catalogo where id = 300)
   and not exists (select 1 from public.escandallo_platos x where x.plato_id = e.plato_id and x.producto_id = 300);

-- 2. Calamar Bahía plancha: sin producto de compra (solo hay calamar congelado).
delete from public.escandallo_platos e
 where e.plato_id = '3bc24b89-c7d7-40fd-a126-86fe704563e3'
   and e.producto_id = 221
   and e.origen = 'estimado';

insert into public.margenes_carta_revision (tipo, articulo_id, sin_mapear_motivo)
select 'plato', p.id,
       'No hay compras de calamar de bahía fresco: las de «Calamar» son congelado de Marruecos/patagónico (9-11 €/kg)'
  from public."Platos" p
 where p.id = '3bc24b89-c7d7-40fd-a126-86fe704563e3'
   and not exists (select 1 from public.escandallo_platos e where e.plato_id = p.id)
on conflict (tipo, articulo_id) do update
  set sin_mapear_motivo = excluded.sin_mapear_motivo, updated_at = now()
  where not public.margenes_carta_revision.revisado;

select 'margenes_por_peso_datos: chuletón ternera → '
       || coalesce((select string_agg(producto_id::text, ',') from public.escandallo_platos where plato_id = '111e2e2d-5357-47c2-baf2-3e7a72ea4579'), 'nada')
       || '; calamar bahía → '
       || coalesce((select sin_mapear_motivo from public.margenes_carta_revision where tipo = 'plato' and articulo_id = '3bc24b89-c7d7-40fd-a126-86fe704563e3'), 'sin motivo')
       as resultado;
