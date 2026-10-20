-- ===========================================================================
-- ##                                                                       ##
-- ##                          SIN APLICAR                                  ##
-- ##                                                                       ##
-- ##   Escrita 2026-09-28. NO se ha aplicado ni en produccion ni en local  ##
-- ##   (Docker Desktop apagado en esta maquina: `supabase start` falla con  ##
-- ##   «failed to inspect docker image», igual que le paso a               ##
-- ##   20260928140000). Espera el OK del dueno.                            ##
-- ##                                                                       ##
-- ##   ANTES DE APLICARLA, leer el CHECKLIST del final. Dos cosas que NO   ##
-- ##   son opcionales:                                                     ##
-- ##     1. `ia_precios` se siembra con tarifas PUBLICAS sin verificar      ##
-- ##        contra la factura de OpenAI (verificado_en = NULL en 5 de 7).   ##
-- ##        Mientras sigan sin verificar, el coste que pinte la pantalla    ##
-- ##        es orientativo. La unica tarifa verificada contra el codigo es  ##
-- ##        la de gpt-5.6-luna (la tiene chat-web).                         ##
-- ##     2. Esta migracion NO instrumenta ninguna funcion. Crea la tuberia  ##
-- ##        (tabla + RPC de escritura) y el catalogo. Hasta que las Edge    ##
-- ##        Functions llamen a `ia_registrar_uso`, `ia_uso` queda VACIA y   ##
-- ##        la pantalla lo dice en voz alta via `ia_funciones_sin_registro`.##
-- ##                                                                       ##
-- ##   Rollback: supabase/rollbacks/20260928193000_costes_sistema_          ##
-- ##   ROLLBACK.sql, a mano.                                               ##
-- ##                                                                       ##
-- ===========================================================================
--
-- ENCARGO (dueno, 2026-09-28)
--
--   "un analisis de lo que puede costar las cosas en la parte de costes, si
--    hay en el super admin, y si no lo creamos, para ver los gastos posibles,
--    al igual que tenemos lo de las visitas para las paginas web"
--
--   Es decir: el equivalente de /super-admin/trafico-web pero para el GASTO.
--   El sistema se le va a vender a un restaurante, asi que saber lo que cuesta
--   mantenerlo cada mes es parte del producto, no un extra.
--
-- ---------------------------------------------------------------------------
-- POR QUE UNA PANTALLA NUEVA Y NO AMPLIAR `GestorGasto` -- COMPROBADO
-- ---------------------------------------------------------------------------
--
--   /super-admin/gestor-gasto ya existe, pero mide LO CONTRARIO. Se leyo su
--   codigo entero (src/pages/GestorGasto.tsx, 17 lineas, y
--   src/components/dashboard/widgets/GestorGasto.tsx, 136 lineas):
--
--     * Su subtitulo literal es "Previsualizacion de tu facturacion con
--       OficiososIA" y su CardTitle "Gestor de Gasto — OficiososIA".
--     * Su contenido es un array `conceptos` ESCRITO A MANO en el codigo:
--       Licencia Plan Pro 149 EUR, Modulo Chatbot IA 49, Procesamiento de
--       Facturas IA 29, Newsletter 19, Soporte Premium incluido = 246 EUR/mes.
--     * No lee ninguna tabla, ninguna RPC y ningun sistema de cobro.
--
--   Eso es el PRECIO DE VENTA (lo que OficiososIA le cobra al restaurante).
--   El encargo pide el COSTE (lo que el sistema le cuesta a quien lo mantiene).
--   Son las dos caras de la misma cuenta de resultados, y meterlas en la misma
--   pantalla invita exactamente a la confusion que docs/CREDENCIALES-Y-COSTES.md
--   ya documenta como problema real ("nadie tenia claro si le tocaba recargar
--   al proveedor o al restaurante — porque nunca se decidio").
--
--   DECISION: pantalla nueva /super-admin/costes, y en ella un KPI de MARGEN
--   que importa el total de `GestorGasto` en vez de repetir el 246 a mano. Asi
--   las dos pantallas quedan enganchadas sin mezclarse, y si manana cambia la
--   tarifa el margen se mueve solo.
--
--   Lo que NO hace esta migracion, a proposito: conectar `GestorGasto` a datos
--   reales. Es el punto 10 de las acciones de docs/CREDENCIALES-Y-COSTES.md y
--   es otro encargo (decidir modelo de cobro, no medir consumo).
--
-- ---------------------------------------------------------------------------
-- EL AGUJERO QUE SE TAPA
-- ---------------------------------------------------------------------------
--
--   De las 6 funciones de IA, SOLO chat-web registra su consumo (tabla
--   `chat_web_uso`, migracion 20260926121000). Verificado leyendo las 6:
--
--     funcion                     modelo(s)                          registra
--     --------------------------  ---------------------------------  --------
--     chat-web                    gpt-5.6-luna                       SI
--     chat-facturas               gpt-4.1-mini + emb-3-small         no
--     procesar-factura            gpt-5-mini + emb-3-small           no
--     procesar-dibujo-perimetro   gpt-5-mini                         no
--     traducir-contenido          gpt-4.1-mini                       no
--     format-novedad              gpt-4o-mini                        no
--
--   (Se comprobo tambien que NINGUNA de esas cinco tiene constantes de precio
--    en su codigo: `grep -rn "PRECIO" supabase/functions --include=index.ts`
--    solo da resultados en chat-web y en el PROMPT de procesar-factura, donde
--    "PRECIO" habla de los precios de la factura del proveedor, no de OpenAI.)
--
--   Consecuencia: hoy no se sabe cuantas llamadas hacen, ni cuantos tokens, ni
--   cuanto cuestan. Cinco sextos del gasto de IA es invisible.
--
-- ---------------------------------------------------------------------------
-- POR QUE LOS TOKENS DE RAZONAMIENTO VAN EN COLUMNA APARTE
-- ---------------------------------------------------------------------------
--
--   Dato medido el 2026-09-28 y que motiva la columna: leyendo la MISMA
--   factura, `gpt-5-mini` quema 3.060 tokens de salida y `gpt-5.4-mini` gasta
--   598, y la tarifa por token es la misma. Sin separar el razonamiento del
--   texto util, la fila solo dice "3.060 tokens de salida" y no se ve que 2.500
--   de ellos son el modelo pensando en voz baja. Con la columna aparte, la
--   pantalla puede decir "el 82 % de tu salida es razonamiento" — que es el
--   dato con el que se decide cambiar de modelo.
--
--   ############  EL DETALLE QUE SE PRESTA A DOBLE CONTEO  ############
--   En la API de OpenAI, `completion_tokens_details.reasoning_tokens` es un
--   SUBCONJUNTO de `completion_tokens`, NO un tercer cubo que se sume aparte.
--   Es decir: completion_tokens = texto_util + reasoning_tokens.
--   Por eso:
--     * `razonamiento_tokens` lleva CHECK (razonamiento_tokens <=
--       completion_tokens): si alguien algun dia suma mal, la fila no entra.
--     * El coste NO suma el razonamiento por separado. Se factura como output
--       y ya va dentro de completion_tokens. `ia_precios` lo deja escrito en
--       la columna `razonamiento_como_output` para no tener que recordarlo.
--   Si alguien "arregla" esto sumando razonamiento aparte, el coste de la
--   pantalla se infla en silencio. Es el fallo mas facil de cometer aqui.
--   ###################################################################
--
-- ---------------------------------------------------------------------------
-- POR QUE EL COSTE SE CALCULA EN SQL Y NO EN LA EDGE FUNCTION
-- ---------------------------------------------------------------------------
--
--   chat-web lo calcula en TypeScript (`costeUsd()` con la constante
--   `PRECIO_USD_POR_M`, supabase/functions/chat-web/index.ts:155-172) y manda
--   el USD ya hecho a `chat_web_cerrar_uso`. Aqui se hace al contrario: la
--   funcion manda TOKENS y `ia_registrar_uso` calcula el USD leyendo
--   `ia_precios`. Tres razones, por orden de peso:
--
--     1. Cambiar una tarifa es un UPDATE, no 6 redespliegues. Hoy hay 6
--        funciones; con el precio en el codigo, corregir una tarifa mal
--        apuntada obliga a tocar y desplegar todas las que usen ese modelo.
--     2. Permite RE-TARIFAR el historico. `ia_coste_alternativa()` coge los
--        tokens YA GUARDADOS y los pasa por la tarifa de otro modelo. Eso es
--        literalmente la pregunta del dueno (gpt-5-mini vs gpt-5.4-mini)
--        contestada con datos propios en vez de a ojo. Con el coste congelado
--        en la fila no se puede hacer.
--     3. Un modelo nuevo sin tarifa no pierde el dato: la fila entra con
--        `coste_usd = NULL` y `ia_coste_por_modelo` la marca
--        `tarifado = false`. NULL = "sin datos", nunca 0 — la regla de oro de
--        trafico-web (ver src/hooks/useTraficoWeb.ts, cabecera).
--
--   chat_web_uso NO se migra ni se toca. Sigue siendo la contabilidad de
--   chat-web, con sus topes de abuso colgando de ella
--   (`chat_web_reservar_cupo` la consulta en 5 sitios). Esta pantalla la LEE
--   como una fuente mas: ver `ia_uso_diario`, que hace UNION con ella para que
--   el total del mes incluya el chat de la web sin duplicarlo.
--
-- ---------------------------------------------------------------------------
-- POR QUE LOS COSTES FIJOS ENTRAN AQUI (y no en otro encargo)
-- ---------------------------------------------------------------------------
--
--   Porque sin ellos la pantalla contesta la pregunta equivocada por dos
--   ordenes de magnitud. Con lo medido el 2026-09-28, TODA la IA del sistema
--   ronda 1-2 USD/mes. Supabase, Vercel, Resend, VAPI y el dominio estan en
--   otra escala. Una pantalla que ensenara solo la IA le diria al dueno que el
--   sistema es practicamente gratis, que es justo lo contrario de lo que
--   necesita para ponerle precio.
--
--   docs/CREDENCIALES-Y-COSTES.md ya lo dice en su seccion "Donde no encaja":
--   VAPI y la infraestructura no tienen hoy NINGUN concepto que los cubra, y
--   son "justamente los dos costes variables o mas caros del conjunto".
--
--   Como no hay API que lea esas facturas (y no la va a haber: son 5 paneles
--   distintos), `costes_fijos` es DECLARATIVA y a mano. Para que se distinga
--   una cifra fresca de una adivinada, cada fila lleva `verificado_en` y
--   `eur_mes` es NULLABLE: NULL significa "no comprobado todavia" y la
--   pantalla lo pinta como "sin datos", nunca como 0. Las filas se siembran
--   con eur_mes = NULL a proposito — inventar 25 EUR de Supabase seria peor que
--   no poner nada, porque parece un dato.
--
-- ---------------------------------------------------------------------------
-- LO QUE ESTA MIGRACION NO HACE
-- ---------------------------------------------------------------------------
--
--   * NO toca `chat_web_uso`, ni `chat_web_config`, ni ninguna de sus RPC.
--   * NO instrumenta ninguna Edge Function (eso es codigo, no SQL), y en
--     concreto NO toca procesar-dibujo-perimetro, procesar-factura ni
--     traducir-contenido: hay otro agente en esos tres ficheros.
--   * NO crea ningun cron que llame a OpenAI ni a Vercel. Aqui no hay
--     sincronizacion: las funciones escriben en vivo. El unico cron es el de
--     retencion (ver bloque 9).
--   * NO toca el aforo, ni reservas, ni mesas, ni espacios_reserva.
--   * NO activa FORCE ROW LEVEL SECURITY en ninguna tabla.
--
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. ia_precios -- catalogo de tarifas, USD por 1M de tokens
-- ---------------------------------------------------------------------------
--    Es la fuente de verdad del coste. `ia_registrar_uso` la lee en cada
--    insercion. Un modelo que no este aqui NO impide registrar el uso: la fila
--    entra con coste_usd = NULL.
-- ---------------------------------------------------------------------------

create table if not exists public.ia_precios (
  modelo                   text          primary key
                             check (length(modelo) between 1 and 120),
  usd_por_m_input          numeric(12,6) not null check (usd_por_m_input >= 0),
  -- NULL = el modelo no tiene tarifa de cache (no es lo mismo que 0).
  usd_por_m_cached         numeric(12,6)          check (usd_por_m_cached >= 0),
  usd_por_m_cache_write    numeric(12,6)          check (usd_por_m_cache_write >= 0),
  usd_por_m_output         numeric(12,6) not null check (usd_por_m_output >= 0),
  -- Dejado explicito para que nadie sume el razonamiento aparte. Ver cabecera.
  razonamiento_como_output boolean       not null default true,
  notas                    text,
  fuente                   text,
  -- NULL = tarifa NO comprobada contra una factura real. La pantalla avisa.
  verificado_en            date,
  actualizado_en           timestamptz   not null default now()
);

comment on table public.ia_precios is
  'Tarifas por modelo en USD por 1M de tokens. Fuente de verdad del coste: la '
  'calcula ia_registrar_uso, no la Edge Function. verificado_en NULL = tarifa '
  'publica sin comprobar contra factura.';
comment on column public.ia_precios.razonamiento_como_output is
  'true = los reasoning_tokens se facturan a la tarifa de output y YA van '
  'dentro de completion_tokens (no se suman aparte). Ver cabecera del fichero.';
comment on column public.ia_precios.usd_por_m_cached is
  'NULL = el modelo no tiene tarifa de lectura de cache. NO es 0: si es NULL, '
  'los cached_tokens se cobran como input normal.';

-- ---------------------------------------------------------------------------
-- 2. ia_funciones -- que funciones hay y cual registra de verdad
-- ---------------------------------------------------------------------------
--    Este catalogo es lo que permite a la pantalla ADMITIR QUE LE FALTAN
--    DATOS. Es el equivalente de `trafico_web_sync_estado` en trafico-web: la
--    tabla contra la que se compara lo que hay con lo que deberia haber.
--    Sin el, una funcion sin instrumentar se leeria como "0 EUR de gasto".
-- ---------------------------------------------------------------------------

create table if not exists public.ia_funciones (
  funcion       text    primary key check (length(funcion) between 1 and 80),
  descripcion   text    not null,
  -- false = todavia NO llama a ia_registrar_uso. La pantalla lo dice en rojo.
  instrumentada boolean not null default false,
  unidad        text    not null default 'llamada',
  orden         integer not null default 100,
  activo        boolean not null default true
);

comment on table public.ia_funciones is
  'Catalogo de funciones de IA. instrumentada = false significa que la funcion '
  'todavia no registra su consumo, asi que su coste real NO aparece en ia_uso. '
  'La pantalla de costes usa esto para avisar de que esta infra-declarando.';

-- ---------------------------------------------------------------------------
-- 3. ia_uso -- una fila por llamada a un modelo
-- ---------------------------------------------------------------------------
--    Mismo patron que chat_web_uso (20260926121000) pero comun a todas las
--    funciones y con el razonamiento desglosado.
--
--    A DIFERENCIA de chat_web_uso, aqui NO hay estado 'reservado': ia_uso no
--    controla ningun tope de abuso, solo contabiliza. Se escribe UNA vez, al
--    final de la llamada, y si esa escritura falla la funcion sigue (ver
--    supabase/functions/_shared/registrar-uso-ia.ts). Consecuencia asumida:
--    una funcion que muere a mitad no deja fila, asi que ia_uso INFRA-declara
--    en caso de caida. Es lo contrario de chat_web_uso, que sobre-declara
--    (deja la fila en 'reservado' con coste 0). Se prefiere infra-declarar
--    porque aqui la fila no defiende ningun cupo: nadie se cuela por no tener
--    fila, solo se pierde un dato de coste.
-- ---------------------------------------------------------------------------

create table if not exists public.ia_uso (
  id                  bigint        generated always as identity primary key,
  funcion             text          not null check (length(funcion) between 1 and 80),
  -- chat | embedding | vision | otro. Sin FK: una funcion nueva debe poder
  -- registrar antes de que nadie se acuerde de darla de alta en ia_funciones.
  operacion           text          not null default 'chat'
                        check (operacion in ('chat','embedding','vision','otro')),
  modelo              text          not null check (length(modelo) between 1 and 120),
  prompt_tokens       integer       not null default 0 check (prompt_tokens >= 0),
  cached_tokens       integer       not null default 0 check (cached_tokens >= 0),
  cache_write_tokens  integer       not null default 0 check (cache_write_tokens >= 0),
  completion_tokens   integer       not null default 0 check (completion_tokens >= 0),
  -- SUBCONJUNTO de completion_tokens, no un cubo aparte. Ver cabecera.
  razonamiento_tokens integer       not null default 0 check (razonamiento_tokens >= 0),
  llamadas            integer       not null default 1 check (llamadas >= 0),
  -- NULL = el modelo no estaba en ia_precios al registrar. NUNCA 0 por defecto.
  coste_usd           numeric(12,6)          check (coste_usd >= 0),
  estado              text          not null default 'ok'
                        check (estado in ('ok','error')),
  -- Que disparo la llamada, en texto libre corto y SIN datos personales:
  -- 'factura:<uuid>', 'usuario:<uuid>', 'cron', 'carta:auto'. Se usa para
  -- poder rastrear un pico hasta su origen sin guardar contenido.
  disparador          text                   check (disparador is null or length(disparador) <= 200),
  duracion_ms         integer                check (duracion_ms >= 0),
  created_at          timestamptz   not null default now(),

  -- El CHECK que impide el doble conteo del razonamiento. Si esto salta, es
  -- que alguien esta sumando reasoning_tokens FUERA de completion_tokens.
  constraint ia_uso_razonamiento_cabe_en_completion
    check (razonamiento_tokens <= completion_tokens),
  -- Los cached y los cache_write salen de los prompt_tokens, igual que en la
  -- API. Si la suma se pasa, el coste saldria negativo en el greatest() de
  -- ia_registrar_uso y quedaria enmascarado: mejor rechazar la fila.
  constraint ia_uso_cache_cabe_en_prompt
    check (cached_tokens + cache_write_tokens <= prompt_tokens)
);

comment on table public.ia_uso is
  'Contabilidad por llamada de TODAS las funciones de IA (menos chat-web, que '
  'tiene la suya en chat_web_uso desde 20260926121000 y no se migra). El coste '
  'lo calcula ia_registrar_uso leyendo ia_precios; NULL = modelo sin tarifa.';
comment on column public.ia_uso.razonamiento_tokens is
  'SUBCONJUNTO de completion_tokens (asi lo devuelve la API en '
  'completion_tokens_details.reasoning_tokens). NO se suma aparte al calcular '
  'el coste: ya se factura como output. Hay un CHECK que lo garantiza.';
comment on column public.ia_uso.disparador is
  'Origen de la llamada en texto corto y sin datos personales. Para rastrear '
  'un pico de gasto hasta el registro que lo causo.';

create index if not exists idx_ia_uso_creado
  on public.ia_uso (created_at desc);
create index if not exists idx_ia_uso_funcion_creado
  on public.ia_uso (funcion, created_at desc);
create index if not exists idx_ia_uso_modelo_creado
  on public.ia_uso (modelo, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. costes_fijos -- el gasto que NO es IA, declarado a mano
-- ---------------------------------------------------------------------------

create table if not exists public.costes_fijos (
  id             uuid          primary key default gen_random_uuid(),
  concepto       text          not null check (length(concepto) between 1 and 120),
  proveedor      text          not null check (length(proveedor) between 1 and 80),
  categoria      text          not null
                   check (categoria in ('infraestructura','email','telefonia',
                                        'dominio','ia_plataforma','otros')),
  -- NULL = NO comprobado todavia. La pantalla lo pinta "sin datos", no 0.
  eur_mes        numeric(10,2)          check (eur_mes >= 0),
  -- 'fijo' = la cuota no se mueve con el uso. 'variable' = si (VAPI por
  -- minuto, Supabase/Vercel al pasar de plan). Esta distincion es la que el
  -- dueno necesita para decirle al restaurante "esto son X al mes, mas Y si
  -- creces": sin ella el total es un numero sin contrato detras.
  naturaleza     text          not null check (naturaleza in ('fijo','variable')),
  notas          text,
  verificado_en  date,
  activo         boolean       not null default true,
  orden          integer       not null default 100,
  creado_en      timestamptz   not null default now(),
  actualizado_en timestamptz   not null default now()
);

comment on table public.costes_fijos is
  'Coste mensual que no es IA (Supabase, Vercel, Resend, VAPI, dominio). '
  'DECLARATIVA y a mano: no hay API que lea esas facturas. eur_mes NULL = sin '
  'comprobar; verificado_en dice de cuando es la cifra.';
comment on column public.costes_fijos.eur_mes is
  'NULL significa "no comprobado", NO "gratis". Inventar una cifra es peor que '
  'dejarla vacia porque parece un dato.';

create index if not exists idx_costes_fijos_activo_orden
  on public.costes_fijos (activo, orden);

-- ---------------------------------------------------------------------------
-- 5. ia_coste_estimado -- la estimacion medida a mano, para el dia 1
-- ---------------------------------------------------------------------------
--    `ia_uso` arranca vacia. Sin esto, la pantalla nace inutil y el dueno no
--    puede poner precio hasta que pase un mes. Estas cifras se midieron el
--    2026-09-28 llamando a cada funcion y leyendo el `usage` de la respuesta.
--
--    Es ESTIMACION, no gasto real, y la pantalla lo marca. El volumen mensual
--    es una HIPOTESIS editable (20 preguntas/dia, etc.): cambiarla es como se
--    contesta "cuanto le costara al restaurante si usa mas el chatbot".
-- ---------------------------------------------------------------------------

create table if not exists public.ia_coste_estimado (
  funcion                text          primary key check (length(funcion) between 1 and 80),
  unidad                 text          not null default 'llamada',
  usd_por_unidad         numeric(12,6) not null check (usd_por_unidad >= 0),
  unidades_mes_estimadas numeric(10,2) not null check (unidades_mes_estimadas >= 0),
  modelo                 text,
  medido_en              date,
  nota                   text
);

comment on table public.ia_coste_estimado is
  'Coste por unidad MEDIDO a mano el 2026-09-28, con una hipotesis de volumen '
  'mensual editable. Sirve para que la pantalla valga desde el primer dia con '
  'ia_uso vacia. Es estimacion, y la pantalla la marca como tal.';

commit;

-- ===========================================================================
-- 6. SIEMBRA
--    Fuera de la transaccion anterior para que un fallo de datos no tire el
--    esquema. Todo idempotente (on conflict do nothing / do update).
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 6a. Tarifas
--
--     ############  AVISO: 5 de 7 SIN VERIFICAR  ############
--     Solo `gpt-5.6-luna` esta verificada contra el codigo del proyecto
--     (supabase/functions/chat-web/index.ts:155 la tiene escrita, con la URL
--     de la doc que se consulto el 2026-09-26), y `text-embedding-3-small`
--     se deja tambien como verificada porque su tarifa aparece en la misma
--     tanda. Las otras cinco son tarifas PUBLICAS de catalogo apuntadas de
--     memoria al escribir esta migracion: NO se han comprobado contra una
--     factura real ni contra la doc, y por eso van con verificado_en = NULL.
--
--     Mientras sigan en NULL, la pantalla avisa y el coste es orientativo.
--     Comprobarlas es el paso 2 del CHECKLIST del final: son 5 numeros y se
--     leen en platform.openai.com/docs/pricing en dos minutos.
--     #######################################################
-- ---------------------------------------------------------------------------

insert into public.ia_precios
  (modelo, usd_por_m_input, usd_por_m_cached, usd_por_m_cache_write,
   usd_por_m_output, notas, fuente, verificado_en)
values
  -- La unica verificada contra el propio codigo del proyecto.
  ('gpt-5.6-luna', 0.200000, 0.020000, 0.250000, 1.200000,
   'La usa chat-web. cache_write = input x 1.25 segun la guia de prompt caching.',
   'supabase/functions/chat-web/index.ts:155 (doc consultada 2026-09-26)',
   date '2026-09-26'),

  ('text-embedding-3-small', 0.020000, null, null, 0.000000,
   'Solo input: un embedding no genera tokens de salida. La usan chat-facturas y procesar-factura.',
   'Tarifa publica de catalogo', date '2026-09-26'),

  -- ---- SIN VERIFICAR (verificado_en = NULL) --------------------------------
  ('gpt-4.1-mini', 0.400000, 0.100000, null, 1.600000,
   'La usan chat-facturas y traducir-contenido.',
   'Tarifa publica de catalogo, PENDIENTE de verificar contra factura', null),

  ('gpt-4o-mini', 0.150000, 0.075000, null, 0.600000,
   'La usa format-novedad.',
   'Tarifa publica de catalogo, PENDIENTE de verificar contra factura', null),

  ('gpt-5-mini', 0.250000, 0.025000, null, 2.000000,
   'La usan procesar-factura y procesar-dibujo-perimetro. Es el modelo que '
   'quema 3.060 tokens de salida leyendo una factura (medido 2026-09-28).',
   'Tarifa publica de catalogo, PENDIENTE de verificar contra factura', null),

  ('gpt-5.4-mini', 0.250000, 0.025000, null, 2.000000,
   'Candidato a sustituir a gpt-5-mini: misma tarifa y 598 tokens de salida en '
   'vez de 3.060 en la misma factura (medido 2026-09-28). Se da de alta AUNQUE '
   'todavia no se use, para que ia_coste_alternativa() pueda re-tarifar el '
   'historico contra el y ensenar el ahorro con datos propios.',
   'Tarifa publica de catalogo, PENDIENTE de verificar contra factura', null),

  ('sonar', 1.000000, null, null, 1.000000,
   'Perplexity, la usa buscar-precios-mercado. OJO: Perplexity cobra ADEMAS '
   'por busqueda ($5/1000 peticiones aprox), que esto NO recoge — el coste que '
   'salga de aqui para `sonar` esta infra-declarado. Segun '
   'docs/CREDENCIALES-Y-COSTES.md esa funcion no la llama ninguna pantalla, '
   'asi que hoy deberia registrar 0 llamadas; si registra alguna, es que algo '
   'la esta llamando y conviene averiguar que.',
   'Tarifa publica de catalogo, PENDIENTE de verificar contra factura', null)
on conflict (modelo) do nothing;

-- ---------------------------------------------------------------------------
-- 6b. Catalogo de funciones
--
--     `instrumentada` refleja la REALIDAD DEL CODIGO en el momento de escribir
--     esto, no la intencion. Las tres en false por encargo ajeno
--     (procesar-dibujo-perimetro, procesar-factura, traducir-contenido) NO se
--     pueden tocar ahora: hay otro agente en esos ficheros. Su guia de
--     enganche esta en supabase/functions/_shared/ENGANCHE-REGISTRO-IA.md.
--
--     QUIEN PONE ESTO A true: el que despliegue la funcion instrumentada, en
--     el mismo momento. Si se pone a true antes, la pantalla deja de avisar de
--     un agujero que sigue abierto — que es peor que no avisar nunca.
-- ---------------------------------------------------------------------------

insert into public.ia_funciones (funcion, descripcion, instrumentada, unidad, orden)
values
  ('chat-web', 'Chatbot de la web publica. Tiene su propia contabilidad en chat_web_uso desde 20260926121000; ia_uso_diario la lee de alli. Hasta 3 llamadas por pregunta (loop de tools).', true, 'pregunta', 10),
  ('procesar-factura', 'OCR de una factura o albaran: extrae lineas, importes y proveedor. LA MAS CARA: hasta 2 llamadas de vision (max_completion_tokens 16000, y el reintento reenvia la imagen entera) mas 2 de embeddings por documento.', false, 'documento', 20),
  ('chat-facturas', 'Chatbot contable sobre las facturas. Hasta 6 llamadas de chat por pregunta (MAX_PASOS=6) mas una de embeddings por consulta distinta.', false, 'pregunta', 30),
  ('traducir-contenido', 'Traduce platos y contenido de la carta. En modo bulk hace UNA llamada POR FILA, asi que una traduccion masiva son cientos de llamadas en rafaga.', false, 'plato', 40),
  ('format-novedad', 'Da formato a una novedad antes de publicarla. Una sola llamada.', false, 'llamada', 50),
  -- Las dos siguientes NO LAS LLAMA NADIE (verificado 2026-09-28: 0 resultados
  -- de functions.invoke en los 4 repos). Se dan de alta a proposito: si algun
  -- dia aparecen llamadas aqui, es que algo las esta llamando y hay que
  -- averiguar que. Es el uso mas barato de este catalogo: detectar gasto que
  -- nadie sabia que existia.
  ('procesar-dibujo-perimetro', 'Lee un plano de sala dibujado a mano y saca el perimetro. HUERFANA: su cabecera apunta a EditorPlanoArquitectonico.tsx, que YA NO EXISTE (el editor vivo es EditorPlanoEspacio.tsx / CanvasPlano.tsx) y no hay ni un functions.invoke que la llame. Instrumentarla es trabajo perdido mientras siga asi; lo que hay que decidir es si se borra.', false, 'llamada', 60),
  ('buscar-precios-mercado', 'Precios de lonja via Perplexity (modelo sonar). HUERFANA: ninguna pantalla la llama, como ya apuntaba docs/CREDENCIALES-Y-COSTES.md. Si aqui aparecen llamadas, hay que averiguar quien la llama.', false, 'consulta', 70)
on conflict (funcion) do update
  set descripcion = excluded.descripcion,
      unidad      = excluded.unidad,
      orden       = excluded.orden;
      -- `instrumentada` NO se sobrescribe a proposito: si alguien ya la puso a
      -- true porque desplego la funcion, re-aplicar la migracion no debe
      -- devolverla a false y volver a mentir.

-- ---------------------------------------------------------------------------
-- 6c. Estimacion medida el 2026-09-28
--
--     Las columnas `usd_por_unidad` son MEDIDAS (se llamo a la funcion y se
--     leyo el usage). Las `unidades_mes_estimadas` son HIPOTESIS: el dueno las
--     cambia y el total se mueve. Se apunta de donde sale cada hipotesis.
-- ---------------------------------------------------------------------------

insert into public.ia_coste_estimado
  (funcion, unidad, usd_por_unidad, unidades_mes_estimadas, modelo, medido_en, nota)
values
  ('chat-facturas', 'pregunta', 0.001600, 600, 'gpt-4.1-mini', date '2026-09-28',
   'Hipotesis: 20 preguntas/dia x 30 dias = 600/mes -> 0,96 USD/mes.'),
  ('procesar-factura', 'documento', 0.007500, 100, 'gpt-5-mini', date '2026-09-28',
   'Hipotesis: 100 documentos/mes. Es el concepto mas sensible al modelo: con '
   'gpt-5.4-mini el mismo documento deberia bajar mucho (598 vs 3.060 tokens '
   'de salida, misma tarifa).'),
  ('procesar-dibujo-perimetro', 'llamada', 0.005000, 0, 'gpt-5-mini', date '2026-09-28',
   'Volumen 0 A PROPOSITO: el coste por llamada esta medido (0,005 USD), pero '
   'NO LA LLAMA NADIE (verificado 2026-09-28: su cabecera apunta a un fichero '
   'que ya no existe y no hay ni un functions.invoke). Poner 4/mes seria meter '
   'en el total un gasto que no se produce. Si se vuelve a conectar, cambiar '
   'unidades_mes_estimadas y ya esta.'),
  ('traducir-contenido', 'plato', 0.000270, 40, 'gpt-4.1-mini', date '2026-09-28',
   'Medido: 0,00027 USD/plato. El catalogo COMPLETO son 403 filas = 0,11 USD '
   'de una vez. La hipotesis de 40/mes son los cambios de carta, no el '
   'catalogo entero: retraducirlo todo cuesta 0,11 USD y se hace una vez.'),
  ('format-novedad', 'llamada', 0.000150, 20, 'gpt-4o-mini', date '2026-09-28',
   'Hipotesis: 20 novedades/mes.')
on conflict (funcion) do nothing;

-- ---------------------------------------------------------------------------
-- 6d. Costes fijos -- SE SIEMBRAN SIN IMPORTE, A PROPOSITO
--
--     Los importes van a NULL porque NINGUNO esta verificado:
--     docs/CREDENCIALES-Y-COSTES.md repite "no verificable desde el codigo"
--     en Supabase, Vercel, Resend y VAPI. Poner 25 EUR de Supabase seria
--     inventarse la cifra que el dueno va a usar para poner precio.
--
--     `naturaleza` si esta decidida, y esa si se puede afirmar: VAPI es por
--     minuto (variable), el dominio es anual (fijo), etc.
-- ---------------------------------------------------------------------------

insert into public.costes_fijos
  (concepto, proveedor, categoria, eur_mes, naturaleza, notas, verificado_en, orden)
select * from (values
  ('Base de datos, auth y ~30 Edge Functions', 'Supabase', 'infraestructura', null::numeric, 'variable',
   'Proyecto principal (jeamoczmbfsnwkfjxcyo). Comprobar en supabase.com -> Settings -> Billing. Free tier o Pro segun uso: al pasar de limites salta de golpe, por eso variable.', null::date, 10),
  ('Proyecto de metricas', 'Supabase', 'infraestructura', null, 'variable',
   'Segundo proyecto, solo estadisticas de trafico y panel. Puede estar en free tier.', null, 20),
  ('Alojamiento de las 4 webs/apps', 'Vercel', 'infraestructura', null, 'variable',
   'Plan Hobby hoy (limite de 100 GB de Fast Data Transfer: lo vigila /super-admin/trafico-web). Al pasarlo, salta a Pro y deja de ser 0.', null, 30),
  ('Envio de correos de reserva y newsletter', 'Resend', 'email', null, 'variable',
   'Free tier por volumen. Hoy manda desde onboarding@resend.dev por no haber dominio verificado.', null, 40),
  ('Bot de voz que contesta el telefono', 'VAPI', 'telefonia', null, 'variable',
   'COSTE POR MINUTO DE LLAMADA: probablemente el mas alto del conjunto y el mas dificil de acotar. No aparece en el Gestor de Gasto. Mirar el dashboard de VAPI.', null, 50),
  ('Dominio propio del restaurante', 'Registrador por decidir', 'dominio', null, 'fijo',
   'NO EXISTE TODAVIA: ninguna de las 4 webs tiene dominio propio conectado (verificado en Vercel el 2026-09-25). Se deja la fila para que el coste este contemplado cuando se compre, y para que se vea que falta.', null, 60),
  ('Saldo de la cuenta de IA', 'OpenAI', 'ia_plataforma', null, 'variable',
   'NO SUMAR con el coste de IA de esta pantalla: seria contarlo dos veces. Esta fila existe para dejar constancia de que la cuenta es unica y compartida por las 6 funciones, y de que se quedo a 0 (ver docs/CREDENCIALES-Y-COSTES.md). Dejar eur_mes en NULL siempre; el importe real de IA es el que calcula ia_uso.', null, 70),
  ('Servidor de automatizaciones', 'n8n (cuenta personal)', 'otros', null, 'variable',
   'RIESGO, no solo coste: hoy es un servidor PERSONAL de un desarrollador (n8npersonal.miguelbenito.space) y de el dependen la traduccion de la carta y de las novedades. Si se apaga, se rompen sin aviso.', null, 80)
) as v(concepto, proveedor, categoria, eur_mes, naturaleza, notas, verificado_en, orden)
where not exists (
  select 1 from public.costes_fijos c
  where c.concepto = v.concepto and c.proveedor = v.proveedor
);

commit;

-- ===========================================================================
-- 7. RLS Y PRIVILEGIOS
--    Esta pantalla es de SUPER ADMIN, no por seccion: son las cuentas y las
--    facturas del proveedor, no la operacion del restaurante. Mismo criterio
--    y misma forma que chat_web_uso (20260926121000), que ya usa
--    is_super_admin. NO se usa can_read_section: no hay seccion `costes` en
--    src/hooks/useUserRole.tsx (las vivas son dashboard, reservas,
--    gestor_carta, gestion_web, marketing, facturas, usuarios) y crear una
--    nueva solo para esto obligaria a repartirla a mano a cada usuario.
--
--    OJO CON EL OR: las politicas PERMISSIVE se combinan con OR. Estas tablas
--    son nuevas, asi que no hay ninguna politica vieja que las abra — pero si
--    alguien anade luego una con `using (true)`, todo esto deja de valer.
-- ===========================================================================

begin;

alter table public.ia_precios        enable row level security;
alter table public.ia_funciones      enable row level security;
alter table public.ia_uso            enable row level security;
alter table public.costes_fijos      enable row level security;
alter table public.ia_coste_estimado enable row level security;

-- ---------------------------------------------------------------------------
-- 7a. Privilegios de tabla. `revoke all ... from anon` primero: estas tablas
--     no las lee ninguna web publica, y el GRANT que no se revoca se queda
--     esperando a la proxima politica descuidada (la leccion de
--     20260928120000).
-- ---------------------------------------------------------------------------

revoke all on public.ia_precios        from anon, authenticated;
revoke all on public.ia_funciones      from anon, authenticated;
revoke all on public.ia_uso            from anon, authenticated;
revoke all on public.costes_fijos      from anon, authenticated;
revoke all on public.ia_coste_estimado from anon, authenticated;

-- Lectura para authenticated (la RLS de abajo la reduce a super admins).
grant select on public.ia_precios        to authenticated;
grant select on public.ia_funciones      to authenticated;
grant select on public.ia_uso            to authenticated;
grant select on public.ia_coste_estimado to authenticated;

-- `costes_fijos` es la unica que se edita desde la pantalla: es la que se
-- rellena a mano. Las demas se tocan por SQL o por la Edge Function.
grant select, insert, update, delete on public.costes_fijos to authenticated;

grant all on public.ia_precios        to service_role;
grant all on public.ia_funciones      to service_role;
grant all on public.ia_uso            to service_role;
grant all on public.costes_fijos      to service_role;
grant all on public.ia_coste_estimado to service_role;

-- ---------------------------------------------------------------------------
-- 7b. EL AGUJERO QUE LA RLS NO TAPA: TRUNCATE.
--     TRUNCATE NO pasa por las politicas. Sin este revoke, cualquier
--     autenticado podria vaciar `ia_uso` de golpe y todo lo de arriba seria
--     decorativo. El `revoke all` de 7a ya lo quita; se repite explicito
--     porque es el fallo que se colo en `mesas` y en `reservas`, y porque un
--     `grant` posterior escrito sin pensar lo devuelve sin que nadie lo note.
-- ---------------------------------------------------------------------------

revoke truncate on public.ia_precios        from authenticated;
revoke truncate on public.ia_funciones      from authenticated;
revoke truncate on public.ia_uso            from authenticated;
revoke truncate on public.costes_fijos      from authenticated;
revoke truncate on public.ia_coste_estimado from authenticated;

-- ---------------------------------------------------------------------------
-- 7c. Politicas
-- ---------------------------------------------------------------------------

-- ia_precios
drop policy if exists ia_precios_select_super_admin on public.ia_precios;
create policy ia_precios_select_super_admin
  on public.ia_precios for select to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) );

