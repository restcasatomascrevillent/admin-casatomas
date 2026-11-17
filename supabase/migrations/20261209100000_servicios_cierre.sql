set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261209100000_servicios_cierre — Super Admin › Servicios: cierre de los
-- gastos mensuales (Loading, Vercel Pro, Hostinger, Mapbox y cuadre de la IA)
-- ===========================================================================
-- Dueño (17/11/2026): «Vamos a cerrar todo lo de los servicios y que se
-- apunten correctamente los gastos mensuales […] Loading ya no se gasta y hay
-- que controlar todo lo que utiliza api open ai y toda la ia que se gasta del
-- panel […] vercel usamos el pro ahora y en hostinger tenemos dos buzones de
-- correo y un dominio, en mapbox no salen el número de usos del mapa».
--
-- QUÉ HACE
--   0. Copia de las filas que toca (`servicios_contratados_copia_cierre`, solo
--      service_role), para que el rollback las devuelva tal cual estaban.
--   1. Loading: «no lo usamos» (activo = false). Deja de leerse y de sumar.
--   2. Vercel: plan Pro, 20 US$ al mes, precio confirmado. Fuera los límites
--      del plan Hobby (peticiones, transferencia, CPU…): en Pro se paga por
--      uso, y lo que cuenta es el límite nuevo `uso_periodo` (los 20 US$ de
--      uso que incluye el plan en cada periodo de facturación; lo que pase se
--      cobra aparte). servicios-uso lo lee de la facturación de Vercel.
--   3. Hostinger: el dominio .es (9,99 € al año) y los dos buzones de correo
--      (Starter Business Email, 38,16 € al año): 48,15 € al año, confirmado.
--      Son los precios de renovación que da la API de Hostinger el 17/11/2026.
--   4. Mapbox: contador propio de cargas del mapa de vinos
--      (`mapa_vinos_cargas`, una fila por día, sin ningún dato del visitante)
--      que la web suma con `mapa_vinos_contar_carga()` cada vez que dibuja el
--      mapa. Hasta ahora se contaban las sesiones con el evento `mapa_vinos`
--      de los logs de la web, que la web nunca llegó a mandar: salía 0.
--      `servicios_cargas_mapa_vinos` pasa a leer el contador (y, si un día
--      llega el evento, se queda con la cifra mayor).
--   5. IA: `ia_cuadre_openai(p_desde, p_hasta)` compara lo que OpenAI ha
--      facturado en los días ya publicados con lo que las funciones del panel
--      registraron esos mismos días en ESTE proyecto. La diferencia es lo que
--      gasta la demo y las pruebas, que usan la misma clave de OpenAI.
--      `procesar-dibujo-perimetro` pasa a «instrumentada» (ya registra).
--
-- APLICAR (una a una, nunca `db push`): demo primero (sfonaclosuafvlhutkon),
-- producción (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR de la release y
-- con el «sí» del dueño. Idempotente. Después, desplegar `servicios-uso` y
-- `procesar-dibujo-perimetro`.
-- Deshacer: supabase/rollbacks/20261209100000_servicios_cierre_ROLLBACK.sql
-- Pruebas: npm run test:servicios-cierre:db (PGlite).
-- ===========================================================================

begin;

do $$
begin
  if to_regclass('public.servicios_contratados') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'servicios_contratados' and column_name = 'precio_confirmado_en') then
    raise exception 'servicios_cierre: falta 20261129153000_costes_servicios_ia. No se ha cambiado nada.';
  end if;
end;
$$;

-- ─── 0. Copia de lo que se toca (para el rollback) ──────────────────────────
create table if not exists public.servicios_contratados_copia_cierre (
  proveedor  text primary key,
  fila       jsonb not null,
  copiado_en timestamptz not null default now()
);
comment on table public.servicios_contratados_copia_cierre is
  'Cómo estaban Loading, Vercel, Hostinger y Mapbox antes de 20261209100000_servicios_cierre. Solo la usa su rollback.';
alter table public.servicios_contratados_copia_cierre enable row level security;
revoke all on public.servicios_contratados_copia_cierre from public, anon, authenticated;
grant all on public.servicios_contratados_copia_cierre to service_role;

insert into public.servicios_contratados_copia_cierre (proveedor, fila)
select s.proveedor, to_jsonb(s)
  from public.servicios_contratados s
 where s.proveedor in ('loading', 'vercel', 'hostinger', 'mapbox')
on conflict (proveedor) do nothing;

-- ─── 1. Loading: ya no se usa ───────────────────────────────────────────────
update public.servicios_contratados
   set activo = false,
       por_confirmar = false,
       para_que = 'El dominio, el correo y la web antigua (ya no se usa: el dominio y el correo están en Hostinger).'
 where proveedor = 'loading'
   and activo is distinct from false;

