-- ===========================================================================
--  Guardado de facturas más rápido y sin atascos (20/11/2026)
--
--  Medición: facturas-conocimiento/guardado-facturas-medicion-2026-11-20.md
--  (los disparadores suman ~0,75 s por factura de 25 líneas con la base
--  tranquila: no es ahí donde se pierde el tiempo; lo que falla es la espera
--  por contención y que un fallo por tiempo no se reintente solo).
--
--  1. Trabajos de OCR que fallan por un corte de tiempo de la base («statement
--     timeout», «lock timeout»): el 19/11 dos documentos fallaron tres veces
--     en 6 minutos (la base estuvo parada) y esperaron 31 minutos a que alguien
--     pulsara «Reintentar». Ahora reanudar_trabajos_ocr (cron de cada minuto)
--     los reintenta SOLO, hasta 2 veces, a partir de los 3 minutos de fallar y
--     solo si todas sus páginas ya se leyeron (reintentar no cuesta OpenAI).
--     Además sale al instante si no hay nada en marcha ni nada que reintentar.
--
--  2. pg_cron: hasta 11 jobs arrancaban en el mismo segundo (:00, :15, :30, :45)
--     y el 15/11 y el 18/11 la base dejó de aceptarlos a todos («job startup
--     timeout»). Se escalonan los de cada 5, 10 y 15 minutos. Solo cambia el
--     MINUTO de arranque (misma frecuencia, mismo comando).
--
--  3. Revisión independiente (20/11/2026), tres arreglos:
--     a. facturas_insertar_lineas: las líneas se insertan en UNA transacción con
--        un bloqueo por factura y solo si la factura no tiene ninguna. Dos
--        procesos sobre el mismo trabajo ya no pueden duplicar importes.
--     b. Al completarse un trabajo cuyo ticket «Lectura fallida» sigue abierto
--        (se reanudó solo, o con «Reintentar»), el ticket pasa a «hecha».
--     c. reanudar_trabajos_ocr ya no elige candidatos sin ficheros (ocupaban un
--        hueco del limit 3 cada minuto durante 3 h).
--
--  Sin begin/commit propios. Reaplicable. Deshacer:
--  supabase/rollbacks/20261213010000_guardado_facturas_rapido_ROLLBACK.sql
-- ===========================================================================

-- 1. Reintento automático de los trabajos fallidos por tiempo ---------------
alter table public.ocr_trabajos add column if not exists reintentos_auto smallint not null default 0;
comment on column public.ocr_trabajos.reintentos_auto is
  'Veces que reanudar_trabajos_ocr lo reanudó solo tras fallar por un corte de tiempo de la base (máx. 2).';

