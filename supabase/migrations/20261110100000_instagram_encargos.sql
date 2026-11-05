set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261110100000_instagram_encargos — Encargos a Oficiosos (tickets) y piezas
-- automáticas pedidas desde la pestaña «Encargos» (fase 4 de la propuesta,
-- 10/11/2026). Ver docs/instagram-encargos.md.
-- ===========================================================================
-- El restaurante (sección «marketing») pide una pieza o un vídeo:
--   · modo «automatico»: se genera solo con una plantilla de imagen (render
--     de /api/instagram-render) o con un reel base (cola de render de
--     20261109100000). El panel genera la pieza y la vincula al encargo.
--   · modo «oficiosos»: lo hace una persona de la agencia, que acepta, entrega
--     versiones (JPEG o MP4 subidos a los cubos públicos) y el restaurante
--     aprueba o pide cambios. Al aprobar se crea la instagram_piezas (origen
--     «encargo») que sigue el flujo normal: probar, publicar o programar.
--
-- QUIÉN ES QUIÉN
--   restaurante = can_write_section('marketing')
--   agencia     = can_write_section('instagram_agencia')   ← permiso NUEVO
--   (sección «Instagram · Agencia (Oficiosos)» en Usuarios; el super admin es
--   las dos cosas, como en cualquier sección). Ambas exigen además la sesión
--   de panel viva (private.sesion_panel_permitida) si existe.
--
-- ESTADOS (instagram_encargos.estado) y QUIÉN los cambia — SOLO por RPC:
--   borrador ─enviar(R)─► enviado ─aceptar(A)─► aceptado ─empezar(A)─► en_curso
--   enviado/aceptado ─rechazar(A, motivo)─► rechazado ─guardar+enviar(R)─► enviado
--   aceptado/en_curso/cambios_pedidos ─entregar(A, versión)─► para_revisar
--   para_revisar ─pedir_cambios(R, comentario; cuenta rondas)─► cambios_pedidos
--   cambios_pedidos ─empezar(A)─► en_curso
--   para_revisar ─aprobar(R)─► aprobado  (crea o enlaza la instagram_piezas)
--   aprobado ─(la pieza se publica: trigger)─► publicado
--   cualquiera no final ─cancelar(R)─► cancelado   (un borrador se borra)
--   Automático: enviar(R) ─► en_curso ─vincular_pieza(R)─► para_revisar
--   (o sigue en_curso hasta que el trabajador termina el MP4: trigger).
--   R = restaurante, A = agencia. Nadie tiene INSERT/UPDATE/DELETE directo.
--
-- QUÉ CREA
--   1. instagram_encargos_ajustes (fila única): plazo estándar (5 días
--      laborables), rondas de cambios incluidas (2) y cupo mensual (null = sin
--      límite). Los lee quien ve encargos; los cambia solo un super admin.
--   2. instagram_encargos, instagram_encargo_adjuntos (fotos del restaurante:
--      Drive, carta o subidas a Drive), instagram_encargo_entregas (versiones
--      v1, v2…), instagram_encargo_mensajes (hilo) e instagram_encargo_eventos
--      (historial: quién, cuándo, de qué estado a cuál y comentario).
--      RLS: el restaurante ve todos los encargos; la agencia, todos menos los
--      borradores. Escritura solo por las RPC instagram_encargo_*.
--   3. Storage: la agencia sube entregas a
--        instagram        encargos/<encargo>/v<N>-<8 hex>.jpg
--        instagram-video  reels/AAAA-MM/<encargo>-<8 hex>.mp4 (y .jpg portada)
--      (solo INSERT y SELECT con esos prefijos; el resto, como estaba).
--   4. Avisos: cada evento dirigido al restaurante deja una fila en
--      notificaciones_dashboard (campana). El Web Push lo manda
--      notificar-video con { tipo: "encargo", evento_id } y los destinatarios
--      salen de instagram_encargo_destinatarios (solo service_role).
--   5. Trigger en instagram_piezas: al publicarse una pieza aprobada, el
--      encargo pasa a «publicado»; al terminar el MP4 de un encargo
--      automático, pasa a «para_revisar».
--   El hueco del calendario es la fecha_deseada de los encargos enviados y
--   vivos (el panel los lee de instagram_encargos).
--
-- APLICAR (una a una, nunca `db push`), DESPUÉS de 20261109100000_instagram_
-- video: demo primero (sfonaclosuafvlhutkon), producción (haqmmdfdzzatdnrrcgez)
-- solo tras aceptar el PR y con el «sí» del dueño:
--   npx supabase db query --linked -f supabase/migrations/20261110100000_instagram_encargos.sql
-- Idempotente. Tiene que terminar en «instagram_encargos: aplicada».
-- Deshacer: supabase/rollbacks/20261110100000_instagram_encargos_ROLLBACK.sql
-- Pruebas: npm run test:instagram-encargos:db (PGlite).
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
  if to_regclass('public.instagram_piezas') is not null and not exists (
       select 1 from pg_attribute where attrelid = 'public.instagram_piezas'::regclass and attname = 'origen' and not attisdropped) then
    v_faltan := v_faltan || 'instagram_piezas.origen (aplica antes 20261109000000_instagram_campanas.sql)'::text;
  end if;
  if to_regclass('public.instagram_piezas') is not null and not exists (
       select 1 from pg_attribute where attrelid = 'public.instagram_piezas'::regclass and attname = 'video_ruta' and not attisdropped) then
    v_faltan := v_faltan || 'instagram_piezas.video_ruta (aplica antes 20261109100000_instagram_video.sql)'::text;
  end if;
  if to_regprocedure('public.can_write_section(text)') is null or to_regprocedure('public.can_read_section(text)') is null then
    v_faltan := v_faltan || 'public.can_read_section / can_write_section'::text;
  end if;
  if to_regprocedure('public.is_super_admin(uuid)') is null then
    v_faltan := v_faltan || 'public.is_super_admin(uuid)'::text;
  end if;
  if to_regclass('public.user_permissions') is null then
    v_faltan := v_faltan || 'public.user_permissions'::text;
  end if;
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    v_faltan := v_faltan || 'storage.buckets / storage.objects'::text;
  end if;
  if cardinality(v_faltan) > 0 then
    raise exception 'instagram_encargos: falta %. No se ha cambiado nada.', array_to_string(v_faltan, ', ');
  end if;
end;
$$;

-- ─── 1. Ajustes (fila única) ────────────────────────────────────────────────
create table if not exists public.instagram_encargos_ajustes (
  id                     boolean primary key default true,
  plazo_dias_laborables  integer not null default 5,
  rondas_incluidas       integer not null default 2,
  cupo_mensual           integer,
  updated_at             timestamptz not null default now(),
  updated_by             uuid,
  constraint instagram_encargos_ajustes_unica_chk check (id),
  constraint instagram_encargos_ajustes_valores_chk check (
    plazo_dias_laborables between 1 and 60
    and rondas_incluidas between 0 and 20
    and (cupo_mensual is null or cupo_mensual between 1 and 500))
);
comment on table public.instagram_encargos_ajustes is
  'Condiciones de los encargos a Oficiosos (fila única): plazo estándar en días laborables, rondas de cambios incluidas y cupo mensual (null = sin límite). Solo las cambia un super admin.';
insert into public.instagram_encargos_ajustes (id) values (true) on conflict (id) do nothing;

