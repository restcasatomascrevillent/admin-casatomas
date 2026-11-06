set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261106200000_facturas_cargar_qa — Arreglos de la QA de «Cargar» y del
-- guardado de originales en Google Drive (05/11/2026)
-- ===========================================================================
-- PRIORIDAD DEL DUEÑO: que NUNCA se pierda un original y que NADA quede para
-- siempre en Supabase Storage.
--
-- QUÉ HACE (idempotente)
--   S-3  pg_cron «reanudar-trabajos-ocr» cada minuto (en la demo no existía:
--        los trabajos colgados no se reanudaban ni caducaban nunca).
--   S-4  url_funcion_edge(nombre): la URL de una Edge Function a partir del
--        secreto de Vault «project_url». ocr_despachar,
--        productos_despachar_clasificacion y
--        openai_despachar_sincronizacion_costes dejan de llevar fija la URL
--        del proyecto VIEJO (jeamoczmbfsnwkfjxcyo); sin «project_url» quedan
--        mudas (devuelven 0). Cualquier pg_cron con una URL fija
--        «https://<ref>.supabase.co/functions/v1/…» (los de emails-reserva)
--        pasa a leerla de Vault; si no existe ninguno, no se crea nada.
--   S-5  ocr_descartar_trabajo(trabajo) para el panel («Dejar la que hay»,
--        cancelar): el trabajo pasa a «cancelado» y el cron borra después sus
--        ficheros temporales. Los duplicados sin decidir CADUCAN a los 7
--        días: su original va a Drive como «anterior-…» (o, si la factura
--        existente no tiene original, se le pone como el suyo) y el trabajo
--        pasa a «cancelado».
--   S-1  facturas_originales_por_pasar rescata el original de pendientes/ de
--        una factura que se quedó sin ninguno (ni drive_url ni archivo_path)
--        en vez de borrarlo. Los «fallido» guardan sus ficheros 24 h.
--   UI-1 ocr_reintentar_trabajo(trabajo): reanuda el MISMO trabajo fallido
--        (sin volver a leer las piezas ya leídas) si sus ficheros siguen.
--   S-12 Aviso «original sin Drive»: uno por hora (se agrupa), no uno por
--        factura.
--   S-13 Storage: fuera las políticas facturas_originales_insert/_update (el
--        panel solo escribe en pendientes/{su uid}/, que ya tiene la suya).
--   S-6  Bucket facturas-originales a 20 MB (la importación histórica admite
--        PDF de hasta 20 MB y, con Drive caído, su copia temporal no cabía).
--
-- APLICAR (una a una, nunca `db push`): demo primero (sfonaclosuafvlhutkon);
-- producción (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR y con el «sí»
-- del dueño, DESPUÉS de desplegar procesar-factura, ocr-trabajo,
-- importar-factura-historica y facturas-originales-drive:
--   supabase db query --linked -f supabase/migrations/20261106200000_facturas_cargar_qa.sql
-- Tiene que terminar en «facturas_cargar_qa: aplicada | …».
-- Deshacer: supabase/rollbacks/20261106200000_facturas_cargar_qa_ROLLBACK.sql
-- Pruebas: supabase db query --linked -f supabase/tests/facturas_cargar_qa_test.sql
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- ─── 0. Comprobaciones previas (no cambian nada) ────────────────────────────
do $$
declare
  v_faltan text[] := '{}';
begin
  if to_regclass('public.ocr_trabajos') is null then v_faltan := v_faltan || 'public.ocr_trabajos'::text; end if;
  if to_regclass('public.ocr_trabajo_paginas') is null then v_faltan := v_faltan || 'public.ocr_trabajo_paginas'::text; end if;
  if to_regprocedure('public.reanudar_trabajos_ocr()') is null then v_faltan := v_faltan || 'reanudar_trabajos_ocr()'::text; end if;
  if to_regprocedure('public.facturas_originales_por_pasar(integer)') is null then
    v_faltan := v_faltan || 'facturas_originales_por_pasar (migración 20261105193000)'::text;
  end if;
  if to_regprocedure('public.can_write_section(text)') is null then v_faltan := v_faltan || 'can_write_section(text)'::text; end if;
  if to_regclass('cron.job') is null then v_faltan := v_faltan || 'pg_cron'::text; end if;
  if to_regclass('vault.decrypted_secrets') is null then v_faltan := v_faltan || 'Vault'::text; end if;
  if cardinality(v_faltan) > 0 then
    raise exception 'MIGRACIÓN ABORTADA: falta %', array_to_string(v_faltan, ', ');
  end if;
end;
$$;

-- ─── 1. S-4: URL de las Edge Functions desde Vault ─────────────────────────
create or replace function public.url_funcion_edge(p_funcion text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
           when coalesce(s.decrypted_secret, '') = '' or coalesce(p_funcion, '') = '' then null
           else rtrim(s.decrypted_secret, '/') || '/functions/v1/' || p_funcion
         end
    from (select (select decrypted_secret from vault.decrypted_secrets where name = 'project_url' limit 1) as decrypted_secret) s;
$$;
comment on function public.url_funcion_edge(text) is
  'URL de una Edge Function del proyecto (secreto de Vault «project_url»). Null sin el secreto. 20261106200000.';

create or replace function public.ocr_despachar(p_trabajo_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $function$
-- 20261010150000_ocr_paginas_duplicados: topes de 3 consolidaciones y 12
-- piezas en todo el sistema. 20261106200000: la URL sale de Vault
-- («project_url»), ya no va fija la del proyecto viejo.
declare
  c_max_consolidaciones constant integer := 3;
  c_max_piezas          constant integer := 12;
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

create or replace function public.productos_despachar_clasificacion()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $function$
-- 20261106200000: la URL sale de Vault («project_url»).
declare
  v_url     text;
  v_secreto text;
begin
  if not exists (select 1 from public.productos_factura
                  where producto_id is null
                    and created_at > now() - interval '7 days'
                    and created_at < now() - interval '1 minute') then
    return 0;
  end if;
  v_url := public.url_funcion_edge('clasificar-productos');
  select s.decrypted_secret into v_secreto
    from vault.decrypted_secrets s where s.name = 'ocr_trabajos_secret' limit 1;
  if v_url is null or v_secreto is null or v_secreto = '' then
    return 0;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-ocr-secret', v_secreto),
    body := jsonb_build_object('modo', 'cron'),
    timeout_milliseconds := 10000);
  return 1;
end;
$function$;

create or replace function public.openai_despachar_sincronizacion_costes()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $function$
-- 20261106200000: la URL sale de Vault («project_url»).
declare
  v_url     text;
  v_secreto text;
begin
  v_url := public.url_funcion_edge('sincronizar-costes-openai');
  select s.decrypted_secret into v_secreto
    from vault.decrypted_secrets s where s.name = 'ocr_trabajos_secret' limit 1;
  if v_url is null or v_secreto is null or v_secreto = '' then
    return 0;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-ocr-secret', v_secreto),
    body := jsonb_build_object('modo', 'cron'),
    timeout_milliseconds := 10000);
  return 1;
end;
$function$;

-- Crons con una URL fija de proyecto (emails-reserva de 20260920010000 y
-- 20260922160000): la URL pasa a leerse de Vault. Solo se tocan los que
-- existen; si no hay ninguno, no se crea nada.
do $$
declare
  r record;
  v_nuevo text;
begin
  for r in select jobid, jobname, command from cron.job
            where command ~ '''https://[a-z0-9]{20}\.supabase\.co/functions/v1/[^'']*''' loop
    v_nuevo := regexp_replace(
      r.command,
      '''https://[a-z0-9]{20}\.supabase\.co(/functions/v1/[^'']*)''',
      '(select rtrim(s.decrypted_secret, ''/'') from vault.decrypted_secrets s where s.name = ''project_url'') || ''\1''',
      'g');
    perform cron.alter_job(r.jobid, command := v_nuevo);
    raise notice 'cron % ahora lee la URL de Vault', r.jobname;
  end loop;
end;
$$;

-- ─── 2. S-5 / UI-4 / UI-11: descartar un trabajo desde el panel ─────────────
create or replace function public.ocr_descartar_trabajo(p_trabajo_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  t public.ocr_trabajos%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'motivo', 'Tu sesión ha caducado: vuelve a entrar en el panel.');
  end if;
  select * into t from public.ocr_trabajos where id = p_trabajo_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'Ese documento ya no está en el servidor.');
  end if;
  if t.creado_por is distinct from v_uid and not public.can_write_section('facturas') then
    return jsonb_build_object('ok', false, 'motivo', 'No tienes permiso para descartar documentos de otra persona.');
  end if;
  if t.estado = 'cancelado' then
    return jsonb_build_object('ok', true, 'estado', 'cancelado');
  end if;
  if t.estado = 'consolidando' then
    return jsonb_build_object('ok', false, 'estado', t.estado,
      'motivo', 'Se está guardando ahora mismo: espera unos segundos y mira si ha quedado guardado.');
  end if;
  if t.estado = 'completado' then
    return jsonb_build_object('ok', false, 'estado', t.estado, 'factura_id', t.factura_id,
      'motivo', 'Ese documento ya está guardado: si sobra, bórralo desde la lista de documentos.');
  end if;
  -- duplicado, pendiente, pagina1, paginas, fallido → cancelado. Los workers
  -- no tocan un trabajo cancelado (ocr_despachar y ocr_terminar_trabajo lo
  -- excluyen) y el cron facturas-originales-drive borra sus ficheros de
  -- pendientes/ (salvo que sean el único original de una factura).
  update public.ocr_trabajos
     set estado = 'cancelado',
         error = coalesce(nullif(error, ''), case when t.estado = 'duplicado'
                                                  then 'Descartado: se deja la factura que ya había'
                                                  else 'Cancelado desde el panel' end),
         terminado_at = coalesce(terminado_at, now()),
         lease_hasta = null
   where id = t.id;
  return jsonb_build_object('ok', true, 'estado', 'cancelado', 'antes', t.estado);
