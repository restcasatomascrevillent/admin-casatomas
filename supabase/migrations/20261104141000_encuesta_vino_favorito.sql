set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261104141000_encuesta_vino_favorito — «Vota tu vino favorito» (04/11/2026)
-- ===========================================================================
-- Petición del dueño (04/11/2026): «instala una estructura de encuestar en la
-- carta de vinos: cuando entres en la web a la carta de vinos que te salga una
-- notificación de 3 segundos de "vota por tu vino favorito y gana un sorteo"
-- (que esto se pueda activar o desactivar desde el gestor web)».
--
-- QUÉ CREA
--   1. configuracion_web.encuesta_vinos_activa (boolean, false): el interruptor
--      del Gestor Web › Carta › Vinos. La web lo lee con la clave pública (la
--      fila ya es de lectura pública) y solo enseña el aviso y el botón de votar
--      si está encendido. Lo cambia quien puede escribir en «Gestor carta», con
--      la política de UPDATE que ya tiene la tabla.
--   2. public.votos_vino_favorito: una fila por participante. Guarda el vino
--      (id y nombre en ese momento, por si luego se borra), nombre y contacto
--      (email o teléfono) para avisar a quien gane, y la aceptación de las bases.
--      Un contacto = una participación (índice único sobre el contacto
--      normalizado). Solo la leen y la vacían los usuarios del panel con
--      «Gestor carta»; la web no puede leerla (datos personales).
--   3. public.votar_vino_favorito(...): la ÚNICA vía para votar desde la web
--      (anon). SECURITY DEFINER, search_path vacío. Comprueba que la votación
--      está abierta, que el vino está publicado en la carta de Casa Tomás, el
--      formato de nombre y contacto, la aceptación de las bases y un tope global
--      de 300 votos por hora (un advisory lock serializa conteo + inserción, así
--      una ráfaga no lo supera). Los mensajes de error van en castellano: la web
--      los traduce por código (ver ERRCODE abajo).
--
-- CÓDIGOS DE ERROR de votar_vino_favorito (la web los usa para su mensaje):
--   P0001 'encuesta_cerrada'   — la votación no está abierta.
--   P0002 'vino_no_disponible' — el vino no existe o no está en la carta.
--   22023 'datos_no_validos'   — nombre, contacto o bases.
--   23505 'ya_participado'     — ese contacto ya votó.
--   54000 'demasiados_votos'   — tope por hora superado.
--
-- APLICAR (una a una, nunca `db push`): demo primero (sfonaclosuafvlhutkon),
-- producción (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR y con el «sí» del
-- dueño. Idempotente. Tiene que terminar en «encuesta_vino_favorito: aplicada».
-- Deshacer: supabase/rollbacks/20261104141000_encuesta_vino_favorito_ROLLBACK.sql
-- Pruebas: npm run test:vinos-copeo-encuesta:db (PGlite).
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regclass('public.configuracion_web') is null or to_regclass('public."Vinos"') is null then
    raise exception 'encuesta_vino_favorito: falta public.configuracion_web o public."Vinos". No se ha cambiado nada.';
  end if;
end
$$;

-- 1. Interruptor ----------------------------------------------------------------
alter table public.configuracion_web
  add column if not exists encuesta_vinos_activa boolean not null default false;

comment on column public.configuracion_web.encuesta_vinos_activa is
  'Votación «Vota tu vino favorito y entra en el sorteo» en /carta/vinos de Casa Tomás (04/11/2026).';

-- 2. Votos -------------------------------------------------------------------------
create table if not exists public.votos_vino_favorito (
  id                   uuid primary key default gen_random_uuid(),
  vino_id              text references public."Vinos"(id) on delete set null,
  vino_nombre          text not null,
  nombre               text not null,
  contacto             text not null,
  contacto_normalizado text not null,
  acepta_bases         boolean not null,
  idioma               text not null default 'es',
  created_at           timestamptz not null default now(),
  constraint votos_vino_favorito_nombre_valido check (char_length(btrim(nombre)) between 2 and 80),
  constraint votos_vino_favorito_contacto_valido check (char_length(btrim(contacto)) between 5 and 120),
  constraint votos_vino_favorito_acepta_bases check (acepta_bases is true),
  constraint votos_vino_favorito_idioma_valido check (idioma in ('es', 'en', 'fr'))
);

create unique index if not exists votos_vino_favorito_contacto_unico
  on public.votos_vino_favorito (contacto_normalizado);
create index if not exists votos_vino_favorito_created_at
  on public.votos_vino_favorito (created_at);

comment on table public.votos_vino_favorito is
  'Participaciones de «Vota tu vino favorito». Datos personales: solo panel con «Gestor carta». Se vacía desde el Gestor Web al cerrar cada sorteo.';

alter table public.votos_vino_favorito enable row level security;

revoke all on public.votos_vino_favorito from anon, authenticated;
grant select, delete on public.votos_vino_favorito to authenticated;

drop policy if exists votos_vino_favorito_select_panel on public.votos_vino_favorito;
create policy votos_vino_favorito_select_panel on public.votos_vino_favorito
  for select to authenticated
  using ((select public.can_write_section('gestor_carta')));

drop policy if exists votos_vino_favorito_delete_panel on public.votos_vino_favorito;
create policy votos_vino_favorito_delete_panel on public.votos_vino_favorito
  for delete to authenticated
  using ((select public.can_write_section('gestor_carta')));

-- Si el proyecto tiene el bloqueo de sesiones del panel (acceso_panel_no_bloqueado
-- en el resto de tablas), también aquí.
do $$
begin
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    execute 'drop policy if exists acceso_panel_no_bloqueado on public.votos_vino_favorito';
    execute 'create policy acceso_panel_no_bloqueado on public.votos_vino_favorito as restrictive for all to authenticated
               using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()))';
  end if;
