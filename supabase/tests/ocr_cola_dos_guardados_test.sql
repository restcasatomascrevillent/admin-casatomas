set client_encoding = 'UTF8';
-- ===========================================================================
-- Pruebas de 20261212610000_ocr_cola_dos_guardados.sql
-- SQL plano con ASSERT dentro de BEGIN … ROLLBACK: no deja nada escrito, y
-- las peticiones de pg_net que se encolen aquí se descartan con el ROLLBACK
-- (net.http_post solo envía tras COMMIT). DESPUÉS de aplicar la migración:
--   npx supabase db query --linked -f supabase/tests/ocr_cola_dos_guardados_test.sql
-- Si termina sin ERROR e imprime «ocr_cola_dos_guardados_test: OK», todo ha pasado.
--
-- Cubre (los topes son de TODO el sistema; se aparta lo que ya hubiera en marcha):
--   C1 con 2 documentos guardándose, un tercero espera; con 1, entra.
--   C2 con 6 piezas leyéndose, una nueva espera; con 5, entra.
--   C3 la cola (ocr_despachar_cola) da paso al que esperaba cuando hay hueco.
-- ===========================================================================

begin;

do $$
declare
  v_user uuid;
  v_tc   uuid;
  n      integer;
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'ocr_trabajos_secret' and coalesce(decrypted_secret, '') <> '') then
    raise notice 'ocr_cola_dos_guardados_test: sin el secreto ocr_trabajos_secret en Vault; no se puede probar el despacho';
    return;
  end if;
  assert position('c_max_consolidaciones constant integer := 2' in pg_get_functiondef('public.ocr_despachar(uuid)'::regprocedure)) > 0,
    'C0: la migración no está aplicada (tope de consolidaciones distinto de 2)';

  select id into v_user from auth.users order by created_at limit 1;
  -- Lo que hubiera en marcha de verdad no cuenta para la prueba (se deshace con el ROLLBACK).
  update public.ocr_trabajos set lease_hasta = now() - interval '1 second', consolidar_despachado_at = null
   where estado in ('consolidando', 'paginas');
  update public.ocr_trabajo_paginas set lease_hasta = now() - interval '1 second', despachada_at = null
   where estado in ('procesando', 'pendiente');

  -- ─── C1. Guardar: 2 a la vez ─────────────────────────────────────────────
  insert into public.ocr_trabajos (id, creado_por, num_paginas, origen, nombre_original, estado, lease_hasta)
  select gen_random_uuid(), v_user, 1, 'imagen', 'c1-consol-' || g || '.jpg', 'consolidando', now() + interval '2 minutes' from generate_series(1, 2) g;
  insert into public.ocr_trabajos (id, creado_por, num_paginas, origen, nombre_original, estado)
  values (gen_random_uuid(), v_user, 1, 'imagen', 'c1-espera.jpg', 'paginas') returning id into v_tc;
  insert into public.ocr_trabajo_paginas (trabajo_id, numero, pieza, pagina_doc, storage_path, mime, bytes, estado)
  values (v_tc, 1, 'pagina', 1, 'pendientes/x/c1/01.jpg', 'image/jpeg', 1000, 'completada');
  n := public.ocr_despachar(v_tc);
  assert n = 0, format('C1a: con 2 guardándose no se despacha un tercero (%s)', n);
  assert (select consolidar_despachado_at is null from public.ocr_trabajos where id = v_tc), 'C1b: sigue en la cola';
  -- Se libera uno: queda 1 guardándose → entra.
  update public.ocr_trabajos set lease_hasta = now() - interval '1 second'
   where id = (select id from public.ocr_trabajos where nombre_original = 'c1-consol-1.jpg');
  n := public.ocr_despachar_cola();
  assert n >= 1 and (select consolidar_despachado_at is not null from public.ocr_trabajos where id = v_tc),
    format('C3a: al quedar hueco, la cola lo despacha (%s)', n);

  -- ─── C2. Leer: 6 piezas a la vez ─────────────────────────────────────────
  update public.ocr_trabajos set lease_hasta = now() - interval '1 second' where nombre_original like 'c1-%';
  insert into public.ocr_trabajos (id, creado_por, num_paginas, origen, nombre_original, estado)
  select gen_random_uuid(), v_user, 1, 'imagen', 'c2-lee-' || g || '.jpg', 'pagina1' from generate_series(1, 6) g;
  insert into public.ocr_trabajo_paginas (trabajo_id, numero, pieza, pagina_doc, storage_path, mime, bytes, estado, lease_hasta)
  select id, 1, 'pagina', 1, 'pendientes/x/c2/01.jpg', 'image/jpeg', 1000, 'procesando', now() + interval '2 minutes'
    from public.ocr_trabajos where nombre_original like 'c2-lee-%';
  insert into public.ocr_trabajos (id, creado_por, num_paginas, origen, nombre_original)
  values (gen_random_uuid(), v_user, 1, 'imagen', 'c2-nueva.jpg') returning id into v_tc;
  insert into public.ocr_trabajo_paginas (trabajo_id, numero, pieza, pagina_doc, storage_path, mime, bytes)
  values (v_tc, 1, 'pagina', 1, 'pendientes/x/c2/01.jpg', 'image/jpeg', 1000);
  n := public.ocr_despachar(v_tc);
  assert n = 0, format('C2a: con 6 piezas leyéndose no se despacha otra (%s)', n);
  assert (select estado from public.ocr_trabajos where id = v_tc) = 'pagina1', 'C2b: pasa a pagina1 y espera';
  -- Se libera una: quedan 5 → entra.
  update public.ocr_trabajo_paginas set lease_hasta = now() - interval '1 second'
   where trabajo_id = (select id from public.ocr_trabajos where nombre_original = 'c2-lee-1.jpg');
  n := public.ocr_despachar(v_tc);
  assert n = 1, format('C2c: con 5 leyéndose, se despacha (%s)', n);
end;
$$;

select 'ocr_cola_dos_guardados_test: OK' as resultado;
rollback;