end;
$$;
comment on function public.ocr_descartar_trabajo(uuid) is
  'Panel: descarta un documento pendiente de decidir (duplicado) o cancela uno en cola/leyéndose. 20261106200000.';

-- ─── 3. UI-1: reanudar el MISMO trabajo ─────────────────────────────────────
create or replace function public.ocr_reintentar_trabajo(p_trabajo_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  t public.ocr_trabajos%rowtype;
  v_faltan integer;
  v_p1 text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'motivo', 'Tu sesión ha caducado: vuelve a entrar en el panel.');
  end if;
  select * into t from public.ocr_trabajos where id = p_trabajo_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'estado', null,
      'motivo', 'Ese documento ya no está en el servidor: vuelve a subirlo.');
  end if;
  if t.creado_por is distinct from v_uid and not public.can_write_section('facturas') then
    return jsonb_build_object('ok', false, 'estado', t.estado, 'motivo', 'No tienes permiso para reintentar documentos de otra persona.');
  end if;
  if t.estado in ('pendiente', 'pagina1', 'paginas', 'consolidando') then
    -- Sigue en marcha: nada que reintentar (y nada que volver a pagar).
    return jsonb_build_object('ok', true, 'estado', t.estado);
  end if;
  if t.estado in ('completado', 'duplicado') then
    return jsonb_build_object('ok', true, 'estado', t.estado, 'factura_id', t.factura_id);
  end if;
  if t.estado = 'cancelado' then
    return jsonb_build_object('ok', false, 'estado', t.estado, 'motivo', 'Ese documento se descartó: vuelve a subirlo.');
  end if;

  -- fallido: ¿siguen sus ficheros en Storage?
  select count(*) into v_faltan
    from (select t.original_path as ruta where t.original_path is not null
          union all
          select storage_path from public.ocr_trabajo_paginas where trabajo_id = t.id) r
   where not exists (select 1 from storage.objects o where o.bucket_id = 'facturas-originales' and o.name = r.ruta);
  if v_faltan > 0 or not exists (select 1 from public.ocr_trabajo_paginas where trabajo_id = t.id) then
    return jsonb_build_object('ok', false, 'estado', t.estado,
      'motivo', 'Los ficheros de este documento ya no están en el servidor: vuelve a subirlo.');
  end if;

  -- Las piezas ya leídas se conservan (no se vuelven a pagar); las demás, a la cola.
  update public.ocr_trabajo_paginas
     set estado = 'pendiente', intentos = 0, error = null, lease_hasta = null,
         despachada_at = null, no_antes_de = now()
   where trabajo_id = t.id and estado <> 'completada';
  select estado into v_p1 from public.ocr_trabajo_paginas where trabajo_id = t.id and numero = 1;
  update public.ocr_trabajos
     set estado = case when v_p1 = 'completada' then 'paginas' else 'pagina1' end,
         error = null, resultado = null, terminado_at = null, lease_hasta = null,
         consolidar_despachado_at = null, intentos_consolidacion = 0,
         limite_at = now() + interval '15 minutes'
   where id = t.id;
  perform public.ocr_despachar(t.id);
  return jsonb_build_object('ok', true, 'estado', 'reanudado');
