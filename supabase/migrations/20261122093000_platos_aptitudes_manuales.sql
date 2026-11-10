set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261122093000_platos_aptitudes_manuales — «Apto para celíacos» y «Apto sin
-- lactosa» decididos a mano en el panel (10/11/2026)
-- ===========================================================================
-- Dueño (10/11/2026): «que en editar cada plato sea modificable el toggle de
-- se puede hacer para celíaco y apto para celíaco, apto para vegetarianos,
-- apto para sin lactosa».
--
-- Hasta ahora «Celíacos» y «Sin lactosa» salían SOLO de los alérgenos (y de la
-- nota de alérgenos); no había forma de decidirlo a mano. «Se puede hacer sin
-- gluten» ya tenía columna (sin_gluten_disponible, 20261007060000) y
-- «Vegetariano», etiquetas_dieteticas (20261104151000).
--
-- QUÉ HACE
--   Platos.apto_celiacos    boolean NULL
--   Platos.apto_sin_lactosa boolean NULL
--     NULL  = automático: lo deciden los alérgenos, como hasta ahora (todos los
--             platos quedan así: no cambia nada de lo que ve la web).
--     true  = el restaurante confirma que es apto.
--     false = el restaurante dice que no lo es, aunque los alérgenos lo permitan.
--   Sin datos ni defaults: no toca ninguna fila.
--
-- LA WEB (web-casatomas) tiene que leer estas dos columnas para que los
-- filtros «Sin gluten»/«Sin lactosa» respeten lo marcado a mano; hasta
-- entonces las ignora (y sigue funcionando igual).
--
-- APLICAR (una a una, nunca `db push`): demo primero (sfonaclosuafvlhutkon),
-- producción (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR de la release y con
-- el «sí» del dueño. Idempotente. Termina en
-- «platos_aptitudes_manuales: columnas listas».
-- Deshacer: supabase/rollbacks/20261122093000_platos_aptitudes_manuales_ROLLBACK.sql
-- Pruebas: npm run test:platos-aptitudes:db (PGlite).
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regclass('public."Platos"') is null then
    raise exception 'platos_aptitudes_manuales: falta public."Platos". No se ha cambiado nada.';
  end if;
end
$$;

alter table public."Platos" add column if not exists apto_celiacos boolean;
alter table public."Platos" add column if not exists apto_sin_lactosa boolean;

comment on column public."Platos".apto_celiacos is
  'Apto para celíacos decidido a mano en el panel. NULL = automático (según alérgenos y sin_gluten_disponible); true = sí; false = no. 20261122093000.';
comment on column public."Platos".apto_sin_lactosa is
  'Apto sin lactosa decidido a mano en el panel. NULL = automático (según alérgenos); true = sí; false = no. 20261122093000.';

notify pgrst, 'reload schema';

do $$
begin
  raise notice 'platos_aptitudes_manuales: columnas listas';
end
$$;

commit;
