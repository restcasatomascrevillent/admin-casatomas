set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261122143000_resenas_contestador — Reseñas de Google: contestador con IA
-- y conexión con Google Business Profile (10/11/2026)
-- ===========================================================================
-- Petición del dueño: «Conectar reseñas + un contestador».
--
--   * `resenas`: columnas del contestador. Para cada reseña la IA propone una
--     respuesta (respuesta_propuesta); el dueño la revisa, la edita y la
--     aprueba. NADA se publica en Google sin aprobación, salvo que el dueño
--     encienda la respuesta automática (apagada por defecto) para las
--     estrellas que elija. `respuesta` sigue siendo la respuesta que hay
--     PUBLICADA en Google (la escrita aquí o la que ya existía allí).
--       respuesta_estado: pendiente → propuesta → aprobada → publicada
--                         (o error, si Google rechazó la publicación).
--     Más el enlace a la reseña en Google Maps (google_maps_uri) y su nombre
--     en Business Profile (gbp_review_name, necesario para responder).
--   * `resenas_ajustes` (una fila): proponer solas las respuestas de las
--     reseñas nuevas, respuesta automática (apagada) y sus estrellas, firma e
--     indicaciones de tono; y la ficha de Business Profile conectada. Solo
--     super admin.
--   * `resenas_google_token`: el refresh token OAuth de la cuenta del negocio.
--     Sin políticas y sin GRANT: solo la service role (la Edge Function
--     resenas-contestador) lo lee. Nunca llega al navegador.
--   * Alta de «resenas-contestador» en Gasto IA (ia_funciones +
--     ia_modelo_funcion), instrumentada: registra cada llamada en ia_uso.
--
-- La web pública no cambia: `anon` solo tiene SELECT por columnas en
-- `resenas` (20260923100000) y las columnas nuevas no se le conceden.
--
-- Idempotente. Necesita is_super_admin y update_updated_at_column.
-- Rollback: supabase/rollbacks/20261122143000_resenas_contestador_ROLLBACK.sql
-- ===========================================================================

begin;

do $$
begin
  if to_regclass('public.resenas') is null then
    raise exception 'resenas_contestador: falta la tabla resenas.';
  end if;
  if to_regprocedure('public.is_super_admin(uuid)') is null then
    raise exception 'resenas_contestador: falta is_super_admin(uuid).';
  end if;
end;
$$;

-- ─── 1. Columnas del contestador en resenas ─────────────────────────────────

alter table public.resenas
  add column if not exists respuesta_propuesta text,
  add column if not exists respuesta_estado text not null default 'pendiente',
  add column if not exists respuesta_origen text,
  add column if not exists respuesta_modelo text,
  add column if not exists respuesta_automatica boolean not null default false,
  add column if not exists respuesta_aprobada_por uuid,
  add column if not exists respuesta_aprobada_en timestamptz,
  add column if not exists respuesta_error text,
  add column if not exists respuesta_intentos integer not null default 0,
  add column if not exists gbp_review_name text,
  add column if not exists google_maps_uri text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'resenas_respuesta_estado_check') then
    alter table public.resenas add constraint resenas_respuesta_estado_check
      check (respuesta_estado in ('pendiente', 'propuesta', 'aprobada', 'publicada', 'error'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'resenas_respuesta_origen_check') then
    alter table public.resenas add constraint resenas_respuesta_origen_check
      check (respuesta_origen is null or respuesta_origen in ('ia', 'editada', 'google', 'manual'));
  end if;
  -- Google Business Profile admite respuestas de hasta 4.096 caracteres.
  if not exists (select 1 from pg_constraint where conname = 'resenas_respuesta_propuesta_largo') then
    alter table public.resenas add constraint resenas_respuesta_propuesta_largo
      check (respuesta_propuesta is null or char_length(respuesta_propuesta) <= 4096);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'resenas_google_maps_uri_https') then
    alter table public.resenas add constraint resenas_google_maps_uri_https
      check (google_maps_uri is null or google_maps_uri ~ '^https://');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'resenas_respuesta_intentos_no_negativo') then
    alter table public.resenas add constraint resenas_respuesta_intentos_no_negativo check (respuesta_intentos >= 0);
  end if;
end;
$$;

create unique index if not exists resenas_gbp_review_name_unico on public.resenas (gbp_review_name) where gbp_review_name is not null;
create index if not exists resenas_respuesta_estado_idx on public.resenas (respuesta_estado);

-- Las reseñas que ya tienen una respuesta guardada cuentan como publicadas.
update public.resenas
   set respuesta_estado = 'publicada', respuesta_origen = coalesce(respuesta_origen, 'google')
 where respuesta is not null and btrim(respuesta) <> '' and respuesta_estado = 'pendiente';

comment on column public.resenas.respuesta is 'Respuesta PUBLICADA en Google (escrita en el panel o leída de Business Profile).';
comment on column public.resenas.respuesta_propuesta is 'Borrador de respuesta (IA o editado por el dueño). No se publica sin aprobación.';
comment on column public.resenas.respuesta_estado is 'pendiente · propuesta (borrador listo) · aprobada (falta publicar/copiar) · publicada · error';
comment on column public.resenas.gbp_review_name is 'accounts/…/locations/…/reviews/… de Google Business Profile (para responder).';

