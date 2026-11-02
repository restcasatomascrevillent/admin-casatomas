-- Recorte de fotos de la carta en un ordenador (sin Replicate) — 02/11/2026
-- ---------------------------------------------------------------------------
-- El móvil guarda la foto ORIGINAL en la ficha (Platos, Vinos, Bebidas o
-- Cocteles) y, si no puede recortarla él mismo en el navegador (error, falta
-- de memoria, pestaña cerrada por iOS o dispositivo ya marcado como «no
-- recorta»), crea aquí un trabajo. Un ordenador con el panel abierto lo ve por
-- sondeo (cada 60 s), lo reclama con `reclamar_trabajo_recorte()`, recorta la
-- foto con el fondo elegido (`tema`), guarda la foto compuesta en la ficha y
-- lo cierra con `terminar_trabajo_recorte()`. La Edge Function
-- `notificar-video` (con `tipo: "recorte"`) avisa por Web Push al que la subió
-- (suscripciones de `suscripciones_push`, migración 20261101160000).
--
-- Es el mismo esquema que trabajos_video, pero polimórfico: `tabla` +
-- `registro_id` (validado por trigger: la ficha tiene que existir) en vez de
-- una FK a Platos. La foto NO se copia: `ruta_original` es la ruta de la foto
-- ya guardada en el bucket de la tabla (`<id>.<ext>`).
--
-- Permisos: sección `gestor_carta` (can_write_section) + la restrictiva
-- `acceso_panel_no_bloqueado` (sesión de panel viva, usuario no bloqueado) si
-- existe private.sesion_panel_permitida(). Igual que trabajos_video.
--
-- El panel funciona sin esta migración: si la tabla no existe (PGRST205 /
-- 42P01) la foto se queda guardada sin recortar y se avisa como antes.
--
-- Idempotente (if not exists / drop policy if exists / create or replace).
-- ROLLBACK: supabase/rollbacks/20261102160000_trabajos_recorte_ROLLBACK.sql.
-- ---------------------------------------------------------------------------

create table if not exists public.trabajos_recorte (
  id                  uuid primary key default gen_random_uuid(),
  tabla               text not null,
  registro_id         text not null,
  nombre              text,
  ruta_original       text not null,
  tema                text not null default 'cartulina',
  estado              text not null default 'pendiente',
  creado_por          uuid default auth.uid() references auth.users(id) on delete set null,
  dispositivo_origen  text,
  procesado_por       uuid references auth.users(id) on delete set null,
  dispositivo_proceso text,
  reclamado_en        timestamptz,
  intentos            integer not null default 0,
  error               text,
  terminado_en        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint trabajos_recorte_tabla_chk check (tabla in ('Platos', 'Vinos', 'Bebidas', 'Cocteles')),
  constraint trabajos_recorte_registro_chk check (length(registro_id) between 1 and 100),
  -- Solo un fichero en la raíz del bucket de la tabla (`<id>.<ext>`), sin carpetas ni «..».
  constraint trabajos_recorte_ruta_chk check (ruta_original ~ '^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,150}\.[a-z0-9]{1,5}$' and position('..' in ruta_original) = 0),
  constraint trabajos_recorte_estado_chk check (estado in ('pendiente', 'procesando', 'listo', 'error')),
  constraint trabajos_recorte_tema_chk check (tema ~ '^[a-z_]{1,40}$'),
  constraint trabajos_recorte_textos_chk check (
    coalesce(length(nombre), 0) <= 200
    and coalesce(length(dispositivo_origen), 0) <= 200 and coalesce(length(dispositivo_proceso), 0) <= 200
    and coalesce(length(error), 0) <= 1000)
);

comment on table public.trabajos_recorte is
  'Fotos de la carta guardadas sin recortar desde un móvil, pendientes de recortar en un ordenador con el panel abierto.';

-- Un solo trabajo vivo por ficha.
create unique index if not exists trabajos_recorte_un_vivo_por_ficha
  on public.trabajos_recorte (tabla, registro_id) where estado in ('pendiente', 'procesando');
create index if not exists trabajos_recorte_vivos_idx
  on public.trabajos_recorte (created_at) where estado in ('pendiente', 'procesando');
create index if not exists trabajos_recorte_creado_por_idx on public.trabajos_recorte (creado_por);

-- La ficha tiene que existir (no hay FK posible: la tabla es variable).
create or replace function public.trabajos_recorte_validar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existe boolean;
begin
  if new.tabla not in ('Platos', 'Vinos', 'Bebidas', 'Cocteles') then
    raise exception 'Tabla no admitida: %', new.tabla using errcode = '23514';
  end if;
  execute format('select exists (select 1 from public.%I where id::text = $1)', new.tabla)
    into v_existe using new.registro_id;
  if not v_existe then
    raise exception 'La ficha % de % no existe', new.registro_id, new.tabla using errcode = '23503';
  end if;
  return new;
end $$;
revoke all on function public.trabajos_recorte_validar() from public, anon, authenticated;

drop trigger if exists trabajos_recorte_validar on public.trabajos_recorte;
create trigger trabajos_recorte_validar
  before insert or update of tabla, registro_id on public.trabajos_recorte
  for each row execute function public.trabajos_recorte_validar();

