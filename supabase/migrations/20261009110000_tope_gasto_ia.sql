set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261009110000_tope_gasto_ia
-- ===========================================================================
-- ##   NO APLICADA: la aplica el dueño a mano (ver PASOS)                  ##
-- ===========================================================================
-- Tope mensual del gasto de IA («para evitar sustos») y botón «Sincronizar
-- ahora» de Super Admin › Costes.
--
-- QUÉ CAMBIA
--   1. `configuracion_facturas.tope_ia_mes_eur` numeric(8,2), por defecto 5 €.
--      Lo LEE cualquiera que vea Facturas (el monitor avisa en ámbar al 80 % y
--      en rojo al pasarlo), pero NO se puede escribir con un UPDATE normal: el
--      GRANT de columnas de 20261007170000 no la incluye.
--   2. RPC `fijar_tope_ia_mes(numeric)`: SOLO super admin. Es la única forma de
--      cambiar el tope (se edita desde Super Admin › Costes). Valida 0,01–10000.
--   3. RPC `openai_sincronizar_ahora()`: SOLO super admin. Lanza la misma
--      sincronización que el cron de 6 h (`openai_despachar_sincronizacion_
--      costes()`), como mucho UNA vez por minuto (la API de costes de OpenAI
--      admite 30 peticiones por minuto). Devuelve 1 si la ha lanzado y 0 si se
--      sincronizó hace menos de un minuto o falta el secreto de Vault.
--
-- No toca ninguna función ni dato existente. Idempotente.
--
-- PASOS (desde adminpanelct/, POR TERMINAL; no en el SQL Editor)
--   1. npx supabase db query --linked -f supabase/migrations/20261009110000_tope_gasto_ia.sql
--      Tiene que imprimir «tope_gasto_ia: aplicada».
--   2. npx supabase db query --linked -f supabase/tests/tope_gasto_ia_test.sql
--      (BEGIN … ROLLBACK). Tiene que acabar en «tope_gasto_ia_test: OK».
--   Deshacer: supabase/rollbacks/20261009110000_tope_gasto_ia_ROLLBACK.sql
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regclass('public.configuracion_facturas') is null
     or to_regclass('public.openai_costes_diarios') is null
     or to_regprocedure('public.is_super_admin(uuid)') is null
     or to_regprocedure('public.openai_despachar_sincronizacion_costes()') is null then
    raise exception 'tope_gasto_ia: falta 20261007170000_chatbot_categorias_precios o 20261008150000_openai_costes_reales. No se ha cambiado nada.';
  end if;
end;
$$;

-- ─── 1. Columna del tope ────────────────────────────────────────────────────
alter table public.configuracion_facturas
  add column if not exists tope_ia_mes_eur numeric(8,2) not null default 5
    check (tope_ia_mes_eur >= 0.01 and tope_ia_mes_eur <= 10000);
comment on column public.configuracion_facturas.tope_ia_mes_eur is
  'Tope del gasto de IA del mes (€, todo el restaurante). Facturas avisa en ámbar al 80 % y en rojo al pasarlo. '
  'Solo se cambia con fijar_tope_ia_mes() (super admin).';

-- ─── 2. Cambiar el tope: solo super admin ───────────────────────────────────
create or replace function public.fijar_tope_ia_mes(p_eur numeric)
returns numeric
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_nuevo numeric(8,2);
begin
  if not coalesce(public.is_super_admin(auth.uid()), false) then
    raise exception 'fijar_tope_ia_mes: solo super admin' using errcode = '42501';
  end if;
  if p_eur is null or p_eur < 0.01 or p_eur > 10000 then
    raise exception 'fijar_tope_ia_mes: el tope tiene que estar entre 0,01 y 10000 €' using errcode = '22023';
  end if;
  update public.configuracion_facturas set tope_ia_mes_eur = round(p_eur, 2) where id
  returning tope_ia_mes_eur into v_nuevo;
  if not found then
    insert into public.configuracion_facturas (id, tope_ia_mes_eur) values (true, round(p_eur, 2))
    returning tope_ia_mes_eur into v_nuevo;
  end if;
  return v_nuevo;
end;
$$;
comment on function public.fijar_tope_ia_mes(numeric) is
  'Cambia el tope mensual de gasto de IA (configuracion_facturas.tope_ia_mes_eur). Solo super admin. Devuelve el tope guardado.';
revoke all on function public.fijar_tope_ia_mes(numeric) from public, anon;
grant execute on function public.fijar_tope_ia_mes(numeric) to authenticated, service_role;

-- ─── 3. «Sincronizar ahora» ─────────────────────────────────────────────────
create or replace function public.openai_sincronizar_ahora()
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not coalesce(public.is_super_admin(auth.uid()), false) then
    raise exception 'openai_sincronizar_ahora: solo super admin' using errcode = '42501';
  end if;
  -- Como mucho una vez por minuto en todo el sistema: no martillear a OpenAI
  -- (30 peticiones por minuto en su API de costes).
  if not pg_try_advisory_xact_lock(hashtext('openai_sincronizar_ahora')) then
    return 0;
  end if;
  if exists (select 1 from public.openai_costes_diarios c where c.actualizado_en > now() - interval '1 minute') then
    return 0;
  end if;
  return public.openai_despachar_sincronizacion_costes();
end;
$$;
comment on function public.openai_sincronizar_ahora() is
  'Lanza ya la sincronización de costes de OpenAI (la misma llamada que el cron de 6 h). Solo super admin. '
  'Devuelve 1 si la ha lanzado, 0 si se acaba de sincronizar (<1 min) o falta el secreto de Vault.';
revoke all on function public.openai_sincronizar_ahora() from public, anon;
grant execute on function public.openai_sincronizar_ahora() to authenticated, service_role;

commit;

select 'tope_gasto_ia: aplicada' as resultado;