drop policy if exists ia_precios_service_role on public.ia_precios;
create policy ia_precios_service_role
  on public.ia_precios for all to service_role
  using (true) with check (true);

-- ia_funciones
drop policy if exists ia_funciones_select_super_admin on public.ia_funciones;
create policy ia_funciones_select_super_admin
  on public.ia_funciones for select to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) );

drop policy if exists ia_funciones_service_role on public.ia_funciones;
create policy ia_funciones_service_role
  on public.ia_funciones for all to service_role
  using (true) with check (true);

-- ia_uso. Solo SELECT para authenticated: quien escribe es la Edge Function
-- via ia_registrar_uso (SECURITY DEFINER, EXECUTE solo a service_role).
drop policy if exists ia_uso_select_super_admin on public.ia_uso;
create policy ia_uso_select_super_admin
  on public.ia_uso for select to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) );

drop policy if exists ia_uso_service_role on public.ia_uso;
create policy ia_uso_service_role
  on public.ia_uso for all to service_role
  using (true) with check (true);

-- costes_fijos: lectura Y escritura para super admin (es la tabla a mano).
drop policy if exists costes_fijos_select_super_admin on public.costes_fijos;
create policy costes_fijos_select_super_admin
  on public.costes_fijos for select to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) );

drop policy if exists costes_fijos_insert_super_admin on public.costes_fijos;
create policy costes_fijos_insert_super_admin
  on public.costes_fijos for insert to authenticated
  with check ( (select public.is_super_admin((select auth.uid()))) );

