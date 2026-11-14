set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261129153000_costes_servicios_ia — Super Admin › Servicios › Costes:
-- el precio de todos los servicios y de las IAs
-- ===========================================================================
-- Encargo del dueño (13/11/2026, «Pasos para saber el precio de todos los
-- servicios y de las IAs»): inventario con para qué se usa cada servicio y
-- «Confirmar precio», gasto variable del mes, la IA función por función con
-- su coste por uso, lo que cuesta cada cosa en palabras («Leer una factura ≈
-- X céntimos»), total del mes con previsión y mes anterior, avisos antes de
-- pasar del plan gratis (qué pasaría y cuánto cuesta el plan siguiente) e
-- informe mensual. Los precios siguen en la base de datos y se editan desde
-- la pantalla: nada de precios escritos en el código.
--
-- QUÉ HACE
--   1. servicios_contratados, columnas nuevas (editables por el super admin):
--        · para_que             «Para qué lo usamos», en palabras.
--        · precio_confirmado_en Día en que se comprobó el plan y el precio
--                               («Confirmar precio»).
--        · plan_siguiente       El plan al que habría que pasar si se acaba
--        · precio_siguiente     el gratis, y su precio al mes (en la moneda
--                               del servicio).
--        · si_se_pasa           Qué pasa si se pasa de un límite del plan.
--      Y en `limites`, para Supabase y Resend, `si_se_pasa` por métrica
--      (la base de datos no se comporta igual que los archivos). Semilla solo
--      donde no hay nada: no pisa lo que haya escrito el dueño.
--   2. ia_funciones: `que_hace` (qué hace, en palabras del restaurante) y
--      `accion` («Leer una factura»: la frase de «Cuánto cuesta cada cosa»).
--      Da de alta las dos funciones que ya registraban sin estar en el
--      catálogo (buscar-puntuacion-parker, interpretar-reserva-manuscrita) y
--      marca como instrumentadas las que ya registran su gasto en ia_uso
--      (chat-facturas, traducir-contenido, format-novedad, rrss-ia,
--      instagram-ia, buscar-precios-mercado: el catálogo decía que no).
--   3. ia_coste_por_uso(p_desde, p_hasta) (security invoker: solo un super
--      admin ve filas): por función, llamadas, usos, coste y la MEDIANA del
--      coste de un uso. Un uso = una petición a la función: las filas de un
--      mismo trabajo de OCR (disparador «trabajo:<id>#…») o, en el resto, las
--      que la misma petición escribe seguidas (mismo disparador, menos de 5 s
--      entre una y otra; registrarUso las escribe una tras otra en el finally).
--      chat-web sale de chat_web_uso (una fila = una pregunta). Las filas con
--      coste NULL (modelo sin tarifa) no suman ni entran en la mediana: se
--      cuentan aparte para avisar.
--
-- APLICAR (una a una, nunca `db push`): demo primero (sfonaclosuafvlhutkon),
-- producción (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR de la release y
-- con el «sí» del dueño. Idempotente. No hace falta desplegar ninguna función.
-- Deshacer: supabase/rollbacks/20261129153000_costes_servicios_ia_ROLLBACK.sql
-- Pruebas: npm run test:costes-ia:db (PGlite).
-- ===========================================================================

begin;

do $$
begin
  if to_regclass('public.servicios_contratados') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'servicios_contratados' and column_name = 'por_confirmar') then
    raise exception 'costes_servicios_ia: falta 20261103160000_servicios_planes_costes. No se ha cambiado nada.';
  end if;
  if to_regclass('public.ia_funciones') is null or to_regclass('public.ia_uso') is null then
    raise exception 'costes_servicios_ia: falta 20260928193000_costes_sistema (ia_funciones / ia_uso). No se ha cambiado nada.';
  end if;
end;
$$;

-- ─── 1. servicios_contratados: para qué, precio confirmado y plan siguiente ─
alter table public.servicios_contratados add column if not exists para_que text;
alter table public.servicios_contratados add column if not exists precio_confirmado_en date;
alter table public.servicios_contratados add column if not exists plan_siguiente text;
alter table public.servicios_contratados add column if not exists precio_siguiente numeric(10,2);
alter table public.servicios_contratados add column if not exists si_se_pasa text;

alter table public.servicios_contratados drop constraint if exists servicios_contratados_para_que_chk;
alter table public.servicios_contratados add constraint servicios_contratados_para_que_chk
  check (para_que is null or length(para_que) <= 300);
alter table public.servicios_contratados drop constraint if exists servicios_contratados_plan_siguiente_chk;
alter table public.servicios_contratados add constraint servicios_contratados_plan_siguiente_chk
  check (plan_siguiente is null or length(plan_siguiente) <= 80);
alter table public.servicios_contratados drop constraint if exists servicios_contratados_precio_siguiente_chk;
alter table public.servicios_contratados add constraint servicios_contratados_precio_siguiente_chk
  check (precio_siguiente is null or (precio_siguiente >= 0 and precio_siguiente <= 100000));
alter table public.servicios_contratados drop constraint if exists servicios_contratados_si_se_pasa_chk;
alter table public.servicios_contratados add constraint servicios_contratados_si_se_pasa_chk
  check (si_se_pasa is null or length(si_se_pasa) <= 500);
alter table public.servicios_contratados drop constraint if exists servicios_contratados_precio_confirmado_chk;
alter table public.servicios_contratados add constraint servicios_contratados_precio_confirmado_chk
  check (precio_confirmado_en is null or precio_confirmado_en >= date '2020-01-01');

comment on column public.servicios_contratados.para_que is 'Para qué lo usa el restaurante, en palabras (inventario de Servicios › Costes).';
comment on column public.servicios_contratados.precio_confirmado_en is 'Día en que el super admin comprobó plan y precio («Confirmar precio»). null = sin comprobar o de antes.';
comment on column public.servicios_contratados.plan_siguiente is 'Plan al que habría que pasar si se acaba el actual (p. ej. «Pro»).';
comment on column public.servicios_contratados.precio_siguiente is 'Precio al mes del plan siguiente, en la moneda del servicio. null = sin dato o pago por uso.';
comment on column public.servicios_contratados.si_se_pasa is 'Qué pasa si se pasa de un límite del plan. Una métrica puede afinarlo con limites.<clave>.si_se_pasa.';

grant update (para_que, precio_confirmado_en, plan_siguiente, precio_siguiente, si_se_pasa)
  on public.servicios_contratados to authenticated;
grant insert (para_que, precio_confirmado_en, plan_siguiente, precio_siguiente, si_se_pasa)
  on public.servicios_contratados to authenticated;

-- Semilla (solo donde está vacío). Precios del plan siguiente según la página
-- oficial de cada proveedor (fuente_precio), consultada el 13/11/2026.
update public.servicios_contratados s
   set para_que = v.para_que
  from (values
    ('vercel',       'Publica las webs (la del restaurante y la de Touza) y este panel.'),
    ('supabase',     'La base de datos: reservas, facturas, carta, usuarios, fotos y archivos.'),
    ('github',       'Guarda el código de las webs y del panel y pasa las pruebas automáticas.'),
    ('resend',       'Manda los correos: confirmaciones de reserva y la newsletter.'),
    ('stripe',       'Cobra los cheques regalo de la web.'),
    ('openai',       'La inteligencia artificial: leer facturas y vinos, los chats, traducir la carta…'),
    ('perplexity',   'Precios de lonja (ya no se usa).'),
    ('vapi',         'El asistente que contesta el teléfono.'),
    ('google',       'Las reseñas de Google en la web y en el panel.'),
    ('mapbox',       'El mapa de vinos de la web.'),
    ('google_drive', 'Las copias de las facturas originales.'),
    ('hostinger',    'Dominio y alojamiento (falta confirmar si se usa).'),
    ('loading',      'El dominio restaurantecasatomascrevillente.es, el correo y la web antigua.')
  ) as v(proveedor, para_que)
 where s.proveedor = v.proveedor and s.para_que is null;

update public.servicios_contratados s
   set plan_siguiente   = coalesce(s.plan_siguiente, v.plan),
       precio_siguiente = coalesce(s.precio_siguiente, v.precio),
       si_se_pasa       = coalesce(s.si_se_pasa, v.si_se_pasa)
  from (values
    ('vercel', 'Pro', 20.00::numeric,
     'Vercel pausa lo que se pase (las webs o el panel) hasta que pasen 30 días, salvo que se pase al plan Pro (20 US$ por persona y mes).'),
    ('supabase', 'Pro', 25.00::numeric,
     'Supabase puede limitar el proyecto hasta el mes siguiente o hasta pasar al plan Pro.'),
    ('resend', 'Pro', 20.00::numeric,
     'Los correos (confirmaciones de reserva y newsletter) dejan de salir hasta que se renueva el cupo. El plan Pro incluye 50.000 correos al mes.'),
    ('github', 'Team', 4.00::numeric,
     'GitHub deja de arrancar las pruebas automáticas y la copia de seguridad hasta el mes siguiente o hasta poner un presupuesto. El plan Team cuesta 4 US$ por persona y mes.'),
    ('google_drive', 'Google One 100 GB', 1.99::numeric,
     'Con la cuenta llena no se guardan más copias de las facturas en Drive (y el Gmail de esa cuenta deja de recibir correo).'),
    ('mapbox', 'Pago por uso', null::numeric,
     'Pasadas las 50.000 cargas del mes, Mapbox cobra 5 US$ cada 1.000 cargas más.')
  ) as v(proveedor, plan, precio, si_se_pasa)
 where s.proveedor = v.proveedor
   and (s.plan_siguiente is null or s.precio_siguiente is null or s.si_se_pasa is null);

-- Qué pasa, métrica a métrica, donde no es lo mismo (solo si la métrica existe
-- y aún no lo dice).
update public.servicios_contratados s
   set limites = jsonb_set(s.limites, array[v.clave, 'si_se_pasa'], to_jsonb(v.texto))
  from (values
    ('supabase', 'bd_tamano',      'La base de datos pasa a solo lectura: no se podrían guardar reservas, facturas ni cambios hasta liberar espacio o pasar al plan Pro.'),
    ('supabase', 'almacenamiento', 'No se podrían subir más fotos ni archivos (carta, facturas originales) hasta liberar espacio o pasar al plan Pro.'),
    ('supabase', 'egreso',         'Supabase avisa y, si se repite, puede limitar el proyecto hasta pasar al plan Pro.'),
    ('resend',   'correos_hoy',    'Los correos dejan de salir hasta el día siguiente (confirmaciones de reserva incluidas).'),
    ('resend',   'correos_mes',    'Los correos dejan de salir hasta el mes siguiente (confirmaciones de reserva incluidas).')
  ) as v(proveedor, clave, texto)
 where s.proveedor = v.proveedor
   and jsonb_typeof(s.limites -> v.clave) = 'object'
   and not (s.limites -> v.clave ? 'si_se_pasa');

-- ─── 2. ia_funciones: qué hace y la frase de «Cuánto cuesta cada cosa» ──────
alter table public.ia_funciones add column if not exists que_hace text;
alter table public.ia_funciones add column if not exists accion text;
alter table public.ia_funciones drop constraint if exists ia_funciones_que_hace_chk;
alter table public.ia_funciones add constraint ia_funciones_que_hace_chk check (que_hace is null or length(que_hace) <= 300);
alter table public.ia_funciones drop constraint if exists ia_funciones_accion_chk;
alter table public.ia_funciones add constraint ia_funciones_accion_chk check (accion is null or length(accion) <= 80);
comment on column public.ia_funciones.que_hace is 'Qué hace la función, en palabras del restaurante (tabla «IA, función por función»).';
comment on column public.ia_funciones.accion is 'Una acción en palabras («Leer una factura»): sale en «Cuánto cuesta cada cosa» con la mediana del coste de un uso.';

-- Las que ya registraban en ia_uso sin estar en el catálogo.
insert into public.ia_funciones (funcion, descripcion, instrumentada, unidad, orden)
values
  ('buscar-puntuacion-parker', 'Carta › Vinos: busca en internet la puntuación Parker de un vino (gpt-4.1 + búsqueda web). Registra cada llamada en ia_uso.', true, 'vino', 65),
  ('interpretar-reserva-manuscrita', 'Reservas › «Escribir reserva»: lee con visión lo escrito a mano en la hoja del día. Registra cada llamada en ia_uso.', true, 'reserva', 67)
on conflict (funcion) do nothing;

-- Ya registran su gasto (registrarUso en su código): el catálogo decía que no.
update public.ia_funciones
   set instrumentada = true
 where funcion in ('chat-facturas', 'traducir-contenido', 'format-novedad', 'rrss-ia', 'instagram-ia', 'buscar-precios-mercado')
   and instrumentada = false;

update public.ia_funciones f
   set que_hace = coalesce(f.que_hace, v.que_hace),
       accion   = coalesce(f.accion, v.accion)
  from (values
    ('ocr-trabajo',                    'Lee las facturas y albaranes que se suben (foto o PDF) y saca sus líneas.', 'Leer una factura'),
    ('procesar-factura',               'Prepara la lectura de cada factura; aquí solo gasta al indexar productos (al sustituir una factura o al importar el histórico).', 'Indexar los productos de una factura'),
    ('clasificar-productos',           'Ordena en el catálogo los productos nuevos de las facturas (sola, cada pocos minutos).', 'Clasificar una tanda de productos nuevos'),
    ('chat-facturas',                  'Contesta a las preguntas del chat de Facturas.', 'Contestar una pregunta en el chat de Facturas'),
    ('chat-web',                       'Contesta a los clientes en el chat de la web.', 'Contestar una pregunta en el chat de la web'),
    ('traducir-contenido',             'Traduce los platos y textos de la carta a otros idiomas.', 'Traducir un plato'),
    ('extraer-vino-foto',              'Lee la etiqueta de la foto de un vino y busca sus datos.', 'Leer la etiqueta de un vino'),
    ('buscar-puntuacion-parker',       'Busca en internet la puntuación Parker de un vino.', 'Buscar la puntuación Parker de un vino'),
    ('recortar-foto',                  'Quita el fondo de las fotos de la carta, en nuestro servidor (Vercel), sin IA de pago.', 'Recortar una foto'),
    ('interpretar-reserva-manuscrita', 'Lee las reservas escritas a mano en la hoja del día.', 'Leer una reserva escrita a mano'),
    ('format-novedad',                 'Da formato a una novedad antes de publicarla.', 'Dar formato a una novedad'),
    ('instagram-ia',                   'Propone textos y rótulos para las publicaciones de Instagram.', 'Proponer los textos de una publicación'),
    ('rrss-ia',                        'Editor de redes sociales: plan de edición, textos e ideas para grabar.', 'Pedir una propuesta al editor de redes'),
    ('newsletter-ia',                  'Redacta la newsletter y propone cómo presentarla.', 'Redactar una newsletter'),
    ('resenas-contestador',            'Propone la respuesta a una reseña de Google en el tono de Casa Tomás.', 'Proponer la respuesta a una reseña'),
    ('procesar-logs-web',              'Analiza una incidencia de la web antes de abrir su aviso.', 'Analizar una incidencia de la web'),
    ('resumen-logs-web',               'Resume la actividad de la web del periodo.', 'Resumir la actividad de la web'),
    ('ia-modelos-openai',              'Prueba los modelos de IA (botón «Probar» de Servicios › Modelos).', 'Probar un modelo'),
    ('procesar-dibujo-perimetro',      'Leía un plano de sala dibujado a mano (ya no se usa).', null),
    ('buscar-precios-mercado',         'Precios de lonja con Perplexity (ya no se usa).', null)
  ) as v(funcion, que_hace, accion)
 where f.funcion = v.funcion
   and (f.que_hace is null or (f.accion is null and v.accion is not null));

-- ─── 3. Coste por uso de cada función de IA ─────────────────────────────────
create or replace function public.ia_coste_por_uso(p_desde date, p_hasta date)
returns table (
  funcion            text,
  que_hace           text,
  accion             text,
  unidad             text,
  orden              integer,
  llamadas           bigint,
  usos               bigint,
  usos_con_coste     bigint,
  coste_usd          numeric,
  filas_sin_tarifa   bigint,
  modelos_sin_tarifa text[],
  mediana_usd        numeric,
  media_usd          numeric,
  servidor_propio    boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with filas as (
    select u.id, u.funcion, u.modelo, u.llamadas, u.coste_usd, u.created_at,
           coalesce(nullif(split_part(coalesce(u.disparador, ''), '#', 1), ''), '-') as base
      from public.ia_uso u
     where (u.created_at at time zone 'Europe/Madrid')::date between p_desde and p_hasta
  ),
  con_previa as (
    select f.*,
           lag(f.created_at) over (partition by f.funcion, f.base order by f.created_at, f.id) as previa
      from filas f
  ),
  islas as (
    -- Un trabajo de OCR es un uso aunque sus piezas tarden minutos; el resto,
    -- un uso nuevo cada vez que pasan más de 5 s sin filas del mismo disparador.
    select c.*,
           sum(case when c.base like 'trabajo:%' then 0
                    when c.previa is null or c.created_at - c.previa > interval '5 seconds' then 1
                    else 0 end)
             over (partition by c.funcion, c.base order by c.created_at, c.id rows unbounded preceding) as isla
      from con_previa c
  ),
  usos_ia as (
    select i.funcion,
           sum(i.llamadas)::bigint                                  as llamadas,
           sum(i.coste_usd)                                         as coste,
           count(*) filter (where i.coste_usd is null)::bigint      as sin_tarifa,
           array_agg(distinct i.modelo) filter (where i.coste_usd is null) as modelos_sin,
           bool_and(i.modelo like 'vercel:%')                       as propio
      from islas i
     group by i.funcion, i.base, i.isla
  ),
  usos_web as (
    select 'chat-web'::text                                         as funcion,
           coalesce(c.llamadas_openai, 1)::bigint                   as llamadas,
           c.coste_usd                                              as coste,
           (case when c.coste_usd is null then 1 else 0 end)::bigint as sin_tarifa,
           case when c.coste_usd is null then array[coalesce(c.modelo, 'gpt-5.6-luna')] end as modelos_sin,
           false                                                    as propio
      from public.chat_web_uso c
     where c.estado in ('ok', 'error')
       and (c.created_at at time zone 'Europe/Madrid')::date between p_desde and p_hasta
  ),
  usos as (
    select * from usos_ia
    union all
    select * from usos_web
  ),
  por_funcion as (
    select u.funcion,
           sum(u.llamadas)::bigint                                              as llamadas,
           count(*)::bigint                                                     as usos,
           count(*) filter (where u.sin_tarifa = 0)::bigint                      as usos_con_coste,
           round(sum(u.coste), 6)                                               as coste_usd,
           sum(u.sin_tarifa)::bigint                                            as filas_sin_tarifa,
           (select array_agg(distinct m order by m) from usos x, unnest(x.modelos_sin) m where x.funcion = u.funcion) as modelos_sin_tarifa,
           round((percentile_cont(0.5) within group (order by u.coste) filter (where u.sin_tarifa = 0))::numeric, 6) as mediana_usd,
           round(avg(u.coste) filter (where u.sin_tarifa = 0), 6)               as media_usd,
           bool_and(u.propio)                                                   as servidor_propio
      from usos u
     group by u.funcion
  )
  select p.funcion,
         coalesce(f.que_hace, f.descripcion)  as que_hace,
         f.accion,
         coalesce(f.unidad, 'llamada')        as unidad,
         coalesce(f.orden, 999)               as orden,
         p.llamadas,
         p.usos,
         p.usos_con_coste,
         p.coste_usd,
         p.filas_sin_tarifa,
         coalesce(p.modelos_sin_tarifa, '{}'::text[]) as modelos_sin_tarifa,
         p.mediana_usd,
         p.media_usd,
         coalesce(p.servidor_propio, false)   as servidor_propio
    from por_funcion p
    left join public.ia_funciones f on f.funcion = p.funcion
   order by p.coste_usd desc nulls last, coalesce(f.orden, 999), p.funcion;
$$;

comment on function public.ia_coste_por_uso(date, date) is
  'IA función por función entre dos días (hora de Madrid): llamadas, usos (peticiones), coste conocido y mediana/media del coste de un uso. '
  'Un uso = las filas de un trabajo de OCR (trabajo:<id>) o las que una petición escribe seguidas (mismo disparador, < 5 s). '
  'chat-web sale de chat_web_uso. Las filas sin tarifa (coste NULL) no suman: filas_sin_tarifa y modelos_sin_tarifa avisan. Solo super admin (RLS).';

revoke all on function public.ia_coste_por_uso(date, date) from public, anon;
grant execute on function public.ia_coste_por_uso(date, date) to authenticated, service_role;

commit;
