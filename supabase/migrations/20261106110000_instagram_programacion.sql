set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261106110000_instagram_programacion — Programar publicaciones (06/11/2026)
-- ===========================================================================
-- La API de Instagram NO programa publicaciones: lo hacemos nosotros. Quien
-- tiene Marketing elige fecha y hora (Europe/Madrid) para una pieza ya
-- generada; pg_cron llama cada 5 minutos a la Edge Function
-- instagram-programador, que publica las vencidas con el MISMO núcleo que
-- instagram-publicar (contenedor creado en el momento: caduca a las 24 h).
-- Ver docs/instagram-programar.md.
--
-- POR QUÉ UNA TABLA APARTE (y no columnas en instagram_piezas)
--   * instagram_piezas.estado lo reescriben instagram-publicar («error»,
--     «prueba_ok», «publicada») y el render («generada»). Un estado
--     «programada» ahí se pisaría en cuanto alguien regenera o prueba la
--     pieza, o en el primer intento fallido del programador.
--   * Bloqueo (lease), intentos, próximo intento y contenedor en curso son
--     cosas de la tarea, no de la pieza. Así quedan el historial
--     (reprogramada, cancelada, error) y la pieza no cambia de forma.
--   * Las escrituras van solo por RPC (validación en el servidor): la tabla
--     no da INSERT/UPDATE/DELETE a authenticated.
--
-- QUÉ CREA
--   1. instagram_piezas.publicada_at (la pone un trigger al pasar a
--      «publicada»; relleno con updated_at para las ya publicadas) e índice:
--      para pintar las publicadas en el calendario.
--   2. public.instagram_programaciones: pieza, marca (copiada de la pieza),
--      programada_para, estado (programada → publicando → publicada, o
--      error / cancelada), intentos (≤ 3), siguiente_intento_at,
--      ultimo_error, contenedor_id (solo el que dejó el programador a medias),
--      bloqueo (bloqueo_id + bloqueada_hasta), media_id, permalink.
--      Una sola activa (programada/publicando) por pieza (índice único
--      parcial). Índice de pendientes (siguiente_intento_at) WHERE
--      estado = 'programada'. RLS: leer con can_read_section('marketing') y
--      sesión de panel viva; escribir SOLO por las RPC. SE AUDITA.
--   3. RPC del panel (SECURITY DEFINER, can_write_section('marketing') +
--      sesión de panel viva):
--        instagram_programar(pieza, para, confirmar_conflicto)  crea o mueve
--        instagram_reprogramar(programación, para, confirmar)   mueve (también
--                                                               una en error)
--        instagram_cancelar_programacion(programación)
--      Validan: fecha ≥ ahora + 10 min y ≤ ahora + 75 días; la pieza existe,
--      tiene JPEG y no está publicada; no se toca una que se está publicando.
--      Si en ±30 min ya hay otra programada de la MISMA marca devuelven
--      { ok:false, requiereConfirmacion:true, conflictos } sin cambiar nada,
--      salvo con confirmar_conflicto = true.
--   4. RPC del programador (solo service_role):
--        instagram_programador_reclamar(lease_seg)  reclama UNA vencida con
--          FOR UPDATE SKIP LOCKED y le pone un bloqueo con caducidad. Antes
--          cierra los bloqueos caducados SIN volver a publicar (la pasada que
--          los tenía pudo publicar): publicada si la pieza ya tiene media_id;
--          si no, error para que una persona lo compruebe.
--        instagram_programador_cerrar(…)  publicada / reintentar (cuenta un
--          intento; al 3.º, error) / aplazar (cuota agotada: no cuenta) /
--          error (definitivo). Exige el bloqueo de la pasada.
--   5. pg_cron «instagram-programador» cada 5 minutos: net.http_post a
--      <project_url>/functions/v1/instagram-programador con la cabecera
--      x-webhook-secret. URL y secreto salen de Vault en cada ejecución (el
--      mismo patrón que sync-trafico-web, 20261101093800):
--        'project_url'                   https://<ref>.supabase.co
--        'instagram_programador_secret'  el MISMO valor que el secreto
--                                        INSTAGRAM_PROGRAMADOR_SECRET de la función
--      MUDO mientras falte cualquiera de los dos (0 filas en el FROM, como el
--      cron del OCR) y solo llama cuando hay trabajo vencido.
--
-- APLICAR (una a una, nunca `db push`), DESPUÉS de 20261105090000_instagram:
-- demo primero (sfonaclosuafvlhutkon), producción (haqmmdfdzzatdnrrcgez) solo
-- tras aceptar el PR y con el «sí» del dueño:
--   npx supabase db query --linked -f supabase/migrations/20261106110000_instagram_programacion.sql
-- Idempotente. Tiene que terminar en «instagram_programacion: aplicada | …».
-- Deshacer: supabase/rollbacks/20261106110000_instagram_programacion_ROLLBACK.sql
-- Pruebas: npm run test:instagram-programar:db (PGlite).
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- ─── 0. Comprobaciones previas (no cambian nada) ────────────────────────────
do $$
declare
  v_faltan text[] := '{}';
