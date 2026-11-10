set client_encoding = 'UTF8';
-- Deshace 20261122171500_reservas_sentar_fuera.sql. BORRA dónde se sentó fuera
-- a cada reserva (Touza, Terraza Touza…). Antes, a las que estén fuera ahora se
-- les devuelve su sala de antes (siguen «Llegó», sin mesa), para que no queden
-- sin sala. Publicar antes un panel que no pida las columnas `fuera_*` (el de
-- ahora aguanta sin ellas: relee Hoy sin esas columnas).
begin;

drop trigger if exists trg_reservas_sentada_fuera on public.reservas;
drop function if exists public.fn_reservas_sentada_fuera();

do $$
begin
  if exists (select 1 from pg_attribute where attrelid = 'public.reservas'::regclass and attname = 'fuera_lugar' and not attisdropped) then
    execute 'update public.reservas set espacio_id = fuera_espacio_previo_id
              where fuera_lugar is not null and espacio_id is null and fuera_espacio_previo_id is not null';
  end if;
end;
$$;

alter table public.reservas drop constraint if exists reservas_fuera_solo_llegada;
alter table public.reservas drop constraint if exists reservas_fuera_mesa_largo;
alter table public.reservas drop constraint if exists reservas_fuera_lugar_largo;
alter table public.reservas drop constraint if exists reservas_fuera_espacio_previo_fkey;
alter table public.reservas
  drop column if exists fuera_at,
  drop column if exists fuera_espacio_previo_id,
  drop column if exists fuera_mesa,
  drop column if exists fuera_lugar;

notify pgrst, 'reload schema';

commit;
