-- Prueba de 20261026120000_ia_precios_replicate_fondo.sql: BEGIN … ROLLBACK, no deja nada.
begin;
set local lock_timeout = '5s';
insert into public.ia_precios
  (modelo, usd_por_m_input, usd_por_m_cached, usd_por_m_cache_write, usd_por_m_output, notas, fuente, verificado_en)
values
  ('replicate:men1scus/birefnet', 3.300000, null, null, 0.000000, 'test', 'test', null)
on conflict (modelo) do nothing;
do $$
declare v numeric;
begin
  select usd_por_m_input * 1000 / 1e6 into v from public.ia_precios where modelo = 'replicate:men1scus/birefnet';
  if v is null or abs(v - 0.0033) > 0.0001 then
    raise exception 'Coste por foto inesperado: %', v;
  end if;
  raise notice 'OK: % $/foto', v;
end $$;
rollback;
