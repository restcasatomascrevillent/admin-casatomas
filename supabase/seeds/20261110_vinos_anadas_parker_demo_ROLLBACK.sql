set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261110_vinos_anadas_parker_demo_ROLLBACK
-- VUELTA ATRÁS de 20261110_vinos_anadas_parker_demo.sql
-- Proyecto: sfonaclosuafvlhutkon (demo)
-- ===========================================================================
-- GENERADO por scripts/parker/generar-sql-anadas.mjs a partir de
-- docs/anadas-parker-2026-11-10/cambios.json (informe: INFORME.md en la misma
-- carpeta). No editar a mano: cambiar el JSON y volver a generar.
--
-- 121 vinos (nombre + añada que se sirve) y 75 filas de vinos_puntuacion_parker.
-- Solo deshace las filas que siguen con los valores nuevos; las demás se dejan.
-- Idempotente. Requiere las migraciones 20261118103000 y 20261118110000 (Parker con fuente).
-- Aplicar en el SQL editor de Supabase (o psql), una vez. Termina con un
-- aviso «20261110_vinos_anadas_parker_demo_ROLLBACK: …» con lo que ha cambiado.
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
    raise exception '20261110_vinos_anadas_parker_demo_ROLLBACK: falta la migración 20261118103000_vinos_puntuacion_parker_fuentes. No se ha cambiado nada.';
  end if;

  -- ─── 1. Puntuaciones Parker ───
  -- 912 de Altitud 2023 2023: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '56b33d30-e029-4208-b06d-2c5b47762240' and p.clave_anada = 2023 and p.estado = 'revision' and p.puntos_texto is not distinct from '93+' and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Artadi Valdeginés 2022 2022: vuelve a revision 94
  update public.vinos_puntuacion_parker p
     set estado = 'revision',
         motivo = 'fuentes_contradictorias',
         puntos_texto = '94',
         puntos_min = 94,
         puntos_max = 94,
         provisional = false,
         vino_evaluado = '2022 Artadi Valdeginés',
         entidad = 'Robert Parker Wine Advocate',
         critico = 'Luis Gutiérrez',
         fecha_valoracion = null,
         fuente_nombre = 'Grand Cru Wijnen (tienda, según resumen de WebSearch)',
         fuente_url = 'https://www.grandcruwijnen.nl/en/2022-artadi-valdegines',
         fuente_tipo = 'secundaria',
         cita = 'RP 94 (resumen del buscador; página no abierta)',
         fecha_consulta = '2026-11-08'::date,
         discrepancias = '[{"nota":"''93-94 PARKER'' / ''Parker Points: 93-94''; quizá nota de barrica.","fuente_url":"https://www.bodeboca.com/vino/artadi-valdegines-2022","puntos_texto":"93-94","fuente_nombre":"Bodeboca (según resumen de WebSearch)"}]'::jsonb,
         notas = 'Una ficha da 94 (Luis Gutiérrez) y otra 93-94; podría ser la nota de barrica frente a la del embotellado, pero las fuentes no lo dicen. Sin cita literal de página abierta (Firecrawl sin créditos, red bloqueada). La añada 2021 figura con 94+ (no aplicable).',
         origen = 'revision'
   where p.vino_id = '4763a3d1-6e66-4dc5-9101-649690958baf' and p.clave_anada = 2022 and p.estado = 'verificada' and p.puntos_texto is not distinct from '94' and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Áster El Otero 2018 2018: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '93aa5d5f-97de-494a-9266-4bcf9bc07b74' and p.clave_anada = 2018 and p.estado = 'revision' and p.puntos_texto is not distinct from '95' and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Balbás Ancestral 2020 2020: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '53671e64-4ef1-4264-875d-e66b106018c4' and p.clave_anada = 2020 and p.estado = 'no_localizada' and p.puntos_texto is not distinct from null and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Carraovejas El Anejón 2018 2018: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = 'bf7a0cc1-9eaa-46b5-8c32-4fa4bca55cf1' and p.clave_anada = 2018 and p.estado = 'verificada' and p.puntos_texto is not distinct from '93' and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Dom Pérignon Vintage 2013 2013: vuelve a revision 95+
  update public.vinos_puntuacion_parker p
     set estado = 'revision',
         motivo = null,
         puntos_texto = '95+',
         puntos_min = 95,
         puntos_max = 95,
         provisional = false,
         vino_evaluado = '2013 Dom Pérignon',
         entidad = 'Robert Parker Wine Advocate',
         critico = 'William Kelley',
         fecha_valoracion = '2022-08',
         fuente_nombre = 'Fragmentos de búsqueda (Fine Wine Cellar, Liv-ex)',
         fuente_url = 'https://www.finewinecellar.co.uk/collections/all-wines/products/dom-perignon-2013',
         fuente_tipo = 'secundaria',
         cita = 'William Kelley, Wine Advocate, August 2022 95+ (Fine Wine Cellar, Dom Pérignon 2013); Liv-ex: ''The Wine Advocate''s William Kelley gave the 2013 Dom Pérignon a score of 95+ points.''',
         fecha_consulta = '2026-11-08'::date,
         discrepancias = '[{"nota":"''95 Yohan Castaing, Wine Advocate, April 2023'': segunda reseña WA, misma cifra (95) sin el ''+''. No cambia la cifra.","fuente_url":"https://farrvintners.com/wine.php?preset=3&wine=87999","puntos_texto":"95","fuente_nombre":"Varias tiendas (p. ej. Farr Vintners, Justerini & Brooks)"},{"nota":"Atribuye 94 a WA pero el texto citado es el de Vinous (Galloni): error de la tienda, no vale.","fuente_url":"https://harveynichols.com/dom-perignon/dom-perignon-vintage-champagne-2013-no-box-949427-na-163373","puntos_texto":"94","fuente_nombre":"Harvey Nichols"}]'::jsonb,
         notas = 'Fuente secundaria vista solo en los resultados del buscador (no se abrió la página): ábrela y, si es correcta, pulsa «Confirmar». Fragmentos del buscador web (WebSearch); no se pudo abrir la página (Firecrawl sin créditos, proxy bloquea tiendas). WA tiene dos reseñas: William Kelley 95+ (ago. 2022, en el lanzamiento) y Yohan Castaing 95 (abr. 2023). Las dos dan 95 puntos.',
         origen = 'revision'
   where p.vino_id = '246cd25d-cf75-4eca-b2cb-72d5b5f6fb06' and p.clave_anada = 2013 and p.estado = 'revision' and p.puntos_texto is not distinct from '95' and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Dominio del Águila Reserva 2020 2020: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = 'a62be9fe-cea2-49d1-9dcf-b0a988510afd' and p.clave_anada = 2020 and p.estado = 'revision' and p.puntos_texto is not distinct from '97' and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- El Nido 2023 2023: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '71df1c08-defa-415c-861f-9daa4fb54762' and p.clave_anada = 2023 and p.estado = 'revision' and p.puntos_texto is not distinct from '93' and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- José Pariente Sauvignon Blanc 2024 2024: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = 'b8867cac-a5ae-4b9a-acad-6c498b538739' and p.clave_anada = 2024 and p.estado = 'no_localizada' and p.puntos_texto is not distinct from null and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Laurent‑Perrier Alexandra Rosé 2004 2004: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '4a5bf9d9-d33e-4c58-bc1c-06eff214824f' and p.clave_anada = 2004 and p.estado = 'revision' and p.puntos_texto is not distinct from '95' and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Marqués de Riscal Barón de Chirel 2020 2020: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '8a70d0ed-39df-4f42-86b7-55c74c84872b' and p.clave_anada = 2020 and p.estado = 'no_localizada' and p.puntos_texto is not distinct from null and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Moët & Chandon Grand Vintage 2015 2015: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '7bd2fba7-244e-497c-b9f0-311dc36ec973' and p.clave_anada = 2015 and p.estado = 'revision' and p.puntos_texto is not distinct from '91' and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Otazu Premium Cuvée 2021 2021: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '9c360d96-9ff9-48dc-b2f8-de5694acb00f' and p.clave_anada = 2021 and p.estado = 'no_localizada' and p.puntos_texto is not distinct from null and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Pago de los Capellanes Crianza 2022 2022: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '3a443d48-c2b1-4d4b-ba0e-01ef3652caa4' and p.clave_anada = 2022 and p.estado = 'revision' and p.puntos_texto is not distinct from '91' and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Pazo Barrantes 2020 2020: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '813c4abb-4371-4dad-bc45-9360cf262e59' and p.clave_anada = 2020 and p.estado = 'revision' and p.puntos_texto is not distinct from '94' and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- PSI 2023 2023: vuelve a revision 93-94
  update public.vinos_puntuacion_parker p
     set estado = 'revision',
         motivo = 'fuentes_contradictorias',
         puntos_texto = '93-94',
         puntos_min = 93,
         puntos_max = 94,
         provisional = true,
         vino_evaluado = 'PSI 2023 (Dominio de Pingus)',
         entidad = 'Robert Parker Wine Advocate',
         critico = 'Luis Gutiérrez',
         fecha_valoracion = '2025-06-19',
         fuente_nombre = 'Woodland Hills Wine Company (ficha PSI 2023)',
         fuente_url = 'https://whwc.com/pingus-psi-ribera-del-duero-2023',
         fuente_tipo = 'secundaria',
         cita = '"93-94 points Luis Gutiérrez (Wine Advocate)", reseña fechada 6/19/25 (fragmento de búsqueda).',
         fecha_consulta = '2026-11-08'::date,
         discrepancias = '[{"nota":"Fragmento de búsqueda: PSI 2023 ''Parker 94/100'' (sin crítico ni fecha; podría ser la nota en botella).","fuente_url":"https://www.comptoirdesmillesimes.com/en/pingus/psi-2023-dominio-de-pingus.html","puntos_texto":"94","fuente_nombre":"Comptoir des Millésimes"}]'::jsonb,
         notas = 'Solo fragmentos de búsqueda, obtenidos al buscar Pingus 2023; no se pudo hacer una búsqueda específica de PSI porque se agotaron los créditos de Firecrawl y el cupo de búsquedas web. La nota de junio de 2025 es un intervalo (probable muestra previa al embotellado); 94 podría ser la nota definitiva, sin confirmar.',
         origen = 'revision'
   where p.vino_id = 'e59baae8-5310-4264-80f0-31bb3f1e7bfb' and p.clave_anada = 2023 and p.estado = 'revision' and p.puntos_texto is not distinct from '94' and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Tomás Postigo 2022 2022: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '06bf9660-61b1-48ae-8032-5cbaf982d894' and p.clave_anada = 2022 and p.estado = 'no_localizada' and p.puntos_texto is not distinct from null and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Aaltos Blanco 2023 2023: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '0b790f1a-03da-4f83-9c24-a6f0ab600b5a' and p.clave_anada = 2023 and p.estado = 'verificada' and p.puntos_texto is not distinct from '93' and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Arzuaga 2022 2022: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = 'aee0f9a6-4587-4690-b8a0-d188c1e4f736' and p.clave_anada = 2022 and p.estado = 'revision' and p.puntos_texto is not distinct from '89' and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Áster Otero 2018 (Magnum) 2018: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = 'c0d22e63-dfea-45d1-a6c4-080a16a6b8f2' and p.clave_anada = 2018 and p.estado = 'no_localizada' and p.puntos_texto is not distinct from null and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Bermejos (Lanzarote) 2025 2025: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '1214516e-edd2-4323-a044-12892572deb3' and p.clave_anada = 2025 and p.estado = 'no_localizada' and p.puntos_texto is not distinct from null and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Carraovejas El Anejón 2018 (Magnum) 2018: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '6278535b-bf41-4387-b017-9d77e51d4ab8' and p.clave_anada = 2018 and p.estado = 'verificada' and p.puntos_texto is not distinct from '93' and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Dominio de Calogía 2020 2020: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = 'b550e328-7b1b-4e5b-8442-1d8b5161e771' and p.clave_anada = 2020 and p.estado = 'revision' and p.puntos_texto is not distinct from '93' and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Dominio del Pidio 2021 2021: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '27696aa0-c54f-4baa-a65a-cd0442de84bb' and p.clave_anada = 2021 and p.estado = 'revision' and p.puntos_texto is not distinct from '94' and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Fefiñanes 2024 2024: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = 'a21f8826-79e1-4662-9d9a-a0ac445a2e11' and p.clave_anada = 2024 and p.estado = 'no_localizada' and p.puntos_texto is not distinct from null and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- L. Beyer Gewurz Comtes d'Eguisheim 2009 2009: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = 'b54dca1f-4030-4af3-94c4-733806de0b7d' and p.clave_anada = 2009 and p.estado = 'no_localizada' and p.puntos_texto is not distinct from null and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Ladoucette Pouilly‑Fumé 2022 2022: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '6e0f4e55-cb21-4fd0-b112-acd103405948' and p.clave_anada = 2022 and p.estado = 'no_localizada' and p.puntos_texto is not distinct from null and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Martelo 2019 2019: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '0bf32fa1-51aa-45af-9882-a11fc391b509' and p.clave_anada = 2019 and p.estado = 'revision' and p.puntos_texto is not distinct from '94' and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Moët Grand Vintage Rosé 2015 2015: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '46f035f1-b2ca-4a69-b607-1806a93c6e8b' and p.clave_anada = 2015 and p.estado = 'revision' and p.puntos_texto is not distinct from '91' and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Otazu Rosado 2024 2024: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '0e14f46c-85fb-4f93-9890-ca8e7e15e869' and p.clave_anada = 2024 and p.estado = 'no_localizada' and p.puntos_texto is not distinct from null and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Pago de los Capellanes Crianza 2022 (Magnum) 2022: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = 'e895f569-8a83-4f1d-ab48-03f86a4d9c6b' and p.clave_anada = 2022 and p.estado = 'no_localizada' and p.puntos_texto is not distinct from null and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Pícaro del Águila 2022 2022: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '0628c633-b086-40f6-bcb7-125f64081d4b' and p.clave_anada = 2022 and p.estado = 'revision' and p.puntos_texto is not distinct from '94' and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- PSI 2021 (Magnum) 2021: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = 'c9903817-6d30-4d69-a96f-0cdc8bbf8495' and p.clave_anada = 2021 and p.estado = 'revision' and p.puntos_texto is not distinct from '93+' and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Sierra Cantabria Colección Privada 2021 2021: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '4f2bdba3-9850-4a7d-aa56-fb406a2f3424' and p.clave_anada = 2021 and p.estado = 'revision' and p.puntos_texto is not distinct from '94' and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Tomás Postigo 2022 (Magnum) 2022: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '8cfcfafc-fcef-4ba5-ac7f-f5fcc850c23e' and p.clave_anada = 2022 and p.estado = 'no_localizada' and p.puntos_texto is not distinct from null and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Abadía Retuerta Selección Especial 2019 2019: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '6cce52a0-2fc7-48d3-8801-29ea2073e3b2' and p.clave_anada = 2019 and p.estado = 'verificada' and p.puntos_texto is not distinct from '92' and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Arzuaga Gran Reserva 2018 2018: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '4171e534-9b36-400f-8304-925460ed3a89' and p.clave_anada = 2018 and p.estado = 'no_localizada' and p.puntos_texto is not distinct from null and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Ausàs Interpretación 2018 2018: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '57cf57dc-6ce5-4407-adbb-d3d337bf1544' and p.clave_anada = 2018 and p.estado = 'verificada' and p.puntos_texto is not distinct from '95' and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Bosque de Matasnos 2022 2022: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '8b2d10a2-c778-4233-980d-ebb94db71ce4' and p.clave_anada = 2022 and p.estado = 'no_localizada' and p.puntos_texto is not distinct from null and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Carraovejas 2023 (Magnum) 2023: vuelve a revision 92
  update public.vinos_puntuacion_parker p
     set estado = 'revision',
         motivo = 'fuentes_contradictorias',
         puntos_texto = '92',
         puntos_min = 92,
         puntos_max = 92,
         provisional = false,
         vino_evaluado = '2023 Pago de Carraovejas',
         entidad = 'Robert Parker Wine Advocate',
         critico = null,
         fecha_valoracion = null,
         fuente_nombre = 'Enterwine (tienda, según resumen de WebSearch)',
         fuente_url = 'https://www.enterwine.com/en/pago-de-carraovejas-2023',
         fuente_tipo = 'secundaria',
         cita = 'Parker''s Score 92 (resumen del buscador; página no abierta)',
         fecha_consulta = '2026-11-08'::date,
         discrepancias = '[{"nota":"Ficha 2023 (magnum) con ''The Wine Advocate RP 92, Luis Gutiérrez'', pero el texto de la reseña habla del 2022: probable nota de la añada anterior.","fuente_url":"https://www.grandcruwijnen.nl/en/2023-pago-de-carraovejas-magnum","puntos_texto":"92","fuente_nombre":"Grand Cru Wijnen (según resumen de WebSearch)"},{"nota":"Distintivo ''93 PARKER'' junto a la ficha 2023, pero la reseña (Luis Gutiérrez, 31/1/2023) es de la añada 2020: es la nota de otra añada.","fuente_url":"https://www.vinissimus.com/es/vino/pago-de-carraovejas/","puntos_texto":"93","fuente_nombre":"Vinissimus (según resumen de WebSearch)"}]'::jsonb,
         notas = 'No hay ninguna fuente que ligue claramente una nota WA a la añada 2023. El 93 cargado parece venir de la ficha de Vinissimus, cuya reseña es de la añada 2020. Kysela da JD 95 y Suckling 92 para 2023 (no valen). Magnum: misma nota que la botella. Páginas no abiertas (Firecrawl sin créditos, red bloqueada). Pago de Carraovejas ≠ Cuesta de las Liebres ≠ El Anejón.',
         origen = 'revision'
   where p.vino_id = '540c1075-8c8e-4a70-9fe7-d499b293741d' and p.clave_anada = 2023 and p.estado = 'verificada' and p.puntos_texto is not distinct from '92' and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Dom Pérignon Plénitude 2 (2002) 2002: vuelve a revision 96
  update public.vinos_puntuacion_parker p
     set estado = 'revision',
         motivo = 'fuentes_contradictorias',
         puntos_texto = '96',
         puntos_min = 96,
         puntos_max = 96,
         provisional = false,
         vino_evaluado = '2002 Dom Pérignon P2',
         entidad = 'Robert Parker Wine Advocate',
         critico = 'William Kelley',
         fecha_valoracion = '2019-03',
         fuente_nombre = 'Fragmentos de búsqueda (Zachys, Morrell Wine, Pogo''s Wine)',
         fuente_url = 'https://www.zachys.com/products/dom-perignon-p2-2002-750ml',
         fuente_tipo = 'secundaria',
         cita = '96 Points, William Kelley, Robert Parker''s Wine Advocate (Zachys, Dom Pérignon P2 2002); reseña de marzo 2019: ''still a youthful wine, but it is beginning to develop appreciable complexity''',
         fecha_consulta = '2026-11-08'::date,
         discrepancias = '[{"nota":"Atribuyen ''Wine Advocate: 95 Points'' al P2 2002 (posible reseña anterior de WA, sin fecha ni crítico en el fragmento).","fuente_url":"https://www.wineandcheeseplace.com/wines/Moet-and-Chandon-Dom-Perignon-P2-Plenitude-Brut-2002-w4863652t9","puntos_texto":"95","fuente_nombre":"Wine and Cheese Place / Lincoln Fine Wines / zyn.ca"},{"nota":"Título ''Robert Parker rating: 95''; la página mezcla varios productos (también aparece 92), poco fiable.","fuente_url":"https://www.hedonism.co.uk/product/dom-perignon-p2-2002","puntos_texto":"95 / 92","fuente_nombre":"Hedonism"}]'::jsonb,
         notas = 'Fragmentos del buscador web (WebSearch); no se pudo abrir ninguna página (Firecrawl sin créditos y proxy que bloquea tiendas/robertparker.com). Probablemente WA publicó dos reseñas (una de 95, anterior, y la de William Kelley de 96 en mar. 2019), pero no se ha podido confirmar a qué reseña corresponde el 95.',
         origen = 'revision'
   where p.vino_id = '1d2c19d4-9d36-4531-ad0a-4824109b43de' and p.clave_anada = 2002 and p.estado = 'revision' and p.puntos_texto is not distinct from '95' and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Dominio de Calogía 2020 (Magnum) 2020: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = 'c845e388-6954-4b1f-b5dc-36064f06043f' and p.clave_anada = 2020 and p.estado = 'revision' and p.puntos_texto is not distinct from '93' and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- El Canto de la Alondra 2022 2022: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '5a6e9fa1-4a16-48e9-9201-0c9452ac35ba' and p.clave_anada = 2022 and p.estado = 'no_localizada' and p.puntos_texto is not distinct from null and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Fefiñanes 2024 (Magnum) 2024: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '869f78bc-2994-49a7-88b3-c5eec414b6df' and p.clave_anada = 2024 and p.estado = 'no_localizada' and p.puntos_texto is not distinct from null and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Flor de Pingus 2023 2023: vuelve a revision 93-94
  update public.vinos_puntuacion_parker p
     set estado = 'revision',
         motivo = 'fuentes_contradictorias',
         puntos_texto = '93-94',
         puntos_min = 93,
         puntos_max = 94,
         provisional = false,
         vino_evaluado = 'Dominio de Pingus 2023 ''Flor de Pingus''',
         entidad = 'Robert Parker Wine Advocate',
         critico = 'Luis Gutiérrez',
         fecha_valoracion = '2025-06-19',
         fuente_nombre = 'Creamwine / 67Wine / K&L (1,5 L) (fragmentos de búsqueda)',
         fuente_url = 'https://creamwine.com/product.php?id=22806',
         fuente_tipo = 'secundaria',
         cita = '93-94 PARKER [2023]; 95TA 94-95VN 93-94RP',
         fecha_consulta = '2026-11-08'::date,
         discrepancias = '[{"nota":"La ficha de 750 ml muestra Wine Advocate 95 (''95+ points'', LG, 06/2025), mientras la ficha de 1,5 L de la misma tienda (https://www.klwines.com/products/details/1956428) da 93-94 RP con reseña de 06/2025.","fuente_url":"https://www.klwines.com/products/details/1954671","puntos_texto":"95 / 95+","fuente_nombre":"K&L Wine Merchants (750 ml)"},{"nota":"Tabla de añadas: ''2023 95 Parker''.","fuente_url":"https://www.decantalo.com/cy/en/flor-de-pingus.html","puntos_texto":"95","fuente_nombre":"Decántalo"}]'::jsonb,
         notas = 'Mayoría de fuentes (Creamwine con fecha 19/06/2025, 67Wine, K&L 1,5 L, varias tiendas) dan 93-94 de Luis Gutiérrez; la reseña describe un vino ''pretty, juicy, ripe and approachable, less serious than the 2022''. Un rango así suele indicar vino sin terminar, pero ninguna fuente lo dice expresamente, por eso provisional=false. El 95 aparece solo en K&L 750 ml y en la tabla de Decántalo. No pude abrir robertparker.com (red bloqueada).',
         origen = 'revision'
   where p.vino_id = '82a51e05-5a64-47cc-92eb-b0fba170310c' and p.clave_anada = 2023 and p.estado = 'revision' and p.puntos_texto is not distinct from '93-94' and p.provisional = true;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- La Nieta 2024 2024: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '465516c9-e18b-40d7-b94b-e0467d9931bf' and p.clave_anada = 2024 and p.estado = 'no_localizada' and p.puntos_texto is not distinct from null and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Lagar de Cervera 2024 2024: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '3cc18639-ab51-49b4-93b2-695edde103ed' and p.clave_anada = 2024 and p.estado = 'no_localizada' and p.puntos_texto is not distinct from null and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Marqués de Murrieta Reserva 2021 2021: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '2564cf67-b7d9-4425-9ef5-cb2d39d5bc60' and p.clave_anada = 2021 and p.estado = 'revision' and p.puntos_texto is not distinct from '95' and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Otazu (Chardonnay) 2024 2024: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = 'f04c83eb-6f74-4cce-bb74-46b4c2a6155d' and p.clave_anada = 2024 and p.estado = 'no_localizada' and p.puntos_texto is not distinct from null and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Ou Steen 2022 2022: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '86850a57-53f5-4b59-b0f6-9e7bdb82a42f' and p.clave_anada = 2022 and p.estado = 'no_localizada' and p.puntos_texto is not distinct from null and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Pago Santa Cruz 2021 2021: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = 'dc67ee11-502b-4b43-8486-ef5ef848af46' and p.clave_anada = 2021 and p.estado = 'no_localizada' and p.puntos_texto is not distinct from null and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Pícaro del Águila 2022 (Magnum) 2022: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '9848ae25-9051-4a7f-bbfc-1474445f39db' and p.clave_anada = 2022 and p.estado = 'revision' and p.puntos_texto is not distinct from '94' and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Riscal XR 2021 2021: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = 'ff35c279-bddb-49c5-800a-1b3f47ded052' and p.clave_anada = 2021 and p.estado = 'no_localizada' and p.puntos_texto is not distinct from null and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Terras Gauda 2023 2023: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '482ba8da-5974-4fae-8a1a-c15d391d5245' and p.clave_anada = 2023 and p.estado = 'no_localizada' and p.puntos_texto is not distinct from null and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Tomás Postigo 5º Año 2020 2020: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = 'de8f93b9-5ad5-4097-8878-3e1357340d5a' and p.clave_anada = 2020 and p.estado = 'no_localizada' and p.puntos_texto is not distinct from null and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Alión 2020 2020: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '701d9b3a-35c2-43a5-a613-b041886538a5' and p.clave_anada = 2020 and p.estado = 'verificada' and p.puntos_texto is not distinct from '95' and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Áster El Espino 2020 2020: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '75bb1e5e-ae7d-4ded-bf22-878858e00355' and p.clave_anada = 2020 and p.estado = 'no_localizada' and p.puntos_texto is not distinct from null and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Bahía de Dénia 2024 2024: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '7962c4ca-25aa-4500-92d4-4c4b038fa269' and p.clave_anada = 2024 and p.estado = 'no_localizada' and p.puntos_texto is not distinct from null and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Bosque de Matasnos 2022 (Magnum) 2022: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '387d18c4-a561-4524-9dbe-c53ea3d202f5' and p.clave_anada = 2022 and p.estado = 'no_localizada' and p.puntos_texto is not distinct from null and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Carraovejas Cuesta de las Liebres 2019 2019: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '474b23ff-1c6e-4f6d-b25c-736e0640525d' and p.clave_anada = 2019 and p.estado = 'revision' and p.puntos_texto is not distinct from '95' and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Conde de los Andes 2019 2019: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '435c2b95-e7b7-42e7-9314-11d38d082f3f' and p.clave_anada = 2019 and p.estado = 'no_localizada' and p.puntos_texto is not distinct from null and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Dom Pérignon Rosé Vintage 2005 2005: vuelve a revision 93
  update public.vinos_puntuacion_parker p
     set estado = 'revision',
         motivo = null,
         puntos_texto = '93',
         puntos_min = 93,
         puntos_max = 93,
         provisional = false,
         vino_evaluado = '2005 Moët & Chandon Dom Pérignon Rosé',
         entidad = 'Robert Parker Wine Advocate',
         critico = 'William Kelley',
         fecha_valoracion = null,
         fuente_nombre = 'Fragmentos de búsqueda (J.J. Buckley, Sokolin, Hedonism)',
         fuente_url = 'https://www.jjbuckley.com/wine/2005-moet-chandon-dom-perignon-rose/2005-862-750/',
         fuente_tipo = 'secundaria',
         cita = '2005 Moet Chandon Dom Perignon Rose ... Robert Parker''s Wine Advocate is more reserved at 93 points, but still clearly positive',
         fecha_consulta = '2026-11-08'::date,
         discrepancias = '[{"nota":"El título dice ''Robert Parker rating: 93'', pero la página mezcla varios productos y también muestra 94 RP; probablemente de otra añada o formato.","fuente_url":"https://hedonism.co.uk/product/dom-perignon-rose-magnum-2005","puntos_texto":"93 / 94","fuente_nombre":"Hedonism (magnum 2005)"}]'::jsonb,
         notas = 'Fuente secundaria vista solo en los resultados del buscador (no se abrió la página): ábrela y, si es correcta, pulsa «Confirmar». Fragmentos del buscador web (WebSearch); no se pudo abrir la página (Firecrawl sin créditos, proxy bloquea tiendas). J.J. Buckley (que atribuye la reseña a William Kelley), Sokolin (''93 RP'') y Hedonism coinciden en 93. Las notas de 99 (Suckling), 96 (Falstaff) y 94 (Vinous) no valen.',
         origen = 'revision'
   where p.vino_id = '5f98d412-135b-4f0d-979e-ba7c41162781' and p.clave_anada = 2005 and p.estado = 'verificada' and p.puntos_texto is not distinct from '93' and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Dominio de Calogía Doble M 2020 2020: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = 'd9803ec6-fff8-4ea8-a6d6-04d04da64404' and p.clave_anada = 2020 and p.estado = 'no_localizada' and p.puntos_texto is not distinct from null and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- El Corral de Taruguín 2018 2018: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = 'fddf1981-ac0e-406f-9172-536b92f79a19' and p.clave_anada = 2018 and p.estado = 'no_localizada' and p.puntos_texto is not distinct from null and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Gran Reserva 904 (La Rioja Alta) 2015 2015: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = 'b0d47317-673b-4cb2-a787-48081719ba9e' and p.clave_anada = 2015 and p.estado = 'revision' and p.puntos_texto is not distinct from '95' and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- La Rioja Alta Gran Reserva 890 2010 2010: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '345729aa-0a2e-464a-bca8-05409784f668' and p.clave_anada = 2010 and p.estado = 'revision' and p.puntos_texto is not distinct from '97' and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Lagar de Cervera 2024 (Magnum) 2024: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = 'dc364646-e73b-4b4f-8a64-c611abb6cef1' and p.clave_anada = 2024 and p.estado = 'no_localizada' and p.puntos_texto is not distinct from null and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Louis Latour Chablis La Chanfleure 2024 2024: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '4d59ef4a-d7b3-45d3-af5a-54f67618f613' and p.clave_anada = 2024 and p.estado = 'no_localizada' and p.puntos_texto is not distinct from null and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Marqués de Riscal 150 Aniversario 2017 2017: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '0aeba489-b6d1-4d25-884f-dee60eba581b' and p.clave_anada = 2017 and p.estado = 'no_localizada' and p.puntos_texto is not distinct from null and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Otazu Altar 2013 2013: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = 'cb629ad3-5ea7-4498-8511-e38c0ff0b21d' and p.clave_anada = 2013 and p.estado = 'no_localizada' and p.puntos_texto is not distinct from null and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Pago de Carraovejas 2023 2023: vuelve a revision —
  update public.vinos_puntuacion_parker p
     set estado = 'revision',
         motivo = 'fuentes_contradictorias',
         puntos_texto = null,
         puntos_min = null,
         puntos_max = null,
         provisional = false,
         vino_evaluado = 'Pago de Carraovejas 2023',
         entidad = 'Robert Parker Wine Advocate',
         critico = null,
         fecha_valoracion = null,
         fuente_nombre = 'Decántalo / Vinissimus / Grand Cru Wijnen (fragmentos de búsqueda)',
         fuente_url = 'https://www.grandcruwijnen.nl/en/2023-pago-de-carraovejas-magnum',
         fuente_tipo = 'secundaria',
         cita = 'Grand Cru Wijnen, ficha 2023 Magnum: "The Wine Advocate RP 92 Reviewed by: Luis Gutiérrez" (fragmento de búsqueda; según el mismo resultado, la ficha 2022 muestra también RP 92 de Gutiérrez, por lo que puede ser la nota de 2022 arrastrada).',
         fecha_consulta = '2026-11-08'::date,
         discrepancias = '[{"nota":"Fragmento de búsqueda: ''2023 92 Suckling 93 Parker'' (sin crítico ni fecha).","fuente_url":"https://www.decantalo.com/us/en/pago-de-carraovejas.html","puntos_texto":"93","fuente_nombre":"Decántalo"},{"nota":"Fragmento: ''93 puntos Parker (2023), 92 (2022), 93+ (2021) y 93 (2020)''; otro resultado indica que la reseña adjunta en la ficha es ''Robert Parker Wine Advocate Añada 2020 - 93 PARKER'' fechada 31/1/2023, posible nota de 2020 arrastrada.","fuente_url":"https://www.vinissimus.com/es/vino/pago-de-carraovejas/","puntos_texto":"93","fuente_nombre":"Vinissimus"},{"nota":"Ficha 2023 Magnum: ''The Wine Advocate RP 92 Reviewed by: Luis Gutiérrez''.","fuente_url":"https://www.grandcruwijnen.nl/en/2023-pago-de-carraovejas-magnum","puntos_texto":"92","fuente_nombre":"Grand Cru Wijnen"}]'::jsonb,
         notas = 'Wine-Searcher 2023 (abierto antes de agotarse Firecrawl) muestra James Suckling (oculta), Tim Atkin 93 y CellarTracker 91, sin Wine Advocate visible (una de las 4 notas no se muestra). En robertparker.com no aparece reseña de la añada 2023 en buscador (hay un informe ''Spain: 2026 Update on the Wines from the Duero, with a Focus on 2023 and 2024'' tras muro de pago). Firecrawl agotó créditos y robertparker.com/wine-searcher/tiendas están bloqueados por la red; solo se pudieron ver fragmentos de búsqueda. El 93 cargado coincide con Tim Atkin 93 y con tiendas que podrían arrastrar la nota WA de 2020 (93).',
         origen = 'revision'
   where p.vino_id = '6064cef2-c768-4c7c-9853-2409ff2b6270' and p.clave_anada = 2023 and p.estado = 'revision' and p.puntos_texto is not distinct from '92' and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Pagos de Anguix 2018 2018: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '050a3e6d-a114-421e-bd09-d6288441653f' and p.clave_anada = 2018 and p.estado = 'no_localizada' and p.puntos_texto is not distinct from null and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Pingus 2023 2023: vuelve a revision 99
  update public.vinos_puntuacion_parker p
     set estado = 'revision',
         motivo = 'fuentes_contradictorias',
         puntos_texto = '99',
         puntos_min = 99,
         puntos_max = 99,
         provisional = false,
         vino_evaluado = 'Pingus 2023 (Dominio de Pingus)',
         entidad = 'Robert Parker Wine Advocate',
         critico = 'Luis Gutiérrez',
         fecha_valoracion = null,
         fuente_nombre = 'Millesima USA (ficha Pingus 2023)',
         fuente_url = 'https://www.millesima-usa.com/dominio-de-pingus-pingus-2023.html',
         fuente_tipo = 'secundaria',
         cita = 'Millesima: 99/100 Robert Parker Wine Advocate, Luis Gutiérrez: "7,200 bottles produced. It was bottled in May 2025." (fragmento de búsqueda; la cabecera de la misma ficha muestra 98-99).',
         fecha_consulta = '2026-11-08'::date,
         discrepancias = '[{"nota":"Una ficha 2023 da ''Parker rating 99''; otra da ''Parker The Wine Advocate RP (98-100) Reviewed by: Luis Gutiérrez'' (nota de barrica).","fuente_url":"https://www.grandcruwijnen.nl/en/2023-dominio-de-pingus-pingus-1","puntos_texto":"99 / (98-100)","fuente_nombre":"Grand Cru Wijnen"},{"nota":"''Points Parker: 98-99'' (probable nota de barrica).","fuente_url":"https://www.gourmethunters.com/en_US/Pingus+2023","puntos_texto":"98-99","fuente_nombre":"Gourmet Hunters / Wine Decider / cabecera de Millesima"}]'::jsonb,
         notas = 'Solo fragmentos de búsqueda (Firecrawl sin créditos; robertparker.com y tiendas bloqueadas por la red). Parece haber una nota de barrica (98-99 o 98-100) y una nota en botella de 99 (la reseña con 99 menciona el embotellado en mayo de 2025). robertparker.com: el 2023 Pingus figura en ''Spain: 2026 Update on the Wines from the Duero, with a Focus on 2023 and 2024'' (tras muro de pago), sin ver la nota.',
         origen = 'revision'
   where p.vino_id = '2e6a2e86-db54-4f26-937c-77f7f0708fac' and p.clave_anada = 2023 and p.estado = 'revision' and p.puntos_texto is not distinct from '98-100' and p.provisional = true;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Ritus 2020 2020: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '453220b5-59f9-4f44-b472-dc7d61be506c' and p.clave_anada = 2020 and p.estado = 'no_localizada' and p.puntos_texto is not distinct from null and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- Terreus 2019 2019: se borra la fila nueva
  delete from public.vinos_puntuacion_parker p
   where p.vino_id = '8ae1eafd-7999-4180-93dc-362364091af0' and p.clave_anada = 2019 and p.estado = 'no_localizada' and p.puntos_texto is not distinct from null and p.provisional = false;
  get diagnostics n = row_count;
  v_parker := v_parker + n;

  -- ─── 2. Nombre y añada anteriores ───
  -- 912 de Altitud 2023 → 912 de Altitud
  update public."Vinos"
     set nombre = '912 de Altitud',
         anada = null,
         sin_anada = false
   where id = '56b33d30-e029-4208-b06d-2c5b47762240'
     and nombre = '912 de Altitud 2023'
     and anada is not distinct from 2023
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '56b33d30-e029-4208-b06d-2c5b47762240' and nombre = '912 de Altitud'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '56b33d30-e029-4208-b06d-2c5b47762240') then v_saltados := array_append(v_saltados, '56b33d30-e029-4208-b06d-2c5b47762240 (912 de Altitud 2023)');
  end if;

  -- Aalto PS 2022 → Aalto PS
  update public."Vinos"
     set nombre = 'Aalto PS',
         anada = null,
         sin_anada = false
   where id = '43187593-0677-4f4b-9583-a3838dabd7f2'
     and nombre = 'Aalto PS 2022'
     and anada is not distinct from 2022
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '43187593-0677-4f4b-9583-a3838dabd7f2' and nombre = 'Aalto PS'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '43187593-0677-4f4b-9583-a3838dabd7f2') then v_saltados := array_append(v_saltados, '43187593-0677-4f4b-9583-a3838dabd7f2 (Aalto PS 2022)');
  end if;

  -- Aaltos Blanco 2023 → Aaltos Blanco
  update public."Vinos"
     set nombre = 'Aaltos Blanco',
         anada = null,
         sin_anada = false
   where id = '0b790f1a-03da-4f83-9c24-a6f0ab600b5a'
     and nombre = 'Aaltos Blanco 2023'
     and anada is not distinct from 2023
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '0b790f1a-03da-4f83-9c24-a6f0ab600b5a' and nombre = 'Aaltos Blanco'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '0b790f1a-03da-4f83-9c24-a6f0ab600b5a') then v_saltados := array_append(v_saltados, '0b790f1a-03da-4f83-9c24-a6f0ab600b5a (Aaltos Blanco 2023)');
  end if;

  -- Abadía Retuerta Selección Especial 2019 → Abadía Retuerta Selección Especial
  update public."Vinos"
     set nombre = 'Abadía Retuerta Selección Especial',
         anada = null,
         sin_anada = false
   where id = '6cce52a0-2fc7-48d3-8801-29ea2073e3b2'
     and nombre = 'Abadía Retuerta Selección Especial 2019'
     and anada is not distinct from 2019
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '6cce52a0-2fc7-48d3-8801-29ea2073e3b2' and nombre = 'Abadía Retuerta Selección Especial'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '6cce52a0-2fc7-48d3-8801-29ea2073e3b2') then v_saltados := array_append(v_saltados, '6cce52a0-2fc7-48d3-8801-29ea2073e3b2 (Abadía Retuerta Selección Especial 2019)');
  end if;

  -- Alión 2020 → Alión
  update public."Vinos"
     set nombre = 'Alión',
         anada = null,
         sin_anada = false
   where id = '701d9b3a-35c2-43a5-a613-b041886538a5'
     and nombre = 'Alión 2020'
     and anada is not distinct from 2020
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '701d9b3a-35c2-43a5-a613-b041886538a5' and nombre = 'Alión'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '701d9b3a-35c2-43a5-a613-b041886538a5') then v_saltados := array_append(v_saltados, '701d9b3a-35c2-43a5-a613-b041886538a5 (Alión 2020)');
  end if;

  -- Artadi Valdeginés 2022 → Artadi Valdeginés
  update public."Vinos"
     set nombre = 'Artadi Valdeginés',
         anada = null,
         sin_anada = false
   where id = '4763a3d1-6e66-4dc5-9101-649690958baf'
     and nombre = 'Artadi Valdeginés 2022'
     and anada is not distinct from 2022
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '4763a3d1-6e66-4dc5-9101-649690958baf' and nombre = 'Artadi Valdeginés'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '4763a3d1-6e66-4dc5-9101-649690958baf') then v_saltados := array_append(v_saltados, '4763a3d1-6e66-4dc5-9101-649690958baf (Artadi Valdeginés 2022)');
  end if;

  -- Arzuaga 2022 → Arzuaga
  update public."Vinos"
     set nombre = 'Arzuaga',
         anada = null,
         sin_anada = false
   where id = 'aee0f9a6-4587-4690-b8a0-d188c1e4f736'
     and nombre = 'Arzuaga 2022'
     and anada is not distinct from 2022
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'aee0f9a6-4587-4690-b8a0-d188c1e4f736' and nombre = 'Arzuaga'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'aee0f9a6-4587-4690-b8a0-d188c1e4f736') then v_saltados := array_append(v_saltados, 'aee0f9a6-4587-4690-b8a0-d188c1e4f736 (Arzuaga 2022)');
  end if;

  -- Arzuaga Gran Reserva 2018 → Arzuaga Gran Reserva
  update public."Vinos"
     set nombre = 'Arzuaga Gran Reserva',
         anada = null,
         sin_anada = false
   where id = '4171e534-9b36-400f-8304-925460ed3a89'
     and nombre = 'Arzuaga Gran Reserva 2018'
     and anada is not distinct from 2018
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '4171e534-9b36-400f-8304-925460ed3a89' and nombre = 'Arzuaga Gran Reserva'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '4171e534-9b36-400f-8304-925460ed3a89') then v_saltados := array_append(v_saltados, '4171e534-9b36-400f-8304-925460ed3a89 (Arzuaga Gran Reserva 2018)');
  end if;

  -- Áster El Espino 2020 → Áster El Espino
  update public."Vinos"
     set nombre = 'Áster El Espino',
         anada = null,
         sin_anada = false
   where id = '75bb1e5e-ae7d-4ded-bf22-878858e00355'
     and nombre = 'Áster El Espino 2020'
     and anada is not distinct from 2020
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '75bb1e5e-ae7d-4ded-bf22-878858e00355' and nombre = 'Áster El Espino'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '75bb1e5e-ae7d-4ded-bf22-878858e00355') then v_saltados := array_append(v_saltados, '75bb1e5e-ae7d-4ded-bf22-878858e00355 (Áster El Espino 2020)');
  end if;

  -- Áster El Otero 2018 → Áster El Otero
  update public."Vinos"
     set nombre = 'Áster El Otero',
         anada = null,
         sin_anada = false
   where id = '93aa5d5f-97de-494a-9266-4bcf9bc07b74'
     and nombre = 'Áster El Otero 2018'
     and anada is not distinct from 2018
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '93aa5d5f-97de-494a-9266-4bcf9bc07b74' and nombre = 'Áster El Otero'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '93aa5d5f-97de-494a-9266-4bcf9bc07b74') then v_saltados := array_append(v_saltados, '93aa5d5f-97de-494a-9266-4bcf9bc07b74 (Áster El Otero 2018)');
  end if;

  -- Áster Otero 2018 (Magnum) → Áster Otero (Magnum)
  update public."Vinos"
     set nombre = 'Áster Otero (Magnum)',
         anada = null,
         sin_anada = false
   where id = 'c0d22e63-dfea-45d1-a6c4-080a16a6b8f2'
     and nombre = 'Áster Otero 2018 (Magnum)'
     and anada is not distinct from 2018
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'c0d22e63-dfea-45d1-a6c4-080a16a6b8f2' and nombre = 'Áster Otero (Magnum)'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'c0d22e63-dfea-45d1-a6c4-080a16a6b8f2') then v_saltados := array_append(v_saltados, 'c0d22e63-dfea-45d1-a6c4-080a16a6b8f2 (Áster Otero 2018 (Magnum))');
  end if;

  -- Ausàs Interpretación 2018 → Ausàs Interpretación
  update public."Vinos"
     set nombre = 'Ausàs Interpretación',
         anada = null,
         sin_anada = false
   where id = '57cf57dc-6ce5-4407-adbb-d3d337bf1544'
     and nombre = 'Ausàs Interpretación 2018'
     and anada is not distinct from 2018
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '57cf57dc-6ce5-4407-adbb-d3d337bf1544' and nombre = 'Ausàs Interpretación'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '57cf57dc-6ce5-4407-adbb-d3d337bf1544') then v_saltados := array_append(v_saltados, '57cf57dc-6ce5-4407-adbb-d3d337bf1544 (Ausàs Interpretación 2018)');
  end if;

  -- Bahía de Dénia 2024 → Bahía de Dénia
  update public."Vinos"
     set nombre = 'Bahía de Dénia',
         anada = null,
         sin_anada = false
   where id = '7962c4ca-25aa-4500-92d4-4c4b038fa269'
     and nombre = 'Bahía de Dénia 2024'
     and anada is not distinct from 2024
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '7962c4ca-25aa-4500-92d4-4c4b038fa269' and nombre = 'Bahía de Dénia'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '7962c4ca-25aa-4500-92d4-4c4b038fa269') then v_saltados := array_append(v_saltados, '7962c4ca-25aa-4500-92d4-4c4b038fa269 (Bahía de Dénia 2024)');
  end if;

  -- Balbás Ancestral 2020 → Balbás Ancestral
  update public."Vinos"
     set nombre = 'Balbás Ancestral',
         anada = null,
         sin_anada = false
   where id = '53671e64-4ef1-4264-875d-e66b106018c4'
     and nombre = 'Balbás Ancestral 2020'
     and anada is not distinct from 2020
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '53671e64-4ef1-4264-875d-e66b106018c4' and nombre = 'Balbás Ancestral'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '53671e64-4ef1-4264-875d-e66b106018c4') then v_saltados := array_append(v_saltados, '53671e64-4ef1-4264-875d-e66b106018c4 (Balbás Ancestral 2020)');
  end if;

  -- Bermejos (Lanzarote) 2025 → Bermejos (Lanzarote)
  update public."Vinos"
     set nombre = 'Bermejos (Lanzarote)',
         anada = null,
         sin_anada = false
   where id = '1214516e-edd2-4323-a044-12892572deb3'
     and nombre = 'Bermejos (Lanzarote) 2025'
     and anada is not distinct from 2025
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '1214516e-edd2-4323-a044-12892572deb3' and nombre = 'Bermejos (Lanzarote)'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '1214516e-edd2-4323-a044-12892572deb3') then v_saltados := array_append(v_saltados, '1214516e-edd2-4323-a044-12892572deb3 (Bermejos (Lanzarote) 2025)');
  end if;

  -- Bosque de Matasnos 2022 → Bosque de Matasnos
  update public."Vinos"
     set nombre = 'Bosque de Matasnos',
         anada = null,
         sin_anada = false
   where id = '8b2d10a2-c778-4233-980d-ebb94db71ce4'
     and nombre = 'Bosque de Matasnos 2022'
     and anada is not distinct from 2022
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '8b2d10a2-c778-4233-980d-ebb94db71ce4' and nombre = 'Bosque de Matasnos'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '8b2d10a2-c778-4233-980d-ebb94db71ce4') then v_saltados := array_append(v_saltados, '8b2d10a2-c778-4233-980d-ebb94db71ce4 (Bosque de Matasnos 2022)');
  end if;

  -- Bosque de Matasnos 2022 (Magnum) → Bosque de Matasnos (Magnum)
  update public."Vinos"
     set nombre = 'Bosque de Matasnos (Magnum)',
         anada = null,
         sin_anada = false
   where id = '387d18c4-a561-4524-9dbe-c53ea3d202f5'
     and nombre = 'Bosque de Matasnos 2022 (Magnum)'
     and anada is not distinct from 2022
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '387d18c4-a561-4524-9dbe-c53ea3d202f5' and nombre = 'Bosque de Matasnos (Magnum)'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '387d18c4-a561-4524-9dbe-c53ea3d202f5') then v_saltados := array_append(v_saltados, '387d18c4-a561-4524-9dbe-c53ea3d202f5 (Bosque de Matasnos 2022 (Magnum))');
  end if;

  -- Carraovejas 2023 (Magnum) → Carraovejas (Magnum)
  update public."Vinos"
     set nombre = 'Carraovejas (Magnum)',
         anada = null,
         sin_anada = false
   where id = '540c1075-8c8e-4a70-9fe7-d499b293741d'
     and nombre = 'Carraovejas 2023 (Magnum)'
     and anada is not distinct from 2023
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '540c1075-8c8e-4a70-9fe7-d499b293741d' and nombre = 'Carraovejas (Magnum)'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '540c1075-8c8e-4a70-9fe7-d499b293741d') then v_saltados := array_append(v_saltados, '540c1075-8c8e-4a70-9fe7-d499b293741d (Carraovejas 2023 (Magnum))');
  end if;

  -- Carraovejas Cuesta de las Liebres 2019 → Carraovejas Cuesta de las Liebres
  update public."Vinos"
     set nombre = 'Carraovejas Cuesta de las Liebres',
         anada = null,
         sin_anada = false
   where id = '474b23ff-1c6e-4f6d-b25c-736e0640525d'
     and nombre = 'Carraovejas Cuesta de las Liebres 2019'
     and anada is not distinct from 2019
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '474b23ff-1c6e-4f6d-b25c-736e0640525d' and nombre = 'Carraovejas Cuesta de las Liebres'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '474b23ff-1c6e-4f6d-b25c-736e0640525d') then v_saltados := array_append(v_saltados, '474b23ff-1c6e-4f6d-b25c-736e0640525d (Carraovejas Cuesta de las Liebres 2019)');
  end if;

  -- Carraovejas El Anejón 2018 → Carraovejas El Anejón
  update public."Vinos"
     set nombre = 'Carraovejas El Anejón',
         anada = null,
         sin_anada = false
   where id = 'bf7a0cc1-9eaa-46b5-8c32-4fa4bca55cf1'
     and nombre = 'Carraovejas El Anejón 2018'
     and anada is not distinct from 2018
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'bf7a0cc1-9eaa-46b5-8c32-4fa4bca55cf1' and nombre = 'Carraovejas El Anejón'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'bf7a0cc1-9eaa-46b5-8c32-4fa4bca55cf1') then v_saltados := array_append(v_saltados, 'bf7a0cc1-9eaa-46b5-8c32-4fa4bca55cf1 (Carraovejas El Anejón 2018)');
  end if;

  -- Carraovejas El Anejón 2018 (Magnum) → Carraovejas El Anejón (Magnum)
  update public."Vinos"
     set nombre = 'Carraovejas El Anejón (Magnum)',
         anada = null,
         sin_anada = false
   where id = '6278535b-bf41-4387-b017-9d77e51d4ab8'
     and nombre = 'Carraovejas El Anejón 2018 (Magnum)'
     and anada is not distinct from 2018
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '6278535b-bf41-4387-b017-9d77e51d4ab8' and nombre = 'Carraovejas El Anejón (Magnum)'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '6278535b-bf41-4387-b017-9d77e51d4ab8') then v_saltados := array_append(v_saltados, '6278535b-bf41-4387-b017-9d77e51d4ab8 (Carraovejas El Anejón 2018 (Magnum))');
  end if;

  -- Castillo de Ygay Gran Reserva 2012 → Castillo de Ygay Gran Reserva
  update public."Vinos"
     set nombre = 'Castillo de Ygay Gran Reserva',
         anada = null,
         sin_anada = false
   where id = 'ec7978fd-a0e0-4168-86bc-4b80b46fd6cf'
     and nombre = 'Castillo de Ygay Gran Reserva 2012'
     and anada is not distinct from 2012
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'ec7978fd-a0e0-4168-86bc-4b80b46fd6cf' and nombre = 'Castillo de Ygay Gran Reserva'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'ec7978fd-a0e0-4168-86bc-4b80b46fd6cf') then v_saltados := array_append(v_saltados, 'ec7978fd-a0e0-4168-86bc-4b80b46fd6cf (Castillo de Ygay Gran Reserva 2012)');
  end if;

  -- Clio 2023 → Clio
  update public."Vinos"
     set nombre = 'Clio',
         anada = null,
         sin_anada = false
   where id = '7477d8f5-3c41-45a9-8bd0-77247ef2aeca'
     and nombre = 'Clio 2023'
     and anada is not distinct from 2023
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '7477d8f5-3c41-45a9-8bd0-77247ef2aeca' and nombre = 'Clio'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '7477d8f5-3c41-45a9-8bd0-77247ef2aeca') then v_saltados := array_append(v_saltados, '7477d8f5-3c41-45a9-8bd0-77247ef2aeca (Clio 2023)');
  end if;

  -- Collet Rosé → Collet Rosé
  update public."Vinos"
     set nombre = 'Collet Rosé',
         anada = null,
         sin_anada = false
   where id = '7c8df937-0938-4ce4-b35d-c2cbc20f9fc6'
     and nombre = 'Collet Rosé'
     and anada is not distinct from null
     and sin_anada = true;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '7c8df937-0938-4ce4-b35d-c2cbc20f9fc6' and nombre = 'Collet Rosé'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '7c8df937-0938-4ce4-b35d-c2cbc20f9fc6') then v_saltados := array_append(v_saltados, '7c8df937-0938-4ce4-b35d-c2cbc20f9fc6 (Collet Rosé)');
  end if;

  -- Conde de los Andes 2019 → Conde de los Andes
  update public."Vinos"
     set nombre = 'Conde de los Andes',
         anada = null,
         sin_anada = false
   where id = '435c2b95-e7b7-42e7-9314-11d38d082f3f'
     and nombre = 'Conde de los Andes 2019'
     and anada is not distinct from 2019
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '435c2b95-e7b7-42e7-9314-11d38d082f3f' and nombre = 'Conde de los Andes'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '435c2b95-e7b7-42e7-9314-11d38d082f3f') then v_saltados := array_append(v_saltados, '435c2b95-e7b7-42e7-9314-11d38d082f3f (Conde de los Andes 2019)');
  end if;

  -- Dominio de Calogía 2020 → Dominio de Calogía
  update public."Vinos"
     set nombre = 'Dominio de Calogía',
         anada = null,
         sin_anada = false
   where id = 'b550e328-7b1b-4e5b-8442-1d8b5161e771'
     and nombre = 'Dominio de Calogía 2020'
     and anada is not distinct from 2020
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'b550e328-7b1b-4e5b-8442-1d8b5161e771' and nombre = 'Dominio de Calogía'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'b550e328-7b1b-4e5b-8442-1d8b5161e771') then v_saltados := array_append(v_saltados, 'b550e328-7b1b-4e5b-8442-1d8b5161e771 (Dominio de Calogía 2020)');
  end if;

  -- Dominio de Calogía 2020 (Magnum) → Dominio de Calogía (Magnum)
  update public."Vinos"
     set nombre = 'Dominio de Calogía (Magnum)',
         anada = null,
         sin_anada = false
   where id = 'c845e388-6954-4b1f-b5dc-36064f06043f'
     and nombre = 'Dominio de Calogía 2020 (Magnum)'
     and anada is not distinct from 2020
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'c845e388-6954-4b1f-b5dc-36064f06043f' and nombre = 'Dominio de Calogía (Magnum)'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'c845e388-6954-4b1f-b5dc-36064f06043f') then v_saltados := array_append(v_saltados, 'c845e388-6954-4b1f-b5dc-36064f06043f (Dominio de Calogía 2020 (Magnum))');
  end if;

  -- Dominio de Calogía Doble M 2020 → Dominio de Calogía Doble M
  update public."Vinos"
     set nombre = 'Dominio de Calogía Doble M',
         anada = null,
         sin_anada = false
   where id = 'd9803ec6-fff8-4ea8-a6d6-04d04da64404'
     and nombre = 'Dominio de Calogía Doble M 2020'
     and anada is not distinct from 2020
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'd9803ec6-fff8-4ea8-a6d6-04d04da64404' and nombre = 'Dominio de Calogía Doble M'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'd9803ec6-fff8-4ea8-a6d6-04d04da64404') then v_saltados := array_append(v_saltados, 'd9803ec6-fff8-4ea8-a6d6-04d04da64404 (Dominio de Calogía Doble M 2020)');
  end if;

  -- Dominio del Águila Reserva 2020 → Dominio del Águila Reserva
  update public."Vinos"
     set nombre = 'Dominio del Águila Reserva',
         anada = null,
         sin_anada = false
   where id = 'a62be9fe-cea2-49d1-9dcf-b0a988510afd'
     and nombre = 'Dominio del Águila Reserva 2020'
     and anada is not distinct from 2020
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'a62be9fe-cea2-49d1-9dcf-b0a988510afd' and nombre = 'Dominio del Águila Reserva'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'a62be9fe-cea2-49d1-9dcf-b0a988510afd') then v_saltados := array_append(v_saltados, 'a62be9fe-cea2-49d1-9dcf-b0a988510afd (Dominio del Águila Reserva 2020)');
  end if;

  -- Dominio del Pidio 2021 → Dominio del Pidio
  update public."Vinos"
     set nombre = 'Dominio del Pidio',
         anada = null,
         sin_anada = false
   where id = '27696aa0-c54f-4baa-a65a-cd0442de84bb'
     and nombre = 'Dominio del Pidio 2021'
     and anada is not distinct from 2021
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '27696aa0-c54f-4baa-a65a-cd0442de84bb' and nombre = 'Dominio del Pidio'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '27696aa0-c54f-4baa-a65a-cd0442de84bb') then v_saltados := array_append(v_saltados, '27696aa0-c54f-4baa-a65a-cd0442de84bb (Dominio del Pidio 2021)');
  end if;

  -- El Canto de la Alondra 2022 → El Canto de la Alondra
  update public."Vinos"
     set nombre = 'El Canto de la Alondra',
         anada = null,
         sin_anada = false
   where id = '5a6e9fa1-4a16-48e9-9201-0c9452ac35ba'
     and nombre = 'El Canto de la Alondra 2022'
     and anada is not distinct from 2022
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '5a6e9fa1-4a16-48e9-9201-0c9452ac35ba' and nombre = 'El Canto de la Alondra'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '5a6e9fa1-4a16-48e9-9201-0c9452ac35ba') then v_saltados := array_append(v_saltados, '5a6e9fa1-4a16-48e9-9201-0c9452ac35ba (El Canto de la Alondra 2022)');
  end if;

  -- El Corral de Taruguín 2018 → El Corral de Taruguín
  update public."Vinos"
     set nombre = 'El Corral de Taruguín',
         anada = null,
         sin_anada = false
   where id = 'fddf1981-ac0e-406f-9172-536b92f79a19'
     and nombre = 'El Corral de Taruguín 2018'
     and anada is not distinct from 2018
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'fddf1981-ac0e-406f-9172-536b92f79a19' and nombre = 'El Corral de Taruguín'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'fddf1981-ac0e-406f-9172-536b92f79a19') then v_saltados := array_append(v_saltados, 'fddf1981-ac0e-406f-9172-536b92f79a19 (El Corral de Taruguín 2018)');
  end if;

  -- El Nido 2023 → El Nido
  update public."Vinos"
     set nombre = 'El Nido',
         anada = null,
         sin_anada = false
   where id = '71df1c08-defa-415c-861f-9daa4fb54762'
     and nombre = 'El Nido 2023'
     and anada is not distinct from 2023
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '71df1c08-defa-415c-861f-9daa4fb54762' and nombre = 'El Nido'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '71df1c08-defa-415c-861f-9daa4fb54762') then v_saltados := array_append(v_saltados, '71df1c08-defa-415c-861f-9daa4fb54762 (El Nido 2023)');
  end if;

  -- El Sequé 2022 → El Sequé
  update public."Vinos"
     set nombre = 'El Sequé',
         anada = null,
         sin_anada = false
   where id = 'd65dcbd3-4a7a-402e-80b4-a79b562714c8'
     and nombre = 'El Sequé 2022'
     and anada is not distinct from 2022
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'd65dcbd3-4a7a-402e-80b4-a79b562714c8' and nombre = 'El Sequé'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'd65dcbd3-4a7a-402e-80b4-a79b562714c8') then v_saltados := array_append(v_saltados, 'd65dcbd3-4a7a-402e-80b4-a79b562714c8 (El Sequé 2022)');
  end if;

  -- Fefiñanes 2024 → Fefiñanes
  update public."Vinos"
     set nombre = 'Fefiñanes',
         anada = null,
         sin_anada = false
   where id = 'a21f8826-79e1-4662-9d9a-a0ac445a2e11'
     and nombre = 'Fefiñanes 2024'
     and anada is not distinct from 2024
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'a21f8826-79e1-4662-9d9a-a0ac445a2e11' and nombre = 'Fefiñanes'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'a21f8826-79e1-4662-9d9a-a0ac445a2e11') then v_saltados := array_append(v_saltados, 'a21f8826-79e1-4662-9d9a-a0ac445a2e11 (Fefiñanes 2024)');
  end if;

  -- Fefiñanes 2024 (Magnum) → Fefiñanes (Magnum)
  update public."Vinos"
     set nombre = 'Fefiñanes (Magnum)',
         anada = null,
         sin_anada = false
   where id = '869f78bc-2994-49a7-88b3-c5eec414b6df'
     and nombre = 'Fefiñanes 2024 (Magnum)'
     and anada is not distinct from 2024
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '869f78bc-2994-49a7-88b3-c5eec414b6df' and nombre = 'Fefiñanes (Magnum)'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '869f78bc-2994-49a7-88b3-c5eec414b6df') then v_saltados := array_append(v_saltados, '869f78bc-2994-49a7-88b3-c5eec414b6df (Fefiñanes 2024 (Magnum))');
  end if;

  -- Flor de Pingus 2023 → Flor de Pingus
  update public."Vinos"
     set nombre = 'Flor de Pingus',
         anada = null,
         sin_anada = false
   where id = '82a51e05-5a64-47cc-92eb-b0fba170310c'
     and nombre = 'Flor de Pingus 2023'
     and anada is not distinct from 2023
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '82a51e05-5a64-47cc-92eb-b0fba170310c' and nombre = 'Flor de Pingus'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '82a51e05-5a64-47cc-92eb-b0fba170310c') then v_saltados := array_append(v_saltados, '82a51e05-5a64-47cc-92eb-b0fba170310c (Flor de Pingus 2023)');
  end if;

  -- G.H. Martel Prestige Brut → G.H. Martel Prestige Brut
  update public."Vinos"
     set nombre = 'G.H. Martel Prestige Brut',
         anada = null,
         sin_anada = false
   where id = '52af6943-a587-4c05-bba7-e25d62c796c8'
     and nombre = 'G.H. Martel Prestige Brut'
     and anada is not distinct from null
     and sin_anada = true;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '52af6943-a587-4c05-bba7-e25d62c796c8' and nombre = 'G.H. Martel Prestige Brut'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '52af6943-a587-4c05-bba7-e25d62c796c8') then v_saltados := array_append(v_saltados, '52af6943-a587-4c05-bba7-e25d62c796c8 (G.H. Martel Prestige Brut)');
  end if;

  -- Gran Reserva 904 (La Rioja Alta) 2015 → Gran Reserva 904 (La Rioja Alta)
  update public."Vinos"
     set nombre = 'Gran Reserva 904 (La Rioja Alta)',
         anada = null,
         sin_anada = false
   where id = 'b0d47317-673b-4cb2-a787-48081719ba9e'
     and nombre = 'Gran Reserva 904 (La Rioja Alta) 2015'
     and anada is not distinct from 2015
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'b0d47317-673b-4cb2-a787-48081719ba9e' and nombre = 'Gran Reserva 904 (La Rioja Alta)'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'b0d47317-673b-4cb2-a787-48081719ba9e') then v_saltados := array_append(v_saltados, 'b0d47317-673b-4cb2-a787-48081719ba9e (Gran Reserva 904 (La Rioja Alta) 2015)');
  end if;

  -- José Pariente Sauvignon Blanc 2024 → José Pariente Sauvignon Blanc
  update public."Vinos"
     set nombre = 'José Pariente Sauvignon Blanc',
         anada = null,
         sin_anada = false
   where id = 'b8867cac-a5ae-4b9a-acad-6c498b538739'
     and nombre = 'José Pariente Sauvignon Blanc 2024'
     and anada is not distinct from 2024
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'b8867cac-a5ae-4b9a-acad-6c498b538739' and nombre = 'José Pariente Sauvignon Blanc'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'b8867cac-a5ae-4b9a-acad-6c498b538739') then v_saltados := array_append(v_saltados, 'b8867cac-a5ae-4b9a-acad-6c498b538739 (José Pariente Sauvignon Blanc 2024)');
  end if;

  -- L. Beyer Gewurz Comtes d'Eguisheim 2009 → L. Beyer Gewurz Comtes d'Eguisheim
  update public."Vinos"
     set nombre = 'L. Beyer Gewurz Comtes d''Eguisheim',
         anada = null,
         sin_anada = false
   where id = 'b54dca1f-4030-4af3-94c4-733806de0b7d'
     and nombre = 'L. Beyer Gewurz Comtes d''Eguisheim 2009'
     and anada is not distinct from 2009
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'b54dca1f-4030-4af3-94c4-733806de0b7d' and nombre = 'L. Beyer Gewurz Comtes d''Eguisheim'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'b54dca1f-4030-4af3-94c4-733806de0b7d') then v_saltados := array_append(v_saltados, 'b54dca1f-4030-4af3-94c4-733806de0b7d (L. Beyer Gewurz Comtes d''Eguisheim 2009)');
  end if;

  -- La Nieta 2024 → La Nieta
  update public."Vinos"
     set nombre = 'La Nieta',
         anada = null,
         sin_anada = false
   where id = '465516c9-e18b-40d7-b94b-e0467d9931bf'
     and nombre = 'La Nieta 2024'
     and anada is not distinct from 2024
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '465516c9-e18b-40d7-b94b-e0467d9931bf' and nombre = 'La Nieta'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '465516c9-e18b-40d7-b94b-e0467d9931bf') then v_saltados := array_append(v_saltados, '465516c9-e18b-40d7-b94b-e0467d9931bf (La Nieta 2024)');
  end if;

  -- La Rioja Alta Gran Reserva 890 2010 → La Rioja Alta Gran Reserva 890
  update public."Vinos"
     set nombre = 'La Rioja Alta Gran Reserva 890',
         anada = null,
         sin_anada = false
   where id = '345729aa-0a2e-464a-bca8-05409784f668'
     and nombre = 'La Rioja Alta Gran Reserva 890 2010'
     and anada is not distinct from 2010
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '345729aa-0a2e-464a-bca8-05409784f668' and nombre = 'La Rioja Alta Gran Reserva 890'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '345729aa-0a2e-464a-bca8-05409784f668') then v_saltados := array_append(v_saltados, '345729aa-0a2e-464a-bca8-05409784f668 (La Rioja Alta Gran Reserva 890 2010)');
  end if;

  -- Ladoucette Pouilly‑Fumé 2022 → Ladoucette Pouilly‑Fumé
  update public."Vinos"
     set nombre = 'Ladoucette Pouilly‑Fumé',
         anada = null,
         sin_anada = false
   where id = '6e0f4e55-cb21-4fd0-b112-acd103405948'
     and nombre = 'Ladoucette Pouilly‑Fumé 2022'
     and anada is not distinct from 2022
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '6e0f4e55-cb21-4fd0-b112-acd103405948' and nombre = 'Ladoucette Pouilly‑Fumé'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '6e0f4e55-cb21-4fd0-b112-acd103405948') then v_saltados := array_append(v_saltados, '6e0f4e55-cb21-4fd0-b112-acd103405948 (Ladoucette Pouilly‑Fumé 2022)');
  end if;

  -- Lagar de Cervera 2024 → Lagar de Cervera
  update public."Vinos"
     set nombre = 'Lagar de Cervera',
         anada = null,
         sin_anada = false
   where id = '3cc18639-ab51-49b4-93b2-695edde103ed'
     and nombre = 'Lagar de Cervera 2024'
     and anada is not distinct from 2024
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '3cc18639-ab51-49b4-93b2-695edde103ed' and nombre = 'Lagar de Cervera'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '3cc18639-ab51-49b4-93b2-695edde103ed') then v_saltados := array_append(v_saltados, '3cc18639-ab51-49b4-93b2-695edde103ed (Lagar de Cervera 2024)');
  end if;

  -- Lagar de Cervera 2024 (Magnum) → Lagar de Cervera (Magnum)
  update public."Vinos"
     set nombre = 'Lagar de Cervera (Magnum)',
         anada = null,
         sin_anada = false
   where id = 'dc364646-e73b-4b4f-8a64-c611abb6cef1'
     and nombre = 'Lagar de Cervera 2024 (Magnum)'
     and anada is not distinct from 2024
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'dc364646-e73b-4b4f-8a64-c611abb6cef1' and nombre = 'Lagar de Cervera (Magnum)'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'dc364646-e73b-4b4f-8a64-c611abb6cef1') then v_saltados := array_append(v_saltados, 'dc364646-e73b-4b4f-8a64-c611abb6cef1 (Lagar de Cervera 2024 (Magnum))');
  end if;

  -- Laurent‑Perrier Alexandra Rosé 2004 → Laurent‑Perrier Alexandra Rosé
  update public."Vinos"
     set nombre = 'Laurent‑Perrier Alexandra Rosé',
         anada = null,
         sin_anada = false
   where id = '4a5bf9d9-d33e-4c58-bc1c-06eff214824f'
     and nombre = 'Laurent‑Perrier Alexandra Rosé 2004'
     and anada is not distinct from 2004
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '4a5bf9d9-d33e-4c58-bc1c-06eff214824f' and nombre = 'Laurent‑Perrier Alexandra Rosé'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '4a5bf9d9-d33e-4c58-bc1c-06eff214824f') then v_saltados := array_append(v_saltados, '4a5bf9d9-d33e-4c58-bc1c-06eff214824f (Laurent‑Perrier Alexandra Rosé 2004)');
  end if;

  -- Laurent‑Perrier Millésimé 2015 → Laurent‑Perrier Millésimé
  update public."Vinos"
     set nombre = 'Laurent‑Perrier Millésimé',
         anada = null,
         sin_anada = false
   where id = '30cc8620-1c38-47fe-9204-b2ac7eb8eaa8'
     and nombre = 'Laurent‑Perrier Millésimé 2015'
     and anada is not distinct from 2015
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '30cc8620-1c38-47fe-9204-b2ac7eb8eaa8' and nombre = 'Laurent‑Perrier Millésimé'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '30cc8620-1c38-47fe-9204-b2ac7eb8eaa8') then v_saltados := array_append(v_saltados, '30cc8620-1c38-47fe-9204-b2ac7eb8eaa8 (Laurent‑Perrier Millésimé 2015)');
  end if;

  -- Louis Latour Chablis La Chanfleure 2024 → Louis Latour Chablis La Chanfleure
  update public."Vinos"
     set nombre = 'Louis Latour Chablis La Chanfleure',
         anada = null,
         sin_anada = false
   where id = '4d59ef4a-d7b3-45d3-af5a-54f67618f613'
     and nombre = 'Louis Latour Chablis La Chanfleure 2024'
     and anada is not distinct from 2024
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '4d59ef4a-d7b3-45d3-af5a-54f67618f613' and nombre = 'Louis Latour Chablis La Chanfleure'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '4d59ef4a-d7b3-45d3-af5a-54f67618f613') then v_saltados := array_append(v_saltados, '4d59ef4a-d7b3-45d3-af5a-54f67618f613 (Louis Latour Chablis La Chanfleure 2024)');
  end if;

  -- Marqués de Murrieta Reserva 2021 → Marqués de Murrieta Reserva
  update public."Vinos"
     set nombre = 'Marqués de Murrieta Reserva',
         anada = null,
         sin_anada = false
   where id = '2564cf67-b7d9-4425-9ef5-cb2d39d5bc60'
     and nombre = 'Marqués de Murrieta Reserva 2021'
     and anada is not distinct from 2021
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '2564cf67-b7d9-4425-9ef5-cb2d39d5bc60' and nombre = 'Marqués de Murrieta Reserva'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '2564cf67-b7d9-4425-9ef5-cb2d39d5bc60') then v_saltados := array_append(v_saltados, '2564cf67-b7d9-4425-9ef5-cb2d39d5bc60 (Marqués de Murrieta Reserva 2021)');
  end if;

  -- Marqués de Riscal 150 Aniversario 2017 → Marqués de Riscal 150 Aniversario
  update public."Vinos"
     set nombre = 'Marqués de Riscal 150 Aniversario',
         anada = null,
         sin_anada = false
   where id = '0aeba489-b6d1-4d25-884f-dee60eba581b'
     and nombre = 'Marqués de Riscal 150 Aniversario 2017'
     and anada is not distinct from 2017
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '0aeba489-b6d1-4d25-884f-dee60eba581b' and nombre = 'Marqués de Riscal 150 Aniversario'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '0aeba489-b6d1-4d25-884f-dee60eba581b') then v_saltados := array_append(v_saltados, '0aeba489-b6d1-4d25-884f-dee60eba581b (Marqués de Riscal 150 Aniversario 2017)');
  end if;

  -- Marqués de Riscal Barón de Chirel 2020 → Marqués de Riscal Barón de Chirel
  update public."Vinos"
     set nombre = 'Marqués de Riscal Barón de Chirel',
         anada = null,
         sin_anada = false
   where id = '8a70d0ed-39df-4f42-86b7-55c74c84872b'
     and nombre = 'Marqués de Riscal Barón de Chirel 2020'
     and anada is not distinct from 2020
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '8a70d0ed-39df-4f42-86b7-55c74c84872b' and nombre = 'Marqués de Riscal Barón de Chirel'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '8a70d0ed-39df-4f42-86b7-55c74c84872b') then v_saltados := array_append(v_saltados, '8a70d0ed-39df-4f42-86b7-55c74c84872b (Marqués de Riscal Barón de Chirel 2020)');
  end if;

  -- Martelo 2019 → Martelo
  update public."Vinos"
     set nombre = 'Martelo',
         anada = null,
         sin_anada = false
   where id = '0bf32fa1-51aa-45af-9882-a11fc391b509'
     and nombre = 'Martelo 2019'
     and anada is not distinct from 2019
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '0bf32fa1-51aa-45af-9882-a11fc391b509' and nombre = 'Martelo'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '0bf32fa1-51aa-45af-9882-a11fc391b509') then v_saltados := array_append(v_saltados, '0bf32fa1-51aa-45af-9882-a11fc391b509 (Martelo 2019)');
  end if;

  -- Mauro 2023 → Mauro
  update public."Vinos"
     set nombre = 'Mauro',
         anada = null,
         sin_anada = false
   where id = '2caabdff-987d-4b46-9005-64c8536d8334'
     and nombre = 'Mauro 2023'
     and anada is not distinct from 2023
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '2caabdff-987d-4b46-9005-64c8536d8334' and nombre = 'Mauro'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '2caabdff-987d-4b46-9005-64c8536d8334') then v_saltados := array_append(v_saltados, '2caabdff-987d-4b46-9005-64c8536d8334 (Mauro 2023)');
  end if;

  -- Moët & Chandon Grand Vintage 2015 → Moët & Chandon Grand Vintage
  update public."Vinos"
     set nombre = 'Moët & Chandon Grand Vintage',
         anada = null,
         sin_anada = false
   where id = '7bd2fba7-244e-497c-b9f0-311dc36ec973'
     and nombre = 'Moët & Chandon Grand Vintage 2015'
     and anada is not distinct from 2015
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '7bd2fba7-244e-497c-b9f0-311dc36ec973' and nombre = 'Moët & Chandon Grand Vintage'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '7bd2fba7-244e-497c-b9f0-311dc36ec973') then v_saltados := array_append(v_saltados, '7bd2fba7-244e-497c-b9f0-311dc36ec973 (Moët & Chandon Grand Vintage 2015)');
  end if;

  -- Moët Grand Vintage Rosé 2015 → Moët Grand Vintage Rosé
  update public."Vinos"
     set nombre = 'Moët Grand Vintage Rosé',
         anada = null,
         sin_anada = false
   where id = '46f035f1-b2ca-4a69-b607-1806a93c6e8b'
     and nombre = 'Moët Grand Vintage Rosé 2015'
     and anada is not distinct from 2015
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '46f035f1-b2ca-4a69-b607-1806a93c6e8b' and nombre = 'Moët Grand Vintage Rosé'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '46f035f1-b2ca-4a69-b607-1806a93c6e8b') then v_saltados := array_append(v_saltados, '46f035f1-b2ca-4a69-b607-1806a93c6e8b (Moët Grand Vintage Rosé 2015)');
  end if;

  -- Otazu (Chardonnay) 2024 → Otazu (Chardonnay)
  update public."Vinos"
     set nombre = 'Otazu (Chardonnay)',
         anada = null,
         sin_anada = false
   where id = 'f04c83eb-6f74-4cce-bb74-46b4c2a6155d'
     and nombre = 'Otazu (Chardonnay) 2024'
     and anada is not distinct from 2024
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'f04c83eb-6f74-4cce-bb74-46b4c2a6155d' and nombre = 'Otazu (Chardonnay)'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'f04c83eb-6f74-4cce-bb74-46b4c2a6155d') then v_saltados := array_append(v_saltados, 'f04c83eb-6f74-4cce-bb74-46b4c2a6155d (Otazu (Chardonnay) 2024)');
  end if;

  -- Otazu Altar 2013 → Otazu Altar
  update public."Vinos"
     set nombre = 'Otazu Altar',
         anada = null,
         sin_anada = false
   where id = 'cb629ad3-5ea7-4498-8511-e38c0ff0b21d'
     and nombre = 'Otazu Altar 2013'
     and anada is not distinct from 2013
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'cb629ad3-5ea7-4498-8511-e38c0ff0b21d' and nombre = 'Otazu Altar'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'cb629ad3-5ea7-4498-8511-e38c0ff0b21d') then v_saltados := array_append(v_saltados, 'cb629ad3-5ea7-4498-8511-e38c0ff0b21d (Otazu Altar 2013)');
  end if;

  -- Otazu Premium Cuvée 2021 → Otazu Premium Cuvée
  update public."Vinos"
     set nombre = 'Otazu Premium Cuvée',
         anada = null,
         sin_anada = false
   where id = '9c360d96-9ff9-48dc-b2f8-de5694acb00f'
     and nombre = 'Otazu Premium Cuvée 2021'
     and anada is not distinct from 2021
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '9c360d96-9ff9-48dc-b2f8-de5694acb00f' and nombre = 'Otazu Premium Cuvée'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '9c360d96-9ff9-48dc-b2f8-de5694acb00f') then v_saltados := array_append(v_saltados, '9c360d96-9ff9-48dc-b2f8-de5694acb00f (Otazu Premium Cuvée 2021)');
  end if;

  -- Otazu Rosado 2024 → Otazu Rosado
  update public."Vinos"
     set nombre = 'Otazu Rosado',
         anada = null,
         sin_anada = false
   where id = '0e14f46c-85fb-4f93-9890-ca8e7e15e869'
     and nombre = 'Otazu Rosado 2024'
     and anada is not distinct from 2024
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '0e14f46c-85fb-4f93-9890-ca8e7e15e869' and nombre = 'Otazu Rosado'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '0e14f46c-85fb-4f93-9890-ca8e7e15e869') then v_saltados := array_append(v_saltados, '0e14f46c-85fb-4f93-9890-ca8e7e15e869 (Otazu Rosado 2024)');
  end if;

  -- Ou Steen 2022 → Ou Steen
  update public."Vinos"
     set nombre = 'Ou Steen',
         anada = null,
         sin_anada = false
   where id = '86850a57-53f5-4b59-b0f6-9e7bdb82a42f'
     and nombre = 'Ou Steen 2022'
     and anada is not distinct from 2022
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '86850a57-53f5-4b59-b0f6-9e7bdb82a42f' and nombre = 'Ou Steen'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '86850a57-53f5-4b59-b0f6-9e7bdb82a42f') then v_saltados := array_append(v_saltados, '86850a57-53f5-4b59-b0f6-9e7bdb82a42f (Ou Steen 2022)');
  end if;

  -- Pago de Carraovejas 2023 → Pago de Carraovejas
  update public."Vinos"
     set nombre = 'Pago de Carraovejas',
         anada = null,
         sin_anada = false
   where id = '6064cef2-c768-4c7c-9853-2409ff2b6270'
     and nombre = 'Pago de Carraovejas 2023'
     and anada is not distinct from 2023
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '6064cef2-c768-4c7c-9853-2409ff2b6270' and nombre = 'Pago de Carraovejas'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '6064cef2-c768-4c7c-9853-2409ff2b6270') then v_saltados := array_append(v_saltados, '6064cef2-c768-4c7c-9853-2409ff2b6270 (Pago de Carraovejas 2023)');
  end if;

  -- Pago de los Capellanes Crianza 2022 → Pago de los Capellanes Crianza
  update public."Vinos"
     set nombre = 'Pago de los Capellanes Crianza',
         anada = null,
         sin_anada = false
   where id = '3a443d48-c2b1-4d4b-ba0e-01ef3652caa4'
     and nombre = 'Pago de los Capellanes Crianza 2022'
     and anada is not distinct from 2022
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '3a443d48-c2b1-4d4b-ba0e-01ef3652caa4' and nombre = 'Pago de los Capellanes Crianza'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '3a443d48-c2b1-4d4b-ba0e-01ef3652caa4') then v_saltados := array_append(v_saltados, '3a443d48-c2b1-4d4b-ba0e-01ef3652caa4 (Pago de los Capellanes Crianza 2022)');
  end if;

  -- Pago de los Capellanes Crianza 2022 (Magnum) → Pago de los Capellanes Crianza (Magnum)
  update public."Vinos"
     set nombre = 'Pago de los Capellanes Crianza (Magnum)',
         anada = null,
         sin_anada = false
   where id = 'e895f569-8a83-4f1d-ab48-03f86a4d9c6b'
     and nombre = 'Pago de los Capellanes Crianza 2022 (Magnum)'
     and anada is not distinct from 2022
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'e895f569-8a83-4f1d-ab48-03f86a4d9c6b' and nombre = 'Pago de los Capellanes Crianza (Magnum)'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'e895f569-8a83-4f1d-ab48-03f86a4d9c6b') then v_saltados := array_append(v_saltados, 'e895f569-8a83-4f1d-ab48-03f86a4d9c6b (Pago de los Capellanes Crianza 2022 (Magnum))');
  end if;

  -- Pago Santa Cruz 2021 → Pago Santa Cruz
  update public."Vinos"
     set nombre = 'Pago Santa Cruz',
         anada = null,
         sin_anada = false
   where id = 'dc67ee11-502b-4b43-8486-ef5ef848af46'
     and nombre = 'Pago Santa Cruz 2021'
     and anada is not distinct from 2021
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'dc67ee11-502b-4b43-8486-ef5ef848af46' and nombre = 'Pago Santa Cruz'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'dc67ee11-502b-4b43-8486-ef5ef848af46') then v_saltados := array_append(v_saltados, 'dc67ee11-502b-4b43-8486-ef5ef848af46 (Pago Santa Cruz 2021)');
  end if;

  -- Pagos de Anguix 2018 → Pagos de Anguix
  update public."Vinos"
     set nombre = 'Pagos de Anguix',
         anada = null,
         sin_anada = false
   where id = '050a3e6d-a114-421e-bd09-d6288441653f'
     and nombre = 'Pagos de Anguix 2018'
     and anada is not distinct from 2018
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '050a3e6d-a114-421e-bd09-d6288441653f' and nombre = 'Pagos de Anguix'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '050a3e6d-a114-421e-bd09-d6288441653f') then v_saltados := array_append(v_saltados, '050a3e6d-a114-421e-bd09-d6288441653f (Pagos de Anguix 2018)');
  end if;

  -- Pazo Barrantes 2020 → Pazo Barrantes
  update public."Vinos"
     set nombre = 'Pazo Barrantes',
         anada = null,
         sin_anada = false
   where id = '813c4abb-4371-4dad-bc45-9360cf262e59'
     and nombre = 'Pazo Barrantes 2020'
     and anada is not distinct from 2020
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '813c4abb-4371-4dad-bc45-9360cf262e59' and nombre = 'Pazo Barrantes'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '813c4abb-4371-4dad-bc45-9360cf262e59') then v_saltados := array_append(v_saltados, '813c4abb-4371-4dad-bc45-9360cf262e59 (Pazo Barrantes 2020)');
  end if;

  -- Pícaro del Águila 2022 → Pícaro del Águila
  update public."Vinos"
     set nombre = 'Pícaro del Águila',
         anada = null,
         sin_anada = false
   where id = '0628c633-b086-40f6-bcb7-125f64081d4b'
     and nombre = 'Pícaro del Águila 2022'
     and anada is not distinct from 2022
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '0628c633-b086-40f6-bcb7-125f64081d4b' and nombre = 'Pícaro del Águila'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '0628c633-b086-40f6-bcb7-125f64081d4b') then v_saltados := array_append(v_saltados, '0628c633-b086-40f6-bcb7-125f64081d4b (Pícaro del Águila 2022)');
  end if;

  -- Pícaro del Águila 2022 (Magnum) → Pícaro del Águila (Magnum)
  update public."Vinos"
     set nombre = 'Pícaro del Águila (Magnum)',
         anada = null,
         sin_anada = false
   where id = '9848ae25-9051-4a7f-bbfc-1474445f39db'
     and nombre = 'Pícaro del Águila 2022 (Magnum)'
     and anada is not distinct from 2022
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '9848ae25-9051-4a7f-bbfc-1474445f39db' and nombre = 'Pícaro del Águila (Magnum)'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '9848ae25-9051-4a7f-bbfc-1474445f39db') then v_saltados := array_append(v_saltados, '9848ae25-9051-4a7f-bbfc-1474445f39db (Pícaro del Águila 2022 (Magnum))');
  end if;

  -- Pingus 2023 → Pingus
  update public."Vinos"
     set nombre = 'Pingus',
         anada = null,
         sin_anada = false
   where id = '2e6a2e86-db54-4f26-937c-77f7f0708fac'
     and nombre = 'Pingus 2023'
     and anada is not distinct from 2023
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '2e6a2e86-db54-4f26-937c-77f7f0708fac' and nombre = 'Pingus'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '2e6a2e86-db54-4f26-937c-77f7f0708fac') then v_saltados := array_append(v_saltados, '2e6a2e86-db54-4f26-937c-77f7f0708fac (Pingus 2023)');
  end if;

  -- Piper‑Heidsieck → Piper‑Heidsieck
  update public."Vinos"
     set nombre = 'Piper‑Heidsieck',
         anada = null,
         sin_anada = false
   where id = '87b17adb-c4bc-4b1a-a5d7-0665e4f118a0'
     and nombre = 'Piper‑Heidsieck'
     and anada is not distinct from null
     and sin_anada = true;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '87b17adb-c4bc-4b1a-a5d7-0665e4f118a0' and nombre = 'Piper‑Heidsieck'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '87b17adb-c4bc-4b1a-a5d7-0665e4f118a0') then v_saltados := array_append(v_saltados, '87b17adb-c4bc-4b1a-a5d7-0665e4f118a0 (Piper‑Heidsieck)');
  end if;

  -- PSI 2023 → PSI
  update public."Vinos"
     set nombre = 'PSI',
         anada = null,
         sin_anada = false
   where id = 'e59baae8-5310-4264-80f0-31bb3f1e7bfb'
     and nombre = 'PSI 2023'
     and anada is not distinct from 2023
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'e59baae8-5310-4264-80f0-31bb3f1e7bfb' and nombre = 'PSI'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'e59baae8-5310-4264-80f0-31bb3f1e7bfb') then v_saltados := array_append(v_saltados, 'e59baae8-5310-4264-80f0-31bb3f1e7bfb (PSI 2023)');
  end if;

  -- PSI 2021 (Magnum) → PSI (Magnum)
  update public."Vinos"
     set nombre = 'PSI (Magnum)',
         anada = null,
         sin_anada = false
   where id = 'c9903817-6d30-4d69-a96f-0cdc8bbf8495'
     and nombre = 'PSI 2021 (Magnum)'
     and anada is not distinct from 2021
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'c9903817-6d30-4d69-a96f-0cdc8bbf8495' and nombre = 'PSI (Magnum)'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'c9903817-6d30-4d69-a96f-0cdc8bbf8495') then v_saltados := array_append(v_saltados, 'c9903817-6d30-4d69-a96f-0cdc8bbf8495 (PSI 2021 (Magnum))');
  end if;

  -- Riscal XR 2021 → Riscal XR
  update public."Vinos"
     set nombre = 'Riscal XR',
         anada = null,
         sin_anada = false
   where id = 'ff35c279-bddb-49c5-800a-1b3f47ded052'
     and nombre = 'Riscal XR 2021'
     and anada is not distinct from 2021
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'ff35c279-bddb-49c5-800a-1b3f47ded052' and nombre = 'Riscal XR'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'ff35c279-bddb-49c5-800a-1b3f47ded052') then v_saltados := array_append(v_saltados, 'ff35c279-bddb-49c5-800a-1b3f47ded052 (Riscal XR 2021)');
  end if;

  -- Ritus 2020 → Ritus
  update public."Vinos"
     set nombre = 'Ritus',
         anada = null,
         sin_anada = false
   where id = '453220b5-59f9-4f44-b472-dc7d61be506c'
     and nombre = 'Ritus 2020'
     and anada is not distinct from 2020
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '453220b5-59f9-4f44-b472-dc7d61be506c' and nombre = 'Ritus'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '453220b5-59f9-4f44-b472-dc7d61be506c') then v_saltados := array_append(v_saltados, '453220b5-59f9-4f44-b472-dc7d61be506c (Ritus 2020)');
  end if;

  -- Sierra Cantabria Colección Privada 2021 → Sierra Cantabria Colección Privada
  update public."Vinos"
     set nombre = 'Sierra Cantabria Colección Privada',
         anada = null,
         sin_anada = false
   where id = '4f2bdba3-9850-4a7d-aa56-fb406a2f3424'
     and nombre = 'Sierra Cantabria Colección Privada 2021'
     and anada is not distinct from 2021
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '4f2bdba3-9850-4a7d-aa56-fb406a2f3424' and nombre = 'Sierra Cantabria Colección Privada'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '4f2bdba3-9850-4a7d-aa56-fb406a2f3424') then v_saltados := array_append(v_saltados, '4f2bdba3-9850-4a7d-aa56-fb406a2f3424 (Sierra Cantabria Colección Privada 2021)');
  end if;

  -- Terras Gauda 2023 → Terras Gauda
  update public."Vinos"
     set nombre = 'Terras Gauda',
         anada = null,
         sin_anada = false
   where id = '482ba8da-5974-4fae-8a1a-c15d391d5245'
     and nombre = 'Terras Gauda 2023'
     and anada is not distinct from 2023
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '482ba8da-5974-4fae-8a1a-c15d391d5245' and nombre = 'Terras Gauda'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '482ba8da-5974-4fae-8a1a-c15d391d5245') then v_saltados := array_append(v_saltados, '482ba8da-5974-4fae-8a1a-c15d391d5245 (Terras Gauda 2023)');
  end if;

  -- Terreus 2019 → Terreus
  update public."Vinos"
     set nombre = 'Terreus',
         anada = null,
         sin_anada = false
   where id = '8ae1eafd-7999-4180-93dc-362364091af0'
     and nombre = 'Terreus 2019'
     and anada is not distinct from 2019
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '8ae1eafd-7999-4180-93dc-362364091af0' and nombre = 'Terreus'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '8ae1eafd-7999-4180-93dc-362364091af0') then v_saltados := array_append(v_saltados, '8ae1eafd-7999-4180-93dc-362364091af0 (Terreus 2019)');
  end if;

  -- Tomás Postigo 2022 → Tomás Postigo
  update public."Vinos"
     set nombre = 'Tomás Postigo',
         anada = null,
         sin_anada = false
   where id = '06bf9660-61b1-48ae-8032-5cbaf982d894'
     and nombre = 'Tomás Postigo 2022'
     and anada is not distinct from 2022
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '06bf9660-61b1-48ae-8032-5cbaf982d894' and nombre = 'Tomás Postigo'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '06bf9660-61b1-48ae-8032-5cbaf982d894') then v_saltados := array_append(v_saltados, '06bf9660-61b1-48ae-8032-5cbaf982d894 (Tomás Postigo 2022)');
  end if;

  -- Tomás Postigo 2022 (Magnum) → Tomás Postigo (Magnum)
  update public."Vinos"
     set nombre = 'Tomás Postigo (Magnum)',
         anada = null,
         sin_anada = false
   where id = '8cfcfafc-fcef-4ba5-ac7f-f5fcc850c23e'
     and nombre = 'Tomás Postigo 2022 (Magnum)'
     and anada is not distinct from 2022
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '8cfcfafc-fcef-4ba5-ac7f-f5fcc850c23e' and nombre = 'Tomás Postigo (Magnum)'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '8cfcfafc-fcef-4ba5-ac7f-f5fcc850c23e') then v_saltados := array_append(v_saltados, '8cfcfafc-fcef-4ba5-ac7f-f5fcc850c23e (Tomás Postigo 2022 (Magnum))');
  end if;

  -- Tomás Postigo 5º Año 2020 → Tomás Postigo 5º Año
  update public."Vinos"
     set nombre = 'Tomás Postigo 5º Año',
         anada = null,
         sin_anada = false
   where id = 'de8f93b9-5ad5-4097-8878-3e1357340d5a'
     and nombre = 'Tomás Postigo 5º Año 2020'
     and anada is not distinct from 2020
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'de8f93b9-5ad5-4097-8878-3e1357340d5a' and nombre = 'Tomás Postigo 5º Año'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'de8f93b9-5ad5-4097-8878-3e1357340d5a') then v_saltados := array_append(v_saltados, 'de8f93b9-5ad5-4097-8878-3e1357340d5a (Tomás Postigo 5º Año 2020)');
  end if;

  -- Viña Arana 2017 → Viña Arana
  update public."Vinos"
     set nombre = 'Viña Arana',
         anada = null,
         sin_anada = false
   where id = '1afe9a7d-c4c1-4dea-9d52-c6df8cd13f08'
     and nombre = 'Viña Arana 2017'
     and anada is not distinct from 2017
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '1afe9a7d-c4c1-4dea-9d52-c6df8cd13f08' and nombre = 'Viña Arana'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '1afe9a7d-c4c1-4dea-9d52-c6df8cd13f08') then v_saltados := array_append(v_saltados, '1afe9a7d-c4c1-4dea-9d52-c6df8cd13f08 (Viña Arana 2017)');
  end if;

  -- 200 Monges Reserva 2014 → 200 Monges Reserva
  update public."Vinos"
     set nombre = '200 Monges Reserva',
         anada = null,
         sin_anada = false
   where id = '55713b26-fb21-40f0-80e6-2cb8884f6311'
     and nombre = '200 Monges Reserva 2014'
     and anada is not distinct from 2014
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '55713b26-fb21-40f0-80e6-2cb8884f6311' and nombre = '200 Monges Reserva'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '55713b26-fb21-40f0-80e6-2cb8884f6311') then v_saltados := array_append(v_saltados, '55713b26-fb21-40f0-80e6-2cb8884f6311 (200 Monges Reserva 2014)');
  end if;

  -- Abadía Retuerta Le Domaine 2022 → Abadía Retuerta Le Domaine
  update public."Vinos"
     set nombre = 'Abadía Retuerta Le Domaine',
         anada = null,
         sin_anada = false
   where id = 'ba574335-8727-406a-9180-8afc887f9544'
     and nombre = 'Abadía Retuerta Le Domaine 2022'
     and anada is not distinct from 2022
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'ba574335-8727-406a-9180-8afc887f9544' and nombre = 'Abadía Retuerta Le Domaine'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'ba574335-8727-406a-9180-8afc887f9544') then v_saltados := array_append(v_saltados, 'ba574335-8727-406a-9180-8afc887f9544 (Abadía Retuerta Le Domaine 2022)');
  end if;

  -- Abadía Retuerta Pago Garduña 2019 → Abadía Retuerta Pago Garduña
  update public."Vinos"
     set nombre = 'Abadía Retuerta Pago Garduña',
         anada = null,
         sin_anada = false
   where id = '38d76f0d-7757-4f7f-bc84-05de04a3dbbc'
     and nombre = 'Abadía Retuerta Pago Garduña 2019'
     and anada is not distinct from 2019
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '38d76f0d-7757-4f7f-bc84-05de04a3dbbc' and nombre = 'Abadía Retuerta Pago Garduña'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '38d76f0d-7757-4f7f-bc84-05de04a3dbbc') then v_saltados := array_append(v_saltados, '38d76f0d-7757-4f7f-bc84-05de04a3dbbc (Abadía Retuerta Pago Garduña 2019)');
  end if;

  -- Abadía Retuerta Pago Negralada 2018 → Abadía Retuerta Pago Negralada
  update public."Vinos"
     set nombre = 'Abadía Retuerta Pago Negralada',
         anada = null,
         sin_anada = false
   where id = '2749a417-cfcf-4195-b747-85ac1c7f2c56'
     and nombre = 'Abadía Retuerta Pago Negralada 2018'
     and anada is not distinct from 2018
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '2749a417-cfcf-4195-b747-85ac1c7f2c56' and nombre = 'Abadía Retuerta Pago Negralada'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '2749a417-cfcf-4195-b747-85ac1c7f2c56') then v_saltados := array_append(v_saltados, '2749a417-cfcf-4195-b747-85ac1c7f2c56 (Abadía Retuerta Pago Negralada 2018)');
  end if;

  -- Almirez 2023 → Almirez
  update public."Vinos"
     set nombre = 'Almirez',
         anada = null,
         sin_anada = false
   where id = '219dc294-c7cd-49f4-b2d2-73c5b48697b2'
     and nombre = 'Almirez 2023'
     and anada is not distinct from 2023
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '219dc294-c7cd-49f4-b2d2-73c5b48697b2' and nombre = 'Almirez'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '219dc294-c7cd-49f4-b2d2-73c5b48697b2') then v_saltados := array_append(v_saltados, '219dc294-c7cd-49f4-b2d2-73c5b48697b2 (Almirez 2023)');
  end if;

  -- Artadi Viñas de Gaín 2021 → Artadi Viñas de Gaín
  update public."Vinos"
     set nombre = 'Artadi Viñas de Gaín',
         anada = null,
         sin_anada = false
   where id = '7e02d098-2f4b-4674-ab1b-b70b45293d20'
     and nombre = 'Artadi Viñas de Gaín 2021'
     and anada is not distinct from 2021
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '7e02d098-2f4b-4674-ab1b-b70b45293d20' and nombre = 'Artadi Viñas de Gaín'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '7e02d098-2f4b-4674-ab1b-b70b45293d20') then v_saltados := array_append(v_saltados, '7e02d098-2f4b-4674-ab1b-b70b45293d20 (Artadi Viñas de Gaín 2021)');
  end if;

  -- Belondrade y Lurton 2022 → Belondrade y Lurton
  update public."Vinos"
     set nombre = 'Belondrade y Lurton',
         anada = null,
         sin_anada = false
   where id = '500e4fef-6610-4f7e-8125-d9e22c4b6045'
     and nombre = 'Belondrade y Lurton 2022'
     and anada is not distinct from 2022
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '500e4fef-6610-4f7e-8125-d9e22c4b6045' and nombre = 'Belondrade y Lurton'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '500e4fef-6610-4f7e-8125-d9e22c4b6045') then v_saltados := array_append(v_saltados, '500e4fef-6610-4f7e-8125-d9e22c4b6045 (Belondrade y Lurton 2022)');
  end if;

  -- Bollinger Special Cuvée Brut → Bollinger Special Cuvée Brut
  update public."Vinos"
     set nombre = 'Bollinger Special Cuvée Brut',
         anada = null,
         sin_anada = false
   where id = 'a34df870-a464-4be6-92bc-0528a09762a3'
     and nombre = 'Bollinger Special Cuvée Brut'
     and anada is not distinct from null
     and sin_anada = true;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'a34df870-a464-4be6-92bc-0528a09762a3' and nombre = 'Bollinger Special Cuvée Brut'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'a34df870-a464-4be6-92bc-0528a09762a3') then v_saltados := array_append(v_saltados, 'a34df870-a464-4be6-92bc-0528a09762a3 (Bollinger Special Cuvée Brut)');
  end if;

  -- Casar de Burbia Hombros Mencía 2020 → Casar de Burbia Hombros Mencía
  update public."Vinos"
     set nombre = 'Casar de Burbia Hombros Mencía',
         anada = null,
         sin_anada = false
   where id = '63f6d239-6451-4200-aa3b-8f6136bd642f'
     and nombre = 'Casar de Burbia Hombros Mencía 2020'
     and anada is not distinct from 2020
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '63f6d239-6451-4200-aa3b-8f6136bd642f' and nombre = 'Casar de Burbia Hombros Mencía'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '63f6d239-6451-4200-aa3b-8f6136bd642f') then v_saltados := array_append(v_saltados, '63f6d239-6451-4200-aa3b-8f6136bd642f (Casar de Burbia Hombros Mencía 2020)');
  end if;

  -- Castro do Coto Caíño Blanco 2024 → Castro do Coto Caíño Blanco
  update public."Vinos"
     set nombre = 'Castro do Coto Caíño Blanco',
         anada = null,
         sin_anada = false
   where id = 'e244f79d-d740-4bc1-a569-550f04d0939d'
     and nombre = 'Castro do Coto Caíño Blanco 2024'
     and anada is not distinct from 2024
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'e244f79d-d740-4bc1-a569-550f04d0939d' and nombre = 'Castro do Coto Caíño Blanco'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'e244f79d-d740-4bc1-a569-550f04d0939d') then v_saltados := array_append(v_saltados, 'e244f79d-d740-4bc1-a569-550f04d0939d (Castro do Coto Caíño Blanco 2024)');
  end if;

  -- Château Pindefleurs 2022 → Château Pindefleurs
  update public."Vinos"
     set nombre = 'Château Pindefleurs',
         anada = null,
         sin_anada = false
   where id = '38786511-129f-4b4e-8396-5128d305f80b'
     and nombre = 'Château Pindefleurs 2022'
     and anada is not distinct from 2022
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '38786511-129f-4b4e-8396-5128d305f80b' and nombre = 'Château Pindefleurs'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '38786511-129f-4b4e-8396-5128d305f80b') then v_saltados := array_append(v_saltados, '38786511-129f-4b4e-8396-5128d305f80b (Château Pindefleurs 2022)');
  end if;

  -- Comando G Las Umbrías 2023 → Comando G Las Umbrías
  update public."Vinos"
     set nombre = 'Comando G Las Umbrías',
         anada = null,
         sin_anada = false
   where id = '3b0b59b7-ab96-4a4c-b886-22ac061eab79'
     and nombre = 'Comando G Las Umbrías 2023'
     and anada is not distinct from 2023
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '3b0b59b7-ab96-4a4c-b886-22ac061eab79' and nombre = 'Comando G Las Umbrías'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '3b0b59b7-ab96-4a4c-b886-22ac061eab79') then v_saltados := array_append(v_saltados, '3b0b59b7-ab96-4a4c-b886-22ac061eab79 (Comando G Las Umbrías 2023)');
  end if;

  -- Comando G Rumbo al Norte 2022 → Comando G Rumbo al Norte
  update public."Vinos"
     set nombre = 'Comando G Rumbo al Norte',
         anada = null,
         sin_anada = false
   where id = 'd18df3cc-6636-4534-af13-2c25740764f2'
     and nombre = 'Comando G Rumbo al Norte 2022'
     and anada is not distinct from 2022
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'd18df3cc-6636-4534-af13-2c25740764f2' and nombre = 'Comando G Rumbo al Norte'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'd18df3cc-6636-4534-af13-2c25740764f2') then v_saltados := array_append(v_saltados, 'd18df3cc-6636-4534-af13-2c25740764f2 (Comando G Rumbo al Norte 2022)');
  end if;

  -- Contino Reserva 2020 → Contino Reserva
  update public."Vinos"
     set nombre = 'Contino Reserva',
         anada = null,
         sin_anada = false
   where id = 'bdd5d694-b33c-4299-862f-575b439b4f48'
     and nombre = 'Contino Reserva 2020'
     and anada is not distinct from 2020
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'bdd5d694-b33c-4299-862f-575b439b4f48' and nombre = 'Contino Reserva'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'bdd5d694-b33c-4299-862f-575b439b4f48') then v_saltados := array_append(v_saltados, 'bdd5d694-b33c-4299-862f-575b439b4f48 (Contino Reserva 2020)');
  end if;

  -- Corullón 2023 → Corullón
  update public."Vinos"
     set nombre = 'Corullón',
         anada = null,
         sin_anada = false
   where id = '6a288d00-087a-428e-96ec-af801ba1fcb3'
     and nombre = 'Corullón 2023'
     and anada is not distinct from 2023
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '6a288d00-087a-428e-96ec-af801ba1fcb3' and nombre = 'Corullón'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '6a288d00-087a-428e-96ec-af801ba1fcb3') then v_saltados := array_append(v_saltados, '6a288d00-087a-428e-96ec-af801ba1fcb3 (Corullón 2023)');
  end if;

  -- Domaine Combe Queyzaire Côtes du Rhône 2019 → Domaine Combe Queyzaire Côtes du Rhône
  update public."Vinos"
     set nombre = 'Domaine Combe Queyzaire Côtes du Rhône',
         anada = null,
         sin_anada = false
   where id = '320ea437-fe35-41e4-92d2-6cdfc35c0dc8'
     and nombre = 'Domaine Combe Queyzaire Côtes du Rhône 2019'
     and anada is not distinct from 2019
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '320ea437-fe35-41e4-92d2-6cdfc35c0dc8' and nombre = 'Domaine Combe Queyzaire Côtes du Rhône'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '320ea437-fe35-41e4-92d2-6cdfc35c0dc8') then v_saltados := array_append(v_saltados, '320ea437-fe35-41e4-92d2-6cdfc35c0dc8 (Domaine Combe Queyzaire Côtes du Rhône 2019)');
  end if;

  -- Dominio de Calogía Cuvée S 2020 → Dominio de Calogía Cuvée S
  update public."Vinos"
     set nombre = 'Dominio de Calogía Cuvée S',
         anada = null,
         sin_anada = false
   where id = 'c46d83de-a368-4378-877d-58606d1a8219'
     and nombre = 'Dominio de Calogía Cuvée S 2020'
     and anada is not distinct from 2020
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'c46d83de-a368-4378-877d-58606d1a8219' and nombre = 'Dominio de Calogía Cuvée S'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'c46d83de-a368-4378-877d-58606d1a8219') then v_saltados := array_append(v_saltados, 'c46d83de-a368-4378-877d-58606d1a8219 (Dominio de Calogía Cuvée S 2020)');
  end if;

  -- El Confidente Godello 2024 → El Confidente Godello
  update public."Vinos"
     set nombre = 'El Confidente Godello',
         anada = null,
         sin_anada = false
   where id = '7c4d6a37-e6f4-45ca-9b19-6426b4a3d1ec'
     and nombre = 'El Confidente Godello 2024'
     and anada is not distinct from 2024
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '7c4d6a37-e6f4-45ca-9b19-6426b4a3d1ec' and nombre = 'El Confidente Godello'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '7c4d6a37-e6f4-45ca-9b19-6426b4a3d1ec') then v_saltados := array_append(v_saltados, '7c4d6a37-e6f4-45ca-9b19-6426b4a3d1ec (El Confidente Godello 2024)');
  end if;

  -- El Puntido 2022 → El Puntido
  update public."Vinos"
     set nombre = 'El Puntido',
         anada = null,
         sin_anada = false
   where id = 'f92a9727-9d2e-41da-9466-dd9bd9044a2a'
     and nombre = 'El Puntido 2022'
     and anada is not distinct from 2022
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'f92a9727-9d2e-41da-9466-dd9bd9044a2a' and nombre = 'El Puntido'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'f92a9727-9d2e-41da-9466-dd9bd9044a2a') then v_saltados := array_append(v_saltados, 'f92a9727-9d2e-41da-9466-dd9bd9044a2a (El Puntido 2022)');
  end if;

  -- Fenomenal Verdejo 2024 → Fenomenal Verdejo
  update public."Vinos"
     set nombre = 'Fenomenal Verdejo',
         anada = null,
         sin_anada = false
   where id = '7c15a773-d357-401f-b5dd-8587cc6fe18c'
     and nombre = 'Fenomenal Verdejo 2024'
     and anada is not distinct from 2024
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '7c15a773-d357-401f-b5dd-8587cc6fe18c' and nombre = 'Fenomenal Verdejo'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '7c15a773-d357-401f-b5dd-8587cc6fe18c') then v_saltados := array_append(v_saltados, '7c15a773-d357-401f-b5dd-8587cc6fe18c (Fenomenal Verdejo 2024)');
  end if;

  -- Gramona Brut Imperial Gran Reserva 2019 → Gramona Brut Imperial Gran Reserva
  update public."Vinos"
     set nombre = 'Gramona Brut Imperial Gran Reserva',
         anada = null,
         sin_anada = false
   where id = '53d74758-da94-4d8d-84cb-35bbceee8204'
     and nombre = 'Gramona Brut Imperial Gran Reserva 2019'
     and anada is not distinct from 2019
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '53d74758-da94-4d8d-84cb-35bbceee8204' and nombre = 'Gramona Brut Imperial Gran Reserva'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '53d74758-da94-4d8d-84cb-35bbceee8204') then v_saltados := array_append(v_saltados, '53d74758-da94-4d8d-84cb-35bbceee8204 (Gramona Brut Imperial Gran Reserva 2019)');
  end if;

  -- Gramona Tres Lustros Gran Reserva 2017 → Gramona Tres Lustros Gran Reserva
  update public."Vinos"
     set nombre = 'Gramona Tres Lustros Gran Reserva',
         anada = null,
         sin_anada = false
   where id = '4ecd5d61-cdae-4473-88d1-57127e8296b6'
     and nombre = 'Gramona Tres Lustros Gran Reserva 2017'
     and anada is not distinct from 2017
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '4ecd5d61-cdae-4473-88d1-57127e8296b6' and nombre = 'Gramona Tres Lustros Gran Reserva'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '4ecd5d61-cdae-4473-88d1-57127e8296b6') then v_saltados := array_append(v_saltados, '4ecd5d61-cdae-4473-88d1-57127e8296b6 (Gramona Tres Lustros Gran Reserva 2017)');
  end if;

  -- José Pariente Sauvignon Blanc 2022 (Magnum) → José Pariente Sauvignon Blanc (Magnum)
  update public."Vinos"
     set nombre = 'José Pariente Sauvignon Blanc (Magnum)',
         anada = null,
         sin_anada = false
   where id = '99ce9d00-fca8-4dba-ab27-9d8426520b38'
     and nombre = 'José Pariente Sauvignon Blanc 2022 (Magnum)'
     and anada is not distinct from 2022
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '99ce9d00-fca8-4dba-ab27-9d8426520b38' and nombre = 'José Pariente Sauvignon Blanc (Magnum)'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '99ce9d00-fca8-4dba-ab27-9d8426520b38') then v_saltados := array_append(v_saltados, '99ce9d00-fca8-4dba-ab27-9d8426520b38 (José Pariente Sauvignon Blanc 2022 (Magnum))');
  end if;

  -- Juvé & Camps Gran Juvé 2017 → Juvé & Camps Gran Juvé
  update public."Vinos"
     set nombre = 'Juvé & Camps Gran Juvé',
         anada = null,
         sin_anada = false
   where id = '42b93d88-db5f-4b73-afd4-d21a0fb1938d'
     and nombre = 'Juvé & Camps Gran Juvé 2017'
     and anada is not distinct from 2017
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '42b93d88-db5f-4b73-afd4-d21a0fb1938d' and nombre = 'Juvé & Camps Gran Juvé'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '42b93d88-db5f-4b73-afd4-d21a0fb1938d') then v_saltados := array_append(v_saltados, '42b93d88-db5f-4b73-afd4-d21a0fb1938d (Juvé & Camps Gran Juvé 2017)');
  end if;

  -- La Cueva del Contador 2019 → La Cueva del Contador
  update public."Vinos"
     set nombre = 'La Cueva del Contador',
         anada = null,
         sin_anada = false
   where id = '696ca439-8bba-4e8a-9de5-f1a4e6dc5f8f'
     and nombre = 'La Cueva del Contador 2019'
     and anada is not distinct from 2019
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '696ca439-8bba-4e8a-9de5-f1a4e6dc5f8f' and nombre = 'La Cueva del Contador'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '696ca439-8bba-4e8a-9de5-f1a4e6dc5f8f') then v_saltados := array_append(v_saltados, '696ca439-8bba-4e8a-9de5-f1a4e6dc5f8f (La Cueva del Contador 2019)');
  end if;

  -- La Rioja Alta Gran Reserva 890 2010 (Magnum) → La Rioja Alta Gran Reserva 890 (Magnum)
  update public."Vinos"
     set nombre = 'La Rioja Alta Gran Reserva 890 (Magnum)',
         anada = null,
         sin_anada = false
   where id = '8b7e528f-7d6b-413b-9100-8671ae590d05'
     and nombre = 'La Rioja Alta Gran Reserva 890 2010 (Magnum)'
     and anada is not distinct from 2010
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '8b7e528f-7d6b-413b-9100-8671ae590d05' and nombre = 'La Rioja Alta Gran Reserva 890 (Magnum)'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '8b7e528f-7d6b-413b-9100-8671ae590d05') then v_saltados := array_append(v_saltados, '8b7e528f-7d6b-413b-9100-8671ae590d05 (La Rioja Alta Gran Reserva 890 2010 (Magnum))');
  end if;

  -- Laurent-Perrier Blanc de Blancs Brut Nature → Laurent-Perrier Blanc de Blancs Brut Nature
  update public."Vinos"
     set nombre = 'Laurent-Perrier Blanc de Blancs Brut Nature',
         anada = null,
         sin_anada = false
   where id = '3393f537-9c82-432a-a423-6115b5eed70e'
     and nombre = 'Laurent-Perrier Blanc de Blancs Brut Nature'
     and anada is not distinct from null
     and sin_anada = true;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '3393f537-9c82-432a-a423-6115b5eed70e' and nombre = 'Laurent-Perrier Blanc de Blancs Brut Nature'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '3393f537-9c82-432a-a423-6115b5eed70e') then v_saltados := array_append(v_saltados, '3393f537-9c82-432a-a423-6115b5eed70e (Laurent-Perrier Blanc de Blancs Brut Nature)');
  end if;

  -- Laurent-Perrier Héritage Brut → Laurent-Perrier Héritage Brut
  update public."Vinos"
     set nombre = 'Laurent-Perrier Héritage Brut',
         anada = null,
         sin_anada = false
   where id = '0e213a1d-d5d3-4821-b02d-fd106eab7ba8'
     and nombre = 'Laurent-Perrier Héritage Brut'
     and anada is not distinct from null
     and sin_anada = true;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '0e213a1d-d5d3-4821-b02d-fd106eab7ba8' and nombre = 'Laurent-Perrier Héritage Brut'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '0e213a1d-d5d3-4821-b02d-fd106eab7ba8') then v_saltados := array_append(v_saltados, '0e213a1d-d5d3-4821-b02d-fd106eab7ba8 (Laurent-Perrier Héritage Brut)');
  end if;

  -- Marqués de Murrieta Reserva 2020 (Magnum) → Marqués de Murrieta Reserva (Magnum)
  update public."Vinos"
     set nombre = 'Marqués de Murrieta Reserva (Magnum)',
         anada = null,
         sin_anada = false
   where id = '27f941e0-9a95-492d-b939-12f2d7abdcb4'
     and nombre = 'Marqués de Murrieta Reserva 2020 (Magnum)'
     and anada is not distinct from 2020
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '27f941e0-9a95-492d-b939-12f2d7abdcb4' and nombre = 'Marqués de Murrieta Reserva (Magnum)'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '27f941e0-9a95-492d-b939-12f2d7abdcb4') then v_saltados := array_append(v_saltados, '27f941e0-9a95-492d-b939-12f2d7abdcb4 (Marqués de Murrieta Reserva 2020 (Magnum))');
  end if;

  -- Marqués de Vargas Reserva 2017 → Marqués de Vargas Reserva
  update public."Vinos"
     set nombre = 'Marqués de Vargas Reserva',
         anada = null,
         sin_anada = false
   where id = '1c5569cd-f889-42b9-905c-0c7d80d6c5a3'
     and nombre = 'Marqués de Vargas Reserva 2017'
     and anada is not distinct from 2017
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '1c5569cd-f889-42b9-905c-0c7d80d6c5a3' and nombre = 'Marqués de Vargas Reserva'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '1c5569cd-f889-42b9-905c-0c7d80d6c5a3') then v_saltados := array_append(v_saltados, '1c5569cd-f889-42b9-905c-0c7d80d6c5a3 (Marqués de Vargas Reserva 2017)');
  end if;

  -- Oremus Mandolás Furmint 2022 → Oremus Mandolás Furmint
  update public."Vinos"
     set nombre = 'Oremus Mandolás Furmint',
         anada = null,
         sin_anada = false
   where id = '621d142c-5ee2-48d9-97fe-52107a644727'
     and nombre = 'Oremus Mandolás Furmint 2022'
     and anada is not distinct from 2022
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '621d142c-5ee2-48d9-97fe-52107a644727' and nombre = 'Oremus Mandolás Furmint'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '621d142c-5ee2-48d9-97fe-52107a644727') then v_saltados := array_append(v_saltados, '621d142c-5ee2-48d9-97fe-52107a644727 (Oremus Mandolás Furmint 2022)');
  end if;

  -- Pago de Otazu Chardonnay 2020 → Pago de Otazu Chardonnay
  update public."Vinos"
     set nombre = 'Pago de Otazu Chardonnay',
         anada = null,
         sin_anada = false
   where id = 'af54c80e-f17e-4050-ab03-205cdccd8aed'
     and nombre = 'Pago de Otazu Chardonnay 2020'
     and anada is not distinct from 2020
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'af54c80e-f17e-4050-ab03-205cdccd8aed' and nombre = 'Pago de Otazu Chardonnay'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'af54c80e-f17e-4050-ab03-205cdccd8aed') then v_saltados := array_append(v_saltados, 'af54c80e-f17e-4050-ab03-205cdccd8aed (Pago de Otazu Chardonnay 2020)');
  end if;

  -- Pandora Verdejo 2023 → Pandora Verdejo
  update public."Vinos"
     set nombre = 'Pandora Verdejo',
         anada = null,
         sin_anada = false
   where id = '8b8e631d-dd87-499a-a5b2-928d3fef0469'
     and nombre = 'Pandora Verdejo 2023'
     and anada is not distinct from 2023
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '8b8e631d-dd87-499a-a5b2-928d3fef0469' and nombre = 'Pandora Verdejo'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '8b8e631d-dd87-499a-a5b2-928d3fef0469') then v_saltados := array_append(v_saltados, '8b8e631d-dd87-499a-a5b2-928d3fef0469 (Pandora Verdejo 2023)');
  end if;

  -- Petra de Valpiedra Garnacha 2017 → Petra de Valpiedra Garnacha
  update public."Vinos"
     set nombre = 'Petra de Valpiedra Garnacha',
         anada = null,
         sin_anada = false
   where id = '88d2f1ab-f25f-4088-957d-413e197643f3'
     and nombre = 'Petra de Valpiedra Garnacha 2017'
     and anada is not distinct from 2017
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '88d2f1ab-f25f-4088-957d-413e197643f3' and nombre = 'Petra de Valpiedra Garnacha'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '88d2f1ab-f25f-4088-957d-413e197643f3') then v_saltados := array_append(v_saltados, '88d2f1ab-f25f-4088-957d-413e197643f3 (Petra de Valpiedra Garnacha 2017)');
  end if;

  -- Pintia 2019 → Pintia
  update public."Vinos"
     set nombre = 'Pintia',
         anada = null,
         sin_anada = false
   where id = 'd6f6124a-e6e9-4824-9e25-b5d42ca334ba'
     and nombre = 'Pintia 2019'
     and anada is not distinct from 2019
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'd6f6124a-e6e9-4824-9e25-b5d42ca334ba' and nombre = 'Pintia'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'd6f6124a-e6e9-4824-9e25-b5d42ca334ba') then v_saltados := array_append(v_saltados, 'd6f6124a-e6e9-4824-9e25-b5d42ca334ba (Pintia 2019)');
  end if;

  -- Qué Bonito Cacareaba 2021 → Qué Bonito Cacareaba
  update public."Vinos"
     set nombre = 'Qué Bonito Cacareaba',
         anada = null,
         sin_anada = false
   where id = '0f8279dc-0f3e-4c68-9309-0cd029c39241'
     and nombre = 'Qué Bonito Cacareaba 2021'
     and anada is not distinct from 2021
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '0f8279dc-0f3e-4c68-9309-0cd029c39241' and nombre = 'Qué Bonito Cacareaba'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '0f8279dc-0f3e-4c68-9309-0cd029c39241') then v_saltados := array_append(v_saltados, '0f8279dc-0f3e-4c68-9309-0cd029c39241 (Qué Bonito Cacareaba 2021)');
  end if;

  -- Riscal XR 2019 (Magnum) → Riscal XR (Magnum)
  update public."Vinos"
     set nombre = 'Riscal XR (Magnum)',
         anada = null,
         sin_anada = false
   where id = 'bbb74810-0849-459c-8ed8-4406caa78773'
     and nombre = 'Riscal XR 2019 (Magnum)'
     and anada is not distinct from 2019
     and sin_anada = false;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'bbb74810-0849-459c-8ed8-4406caa78773' and nombre = 'Riscal XR (Magnum)'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'bbb74810-0849-459c-8ed8-4406caa78773') then v_saltados := array_append(v_saltados, 'bbb74810-0849-459c-8ed8-4406caa78773 (Riscal XR 2019 (Magnum))');
  end if;

  -- Veuve Clicquot Brut (Carte Jaune) → Veuve Clicquot Brut (Carte Jaune)
  update public."Vinos"
     set nombre = 'Veuve Clicquot Brut (Carte Jaune)',
         anada = null,
         sin_anada = false
   where id = '4e63cd1b-1a57-4187-9a4c-ac43810f88b9'
     and nombre = 'Veuve Clicquot Brut (Carte Jaune)'
     and anada is not distinct from null
     and sin_anada = true;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = '4e63cd1b-1a57-4187-9a4c-ac43810f88b9' and nombre = 'Veuve Clicquot Brut (Carte Jaune)'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = '4e63cd1b-1a57-4187-9a4c-ac43810f88b9') then v_saltados := array_append(v_saltados, '4e63cd1b-1a57-4187-9a4c-ac43810f88b9 (Veuve Clicquot Brut (Carte Jaune))');
  end if;

  -- Viña Corrales Fino → Viña Corrales Fino
  update public."Vinos"
     set nombre = 'Viña Corrales Fino',
         anada = null,
         sin_anada = false
   where id = 'b2f2f856-7458-4fe0-9468-b7a21a35559b'
     and nombre = 'Viña Corrales Fino'
     and anada is not distinct from null
     and sin_anada = true;
  get diagnostics n = row_count;
  if n = 1 then v_vinos := v_vinos + 1;
  elsif exists (select 1 from public."Vinos" where id = 'b2f2f856-7458-4fe0-9468-b7a21a35559b' and nombre = 'Viña Corrales Fino'
                  and anada is not distinct from null and sin_anada = false) then v_ya := v_ya + 1;
  elsif exists (select 1 from public."Vinos" where id = 'b2f2f856-7458-4fe0-9468-b7a21a35559b') then v_saltados := array_append(v_saltados, 'b2f2f856-7458-4fe0-9468-b7a21a35559b (Viña Corrales Fino)');
  end if;

  raise notice '20261110_vinos_anadas_parker_demo_ROLLBACK: % vinos cambiados, % ya estaban, % cambios en puntuaciones Parker.', v_vinos, v_ya, v_parker;
  if cardinality(v_saltados) > 0 then
    raise notice '20261110_vinos_anadas_parker_demo_ROLLBACK: % saltados porque alguien los cambió después (revisar a mano): %',
      cardinality(v_saltados), array_to_string(v_saltados, '; ');
  end if;
end;
$$;

commit;
