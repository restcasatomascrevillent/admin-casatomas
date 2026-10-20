-- ===========================================================================
-- Tests SQL de 20260923200000_trafico_web.sql (cambio SDD trafico-web, 1.7)
-- ---------------------------------------------------------------------------
-- SQL plano (no pgTAP): cada comprobacion es un ASSERT dentro de un DO; el
-- primer fallo aborta con "ASSERT FAILED: <mensaje>". Todo va en una
-- transaccion que termina en ROLLBACK: no deja nada escrito.
--
-- Ejecutar SOLO contra una base local/de pruebas con la migracion aplicada:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/trafico_web_test.sql
-- Si termina en ROLLBACK sin ERROR, todo ha pasado.
--
-- Cubre: sabados 3x no anomalos, pico real = anomalia, n<3 -> NULL, huecos
-- -> NULL, ruta sin peso -> fallback '*', sin ningun peso -> NULL, FDT del
-- mes con remanente, regresion, authenticated sin permiso -> 0 filas,
-- insert rechazado, cron x2 -> 1 job.
-- ===========================================================================

begin;

-- Partir de tablas vacias dentro de la transaccion (por si la base local ya
-- tiene datos sincronizados). Se deshace con el ROLLBACK final.
delete from public.trafico_web_diario;
delete from public.trafico_web_desglose;
delete from public.peso_paginas;

insert into public.peso_paginas (proyecto, ruta, bytes_por_visita) values
  ('casa-tomas-story', '*',      2500000),
  ('casa-tomas-story', '/carta', 1000000);
-- touza SIN ningun peso a proposito (caso "FDT = NULL").

-- ---------------------------------------------------------------------------
-- Datos sinteticos casa-tomas: 70 dias cerrados hasta ayer.
--   entre semana ~100 (100/105/110), sabados ~300 (300/310/320),
--   hueco (sin fila) hace 20 dias, pico de 1000 hace 3 dias salvo que sea
--   sabado (entonces hace 4).
-- touza: solo 10 dias -> como mucho 1 muestra por isodow -> z/anomalia NULL.
-- ---------------------------------------------------------------------------
do $$
declare
  v_dia  date;
  v_pico date := case when extract(isodow from current_date - 3) = 6
                      then current_date - 4 else current_date - 3 end;
  i int;
begin
  for i in 1..70 loop
    v_dia := current_date - i;
    continue when v_dia = current_date - 20;             -- hueco
    insert into public.trafico_web_diario (fecha, proyecto, ruta, visitas, visitantes)
    values (v_dia, 'casa-tomas-story', '*',
            case when v_dia = v_pico then 1000
                 when extract(isodow from v_dia) = 6 then 300 + (i % 3) * 10
                 else 100 + (i % 3) * 5 end,
            null);
  end loop;

  for i in 1..10 loop
    insert into public.trafico_web_diario (fecha, proyecto, ruta, visitas, visitantes)
    values (current_date - i, 'touza-restaurant-website', '*', 50 + i, 40 + i);
  end loop;

  -- Un dia cerrado de un mes antiguo para probar FDT (mes 2025-01 completo).
  --   total 100 visitas; '/' 50 (sin peso propio -> 2.5 MB), '/carta' 30
  --   (1 MB); remanente 20 -> 2.5 MB.
  --   bytes = 50*2.5e6 + 30*1e6 + 20*2.5e6 = 205e6
  insert into public.trafico_web_diario (fecha, proyecto, ruta, visitas) values
    ('2025-01-10', 'casa-tomas-story', '*',      100),
    ('2025-01-10', 'casa-tomas-story', '/',       50),
    ('2025-01-10', 'casa-tomas-story', '/carta',  30),
    ('2025-01-10', 'touza-restaurant-website', '*', 10),
    ('2025-01-10', 'touza-restaurant-website', '/', 10);

  insert into public.trafico_web_desglose (fecha, proyecto, dimension, valor, visitas, visitantes) values
    ('2025-01-10', 'casa-tomas-story', 'device', 'mobile',  70, 60),
    ('2025-01-10', 'casa-tomas-story', 'device', 'desktop', 30, null);
end;
$$;

