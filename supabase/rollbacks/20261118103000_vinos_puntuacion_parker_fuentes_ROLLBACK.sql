set client_encoding = 'UTF8';
-- ROLLBACK de 20261118103000_vinos_puntuacion_parker_fuentes.sql. Aplicar a
-- mano SOLO si hay que deshacerlo (y antes, si se aplicó, el rollback de
-- 20261118110000_vinos_puntuacion_parker_revision_datos).
--
-- BORRA DATOS: se pierden las puntuaciones con fuente (tabla
-- vinos_puntuacion_parker), la añada que se sirve ("Vinos".anada/sin_anada) y
-- el texto público. "Vinos".puntuacion_parker y puntuacion_parker_anada se
-- quedan con lo último que publicó el trigger y vuelven a ser editables a mano.
-- Antes, desplegar un panel que no use la tabla ni las columnas nuevas (la web
-- ignora puntuacion_parker_texto si no viene). Se puede aplicar dos veces.
begin;
set local lock_timeout = '5s';

drop trigger if exists trg_vinos_parker_publicado on public."Vinos";
drop table if exists public.vinos_puntuacion_parker;
drop function if exists public.vinos_parker_publicado();
drop function if exists public.vinos_puntuacion_parker_refrescar_vino();
drop function if exists public.vinos_puntuacion_parker_al_editar();
drop function if exists public.vinos_parker_calculado(text, smallint, boolean);

alter table public."Vinos"
  drop constraint if exists vinos_anada_valida,
  drop constraint if exists vinos_sin_anada_sin_ano,
  drop constraint if exists vinos_parker_texto_valido;
alter table public."Vinos"
  drop column if exists anada,
  drop column if exists sin_anada,
  drop column if exists puntuacion_parker_texto;

notify pgrst, 'reload schema';
do $$ begin raise notice 'vinos_puntuacion_parker_fuentes: rollback aplicado'; end $$;
commit;
