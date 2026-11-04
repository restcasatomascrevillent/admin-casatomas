set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261104140000_vinos_copeo_y_parker — Vino por copas y puntuación Parker (04/11/2026)
-- ===========================================================================
-- Peticiones del dueño (04/11/2026):
--   · «Añade en gestor web en vinos, opción de poner un vino apto para copeo, y
--     que se traduzca en carta de vinos de la web que salga otro botón con icono
--     de copa que cuando se ponga salga el precio de la copa (el precio se pondrá
--     en el gestor web)».
--   · «Busca la puntuación Parker de todos los vinos de la carta y añádesela como
--     un iconito en cada tarjeta de cada vino».
--
-- QUÉ AÑADE A "Vinos"
--   copeo                    boolean NOT NULL DEFAULT false — se sirve por copas.
--   precio_copa_eur          double precision NULL — precio de la copa. Mismo
--                            tipo que precio_eur (la web y el panel ya lo tratan
--                            como número).
--   puntuacion_parker        smallint NULL — puntos de Robert Parker / The Wine
--                            Advocate (50–100). NULL = sin puntuación: la web no
--                            pinta el icono.
--   puntuacion_parker_anada  smallint NULL — añada a la que corresponde esa
--                            puntuación (la carta no siempre dice la añada).
--
-- CHECK (mismo patrón que 20261101220000: NOT VALID y luego VALIDATE):
--   vinos_precio_copa_valido   NULL o entre 0,01 y 999,99.
--   vinos_copeo_con_precio     un vino por copas tiene que tener precio de copa
--                              (si no, la web no tendría qué enseñar).
--   vinos_parker_valido        NULL o entre 50 y 100 (la escala de Parker).
--   vinos_parker_anada_valida  NULL o entre 1900 y 2100.
--
-- Permisos: no cambian. Las columnas nuevas quedan cubiertas por las políticas
-- de la tabla (leer: público si activado; escribir: «Gestor carta»).
--
-- APLICAR (una a una, nunca `db push`): demo primero (sfonaclosuafvlhutkon),
-- producción (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR y con el «sí» del
-- dueño. Idempotente. Tiene que terminar en «vinos_copeo_y_parker: aplicada».
-- Deshacer: supabase/rollbacks/20261104140000_vinos_copeo_y_parker_ROLLBACK.sql
-- Pruebas: npm run test:vinos-copeo-encuesta:db (PGlite).
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regclass('public."Vinos"') is null then
    raise exception 'vinos_copeo_y_parker: falta public."Vinos". No se ha cambiado nada.';
  end if;
end
$$;

alter table public."Vinos"
  add column if not exists copeo boolean not null default false,
  add column if not exists precio_copa_eur double precision,
  add column if not exists puntuacion_parker smallint,
  add column if not exists puntuacion_parker_anada smallint;

comment on column public."Vinos".copeo is
  'Se sirve por copas. La web enseña un botón con una copa que muestra precio_copa_eur (04/11/2026).';
comment on column public."Vinos".precio_copa_eur is
  'Precio de una copa, en euros. Obligatorio si copeo = true.';
comment on column public."Vinos".puntuacion_parker is
  'Puntos de Robert Parker / The Wine Advocate (50–100). NULL = sin puntuación conocida.';
comment on column public."Vinos".puntuacion_parker_anada is
  'Añada a la que corresponde puntuacion_parker (opcional).';

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public."Vinos"'::regclass and conname = 'vinos_precio_copa_valido') then
    alter table public."Vinos" add constraint vinos_precio_copa_valido
      check (precio_copa_eur is null or precio_copa_eur between 0.01 and 999.99) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public."Vinos"'::regclass and conname = 'vinos_copeo_con_precio') then
    alter table public."Vinos" add constraint vinos_copeo_con_precio
      check (copeo is not true or precio_copa_eur is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public."Vinos"'::regclass and conname = 'vinos_parker_valido') then
    alter table public."Vinos" add constraint vinos_parker_valido
      check (puntuacion_parker is null or puntuacion_parker between 50 and 100) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public."Vinos"'::regclass and conname = 'vinos_parker_anada_valida') then
    alter table public."Vinos" add constraint vinos_parker_anada_valida
      check (puntuacion_parker_anada is null or puntuacion_parker_anada between 1900 and 2100) not valid;
  end if;
end
$$;

-- Columnas nuevas: ninguna fila puede incumplir, VALIDATE no tiene nada que corregir.
alter table public."Vinos" validate constraint vinos_precio_copa_valido;
alter table public."Vinos" validate constraint vinos_copeo_con_precio;
alter table public."Vinos" validate constraint vinos_parker_valido;
alter table public."Vinos" validate constraint vinos_parker_anada_valida;

notify pgrst, 'reload schema';

do $$ begin raise notice 'vinos_copeo_y_parker: aplicada'; end $$;
commit;
