set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261129143100_ia_tarifas_sin_coste — IA: las llamadas de un modelo sin
-- tarifa ya no se quedan «sin coste» para siempre
-- ===========================================================================
-- Encargo del dueño (13/11/2026, «Pasos para saber el precio de todos los
-- servicios y de las IAs», paso 3): detectar y arreglar las funciones que
-- registran llamadas sin coste cuando sí lo tienen (arreglar el registro, no
-- la pantalla) y sin contar nada dos veces.
--
-- LO QUE PASABA (comprobado en producción el 13/11/2026)
--   · `chat-facturas` usa `gpt-6.1-terra` (Super Admin › Servicios › Modelos)
--     desde el 12/11, pero en producción `ia_precios` no tenía tarifa de
--     ningún GPT-6: las tarifas se metieron a mano en la demo el 07/11 y nunca
--     llegaron a una migración. `ia_registrar_uso` guarda entonces
--     `coste_usd = NULL` («sin datos») y las pantallas lo suman como 0: 24
--     preguntas del chat de Facturas con 0,00 $ en noviembre.
--   · Una fila de `extraer-vino-foto` (08/10, gpt-4.1) se registró antes de
--     que existiera la tarifa de gpt-4.1 (20261008210000) y sigue a NULL.
--   · `procesar-factura` con ~3.600 llamadas a 0,00 $ NO es un fallo: son
--     embeddings de la importación del histórico (08/11, sin visión), que
--     cuestan 0,02 $ por millón de tokens (0,0078 $ en total). La lectura de
--     las facturas (visión) la registra `ocr-trabajo`, a propósito: cada
--     documento se cuenta una sola vez (ver procesar-factura/costeLectura.ts).
--     Aquí no se toca.
--
-- QUÉ HACE
--   1. Da de alta en `ia_precios` las tarifas de los modelos que ofrece
--      Servicios › Modelos (GPT-6, GPT-5.6, GPT-5.5, GPT-5.4-nano), las mismas
--      que la demo (página oficial de precios de OpenAI, consultada el
--      07/11/2026). Solo las que falten: no pisa ninguna tarifa existente.
--   2. `ia_retarifar_sin_coste(p_modelo)`: pone el coste a las filas de
--      `ia_uso` que lo tienen a NULL y cuyo modelo YA tiene tarifa, con la
--      MISMA cuenta que `ia_registrar_uso` (los cacheados y la escritura en
--      caché salen del input; el razonamiento ya va dentro de la salida y no
--      se suma aparte). Solo toca filas a NULL: nunca cambia un coste ya
--      calculado, así que nada se cuenta dos veces.
--   3. Trigger en `ia_precios`: cuando se añade (o se corrige) la tarifa de un
--      modelo, sus filas sin coste se recalculan solas. La próxima vez que se
--      elija un modelo nuevo antes de tener su tarifa, basta con darla de alta.
--   4. Recalcula ahora todas las filas sin coste que ya tengan tarifa.
--
-- APLICAR (una a una, nunca `db push`): demo primero (sfonaclosuafvlhutkon),
-- producción (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR de la release y
-- con el «sí» del dueño. Idempotente. No hace falta desplegar ninguna función.
-- Deshacer: supabase/rollbacks/20261129143100_ia_tarifas_sin_coste_ROLLBACK.sql
-- Pruebas: npm run test:ia-tarifas:db (PGlite).
-- ===========================================================================

begin;

do $$
begin
  if to_regclass('public.ia_uso') is null or to_regclass('public.ia_precios') is null then
    raise exception 'ia_tarifas_sin_coste: falta 20260928193000_costes_sistema (ia_uso / ia_precios). No se ha cambiado nada.';
  end if;
end;
$$;

-- ─── 1. Tarifas de los modelos del centro de modelos (solo las que falten) ──
insert into public.ia_precios
  (modelo, usd_por_m_input, usd_por_m_cached, usd_por_m_cache_write, usd_por_m_output, razonamiento_como_output, notas, fuente, verificado_en)
values
  ('gpt-6.1-terra', 1.00, 0.05, 1.25,  5.00, true, 'Tier Standard, contexto corto. Cache write = escritura 30 min. La usa chat-facturas desde el 12/11/2026.', 'https://developers.openai.com/api/docs/pricing (consultada 2026-11-07)', null),
  ('gpt-6.1-sol',   2.00, 0.10, 2.50, 10.00, true, 'Tier Standard, contexto corto. Cache write = escritura 30 min.', 'https://developers.openai.com/api/docs/pricing (consultada 2026-11-07)', null),
  ('gpt-6-astra',  10.00, 1.00, 12.50, 50.00, true, 'Tier Standard, contexto corto. Cache write = escritura 30 min.', 'https://developers.openai.com/api/docs/pricing (consultada 2026-11-07)', null),
  ('gpt-6-sol',     2.00, 0.20, 2.50, 10.00, true, 'Tier Standard, contexto corto. Cache write = escritura 30 min.', 'https://developers.openai.com/api/docs/pricing (consultada 2026-11-07)', null),
  ('gpt-6-luna',    0.10, 0.01, 0.125, 0.50, true, 'Tier Standard, contexto corto. Cache write = escritura 30 min.', 'https://developers.openai.com/api/docs/pricing (consultada 2026-11-07)', null),
  ('gpt-5.6-sol',   4.00, 0.40, null, 20.00, true, 'Tier Standard, contexto corto.', 'https://developers.openai.com/api/docs/pricing (consultada 2026-11-07)', null),
  ('gpt-5.6-terra', 2.00, 0.20, null, 12.00, true, 'Tier Standard, contexto corto.', 'https://developers.openai.com/api/docs/pricing (consultada 2026-11-07)', null),
  ('gpt-5.5',       5.00, 0.50, null, 30.00, true, 'Tier Standard, entrada < 272K tokens (más larga: 10 / 1 / 45).', 'https://developers.openai.com/api/docs/pricing (consultada 2026-11-07)', null),
  ('gpt-5.4-nano',  0.20, 0.02, null,  1.25, true, 'Tier Standard.', 'https://developers.openai.com/api/docs/pricing (consultada 2026-11-07)', null)
on conflict (modelo) do nothing;

-- ─── 2. Poner el coste a las filas que lo tienen a NULL ─────────────────────
-- Misma cuenta que ia_registrar_uso (20260928193000, apartado 8b). Si algún
-- día cambia allí, hay que cambiarla aquí también.
create or replace function public.ia_retarifar_sin_coste(p_modelo text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  update public.ia_uso u
     set coste_usd = round((
           greatest(u.prompt_tokens - u.cached_tokens - u.cache_write_tokens, 0) * p.usd_por_m_input
         + u.cached_tokens      * coalesce(p.usd_por_m_cached, p.usd_por_m_input)
         + u.cache_write_tokens * coalesce(p.usd_por_m_cache_write, p.usd_por_m_input)
         -- completion_tokens YA incluye el razonamiento: no se suma aparte.
         + u.completion_tokens  * p.usd_por_m_output
         ) / 1000000.0, 6)
    from public.ia_precios p
   where p.modelo = u.modelo
     and u.coste_usd is null
     and (p_modelo is null or u.modelo = p_modelo);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function public.ia_retarifar_sin_coste(text) is
  'Pone el coste a las filas de ia_uso con coste_usd NULL cuyo modelo ya tiene tarifa en ia_precios (todas, o solo las de p_modelo). '
  'Misma cuenta que ia_registrar_uso. Nunca cambia un coste ya calculado. Devuelve cuántas filas ha arreglado.';

revoke all on function public.ia_retarifar_sin_coste(text) from public, anon, authenticated;
grant execute on function public.ia_retarifar_sin_coste(text) to service_role;

-- ─── 3. Al añadir o corregir una tarifa, sus filas sin coste se arreglan ────
create or replace function public.ia_precios_retarifar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ia_retarifar_sin_coste(new.modelo);
  return null;
end;
$$;

revoke all on function public.ia_precios_retarifar() from public, anon, authenticated;

drop trigger if exists ia_precios_retarifar on public.ia_precios;
create trigger ia_precios_retarifar
  after insert or update of usd_por_m_input, usd_por_m_cached, usd_por_m_cache_write, usd_por_m_output
  on public.ia_precios
  for each row execute function public.ia_precios_retarifar();

-- ─── 4. Lo que ya estaba sin coste y tiene tarifa ───────────────────────────
do $$
declare
  v_n integer;
  v_quedan integer;
begin
  v_n := public.ia_retarifar_sin_coste(null);
  select count(*) into v_quedan from public.ia_uso where coste_usd is null;
  raise notice 'ia_tarifas_sin_coste: % filas de ia_uso con coste recalculado; quedan % sin tarifa.', v_n, v_quedan;
end;
$$;

commit;