-- ---------------------------------------------------------------------------
-- T1 serie: sabados 3x NO son anomalia; el pico SI; n<3 -> NULL; hueco NULL
-- ---------------------------------------------------------------------------
do $$
declare
  v_pico date := case when extract(isodow from current_date - 3) = 6
                      then current_date - 4 else current_date - 3 end;
  r record;
  n int;
begin
  -- sabados con base suficiente: ninguno anomalo
  select count(*) into n
  from public.trafico_web_serie('casa-tomas-story', current_date - 30, current_date - 1) s
  where extract(isodow from s.fecha) = 6 and s.es_anomalia is true;
  assert n = 0, format('T1a: %s sabados marcados como anomalia', n);

  select count(*) into n
  from public.trafico_web_serie('casa-tomas-story', current_date - 30, current_date - 1) s
  where extract(isodow from s.fecha) = 6 and s.es_anomalia is false;
  assert n >= 3, format('T1a: se esperaban >=3 sabados evaluados como no anomalos, hay %s', n);

  -- el pico si es anomalia
  select * into r
  from public.trafico_web_serie('casa-tomas-story', current_date - 30, current_date - 1) s
  where s.fecha = v_pico;
  assert r.es_anomalia is true, format('T1b: el pico (%s, %s visitas) no sale como anomalia (z=%s)', v_pico, r.visitas, r.z_dow);
  assert r.z_dow > 2, 'T1b: z del pico <= 2';

  -- hueco: visitas NULL, anomalia NULL (no false, no 0)
  select * into r
  from public.trafico_web_serie('casa-tomas-story', current_date - 30, current_date - 1) s
  where s.fecha = current_date - 20;
  assert r.visitas is null, 'T1c: el hueco deberia tener visitas NULL';
  assert r.es_anomalia is null and r.z_dow is null, 'T1c: el hueco deberia tener anomalia/z NULL';

  -- touza: < 3 muestras por isodow -> z y anomalia NULL en todos los dias
  select count(*) into n
  from public.trafico_web_serie('touza-restaurant-website', current_date - 10, current_date - 1) s
  where s.es_anomalia is not null or s.z_dow is not null;
  assert n = 0, format('T1d: con n<3 hay %s dias con z/anomalia no NULL', n);

  select count(*) into n
  from public.trafico_web_serie('touza-restaurant-website', current_date - 10, current_date - 1) s
  where s.visitantes is not null;
  assert n = 10, 'T1e: touza trae visitantes en todas sus filas';

  -- p_proyecto NULL suma ambas webs
  select s.visitas into n
  from public.trafico_web_serie(null, current_date - 1, current_date - 1) s;
  assert n = (select sum(visitas) from public.trafico_web_diario
              where ruta = '*' and fecha = current_date - 1),
    'T1f: p_proyecto NULL no suma las dos webs';

  -- visitantes NULL si alguna web no lo trae (casa-tomas no lo trae)
  select count(*) into n
  from public.trafico_web_serie(null, current_date - 5, current_date - 1) s
  where s.visitantes is not null;
  assert n = 0, 'T1g: visitantes sumados deberian ser NULL si falta en una web';
end;
$$;

-- ---------------------------------------------------------------------------
-- T2 tendencia: fiable con >=14 dias; con < 14 fiable=false (R6)
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  select * into r from public.trafico_web_tendencia('casa-tomas-story', 90);
  assert r.n = 69, format('T2a: n esperado 69 (70 dias - hueco), es %s', r.n);
  assert r.fiable is true, 'T2a: con 69 dias deberia ser fiable';
  assert jsonb_array_length(r.proyeccion) = 30, 'T2a: proyeccion deberia tener 30 puntos';
  assert r.total_30d is not null, 'T2a: total_30d no deberia ser NULL';

  select * into r from public.trafico_web_tendencia('touza-restaurant-website', 90);
  assert r.n = 10 and r.fiable is false, 'T2b: 10 dias -> fiable=false';
  -- touza: visitas = 50 + dias_atras -> baja 1 visita/dia hacia hoy
  assert r.pendiente = -1, format('T2b: pendiente esperada -1, da %s', r.pendiente);
  assert r.r2 = 1, 'T2b: ajuste perfecto -> r2 = 1';
