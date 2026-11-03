set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261103180000_recorte_servidor_cupo — recorte de fotos en el servidor:
-- constancia de cada recorte y TOPE de gasto (03/11/2026)
-- ===========================================================================
-- El móvil manda la foto a la Vercel Function `api/recortar-foto` (ver
-- docs/recorte-servidor.md). El equipo de Vercel está en el plan Hobby: 4 h de
-- CPU activa cada 30 días y, si se pasan, Vercel PAUSA las funciones. Para no
-- acercarse:
--
--   1. Cada recorte en el servidor deja una fila en `ia_uso` (funcion
--      'recortar-foto', modelo 'vercel:recortar-foto', `duracion_ms` = lo que
--      tardó el trabajo de CPU: decodificar + inferencia + refinado + PNG).
--      Se ve en Costes como cualquier otra función, a 0 USD (plan gratuito).
--   2. TOPES configurables en Super Admin › Servicios › Vercel (`limites` de
--      la fila 'vercel' de servicios_contratados, editables por el dueño):
--        recortes_servidor_mes  600 fotos/mes   (peor caso medido ~12 s de
--                                                CPU por foto → 2 h, la mitad
--                                                del cupo)
--        recortes_servidor_dia   60 fotos/día   (seguridad)
--        cpu_recortes_mes       120 min/mes     (con la duración REAL anotada)
--      Si falta la fila o la clave, se usan esos mismos valores.
--   3. `recorte_servidor_reservar()`: la llama la función de Vercel COMO EL
--      USUARIO antes de recortar. Comprueba el permiso de carta
--      (can_write_section('gestor_carta')) y los topes; si caben, anota la
--      fila y devuelve su id; si no, `permitido = false` y la función responde
--      429 sin gastar CPU. `recorte_servidor_terminar(id, ms, ok)` anota la
--      duración al acabar (solo sobre una fila del propio usuario).
--   4. `recorte_servidor_uso()`: recortes y minutos del mes y de hoy con sus
--      topes (service_role para la función servicios-uso; y super admin).
--
-- Los contadores van por proyecto de Supabase: la demo y producción cuentan
-- aparte aunque el cupo de Vercel es del equipo.
--
-- APLICAR (una a una, nunca `db push`): demo primero (sfonaclosuafvlhutkon),
-- producción (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR y con el «sí» del
-- dueño. Idempotente. Tiene que terminar en «recorte_servidor_cupo: aplicada».
-- Deshacer: supabase/rollbacks/20261103180000_recorte_servidor_cupo_ROLLBACK.sql
-- Pruebas: npm run test:recorte-servidor:db (PGlite).
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regclass('public.ia_uso') is null or to_regclass('public.ia_precios') is null then
    raise exception 'recorte_servidor_cupo: faltan ia_uso / ia_precios (20260928193000). No se ha cambiado nada.';
  end if;
  if to_regprocedure('public.can_write_section(text)') is null then
    raise exception 'recorte_servidor_cupo: falta public.can_write_section(text). No se ha cambiado nada.';
  end if;
end;
$$;

-- ─── 1. Tarifa (0: plan Hobby) y alta en el catálogo de funciones ───────────
insert into public.ia_precios (modelo, usd_por_m_input, usd_por_m_cached, usd_por_m_cache_write, usd_por_m_output, notas, fuente, verificado_en)
values ('vercel:recortar-foto', 0, null, null, 0,
        'Pseudo-modelo: recorte de fondo en la Vercel Function api/recortar-foto (plan Hobby, sin coste en dinero; el gasto es CPU: ver duracion_ms y Super Admin › Servicios).',
        'https://vercel.com/docs/plans/hobby', null)
on conflict (modelo) do nothing;

do $$
begin
  if to_regclass('public.ia_funciones') is not null then
    insert into public.ia_funciones (funcion, descripcion, instrumentada, unidad, orden)
    values ('recortar-foto', 'Quita el fondo de las fotos de la carta que se suben desde el móvil (Vercel Function, mismo modelo que el ordenador). Una fila por foto con su duración de CPU.', true, 'foto', 90)
    on conflict (funcion) do nothing;
  end if;
end;
$$;

-- ─── 2. Topes por defecto en la fila de Vercel (no pisa lo editado) ─────────
do $$
begin
  if to_regclass('public.servicios_contratados') is not null then
    update public.servicios_contratados
       set limites = $j${
             "recortes_servidor_mes": {"orden": 8, "etiqueta": "Recortes de fotos en el servidor (tope del panel)", "limite": 600, "unidad": "fotos", "periodo": "mes en curso", "nota": "Tope nuestro, no de Vercel: al llegar, el móvil deja las fotos para un ordenador. 600 fotos × ~12 s de CPU (peor caso) ≈ 2 h, la mitad del cupo de 4 h."},
             "recortes_servidor_dia": {"orden": 9, "etiqueta": "Recortes de fotos en el servidor hoy (tope del panel)", "limite": 60, "unidad": "fotos", "periodo": "hoy"},
             "cpu_recortes_mes": {"orden": 10, "etiqueta": "CPU de los recortes en el servidor (tope del panel)", "limite": 120, "unidad": "minutos", "periodo": "mes en curso"}
           }$j$::jsonb || limites
     where proveedor = 'vercel';
  end if;
end;
$$;

-- ─── 3. Topes vigentes ──────────────────────────────────────────────────────
create or replace function public.recorte_servidor_topes()
returns table (tope_mes integer, tope_dia integer, tope_cpu_min integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if to_regclass('public.servicios_contratados') is not null then
    execute $q$select limites from public.servicios_contratados where proveedor = 'vercel'$q$ into v;
  end if;
  return query select
    coalesce(floor((v -> 'recortes_servidor_mes' ->> 'limite')::numeric)::integer, 600),
    coalesce(floor((v -> 'recortes_servidor_dia' ->> 'limite')::numeric)::integer, 60),
    coalesce(floor((v -> 'cpu_recortes_mes' ->> 'limite')::numeric)::integer, 120);
end;
$$;
revoke all on function public.recorte_servidor_topes() from public, anon, authenticated;

-- ─── 4. Uso del mes y de hoy (hora de Madrid) ───────────────────────────────
create or replace function public.recorte_servidor_uso()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_mes   timestamptz := date_trunc('month', now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid';
  v_dia   timestamptz := date_trunc('day', now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid';
  t       record;
  v_n_mes integer;
  v_n_dia integer;
  v_ms    bigint;
begin
  -- service_role (función servicios-uso) o un super admin; nadie más.
  if coalesce(auth.role(), '') <> 'service_role' and not coalesce(public.is_super_admin(auth.uid()), false) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  select * into t from public.recorte_servidor_topes();
  select count(*), coalesce(sum(duracion_ms), 0) into v_n_mes, v_ms
    from public.ia_uso where funcion = 'recortar-foto' and created_at >= v_mes;
  select count(*) into v_n_dia from public.ia_uso where funcion = 'recortar-foto' and created_at >= v_dia;
  return jsonb_build_object(
    'recortes_mes', v_n_mes, 'recortes_dia', v_n_dia, 'cpu_ms_mes', v_ms,
    'tope_mes', t.tope_mes, 'tope_dia', t.tope_dia, 'tope_cpu_min', t.tope_cpu_min);
end;
$$;
revoke all on function public.recorte_servidor_uso() from public, anon, authenticated;
grant execute on function public.recorte_servidor_uso() to authenticated, service_role;

-- ─── 5. Reservar un recorte (lo llama la función de Vercel como el usuario) ─
create or replace function public.recorte_servidor_reservar()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_mes   timestamptz := date_trunc('month', now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid';
  v_dia   timestamptz := date_trunc('day', now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid';
  t       record;
  v_n_mes integer;
  v_n_dia integer;
  v_ms    bigint;
  v_id    bigint;
  v_motivo text;
begin
  if auth.uid() is null or not coalesce(public.can_write_section('gestor_carta'), false) then
    raise exception 'Sin permiso para la carta' using errcode = '42501';
  end if;
  -- Un recorte cada vez decide el tope (dos móviles a la vez no se cuelan los dos).
  perform pg_advisory_xact_lock(hashtext('recorte_servidor_reservar'));
  select * into t from public.recorte_servidor_topes();
  select count(*), coalesce(sum(duracion_ms), 0) into v_n_mes, v_ms
    from public.ia_uso where funcion = 'recortar-foto' and created_at >= v_mes;
  select count(*) into v_n_dia from public.ia_uso where funcion = 'recortar-foto' and created_at >= v_dia;

  v_motivo := case
    when v_n_mes >= t.tope_mes then 'mes'
    when v_ms >= t.tope_cpu_min::bigint * 60000 then 'cpu'
    when v_n_dia >= t.tope_dia then 'dia'
  end;
  if v_motivo is null then
    insert into public.ia_uso (funcion, operacion, modelo, prompt_tokens, completion_tokens, llamadas, coste_usd, estado, disparador, duracion_ms)
    values ('recortar-foto', 'vision', 'vercel:recortar-foto', 0, 0, 1, 0, 'ok', 'usuario:' || auth.uid()::text, null)
    returning id into v_id;
  end if;
  return jsonb_build_object(
    'permitido', v_motivo is null, 'id', v_id, 'motivo', v_motivo,
    'recortes_mes', v_n_mes + (v_id is not null)::int, 'recortes_dia', v_n_dia + (v_id is not null)::int, 'cpu_ms_mes', v_ms,
    'tope_mes', t.tope_mes, 'tope_dia', t.tope_dia, 'tope_cpu_min', t.tope_cpu_min);
end;
$$;
revoke all on function public.recorte_servidor_reservar() from public, anon;
grant execute on function public.recorte_servidor_reservar() to authenticated;

-- ─── 6. Anotar cómo acabó (solo una fila reciente del propio usuario) ───────
create or replace function public.recorte_servidor_terminar(p_id bigint, p_duracion_ms integer, p_ok boolean)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.ia_uso
     set duracion_ms = least(greatest(coalesce(p_duracion_ms, 0), 0), 600000),
         estado = case when p_ok then 'ok' else 'error' end
   where id = p_id
     and funcion = 'recortar-foto'
     and disparador = 'usuario:' || auth.uid()::text
     and duracion_ms is null
     and created_at > now() - interval '15 minutes';
$$;
revoke all on function public.recorte_servidor_terminar(bigint, integer, boolean) from public, anon;
grant execute on function public.recorte_servidor_terminar(bigint, integer, boolean) to authenticated;

do $$ begin raise notice 'recorte_servidor_cupo: aplicada'; end $$;

commit;
