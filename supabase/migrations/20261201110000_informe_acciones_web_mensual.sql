set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261201110000_informe_acciones_web_mensual — Informes › «Informe mensual de lo que hacen los clientes en la web» (14/11/2026)
-- ===========================================================================
-- Ranking de acciones de los visitantes de la web (ver la carta, abrir un
-- plato o un vino, pulsar Reservar, llamar, WhatsApp, cómo llegar, comprar un
-- cheque, buscar…): cuántas veces, en cuántas visitas, y lo mismo del mes
-- anterior. SOLO cuenta visitas con el consentimiento «Estadísticas» (las
-- demás no se registran) y deja fuera bots, tráfico interno y pruebas.
-- Lee web_sesiones / web_eventos del entorno de esta base de datos
-- (web_logs_config.entorno_bd). Solo lectura. Solo super admin.
-- Vuelta atrás: supabase/rollbacks/20261201110000_informe_acciones_web_mensual_ROLLBACK.sql.
begin;

create or replace function public.informe_acciones_web_mensual(p_mes text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ini timestamptz;
  v_fin timestamptz;
  v_prev timestamptz;
  v_ent text;
  v_res jsonb;
begin
  if auth.uid() is null or not exists (select 1 from public.super_admins s where s.user_id = auth.uid()) then
    raise exception 'Solo el super admin puede generar este informe' using errcode = '42501';
  end if;
  if p_mes is null or p_mes !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Mes inválido (se espera AAAA-MM)' using errcode = '22023';
  end if;
  v_ini := (p_mes || '-01')::date::timestamp at time zone 'Europe/Madrid';
  v_fin := ((p_mes || '-01')::date + interval '1 month')::timestamp at time zone 'Europe/Madrid';
  v_prev := ((p_mes || '-01')::date - interval '1 month')::timestamp at time zone 'Europe/Madrid';
  select c.entorno_bd into v_ent from public.web_logs_config c limit 1;
  v_ent := coalesce(v_ent, 'produccion');

  with ses as materialized (
    select s.sesion_id, (s.inicio >= v_ini) as es_mes
      from public.web_sesiones s
     where s.entorno = v_ent and s.consentimiento and not s.es_bot and not s.es_interno and not s.es_prueba
       and s.inicio >= v_prev and s.inicio < v_fin
  ),
  acc as (
    select ses.es_mes, e.sesion_id, a.id
      from ses
      join public.web_eventos e on e.sesion_id = ses.sesion_id and e.consentimiento
      cross join lateral (values
        ('ver_carta',          e.tipo = 'pagina_vista' and e.ruta ~ '^/((en|fr)/)?carta(/|$)'),
        ('ver_vinos',          e.tipo = 'pagina_vista' and e.ruta ~ '^/((en|fr)/)?carta/vinos(/|$)'),
        ('cambiar_categoria',  e.tipo = 'carta_categoria'),
        ('abrir_plato',        e.tipo = 'plato_abierto'),
        ('abrir_vino',         e.tipo = 'vino_abierto'),
        ('abrir_bebida',       e.tipo = 'bebida_abierta'),
        ('ver_alergenos',      e.tipo = 'clic' and e.objetivo ilike 'Ver ingredientes%'),
        ('ampliar_foto',       e.tipo = 'clic' and (e.objetivo ilike 'Ver foto%' or e.objetivo ilike 'Ampliar foto%')),
        ('buscar',             e.tipo = 'busqueda'),
        ('filtrar',            e.tipo = 'filtro'),
        ('mi_mesa',            e.tipo = 'pedido' and e.accion = 'anadir'),
        ('pulsar_reservar',    e.tipo = 'clic' and (e.objetivo ~* 'reserv' or (e.propiedades ->> 'destino') ~ '^/((en|fr)/)?reservas')),
        ('ver_disponibilidad', e.tipo = 'reserva_disponibilidad'),
        ('reserva_enviada',    e.tipo = 'reserva_solicitada'),
        ('llamar',             e.tipo = 'contacto' and e.accion = 'telefono'),
        ('whatsapp',           e.tipo = 'contacto' and e.accion = 'whatsapp'),
        ('como_llegar',        e.tipo = 'contacto' and e.accion = 'mapa'),
        ('correo',             e.tipo = 'contacto' and e.accion = 'email'),
        ('redes',              e.tipo = 'contacto' and e.accion = 'red_social'),
        ('ver_cheques',        e.tipo = 'pagina_vista' and e.ruta ~ '^/((en|fr)/)?tienda(/|$)'),
        ('ir_a_pagar_cheque',  e.tipo = 'cheque_checkout' and e.accion = 'ir_al_pago'),
        ('cheque_pagado',      e.tipo = 'cheque_pagado'),
        ('chat',               e.tipo = 'chat' and e.accion = 'mensaje')
      ) as a(id, ok)
     where a.ok
  )
  select jsonb_build_object(
    'mes', p_mes,
    'entorno', v_ent,
    'sesiones', (select count(*) from ses where es_mes),
    'sesiones_anterior', (select count(*) from ses where not es_mes),
    'datos_desde', (select min(e.ocurrido_en) from public.web_eventos e where e.entorno = v_ent and e.fuente = 'navegador' and e.consentimiento),
    'acciones', coalesce((
      select jsonb_agg(to_jsonb(t))
        from (select id,
                     count(*) filter (where es_mes) as n,
                     count(distinct sesion_id) filter (where es_mes) as sesiones,
                     count(*) filter (where not es_mes) as n_anterior,
                     count(distinct sesion_id) filter (where not es_mes) as sesiones_anterior
                from acc group by id) t), '[]'::jsonb)
  ) into v_res;
  return v_res;
end;
$$;

revoke all on function public.informe_acciones_web_mensual(text) from public, anon;
grant execute on function public.informe_acciones_web_mensual(text) to authenticated;

commit;
