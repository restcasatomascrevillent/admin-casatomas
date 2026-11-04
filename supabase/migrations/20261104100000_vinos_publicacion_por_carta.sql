set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261104100000_vinos_publicacion_por_carta — Un interruptor por carta (04/11/2026)
-- ===========================================================================
-- Petición del dueño (Gestor Web › Carta › Vinos): «que el toggle de
-- restaurante o touza sea para si está activo en web o no, el otro toggle
-- quítalo para no duplicar». Y: «no puede haber en web publicada vinos sin
-- origen porque si no el mapa no los va a leer».
--
-- ANTES: cada vino tenía tres interruptores: «Restaurante» (columna
-- `restaurante`), «Touza» (`touza`) y «Activo (se publica en la web)»
-- (`activado`). La web de Casa Tomás enseña un vino si
-- `activado AND restaurante IS TRUE` (scripts/carta-ssg.mjs, tienda) y la carta
-- de Touza con `touza`. «Restaurante» encendido con «Activo» apagado no salía
-- en ninguna parte: dos controles para lo mismo.
--
-- AHORA el panel solo enseña «Restaurante» y «Touza», y `activado` se calcula:
--     activado = coalesce(restaurante, false) OR coalesce(touza, false)
-- Así todo lo que ya filtra por `activado` (web, tienda, bot, panel) sigue
-- cuadrando sin tocar la web:
--   · Restaurante encendido  → sale en la carta de la web de Casa Tomás.
--   · Touza encendido        → sale en la carta de Touza.
--   · Los dos apagados       → activado = false, no sale en ninguna.
--
-- ORIGEN: publicar un vino exige país y región (los lee el mapa de la web,
-- MapaMundoVinos) y una categoría con denominación, no «… — ORIGEN PENDIENTE»
-- (la web la enseña como «Consultar origen» y el mapa no la sitúa). Decisión
-- del dueño (04/11/2026, opción a): los vinos publicados con «ORIGEN
-- PENDIENTE» se ocultan hasta que tengan su denominación.
--
-- QUÉ HACE
--   1. Los vinos ocultos hoy (activado distinto de true) pasan a tener
--      `restaurante = false, touza = false`: siguen ocultos (en la demo, 37).
--   2. Los de categoría «… ORIGEN PENDIENTE» (sin distinguir mayúsculas; el
--      mismo patrón que la web y el panel: «pendiente» o «por confirmar»)
--      también: se ocultan en las dos cartas (en la demo, 18 publicados).
--   3. `activado` = restaurante OR touza en todas las filas (en la demo no
--      cambia ninguna más: no hay vinos activos con las dos cartas apagadas).
--   4. Trigger BEFORE INSERT OR UPDATE `trg_vinos_publicacion_por_carta`:
--      recalcula `activado` siempre (lo que se escriba a mano en `activado` se
--      ignora) y no deja PUBLICAR un vino sin país, sin región o con la
--      categoría «… ORIGEN PENDIENTE»: error 23514 con el mensaje en
--      castellano. Solo salta cuando el vino se publica (alta, o «Restaurante»
--      o «Touza» pasa a encendido) o cuando cambia su origen (país, región o
--      categoría) estando publicado; así un vino antiguo publicado sin país no
--      bloquea otros cambios (precio, traducciones, orden) ni que se apague.
--
-- ORDEN DE DESPLIEGUE: con esta migración el interruptor «Activo» de un panel
-- antiguo deja de tener efecto (el trigger recalcula `activado`). Aplicarla
-- junto con el panel que solo tiene «Restaurante» y «Touza».
--
-- APLICAR (una a una, nunca `db push`): demo primero (sfonaclosuafvlhutkon),
-- producción (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR y con el «sí» del
-- dueño. Idempotente. Tiene que terminar en
-- «vinos_publicacion_por_carta: aplicada».
-- Deshacer: supabase/rollbacks/20261104100000_vinos_publicacion_por_carta_ROLLBACK.sql
-- Pruebas: npm run test:vinos-publicacion:db (PGlite).
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- ─── 0. Comprobaciones previas (no cambian nada) ────────────────────────────
do $$
declare
  v_faltan text[] := '{}';
  v_col text;
begin
  if to_regclass('public."Vinos"') is null then
    v_faltan := v_faltan || 'public."Vinos"'::text;
  else
    foreach v_col in array array['id', 'nombre', 'categoria', 'activado', 'restaurante', 'touza', 'ubicacion_pais', 'ubicacion_region'] loop
      if not exists (select 1 from pg_attribute
                      where attrelid = 'public."Vinos"'::regclass and attname = v_col and attnum > 0 and not attisdropped) then
        v_faltan := v_faltan || format('public."Vinos".%s', v_col);
      end if;
    end loop;
  end if;
  if cardinality(v_faltan) > 0 then
    raise exception 'vinos_publicacion_por_carta: falta %. No se ha cambiado nada.', array_to_string(v_faltan, ', ');
  end if;
end;
$$;

-- ─── 1. ¿La categoría tiene el origen sin confirmar? ────────────────────────
-- El mismo patrón que la web (src/lib/tipos-vino.ts, «Consultar origen») y el
-- panel (esCategoriaOrigenPendiente).
create or replace function public.vino_categoria_origen_pendiente(p_categoria text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_categoria, '') ~* '(pendiente|por confirmar)'
$$;
comment on function public.vino_categoria_origen_pendiente(text) is
  'Vinos: la categoría tiene el origen sin confirmar («VINOS TINTOS — ORIGEN PENDIENTE»). Un vino así no se puede publicar.';
-- Sin revocar: la llama el trigger con el usuario que edita (el panel).

-- ─── 2. Fuera de las cartas: los ocultos y los de origen pendiente ──────────
-- Va antes del trigger. Al reaplicar no encuentra ninguno (con el trigger,
-- activado = false implica restaurante y touza apagados, y un vino de origen
-- pendiente no se puede encender).
update public."Vinos"
   set restaurante = false,
       touza = false
 where (activado is distinct from true or public.vino_categoria_origen_pendiente(categoria))
   and (restaurante is distinct from false or touza is distinct from false);

-- ─── 3. activado = restaurante OR touza en todas las filas ──────────────────
update public."Vinos"
   set activado = coalesce(restaurante, false) or coalesce(touza, false)
 where activado is distinct from (coalesce(restaurante, false) or coalesce(touza, false));

-- ─── 4. Trigger: activado calculado y sin publicar sin origen ───────────────
create or replace function public.vinos_publicacion_por_carta()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_comprobar boolean;
  v_nombre text;
begin
  new.activado := coalesce(new.restaurante, false) or coalesce(new.touza, false);

  if new.activado then
    -- Se publica (alta, o una carta pasa a encendida) o cambia el origen estando publicado.
    if tg_op = 'INSERT' then
      v_comprobar := true;
    else
      v_comprobar := (new.restaurante is true and old.restaurante is not true)
        or (new.touza is true and old.touza is not true)
        or new.ubicacion_pais is distinct from old.ubicacion_pais
        or new.ubicacion_region is distinct from old.ubicacion_region
        or new.categoria is distinct from old.categoria;
    end if;

    if v_comprobar then
      v_nombre := coalesce(nullif(btrim(new.nombre), ''), new.id::text);
      if coalesce(btrim(new.ubicacion_pais), '') = '' or coalesce(btrim(new.ubicacion_region), '') = '' then
        raise exception using
          errcode = '23514',
          message = format(
            'El vino «%s» no se puede publicar sin origen: indica el país y la región (los usa el mapa de la carta).',
            v_nombre),
          hint = 'Completa el país y la región, o apaga «Restaurante» y «Touza».';
      end if;
      if public.vino_categoria_origen_pendiente(new.categoria) then
        raise exception using
          errcode = '23514',
          message = format(
            'El vino «%s» no tiene la denominación de origen confirmada: cámbiale la categoría antes de publicarlo.',
            v_nombre),
          hint = 'Elige la categoría con su denominación (no «… — ORIGEN PENDIENTE»), o apaga «Restaurante» y «Touza».';
      end if;
    end if;
  end if;

  return new;
end;
$$;
comment on function public.vinos_publicacion_por_carta() is
  'Vinos: activado = restaurante OR touza (un interruptor por carta) y no se publica un vino sin país, sin región o con la categoría «… ORIGEN PENDIENTE» (el mapa de la web no lo sitúa).';
revoke all on function public.vinos_publicacion_por_carta() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.vinos_publicacion_por_carta() from anon, authenticated;
  end if;
end;
$$;

drop trigger if exists trg_vinos_publicacion_por_carta on public."Vinos";
create trigger trg_vinos_publicacion_por_carta
  before insert or update on public."Vinos"
  for each row execute function public.vinos_publicacion_por_carta();

comment on column public."Vinos".activado is
  'Calculado: restaurante OR touza (trigger trg_vinos_publicacion_por_carta). No se escribe a mano: el panel solo tiene «Restaurante» (carta de la web de Casa Tomás) y «Touza» (carta de Touza).';
comment on column public."Vinos".restaurante is
  'Sale en la carta de la web de Casa Tomás (y en su tienda). Para encenderlo hace falta país, región y una categoría con denominación.';
comment on column public."Vinos".touza is
  'Sale en la carta de Touza. Para encenderlo hace falta país, región y una categoría con denominación.';

-- ─── 5. Comprobación final ──────────────────────────────────────────────────
do $$
declare
  v_malos text[] := '{}';
  v_sin_origen int;
begin
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public."Vinos"'::regclass and tgname = 'trg_vinos_publicacion_por_carta' and not tgisinternal) then
    v_malos := v_malos || 'falta el trigger trg_vinos_publicacion_por_carta'::text;
  end if;
  if exists (select 1 from public."Vinos"
              where activado is distinct from (coalesce(restaurante, false) or coalesce(touza, false))) then
    v_malos := v_malos || 'hay vinos con activado distinto de restaurante OR touza'::text;
  end if;
  if exists (select 1 from public."Vinos"
              where (restaurante is true or touza is true) and public.vino_categoria_origen_pendiente(categoria)) then
    v_malos := v_malos || 'quedan vinos publicados con la categoría «… ORIGEN PENDIENTE»'::text;
  end if;
  if cardinality(v_malos) > 0 then
    raise exception 'vinos_publicacion_por_carta: comprobación final fallida (%). No se ha aplicado nada.', array_to_string(v_malos, '; ');
  end if;

  -- Aviso (no para la migración): publicados sin país o región. En la demo no
  -- hay ninguno; si los hubiera, siguen publicados y el panel los marca.
  select count(*) into v_sin_origen from public."Vinos"
   where activado and (coalesce(btrim(ubicacion_pais), '') = '' or coalesce(btrim(ubicacion_region), '') = '');
  if v_sin_origen > 0 then
    raise notice 'vinos_publicacion_por_carta: AVISO, % vinos publicados sin país o región (siguen publicados; el mapa no los sitúa).', v_sin_origen;
  end if;

  raise notice 'vinos_publicacion_por_carta: aplicada';
end;
$$;

commit;
