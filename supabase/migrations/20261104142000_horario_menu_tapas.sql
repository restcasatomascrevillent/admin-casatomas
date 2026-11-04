set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261104142000_horario_menu_tapas — Días y horas de «Menú del día» y «Tapas» (04/11/2026)
-- ===========================================================================
-- Petición del dueño (04/11/2026): «que los botones de menú del día y tapas, tal
-- y como se pueden activar y desactivar desde el gestor web, que se puedan
-- configurar los días que aparecen esos botones y a qué hora aparecen y
-- desaparecen».
--
-- ANTES: la web los enseñaba con días fijos en el código (menú de martes a
-- jueves, tapas los jueves, todo el día) y el panel solo los encendía o apagaba
-- (20261008063000_visibilidad_menu_tapas_casa_tomas.sql).
--
-- AHORA, en configuracion_web (fila única, lectura pública):
--   horario_menu_dia_casa_tomas  jsonb NULL
--   horario_tapas_casa_tomas     jsonb NULL
-- con la forma {"dias": [1..7], "desde": "HH:MM" | null, "hasta": "HH:MM" | null}
--   · dias: días de la semana ISO (1 = lunes … 7 = domingo), sin repetir, al menos uno.
--   · desde/hasta: hora de Madrid a la que aparece y desaparece el botón. Los dos
--     o ninguno (ninguno = todo el día). Si «hasta» es menor que «desde», el
--     horario cruza la medianoche (20:00–01:00 sigue visible hasta la 01:00 del
--     día siguiente).
--   · NULL = lo de siempre (menú martes–jueves, tapas jueves, todo el día): la
--     web aplica ese valor por defecto, así nada cambia hasta que se guarde un
--     horario.
-- Un CHECK con public.horario_web_valido(jsonb) impide guardar otra forma.
--
-- El interruptor de encender/apagar sigue mandando: apagado no se ve nunca;
-- encendido se ve solo dentro de su horario.
--
-- public.configuracion_web_horario_menu_tapas(p_seccion, p_horario): cambia el
-- horario con el permiso de «Gestión web», como la RPC del interruptor (no
-- amplía el acceso a los ajustes de la pestaña Carta).
--
-- APLICAR (una a una, nunca `db push`): demo primero (sfonaclosuafvlhutkon),
-- producción (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR y con el «sí» del
-- dueño. Idempotente. Tiene que terminar en «horario_menu_tapas: aplicada».
-- Deshacer: supabase/rollbacks/20261104142000_horario_menu_tapas_ROLLBACK.sql
-- Pruebas: npm run test:vinos-copeo-encuesta:db (PGlite).
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regclass('public.configuracion_web') is null then
    raise exception 'horario_menu_tapas: falta public.configuracion_web. No se ha cambiado nada.';
  end if;
end
$$;

-- Forma válida de un horario. IMMUTABLE para poder usarla en un CHECK. Va con
-- CASE y no con AND porque Postgres no garantiza el orden de un AND, y
-- jsonb_object_keys/jsonb_array_elements fallan (en vez de dar false) si el
-- valor no es un objeto o un array.
create or replace function public.horario_web_valido(valor jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog
as $fn$
  select case
    when valor is null then true
    when jsonb_typeof(valor) <> 'object' then false
    when jsonb_typeof(valor -> 'dias') is distinct from 'array' then false
    when exists (select 1 from jsonb_object_keys(valor) k where k not in ('dias', 'desde', 'hasta')) then false
    when jsonb_array_length(valor -> 'dias') not between 1 and 7 then false
    when exists (
      select 1 from jsonb_array_elements(valor -> 'dias') d(dia)
       where jsonb_typeof(d.dia) <> 'number' or (d.dia #>> '{}') !~ '^[1-7]$'
    ) then false
    when (select count(distinct d.dia) from jsonb_array_elements(valor -> 'dias') d(dia)) <> jsonb_array_length(valor -> 'dias') then false
    when coalesce(jsonb_typeof(valor -> 'desde'), 'null') = 'null' and coalesce(jsonb_typeof(valor -> 'hasta'), 'null') = 'null' then true
    when jsonb_typeof(valor -> 'desde') is distinct from 'string' or jsonb_typeof(valor -> 'hasta') is distinct from 'string' then false
    else (valor ->> 'desde') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     and (valor ->> 'hasta') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     and (valor ->> 'desde') <> (valor ->> 'hasta')
  end
$fn$;

comment on function public.horario_web_valido(jsonb) is
  'CHECK de configuracion_web: NULL o {"dias":[1..7], "desde":"HH:MM"|null, "hasta":"HH:MM"|null} (20261104142000).';

alter table public.configuracion_web
  add column if not exists horario_menu_dia_casa_tomas jsonb,
  add column if not exists horario_tapas_casa_tomas jsonb;

comment on column public.configuracion_web.horario_menu_dia_casa_tomas is
  'Días (ISO 1–7) y horas de Madrid en que la web enseña «Menú del día». NULL = martes a jueves, todo el día.';
comment on column public.configuracion_web.horario_tapas_casa_tomas is
  'Días (ISO 1–7) y horas de Madrid en que la web enseña «Tapas». NULL = jueves, todo el día.';

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.configuracion_web'::regclass and conname = 'configuracion_web_horarios_validos') then
    alter table public.configuracion_web add constraint configuracion_web_horarios_validos
      check (public.horario_web_valido(horario_menu_dia_casa_tomas) and public.horario_web_valido(horario_tapas_casa_tomas));
  end if;
end
$$;

create or replace function public.configuracion_web_horario_menu_tapas(p_seccion text, p_horario jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.can_write_section('gestion_web') is not true then
    raise exception 'No tienes permiso para gestionar el menú y las tapas de la web.' using errcode = '42501';
  end if;
  if not public.horario_web_valido(p_horario) then
    raise exception 'El horario no es válido: elige al menos un día y, si pones horas, las dos y distintas.' using errcode = '22023';
  end if;
  if p_seccion = 'menu' then
    update public.configuracion_web set horario_menu_dia_casa_tomas = p_horario where id = true;
  elsif p_seccion = 'tapas' then
    update public.configuracion_web set horario_tapas_casa_tomas = p_horario where id = true;
  else
    raise exception 'Sección no válida.' using errcode = '22023';
  end if;
  if not found then
    raise exception 'No existe la configuración de la web.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.configuracion_web_horario_menu_tapas(text, jsonb) from public, anon;
grant execute on function public.configuracion_web_horario_menu_tapas(text, jsonb) to authenticated;

notify pgrst, 'reload schema';

do $$ begin raise notice 'horario_menu_tapas: aplicada'; end $$;
commit;
