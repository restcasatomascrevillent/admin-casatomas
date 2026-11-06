set client_encoding = 'UTF8';
-- ============================================================================
-- Relleno de facturas.retencion_irpf del histórico importado (06/11/2026)
-- ----------------------------------------------------------------------------
-- Generado con scripts/facturas/generar-relleno-retencion.mjs desde los JSON de
-- facturas-conocimiento/importar (42 facturas con retención). Casa por
-- facturas.import_clave. NO es una migración: se ejecuta a mano en la demo y,
-- en producción, DESPUÉS de la importación histórica y de 20261106300000.
--   supabase db query --linked -f supabase/snippets/2026-11-06_retencion_irpf_historico.sql
-- Es repetible: no toca las que ya tienen la retención, ni las que no cuadran
-- (base + IVA − retención ≠ total, ±0,05 €), que salen en la lista final.
-- El signo sigue al total (negativa en un abono). Después recalcula sus avisos
-- (se va el «iva_incoherente»).
-- ============================================================================
begin;

create temp table _retencion_historico (import_clave text primary key, retencion numeric(12,2), pct numeric(5,2))
  on commit drop;
insert into _retencion_historico (import_clave, retencion, pct) values
  ('zip2026:R22.pdf#0', 142.50, 19.00),  -- 2026-01-01 VICENTE BAILÉN MOROTE
  ('zip2026:R23.pdf#0', 209.00, 19.00),  -- 2026-01-01 SALVADOR MAS MAS
  ('zip2026:R18.pdf#0', 63.80, 19.00),  -- 2026-01-02 ALFONSO BERNAL MESTRE
  ('zip2026:R21.pdf#0', 164.64, 19.00),  -- 2026-01-02 CREVIGEST, S.L.
  ('zip2026:R110.pdf#0', 209.00, 19.00),  -- 2026-02-01 SALVADOR MAS MAS
  ('zip2026:R111.pdf#0', 142.50, 19.00),  -- 2026-02-01 VICENTE BAILÉN MOROTE
  ('zip2026:R113.pdf#0', 161.06, 19.00),  -- 2026-02-02 CREVIGEST, S.L.
  ('zip2026:R143.pdf#0', 65.65, 19.00),  -- 2026-02-02 ALFONSO BERNAL MESTRE
  ('zip2026:R282.pdf#0', 209.00, 19.00),  -- 2026-03-01 SALVADOR MAS MAS
  ('zip2026:R283.pdf#0', 142.50, 19.00),  -- 2026-03-01 VICENTE BAILÉN MOROTE
  ('zip2026:R281.pdf#0', 65.65, 19.00),  -- 2026-03-02 ALFONSO BERNAL MESTRE
  ('zip2026:R300.pdf#0', 154.39, 19.00),  -- 2026-03-02 CREVIGEST, S.L.
  ('zip2026:R517.pdf#0', 65.65, 19.00),  -- 2026-04-01 Alfonso Bernal Mestre
  ('zip2026:R528.pdf#0', 142.50, 19.00),  -- 2026-04-01 VICENTE BAILÉN MOROTE
  ('zip2026:R529.pdf#0', 209.00, 19.00),  -- 2026-04-01 SALVADOR MAS MAS
  ('zip2026:R519.pdf#0', 153.83, 19.00),  -- 2026-04-02 CREVIGEST, S.L.
  ('zip2026:R617.pdf#0', 65.65, 19.00),  -- 2026-05-01 ALFONSO BERNAL MESTRE
  ('zip2026:R618.pdf#0', 142.50, 19.00),  -- 2026-05-01 VICENTE BAILÉN MOROTE
  ('zip2026:R619.pdf#0', 209.00, 19.00),  -- 2026-05-01 SALVADOR MAS MAS
  ('zip2026:R630.pdf#0', 161.19, 19.00),  -- 2026-05-02 CREVIGEST, S.L.
  ('zip2026:R759.pdf#0', 27.63, 15.00),  -- 2026-05-25 MARÍA EUGENIA ALONSO ROCAMORA (notaria)
  ('zip2026:R781.pdf#0', 65.65, 19.00),  -- 2026-06-01 ALFONSO BERNAL MESTRE
  ('zip2026:R782.pdf#0', 142.50, 19.00),  -- 2026-06-01 VICENTE BAILÉN MOROTE
  ('zip2026:R783.pdf#0', 209.00, 19.00),  -- 2026-06-01 SALVADOR MAS MAS
  ('zip2026:R814.pdf#0', 153.53, 19.00),  -- 2026-06-02 CREVIGEST, S.L.
  ('zip2026:R1052.pdf#0', 65.65, 19.00),  -- 2026-07-01 ALFONSO BERNAL MESTRE
  ('zip2026:R1085.pdf#0', 209.00, 19.00),  -- 2026-07-01 SALVADOR MAS MAS
  ('zip2026:R1086.pdf#0', 142.50, 19.00),  -- 2026-07-01 VICENTE BAILÉN MOROTE
  ('zip2026:R1108.pdf#0', 158.17, 19.00),  -- 2026-07-02 CREVIGEST, S.L.
  ('zip2026:R1199.pdf#0', 209.00, 19.00),  -- 2026-08-01 SALVADOR MAS MAS
  ('zip2026:R1201.pdf#0', 142.50, 19.00),  -- 2026-08-01 VICENTE BAILÉN MOROTE
  ('zip2026:R1213.pdf#0', 65.65, 19.00),  -- 2026-08-01 ALFONSO BERNAL MESTRE
  ('zip2026:R1202.pdf#0', 176.00, 19.00),  -- 2026-08-02 CREVIGEST, S.L.
  ('zip2026:R1383.pdf#0', 8.17, 15.00),  -- 2026-08-18 REGISTRO MERCANTIL DE ALICANTE SC
  ('zip2026:R1395.pdf#0', 209.00, 19.00),  -- 2026-09-01 SALVADOR MAS MAS
  ('zip2026:R1396.pdf#0', 142.50, 19.00),  -- 2026-09-01 VICENTE BAILÉN MOROTE
  ('zip2026:R1401.pdf#0', 65.65, 19.00),  -- 2026-09-01 Alfonso Bernal Mestre
  ('zip2026:R1397.pdf#0', 195.90, 19.00),  -- 2026-09-02 CREVIGEST, S.L.
  ('zip2026:R1656.pdf#0', 65.65, 19.00),  -- 2026-10-01 ALFONSO BERNAL MESTRE
  ('zip2026:R1659.pdf#0', 209.00, 19.00),  -- 2026-10-01 SALVADOR MAS MAS
  ('zip2026:R1661.pdf#0', 142.50, 19.00),  -- 2026-10-01 VICENTE BAILÉN MOROTE
  ('zip2026:R1663.pdf#0', 235.93, 19.00)  -- 2026-10-02 CREVIGEST, S.L.
;

create temp table _retencion_aplicada on commit drop as
with upd as (
  update public.facturas f
     set retencion_irpf = case when f.total < 0 then -r.retencion else r.retencion end,
         retencion_irpf_pct = r.pct
    from _retencion_historico r
   where f.import_clave = r.import_clave
     and f.retencion_irpf is null
     and (f.subtotal is null or f.iva is null or f.total is null
          or abs(abs(f.subtotal + f.iva - f.total) - r.retencion) <= 0.05)
  returning f.id
)
select id from upd;

select public.recalcular_alertas_factura(a.id) from _retencion_aplicada a;

-- Resumen: aplicadas ahora, ya tenían, no encontradas y no cuadran.
select 'aplicadas' as estado, count(*) as n from _retencion_aplicada
union all
select 'con retención (total)', count(*) from public.facturas f join _retencion_historico r using (import_clave)
 where f.retencion_irpf is not null
union all
select 'clave no encontrada', count(*) from _retencion_historico r
 where not exists (select 1 from public.facturas f where f.import_clave = r.import_clave)
union all
select 'no cuadra (revisar): ' || string_agg(r.import_clave, ', '), count(*)
  from _retencion_historico r join public.facturas f using (import_clave)
 where f.retencion_irpf is null;

commit;
