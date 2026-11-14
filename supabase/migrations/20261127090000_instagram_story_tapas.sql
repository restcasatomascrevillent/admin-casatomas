-- ============================================================================
-- Story automática del JUEVES DE TAPAS (12/11/2026)
-- ----------------------------------------------------------------------------
-- Pedido del dueño: «Hoy es día de tapas: que se suba la historia a Instagram
-- con las tapas cuando estén las tapas».
--
-- El panel (con la sesión de quien guarda las tapas en Gestión web) genera la
-- story con /api/instagram-render y la programa con instagram_programar, como
-- cualquier pieza. Aquí solo va lo que tiene que decidir el servidor:
--
--   1. instagram_story_tapas_ajustes (una fila): interruptor «Story automática
--      del jueves de tapas» (activada), hora (12:00 de Madrid), plantilla
--      (ct-tapas | ct-tapas-clasica) y foto de fondo por defecto.
--   2. instagram_story_tapas: UNA fila por semana (clave = el lunes). Dice qué
--      pieza y qué programación son la story de esa semana, con qué tapas
--      (huella) se hizo y en qué estado está. Es la marca de «story de tapas de
--      la semana X»: nunca hay dos piezas para la misma semana, así que nunca se
--      publica dos veces.
--   3. RPC (SECURITY DEFINER, «Editar» en Marketing + sesión de panel viva):
--        instagram_story_tapas_reclamar(fecha, huella, manual) → { accion: crear|regenerar|nada, fila }
--          con cerrojo de 3 min: dos pestañas o dos guardados seguidos no
--          generan dos stories.
--        instagram_story_tapas_registrar(semana, pieza, programacion, …)
--          guarda el resultado y deja el aviso en la campana (tipo
--          «instagram_story_tapas», con sus datos para «Ver», «Publicar
--          ahora», «Cambiar hora» y «Cancelar»).
--        instagram_story_tapas_fallo(semana, error)   suelta el cerrojo.
--        instagram_story_tapas_cancelar(semana)       cancela la programación.
--        instagram_story_tapas_ver(semana)            la fila al día (lee «Ver»).
--      El estado se sincroniza con la pieza y la programación reales: si se
--      cancela o se cambia la hora desde el calendario, o el programador la
--      publica, la fila lo refleja al leerla.
--
-- Escritura de las tablas: ajustes, por UPDATE con «Editar» en Marketing;
-- instagram_story_tapas, SOLO por las RPC. Lectura: «Ver» en Marketing.
--
-- Depende de: 20261105090000_instagram (instagram_piezas),
-- 20261106110000_instagram_programacion (instagram_programaciones,
-- instagram_cancelar_programacion), 20261107300000_facturas_alertas
-- (notificaciones_dashboard.clave/datos), 20261001170000 (can_edit_section).
-- Idempotente. Vuelta atrás: supabase/rollbacks/20261127090000_instagram_story_tapas_ROLLBACK.sql
-- ============================================================================

do $$
declare
  v_faltan text[] := '{}';
begin
  if to_regclass('public.instagram_piezas') is null then v_faltan := v_faltan || 'public.instagram_piezas (20261105090000_instagram)'::text; end if;
  if to_regclass('public.instagram_programaciones') is null then v_faltan := v_faltan || 'public.instagram_programaciones (20261106110000_instagram_programacion)'::text; end if;
  if to_regclass('public.notificaciones_dashboard') is null then v_faltan := v_faltan || 'public.notificaciones_dashboard'::text; end if;
  if to_regprocedure('public.can_edit_section(text)') is null then v_faltan := v_faltan || 'public.can_edit_section(text)'::text; end if;
  if to_regprocedure('public.can_read_section(text)') is null then v_faltan := v_faltan || 'public.can_read_section(text)'::text; end if;
  if cardinality(v_faltan) > 0 then
    raise exception 'instagram_story_tapas: faltan %', array_to_string(v_faltan, ', ');
  end if;
end $$;