begin
  if to_regclass('public.instagram_piezas') is null then
    v_faltan := v_faltan || 'public.instagram_piezas (aplica antes 20261105090000_instagram.sql)'::text;
  end if;
  if to_regprocedure('public.can_read_section(text)') is null then
    v_faltan := v_faltan || 'public.can_read_section(text)'::text;
  end if;
  if to_regprocedure('public.can_write_section(text)') is null then
    v_faltan := v_faltan || 'public.can_write_section(text)'::text;
  end if;
  if to_regclass('cron.job') is null then
    v_faltan := v_faltan || 'pg_cron (cron.job)'::text;
  end if;
  if to_regnamespace('net') is null then
    v_faltan := v_faltan || 'pg_net (esquema net)'::text;
  end if;
  if to_regclass('vault.decrypted_secrets') is null then
    v_faltan := v_faltan || 'Vault (vault.decrypted_secrets)'::text;
  end if;
  if cardinality(v_faltan) > 0 then
    raise exception 'instagram_programacion: falta %. No se ha cambiado nada.', array_to_string(v_faltan, ', ');
  end if;
end;
$$;

-- ─── 1. instagram_piezas.publicada_at ───────────────────────────────────────
alter table public.instagram_piezas add column if not exists publicada_at timestamptz;
comment on column public.instagram_piezas.publicada_at is
  'Cuándo pasó a «publicada» (trigger instagram_piezas_marcar_publicada; no se puede falsear). Para el calendario.';

-- Relleno de las ya publicadas ANTES de crear el trigger y sin mover su
-- updated_at (el trigger de edición pondría now()).
drop trigger if exists instagram_piezas_marcar_publicada on public.instagram_piezas;
alter table public.instagram_piezas disable trigger instagram_piezas_al_editar;
update public.instagram_piezas set publicada_at = updated_at
 where estado = 'publicada' and publicada_at is null;
alter table public.instagram_piezas enable trigger instagram_piezas_al_editar;

create or replace function public.instagram_piezas_marcar_publicada()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.estado = 'publicada' then
    if tg_op = 'INSERT' or old.estado is distinct from 'publicada' then
      new.publicada_at := now();
    else
      new.publicada_at := old.publicada_at;
    end if;
  else
    new.publicada_at := null;
  end if;
  return new;
end;
$$;
revoke all on function public.instagram_piezas_marcar_publicada() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.instagram_piezas_marcar_publicada() from anon, authenticated';
  end if;
end;
$$;
create trigger instagram_piezas_marcar_publicada
  before insert or update on public.instagram_piezas
  for each row execute function public.instagram_piezas_marcar_publicada();

create index if not exists instagram_piezas_publicada_at_idx
  on public.instagram_piezas (publicada_at) where publicada_at is not null;

