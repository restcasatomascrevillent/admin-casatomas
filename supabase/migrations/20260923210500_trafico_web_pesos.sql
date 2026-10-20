-- ===========================================================================
-- SIN APLICAR (escrita 2026-09-23, cambio SDD `trafico-web`, tarea 0.3).
-- Requiere 20260923200000_trafico_web.sql (tabla public.peso_paginas).
-- ---------------------------------------------------------------------------
-- Pesos MEDIDOS de primera visita (sin cache) por ruta, para la ESTIMACION de
-- Fast Data Transfer (visitas x bytes_por_visita).
--
-- Origen: auditoria FDT del 2026-09-23 (engram perf/fdt-audit). Cada ruta se
-- cargo en Chrome headless contando los bytes servidos por el servidor, con
-- los recursos de texto en BROTLI (como los sirve Vercel). Es la primera
-- visita: las siguientes pesan mucho menos (cache), asi que la estimacion es
-- conservadora (por arriba).
--
--   casa-tomas-story
--     /           667 844 B
--     /carta      430 854 B
--     /carta/*    ~450 000 B (media de las paginas de carta, 421-487 KB)
--     /reservas   466 851 B
--     *           ~470 000 B (media ponderada del sitio)
--
--   touza-restaurant-website (YA optimizado tras la auditoria; la medicion
--   original de / era 905 521 B)
--     /           ~680 000 B (~579 KB movil / ~772 KB escritorio, promedio)
--     /carta      338 000 B
--     /galeria    374 000 B
--     /contacto   201 000 B
--     /reservado  ~420 000 B
--     *           ~400 000 B
--
-- Sustituye la semilla PROVISIONAL de 20260923200000 (2.5 MB / 1.5 MB, sin
-- medir). Idempotente: upsert por PK (proyecto, ruta). OJO: si alguien ya ha
-- corregido estas mismas rutas desde el panel, re-ejecutar la migracion las
-- pisa con estos valores medidos (solo se tocan las rutas listadas aqui).
--
-- NOTA sobre '/carta/*': en peso_paginas la ruta se compara por IGUALDAD con
-- la ruta de trafico_web_diario, no como patron. La fila '/carta/*' solo
-- aplicara si la API de Vercel agrupa asi las rutas dinamicas; si no, las
-- paginas de carta concretas usan el '*' del proyecto (~470 KB, muy parecido).
-- ===========================================================================

begin;

insert into public.peso_paginas (proyecto, ruta, bytes_por_visita, nota, actualizado_en) values
  ('casa-tomas-story', '*',         470000, 'Medido 2026-09-23: media primera visita (brotli) de las rutas principales.', now()),
  ('casa-tomas-story', '/',         667844, 'Medido 2026-09-23: primera visita, brotli.', now()),
  ('casa-tomas-story', '/carta',    430854, 'Medido 2026-09-23: primera visita, brotli.', now()),
  ('casa-tomas-story', '/carta/*',  450000, 'Medido 2026-09-23: media de las paginas de carta (421-487 KB), primera visita, brotli.', now()),
  ('casa-tomas-story', '/reservas', 466851, 'Medido 2026-09-23: primera visita, brotli.', now()),

  ('touza-restaurant-website', '*',          400000, 'Medido 2026-09-23 tras optimizar: media primera visita (brotli).', now()),
  ('touza-restaurant-website', '/',          680000, 'Medido 2026-09-23 tras optimizar: ~579 KB movil / ~772 KB escritorio, primera visita, brotli.', now()),
  ('touza-restaurant-website', '/carta',     338000, 'Medido 2026-09-23 tras optimizar: primera visita, brotli.', now()),
  ('touza-restaurant-website', '/galeria',   374000, 'Medido 2026-09-23 tras optimizar: primera visita, brotli.', now()),
  ('touza-restaurant-website', '/contacto',  201000, 'Medido 2026-09-23 tras optimizar: primera visita, brotli.', now()),
  ('touza-restaurant-website', '/reservado', 420000, 'Medido 2026-09-23 tras optimizar: primera visita, brotli (aprox.).', now())
on conflict (proyecto, ruta) do update
  set bytes_por_visita = excluded.bytes_por_visita,
      nota             = excluded.nota,
      actualizado_en   = now();

commit;