-- ¿Tiene el trabajo páginas y están TODOS sus ficheros en Storage? (lo exige reintentar)
create or replace function public.ocr_trabajo_ficheros_presentes(p_trabajo_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (select 1 from public.ocr_trabajo_paginas where trabajo_id = p_trabajo_id)
     and not exists (
       select 1
         from (select t.original_path as ruta from public.ocr_trabajos t where t.id = p_trabajo_id and t.original_path is not null
               union all
               select storage_path from public.ocr_trabajo_paginas where trabajo_id = p_trabajo_id) r
        where not exists (select 1 from storage.objects o where o.bucket_id = 'facturas-originales' and o.name = r.ruta));
$function$;

revoke all on function public.ocr_trabajo_ficheros_presentes(uuid) from public, anon, authenticated;

-- Lo mismo que la parte «fallido» de ocr_reintentar_trabajo, sin sesión de usuario.
create or replace function public.ocr_reanudar_fallido_interno(p_trabajo_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  t public.ocr_trabajos%rowtype;
  v_p1 text;
begin
  select * into t from public.ocr_trabajos where id = p_trabajo_id for update skip locked;
  if not found or t.estado <> 'fallido' then
    return false;
  end if;
  if not public.ocr_trabajo_ficheros_presentes(t.id) then
    return false;
  end if;
  update public.ocr_trabajo_paginas
     set estado = 'pendiente', intentos = 0, error = null, lease_hasta = null,
         despachada_at = null, no_antes_de = now()
   where trabajo_id = t.id and estado <> 'completada';
  select estado into v_p1 from public.ocr_trabajo_paginas where trabajo_id = t.id and numero = 1;
  update public.ocr_trabajos
     set estado = case when v_p1 = 'completada' then 'paginas' else 'pagina1' end,
         error = null, resultado = null, terminado_at = null, lease_hasta = null,
         consolidar_despachado_at = null, intentos_consolidacion = 0,
         reintentos_auto = reintentos_auto + 1,
         limite_at = now() + interval '15 minutes'
   where id = t.id;
  perform public.ocr_despachar(t.id);
  return true;
end;
$function$;

revoke all on function public.ocr_reanudar_fallido_interno(uuid) from public, anon, authenticated;

-- Fallidos por corte de tiempo de la base con TODAS las páginas leídas (solo falló el guardado).
create or replace function public.ocr_reanudar_fallidos_transitorios()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  n integer := 0;
begin
  for r in
    select t.id
      from public.ocr_trabajos t
     where t.estado = 'fallido'
       and t.reintentos_auto < 2
       and t.terminado_at between now() - interval '3 hours' and now() - interval '3 minutes'
       and t.error ~* '(statement timeout|lock timeout|canceling statement|deadlock detected|could not obtain lock)'
       and not exists (select 1 from public.ocr_trabajo_paginas p where p.trabajo_id = t.id and p.estado <> 'completada')
       -- Sin ficheros (borrados) no se puede reanudar: fuera de la selección, para que no ocupe
       -- un hueco del limit 3 cada minuto durante 3 h.
       and public.ocr_trabajo_ficheros_presentes(t.id)
     order by t.terminado_at
     limit 3
  loop
    if public.ocr_reanudar_fallido_interno(r.id) then
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$function$;

revoke all on function public.ocr_reanudar_fallidos_transitorios() from public, anon, authenticated;

-- reanudar_trabajos_ocr: pasos 1-4 idénticos a antes, pero solo si hay algo en
-- marcha; el paso 5 (nuevo) reintenta los fallidos por tiempo.
create or replace function public.reanudar_trabajos_ocr()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  n integer := 0;
begin
  if exists (select 1 from public.ocr_trabajos where estado in ('pendiente', 'pagina1', 'paginas', 'consolidando'))
     or exists (select 1 from public.ocr_trabajo_paginas where estado = 'procesando') then
    -- 1. Piezas con el lease caducado (el worker murió): fallo técnico → reintento.
    for r in select id from public.ocr_trabajo_paginas where estado = 'procesando' and lease_hasta < now() loop
      perform public.ocr_fallo_pagina(r.id, 'lease caducado (el worker no cerró la pieza)');
      n := n + 1;
    end loop;

    -- 2. Trabajos que pasan del límite → fallido.
    update public.ocr_trabajos
       set estado = 'fallido', error = coalesce(error, 'tiempo agotado (15 min) sin terminar'),
           terminado_at = now(), lease_hasta = null
     where estado in ('pendiente', 'pagina1', 'paginas', 'consolidando') and limite_at < now();

    -- 3. Consolidación con el lease caducado: reintento (máx. 3) o fallido.
    update public.ocr_trabajos
       set estado = 'fallido', error = coalesce(error, 'la consolidación falló 3 veces'),
           terminado_at = now(), lease_hasta = null
     where estado = 'consolidando' and lease_hasta < now() and intentos_consolidacion >= 3;
    update public.ocr_trabajos
       set estado = 'paginas', lease_hasta = null, consolidar_despachado_at = null
     where estado = 'consolidando' and lease_hasta < now() and intentos_consolidacion < 3;

    -- 4. Trabajos activos sin movimiento en 60 s → volver a despachar.
    for r in select id from public.ocr_trabajos
              where estado in ('pendiente', 'pagina1', 'paginas') and updated_at < now() - interval '60 seconds' loop
      n := n + public.ocr_despachar(r.id);
    end loop;
  end if;

  -- 5. Fallidos por un corte de tiempo de la base, con todas las páginas leídas: se reanudan solos.
  if exists (select 1 from public.ocr_trabajos
              where estado = 'fallido' and reintentos_auto < 2 and terminado_at > now() - interval '3 hours') then
    n := n + public.ocr_reanudar_fallidos_transitorios();
  end if;
  return n;
end;
$function$;

-- 3a. Líneas de factura idempotentes y con exclusión por factura -------------
--     Una sola transacción: bloqueo (por factura) → ¿hay líneas? → insertar todas.
--     Devuelve las líneas insertadas (0 si ya había: otro proceso se adelantó).
--     lock_timeout 5 s: si otro proceso tarda en soltar el bloqueo, falla con 55P03,
--     que el guardado ya reintenta (no se espera sin fin). El statement_timeout de
--     PostgREST (8 s) lo fija el rol y no se toca; al cortar, Postgres lo deshace todo.
--     Las columnas se toman de las claves del JSON (como hace PostgREST), así una
--     columna que falte por migrar da el mismo error de siempre y el DEFAULT de las
--     columnas no enviadas se conserva.
create or replace function public.facturas_insertar_lineas(p_factura_id bigint, p_lineas jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public'
set lock_timeout to '5s'
as $function$
declare
  v_cols text;
  v_n integer;
begin
  if p_factura_id is null or p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    return 0;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('facturas_insertar_lineas:' || p_factura_id::text, 0));
  if exists (select 1 from public.productos_factura where factura_id = p_factura_id) then
    return 0;
  end if;
  select string_agg(quote_ident(k), ', ' order by k) into v_cols
    from (select distinct k
            from jsonb_array_elements(p_lineas) e, jsonb_object_keys(e) k
           where k not in ('id', 'factura_id')) claves;
  if v_cols is null then
    return 0;
  end if;
  execute format(
    'insert into public.productos_factura (factura_id, %1$s) select $1, %1$s from jsonb_populate_recordset(null::public.productos_factura, $2)',
    v_cols) using p_factura_id, p_lineas;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

revoke all on function public.facturas_insertar_lineas(bigint, jsonb) from public, anon, authenticated;
do $grant$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.facturas_insertar_lineas(bigint, jsonb) to service_role;
  end if;
end
$grant$;

-- 3b. El ticket «Lectura fallida» se cierra solo si el trabajo acaba bien -----
--     Solo el ticket de ESTE trabajo (clave_origen = 'ocr:<id>', origen 'ocr') y solo si
--     nadie lo ha tocado (nueva / en_analisis): uno aceptado o descartado se respeta.
create or replace function public.ocr_trabajos_cerrar_ticket_fallo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    if new.estado in ('completado', 'duplicado') and old.estado is distinct from new.estado then
      update public.peticiones p
         set estado = 'hecha',
             descripcion = left(p.descripcion, 3800) || E'\n\n'
               || case when new.estado = 'completado'
                    then 'Resuelto solo: se reintentó y se guardó la factura ' || coalesce(new.factura_id::text, '(sin número)') || '.'
                    else 'Resuelto solo: se reintentó y el documento ya existía' || coalesce(' (factura ' || new.factura_id::text || ')', '') || '.'
                  end
       where p.clave_origen = 'ocr:' || new.id
         and p.origen = 'ocr'
         and p.estado in ('nueva', 'en_analisis');
    end if;
  exception when others then
    raise warning 'ocr_trabajos_cerrar_ticket_fallo: no se pudo cerrar el ticket del trabajo %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public.ocr_trabajos_cerrar_ticket_fallo() from public, anon, authenticated;

drop trigger if exists trg_ocr_trabajos_cerrar_ticket_fallo on public.ocr_trabajos;
create trigger trg_ocr_trabajos_cerrar_ticket_fallo after update of estado on public.ocr_trabajos
  for each row execute function public.ocr_trabajos_cerrar_ticket_fallo();

-- 2. pg_cron: escalonar ------------------------------------------------------
--    Solo cambia el minuto de arranque. Si un job no existe (otro entorno), se salta.
do $cron$
declare
  r record;
begin
  if to_regclass('cron.job') is null then
    return;
  end if;
  for r in
    select * from (values
      ('avisos-telegram-fallos',        '0-59/5 * * * *'),
      ('avisos-telegram-pendientes',    '1-59/5 * * * *'),
      ('clasificar-productos',          '2-59/5 * * * *'),
      ('reservas-web-keep-warm',        '2-59/5 * * * *'),
      ('instagram-programador',         '3-59/5 * * * *'),
      ('procesar-logs-web',             '4-59/5 * * * *'),
      ('facturas-originales-drive',     '6,16,26,36,46,56 * * * *'),
      ('embeddings-nombres',            '9,19,29,39,49,59 * * * *'),
      ('emails-reserva-reintentar-fallidos', '8,23,38,53 * * * *'),
      ('avisos-telegram-vigilante',     '13,28,43,58 * * * *'),
      ('ia-modelos-openai',             '20 6 * * *')
    ) as v(nombre, horario)
  loop
    perform cron.alter_job(j.jobid, schedule := r.horario)
       from cron.job j
      where j.jobname = r.nombre and j.schedule is distinct from r.horario;
  end loop;
end
$cron$;
