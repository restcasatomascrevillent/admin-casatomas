-- ROLLBACK de 20261130100000_logs_web_origen.sql (Super Admin › Logs).
-- Aplicar a mano SOLO si hay que deshacerlo. Vuelve a la agrupación de
-- 20261129143000 (todos los errores vuelven a contar para los umbrales salvo
-- los de «versión antigua tras publicar», también los de la conexión del
-- visitante o del navegador) y al «Pedir ticket» de 20261118100000, y borra el
-- origen de eventos, incidencias y sesiones y el interruptor de los servicios
-- externos. No toca Linear ni los tickets ya creados. Las funciones
-- desplegadas con esta versión siguen funcionando sin las columnas (sin
-- origen tratan cada incidencia como antes) y el panel lo detecta y no enseña
-- los colores ni el filtro de origen.
begin;
set local lock_timeout = '5s';

-- Agrupación de 20261129143000_logs_web_legibles.sql (copia literal).
create or replace function public.web_logs_agrupar_errores(p_limite integer default 5000)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.web_logs_config;
  v_ids bigint[];
  v_afectadas bigint[];
  v_nuevas integer := 0;
  v_reabiertas integer := 0;
  v_pendientes integer := 0;
  v_reclasificadas bigint[];
begin
  if not pg_try_advisory_xact_lock(hashtext('web_logs_agrupar_errores')) then
    return jsonb_build_object('ocupado', true);
  end if;
  select * into c from public.web_logs_config where id;

  select array_agg(id order by id) into v_ids
    from (select id from public.web_eventos
           where categoria = 'error' and incidencia_id is null and huella is not null
           order by id limit greatest(p_limite, 1)) t;

  if v_ids is not null then
    with nuevas as (
      insert into public.web_incidencias (entorno, huella, titulo, tipo, fuente, proyecto, gravedad, primera_vez, ultima_vez,
                                          mensaje, pila, ejemplo_evento_id)
      select distinct on (e.entorno, e.huella)
             e.entorno, e.huella,
             left(coalesce(nullif(e.mensaje, ''), e.tipo) || coalesce(' · ' || nullif(e.objetivo, ''), ''), 200),
             e.tipo, e.fuente, e.proyecto, coalesce(e.gravedad, 'error'), e.ocurrido_en, e.ocurrido_en, e.mensaje, e.pila, e.id
        from public.web_eventos e
       where e.id = any (v_ids)
       order by e.entorno, e.huella, e.id
      on conflict (entorno, huella) do nothing
      returning 1
    )
    select count(*) into v_nuevas from nuevas;

    update public.web_eventos e
       set incidencia_id = i.id
      from public.web_incidencias i
     where e.id = any (v_ids) and i.entorno = e.entorno and i.huella = e.huella;

    select array_agg(distinct incidencia_id) into v_afectadas from public.web_eventos where id = any (v_ids);
  end if;

  -- Ficheros de una versión anterior (tras publicar): se clasifican con lo que
  -- pasó después en la misma sesión. Las que cambian se recalculan.
  v_reclasificadas := public.web_logs_clasificar_tras_publicar(now() - interval '2 days');

  -- También las que tienen ocurrencias que salen de las ventanas (cifras al día).
  select array_agg(distinct x) into v_afectadas
    from (select unnest(coalesce(v_afectadas, array[]::bigint[])) as x
          union
          select unnest(v_reclasificadas)
          union
          select id from public.web_incidencias
           where ocurrencias_ventana > 0 or ocurrencias_24h > 0) t;

  if v_afectadas is null then
    return jsonb_build_object('agrupados', 0, 'nuevas', 0, 'reabiertas', 0, 'pendientes_linear', 0);
  end if;

  with st as (
    select e.incidencia_id as id,
           min(e.ocurrido_en) as primera,
           max(e.ocurrido_en) as ultima,
           count(*) filter (where not e.es_bot) as n,
           count(distinct e.sesion_id) filter (where not e.es_bot) as ses,
           -- Para los umbrales solo cuenta lo que afecta a clientes: sin bots, sin pruebas ni
           -- tráfico interno (si así se configura) y sin «versión antigua tras publicar» que se
           -- arregló sola, de la que no hay datos o sin conexión (sí cuenta si recargar no lo arregló).
           count(*) filter (where not e.es_bot and (not c.excluir_pruebas_tickets or not (e.es_prueba or e.es_interno))
                              and coalesce(e.tras_publicar, '-') not in ('sin_impacto', 'sin_datos', 'sin_conexion')
                              and e.ocurrido_en > now() - make_interval(hours => c.umbral_ventana_horas)) as n_ventana,
           count(distinct e.sesion_id) filter (where not e.es_bot and (not c.excluir_pruebas_tickets or not (e.es_prueba or e.es_interno))
                              and coalesce(e.tras_publicar, '-') not in ('sin_impacto', 'sin_datos', 'sin_conexion')
                              and e.ocurrido_en > now() - make_interval(hours => c.umbral_ventana_horas)) as ses_ventana,
           count(*) filter (where not e.es_bot and e.tras_publicar in ('sin_impacto', 'sin_datos', 'sin_conexion')) as n_tras_publicar,
           count(*) filter (where not e.es_bot and e.tras_publicar = 'repetido') as n_repetidas,
           count(*) filter (where not e.es_bot and e.ocurrido_en > now() - interval '24 hours') as n24,
           max(case e.gravedad when 'critico' then 4 when 'error' then 3 when 'aviso' then 2 else 1 end) as grav,
           (array_agg(e.version order by e.ocurrido_en) filter (where e.version is not null))[1] as vprim,
           (array_agg(e.version order by e.ocurrido_en desc) filter (where e.version is not null))[1] as vult,
           (array_agg(e.despliegue order by e.ocurrido_en desc) filter (where e.despliegue is not null))[1] as dult
      from public.web_eventos e
     where e.incidencia_id = any (v_afectadas)
     group by e.incidencia_id
  ), rutas as (
    select r.incidencia_id as id, jsonb_agg(jsonb_build_object('ruta', r.ruta, 'n', r.n) order by r.n desc) as rutas
      from (select e.incidencia_id, coalesce(e.ruta, '(sin ruta)') as ruta, count(*) as n,
                   row_number() over (partition by e.incidencia_id order by count(*) desc) as rk
              from public.web_eventos e
             where e.incidencia_id = any (v_afectadas) and not e.es_bot
             group by e.incidencia_id, coalesce(e.ruta, '(sin ruta)')) r
     where r.rk <= 5
     group by r.incidencia_id
  )
  update public.web_incidencias i
     set primera_vez = st.primera,
         ultima_vez = st.ultima,
         ocurrencias = st.n,
         sesiones_afectadas = st.ses,
         ocurrencias_ventana = st.n_ventana,
         sesiones_ventana = st.ses_ventana,
         ocurrencias_24h = st.n24,
         gravedad = case st.grav when 4 then 'critico' when 3 then 'error' when 2 then 'aviso' else 'info' end,
         rutas = coalesce(rutas.rutas, '[]'::jsonb),
         version_primera = st.vprim,
         version_ultima = st.vult,
         despliegue_ultimo = st.dult,
         ocurrencias_tras_publicar = st.n_tras_publicar,
         repetidas_tras_recargar = st.n_repetidas,
         actualizado_en = now()
    from st left join rutas on rutas.id = st.id
   where i.id = st.id
     and (i.ultima_vez, i.ocurrencias, i.ocurrencias_ventana, i.sesiones_ventana, i.ocurrencias_24h, i.sesiones_afectadas, i.rutas,
          i.ocurrencias_tras_publicar, i.repetidas_tras_recargar)
         is distinct from (st.ultima, st.n::integer, st.n_ventana::integer, st.ses_ventana::integer, st.n24::integer, st.ses::integer,
          coalesce(rutas.rutas, '[]'::jsonb), st.n_tras_publicar::integer, st.n_repetidas::integer);

  -- Incidencias cuyos eventos ya se purgaron: ventanas a cero.
  update public.web_incidencias i
     set ocurrencias_ventana = 0, sesiones_ventana = 0, ocurrencias_24h = 0
   where i.id = any (v_afectadas)
     and not exists (select 1 from public.web_eventos e where e.incidencia_id = i.id)
     and (i.ocurrencias_ventana > 0 or i.ocurrencias_24h > 0);

  -- Patrones ignorados (extensiones del navegador, ruido conocido).
  update public.web_incidencias i
     set estado = 'ignorada', linear_estado = case when i.linear_estado = 'pendiente' then 'no_aplica' else i.linear_estado end,
         motivo_ticket = 'Coincide con un patrón ignorado en Configuración'
   where i.id = any (v_afectadas) and i.estado = 'nueva'
     and exists (select 1 from unnest(c.mensajes_ignorados) p
                  where p <> '' and (position(lower(p) in lower(coalesce(i.mensaje, ''))) > 0
                                     or position(lower(p) in lower(coalesce(i.pila, ''))) > 0));

  -- Reaparición de una resuelta: nueva ocurrencia posterior a la resolución.
  --   reabrir      → estado «reabierta» y, si había ticket, se reabre/comenta el mismo.
  --   nuevo_ticket → estado «reabierta» y un ticket NUEVO (id nuevo), enlazando el anterior.
  --   ignorar      → sigue resuelta (las ocurrencias se cuentan igual).
  with r as (
    update public.web_incidencias i
       set estado = 'reabierta',
           reabierta_veces = i.reabierta_veces + 1,
           linear_pendiente_reapertura = (c.reapertura = 'reabrir' and i.linear_estado = 'creado'),
           linear_estado = case when c.reapertura = 'nuevo_ticket' and i.linear_estado = 'creado' then 'sin_ticket' else i.linear_estado end,
           linear_uuid = case when c.reapertura = 'nuevo_ticket' and i.linear_estado = 'creado' then gen_random_uuid() else i.linear_uuid end,
           linear_issue_id = case when c.reapertura = 'nuevo_ticket' and i.linear_estado = 'creado' then null else i.linear_issue_id end,
           motivo_ticket = case when c.reapertura = 'nuevo_ticket' and i.linear_estado = 'creado'
                                then left('Reaparecida tras resolverse (ticket anterior: ' || coalesce(i.linear_identificador, i.linear_issue_id, '?') || ')', 500)
                                else i.motivo_ticket end
     where i.id = any (v_afectadas) and i.estado = 'resuelta' and i.resuelta_en is not null
       and c.reapertura <> 'ignorar'
       and exists (select 1 from public.web_eventos e where e.incidencia_id = i.id and e.ocurrido_en > i.resuelta_en and not e.es_bot)
    returning 1
  )
  select count(*) into v_reabiertas from r;

  -- Umbrales de ticket.
  update public.web_incidencias i
     set requiere_ticket = true,
         linear_estado = 'pendiente',
         linear_proximo_intento = coalesce(i.linear_proximo_intento, now()),
         motivo_ticket = case
           when i.gravedad = 'critico' then 'Gravedad crítica: se abre con la primera ocurrencia'
           when i.tipo = 'error_404' then format('%s 404 en 24 h (umbral %s)', i.ocurrencias_24h, c.umbral_404_diario)
           else format('%s ocurrencias y %s sesiones en %s h (umbral %s y %s)', i.ocurrencias_ventana, i.sesiones_ventana,
                       c.umbral_ventana_horas, c.umbral_ocurrencias, c.umbral_sesiones)
         end || case when i.motivo_ticket like 'Reaparecida%' then ' · ' || i.motivo_ticket else '' end
   where i.id = any (v_afectadas)
     and i.linear_estado = 'sin_ticket'
     and i.estado in ('nueva', 'abierta', 'reabierta')
     and c.linear_modo <> 'desactivado'
     and i.entorno = any (c.entornos_ticket)
     and i.ocurrencias_ventana > 0
     and (
       (i.tipo = 'error_404' and c.tickets_404 and i.ocurrencias_24h >= c.umbral_404_diario)
       or (i.tipo <> 'error_404' and (
             i.gravedad = 'critico'
             or (i.ocurrencias_ventana >= c.umbral_ocurrencias
                 and (i.fuente <> 'navegador' or i.sesiones_ventana >= c.umbral_sesiones))))
     );

  select count(*) into v_pendientes from public.web_incidencias
   where linear_estado in ('pendiente', 'error') or linear_pendiente_reapertura;

  return jsonb_build_object('agrupados', coalesce(cardinality(v_ids), 0), 'nuevas', v_nuevas,
                            'reabiertas', v_reabiertas, 'pendientes_linear', v_pendientes);