alter table public.trabajos_recorte enable row level security;
revoke all on public.trabajos_recorte from anon, authenticated;
grant select, insert, delete on public.trabajos_recorte to authenticated;
grant all on public.trabajos_recorte to service_role;

drop policy if exists trabajos_recorte_select_seccion on public.trabajos_recorte;
create policy trabajos_recorte_select_seccion on public.trabajos_recorte
  for select to authenticated
  using ( (select public.can_write_section('gestor_carta')) );

-- Solo se crea en estado inicial y a nombre propio; el resto lo cambian las RPC.
drop policy if exists trabajos_recorte_insert_seccion on public.trabajos_recorte;
create policy trabajos_recorte_insert_seccion on public.trabajos_recorte
  for insert to authenticated
  with check (
    (select public.can_write_section('gestor_carta'))
    and creado_por = (select auth.uid())
    and estado = 'pendiente' and procesado_por is null and reclamado_en is null
    and intentos = 0 and error is null and terminado_en is null
  );

-- Cancelar un pendiente o limpiar uno terminado (no uno que se está procesando).
drop policy if exists trabajos_recorte_delete_seccion on public.trabajos_recorte;
create policy trabajos_recorte_delete_seccion on public.trabajos_recorte
  for delete to authenticated
  using ( (select public.can_write_section('gestor_carta')) and estado <> 'procesando' );

drop policy if exists trabajos_recorte_service_role on public.trabajos_recorte;
create policy trabajos_recorte_service_role on public.trabajos_recorte
  for all to service_role using (true) with check (true);

do $$
begin
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    execute 'drop policy if exists "acceso_panel_no_bloqueado" on public.trabajos_recorte';
    execute 'create policy "acceso_panel_no_bloqueado" on public.trabajos_recorte as restrictive for all to authenticated
      using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()))';
  end if;
end $$;

-- RPC ------------------------------------------------------------------------
create or replace function public.trabajos_recorte_permiso()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.can_write_section('gestor_carta') then
    raise exception 'Sin permiso de carta' using errcode = '42501';
  end if;
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    if not coalesce((select private.sesion_panel_permitida()), false) then
      raise exception 'Sesión de panel no válida' using errcode = '42501';
    end if;
  end if;
end $$;
revoke all on function public.trabajos_recorte_permiso() from public, anon;
grant execute on function public.trabajos_recorte_permiso() to authenticated, service_role;

-- Reclama UN trabajo de forma atómica (el indicado o el pendiente más antiguo,
-- o uno 'procesando' abandonado hace más de 10 min). FOR UPDATE SKIP LOCKED.
create or replace function public.reclamar_trabajo_recorte(p_id uuid default null, p_dispositivo text default null)
returns setof public.trabajos_recorte
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform public.trabajos_recorte_permiso();
  select t.id into v_id
    from public.trabajos_recorte t
   where (p_id is null or t.id = p_id)
     and (t.estado = 'pendiente'
          or (t.estado = 'procesando' and t.reclamado_en < now() - interval '10 minutes'))
   order by t.created_at
   limit 1
   for update skip locked;
  if v_id is null then
    return;
  end if;
  return query
    update public.trabajos_recorte t
       set estado = 'procesando',
           procesado_por = auth.uid(),
           dispositivo_proceso = left(p_dispositivo, 200),
           reclamado_en = now(),
           intentos = t.intentos + 1,
           error = null,
           updated_at = now()
     where t.id = v_id
    returning t.*;
end $$;
revoke all on function public.reclamar_trabajo_recorte(uuid, text) from public, anon;
grant execute on function public.reclamar_trabajo_recorte(uuid, text) to authenticated, service_role;

create or replace function public.terminar_trabajo_recorte(p_id uuid, p_ok boolean, p_error text default null)
returns public.trabajos_recorte
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.trabajos_recorte;
begin
  perform public.trabajos_recorte_permiso();
  update public.trabajos_recorte t
     set estado = case when p_ok then 'listo' else 'error' end,
         error = case when p_ok then null else left(coalesce(nullif(p_error, ''), 'Error al recortar'), 1000) end,
         terminado_en = now(),
         updated_at = now()
   where t.id = p_id and t.estado = 'procesando' and t.procesado_por = auth.uid()
  returning t.* into v;
  if v.id is null then
    raise exception 'El trabajo no existe o no lo está procesando este usuario' using errcode = 'P0002';
  end if;
  return v;
end $$;
revoke all on function public.terminar_trabajo_recorte(uuid, boolean, text) from public, anon;
grant execute on function public.terminar_trabajo_recorte(uuid, boolean, text) to authenticated, service_role;

create or replace function public.soltar_trabajo_recorte(p_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.trabajos_recorte_permiso();
  update public.trabajos_recorte t
     set estado = 'pendiente', procesado_por = null, dispositivo_proceso = null,
         reclamado_en = null, updated_at = now()
   where t.id = p_id and t.estado = 'procesando' and t.procesado_por = auth.uid();
  return found;
end $$;
revoke all on function public.soltar_trabajo_recorte(uuid) from public, anon;
grant execute on function public.soltar_trabajo_recorte(uuid) to authenticated, service_role;