create or replace function public.instagram_encargos_ajustes_al_editar()
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
revoke all on function public.instagram_encargos_ajustes_al_editar() from public;
drop trigger if exists instagram_encargos_ajustes_al_editar on public.instagram_encargos_ajustes;
create trigger instagram_encargos_ajustes_al_editar
  before insert or update on public.instagram_encargos_ajustes
  for each row execute function public.instagram_encargos_ajustes_al_editar();

-- ─── 2. Encargos ────────────────────────────────────────────────────────────
create table if not exists public.instagram_encargos (
  id                      uuid primary key default gen_random_uuid(),
  numero                  bigint generated by default as identity unique,
  marca                   text not null,
  modo                    text not null,
  formato                 text not null,
  titulo                  text not null,
  idea                    text,
  estilo                  text,
  plantilla               text,
  base_reel               text,
  texto                   text,
  fecha_deseada           date,
  fecha_entrega_prevista  date,
  fecha_entrega           date,
  estado                  text not null default 'borrador',
  rondas_cambios          integer not null default 0,
  rondas_incluidas        integer not null default 2,
  motivo                  text,
  pieza_id                uuid references public.instagram_piezas (id) on delete set null,
  creado_por              uuid default auth.uid() references auth.users (id) on delete set null,
  asignado_a              uuid references auth.users (id) on delete set null,
  enviado_at              timestamptz,
  aceptado_at             timestamptz,
  entregado_at            timestamptz,
  aprobado_at             timestamptz,
  publicado_at            timestamptz,
  cerrado_at              timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint instagram_encargos_marca_chk   check (marca in ('casa-tomas', 'touza')),
  constraint instagram_encargos_modo_chk    check (modo in ('automatico', 'oficiosos')),
  constraint instagram_encargos_formato_chk check (formato in ('post', 'story', 'reel')),
  constraint instagram_encargos_estado_chk  check (estado in ('borrador', 'enviado', 'aceptado', 'en_curso', 'para_revisar',
                                                             'cambios_pedidos', 'aprobado', 'publicado', 'rechazado', 'cancelado')),
  constraint instagram_encargos_textos_chk  check (
    char_length(titulo) between 1 and 120
    and coalesce(char_length(idea), 0) <= 4000 and coalesce(char_length(estilo), 0) <= 200
    and coalesce(char_length(texto), 0) <= 2200 and coalesce(char_length(motivo), 0) <= 2000),
  constraint instagram_encargos_plantilla_chk check (plantilla is null or plantilla ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  constraint instagram_encargos_base_reel_chk check (base_reel is null or base_reel in ('bienvenido', 'del-mar', 'bodega', 'brasa', 'touza', 'libre')),
  constraint instagram_encargos_rondas_chk  check (rondas_cambios between 0 and 100 and rondas_incluidas between 0 and 20)
);
comment on table public.instagram_encargos is
  'Encargos de Instagram: piezas automáticas (plantilla o reel base) o encargos a Oficiosos (agencia). Estados solo por RPC instagram_encargo_*. Ver docs/instagram-encargos.md.';
comment on column public.instagram_encargos.fecha_deseada is 'Fecha de publicación que quiere el restaurante: hueco reservado en el calendario desde que se envía.';
comment on column public.instagram_encargos.fecha_entrega_prevista is 'Al enviar: hoy + plazo estándar en días laborables (instagram_encargos_ajustes).';
comment on column public.instagram_encargos.fecha_entrega is 'Fecha de entrega comprometida por la agencia al aceptar.';
comment on column public.instagram_encargos.rondas_incluidas is 'Rondas de cambios incluidas (copia de los ajustes al enviar). Más rondas se pueden pedir, marcadas como extra.';
comment on column public.instagram_encargos.pieza_id is 'Pieza aprobada (oficiosos) o la que se está generando (automático).';

create index if not exists instagram_encargos_estado_idx on public.instagram_encargos (estado, updated_at desc);
create index if not exists instagram_encargos_fecha_idx on public.instagram_encargos (fecha_deseada) where fecha_deseada is not null;
create index if not exists instagram_encargos_pieza_idx on public.instagram_encargos (pieza_id) where pieza_id is not null;

create or replace function public.instagram_encargos_al_editar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.creado_por := coalesce(auth.uid(), new.creado_por);
    new.created_at := now();
  else
    new.creado_por := old.creado_por;
    new.created_at := old.created_at;
    new.numero := old.numero;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.instagram_encargos_al_editar() from public;
drop trigger if exists instagram_encargos_al_editar on public.instagram_encargos;
create trigger instagram_encargos_al_editar
  before insert or update on public.instagram_encargos
  for each row execute function public.instagram_encargos_al_editar();

-- Fotos que aporta el restaurante (id del catálogo del panel: «drive:<id>»,
-- «carta:<id>» o una foto fija). La subida va a Drive con el selector de
-- siempre; aquí solo se guarda la referencia.
create table if not exists public.instagram_encargo_adjuntos (
  id          uuid primary key default gen_random_uuid(),
  encargo_id  uuid not null references public.instagram_encargos (id) on delete cascade,
  foto_id     text not null,
  nombre      text,
  miniatura   text,
  orden       smallint not null default 0,
  subido_por  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint instagram_encargo_adjuntos_chk check (
    char_length(foto_id) between 1 and 200 and coalesce(char_length(nombre), 0) <= 200
    and (miniatura is null or (char_length(miniatura) <= 1000 and miniatura ~ '^https://[^[:space:]]+$'))
    and orden between 0 and 50)
);
create index if not exists instagram_encargo_adjuntos_encargo_idx on public.instagram_encargo_adjuntos (encargo_id, orden);

-- Versiones entregadas (v1, v2…). Oficiosos: fichero subido (ruta). Automático:
-- la pieza generada (pieza_id, sin ruta).
create table if not exists public.instagram_encargo_entregas (
  id            uuid primary key default gen_random_uuid(),
  encargo_id    uuid not null references public.instagram_encargos (id) on delete cascade,
  version       integer not null,
  tipo_medio    text not null,
  cubo          text,
  ruta          text,
  portada_ruta  text,
  pieza_id      uuid references public.instagram_piezas (id) on delete set null,
  bytes         bigint,
  ancho         integer,
  alto          integer,
  duracion_s    numeric(6, 2),
  texto         text,
  nota          text,
  entregado_por uuid default auth.uid() references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint instagram_encargo_entregas_version_uq unique (encargo_id, version),
  constraint instagram_encargo_entregas_chk check (
    version between 1 and 100
    and tipo_medio in ('imagen', 'reel')
    and (cubo is null or cubo in ('instagram', 'instagram-video'))
    and (ruta is not null or pieza_id is not null)
    and (ruta is null or cubo is not null)
    and coalesce(char_length(ruta), 0) <= 300 and coalesce(char_length(portada_ruta), 0) <= 300
    and (bytes is null or bytes between 1 and 52428800)
    and (ancho is null or ancho between 1 and 10000) and (alto is null or alto between 1 and 10000)
    and (duracion_s is null or duracion_s between 0 and 600)
    and coalesce(char_length(texto), 0) <= 2200 and coalesce(char_length(nota), 0) <= 2000)
);
create unique index if not exists instagram_encargo_entregas_ruta_uq on public.instagram_encargo_entregas (ruta) where ruta is not null;

create table if not exists public.instagram_encargo_mensajes (
  id          uuid primary key default gen_random_uuid(),
  encargo_id  uuid not null references public.instagram_encargos (id) on delete cascade,
  autor       uuid default auth.uid() references auth.users (id) on delete set null,
  lado        text not null,
  texto       text not null,
  created_at  timestamptz not null default now(),
  constraint instagram_encargo_mensajes_chk check (lado in ('restaurante', 'agencia') and char_length(texto) between 1 and 4000)
);
create index if not exists instagram_encargo_mensajes_encargo_idx on public.instagram_encargo_mensajes (encargo_id, created_at);

create table if not exists public.instagram_encargo_eventos (
  id          uuid primary key default gen_random_uuid(),
  encargo_id  uuid not null references public.instagram_encargos (id) on delete cascade,
  actor       uuid references auth.users (id) on delete set null,
  lado        text not null,
  accion      text not null,
  de_estado   text,
  a_estado    text,
  comentario  text,
  created_at  timestamptz not null default now(),
  constraint instagram_encargo_eventos_chk check (
    lado in ('restaurante', 'agencia', 'sistema') and char_length(accion) between 1 and 40
    and coalesce(char_length(comentario), 0) <= 4000)
);
create index if not exists instagram_encargo_eventos_encargo_idx on public.instagram_encargo_eventos (encargo_id, created_at);

-- ─── 3. RLS: lectura por sección; escritura solo por RPC ────────────────────
do $$
declare
  v_t text;
begin
  foreach v_t in array array['instagram_encargos_ajustes', 'instagram_encargos', 'instagram_encargo_adjuntos',
                             'instagram_encargo_entregas', 'instagram_encargo_mensajes', 'instagram_encargo_eventos'] loop
    execute format('alter table public.%I enable row level security', v_t);
    execute format('revoke all on public.%I from public', v_t);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on public.%I from anon, authenticated', v_t);
      execute format('grant select on public.%I to authenticated', v_t);
      execute format('grant all on public.%I to service_role', v_t);
    end if;
    execute format('drop policy if exists %I on public.%I', v_t || '_service_role', v_t);
    execute format('create policy %I on public.%I for all to service_role using (true) with check (true)', v_t || '_service_role', v_t);
    if to_regprocedure('private.sesion_panel_permitida()') is not null then
      execute format('drop policy if exists "acceso_panel_no_bloqueado" on public.%I', v_t);
      execute format('create policy "acceso_panel_no_bloqueado" on public.%I as restrictive for all to authenticated
        using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()))', v_t);
    end if;
  end loop;
