-- Vuelta atrás de 20261212610000_ocr_cola_dos_guardados (solo la función: no hay datos que deshacer).
-- Devuelve ocr_despachar a la versión de 20261106200000 (3 consolidaciones y 12 piezas a la vez).
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

select 'ocr_cola_dos_guardados: deshecha' as resultado;