-- ─── 2. Tabla de programaciones ─────────────────────────────────────────────
create table if not exists public.instagram_programaciones (
  id                    uuid primary key default gen_random_uuid(),
  pieza_id              uuid not null references public.instagram_piezas (id) on delete cascade,
  marca                 text not null,
  programada_para       timestamptz not null,
  estado                text not null default 'programada',
  intentos              smallint not null default 0,
  siguiente_intento_at  timestamptz not null,
  ultimo_intento_at     timestamptz,
  ultimo_error          text,
  contenedor_id         text,
  bloqueo_id            uuid,
  bloqueada_hasta       timestamptz,
  media_id              text,
  permalink             text,
  publicada_at          timestamptz,
  creado_por            uuid default auth.uid() references auth.users (id) on delete set null,
  cancelada_por         uuid references auth.users (id) on delete set null,
  cancelada_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint instagram_programaciones_estado_chk check (estado in ('programada', 'publicando', 'publicada', 'error', 'cancelada')),
  constraint instagram_programaciones_marca_chk check (marca in ('casa-tomas', 'touza')),
  constraint instagram_programaciones_intentos_chk check (intentos between 0 and 3),
  constraint instagram_programaciones_bloqueo_chk check (
    (estado = 'publicando') = (bloqueo_id is not null and bloqueada_hasta is not null)),
  constraint instagram_programaciones_publicada_chk check (estado <> 'publicada' or publicada_at is not null),
  constraint instagram_programaciones_contenedor_chk check (contenedor_id is null or contenedor_id ~ '^[0-9]{1,40}$'),
  constraint instagram_programaciones_textos_chk check (
    coalesce(char_length(ultimo_error), 0) <= 1000
    and coalesce(char_length(media_id), 0) <= 200 and coalesce(char_length(permalink), 0) <= 500)
);
comment on table public.instagram_programaciones is
  'Publicaciones programadas de instagram_piezas. Las publica la Edge Function instagram-programador (pg_cron cada 5 min). '
  'Escritura solo por RPC (instagram_programar, instagram_reprogramar, instagram_cancelar_programacion; el programador con service_role). Se audita.';
comment on column public.instagram_programaciones.programada_para is 'Instante elegido (el panel lo pide en hora de Europe/Madrid).';
comment on column public.instagram_programaciones.estado is 'programada → publicando → publicada; error (3 intentos o fallo definitivo) o cancelada.';
comment on column public.instagram_programaciones.siguiente_intento_at is 'Cuándo puede reclamarla el programador (= programada_para, o más tarde tras un reintento o un aplazamiento).';
comment on column public.instagram_programaciones.contenedor_id is 'Contenedor de Meta que dejó a medias el programador (Meta aún procesaba); se reutiliza en la siguiente pasada.';
comment on column public.instagram_programaciones.bloqueo_id is 'Bloqueo de la pasada que la está publicando (solo en «publicando»).';

create unique index if not exists instagram_programaciones_activa_uq
  on public.instagram_programaciones (pieza_id) where estado in ('programada', 'publicando');
create index if not exists instagram_programaciones_pendientes_idx
  on public.instagram_programaciones (siguiente_intento_at) where estado = 'programada';
create index if not exists instagram_programaciones_marca_fecha_idx
  on public.instagram_programaciones (marca, programada_para);
create index if not exists instagram_programaciones_pieza_idx
  on public.instagram_programaciones (pieza_id);

create or replace function public.instagram_programaciones_al_editar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.creado_por := old.creado_por;
    new.created_at := old.created_at;
    new.pieza_id := old.pieza_id;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.instagram_programaciones_al_editar() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.instagram_programaciones_al_editar() from anon, authenticated';
  end if;
end;
$$;
drop trigger if exists instagram_programaciones_al_editar on public.instagram_programaciones;
create trigger instagram_programaciones_al_editar
  before insert or update on public.instagram_programaciones
  for each row execute function public.instagram_programaciones_al_editar();