-- ─── 2. Vercel: plan Pro ────────────────────────────────────────────────────
update public.servicios_contratados
   set plan = 'Pro',
       ciclo = 'mensual',
       precio_mensual = 20,
       precio_anual = null,
       moneda = 'USD',
       por_confirmar = false,
       precio_confirmado_en = coalesce(precio_confirmado_en, current_date),
       fuente_precio = 'https://vercel.com/pricing',
       plan_siguiente = null,
       precio_siguiente = null,
       si_se_pasa = 'Vercel no corta las webs: cobra en la factura del mes el uso que pase de los 20 US$ incluidos.'
 where proveedor = 'vercel'
   and plan is distinct from 'Pro';

-- Los límites del plan Hobby ya no valen (se reconocen por su página oficial);
-- tampoco los dos «sin dato» de almacenamiento, que ahora salen de la facturación.
update public.servicios_contratados s
   set limites = coalesce((
         select jsonb_object_agg(l.key, l.value)
           from jsonb_each(s.limites) l
          where coalesce(l.value ->> 'fuente', '') not like 'https://vercel.com/docs/plans/hobby%'
            and not (l.key in ('almacenamiento_despliegues', 'almacenamiento_funciones') and l.value ->> 'limite' is null)
       ), '{}'::jsonb)
 where s.proveedor = 'vercel';

update public.servicios_contratados
   set limites = limites || jsonb_build_object('uso_periodo', jsonb_build_object(
         'etiqueta', 'Uso del periodo de facturación',
         'limite', 20,
         'unidad', 'USD',
         'periodo', 'periodo de facturación',
         'orden', 0,
         'fuente', 'https://vercel.com/docs/plans/pro-plan',
         'nota', 'El plan Pro incluye 20 US$ de uso en cada periodo (compilaciones, almacenamiento, visitas…). Lo que pase se cobra aparte.',
         'si_se_pasa', 'Vercel no corta las webs: cobra el exceso en la factura del mes.'))
 where proveedor = 'vercel'
   and not (limites ? 'uso_periodo');

-- ─── 3. Hostinger: un dominio y dos buzones ─────────────────────────────────
update public.servicios_contratados
   set nombre = 'Hostinger (dominio y correo)',
       plan = 'Dominio .es + 2 buzones de correo (Starter Business Email)',
       ciclo = 'anual',
       precio_anual = 48.15,
       precio_mensual = null,
       moneda = 'EUR',
       por_confirmar = false,
       precio_confirmado_en = coalesce(precio_confirmado_en, current_date),
       fuente_precio = coalesce(fuente_precio, 'https://hpanel.hostinger.com/billing/subscriptions'),
       para_que = 'El dominio restaurantecasatomascrevillente.es y los dos buzones de correo del restaurante.',
       notas = coalesce(nullif(notas, ''), 'Renovación al año: dominio .es 9,99 € + correo (2 buzones) 38,16 €. La tarjeta avisa si la API de Hostinger da otro importe.')
 where proveedor = 'hostinger'
   and por_confirmar is true;

-- ─── 4. Mapbox: contador propio de cargas del mapa ──────────────────────────
create table if not exists public.mapa_vinos_cargas (
  dia    date primary key,
  cargas integer not null default 0,
  constraint mapa_vinos_cargas_chk check (cargas >= 0)
);
comment on table public.mapa_vinos_cargas is
  'Veces que la web ha dibujado el mapa de vinos (Mapbox) cada día (UTC). Solo un número por día: ningún dato del visitante. Lo suma mapa_vinos_contar_carga().';
alter table public.mapa_vinos_cargas enable row level security;
revoke all on public.mapa_vinos_cargas from public, anon, authenticated;
grant select on public.mapa_vinos_cargas to authenticated;
grant all on public.mapa_vinos_cargas to service_role;
drop policy if exists mapa_vinos_cargas_super_admin on public.mapa_vinos_cargas;
create policy mapa_vinos_cargas_super_admin
  on public.mapa_vinos_cargas for select to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) );

-- La llama la web (anon) al crear el mapa. No recibe ni guarda nada del
-- visitante. Tope diario de cordura: nadie puede inflar la cifra sin fin.
create or replace function public.mapa_vinos_contar_carga()
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.mapa_vinos_cargas as c (dia, cargas)
  values ((now() at time zone 'utc')::date, 1)
  on conflict (dia) do update set cargas = c.cargas + 1 where c.cargas < 200000;
