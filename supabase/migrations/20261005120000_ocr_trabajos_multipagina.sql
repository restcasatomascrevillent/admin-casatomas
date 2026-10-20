set client_encoding = 'UTF8';
-- (Primera línea a propósito: comentarios y nombres con tilde; psql en una
-- consola de Windows puede arrancar en WIN1252.)
-- ===========================================================================
-- ##                                                                       ##
-- ##          NO APLICADA: la aplica el dueño a mano (ver pasos)           ##
-- ##                                                                       ##
-- ##   Facturas · OCR de documentos largos (varias páginas y franjas) y    ##
-- ##   sustitución EN SITIO de una factura ya guardada.                    ##
-- ##   Diseño: docs/funcionalidades/04b-facturas-multipagina-plan.md      ##
-- ##                                                                       ##
-- ===========================================================================
--
-- POR QUÉ (decisiones del dueño, 05/10/2026)
--   · Luga ML/101511 (factura 54) se guardó con 8 de 54 líneas: una imagen muy
--     alta con dos páginas apiladas no cabe en una sola lectura del modelo.
--     Ahora el panel la trocea (franjas con solape, o páginas de un PDF) y
--     cada pieza se lee aparte, en segundo plano, encadenado por Postgres
--     (pg_net) y rescatado por un pg_cron por minuto.
--   · Para volver a subir Luga (54) y Salazones Garre (39) sin duplicarlas,
--     el panel ofrece «Sustituir la existente»: reemplazo en sitio, en UNA
--     transacción, con copia de auditoría.
--
-- QUÉ CAMBIA
--   1. facturas: + paginas (1..20, def. 1), + ocr_trabajo_id (uuid, FK y UNIQUE).
--      productos_factura: + pagina, + orden (rellenado 0..n-1 por factura en el
--      orden de id), + albaran_ref. Índice (factura_id, orden).
--   2. Tablas nuevas: ocr_trabajos, ocr_trabajo_paginas (piezas: página o
--      franja), facturas_sustituciones (auditoría de sustituciones).
--      RLS: lectura con can_read_section('facturas'); escritura SOLO service
--      role (las Edge Functions). anon sin nada.
--   3. Storage: política de INSERT estrecha en facturas-originales bajo
--      pendientes/{auth.uid()}/… con permiso de LECTURA de facturas (el mismo
--      que exige hoy procesar-factura para subir).
--   4. Funciones (SECURITY DEFINER, search_path fijo, EXECUTE solo
--      service_role): ocr_reclamar_pagina, ocr_cerrar_pagina,
--      ocr_fallo_pagina, ocr_reclamar_consolidacion, ocr_pedir_relectura,
--      ocr_terminar_trabajo, ocr_despachar, reanudar_trabajos_ocr,
--      ocr_factura_existente, ocr_sustituir_factura.
--   5. pg_cron «reanudar-trabajos-ocr» cada minuto. Queda MUDO (no llama a
--      nada) hasta que exista el secreto de Vault «ocr_trabajos_secret».
--
-- PASOS (desde adminpanelct/)
--   1. npx supabase db query --linked -f supabase/migrations/20261005120000_ocr_trabajos_multipagina.sql
--      Tiene que imprimir «ocr_trabajos_multipagina: aplicada | …».
--   2. npx supabase db query --linked -f supabase/tests/ocr_trabajos_multipagina_test.sql
--      (BEGIN … ROLLBACK: no deja nada escrito).
--   3. Desplegar procesar-factura y ocr-trabajo, crear OCR_TRABAJOS_SECRET y el
--      mismo valor en Vault (ver supabase/functions/DEPLOY-facturas.md).
--   Deshacer: supabase/rollbacks/20261005120000_ocr_trabajos_multipagina_ROLLBACK.sql
--   Idempotente: se puede ejecutar dos veces.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- ─── 0. Comprobaciones previas (abortan sin tocar nada) ─────────────────────
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception 'MIGRACIÓN ABORTADA: falta la extensión pg_net.';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'MIGRACIÓN ABORTADA: falta la extensión pg_cron.';
  end if;
  if not exists (select 1 from pg_extension where extname = 'supabase_vault') then
    raise exception 'MIGRACIÓN ABORTADA: falta la extensión supabase_vault.';
  end if;
  if to_regprocedure('public.can_read_section(text)') is null
     or to_regprocedure('public.actualizar_updated_at()') is null
     or to_regprocedure('public.verificar_duplicado_factura(character varying, character varying, date, numeric)') is null then
    raise exception 'MIGRACIÓN ABORTADA: faltan can_read_section / actualizar_updated_at / verificar_duplicado_factura.';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trigger_historial_precios'
                 and tgrelid = 'public.productos_factura'::regclass) then
    raise exception 'MIGRACIÓN ABORTADA: no está el trigger trigger_historial_precios (la sustitución cuenta con él).';
  end if;
  if not exists (select 1 from storage.buckets where id = 'facturas-originales') then
    raise exception 'MIGRACIÓN ABORTADA: no existe el bucket facturas-originales.';
  end if;
end;
$$;

-- ─── 1. Columnas nuevas en tablas existentes ────────────────────────────────
alter table public.facturas
  add column if not exists paginas smallint not null default 1,
  add column if not exists ocr_trabajo_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'facturas_paginas_rango') then
    alter table public.facturas add constraint facturas_paginas_rango check (paginas between 1 and 20);
  end if;