-- Auditoría: el mismo trigger que instala instalar_auditoria_panel().
do $$
begin
  if to_regprocedure('public.fn_registrar_auditoria()') is not null
     and not exists (select 1 from pg_trigger
                      where tgrelid = 'public.instagram_programaciones'::regclass
                        and tgfoid = 'public.fn_registrar_auditoria()'::regprocedure
                        and not tgisinternal) then
    execute 'drop trigger if exists trg_auditoria on public.instagram_programaciones';
    execute 'create trigger trg_auditoria after insert or update or delete on public.instagram_programaciones
             for each row execute function public.fn_registrar_auditoria()';
  end if;
end;
$$;

-- RLS: el panel solo LEE (marketing); todo cambio pasa por las RPC.
alter table public.instagram_programaciones enable row level security;
revoke all on public.instagram_programaciones from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.instagram_programaciones from anon, authenticated';
    execute 'grant select on public.instagram_programaciones to authenticated';
    execute 'grant all on public.instagram_programaciones to service_role';
  end if;
end;
$$;

drop policy if exists instagram_programaciones_select_seccion on public.instagram_programaciones;
create policy instagram_programaciones_select_seccion on public.instagram_programaciones
  for select to authenticated using ((select public.can_read_section('marketing')));
drop policy if exists instagram_programaciones_service_role on public.instagram_programaciones;
create policy instagram_programaciones_service_role on public.instagram_programaciones
  for all to service_role using (true) with check (true);

do $$
begin
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    execute 'drop policy if exists "acceso_panel_no_bloqueado" on public.instagram_programaciones';
    execute 'create policy "acceso_panel_no_bloqueado" on public.instagram_programaciones as restrictive for all to authenticated
      using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()))';
  end if;
end;
$$;

-- ─── 3. RPC del panel ───────────────────────────────────────────────────────

-- Marketing con edición y sesión de panel viva (mismo criterio que la RLS).
create or replace function public.instagram_programacion_permiso()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not coalesce(public.can_write_section('marketing'), false) then
    raise exception 'Sin permiso de Marketing' using errcode = '42501';
  end if;
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    if not coalesce((select private.sesion_panel_permitida()), false) then
      raise exception 'Sesión de panel no válida' using errcode = '42501';
    end if;
  end if;
end;
$$;

-- Ventana: como mínimo 10 minutos y como máximo 75 días desde ahora.
create or replace function public.instagram_programacion_validar_fecha(p_para timestamptz)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_para is null then
    raise exception 'Falta la fecha y la hora' using errcode = '22023';
  end if;
  if p_para < now() + interval '10 minutes' then
    raise exception 'Hay que programarla con al menos 10 minutos de margen' using errcode = '22023';
  end if;
  if p_para > now() + interval '75 days' then
    raise exception 'Como mucho se puede programar a 75 días vista' using errcode = '22023';
  end if;
end;
$$;

-- Otras programadas de la misma marca a ±30 min (sin contar la propia pieza).
create or replace function public.instagram_programacion_conflictos(p_marca text, p_para timestamptz, p_excluir_pieza uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'piezaId', p.pieza_id, 'programadaPara', p.programada_para)
                            order by p.programada_para), '[]'::jsonb)
    from public.instagram_programaciones p
   where p.marca = p_marca
     and p.estado in ('programada', 'publicando')
     and p.pieza_id is distinct from p_excluir_pieza
     and p.programada_para between p_para - interval '30 minutes' and p_para + interval '30 minutes';
$$;

-- La pieza se puede programar: existe, tiene JPEG y no está publicada.
create or replace function public.instagram_programacion_pieza(p_pieza_id uuid)
returns public.instagram_piezas
language plpgsql
volatile
set search_path = ''
as $$
declare
  v public.instagram_piezas;
begin
  select * into v from public.instagram_piezas where id = p_pieza_id for update;
  if not found then
    raise exception 'No existe esa pieza' using errcode = 'P0002';
  end if;
  if v.media_id is not null or v.estado = 'publicada' then
    raise exception 'Esa pieza ya está publicada' using errcode = '22023';
  end if;
  if v.imagen_ruta is null then
    raise exception 'La pieza no tiene imagen: genérala antes de programarla' using errcode = '22023';
  end if;
  return v;
