set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261107500000_ia_modelos_centro — Centro de modelos de IA (07/11/2026)
-- ===========================================================================
-- Un sitio único para saber QUÉ MODELO DE OPENAI USA CADA FUNCIÓN, cambiarlo
-- sin desplegar y enterarse cuando OpenAI saca o retira modelos.
--
-- QUÉ CREA
--   1. `ia_modelo_funcion`: una fila por función (FK a ia_funciones) con
--      `modelo` (NULL = el del código, que es lo de antes), `modelo_respaldo`,
--      `notas`, quién y cuándo lo cambió. `modelo_codigo` es INFORMATIVO (lo
--      que usa la función sin fila: secreto o valor por defecto) y
--      `centralizado` dice si la función ya lee esta tabla (helper
--      `_shared/modelo-funcion.ts`). Solo un super admin la lee y la escribe;
--      solo se puede poner un modelo que la cuenta tenga (ia_modelos_disponibles,
--      no retirado) y solo en funciones centralizadas. SE AUDITA.
--   2. `ia_modelo_funcion_historial`: cada cambio (trigger). Solo lectura.
--   3. `ia_modelos_disponibles`: lo que devuelve GET /v1/models (id, owned_by,
--      created, primera y última vez visto, retirado_en). Solo service_role
--      escribe (Edge Function `ia-modelos-openai`). Dato derivado: no se audita.
--   4. `ia_modelos_registrar(jsonb)`: guarda la lista y genera los avisos en
--      notificaciones_dashboard (tipos ia_modelo_*): modelo NUEVO de las
--      familias gpt-*, o*, text-embedding-* (la primera carga no avisa de
--      nada); modelo EN USO retirado o inexistente (prioridad alta); modelo en
--      uso sin precio en ia_precios. Sin duplicar avisos sin leer. SOLO
--      service_role.
--   5. `ia_modelos_centro(p_dias)`: lo que pinta Super Admin › Servicios ›
--      Modelos (SECURITY INVOKER: la RLS decide; todo es de super admin).
--   6. Política RESTRICTIVA en notificaciones_dashboard: los avisos ia_modelo_*
--      solo los ve (y toca) un super admin.
--   7. Cron diario `ia-modelos-openai` (06:15 UTC) que llama a la función con
--      x-ocr-secret (Vault «ocr_trabajos_secret», como facturas-originales-drive).
--      Si falta Vault/pg_net/pg_cron no se instala el cron (aviso, no error).
--
-- NO CAMBIA EL MODELO DE NADIE: todas las filas nacen con modelo NULL.
--
-- APLICAR (una a una, nunca `db push`): demo primero (sfonaclosuafvlhutkon),
-- producción (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR y con el «sí» del
-- dueño. Idempotente. Tiene que terminar en «ia_modelos_centro: aplicada».
-- Deshacer: supabase/rollbacks/20261107500000_ia_modelos_centro_ROLLBACK.sql
-- Pruebas: supabase/tests/ia_modelos_centro_test.sql (contra la demo, BEGIN … ROLLBACK)
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regprocedure('public.is_super_admin(uuid)') is null then
    raise exception 'ia_modelos_centro: falta public.is_super_admin(uuid). No se ha cambiado nada.';
  end if;
  if to_regclass('public.ia_funciones') is null or to_regclass('public.ia_precios') is null
     or to_regclass('public.ia_uso') is null or to_regclass('public.notificaciones_dashboard') is null then
    raise exception 'ia_modelos_centro: faltan ia_funciones/ia_precios/ia_uso/notificaciones_dashboard. No se ha cambiado nada.';
  end if;
end;
$$;

-- ─── 0. La propia función en el catálogo de ia_funciones ────────────────────
-- activo = false: solo gasta en las pruebas a mano, así que no debe salir en
-- «funciones sin registro» por no tener filas en una semana.
insert into public.ia_funciones (funcion, descripcion, instrumentada, unidad, orden, activo)
values ('ia-modelos-openai',
        'Centro de modelos de IA: lista los modelos de la cuenta (GET /v1/models, gratis) y hace las llamadas mínimas del botón «Probar».',
        true, 'prueba', 900, false)
on conflict (funcion) do nothing;

-- ─── 1. Modelos de la cuenta ────────────────────────────────────────────────
create table if not exists public.ia_modelos_disponibles (
  id                 text primary key check (id ~ '^[A-Za-z0-9][A-Za-z0-9._:\-]{0,119}$'),
  owned_by           text check (owned_by is null or length(owned_by) <= 120),
  creado_openai      timestamptz,
  primera_vez_visto  timestamptz not null default now(),
  ultima_vez_visto   timestamptz not null default now(),
  retirado_en        timestamptz,
  -- true = se vio en la primera carga: no es «nuevo», ya estaba.
  primera_carga      boolean not null default false,
  de_interes         boolean generated always as (id ~ '^(gpt-|o[0-9]|text-embedding-)') stored
);
comment on table public.ia_modelos_disponibles is
  'Modelos que devuelve GET /v1/models de OpenAI (Edge Function ia-modelos-openai). retirado_en = dejó de salir en la lista. '
  'de_interes = familias gpt-*, o*, text-embedding-*. Dato derivado: no se audita.';
drop trigger if exists trg_auditoria on public.ia_modelos_disponibles;

-- ─── 2. Modelo por función ──────────────────────────────────────────────────
create table if not exists public.ia_modelo_funcion (
  funcion             text primary key references public.ia_funciones(funcion) on update cascade on delete restrict,
  modelo              text check (modelo is null or modelo ~ '^[A-Za-z0-9][A-Za-z0-9._:\-]{2,119}$'),
  modelo_respaldo     text check (modelo_respaldo is null or modelo_respaldo ~ '^[A-Za-z0-9][A-Za-z0-9._:\-]{2,119}$'),
  modelo_codigo       text check (modelo_codigo is null or length(modelo_codigo) <= 200),
  centralizado        boolean not null default false,
  notas               text check (notas is null or length(notas) <= 2000),
  cambiado_por        uuid,
  cambiado_por_email  text,
  cambiado_en         timestamptz not null default now(),
  constraint ia_modelo_funcion_respaldo_distinto check (modelo_respaldo is null or modelo is null or modelo_respaldo <> modelo)
);
comment on table public.ia_modelo_funcion is
  'Modelo de OpenAI elegido por función. modelo NULL = el del código (modelo_codigo, informativo). Lo leen las Edge Functions '
  'con _shared/modelo-funcion.ts (caché 60 s; si falla, secreto o valor por defecto). Solo super admin.';

create table if not exists public.ia_modelo_funcion_historial (
  id                  bigserial primary key,
  funcion             text not null,
  modelo_anterior     text,
  modelo_nuevo        text,
  respaldo_anterior   text,
  respaldo_nuevo      text,
  notas               text,
  cambiado_por        uuid,
  cambiado_por_email  text,
  cambiado_en         timestamptz not null default now()
);
create index if not exists ia_modelo_funcion_historial_funcion_idx on public.ia_modelo_funcion_historial (funcion, cambiado_en desc);
drop trigger if exists trg_auditoria on public.ia_modelo_funcion_historial;

-- Antes de guardar: valida el modelo y apunta quién y cuándo.
create or replace function public.ia_modelo_funcion_antes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_m text;
begin
  if tg_op = 'UPDATE' and new.funcion is distinct from old.funcion then
    raise exception 'La función de una fila de ia_modelo_funcion no se puede cambiar' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.modelo is not distinct from old.modelo
     and new.modelo_respaldo is not distinct from old.modelo_respaldo
     and new.notas is not distinct from old.notas
     and new.modelo_codigo is not distinct from old.modelo_codigo
     and new.centralizado is not distinct from old.centralizado then
    return new;
  end if;
  if (new.modelo is not null or new.modelo_respaldo is not null) and not new.centralizado then
    raise exception 'La función % todavía no lee el modelo de esta tabla (centralizado = false): cambiarlo aquí no tendría efecto', new.funcion
      using errcode = '23514';
  end if;
  foreach v_m in array array_remove(array[new.modelo, new.modelo_respaldo], null) loop
    if tg_op = 'UPDATE' and (v_m is not distinct from old.modelo or v_m is not distinct from old.modelo_respaldo) then
      continue; -- ya estaba puesto: no se revalida (puede haberse retirado después)
    end if;
    if not exists (select 1 from public.ia_modelos_disponibles d where d.id = v_m and d.retirado_en is null) then
      raise exception 'El modelo % no está entre los modelos disponibles de la cuenta de OpenAI (o está retirado). Actualiza la lista antes.', v_m
        using errcode = '23514';
    end if;
  end loop;
  new.cambiado_en := now();
  new.cambiado_por := auth.uid();
  -- Sin usuario (SQL a mano, service_role): quien lo haga puede firmar con
  -- `set local ia_modelos.cambiado_por = '…'`; si no, «sistema».
  new.cambiado_por_email := coalesce(nullif(auth.jwt() ->> 'email', ''),
                                     nullif(left(current_setting('ia_modelos.cambiado_por', true), 120), ''),
                                     'sistema');
  return new;
end;
$$;
revoke all on function public.ia_modelo_funcion_antes() from public, anon, authenticated;
drop trigger if exists ia_modelo_funcion_antes on public.ia_modelo_funcion;
create trigger ia_modelo_funcion_antes
  before insert or update on public.ia_modelo_funcion
  for each row execute function public.ia_modelo_funcion_antes();

create or replace function public.ia_modelo_funcion_historiar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.modelo is not distinct from old.modelo
     and new.modelo_respaldo is not distinct from old.modelo_respaldo then
    return new; -- solo notas o datos informativos: no es un cambio de modelo
  end if;
  if tg_op = 'INSERT' and new.modelo is null and new.modelo_respaldo is null then
    return new; -- alta de la fila sin modelo (semilla): nada que historiar
  end if;
  insert into public.ia_modelo_funcion_historial
    (funcion, modelo_anterior, modelo_nuevo, respaldo_anterior, respaldo_nuevo, notas, cambiado_por, cambiado_por_email, cambiado_en)
  values (new.funcion,
          case when tg_op = 'UPDATE' then old.modelo end, new.modelo,
          case when tg_op = 'UPDATE' then old.modelo_respaldo end, new.modelo_respaldo,
          new.notas, new.cambiado_por, new.cambiado_por_email, new.cambiado_en);
  return new;
end;
$$;
revoke all on function public.ia_modelo_funcion_historiar() from public, anon, authenticated;
drop trigger if exists ia_modelo_funcion_historiar on public.ia_modelo_funcion;
create trigger ia_modelo_funcion_historiar
  after insert or update on public.ia_modelo_funcion
  for each row execute function public.ia_modelo_funcion_historiar();

-- La configuración SÍ se audita (mismo criterio que servicios_contratados).
do $$
begin
  if to_regprocedure('public.fn_registrar_auditoria()') is not null
     and not exists (select 1 from pg_trigger
                      where tgrelid = 'public.ia_modelo_funcion'::regclass
                        and tgfoid = 'public.fn_registrar_auditoria()'::regprocedure
                        and not tgisinternal) then
    execute 'drop trigger if exists trg_auditoria on public.ia_modelo_funcion';
    execute 'create trigger trg_auditoria after insert or update or delete on public.ia_modelo_funcion
             for each row execute function public.fn_registrar_auditoria()';
  end if;
end;
$$;

-- Semilla: una fila por función, SIN modelo (= lo de antes). on conflict:
-- solo se refresca lo informativo, nunca el modelo elegido.
insert into public.ia_modelo_funcion (funcion, modelo_codigo, centralizado)
select v.funcion, v.codigo, v.centralizado
  from (values
    ('chat-facturas',             'gpt-4.1-mini (secreto CHAT_FACTURAS_MODELO)',                 true),
    ('clasificar-productos',      'gpt-5.6-luna (secreto CLASIFICAR_PRODUCTOS_MODELO)',          true),
    ('procesar-factura',          'gpt-5.6-luna (secreto OCR_MODELO; también trabajos de 1 página)', true),
    ('ocr-trabajo',               'gpt-5.6-luna (secreto OCR_MODELO_PIEZAS u OCR_MODELO; piezas)', true),
    ('chat-web',                  'gpt-5.6-luna (secreto CHAT_WEB_MODEL)',                       true),
    ('extraer-vino-foto',         'gpt-4.1 (secreto VINO_FOTO_MODELO) y gpt-4.1-mini para buscar', false),
    ('instagram-ia',              'gpt-5.6-luna (texto) y gpt-4.1 (visión), en código',          false),
    ('traducir-contenido',        'gpt-4.1-mini, en código',                                     false),
    ('format-novedad',            'gpt-4o-mini, en código',                                      false),
    ('procesar-dibujo-perimetro', 'gpt-5.4-mini, en código',                                     false)
  ) as v(funcion, codigo, centralizado)
 where exists (select 1 from public.ia_funciones f where f.funcion = v.funcion)
on conflict (funcion) do update
  set modelo_codigo = excluded.modelo_codigo,
      centralizado = excluded.centralizado
  where public.ia_modelo_funcion.modelo_codigo is distinct from excluded.modelo_codigo
     or public.ia_modelo_funcion.centralizado is distinct from excluded.centralizado;

-- ─── 3. RLS ─────────────────────────────────────────────────────────────────
alter table public.ia_modelo_funcion           enable row level security;
alter table public.ia_modelo_funcion_historial enable row level security;
alter table public.ia_modelos_disponibles      enable row level security;

revoke all on public.ia_modelo_funcion           from anon, authenticated;
revoke all on public.ia_modelo_funcion_historial from anon, authenticated;
revoke all on public.ia_modelos_disponibles      from anon, authenticated;
grant select on public.ia_modelo_funcion to authenticated;
grant update (modelo, modelo_respaldo, notas) on public.ia_modelo_funcion to authenticated;
grant select on public.ia_modelo_funcion_historial to authenticated;
grant select on public.ia_modelos_disponibles to authenticated;
grant all on public.ia_modelo_funcion           to service_role;
grant all on public.ia_modelo_funcion_historial to service_role;
grant all on public.ia_modelos_disponibles      to service_role;
grant usage, select on sequence public.ia_modelo_funcion_historial_id_seq to service_role;

drop policy if exists ia_modelo_funcion_select_super_admin on public.ia_modelo_funcion;
create policy ia_modelo_funcion_select_super_admin on public.ia_modelo_funcion for select to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) );
drop policy if exists ia_modelo_funcion_update_super_admin on public.ia_modelo_funcion;
create policy ia_modelo_funcion_update_super_admin on public.ia_modelo_funcion for update to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) )
  with check ( (select public.is_super_admin((select auth.uid()))) );
