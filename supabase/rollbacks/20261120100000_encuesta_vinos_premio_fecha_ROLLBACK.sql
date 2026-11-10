set client_encoding = 'UTF8';
-- ROLLBACK de 20261120100000_encuesta_vinos_premio_fecha.sql (premio y último
-- día de «Vota tu vino favorito»). Aplicar a mano SOLO si hay que deshacerlo.
--
-- Se pierden el premio y la fecha de cierre guardados (la votación sigue como
-- esté, abierta o cerrada) y vuelve la función de voto de 20261104141000, que
-- ya no mira premio ni fecha. Si la votación está abierta, ciérrala antes.
begin;
set local lock_timeout = '5s';

alter table public.configuracion_web drop constraint if exists configuracion_web_encuesta_vinos_completa;
alter table public.configuracion_web drop constraint if exists configuracion_web_encuesta_vinos_premio_valido;
alter table public.configuracion_web
  drop column if exists encuesta_vinos_premio,
  drop column if exists encuesta_vinos_fin;

-- Función de 20261104141000_encuesta_vino_favorito.sql.
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

  if v_contacto ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(v_contacto) <= 120 then
    v_normalizado := 'email:' || lower(v_contacto);
  elsif v_contacto ~ '^\+?[0-9][0-9 .()-]{7,20}$' and char_length(regexp_replace(v_contacto, '[^0-9]', '', 'g')) between 9 and 15 then
    v_normalizado := 'tel:' || regexp_replace(regexp_replace(v_contacto, '[^0-9]', '', 'g'), '^(0034|34)(?=[0-9]{9}$)', '');
  else
    raise exception 'datos_no_validos' using errcode = '22023', detail = 'Escribe un email o un teléfono válido.';
  end if;

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
commit;