end;
$$;
comment on function public.ocr_reintentar_trabajo(uuid) is
  'Panel: reanuda un trabajo de OCR fallido (el mismo, sin releer las piezas ya leídas) si sus ficheros siguen en Storage. 20261106200000.';

-- ─── 4. S-1 / S-5: qué hay que pasar a Drive o borrar ──────────────────────
-- de_trabajos: ficheros de pendientes/ que NO se pueden borrar sin más:
--   · el original de una factura que se quedó sin ninguno (rescate, S-1);
--   · el original de un duplicado sin decidir de más de 7 días (S-5): va a
--     Drive como «anterior-…» (o como el original de la existente, si esta no
--     tiene) y el trabajo pasa a «cancelado».
create or replace function public.facturas_originales_por_pasar(p_limite integer default 20)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with lim as (select greatest(1, least(coalesce(p_limite, 20), 500)) as n),
  facturas_p as (
    select f.id, f.archivo_path, f.drive_url, f.fecha, coalesce(p.nombre, f.proveedor) as proveedor,
           f.drive_intentos,
           exists (select 1 from storage.objects o
                    where o.bucket_id = 'facturas-originales' and o.name = f.archivo_path) as existe
      from public.facturas f
      left join public.proveedores p on p.id = f.proveedor_id
     where f.archivo_path is not null
       and (f.drive_url is not null or f.drive_intentos < 5 or f.drive_intento_at is null
            or f.drive_intento_at < now() - interval '6 hours')
     order by (f.drive_url is null), f.id
     limit (select n from lim)
  ),
  candidatos as (
    select t.id as trabajo_id, t.estado, t.nombre_original, t.terminado_at, t.updated_at,
           coalesce(t.original_path,
                    (select tp.storage_path from public.ocr_trabajo_paginas tp
                      where tp.trabajo_id = t.id order by tp.numero limit 1)) as ruta,
           coalesce(t.factura_id,
                    (select x.id from public.facturas x where x.ocr_trabajo_id = t.id order by x.id limit 1),
                    case when (t.documento_pendiente->'existente'->>'id') ~ '^\d{1,18}$'
                         then (t.documento_pendiente->'existente'->>'id')::bigint end) as factura_id
      from public.ocr_trabajos t
     where t.estado in ('completado', 'fallido', 'cancelado', 'duplicado')
  ),
  protegidos as (
    select o.name, (o.metadata->>'size')::bigint as bytes, f.id as factura_id, f.fecha,
           coalesce(p.nombre, f.proveedor) as proveedor,
           (f.drive_url is null and f.archivo_path is null) as es_su_original,
           case when c.estado = 'duplicado' then c.trabajo_id end as trabajo_id,
           c.nombre_original as nombre
      from candidatos c
      join storage.objects o on o.bucket_id = 'facturas-originales' and o.name = c.ruta
      join public.facturas f on f.id = c.factura_id
      left join public.proveedores p on p.id = f.proveedor_id
     where o.name like 'pendientes/%'
       and o.created_at < now() - interval '1 hour'
       and not exists (select 1 from public.facturas x where x.archivo_path = o.name)
       and ((c.estado = 'duplicado' and coalesce(c.terminado_at, c.updated_at) < now() - interval '7 days')
            or (c.estado <> 'duplicado' and f.drive_url is null and f.archivo_path is null))
  ),
  huerfanos as (
    (select o.name, (o.metadata->>'size')::bigint as bytes, f.id as factura_id, f.fecha,
            coalesce(p.nombre, f.proveedor) as proveedor,
            -- La factura se quedó sin original (ni Drive ni Storage) y el fichero
            -- es suyo (no «sust-»/«pagN-»): se le devuelve como drive_url.
            (f.id is not null and f.drive_url is null and f.archivo_path is null
             and regexp_replace(o.name, '^.*/', '') !~ '^\d+-(sust-|pag\d+-)') as es_su_original,
            null::uuid as trabajo_id, null::text as nombre
       from storage.objects o
       left join public.facturas f
         on f.id = nullif(substring(regexp_replace(o.name, '^.*/', '') from '^(\d{1,18})-'), '')::bigint
       left join public.proveedores p on p.id = f.proveedor_id
      where o.bucket_id = 'facturas-originales'
        and o.name not like 'pendientes/%'
        and o.created_at < now() - interval '1 hour'
        and not exists (select 1 from public.facturas x where x.archivo_path = o.name)
        and not exists (select 1 from public.ocr_trabajos t where t.original_path = o.name)
      order by o.name
      limit (select n from lim))
    union all
    (select * from protegidos order by name limit (select n from lim))
  ),
  pendientes as (
    select o.name
      from storage.objects o
      left join public.ocr_trabajos t on t.id::text = split_part(o.name, '/', 3)
     where o.bucket_id = 'facturas-originales'
       and o.name like 'pendientes/%'
       and o.created_at < now() - interval '1 hour'
       and (t.id is null
            or t.estado in ('completado', 'cancelado')
            -- 24 h para «Reintentar» (ocr_reintentar_trabajo) sin volver a subir nada.
            or (t.estado = 'fallido' and coalesce(t.terminado_at, t.updated_at) < now() - interval '24 hours'))
       and not exists (select 1 from public.facturas x where x.archivo_path = o.name)
       and not exists (select 1 from protegidos pr where pr.name = o.name)
       -- Un duplicado caducado se borra cuando ya está cancelado (su original, a salvo).
     order by o.name
     limit (select n * 10 from lim)
  )
  select jsonb_build_object(
    'facturas', coalesce((select jsonb_agg(to_jsonb(x)) from facturas_p x), '[]'::jsonb),
    'huerfanos', coalesce((select jsonb_agg(to_jsonb(x)) from huerfanos x), '[]'::jsonb),
    'pendientes', coalesce((select jsonb_agg(x.name) from pendientes x), '[]'::jsonb)
  );