end;
$$;

-- Mueve una programación pendiente o con error (reinicia intentos y error).
create or replace function public.instagram_reprogramar(p_id uuid, p_para timestamptz, p_confirmar_conflicto boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_prog public.instagram_programaciones;
  v_pieza public.instagram_piezas;
  v_conflictos jsonb;
begin
  perform public.instagram_programacion_permiso();
  perform public.instagram_programacion_validar_fecha(p_para);
  select * into v_prog from public.instagram_programaciones where id = p_id for update;
  if not found then
    raise exception 'No existe esa programación' using errcode = 'P0002';
  end if;
  if v_prog.estado = 'publicando' then
    raise exception 'Se está publicando ahora mismo; espera a que termine' using errcode = '55006';
  end if;
  if v_prog.estado in ('publicada', 'cancelada') then
    raise exception 'Esa programación ya está %; prográmala de nuevo desde la pieza', v_prog.estado using errcode = '22023';
  end if;
  v_pieza := public.instagram_programacion_pieza(v_prog.pieza_id);
  if v_prog.estado = 'error' and exists (
       select 1 from public.instagram_programaciones
        where pieza_id = v_prog.pieza_id and id <> v_prog.id and estado in ('programada', 'publicando')) then
    raise exception 'Esa pieza ya tiene otra programación pendiente' using errcode = '23505';
  end if;
  v_conflictos := public.instagram_programacion_conflictos(v_pieza.marca, p_para, v_pieza.id);
  if jsonb_array_length(v_conflictos) > 0 and not coalesce(p_confirmar_conflicto, false) then
    return jsonb_build_object('ok', false, 'requiereConfirmacion', true, 'conflictos', v_conflictos);
  end if;
  update public.instagram_programaciones
     set estado = 'programada', programada_para = p_para, siguiente_intento_at = p_para, marca = v_pieza.marca,
         intentos = 0, ultimo_error = null, contenedor_id = null, cancelada_at = null, cancelada_por = null
   where id = v_prog.id
  returning * into v_prog;
  return jsonb_build_object('ok', true, 'accion', 'reprogramada', 'programacion', to_jsonb(v_prog), 'conflictos', v_conflictos);
end;
$$;

-- Programa una pieza; si ya tiene una programación pendiente, la mueve.
create or replace function public.instagram_programar(p_pieza_id uuid, p_para timestamptz, p_confirmar_conflicto boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_pieza public.instagram_piezas;
  v_activa public.instagram_programaciones;
  v_conflictos jsonb;
  v_fila public.instagram_programaciones;
begin
  perform public.instagram_programacion_permiso();
  perform public.instagram_programacion_validar_fecha(p_para);
  v_pieza := public.instagram_programacion_pieza(p_pieza_id);
  select * into v_activa from public.instagram_programaciones
   where pieza_id = p_pieza_id and estado in ('programada', 'publicando') for update;
  if v_activa.id is not null then
    return public.instagram_reprogramar(v_activa.id, p_para, p_confirmar_conflicto);
  end if;
  v_conflictos := public.instagram_programacion_conflictos(v_pieza.marca, p_para, v_pieza.id);
  if jsonb_array_length(v_conflictos) > 0 and not coalesce(p_confirmar_conflicto, false) then
    return jsonb_build_object('ok', false, 'requiereConfirmacion', true, 'conflictos', v_conflictos);
  end if;
  insert into public.instagram_programaciones (pieza_id, marca, programada_para, siguiente_intento_at, creado_por)
  values (v_pieza.id, v_pieza.marca, p_para, p_para, auth.uid())
  returning * into v_fila;
  return jsonb_build_object('ok', true, 'accion', 'programada', 'programacion', to_jsonb(v_fila), 'conflictos', v_conflictos);
end;
$$;

-- Cancela una pendiente (o quita del calendario una con error).
create or replace function public.instagram_cancelar_programacion(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.instagram_programaciones;
begin
  perform public.instagram_programacion_permiso();
  update public.instagram_programaciones
     set estado = 'cancelada', cancelada_at = now(), cancelada_por = auth.uid()
   where id = p_id and estado in ('programada', 'error')
  returning * into v;
  if v.id is null then
    if exists (select 1 from public.instagram_programaciones where id = p_id and estado = 'publicando') then
      raise exception 'Se está publicando ahora mismo; ya no se puede cancelar' using errcode = '55006';
    end if;
    raise exception 'No hay ninguna programación pendiente con ese id' using errcode = 'P0002';
  end if;
  return jsonb_build_object('ok', true, 'programacion', to_jsonb(v));
end;
$$;

-- ─── 4. RPC del programador (solo service_role) ─────────────────────────────

-- Reclama UNA programación vencida (la más antigua) con bloqueo.
create or replace function public.instagram_programador_reclamar(p_lease_seg integer default 600)
returns setof public.instagram_programaciones
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- Bloqueos caducados: la pasada que la tenía se cortó. NUNCA se vuelve a
  -- publicar sola (pudo llegar a publicarse): si la pieza tiene media_id se da
  -- por publicada; si no, error para que alguien lo compruebe en Instagram.
  update public.instagram_programaciones p
     set estado          = case when pz.media_id is not null then 'publicada' else 'error' end,
         media_id        = pz.media_id,
         permalink       = pz.permalink,
         publicada_at    = case when pz.media_id is not null then coalesce(pz.publicada_at, now()) end,
         intentos        = least(3, p.intentos + case when pz.media_id is null then 1 else 0 end),
         ultimo_error    = case when pz.media_id is null then
           'La publicación se cortó a mitad y no se ha reintentado para no publicarla dos veces. '
           || 'Comprueba en Instagram si salió; si no, vuelve a programarla.' end,
         bloqueo_id      = null,
         bloqueada_hasta = null
    from public.instagram_piezas pz
   where pz.id = p.pieza_id
     and p.estado = 'publicando'
     and p.bloqueada_hasta < now();

  select p.id into v_id
    from public.instagram_programaciones p
   where p.estado = 'programada' and p.siguiente_intento_at <= now()
   order by p.siguiente_intento_at, p.created_at
   limit 1
   for update skip locked;
  if v_id is null then
    return;
  end if;
  return query
    update public.instagram_programaciones p
       set estado            = 'publicando',
           bloqueo_id        = gen_random_uuid(),
           bloqueada_hasta   = now() + make_interval(secs => greatest(60, least(coalesce(p_lease_seg, 600), 3600))),
           ultimo_intento_at = now()
     where p.id = v_id
    returning p.*;
end;
$$;

-- Cierra lo que reclamó la pasada (exige su bloqueo).
--   publicada   media_id + permalink (p_mensaje = aviso opcional)
--   reintentar  cuenta un intento; al 3.º queda en error; si no, vuelve a
--               «programada» dentro de p_espera_seg
--   aplazar     cuota agotada o límites de Meta: NO cuenta intento
--   error       definitivo (cuenta el intento)
create or replace function public.instagram_programador_cerrar(
  p_id uuid,
  p_bloqueo uuid,
  p_resultado text,
  p_mensaje text default null,
  p_media_id text default null,
  p_permalink text default null,
  p_contenedor_id text default null,
  p_espera_seg integer default 0
)
returns public.instagram_programaciones
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.instagram_programaciones;
  v_intentos smallint;
  v_mensaje text := left(nullif(btrim(p_mensaje), ''), 1000);
  v_siguiente timestamptz := now() + make_interval(secs => greatest(0, least(coalesce(p_espera_seg, 0), 86400)));
begin
  if p_resultado is null or p_resultado not in ('publicada', 'reintentar', 'aplazar', 'error') then
    raise exception 'Resultado no válido: %', p_resultado using errcode = '22023';
  end if;
  select * into v from public.instagram_programaciones
   where id = p_id and estado = 'publicando' and bloqueo_id = p_bloqueo
   for update;
  if not found then
    raise exception 'La programación ya no está bloqueada por esta pasada' using errcode = 'P0002';
  end if;

  if p_resultado = 'publicada' then
    if nullif(btrim(p_media_id), '') is null then
      raise exception 'Falta el media_id de la publicación' using errcode = '22023';
    end if;
    update public.instagram_programaciones
       set estado = 'publicada', media_id = p_media_id, permalink = p_permalink, publicada_at = now(),
           ultimo_error = v_mensaje, bloqueo_id = null, bloqueada_hasta = null
     where id = v.id returning * into v;
  elsif p_resultado = 'aplazar' then
    update public.instagram_programaciones
       set estado = 'programada', siguiente_intento_at = v_siguiente, ultimo_error = v_mensaje,
           contenedor_id = p_contenedor_id, bloqueo_id = null, bloqueada_hasta = null
     where id = v.id returning * into v;
  elsif p_resultado = 'reintentar' then
    v_intentos := least(3, v.intentos + 1);
    update public.instagram_programaciones
       set estado = case when v_intentos >= 3 then 'error' else 'programada' end,
           intentos = v_intentos,
           siguiente_intento_at = case when v_intentos >= 3 then siguiente_intento_at else v_siguiente end,
           ultimo_error = coalesce(v_mensaje, 'Error al publicar'),
           contenedor_id = case when v_intentos >= 3 then null else p_contenedor_id end,
           bloqueo_id = null, bloqueada_hasta = null
     where id = v.id returning * into v;
  else
    update public.instagram_programaciones
       set estado = 'error', intentos = least(3, v.intentos + 1), ultimo_error = coalesce(v_mensaje, 'Error al publicar'),
           contenedor_id = null, bloqueo_id = null, bloqueada_hasta = null
     where id = v.id returning * into v;
  end if;
  return v;
end;
$$;

-- Permisos de las funciones: el panel, solo las tres RPC; el resto, nadie
-- (las auxiliares solo se llaman desde dentro de las SECURITY DEFINER).
revoke all on function public.instagram_programacion_permiso() from public;
revoke all on function public.instagram_programacion_validar_fecha(timestamptz) from public;
revoke all on function public.instagram_programacion_conflictos(text, timestamptz, uuid) from public;
revoke all on function public.instagram_programacion_pieza(uuid) from public;
revoke all on function public.instagram_programar(uuid, timestamptz, boolean) from public;
revoke all on function public.instagram_reprogramar(uuid, timestamptz, boolean) from public;
revoke all on function public.instagram_cancelar_programacion(uuid) from public;
revoke all on function public.instagram_programador_reclamar(integer) from public;
revoke all on function public.instagram_programador_cerrar(uuid, uuid, text, text, text, text, text, integer) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.instagram_programacion_permiso() from anon, authenticated';
    execute 'revoke all on function public.instagram_programacion_validar_fecha(timestamptz) from anon, authenticated';
    execute 'revoke all on function public.instagram_programacion_conflictos(text, timestamptz, uuid) from anon, authenticated';
    execute 'revoke all on function public.instagram_programacion_pieza(uuid) from anon, authenticated';
    execute 'revoke all on function public.instagram_programar(uuid, timestamptz, boolean) from anon';
    execute 'revoke all on function public.instagram_reprogramar(uuid, timestamptz, boolean) from anon';
    execute 'revoke all on function public.instagram_cancelar_programacion(uuid) from anon';
    execute 'revoke all on function public.instagram_programador_reclamar(integer) from anon, authenticated';
    execute 'revoke all on function public.instagram_programador_cerrar(uuid, uuid, text, text, text, text, text, integer) from anon, authenticated';
    execute 'grant execute on function public.instagram_programar(uuid, timestamptz, boolean) to authenticated';
    execute 'grant execute on function public.instagram_reprogramar(uuid, timestamptz, boolean) to authenticated';
    execute 'grant execute on function public.instagram_cancelar_programacion(uuid) to authenticated';
    execute 'grant execute on function public.instagram_programador_reclamar(integer) to service_role';
    execute 'grant execute on function public.instagram_programador_cerrar(uuid, uuid, text, text, text, text, text, integer) to service_role';
  end if;
end;
$$;

-- ─── 5. pg_cron cada 5 minutos (mudo sin los secretos de Vault) ─────────────
select cron.unschedule('instagram-programador')
 where exists (select 1 from cron.job where jobname = 'instagram-programador');

-- Solo llama si hay trabajo: vencidas o bloqueos caducados. timeout 150 s: la
-- función publica de una en una y espera a que Meta procese la imagen.
select cron.schedule(
  'instagram-programador',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url := rtrim(u.decrypted_secret, '/') || '/functions/v1/instagram-programador',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', s.decrypted_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  )
  from vault.decrypted_secrets s
  cross join vault.decrypted_secrets u
  where s.name = 'instagram_programador_secret'
    and u.name = 'project_url'
    and exists (
      select 1 from public.instagram_programaciones p
       where (p.estado = 'programada' and p.siguiente_intento_at <= now())
          or (p.estado = 'publicando' and p.bloqueada_hasta < now())
    );
  $cron$
);

-- ─── 6. Comprobación final ──────────────────────────────────────────────────
do $$
declare
  v_malos text[] := '{}';
begin
  if not (select relrowsecurity from pg_class where oid = 'public.instagram_programaciones'::regclass) then
    v_malos := v_malos || 'RLS apagada en instagram_programaciones'::text;
  end if;
  if (select count(*) from cron.job where jobname = 'instagram-programador') <> 1 then
    v_malos := v_malos || 'el cron instagram-programador no quedó instalado una vez'::text;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    if has_table_privilege('anon', 'public.instagram_programaciones', 'SELECT')
       or has_table_privilege('anon', 'public.instagram_programaciones', 'INSERT')
       or has_table_privilege('anon', 'public.instagram_programaciones', 'UPDATE')
       or has_table_privilege('anon', 'public.instagram_programaciones', 'DELETE') then
      v_malos := v_malos || 'anon tiene acceso a instagram_programaciones'::text;
    end if;
    if has_table_privilege('authenticated', 'public.instagram_programaciones', 'INSERT')
       or has_table_privilege('authenticated', 'public.instagram_programaciones', 'UPDATE')
       or has_table_privilege('authenticated', 'public.instagram_programaciones', 'DELETE')
       or has_table_privilege('authenticated', 'public.instagram_programaciones', 'TRUNCATE') then
      v_malos := v_malos || 'authenticated puede escribir en instagram_programaciones sin pasar por las RPC'::text;
    end if;
    if has_function_privilege('authenticated', 'public.instagram_programador_reclamar(integer)', 'execute')
       or has_function_privilege('anon', 'public.instagram_programador_reclamar(integer)', 'execute')
       or has_function_privilege('authenticated', 'public.instagram_programador_cerrar(uuid, uuid, text, text, text, text, text, integer)', 'execute')
       or has_function_privilege('anon', 'public.instagram_programar(uuid, timestamptz, boolean)', 'execute') then
      v_malos := v_malos || 'RPC del programador ejecutables fuera de service_role (o del panel por anon)'::text;
    end if;
  end if;
  if cardinality(v_malos) > 0 then
    raise exception 'instagram_programacion: comprobación final fallida (%). No se ha aplicado nada.', array_to_string(v_malos, '; ');
  end if;
end;
$$;

commit;

-- Verificación (solo lectura): «aplicada | cron activo | secretos de Vault».
select 'instagram_programacion: aplicada' as resultado,
       (select active from cron.job where jobname = 'instagram-programador') as cron_activo,
       exists (select 1 from vault.decrypted_secrets where name = 'project_url') as vault_project_url,
       exists (select 1 from vault.decrypted_secrets where name = 'instagram_programador_secret') as vault_secreto_programador;
