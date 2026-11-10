set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261110_vinos_anadas_parker_demo
-- Añadas en el nombre según las fotos de las etiquetas y puntuaciones Parker aplicadas
-- Proyecto: sfonaclosuafvlhutkon (demo)
-- ===========================================================================
-- GENERADO por scripts/parker/generar-sql-anadas.mjs a partir de
-- docs/anadas-parker-2026-11-10/cambios.json (informe: INFORME.md en la misma
-- carpeta). No editar a mano: cambiar el JSON y volver a generar.
--
-- 121 vinos (nombre + añada que se sirve) y 75 filas de vinos_puntuacion_parker.
-- Solo cambia las filas que siguen como se vieron al preparar el cambio (consulta a la
-- demo del 10/11/2026, copia de producción); las demás se saltan y se listan al final.
-- Idempotente. Requiere las migraciones 20261118103000 y 20261118110000 (Parker con fuente).
-- Aplicar en el SQL editor de Supabase (o psql), una vez. Termina con un
-- aviso «20261110_vinos_anadas_parker_demo: …» con lo que ha cambiado.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
declare
  n integer;
  v_vinos integer := 0;
  v_ya integer := 0;
  v_parker integer := 0;
  v_saltados text[] := '{}';
begin
  if to_regclass('public.vinos_puntuacion_parker') is null
     or to_regprocedure('public.vinos_parker_calculado(text, smallint, boolean)') is null then
    raise exception '20261110_vinos_anadas_parker_demo: falta la migración 20261118103000_vinos_puntuacion_parker_fuentes. No se ha cambiado nada.';
  end if;

  -- ─── 1. Nombre y añada que se sirve ───
  -- 912 de Altitud → 912 de Altitud 2023
  update public."Vinos"
     set nombre = '912 de Altitud 2023',
         anada = 2023,
         sin_anada = false
   where id = '56b33d30-e029-4208-b06d-2c5b47762240'
     and nombre = '912 de Altitud'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '56b33d30-e029-4208-b06d-2c5b47762240' and nombre = '912 de Altitud 2023'
                  and anada is not distinct from 2023 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '56b33d30-e029-4208-b06d-2c5b47762240') then v_saltados := array_append(v_saltados, '56b33d30-e029-4208-b06d-2c5b47762240 (912 de Altitud)');
  end if;

  -- Aalto PS → Aalto PS 2022
  update public."Vinos"
     set nombre = 'Aalto PS 2022',
         anada = 2022,
         sin_anada = false
   where id = '43187593-0677-4f4b-9583-a3838dabd7f2'
     and nombre = 'Aalto PS'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '43187593-0677-4f4b-9583-a3838dabd7f2' and nombre = 'Aalto PS 2022'
                  and anada is not distinct from 2022 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '43187593-0677-4f4b-9583-a3838dabd7f2') then v_saltados := array_append(v_saltados, '43187593-0677-4f4b-9583-a3838dabd7f2 (Aalto PS)');
  end if;

  -- Aaltos Blanco → Aaltos Blanco 2023
  update public."Vinos"
     set nombre = 'Aaltos Blanco 2023',
         anada = 2023,
         sin_anada = false
   where id = '0b790f1a-03da-4f83-9c24-a6f0ab600b5a'
     and nombre = 'Aaltos Blanco'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '0b790f1a-03da-4f83-9c24-a6f0ab600b5a' and nombre = 'Aaltos Blanco 2023'
                  and anada is not distinct from 2023 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '0b790f1a-03da-4f83-9c24-a6f0ab600b5a') then v_saltados := array_append(v_saltados, '0b790f1a-03da-4f83-9c24-a6f0ab600b5a (Aaltos Blanco)');
  end if;

  -- Abadía Retuerta Selección Especial → Abadía Retuerta Selección Especial 2019
  update public."Vinos"
     set nombre = 'Abadía Retuerta Selección Especial 2019',
         anada = 2019,
         sin_anada = false
   where id = '6cce52a0-2fc7-48d3-8801-29ea2073e3b2'
     and nombre = 'Abadía Retuerta Selección Especial'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '6cce52a0-2fc7-48d3-8801-29ea2073e3b2' and nombre = 'Abadía Retuerta Selección Especial 2019'
                  and anada is not distinct from 2019 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '6cce52a0-2fc7-48d3-8801-29ea2073e3b2') then v_saltados := array_append(v_saltados, '6cce52a0-2fc7-48d3-8801-29ea2073e3b2 (Abadía Retuerta Selección Especial)');
  end if;

  -- Alión → Alión 2020
  update public."Vinos"
     set nombre = 'Alión 2020',
         anada = 2020,
         sin_anada = false
   where id = '701d9b3a-35c2-43a5-a613-b041886538a5'
     and nombre = 'Alión'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '701d9b3a-35c2-43a5-a613-b041886538a5' and nombre = 'Alión 2020'
                  and anada is not distinct from 2020 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '701d9b3a-35c2-43a5-a613-b041886538a5') then v_saltados := array_append(v_saltados, '701d9b3a-35c2-43a5-a613-b041886538a5 (Alión)');
  end if;

  -- Artadi Valdeginés → Artadi Valdeginés 2022
  update public."Vinos"
     set nombre = 'Artadi Valdeginés 2022',
         anada = 2022,
         sin_anada = false
   where id = '4763a3d1-6e66-4dc5-9101-649690958baf'
     and nombre = 'Artadi Valdeginés'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '4763a3d1-6e66-4dc5-9101-649690958baf' and nombre = 'Artadi Valdeginés 2022'
                  and anada is not distinct from 2022 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '4763a3d1-6e66-4dc5-9101-649690958baf') then v_saltados := array_append(v_saltados, '4763a3d1-6e66-4dc5-9101-649690958baf (Artadi Valdeginés)');
  end if;

  -- Arzuaga → Arzuaga 2022
  update public."Vinos"
     set nombre = 'Arzuaga 2022',
         anada = 2022,
         sin_anada = false
   where id = 'aee0f9a6-4587-4690-b8a0-d188c1e4f736'
     and nombre = 'Arzuaga'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'aee0f9a6-4587-4690-b8a0-d188c1e4f736' and nombre = 'Arzuaga 2022'
                  and anada is not distinct from 2022 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'aee0f9a6-4587-4690-b8a0-d188c1e4f736') then v_saltados := array_append(v_saltados, 'aee0f9a6-4587-4690-b8a0-d188c1e4f736 (Arzuaga)');
  end if;

  -- Arzuaga Gran Reserva → Arzuaga Gran Reserva 2018
  update public."Vinos"
     set nombre = 'Arzuaga Gran Reserva 2018',
         anada = 2018,
         sin_anada = false
   where id = '4171e534-9b36-400f-8304-925460ed3a89'
     and nombre = 'Arzuaga Gran Reserva'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '4171e534-9b36-400f-8304-925460ed3a89' and nombre = 'Arzuaga Gran Reserva 2018'
                  and anada is not distinct from 2018 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '4171e534-9b36-400f-8304-925460ed3a89') then v_saltados := array_append(v_saltados, '4171e534-9b36-400f-8304-925460ed3a89 (Arzuaga Gran Reserva)');
  end if;

  -- Áster El Espino → Áster El Espino 2020
  update public."Vinos"
     set nombre = 'Áster El Espino 2020',
         anada = 2020,
         sin_anada = false
   where id = '75bb1e5e-ae7d-4ded-bf22-878858e00355'
     and nombre = 'Áster El Espino'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '75bb1e5e-ae7d-4ded-bf22-878858e00355' and nombre = 'Áster El Espino 2020'
                  and anada is not distinct from 2020 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '75bb1e5e-ae7d-4ded-bf22-878858e00355') then v_saltados := array_append(v_saltados, '75bb1e5e-ae7d-4ded-bf22-878858e00355 (Áster El Espino)');
  end if;

  -- Áster El Otero → Áster El Otero 2018
  update public."Vinos"
     set nombre = 'Áster El Otero 2018',
         anada = 2018,
         sin_anada = false
   where id = '93aa5d5f-97de-494a-9266-4bcf9bc07b74'
     and nombre = 'Áster El Otero'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '93aa5d5f-97de-494a-9266-4bcf9bc07b74' and nombre = 'Áster El Otero 2018'
                  and anada is not distinct from 2018 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '93aa5d5f-97de-494a-9266-4bcf9bc07b74') then v_saltados := array_append(v_saltados, '93aa5d5f-97de-494a-9266-4bcf9bc07b74 (Áster El Otero)');
  end if;

  -- Áster Otero (Magnum) → Áster Otero 2018 (Magnum)
  update public."Vinos"
     set nombre = 'Áster Otero 2018 (Magnum)',
         anada = 2018,
         sin_anada = false
   where id = 'c0d22e63-dfea-45d1-a6c4-080a16a6b8f2'
     and nombre = 'Áster Otero (Magnum)'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'c0d22e63-dfea-45d1-a6c4-080a16a6b8f2' and nombre = 'Áster Otero 2018 (Magnum)'
                  and anada is not distinct from 2018 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'c0d22e63-dfea-45d1-a6c4-080a16a6b8f2') then v_saltados := array_append(v_saltados, 'c0d22e63-dfea-45d1-a6c4-080a16a6b8f2 (Áster Otero (Magnum))');
  end if;

  -- Ausàs Interpretación → Ausàs Interpretación 2018
  update public."Vinos"
     set nombre = 'Ausàs Interpretación 2018',
         anada = 2018,
         sin_anada = false
   where id = '57cf57dc-6ce5-4407-adbb-d3d337bf1544'
     and nombre = 'Ausàs Interpretación'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '57cf57dc-6ce5-4407-adbb-d3d337bf1544' and nombre = 'Ausàs Interpretación 2018'
                  and anada is not distinct from 2018 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '57cf57dc-6ce5-4407-adbb-d3d337bf1544') then v_saltados := array_append(v_saltados, '57cf57dc-6ce5-4407-adbb-d3d337bf1544 (Ausàs Interpretación)');
  end if;

  -- Bahía de Dénia → Bahía de Dénia 2024
  update public."Vinos"
     set nombre = 'Bahía de Dénia 2024',
         anada = 2024,
         sin_anada = false
   where id = '7962c4ca-25aa-4500-92d4-4c4b038fa269'
     and nombre = 'Bahía de Dénia'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '7962c4ca-25aa-4500-92d4-4c4b038fa269' and nombre = 'Bahía de Dénia 2024'
                  and anada is not distinct from 2024 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '7962c4ca-25aa-4500-92d4-4c4b038fa269') then v_saltados := array_append(v_saltados, '7962c4ca-25aa-4500-92d4-4c4b038fa269 (Bahía de Dénia)');
  end if;

  -- Balbás Ancestral → Balbás Ancestral 2020
  update public."Vinos"
     set nombre = 'Balbás Ancestral 2020',
         anada = 2020,
         sin_anada = false
   where id = '53671e64-4ef1-4264-875d-e66b106018c4'
     and nombre = 'Balbás Ancestral'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '53671e64-4ef1-4264-875d-e66b106018c4' and nombre = 'Balbás Ancestral 2020'
                  and anada is not distinct from 2020 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '53671e64-4ef1-4264-875d-e66b106018c4') then v_saltados := array_append(v_saltados, '53671e64-4ef1-4264-875d-e66b106018c4 (Balbás Ancestral)');
  end if;

  -- Bermejos (Lanzarote) → Bermejos (Lanzarote) 2025
  update public."Vinos"
     set nombre = 'Bermejos (Lanzarote) 2025',
         anada = 2025,
         sin_anada = false
   where id = '1214516e-edd2-4323-a044-12892572deb3'
     and nombre = 'Bermejos (Lanzarote)'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '1214516e-edd2-4323-a044-12892572deb3' and nombre = 'Bermejos (Lanzarote) 2025'
                  and anada is not distinct from 2025 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '1214516e-edd2-4323-a044-12892572deb3') then v_saltados := array_append(v_saltados, '1214516e-edd2-4323-a044-12892572deb3 (Bermejos (Lanzarote))');
  end if;

  -- Bosque de Matasnos → Bosque de Matasnos 2022
  update public."Vinos"
     set nombre = 'Bosque de Matasnos 2022',
         anada = 2022,
         sin_anada = false
   where id = '8b2d10a2-c778-4233-980d-ebb94db71ce4'
     and nombre = 'Bosque de Matasnos'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '8b2d10a2-c778-4233-980d-ebb94db71ce4' and nombre = 'Bosque de Matasnos 2022'
                  and anada is not distinct from 2022 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '8b2d10a2-c778-4233-980d-ebb94db71ce4') then v_saltados := array_append(v_saltados, '8b2d10a2-c778-4233-980d-ebb94db71ce4 (Bosque de Matasnos)');
  end if;

  -- Bosque de Matasnos (Magnum) → Bosque de Matasnos 2022 (Magnum)
  update public."Vinos"
     set nombre = 'Bosque de Matasnos 2022 (Magnum)',
         anada = 2022,
         sin_anada = false
   where id = '387d18c4-a561-4524-9dbe-c53ea3d202f5'
     and nombre = 'Bosque de Matasnos (Magnum)'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '387d18c4-a561-4524-9dbe-c53ea3d202f5' and nombre = 'Bosque de Matasnos 2022 (Magnum)'
                  and anada is not distinct from 2022 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '387d18c4-a561-4524-9dbe-c53ea3d202f5') then v_saltados := array_append(v_saltados, '387d18c4-a561-4524-9dbe-c53ea3d202f5 (Bosque de Matasnos (Magnum))');
  end if;

  -- Carraovejas (Magnum) → Carraovejas 2023 (Magnum)
  update public."Vinos"
     set nombre = 'Carraovejas 2023 (Magnum)',
         anada = 2023,
         sin_anada = false
   where id = '540c1075-8c8e-4a70-9fe7-d499b293741d'
     and nombre = 'Carraovejas (Magnum)'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '540c1075-8c8e-4a70-9fe7-d499b293741d' and nombre = 'Carraovejas 2023 (Magnum)'
                  and anada is not distinct from 2023 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '540c1075-8c8e-4a70-9fe7-d499b293741d') then v_saltados := array_append(v_saltados, '540c1075-8c8e-4a70-9fe7-d499b293741d (Carraovejas (Magnum))');
  end if;

  -- Carraovejas Cuesta de las Liebres → Carraovejas Cuesta de las Liebres 2019
  update public."Vinos"
     set nombre = 'Carraovejas Cuesta de las Liebres 2019',
         anada = 2019,
         sin_anada = false
   where id = '474b23ff-1c6e-4f6d-b25c-736e0640525d'
     and nombre = 'Carraovejas Cuesta de las Liebres'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '474b23ff-1c6e-4f6d-b25c-736e0640525d' and nombre = 'Carraovejas Cuesta de las Liebres 2019'
                  and anada is not distinct from 2019 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '474b23ff-1c6e-4f6d-b25c-736e0640525d') then v_saltados := array_append(v_saltados, '474b23ff-1c6e-4f6d-b25c-736e0640525d (Carraovejas Cuesta de las Liebres)');
  end if;

  -- Carraovejas El Anejón → Carraovejas El Anejón 2018
  update public."Vinos"
     set nombre = 'Carraovejas El Anejón 2018',
         anada = 2018,
         sin_anada = false
   where id = 'bf7a0cc1-9eaa-46b5-8c32-4fa4bca55cf1'
     and nombre = 'Carraovejas El Anejón'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'bf7a0cc1-9eaa-46b5-8c32-4fa4bca55cf1' and nombre = 'Carraovejas El Anejón 2018'
                  and anada is not distinct from 2018 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'bf7a0cc1-9eaa-46b5-8c32-4fa4bca55cf1') then v_saltados := array_append(v_saltados, 'bf7a0cc1-9eaa-46b5-8c32-4fa4bca55cf1 (Carraovejas El Anejón)');
  end if;

  -- Carraovejas El Anejón (Magnum) → Carraovejas El Anejón 2018 (Magnum)
  update public."Vinos"
     set nombre = 'Carraovejas El Anejón 2018 (Magnum)',
         anada = 2018,
         sin_anada = false
   where id = '6278535b-bf41-4387-b017-9d77e51d4ab8'
     and nombre = 'Carraovejas El Anejón (Magnum)'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '6278535b-bf41-4387-b017-9d77e51d4ab8' and nombre = 'Carraovejas El Anejón 2018 (Magnum)'
                  and anada is not distinct from 2018 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '6278535b-bf41-4387-b017-9d77e51d4ab8') then v_saltados := array_append(v_saltados, '6278535b-bf41-4387-b017-9d77e51d4ab8 (Carraovejas El Anejón (Magnum))');
  end if;

  -- Castillo de Ygay Gran Reserva → Castillo de Ygay Gran Reserva 2012
  update public."Vinos"
     set nombre = 'Castillo de Ygay Gran Reserva 2012',
         anada = 2012,
         sin_anada = false
   where id = 'ec7978fd-a0e0-4168-86bc-4b80b46fd6cf'
     and nombre = 'Castillo de Ygay Gran Reserva'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'ec7978fd-a0e0-4168-86bc-4b80b46fd6cf' and nombre = 'Castillo de Ygay Gran Reserva 2012'
                  and anada is not distinct from 2012 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'ec7978fd-a0e0-4168-86bc-4b80b46fd6cf') then v_saltados := array_append(v_saltados, 'ec7978fd-a0e0-4168-86bc-4b80b46fd6cf (Castillo de Ygay Gran Reserva)');
  end if;

  -- Clio → Clio 2023
  update public."Vinos"
     set nombre = 'Clio 2023',
         anada = 2023,
         sin_anada = false
   where id = '7477d8f5-3c41-45a9-8bd0-77247ef2aeca'
     and nombre = 'Clio'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '7477d8f5-3c41-45a9-8bd0-77247ef2aeca' and nombre = 'Clio 2023'
                  and anada is not distinct from 2023 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '7477d8f5-3c41-45a9-8bd0-77247ef2aeca') then v_saltados := array_append(v_saltados, '7477d8f5-3c41-45a9-8bd0-77247ef2aeca (Clio)');
  end if;

  -- Collet Rosé → Collet Rosé
  update public."Vinos"
     set nombre = 'Collet Rosé',
         anada = null,
         sin_anada = true
   where id = '7c8df937-0938-4ce4-b35d-c2cbc20f9fc6'
     and nombre = 'Collet Rosé'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '7c8df937-0938-4ce4-b35d-c2cbc20f9fc6' and nombre = 'Collet Rosé'
                  and anada is not distinct from null and sin_anada = true) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '7c8df937-0938-4ce4-b35d-c2cbc20f9fc6') then v_saltados := array_append(v_saltados, '7c8df937-0938-4ce4-b35d-c2cbc20f9fc6 (Collet Rosé)');
  end if;

  -- Conde de los Andes → Conde de los Andes 2019
  update public."Vinos"
     set nombre = 'Conde de los Andes 2019',
         anada = 2019,
         sin_anada = false
   where id = '435c2b95-e7b7-42e7-9314-11d38d082f3f'
     and nombre = 'Conde de los Andes'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '435c2b95-e7b7-42e7-9314-11d38d082f3f' and nombre = 'Conde de los Andes 2019'
                  and anada is not distinct from 2019 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '435c2b95-e7b7-42e7-9314-11d38d082f3f') then v_saltados := array_append(v_saltados, '435c2b95-e7b7-42e7-9314-11d38d082f3f (Conde de los Andes)');
  end if;

  -- Dominio de Calogía → Dominio de Calogía 2020
  update public."Vinos"
     set nombre = 'Dominio de Calogía 2020',
         anada = 2020,
         sin_anada = false
   where id = 'b550e328-7b1b-4e5b-8442-1d8b5161e771'
     and nombre = 'Dominio de Calogía'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'b550e328-7b1b-4e5b-8442-1d8b5161e771' and nombre = 'Dominio de Calogía 2020'
                  and anada is not distinct from 2020 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'b550e328-7b1b-4e5b-8442-1d8b5161e771') then v_saltados := array_append(v_saltados, 'b550e328-7b1b-4e5b-8442-1d8b5161e771 (Dominio de Calogía)');
  end if;

  -- Dominio de Calogía (Magnum) → Dominio de Calogía 2020 (Magnum)
  update public."Vinos"
     set nombre = 'Dominio de Calogía 2020 (Magnum)',
         anada = 2020,
         sin_anada = false
   where id = 'c845e388-6954-4b1f-b5dc-36064f06043f'
     and nombre = 'Dominio de Calogía (Magnum)'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'c845e388-6954-4b1f-b5dc-36064f06043f' and nombre = 'Dominio de Calogía 2020 (Magnum)'
                  and anada is not distinct from 2020 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'c845e388-6954-4b1f-b5dc-36064f06043f') then v_saltados := array_append(v_saltados, 'c845e388-6954-4b1f-b5dc-36064f06043f (Dominio de Calogía (Magnum))');
  end if;

  -- Dominio de Calogía Doble M → Dominio de Calogía Doble M 2020
  update public."Vinos"
     set nombre = 'Dominio de Calogía Doble M 2020',
         anada = 2020,
         sin_anada = false
   where id = 'd9803ec6-fff8-4ea8-a6d6-04d04da64404'
     and nombre = 'Dominio de Calogía Doble M'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'd9803ec6-fff8-4ea8-a6d6-04d04da64404' and nombre = 'Dominio de Calogía Doble M 2020'
                  and anada is not distinct from 2020 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'd9803ec6-fff8-4ea8-a6d6-04d04da64404') then v_saltados := array_append(v_saltados, 'd9803ec6-fff8-4ea8-a6d6-04d04da64404 (Dominio de Calogía Doble M)');
  end if;

  -- Dominio del Águila Reserva → Dominio del Águila Reserva 2020
  update public."Vinos"
     set nombre = 'Dominio del Águila Reserva 2020',
         anada = 2020,
         sin_anada = false
   where id = 'a62be9fe-cea2-49d1-9dcf-b0a988510afd'
     and nombre = 'Dominio del Águila Reserva'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'a62be9fe-cea2-49d1-9dcf-b0a988510afd' and nombre = 'Dominio del Águila Reserva 2020'
                  and anada is not distinct from 2020 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'a62be9fe-cea2-49d1-9dcf-b0a988510afd') then v_saltados := array_append(v_saltados, 'a62be9fe-cea2-49d1-9dcf-b0a988510afd (Dominio del Águila Reserva)');
  end if;

  -- Dominio del Pidio → Dominio del Pidio 2021
  update public."Vinos"
     set nombre = 'Dominio del Pidio 2021',
         anada = 2021,
         sin_anada = false
   where id = '27696aa0-c54f-4baa-a65a-cd0442de84bb'
     and nombre = 'Dominio del Pidio'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '27696aa0-c54f-4baa-a65a-cd0442de84bb' and nombre = 'Dominio del Pidio 2021'
                  and anada is not distinct from 2021 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '27696aa0-c54f-4baa-a65a-cd0442de84bb') then v_saltados := array_append(v_saltados, '27696aa0-c54f-4baa-a65a-cd0442de84bb (Dominio del Pidio)');
  end if;

  -- El Canto de la Alondra → El Canto de la Alondra 2022
  update public."Vinos"
     set nombre = 'El Canto de la Alondra 2022',
         anada = 2022,
         sin_anada = false
   where id = '5a6e9fa1-4a16-48e9-9201-0c9452ac35ba'
     and nombre = 'El Canto de la Alondra'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '5a6e9fa1-4a16-48e9-9201-0c9452ac35ba' and nombre = 'El Canto de la Alondra 2022'
                  and anada is not distinct from 2022 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '5a6e9fa1-4a16-48e9-9201-0c9452ac35ba') then v_saltados := array_append(v_saltados, '5a6e9fa1-4a16-48e9-9201-0c9452ac35ba (El Canto de la Alondra)');
  end if;

  -- El Corral de Taruguín → El Corral de Taruguín 2018
  update public."Vinos"
     set nombre = 'El Corral de Taruguín 2018',
         anada = 2018,
         sin_anada = false
   where id = 'fddf1981-ac0e-406f-9172-536b92f79a19'
     and nombre = 'El Corral de Taruguín'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'fddf1981-ac0e-406f-9172-536b92f79a19' and nombre = 'El Corral de Taruguín 2018'
                  and anada is not distinct from 2018 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'fddf1981-ac0e-406f-9172-536b92f79a19') then v_saltados := array_append(v_saltados, 'fddf1981-ac0e-406f-9172-536b92f79a19 (El Corral de Taruguín)');
  end if;

  -- El Nido → El Nido 2023
  update public."Vinos"
     set nombre = 'El Nido 2023',
         anada = 2023,
         sin_anada = false
   where id = '71df1c08-defa-415c-861f-9daa4fb54762'
     and nombre = 'El Nido'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '71df1c08-defa-415c-861f-9daa4fb54762' and nombre = 'El Nido 2023'
                  and anada is not distinct from 2023 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '71df1c08-defa-415c-861f-9daa4fb54762') then v_saltados := array_append(v_saltados, '71df1c08-defa-415c-861f-9daa4fb54762 (El Nido)');
  end if;

  -- El Sequé → El Sequé 2022
  update public."Vinos"
     set nombre = 'El Sequé 2022',
         anada = 2022,
         sin_anada = false
   where id = 'd65dcbd3-4a7a-402e-80b4-a79b562714c8'
     and nombre = 'El Sequé'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'd65dcbd3-4a7a-402e-80b4-a79b562714c8' and nombre = 'El Sequé 2022'
                  and anada is not distinct from 2022 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'd65dcbd3-4a7a-402e-80b4-a79b562714c8') then v_saltados := array_append(v_saltados, 'd65dcbd3-4a7a-402e-80b4-a79b562714c8 (El Sequé)');
  end if;

  -- Fefiñanes → Fefiñanes 2024
  update public."Vinos"
     set nombre = 'Fefiñanes 2024',
         anada = 2024,
         sin_anada = false
   where id = 'a21f8826-79e1-4662-9d9a-a0ac445a2e11'
     and nombre = 'Fefiñanes'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'a21f8826-79e1-4662-9d9a-a0ac445a2e11' and nombre = 'Fefiñanes 2024'
                  and anada is not distinct from 2024 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'a21f8826-79e1-4662-9d9a-a0ac445a2e11') then v_saltados := array_append(v_saltados, 'a21f8826-79e1-4662-9d9a-a0ac445a2e11 (Fefiñanes)');
  end if;

  -- Fefiñanes (Magnum) → Fefiñanes 2024 (Magnum)
  update public."Vinos"
     set nombre = 'Fefiñanes 2024 (Magnum)',
         anada = 2024,
         sin_anada = false
   where id = '869f78bc-2994-49a7-88b3-c5eec414b6df'
     and nombre = 'Fefiñanes (Magnum)'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '869f78bc-2994-49a7-88b3-c5eec414b6df' and nombre = 'Fefiñanes 2024 (Magnum)'
                  and anada is not distinct from 2024 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '869f78bc-2994-49a7-88b3-c5eec414b6df') then v_saltados := array_append(v_saltados, '869f78bc-2994-49a7-88b3-c5eec414b6df (Fefiñanes (Magnum))');
  end if;

  -- Flor de Pingus → Flor de Pingus 2023
  update public."Vinos"
     set nombre = 'Flor de Pingus 2023',
         anada = 2023,
         sin_anada = false
   where id = '82a51e05-5a64-47cc-92eb-b0fba170310c'
     and nombre = 'Flor de Pingus'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '82a51e05-5a64-47cc-92eb-b0fba170310c' and nombre = 'Flor de Pingus 2023'
                  and anada is not distinct from 2023 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '82a51e05-5a64-47cc-92eb-b0fba170310c') then v_saltados := array_append(v_saltados, '82a51e05-5a64-47cc-92eb-b0fba170310c (Flor de Pingus)');
  end if;

  -- G.H. Martel Prestige Brut → G.H. Martel Prestige Brut
  update public."Vinos"
     set nombre = 'G.H. Martel Prestige Brut',
         anada = null,
         sin_anada = true
   where id = '52af6943-a587-4c05-bba7-e25d62c796c8'
     and nombre = 'G.H. Martel Prestige Brut'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '52af6943-a587-4c05-bba7-e25d62c796c8' and nombre = 'G.H. Martel Prestige Brut'
                  and anada is not distinct from null and sin_anada = true) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '52af6943-a587-4c05-bba7-e25d62c796c8') then v_saltados := array_append(v_saltados, '52af6943-a587-4c05-bba7-e25d62c796c8 (G.H. Martel Prestige Brut)');
  end if;

  -- Gran Reserva 904 (La Rioja Alta) → Gran Reserva 904 (La Rioja Alta) 2015
  update public."Vinos"
     set nombre = 'Gran Reserva 904 (La Rioja Alta) 2015',
         anada = 2015,
         sin_anada = false
   where id = 'b0d47317-673b-4cb2-a787-48081719ba9e'
     and nombre = 'Gran Reserva 904 (La Rioja Alta)'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'b0d47317-673b-4cb2-a787-48081719ba9e' and nombre = 'Gran Reserva 904 (La Rioja Alta) 2015'
                  and anada is not distinct from 2015 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'b0d47317-673b-4cb2-a787-48081719ba9e') then v_saltados := array_append(v_saltados, 'b0d47317-673b-4cb2-a787-48081719ba9e (Gran Reserva 904 (La Rioja Alta))');
  end if;

  -- José Pariente Sauvignon Blanc → José Pariente Sauvignon Blanc 2024
  update public."Vinos"
     set nombre = 'José Pariente Sauvignon Blanc 2024',
         anada = 2024,
         sin_anada = false
   where id = 'b8867cac-a5ae-4b9a-acad-6c498b538739'
     and nombre = 'José Pariente Sauvignon Blanc'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'b8867cac-a5ae-4b9a-acad-6c498b538739' and nombre = 'José Pariente Sauvignon Blanc 2024'
                  and anada is not distinct from 2024 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'b8867cac-a5ae-4b9a-acad-6c498b538739') then v_saltados := array_append(v_saltados, 'b8867cac-a5ae-4b9a-acad-6c498b538739 (José Pariente Sauvignon Blanc)');
  end if;

  -- L. Beyer Gewurz Comtes d'Eguisheim → L. Beyer Gewurz Comtes d'Eguisheim 2009
  update public."Vinos"
     set nombre = 'L. Beyer Gewurz Comtes d''Eguisheim 2009',
         anada = 2009,
         sin_anada = false
   where id = 'b54dca1f-4030-4af3-94c4-733806de0b7d'
     and nombre = 'L. Beyer Gewurz Comtes d''Eguisheim'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'b54dca1f-4030-4af3-94c4-733806de0b7d' and nombre = 'L. Beyer Gewurz Comtes d''Eguisheim 2009'
                  and anada is not distinct from 2009 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'b54dca1f-4030-4af3-94c4-733806de0b7d') then v_saltados := array_append(v_saltados, 'b54dca1f-4030-4af3-94c4-733806de0b7d (L. Beyer Gewurz Comtes d''Eguisheim)');
  end if;

  -- La Nieta → La Nieta 2024
  update public."Vinos"
     set nombre = 'La Nieta 2024',
         anada = 2024,
         sin_anada = false
   where id = '465516c9-e18b-40d7-b94b-e0467d9931bf'
     and nombre = 'La Nieta'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '465516c9-e18b-40d7-b94b-e0467d9931bf' and nombre = 'La Nieta 2024'
                  and anada is not distinct from 2024 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '465516c9-e18b-40d7-b94b-e0467d9931bf') then v_saltados := array_append(v_saltados, '465516c9-e18b-40d7-b94b-e0467d9931bf (La Nieta)');
  end if;

  -- La Rioja Alta Gran Reserva 890 → La Rioja Alta Gran Reserva 890 2010
  update public."Vinos"
     set nombre = 'La Rioja Alta Gran Reserva 890 2010',
         anada = 2010,
         sin_anada = false
   where id = '345729aa-0a2e-464a-bca8-05409784f668'
     and nombre = 'La Rioja Alta Gran Reserva 890'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '345729aa-0a2e-464a-bca8-05409784f668' and nombre = 'La Rioja Alta Gran Reserva 890 2010'
                  and anada is not distinct from 2010 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '345729aa-0a2e-464a-bca8-05409784f668') then v_saltados := array_append(v_saltados, '345729aa-0a2e-464a-bca8-05409784f668 (La Rioja Alta Gran Reserva 890)');
  end if;

  -- Ladoucette Pouilly‑Fumé → Ladoucette Pouilly‑Fumé 2022
  update public."Vinos"
     set nombre = 'Ladoucette Pouilly‑Fumé 2022',
         anada = 2022,
         sin_anada = false
   where id = '6e0f4e55-cb21-4fd0-b112-acd103405948'
     and nombre = 'Ladoucette Pouilly‑Fumé'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '6e0f4e55-cb21-4fd0-b112-acd103405948' and nombre = 'Ladoucette Pouilly‑Fumé 2022'
                  and anada is not distinct from 2022 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '6e0f4e55-cb21-4fd0-b112-acd103405948') then v_saltados := array_append(v_saltados, '6e0f4e55-cb21-4fd0-b112-acd103405948 (Ladoucette Pouilly‑Fumé)');
  end if;

  -- Lagar de Cervera → Lagar de Cervera 2024
  update public."Vinos"
     set nombre = 'Lagar de Cervera 2024',
         anada = 2024,
         sin_anada = false
   where id = '3cc18639-ab51-49b4-93b2-695edde103ed'
     and nombre = 'Lagar de Cervera'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '3cc18639-ab51-49b4-93b2-695edde103ed' and nombre = 'Lagar de Cervera 2024'
                  and anada is not distinct from 2024 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '3cc18639-ab51-49b4-93b2-695edde103ed') then v_saltados := array_append(v_saltados, '3cc18639-ab51-49b4-93b2-695edde103ed (Lagar de Cervera)');
  end if;

  -- Lagar de Cervera (Magnum) → Lagar de Cervera 2024 (Magnum)
  update public."Vinos"
     set nombre = 'Lagar de Cervera 2024 (Magnum)',
         anada = 2024,
         sin_anada = false
   where id = 'dc364646-e73b-4b4f-8a64-c611abb6cef1'
     and nombre = 'Lagar de Cervera (Magnum)'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'dc364646-e73b-4b4f-8a64-c611abb6cef1' and nombre = 'Lagar de Cervera 2024 (Magnum)'
                  and anada is not distinct from 2024 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'dc364646-e73b-4b4f-8a64-c611abb6cef1') then v_saltados := array_append(v_saltados, 'dc364646-e73b-4b4f-8a64-c611abb6cef1 (Lagar de Cervera (Magnum))');
  end if;

  -- Laurent‑Perrier Alexandra Rosé → Laurent‑Perrier Alexandra Rosé 2004
  update public."Vinos"
     set nombre = 'Laurent‑Perrier Alexandra Rosé 2004',
         anada = 2004,
         sin_anada = false
   where id = '4a5bf9d9-d33e-4c58-bc1c-06eff214824f'
     and nombre = 'Laurent‑Perrier Alexandra Rosé'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '4a5bf9d9-d33e-4c58-bc1c-06eff214824f' and nombre = 'Laurent‑Perrier Alexandra Rosé 2004'
                  and anada is not distinct from 2004 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '4a5bf9d9-d33e-4c58-bc1c-06eff214824f') then v_saltados := array_append(v_saltados, '4a5bf9d9-d33e-4c58-bc1c-06eff214824f (Laurent‑Perrier Alexandra Rosé)');
  end if;

  -- Laurent‑Perrier Millésimé → Laurent‑Perrier Millésimé 2015
  update public."Vinos"
     set nombre = 'Laurent‑Perrier Millésimé 2015',
         anada = 2015,
         sin_anada = false
   where id = '30cc8620-1c38-47fe-9204-b2ac7eb8eaa8'
     and nombre = 'Laurent‑Perrier Millésimé'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '30cc8620-1c38-47fe-9204-b2ac7eb8eaa8' and nombre = 'Laurent‑Perrier Millésimé 2015'
                  and anada is not distinct from 2015 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '30cc8620-1c38-47fe-9204-b2ac7eb8eaa8') then v_saltados := array_append(v_saltados, '30cc8620-1c38-47fe-9204-b2ac7eb8eaa8 (Laurent‑Perrier Millésimé)');
  end if;

  -- Louis Latour Chablis La Chanfleure → Louis Latour Chablis La Chanfleure 2024
  update public."Vinos"
     set nombre = 'Louis Latour Chablis La Chanfleure 2024',
         anada = 2024,
         sin_anada = false
   where id = '4d59ef4a-d7b3-45d3-af5a-54f67618f613'
     and nombre = 'Louis Latour Chablis La Chanfleure'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '4d59ef4a-d7b3-45d3-af5a-54f67618f613' and nombre = 'Louis Latour Chablis La Chanfleure 2024'
                  and anada is not distinct from 2024 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '4d59ef4a-d7b3-45d3-af5a-54f67618f613') then v_saltados := array_append(v_saltados, '4d59ef4a-d7b3-45d3-af5a-54f67618f613 (Louis Latour Chablis La Chanfleure)');
  end if;

  -- Marqués de Murrieta Reserva → Marqués de Murrieta Reserva 2021
  update public."Vinos"
     set nombre = 'Marqués de Murrieta Reserva 2021',
         anada = 2021,
         sin_anada = false
   where id = '2564cf67-b7d9-4425-9ef5-cb2d39d5bc60'
     and nombre = 'Marqués de Murrieta Reserva'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '2564cf67-b7d9-4425-9ef5-cb2d39d5bc60' and nombre = 'Marqués de Murrieta Reserva 2021'
                  and anada is not distinct from 2021 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '2564cf67-b7d9-4425-9ef5-cb2d39d5bc60') then v_saltados := array_append(v_saltados, '2564cf67-b7d9-4425-9ef5-cb2d39d5bc60 (Marqués de Murrieta Reserva)');
  end if;

  -- Marqués de Riscal 150 Aniversario → Marqués de Riscal 150 Aniversario 2017
  update public."Vinos"
     set nombre = 'Marqués de Riscal 150 Aniversario 2017',
         anada = 2017,
         sin_anada = false
   where id = '0aeba489-b6d1-4d25-884f-dee60eba581b'
     and nombre = 'Marqués de Riscal 150 Aniversario'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '0aeba489-b6d1-4d25-884f-dee60eba581b' and nombre = 'Marqués de Riscal 150 Aniversario 2017'
                  and anada is not distinct from 2017 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '0aeba489-b6d1-4d25-884f-dee60eba581b') then v_saltados := array_append(v_saltados, '0aeba489-b6d1-4d25-884f-dee60eba581b (Marqués de Riscal 150 Aniversario)');
  end if;

  -- Marqués de Riscal Barón de Chirel → Marqués de Riscal Barón de Chirel 2020
  update public."Vinos"
     set nombre = 'Marqués de Riscal Barón de Chirel 2020',
         anada = 2020,
         sin_anada = false
   where id = '8a70d0ed-39df-4f42-86b7-55c74c84872b'
     and nombre = 'Marqués de Riscal Barón de Chirel'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '8a70d0ed-39df-4f42-86b7-55c74c84872b' and nombre = 'Marqués de Riscal Barón de Chirel 2020'
                  and anada is not distinct from 2020 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '8a70d0ed-39df-4f42-86b7-55c74c84872b') then v_saltados := array_append(v_saltados, '8a70d0ed-39df-4f42-86b7-55c74c84872b (Marqués de Riscal Barón de Chirel)');
  end if;

  -- Martelo → Martelo 2019
  update public."Vinos"
     set nombre = 'Martelo 2019',
         anada = 2019,
         sin_anada = false
   where id = '0bf32fa1-51aa-45af-9882-a11fc391b509'
     and nombre = 'Martelo'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '0bf32fa1-51aa-45af-9882-a11fc391b509' and nombre = 'Martelo 2019'
                  and anada is not distinct from 2019 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '0bf32fa1-51aa-45af-9882-a11fc391b509') then v_saltados := array_append(v_saltados, '0bf32fa1-51aa-45af-9882-a11fc391b509 (Martelo)');
  end if;

  -- Mauro → Mauro 2023
  update public."Vinos"
     set nombre = 'Mauro 2023',
         anada = 2023,
         sin_anada = false
   where id = '2caabdff-987d-4b46-9005-64c8536d8334'
     and nombre = 'Mauro'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '2caabdff-987d-4b46-9005-64c8536d8334' and nombre = 'Mauro 2023'
                  and anada is not distinct from 2023 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '2caabdff-987d-4b46-9005-64c8536d8334') then v_saltados := array_append(v_saltados, '2caabdff-987d-4b46-9005-64c8536d8334 (Mauro)');
  end if;

  -- Moët & Chandon Grand Vintage → Moët & Chandon Grand Vintage 2015
  update public."Vinos"
     set nombre = 'Moët & Chandon Grand Vintage 2015',
         anada = 2015,
         sin_anada = false
   where id = '7bd2fba7-244e-497c-b9f0-311dc36ec973'
     and nombre = 'Moët & Chandon Grand Vintage'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '7bd2fba7-244e-497c-b9f0-311dc36ec973' and nombre = 'Moët & Chandon Grand Vintage 2015'
                  and anada is not distinct from 2015 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '7bd2fba7-244e-497c-b9f0-311dc36ec973') then v_saltados := array_append(v_saltados, '7bd2fba7-244e-497c-b9f0-311dc36ec973 (Moët & Chandon Grand Vintage)');
  end if;

  -- Moët Grand Vintage Rosé → Moët Grand Vintage Rosé 2015
  update public."Vinos"
     set nombre = 'Moët Grand Vintage Rosé 2015',
         anada = 2015,
         sin_anada = false
   where id = '46f035f1-b2ca-4a69-b607-1806a93c6e8b'
     and nombre = 'Moët Grand Vintage Rosé'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '46f035f1-b2ca-4a69-b607-1806a93c6e8b' and nombre = 'Moët Grand Vintage Rosé 2015'
                  and anada is not distinct from 2015 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '46f035f1-b2ca-4a69-b607-1806a93c6e8b') then v_saltados := array_append(v_saltados, '46f035f1-b2ca-4a69-b607-1806a93c6e8b (Moët Grand Vintage Rosé)');
  end if;

  -- Otazu (Chardonnay) → Otazu (Chardonnay) 2024
  update public."Vinos"
     set nombre = 'Otazu (Chardonnay) 2024',
         anada = 2024,
         sin_anada = false
   where id = 'f04c83eb-6f74-4cce-bb74-46b4c2a6155d'
     and nombre = 'Otazu (Chardonnay)'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'f04c83eb-6f74-4cce-bb74-46b4c2a6155d' and nombre = 'Otazu (Chardonnay) 2024'
                  and anada is not distinct from 2024 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'f04c83eb-6f74-4cce-bb74-46b4c2a6155d') then v_saltados := array_append(v_saltados, 'f04c83eb-6f74-4cce-bb74-46b4c2a6155d (Otazu (Chardonnay))');
  end if;

  -- Otazu Altar → Otazu Altar 2013
  update public."Vinos"
     set nombre = 'Otazu Altar 2013',
         anada = 2013,
         sin_anada = false
   where id = 'cb629ad3-5ea7-4498-8511-e38c0ff0b21d'
     and nombre = 'Otazu Altar'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'cb629ad3-5ea7-4498-8511-e38c0ff0b21d' and nombre = 'Otazu Altar 2013'
                  and anada is not distinct from 2013 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'cb629ad3-5ea7-4498-8511-e38c0ff0b21d') then v_saltados := array_append(v_saltados, 'cb629ad3-5ea7-4498-8511-e38c0ff0b21d (Otazu Altar)');
  end if;

  -- Otazu Premium Cuvée → Otazu Premium Cuvée 2021
  update public."Vinos"
     set nombre = 'Otazu Premium Cuvée 2021',
         anada = 2021,
         sin_anada = false
   where id = '9c360d96-9ff9-48dc-b2f8-de5694acb00f'
     and nombre = 'Otazu Premium Cuvée'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '9c360d96-9ff9-48dc-b2f8-de5694acb00f' and nombre = 'Otazu Premium Cuvée 2021'
                  and anada is not distinct from 2021 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '9c360d96-9ff9-48dc-b2f8-de5694acb00f') then v_saltados := array_append(v_saltados, '9c360d96-9ff9-48dc-b2f8-de5694acb00f (Otazu Premium Cuvée)');
  end if;

  -- Otazu Rosado → Otazu Rosado 2024
  update public."Vinos"
     set nombre = 'Otazu Rosado 2024',
         anada = 2024,
         sin_anada = false
   where id = '0e14f46c-85fb-4f93-9890-ca8e7e15e869'
     and nombre = 'Otazu Rosado'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '0e14f46c-85fb-4f93-9890-ca8e7e15e869' and nombre = 'Otazu Rosado 2024'
                  and anada is not distinct from 2024 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '0e14f46c-85fb-4f93-9890-ca8e7e15e869') then v_saltados := array_append(v_saltados, '0e14f46c-85fb-4f93-9890-ca8e7e15e869 (Otazu Rosado)');
  end if;

  -- Ou Steen → Ou Steen 2022
  update public."Vinos"
     set nombre = 'Ou Steen 2022',
         anada = 2022,
         sin_anada = false
   where id = '86850a57-53f5-4b59-b0f6-9e7bdb82a42f'
     and nombre = 'Ou Steen'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '86850a57-53f5-4b59-b0f6-9e7bdb82a42f' and nombre = 'Ou Steen 2022'
                  and anada is not distinct from 2022 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '86850a57-53f5-4b59-b0f6-9e7bdb82a42f') then v_saltados := array_append(v_saltados, '86850a57-53f5-4b59-b0f6-9e7bdb82a42f (Ou Steen)');
  end if;

  -- Pago de Carraovejas → Pago de Carraovejas 2023
  update public."Vinos"
     set nombre = 'Pago de Carraovejas 2023',
         anada = 2023,
         sin_anada = false
   where id = '6064cef2-c768-4c7c-9853-2409ff2b6270'
     and nombre = 'Pago de Carraovejas'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '6064cef2-c768-4c7c-9853-2409ff2b6270' and nombre = 'Pago de Carraovejas 2023'
                  and anada is not distinct from 2023 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '6064cef2-c768-4c7c-9853-2409ff2b6270') then v_saltados := array_append(v_saltados, '6064cef2-c768-4c7c-9853-2409ff2b6270 (Pago de Carraovejas)');
  end if;

  -- Pago de los Capellanes Crianza → Pago de los Capellanes Crianza 2022
  update public."Vinos"
     set nombre = 'Pago de los Capellanes Crianza 2022',
         anada = 2022,
         sin_anada = false
   where id = '3a443d48-c2b1-4d4b-ba0e-01ef3652caa4'
     and nombre = 'Pago de los Capellanes Crianza'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '3a443d48-c2b1-4d4b-ba0e-01ef3652caa4' and nombre = 'Pago de los Capellanes Crianza 2022'
                  and anada is not distinct from 2022 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '3a443d48-c2b1-4d4b-ba0e-01ef3652caa4') then v_saltados := array_append(v_saltados, '3a443d48-c2b1-4d4b-ba0e-01ef3652caa4 (Pago de los Capellanes Crianza)');
  end if;

  -- Pago de los Capellanes Crianza (Magnum) → Pago de los Capellanes Crianza 2022 (Magnum)
  update public."Vinos"
     set nombre = 'Pago de los Capellanes Crianza 2022 (Magnum)',
         anada = 2022,
         sin_anada = false
   where id = 'e895f569-8a83-4f1d-ab48-03f86a4d9c6b'
     and nombre = 'Pago de los Capellanes Crianza (Magnum)'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'e895f569-8a83-4f1d-ab48-03f86a4d9c6b' and nombre = 'Pago de los Capellanes Crianza 2022 (Magnum)'
                  and anada is not distinct from 2022 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'e895f569-8a83-4f1d-ab48-03f86a4d9c6b') then v_saltados := array_append(v_saltados, 'e895f569-8a83-4f1d-ab48-03f86a4d9c6b (Pago de los Capellanes Crianza (Magnum))');
  end if;

  -- Pago Santa Cruz → Pago Santa Cruz 2021
  update public."Vinos"
     set nombre = 'Pago Santa Cruz 2021',
         anada = 2021,
         sin_anada = false
   where id = 'dc67ee11-502b-4b43-8486-ef5ef848af46'
     and nombre = 'Pago Santa Cruz'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'dc67ee11-502b-4b43-8486-ef5ef848af46' and nombre = 'Pago Santa Cruz 2021'
                  and anada is not distinct from 2021 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'dc67ee11-502b-4b43-8486-ef5ef848af46') then v_saltados := array_append(v_saltados, 'dc67ee11-502b-4b43-8486-ef5ef848af46 (Pago Santa Cruz)');
  end if;

  -- Pagos de Anguix → Pagos de Anguix 2018
  update public."Vinos"
     set nombre = 'Pagos de Anguix 2018',
         anada = 2018,
         sin_anada = false
   where id = '050a3e6d-a114-421e-bd09-d6288441653f'
     and nombre = 'Pagos de Anguix'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '050a3e6d-a114-421e-bd09-d6288441653f' and nombre = 'Pagos de Anguix 2018'
                  and anada is not distinct from 2018 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '050a3e6d-a114-421e-bd09-d6288441653f') then v_saltados := array_append(v_saltados, '050a3e6d-a114-421e-bd09-d6288441653f (Pagos de Anguix)');
  end if;

  -- Pazo Barrantes → Pazo Barrantes 2020
  update public."Vinos"
     set nombre = 'Pazo Barrantes 2020',
         anada = 2020,
         sin_anada = false
   where id = '813c4abb-4371-4dad-bc45-9360cf262e59'
     and nombre = 'Pazo Barrantes'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '813c4abb-4371-4dad-bc45-9360cf262e59' and nombre = 'Pazo Barrantes 2020'
                  and anada is not distinct from 2020 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '813c4abb-4371-4dad-bc45-9360cf262e59') then v_saltados := array_append(v_saltados, '813c4abb-4371-4dad-bc45-9360cf262e59 (Pazo Barrantes)');
  end if;

  -- Pícaro del Águila → Pícaro del Águila 2022
  update public."Vinos"
     set nombre = 'Pícaro del Águila 2022',
         anada = 2022,
         sin_anada = false
   where id = '0628c633-b086-40f6-bcb7-125f64081d4b'
     and nombre = 'Pícaro del Águila'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '0628c633-b086-40f6-bcb7-125f64081d4b' and nombre = 'Pícaro del Águila 2022'
                  and anada is not distinct from 2022 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '0628c633-b086-40f6-bcb7-125f64081d4b') then v_saltados := array_append(v_saltados, '0628c633-b086-40f6-bcb7-125f64081d4b (Pícaro del Águila)');
  end if;

  -- Pícaro del Águila (Magnum) → Pícaro del Águila 2022 (Magnum)
  update public."Vinos"
     set nombre = 'Pícaro del Águila 2022 (Magnum)',
         anada = 2022,
         sin_anada = false
   where id = '9848ae25-9051-4a7f-bbfc-1474445f39db'
     and nombre = 'Pícaro del Águila (Magnum)'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '9848ae25-9051-4a7f-bbfc-1474445f39db' and nombre = 'Pícaro del Águila 2022 (Magnum)'
                  and anada is not distinct from 2022 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '9848ae25-9051-4a7f-bbfc-1474445f39db') then v_saltados := array_append(v_saltados, '9848ae25-9051-4a7f-bbfc-1474445f39db (Pícaro del Águila (Magnum))');
  end if;

  -- Pingus → Pingus 2023
  update public."Vinos"
     set nombre = 'Pingus 2023',
         anada = 2023,
         sin_anada = false
   where id = '2e6a2e86-db54-4f26-937c-77f7f0708fac'
     and nombre = 'Pingus'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '2e6a2e86-db54-4f26-937c-77f7f0708fac' and nombre = 'Pingus 2023'
                  and anada is not distinct from 2023 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '2e6a2e86-db54-4f26-937c-77f7f0708fac') then v_saltados := array_append(v_saltados, '2e6a2e86-db54-4f26-937c-77f7f0708fac (Pingus)');
  end if;

  -- Piper‑Heidsieck → Piper‑Heidsieck
  update public."Vinos"
     set nombre = 'Piper‑Heidsieck',
         anada = null,
         sin_anada = true
   where id = '87b17adb-c4bc-4b1a-a5d7-0665e4f118a0'
     and nombre = 'Piper‑Heidsieck'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '87b17adb-c4bc-4b1a-a5d7-0665e4f118a0' and nombre = 'Piper‑Heidsieck'
                  and anada is not distinct from null and sin_anada = true) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '87b17adb-c4bc-4b1a-a5d7-0665e4f118a0') then v_saltados := array_append(v_saltados, '87b17adb-c4bc-4b1a-a5d7-0665e4f118a0 (Piper‑Heidsieck)');
  end if;

  -- PSI → PSI 2023
  update public."Vinos"
     set nombre = 'PSI 2023',
         anada = 2023,
         sin_anada = false
   where id = 'e59baae8-5310-4264-80f0-31bb3f1e7bfb'
     and nombre = 'PSI'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'e59baae8-5310-4264-80f0-31bb3f1e7bfb' and nombre = 'PSI 2023'
                  and anada is not distinct from 2023 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'e59baae8-5310-4264-80f0-31bb3f1e7bfb') then v_saltados := array_append(v_saltados, 'e59baae8-5310-4264-80f0-31bb3f1e7bfb (PSI)');
  end if;

  -- PSI (Magnum) → PSI 2021 (Magnum)
  update public."Vinos"
     set nombre = 'PSI 2021 (Magnum)',
         anada = 2021,
         sin_anada = false
   where id = 'c9903817-6d30-4d69-a96f-0cdc8bbf8495'
     and nombre = 'PSI (Magnum)'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'c9903817-6d30-4d69-a96f-0cdc8bbf8495' and nombre = 'PSI 2021 (Magnum)'
                  and anada is not distinct from 2021 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'c9903817-6d30-4d69-a96f-0cdc8bbf8495') then v_saltados := array_append(v_saltados, 'c9903817-6d30-4d69-a96f-0cdc8bbf8495 (PSI (Magnum))');
  end if;

  -- Riscal XR → Riscal XR 2021
  update public."Vinos"
     set nombre = 'Riscal XR 2021',
         anada = 2021,
         sin_anada = false
   where id = 'ff35c279-bddb-49c5-800a-1b3f47ded052'
     and nombre = 'Riscal XR'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'ff35c279-bddb-49c5-800a-1b3f47ded052' and nombre = 'Riscal XR 2021'
                  and anada is not distinct from 2021 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'ff35c279-bddb-49c5-800a-1b3f47ded052') then v_saltados := array_append(v_saltados, 'ff35c279-bddb-49c5-800a-1b3f47ded052 (Riscal XR)');
  end if;

  -- Ritus → Ritus 2020
  update public."Vinos"
     set nombre = 'Ritus 2020',
         anada = 2020,
         sin_anada = false
   where id = '453220b5-59f9-4f44-b472-dc7d61be506c'
     and nombre = 'Ritus'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '453220b5-59f9-4f44-b472-dc7d61be506c' and nombre = 'Ritus 2020'
                  and anada is not distinct from 2020 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '453220b5-59f9-4f44-b472-dc7d61be506c') then v_saltados := array_append(v_saltados, '453220b5-59f9-4f44-b472-dc7d61be506c (Ritus)');
  end if;

  -- Sierra Cantabria Colección Privada → Sierra Cantabria Colección Privada 2021
  update public."Vinos"
     set nombre = 'Sierra Cantabria Colección Privada 2021',
         anada = 2021,
         sin_anada = false
   where id = '4f2bdba3-9850-4a7d-aa56-fb406a2f3424'
     and nombre = 'Sierra Cantabria Colección Privada'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '4f2bdba3-9850-4a7d-aa56-fb406a2f3424' and nombre = 'Sierra Cantabria Colección Privada 2021'
                  and anada is not distinct from 2021 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '4f2bdba3-9850-4a7d-aa56-fb406a2f3424') then v_saltados := array_append(v_saltados, '4f2bdba3-9850-4a7d-aa56-fb406a2f3424 (Sierra Cantabria Colección Privada)');
  end if;

  -- Terras Gauda → Terras Gauda 2023
  update public."Vinos"
     set nombre = 'Terras Gauda 2023',
         anada = 2023,
         sin_anada = false
   where id = '482ba8da-5974-4fae-8a1a-c15d391d5245'
     and nombre = 'Terras Gauda'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '482ba8da-5974-4fae-8a1a-c15d391d5245' and nombre = 'Terras Gauda 2023'
                  and anada is not distinct from 2023 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '482ba8da-5974-4fae-8a1a-c15d391d5245') then v_saltados := array_append(v_saltados, '482ba8da-5974-4fae-8a1a-c15d391d5245 (Terras Gauda)');
  end if;

  -- Terreus → Terreus 2019
  update public."Vinos"
     set nombre = 'Terreus 2019',
         anada = 2019,
         sin_anada = false
   where id = '8ae1eafd-7999-4180-93dc-362364091af0'
     and nombre = 'Terreus'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '8ae1eafd-7999-4180-93dc-362364091af0' and nombre = 'Terreus 2019'
                  and anada is not distinct from 2019 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '8ae1eafd-7999-4180-93dc-362364091af0') then v_saltados := array_append(v_saltados, '8ae1eafd-7999-4180-93dc-362364091af0 (Terreus)');
  end if;

  -- Tomás Postigo → Tomás Postigo 2022
  update public."Vinos"
     set nombre = 'Tomás Postigo 2022',
         anada = 2022,
         sin_anada = false
   where id = '06bf9660-61b1-48ae-8032-5cbaf982d894'
     and nombre = 'Tomás Postigo'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '06bf9660-61b1-48ae-8032-5cbaf982d894' and nombre = 'Tomás Postigo 2022'
                  and anada is not distinct from 2022 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '06bf9660-61b1-48ae-8032-5cbaf982d894') then v_saltados := array_append(v_saltados, '06bf9660-61b1-48ae-8032-5cbaf982d894 (Tomás Postigo)');
  end if;

  -- Tomás Postigo (Magnum) → Tomás Postigo 2022 (Magnum)
  update public."Vinos"
     set nombre = 'Tomás Postigo 2022 (Magnum)',
         anada = 2022,
         sin_anada = false
   where id = '8cfcfafc-fcef-4ba5-ac7f-f5fcc850c23e'
     and nombre = 'Tomás Postigo (Magnum)'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '8cfcfafc-fcef-4ba5-ac7f-f5fcc850c23e' and nombre = 'Tomás Postigo 2022 (Magnum)'
                  and anada is not distinct from 2022 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '8cfcfafc-fcef-4ba5-ac7f-f5fcc850c23e') then v_saltados := array_append(v_saltados, '8cfcfafc-fcef-4ba5-ac7f-f5fcc850c23e (Tomás Postigo (Magnum))');
  end if;

  -- Tomás Postigo 5º Año → Tomás Postigo 5º Año 2020
  update public."Vinos"
     set nombre = 'Tomás Postigo 5º Año 2020',
         anada = 2020,
         sin_anada = false
   where id = 'de8f93b9-5ad5-4097-8878-3e1357340d5a'
     and nombre = 'Tomás Postigo 5º Año'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'de8f93b9-5ad5-4097-8878-3e1357340d5a' and nombre = 'Tomás Postigo 5º Año 2020'
                  and anada is not distinct from 2020 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'de8f93b9-5ad5-4097-8878-3e1357340d5a') then v_saltados := array_append(v_saltados, 'de8f93b9-5ad5-4097-8878-3e1357340d5a (Tomás Postigo 5º Año)');
  end if;

  -- Viña Arana → Viña Arana 2017
  update public."Vinos"
     set nombre = 'Viña Arana 2017',
         anada = 2017,
         sin_anada = false
   where id = '1afe9a7d-c4c1-4dea-9d52-c6df8cd13f08'
     and nombre = 'Viña Arana'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '1afe9a7d-c4c1-4dea-9d52-c6df8cd13f08' and nombre = 'Viña Arana 2017'
                  and anada is not distinct from 2017 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '1afe9a7d-c4c1-4dea-9d52-c6df8cd13f08') then v_saltados := array_append(v_saltados, '1afe9a7d-c4c1-4dea-9d52-c6df8cd13f08 (Viña Arana)');
  end if;

  -- 200 Monges Reserva → 200 Monges Reserva 2014
  update public."Vinos"
     set nombre = '200 Monges Reserva 2014',
         anada = 2014,
         sin_anada = false
   where id = '55713b26-fb21-40f0-80e6-2cb8884f6311'
     and nombre = '200 Monges Reserva'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '55713b26-fb21-40f0-80e6-2cb8884f6311' and nombre = '200 Monges Reserva 2014'
                  and anada is not distinct from 2014 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '55713b26-fb21-40f0-80e6-2cb8884f6311') then v_saltados := array_append(v_saltados, '55713b26-fb21-40f0-80e6-2cb8884f6311 (200 Monges Reserva)');
  end if;

  -- Abadía Retuerta Le Domaine → Abadía Retuerta Le Domaine 2022
  update public."Vinos"
     set nombre = 'Abadía Retuerta Le Domaine 2022',
         anada = 2022,
         sin_anada = false
   where id = 'ba574335-8727-406a-9180-8afc887f9544'
     and nombre = 'Abadía Retuerta Le Domaine'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'ba574335-8727-406a-9180-8afc887f9544' and nombre = 'Abadía Retuerta Le Domaine 2022'
                  and anada is not distinct from 2022 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'ba574335-8727-406a-9180-8afc887f9544') then v_saltados := array_append(v_saltados, 'ba574335-8727-406a-9180-8afc887f9544 (Abadía Retuerta Le Domaine)');
  end if;

  -- Abadía Retuerta Pago Garduña → Abadía Retuerta Pago Garduña 2019
  update public."Vinos"
     set nombre = 'Abadía Retuerta Pago Garduña 2019',
         anada = 2019,
         sin_anada = false
   where id = '38d76f0d-7757-4f7f-bc84-05de04a3dbbc'
     and nombre = 'Abadía Retuerta Pago Garduña'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '38d76f0d-7757-4f7f-bc84-05de04a3dbbc' and nombre = 'Abadía Retuerta Pago Garduña 2019'
                  and anada is not distinct from 2019 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '38d76f0d-7757-4f7f-bc84-05de04a3dbbc') then v_saltados := array_append(v_saltados, '38d76f0d-7757-4f7f-bc84-05de04a3dbbc (Abadía Retuerta Pago Garduña)');
  end if;

  -- Abadía Retuerta Pago Negralada → Abadía Retuerta Pago Negralada 2018
  update public."Vinos"
     set nombre = 'Abadía Retuerta Pago Negralada 2018',
         anada = 2018,
         sin_anada = false
   where id = '2749a417-cfcf-4195-b747-85ac1c7f2c56'
     and nombre = 'Abadía Retuerta Pago Negralada'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '2749a417-cfcf-4195-b747-85ac1c7f2c56' and nombre = 'Abadía Retuerta Pago Negralada 2018'
                  and anada is not distinct from 2018 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '2749a417-cfcf-4195-b747-85ac1c7f2c56') then v_saltados := array_append(v_saltados, '2749a417-cfcf-4195-b747-85ac1c7f2c56 (Abadía Retuerta Pago Negralada)');
  end if;

  -- Almirez → Almirez 2023
  update public."Vinos"
     set nombre = 'Almirez 2023',
         anada = 2023,
         sin_anada = false
   where id = '219dc294-c7cd-49f4-b2d2-73c5b48697b2'
     and nombre = 'Almirez'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '219dc294-c7cd-49f4-b2d2-73c5b48697b2' and nombre = 'Almirez 2023'
                  and anada is not distinct from 2023 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '219dc294-c7cd-49f4-b2d2-73c5b48697b2') then v_saltados := array_append(v_saltados, '219dc294-c7cd-49f4-b2d2-73c5b48697b2 (Almirez)');
  end if;

  -- Artadi Viñas de Gaín → Artadi Viñas de Gaín 2021
  update public."Vinos"
     set nombre = 'Artadi Viñas de Gaín 2021',
         anada = 2021,
         sin_anada = false
   where id = '7e02d098-2f4b-4674-ab1b-b70b45293d20'
     and nombre = 'Artadi Viñas de Gaín'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '7e02d098-2f4b-4674-ab1b-b70b45293d20' and nombre = 'Artadi Viñas de Gaín 2021'
                  and anada is not distinct from 2021 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '7e02d098-2f4b-4674-ab1b-b70b45293d20') then v_saltados := array_append(v_saltados, '7e02d098-2f4b-4674-ab1b-b70b45293d20 (Artadi Viñas de Gaín)');
  end if;

  -- Belondrade y Lurton → Belondrade y Lurton 2022
  update public."Vinos"
     set nombre = 'Belondrade y Lurton 2022',
         anada = 2022,
         sin_anada = false
   where id = '500e4fef-6610-4f7e-8125-d9e22c4b6045'
     and nombre = 'Belondrade y Lurton'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '500e4fef-6610-4f7e-8125-d9e22c4b6045' and nombre = 'Belondrade y Lurton 2022'
                  and anada is not distinct from 2022 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '500e4fef-6610-4f7e-8125-d9e22c4b6045') then v_saltados := array_append(v_saltados, '500e4fef-6610-4f7e-8125-d9e22c4b6045 (Belondrade y Lurton)');
  end if;

  -- Bollinger Special Cuvée Brut → Bollinger Special Cuvée Brut
  update public."Vinos"
     set nombre = 'Bollinger Special Cuvée Brut',
         anada = null,
         sin_anada = true
   where id = 'a34df870-a464-4be6-92bc-0528a09762a3'
     and nombre = 'Bollinger Special Cuvée Brut'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'a34df870-a464-4be6-92bc-0528a09762a3' and nombre = 'Bollinger Special Cuvée Brut'
                  and anada is not distinct from null and sin_anada = true) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'a34df870-a464-4be6-92bc-0528a09762a3') then v_saltados := array_append(v_saltados, 'a34df870-a464-4be6-92bc-0528a09762a3 (Bollinger Special Cuvée Brut)');
  end if;

  -- Casar de Burbia Hombros Mencía → Casar de Burbia Hombros Mencía 2020
  update public."Vinos"
     set nombre = 'Casar de Burbia Hombros Mencía 2020',
         anada = 2020,
         sin_anada = false
   where id = '63f6d239-6451-4200-aa3b-8f6136bd642f'
     and nombre = 'Casar de Burbia Hombros Mencía'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '63f6d239-6451-4200-aa3b-8f6136bd642f' and nombre = 'Casar de Burbia Hombros Mencía 2020'
                  and anada is not distinct from 2020 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '63f6d239-6451-4200-aa3b-8f6136bd642f') then v_saltados := array_append(v_saltados, '63f6d239-6451-4200-aa3b-8f6136bd642f (Casar de Burbia Hombros Mencía)');
  end if;

  -- Castro do Coto Caíño Blanco → Castro do Coto Caíño Blanco 2024
  update public."Vinos"
     set nombre = 'Castro do Coto Caíño Blanco 2024',
         anada = 2024,
         sin_anada = false
   where id = 'e244f79d-d740-4bc1-a569-550f04d0939d'
     and nombre = 'Castro do Coto Caíño Blanco'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'e244f79d-d740-4bc1-a569-550f04d0939d' and nombre = 'Castro do Coto Caíño Blanco 2024'
                  and anada is not distinct from 2024 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'e244f79d-d740-4bc1-a569-550f04d0939d') then v_saltados := array_append(v_saltados, 'e244f79d-d740-4bc1-a569-550f04d0939d (Castro do Coto Caíño Blanco)');
  end if;

  -- Château Pindefleurs → Château Pindefleurs 2022
  update public."Vinos"
     set nombre = 'Château Pindefleurs 2022',
         anada = 2022,
         sin_anada = false
   where id = '38786511-129f-4b4e-8396-5128d305f80b'
     and nombre = 'Château Pindefleurs'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '38786511-129f-4b4e-8396-5128d305f80b' and nombre = 'Château Pindefleurs 2022'
                  and anada is not distinct from 2022 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '38786511-129f-4b4e-8396-5128d305f80b') then v_saltados := array_append(v_saltados, '38786511-129f-4b4e-8396-5128d305f80b (Château Pindefleurs)');
  end if;

  -- Comando G Las Umbrías → Comando G Las Umbrías 2023
  update public."Vinos"
     set nombre = 'Comando G Las Umbrías 2023',
         anada = 2023,
         sin_anada = false
   where id = '3b0b59b7-ab96-4a4c-b886-22ac061eab79'
     and nombre = 'Comando G Las Umbrías'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '3b0b59b7-ab96-4a4c-b886-22ac061eab79' and nombre = 'Comando G Las Umbrías 2023'
                  and anada is not distinct from 2023 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '3b0b59b7-ab96-4a4c-b886-22ac061eab79') then v_saltados := array_append(v_saltados, '3b0b59b7-ab96-4a4c-b886-22ac061eab79 (Comando G Las Umbrías)');
  end if;

  -- Comando G Rumbo al Norte → Comando G Rumbo al Norte 2022
  update public."Vinos"
     set nombre = 'Comando G Rumbo al Norte 2022',
         anada = 2022,
         sin_anada = false
   where id = 'd18df3cc-6636-4534-af13-2c25740764f2'
     and nombre = 'Comando G Rumbo al Norte'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'd18df3cc-6636-4534-af13-2c25740764f2' and nombre = 'Comando G Rumbo al Norte 2022'
                  and anada is not distinct from 2022 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'd18df3cc-6636-4534-af13-2c25740764f2') then v_saltados := array_append(v_saltados, 'd18df3cc-6636-4534-af13-2c25740764f2 (Comando G Rumbo al Norte)');
  end if;

  -- Contino Reserva → Contino Reserva 2020
  update public."Vinos"
     set nombre = 'Contino Reserva 2020',
         anada = 2020,
         sin_anada = false
   where id = 'bdd5d694-b33c-4299-862f-575b439b4f48'
     and nombre = 'Contino Reserva'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'bdd5d694-b33c-4299-862f-575b439b4f48' and nombre = 'Contino Reserva 2020'
                  and anada is not distinct from 2020 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'bdd5d694-b33c-4299-862f-575b439b4f48') then v_saltados := array_append(v_saltados, 'bdd5d694-b33c-4299-862f-575b439b4f48 (Contino Reserva)');
  end if;

  -- Corullón → Corullón 2023
  update public."Vinos"
     set nombre = 'Corullón 2023',
         anada = 2023,
         sin_anada = false
   where id = '6a288d00-087a-428e-96ec-af801ba1fcb3'
     and nombre = 'Corullón'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '6a288d00-087a-428e-96ec-af801ba1fcb3' and nombre = 'Corullón 2023'
                  and anada is not distinct from 2023 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '6a288d00-087a-428e-96ec-af801ba1fcb3') then v_saltados := array_append(v_saltados, '6a288d00-087a-428e-96ec-af801ba1fcb3 (Corullón)');
  end if;

  -- Domaine Combe Queyzaire Côtes du Rhône → Domaine Combe Queyzaire Côtes du Rhône 2019
  update public."Vinos"
     set nombre = 'Domaine Combe Queyzaire Côtes du Rhône 2019',
         anada = 2019,
         sin_anada = false
   where id = '320ea437-fe35-41e4-92d2-6cdfc35c0dc8'
     and nombre = 'Domaine Combe Queyzaire Côtes du Rhône'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '320ea437-fe35-41e4-92d2-6cdfc35c0dc8' and nombre = 'Domaine Combe Queyzaire Côtes du Rhône 2019'
                  and anada is not distinct from 2019 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '320ea437-fe35-41e4-92d2-6cdfc35c0dc8') then v_saltados := array_append(v_saltados, '320ea437-fe35-41e4-92d2-6cdfc35c0dc8 (Domaine Combe Queyzaire Côtes du Rhône)');
  end if;

  -- Dominio de Calogía Cuvée S → Dominio de Calogía Cuvée S 2020
  update public."Vinos"
     set nombre = 'Dominio de Calogía Cuvée S 2020',
         anada = 2020,
         sin_anada = false
   where id = 'c46d83de-a368-4378-877d-58606d1a8219'
     and nombre = 'Dominio de Calogía Cuvée S'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'c46d83de-a368-4378-877d-58606d1a8219' and nombre = 'Dominio de Calogía Cuvée S 2020'
                  and anada is not distinct from 2020 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'c46d83de-a368-4378-877d-58606d1a8219') then v_saltados := array_append(v_saltados, 'c46d83de-a368-4378-877d-58606d1a8219 (Dominio de Calogía Cuvée S)');
  end if;

  -- El Confidente Godello → El Confidente Godello 2024
  update public."Vinos"
     set nombre = 'El Confidente Godello 2024',
         anada = 2024,
         sin_anada = false
   where id = '7c4d6a37-e6f4-45ca-9b19-6426b4a3d1ec'
     and nombre = 'El Confidente Godello'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '7c4d6a37-e6f4-45ca-9b19-6426b4a3d1ec' and nombre = 'El Confidente Godello 2024'
                  and anada is not distinct from 2024 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '7c4d6a37-e6f4-45ca-9b19-6426b4a3d1ec') then v_saltados := array_append(v_saltados, '7c4d6a37-e6f4-45ca-9b19-6426b4a3d1ec (El Confidente Godello)');
  end if;

  -- El Puntido → El Puntido 2022
  update public."Vinos"
     set nombre = 'El Puntido 2022',
         anada = 2022,
         sin_anada = false
   where id = 'f92a9727-9d2e-41da-9466-dd9bd9044a2a'
     and nombre = 'El Puntido'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'f92a9727-9d2e-41da-9466-dd9bd9044a2a' and nombre = 'El Puntido 2022'
                  and anada is not distinct from 2022 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'f92a9727-9d2e-41da-9466-dd9bd9044a2a') then v_saltados := array_append(v_saltados, 'f92a9727-9d2e-41da-9466-dd9bd9044a2a (El Puntido)');
  end if;

  -- Fenomenal Verdejo → Fenomenal Verdejo 2024
  update public."Vinos"
     set nombre = 'Fenomenal Verdejo 2024',
         anada = 2024,
         sin_anada = false
   where id = '7c15a773-d357-401f-b5dd-8587cc6fe18c'
     and nombre = 'Fenomenal Verdejo'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '7c15a773-d357-401f-b5dd-8587cc6fe18c' and nombre = 'Fenomenal Verdejo 2024'
                  and anada is not distinct from 2024 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '7c15a773-d357-401f-b5dd-8587cc6fe18c') then v_saltados := array_append(v_saltados, '7c15a773-d357-401f-b5dd-8587cc6fe18c (Fenomenal Verdejo)');
  end if;

  -- Gramona Brut Imperial Gran Reserva → Gramona Brut Imperial Gran Reserva 2019
  update public."Vinos"
     set nombre = 'Gramona Brut Imperial Gran Reserva 2019',
         anada = 2019,
         sin_anada = false
   where id = '53d74758-da94-4d8d-84cb-35bbceee8204'
     and nombre = 'Gramona Brut Imperial Gran Reserva'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '53d74758-da94-4d8d-84cb-35bbceee8204' and nombre = 'Gramona Brut Imperial Gran Reserva 2019'
                  and anada is not distinct from 2019 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '53d74758-da94-4d8d-84cb-35bbceee8204') then v_saltados := array_append(v_saltados, '53d74758-da94-4d8d-84cb-35bbceee8204 (Gramona Brut Imperial Gran Reserva)');
  end if;

  -- Gramona Tres Lustros Gran Reserva → Gramona Tres Lustros Gran Reserva 2017
  update public."Vinos"
     set nombre = 'Gramona Tres Lustros Gran Reserva 2017',
         anada = 2017,
         sin_anada = false
   where id = '4ecd5d61-cdae-4473-88d1-57127e8296b6'
     and nombre = 'Gramona Tres Lustros Gran Reserva'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '4ecd5d61-cdae-4473-88d1-57127e8296b6' and nombre = 'Gramona Tres Lustros Gran Reserva 2017'
                  and anada is not distinct from 2017 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '4ecd5d61-cdae-4473-88d1-57127e8296b6') then v_saltados := array_append(v_saltados, '4ecd5d61-cdae-4473-88d1-57127e8296b6 (Gramona Tres Lustros Gran Reserva)');
  end if;

  -- José Pariente Sauvignon Blanc (Magnum) → José Pariente Sauvignon Blanc 2022 (Magnum)
  update public."Vinos"
     set nombre = 'José Pariente Sauvignon Blanc 2022 (Magnum)',
         anada = 2022,
         sin_anada = false
   where id = '99ce9d00-fca8-4dba-ab27-9d8426520b38'
     and nombre = 'José Pariente Sauvignon Blanc (Magnum)'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '99ce9d00-fca8-4dba-ab27-9d8426520b38' and nombre = 'José Pariente Sauvignon Blanc 2022 (Magnum)'
                  and anada is not distinct from 2022 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '99ce9d00-fca8-4dba-ab27-9d8426520b38') then v_saltados := array_append(v_saltados, '99ce9d00-fca8-4dba-ab27-9d8426520b38 (José Pariente Sauvignon Blanc (Magnum))');
  end if;

  -- Juvé & Camps Gran Juvé → Juvé & Camps Gran Juvé 2017
  update public."Vinos"
     set nombre = 'Juvé & Camps Gran Juvé 2017',
         anada = 2017,
         sin_anada = false
   where id = '42b93d88-db5f-4b73-afd4-d21a0fb1938d'
     and nombre = 'Juvé & Camps Gran Juvé'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '42b93d88-db5f-4b73-afd4-d21a0fb1938d' and nombre = 'Juvé & Camps Gran Juvé 2017'
                  and anada is not distinct from 2017 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '42b93d88-db5f-4b73-afd4-d21a0fb1938d') then v_saltados := array_append(v_saltados, '42b93d88-db5f-4b73-afd4-d21a0fb1938d (Juvé & Camps Gran Juvé)');
  end if;

  -- La Cueva del Contador → La Cueva del Contador 2019
  update public."Vinos"
     set nombre = 'La Cueva del Contador 2019',
         anada = 2019,
         sin_anada = false
   where id = '696ca439-8bba-4e8a-9de5-f1a4e6dc5f8f'
     and nombre = 'La Cueva del Contador'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '696ca439-8bba-4e8a-9de5-f1a4e6dc5f8f' and nombre = 'La Cueva del Contador 2019'
                  and anada is not distinct from 2019 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '696ca439-8bba-4e8a-9de5-f1a4e6dc5f8f') then v_saltados := array_append(v_saltados, '696ca439-8bba-4e8a-9de5-f1a4e6dc5f8f (La Cueva del Contador)');
  end if;

  -- La Rioja Alta Gran Reserva 890 (Magnum) → La Rioja Alta Gran Reserva 890 2010 (Magnum)
  update public."Vinos"
     set nombre = 'La Rioja Alta Gran Reserva 890 2010 (Magnum)',
         anada = 2010,
         sin_anada = false
   where id = '8b7e528f-7d6b-413b-9100-8671ae590d05'
     and nombre = 'La Rioja Alta Gran Reserva 890 (Magnum)'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '8b7e528f-7d6b-413b-9100-8671ae590d05' and nombre = 'La Rioja Alta Gran Reserva 890 2010 (Magnum)'
                  and anada is not distinct from 2010 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '8b7e528f-7d6b-413b-9100-8671ae590d05') then v_saltados := array_append(v_saltados, '8b7e528f-7d6b-413b-9100-8671ae590d05 (La Rioja Alta Gran Reserva 890 (Magnum))');
  end if;

  -- Laurent-Perrier Blanc de Blancs Brut Nature → Laurent-Perrier Blanc de Blancs Brut Nature
  update public."Vinos"
     set nombre = 'Laurent-Perrier Blanc de Blancs Brut Nature',
         anada = null,
         sin_anada = true
   where id = '3393f537-9c82-432a-a423-6115b5eed70e'
     and nombre = 'Laurent-Perrier Blanc de Blancs Brut Nature'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '3393f537-9c82-432a-a423-6115b5eed70e' and nombre = 'Laurent-Perrier Blanc de Blancs Brut Nature'
                  and anada is not distinct from null and sin_anada = true) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '3393f537-9c82-432a-a423-6115b5eed70e') then v_saltados := array_append(v_saltados, '3393f537-9c82-432a-a423-6115b5eed70e (Laurent-Perrier Blanc de Blancs Brut Nature)');
  end if;

  -- Laurent-Perrier Héritage Brut → Laurent-Perrier Héritage Brut
  update public."Vinos"
     set nombre = 'Laurent-Perrier Héritage Brut',
         anada = null,
         sin_anada = true
   where id = '0e213a1d-d5d3-4821-b02d-fd106eab7ba8'
     and nombre = 'Laurent-Perrier Héritage Brut'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '0e213a1d-d5d3-4821-b02d-fd106eab7ba8' and nombre = 'Laurent-Perrier Héritage Brut'
                  and anada is not distinct from null and sin_anada = true) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '0e213a1d-d5d3-4821-b02d-fd106eab7ba8') then v_saltados := array_append(v_saltados, '0e213a1d-d5d3-4821-b02d-fd106eab7ba8 (Laurent-Perrier Héritage Brut)');
  end if;

  -- Marqués de Murrieta Reserva (Magnum) → Marqués de Murrieta Reserva 2020 (Magnum)
  update public."Vinos"
     set nombre = 'Marqués de Murrieta Reserva 2020 (Magnum)',
         anada = 2020,
         sin_anada = false
   where id = '27f941e0-9a95-492d-b939-12f2d7abdcb4'
     and nombre = 'Marqués de Murrieta Reserva (Magnum)'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '27f941e0-9a95-492d-b939-12f2d7abdcb4' and nombre = 'Marqués de Murrieta Reserva 2020 (Magnum)'
                  and anada is not distinct from 2020 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '27f941e0-9a95-492d-b939-12f2d7abdcb4') then v_saltados := array_append(v_saltados, '27f941e0-9a95-492d-b939-12f2d7abdcb4 (Marqués de Murrieta Reserva (Magnum))');
  end if;

  -- Marqués de Vargas Reserva → Marqués de Vargas Reserva 2017
  update public."Vinos"
     set nombre = 'Marqués de Vargas Reserva 2017',
         anada = 2017,
         sin_anada = false
   where id = '1c5569cd-f889-42b9-905c-0c7d80d6c5a3'
     and nombre = 'Marqués de Vargas Reserva'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '1c5569cd-f889-42b9-905c-0c7d80d6c5a3' and nombre = 'Marqués de Vargas Reserva 2017'
                  and anada is not distinct from 2017 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '1c5569cd-f889-42b9-905c-0c7d80d6c5a3') then v_saltados := array_append(v_saltados, '1c5569cd-f889-42b9-905c-0c7d80d6c5a3 (Marqués de Vargas Reserva)');
  end if;

  -- Oremus Mandolás Furmint → Oremus Mandolás Furmint 2022
  update public."Vinos"
     set nombre = 'Oremus Mandolás Furmint 2022',
         anada = 2022,
         sin_anada = false
   where id = '621d142c-5ee2-48d9-97fe-52107a644727'
     and nombre = 'Oremus Mandolás Furmint'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '621d142c-5ee2-48d9-97fe-52107a644727' and nombre = 'Oremus Mandolás Furmint 2022'
                  and anada is not distinct from 2022 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '621d142c-5ee2-48d9-97fe-52107a644727') then v_saltados := array_append(v_saltados, '621d142c-5ee2-48d9-97fe-52107a644727 (Oremus Mandolás Furmint)');
  end if;

  -- Pago de Otazu Chardonnay → Pago de Otazu Chardonnay 2020
  update public."Vinos"
     set nombre = 'Pago de Otazu Chardonnay 2020',
         anada = 2020,
         sin_anada = false
   where id = 'af54c80e-f17e-4050-ab03-205cdccd8aed'
     and nombre = 'Pago de Otazu Chardonnay'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'af54c80e-f17e-4050-ab03-205cdccd8aed' and nombre = 'Pago de Otazu Chardonnay 2020'
                  and anada is not distinct from 2020 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'af54c80e-f17e-4050-ab03-205cdccd8aed') then v_saltados := array_append(v_saltados, 'af54c80e-f17e-4050-ab03-205cdccd8aed (Pago de Otazu Chardonnay)');
  end if;

  -- Pandora Verdejo → Pandora Verdejo 2023
  update public."Vinos"
     set nombre = 'Pandora Verdejo 2023',
         anada = 2023,
         sin_anada = false
   where id = '8b8e631d-dd87-499a-a5b2-928d3fef0469'
     and nombre = 'Pandora Verdejo'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '8b8e631d-dd87-499a-a5b2-928d3fef0469' and nombre = 'Pandora Verdejo 2023'
                  and anada is not distinct from 2023 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '8b8e631d-dd87-499a-a5b2-928d3fef0469') then v_saltados := array_append(v_saltados, '8b8e631d-dd87-499a-a5b2-928d3fef0469 (Pandora Verdejo)');
  end if;

  -- Petra de Valpiedra Garnacha → Petra de Valpiedra Garnacha 2017
  update public."Vinos"
     set nombre = 'Petra de Valpiedra Garnacha 2017',
         anada = 2017,
         sin_anada = false
   where id = '88d2f1ab-f25f-4088-957d-413e197643f3'
     and nombre = 'Petra de Valpiedra Garnacha'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '88d2f1ab-f25f-4088-957d-413e197643f3' and nombre = 'Petra de Valpiedra Garnacha 2017'
                  and anada is not distinct from 2017 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '88d2f1ab-f25f-4088-957d-413e197643f3') then v_saltados := array_append(v_saltados, '88d2f1ab-f25f-4088-957d-413e197643f3 (Petra de Valpiedra Garnacha)');
  end if;

  -- Pintia → Pintia 2019
  update public."Vinos"
     set nombre = 'Pintia 2019',
         anada = 2019,
         sin_anada = false
   where id = 'd6f6124a-e6e9-4824-9e25-b5d42ca334ba'
     and nombre = 'Pintia'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'd6f6124a-e6e9-4824-9e25-b5d42ca334ba' and nombre = 'Pintia 2019'
                  and anada is not distinct from 2019 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'd6f6124a-e6e9-4824-9e25-b5d42ca334ba') then v_saltados := array_append(v_saltados, 'd6f6124a-e6e9-4824-9e25-b5d42ca334ba (Pintia)');
  end if;

  -- Qué Bonito Cacareaba → Qué Bonito Cacareaba 2021
  update public."Vinos"
     set nombre = 'Qué Bonito Cacareaba 2021',
         anada = 2021,
         sin_anada = false
   where id = '0f8279dc-0f3e-4c68-9309-0cd029c39241'
     and nombre = 'Qué Bonito Cacareaba'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '0f8279dc-0f3e-4c68-9309-0cd029c39241' and nombre = 'Qué Bonito Cacareaba 2021'
                  and anada is not distinct from 2021 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '0f8279dc-0f3e-4c68-9309-0cd029c39241') then v_saltados := array_append(v_saltados, '0f8279dc-0f3e-4c68-9309-0cd029c39241 (Qué Bonito Cacareaba)');
  end if;

  -- Riscal XR (Magnum) → Riscal XR 2019 (Magnum)
  update public."Vinos"
     set nombre = 'Riscal XR 2019 (Magnum)',
         anada = 2019,
         sin_anada = false
   where id = 'bbb74810-0849-459c-8ed8-4406caa78773'
     and nombre = 'Riscal XR (Magnum)'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'bbb74810-0849-459c-8ed8-4406caa78773' and nombre = 'Riscal XR 2019 (Magnum)'
                  and anada is not distinct from 2019 and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'bbb74810-0849-459c-8ed8-4406caa78773') then v_saltados := array_append(v_saltados, 'bbb74810-0849-459c-8ed8-4406caa78773 (Riscal XR (Magnum))');
  end if;

  -- Veuve Clicquot Brut (Carte Jaune) → Veuve Clicquot Brut (Carte Jaune)
  update public."Vinos"
     set nombre = 'Veuve Clicquot Brut (Carte Jaune)',
         anada = null,
         sin_anada = true
   where id = '4e63cd1b-1a57-4187-9a4c-ac43810f88b9'
     and nombre = 'Veuve Clicquot Brut (Carte Jaune)'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '4e63cd1b-1a57-4187-9a4c-ac43810f88b9' and nombre = 'Veuve Clicquot Brut (Carte Jaune)'
                  and anada is not distinct from null and sin_anada = true) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '4e63cd1b-1a57-4187-9a4c-ac43810f88b9') then v_saltados := array_append(v_saltados, '4e63cd1b-1a57-4187-9a4c-ac43810f88b9 (Veuve Clicquot Brut (Carte Jaune))');
  end if;

  -- Viña Corrales Fino → Viña Corrales Fino
  update public."Vinos"
     set nombre = 'Viña Corrales Fino',
         anada = null,
         sin_anada = true
   where id = 'b2f2f856-7458-4fe0-9468-b7a21a35559b'
     and nombre = 'Viña Corrales Fino'
     and anada is not distinct from null
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'b2f2f856-7458-4fe0-9468-b7a21a35559b' and nombre = 'Viña Corrales Fino'
                  and anada is not distinct from null and sin_anada = true) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'b2f2f856-7458-4fe0-9468-b7a21a35559b') then v_saltados := array_append(v_saltados, 'b2f2f856-7458-4fe0-9468-b7a21a35559b (Viña Corrales Fino)');
  end if;

  -- ─── 2. Puntuaciones Parker ───
  -- 912 de Altitud 2023 2023: nueva (revision 93+)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '56b33d30-e029-4208-b06d-2c5b47762240', 2023, false, 'revision', null, '93+', 93, 93, false, '912 de Altitud 9 Months 2023 (Bodegas Veganzones)', 'Robert Parker Wine Advocate', 'The Wine Advocate (crítico no visto)', null, 'Vino Vintana (tienda suiza, fragmento Firecrawl)', 'https://www.vinovintana.ch/912-de-Altitud-9-Months-2023-0.75l/9208', 'secundaria', 'Auszeichnungen94 Punkte James Suckling93+ Punkte Robert Parker / Wine ...', '2026-11-10'::date, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Una sola fuente secundaria vista en fragmento. Veganzones tiene varias cuvées ''912 de Altitud'' (9 Meses en Barrica, Tierra Caliza Crianza, Tierra Arcillosa...): confirmar en la foto que la botella es la de 9 meses. Solo visto en fragmento/resumen del buscador; no se pudo abrir la página (Firecrawl sin créditos y la red de la sesión bloquea las tiendas).', 'revision'
   where exists (select 1 from public."Vinos" where id = '56b33d30-e029-4208-b06d-2c5b47762240')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Artadi Valdeginés 2022 2022: revision 94 → verificada 94
  update public.vinos_puntuacion_parker p
     set estado = 'verificada',
         motivo = null,
         puntos_texto = '94',
         puntos_min = 94,
         puntos_max = 94,
         provisional = false,
         vino_evaluado = '2022 Valdeginés (Artadi)',
         entidad = 'Robert Parker Wine Advocate',
         critico = 'Luis Gutiérrez',
         fecha_valoracion = null,
         fuente_nombre = 'Grand Cru Wijnen',
         fuente_url = 'https://www.grandcruwijnen.nl/en/2022-artadi-valdegines',
         fuente_tipo = 'secundaria',
         cita = 'The Wine Advocate RP 94 Reviewed by: Luis Gutiérrez ... Drink Date: 2025 - 2035. The 2022 Valdeginés comes from a warm and dry year...',
         fecha_consulta = '2026-11-10'::date,
         discrepancias = '[{"fuente_nombre":"Otras tiendas (resumen de WebSearch: Bodeboca/Vinissimus)","fuente_url":"https://www.bodeboca.com/vino/artadi-valdegines-2022","puntos_texto":"93-94","nota":"Probablemente la nota provisional de barrica (muestra sin embotellar); la definitiva embotellada es 94."}]'::jsonb,
         notas = 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Página abierta (scrape): nota de cata completa de Luis Gutiérrez con RP 94. Confirma la fila actual (94); la discrepancia previa se explica por el intervalo de barrica 93-94.',
         origen = 'revision'
   where p.vino_id = '4763a3d1-6e66-4dc5-9101-649690958baf' and p.clave_anada = 2022 and p.estado = 'revision' and p.puntos_texto is not distinct from '94' and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;
  if n = 0 and not exists (select 1 from public.vinos_puntuacion_parker p
                            where p.vino_id = '4763a3d1-6e66-4dc5-9101-649690958baf' and p.clave_anada = 2022) then
    insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
    select '4763a3d1-6e66-4dc5-9101-649690958baf', 2022, false, 'verificada', null, '94', 94, 94, false, '2022 Valdeginés (Artadi)', 'Robert Parker Wine Advocate', 'Luis Gutiérrez', null, 'Grand Cru Wijnen', 'https://www.grandcruwijnen.nl/en/2022-artadi-valdegines', 'secundaria', 'The Wine Advocate RP 94 Reviewed by: Luis Gutiérrez ... Drink Date: 2025 - 2035. The 2022 Valdeginés comes from a warm and dry year...', '2026-11-10'::date, '[{"fuente_nombre":"Otras tiendas (resumen de WebSearch: Bodeboca/Vinissimus)","fuente_url":"https://www.bodeboca.com/vino/artadi-valdegines-2022","puntos_texto":"93-94","nota":"Probablemente la nota provisional de barrica (muestra sin embotellar); la definitiva embotellada es 94."}]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Página abierta (scrape): nota de cata completa de Luis Gutiérrez con RP 94. Confirma la fila actual (94); la discrepancia previa se explica por el intervalo de barrica 93-94.', 'revision'
     where exists (select 1 from public."Vinos" where id = '4763a3d1-6e66-4dc5-9101-649690958baf')
    on conflict (vino_id, clave_anada) do nothing;
    get diagnostics n = row_count;
    v_parker := v_parker + n;
  elsif n = 0 and not exists (select 1 from public.vinos_puntuacion_parker p
                               where p.vino_id = '4763a3d1-6e66-4dc5-9101-649690958baf' and p.clave_anada = 2022 and p.estado = 'verificada' and p.puntos_texto is not distinct from '94' and p.provisional = false)
        and exists (select 1 from public."Vinos" where id = '4763a3d1-6e66-4dc5-9101-649690958baf') then
    v_saltados := array_append(v_saltados, 'Parker 4763a3d1-6e66-4dc5-9101-649690958baf 2022 (Artadi Valdeginés 2022)');
  end if;

  -- Áster El Otero 2018 2018: nueva (revision 95)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '93aa5d5f-97de-494a-9266-4bcf9bc07b74', 2018, false, 'revision', null, '95', 95, 95, false, 'Bodegas Aster Finca El Otero 2018', 'Robert Parker Wine Advocate', 'The Wine Advocate (crítico no visto)', null, 'Timeless Wines (fragmento Firecrawl)', 'https://www.timelesswines.com/bodegas-aster-finca-el-otero-2018/', 'secundaria', 'This is a production of 67,740 bottles. -Robert Parker The Wine Advocate 95 Points', '2026-11-10'::date, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Una sola fuente vista en fragmento; la página no se pudo abrir (fuente inaccesible). Solo visto en fragmento/resumen del buscador; no se pudo abrir la página (Firecrawl sin créditos y la red de la sesión bloquea las tiendas).', 'revision'
   where exists (select 1 from public."Vinos" where id = '93aa5d5f-97de-494a-9266-4bcf9bc07b74')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Balbás Ancestral 2020 2020: nueva (no_localizada —)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '53671e64-4ef1-4264-875d-e66b106018c4', 2020, false, 'no_localizada', 'no_localizada', null, null, null, false, null, 'Robert Parker Wine Advocate', null, null, null, null, null, null, null, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. No aparece nota RP/WA para Balbás Ancestral 2020 en búsquedas (WebSearch y Firecrawl). No confundir con Clos Ancestral de Torres ni Balbás Ritus.', 'revision'
   where exists (select 1 from public."Vinos" where id = '53671e64-4ef1-4264-875d-e66b106018c4')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Carraovejas El Anejón 2018 2018: nueva (verificada 93)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select 'bf7a0cc1-9eaa-46b5-8c32-4fa4bca55cf1', 2018, false, 'verificada', null, '93', 93, 93, false, '2018 El Anejón (Pago de Carraovejas)', 'Robert Parker Wine Advocate', 'Robert Parker''s Wine Advocate (Luis Gutiérrez, según contexto; no visto en la página)', '2023-01', 'Wine.com', 'https://www.wine.com/product/pago-de-carraovejas-el-anejon-2018/1308340', 'secundaria', '93 Robert Parker''s Wine Advocate The 2018 El Anejón is a blend of 81% Tinto Fino, 12% Merlot and 7% Cabernet Sauvignon from a very steep slope', '2026-11-10'::date, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Página abierta (scrape). La fecha 2023-01 sale del importador Kysela (''Robert Parker''s The Wine Advocate (January 31st 2023), 93 pts''), visto solo en fragmento; Ideavinos también lista 93 para 2018. El 94 corresponde a la añada 2016.', 'revision'
   where exists (select 1 from public."Vinos" where id = 'bf7a0cc1-9eaa-46b5-8c32-4fa4bca55cf1')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Dom Pérignon Vintage 2013 2013: revision 95+ → revision 95
  update public.vinos_puntuacion_parker p
     set estado = 'revision',
         motivo = 'fuentes_contradictorias',
         puntos_texto = '95',
         puntos_min = 95,
         puntos_max = 95,
         provisional = false,
         vino_evaluado = 'Dom Pérignon 2013',
         entidad = 'Robert Parker Wine Advocate',
         critico = 'William Kelley',
         fecha_valoracion = '2022-08',
         fuente_nombre = 'Farr Vintners / Berry Bros. & Rudd / Vinofino (resumen de WebSearch)',
         fuente_url = 'https://www.farrvintners.com/wine.php?wine=87999',
         fuente_tipo = 'secundaria',
         cita = 'William Kelley, Wine Advocate, August 2022',
         fecha_consulta = '2026-11-10'::date,
         discrepancias = '[{"fuente_nombre":"The Liquor Barn (resumen de WebSearch)","fuente_url":"https://theliquorbarn.com/collections/sparkling-wines/products/dom-perignon-brut-vintage-2013","puntos_texto":"95+","nota":"Única fuente con 95+; coincide con la fila actual. Las demás dan 95."},{"fuente_nombre":"Berry Bros. & Rudd","fuente_url":"https://www.bbr.com/products-20138000200-","puntos_texto":"95","nota":"Fecha mayo 2022 (otras dicen agosto 2022 o abril 2023)."}]'::jsonb,
         notas = 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. La fila actual (95+) es dudosa: la mayoría de fuentes da 95 de William Kelley. Fechas inconsistentes entre tiendas. Solo visto en fragmento/resumen del buscador; no se pudo abrir la página (Firecrawl sin créditos y la red de la sesión bloquea las tiendas).',
         origen = 'revision'
   where p.vino_id = '246cd25d-cf75-4eca-b2cb-72d5b5f6fb06' and p.clave_anada = 2013 and p.estado = 'revision' and p.puntos_texto is not distinct from '95+' and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;
  if n = 0 and not exists (select 1 from public.vinos_puntuacion_parker p
                            where p.vino_id = '246cd25d-cf75-4eca-b2cb-72d5b5f6fb06' and p.clave_anada = 2013) then
    insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
    select '246cd25d-cf75-4eca-b2cb-72d5b5f6fb06', 2013, false, 'revision', 'fuentes_contradictorias', '95', 95, 95, false, 'Dom Pérignon 2013', 'Robert Parker Wine Advocate', 'William Kelley', '2022-08', 'Farr Vintners / Berry Bros. & Rudd / Vinofino (resumen de WebSearch)', 'https://www.farrvintners.com/wine.php?wine=87999', 'secundaria', 'William Kelley, Wine Advocate, August 2022', '2026-11-10'::date, '[{"fuente_nombre":"The Liquor Barn (resumen de WebSearch)","fuente_url":"https://theliquorbarn.com/collections/sparkling-wines/products/dom-perignon-brut-vintage-2013","puntos_texto":"95+","nota":"Única fuente con 95+; coincide con la fila actual. Las demás dan 95."},{"fuente_nombre":"Berry Bros. & Rudd","fuente_url":"https://www.bbr.com/products-20138000200-","puntos_texto":"95","nota":"Fecha mayo 2022 (otras dicen agosto 2022 o abril 2023)."}]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. La fila actual (95+) es dudosa: la mayoría de fuentes da 95 de William Kelley. Fechas inconsistentes entre tiendas. Solo visto en fragmento/resumen del buscador; no se pudo abrir la página (Firecrawl sin créditos y la red de la sesión bloquea las tiendas).', 'revision'
     where exists (select 1 from public."Vinos" where id = '246cd25d-cf75-4eca-b2cb-72d5b5f6fb06')
    on conflict (vino_id, clave_anada) do nothing;
    get diagnostics n = row_count;
    v_parker := v_parker + n;
  elsif n = 0 and not exists (select 1 from public.vinos_puntuacion_parker p
                               where p.vino_id = '246cd25d-cf75-4eca-b2cb-72d5b5f6fb06' and p.clave_anada = 2013 and p.estado = 'revision' and p.puntos_texto is not distinct from '95' and p.provisional = false)
        and exists (select 1 from public."Vinos" where id = '246cd25d-cf75-4eca-b2cb-72d5b5f6fb06') then
    v_saltados := array_append(v_saltados, 'Parker 246cd25d-cf75-4eca-b2cb-72d5b5f6fb06 2013 (Dom Pérignon Vintage 2013)');
  end if;

  -- Dominio del Águila Reserva 2020 2020: nueva (revision 97)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select 'a62be9fe-cea2-49d1-9dcf-b0a988510afd', 2020, false, 'revision', null, '97', 97, 97, false, '2020 Dominio del Águila Reserva', 'Robert Parker Wine Advocate', 'Luis Gutiérrez', '2024-06', 'Varias tiendas (Zachys, Gourmet Hunters, IPO Wines… resumen de WebSearch)', 'https://www.ipowines.com/wine/2020-dominio-del-aguila-ribera-del-duero-reserva', 'secundaria', 'Luis Gutiérrez ... 97 points ... June 2024, drinking window 2025-2036 (resumen)', '2026-11-10'::date, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Fuentes coherentes (97) pero no se pudo abrir ninguna página. Solo visto en fragmento/resumen del buscador; no se pudo abrir la página (Firecrawl sin créditos y la red de la sesión bloquea las tiendas).', 'revision'
   where exists (select 1 from public."Vinos" where id = 'a62be9fe-cea2-49d1-9dcf-b0a988510afd')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- El Nido 2023 2023: nueva (revision 93)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '71df1c08-defa-415c-861f-9daa4fb54762', 2023, false, 'revision', 'fuentes_contradictorias', '93', 93, 93, false, '2023 Bodegas El Nido Nido', 'Robert Parker Wine Advocate', 'The Wine Advocate (crítico no visto)', null, 'Grand Cru Wijnen / Gourmet Hunters (resumen de WebSearch)', 'https://www.grandcruwijnen.nl/en/2023-bodegas-el-nido-nido', 'secundaria', 'Parker Points: 93 (resumen)', '2026-11-10'::date, '[{"fuente_nombre":"Tienda española (resumen de WebSearch, posiblemente Bodeboca/Enterwine)","fuente_url":"https://www.bodeboca.it/vino/el-nido-2023","puntos_texto":"94","nota":"Una tienda da 94 Parker; la mayoría 93."}]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. No confundir con Clio 2023 (también 93 WA). Solo visto en fragmento/resumen del buscador; no se pudo abrir la página (Firecrawl sin créditos y la red de la sesión bloquea las tiendas).', 'revision'
   where exists (select 1 from public."Vinos" where id = '71df1c08-defa-415c-861f-9daa4fb54762')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- José Pariente Sauvignon Blanc 2024 2024: nueva (no_localizada —)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select 'b8867cac-a5ae-4b9a-acad-6c498b538739', 2024, false, 'no_localizada', 'no_localizada', null, null, null, false, null, 'Robert Parker Wine Advocate', null, null, null, null, null, null, null, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Solo aparecen 94 y 90 sin crítico (Licorea, Enterwine) y notas Peñín de otras añadas. Ninguna RP/WA para 2024.', 'revision'
   where exists (select 1 from public."Vinos" where id = 'b8867cac-a5ae-4b9a-acad-6c498b538739')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Laurent‑Perrier Alexandra Rosé 2004 2004: nueva (revision 95)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '4a5bf9d9-d33e-4c58-bc1c-06eff214824f', 2004, false, 'revision', 'fuentes_contradictorias', '95', 95, 95, false, '2004 Laurent-Perrier Grand Siècle Cuvée Alexandra Rosé', 'Robert Parker Wine Advocate', 'William Kelley', '2019-04', 'Vinfolio / JJ Buckley / otras tiendas (resumen de WebSearch)', 'https://www.vinfolio.com/product/67f9463668f9c0f62e013cbd/2004-laurent-perrier-grand-siecle-cuvee-alexandra-rose-laurent-perrier', 'secundaria', 'Robert Parker''s Wine Advocate, April 2019 ... 95 (resumen)', '2026-11-10'::date, '[{"fuente_nombre":"Otras tiendas (resumen de WebSearch)","fuente_url":"https://www.frw.co.uk/product/612ec28001000000000045c6/2004-laurent-perrier-alexandra-rose-laurent-perrier","puntos_texto":"94","nota":"94/100 atribuido a Stephan Reinhardt (Wine Advocate), posiblemente una reseña anterior."}]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Dos notas WA distintas en tiendas (95 Kelley 2019 vs 94 Reinhardt). La de 2012 guardada (94) no vale para 2004. Solo visto en fragmento/resumen del buscador; no se pudo abrir la página (Firecrawl sin créditos y la red de la sesión bloquea las tiendas).', 'revision'
   where exists (select 1 from public."Vinos" where id = '4a5bf9d9-d33e-4c58-bc1c-06eff214824f')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Marqués de Riscal Barón de Chirel 2020 2020: nueva (no_localizada —)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '8a70d0ed-39df-4f42-86b7-55c74c84872b', 2020, false, 'no_localizada', 'no_localizada', null, null, null, false, null, 'Robert Parker Wine Advocate', null, null, null, null, null, null, null, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Solo Suckling, Atkin, Decanter (93). Parker solo para 2011 y 2012 en Decántalo. Ninguna RP/WA para 2020.', 'revision'
   where exists (select 1 from public."Vinos" where id = '8a70d0ed-39df-4f42-86b7-55c74c84872b')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Moët & Chandon Grand Vintage 2015 2015: nueva (revision 91)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '7bd2fba7-244e-497c-b9f0-311dc36ec973', 2015, false, 'revision', null, '91', 91, 91, false, 'Moët & Chandon Grand Vintage 2015', 'Robert Parker Wine Advocate', 'The Wine Advocate (crítico no visto)', null, 'Chapel Hill Wine Company (resumen de WebSearch)', 'https://www.chapelhillwinecompany.com/wines/Moet-and-Chandon-Brut-Grand-Vintage-2015-w5650371x5', 'secundaria', 'Wine Advocate: 91 Points', '2026-11-10'::date, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Una sola fuente. Ojo: el Grand Vintage Rosé 2015 también aparece con WA 91, puede haber confusión. Solo visto en fragmento/resumen del buscador; no se pudo abrir la página (Firecrawl sin créditos y la red de la sesión bloquea las tiendas).', 'revision'
   where exists (select 1 from public."Vinos" where id = '7bd2fba7-244e-497c-b9f0-311dc36ec973')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Otazu Premium Cuvée 2021 2021: nueva (no_localizada —)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '9c360d96-9ff9-48dc-b2f8-de5694acb00f', 2021, false, 'no_localizada', 'no_localizada', null, null, null, false, null, 'Robert Parker Wine Advocate', null, null, null, null, null, null, null, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Sin nota RP/WA para Premium Cuvée 2021 (solo notas de otros críticos y de otras añadas/vinos de Otazu).', 'revision'
   where exists (select 1 from public."Vinos" where id = '9c360d96-9ff9-48dc-b2f8-de5694acb00f')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Pago de los Capellanes Crianza 2022 2022: nueva (revision 91)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '3a443d48-c2b1-4d4b-ba0e-01ef3652caa4', 2022, false, 'revision', null, '91', 91, 91, false, 'Pago de los Capellanes Crianza (Spainflavor)', 'Robert Parker Wine Advocate', 'Parker (crítico no visto)', null, 'Spainflavor (resumen de WebSearch)', 'https://en.spainflavor.com/wine/pago-capellanes-red-wine-2167450', 'secundaria', '91 Parker points (resumen)', '2026-11-10'::date, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Fuente única y dudosa: la ficha indica ''Year 2023'' pero describe el Crianza 2022. Necesita confirmación. Solo visto en fragmento/resumen del buscador; no se pudo abrir la página (Firecrawl sin créditos y la red de la sesión bloquea las tiendas).', 'revision'
   where exists (select 1 from public."Vinos" where id = '3a443d48-c2b1-4d4b-ba0e-01ef3652caa4')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Pazo Barrantes 2020 2020: nueva (revision 94)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '813c4abb-4371-4dad-bc45-9360cf262e59', 2020, false, 'revision', null, '94', 94, 94, false, '2020 Pazo Barrantes Gran Vino Albariño', 'Robert Parker Wine Advocate', 'Luis Gutiérrez', '2023-11', 'MMD USA (importador, resumen de WebSearch)', 'https://mmdusa.net/portfolio/pazo-barrantes/gran-vino-albarino/2020', 'secundaria', 'The Wine Advocate 94 Points November 2023, Luis Gutiérrez', '2026-11-10'::date, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. No confundir con La Comtesse de Pazo Barrantes 2020 (96 WA, otro vino). Solo visto en fragmento/resumen del buscador; no se pudo abrir la página (Firecrawl sin créditos y la red de la sesión bloquea las tiendas).', 'revision'
   where exists (select 1 from public."Vinos" where id = '813c4abb-4371-4dad-bc45-9360cf262e59')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- PSI 2023 2023: revision 93-94 → revision 94
  update public.vinos_puntuacion_parker p
     set estado = 'revision',
         motivo = 'fuentes_contradictorias',
         puntos_texto = '94',
         puntos_min = 94,
         puntos_max = 94,
         provisional = false,
         vino_evaluado = '2023 PSI (Dominio de Pingus) embotellado',
         entidad = 'Robert Parker Wine Advocate',
         critico = 'Luis Gutiérrez',
         fecha_valoracion = '2026-07',
         fuente_nombre = 'Cream Wine (resumen de WebSearch)',
         fuente_url = 'https://www.creamwine.com/product.php?id=22763',
         fuente_tipo = 'secundaria',
         cita = 'Wine Advocate 94, 7/16/2026, bottled wine consistent with the blend tasted the previous year (resumen)',
         fecha_consulta = '2026-11-10'::date,
         discrepancias = '[{"fuente_nombre":"Woodland Hills Wine Company / JJ Buckley","fuente_url":"https://whwc.com/pingus-psi-ribera-del-duero-2023","puntos_texto":"93-94","nota":"Nota provisional de muestra antes de embotellar (junio 2025), provisional=true."}]'::jsonb,
         notas = 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. La fila actual (93-94 provisional) parece superada por una nota del vino embotellado (94, julio 2026), vista solo en una fuente. Solo visto en fragmento/resumen del buscador; no se pudo abrir la página (Firecrawl sin créditos y la red de la sesión bloquea las tiendas).',
         origen = 'revision'
   where p.vino_id = 'e59baae8-5310-4264-80f0-31bb3f1e7bfb' and p.clave_anada = 2023 and p.estado = 'revision' and p.puntos_texto is not distinct from '93-94' and p.provisional = true;
  get diagnostics n = row_count;
  v_parker := v_parker + n;
  if n = 0 and not exists (select 1 from public.vinos_puntuacion_parker p
                            where p.vino_id = 'e59baae8-5310-4264-80f0-31bb3f1e7bfb' and p.clave_anada = 2023) then
    insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
    select 'e59baae8-5310-4264-80f0-31bb3f1e7bfb', 2023, false, 'revision', 'fuentes_contradictorias', '94', 94, 94, false, '2023 PSI (Dominio de Pingus) embotellado', 'Robert Parker Wine Advocate', 'Luis Gutiérrez', '2026-07', 'Cream Wine (resumen de WebSearch)', 'https://www.creamwine.com/product.php?id=22763', 'secundaria', 'Wine Advocate 94, 7/16/2026, bottled wine consistent with the blend tasted the previous year (resumen)', '2026-11-10'::date, '[{"fuente_nombre":"Woodland Hills Wine Company / JJ Buckley","fuente_url":"https://whwc.com/pingus-psi-ribera-del-duero-2023","puntos_texto":"93-94","nota":"Nota provisional de muestra antes de embotellar (junio 2025), provisional=true."}]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. La fila actual (93-94 provisional) parece superada por una nota del vino embotellado (94, julio 2026), vista solo en una fuente. Solo visto en fragmento/resumen del buscador; no se pudo abrir la página (Firecrawl sin créditos y la red de la sesión bloquea las tiendas).', 'revision'
     where exists (select 1 from public."Vinos" where id = 'e59baae8-5310-4264-80f0-31bb3f1e7bfb')
    on conflict (vino_id, clave_anada) do nothing;
    get diagnostics n = row_count;
    v_parker := v_parker + n;
  elsif n = 0 and not exists (select 1 from public.vinos_puntuacion_parker p
                               where p.vino_id = 'e59baae8-5310-4264-80f0-31bb3f1e7bfb' and p.clave_anada = 2023 and p.estado = 'revision' and p.puntos_texto is not distinct from '94' and p.provisional = false)
        and exists (select 1 from public."Vinos" where id = 'e59baae8-5310-4264-80f0-31bb3f1e7bfb') then
    v_saltados := array_append(v_saltados, 'Parker e59baae8-5310-4264-80f0-31bb3f1e7bfb 2023 (PSI 2023)');
  end if;

  -- Tomás Postigo 2022 2022: nueva (no_localizada —)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '06bf9660-61b1-48ae-8032-5cbaf982d894', 2022, false, 'no_localizada', 'no_localizada', null, null, null, false, null, 'Robert Parker Wine Advocate', null, null, null, null, null, null, null, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Sin nota RP/WA para 2022. Además la referencia es ambigua (Tomás Postigo 3er Año, Crianza, 5º Año...).', 'revision'
   where exists (select 1 from public."Vinos" where id = '06bf9660-61b1-48ae-8032-5cbaf982d894')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Aaltos Blanco 2023 2023: nueva (verificada 93)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '0b790f1a-03da-4f83-9c24-a6f0ab600b5a', 2023, false, 'verificada', null, '93', 93, 93, false, '2023 Blanco de Parcela Fuente de las Hontanillas (Aalto)', 'Robert Parker Wine Advocate', 'Luis Gutiérrez (The Wine Advocate)', null, 'Ideavinos (tienda)', 'https://www.ideavinos.com/vino-aalto-blanco-de-parcela.html', 'secundaria', '2023 / 93 puntos — The white 2023 Blanco de Parcela Fuente de las Hontanillas was produced with an unusual blend of Verdejo, Albillo Mayor and Godello… Robert Parker The Wine Advocate / Luis Gutiérrez', '2026-11-10'::date, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Página abierta (scrape). ''Aaltos Blanco'' de la carta = Aalto Blanco de Parcela. La nota 93+ guardada es de la añada 2024, no aplica.', 'revision'
   where exists (select 1 from public."Vinos" where id = '0b790f1a-03da-4f83-9c24-a6f0ab600b5a')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Arzuaga 2022 2022: nueva (revision 89)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select 'aee0f9a6-4587-4690-b8a0-d188c1e4f736', 2022, false, 'revision', null, '89', 89, 89, false, 'Arzuaga Crianza 2022', 'Robert Parker Wine Advocate', 'Parker (sin nombre de catador)', null, 'Licorea (tienda), fragmento de búsqueda', 'https://www.licorea.com/arzuaga-crianza-2022-en-p-2451.html', 'secundaria', 'Vino Arzuaga Crianza 2022 ... 89 Parker 89 Peñín', '2026-11-10'::date, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Una sola fuente dudosa (la misma ficha da un coupage que no cuadra con otras). Se asume que ''Arzuaga 2022'' es el Crianza; otras notas 2022 vistas son de Vinous (91) y Wine Spectator (90), no valen. Firecrawl sin créditos a mitad de la investigación y WebFetch/curl bloqueados por la red de la sesión: solo se pudo ver el fragmento del buscador.', 'revision'
   where exists (select 1 from public."Vinos" where id = 'aee0f9a6-4587-4690-b8a0-d188c1e4f736')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Áster Otero 2018 (Magnum) 2018: nueva (no_localizada —)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select 'c0d22e63-dfea-45d1-a6c4-080a16a6b8f2', 2018, false, 'no_localizada', 'no_localizada', null, null, null, false, null, 'Robert Parker Wine Advocate', null, null, null, null, null, null, null, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Áster Finca El Otero 2018. Wine-Searcher (abierta) solo muestra Suckling, Tim Atkin, Falstaff y DWWA para 2018; Timeless Wines (abierta) solo Suckling 95 y Atkin 96 (el ''95 Parker'' del fragmento no aparece en la página). Gutiérrez valoró la 2014 (92), no la 2018.', 'revision'
   where exists (select 1 from public."Vinos" where id = 'c0d22e63-dfea-45d1-a6c4-080a16a6b8f2')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Bermejos (Lanzarote) 2025 2025: nueva (no_localizada —)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '1214516e-edd2-4323-a044-12892572deb3', 2025, false, 'no_localizada', 'no_localizada', null, null, null, false, null, 'Robert Parker Wine Advocate', null, null, null, null, null, null, null, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Bermejo Malvasía (Volcánica) Seco 2025: ninguna fuente con nota RP/WA. La 2024 tiene 93 de John Gilman (no es WA).', 'revision'
   where exists (select 1 from public."Vinos" where id = '1214516e-edd2-4323-a044-12892572deb3')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Carraovejas El Anejón 2018 (Magnum) 2018: nueva (verificada 93)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '6278535b-bf41-4387-b017-9d77e51d4ab8', 2018, false, 'verificada', null, '93', 93, 93, false, 'Pago de Carraovejas El Anejón 2018', 'Robert Parker Wine Advocate', 'Robert Parker''s Wine Advocate (catador no indicado en la página)', null, 'Wine.com', 'https://www.wine.com/product/pago-de-carraovejas-el-anejon-2018/1308340', 'secundaria', '93 Robert Parker''s Wine Advocate — The 2018 El Anejón is a blend of 81% Tinto Fino, 12% Merlot and 7% Cabernet Sauvignon from a very steep slope where they have to make it terraced.', '2026-11-10'::date, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Página abierta (scrape). Magnum vs botella da igual. La misma nota de cata aparece citada en Gourmet Hunters.', 'revision'
   where exists (select 1 from public."Vinos" where id = '6278535b-bf41-4387-b017-9d77e51d4ab8')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Dominio de Calogía 2020 2020: nueva (revision 93)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select 'b550e328-7b1b-4e5b-8442-1d8b5161e771', 2020, false, 'revision', null, '93', 93, 93, false, '2020 Dominio de Calogía Ribera del Duero', 'Robert Parker Wine Advocate', 'The Wine Advocate (catador no visto)', null, 'WineBid (subasta), fragmento de búsqueda', 'https://www.winebid.com/BuyWine/Item/Auction/1788148', 'secundaria', 'Wine Advocate 93 (según resumen del buscador)', '2026-11-10'::date, '[{"fuente_nombre":"Total Wine Concierge","fuente_url":"https://concierge.totalwine.com/product/dominio-de-calogia-ribera-del-duero","puntos_texto":"93","nota":"Wine Advocate Score 93 sin añada clara en el fragmento."}]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. No confundir con Dominio de Calogía Cuvée S 2020 (WA 94 según Total Wine). Firecrawl sin créditos a mitad de la investigación y WebFetch/curl bloqueados por la red de la sesión: solo se pudo ver el fragmento del buscador.', 'revision'
   where exists (select 1 from public."Vinos" where id = 'b550e328-7b1b-4e5b-8442-1d8b5161e771')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Dominio del Pidio 2021 2021: nueva (revision 94)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '27696aa0-c54f-4baa-a65a-cd0442de84bb', 2021, false, 'revision', null, '94', 94, 94, false, 'Dominio del Pidio Ribera del Duero 2021 (tinto)', 'Robert Parker Wine Advocate', 'Luis Gutiérrez (The Wine Advocate)', null, 'MRD Wine (tienda), fragmento de búsqueda', 'https://www.mrdwine.com/collections/all/products/dominio-del-pidio-ribera-del-duero-spain-2021', 'secundaria', '94 Pts Luis Gutierrez, Robert Parker', '2026-11-10'::date, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Una sola fuente. Peñín también da 94 a la 2021 (no vale). La 2022 tiene 93 WA según Gourmet Hunters. Firecrawl sin créditos a mitad de la investigación y WebFetch/curl bloqueados por la red de la sesión: solo se pudo ver el fragmento del buscador.', 'revision'
   where exists (select 1 from public."Vinos" where id = '27696aa0-c54f-4baa-a65a-cd0442de84bb')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Fefiñanes 2024 2024: nueva (no_localizada —)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select 'a21f8826-79e1-4662-9d9a-a0ac445a2e11', 2024, false, 'no_localizada', 'no_localizada', null, null, null, false, null, 'Robert Parker Wine Advocate', null, null, null, null, null, null, null, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Albariño de Fefiñanes 2024: solo Vinous 92+ (K&L) y John Szabo 93; una tienda francesa muestra 91 con campo Parker vacío. El 91+ WA es de la 2023.', 'revision'
   where exists (select 1 from public."Vinos" where id = 'a21f8826-79e1-4662-9d9a-a0ac445a2e11')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- L. Beyer Gewurz Comtes d'Eguisheim 2009 2009: nueva (no_localizada —)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select 'b54dca1f-4030-4af3-94c4-733806de0b7d', 2009, false, 'no_localizada', 'fuente_inaccesible', null, null, null, false, null, 'Robert Parker Wine Advocate', null, null, null, null, null, null, null, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Gourmet Hunters cita una reseña de Robert Parker''s Wine Advocate de la Gewurztraminer Comtes d''Eguisheim 2009 (''more formidable than the regular 2009''), pero el fragmento no da puntos y la página no se pudo abrir (dominio bloqueado). URL: https://www.gourmethunters.com/en_GB/Léon+Beyer+Gewürztraminer+Comtes+d''Eguisheim+2009', 'revision'
   where exists (select 1 from public."Vinos" where id = 'b54dca1f-4030-4af3-94c4-733806de0b7d')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Ladoucette Pouilly‑Fumé 2022 2022: nueva (no_localizada —)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '6e0f4e55-cb21-4fd0-b112-acd103405948', 2022, false, 'no_localizada', 'no_localizada', null, null, null, false, null, 'Robert Parker Wine Advocate', null, null, null, null, null, null, null, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. De Ladoucette Pouilly-Fumé 2022: sin RP/WA (solo Tastingbook 93; Wine Enthusiast y Falstaff de otras añadas).', 'revision'
   where exists (select 1 from public."Vinos" where id = '6e0f4e55-cb21-4fd0-b112-acd103405948')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Martelo 2019 2019: nueva (revision 94)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '0bf32fa1-51aa-45af-9882-a11fc391b509', 2019, false, 'revision', 'fuentes_contradictorias', '94', 94, 94, false, 'Torre de Oña Finca Martelo Reserva 2019', 'Robert Parker Wine Advocate', 'Luis Gutiérrez (The Wine Advocate)', null, 'Vino Fino NZ (tienda), fragmento de búsqueda', 'https://vinofino.co.nz/product/torre-de-ona-martelo-rioja-reserva-2019', 'secundaria', '94 — Luis Gutiérrez, Parker''s Wine Advocate (según resumen del buscador)', '2026-11-10'::date, '[{"fuente_nombre":"Skurnik Wines (importador)","fuente_url":"https://www.skurnik.com/sku/rioja-reserva-finca-martelo-torre-de-ona-nss-2/","puntos_texto":"94+","nota":"Reseña 2019 fechada 2024-03-25 según el resumen; URL exacta de la añada no confirmada."}]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Firecrawl sin créditos a mitad de la investigación y WebFetch/curl bloqueados por la red de la sesión: solo se pudo ver el fragmento del buscador.', 'revision'
   where exists (select 1 from public."Vinos" where id = '0bf32fa1-51aa-45af-9882-a11fc391b509')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Moët Grand Vintage Rosé 2015 2015: nueva (revision 91)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '46f035f1-b2ca-4a69-b607-1806a93c6e8b', 2015, false, 'revision', null, '91', 91, 91, false, '2015 Moët ''Grand Vintage'' Extra Brut Rosé', 'Robert Parker Wine Advocate', 'The Wine Advocate (catador no visto)', null, 'WineScout (tienda), fragmento de búsqueda', 'https://winescout.com/2015-moet-grand-vintage-brut', 'secundaria', 'WA91 Wine Advocate', '2026-11-10'::date, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Una sola fuente. Otras notas de la misma ficha (VN94, WE93, WS93, JD93) no valen. Firecrawl sin créditos a mitad de la investigación y WebFetch/curl bloqueados por la red de la sesión: solo se pudo ver el fragmento del buscador.', 'revision'
   where exists (select 1 from public."Vinos" where id = '46f035f1-b2ca-4a69-b607-1806a93c6e8b')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Otazu Rosado 2024 2024: nueva (no_localizada —)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '0e14f46c-85fb-4f93-9890-ca8e7e15e869', 2024, false, 'no_localizada', 'no_localizada', null, null, null, false, null, 'Robert Parker Wine Advocate', null, null, null, null, null, null, null, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. La 2024 se comercializa como ''Ozu by Otazu Rosé'' (antes Otazu Rosado). Sin RP/WA; la nota de Parker que aparece es de Artazuri Rosado (otra bodega).', 'revision'
   where exists (select 1 from public."Vinos" where id = '0e14f46c-85fb-4f93-9890-ca8e7e15e869')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Pago de los Capellanes Crianza 2022 (Magnum) 2022: nueva (no_localizada —)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select 'e895f569-8a83-4f1d-ab48-03f86a4d9c6b', 2022, false, 'no_localizada', 'no_localizada', null, null, null, false, null, 'Robert Parker Wine Advocate', null, null, null, null, null, null, null, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Pago de los Capellanes Crianza 2022: solo Suckling 91 y Enterwine 92; RP solo para añadas antiguas (2014).', 'revision'
   where exists (select 1 from public."Vinos" where id = 'e895f569-8a83-4f1d-ab48-03f86a4d9c6b')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Pícaro del Águila 2022 2022: nueva (revision 94)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '0628c633-b086-40f6-bcb7-125f64081d4b', 2022, false, 'revision', null, '94', 94, 94, false, '2022 Pícaro del Águila Tinto (algunas tiendas: ''Viñas Viejas'')', 'Robert Parker Wine Advocate', 'Luis Gutiérrez (The Wine Advocate)', '2024-06', 'Zachys / IPO Wines (fragmentos de búsqueda)', 'https://www.zachys.com/products/ribera-del-duero-picaro-tinto-dominio-del-aguila-2022-750ml', 'secundaria', 'The 2022 Pícaro del Águila Tinto has similar parameters to the 2021 (14% alcohol), but the sensation is of higher ripeness. It was bottled in January 2024.', '2026-11-10'::date, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Varias tiendas coinciden en WA 94 (JJ Buckley lo lista como Viñas Viejas con la misma reseña). Catador no visto explícitamente; Gutiérrez es el crítico de WA para España. Zachys añade Vinous 93 (no vale). Firecrawl sin créditos a mitad de la investigación y WebFetch/curl bloqueados por la red de la sesión: solo se pudo ver el fragmento del buscador.', 'revision'
   where exists (select 1 from public."Vinos" where id = '0628c633-b086-40f6-bcb7-125f64081d4b')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- PSI 2021 (Magnum) 2021: nueva (revision 93+)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select 'c9903817-6d30-4d69-a96f-0cdc8bbf8495', 2021, false, 'revision', 'fuentes_contradictorias', '93+', 93, 93, false, '2021 Dominio de Pingus PSI (embotellado)', 'Robert Parker Wine Advocate', 'Luis Gutiérrez (The Wine Advocate)', '2024-06', 'Comerciante citado en resumen de búsqueda (whwc.com u otro)', 'https://whwc.com/pingus-psi-ribera-del-duero-2021', 'secundaria', '(93+ points) bottled 2021 PSI was reticent and closed when tasted', '2026-11-10'::date, '[{"fuente_nombre":"Varias tiendas","fuente_url":"https://whwc.com/pingus-psi-ribera-del-duero-2021","puntos_texto":"93-95","nota":"Nota provisional en barrica, Luis Gutiérrez, Wine Advocate (Jan 2023)."},{"fuente_nombre":"B-21 / otras tiendas","fuente_url":"https://b-21.com/2021-Dominio-de-Pingus-Psi/productinfo/ESPING21BE","puntos_texto":"95","nota":"Listan WA 95 como cifra única; origen dudoso."}]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Se prioriza la nota en botella (93+), vista en una sola fuente. Atribución exacta de URL a cada cifra no confirmada. Firecrawl sin créditos a mitad de la investigación y WebFetch/curl bloqueados por la red de la sesión: solo se pudo ver el fragmento del buscador.', 'revision'
   where exists (select 1 from public."Vinos" where id = 'c9903817-6d30-4d69-a96f-0cdc8bbf8495')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Sierra Cantabria Colección Privada 2021 2021: nueva (revision 94)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '4f2bdba3-9850-4a7d-aa56-fb406a2f3424', 2021, false, 'revision', null, '94', 94, 94, false, 'Sierra Cantabria Colección Privada 2021', 'Robert Parker Wine Advocate', 'Luis Gutiérrez (The Wine Advocate)', null, 'Grand Cru Wijnen / Gourmet Hunters (fragmentos de búsqueda)', 'https://www.grandcruwijnen.nl/en/2021-sierra-cantabria-colleccion-privada', 'secundaria', 'Parker Points: 94 (según resumen del buscador)', '2026-11-10'::date, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. No confundir con Sierra Cantabria Crianza 2021 (WA 92) ni Finca El Bosque 2021 (WA 96). Firecrawl sin créditos a mitad de la investigación y WebFetch/curl bloqueados por la red de la sesión: solo se pudo ver el fragmento del buscador.', 'revision'
   where exists (select 1 from public."Vinos" where id = '4f2bdba3-9850-4a7d-aa56-fb406a2f3424')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Tomás Postigo 2022 (Magnum) 2022: nueva (no_localizada —)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '8cfcfafc-fcef-4ba5-ac7f-f5fcc850c23e', 2022, false, 'no_localizada', 'no_localizada', null, null, null, false, null, 'Robert Parker Wine Advocate', null, null, null, null, null, null, null, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Se asume Tomás Postigo 3er Año 2022 (la carta no lo precisa; también existe Tomás Postigo Crianza). Ninguna fuente con RP/WA para 2022.', 'revision'
   where exists (select 1 from public."Vinos" where id = '8cfcfafc-fcef-4ba5-ac7f-f5fcc850c23e')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Abadía Retuerta Selección Especial 2019 2019: nueva (verificada 92)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '6cce52a0-2fc7-48d3-8801-29ea2073e3b2', 2019, false, 'verificada', null, '92', 92, 92, false, 'Abadía Retuerta Sardón de Duero Selección Especial 2019', 'Robert Parker Wine Advocate', 'Luis Gutiérrez', null, 'Woodland Hills Wine Company', 'https://whwc.com/abadia-retuerta-sardon-de-duero-seleccion-especial-2019', 'secundaria', '92 points Luis Gutiérrez ( Wine Advocate): "The 2019 Selección Especial, cropped from a warm and dry year..."', '2026-11-10'::date, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. K&L (fragmento) también da 92RP. La nota de 2021 (93) guardada en otras_anadas no aplica.', 'revision'
   where exists (select 1 from public."Vinos" where id = '6cce52a0-2fc7-48d3-8801-29ea2073e3b2')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Arzuaga Gran Reserva 2018 2018: nueva (no_localizada —)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '4171e534-9b36-400f-8304-925460ed3a89', 2018, false, 'no_localizada', 'no_localizada', null, null, null, false, null, 'Robert Parker Wine Advocate', null, null, null, null, null, null, null, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Solo aparecen Peñín 93 (2018 GR) y notas de la Reserva 2018 (vino distinto). Ninguna nota RP/WA para el Gran Reserva 2018.', 'revision'
   where exists (select 1 from public."Vinos" where id = '4171e534-9b36-400f-8304-925460ed3a89')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Ausàs Interpretación 2018 2018: nueva (verificada 95)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '57cf57dc-6ce5-4407-adbb-d3d337bf1544', 2018, false, 'verificada', null, '95', 95, 95, false, 'Ausàs Interpretación (tabla de añadas, 2018)', 'Robert Parker Wine Advocate', null, null, 'Vinissimus', 'https://www.vinissimus.com/en/wine/ausas-interpretacion/', 'secundaria', '| 2018 | 95 PK | 95 PN | | 96 DC | 96 TA | ... PK: Parker', '2026-11-10'::date, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Página abierta (tabla de puntuaciones por añada; la ficha muestra la añada 2023 a la venta). Fragmento de Gourmet Hunters también da Parker 95 para 2018. No se identifica el crítico en la página.', 'revision'
   where exists (select 1 from public."Vinos" where id = '57cf57dc-6ce5-4407-adbb-d3d337bf1544')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Bosque de Matasnos 2022 2022: nueva (no_localizada —)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '8b2d10a2-c778-4233-980d-ebb94db71ce4', 2022, false, 'no_localizada', 'no_localizada', null, null, null, false, null, 'Robert Parker Wine Advocate', null, null, null, null, null, null, null, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Enterwine solo muestra su propia nota (91) para 2022; notas Parker solo de añadas antiguas (2012-2014). No confundir con Edición Limitada.', 'revision'
   where exists (select 1 from public."Vinos" where id = '8b2d10a2-c778-4233-980d-ebb94db71ce4')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Carraovejas 2023 (Magnum) 2023: revision 92 → verificada 92
  update public.vinos_puntuacion_parker p
     set estado = 'verificada',
         motivo = null,
         puntos_texto = '92',
         puntos_min = 92,
         puntos_max = 92,
         provisional = false,
         vino_evaluado = '2023 Pago de Carraovejas Tinto',
         entidad = 'Robert Parker Wine Advocate',
         critico = 'Luis Gutiérrez',
         fecha_valoracion = null,
         fuente_nombre = 'Grandcruwijnen.nl',
         fuente_url = 'https://www.grandcruwijnen.nl/en/2023-pago-de-carraovejas',
         fuente_tipo = 'secundaria',
         cita = 'Parker 92 The Wine Advocate - RP 92 Reviewed by: Luis Gutiérrez',
         fecha_consulta = '2026-11-10'::date,
         discrepancias = '[{"fuente_nombre":"Fragmentos de búsqueda (tiendas no identificadas)","fuente_url":null,"puntos_texto":"93 / 93+","nota":"Algunas tiendas citan 93 o 93+ de Parker para 2023; no se pudieron abrir. La página con crítico identificado da 92."}]'::jsonb,
         notas = 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Confirma la fila_actual (92). Enterwine (página abierta) muestra ''Parker 92'' pero redirige a la añada 2024, por eso no se usa como fuente. Ventana 2026-2032 según fragmento.',
         origen = 'revision'
   where p.vino_id = '540c1075-8c8e-4a70-9fe7-d499b293741d' and p.clave_anada = 2023 and p.estado = 'revision' and p.puntos_texto is not distinct from '92' and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;
  if n = 0 and not exists (select 1 from public.vinos_puntuacion_parker p
                            where p.vino_id = '540c1075-8c8e-4a70-9fe7-d499b293741d' and p.clave_anada = 2023) then
    insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
    select '540c1075-8c8e-4a70-9fe7-d499b293741d', 2023, false, 'verificada', null, '92', 92, 92, false, '2023 Pago de Carraovejas Tinto', 'Robert Parker Wine Advocate', 'Luis Gutiérrez', null, 'Grandcruwijnen.nl', 'https://www.grandcruwijnen.nl/en/2023-pago-de-carraovejas', 'secundaria', 'Parker 92 The Wine Advocate - RP 92 Reviewed by: Luis Gutiérrez', '2026-11-10'::date, '[{"fuente_nombre":"Fragmentos de búsqueda (tiendas no identificadas)","fuente_url":null,"puntos_texto":"93 / 93+","nota":"Algunas tiendas citan 93 o 93+ de Parker para 2023; no se pudieron abrir. La página con crítico identificado da 92."}]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Confirma la fila_actual (92). Enterwine (página abierta) muestra ''Parker 92'' pero redirige a la añada 2024, por eso no se usa como fuente. Ventana 2026-2032 según fragmento.', 'revision'
     where exists (select 1 from public."Vinos" where id = '540c1075-8c8e-4a70-9fe7-d499b293741d')
    on conflict (vino_id, clave_anada) do nothing;
    get diagnostics n = row_count;
    v_parker := v_parker + n;
  elsif n = 0 and not exists (select 1 from public.vinos_puntuacion_parker p
                               where p.vino_id = '540c1075-8c8e-4a70-9fe7-d499b293741d' and p.clave_anada = 2023 and p.estado = 'verificada' and p.puntos_texto is not distinct from '92' and p.provisional = false)
        and exists (select 1 from public."Vinos" where id = '540c1075-8c8e-4a70-9fe7-d499b293741d') then
    v_saltados := array_append(v_saltados, 'Parker 540c1075-8c8e-4a70-9fe7-d499b293741d 2023 (Carraovejas 2023 (Magnum))');
  end if;

  -- Dom Pérignon Plénitude 2 (2002) 2002: revision 96 → revision 95
  update public.vinos_puntuacion_parker p
     set estado = 'revision',
         motivo = 'fuentes_contradictorias',
         puntos_texto = '95',
         puntos_min = 95,
         puntos_max = 95,
         provisional = false,
         vino_evaluado = 'Dom Pérignon P2 2002',
         entidad = 'Robert Parker Wine Advocate',
         critico = 'William Kelley',
         fecha_valoracion = '2020-04',
         fuente_nombre = 'Fragmentos de búsqueda (tiendas: FRW, Zachys, Pogo''s)',
         fuente_url = 'https://www.frw.co.uk/product/612ec280010000000004817c/2002-dom-perignon-p2-dom-perignon',
         fuente_tipo = 'secundaria',
         cita = null,
         fecha_consulta = '2026-11-10'::date,
         discrepancias = '[{"fuente_nombre":"Zachys / Pogo''s (fragmentos)","fuente_url":"https://www.zachys.com/products/dom-perignon-p2-2002-750ml","puntos_texto":"96","nota":"William Kelley, marzo 2019, ventana 2018-2036. Coincide con la fila_actual."}]'::jsonb,
         notas = 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Dos reseñas de William Kelley: 96 (mar 2019) y 95 (abr 2020, ventana 2019-2045). La más reciente es 95; la fila_actual (96) queda dudosa. Ojo: hay un 96 WA del DP 2002 original (no P2). Verificación limitada: créditos de Firecrawl agotados a mitad de la investigación y WebFetch sin acceso a las tiendas; solo visto en fragmentos de búsqueda.',
         origen = 'revision'
   where p.vino_id = '1d2c19d4-9d36-4531-ad0a-4824109b43de' and p.clave_anada = 2002 and p.estado = 'revision' and p.puntos_texto is not distinct from '96' and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;
  if n = 0 and not exists (select 1 from public.vinos_puntuacion_parker p
                            where p.vino_id = '1d2c19d4-9d36-4531-ad0a-4824109b43de' and p.clave_anada = 2002) then
    insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
    select '1d2c19d4-9d36-4531-ad0a-4824109b43de', 2002, false, 'revision', 'fuentes_contradictorias', '95', 95, 95, false, 'Dom Pérignon P2 2002', 'Robert Parker Wine Advocate', 'William Kelley', '2020-04', 'Fragmentos de búsqueda (tiendas: FRW, Zachys, Pogo''s)', 'https://www.frw.co.uk/product/612ec280010000000004817c/2002-dom-perignon-p2-dom-perignon', 'secundaria', null, '2026-11-10'::date, '[{"fuente_nombre":"Zachys / Pogo''s (fragmentos)","fuente_url":"https://www.zachys.com/products/dom-perignon-p2-2002-750ml","puntos_texto":"96","nota":"William Kelley, marzo 2019, ventana 2018-2036. Coincide con la fila_actual."}]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Dos reseñas de William Kelley: 96 (mar 2019) y 95 (abr 2020, ventana 2019-2045). La más reciente es 95; la fila_actual (96) queda dudosa. Ojo: hay un 96 WA del DP 2002 original (no P2). Verificación limitada: créditos de Firecrawl agotados a mitad de la investigación y WebFetch sin acceso a las tiendas; solo visto en fragmentos de búsqueda.', 'revision'
     where exists (select 1 from public."Vinos" where id = '1d2c19d4-9d36-4531-ad0a-4824109b43de')
    on conflict (vino_id, clave_anada) do nothing;
    get diagnostics n = row_count;
    v_parker := v_parker + n;
  elsif n = 0 and not exists (select 1 from public.vinos_puntuacion_parker p
                               where p.vino_id = '1d2c19d4-9d36-4531-ad0a-4824109b43de' and p.clave_anada = 2002 and p.estado = 'revision' and p.puntos_texto is not distinct from '95' and p.provisional = false)
        and exists (select 1 from public."Vinos" where id = '1d2c19d4-9d36-4531-ad0a-4824109b43de') then
    v_saltados := array_append(v_saltados, 'Parker 1d2c19d4-9d36-4531-ad0a-4824109b43de 2002 (Dom Pérignon Plénitude 2 (2002))');
  end if;

  -- Dominio de Calogía 2020 (Magnum) 2020: nueva (revision 93)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select 'c845e388-6954-4b1f-b5dc-36064f06043f', 2020, false, 'revision', null, '93', 93, 93, false, 'Dominio de Calogía Ribera del Duero 2020', 'Robert Parker Wine Advocate', null, null, 'WineBid (fragmento de búsqueda)', 'https://www.winebid.com/BuyWine/Item/Auction/1788148', 'secundaria', null, '2026-11-10'::date, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. No confundir con Dominio de Calogía Cuvée S 2020 (WA 94, otro vino). Gourmet Hunters/Bodeboca citan texto de WA del 2020 sin cifra. Verificación limitada: créditos de Firecrawl agotados a mitad de la investigación y WebFetch sin acceso a las tiendas; solo visto en fragmentos de búsqueda.', 'revision'
   where exists (select 1 from public."Vinos" where id = 'c845e388-6954-4b1f-b5dc-36064f06043f')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- El Canto de la Alondra 2022 2022: nueva (no_localizada —)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '5a6e9fa1-4a16-48e9-9201-0c9452ac35ba', 2022, false, 'no_localizada', 'no_localizada', null, null, null, false, null, 'Robert Parker Wine Advocate', null, null, null, null, null, null, null, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Solo Guía Lías 95 para 2022; ninguna nota RP/WA encontrada.', 'revision'
   where exists (select 1 from public."Vinos" where id = '5a6e9fa1-4a16-48e9-9201-0c9452ac35ba')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Fefiñanes 2024 (Magnum) 2024: nueva (no_localizada —)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '869f78bc-2994-49a7-88b3-c5eec414b6df', 2024, false, 'no_localizada', 'referencia_ambigua', null, null, null, false, null, 'Robert Parker Wine Advocate', null, null, null, null, null, null, null, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Gourmet Hunters muestra un 91 junto a ''Puntos Parker / Puntos Peñín'' sin que quede claro a qué crítico corresponde; Peñín da 91 al 2024. Vinous 92+. No hay nota RP/WA clara para 2024. El 91+ de 2023 no aplica.', 'revision'
   where exists (select 1 from public."Vinos" where id = '869f78bc-2994-49a7-88b3-c5eec414b6df')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Flor de Pingus 2023 2023: revision 93-94 → revision 93-94
  update public.vinos_puntuacion_parker p
     set estado = 'revision',
         motivo = 'fuentes_contradictorias',
         puntos_texto = '93-94',
         puntos_min = 93,
         puntos_max = 94,
         provisional = true,
         vino_evaluado = 'Dominio de Pingus Flor de Pingus 2023',
         entidad = 'Robert Parker Wine Advocate',
         critico = 'Luis Gutiérrez',
         fecha_valoracion = '2025-06',
         fuente_nombre = 'K&L Wines / 67Wine (fragmentos de búsqueda)',
         fuente_url = 'https://shop.klwines.com/products/details/1954671',
         fuente_tipo = 'secundaria',
         cita = null,
         fecha_consulta = '2026-11-10'::date,
         discrepancias = '[{"fuente_nombre":"K&L Wines (otra ficha, fragmento) / Vinissimus","fuente_url":"https://www.klwines.com/products/details/1956428","puntos_texto":"95+","nota":"Otra ficha de K&L (jun 2025) y Vinissimus muestran 95/95+ Parker para 2023."}]'::jsonb,
         notas = 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Intervalo 93-94 probablemente de muestra en barrica (provisional). Confirma la fila_actual pero sigue habiendo contradicción con 95+. Verificación limitada: créditos de Firecrawl agotados a mitad de la investigación y WebFetch sin acceso a las tiendas; solo visto en fragmentos de búsqueda.',
         origen = 'revision'
   where p.vino_id = '82a51e05-5a64-47cc-92eb-b0fba170310c' and p.clave_anada = 2023 and p.estado = 'revision' and p.puntos_texto is not distinct from '93-94' and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;
  if n = 0 and not exists (select 1 from public.vinos_puntuacion_parker p
                            where p.vino_id = '82a51e05-5a64-47cc-92eb-b0fba170310c' and p.clave_anada = 2023) then
    insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
    select '82a51e05-5a64-47cc-92eb-b0fba170310c', 2023, false, 'revision', 'fuentes_contradictorias', '93-94', 93, 94, true, 'Dominio de Pingus Flor de Pingus 2023', 'Robert Parker Wine Advocate', 'Luis Gutiérrez', '2025-06', 'K&L Wines / 67Wine (fragmentos de búsqueda)', 'https://shop.klwines.com/products/details/1954671', 'secundaria', null, '2026-11-10'::date, '[{"fuente_nombre":"K&L Wines (otra ficha, fragmento) / Vinissimus","fuente_url":"https://www.klwines.com/products/details/1956428","puntos_texto":"95+","nota":"Otra ficha de K&L (jun 2025) y Vinissimus muestran 95/95+ Parker para 2023."}]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Intervalo 93-94 probablemente de muestra en barrica (provisional). Confirma la fila_actual pero sigue habiendo contradicción con 95+. Verificación limitada: créditos de Firecrawl agotados a mitad de la investigación y WebFetch sin acceso a las tiendas; solo visto en fragmentos de búsqueda.', 'revision'
     where exists (select 1 from public."Vinos" where id = '82a51e05-5a64-47cc-92eb-b0fba170310c')
    on conflict (vino_id, clave_anada) do nothing;
    get diagnostics n = row_count;
    v_parker := v_parker + n;
  elsif n = 0 and not exists (select 1 from public.vinos_puntuacion_parker p
                               where p.vino_id = '82a51e05-5a64-47cc-92eb-b0fba170310c' and p.clave_anada = 2023 and p.estado = 'revision' and p.puntos_texto is not distinct from '93-94' and p.provisional = true)
        and exists (select 1 from public."Vinos" where id = '82a51e05-5a64-47cc-92eb-b0fba170310c') then
    v_saltados := array_append(v_saltados, 'Parker 82a51e05-5a64-47cc-92eb-b0fba170310c 2023 (Flor de Pingus 2023)');
  end if;

  -- La Nieta 2024 2024: nueva (no_localizada —)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '465516c9-e18b-40d7-b94b-e0467d9931bf', 2024, false, 'no_localizada', 'no_localizada', null, null, null, false, null, 'Robert Parker Wine Advocate', null, null, null, null, null, null, null, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. No aparece nota RP/WA de La Nieta 2024 (Viñedos de Páganos). El 98 de 2023 no aplica.', 'revision'
   where exists (select 1 from public."Vinos" where id = '465516c9-e18b-40d7-b94b-e0467d9931bf')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Lagar de Cervera 2024 2024: nueva (no_localizada —)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '3cc18639-ab51-49b4-93b2-695edde103ed', 2024, false, 'no_localizada', 'no_localizada', null, null, null, false, null, 'Robert Parker Wine Advocate', null, null, null, null, null, null, null, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Solo Vinous 93, Jeb Dunnuck 93, Decanter 92. Los WA 92 (Lagar de Costa 2024) y 93 (Albamar 2024) son de otros vinos.', 'revision'
   where exists (select 1 from public."Vinos" where id = '3cc18639-ab51-49b4-93b2-695edde103ed')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Marqués de Murrieta Reserva 2021 2021: nueva (revision 95)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '2564cf67-b7d9-4425-9ef5-cb2d39d5bc60', 2021, false, 'revision', null, '95', 95, 95, false, 'Marqués de Murrieta 2021 (Rioja Reserva)', 'Robert Parker Wine Advocate', 'Luis Gutiérrez', '2025-02', 'Marqués de Murrieta (blog de la bodega) / MMD USA (fragmentos de búsqueda)', 'https://marquesdemurrieta.com/blogs/news/marques-de-murrieta-sets-a-new-benchmark-with-its-latest-vintages', 'secundaria', null, '2026-11-10'::date, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Desde 2021 se etiqueta solo ''Marqués de Murrieta'' (antes Reserva). Varias fuentes coinciden en 95 de Gutiérrez. Verificación limitada: créditos de Firecrawl agotados a mitad de la investigación y WebFetch sin acceso a las tiendas; solo visto en fragmentos de búsqueda.', 'revision'
   where exists (select 1 from public."Vinos" where id = '2564cf67-b7d9-4425-9ef5-cb2d39d5bc60')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Otazu (Chardonnay) 2024 2024: nueva (no_localizada —)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select 'f04c83eb-6f74-4cce-bb74-46b4c2a6155d', 2024, false, 'no_localizada', 'no_localizada', null, null, null, false, null, 'Robert Parker Wine Advocate', null, null, null, null, null, null, null, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Sin nota RP/WA. No confundir con Pago de Otazu Chardonnay con Crianza ni Ozu by Otazu.', 'revision'
   where exists (select 1 from public."Vinos" where id = 'f04c83eb-6f74-4cce-bb74-46b4c2a6155d')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Ou Steen 2022 2022: nueva (no_localizada —)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '86850a57-53f5-4b59-b0f6-9e7bdb82a42f', 2022, false, 'no_localizada', 'no_localizada', null, null, null, false, null, 'Robert Parker Wine Advocate', null, null, null, null, null, null, null, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Longridge Ou Steen Chenin Blanc: sin nota RP/WA localizada para 2022.', 'revision'
   where exists (select 1 from public."Vinos" where id = '86850a57-53f5-4b59-b0f6-9e7bdb82a42f')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Pago Santa Cruz 2021 2021: nueva (no_localizada —)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select 'dc67ee11-502b-4b43-8486-ef5ef848af46', 2021, false, 'no_localizada', 'no_localizada', null, null, null, false, null, 'Robert Parker Wine Advocate', null, null, null, null, null, null, null, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Pago de Santa Cruz (Sastre): notas Parker solo de 2011-2012 en Enterwine; nada para 2021.', 'revision'
   where exists (select 1 from public."Vinos" where id = 'dc67ee11-502b-4b43-8486-ef5ef848af46')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Pícaro del Águila 2022 (Magnum) 2022: nueva (revision 94)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '9848ae25-9051-4a7f-bbfc-1474445f39db', 2022, false, 'revision', null, '94', 94, 94, false, 'Dominio del Águila Pícaro (Tinto / Viñas Viejas) 2022', 'Robert Parker Wine Advocate', null, '2024-06', 'J.J. Buckley / PJ Wine / Zachys / Vinissimus (fragmentos de búsqueda)', 'https://www.jjbuckley.com/wine/2022-dominio-del-aguila-picaro-del-aguila-vinas-viejas/2022-1464890-750/', 'secundaria', null, '2026-11-10'::date, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Varias tiendas dan WA 94 al 2022 (J.J. Buckley: Wine Advocate jun 2024). Algunas lo llaman ''Pícaro Tinto'' y otras ''Pícaro del Águila Viñas Viejas''; parecen el mismo vino. El 94+ de 2023 no aplica. Verificación limitada: créditos de Firecrawl agotados a mitad de la investigación y WebFetch sin acceso a las tiendas; solo visto en fragmentos de búsqueda.', 'revision'
   where exists (select 1 from public."Vinos" where id = '9848ae25-9051-4a7f-bbfc-1474445f39db')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Riscal XR 2021 2021: nueva (no_localizada —)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select 'ff35c279-bddb-49c5-800a-1b3f47ded052', 2021, false, 'no_localizada', 'no_localizada', null, null, null, false, null, 'Robert Parker Wine Advocate', null, null, null, null, null, null, null, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Solo Peñín 94/95, Decanter 94, Enterwine 93. Sin nota RP/WA localizada.', 'revision'
   where exists (select 1 from public."Vinos" where id = 'ff35c279-bddb-49c5-800a-1b3f47ded052')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Terras Gauda 2023 2023: nueva (no_localizada —)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '482ba8da-5974-4fae-8a1a-c15d391d5245', 2023, false, 'no_localizada', 'no_localizada', null, null, null, false, null, 'Robert Parker Wine Advocate', null, null, null, null, null, null, null, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Solo Suckling 91 y Vinous 90 para 2023.', 'revision'
   where exists (select 1 from public."Vinos" where id = '482ba8da-5974-4fae-8a1a-c15d391d5245')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Tomás Postigo 5º Año 2020 2020: nueva (no_localizada —)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select 'de8f93b9-5ad5-4097-8878-3e1357340d5a', 2020, false, 'no_localizada', 'no_localizada', null, null, null, false, null, 'Robert Parker Wine Advocate', null, null, null, null, null, null, null, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Sin nota RP/WA localizada.', 'revision'
   where exists (select 1 from public."Vinos" where id = 'de8f93b9-5ad5-4097-8878-3e1357340d5a')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Alión 2020 2020: nueva (verificada 95)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '701d9b3a-35c2-43a5-a613-b041886538a5', 2020, false, 'verificada', null, '95', 95, 95, false, '2020 Vega Sicilia Alion', 'Robert Parker Wine Advocate', 'Luis Gutiérrez', '2024-01', 'JJ Buckley Fine Wines (tienda)', 'https://www.jjbuckley.com/wine/2020-vega-sicilia-alion/2020-7733-750/', 'secundaria', 'WA 95 — Robert Parker''s Wine Advocate, January 2024', '2026-11-10'::date, '[{"fuente_nombre":"Fragmentos de buscador (otros distribuidores)","fuente_url":null,"puntos_texto":"95","nota":"Algunos fechan la nota el 13-06-2024; una ficha mostraba 96 pero parece confusión con la añada 2021."}]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Página abierta (scrape). Crítico (Luis Gutiérrez) tomado de fragmentos de buscador; la página solo muestra ''Robert Parker''s Wine Advocate''. Total Wine también lista WA 95.', 'revision'
   where exists (select 1 from public."Vinos" where id = '701d9b3a-35c2-43a5-a613-b041886538a5')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Áster El Espino 2020 2020: nueva (no_localizada —)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '75bb1e5e-ae7d-4ded-bf22-878858e00355', 2020, false, 'no_localizada', 'no_localizada', null, null, null, false, null, 'Robert Parker Wine Advocate', null, null, null, null, null, null, null, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Solo aparecen James Suckling 93 y un 96 sin crítico identificado. Ficha técnica de La Rioja Alta no accesible.', 'revision'
   where exists (select 1 from public."Vinos" where id = '75bb1e5e-ae7d-4ded-bf22-878858e00355')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Bahía de Dénia 2024 2024: nueva (no_localizada —)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '7962c4ca-25aa-4500-92d4-4c4b038fa269', 2024, false, 'no_localizada', 'no_localizada', null, null, null, false, null, 'Robert Parker Wine Advocate', null, null, null, null, null, null, null, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Solo Peñín 87. El informe WA de Alicante 2026 (Pepe Mendoza etc.) no lo menciona en los fragmentos vistos.', 'revision'
   where exists (select 1 from public."Vinos" where id = '7962c4ca-25aa-4500-92d4-4c4b038fa269')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Bosque de Matasnos 2022 (Magnum) 2022: nueva (no_localizada —)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '387d18c4-a561-4524-9dbe-c53ea3d202f5', 2022, false, 'no_localizada', 'no_localizada', null, null, null, false, null, 'Robert Parker Wine Advocate', null, null, null, null, null, null, null, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Solo notas Parker de añadas 2012-2014 en Enterwine; ninguna WA para 2022.', 'revision'
   where exists (select 1 from public."Vinos" where id = '387d18c4-a561-4524-9dbe-c53ea3d202f5')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Carraovejas Cuesta de las Liebres 2019 2019: nueva (revision 95)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '474b23ff-1c6e-4f6d-b25c-736e0640525d', 2019, false, 'revision', null, '95', 95, 95, false, 'Cuesta de las Liebres 2019 (Pago de Carraovejas)', 'Robert Parker Wine Advocate', null, null, 'Vinissimus (fragmento de buscador)', 'https://vinissimus.com/es/vino/pago-de-carraovejas-cuesta-de-las-liebres', 'secundaria', '95 Parker (ficha 2019, agotada)', '2026-11-10'::date, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Fuente única y dudosa: la nota de cata Parker de esa misma página es de la 2018 (94). Bodeboca reproduce una nota WA de la 2019 (''The top-of-the-range 2019 Cuesta de Las Liebres is pure Tinto Fino…'') sin cifra visible. WebFetch bloqueado por la red de la sesión y créditos de Firecrawl agotados a mitad de la investigación; no se pudo abrir ninguna página para verificar.', 'revision'
   where exists (select 1 from public."Vinos" where id = '474b23ff-1c6e-4f6d-b25c-736e0640525d')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Conde de los Andes 2019 2019: nueva (no_localizada —)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '435c2b95-e7b7-42e7-9314-11d38d082f3f', 2019, false, 'no_localizada', 'no_localizada', null, null, null, false, null, 'Robert Parker Wine Advocate', null, null, null, null, null, null, null, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Blanco (categoría VINOS BLANCOS). Un resumen del buscador atribuía 91 PK a la 2019 en Vinissimus, pero al abrir la página solo aparecen 2015 (90 PK) y 2013 (91 PK); el 91 de 2019 es de Guía Peñín. Decántalo da 93 para 2019 pero de James Suckling. No se halló nota WA de 2019.', 'revision'
   where exists (select 1 from public."Vinos" where id = '435c2b95-e7b7-42e7-9314-11d38d082f3f')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Dom Pérignon Rosé Vintage 2005 2005: revision 93 → verificada 93
  update public.vinos_puntuacion_parker p
     set estado = 'verificada',
         motivo = null,
         puntos_texto = '93',
         puntos_min = 93,
         puntos_max = 93,
         provisional = false,
         vino_evaluado = '2005 Dom Pérignon Rosé',
         entidad = 'Robert Parker Wine Advocate',
         critico = 'William Kelley',
         fecha_valoracion = '2020-04',
         fuente_nombre = 'JJ Buckley Fine Wines (tienda)',
         fuente_url = 'https://www.jjbuckley.com/wine/2005-moet-chandon-dom-perignon-rose/2005-862-750/',
         fuente_tipo = 'secundaria',
         cita = 'WA 93 — Robert Parker''s Wine Advocate, April 2020 … the 2005 Dom Pérignon Rosé is medium to full-bodied, vinous and fleshy … - Dr. William Kelley',
         fecha_consulta = '2026-11-10'::date,
         discrepancias = '[]'::jsonb,
         notas = 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Confirma la fila_actual (93, estaba en revisión). Página abierta con nota de cata y firma de William Kelley.',
         origen = 'revision'
   where p.vino_id = '5f98d412-135b-4f0d-979e-ba7c41162781' and p.clave_anada = 2005 and p.estado = 'revision' and p.puntos_texto is not distinct from '93' and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;
  if n = 0 and not exists (select 1 from public.vinos_puntuacion_parker p
                            where p.vino_id = '5f98d412-135b-4f0d-979e-ba7c41162781' and p.clave_anada = 2005) then
    insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
    select '5f98d412-135b-4f0d-979e-ba7c41162781', 2005, false, 'verificada', null, '93', 93, 93, false, '2005 Dom Pérignon Rosé', 'Robert Parker Wine Advocate', 'William Kelley', '2020-04', 'JJ Buckley Fine Wines (tienda)', 'https://www.jjbuckley.com/wine/2005-moet-chandon-dom-perignon-rose/2005-862-750/', 'secundaria', 'WA 93 — Robert Parker''s Wine Advocate, April 2020 … the 2005 Dom Pérignon Rosé is medium to full-bodied, vinous and fleshy … - Dr. William Kelley', '2026-11-10'::date, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Confirma la fila_actual (93, estaba en revisión). Página abierta con nota de cata y firma de William Kelley.', 'revision'
     where exists (select 1 from public."Vinos" where id = '5f98d412-135b-4f0d-979e-ba7c41162781')
    on conflict (vino_id, clave_anada) do nothing;
    get diagnostics n = row_count;
    v_parker := v_parker + n;
  elsif n = 0 and not exists (select 1 from public.vinos_puntuacion_parker p
                               where p.vino_id = '5f98d412-135b-4f0d-979e-ba7c41162781' and p.clave_anada = 2005 and p.estado = 'verificada' and p.puntos_texto is not distinct from '93' and p.provisional = false)
        and exists (select 1 from public."Vinos" where id = '5f98d412-135b-4f0d-979e-ba7c41162781') then
    v_saltados := array_append(v_saltados, 'Parker 5f98d412-135b-4f0d-979e-ba7c41162781 2005 (Dom Pérignon Rosé Vintage 2005)');
  end if;

  -- Dominio de Calogía Doble M 2020 2020: nueva (no_localizada —)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select 'd9803ec6-fff8-4ea8-a6d6-04d04da64404', 2020, false, 'no_localizada', 'no_localizada', null, null, null, false, null, 'Robert Parker Wine Advocate', null, null, null, null, null, null, null, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Hay WA para el Dominio de Calogía 2020 (vino principal, 93 según Decántalo), que es otro vino. Sin WA para Doble M 2020.', 'revision'
   where exists (select 1 from public."Vinos" where id = 'd9803ec6-fff8-4ea8-a6d6-04d04da64404')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- El Corral de Taruguín 2018 2018: nueva (no_localizada —)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select 'fddf1981-ac0e-406f-9172-536b92f79a19', 2018, false, 'no_localizada', 'referencia_ambigua', null, null, null, false, null, 'Robert Parker Wine Advocate', null, null, null, null, null, null, null, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Bodeboca reproduce una nota WA del ''2018 Taruguín'' (sin cifra visible); no queda claro si es el mismo vino que ''El Corral de Taruguín''.', 'revision'
   where exists (select 1 from public."Vinos" where id = 'fddf1981-ac0e-406f-9172-536b92f79a19')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Gran Reserva 904 (La Rioja Alta) 2015 2015: nueva (revision 95)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select 'b0d47317-673b-4cb2-a787-48081719ba9e', 2015, false, 'revision', null, '95', 95, 95, false, '2015 La Rioja Alta Gran Reserva 904 Selección Especial', 'Robert Parker Wine Advocate', 'Luis Gutiérrez', null, 'Fragmentos de buscador (Bottle Barn y otros distribuidores EE. UU.)', 'https://bottlebarn.com/products/2015-la-rioja-alta-904-gran-reserva-rioja', 'secundaria', '2015 La Rioja Alta 904 Gran Reserva Rioja [JS97][TA96][JG95][WA95][V95]', '2026-11-10'::date, '[{"fuente_nombre":"Un distribuidor (fragmento de buscador)","fuente_url":null,"puntos_texto":"94","nota":"Una ficha lista ''Wine Advocate: 94 Points''; la mayoría dan 95."}]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Fecha dudosa (fragmentos dicen abr-2021 y 14-07-2022). WebFetch bloqueado por la red de la sesión y créditos de Firecrawl agotados a mitad de la investigación; no se pudo abrir ninguna página para verificar.', 'revision'
   where exists (select 1 from public."Vinos" where id = 'b0d47317-673b-4cb2-a787-48081719ba9e')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- La Rioja Alta Gran Reserva 890 2010 2010: nueva (revision 97)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '345729aa-0a2e-464a-bca8-05409784f668', 2010, false, 'revision', null, '97', 97, 97, false, '2010 La Rioja Alta Gran Reserva 890 Selección Especial', 'Robert Parker Wine Advocate', 'Luis Gutiérrez', null, 'Fragmentos de buscador (Bottle Barn, varios distribuidores)', 'https://bottlebarn.com/products/2010-la-rioja-alta-rioja-gran-reserva-890', 'secundaria', '2010 La Rioja Alta RIoja Gran Reserva 890 [JS99][WA97][WS95]', '2026-11-10'::date, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Varias fuentes independientes coinciden en 97 (Luis Gutiérrez). WebFetch bloqueado por la red de la sesión y créditos de Firecrawl agotados a mitad de la investigación; no se pudo abrir ninguna página para verificar.', 'revision'
   where exists (select 1 from public."Vinos" where id = '345729aa-0a2e-464a-bca8-05409784f668')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Lagar de Cervera 2024 (Magnum) 2024: nueva (no_localizada —)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select 'dc364646-e73b-4b4f-8a64-c611abb6cef1', 2024, false, 'no_localizada', 'no_localizada', null, null, null, false, null, 'Robert Parker Wine Advocate', null, null, null, null, null, null, null, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Solo Vinous 93, Halliday 93, Peñín 92.', 'revision'
   where exists (select 1 from public."Vinos" where id = 'dc364646-e73b-4b4f-8a64-c611abb6cef1')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Louis Latour Chablis La Chanfleure 2024 2024: nueva (no_localizada —)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '4d59ef4a-d7b3-45d3-af5a-54f67618f613', 2024, false, 'no_localizada', 'no_localizada', null, null, null, false, null, 'Robert Parker Wine Advocate', null, null, null, null, null, null, null, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Sin puntuación WA encontrada.', 'revision'
   where exists (select 1 from public."Vinos" where id = '4d59ef4a-d7b3-45d3-af5a-54f67618f613')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Marqués de Riscal 150 Aniversario 2017 2017: nueva (no_localizada —)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '0aeba489-b6d1-4d25-884f-dee60eba581b', 2017, false, 'no_localizada', 'no_localizada', null, null, null, false, null, 'Robert Parker Wine Advocate', null, null, null, null, null, null, null, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Ficha de bodega lista Peñín/ABC 97, Wine Enthusiast 95, Proensa 95, Tim Atkin 93, sin WA. Vinissimus muestra ''PARKER 94'' pero no está claro si es de 2017 o 2010. WebFetch bloqueado por la red de la sesión y créditos de Firecrawl agotados a mitad de la investigación; no se pudo abrir ninguna página para verificar.', 'revision'
   where exists (select 1 from public."Vinos" where id = '0aeba489-b6d1-4d25-884f-dee60eba581b')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Otazu Altar 2013 2013: nueva (no_localizada —)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select 'cb629ad3-5ea7-4498-8511-e38c0ff0b21d', 2013, false, 'no_localizada', 'no_localizada', null, null, null, false, null, 'Robert Parker Wine Advocate', null, null, null, null, null, null, null, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Bodeboca reproduce una nota WA (''The 2013 Altar de Otazu comes from a cooler year…'') pero sin cifra visible en los fragmentos. WebFetch bloqueado por la red de la sesión y créditos de Firecrawl agotados a mitad de la investigación; no se pudo abrir ninguna página para verificar.', 'revision'
   where exists (select 1 from public."Vinos" where id = 'cb629ad3-5ea7-4498-8511-e38c0ff0b21d')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Pago de Carraovejas 2023 2023: revision — → revision 92
  update public.vinos_puntuacion_parker p
     set estado = 'revision',
         motivo = null,
         puntos_texto = '92',
         puntos_min = 92,
         puntos_max = 92,
         provisional = false,
         vino_evaluado = '2023 Pago de Carraovejas',
         entidad = 'Robert Parker Wine Advocate',
         critico = 'Luis Gutiérrez',
         fecha_valoracion = null,
         fuente_nombre = 'Grand Cru Wijnen (fragmento de buscador)',
         fuente_url = 'https://www.grandcruwijnen.nl/en/2023-pago-de-carraovejas-magnum',
         fuente_tipo = 'secundaria',
         cita = 'The Wine Advocate RP 92 Reviewed by: Luis Gutiérrez',
         fecha_consulta = '2026-11-10'::date,
         discrepancias = '[{"fuente_nombre":"Enterwine (fragmento)","fuente_url":"https://www.enterwine.com/en/pago-de-carraovejas-2023","puntos_texto":"92","nota":"Coincide; página con URL/añada confusa."}]'::jsonb,
         notas = 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. fila_actual sin puntos (fuentes_contradictorias). Enterwine también muestra ''Parker 92'' para 2023 (URL rotulada 2022). WebFetch bloqueado por la red de la sesión y créditos de Firecrawl agotados a mitad de la investigación; no se pudo abrir ninguna página para verificar.',
         origen = 'revision'
   where p.vino_id = '6064cef2-c768-4c7c-9853-2409ff2b6270' and p.clave_anada = 2023 and p.estado = 'revision' and p.puntos_texto is not distinct from null and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;
  if n = 0 and not exists (select 1 from public.vinos_puntuacion_parker p
                            where p.vino_id = '6064cef2-c768-4c7c-9853-2409ff2b6270' and p.clave_anada = 2023) then
    insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
    select '6064cef2-c768-4c7c-9853-2409ff2b6270', 2023, false, 'revision', null, '92', 92, 92, false, '2023 Pago de Carraovejas', 'Robert Parker Wine Advocate', 'Luis Gutiérrez', null, 'Grand Cru Wijnen (fragmento de buscador)', 'https://www.grandcruwijnen.nl/en/2023-pago-de-carraovejas-magnum', 'secundaria', 'The Wine Advocate RP 92 Reviewed by: Luis Gutiérrez', '2026-11-10'::date, '[{"fuente_nombre":"Enterwine (fragmento)","fuente_url":"https://www.enterwine.com/en/pago-de-carraovejas-2023","puntos_texto":"92","nota":"Coincide; página con URL/añada confusa."}]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. fila_actual sin puntos (fuentes_contradictorias). Enterwine también muestra ''Parker 92'' para 2023 (URL rotulada 2022). WebFetch bloqueado por la red de la sesión y créditos de Firecrawl agotados a mitad de la investigación; no se pudo abrir ninguna página para verificar.', 'revision'
     where exists (select 1 from public."Vinos" where id = '6064cef2-c768-4c7c-9853-2409ff2b6270')
    on conflict (vino_id, clave_anada) do nothing;
    get diagnostics n = row_count;
    v_parker := v_parker + n;
  elsif n = 0 and not exists (select 1 from public.vinos_puntuacion_parker p
                               where p.vino_id = '6064cef2-c768-4c7c-9853-2409ff2b6270' and p.clave_anada = 2023 and p.estado = 'revision' and p.puntos_texto is not distinct from '92' and p.provisional = false)
        and exists (select 1 from public."Vinos" where id = '6064cef2-c768-4c7c-9853-2409ff2b6270') then
    v_saltados := array_append(v_saltados, 'Parker 6064cef2-c768-4c7c-9853-2409ff2b6270 2023 (Pago de Carraovejas 2023)');
  end if;

  -- Pagos de Anguix 2018 2018: nueva (no_localizada —)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '050a3e6d-a114-421e-bd09-d6288441653f', 2018, false, 'no_localizada', 'referencia_ambigua', null, null, null, false, null, 'Robert Parker Wine Advocate', null, null, null, null, null, null, null, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. La bodega tiene varias cuvées (Barrueco, Prado Lobo, 10 meses…); no se identifica cuál es ni hay WA 2018 localizada.', 'revision'
   where exists (select 1 from public."Vinos" where id = '050a3e6d-a114-421e-bd09-d6288441653f')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Pingus 2023 2023: revision 99 → revision 98-100
  update public.vinos_puntuacion_parker p
     set estado = 'revision',
         motivo = 'fuentes_contradictorias',
         puntos_texto = '98-100',
         puntos_min = 98,
         puntos_max = 100,
         provisional = true,
         vino_evaluado = '2023 Dominio de Pingus Pingus',
         entidad = 'Robert Parker Wine Advocate',
         critico = 'Luis Gutiérrez',
         fecha_valoracion = null,
         fuente_nombre = 'Grand Cru Wijnen (fragmento de buscador)',
         fuente_url = 'https://www.grandcruwijnen.nl/en/2023-dominio-de-pingus-pingus-1',
         fuente_tipo = 'secundaria',
         cita = 'Parker The Wine Advocate RP (98-100) Reviewed by: Luis Gutiérrez',
         fecha_consulta = '2026-11-10'::date,
         discrepancias = '[{"fuente_nombre":"Grand Cru Wijnen (otra ficha, fragmento)","fuente_url":"https://www.grandcruwijnen.nl/en/2019-dominio-de-pingus-pingus-4","puntos_texto":"98-99","nota":"Intervalo de barrica distinto en otra ficha de la misma tienda."},{"fuente_nombre":"Millesima USA (fragmento)","fuente_url":"https://www.millesima-usa.com/dominio-de-pingus-pingus-2023.html","puntos_texto":"99","nota":"Muestra 99/100 Luis Gutiérrez junto a un 98-99; posible nota definitiva tras embotellado, no verificada."}]'::jsonb,
         notas = 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. fila_actual (99) dudosa: hay intervalos provisionales 98-100 y 98-99 y un 99 sin confirmar. WebFetch bloqueado por la red de la sesión y créditos de Firecrawl agotados a mitad de la investigación; no se pudo abrir ninguna página para verificar.',
         origen = 'revision'
   where p.vino_id = '2e6a2e86-db54-4f26-937c-77f7f0708fac' and p.clave_anada = 2023 and p.estado = 'revision' and p.puntos_texto is not distinct from '99' and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;
  if n = 0 and not exists (select 1 from public.vinos_puntuacion_parker p
                            where p.vino_id = '2e6a2e86-db54-4f26-937c-77f7f0708fac' and p.clave_anada = 2023) then
    insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
    select '2e6a2e86-db54-4f26-937c-77f7f0708fac', 2023, false, 'revision', 'fuentes_contradictorias', '98-100', 98, 100, true, '2023 Dominio de Pingus Pingus', 'Robert Parker Wine Advocate', 'Luis Gutiérrez', null, 'Grand Cru Wijnen (fragmento de buscador)', 'https://www.grandcruwijnen.nl/en/2023-dominio-de-pingus-pingus-1', 'secundaria', 'Parker The Wine Advocate RP (98-100) Reviewed by: Luis Gutiérrez', '2026-11-10'::date, '[{"fuente_nombre":"Grand Cru Wijnen (otra ficha, fragmento)","fuente_url":"https://www.grandcruwijnen.nl/en/2019-dominio-de-pingus-pingus-4","puntos_texto":"98-99","nota":"Intervalo de barrica distinto en otra ficha de la misma tienda."},{"fuente_nombre":"Millesima USA (fragmento)","fuente_url":"https://www.millesima-usa.com/dominio-de-pingus-pingus-2023.html","puntos_texto":"99","nota":"Muestra 99/100 Luis Gutiérrez junto a un 98-99; posible nota definitiva tras embotellado, no verificada."}]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. fila_actual (99) dudosa: hay intervalos provisionales 98-100 y 98-99 y un 99 sin confirmar. WebFetch bloqueado por la red de la sesión y créditos de Firecrawl agotados a mitad de la investigación; no se pudo abrir ninguna página para verificar.', 'revision'
     where exists (select 1 from public."Vinos" where id = '2e6a2e86-db54-4f26-937c-77f7f0708fac')
    on conflict (vino_id, clave_anada) do nothing;
    get diagnostics n = row_count;
    v_parker := v_parker + n;
  elsif n = 0 and not exists (select 1 from public.vinos_puntuacion_parker p
                               where p.vino_id = '2e6a2e86-db54-4f26-937c-77f7f0708fac' and p.clave_anada = 2023 and p.estado = 'revision' and p.puntos_texto is not distinct from '98-100' and p.provisional = true)
        and exists (select 1 from public."Vinos" where id = '2e6a2e86-db54-4f26-937c-77f7f0708fac') then
    v_saltados := array_append(v_saltados, 'Parker 2e6a2e86-db54-4f26-937c-77f7f0708fac 2023 (Pingus 2023)');
  end if;

  -- Ritus 2020 2020: nueva (no_localizada —)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '453220b5-59f9-4f44-b472-dc7d61be506c', 2020, false, 'no_localizada', 'no_localizada', null, null, null, false, null, 'Robert Parker Wine Advocate', null, null, null, null, null, null, null, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Ritus (Bodegas Balbás): solo medalla Concours Mondial y nota de Suckling; sin WA.', 'revision'
   where exists (select 1 from public."Vinos" where id = '453220b5-59f9-4f44-b472-dc7d61be506c')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Terreus 2019 2019: nueva (no_localizada —)
  insert into public.vinos_puntuacion_parker (vino_id, anada, sin_anada, estado, motivo, puntos_texto, puntos_min, puntos_max, provisional, vino_evaluado, entidad, critico, fecha_valoracion, fuente_nombre, fuente_url, fuente_tipo, cita, fecha_consulta, discrepancias, notas, origen)
  select '8ae1eafd-7999-4180-93dc-362364091af0', 2019, false, 'no_localizada', 'no_localizada', null, null, null, false, null, 'Robert Parker Wine Advocate', null, null, null, null, null, null, null, '[]'::jsonb, 'Revisión 10/11/2026 con la añada de la foto de la etiqueta. Sin WA para 2019 en los resultados (sí referencias a 2020 y 2022).', 'revision'
   where exists (select 1 from public."Vinos" where id = '8ae1eafd-7999-4180-93dc-362364091af0')
  on conflict (vino_id, clave_anada) do nothing;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  raise notice '20261110_vinos_anadas_parker_demo: % vinos cambiados, % ya estaban, % cambios en puntuaciones Parker.', v_vinos, v_ya, v_parker;
  if cardinality(v_saltados) > 0 then
    raise notice '20261110_vinos_anadas_parker_demo: % saltados porque alguien los cambió después (revisar a mano): %',
      cardinality(v_saltados), array_to_string(v_saltados, '; ');
  end if;
end;
$$;

commit;