drop policy if exists ia_modelo_funcion_service_role on public.ia_modelo_funcion;
create policy ia_modelo_funcion_service_role on public.ia_modelo_funcion for all to service_role using (true) with check (true);

drop policy if exists ia_modelo_funcion_historial_select_super_admin on public.ia_modelo_funcion_historial;
create policy ia_modelo_funcion_historial_select_super_admin on public.ia_modelo_funcion_historial for select to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) );
drop policy if exists ia_modelo_funcion_historial_service_role on public.ia_modelo_funcion_historial;
create policy ia_modelo_funcion_historial_service_role on public.ia_modelo_funcion_historial for all to service_role using (true) with check (true);

drop policy if exists ia_modelos_disponibles_select_super_admin on public.ia_modelos_disponibles;
create policy ia_modelos_disponibles_select_super_admin on public.ia_modelos_disponibles for select to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) );
drop policy if exists ia_modelos_disponibles_service_role on public.ia_modelos_disponibles;
create policy ia_modelos_disponibles_service_role on public.ia_modelos_disponibles for all to service_role using (true) with check (true);

do $$
declare
  t text;
begin
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    foreach t in array array['ia_modelo_funcion', 'ia_modelo_funcion_historial', 'ia_modelos_disponibles'] loop
      execute format('drop policy if exists "acceso_panel_no_bloqueado" on public.%I', t);
      execute format('create policy "acceso_panel_no_bloqueado" on public.%I as restrictive for all to authenticated
        using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()))', t);
    end loop;
  end if;