drop policy if exists costes_fijos_update_super_admin on public.costes_fijos;
create policy costes_fijos_update_super_admin
  on public.costes_fijos for update to authenticated
  using      ( (select public.is_super_admin((select auth.uid()))) )
  with check ( (select public.is_super_admin((select auth.uid()))) );

drop policy if exists costes_fijos_delete_super_admin on public.costes_fijos;
create policy costes_fijos_delete_super_admin
  on public.costes_fijos for delete to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) );

drop policy if exists costes_fijos_service_role on public.costes_fijos;
create policy costes_fijos_service_role
  on public.costes_fijos for all to service_role
  using (true) with check (true);

-- ia_coste_estimado
drop policy if exists ia_coste_estimado_select_super_admin on public.ia_coste_estimado;
create policy ia_coste_estimado_select_super_admin
  on public.ia_coste_estimado for select to authenticated
  using ( (select public.is_super_admin((select auth.uid()))) );

drop policy if exists ia_coste_estimado_service_role on public.ia_coste_estimado;
create policy ia_coste_estimado_service_role
  on public.ia_coste_estimado for all to service_role
  using (true) with check (true);

-- Trigger de actualizado_en en costes_fijos. `update_updated_at_column` ya
-- existe en el proyecto pero escribe en `updated_at`, y aqui la columna se
-- llama `actualizado_en` (como en peso_paginas / ia_precios), asi que se
-- necesita una propia. search_path fijado: lo exige 20260922200000.
create or replace function public.costes_fijos_marcar_actualizado()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;