-- ─── 2. Ajustes del contestador (una fila) ──────────────────────────────────

create table if not exists public.resenas_ajustes (
  id boolean primary key default true check (id),
  proponer_automatico boolean not null default true,
  autorespuesta_activa boolean not null default false,
  autorespuesta_estrellas integer[] not null default '{4,5}',
  autorespuesta_sin_texto boolean not null default true,
  firma text not null default 'El equipo de Casa Tomás' check (char_length(firma) <= 120),
  indicaciones text not null default '' check (char_length(indicaciones) <= 1500),
  gbp_cuenta text,
  gbp_ubicacion text,
  gbp_ubicacion_nombre text,
  gbp_email text,
  gbp_conectada_en timestamptz,
  gbp_ultima_sincronizacion timestamptz,
  gbp_ultimo_error text,
  ultimo_ciclo timestamptz,
  ultimo_ciclo_resumen jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint resenas_ajustes_estrellas_validas check (autorespuesta_estrellas <@ array[1, 2, 3, 4, 5]),
  constraint resenas_ajustes_ubicacion_formato check (gbp_ubicacion is null or gbp_ubicacion ~ '^accounts/[0-9]+/locations/[0-9]+$')
);

insert into public.resenas_ajustes (id) values (true) on conflict (id) do nothing;

alter table public.resenas_ajustes enable row level security;
revoke all on public.resenas_ajustes from anon;

drop policy if exists resenas_ajustes_superadmin on public.resenas_ajustes;
create policy resenas_ajustes_superadmin on public.resenas_ajustes for all to authenticated
  using ((select public.is_super_admin((select auth.uid()))))
  with check ((select public.is_super_admin((select auth.uid()))));

-- El navegador solo cambia las preferencias; la conexión con Google y el
-- resumen del ciclo los escribe la Edge Function (service role).
revoke insert, update, delete on public.resenas_ajustes from authenticated;
grant select on public.resenas_ajustes to authenticated;
grant update (proponer_automatico, autorespuesta_activa, autorespuesta_estrellas, autorespuesta_sin_texto, firma, indicaciones)
  on public.resenas_ajustes to authenticated;

create or replace function public.resenas_ajustes_fijar_autor()
returns trigger language plpgsql set search_path = public as $f$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end
$f$;

drop trigger if exists resenas_ajustes_autor on public.resenas_ajustes;
create trigger resenas_ajustes_autor before update on public.resenas_ajustes
  for each row execute function public.resenas_ajustes_fijar_autor();

-- ─── 3. Token OAuth de Google Business Profile (solo service role) ──────────

create table if not exists public.resenas_google_token (
  id boolean primary key default true check (id),
  refresh_token text not null,
  scope text,
  email text,
  creado_por uuid,
  created_at timestamptz not null default now()
);

alter table public.resenas_google_token enable row level security;
revoke all on public.resenas_google_token from anon, authenticated;
comment on table public.resenas_google_token is
  'Refresh token OAuth (business.manage) de la cuenta de Google del negocio. Sin políticas: solo la service role (resenas-contestador).';

-- ─── 4. Sesión de panel viva y auditoría (como el resto del panel) ──────────

do $$
begin
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    execute 'drop policy if exists "acceso_panel_no_bloqueado" on public.resenas_ajustes';
    execute 'create policy "acceso_panel_no_bloqueado" on public.resenas_ajustes as restrictive for all to authenticated using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()))';
  end if;
  if to_regprocedure('public.fn_registrar_auditoria()') is not null then
    execute 'drop trigger if exists trg_auditoria on public.resenas_ajustes';
    execute 'create trigger trg_auditoria after insert or update or delete on public.resenas_ajustes for each row execute function public.fn_registrar_auditoria()';
  end if;
end;
$$;

-- ─── 5. Gasto IA ────────────────────────────────────────────────────────────

do $$
begin
  if to_regclass('public.ia_funciones') is not null then
    insert into public.ia_funciones (funcion, descripcion, instrumentada, unidad, orden)
    values ('resenas-contestador', 'Reseñas Google · respuesta propuesta por la IA en el tono de Casa Tomás', true, 'respuesta', 70)
    on conflict (funcion) do nothing;
  end if;
  if to_regclass('public.ia_modelo_funcion') is not null and to_regclass('public.ia_funciones') is not null then
    insert into public.ia_modelo_funcion (funcion, modelo_codigo, centralizado)
    values ('resenas-contestador', 'gpt-4.1-mini, en código', true)
    on conflict (funcion) do nothing;
  end if;
end;
$$;

do $$ begin raise notice 'resenas_contestador: aplicada'; end $$;

commit;

-- VERIFICACIÓN (solo lectura):
--   select respuesta_estado, count(*) from public.resenas group by 1;
--   select * from public.resenas_ajustes;
--   select count(*) from public.resenas_google_token;  -- 0 hasta conectar la cuenta
