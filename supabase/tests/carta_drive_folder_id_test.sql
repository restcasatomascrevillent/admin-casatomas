set client_encoding = 'UTF8';
-- ===========================================================================
-- Prueba de 20261201120000_carta_drive_folder_id.sql: BEGIN … ROLLBACK, no deja nada.
-- Se lanza DESPUÉS de aplicar la migración, como `postgres`:
--   npx supabase db query --linked -f supabase/tests/carta_drive_folder_id_test.sql
-- Comprueba: columnas en Platos y Vinos, CHECK del id de Drive, que guardar solo
-- el id de carpeta NO toca updated_at, que cambiar otra cosa sí, y que anon no
-- puede escribir. Si termina sin ERROR, todo ha pasado.
-- ===========================================================================
begin;
set local lock_timeout = '5s';

do $$
declare
  v_plato text;
  v_vino text;
  v_antes timestamptz;
  v_despues timestamptz;
  v_error text;
begin
  -- 1. Las dos columnas existen (la migración está aplicada).
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name in ('Platos', 'Vinos') and column_name = 'drive_folder_id') <> 2 then
    raise exception 'ASSERT FAILED: aplica antes 20261201120000_carta_drive_folder_id.sql';
  end if;

  select id into v_plato from public."Platos" order by id limit 1;
  select id into v_vino from public."Vinos" order by id limit 1;
  if v_plato is null or v_vino is null then
    raise exception 'ASSERT FAILED: hace falta al menos un plato y un vino para probar';
  end if;

  -- 2. Un id válido se guarda; null también.
  update public."Platos" set drive_folder_id = '1AbCdEfGhIjKlMnOpQrS' where id = v_plato;
  update public."Vinos"  set drive_folder_id = '1AbCdEfGhIjKlMnOpQrS' where id = v_vino;
  update public."Platos" set drive_folder_id = null where id = v_plato;

  -- 3. Un id mal formado se rechaza (con barra, corto, con espacios, URL).
  foreach v_error in array array['corto', 'tiene/barra/xxxxxxxxxx', 'con espacio xxxxxxxxx', 'https://drive.google.com/drive/folders/abc'] loop
    begin
      update public."Platos" set drive_folder_id = v_error where id = v_plato;
      raise exception 'ASSERT FAILED: Platos aceptó el id %', v_error;
    exception when check_violation then
      null;
    end;
    begin
      update public."Vinos" set drive_folder_id = v_error where id = v_vino;
      raise exception 'ASSERT FAILED: Vinos aceptó el id %', v_error;
    exception when check_violation then
      null;
    end;
  end loop;

  -- 4. Guardar SOLO el id de carpeta no cambia updated_at; editar otra cosa, sí.
  update public."Platos" set updated_at = now() - interval '30 days' where id = v_plato;
  select updated_at into v_antes from public."Platos" where id = v_plato;
  update public."Platos" set drive_folder_id = '1ZyXwVuTsRqPoNmLkJiH' where id = v_plato;
  select updated_at into v_despues from public."Platos" where id = v_plato;
  if v_despues is distinct from v_antes then
    raise exception 'ASSERT FAILED: guardar drive_folder_id cambió updated_at (% → %)', v_antes, v_despues;
  end if;
  update public."Platos" set nombre = nombre || ' ' where id = v_plato;
  select updated_at into v_despues from public."Platos" where id = v_plato;
  if v_despues <= v_antes then
    raise exception 'ASSERT FAILED: editar el nombre ya no actualiza updated_at';
  end if;

  -- 5. anon no escribe en la carta.
  if exists (select 1 from pg_roles where rolname = 'anon') then
    if has_table_privilege('anon', 'public."Platos"', 'UPDATE') or has_table_privilege('anon', 'public."Vinos"', 'UPDATE') then
      raise exception 'ASSERT FAILED: anon puede hacer UPDATE en la carta';
    end if;
  end if;

  raise notice 'carta_drive_folder_id: todas las comprobaciones han pasado';
end;
$$;

rollback;