end;
$$;

alter table public.productos_factura
  add column if not exists pagina smallint,
  add column if not exists orden integer,
  add column if not exists albaran_ref varchar(100);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'productos_factura_pagina_rango') then
    alter table public.productos_factura add constraint productos_factura_pagina_rango check (pagina between 1 and 20);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'productos_factura_orden_pos') then
    alter table public.productos_factura add constraint productos_factura_orden_pos check (orden >= 0);
  end if;
end;
$$;

comment on column public.facturas.paginas is
  'Páginas del documento original (1 en el camino de una página). Lo escribe procesar-factura / ocr-trabajo.';
comment on column public.facturas.ocr_trabajo_id is
  'Trabajo de OCR (ocr_trabajos) que creó o sustituyó por última vez esta fila. UNIQUE: hace idempotente el insert de la consolidación.';
comment on column public.productos_factura.orden is
  'Posición de la línea en el documento (0..n-1), en el orden impreso. Las filas anteriores a 20261005120000 se rellenan en el orden de id.';
comment on column public.productos_factura.pagina is
  'Página del documento de la que sale la línea (1..20).';
comment on column public.productos_factura.albaran_ref is
  'Albarán de origen de la línea en facturas mensuales que agrupan albaranes (p. ej. "V/ 781.316"). Copiado tal cual; se hereda entre páginas cuando el albarán no repite su cabecera.';

-- Relleno: las líneas existentes quedan en página 1 y en el orden de inserción.
-- (trigger_historial_precios es AFTER INSERT: este UPDATE no lo dispara.)
update public.productos_factura p
   set orden = s.rn, pagina = coalesce(p.pagina, 1)
  from (select id, (row_number() over (partition by factura_id order by id) - 1)::int as rn
          from public.productos_factura) s
 where s.id = p.id and p.orden is null;

create index if not exists productos_factura_factura_orden_idx
  on public.productos_factura (factura_id, orden);

-- ─── 2. Tablas nuevas ───────────────────────────────────────────────────────
create table if not exists public.ocr_trabajos (
  id                       uuid primary key,              -- lo genera el navegador (carpeta de Storage)
  creado_por               uuid not null references auth.users(id),
  estado                   text not null default 'pendiente'
    constraint ocr_trabajos_estado check (estado in
      ('pendiente','pagina1','paginas','consolidando','completado','duplicado','fallido','cancelado')),
  num_paginas              smallint not null
    constraint ocr_trabajos_num check (num_paginas between 1 and 40),   -- piezas (páginas o franjas)
  paginas_documento        smallint not null default 1
    constraint ocr_trabajos_paginas_doc check (paginas_documento between 1 and 20),
  origen                   text not null
    constraint ocr_trabajos_origen check (origen in ('pdf','imagen','fotos','sincrono')),
  nombre_original          text not null,
  original_path            text,                          -- pendientes/{uid}/{id}/original.{ext}
  original_mime            text,
  contexto_p1              jsonb,
  modelo                   text,
  ronda_relectura          smallint not null default 0
    constraint ocr_trabajos_ronda check (ronda_relectura between 0 and 1),
  intentos_consolidacion   smallint not null default 0,
  lease_hasta              timestamptz,
  consolidar_despachado_at timestamptz,
  resultado                jsonb,                         -- lo que pinta el panel al terminar
  documento_pendiente      jsonb,                         -- duplicado: documento listo para «Sustituir la existente»
  factura_id               bigint references public.facturas(id) on delete set null,
  error                    text,
  coste_usd                numeric(10,5) not null default 0,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  terminado_at             timestamptz,
  limite_at                timestamptz not null default now() + interval '15 minutes'
);

comment on table public.ocr_trabajos is
  'OCR en segundo plano de documentos largos (04b) y documentos duplicados pendientes de sustituir. Escribe solo el service role.';

create table if not exists public.ocr_trabajo_paginas (
  id               bigserial primary key,
  trabajo_id       uuid not null references public.ocr_trabajos(id) on delete cascade,
  numero           smallint not null constraint ocr_paginas_numero check (numero between 1 and 40),
  pieza            text not null default 'pagina' constraint ocr_paginas_pieza check (pieza in ('pagina','franja')),
  pagina_doc       smallint not null default 1 constraint ocr_paginas_pagina_doc check (pagina_doc between 1 and 20),
  franja           smallint constraint ocr_paginas_franja check (franja between 1 and 40),
  franjas_pagina   smallint constraint ocr_paginas_franjas_pagina check (franjas_pagina between 1 and 40),
  storage_path     text not null,
  mime             text not null constraint ocr_paginas_mime check
                     (mime in ('application/pdf','image/jpeg','image/png','image/webp')),
  bytes            integer not null constraint ocr_paginas_bytes check (bytes between 1 and 10485760),
  estado           text not null default 'pendiente'
    constraint ocr_paginas_estado check (estado in ('pendiente','procesando','completada','fallida')),
  intentos         smallint not null default 0,
  relecturas       smallint not null default 0 constraint ocr_paginas_relecturas check (relecturas between 0 and 1),
  motivo_relectura jsonb,
  no_antes_de      timestamptz not null default now(),
  despachada_at    timestamptz,
  lease_hasta      timestamptz,
  resultado        jsonb,
  recuento         jsonb,
  verificacion_pie jsonb,
  motivos          jsonb,
  filas_extraidas  smallint,
  filas_contadas   smallint,
  duracion_ms      integer,
  tokens_entrada   integer,
  tokens_salida    integer,
  coste_usd        numeric(10,5),
  error            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint ocr_paginas_unica unique (trabajo_id, numero)
);

