set client_encoding = 'UTF8';
-- ============================================================================
-- 20261212610000_ocr_cola_dos_guardados — la cola de facturas guarda de 2 en 2
-- (18/11/2026, decisión del dueño)
-- ----------------------------------------------------------------------------
-- QUÉ PASABA
--   El 18/11/2026 entre las 12:54 y las 13:01 (Madrid) se subieron 22 albaranes.
--   La cola ya existía (ocr_despachar): lee hasta 12 piezas a la vez en todo el
--   sistema y guarda («consolida») hasta 3 documentos a la vez. Con 3 guardados
--   a la vez la base de datos de producción (instancia pequeña) se saturó: cada
--   guardado tardó 14–80 s (debería ser 1–3 s), se cortaron por tiempo varias
--   escrituras (líneas de factura, alertas, vectores de nombres) y dos
--   documentos necesitaron un segundo intento.
--
-- QUÉ HACE (idempotente; solo la función, ni tablas ni datos)
--   ocr_despachar: igual que en 20261106200000 (= producción y demo, mismo
--   cuerpo), con los topes de todo el sistema más bajos:
--     · consolidaciones (guardar) a la vez: 3 → 2;
--     · piezas leyéndose a la vez:          12 → 6.
--   Lo que no cabe espera en la cola como hasta ahora: ocr_despachar_cola y el
--   cron reanudar-trabajos-ocr (cada minuto) le dan paso cuando hay hueco.
--   Un documento de varias páginas sigue leyendo como mucho 4 páginas a la vez.
--   Las causas de que guardar tarde tanto se tratan aparte (informe del 18/11).
--
-- APLICAR (una a una, nunca `db push`): demo primero (sfonaclosuafvlhutkon);
-- producción (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR de la release y
-- con el «sí» del dueño:
--   supabase db query --linked -f supabase/migrations/20261212610000_ocr_cola_dos_guardados.sql
-- Tiene que terminar en «ocr_cola_dos_guardados: aplicada».
-- No hay que desplegar ninguna función.
-- Pruebas (después de aplicarla; BEGIN … ROLLBACK, no deja nada):
--   supabase db query --linked -f supabase/tests/ocr_cola_dos_guardados_test.sql
-- Deshacer: supabase/rollbacks/20261212610000_ocr_cola_dos_guardados_ROLLBACK.sql
-- ============================================================================
set lock_timeout = '5s';

create or replace function public.ocr_despachar(p_trabajo_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $function$
-- 20261010150000_ocr_paginas_duplicados: topes de 3 consolidaciones y 12
-- piezas en todo el sistema. 20261106200000: la URL sale de Vault
-- («project_url»), ya no va fija la del proyecto viejo.
-- 20261212610000: topes de 2 consolidaciones (guardar) y 6 piezas (leer) a la
-- vez: con 3 guardados a la vez la base de producción se saturó (18/11/2026).
declare
  c_max_consolidaciones constant integer := 2;
  c_max_piezas          constant integer := 6;
  v_url     text;
  v_secreto text;
  t        public.ocr_trabajos%rowtype;
  p        public.ocr_trabajo_paginas%rowtype;
  v_vuelo  integer;
  v_hueco  integer;
  v_consol integer;
  n        integer := 0;
begin
  v_url := public.url_funcion_edge('ocr-trabajo');
  select s.decrypted_secret into v_secreto
    from vault.decrypted_secrets s where s.name = 'ocr_trabajos_secret' limit 1;
  if v_url is null or v_secreto is null or v_secreto = '' then
    return 0;
  end if;

  select * into t from public.ocr_trabajos where id = p_trabajo_id for update;
  if not found or t.estado not in ('pendiente', 'pagina1', 'paginas') then
    return 0;
  end if;

  if t.estado = 'pendiente' then
    update public.ocr_trabajos set estado = 'pagina1' where id = t.id;
    t.estado := 'pagina1';
  end if;

  -- Piezas que aún caben en todo el sistema (leyéndose o recién despachadas).
  select count(*) into v_hueco
    from public.ocr_trabajo_paginas
   where (estado = 'procesando' and lease_hasta > now())
      or (estado = 'pendiente' and despachada_at > now() - interval '30 seconds');
  v_hueco := greatest(0, c_max_piezas - v_hueco);

  if t.estado = 'pagina1' then
    select * into p from public.ocr_trabajo_paginas where trabajo_id = t.id and numero = 1;
    if not found or p.estado in ('completada', 'fallida') then
      update public.ocr_trabajos set estado = 'paginas' where id = t.id;
      t.estado := 'paginas';
    elsif p.estado = 'pendiente' and p.no_antes_de <= now() and v_hueco > 0
          and (p.despachada_at is null or p.despachada_at < now() - interval '30 seconds') then
      perform net.http_post(
        url := v_url,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-ocr-secret', v_secreto),
        body := jsonb_build_object('modo', 'pagina', 'pagina_id', p.id),
        timeout_milliseconds := 10000);
      update public.ocr_trabajo_paginas set despachada_at = now() where id = p.id;
      v_hueco := v_hueco - 1;
      n := n + 1;
    end if;
  end if;

  if t.estado = 'paginas' then
    select count(*) into v_vuelo from public.ocr_trabajo_paginas
     where trabajo_id = t.id and estado = 'procesando';
    for p in
      select * from public.ocr_trabajo_paginas
       where trabajo_id = t.id and estado = 'pendiente' and no_antes_de <= now()
         and (despachada_at is null or despachada_at < now() - interval '30 seconds')
       order by numero
       limit least(greatest(0, 4 - v_vuelo), v_hueco)
    loop
      perform net.http_post(
        url := v_url,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-ocr-secret', v_secreto),
        body := jsonb_build_object('modo', 'pagina', 'pagina_id', p.id),
        timeout_milliseconds := 10000);
      update public.ocr_trabajo_paginas set despachada_at = now() where id = p.id;
      n := n + 1;
    end loop;

    if not exists (select 1 from public.ocr_trabajo_paginas
                    where trabajo_id = t.id and estado in ('pendiente', 'procesando'))
       and (t.consolidar_despachado_at is null or t.consolidar_despachado_at < now() - interval '30 seconds') then
      select count(*) into v_consol
        from public.ocr_trabajos
       where id <> t.id
         and ((estado = 'consolidando' and lease_hasta > now())
              or (estado = 'paginas' and consolidar_despachado_at > now() - interval '30 seconds'));
      if v_consol < c_max_consolidaciones then
        perform net.http_post(
          url := v_url,
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-ocr-secret', v_secreto),
          body := jsonb_build_object('modo', 'consolidar', 'trabajo_id', t.id),
          timeout_milliseconds := 10000);
        update public.ocr_trabajos set consolidar_despachado_at = now() where id = t.id;
        n := n + 1;
      end if;
    end if;
  end if;
  return n;
end;
$function$;

select 'ocr_cola_dos_guardados: aplicada' as resultado;