drop trigger if exists trg_costes_fijos_actualizado on public.costes_fijos;
create trigger trg_costes_fijos_actualizado
  before update on public.costes_fijos
  for each row execute function public.costes_fijos_marcar_actualizado();

commit;

-- ===========================================================================
-- 8. VISTA Y RPC
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 8a. ia_uso_diario -- agregado por dia natural de Madrid, funcion y modelo.
--
--     UNION ALL con chat_web_uso: chat-web ya tiene su contabilidad y NO se
--     migra (sus topes de abuso dependen de esa tabla). Sin el UNION, el total
--     del mes dejaria fuera el chatbot de la web, que hoy es el unico que si
--     mide. Ojo: de chat_web_uso se cogen solo las filas 'ok'/'error' (las
--     'reservado' se quedaron a medias y su coste es 0 falso, y las
--     'rechazado' no llamaron a OpenAI). Ahi no hay razonamiento porque
--     chat-web fuerza reasoning_effort "none".
--
--     security_invoker: aplica la RLS de las tablas de abajo, asi que solo un
--     super admin ve filas. Igual que chat_web_uso_diario.
-- ---------------------------------------------------------------------------

create or replace view public.ia_uso_diario
with (security_invoker = true) as
select
  (u.created_at at time zone 'Europe/Madrid')::date            as dia,
  u.funcion                                                    as funcion,
  u.modelo                                                     as modelo,
  coalesce(sum(u.llamadas), 0)::bigint                         as llamadas,
  count(*)::bigint                                             as peticiones,
  count(*) filter (where u.estado = 'error')::bigint            as errores,
  coalesce(sum(u.prompt_tokens), 0)::bigint                    as prompt_tokens,
  coalesce(sum(u.cached_tokens), 0)::bigint                    as cached_tokens,
  coalesce(sum(u.completion_tokens), 0)::bigint                as completion_tokens,
  coalesce(sum(u.razonamiento_tokens), 0)::bigint              as razonamiento_tokens,
  -- sum() de numeric devuelve NULL si TODAS son NULL: se conserva a proposito
  -- (modelo sin tarifa -> "sin datos", no 0). No se envuelve en coalesce.
  sum(u.coste_usd)::numeric                                    as coste_usd