end;
$$;

-- Ajustes: los ve quien ve encargos; solo un super admin los cambia.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'grant update (plazo_dias_laborables, rondas_incluidas, cupo_mensual) on public.instagram_encargos_ajustes to authenticated';
  end if;
end;
$$;
drop policy if exists instagram_encargos_ajustes_select on public.instagram_encargos_ajustes;
create policy instagram_encargos_ajustes_select on public.instagram_encargos_ajustes
  for select to authenticated
  using ((select public.can_read_section('marketing')) or (select public.can_read_section('instagram_agencia')));
drop policy if exists instagram_encargos_ajustes_update on public.instagram_encargos_ajustes;
create policy instagram_encargos_ajustes_update on public.instagram_encargos_ajustes
  for update to authenticated
  using ((select public.is_super_admin(auth.uid())))
  with check ((select public.is_super_admin(auth.uid())));

-- Encargos: el restaurante (marketing) ve todos los suyos; la agencia ve
-- todos los que se le han enviado (cualquiera menos los borradores).
drop policy if exists instagram_encargos_select on public.instagram_encargos;
create policy instagram_encargos_select on public.instagram_encargos
  for select to authenticated
  using ((select public.can_read_section('marketing'))
         or (estado <> 'borrador' and (select public.can_read_section('instagram_agencia'))));

-- Hijos: visibles si el encargo es visible (la subconsulta aplica la RLS de arriba).
do $$
declare
  v_t text;