$$;

-- Duplicados de más de 7 días cuyo fichero ya no está (nada que salvar): cancelados.
create or replace function public.ocr_caducar_duplicados()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.ocr_trabajos t
     set estado = 'cancelado', error = coalesce(nullif(t.error, ''), 'Caducado sin decidir (7 días)')
   where t.estado = 'duplicado'
     and coalesce(t.terminado_at, t.updated_at) < now() - interval '7 days'
     and not exists (
       select 1 from storage.objects o
        where o.bucket_id = 'facturas-originales'
          and o.name = coalesce(t.original_path,
                                (select tp.storage_path from public.ocr_trabajo_paginas tp
                                  where tp.trabajo_id = t.id order by tp.numero limit 1)));
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.facturas_originales_hay_trabajo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_array_length(j->'facturas') + jsonb_array_length(j->'huerfanos') + jsonb_array_length(j->'pendientes') > 0
    from (select public.facturas_originales_por_pasar(1) as j) x;
$$;

create or replace function public.facturas_originales_drive_disparar()
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url text;
  v_secreto text;
begin
  -- Lo que no tiene nada que salvar se cancela aquí mismo (sin Edge Function).
  perform public.ocr_caducar_duplicados();
  v_url := public.url_funcion_edge('facturas-originales-drive');
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'ocr_trabajos_secret' limit 1;
  if v_url is null or coalesce(v_secreto, '') = '' then
    return false;
  end if;
  if not public.facturas_originales_hay_trabajo() then
    return false;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-ocr-secret', v_secreto),
    body := '{"accion":"pasar"}'::jsonb,
    timeout_milliseconds := 150000);
  return true;