$$;
comment on function public.mapa_vinos_contar_carga() is
  'Suma una carga del mapa de vinos al día de hoy (UTC). La llama la web cada vez que dibuja el mapa de Mapbox.';
revoke all on function public.mapa_vinos_contar_carga() from public;
grant execute on function public.mapa_vinos_contar_carga() to anon, authenticated, service_role;

create or replace function public.servicios_cargas_mapa_vinos(p_desde timestamptz)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_contador integer;
  v_sesiones integer;
begin
  select sum(c.cargas)::int into v_contador
    from public.mapa_vinos_cargas c
   where c.dia >= (p_desde at time zone 'utc')::date;
  if to_regclass('public.web_eventos') is not null then
    execute $q$
      select count(distinct coalesce(sesion_id::text, evento_id::text))::int
        from public.web_eventos
       where tipo = 'mapa_vinos' and entorno = 'produccion'
         and not es_bot and not es_prueba and not es_interno
         and ocurrido_en >= $1
    $q$ into v_sesiones using p_desde;
  end if;
  -- Sin logs de la web y sin ninguna carga contada todavía: 0 (el contador existe).
  return greatest(coalesce(v_contador, 0), coalesce(v_sesiones, 0));
end;
$$;
revoke all on function public.servicios_cargas_mapa_vinos(timestamptz) from public, anon, authenticated;
grant execute on function public.servicios_cargas_mapa_vinos(timestamptz) to service_role;

update public.servicios_contratados
   set limites = jsonb_set(limites, '{cargas_mapa_web,nota}', to_jsonb(
         'Después, 5 US$ cada 1.000 cargas. Lectura automática: la web suma una carga cada vez que dibuja el mapa (contador propio, sin datos del visitante). La cifra oficial, en su panel (Statistics).'::text))
 where proveedor = 'mapbox'
   and limites ? 'cargas_mapa_web';

-- ─── 5. IA: cuadre con lo que factura OpenAI ────────────────────────────────
-- Días (UTC, como los publica OpenAI) entre p_desde y p_hasta que ya tienen
-- coste real: lo facturado frente a lo registrado aquí esos mismos días.
-- Security invoker: la RLS de cada tabla decide (solo un super admin ve filas).
create or replace function public.ia_cuadre_openai(p_desde date, p_hasta date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with reales as (
    select o.fecha, sum(o.usd) as usd
      from public.openai_costes_diarios o
     where o.fecha between p_desde and p_hasta
     group by o.fecha
  ), registrado as (
    select (i.created_at at time zone 'utc')::date as fecha, sum(i.coste_usd) as usd
      from public.ia_uso i
     where i.created_at >= (p_desde::timestamp at time zone 'utc')
       and i.created_at <  ((p_hasta + 1)::timestamp at time zone 'utc')
       and i.modelo not like 'vercel:%'
       and i.modelo not ilike 'sonar%'
       and i.funcion <> 'buscar-precios-mercado'
     group by 1
  ), web as (
    select (c.created_at at time zone 'utc')::date as fecha, sum(c.coste_usd) as usd
      from public.chat_web_uso c
     where c.created_at >= (p_desde::timestamp at time zone 'utc')
       and c.created_at <  ((p_hasta + 1)::timestamp at time zone 'utc')
     group by 1
  )
  select jsonb_build_object(
           'dias', count(*),
           'primer_dia', min(r.fecha),
           'ultimo_dia', max(r.fecha),
           'real_usd', coalesce(round(sum(r.usd), 4), 0),
           'registrado_usd', coalesce(round(sum(coalesce(g.usd, 0) + coalesce(w.usd, 0)), 4), 0))
    from reales r
    left join registrado g on g.fecha = r.fecha
    left join web w on w.fecha = r.fecha;
$$;
comment on function public.ia_cuadre_openai(date, date) is
  'Días con coste real de OpenAI entre dos fechas (UTC): lo facturado frente a lo que registraron las funciones de este proyecto (ia_uso + chat_web_uso). La diferencia es gasto de fuera (demo, pruebas). Solo super admin (RLS).';
revoke all on function public.ia_cuadre_openai(date, date) from public, anon;
grant execute on function public.ia_cuadre_openai(date, date) to authenticated, service_role;

do $$
begin
  if to_regclass('public.ia_funciones') is not null then
    update public.ia_funciones
       set instrumentada = true,
           que_hace = coalesce(que_hace, 'Convierte el dibujo a mano del plano de la sala en paredes rectas.'),
           accion = coalesce(accion, 'Pasar a limpio el dibujo de una sala'),
           unidad = case when unidad = 'llamada' then 'dibujo' else unidad end
     where funcion = 'procesar-dibujo-perimetro';
  end if;
end;
$$;

commit;
