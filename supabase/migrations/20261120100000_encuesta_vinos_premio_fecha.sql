set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261120100000_encuesta_vinos_premio_fecha — premio y cierre del sorteo (20/11/2026)
-- ===========================================================================
-- La web va a publicar las bases legales del sorteo «Vota tu vino favorito» y a
-- enseñar el premio y la fecha de cierre de cada edición. El dueño los pone
-- desde el panel (Gestor Web › Carta › Vinos), junto al interruptor de la
-- votación (20261104141000).
--
-- QUÉ CAMBIA (configuracion_web, fila única de lectura pública)
--   1. encuesta_vinos_premio text null: el premio, texto libre. CHECK: NULL o
--      entre 3 y 200 caracteres sin contar los espacios de los extremos.
--   2. encuesta_vinos_fin date null: último día para votar, INCLUIDO, en hora
--      de España (Europe/Madrid).
--   3. CHECK configuracion_web_encuesta_vinos_completa: no se puede tener
--      encuesta_vinos_activa = true sin premio y sin fecha de cierre. Si al
--      aplicarla la votación está abierta sin premio ni fecha (la demo lo estaba
--      el 09/11/2026; producción, cerrada), se CIERRA antes de añadir la regla:
--      un sorteo sin bases completas no debe seguir abierto. Se vuelve a abrir
--      desde el panel tras poner el premio y el último día. El rollback no la
--      reabre.
--   4. public.votar_vino_favorito (misma firma, SECURITY DEFINER, search_path
--      vacío, mismos códigos de error): además rechaza con 'encuesta_cerrada'
--      (P0001) si no hay premio o si hoy (Europe/Madrid) es posterior a
--      encuesta_vinos_fin. El resto del cuerpo es el de 20261104141000.
--
-- PERMISOS: no hay permisos por columna en configuracion_web: la web (anon)
-- lee las columnas nuevas con el SELECT que ya tiene la tabla y las actualiza
-- quien ya actualiza encuesta_vinos_activa («Gestor carta» con editar, por la
-- política de UPDATE de la tabla). No se toca ningún permiso.
--
-- APLICAR (una a una, nunca `db push`): demo primero (sfonaclosuafvlhutkon),
-- producción (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR y con el «sí» del
-- dueño. Idempotente. Tiene que terminar en «encuesta_vinos_premio_fecha: aplicada».
-- Requiere 20261104141000. Compatible con el panel y la web de PROD (no usan
-- las columnas nuevas; mientras la votación esté cerrada nada cambia).
-- Deshacer: supabase/rollbacks/20261120100000_encuesta_vinos_premio_fecha_ROLLBACK.sql
-- Pruebas: npm run test:vinos-copeo-encuesta:db (PGlite).
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regclass('public.configuracion_web') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'configuracion_web' and column_name = 'encuesta_vinos_activa')
     or to_regprocedure('public.votar_vino_favorito(text,text,text,boolean,text)') is null then
    raise exception 'encuesta_vinos_premio_fecha: falta la votación (20261104141000). No se ha cambiado nada.';
  end if;
end
$$;

-- 1. Columnas ------------------------------------------------------------------
alter table public.configuracion_web
  add column if not exists encuesta_vinos_premio text,
  add column if not exists encuesta_vinos_fin date;

comment on column public.configuracion_web.encuesta_vinos_premio is
  'Premio del sorteo «Vota tu vino favorito», texto libre (3 a 200 caracteres). Lo enseñan la web y sus bases legales. Obligatorio para abrir la votación.';
comment on column public.configuracion_web.encuesta_vinos_fin is
  'Último día para votar, incluido, en hora de España (Europe/Madrid). Pasado ese día la votación se rechaza aunque siga abierta. Obligatorio para abrir la votación.';

-- 2. Reglas ---------------------------------------------------------------------
-- Votación abierta sin premio o sin fecha: se cierra (ver cabecera, punto 3).
update public.configuracion_web
   set encuesta_vinos_activa = false
 where encuesta_vinos_activa is true
   and (btrim(coalesce(encuesta_vinos_premio, '')) = '' or encuesta_vinos_fin is null);

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.configuracion_web'::regclass and conname = 'configuracion_web_encuesta_vinos_premio_valido') then
    alter table public.configuracion_web add constraint configuracion_web_encuesta_vinos_premio_valido
      check (encuesta_vinos_premio is null or char_length(btrim(encuesta_vinos_premio)) between 3 and 200);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.configuracion_web'::regclass and conname = 'configuracion_web_encuesta_vinos_completa') then
    alter table public.configuracion_web add constraint configuracion_web_encuesta_vinos_completa
      check (
        encuesta_vinos_activa is not true
        or (encuesta_vinos_premio is not null and btrim(encuesta_vinos_premio) <> '' and encuesta_vinos_fin is not null)
      );
  end if;
end
$$;

-- 3. Votar (web, anon): cuerpo de 20261104141000 + comprobación de premio y fecha --
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
  v_activa boolean;
  v_premio text;
  v_fin date;
begin
  select c.encuesta_vinos_activa, c.encuesta_vinos_premio, c.encuesta_vinos_fin
    into v_activa, v_premio, v_fin
    from public.configuracion_web c
   where c.id = true;
  if coalesce(v_activa, false) is not true then
    raise exception 'encuesta_cerrada' using errcode = 'P0001', detail = 'La votación no está abierta ahora mismo.';
  end if;
  -- Sin premio, sin fecha o pasado el último día (hora de España): cerrada.
  if btrim(coalesce(v_premio, '')) = '' or v_fin is null or (now() at time zone 'Europe/Madrid')::date > v_fin then
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
  'Voto de «Vota tu vino favorito» desde la web (anon). Rechaza sin premio o pasado el último día (Madrid). Ver 20261104141000 y 20261120100000.';

notify pgrst, 'reload schema';

do $$ begin raise notice 'encuesta_vinos_premio_fecha: aplicada'; end $$;
commit;