from public.ia_uso u
group by 1, 2, 3
union all
select
  (c.created_at at time zone 'Europe/Madrid')::date            as dia,
  'chat-web'::text                                             as funcion,
  coalesce(c.modelo, 'gpt-5.6-luna')                           as modelo,
  coalesce(sum(c.llamadas_openai), 0)::bigint                  as llamadas,
  count(*)::bigint                                             as peticiones,
  count(*) filter (where c.estado = 'error')::bigint            as errores,
  coalesce(sum(c.prompt_tokens), 0)::bigint                    as prompt_tokens,
  coalesce(sum(c.cached_tokens), 0)::bigint                    as cached_tokens,
  coalesce(sum(c.completion_tokens), 0)::bigint                as completion_tokens,
  -- chat-web va con reasoning_effort "none": no hay razonamiento que facturar.
  0::bigint                                                    as razonamiento_tokens,
  sum(c.coste_usd)::numeric                                    as coste_usd
from public.chat_web_uso c
where c.estado in ('ok','error')
group by 1, 2, 3;

comment on view public.ia_uso_diario is
  'Consumo diario de IA por funcion y modelo. UNION de ia_uso y chat_web_uso: '
  'chat-web tiene su propia contabilidad desde 20260926121000 y no se migra '
  'porque sus topes de abuso dependen de ella. De chat_web_uso solo entran las '
  'filas ok/error (reservado tiene coste 0 falso; rechazado no llamo a OpenAI).';

revoke all on public.ia_uso_diario from anon, authenticated;
grant select on public.ia_uso_diario to authenticated;

-- ---------------------------------------------------------------------------
-- 8b. ia_registrar_uso -- LA UNICA puerta de escritura
--
--     SECURITY DEFINER y EXECUTE SOLO a service_role: la escribe la Edge
--     Function con la service key, nunca el navegador.
--
--     Calcula el coste leyendo ia_precios. Si el modelo no esta, devuelve la
--     fila con coste_usd = NULL en vez de fallar: perder el coste es malo,
--     perder tambien el recuento de tokens es peor.
--
--     Devuelve la fila insertada para que la funcion pueda loguear el USD en
--     su consola, como ya hace chat-web.
-- ---------------------------------------------------------------------------