create table if not exists public.facturas_sustituciones (
  id               bigserial primary key,
  factura_id       bigint not null,                     -- sin FK a propósito: la copia sobrevive aunque se borre la factura
  trabajo_id       uuid references public.ocr_trabajos(id) on delete set null,
  sustituida_por   uuid references auth.users(id),
  sustituida_at    timestamptz not null default now(),
  factura_antes    jsonb not null,                      -- fila completa (sin embedding)
  productos_antes  jsonb not null,                      -- líneas completas (sin embedding)
  historial_antes  jsonb not null,                      -- historial_precios de esa factura
  resumen_antes    jsonb not null,                      -- {total, lineas, alertas…} que se mostró al confirmar
  resumen_despues  jsonb
);
comment on table public.facturas_sustituciones is
  'Copia de seguridad de cada sustitución en sitio de una factura (ocr_sustituir_factura). Solo lectura para el panel.';

create index if not exists ocr_trabajos_activos_idx on public.ocr_trabajos (estado, updated_at)
  where estado in ('pendiente','pagina1','paginas','consolidando');
create index if not exists ocr_trabajos_creador_idx on public.ocr_trabajos (creado_por, created_at desc);
create index if not exists ocr_paginas_trabajo_estado_idx on public.ocr_trabajo_paginas (trabajo_id, estado);
create index if not exists facturas_sustituciones_factura_idx on public.facturas_sustituciones (factura_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'facturas_ocr_trabajo_fk') then
    alter table public.facturas add constraint facturas_ocr_trabajo_fk foreign key (ocr_trabajo_id)
      references public.ocr_trabajos(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'facturas_ocr_trabajo_unico') then
    alter table public.facturas add constraint facturas_ocr_trabajo_unico unique (ocr_trabajo_id);
  end if;
end;
$$;

-- updated_at: actualizar_updated_at() hace NEW.updated_at = NOW(), válido para timestamptz.
drop trigger if exists trigger_ocr_trabajos_updated on public.ocr_trabajos;
create trigger trigger_ocr_trabajos_updated before update on public.ocr_trabajos
  for each row execute function public.actualizar_updated_at();
drop trigger if exists trigger_ocr_paginas_updated on public.ocr_trabajo_paginas;
create trigger trigger_ocr_paginas_updated before update on public.ocr_trabajo_paginas
  for each row execute function public.actualizar_updated_at();

-- ─── 3. RLS y privilegios ───────────────────────────────────────────────────
alter table public.ocr_trabajos enable row level security;
alter table public.ocr_trabajo_paginas enable row level security;
alter table public.facturas_sustituciones enable row level security;

revoke all on public.ocr_trabajos, public.ocr_trabajo_paginas, public.facturas_sustituciones from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.ocr_trabajos, public.ocr_trabajo_paginas, public.facturas_sustituciones from authenticated;
grant select on public.ocr_trabajos, public.ocr_trabajo_paginas, public.facturas_sustituciones to authenticated;
grant all on public.ocr_trabajos, public.ocr_trabajo_paginas, public.facturas_sustituciones to service_role;
revoke all on sequence public.ocr_trabajo_paginas_id_seq, public.facturas_sustituciones_id_seq from anon, authenticated;
grant usage, select on sequence public.ocr_trabajo_paginas_id_seq, public.facturas_sustituciones_id_seq to service_role;

drop policy if exists ocr_trabajos_select on public.ocr_trabajos;
create policy ocr_trabajos_select on public.ocr_trabajos for select to authenticated
  using (public.can_read_section('facturas'));
drop policy if exists ocr_paginas_select on public.ocr_trabajo_paginas;
create policy ocr_paginas_select on public.ocr_trabajo_paginas for select to authenticated
  using (public.can_read_section('facturas'));
drop policy if exists facturas_sustituciones_select on public.facturas_sustituciones;
create policy facturas_sustituciones_select on public.facturas_sustituciones for select to authenticated
  using (public.can_read_section('facturas'));
-- Sin políticas de escritura: solo escriben las Edge Functions (service role, que no pasa por RLS).

-- ─── 4. Storage: subida de piezas pendientes ────────────────────────────────
-- facturas_originales_insert exige can_write_section('facturas'), pero subir
-- documentos solo exige ver la sección (procesar-factura, 'view'). Política
-- estrecha: solo bajo pendientes/{su uid}/, solo INSERT (sin UPDATE = sin
-- upsert; sin DELETE, como hoy: el original es la prueba).
drop policy if exists facturas_originales_pendientes_insert on storage.objects;
create policy facturas_originales_pendientes_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'facturas-originales'
    and (storage.foldername(name))[1] = 'pendientes'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and public.can_read_section('facturas')
  );

-- ─── 5. Coordinación ────────────────────────────────────────────────────────