end;
$$;

-- ---------------------------------------------------------------------------
-- T3 FDT: fallback de peso, remanente, sin peso -> NULL, mes cerrado
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  -- ruta sin peso propio -> usa el '*' del proyecto
  select * into r from public.trafico_web_top_paginas('casa-tomas-story', '2025-01-10', '2025-01-10', 20, 'visitas')
  where ruta = '/';
  assert r.bytes_estimados = 125000000, format('T3a: / deberia estimar 125e6 (fallback), da %s', r.bytes_estimados);
  assert r.pct_visitas = 50, format('T3a: / deberia ser 50%% de las visitas, da %s', r.pct_visitas);

  select * into r from public.trafico_web_top_paginas('casa-tomas-story', '2025-01-10', '2025-01-10', 20, 'visitas')
  where ruta = '/carta';
  assert r.bytes_estimados = 30000000, 'T3b: /carta deberia usar su peso propio (30e6)';

  -- proyecto sin ningun peso -> NULL, nunca 0
  select * into r from public.trafico_web_top_paginas('touza-restaurant-website', '2025-01-10', '2025-01-10', 20, 'visitas')
  where ruta = '/';
  assert r.bytes_estimados is null, 'T3c: sin peso alguno el FDT debe ser NULL';

  -- orden por bytes
  select * into r from public.trafico_web_top_paginas(null, '2025-01-10', '2025-01-10', 1, 'bytes');
  assert r.ruta = '/' and r.proyecto = 'casa-tomas-story', 'T3d: orden por bytes';

  -- mes cerrado 2025-01: acumulado = 205e6 (con remanente), lineal = x31
  select * into r from public.trafico_web_fdt_mes('2025-01-15') where proyecto = 'casa-tomas-story';
  assert r.bytes_acumulados = 205000000, format('T3e: acumulado esperado 205e6, da %s', r.bytes_acumulados);
  assert r.dias_con_dato = 1 and r.dias_mes = 31 and r.dias_restantes = 0, 'T3e: dias';
  assert r.bytes_proy_lineal = 205000000::numeric * 31, 'T3e: proyeccion lineal';
  assert r.bytes_proy_regresion = 205000000, 'T3e: mes cerrado -> proyeccion regresion = acumulado';
  assert r.alerta_80 is false, 'T3e: sin alerta';

  select * into r from public.trafico_web_fdt_mes('2025-01-01') where proyecto = 'touza-restaurant-website';
  assert r.bytes_acumulados is null and r.dias_con_dato = 0, 'T3f: touza sin peso -> acumulado NULL';

  select * into r from public.trafico_web_fdt_mes('2025-01-01') where proyecto = '*';
  assert r.bytes_acumulados = 205000000, 'T3g: total = suma de proyectos con estimacion';
  assert r.limite_bytes = 100e9, 'T3g: limite 100e9';

  -- R4: alerta cuando la proyeccion supera 80e9 (subimos el peso)
  update public.peso_paginas set bytes_por_visita = 1000000000 where proyecto = 'casa-tomas-story';
  select * into r from public.trafico_web_fdt_mes('2025-01-01') where proyecto = '*';
  assert r.alerta_80 is true, 'T3h: proyeccion > 80e9 deberia activar alerta_80';
  update public.peso_paginas set bytes_por_visita = 2500000 where proyecto = 'casa-tomas-story' and ruta = '*';
  update public.peso_paginas set bytes_por_visita = 1000000 where proyecto = 'casa-tomas-story' and ruta = '/carta';

  -- mes actual: devuelve 3 filas y no revienta
  assert (select count(*) from public.trafico_web_fdt_mes()) = 3, 'T3i: 3 filas (2 proyectos + total)';
end;
$$;