end;
$$;

-- Avisos de modelos: solo super admin (RESTRICTIVA: se suma a las de sección).
drop policy if exists notificaciones_ia_modelos_solo_super_admin on public.notificaciones_dashboard;
create policy notificaciones_ia_modelos_solo_super_admin on public.notificaciones_dashboard
  as restrictive for all to authenticated
  using ( tipo not like 'ia\_modelo%' or (select public.is_super_admin((select auth.uid()))) )
  with check ( tipo not like 'ia\_modelo%' or (select public.is_super_admin((select auth.uid()))) );

-- ─── 4. Registrar la lista de OpenAI y avisar ───────────────────────────────
create or replace function public.ia_modelos_registrar(p_modelos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ahora      timestamptz := clock_timestamp();
  v_primera    boolean;
  v_nuevos     text[];
  v_retirados  text[];
  v_vuelven    text[];
  v_en_uso     text[];
  v_uso_ret    text[];
  v_uso_inex   text[];
  v_sin_precio text[];
  v_m          text;
  v_avisos     int := 0;
  v_quien      text;
begin
  if p_modelos is null or jsonb_typeof(p_modelos) <> 'array' then
    raise exception 'ia_modelos_registrar: se esperaba un array de modelos' using errcode = '22023';
  end if;
  -- Una lista vacía (fallo de la API) marcaría todo como retirado: se rechaza.
  if not exists (select 1 from jsonb_array_elements(p_modelos) e
                  where jsonb_typeof(e) = 'object' and coalesce(btrim(e ->> 'id'), '') <> '') then
    raise exception 'ia_modelos_registrar: la lista no trae ningún modelo; no se cambia nada' using errcode = '22023';
  end if;

  create temp table if not exists ia_modelos_entrada (id text primary key, owned_by text, creado timestamptz) on commit drop;
  truncate pg_temp.ia_modelos_entrada;
  insert into pg_temp.ia_modelos_entrada (id, owned_by, creado)
  select distinct on (btrim(e ->> 'id'))
         btrim(e ->> 'id'),
         left(nullif(e ->> 'owned_by', ''), 120),
         case when (e ->> 'created') ~ '^[0-9]{1,12}$' then to_timestamp((e ->> 'created')::bigint) end
    from jsonb_array_elements(p_modelos) e
   where jsonb_typeof(e) = 'object'
     and btrim(e ->> 'id') ~ '^[A-Za-z0-9][A-Za-z0-9._:\-]{0,119}$';

  v_primera := not exists (select 1 from public.ia_modelos_disponibles);

  v_nuevos := array(select e.id from pg_temp.ia_modelos_entrada e
                     where not exists (select 1 from public.ia_modelos_disponibles d where d.id = e.id)
                     order by e.id);
  v_vuelven := array(select d.id from public.ia_modelos_disponibles d join pg_temp.ia_modelos_entrada e on e.id = d.id
                      where d.retirado_en is not null order by d.id);
  v_retirados := array(select d.id from public.ia_modelos_disponibles d
                        where d.retirado_en is null
                          and not exists (select 1 from pg_temp.ia_modelos_entrada e where e.id = d.id)
                        order by d.id);

  insert into public.ia_modelos_disponibles as d (id, owned_by, creado_openai, primera_vez_visto, ultima_vez_visto, retirado_en, primera_carga)
  select e.id, e.owned_by, e.creado, v_ahora, v_ahora, null, v_primera from pg_temp.ia_modelos_entrada e
  on conflict (id) do update
    set owned_by = coalesce(excluded.owned_by, d.owned_by),
        creado_openai = coalesce(excluded.creado_openai, d.creado_openai),
        ultima_vez_visto = v_ahora,
        retirado_en = null;

  update public.ia_modelos_disponibles set retirado_en = v_ahora where id = any(v_retirados);

  -- En uso = elegido en ia_modelo_funcion (modelo o respaldo) o usado en ia_uso
  -- los últimos 30 días y que sea de OpenAI (está o estuvo en la lista).
  v_en_uso := array(
    select distinct u.m from (
      select f.modelo as m from public.ia_modelo_funcion f
      union select f.modelo_respaldo from public.ia_modelo_funcion f
      union select x.modelo from public.ia_uso x where x.created_at > now() - interval '30 days'
    ) u
    where u.m is not null and exists (select 1 from public.ia_modelos_disponibles d where d.id = u.m)
    order by u.m);
  v_uso_ret := array(select d.id from public.ia_modelos_disponibles d where d.id = any(v_en_uso) and d.retirado_en is not null order by d.id);
  v_uso_inex := array(
    select distinct u.m from (
      select f.modelo as m from public.ia_modelo_funcion f union select f.modelo_respaldo from public.ia_modelo_funcion f
    ) u
    where u.m is not null and not exists (select 1 from public.ia_modelos_disponibles d where d.id = u.m)
    order by u.m);
  v_sin_precio := array(select m from unnest(v_en_uso) m
                         where not (m = any(v_uso_ret))
                           and not exists (select 1 from public.ia_precios p where p.modelo = m)
                         order by m);

  -- Avisos (para super admin). No se repite uno igual que siga sin leer.
  if not v_primera and exists (select 1 from public.ia_modelos_disponibles d where d.id = any(v_nuevos) and d.de_interes) then
    insert into public.notificaciones_dashboard (tipo, titulo, mensaje, referencia_tipo, prioridad)
    select 'ia_modelo_nuevo',
           'OpenAI tiene ' || count(*) || case when count(*) = 1 then ' modelo nuevo' else ' modelos nuevos' end,
           left('Nuevos en la cuenta: ' || string_agg(d.id, ', ' order by d.id)
                || '. Revisa su precio y pruébalos en Super Admin › Servicios › Modelos.', 1000),
           'ia_modelos', 'normal'
      from public.ia_modelos_disponibles d where d.id = any(v_nuevos) and d.de_interes;
    v_avisos := v_avisos + 1;
  end if;

  foreach v_m in array v_uso_ret || v_uso_inex loop
    v_quien := (select string_agg(f.funcion, ', ' order by f.funcion) from public.ia_modelo_funcion f
                 where f.modelo = v_m or f.modelo_respaldo = v_m);
    if v_quien is null then
      v_quien := (select string_agg(distinct x.funcion, ', ') from public.ia_uso x
                   where x.modelo = v_m and x.created_at > now() - interval '30 days');
    end if;
    if not exists (select 1 from public.notificaciones_dashboard n
                    where n.tipo = 'ia_modelo_retirado' and not n.leida
                      and n.titulo = 'Modelo de IA en uso no disponible: ' || v_m) then
      insert into public.notificaciones_dashboard (tipo, titulo, mensaje, referencia_tipo, prioridad)
      values ('ia_modelo_retirado', 'Modelo de IA en uso no disponible: ' || v_m,
              left('OpenAI ya no lista ' || v_m || ' y lo usa: ' || coalesce(v_quien, '¿?')
                   || '. Cambia el modelo en Super Admin › Servicios › Modelos antes de que falle.', 1000),
              'ia_modelos', 'alta');
      v_avisos := v_avisos + 1;
    end if;
  end loop;

  foreach v_m in array v_sin_precio loop
    if not exists (select 1 from public.notificaciones_dashboard n
                    where n.tipo = 'ia_modelo_sin_precio' and not n.leida
                      and n.titulo = 'Modelo de IA sin precio: ' || v_m) then
      insert into public.notificaciones_dashboard (tipo, titulo, mensaje, referencia_tipo, prioridad)
      values ('ia_modelo_sin_precio', 'Modelo de IA sin precio: ' || v_m,
              left(v_m || ' está en uso y no tiene tarifa en ia_precios: su gasto sale «sin datos». Añade el precio oficial de OpenAI.', 1000),
              'ia_modelos', 'normal');
      v_avisos := v_avisos + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'primera_carga', v_primera,
    'total', (select count(*) from pg_temp.ia_modelos_entrada),
    'nuevos', to_jsonb(v_nuevos),
    'retirados', to_jsonb(v_retirados),
    'vuelven', to_jsonb(v_vuelven),
    'en_uso', to_jsonb(v_en_uso),
    'en_uso_no_disponibles', to_jsonb(v_uso_ret || v_uso_inex),
    'en_uso_sin_precio', to_jsonb(v_sin_precio),
    'avisos', v_avisos);
