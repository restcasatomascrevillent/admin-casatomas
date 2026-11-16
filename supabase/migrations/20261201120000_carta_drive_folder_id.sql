set client_encoding = 'UTF8';
-- ===========================================================================
-- NO APLICADA: la aplica el dueño a mano (primero en la demo).
--
-- "Platos"."drive_folder_id" y "Vinos"."drive_folder_id" — id de la carpeta de
-- cada plato o vino en Google Drive (marketing/Platos/<NN Categoría>/<plato>/
-- y marketing/Vinos/<Tipo>/<vino>/). Mudanza del Drive del 15/11/2026, ver
-- casatomas-recursos/drive/PLAN-MUDANZA.md (secciones 2 y 5).
--
-- Quién la escribe: la Edge Function instagram-drive, con el JWT de quien
-- sube un original (política de UPDATE de la carta: gestor_carta «Editar»), y
-- el script scripts/carta/vincular-carpetas-drive.mjs. El panel la lee para el
-- enlace «Abrir en Drive». Sin permisos nuevos: las columnas heredan los de la
-- tabla (anon solo lee; escribe quien edita la carta; TRUNCATE ya revocado).
--
-- Ojo: "Platos" y "Vinos" se leen como `anon` desde las webs, así que un id de
-- carpeta de Drive es visible en la API pública. No da acceso a nada (Drive
-- pide permiso de la cuenta), pero se sabe.
--
-- updated_at: guardar el id de la carpeta NO cuenta como editar la ficha. Se
-- ajusta carta_tocar_updated_at() para que, si lo único que cambia es
-- drive_folder_id, updated_at se quede como estaba (si no, cada plato que se
-- enlaza parecería «editado» a las webs y a la auditoría de cambios).
--
-- Se puede aplicar dos veces. Rollback:
-- supabase/rollbacks/20261201120000_carta_drive_folder_id_ROLLBACK.sql
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
declare
  v_faltan text[] := '{}';
begin
  if to_regclass('public."Platos"') is null then
    v_faltan := v_faltan || 'la tabla "Platos"'::text;
  end if;
  if to_regclass('public."Vinos"') is null then
    v_faltan := v_faltan || 'la tabla "Vinos"'::text;
  end if;
  if cardinality(v_faltan) > 0 then
    raise exception 'carta_drive_folder_id: falta %. No se ha cambiado nada.', array_to_string(v_faltan, ', ');
  end if;
end;
$$;

alter table public."Platos" add column if not exists drive_folder_id text;
alter table public."Vinos"  add column if not exists drive_folder_id text;

-- El mismo patrón que carta_fotos_originales.drive_id (id de Drive: letras, números, «-» y «_»).
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public."Platos"'::regclass and conname = 'platos_drive_folder_id_chk') then
    alter table public."Platos" add constraint platos_drive_folder_id_chk
      check (drive_folder_id is null or drive_folder_id ~ '^[A-Za-z0-9_-]{10,200}$');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public."Vinos"'::regclass and conname = 'vinos_drive_folder_id_chk') then
    alter table public."Vinos" add constraint vinos_drive_folder_id_chk
      check (drive_folder_id is null or drive_folder_id ~ '^[A-Za-z0-9_-]{10,200}$');
  end if;
end;
$$;

comment on column public."Platos".drive_folder_id is
  'Id de la carpeta del plato en Google Drive (marketing/Platos/<NN Categoría>/<plato>). La rellena instagram-drive al subir el original y scripts/carta/vincular-carpetas-drive.mjs. No es un permiso: Drive pide acceso a la cuenta.';
comment on column public."Vinos".drive_folder_id is
  'Id de la carpeta del vino en Google Drive (marketing/Vinos/<Tipo>/<vino>). La rellena instagram-drive al subir el original y scripts/carta/vincular-carpetas-drive.mjs.';

-- Guardar solo el id de la carpeta no «edita» la ficha: updated_at se queda como estaba.
create or replace function public.carta_tocar_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'drive_folder_id' - 'updated_at') = (to_jsonb(old) - 'drive_folder_id' - 'updated_at')
     and (to_jsonb(new) ->> 'drive_folder_id') is distinct from (to_jsonb(old) ->> 'drive_folder_id') then
    new.updated_at := old.updated_at;
    return new;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.carta_tocar_updated_at() from public, anon, authenticated;

do $$
declare
  v_malos text[] := '{}';
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name in ('Platos', 'Vinos') and column_name = 'drive_folder_id') <> 2 then
    v_malos := v_malos || 'faltan columnas'::text;
  end if;
  if (select count(*) from pg_constraint where conname in ('platos_drive_folder_id_chk', 'vinos_drive_folder_id_chk')) <> 2 then
    v_malos := v_malos || 'faltan CHECK'::text;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    if has_table_privilege('anon', 'public."Platos"', 'INSERT') or has_table_privilege('anon', 'public."Platos"', 'UPDATE')
       or has_table_privilege('anon', 'public."Vinos"', 'INSERT') or has_table_privilege('anon', 'public."Vinos"', 'UPDATE') then
      v_malos := v_malos || 'anon puede escribir en la carta'::text;
    end if;
  end if;
  if cardinality(v_malos) > 0 then
    raise exception 'carta_drive_folder_id: comprobación final fallida (%). No se ha aplicado nada.', array_to_string(v_malos, '; ');
  end if;
  raise notice 'carta_drive_folder_id: aplicada';
end;
$$;

commit;