end;
$$;
revoke all on function public.web_logs_agrupar_errores(integer) from public, anon, authenticated;
grant execute on function public.web_logs_agrupar_errores(integer) to service_role;

-- «Pedir ticket» de 20261118100000_logs_web.sql (copia literal).
create or replace function public.web_incidencia_pedir_ticket(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_modo text;
begin
  if not coalesce(public.is_super_admin(auth.uid()), false) then
    raise exception 'Solo un super admin puede pedir tickets' using errcode = '42501';
  end if;
  select linear_modo into v_modo from public.web_logs_config where id;
  update public.web_incidencias i
     set requiere_ticket = true,
         linear_estado = 'pendiente',
         linear_proximo_intento = now(),
         linear_intentos = 0,
         linear_ultimo_error = null,
         linear_uuid = case when i.linear_destino is not null and i.linear_destino <> v_modo then gen_random_uuid() else i.linear_uuid end,
         linear_issue_id = case when i.linear_destino is not null and i.linear_destino <> v_modo then null else i.linear_issue_id end,
         motivo_ticket = coalesce(i.motivo_ticket, 'Pedido a mano desde Super Admin › Logs'),
         estado = case when i.estado = 'ignorada' then 'abierta' else i.estado end
   where i.id = p_id
     and (i.linear_estado <> 'creado' or (i.linear_destino is not null and i.linear_destino <> v_modo));
end;
$$;
revoke all on function public.web_incidencia_pedir_ticket(bigint) from public, anon;
grant execute on function public.web_incidencia_pedir_ticket(bigint) to authenticated;

drop function if exists public.web_logs_origen_error(text, text, text, text, text, jsonb, text, text);
drop function if exists public.web_logs_proveedor_externo(text, text, text, text, text);
drop index if exists public.web_incidencias_origen_idx;
alter table public.web_incidencias drop column if exists origen_prioridad;
alter table public.web_incidencias drop constraint if exists web_incidencias_origen_chk;
alter table public.web_incidencias drop column if exists origen;
alter table public.web_incidencias drop column if exists origen_proveedor;
alter table public.web_eventos drop constraint if exists web_eventos_origen_chk;
alter table public.web_eventos drop column if exists origen;
alter table public.web_sesiones drop column if exists errores_web;
alter table public.web_sesiones drop column if exists errores_externos;
revoke update (linear_tickets_externos) on public.web_logs_config from authenticated;
alter table public.web_logs_config drop column if exists linear_tickets_externos;

do $$ begin raise notice 'logs_web_origen: deshecha'; end $$;

commit;