create or replace function public.ia_registrar_uso(
  p_funcion             text,
  p_modelo              text,
  p_prompt_tokens       integer default 0,
  p_completion_tokens   integer default 0,
  p_razonamiento_tokens integer default 0,
  p_cached_tokens       integer default 0,
  p_cache_write_tokens  integer default 0,
  p_llamadas            integer default 1,
  p_operacion           text    default 'chat',
  p_estado              text    default 'ok',
  p_disparador          text    default null,
  p_duracion_ms         integer default null
)
returns table (
  id        bigint,
  coste_usd numeric,
  tarifado  boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prompt      integer := greatest(coalesce(p_prompt_tokens, 0), 0);
  v_completion  integer := greatest(coalesce(p_completion_tokens, 0), 0);
  v_razon       integer := greatest(coalesce(p_razonamiento_tokens, 0), 0);
  v_cached      integer := greatest(coalesce(p_cached_tokens, 0), 0);
  v_cache_w     integer := greatest(coalesce(p_cache_write_tokens, 0), 0);
  v_precio      public.ia_precios;
  v_coste       numeric(12,6);
  v_input_neto  integer;
  v_id          bigint;
begin
  -- Se NORMALIZA en vez de rechazar. Esta funcion la llama codigo de
  -- contabilidad en un bloque que nunca debe romper la funcion de negocio: si
  -- el `usage` de OpenAI viene raro, es mejor guardar una fila con numeros
  -- saneados que no guardar nada. Los CHECK de la tabla son la red de
  -- seguridad, no el sitio donde se valida.
  if v_razon > v_completion then
    v_razon := v_completion;
  end if;
  if v_cached + v_cache_w > v_prompt then
    -- Se recortan proporcionalmente por el lado del cache, que es el dato
    -- menos fiable (la API no siempre lo devuelve con el mismo nombre).
    v_cached  := least(v_cached, v_prompt);
    v_cache_w := least(v_cache_w, v_prompt - v_cached);
  end if;

  select * into v_precio from public.ia_precios p where p.modelo = p_modelo;

  if found then
    -- Los cached y los cache_write SALEN de los prompt_tokens: el input que se
    -- cobra a tarifa plena es el resto. Misma cuenta que costeUsd() de
    -- chat-web (index.ts:165), para que las dos den lo mismo.
    v_input_neto := greatest(v_prompt - v_cached - v_cache_w, 0);
    v_coste := (
        v_input_neto * v_precio.usd_por_m_input
      -- Si el modelo no declara tarifa de cache, los cached se cobran como
      -- input normal. NO se cobran a 0: eso seria regalar tokens que OpenAI
      -- factura.
      + v_cached    * coalesce(v_precio.usd_por_m_cached, v_precio.usd_por_m_input)
      + v_cache_w   * coalesce(v_precio.usd_por_m_cache_write, v_precio.usd_por_m_input)
      -- completion_tokens YA INCLUYE el razonamiento. NO se suma v_razon.
      + v_completion * v_precio.usd_por_m_output
    ) / 1000000.0;
    v_coste := round(v_coste, 6);
  else
    v_coste := null;  -- modelo sin tarifa: "sin datos", no 0.
  end if;

  insert into public.ia_uso (
    funcion, operacion, modelo,
    prompt_tokens, cached_tokens, cache_write_tokens,
    completion_tokens, razonamiento_tokens,
    llamadas, coste_usd, estado, disparador, duracion_ms
  ) values (
    p_funcion,
    coalesce(nullif(p_operacion, ''), 'chat'),
    p_modelo,
    v_prompt, v_cached, v_cache_w,
    v_completion, v_razon,
    greatest(coalesce(p_llamadas, 1), 0),
    v_coste,
    coalesce(nullif(p_estado, ''), 'ok'),
    left(nullif(p_disparador, ''), 200),
    p_duracion_ms
  )
  -- Se cualifica con el nombre de la tabla A PROPOSITO: la funcion declara una
  -- columna de salida llamada `id`, asi que un `returning id` seria ambiguo y
  -- plpgsql lo rechaza en tiempo de ejecucion. El schema (`public.`) NO se
  -- puede poner aqui: en RETURNING solo vale el nombre de la relacion.
  returning ia_uso.id into v_id;

  return query select v_id, v_coste, (v_coste is not null);
end;
$$;

comment on function public.ia_registrar_uso(text,text,integer,integer,integer,integer,integer,integer,text,text,text,integer) is
  'Registra una llamada a un modelo y calcula su coste con ia_precios. '
  'SECURITY DEFINER, EXECUTE solo service_role. NO suma razonamiento aparte: '
  'ya va dentro de completion_tokens. Modelo sin tarifa -> coste_usd NULL.';

revoke all on function public.ia_registrar_uso(text,text,integer,integer,integer,integer,integer,integer,text,text,text,integer) from public, anon, authenticated;
grant execute on function public.ia_registrar_uso(text,text,integer,integer,integer,integer,integer,integer,text,text,text,integer) to service_role;

-- ---------------------------------------------------------------------------
-- 8c. ia_coste_serie -- serie diaria con medias, desviacion y anomalias
--
--     Mismo contrato de forma que trafico_web_serie (20260923200000): se
--     rellena el calendario completo con generate_series para que un dia sin
--     llamadas exista en el resultado. AQUI, a diferencia de trafico web, un
--     dia sin filas es CERO GASTO DE VERDAD (nadie llamo), no un hueco de
--     sincronizacion: no hay nada que sincronizar. Por eso el coste de un dia
--     vacio es 0 y no NULL — es el unico sitio de este fichero donde 0 y NULL
--     no significan lo mismo que en trafico-web, y es a proposito.
--
--     La anomalia se calcula sobre la media y desviacion de los 30 dias
--     ANTERIORES (ventana que excluye el dia en curso: si no, un pico se
--     esconde a si mismo subiendo su propia media).
-- ---------------------------------------------------------------------------

create or replace function public.ia_coste_serie(
  p_desde   date default (current_date - 29),
  p_hasta   date default current_date,
  p_funcion text default null
)
returns table (
  dia                 date,
  coste_usd           numeric,
  llamadas            bigint,
  peticiones          bigint,
  errores             bigint,
  prompt_tokens       bigint,
  completion_tokens   bigint,
  razonamiento_tokens bigint,
  media_7             numeric,
  media_30            numeric,
  desv_30             numeric,
  z_30                numeric,
  desviacion_pct      numeric,
  es_anomalia         boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  -- Se amplia 30 dias hacia atras para que la media movil del primer dia del
  -- rango no arranque en falso. El calendario completo se construye abajo en
  -- `completo`, sobre ese mismo rango ampliado, y el filtro final
  -- (`where v.dia >= p_desde`) recorta el calentamiento.
  with crudo as (
    select
      v.dia,
      coalesce(sum(v.coste_usd), 0)::numeric  as coste_usd,
      coalesce(sum(v.llamadas), 0)::bigint    as llamadas,
      coalesce(sum(v.peticiones), 0)::bigint  as peticiones,
      coalesce(sum(v.errores), 0)::bigint     as errores,
      coalesce(sum(v.prompt_tokens), 0)::bigint       as prompt_tokens,
      coalesce(sum(v.completion_tokens), 0)::bigint   as completion_tokens,
      coalesce(sum(v.razonamiento_tokens), 0)::bigint as razonamiento_tokens
    from public.ia_uso_diario v
    where v.dia between (p_desde - 30) and p_hasta
      and (p_funcion is null or v.funcion = p_funcion)
    group by v.dia
  ),
  completo as (
    select
      c.dia,
      coalesce(r.coste_usd, 0)::numeric           as coste_usd,
      coalesce(r.llamadas, 0)::bigint             as llamadas,
      coalesce(r.peticiones, 0)::bigint           as peticiones,
      coalesce(r.errores, 0)::bigint              as errores,
      coalesce(r.prompt_tokens, 0)::bigint        as prompt_tokens,
      coalesce(r.completion_tokens, 0)::bigint    as completion_tokens,
      coalesce(r.razonamiento_tokens, 0)::bigint  as razonamiento_tokens
    from (
      select d::date as dia
      from generate_series(p_desde - 30, p_hasta, interval '1 day') as d
    ) c
    left join crudo r on r.dia = c.dia
  ),
  ventanas as (
    select
      c.*,
      avg(c.coste_usd) over (order by c.dia rows between 6 preceding and current row)  as media_7,
      avg(c.coste_usd) over (order by c.dia rows between 30 preceding and 1 preceding) as media_30,
      stddev_samp(c.coste_usd) over (order by c.dia rows between 30 preceding and 1 preceding) as desv_30,
      count(*) over (order by c.dia rows between 30 preceding and 1 preceding) as n_30
    from completo c
  )
  select
    v.dia,
    round(v.coste_usd, 6)                                   as coste_usd,
    v.llamadas,
    v.peticiones,
    v.errores,
    v.prompt_tokens,
    v.completion_tokens,
    v.razonamiento_tokens,
    round(v.media_7, 6)                                     as media_7,
    round(v.media_30, 6)                                    as media_30,
    round(v.desv_30, 6)                                     as desv_30,
    -- z solo si hay al menos 7 dias de historia y la desviacion no es 0
    -- (con desv 0 cualquier cambio daria z infinito).
    case when v.n_30 >= 7 and v.desv_30 is not null and v.desv_30 > 0
         then round((v.coste_usd - v.media_30) / v.desv_30, 2)
    end                                                     as z_30,
    case when v.media_30 is not null and v.media_30 > 0
         then round(100 * (v.coste_usd - v.media_30) / v.media_30, 1)
    end                                                     as desviacion_pct,
    -- Anomalia = |z| > 2 Y ademas un salto que se note en dinero. Sin el
    -- segundo filtro, pasar de 0,000001 a 0,000004 USD saldria como anomalia:
    -- estadisticamente lo es, pero no es una noticia. El umbral de 0,01 USD/dia
    -- es deliberadamente bajo porque todo el gasto de IA aqui es de centimos.
    case when v.n_30 >= 7 and v.desv_30 is not null and v.desv_30 > 0
         then abs((v.coste_usd - v.media_30) / v.desv_30) > 2
              and abs(v.coste_usd - v.media_30) >= 0.01
    end                                                     as es_anomalia
  from ventanas v
  where v.dia >= p_desde
  order by v.dia;
$$;

comment on function public.ia_coste_serie(date, date, text) is
  'Serie diaria de coste de IA con media 7/30, z y anomalias. Mismo contrato '
  'de forma que trafico_web_serie. Un dia sin llamadas es 0 de verdad (no hay '
  'nada que sincronizar), al contrario que en trafico web.';

revoke all on function public.ia_coste_serie(date, date, text) from public, anon;
grant execute on function public.ia_coste_serie(date, date, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8d. ia_coste_por_funcion
--     LEFT JOIN desde ia_funciones para que una funcion dada de alta y SIN
--     registrar salga en la tabla con 0 peticiones y coste NULL, en vez de
--     desaparecer. Una funcion que no aparece se lee como "no gasta"; una que
--     aparece con "sin datos" se lee como "no lo sabemos". Es la diferencia
--     que hace util esta pantalla.
-- ---------------------------------------------------------------------------

create or replace function public.ia_coste_por_funcion(
  p_desde date default (current_date - 29),
  p_hasta date default current_date
)
returns table (
  funcion             text,
  descripcion         text,
  instrumentada       boolean,
  llamadas            bigint,
  peticiones          bigint,
  errores             bigint,
  prompt_tokens       bigint,
  completion_tokens   bigint,
  razonamiento_tokens bigint,
  coste_usd           numeric,
  pct                 numeric,
  usd_por_peticion    numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with uso as (
    select
      v.funcion,
      coalesce(sum(v.llamadas), 0)::bigint            as llamadas,
      coalesce(sum(v.peticiones), 0)::bigint          as peticiones,
      coalesce(sum(v.errores), 0)::bigint             as errores,
      coalesce(sum(v.prompt_tokens), 0)::bigint       as prompt_tokens,
      coalesce(sum(v.completion_tokens), 0)::bigint   as completion_tokens,
      coalesce(sum(v.razonamiento_tokens), 0)::bigint as razonamiento_tokens,
      sum(v.coste_usd)::numeric                       as coste_usd
    from public.ia_uso_diario v
    where v.dia between p_desde and p_hasta
    group by v.funcion
  ),
  -- FULL JOIN: salen las funciones del catalogo sin uso Y el uso de funciones
  -- que nadie dio de alta en ia_funciones (una funcion nueva que ya registra
  -- pero que se olvidaron de catalogar no debe quedar invisible).
  juntas as (
    select
      coalesce(f.funcion, u.funcion) as funcion,
      f.descripcion,
      coalesce(f.instrumentada, false) as instrumentada,
      coalesce(u.llamadas, 0)::bigint            as llamadas,
      coalesce(u.peticiones, 0)::bigint          as peticiones,
      coalesce(u.errores, 0)::bigint             as errores,
      coalesce(u.prompt_tokens, 0)::bigint       as prompt_tokens,
      coalesce(u.completion_tokens, 0)::bigint   as completion_tokens,
      coalesce(u.razonamiento_tokens, 0)::bigint as razonamiento_tokens,
      u.coste_usd,
      coalesce(f.orden, 999) as orden
    from public.ia_funciones f
    full join uso u on u.funcion = f.funcion
    where f.funcion is null or f.activo
  ),
  total as (select nullif(sum(j.coste_usd), 0) as t from juntas j)
  select
    j.funcion,
    j.descripcion,
    j.instrumentada,
    j.llamadas,
    j.peticiones,
    j.errores,
    j.prompt_tokens,
    j.completion_tokens,
    j.razonamiento_tokens,
    round(j.coste_usd, 6)                                        as coste_usd,
    case when t.t is not null and j.coste_usd is not null
         then round(100 * j.coste_usd / t.t, 1) end               as pct,
    case when j.peticiones > 0 and j.coste_usd is not null
         then round(j.coste_usd / j.peticiones, 6) end            as usd_por_peticion
  from juntas j cross join total t
  order by j.coste_usd desc nulls last, j.orden, j.funcion;
$$;

comment on function public.ia_coste_por_funcion(date, date) is
  'Coste por funcion en un rango. FULL JOIN con ia_funciones: una funcion del '
  'catalogo sin registrar sale con coste NULL ("no lo sabemos") en vez de '
  'desaparecer ("no gasta"), y una que registra sin estar catalogada tampoco '
  'se pierde.';

revoke all on function public.ia_coste_por_funcion(date, date) from public, anon;
grant execute on function public.ia_coste_por_funcion(date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8e. ia_coste_por_modelo
--     `pct_razonamiento` es LA columna de esta pantalla: el porcentaje de la
--     salida que se gasta en pensar. Es la que contesta si merece la pena
--     cambiar de modelo.
-- ---------------------------------------------------------------------------

create or replace function public.ia_coste_por_modelo(
  p_desde date default (current_date - 29),
  p_hasta date default current_date
)
returns table (
  modelo              text,
  llamadas            bigint,
  peticiones          bigint,
  prompt_tokens       bigint,
  cached_tokens       bigint,
  completion_tokens   bigint,
  razonamiento_tokens bigint,
  pct_razonamiento    numeric,
  coste_usd           numeric,
  pct                 numeric,
  usd_por_peticion    numeric,
  tarifado            boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with uso as (
    select
      v.modelo,
      coalesce(sum(v.llamadas), 0)::bigint            as llamadas,
      coalesce(sum(v.peticiones), 0)::bigint          as peticiones,
      coalesce(sum(v.prompt_tokens), 0)::bigint       as prompt_tokens,
      coalesce(sum(v.cached_tokens), 0)::bigint       as cached_tokens,
      coalesce(sum(v.completion_tokens), 0)::bigint   as completion_tokens,
      coalesce(sum(v.razonamiento_tokens), 0)::bigint as razonamiento_tokens,
      sum(v.coste_usd)::numeric                       as coste_usd
    from public.ia_uso_diario v
    where v.dia between p_desde and p_hasta
    group by v.modelo
  ),
  total as (select nullif(sum(u.coste_usd), 0) as t from uso u)
  select
    u.modelo,
    u.llamadas,
    u.peticiones,
    u.prompt_tokens,
    u.cached_tokens,
    u.completion_tokens,
    u.razonamiento_tokens,
    case when u.completion_tokens > 0
         then round(100.0 * u.razonamiento_tokens / u.completion_tokens, 1) end as pct_razonamiento,
    round(u.coste_usd, 6)                                    as coste_usd,
    case when t.t is not null and u.coste_usd is not null
         then round(100 * u.coste_usd / t.t, 1) end           as pct,
    case when u.peticiones > 0 and u.coste_usd is not null
         then round(u.coste_usd / u.peticiones, 6) end        as usd_por_peticion,
    -- false = el modelo NO esta en ia_precios, asi que su coste es NULL. La
    -- pantalla avisa en vez de pintar un 0 tranquilizador.
    exists (select 1 from public.ia_precios p where p.modelo = u.modelo) as tarifado
  from uso u cross join total t
  order by u.coste_usd desc nulls last, u.modelo;
$$;

comment on function public.ia_coste_por_modelo(date, date) is
  'Coste por modelo con el porcentaje de la salida que es razonamiento. '
  'tarifado = false -> el modelo no esta en ia_precios y su coste_usd es NULL.';

revoke all on function public.ia_coste_por_modelo(date, date) from public, anon;
grant execute on function public.ia_coste_por_modelo(date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8f. ia_coste_mes -- mes en curso + proyeccion a fin de mes + fijos
--     Mismo espiritu que trafico_web_fdt_mes: dos proyecciones en vez de una,
--     porque con pocos dias la lineal se dispara.
--       proy_lineal  = acumulado / dias_con_dato * dias_mes
--       proy_media7  = acumulado + media de los ultimos 7 dias x dias_restantes
--     Devuelve SIEMPRE una fila, aunque no haya nada registrado: la pantalla
--     necesita saber cuantos dias lleva el mes incluso con ia_uso vacia.
-- ---------------------------------------------------------------------------

create or replace function public.ia_coste_mes()
returns table (
  mes                   date,
  coste_acumulado_usd   numeric,
  peticiones            bigint,
  dias_con_dato         integer,
  dias_mes              integer,
  dias_restantes        integer,
  usd_medio_dia         numeric,
  proy_lineal_usd       numeric,
  proy_media7_usd       numeric,
  fijos_eur_mes         numeric,
  fijos_sin_verificar   integer,
  estimado_ia_usd_mes   numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with ref as (
    select
      date_trunc('month', (now() at time zone 'Europe/Madrid'))::date as primero,
      (now() at time zone 'Europe/Madrid')::date                      as hoy
  ),
  marco as (
    select
      r.primero                                                        as mes,
      r.hoy                                                            as hoy,
      extract(day from (r.primero + interval '1 month' - interval '1 day'))::integer as dias_mes,
      -- Dias transcurridos incluyendo hoy (hoy esta a medias, y eso hace que
      -- la proyeccion lineal INFRAestime un poco por la manana. Se asume:
      -- corregirlo con la hora exacta daria un numero que baila todo el dia).
      (r.hoy - r.primero + 1)::integer                                 as dias_curso
    from ref r
  ),
  dias as (
    select
      coalesce(sum(v.coste_usd), 0)::numeric as coste,
      coalesce(sum(v.peticiones), 0)::bigint as peticiones,
      count(distinct v.dia)::integer         as dias_con_dato
    from public.ia_uso_diario v, marco m
    where v.dia >= m.mes and v.dia <= m.hoy
  ),
  ult7 as (
    select coalesce(sum(v.coste_usd), 0)::numeric / 7.0 as media
    from public.ia_uso_diario v, marco m
    where v.dia > m.hoy - 7 and v.dia <= m.hoy
  ),
  fijos as (
    select
      -- sum() de numeric ignora NULL: si TODAS las filas estan sin verificar
      -- devuelve NULL, que es lo correcto ("no lo sabemos"), no 0.
      sum(c.eur_mes)::numeric                                    as eur_mes,
      count(*) filter (where c.eur_mes is null)::integer          as sin_verificar
    from public.costes_fijos c
    where c.activo
  ),
  estim as (
    select sum(e.usd_por_unidad * e.unidades_mes_estimadas)::numeric as usd_mes
    from public.ia_coste_estimado e
  )
  select
    m.mes,
    round(d.coste, 6)                                        as coste_acumulado_usd,
    d.peticiones,
    d.dias_con_dato,
    m.dias_mes,
    greatest(m.dias_mes - m.dias_curso, 0)                   as dias_restantes,
    -- Se divide por los dias TRANSCURRIDOS, no por los dias con dato: un dia
    -- sin llamadas es un dia de 0 EUR real y tiene que tirar la media abajo.
    -- (En trafico web es al contrario: alli un dia sin dato es un hueco de
    --  sincronizacion y dividir por el falsearia a la baja.)
    case when m.dias_curso > 0 then round(d.coste / m.dias_curso, 6) end as usd_medio_dia,
    case when m.dias_curso > 0
         then round(d.coste / m.dias_curso * m.dias_mes, 6) end          as proy_lineal_usd,
    round(d.coste + u.media * greatest(m.dias_mes - m.dias_curso, 0), 6) as proy_media7_usd,
    round(f.eur_mes, 2)                                      as fijos_eur_mes,
    coalesce(f.sin_verificar, 0)                             as fijos_sin_verificar,
    round(e.usd_mes, 6)                                      as estimado_ia_usd_mes
  from marco m, dias d, ult7 u, fijos f, estim e;
$$;

comment on function public.ia_coste_mes() is
  'Mes en curso: acumulado, dos proyecciones a fin de mes (lineal y por media '
  'de 7 dias), coste fijo declarado y estimacion de IA. Devuelve siempre una '
  'fila. fijos_eur_mes NULL = ninguna fila de costes_fijos verificada.';

revoke all on function public.ia_coste_mes() from public, anon;
grant execute on function public.ia_coste_mes() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8g. ia_coste_alternativa -- re-tarifar el historico con otro modelo
--
--     Coge los tokens YA REGISTRADOS y los pasa por la tarifa de otro modelo.
--     Es la respuesta con datos propios a "gpt-5-mini me cuesta X, cuanto me
--     costaria gpt-5.4-mini".
--
--     LIMITE QUE HAY QUE DECIR: esto supone MISMOS TOKENS con el otro modelo,
--     y eso es justo lo que NO pasa en el caso que motiva la pantalla (3.060
--     vs 598 tokens de salida). Asi que el ahorro que salga de aqui es el
--     ahorro POR TARIFA, no el ahorro real. Con dos modelos de la misma tarifa
--     dara diferencia 0, y eso es correcto: el ahorro viene de gastar menos
--     tokens, no de pagar menos por token. La pantalla tiene que decirlo o el
--     numero engana. Para medir el ahorro de verdad hay que registrar llamadas
--     reales con el modelo nuevo y comparar usd_por_peticion en
--     ia_coste_por_modelo.
--
--     Lee de ia_uso directamente (no de la vista) porque necesita los tokens
--     sin agregar por dia para no perder el cache_write.
-- ---------------------------------------------------------------------------

create or replace function public.ia_coste_alternativa(
  p_modelo_alternativo text,
  p_desde date default (current_date - 29),
  p_hasta date default current_date
)
returns table (
  modelo_real             text,
  modelo_alternativo      text,
  peticiones              bigint,
  coste_real_usd          numeric,
  coste_alternativo_usd   numeric,
  diferencia_usd          numeric,
  diferencia_pct          numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with alt as (
    select * from public.ia_precios p where p.modelo = p_modelo_alternativo
  ),
  agrupado as (
    select
      u.modelo,
      count(*)::bigint                                as peticiones,
      sum(u.coste_usd)::numeric                       as coste_real,
      sum(greatest(u.prompt_tokens - u.cached_tokens - u.cache_write_tokens, 0))::bigint as input_neto,
      sum(u.cached_tokens)::bigint                    as cached,
      sum(u.cache_write_tokens)::bigint               as cache_w,
      sum(u.completion_tokens)::bigint                as completion
    from public.ia_uso u
    where (u.created_at at time zone 'Europe/Madrid')::date between p_desde and p_hasta
    group by u.modelo
  )
  select
    g.modelo                                                   as modelo_real,
    p_modelo_alternativo                                       as modelo_alternativo,
    g.peticiones,
    round(g.coste_real, 6)                                     as coste_real_usd,
    round((
        g.input_neto  * a.usd_por_m_input
      + g.cached      * coalesce(a.usd_por_m_cached, a.usd_por_m_input)
      + g.cache_w     * coalesce(a.usd_por_m_cache_write, a.usd_por_m_input)
      + g.completion  * a.usd_por_m_output
    ) / 1000000.0, 6)                                          as coste_alternativo_usd,
    round(g.coste_real - (
        g.input_neto  * a.usd_por_m_input
      + g.cached      * coalesce(a.usd_por_m_cached, a.usd_por_m_input)
      + g.cache_w     * coalesce(a.usd_por_m_cache_write, a.usd_por_m_input)
      + g.completion  * a.usd_por_m_output
    ) / 1000000.0, 6)                                          as diferencia_usd,
    case when g.coste_real is not null and g.coste_real > 0 then round(100 * (g.coste_real - (
        g.input_neto  * a.usd_por_m_input
      + g.cached      * coalesce(a.usd_por_m_cached, a.usd_por_m_input)
      + g.cache_w     * coalesce(a.usd_por_m_cache_write, a.usd_por_m_input)
      + g.completion  * a.usd_por_m_output
    ) / 1000000.0) / g.coste_real, 1) end                      as diferencia_pct
  -- INNER JOIN a proposito: si el modelo alternativo no tiene tarifa, no hay
  -- nada que comparar y se devuelven 0 filas en vez de una tabla de NULLs.
  from agrupado g cross join alt a
  where g.modelo <> p_modelo_alternativo
  order by g.coste_real desc nulls last;
$$;

comment on function public.ia_coste_alternativa(text, date, date) is
  'Re-tarifa los tokens ya registrados con la tarifa de otro modelo. OJO: '
  'supone MISMOS tokens, asi que mide el ahorro POR TARIFA, no el ahorro real '
  '(que viene de gastar menos tokens). Dos modelos de igual tarifa dan 0.';

revoke all on function public.ia_coste_alternativa(text, date, date) from public, anon;
grant execute on function public.ia_coste_alternativa(text, date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8h. ia_funciones_sin_registro -- el aviso de "esto no esta midiendo"
--     Equivalente de detectarProblemasSync() de trafico-web. Dos casos, y la
--     pantalla los pinta distinto:
--       instrumentada = false -> se sabe que no registra (agujero conocido).
--       instrumentada = true  -> DEBERIA registrar y no lo hace (algo se rompio).
-- ---------------------------------------------------------------------------

create or replace function public.ia_funciones_sin_registro(
  p_dias integer default 7
)
returns table (
  funcion           text,
  descripcion       text,
  instrumentada     boolean,
  ultima_fila       timestamptz,
  dias_sin_registro integer
)
language sql
stable
security invoker
set search_path = public
as $$
  with ultimas as (
    select u.funcion, max(u.created_at) as ultima
    from public.ia_uso u group by u.funcion
    union all
    select 'chat-web'::text, max(c.created_at)
    from public.chat_web_uso c where c.estado in ('ok','error')
  ),
  mejor as (
    select t.funcion, max(t.ultima) as ultima from ultimas t group by t.funcion
  )
  select
    f.funcion,
    f.descripcion,
    f.instrumentada,
    m.ultima                                                       as ultima_fila,
    case when m.ultima is not null
         then extract(day from (now() - m.ultima))::integer end    as dias_sin_registro
  from public.ia_funciones f
  left join mejor m on m.funcion = f.funcion
  where f.activo
    and (m.ultima is null or m.ultima < now() - make_interval(days => greatest(coalesce(p_dias, 7), 1)))
  order by f.instrumentada desc, f.orden, f.funcion;
$$;

comment on function public.ia_funciones_sin_registro(integer) is
  'Funciones del catalogo sin ninguna fila de uso en los ultimos p_dias dias. '
  'instrumentada = false -> agujero conocido (no registra todavia). '
  'instrumentada = true -> deberia registrar y no lo hace: algo se rompio.';

revoke all on function public.ia_funciones_sin_registro(integer) from public, anon;
grant execute on function public.ia_funciones_sin_registro(integer) to authenticated, service_role;

commit;

-- ===========================================================================
-- 9. RETENCION
--    Igual que chat_web_uso (20260926121000): 90 dias. Fuera de transaccion,
--    patron idempotente unschedule+schedule. pg_cron ya se usa en el proyecto.
--
--    OJO: al borrar la fila se pierde el detalle, no el historico agregado...
--    salvo que NO hay agregado persistido. Con 90 dias de retencion, la serie
--    de 180 y 365 dias que ofrece el filtro de la pantalla se queda corta.
--    Es una LIMITACION ASUMIDA en esta primera version, y esta apuntada en el
--    CHECKLIST: si el dueno quiere un ano de historico, hace falta una tabla
--    `ia_uso_mensual` que consolide antes de borrar. No se hace ahora para no
--    meter una tabla mas sin que nadie haya pedido el historico largo.
-- ===========================================================================

create extension if not exists pg_cron;

select cron.unschedule('ia-uso-retencion') where exists (
  select 1 from cron.job where jobname = 'ia-uso-retencion'
);

select cron.schedule(
  'ia-uso-retencion',
  '25 3 * * *',  -- 10 min despues del de chat_web_uso (15 3), para no solapar
  $$ delete from public.ia_uso where created_at < now() - interval '90 days'; $$
);

-- ===========================================================================
-- CHECKLIST ANTES / DESPUES DE APLICAR
-- ===========================================================================
--
--  ANTES
--  -----
--  1. Confirmar con el dueno. Esta migracion crea 5 tablas y 1 vista nuevas.
--
--  2. VERIFICAR LAS 5 TARIFAS SIN VERIFICAR de ia_precios (gpt-4.1-mini,
--     gpt-4o-mini, gpt-5-mini, gpt-5.4-mini, sonar). Son tarifas publicas
--     apuntadas de memoria. Mientras verificado_en siga NULL, el coste de la
--     pantalla es orientativo y ella misma lo avisa. Comprobar en
--     platform.openai.com/docs/pricing y luego:
--       update public.ia_precios
--          set usd_por_m_input = ..., usd_por_m_output = ...,
--              fuente = 'platform.openai.com/docs/pricing, consultado <fecha>',
--              verificado_en = current_date, actualizado_en = now()
--        where modelo = 'gpt-4.1-mini';
--
--  3. Decidir si `sonar` (Perplexity) se queda. Segun
--     docs/CREDENCIALES-Y-COSTES.md `buscar-precios-mercado` no la llama
--     ninguna pantalla. Si se confirma que sobra, borrar su fila de
--     ia_precios y la de ia_funciones en vez de dejar ruido.
--
--  DESPUES (a mano, contra el catalogo, no contra este SQL)
--  -------------------------------------------------------
--  4. Las 13 politicas nuevas, ninguna abierta:
--       select tablename, policyname, cmd, roles::text,
--              coalesce(qual,'-') as using_expr
--       from pg_policies where schemaname = 'public'
--         and tablename in ('ia_precios','ia_funciones','ia_uso',
--                           'costes_fijos','ia_coste_estimado')
--       order by tablename, cmd, policyname;
--     -- esperado: ia_precios 2, ia_funciones 2, ia_uso 2, costes_fijos 5,
--     --           ia_coste_estimado 2. Ninguna con `true` salvo las 5 de
--     --           service_role. Ninguna con rol public/anon.
--
--  5. Ni TRUNCATE a authenticated ni nada a anon:
--       select table_name, grantee,
--              string_agg(privilege_type, ',' order by privilege_type)
--       from information_schema.role_table_grants
--       where table_schema = 'public'
--         and table_name in ('ia_precios','ia_funciones','ia_uso',
--                            'costes_fijos','ia_coste_estimado','ia_uso_diario')
--         and grantee in ('anon','authenticated','service_role','public')
--       group by 1,2 order by 1,2;
--     -- esperado: CERO filas con grantee='anon'. Ninguna fila de
--     -- authenticated con TRUNCATE. authenticated solo SELECT, salvo
--     -- costes_fijos que tiene tambien INSERT/UPDATE/DELETE.
--
--  6. Que la RPC de escritura NO la puede llamar el navegador:
--       select p.proname, p.prosecdef,
--              array_to_string(p.proconfig, ',') as config,
--              array_to_string(p.proacl, ' ')    as acl
--       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname = 'public' and p.proname like 'ia\_%'
--       order by p.proname;
--     -- esperado: ia_registrar_uso -> prosecdef = TRUE y en el acl SOLO
--     --   service_role=X (ni authenticated ni anon ni =X/ para public).
--     -- esperado: las otras 5 ia_* -> prosecdef = FALSE (security invoker) y
--     --   authenticated=X + service_role=X.
--     -- Las 6 con config = search_path=public.
--
--  7. La vista respeta la RLS:
--       select c.relname, c.reloptions
--       from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where n.nspname = 'public' and c.relname = 'ia_uso_diario';
--     -- esperado: reloptions contiene security_invoker=true.
--
--  8. Prueba de humo del registro (como service_role):
--       select * from public.ia_registrar_uso(
--         'prueba', 'gpt-5-mini', 1200, 3060, 2500, 0, 0, 1, 'chat', 'ok', 'checklist');
--     -- esperado: una fila con tarifado = true y coste_usd = 0,006420
--     --   ((1200 x 0,25) + (3060 x 2,00)) / 1e6 = 0,000300 + 0,006120.
--     -- LO IMPORTANTE: que NO sume los 2500 de razonamiento aparte. Si sale
--     --   0,011420, alguien rompio la regla de la cabecera.
--       select * from public.ia_registrar_uso(
--         'prueba', 'modelo-que-no-existe', 100, 100, 0, 0, 0, 1, 'chat', 'ok', 'checklist');
--     -- esperado: tarifado = false y coste_usd NULL (no 0).
--       select * from public.ia_coste_serie(current_date - 2, current_date);
--       select * from public.ia_coste_por_modelo(current_date - 2, current_date);
--       select * from public.ia_coste_mes();
--       select * from public.ia_coste_alternativa('gpt-5.4-mini', current_date - 2, current_date);
--     -- esperado en la ultima: diferencia_usd = 0 para gpt-5-mini, porque las
--     --   dos tarifas son iguales. NO es un bug: ver el comentario de 8g.
--       select * from public.ia_funciones_sin_registro(7);
--     -- esperado: las 6 funciones que no registran (todas menos chat-web si
--     --   chat_web_uso tiene filas recientes).
--       delete from public.ia_uso where funcion = 'prueba';
--
--  9. Que un autenticado NO super admin no ve nada:
--       -- con el JWT de admin@staff.local: select count(*) from public.ia_uso;
--     -- esperado: 0 filas (no error: la RLS filtra, no rechaza).
--
-- 10. El cron de retencion:
--       select jobname, schedule, active from cron.job
--       where jobname in ('ia-uso-retencion','chat-web-uso-retencion');
--     -- esperado: los dos activos, a las 3:25 y 3:15.
--
-- 11. Rellenar `costes_fijos` con los importes de verdad. Las 8 filas entran
--     con eur_mes NULL: hasta que alguien mire las 5 facturas, la pantalla
--     dice "sin datos" y avisa. Ese es el punto.
--
-- ===========================================================================