end;
$$;
revoke all on function public.ia_modelos_registrar(jsonb) from public, anon, authenticated;
grant execute on function public.ia_modelos_registrar(jsonb) to service_role;

-- ─── 5. Lo que pinta el panel (la RLS decide: todo es de super admin) ───────
create or replace function public.ia_modelos_centro(p_dias integer default 30)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with dias as (select greatest(1, least(coalesce(p_dias, 30), 366)) as n),
  coste as (
    select u.funcion, sum(u.coste_usd) as usd, sum(u.llamadas) as llamadas,
           bool_or(u.coste_usd is null and u.llamadas > 0) as sin_tarifa
      from public.ia_uso_diario u, dias
     where u.dia >= (current_date - dias.n)
     group by u.funcion
  ),
  ultimo as (
    select distinct on (x.funcion) x.funcion, x.modelo, x.created_at
      from public.ia_uso x
     where x.created_at > now() - interval '60 days'
     order by x.funcion, x.created_at desc
  )
  select jsonb_build_object(
    'dias', (select n from dias),
    'funciones', coalesce((
      select jsonb_agg(jsonb_build_object(
               'funcion', f.funcion,
               'descripcion', fn.descripcion,
               'modelo', f.modelo,
               'modelo_respaldo', f.modelo_respaldo,
               'modelo_codigo', f.modelo_codigo,
               'centralizado', f.centralizado,
               'notas', f.notas,
               'cambiado_por_email', f.cambiado_por_email,
               'cambiado_en', f.cambiado_en,
               'ultimo_modelo_usado', ul.modelo,
               'ultimo_uso', ul.created_at,
               'coste_usd', c.usd,
               'llamadas', c.llamadas,
               'coste_sin_tarifa', coalesce(c.sin_tarifa, false))
             order by f.centralizado desc, fn.orden, f.funcion)
        from public.ia_modelo_funcion f
        join public.ia_funciones fn on fn.funcion = f.funcion
        left join coste c on c.funcion = f.funcion
        left join ultimo ul on ul.funcion = f.funcion), '[]'::jsonb),
    'disponibles', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id,
               'owned_by', d.owned_by,
               'creado_openai', d.creado_openai,
               'primera_vez_visto', d.primera_vez_visto,
               'ultima_vez_visto', d.ultima_vez_visto,
               'retirado_en', d.retirado_en,
               'de_interes', d.de_interes,
               'nuevo', (not d.primera_carga and d.primera_vez_visto > now() - interval '30 days'),
               'usd_por_m_input', p.usd_por_m_input,
               'usd_por_m_output', p.usd_por_m_output,
               'precio_fuente', p.fuente)
             order by d.retirado_en is not null, d.de_interes desc, d.creado_openai desc nulls last, d.id)
        from public.ia_modelos_disponibles d
        left join public.ia_precios p on p.modelo = d.id), '[]'::jsonb),
    'ultima_lista', (select max(d.ultima_vez_visto) from public.ia_modelos_disponibles d),
    'historial', coalesce((
      select jsonb_agg(to_jsonb(h) order by h.cambiado_en desc)
        from (select h.funcion, h.modelo_anterior, h.modelo_nuevo, h.respaldo_anterior, h.respaldo_nuevo,
                     h.notas, h.cambiado_por_email, h.cambiado_en
                from public.ia_modelo_funcion_historial h
               order by h.cambiado_en desc limit 100) h), '[]'::jsonb)
  );