end
$$;

-- 3. Votar (web, anon) ---------------------------------------------------------------
create or replace function public.votar_vino_favorito(
  p_vino_id text,
  p_nombre text,
  p_contacto text,
  p_acepta_bases boolean,
  p_idioma text default 'es'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_contacto text := btrim(coalesce(p_contacto, ''));
  v_normalizado text;
  v_vino_nombre text;
  v_id uuid;
begin
  if coalesce((select c.encuesta_vinos_activa from public.configuracion_web c where c.id = true), false) is not true then
    raise exception 'encuesta_cerrada' using errcode = 'P0001', detail = 'La votación no está abierta ahora mismo.';
  end if;

  select v.nombre into v_vino_nombre
    from public."Vinos" v
   where v.id = p_vino_id and v.activado is true and v.restaurante is true;
  if v_vino_nombre is null then
    raise exception 'vino_no_disponible' using errcode = 'P0002', detail = 'Ese vino no está en la carta.';
  end if;

  if char_length(v_nombre) not between 2 and 80 then
    raise exception 'datos_no_validos' using errcode = '22023', detail = 'El nombre debe tener entre 2 y 80 caracteres.';
  end if;
  if p_acepta_bases is not true then
    raise exception 'datos_no_validos' using errcode = '22023', detail = 'Hay que aceptar las bases del sorteo.';
  end if;

  -- Email (algo@algo.algo) o teléfono (9 a 15 cifras, con +, espacios o guiones).
  if v_contacto ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(v_contacto) <= 120 then
    v_normalizado := 'email:' || lower(v_contacto);
  elsif v_contacto ~ '^\+?[0-9][0-9 .()-]{7,20}$' and char_length(regexp_replace(v_contacto, '[^0-9]', '', 'g')) between 9 and 15 then
    -- Mismo número con o sin prefijo de España: se guarda sin el 34 inicial.
    v_normalizado := 'tel:' || regexp_replace(regexp_replace(v_contacto, '[^0-9]', '', 'g'), '^(0034|34)(?=[0-9]{9}$)', '');
  else
    raise exception 'datos_no_validos' using errcode = '22023', detail = 'Escribe un email o un teléfono válido.';
  end if;

  -- Tope global: conteo + inserción serializados.
  perform pg_advisory_xact_lock(hashtext('votar_vino_favorito'));
  if (select count(*) from public.votos_vino_favorito vf where vf.created_at > now() - interval '1 hour') >= 300 then
    raise exception 'demasiados_votos' using errcode = '54000', detail = 'Demasiados votos en poco tiempo. Inténtalo más tarde.';
  end if;

  insert into public.votos_vino_favorito (vino_id, vino_nombre, nombre, contacto, contacto_normalizado, acepta_bases, idioma)
  values (p_vino_id, v_vino_nombre, v_nombre, v_contacto, v_normalizado, true,
          case when p_idioma in ('es', 'en', 'fr') then p_idioma else 'es' end)
  on conflict (contacto_normalizado) do nothing
  returning id into v_id;

  if v_id is null then
    raise exception 'ya_participado' using errcode = '23505', detail = 'Ya has participado con este contacto.';
  end if;

  return jsonb_build_object('ok', true, 'vino', v_vino_nombre);
end;
$$;

revoke all on function public.votar_vino_favorito(text, text, text, boolean, text) from public;
grant execute on function public.votar_vino_favorito(text, text, text, boolean, text) to anon, authenticated;

comment on function public.votar_vino_favorito(text, text, text, boolean, text) is
  'Voto de «Vota tu vino favorito» desde la web (anon). Ver 20261104141000_encuesta_vino_favorito.sql.';

notify pgrst, 'reload schema';

do $$ begin raise notice 'encuesta_vino_favorito: aplicada'; end $$;
commit;