-- Encola las peticiones que tocan. Devuelve cuántas. Sin secreto en Vault no
-- hace nada (sistema mudo hasta el despliegue, como sync-trafico-web).
create or replace function public.ocr_despachar(p_trabajo_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  c_url    constant text := 'https://jeamoczmbfsnwkfjxcyo.supabase.co/functions/v1/ocr-trabajo';
  v_secreto text;
  t        public.ocr_trabajos%rowtype;
  p        public.ocr_trabajo_paginas%rowtype;
  v_vuelo  integer;
  n        integer := 0;
begin
  select s.decrypted_secret into v_secreto
    from vault.decrypted_secrets s where s.name = 'ocr_trabajos_secret' limit 1;
  if v_secreto is null or v_secreto = '' then
    return 0;
  end if;

  select * into t from public.ocr_trabajos where id = p_trabajo_id for update;
  if not found or t.estado not in ('pendiente', 'pagina1', 'paginas') then
    return 0;
  end if;

  if t.estado = 'pendiente' then
    update public.ocr_trabajos set estado = 'pagina1' where id = t.id;
    t.estado := 'pagina1';
  end if;

  if t.estado = 'pagina1' then
    select * into p from public.ocr_trabajo_paginas where trabajo_id = t.id and numero = 1;
    if not found or p.estado in ('completada', 'fallida') then
      update public.ocr_trabajos set estado = 'paginas' where id = t.id;
      t.estado := 'paginas';
    elsif p.estado = 'pendiente' and p.no_antes_de <= now()
          and (p.despachada_at is null or p.despachada_at < now() - interval '30 seconds') then
      perform net.http_post(
        url := c_url,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-ocr-secret', v_secreto),
        body := jsonb_build_object('modo', 'pagina', 'pagina_id', p.id),
        timeout_milliseconds := 10000);
      update public.ocr_trabajo_paginas set despachada_at = now() where id = p.id;
      n := n + 1;
    end if;
  end if;

  if t.estado = 'paginas' then
    select count(*) into v_vuelo from public.ocr_trabajo_paginas
     where trabajo_id = t.id and estado = 'procesando';
    for p in
      select * from public.ocr_trabajo_paginas
       where trabajo_id = t.id and estado = 'pendiente' and no_antes_de <= now()
         and (despachada_at is null or despachada_at < now() - interval '30 seconds')
       order by numero
       limit greatest(0, 4 - v_vuelo)
    loop
      perform net.http_post(
        url := c_url,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-ocr-secret', v_secreto),
        body := jsonb_build_object('modo', 'pagina', 'pagina_id', p.id),
        timeout_milliseconds := 10000);
      update public.ocr_trabajo_paginas set despachada_at = now() where id = p.id;
      n := n + 1;
    end loop;

    if not exists (select 1 from public.ocr_trabajo_paginas
                    where trabajo_id = t.id and estado in ('pendiente', 'procesando'))
       and (t.consolidar_despachado_at is null or t.consolidar_despachado_at < now() - interval '30 seconds') then
      perform net.http_post(
        url := c_url,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-ocr-secret', v_secreto),
        body := jsonb_build_object('modo', 'consolidar', 'trabajo_id', t.id),
        timeout_milliseconds := 10000);
      update public.ocr_trabajos set consolidar_despachado_at = now() where id = t.id;
      n := n + 1;
    end if;
  end if;
  return n;
end;
$$;

-- Reclama una pieza (lease). 0 filas = otro la tiene, no toca o el trabajo terminó.
create or replace function public.ocr_reclamar_pagina(p_pagina_id bigint, p_lease_seg integer default 180)
returns setof public.ocr_trabajo_paginas
language sql
security definer
set search_path = public
as $$
  update public.ocr_trabajo_paginas pg
     set estado = 'procesando', intentos = pg.intentos + 1,
         lease_hasta = now() + make_interval(secs => greatest(30, least(p_lease_seg, 600)))
    from public.ocr_trabajos t
   where pg.id = p_pagina_id and pg.estado = 'pendiente' and pg.no_antes_de <= now()
     and t.id = pg.trabajo_id
     and (t.estado = 'paginas' or (t.estado = 'pagina1' and pg.numero = 1))
  returning pg.*;
$$;

-- Cierra una pieza leída. p_contexto solo para la pieza 1.
create or replace function public.ocr_cerrar_pagina(
  p_pagina_id bigint, p_resultado jsonb, p_recuento jsonb, p_verificacion jsonb, p_motivos jsonb,
  p_filas_extraidas integer, p_filas_contadas integer, p_relecturas integer, p_duracion_ms integer,
  p_tokens_entrada integer, p_tokens_salida integer, p_coste numeric, p_contexto jsonb, p_modelo text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  pg public.ocr_trabajo_paginas%rowtype;
begin
  update public.ocr_trabajo_paginas
     set estado = 'completada', lease_hasta = null, resultado = p_resultado, recuento = p_recuento,
         verificacion_pie = p_verificacion, motivos = p_motivos,
         filas_extraidas = least(p_filas_extraidas, 32767), filas_contadas = least(p_filas_contadas, 32767),
         relecturas = greatest(relecturas, least(coalesce(p_relecturas, 0), 1)),
         duracion_ms = p_duracion_ms, tokens_entrada = p_tokens_entrada, tokens_salida = p_tokens_salida,
         coste_usd = p_coste, error = null
   where id = p_pagina_id and estado = 'procesando'
  returning * into pg;
  if not found then
    return false;
  end if;

  update public.ocr_trabajos
     set coste_usd = coste_usd + coalesce(p_coste, 0),
         modelo = coalesce(p_modelo, modelo),
         contexto_p1 = case when pg.numero = 1 and p_contexto is not null then p_contexto else contexto_p1 end,
         estado = case when estado = 'pagina1' and pg.numero = 1 then 'paginas' else estado end
   where id = pg.trabajo_id;

  perform public.ocr_despachar(pg.trabajo_id);
  return true;
end;
$$;

-- Fallo técnico de una pieza: reintento con espera (30 s · intento) hasta 3; luego «fallida».
create or replace function public.ocr_fallo_pagina(p_pagina_id bigint, p_error text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  pg public.ocr_trabajo_paginas%rowtype;
  v_estado text;
begin
  select * into pg from public.ocr_trabajo_paginas where id = p_pagina_id for update;
  if not found or pg.estado not in ('procesando', 'pendiente') then
    return null;
  end if;
  v_estado := case when pg.intentos >= 3 then 'fallida' else 'pendiente' end;
  update public.ocr_trabajo_paginas
     set estado = v_estado, lease_hasta = null, despachada_at = null,
         no_antes_de = now() + make_interval(secs => 30 * greatest(pg.intentos, 1)),
         error = left(coalesce(p_error, 'error desconocido'), 2000)
   where id = p_pagina_id;
  if v_estado = 'fallida' and pg.numero = 1 then
    update public.ocr_trabajos set estado = 'paginas' where id = pg.trabajo_id and estado = 'pagina1';
  end if;
  perform public.ocr_despachar(pg.trabajo_id);
  return v_estado;
end;
$$;

-- Reclama la consolidación (una sola vez a la vez).
create or replace function public.ocr_reclamar_consolidacion(p_trabajo_id uuid, p_lease_seg integer default 180)
returns setof public.ocr_trabajos
language sql
security definer
set search_path = public
as $$
  update public.ocr_trabajos t
     set estado = 'consolidando', intentos_consolidacion = t.intentos_consolidacion + 1,
         lease_hasta = now() + make_interval(secs => greatest(30, least(p_lease_seg, 600)))
   where t.id = p_trabajo_id
     and ((t.estado = 'paginas'
           and not exists (select 1 from public.ocr_trabajo_paginas pg
                            where pg.trabajo_id = t.id and pg.estado in ('pendiente', 'procesando')))
          or (t.estado = 'consolidando' and t.lease_hasta < now()))
  returning t.*;
$$;

-- Relectura diferida de piezas concretas: UNA ronda por trabajo.
create or replace function public.ocr_pedir_relectura(p_trabajo_id uuid, p_paginas jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer := 0;
  r jsonb;
begin
  if not exists (select 1 from public.ocr_trabajos
                  where id = p_trabajo_id and estado = 'consolidando' and ronda_relectura = 0) then
    return 0;
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_paginas, '[]'::jsonb)) loop
    update public.ocr_trabajo_paginas
       set estado = 'pendiente', relecturas = 1, motivo_relectura = r->'motivo', despachada_at = null,
           no_antes_de = now(), lease_hasta = null
     where id = (r->>'pagina_id')::bigint and trabajo_id = p_trabajo_id
       and estado = 'completada' and relecturas = 0;
    if found then n := n + 1; end if;
  end loop;
  if n = 0 then
    return 0;
  end if;
  update public.ocr_trabajos
     set estado = 'paginas', ronda_relectura = 1, lease_hasta = null, consolidar_despachado_at = null
   where id = p_trabajo_id;
  perform public.ocr_despachar(p_trabajo_id);
  return n;
end;
$$;

-- Estado terminal de un trabajo (completado / duplicado / fallido).
create or replace function public.ocr_terminar_trabajo(
  p_trabajo_id uuid, p_estado text, p_resultado jsonb, p_factura_id bigint, p_error text,
  p_documento_pendiente jsonb default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_estado not in ('completado', 'duplicado', 'fallido') then
    raise exception 'ocr_terminar_trabajo: estado % no permitido', p_estado;
  end if;
  update public.ocr_trabajos
     set estado = p_estado, resultado = p_resultado, factura_id = p_factura_id,
         error = left(p_error, 2000), documento_pendiente = p_documento_pendiente,
         terminado_at = now(), lease_hasta = null
   where id = p_trabajo_id and estado not in ('completado', 'duplicado', 'fallido', 'cancelado');
  return found;
end;
$$;

-- pg_cron cada minuto: rescata lo que se quede colgado.
create or replace function public.reanudar_trabajos_ocr()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n integer := 0;
begin
  -- 1. Piezas con el lease caducado (el worker murió): fallo técnico → reintento.
  for r in select id from public.ocr_trabajo_paginas where estado = 'procesando' and lease_hasta < now() loop
    perform public.ocr_fallo_pagina(r.id, 'lease caducado (el worker no cerró la pieza)');
    n := n + 1;
  end loop;

  -- 2. Trabajos que pasan del límite → fallido.
  update public.ocr_trabajos
     set estado = 'fallido', error = coalesce(error, 'tiempo agotado (15 min) sin terminar'),
         terminado_at = now(), lease_hasta = null
   where estado in ('pendiente', 'pagina1', 'paginas', 'consolidando') and limite_at < now();

  -- 3. Consolidación con el lease caducado: reintento (máx. 3) o fallido.
  update public.ocr_trabajos
     set estado = 'fallido', error = coalesce(error, 'la consolidación falló 3 veces'),
         terminado_at = now(), lease_hasta = null
   where estado = 'consolidando' and lease_hasta < now() and intentos_consolidacion >= 3;
  update public.ocr_trabajos
     set estado = 'paginas', lease_hasta = null, consolidar_despachado_at = null
   where estado = 'consolidando' and lease_hasta < now() and intentos_consolidacion < 3;

  -- 4. Trabajos activos sin movimiento en 60 s → volver a despachar.
  for r in select id from public.ocr_trabajos
            where estado in ('pendiente', 'pagina1', 'paginas') and updated_at < now() - interval '60 seconds' loop
    n := n + public.ocr_despachar(r.id);
  end loop;
  return n;
end;
$$;

-- ─── 6. Duplicados y sustitución en sitio ───────────────────────────────────

-- ¿Ya existe esta factura? Primero el criterio de siempre
-- (verificar_duplicado_factura); si no, el número NORMALIZADO (sin espacios
-- ni signos: «F / 25011959» = «F/25011959») con el mismo proveedor o CIF.
-- Devuelve el resumen que el panel enseña antes de sustituir, o null.
create or replace function public.ocr_factura_existente(
  p_numero text, p_proveedor text, p_cif text, p_fecha date, p_total numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dup json;
  v_id bigint;
  v_motivo text;
  v_num text := upper(regexp_replace(coalesce(p_numero, ''), '[^A-Za-z0-9]', '', 'g'));
  v_cif text := upper(regexp_replace(coalesce(p_cif, ''), '[^A-Za-z0-9]', '', 'g'));
  v_prov text := lower(trim(coalesce(p_proveedor, '')));
  f record;
begin
  v_dup := public.verificar_duplicado_factura(coalesce(p_numero, ''), coalesce(p_proveedor, ''), p_fecha, coalesce(p_total, 0));
  if (v_dup->>'es_duplicado')::boolean then
    v_id := (v_dup->'factura_existente'->>'id')::bigint;
    v_motivo := v_dup->>'motivo';
  elsif v_num <> '' then
    select fa.id into v_id
      from public.facturas fa
     where upper(regexp_replace(fa.numero_documento, '[^A-Za-z0-9]', '', 'g')) = v_num
       and (v_prov = '' or fa.proveedor is null
            or lower(fa.proveedor) like '%' || v_prov || '%' or v_prov like '%' || lower(fa.proveedor) || '%'
            or (v_cif <> '' and upper(regexp_replace(coalesce(fa.cif, ''), '[^A-Za-z0-9]', '', 'g')) = v_cif))
     order by fa.id
     limit 1;
    v_motivo := 'numero_normalizado';
  end if;
  if v_id is null then
    return null;
  end if;

  select fa.id, fa.numero_documento, fa.proveedor, fa.cif, fa.fecha, fa.total, fa.total_origen, fa.tipo,
         fa.archivo_path, fa.updated_at, fa.paginas,
         (select count(*) from public.productos_factura p where p.factura_id = fa.id) as lineas,
         (select count(*) from public.historial_precios h where h.factura_id = fa.id) as historial,
         coalesce(jsonb_array_length(case when jsonb_typeof(fa.alertas_validacion) = 'array' then fa.alertas_validacion end), 0) as alertas,
         (select count(*) from jsonb_array_elements(case when jsonb_typeof(fa.alertas_validacion) = 'array' then fa.alertas_validacion else '[]'::jsonb end) a
           where a->>'severidad' = 'alta') as alertas_graves
    into f
    from public.facturas fa where fa.id = v_id;
  return jsonb_build_object(
    'id', f.id, 'numero_documento', f.numero_documento, 'proveedor', f.proveedor, 'cif', f.cif,
    'fecha', f.fecha, 'total', f.total, 'total_origen', f.total_origen, 'tipo', f.tipo,
    'lineas', f.lineas, 'historial', f.historial, 'alertas', f.alertas, 'alertas_graves', f.alertas_graves,
    'archivo_path', f.archivo_path, 'paginas', f.paginas, 'updated_at', f.updated_at, 'motivo', v_motivo);
end;
$$;

-- Sustituye EN SITIO la factura p_factura_id por el documento pendiente del
-- trabajo p_trabajo_id. Todo o nada:
--   copia de auditoría → borra su historial_precios (FK sin cascade) → borra
--   sus líneas → actualiza la cabecera (mismo id) → inserta las líneas nuevas
--   (el trigger AFTER INSERT rehace historial_precios con el proveedor y la
--   fecha nuevos) → trabajo «completado».
-- p_esperado = lo que vio el usuario al confirmar ({updated_at, lineas}): si
-- la factura ha cambiado desde entonces, aborta (concurrencia optimista).
create or replace function public.ocr_sustituir_factura(
  p_factura_id bigint, p_trabajo_id uuid, p_usuario uuid, p_cabecera jsonb, p_lineas jsonb,
  p_esperado jsonb, p_archivo_path text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  fa public.facturas%rowtype;
  t  public.ocr_trabajos%rowtype;
  v_lineas_antes integer;
  v_hist_borrado integer;
  v_hist_creado integer;
  v_insertadas integer;
  v_sust_id bigint;
begin
  select * into t from public.ocr_trabajos where id = p_trabajo_id for update;
  if not found then raise exception 'SUSTITUCIÓN ABORTADA: no existe el trabajo %', p_trabajo_id; end if;
  if t.estado <> 'duplicado' then
    raise exception 'SUSTITUCIÓN ABORTADA: el trabajo % está «%», no «duplicado».', p_trabajo_id, t.estado;
  end if;

  select * into fa from public.facturas where id = p_factura_id for update;
  if not found then raise exception 'SUSTITUCIÓN ABORTADA: no existe la factura %', p_factura_id; end if;

  select count(*) into v_lineas_antes from public.productos_factura where factura_id = p_factura_id;
  if p_esperado ? 'lineas' and (p_esperado->>'lineas')::int <> v_lineas_antes then
    raise exception 'SUSTITUCIÓN ABORTADA: la factura % tiene ahora % líneas (al confirmar tenía %). Vuelve a intentarlo.',
      p_factura_id, v_lineas_antes, p_esperado->>'lineas';
  end if;
  if p_esperado ? 'updated_at' and p_esperado->>'updated_at' is not null
     and fa.updated_at is distinct from (p_esperado->>'updated_at')::timestamp then
    raise exception 'SUSTITUCIÓN ABORTADA: la factura % se ha modificado después de confirmar. Vuelve a intentarlo.', p_factura_id;
  end if;
  if jsonb_typeof(p_lineas) <> 'array' then
    raise exception 'SUSTITUCIÓN ABORTADA: p_lineas no es una lista';
  end if;
  if coalesce(p_cabecera->>'numero_documento', '') = '' then
    raise exception 'SUSTITUCIÓN ABORTADA: la cabecera nueva no trae número de documento';
  end if;

  -- 1. Copia de auditoría (sin embeddings: pesan y se regeneran).
  insert into public.facturas_sustituciones
    (factura_id, trabajo_id, sustituida_por, factura_antes, productos_antes, historial_antes, resumen_antes)
  values (
    p_factura_id, p_trabajo_id, p_usuario,
    to_jsonb(fa) - 'embedding' - 'embedding_observaciones',
    coalesce((select jsonb_agg(to_jsonb(p) - 'embedding' order by p.id)
                from public.productos_factura p where p.factura_id = p_factura_id), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at, h.id)
                from public.historial_precios h where h.factura_id = p_factura_id), '[]'::jsonb),
    jsonb_build_object('total', fa.total, 'lineas', v_lineas_antes, 'alertas', fa.alertas_validacion,
                       'esperado', p_esperado))
  returning id into v_sust_id;

  -- 2. Historial y líneas viejas.
  delete from public.historial_precios where factura_id = p_factura_id;
  get diagnostics v_hist_borrado = row_count;
  delete from public.productos_factura where factura_id = p_factura_id;

  -- 3. Cabecera nueva, mismo id. (Antes que las líneas: el trigger del
  --    historial lee proveedor y fecha de facturas.)
  update public.facturas
     set tipo = p_cabecera->>'tipo',
         proveedor = p_cabecera->>'proveedor',
         cif = p_cabecera->>'cif',
         numero_documento = p_cabecera->>'numero_documento',
         fecha = (p_cabecera->>'fecha')::date,
         subtotal = (p_cabecera->>'subtotal')::numeric,
         iva = (p_cabecera->>'iva')::numeric,
         total = (p_cabecera->>'total')::numeric,
         total_origen = p_cabecera->>'total_origen',
         observaciones = p_cabecera->>'observaciones',
         resumen = p_cabecera->>'resumen',
         embedding = case when p_cabecera ? 'embedding' and p_cabecera->>'embedding' is not null
                          then (p_cabecera->>'embedding')::vector else null end,
         alertas_validacion = null,
         verificada = false,
         procesado_en = now(),
         paginas = coalesce((p_cabecera->>'paginas')::smallint, 1),
         ocr_trabajo_id = p_trabajo_id,
         archivo_path = coalesce(p_archivo_path, archivo_path),
         drive_url = case when p_archivo_path is not null then null else drive_url end
   where id = p_factura_id;

  -- 4. Líneas nuevas.
  insert into public.productos_factura
    (factura_id, nombre, cantidad, unidad, precio_unitario, total, embedding, pagina, orden, albaran_ref)
  select p_factura_id,
         l->>'nombre',
         coalesce((l->>'cantidad')::numeric, 1),
         coalesce(l->>'unidad', 'unidades'),
         (l->>'precio_unitario')::numeric,
         (l->>'total')::numeric,
         case when l->>'embedding' is not null then (l->>'embedding')::vector end,
         coalesce((l->>'pagina')::smallint, 1),
         coalesce((l->>'orden')::int, (ord - 1)::int),
         nullif(left(l->>'albaran_ref', 100), '')
    from jsonb_array_elements(p_lineas) with ordinality as x(l, ord);
  get diagnostics v_insertadas = row_count;
  select count(*) into v_hist_creado from public.historial_precios where factura_id = p_factura_id;

  -- 5. Trabajo cerrado.
  update public.ocr_trabajos
     set estado = 'completado', factura_id = p_factura_id, terminado_at = now(), documento_pendiente = null
   where id = p_trabajo_id;

  update public.facturas_sustituciones
     set resumen_despues = jsonb_build_object('total', p_cabecera->'total', 'lineas', v_insertadas,
                                              'historial_borrado', v_hist_borrado, 'historial_creado', v_hist_creado)
   where id = v_sust_id;

  return jsonb_build_object('factura_id', p_factura_id, 'sustitucion_id', v_sust_id,
                            'lineas_antes', v_lineas_antes, 'lineas', v_insertadas,
                            'historial_borrado', v_hist_borrado, 'historial_creado', v_hist_creado);
end;
$$;

revoke all on function public.ocr_despachar(uuid) from public, anon, authenticated;
revoke all on function public.ocr_reclamar_pagina(bigint, integer) from public, anon, authenticated;
revoke all on function public.ocr_cerrar_pagina(bigint, jsonb, jsonb, jsonb, jsonb, integer, integer, integer, integer, integer, integer, numeric, jsonb, text) from public, anon, authenticated;
revoke all on function public.ocr_fallo_pagina(bigint, text) from public, anon, authenticated;
revoke all on function public.ocr_reclamar_consolidacion(uuid, integer) from public, anon, authenticated;
revoke all on function public.ocr_pedir_relectura(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.ocr_terminar_trabajo(uuid, text, jsonb, bigint, text, jsonb) from public, anon, authenticated;
revoke all on function public.reanudar_trabajos_ocr() from public, anon, authenticated;
revoke all on function public.ocr_factura_existente(text, text, text, date, numeric) from public, anon, authenticated;
revoke all on function public.ocr_sustituir_factura(bigint, uuid, uuid, jsonb, jsonb, jsonb, text) from public, anon, authenticated;

grant execute on function public.ocr_despachar(uuid) to service_role;
grant execute on function public.ocr_reclamar_pagina(bigint, integer) to service_role;
grant execute on function public.ocr_cerrar_pagina(bigint, jsonb, jsonb, jsonb, jsonb, integer, integer, integer, integer, integer, integer, numeric, jsonb, text) to service_role;
grant execute on function public.ocr_fallo_pagina(bigint, text) to service_role;
grant execute on function public.ocr_reclamar_consolidacion(uuid, integer) to service_role;
grant execute on function public.ocr_pedir_relectura(uuid, jsonb) to service_role;
grant execute on function public.ocr_terminar_trabajo(uuid, text, jsonb, bigint, text, jsonb) to service_role;
grant execute on function public.reanudar_trabajos_ocr() to service_role;
grant execute on function public.ocr_factura_existente(text, text, text, date, numeric) to service_role;
grant execute on function public.ocr_sustituir_factura(bigint, uuid, uuid, jsonb, jsonb, jsonb, text) to service_role;

-- ─── 7. Cron (instalado; mudo hasta crear el secreto de Vault) ──────────────
select cron.unschedule('reanudar-trabajos-ocr')
 where exists (select 1 from cron.job where jobname = 'reanudar-trabajos-ocr');
select cron.schedule('reanudar-trabajos-ocr', '* * * * *', $cron$ select public.reanudar_trabajos_ocr(); $cron$);

-- ─── 8. Comprobación final (aborta si algo no quedó) ────────────────────────
do $$
declare
  n integer;
begin
  select count(*) into n from public.productos_factura where orden is null or pagina is null;
  if n <> 0 then raise exception 'MIGRACIÓN ABORTADA: % líneas sin orden/pagina tras el relleno.', n; end if;
  select count(*) into n from (
    select factura_id from public.productos_factura group by factura_id
    having max(orden) <> count(*) - 1 or min(orden) <> 0 or count(distinct orden) <> count(*)) s;
  if n <> 0 then raise exception 'MIGRACIÓN ABORTADA: % facturas con huecos en orden.', n; end if;
  if (select count(*) from cron.job where jobname = 'reanudar-trabajos-ocr') <> 1 then
    raise exception 'MIGRACIÓN ABORTADA: el cron reanudar-trabajos-ocr no quedó instalado una vez.';
  end if;
  if has_function_privilege('anon', 'public.ocr_despachar(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.ocr_sustituir_factura(bigint, uuid, uuid, jsonb, jsonb, jsonb, text)', 'execute') then
    raise exception 'MIGRACIÓN ABORTADA: las RPC de coordinación son ejecutables por anon/authenticated.';
  end if;
end;
$$;

commit;

-- Verificación (solo lectura): «aplicada | líneas con orden | cron activo | secreto de Vault creado».
select 'ocr_trabajos_multipagina: aplicada' as resultado,
       (select count(*) from public.productos_factura where orden is not null) as lineas_con_orden,
       (select active from cron.job where jobname = 'reanudar-trabajos-ocr') as cron_activo,
       exists (select 1 from vault.secrets where name = 'ocr_trabajos_secret') as secreto_vault_creado;