-- ---------------------------------------------------------------------------
-- T4 desgloses: pct y visitantes NULL si falta en alguna fila
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  select * into r from public.trafico_web_desglose_resumen('casa-tomas-story', 'device', '2025-01-01', '2025-01-31', 10)
  where valor = 'mobile';
  assert r.visitas = 70 and r.pct = 70 and r.visitantes = 60, 'T4a: mobile 70 / 70%% / 60 visitantes';

  select * into r from public.trafico_web_desglose_resumen('casa-tomas-story', 'device', '2025-01-01', '2025-01-31', 10)
  where valor = 'desktop';
  assert r.visitantes is null, 'T4b: visitantes NULL -> NULL, nunca 0';

  assert not exists (select 1 from public.trafico_web_desglose_resumen('casa-tomas-story', 'country', '2025-01-01', '2025-01-31', 10)),
    'T4c: dimension sin datos -> 0 filas';
end;
$$;

-- ---------------------------------------------------------------------------
-- T5 acceso: authenticated SIN la seccion trafico_web -> 0 filas y no escribe
-- (sub inventado: no es admin ni tiene user_permissions)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000fe","role":"authenticated"}';

do $$
declare n int; r record;
begin
  assert (select count(*) from public.trafico_web_diario) = 0,      'T5a: diario visible sin permiso';
  assert (select count(*) from public.trafico_web_desglose) = 0,    'T5a: desglose visible sin permiso';
  assert (select count(*) from public.peso_paginas) = 0,            'T5a: peso_paginas visible sin permiso';
  assert (select count(*) from public.trafico_web_sync_estado) = 0, 'T5a: sync_estado visible sin permiso';

  select count(s.visitas) into n from public.trafico_web_serie(null, current_date - 30, current_date - 1) s;
  assert n = 0, 'T5b: la RPC serie devuelve visitas sin permiso';
  select * into r from public.trafico_web_tendencia(null, 90);
  assert r.n = 0 and r.proyeccion is null, 'T5b: la RPC tendencia devuelve datos sin permiso';
  assert not exists (select 1 from public.trafico_web_top_paginas(null, '2025-01-01', '2025-01-31', 20, 'visitas')),
    'T5b: top_paginas devuelve filas sin permiso';
  assert (select bytes_acumulados from public.trafico_web_fdt_mes('2025-01-01') where proyecto = '*') is null,
    'T5b: fdt_mes estima bytes sin permiso';

  begin
    insert into public.trafico_web_diario (fecha, proyecto, ruta, visitas)
    values (current_date, 'casa-tomas-story', '*', 1);
    raise exception 'T5c: authenticated pudo insertar en trafico_web_diario';
  exception when insufficient_privilege then null;   -- esperado (sin GRANT)
  end;

  begin
    insert into public.peso_paginas (proyecto, ruta, bytes_por_visita)
    values ('casa-tomas-story', '/x', 1);
    raise exception 'T5d: authenticated sin permiso pudo insertar en peso_paginas';
  exception when insufficient_privilege then null;   -- esperado (RLS: new row violates policy)
  end;
end;
$$;

reset role;

-- ---------------------------------------------------------------------------
-- T6 anon: ni tablas ni RPC
-- ---------------------------------------------------------------------------
set local role anon;
do $$
begin
  begin
    perform 1 from public.trafico_web_diario limit 1;
    raise exception 'T6a: anon puede leer trafico_web_diario';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.trafico_web_tendencia(null, 90);
    raise exception 'T6b: anon puede ejecutar trafico_web_tendencia';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- ---------------------------------------------------------------------------
-- T7 cron: re-ejecutar el bloque de la migracion deja exactamente 1 job
-- ---------------------------------------------------------------------------
select cron.unschedule('sync-trafico-web') where exists (select 1 from cron.job where jobname = 'sync-trafico-web');
select cron.schedule('sync-trafico-web', '30 3 * * *', $$ select 1 $$);
select cron.unschedule('sync-trafico-web') where exists (select 1 from cron.job where jobname = 'sync-trafico-web');
select cron.schedule('sync-trafico-web', '30 3 * * *', $$ select 1 $$);

do $$
begin
  assert (select count(*) from cron.job where jobname = 'sync-trafico-web') = 1,
    'T7: tras dos ejecuciones deberia haber exactamente 1 job sync-trafico-web';
end;
$$;

do $$ begin raise notice 'trafico_web_test: TODOS LOS TESTS OK'; end; $$;

rollback;