end;
$$;

-- ─── 5. S-12: un aviso por incidente (agrupado por hora) ────────────────────
create or replace function public.facturas_original_drive_fallo(p_factura_id bigint, p_error text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
  v_num text;
  v_prov text;
  v_aviso uuid;
  v_atascadas integer;
  v_texto text;
begin
  update public.facturas
     set drive_intentos = least(coalesce(drive_intentos, 0) + 1, 32000),
         drive_error = left(coalesce(p_error, 'error desconocido'), 1000),
         drive_intento_at = now()
   where id = p_factura_id
  returning drive_intentos, numero_documento, proveedor into v_n, v_num, v_prov;
  if v_n is null then
    return null;
  end if;
  if v_n = 5 then
    select count(*) into v_atascadas
      from public.facturas
     where archivo_path is not null and drive_url is null and drive_intentos >= 5;
    v_texto := left(format(
      'El original de la factura %s (%s) no se ha podido subir a Drive tras %s intentos. '
        || 'Está guardado temporalmente y se seguirá reintentando. Último error: %s',
      coalesce(v_num, '#' || p_factura_id), coalesce(v_prov, 'sin proveedor'), v_n, coalesce(p_error, 'desconocido')), 900);
    -- Drive caído afecta a todas las subidas: un solo aviso por hora.
    select id into v_aviso
      from public.notificaciones_dashboard
     where tipo = 'original_sin_drive' and coalesce(leida, false) = false
       and created_at > now() - interval '1 hour'
     order by created_at desc
     limit 1;
    if v_aviso is not null then
      update public.notificaciones_dashboard
         set titulo = 'Originales sin subir a Google Drive',
             mensaje = left(format('%s facturas tienen el original sin subir a Drive (guardado temporalmente; se sigue reintentando). Última: %s',
                                   greatest(v_atascadas, 2), v_texto), 900)
       where id = v_aviso;
    else
      insert into public.notificaciones_dashboard (tipo, titulo, mensaje, referencia_tipo, prioridad)
      values ('original_sin_drive', 'Original sin subir a Google Drive', v_texto, 'facturas_original', 'alta');
    end if;
  end if;
  return v_n;
end;
$$;

-- ─── 6. Permisos ────────────────────────────────────────────────────────────
revoke all on function public.url_funcion_edge(text) from public, anon, authenticated;
revoke all on function public.ocr_despachar(uuid) from public, anon, authenticated;
revoke all on function public.productos_despachar_clasificacion() from public, anon, authenticated;
revoke all on function public.openai_despachar_sincronizacion_costes() from public, anon, authenticated;
revoke all on function public.ocr_descartar_trabajo(uuid) from public, anon;
revoke all on function public.ocr_reintentar_trabajo(uuid) from public, anon;
revoke all on function public.facturas_originales_por_pasar(integer) from public, anon, authenticated;
revoke all on function public.ocr_caducar_duplicados() from public, anon, authenticated;
revoke all on function public.facturas_originales_hay_trabajo() from public, anon, authenticated;
revoke all on function public.facturas_originales_drive_disparar() from public, anon, authenticated;
revoke all on function public.facturas_original_drive_fallo(bigint, text) from public, anon, authenticated;
grant execute on function public.url_funcion_edge(text) to service_role;
grant execute on function public.ocr_despachar(uuid) to service_role;
grant execute on function public.productos_despachar_clasificacion() to service_role;
grant execute on function public.openai_despachar_sincronizacion_costes() to service_role;
grant execute on function public.ocr_descartar_trabajo(uuid) to authenticated, service_role;
grant execute on function public.ocr_reintentar_trabajo(uuid) to authenticated, service_role;
grant execute on function public.facturas_originales_por_pasar(integer) to service_role;
grant execute on function public.ocr_caducar_duplicados() to service_role;
grant execute on function public.facturas_originales_hay_trabajo() to service_role;
grant execute on function public.facturas_originales_drive_disparar() to service_role;
grant execute on function public.facturas_original_drive_fallo(bigint, text) to service_role;

-- ─── 7. S-3: cron reanudar-trabajos-ocr cada minuto ────────────────────────
select cron.unschedule('reanudar-trabajos-ocr')
 where exists (select 1 from cron.job where jobname = 'reanudar-trabajos-ocr');
select cron.schedule('reanudar-trabajos-ocr', '* * * * *', $cron$ select public.reanudar_trabajos_ocr(); $cron$);

-- ─── 8. S-13 / S-6: Storage ─────────────────────────────────────────────────
-- El panel solo sube a pendientes/{su uid}/… (facturas_originales_pendientes_insert)
-- y nunca sobrescribe; todo lo demás lo escribe el servidor (service_role).
drop policy if exists facturas_originales_insert on storage.objects;
drop policy if exists facturas_originales_update on storage.objects;
update storage.buckets set file_size_limit = 20971520
 where id = 'facturas-originales' and coalesce(file_size_limit, 0) < 20971520;

-- ─── 9. Comprobación final ──────────────────────────────────────────────────
do $$
declare
  v_malos text[] := '{}';
begin
  if (select count(*) from cron.job where jobname = 'reanudar-trabajos-ocr' and active) <> 1 then
    v_malos := v_malos || 'el cron reanudar-trabajos-ocr no quedó activo una vez'::text;
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.prosrc ~ 'https://[a-z0-9]{20}\.supabase\.co/functions') then
    v_malos := v_malos || 'queda alguna función con la URL de un proyecto fija'::text;
  end if;
  if exists (select 1 from cron.job where command ~ '''https://[a-z0-9]{20}\.supabase\.co/functions') then
    v_malos := v_malos || 'queda algún cron con la URL de un proyecto fija'::text;
  end if;
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
              and policyname in ('facturas_originales_insert', 'facturas_originales_update')) then
    v_malos := v_malos || 'siguen las políticas de escritura fuera de pendientes/'::text;
  end if;
  if has_function_privilege('anon', 'public.ocr_descartar_trabajo(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.url_funcion_edge(text)', 'execute')
     or has_function_privilege('authenticated', 'public.ocr_despachar(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.ocr_reintentar_trabajo(uuid)', 'execute') then
    v_malos := v_malos || 'permisos de las RPC mal puestos'::text;
  end if;
  if cardinality(v_malos) > 0 then
    raise exception 'facturas_cargar_qa: comprobación final fallida (%). No se ha aplicado nada.', array_to_string(v_malos, '; ');
  end if;
end;
$$;

commit;

-- Verificación (solo lectura).
select 'facturas_cargar_qa: aplicada' as resultado,
       (select active from cron.job where jobname = 'reanudar-trabajos-ocr') as cron_reanudar_activo,
       public.url_funcion_edge('ocr-trabajo') is not null as url_desde_vault,
       (select file_size_limit from storage.buckets where id = 'facturas-originales') as limite_bucket,
       (select count(*) from public.ocr_trabajos where estado = 'duplicado') as duplicados_sin_decidir;