begin
  foreach v_t in array array['instagram_encargo_adjuntos', 'instagram_encargo_entregas',
                             'instagram_encargo_mensajes', 'instagram_encargo_eventos'] loop
    execute format('drop policy if exists %I on public.%I', v_t || '_select', v_t);
    execute format('create policy %I on public.%I for select to authenticated
      using (encargo_id in (select e.id from public.instagram_encargos e))', v_t || '_select', v_t);
  end loop;
end;
$$;

-- ─── 4. Auditoría (mismo trigger que el resto del panel) ────────────────────
do $$
declare
  v_tabla text;
begin
  if to_regprocedure('public.fn_registrar_auditoria()') is null then
    return;
  end if;
  foreach v_tabla in array array['instagram_encargos_ajustes', 'instagram_encargos', 'instagram_encargo_entregas'] loop
    if not exists (select 1 from pg_trigger
                    where tgrelid = format('public.%I', v_tabla)::regclass
                      and tgfoid = 'public.fn_registrar_auditoria()'::regprocedure
                      and not tgisinternal) then
      execute format('drop trigger if exists trg_auditoria on public.%I', v_tabla);
      execute format('create trigger trg_auditoria after insert or update or delete on public.%I
                      for each row execute function public.fn_registrar_auditoria()', v_tabla);
    end if;
  end loop;
end;
$$;

-- ─── 5. Storage: entregas de la agencia ─────────────────────────────────────
-- Prefijo ig_encargos_ (ni instagram_ ni ig_video_): las comprobaciones de
-- 20261105090000 y 20261109100000 exigen que esas familias sean de un cubo.
drop policy if exists ig_encargos_jpeg_insert on storage.objects;
create policy ig_encargos_jpeg_insert on storage.objects
  for insert to authenticated
  with check ( bucket_id = 'instagram' and name like 'encargos/%'
               and (select public.can_write_section('instagram_agencia')) );
drop policy if exists ig_encargos_jpeg_select on storage.objects;
create policy ig_encargos_jpeg_select on storage.objects
  for select to authenticated
  using ( bucket_id = 'instagram' and name like 'encargos/%'
          and (select public.can_read_section('instagram_agencia')) );
drop policy if exists ig_encargos_video_insert on storage.objects;
create policy ig_encargos_video_insert on storage.objects
  for insert to authenticated
  with check ( bucket_id = 'instagram-video' and name like 'reels/%'
               and (select public.can_write_section('instagram_agencia')) );
drop policy if exists ig_encargos_video_select on storage.objects;
create policy ig_encargos_video_select on storage.objects
  for select to authenticated
  using ( bucket_id = 'instagram-video' and name like 'reels/%'
          and (select public.can_read_section('instagram_agencia')) );

-- ─── 6. Funciones auxiliares ────────────────────────────────────────────────

-- Hoy en Madrid.
create or replace function public.instagram_encargo_hoy()
returns date
language sql
stable
set search_path = ''
as $$ select (now() at time zone 'Europe/Madrid')::date $$;

-- p_desde + p_dias días laborables (lunes a viernes; sin festivos).
create or replace function public.instagram_sumar_dias_laborables(p_desde date, p_dias integer)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v date := p_desde;
  v_n integer := 0;
begin
  while v_n < greatest(coalesce(p_dias, 0), 0) loop
    v := v + 1;
    if extract(isodow from v) < 6 then
      v_n := v_n + 1;
    end if;
  end loop;
  return v;
end;
$$;

-- ¿Quién llama? Comprueba sesión de panel y el lado pedido. p_lado:
-- 'restaurante', 'agencia' o 'cualquiera' (devuelve el lado efectivo; si es
-- las dos cosas, p_preferido decide y por defecto es 'restaurante').
create or replace function public.instagram_encargo_lado(p_lado text, p_preferido text default null)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_r boolean;
  v_a boolean;
begin
  if auth.uid() is null then
    raise exception 'Sin sesión' using errcode = '42501';
  end if;
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    if not coalesce((select private.sesion_panel_permitida()), false) then
      raise exception 'Sesión de panel no válida' using errcode = '42501';
    end if;
  end if;
  v_r := coalesce(public.can_write_section('marketing'), false);
  v_a := coalesce(public.can_write_section('instagram_agencia'), false);
  if p_lado = 'restaurante' then
    if not v_r then raise exception 'Solo el restaurante (permiso de Marketing) puede hacer esto' using errcode = '42501'; end if;
    return 'restaurante';
  elsif p_lado = 'agencia' then
    if not v_a then raise exception 'Solo la agencia (permiso Instagram · Agencia) puede hacer esto' using errcode = '42501'; end if;
    return 'agencia';
  end if;
  if v_r and v_a then
    return case when p_preferido = 'agencia' then 'agencia' else 'restaurante' end;
  elsif v_r then
    return 'restaurante';
  elsif v_a then
    return 'agencia';
  end if;
  raise exception 'Sin permiso para los encargos de Instagram' using errcode = '42501';
end;
$$;

-- Lee el encargo bloqueándolo; error si no existe o si no está en un estado permitido.
create or replace function public.instagram_encargo_bloquear(p_id uuid, p_estados text[], p_que text)
returns public.instagram_encargos
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.instagram_encargos;
begin
  select * into v from public.instagram_encargos where id = p_id for update;
  if not found then
    raise exception 'No existe ese encargo' using errcode = 'P0002';
  end if;
  if not (v.estado = any (p_estados)) then
    raise exception 'No se puede % un encargo en estado «%»', p_que, v.estado using errcode = '55000';
  end if;
  return v;
end;
$$;

-- Historial + aviso en la campana (solo de lo que va al restaurante).
create or replace function public.instagram_encargo_registrar(
  p_encargo    public.instagram_encargos,
  p_accion     text,
  p_lado       text,
  p_de         text,
  p_a          text,
  p_comentario text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_titulo text;
  v_ref text := 'ENC-' || lpad(p_encargo.numero::text, 4, '0');
begin
  insert into public.instagram_encargo_eventos (encargo_id, actor, lado, accion, de_estado, a_estado, comentario)
  values (p_encargo.id, case when p_lado = 'sistema' then null else auth.uid() end, p_lado, p_accion, p_de, p_a, left(p_comentario, 4000))
  returning id into v_id;

  v_titulo := case p_accion
    when 'aceptar' then 'Oficiosos aceptó el encargo'
    when 'rechazar' then 'Oficiosos no puede hacer el encargo'
    when 'empezar' then 'Oficiosos está con el encargo'
    when 'entregar' then 'Encargo listo para revisar'
    when 'generado' then 'Pieza automática lista para revisar'
    when 'comentar' then 'Mensaje de Oficiosos'
    else null end;
  if v_titulo is not null and p_lado in ('agencia', 'sistema') and to_regclass('public.notificaciones_dashboard') is not null then
    execute 'insert into public.notificaciones_dashboard (tipo, titulo, mensaje, referencia_id, referencia_tipo) values ($1, $2, $3, $4, $5)'
      using 'instagram_encargo', v_titulo, left(v_ref || ' · ' || p_encargo.titulo
                                                  || coalesce(': ' || nullif(p_comentario, ''), ''), 500),
            p_encargo.id, 'instagram_encargo';
  end if;
  return v_id;
end;
$$;

create or replace function public.instagram_encargo_respuesta(p_id uuid, p_evento uuid, p_extra jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('ok', true, 'eventoId', p_evento, 'encargo', to_jsonb(e)) || coalesce(p_extra, '{}'::jsonb)
    from public.instagram_encargos e where e.id = p_id
$$;

-- ─── 7. RPC del restaurante ─────────────────────────────────────────────────

-- Crea (p_id null) o modifica un borrador (o un rechazado, para reenviarlo).
-- p_datos: marca, modo, formato, titulo, idea, estilo, plantilla, base_reel,
-- texto, fecha_deseada (AAAA-MM-DD) y fotos [{ id, nombre?, miniatura? }].
create or replace function public.instagram_encargo_guardar(p_id uuid, p_datos jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.instagram_encargos;
  v_marca text := nullif(trim(p_datos ->> 'marca'), '');
  v_modo text := nullif(trim(p_datos ->> 'modo'), '');
  v_formato text := nullif(trim(p_datos ->> 'formato'), '');
  v_titulo text := nullif(trim(p_datos ->> 'titulo'), '');
  v_fecha date;
  v_fotos jsonb := coalesce(p_datos -> 'fotos', '[]'::jsonb);
  v_mala text;
begin
  perform public.instagram_encargo_lado('restaurante');
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    raise exception 'Faltan los datos del encargo' using errcode = '22023';
  end if;
  if v_marca is null or v_marca not in ('casa-tomas', 'touza') then
    raise exception 'Elige la marca' using errcode = '22023';
  end if;
  if v_modo is null or v_modo not in ('automatico', 'oficiosos') then
    raise exception 'Elige quién lo hace: automático u Oficiosos' using errcode = '22023';
  end if;
  if v_formato is null or v_formato not in ('post', 'story', 'reel') then
    raise exception 'Elige qué necesitas: post, story o vídeo' using errcode = '22023';
  end if;
  if v_titulo is null then
    raise exception 'Ponle un título al encargo' using errcode = '22023';
  end if;
  begin
    v_fecha := nullif(p_datos ->> 'fecha_deseada', '')::date;
  exception when others then
    raise exception 'La fecha deseada no es válida' using errcode = '22023';
  end;
  if jsonb_typeof(v_fotos) <> 'array' or jsonb_array_length(v_fotos) > 20 then
    raise exception 'Como mucho 20 fotos por encargo' using errcode = '22023';
  end if;
  select coalesce(f ->> 'id', '(sin id)') into v_mala from jsonb_array_elements(v_fotos) f
   where jsonb_typeof(f) <> 'object' or coalesce(char_length(f ->> 'id'), 0) not between 1 and 200
      or coalesce(char_length(f ->> 'nombre'), 0) > 200
      or (f ->> 'miniatura' is not null and ((f ->> 'miniatura') !~ '^https://[^[:space:]]+$' or char_length(f ->> 'miniatura') > 1000))
   limit 1;
  if v_mala is not null then
    raise exception 'La foto «%» no es válida', left(v_mala, 60) using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.instagram_encargos (marca, modo, formato, titulo, estado)
    values (v_marca, v_modo, v_formato, left(v_titulo, 120), 'borrador')
    returning * into v;
  else
    v := public.instagram_encargo_bloquear(p_id, array['borrador', 'rechazado'], 'modificar');
  end if;

  update public.instagram_encargos
     set marca = v_marca, modo = v_modo, formato = v_formato, titulo = left(v_titulo, 120),
         idea = nullif(trim(p_datos ->> 'idea'), ''),
         estilo = nullif(trim(p_datos ->> 'estilo'), ''),
         plantilla = nullif(trim(p_datos ->> 'plantilla'), ''),
         base_reel = nullif(trim(p_datos ->> 'base_reel'), ''),
         texto = nullif(p_datos ->> 'texto', ''),
         fecha_deseada = v_fecha
   where id = v.id
  returning * into v;

  delete from public.instagram_encargo_adjuntos where encargo_id = v.id;
  insert into public.instagram_encargo_adjuntos (encargo_id, foto_id, nombre, miniatura, orden)
  select v.id, f.value ->> 'id', nullif(f.value ->> 'nombre', ''), nullif(f.value ->> 'miniatura', ''), (f.ordinality - 1)::smallint
    from jsonb_array_elements(v_fotos) with ordinality f;

  return public.instagram_encargo_respuesta(v.id, null);
end;
$$;

create or replace function public.instagram_encargo_enviar(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.instagram_encargos;
  v_aj public.instagram_encargos_ajustes;
  v_de text;
  v_hoy date := public.instagram_encargo_hoy();
  v_usados integer;
  v_evento uuid;
begin
  perform public.instagram_encargo_lado('restaurante');
  v := public.instagram_encargo_bloquear(p_id, array['borrador', 'rechazado'], 'enviar');
  v_de := v.estado;
  select * into v_aj from public.instagram_encargos_ajustes where id;
  if v.fecha_deseada is null then
    raise exception 'Indica para cuándo lo quieres (fecha deseada)' using errcode = '22023';
  end if;
  if v.fecha_deseada < v_hoy then
    raise exception 'La fecha deseada ya ha pasado' using errcode = '22023';
  end if;
  if v.modo = 'oficiosos' then
    if coalesce(trim(v.idea), '') = '' then
      raise exception 'Cuenta la idea a Oficiosos' using errcode = '22023';
    end if;
    if v_aj.cupo_mensual is not null then
      select count(*) into v_usados from public.instagram_encargos
       where modo = 'oficiosos' and id <> v.id and enviado_at is not null
         and (enviado_at at time zone 'Europe/Madrid')::date >= date_trunc('month', v_hoy)::date;
      if v_usados >= v_aj.cupo_mensual then
        raise exception 'Ya se han pedido los % encargos del cupo de este mes', v_aj.cupo_mensual using errcode = '54000';
      end if;
    end if;
  else
    if v.formato = 'reel' and v.base_reel is null then
      raise exception 'Elige el reel base para el vídeo automático' using errcode = '22023';
    end if;
    if v.formato <> 'reel' and v.plantilla is null then
      raise exception 'Elige la plantilla para la pieza automática' using errcode = '22023';
    end if;
  end if;

  update public.instagram_encargos
     set estado = case when modo = 'oficiosos' then 'enviado' else 'en_curso' end,
         enviado_at = now(), motivo = null, cerrado_at = null,
         rondas_incluidas = coalesce(v_aj.rondas_incluidas, 2),
         fecha_entrega_prevista = case when modo = 'oficiosos'
                                       then public.instagram_sumar_dias_laborables(v_hoy, coalesce(v_aj.plazo_dias_laborables, 5)) end
   where id = v.id
  returning * into v;
  v_evento := public.instagram_encargo_registrar(v, case when v_de = 'rechazado' then 'reenviar' else 'enviar' end, 'restaurante', v_de, v.estado);
  return public.instagram_encargo_respuesta(v.id, v_evento);
end;
$$;

-- Automático: enlaza la pieza generada (imagen ya renderizada o reel en cola).
-- Con el medio listo pasa a «para_revisar» con una entrega; si el MP4 aún se
-- está generando, se queda «en_curso» y lo adelanta el trigger de la pieza.
create or replace function public.instagram_encargo_vincular_pieza(p_id uuid, p_pieza_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.instagram_encargos;
  v_p public.instagram_piezas;
  v_evento uuid;
  v_ver integer;
begin
  perform public.instagram_encargo_lado('restaurante');
  v := public.instagram_encargo_bloquear(p_id, array['en_curso'], 'vincular una pieza a');
  if v.modo <> 'automatico' then
    raise exception 'Solo los encargos automáticos se generan en el panel' using errcode = '22023';
  end if;
  select * into v_p from public.instagram_piezas where id = p_pieza_id for update;
  if not found then
    raise exception 'No existe esa pieza' using errcode = 'P0002';
  end if;
  if v_p.marca <> v.marca then
    raise exception 'La pieza es de otra marca' using errcode = '22023';
  end if;
  if (v.formato = 'reel') <> (v_p.tipo_medio = 'reel') then
    raise exception 'La pieza no es del tipo pedido (imagen o vídeo)' using errcode = '22023';
  end if;
  if exists (select 1 from public.instagram_encargos where pieza_id = p_pieza_id and id <> v.id) then
    raise exception 'Esa pieza ya pertenece a otro encargo' using errcode = '23505';
  end if;
  update public.instagram_piezas set origen = 'encargo' where id = v_p.id;
  update public.instagram_encargos set pieza_id = v_p.id where id = v.id returning * into v;

  if (v_p.tipo_medio = 'reel' and v_p.video_ruta is not null) or (v_p.tipo_medio = 'imagen' and v_p.imagen_ruta is not null) then
    select coalesce(max(version), 0) + 1 into v_ver from public.instagram_encargo_entregas where encargo_id = v.id;
    insert into public.instagram_encargo_entregas (encargo_id, version, tipo_medio, pieza_id, texto, entregado_por)
    values (v.id, v_ver, v_p.tipo_medio, v_p.id, v_p.caption, auth.uid());
    update public.instagram_encargos set estado = 'para_revisar', entregado_at = now() where id = v.id returning * into v;
    v_evento := public.instagram_encargo_registrar(v, 'generado', 'restaurante', 'en_curso', 'para_revisar');
  else
    v_evento := public.instagram_encargo_registrar(v, 'generando', 'restaurante', 'en_curso', 'en_curso');
  end if;
  return public.instagram_encargo_respuesta(v.id, v_evento);
end;
$$;

create or replace function public.instagram_encargo_pedir_cambios(p_id uuid, p_comentario text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.instagram_encargos;
  v_evento uuid;
  v_extra boolean;
begin
  perform public.instagram_encargo_lado('restaurante');
  if coalesce(trim(p_comentario), '') = '' then
    raise exception 'Explica qué hay que cambiar' using errcode = '22023';
  end if;
  v := public.instagram_encargo_bloquear(p_id, array['para_revisar'], 'pedir cambios en');
  if v.modo <> 'oficiosos' then
    raise exception 'Una pieza automática se retoca en el editor y se vuelve a generar' using errcode = '22023';
  end if;
  update public.instagram_encargos set estado = 'cambios_pedidos', rondas_cambios = rondas_cambios + 1
   where id = v.id returning * into v;
  v_extra := v.rondas_cambios > v.rondas_incluidas;
  insert into public.instagram_encargo_mensajes (encargo_id, lado, texto) values (v.id, 'restaurante', left(trim(p_comentario), 4000));
  v_evento := public.instagram_encargo_registrar(v, 'pedir_cambios', 'restaurante', 'para_revisar', 'cambios_pedidos',
    format('Ronda %s de %s incluidas%s: %s', v.rondas_cambios, v.rondas_incluidas,
           case when v_extra then ' (extra)' else '' end, trim(p_comentario)));
  return public.instagram_encargo_respuesta(v.id, v_evento, jsonb_build_object('rondaExtra', v_extra));
end;
$$;

-- Aprueba la última versión. Oficiosos: crea la instagram_piezas con el JPEG
-- o el MP4 entregado (origen «encargo», estado «generada»). Automático: la
-- pieza ya existe y se enlaza.
create or replace function public.instagram_encargo_aprobar(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.instagram_encargos;
  v_e public.instagram_encargo_entregas;
  v_p public.instagram_piezas;
  v_evento uuid;
begin
  perform public.instagram_encargo_lado('restaurante');
  v := public.instagram_encargo_bloquear(p_id, array['para_revisar'], 'aprobar');
  select * into v_e from public.instagram_encargo_entregas where encargo_id = v.id order by version desc limit 1;
  if v_e.id is null then
    raise exception 'No hay ninguna versión entregada' using errcode = '55000';
  end if;

  if v_e.pieza_id is not null then
    select * into v_p from public.instagram_piezas where id = v_e.pieza_id for update;
    if not found then
      raise exception 'La pieza de esta versión ya no existe' using errcode = 'P0002';
    end if;
    update public.instagram_piezas set origen = 'encargo' where id = v_p.id;
  elsif v_e.tipo_medio = 'reel' then
    if not exists (select 1 from storage.objects where bucket_id = 'instagram-video' and name = v_e.ruta) then
      raise exception 'El vídeo de la versión % ya no está en el cubo', v_e.version using errcode = 'P0002';
    end if;
    insert into public.instagram_piezas (marca, plantilla, formato, tipo_medio, datos, caption, estado, origen,
                                         video_ruta, portada_ruta, duracion_s, video_bytes)
    values (v.marca, 'encargo', 'reel', 'reel',
            jsonb_build_object('encargo', v.id, 'version', v_e.version, 'titulo', v.titulo),
            coalesce(v_e.texto, v.texto), 'generada', 'encargo',
            v_e.ruta, v_e.portada_ruta,
            case when v_e.duracion_s between 3 and 90 then v_e.duracion_s end, v_e.bytes)
    returning * into v_p;
    update public.instagram_encargo_entregas set pieza_id = v_p.id where id = v_e.id;
  else
    if not exists (select 1 from storage.objects where bucket_id = 'instagram' and name = v_e.ruta) then
      raise exception 'La imagen de la versión % ya no está en el cubo', v_e.version using errcode = 'P0002';
    end if;
    insert into public.instagram_piezas (marca, plantilla, formato, tipo_medio, datos, caption, estado, origen, imagen_ruta)
    values (v.marca, 'encargo', v.formato, 'imagen',
            jsonb_build_object('encargo', v.id, 'version', v_e.version, 'titulo', v.titulo),
            coalesce(v_e.texto, v.texto), 'generada', 'encargo', v_e.ruta)
    returning * into v_p;
    update public.instagram_encargo_entregas set pieza_id = v_p.id where id = v_e.id;
  end if;

  update public.instagram_encargos set estado = 'aprobado', aprobado_at = now(), pieza_id = v_p.id
   where id = v.id returning * into v;
  v_evento := public.instagram_encargo_registrar(v, 'aprobar', 'restaurante', 'para_revisar', 'aprobado', format('Versión %s', v_e.version));
  return public.instagram_encargo_respuesta(v.id, v_evento, jsonb_build_object('piezaId', v_p.id));
end;
$$;

-- Cancelar. Un borrador se borra sin más; lo demás pide motivo.
create or replace function public.instagram_encargo_cancelar(p_id uuid, p_motivo text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.instagram_encargos;
  v_de text;
  v_evento uuid;
begin
  perform public.instagram_encargo_lado('restaurante');
  v := public.instagram_encargo_bloquear(p_id, array['borrador', 'enviado', 'aceptado', 'en_curso', 'para_revisar',
                                                     'cambios_pedidos', 'rechazado'], 'cancelar');
  if v.estado = 'borrador' then
    delete from public.instagram_encargos where id = v.id;
    return jsonb_build_object('ok', true, 'borrado', true, 'eventoId', null);
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Indica el motivo de la cancelación' using errcode = '22023';
  end if;
  v_de := v.estado;
  update public.instagram_encargos set estado = 'cancelado', motivo = left(trim(p_motivo), 2000), cerrado_at = now()
   where id = v.id returning * into v;
  v_evento := public.instagram_encargo_registrar(v, 'cancelar', 'restaurante', v_de, 'cancelado', trim(p_motivo));
  return public.instagram_encargo_respuesta(v.id, v_evento);
end;
$$;

-- ─── 8. RPC de la agencia ───────────────────────────────────────────────────

create or replace function public.instagram_encargo_aceptar(p_id uuid, p_fecha_entrega date default null, p_comentario text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.instagram_encargos;
  v_fecha date;
  v_evento uuid;
begin
  perform public.instagram_encargo_lado('agencia');
  v := public.instagram_encargo_bloquear(p_id, array['enviado'], 'aceptar');
  if v.modo <> 'oficiosos' then
    raise exception 'Ese encargo es automático: no lo hace la agencia' using errcode = '22023';
  end if;
  -- Por defecto: dos días antes de la fecha deseada, sin pasar del plazo estándar ni de hoy.
  v_fecha := coalesce(p_fecha_entrega,
                      greatest(public.instagram_encargo_hoy(), least(coalesce(v.fecha_entrega_prevista, v.fecha_deseada), v.fecha_deseada - 2)));
  if v_fecha < public.instagram_encargo_hoy() then
    raise exception 'La fecha de entrega no puede ser anterior a hoy' using errcode = '22023';
  end if;
  update public.instagram_encargos
     set estado = 'aceptado', aceptado_at = now(), fecha_entrega = v_fecha, asignado_a = auth.uid()
   where id = v.id returning * into v;
  if coalesce(trim(p_comentario), '') <> '' then
    insert into public.instagram_encargo_mensajes (encargo_id, lado, texto) values (v.id, 'agencia', left(trim(p_comentario), 4000));
  end if;
  v_evento := public.instagram_encargo_registrar(v, 'aceptar', 'agencia', 'enviado', 'aceptado',
    'Entrega el ' || to_char(v_fecha, 'DD/MM/YYYY') || coalesce('. ' || nullif(trim(p_comentario), ''), ''));
  return public.instagram_encargo_respuesta(v.id, v_evento);
end;
$$;

create or replace function public.instagram_encargo_rechazar(p_id uuid, p_motivo text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.instagram_encargos;
  v_de text;
  v_evento uuid;
begin
  perform public.instagram_encargo_lado('agencia');
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Indica el motivo (por ejemplo, falta material)' using errcode = '22023';
  end if;
  v := public.instagram_encargo_bloquear(p_id, array['enviado', 'aceptado'], 'rechazar');
  if v.modo <> 'oficiosos' then
    raise exception 'Ese encargo es automático: no lo hace la agencia' using errcode = '22023';
  end if;
  v_de := v.estado;
  update public.instagram_encargos set estado = 'rechazado', motivo = left(trim(p_motivo), 2000)
   where id = v.id returning * into v;
  v_evento := public.instagram_encargo_registrar(v, 'rechazar', 'agencia', v_de, 'rechazado', trim(p_motivo));
  return public.instagram_encargo_respuesta(v.id, v_evento);
end;
$$;

create or replace function public.instagram_encargo_empezar(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.instagram_encargos;
  v_de text;
  v_evento uuid;
begin
  perform public.instagram_encargo_lado('agencia');
  v := public.instagram_encargo_bloquear(p_id, array['aceptado', 'cambios_pedidos'], 'empezar');
  if v.modo <> 'oficiosos' then
    raise exception 'Ese encargo es automático: no lo hace la agencia' using errcode = '22023';
  end if;
  v_de := v.estado;
  update public.instagram_encargos set estado = 'en_curso', asignado_a = coalesce(asignado_a, auth.uid())
   where id = v.id returning * into v;
  v_evento := public.instagram_encargo_registrar(v, 'empezar', 'agencia', v_de, 'en_curso');
  return public.instagram_encargo_respuesta(v.id, v_evento);
end;
$$;

-- Entrega una versión. El fichero tiene que estar ya subido:
--   post/story → instagram        encargos/<encargo>/v<N>-<8 hex>.jpg
--   reel       → instagram-video  reels/AAAA-MM/<encargo>-<8 hex>.mp4 (+ portada .jpg opcional)
create or replace function public.instagram_encargo_entregar(
  p_id           uuid,
  p_ruta         text,
  p_portada_ruta text default null,
  p_texto        text default null,
  p_nota         text default null,
  p_bytes        bigint default null,
  p_ancho        integer default null,
  p_alto         integer default null,
  p_duracion_s   numeric default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.instagram_encargos;
  v_de text;
  v_cubo text;
  v_tipo text;
  v_ver integer;
  v_evento uuid;
begin
  perform public.instagram_encargo_lado('agencia');
  v := public.instagram_encargo_bloquear(p_id, array['aceptado', 'en_curso', 'cambios_pedidos'], 'entregar');
  if v.modo <> 'oficiosos' then
    raise exception 'Ese encargo es automático: no lo hace la agencia' using errcode = '22023';
  end if;
  if v.formato = 'reel' then
    v_cubo := 'instagram-video';
    v_tipo := 'reel';
    if p_ruta is null or p_ruta !~ ('^reels/[0-9]{4}-[0-9]{2}/' || v.id::text || '-[0-9a-f]{8}\.mp4$') then
      raise exception 'El vídeo tiene que ser un MP4 subido a reels/AAAA-MM/<encargo>-<código>.mp4' using errcode = '22023';
    end if;
    if p_portada_ruta is not null and p_portada_ruta !~ ('^reels/[0-9]{4}-[0-9]{2}/' || v.id::text || '-[0-9a-f]{8}\.jpg$') then
      raise exception 'La portada tiene que ser un JPEG junto al vídeo' using errcode = '22023';
    end if;
    if p_portada_ruta is not null and not exists (select 1 from storage.objects where bucket_id = v_cubo and name = p_portada_ruta) then
      raise exception 'La portada no está subida' using errcode = 'P0002';
    end if;
    if p_duracion_s is not null and (p_duracion_s < 3 or p_duracion_s > 90) then
      raise exception 'El reel tiene que durar entre 3 y 90 segundos' using errcode = '22023';
    end if;
  else
    v_cubo := 'instagram';
    v_tipo := 'imagen';
    if p_portada_ruta is not null then
      raise exception 'Una imagen no lleva portada' using errcode = '22023';
    end if;
    if p_ruta is null or p_ruta !~ ('^encargos/' || v.id::text || '/v[0-9]{1,3}-[0-9a-f]{8}\.jpg$') then
      raise exception 'La imagen tiene que ser un JPEG subido a encargos/<encargo>/v<N>-<código>.jpg' using errcode = '22023';
    end if;
  end if;
  if not exists (select 1 from storage.objects where bucket_id = v_cubo and name = p_ruta) then
    raise exception 'El fichero no está subido (%)', p_ruta using errcode = 'P0002';
  end if;
  if exists (select 1 from public.instagram_encargo_entregas where ruta = p_ruta) then
    raise exception 'Ese fichero ya se entregó en otra versión' using errcode = '23505';
  end if;
  if p_texto is not null and char_length(p_texto) > 2200 then
    raise exception 'El texto pasa de 2200 caracteres' using errcode = '22023';
  end if;

  v_de := v.estado;
  select coalesce(max(version), 0) + 1 into v_ver from public.instagram_encargo_entregas where encargo_id = v.id;
  insert into public.instagram_encargo_entregas (encargo_id, version, tipo_medio, cubo, ruta, portada_ruta, bytes, ancho, alto,
                                                duracion_s, texto, nota, entregado_por)
  values (v.id, v_ver, v_tipo, v_cubo, p_ruta, p_portada_ruta,
          case when p_bytes between 1 and 52428800 then p_bytes end,
          case when p_ancho between 1 and 10000 then p_ancho end,
          case when p_alto between 1 and 10000 then p_alto end,
          p_duracion_s, nullif(p_texto, ''), nullif(left(trim(p_nota), 2000), ''), auth.uid());
  update public.instagram_encargos set estado = 'para_revisar', entregado_at = now(), asignado_a = coalesce(asignado_a, auth.uid())
   where id = v.id returning * into v;
  v_evento := public.instagram_encargo_registrar(v, 'entregar', 'agencia', v_de, 'para_revisar',
    format('Versión %s', v_ver) || coalesce(': ' || nullif(trim(p_nota), ''), ''));
  return public.instagram_encargo_respuesta(v.id, v_evento, jsonb_build_object('version', v_ver));
end;
$$;

-- ─── 9. Hilo (los dos lados) ────────────────────────────────────────────────
create or replace function public.instagram_encargo_comentar(p_id uuid, p_texto text, p_lado text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.instagram_encargos;
  v_lado text;
  v_evento uuid;
begin
  v_lado := public.instagram_encargo_lado('cualquiera', p_lado);
  if coalesce(trim(p_texto), '') = '' then
    raise exception 'Escribe algo' using errcode = '22023';
  end if;
  select * into v from public.instagram_encargos where id = p_id;
  if not found or (v.estado = 'borrador' and v_lado = 'agencia') then
    raise exception 'No existe ese encargo' using errcode = 'P0002';
  end if;
  if v.estado = 'borrador' then
    raise exception 'Envía el encargo antes de comentar' using errcode = '55000';
  end if;
  insert into public.instagram_encargo_mensajes (encargo_id, lado, texto) values (v.id, v_lado, left(trim(p_texto), 4000));
  v_evento := public.instagram_encargo_registrar(v, 'comentar', v_lado, v.estado, v.estado, left(trim(p_texto), 300));
  return public.instagram_encargo_respuesta(v.id, v_evento);
end;
$$;

-- ─── 10. Destinatarios del Web Push (solo service_role: notificar-video) ────
-- Lo que hace el restaurante avisa a la agencia (todos los usuarios con el
-- permiso y quien lo tiene asignado); lo que hace la agencia o el sistema
-- avisa a quien creó el encargo. Nunca al que lo hizo ni a un usuario bloqueado.
create or replace function public.instagram_encargo_destinatarios(p_evento_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with ev as (
    select e.*, x.creado_por, x.asignado_a
      from public.instagram_encargo_eventos e
      join public.instagram_encargos x on x.id = e.encargo_id
     where e.id = p_evento_id
  ), quienes as (
    select p.user_id as u from ev, public.user_permissions p
     where ev.lado = 'restaurante' and p.section_key = 'instagram_agencia' and p.can_view
    union select ev.asignado_a from ev where ev.lado = 'restaurante'
    union select ev.creado_por from ev where ev.lado in ('agencia', 'sistema')
  )
  select distinct q.u from quienes q, ev
   where q.u is not null and q.u is distinct from ev.actor
     and not exists (select 1 from auth.users b where b.id = q.u and b.banned_until > now())
$$;

-- ─── 11. La pieza avanza el encargo ─────────────────────────────────────────
create or replace function public.instagram_piezas_avanzar_encargo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.instagram_encargos;
  v_ver integer;
begin
  if to_regclass('public.instagram_encargos') is null then
    return null;
  end if;
  -- Publicada → el encargo aprobado pasa a «publicado».
  if new.estado = 'publicada' and old.estado is distinct from 'publicada' then
    for v in update public.instagram_encargos set estado = 'publicado', publicado_at = now(), cerrado_at = now()
               where pieza_id = new.id and estado = 'aprobado' returning * loop
      perform public.instagram_encargo_registrar(v, 'publicar', 'sistema', 'aprobado', 'publicado');
    end loop;
  end if;
  -- MP4 de un encargo automático terminado → «para_revisar».
  if new.video_ruta is not null and old.video_ruta is distinct from new.video_ruta then
    for v in select * from public.instagram_encargos
              where pieza_id = new.id and modo = 'automatico' and estado = 'en_curso' for update loop
      select coalesce(max(version), 0) + 1 into v_ver from public.instagram_encargo_entregas where encargo_id = v.id;
      insert into public.instagram_encargo_entregas (encargo_id, version, tipo_medio, pieza_id, duracion_s, bytes, texto, entregado_por)
      values (v.id, v_ver, 'reel', new.id, new.duracion_s, new.video_bytes, new.caption, null);
      update public.instagram_encargos set estado = 'para_revisar', entregado_at = now() where id = v.id returning * into v;
      perform public.instagram_encargo_registrar(v, 'generado', 'sistema', 'en_curso', 'para_revisar');
    end loop;
  end if;
  return null;
end;
$$;
drop trigger if exists instagram_piezas_avanzar_encargo on public.instagram_piezas;
create trigger instagram_piezas_avanzar_encargo
  after update on public.instagram_piezas
  for each row execute function public.instagram_piezas_avanzar_encargo();

-- ─── 12. Permisos de ejecución ──────────────────────────────────────────────
do $$
declare
  v_f text;
begin
  foreach v_f in array array[
    'public.instagram_encargos_ajustes_al_editar()', 'public.instagram_encargos_al_editar()',
    'public.instagram_encargo_hoy()', 'public.instagram_sumar_dias_laborables(date, integer)',
    'public.instagram_encargo_lado(text, text)', 'public.instagram_encargo_bloquear(uuid, text[], text)',
    'public.instagram_encargo_registrar(public.instagram_encargos, text, text, text, text, text)',
    'public.instagram_encargo_respuesta(uuid, uuid, jsonb)',
    'public.instagram_encargo_guardar(uuid, jsonb)', 'public.instagram_encargo_enviar(uuid)',
    'public.instagram_encargo_vincular_pieza(uuid, uuid)', 'public.instagram_encargo_pedir_cambios(uuid, text)',
    'public.instagram_encargo_aprobar(uuid)', 'public.instagram_encargo_cancelar(uuid, text)',
    'public.instagram_encargo_aceptar(uuid, date, text)', 'public.instagram_encargo_rechazar(uuid, text)',
    'public.instagram_encargo_empezar(uuid)',
    'public.instagram_encargo_entregar(uuid, text, text, text, text, bigint, integer, integer, numeric)',
    'public.instagram_encargo_comentar(uuid, text, text)', 'public.instagram_encargo_destinatarios(uuid)',
    'public.instagram_piezas_avanzar_encargo()'] loop
    execute format('revoke all on function %s from public', v_f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon, authenticated', v_f);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    foreach v_f in array array[
      'public.instagram_encargo_guardar(uuid, jsonb)', 'public.instagram_encargo_enviar(uuid)',
      'public.instagram_encargo_vincular_pieza(uuid, uuid)', 'public.instagram_encargo_pedir_cambios(uuid, text)',
      'public.instagram_encargo_aprobar(uuid)', 'public.instagram_encargo_cancelar(uuid, text)',
      'public.instagram_encargo_aceptar(uuid, date, text)', 'public.instagram_encargo_rechazar(uuid, text)',
      'public.instagram_encargo_empezar(uuid)',
      'public.instagram_encargo_entregar(uuid, text, text, text, text, bigint, integer, integer, numeric)',
      'public.instagram_encargo_comentar(uuid, text, text)',
      'public.instagram_encargo_hoy()', 'public.instagram_sumar_dias_laborables(date, integer)'] loop
      execute format('grant execute on function %s to authenticated, service_role', v_f);
    end loop;
    execute 'grant execute on function public.instagram_encargo_destinatarios(uuid) to service_role';
  end if;
end;
$$;

-- ─── 13. Comprobación final ─────────────────────────────────────────────────
do $$
declare
  v_malos text[] := '{}';
  v_t text;
  v_malas text;
begin
  foreach v_t in array array['instagram_encargos_ajustes', 'instagram_encargos', 'instagram_encargo_adjuntos',
                             'instagram_encargo_entregas', 'instagram_encargo_mensajes', 'instagram_encargo_eventos'] loop
    if not (select relrowsecurity from pg_class where oid = format('public.%I', v_t)::regclass) then
      v_malos := v_malos || format('RLS apagada en %s', v_t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'anon') then
      if has_table_privilege('anon', format('public.%I', v_t), 'SELECT')
         or has_table_privilege('authenticated', format('public.%I', v_t), 'INSERT')
         or has_table_privilege('authenticated', format('public.%I', v_t), 'DELETE')
         or (v_t <> 'instagram_encargos_ajustes' and has_table_privilege('authenticated', format('public.%I', v_t), 'UPDATE')) then
        v_malos := v_malos || format('%s se puede escribir sin RPC (o anon la lee)', v_t);
      end if;
    end if;
  end loop;
  select string_agg(policyname, ', ') into v_malas
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname like 'ig\_encargos\_%'
     and coalesce(qual, with_check) not like '%bucket_id = ''instagram%';
  if v_malas is not null then
    v_malos := v_malos || format('políticas de storage sin acotar al cubo: %s', v_malas);
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.instagram_piezas'::regclass
                  and tgname = 'instagram_piezas_avanzar_encargo' and not tgisinternal) then
    v_malos := v_malos || 'falta el trigger instagram_piezas_avanzar_encargo'::text;
  end if;
  if (select count(*) from public.instagram_encargos_ajustes) <> 1 then
    v_malos := v_malos || 'instagram_encargos_ajustes no tiene exactamente una fila'::text;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    if has_function_privilege('anon', 'public.instagram_encargo_enviar(uuid)', 'execute')
       or has_function_privilege('authenticated', 'public.instagram_encargo_destinatarios(uuid)', 'execute')
       or has_function_privilege('authenticated', 'public.instagram_encargo_lado(text, text)', 'execute')
       or has_function_privilege('authenticated', 'public.instagram_encargo_registrar(public.instagram_encargos, text, text, text, text, text)', 'execute') then
      v_malos := v_malos || 'RPC internas o de encargos ejecutables por quien no debe'::text;
    end if;
  end if;
  if cardinality(v_malos) > 0 then
    raise exception 'instagram_encargos: comprobación final fallida (%). No se ha aplicado nada.', array_to_string(v_malos, '; ');
  end if;
  raise notice 'instagram_encargos: aplicada';
end;
$$;

commit;

-- VERIFICACIÓN (solo lectura):
--   select 'instagram_encargos: aplicada' as resultado,
--          (select to_jsonb(a) from public.instagram_encargos_ajustes a) as ajustes,
--          (select count(*) from public.instagram_encargos) as encargos;