-- La campana deduplica por «clave» y guarda los datos del aviso (20261107300000).
alter table public.notificaciones_dashboard add column if not exists clave text;
alter table public.notificaciones_dashboard add column if not exists datos jsonb;

-- ─── 1. Ajustes ─────────────────────────────────────────────────────────────

create table if not exists public.instagram_story_tapas_ajustes (
  id boolean primary key default true check (id),
  activa boolean not null default true,
  hora time not null default '12:00',
  plantilla text not null default 'ct-tapas' check (plantilla in ('ct-tapas', 'ct-tapas-clasica')),
  -- Id de la foto de la biblioteca («drive:<id>», «carta:<id>», «vino:<id>» o del catálogo); null = la de siempre (ct-salon-5).
  foto text check (foto is null or (char_length(foto) between 1 and 200 and foto ~ '^[A-Za-z0-9:_.-]+$')),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.instagram_story_tapas_ajustes (id) values (true) on conflict (id) do nothing;

create or replace function public.instagram_story_tapas_ajustes_tocar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.id := true;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
drop trigger if exists instagram_story_tapas_ajustes_tocar on public.instagram_story_tapas_ajustes;
create trigger instagram_story_tapas_ajustes_tocar before update on public.instagram_story_tapas_ajustes
  for each row execute function public.instagram_story_tapas_ajustes_tocar();

alter table public.instagram_story_tapas_ajustes enable row level security;
revoke all on public.instagram_story_tapas_ajustes from anon, authenticated;
grant select on public.instagram_story_tapas_ajustes to authenticated;
grant update (activa, hora, plantilla, foto) on public.instagram_story_tapas_ajustes to authenticated;
grant all on public.instagram_story_tapas_ajustes to service_role;
drop policy if exists instagram_story_tapas_ajustes_leer on public.instagram_story_tapas_ajustes;
create policy instagram_story_tapas_ajustes_leer on public.instagram_story_tapas_ajustes
  for select to authenticated using ((select public.can_read_section('marketing')));
drop policy if exists instagram_story_tapas_ajustes_editar on public.instagram_story_tapas_ajustes;
create policy instagram_story_tapas_ajustes_editar on public.instagram_story_tapas_ajustes
  for update to authenticated
  using ((select public.can_edit_section('marketing')))
  with check ((select public.can_edit_section('marketing')));

-- ─── 2. Una story por semana ────────────────────────────────────────────────

create table if not exists public.instagram_story_tapas (
  semana date primary key check (extract(isodow from semana) = 1),
  fecha_tapas date not null,
  tapas jsonb not null default '[]'::jsonb check (jsonb_typeof(tapas) = 'array'),
  huella text check (huella is null or char_length(huella) <= 120),
  plantilla text check (plantilla is null or plantilla in ('ct-tapas', 'ct-tapas-clasica')),
  pieza_id uuid references public.instagram_piezas (id) on delete set null,
  programacion_id uuid references public.instagram_programaciones (id) on delete set null,
  programada_para timestamptz,
  estado text not null default 'preparando' check (estado in ('preparando', 'programada', 'publicada', 'cancelada', 'error')),
  error text check (error is null or char_length(error) <= 1000),
  bloqueo_hasta timestamptz,
  publicada_at timestamptz,
  creado_por uuid,
  actualizado_por uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint instagram_story_tapas_fecha_en_semana check (fecha_tapas >= semana and fecha_tapas < semana + 7)
);
create unique index if not exists instagram_story_tapas_pieza_uq on public.instagram_story_tapas (pieza_id) where pieza_id is not null;

alter table public.instagram_story_tapas enable row level security;
revoke all on public.instagram_story_tapas from anon, authenticated;
grant select on public.instagram_story_tapas to authenticated;
grant all on public.instagram_story_tapas to service_role;
drop policy if exists instagram_story_tapas_leer on public.instagram_story_tapas;
create policy instagram_story_tapas_leer on public.instagram_story_tapas
  for select to authenticated using ((select public.can_read_section('marketing')));

-- ─── 3. RPC ─────────────────────────────────────────────────────────────────

create or replace function public.instagram_story_tapas_permiso(p_editar boolean default true)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
     or (p_editar and not coalesce(public.can_edit_section('marketing'), false))
     or (not p_editar and not coalesce(public.can_read_section('marketing'), false)) then
    raise exception 'Sin permiso de Marketing (hace falta «%»)', case when p_editar then 'Editar' else 'Ver' end using errcode = '42501';
  end if;
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    if not coalesce((select private.sesion_panel_permitida()), false) then
      raise exception 'Sesión de panel no válida' using errcode = '42501';
    end if;
  end if;
end;
$$;

-- Pone la fila al día con la pieza y la programación reales (sin permisos: interna).
create or replace function public.instagram_story_tapas_sincronizar(p_semana date)
returns public.instagram_story_tapas
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.instagram_story_tapas;
  v_pieza public.instagram_piezas;
  v_prog public.instagram_programaciones;
  v_estado text;
begin
  select * into v from public.instagram_story_tapas where semana = p_semana;
  if v.semana is null or v.estado = 'publicada' then return v; end if;
  if v.pieza_id is not null then
    select * into v_pieza from public.instagram_piezas where id = v.pieza_id;
  end if;
  if v.programacion_id is not null then
    select * into v_prog from public.instagram_programaciones where id = v.programacion_id;
  end if;
  v_estado := v.estado;
  if v_pieza.id is not null and (v_pieza.estado = 'publicada' or v_pieza.publicada_at is not null) then
    v_estado := 'publicada';
  elsif v_prog.id is not null and v_prog.estado = 'publicada' then
    v_estado := 'publicada';
  elsif v.bloqueo_hasta is not null and v.bloqueo_hasta > now() then
    return v; -- alguien la está rehaciendo: no se toca
  elsif v_prog.id is not null and v_prog.estado in ('programada', 'publicando') then
    v_estado := 'programada';
  elsif v_prog.id is not null and v_prog.estado = 'cancelada' then
    v_estado := 'cancelada';
  elsif v_prog.id is not null and v_prog.estado = 'error' then
    v_estado := 'error';
  end if;
  update public.instagram_story_tapas
     set estado = v_estado,
         programada_para = coalesce(v_prog.programada_para, programada_para),
         publicada_at = case when v_estado = 'publicada' then coalesce(v_pieza.publicada_at, publicada_at, now()) else publicada_at end,
         error = case when v_estado = 'error' then coalesce(v_prog.ultimo_error, error) else error end,
         updated_at = case when v_estado is distinct from v.estado or v_prog.programada_para is distinct from v.programada_para then now() else updated_at end
   where semana = p_semana
  returning * into v;
  return v;
end;
$$;

create or replace function public.instagram_story_tapas_reclamar(p_fecha date, p_huella text, p_manual boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_semana date;
  v public.instagram_story_tapas;
  v_accion text;
begin
  perform public.instagram_story_tapas_permiso(true);
  if p_fecha is null then raise exception 'Falta la fecha de las tapas' using errcode = '22023'; end if;
  if p_huella is null or char_length(p_huella) > 120 then raise exception 'Huella no válida' using errcode = '22023'; end if;
  v_semana := date_trunc('week', p_fecha::timestamp)::date;

  insert into public.instagram_story_tapas (semana, fecha_tapas, creado_por, actualizado_por)
  values (v_semana, p_fecha, auth.uid(), auth.uid())
  on conflict (semana) do nothing;
  perform 1 from public.instagram_story_tapas where semana = v_semana for update;
  v := public.instagram_story_tapas_sincronizar(v_semana);

  -- Lo mismo que decidirAccion (src/lib/instagram/tapas.ts).
  if v.estado = 'publicada' then
    v_accion := 'nada';
  elsif v.bloqueo_hasta is not null and v.bloqueo_hasta > now() then
    v_accion := 'nada';
  elsif v.estado = 'cancelada' then
    v_accion := case when not coalesce(p_manual, false) then 'nada' when v.pieza_id is null then 'crear' else 'regenerar' end;
  elsif v.pieza_id is null then
    v_accion := 'crear';
  elsif coalesce(p_manual, false) then
    v_accion := 'regenerar';
  elsif v.huella = p_huella and v.estado = 'programada' then
    v_accion := 'nada';
  elsif v.estado in ('programada', 'error') then
    v_accion := 'regenerar';
  else
    -- «preparando» con pieza: un «Publicar ahora» a medias. El automático no la toca.
    v_accion := 'nada';
  end if;

  if v_accion <> 'nada' then
    update public.instagram_story_tapas
       set bloqueo_hasta = now() + interval '3 minutes', fecha_tapas = p_fecha, actualizado_por = auth.uid(), updated_at = now()
     where semana = v_semana
    returning * into v;
  end if;
  return jsonb_build_object('accion', v_accion, 'fila', to_jsonb(v));
end;
$$;

create or replace function public.instagram_story_tapas_registrar(
  p_semana date,
  p_pieza_id uuid,
  p_programacion_id uuid,
  p_huella text,
  p_tapas jsonb,
  p_plantilla text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.instagram_story_tapas;
  v_pieza public.instagram_piezas;
  v_prog public.instagram_programaciones;
  v_cuando text;
begin
  perform public.instagram_story_tapas_permiso(true);
  select * into v from public.instagram_story_tapas where semana = p_semana for update;
  if v.semana is null then raise exception 'No hay story de tapas para esa semana' using errcode = 'P0002'; end if;
  if v.estado = 'publicada' then raise exception 'La story de tapas de esa semana ya está publicada' using errcode = '55000'; end if;
  select * into v_pieza from public.instagram_piezas where id = p_pieza_id;
  if v_pieza.id is null or v_pieza.marca <> 'casa-tomas' or v_pieza.formato <> 'story' then
    raise exception 'La pieza no es una story de Casa Tomás' using errcode = '22023';
  end if;
  if v.pieza_id is not null and v.pieza_id <> p_pieza_id and exists (
       select 1 from public.instagram_piezas where id = v.pieza_id and (estado = 'publicada' or publicada_at is not null)) then
    raise exception 'La story de tapas de esa semana ya está publicada' using errcode = '55000';
  end if;
  if p_programacion_id is not null then
    select * into v_prog from public.instagram_programaciones where id = p_programacion_id and pieza_id = p_pieza_id;
    if v_prog.id is null then raise exception 'La programación no es de esa pieza' using errcode = '22023'; end if;
  end if;
  if p_tapas is null or jsonb_typeof(p_tapas) <> 'array' then raise exception 'Tapas no válidas' using errcode = '22023'; end if;

  update public.instagram_story_tapas
     set pieza_id = p_pieza_id,
         programacion_id = p_programacion_id,
         programada_para = v_prog.programada_para,
         huella = p_huella,
         tapas = p_tapas,
         plantilla = p_plantilla,
         -- Sin programación = «Publicar ahora» en marcha: «preparando» (el automático no la toca).
         estado = case when v_prog.id is not null then 'programada' else 'preparando' end,
         error = null,
         bloqueo_hasta = null,
         actualizado_por = auth.uid(),
         updated_at = now()
   where semana = p_semana;
  v := public.instagram_story_tapas_sincronizar(p_semana);

  -- Aviso en la campana (uno por semana: se reescribe y vuelve a «sin leer»).
  if v_prog.id is not null and v.estado = 'programada' then
    v_cuando := to_char(v_prog.programada_para at time zone 'Europe/Madrid', 'DD/MM "a las" HH24:MI');
    insert into public.notificaciones_dashboard (tipo, titulo, mensaje, referencia_id, referencia_tipo, clave, datos, leida)
    values (
      'instagram_story_tapas',
      'Story del jueves de tapas programada',
      format('Se publicará el %s con %s tapas.', v_cuando, jsonb_array_length(p_tapas)),
      p_pieza_id,
      'instagram_story_tapas',
      'instagram_story_tapas:' || p_semana::text,
      jsonb_build_object('semana', p_semana, 'piezaId', p_pieza_id, 'programacionId', p_programacion_id, 'programadaPara', v_prog.programada_para),
      false
    )
    on conflict (clave) where clave is not null do update
      set titulo = excluded.titulo, mensaje = excluded.mensaje, referencia_id = excluded.referencia_id,
          datos = excluded.datos, leida = false, created_at = now();
  end if;
  return jsonb_build_object('ok', true, 'fila', to_jsonb(v));
end;
$$;

create or replace function public.instagram_story_tapas_fallo(p_semana date, p_error text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.instagram_story_tapas;
begin
  perform public.instagram_story_tapas_permiso(true);
  update public.instagram_story_tapas
     set estado = case when estado in ('publicada', 'cancelada') then estado else 'error' end,
         error = left(coalesce(p_error, 'Error desconocido'), 1000),
         bloqueo_hasta = null, actualizado_por = auth.uid(), updated_at = now()
   where semana = p_semana
  returning * into v;
  return jsonb_build_object('ok', v.semana is not null, 'fila', to_jsonb(v));
end;
$$;

create or replace function public.instagram_story_tapas_cancelar(p_semana date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.instagram_story_tapas;
begin
  perform public.instagram_story_tapas_permiso(true);
  select * into v from public.instagram_story_tapas where semana = p_semana for update;
  if v.semana is null then raise exception 'No hay story de tapas para esa semana' using errcode = 'P0002'; end if;
  v := public.instagram_story_tapas_sincronizar(p_semana);
  if v.estado = 'publicada' then raise exception 'Ya está publicada: no se puede cancelar' using errcode = '55000'; end if;
  if v.programacion_id is not null then
    if exists (select 1 from public.instagram_programaciones where id = v.programacion_id and estado = 'publicando') then
      raise exception 'Se está publicando ahora mismo; ya no se puede cancelar' using errcode = '55006';
    end if;
    update public.instagram_programaciones
       set estado = 'cancelada', cancelada_at = now(), cancelada_por = auth.uid()
     where id = v.programacion_id and estado in ('programada', 'error');
  end if;
  update public.instagram_story_tapas
     set estado = 'cancelada', bloqueo_hasta = null, actualizado_por = auth.uid(), updated_at = now()
   where semana = p_semana
  returning * into v;
  update public.notificaciones_dashboard
     set leida = true, titulo = 'Story del jueves de tapas cancelada'
   where clave = 'instagram_story_tapas:' || p_semana::text;
  return jsonb_build_object('ok', true, 'fila', to_jsonb(v));
end;
$$;

create or replace function public.instagram_story_tapas_ver(p_semana date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.instagram_story_tapas;
begin
  perform public.instagram_story_tapas_permiso(false);
  v := public.instagram_story_tapas_sincronizar(p_semana);
  return case when v.semana is null then null else to_jsonb(v) end;
end;
$$;

revoke all on function public.instagram_story_tapas_permiso(boolean) from public, anon;
revoke all on function public.instagram_story_tapas_sincronizar(date) from public, anon, authenticated;
revoke all on function public.instagram_story_tapas_reclamar(date, text, boolean) from public, anon;
revoke all on function public.instagram_story_tapas_registrar(date, uuid, uuid, text, jsonb, text) from public, anon;
revoke all on function public.instagram_story_tapas_fallo(date, text) from public, anon;
revoke all on function public.instagram_story_tapas_cancelar(date) from public, anon;
revoke all on function public.instagram_story_tapas_ver(date) from public, anon;
grant execute on function public.instagram_story_tapas_permiso(boolean) to authenticated;
grant execute on function public.instagram_story_tapas_reclamar(date, text, boolean) to authenticated;
grant execute on function public.instagram_story_tapas_registrar(date, uuid, uuid, text, jsonb, text) to authenticated;
grant execute on function public.instagram_story_tapas_fallo(date, text) to authenticated;
grant execute on function public.instagram_story_tapas_cancelar(date) to authenticated;
grant execute on function public.instagram_story_tapas_ver(date) to authenticated;
grant execute on function public.instagram_story_tapas_sincronizar(date) to service_role;

select 'instagram_story_tapas: aplicada' as resultado;