$$;
revoke all on function public.ia_modelos_centro(integer) from public, anon;
grant execute on function public.ia_modelos_centro(integer) to authenticated, service_role;

-- ─── 6. Cron diario ─────────────────────────────────────────────────────────
create or replace function public.ia_modelos_disparar()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secreto text;
begin
  if to_regclass('vault.decrypted_secrets') is null or not exists (select 1 from pg_namespace where nspname = 'net') then
    return false;
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = ''project_url'' limit 1' into v_url;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = ''ocr_trabajos_secret'' limit 1' into v_secreto;
  if coalesce(v_url, '') = '' or coalesce(v_secreto, '') = '' then
    return false;
  end if;
  execute 'select net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 60000)'
    using rtrim(v_url, '/') || '/functions/v1/ia-modelos-openai',
          jsonb_build_object('Content-Type', 'application/json', 'x-ocr-secret', v_secreto),
          '{"accion":"sincronizar"}'::jsonb;
  return true;
end;
$$;
revoke all on function public.ia_modelos_disparar() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if exists (select 1 from cron.job where jobname = 'ia-modelos-openai') then
      perform cron.unschedule('ia-modelos-openai');
    end if;
    perform cron.schedule('ia-modelos-openai', '15 6 * * *', $cron$ select public.ia_modelos_disparar(); $cron$);
  else
    raise notice 'ia_modelos_centro: no hay pg_cron; el cron diario ia-modelos-openai NO se ha instalado.';
  end if;
end;
$$;

-- ─── 7. Comprobación final ──────────────────────────────────────────────────
do $$
declare
  v_malos text[] := '{}';
begin
  if has_function_privilege('authenticated', 'public.ia_modelos_registrar(jsonb)', 'execute') then
    v_malos := v_malos || 'authenticated puede ejecutar ia_modelos_registrar'::text;
  end if;
  if has_table_privilege('anon', 'public.ia_modelo_funcion', 'select') then
    v_malos := v_malos || 'anon puede leer ia_modelo_funcion'::text;
  end if;
  if has_table_privilege('authenticated', 'public.ia_modelos_disponibles', 'insert') then
    v_malos := v_malos || 'authenticated puede insertar en ia_modelos_disponibles'::text;
  end if;
  if cardinality(v_malos) > 0 then
    raise exception 'ia_modelos_centro: %', array_to_string(v_malos, '; ');
  end if;
  raise notice 'ia_modelos_centro: aplicada';
end;
$$;

commit;
