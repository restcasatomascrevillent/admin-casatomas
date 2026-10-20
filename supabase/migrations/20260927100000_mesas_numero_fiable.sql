-- ===========================================================================
-- ##                                                                       ##
-- ##                       SIN APLICAR — LA APLICA EL DUEÑO                 ##
-- ##                                                                       ##
-- ##   Estado a 2026-09-27: este fichero queda ESCRITO Y REVISADO pero SIN  ##
-- ##   EJECUTAR. No se ha lanzado `supabase db push`, ni `migration up`,    ##
-- ##   ni se ha aplicado por el editor SQL. Tampoco se ha podido LEER la    ##
-- ##   base de datos desde la sesión en que se escribió (el MCP de Supabase ##
-- ##   respondió `Unauthorized`), así que TODAS las cifras de producción    ##
-- ##   que se citan aquí abajo vienen de la lectura que hizo el dueño el    ##
-- ##   2026-09-27 y **no se han vuelto a comprobar**.                       ##
-- ##                                                                       ##
-- ##   Consecuencia práctica: el SQL de limpieza está escrito para          ##
-- ##   DEDUCIR de la tabla lo que tiene que arreglar, no para tocar ids     ##
-- ##   concretos. Si los datos han cambiado desde esa lectura, sigue        ##
-- ##   haciendo lo correcto (o para con un error legible), pero NO da por   ##
-- ##   supuesto nada sobre qué filas hay.                                   ##
-- ##                                                                       ##
-- ##   ANTES DE APLICARLA: ejecutar el bloque "CONSULTAS PREVIAS" del final ##
-- ##   (solo lectura) para ver exactamente qué filas va a tocar. En         ##
-- ##   especial la nº 3: dice qué mesas se van a DESACTIVAR.                ##
-- ##                                                                       ##
-- ===========================================================================
--
-- ENCARGO (dueño, 2026-09-27)
--
--   "Que el número de mesa sea fiable: que no haya dos mesas con el mismo
--    número en la misma sala, que no se cuelen nombres de un tecleo suelto,
--    y que la cuenta de plazas no se invente sillas que no existen."
--
--   Son dos bugs distintos con una raíz común: nada, ni en la pantalla ni en
--   la base, obligaba a que `mesas.nombre` (que es donde vive el NÚMERO de
--   mesa) fuera único dentro de su sala.
--
-- ---------------------------------------------------------------------------
-- BUG 1 — LAS MESAS FUSIONADAS SE CONTABAN DOS VECES
-- ---------------------------------------------------------------------------
--
--   Cuando el editor de plano fusiona dos mesas
--   (`src/components/espacios/EditorPlanoEspacio.tsx`, dentro de `handleSave`)
--   inserta UNA fila nueva con `is_merged = true`, la capacidad combinada y
--   el detalle de las originales en `original_mesas`, y **después borra las
--   filas originales**:
--
--     for (const originalId of idsOriginalesFusionadas) {
--       await supabase.from('mesas').delete().eq('id', originalId);
--     }
--
--   Ese `delete` **no mira el `{ error }` que devuelve supabase-js**. Y aquí
--   está el detalle que explica por qué nadie se dio cuenta: **supabase-js
--   RESUELVE, no rechaza**, cuando la RLS o una FK rechazan el borrado. No
--   hay excepción que subir: el editor sigue como si nada hasta el
--   `toast.success("Plano guardado correctamente")` del final de `handleSave`.
--   La fila fusionada se queda Y las originales también. El borrado puede
--   FALLAR EN SILENCIO.
--
--   Son DOS los `delete` así, los dos dentro de `handleSave` (líneas ~572 y
--   ~609 sobre `main` a 2026-09-27, pero ese fichero se está editando en
--   paralelo y los números se mueven: el ancla fiable es `handleSave` y la
--   cadena `supabase.from('mesas').delete()`):
--
--     · el de arriba, que borra las mesas originales absorbidas por una
--       fusión (el que deja fusionada + originales conviviendo), y
--     · el de DESFUSIONAR, que borra la fila fusionada cuando el usuario
--       deshace la fusión (si falla, la fusionada sobrevive junto a las
--       mesas recién desagrupadas: aforo duplicado otra vez).
--
--   Los dos INSERT de al lado SÍ comprueban su error, así que esto es una
--   omisión y no un criterio.
--
--   (La versión anterior de este comentario, heredada de `20260926120000`,
--   citaba "~183": esa línea ya no es ese código y la referencia era falsa.)
--
--   `20260926120000_capacidad_efectiva_mesas.sql` creó `vista_capacidad_
--   espacios`, `fn_capacidad_efectiva_espacio(uuid)` y
--   `fn_capacidad_efectiva_marca(text)` sumando TODAS las mesas activas,
--   fusionadas incluidas, y dejó escrito en su cabecera y en sus
--   `comment on ...` que NO había que excluir `is_merged` "porque el editor
--   borra las originales al fusionar". Ese razonamiento es FALSO en
--   producción, y la prueba está en los datos: el Salón tiene 15 filas de
--   las que 7 son fusionadas, y sumándolas todas da 64 plazas cuando las
--   mesas no fusionadas suman 36.
--
--   Esta migración corrige las tres definiciones con `create or replace`
--   para que sumen solo mesas **reales**: activas y no fusionadas.
--
--   *** LO QUE ESTA MIGRACIÓN **NO** ARREGLA, Y HAY QUE SABERLO ***
--
--   1. NO toca `EditorPlanoEspacio.tsx`. Los dos `delete` sin comprobar el
--      error siguen ahí, así que **se pueden seguir generando fusiones a
--      medias** (y desfusiones a medias).
--      Lo único que cambia es que la CUENTA de plazas ya no las duplica.
--      Ese fichero lo está tocando otra persona en paralelo; cambiarlo desde
--      aquí sería pisarle el trabajo.
--
--   2. NO borra las filas originales huérfanas que ya quedaron por ahí.
--      Siguen en la tabla, activas y visibles en el plano. Se quedan a
--      propósito: son filas con historial (pueden tener asignaciones) y
--      decidir cuál sobra es del dueño, no de una migración. La vista dice
--      cuántas hay por sala, en la columna `mesas_originales_huerfanas`.
--
--   3. EXCLUIR TODAS LAS FUSIONADAS PUEDE QUEDARSE CORTO. Ojo con esto,
--      porque es el punto delicado de todo el fichero:
--
--        · Si la fusión funcionó (las originales SÍ se borraron), las plazas
--          de la fila fusionada son REALES y excluirla las PIERDE.
--        · Si la fusión falló a medias, la fila fusionada duplica las plazas
--          de las originales que siguen vivas, y excluirla es lo correcto.
--
--      Con los datos del 2026-09-27 la Terraza es justo el primer caso: 3
--      filas, las 3 fusionadas, 12 plazas y NINGUNA original huérfana — o
--      sea, sus fusiones se borraron bien y esas 12 plazas existen. Con el
--      filtro que pide este encargo, la Terraza pasa a declarar **0 plazas**.
--
--      Se aplica igualmente el filtro pedido (activas y no fusionadas)
--      porque es lo encargado y porque HOY NO LO USA NADIE: el aforo lo
--      sigue decidiendo `espacios_reserva.capacidad_maxima` (ver más abajo),
--      así que infravalorar la Terraza no bloquea ninguna reserva. Pero
--      queda dicho aquí y en el `comment on view`, y la vista expone además
--      la cuenta honesta en `plazas_mesas_sin_duplicar`:
--
--          plazas de las fusionadas
--        + plazas de las reales que NO aparecen en ningún `original_mesas`
--
--      Esa columna cuenta cada silla UNA vez en los dos escenarios, y es la
--      que hay que mirar para decidir de verdad si se puede encender la
--      regla de aforo por mesas. Si algún día se enciende, lo razonable es
--      que las funciones usen ESE criterio y no el de este fichero.
--
-- ---------------------------------------------------------------------------
-- BUG 2 — NÚMEROS DE MESA REPETIDOS Y NOMBRES DE UN TECLEO SUELTO
-- ---------------------------------------------------------------------------
--
--   No existe ninguna restricción de unicidad sobre `mesas.nombre`:
--   `mesas_pkey` (sobre `id`) es el único índice de la tabla. Resultado en
--   producción: el Salón tiene DOS mesas llamadas "9", y el Comedor una mesa
--   llamada "o" (una letra suelta que se quedó ahí de un tecleo).
--
--   Se arregla en tres pasos, en este orden y en la misma transacción:
--     1. Limpiar los nombres que impedirían el índice — SIN BORRAR NADA.
--     2. Comprobar que ya no quedan duplicados, y si quedan, parar con un
--        error que diga CUÁLES.
--     3. Crear el índice único parcial `uq_mesas_espacio_nombre_real`.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ NO SE BORRA NINGUNA FILA (decisión)
-- ---------------------------------------------------------------------------
--
--   Un `DELETE` aquí sería irreversible y podría llevarse cosas por delante:
--
--     · `asignaciones_mesa.mesa_id` es `ON DELETE CASCADE`
--       (`20251207090324`): borrar una mesa borra su historial de
--       asignaciones. Y si `20260926140000_asignaciones_mesa_sin_solapes.sql`
--       está aplicada, el `BEFORE DELETE` de `trg_mesas_auditar_asignaciones`
--       además genera avisos en la campana — ruido para el encargado por una
--       limpieza técnica.
--     · El `id` de una mesa puede estar citado dentro del `original_mesas`
--       de una fila fusionada, que es lo que usa la UI para deshacer la
--       fusión. Borrar la fila deja ese JSON apuntando al vacío.
--
--   Así que la limpieza RENOMBRA (y, en un caso muy concreto, DESACTIVA),
--   nunca borra. El sufijo ` (revisar)` es deliberadamente visible: el dueño
--   lo ve en el plano y decide. El índice único parcial (que solo mira mesas
--   activas y no fusionadas) no se lo impide.
--
--   Los `UPDATE` de este fichero NO disparan ningún trigger de `mesas`: el
--   único que hay (o habrá) es `trg_mesas_auditar_asignaciones`, y es
--   `BEFORE DELETE`.
--
-- ---------------------------------------------------------------------------
-- QUÉ SE CONSIDERA "NOMBRE SOSPECHOSO" (y por qué tan estrecho)
-- ---------------------------------------------------------------------------
--
--   Un nombre normalizado de UN SOLO CARÁCTER que no es un dígito. Eso es
--   "o", "p", "ñ": un tecleo suelto. Nada más.
--
--   La regla ancha ("cualquier nombre sin dígitos") se descartó a propósito:
--   "Barra", "Mesa alta" o "Reservado" no llevan dígitos y son nombres
--   perfectamente legítimos; desactivarlos restaría plazas de verdad al
--   cálculo. La regla estrecha coge el caso real ("o") y deja en paz todo lo
--   demás.
--
--   Aun así hay un falso positivo posible: una sala con una mesa llamada "A".
--   Si existe, la migración la renombra a "A (revisar)" y la desactiva, y lo
--   dice por `raise notice`. Se recupera en dos clics desde el editor de
--   plano (reactivar + renombrar) y no se pierde ni una fila ni una
--   asignación. Para verlo ANTES de aplicar, la consulta previa nº 3 del
--   final lista exactamente qué mesas entran por aquí.
--
--   Y solo se DESACTIVA si además está vacía de todo:
--     · sin filas en `asignaciones_mesa` (nunca se le sentó nadie), y
--     · sin aparecer en el `original_mesas` de ninguna otra fila.
--   Si tiene asignaciones o está referenciada, se RENOMBRA y se deja ACTIVA:
--   sus plazas siguen contando y su historial sigue intacto.
--
-- ---------------------------------------------------------------------------
-- NORMALIZACIÓN DEL NOMBRE: TIENE QUE DECIR LO MISMO QUE LA PANTALLA
-- ---------------------------------------------------------------------------
--
--   El frontend compara nombres con `normalizarNombreMesa()`
--   (`src/components/espacios/nombresMesa.ts`):
--
--     (nombre ?? "").trim().toLowerCase().replace(/\s+/g, " ")
--
--   El equivalente en SQL, y lo que usa tanto la limpieza como el índice:
--
--     lower(btrim(regexp_replace(nombre, '\s+', ' ', 'g')))
--
--   OJO AL ORDEN, que no es el obvio: **primero colapsar, después recortar**.
--   `btrim(texto)` con UN solo argumento quita únicamente ESPACIOS, no
--   tabuladores ni saltos de línea, mientras que `.trim()` de JavaScript los
--   quita todos. Con `btrim` primero, un nombre que empieza por tabulador
--   ("\t9") acabaría normalizado como " 9" en la base y como "9" en la
--   pantalla: la pantalla diría "ya existe" y la base lo dejaría pasar.
--   Colapsando primero, el tabulador se convierte en espacio y el `btrim`
--   sí se lo lleva. Así los dos lados dicen exactamente lo mismo.
--
--   Las tres funciones son IMMUTABLE (`lower`, `btrim`, `regexp_replace`),
--   que es el requisito para poder indexar la expresión. No hace falta —
--   ni se crea — ninguna función auxiliar propia.
--
--   `'\s+'` se escribe sin `E''` a propósito: con
--   `standard_conforming_strings = on` (el valor por defecto desde Postgres
--   9.1, y el que usa Supabase) la barra invertida es literal y llega al
--   motor de regex tal cual. En Postgres `\s` equivale a `[[:space:]]`.
--
--   DIVERGENCIAS CONOCIDAS Y ACEPTADAS con la pantalla (ninguna alcanzable
--   escribiendo a mano en el editor de plano):
--     · Espacios Unicode raros (el NBSP que pega Word, U+00A0): JavaScript
--       los trata como espacio y Postgres no. "9" y "9<NBSP>" serían el
--       mismo nombre para la pantalla y distintos para el índice.
--     · Nombre vacío: la pantalla nunca lo considera duplicado (lo bloquea
--       antes la validación de "nombre obligatorio"), el índice sí lo
--       trataría como un nombre más. Si en producción hubiera dos mesas con
--       el nombre en blanco en la misma sala, la limpieza de abajo las
--       separa igual que a cualquier otro duplicado.
--
-- ---------------------------------------------------------------------------
-- QUÉ **NO** HACE ESTA MIGRACIÓN (crítico)
-- ---------------------------------------------------------------------------
--
--   * **NO enciende la regla de aforo por mesas.** No toca
--     `validar_capacidad_reserva()` ni `trg_validar_capacidad`: el aforo
--     sigue sumando `espacios_reserva.capacidad_maxima` por marca, tal como
--     lo dejó `20260922190000_aforo_por_marca.sql`. Las tres definiciones
--     que se corrigen aquí siguen siendo INFORMATIVAS y no las llama nadie.
--     `20260926120000` dejó escrito (líneas ~314-506) cómo se encendería:
--     NO se hace, y con la Terraza a 0 plazas encenderlo hoy sería peor que
--     antes.
--   * **NO da de alta ninguna mesa.** Cuatro salas están sin mesas
--     ("Reservado" de Casa Tomás; "Interior", "Terraza" y "El Reservado" de
--     Touza). Cuántas mesas hay de verdad en cada una solo lo sabe el dueño,
--     y las carga desde el editor de plano.
--   * NO añade `NOT NULL`, ni `CHECK`, ni cambia el tipo de ninguna columna.
--     `mesas.nombre` sigue siendo `varchar(50)` y `mesas.activa` sigue
--     siendo `boolean` nullable con default `true`.
--   * NO edita ninguna migración ya escrita. `20260926120000` se queda tal
--     cual (reescribir una migración aplicada descuadra el historial); lo
--     que hay allí se corrige desde aquí con `create or replace`.
--   * NO depende de `20260926140000_asignaciones_mesa_sin_solapes.sql`. Solo
--     usa `asignaciones_mesa.mesa_id`, que existe desde `20251207090324`;
--     no menciona `fecha`, `turno` ni `espacio_id`, que son de esa otra
--     migración. Da igual el orden en que se apliquen.
--   * NO depende de que `20260926120000` esté aplicada. Todo son
--     `create or replace`, así que si esos tres objetos no existen, los
--     crea; y si existen, los sustituye.
--
-- ---------------------------------------------------------------------------
-- CRITERIO DE "MESA ACTIVA": SE MANTIENE EL DE 20260926120000
-- ---------------------------------------------------------------------------
--
--   `mesas.activa` es `boolean DEFAULT true` pero NO es `NOT NULL`. Se sigue
--   usando `activa is not false` (equivalente a `coalesce(activa, true) =
--   true`, que es como se escribe en el predicado del índice porque allí
--   queda más explícito): una fila con `activa IS NULL` cuenta como activa.
--   Con `activa = true` desaparecerían del cálculo plazas reales por un NULL.
--
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. `public.fn_capacidad_efectiva_espacio(uuid)` — sin las fusionadas
-- ---------------------------------------------------------------------------
--   Copia literal de la definición de `20260926120000` (líneas ~216-227)
--   AÑADIENDO una sola línea al `where`:
--
--     and coalesce(m.is_merged, false) = false
--
--   `coalesce` y no `m.is_merged = false` porque la columna es nullable: una
--   fila con `is_merged IS NULL` es una mesa normal y tiene que SEGUIR
--   contando. Con `is_merged = false` se caería del cálculo por un NULL,
--   que es el mismo error que evita `activa is not false`.
--
--   Se conservan `stable`, `security definer` y `set search_path` de la
--   versión original, y el nombre del parámetro (`p_espacio_id`): un
--   `create or replace function` NO permite cambiar el nombre de un
--   parámetro de entrada, fallaría.
create or replace function public.fn_capacidad_efectiva_espacio(p_espacio_id uuid)
returns integer
language sql
stable
security definer
set search_path = 'public'
as $$
  select coalesce(sum(m.capacidad), 0)::integer
  from public.mesas m
  where m.espacio_id = p_espacio_id
    and m.activa is not false
    and coalesce(m.is_merged, false) = false;
$$;

alter function public.fn_capacidad_efectiva_espacio(uuid) set search_path = 'public';

comment on function public.fn_capacidad_efectiva_espacio(uuid) is
  'INFORMATIVA — hoy no la llama el trigger de aforo. Suma la capacidad de las mesas REALES de un espacio: activas (activa IS NOT FALSE) y NO fusionadas (coalesce(is_merged,false) = false); 0 si no tiene mesas o el uuid no existe. SÍ se excluye is_merged, al contrario de lo que decía la versión de 20260926120000: el editor de plano borra las mesas originales al fusionar con un delete que no comprueba el error que devuelve (los dos delete de handleSave en EditorPlanoEspacio.tsx, ~572 el de las originales absorbidas por una fusión y ~609 el de la fila fusionada al desfusionar; los números se mueven, el ancla es handleSave), y supabase-js RESUELVE en vez de rechazar cuando la RLS o una FK rechazan el borrado, así que el fallo es invisible: el usuario ve Plano guardado correctamente y queda la fila fusionada junto a las originales. Sumar las fusionadas duplicaba plazas (el Salón daba 64 en vez de 36). CONTRAPARTIDA: cuando la fusión SÍ borró bien las originales, excluir la fila fusionada se queda corto (la Terraza pasa a 0 plazas teniendo 12 reales) — la cuenta que no duplica ni pierde es vista_capacidad_espacios.plazas_mesas_sin_duplicar. No filtra por espacios_reserva.activa a propósito: pregunta por el plano de ESE espacio.';

-- ---------------------------------------------------------------------------
-- 2. `public.fn_capacidad_efectiva_marca(text)` — sin las fusionadas
-- ---------------------------------------------------------------------------
--   Copia literal de la definición de `20260926120000` (líneas ~267-280) con
--   la MISMA línea añadida al `where`. Todo lo demás se conserva palabra por
--   palabra, porque esta función está pensada para acabar DENTRO del trigger
--   de aforo y tiene que medir exactamente lo mismo que él salvo el nuevo
--   filtro:
--     · `e.activa = true` (y no `is not false`): es lo que usa el trigger.
--     · `coalesce(...->>'marca','casa_tomas') = coalesce(p_marca,'casa_tomas')`
--       con COALESCE en LOS DOS lados, igual que en `20260922190000`.
--     · JOIN INNER: a una suma le da igual, y es lo que se lee más claro.
--
--   Sigue devolviendo 0 y nunca NULL. Y sigue valiendo el aviso de
--   `20260926120000`: una marca sin mesas cargadas devuelve 0, y encender la
--   regla con un 0 bloquearía el 100 % de sus reservas (caso Touza).
create or replace function public.fn_capacidad_efectiva_marca(p_marca text)
returns integer
language sql
stable
security definer
set search_path = 'public'
as $$
  select coalesce(sum(m.capacidad), 0)::integer
  from public.espacios_reserva e
  join public.mesas m on m.espacio_id = e.id
  where e.activa = true
    and coalesce(e.caracteristicas->>'marca', 'casa_tomas') = coalesce(p_marca, 'casa_tomas')
    and m.activa is not false
    and coalesce(m.is_merged, false) = false;
$$;

alter function public.fn_capacidad_efectiva_marca(text) set search_path = 'public';

comment on function public.fn_capacidad_efectiva_marca(text) is
  'INFORMATIVA HOY — el trigger trg_validar_capacidad NO la llama todavía (sigue sumando capacidad_maxima). Sustituto preparado del paso 1 de validar_capacidad_reserva(): suma las plazas de las mesas REALES (activas y NO fusionadas) de todos los espacios ACTIVOS de una marca, con el mismo criterio de marca que el trigger (coalesce(caracteristicas->>marca, casa_tomas) por igualdad). SÍ se excluye is_merged, al contrario de lo que decía la versión de 20260926120000: el borrado de las mesas originales al fusionar puede fallar en silencio (los dos delete de handleSave en EditorPlanoEspacio.tsx, ~572 y ~609, no comprueban el error, y supabase-js RESUELVE en vez de rechazar cuando la RLS o una FK lo rechazan), y entonces sumar las fusionadas cuenta las mismas plazas dos veces. CONTRAPARTIDA: si la fusión borró bien las originales, esta suma se queda corta — ver vista_capacidad_espacios.plazas_mesas_sin_duplicar, que es la cuenta que no duplica ni pierde, y usarla como referencia ANTES de encender la regla. Devuelve 0, nunca NULL: una marca sin mesas cargadas da 0 y encenderla bloquearía el 100 % de sus reservas. Ver el bloque "CÓMO ENCENDER LA REGLA" en 20260926120000_capacidad_efectiva_mesas.sql.';

-- ---------------------------------------------------------------------------
-- 3. VISTA `public.vista_capacidad_espacios` — reales y fusionadas aparte
-- ---------------------------------------------------------------------------
--   DECISIÓN SOBRE LAS COLUMNAS (y por qué esta y no otra):
--
--   Se CAMBIA el significado de `plazas_mesas`: ahora son solo las plazas de
--   las mesas REALES (activas y no fusionadas), igual que las dos funciones.
--   La alternativa era dejar `plazas_mesas` como total y añadir
--   `plazas_mesas_reales`, pero eso deja la columna con el nombre más obvio
--   diciendo el número equivocado — y es justo la que se mira de un vistazo.
--   Mejor que el nombre corto sea el dato correcto, y que el total viejo
--   quede en una columna con nombre explícito.
--
--   Por arrastre cambian también `diferencia` y `cuadra`, que se derivan de
--   `plazas_mesas`. `mesas_activas` y `mesas_totales` se quedan EXACTAMENTE
--   como estaban (mesas activas fusionadas incluidas, y filas totales), para
--   no cambiar dos veces el significado de lo mismo:
--       mesas_activas = mesas_reales + mesas_fusionadas.
--
--   Las columnas nuevas van TODAS AL FINAL. No es estética: `create or
--   replace view` solo permite AÑADIR columnas, y solo al final; cambiar el
--   nombre o el tipo de una existente, o meter una en medio, obliga a
--   `drop view` + `create view` (y a recuperar los grants y el
--   `security_invoker` a mano). Aquí los nombres y los tipos de las diez
--   primeras columnas son idénticos a los de `20260926120000`, así que el
--   `create or replace` basta.
--
--   Se conserva `with (security_invoker = on)`: es obligatorio en este repo
--   (razonado en `20260919130000_fix_vista_ocupacion_hoy_estados.sql`). Sin
--   esa cláusula la vista se ejecuta con los permisos de su PROPIETARIO,
--   salta la RLS de `espacios_reserva` y `mesas` y reabre la fuga al rol
--   `anon` que cerró `20260918084909_cerrar_fuga_rls_anonima.sql`. Se
--   repite en el `create or replace` porque no es heredable por descuido.
--
--   El `left join` sigue siendo LEFT a propósito: un espacio SIN mesas tiene
--   que SALIR con 0, no desaparecer. Con INNER JOIN las cuatro salas vacías
--   se volverían invisibles y la vista diría que todo cuadra.
--
--   La CTE `mesas_marcadas` calcula por mesa las tres cosas que hacen falta
--   (activa, fusionada, citada en algún `original_mesas`) para poder
--   agregarlas con `filter` sin repetir subconsultas en cada columna.
--
--   `jsonb_array_elements` reventaría con `cannot extract elements from a
--   scalar` si `original_mesas` no fuera un array; el `case` lo convierte en
--   `'[]'` antes de desplegarlo (y el `case` va DENTRO de la llamada, no en
--   un `where` de al lado, para que el planificador no pueda desplegar el
--   JSON antes de filtrarlo). La comparación es `o.elem->>'id' = m.id::text`:
--   texto contra texto, sin castear el JSON a uuid, para que un
--   `original_mesas` con basura dentro no tumbe la consulta con `invalid
--   input syntax for type uuid`. Y se busca en TODAS las filas (`f`), sin
--   filtrar por espacio ni por `is_merged`: es el criterio más conservador
--   posible para decir "esta mesa está referenciada, no la toques".
create or replace view public.vista_capacidad_espacios
with (security_invoker = on)
as
with mesas_marcadas as (
  select
    m.espacio_id                                       as espacio_id,
    m.id                                               as id,
    m.capacidad                                        as capacidad,
    (m.activa is not false)                            as esta_activa,
    coalesce(m.is_merged, false)                       as es_fusionada,
    exists (
      select 1
      from public.mesas f
      cross join lateral jsonb_array_elements(
        case
          when jsonb_typeof(f.original_mesas) = 'array' then f.original_mesas
          else '[]'::jsonb
        end
      ) as o(elem)
      where f.id <> m.id
        and o.elem->>'id' = m.id::text
    )                                                  as esta_en_original_mesas
  from public.mesas m
)
select
  e.id                                                        as espacio_id,
  e.nombre                                                    as nombre,
  coalesce(e.caracteristicas->>'marca', 'casa_tomas')         as marca,
  e.activa                                                    as activa,

  -- La que MANDA HOY: lo que el trigger `trg_validar_capacidad` suma en su
  -- paso 1 (ver 20260922190000_aforo_por_marca.sql).
  e.capacidad_maxima                                          as capacidad_declarada,

  -- CAMBIO DE SIGNIFICADO (antes: todas las activas): plazas de las mesas
  -- REALES, activas y NO fusionadas. Mismo criterio que
  -- fn_capacidad_efectiva_espacio().
  (coalesce(sum(m.capacidad) filter (
     where m.esta_activa and not m.es_fusionada), 0))::integer as plazas_mesas,

  -- Sin cambios: activas, fusionadas INCLUIDAS.
  (count(m.id) filter (where m.esta_activa))::integer         as mesas_activas,

  -- Sin cambios: filas de la tabla, activas o no.
  (count(m.id))::integer                                      as mesas_totales,

  -- Derivadas de `plazas_mesas`, así que cambian de significado con ella.
  (coalesce(sum(m.capacidad) filter (
     where m.esta_activa and not m.es_fusionada), 0)
   - coalesce(e.capacidad_maxima, 0))::integer                as diferencia,

  (coalesce(sum(m.capacidad) filter (
     where m.esta_activa and not m.es_fusionada), 0)
   = coalesce(e.capacidad_maxima, 0))                         as cuadra,

  -- ---- columnas nuevas (obligatoriamente al final) ----------------------

  -- Plazas que aportan las filas fusionadas activas. Lo que ANTES se
  -- sumaba a `plazas_mesas` y duplicaba las plazas de las originales
  -- huérfanas.
  (coalesce(sum(m.capacidad) filter (
     where m.esta_activa and m.es_fusionada), 0))::integer     as plazas_mesas_fusionadas,

  -- El valor que daba `plazas_mesas` en la versión de 20260926120000
  -- (todas las activas). Se conserva para poder comparar el antes y el
  -- después sin ir a buscar la definición vieja.
  (coalesce(sum(m.capacidad) filter (
     where m.esta_activa), 0))::integer                        as plazas_mesas_todas,

  -- *** LA CUENTA HONESTA ***: fusionadas + reales que NO aparecen en el
  -- `original_mesas` de nadie. Cuenta cada silla UNA vez tanto si la fusión
  -- borró bien las originales como si las dejó vivas. Es la columna a mirar
  -- antes de encender la regla de aforo por mesas.
  (coalesce(sum(m.capacidad) filter (
     where m.esta_activa
       and (m.es_fusionada or not m.esta_en_original_mesas)), 0))::integer
                                                              as plazas_mesas_sin_duplicar,

  (count(m.id) filter (
     where m.esta_activa and not m.es_fusionada))::integer     as mesas_reales,

  (count(m.id) filter (
     where m.esta_activa and m.es_fusionada))::integer         as mesas_fusionadas,

  -- EL MEDIDOR DEL BUG: mesas reales activas cuyo `id` está citado dentro
  -- del `original_mesas` de otra fila. Cada una es una original que el
  -- editor creyó haber borrado al fusionar y no borró. Si esto es > 0, esa
  -- sala tiene fusiones a medias.
  (count(m.id) filter (
     where m.esta_activa and not m.es_fusionada
       and m.esta_en_original_mesas))::integer                 as mesas_originales_huerfanas

from public.espacios_reserva e
left join mesas_marcadas m on m.espacio_id = e.id
group by
  e.id,
  e.nombre,
  e.caracteristicas,
  e.activa,
  e.capacidad_maxima;

comment on view public.vista_capacidad_espacios is
  'INFORMATIVA — no la usa el aforo. Compara, por espacio, la capacidad declarada (espacios_reserva.capacidad_maxima, la que MANDA HOY en trg_validar_capacidad) con las plazas del plano. Incluye espacios inactivos y espacios sin mesas (LEFT JOIN, 0 plazas). CUIDADO CON EL SIGNIFICADO DE LAS COLUMNAS, cambió en 20260927100000: plazas_mesas son las mesas REALES (activas y NO fusionadas) y por arrastre diferencia y cuadra también; plazas_mesas_todas es el total de activas, que es lo que plazas_mesas valía antes; plazas_mesas_fusionadas son solo las filas is_merged; mesas_activas sigue contando todas las activas (= mesas_reales + mesas_fusionadas) y mesas_totales todas las filas. SE EXCLUYEN LAS FUSIONADAS porque el editor de plano borra las mesas originales con un delete que no comprueba el error (los dos delete de handleSave en EditorPlanoEspacio.tsx, ~572 el de las originales absorbidas por una fusión y ~609 el de la fila fusionada al desfusionar; los números se mueven, el ancla es handleSave) y supabase-js RESUELVE en vez de rechazar cuando la RLS o una FK lo rechazan: el borrado falla en silencio, el usuario ve Plano guardado correctamente y queda la fila fusionada junto a las originales, con lo que sumarlas todas cuenta las mismas plazas dos veces (el Salón daba 64 en vez de 36). mesas_originales_huerfanas cuenta exactamente esas originales que se creyeron borradas: si es > 0, esa sala tiene fusiones a medias. PERO excluir TODAS las fusionadas se queda corto cuando la fusión sí borró bien las originales (la Terraza tiene 3 filas, las 3 fusionadas, 12 plazas y 0 huérfanas: plazas_mesas dice 0 teniendo 12 reales). Para eso está plazas_mesas_sin_duplicar = fusionadas + reales no huérfanas: cuenta cada silla UNA vez en los dos escenarios y es la columna que hay que cuadrar ANTES de encender la regla de capacidad efectiva.';

-- ---------------------------------------------------------------------------
-- 4. GRANTS — nunca a `anon` ni a `public`
-- ---------------------------------------------------------------------------
--   Un `create or replace` CONSERVA los permisos del objeto, así que esto no
--   hace falta estrictamente. Se repite porque es barato, es idempotente y
--   documenta la intención — y porque si estos tres objetos no existían
--   (caso en que `20260926120000` no estuviera aplicada), este bloque es lo
--   único que los deja con los permisos correctos.
--
--   Mismo patrón que el final de `20260926120000` y de
--   `20260923210000_solicitud_propuesta_espacio.sql`: `revoke all` de
--   `public` y `anon` primero (por si algún `alter default privileges`
--   reparte permisos de serie) y `grant` explícito solo a `authenticated` y
--   `service_role`. Importa sobre todo en las funciones: son SECURITY
--   DEFINER, saltan la RLS de `mesas`, y dárselas a `anon` sería regalar el
--   aforo a cualquiera con la anon key.
revoke all on public.vista_capacidad_espacios from public, anon;
grant select on public.vista_capacidad_espacios to authenticated, service_role;

revoke all on function public.fn_capacidad_efectiva_espacio(uuid) from public, anon;
grant execute on function public.fn_capacidad_efectiva_espacio(uuid) to authenticated, service_role;

revoke all on function public.fn_capacidad_efectiva_marca(text) from public, anon;
grant execute on function public.fn_capacidad_efectiva_marca(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. LIMPIEZA DE NOMBRES — idempotente y SIN BORRAR NADA
-- ---------------------------------------------------------------------------
--   Genérico, no cableado a ids: resuelve lo que encuentre en la tabla el
--   día que se aplique. Dos cosas a la vez, en una sola pasada:
--
--     a) DUPLICADOS: para cada grupo (espacio_id, nombre normalizado) de
--        mesas reales con más de una fila, deja UNA con su nombre y renombra
--        las demás a `<nombre> (revisar)`.
--
--        Cuál se queda, de forma determinista y documentada:
--          1º la que TIENE asignaciones (renombrar la que está en uso sería
--             lo más confuso para el encargado),
--          2º la que está citada en algún `original_mesas`,
--          3º la más ANTIGUA por `created_at` (los NULL cuentan como las más
--             antiguas: son filas previas al default),
--          4º y a igualdad, el `id` menor.
--        Las demás, renombradas por ese mismo orden.
--
--     b) SOSPECHOSAS: nombre normalizado de un solo carácter sin dígitos
--        (el caso "o" del Comedor). Se renombra siempre, y se DESACTIVA solo
--        si no tiene asignaciones ni aparece en ningún `original_mesas`.
--        Ver arriba "QUÉ SE CONSIDERA NOMBRE SOSPECHOSO".
--
--   Idempotente: tras la primera pasada los nombres tocados miden más de un
--   carácter y ya no se repiten, así que una segunda ejecución no hace nada.
--   Si el dueño devuelve un nombre a "9" y vuelve a duplicarlo, se vuelve a
--   marcar — que es lo que se quiere.
--
--   El nombre nuevo se busca comprobando que esté libre EN LA MISMA SALA
--   (` (revisar)`, ` (revisar 2)`, ` (revisar 3)`...), mirando la tabla en
--   vivo dentro de la transacción, así que dos duplicados de un mismo número
--   no pueden acabar los dos con el mismo nombre nuevo. Y se recorta a 50
--   caracteres porque `mesas.nombre` es `varchar(50)`: sin el `left()`, un
--   nombre largo reventaría el `update` con `value too long`.
--
--   Cada fila tocada deja un `raise notice`. Eso sale por la salida de
--   `supabase db push` / del editor SQL: conviene guardarla, porque es el
--   único registro de qué nombre tenía cada mesa ANTES (el rollback no
--   puede reponerlos).
do $do$
declare
  r              record;
  v_base         text;
  v_nuevo        text;
  v_intento      integer;
  v_desactivar   boolean;
  v_renombradas  integer := 0;
  v_desactivadas integer := 0;
begin
  -- Subconsultas anidadas en vez de un `with`: un `FOR ... IN` de PL/pgSQL
  -- que empieza por SELECT no tiene ninguna ambigüedad de parseo en ninguna
  -- versión de Postgres. Las funciones de ventana necesitan un nivel de
  -- subconsulta de todos modos.
  for r in
    select
      c.id                                                          as id,
      c.espacio_id                                                  as espacio_id,
      c.nombre                                                      as nombre,
      c.nombre_norm                                                 as nombre_norm,
      c.capacidad                                                   as capacidad,
      c.tiene_asignaciones                                          as tiene_asignaciones,
      c.esta_referenciada                                           as esta_referenciada,
      e.nombre                                                      as espacio_nombre,
      (c.cuantas > 1 and c.puesto > 1)                              as es_duplicada,
      (length(c.nombre_norm) = 1 and c.nombre_norm !~ '[0-9]')      as es_sospechosa
    from (
      select
        r0.*,
        row_number() over (
          partition by r0.espacio_id, r0.nombre_norm
          order by r0.tiene_asignaciones desc,
                   r0.esta_referenciada  desc,
                   r0.created_at         asc nulls first,
                   r0.id                 asc
        )                                                           as puesto,
        count(*) over (partition by r0.espacio_id, r0.nombre_norm)  as cuantas
      from (
        select
          m.id                                                      as id,
          m.espacio_id                                              as espacio_id,
          m.nombre                                                  as nombre,
          m.capacidad                                               as capacidad,
          m.created_at                                              as created_at,
          lower(btrim(regexp_replace(m.nombre, '\s+', ' ', 'g')))   as nombre_norm,
          exists (
            select 1 from public.asignaciones_mesa a where a.mesa_id = m.id
          )                                                         as tiene_asignaciones,
          exists (
            select 1
            from public.mesas f
            cross join lateral jsonb_array_elements(
              case
                when jsonb_typeof(f.original_mesas) = 'array' then f.original_mesas
                else '[]'::jsonb
              end
            ) as o(elem)
            where f.id <> m.id
              and o.elem->>'id' = m.id::text
          )                                                         as esta_referenciada
        from public.mesas m
        where coalesce(m.is_merged, false) = false
          and coalesce(m.activa, true) = true
      ) r0
    ) c
    join public.espacios_reserva e on e.id = c.espacio_id
    where (c.cuantas > 1 and c.puesto > 1)
       or (length(c.nombre_norm) = 1 and c.nombre_norm !~ '[0-9]')
    order by e.nombre, c.nombre_norm, c.puesto
  loop
    -- Nombre libre en la misma sala, determinista y que quepa en varchar(50).
    -- ' (revisar)' son 10 caracteres -> 40 + 10 = 50.
    -- ' (revisar NN)' son 13 -> 36 + 13 = 49.
    v_base    := btrim(coalesce(r.nombre, ''));
    v_intento := 1;
    loop
      if v_intento = 1 then
        v_nuevo := btrim(left(v_base, 40)) || ' (revisar)';
      else
        v_nuevo := btrim(left(v_base, 36)) || ' (revisar ' || v_intento || ')';
      end if;

      exit when not exists (
        select 1
        from public.mesas x
        where x.espacio_id = r.espacio_id
          and x.id <> r.id
          and coalesce(x.is_merged, false) = false
          and coalesce(x.activa, true) = true
          and lower(btrim(regexp_replace(x.nombre, '\s+', ' ', 'g')))
              = lower(btrim(regexp_replace(v_nuevo, '\s+', ' ', 'g')))
      );

      v_intento := v_intento + 1;
      if v_intento > 50 then
        raise exception
          'MESAS_NOMBRE_SIN_HUECO: no hay ningún nombre libre para la mesa % ("%") de la sala "%". Renómbrala a mano y vuelve a aplicar la migración.',
          r.id, r.nombre, r.espacio_nombre;
      end if;
    end loop;

    v_desactivar := r.es_sospechosa
                    and not r.tiene_asignaciones
                    and not r.esta_referenciada;

    if v_desactivar then
      update public.mesas
         set nombre     = v_nuevo,
             activa     = false,
             updated_at = now()
       where id = r.id;
      v_desactivadas := v_desactivadas + 1;
      raise notice
        'mesas: "%" (sala "%", % plazas) -> "%" y DESACTIVADA. Nombre de un solo carácter sin dígitos, sin asignaciones y sin aparecer en ningún original_mesas. Sus % plazas dejan de contar en plazas_mesas; si la mesa existe de verdad, reactívala y renómbrala desde el editor de plano.',
        r.nombre, r.espacio_nombre, r.capacidad, v_nuevo, r.capacidad;
    else
      update public.mesas
         set nombre     = v_nuevo,
             updated_at = now()
       where id = r.id;
      v_renombradas := v_renombradas + 1;
      if r.es_duplicada then
        raise notice
          'mesas: "%" (sala "%") -> "%". Número repetido en la misma sala. Sigue ACTIVA y con sus % plazas: decide a mano qué número le toca.',
          r.nombre, r.espacio_nombre, v_nuevo, r.capacidad;
      else
        raise notice
          'mesas: "%" (sala "%") -> "%". Nombre sospechoso, pero NO se desactiva: tiene asignaciones (%) o está citada en un original_mesas (%).',
          r.nombre, r.espacio_nombre, v_nuevo, r.tiene_asignaciones, r.esta_referenciada;
      end if;
    end if;
  end loop;

  raise notice
    'mesas: limpieza de nombres terminada. % renombradas y activas, % renombradas y desactivadas. Ninguna fila borrada.',
    v_renombradas, v_desactivadas;
end
$do$;

-- ---------------------------------------------------------------------------
-- 6. ¿QUEDA ALGÚN DUPLICADO? — parar con un error LEGIBLE si sí
-- ---------------------------------------------------------------------------
--   Sin esto, un duplicado que la limpieza no hubiera podido resolver haría
--   fallar el `create unique index` de abajo con el mensaje de Postgres
--   ("could not create unique index ... Key (espacio_id, lower(...))=(...)
--   is duplicated"), que no dice en qué SALA está el problema ni cuántos
--   hay. Este bloque lo dice en español, con la sala y el nombre, y aborta
--   la transacción entera: no queda nada a medias.
--
--   En teoría no debería dispararse nunca — la limpieza de arriba resuelve
--   cualquier duplicado. Está por si alguien aplica la migración con datos
--   que han cambiado bajo los pies, o por si una condición de carrera mete
--   una mesa nueva mientras corre.
do $do$
declare
  v_grupos  integer;
  v_detalle text;
begin
  select count(*),
         string_agg(
           format('sala "%s" (%s): nombre "%s" repetido %s veces',
                  coalesce(e.nombre, '?'), d.espacio_id, d.nombre_norm, d.cuantas),
           '; ' order by coalesce(e.nombre, '?'), d.nombre_norm)
    into v_grupos, v_detalle
  from (
    select
      m.espacio_id                                            as espacio_id,
      lower(btrim(regexp_replace(m.nombre, '\s+', ' ', 'g'))) as nombre_norm,
      count(*)                                                as cuantas
    from public.mesas m
    where coalesce(m.is_merged, false) = false
      and coalesce(m.activa, true) = true
    group by 1, 2
    having count(*) > 1
  ) d
  left join public.espacios_reserva e on e.id = d.espacio_id;

  if coalesce(v_grupos, 0) > 0 then
    raise exception
      'MESAS_NOMBRES_DUPLICADOS: quedan % números de mesa duplicados, así que no se puede crear el índice único uq_mesas_espacio_nombre_real: %. Resuélvelos a mano (renombra o desactiva una de cada pareja desde el editor de plano) y vuelve a aplicar la migración.',
      v_grupos, v_detalle;
  end if;

  raise notice 'mesas: no quedan nombres duplicados entre mesas reales; se puede crear el índice único.';
end
$do$;

-- ---------------------------------------------------------------------------
-- 7. EL ÍNDICE ÚNICO PARCIAL (el núcleo del encargo)
-- ---------------------------------------------------------------------------
--   Un número de mesa, una sala: UNA mesa. Garantizado POR LA BASE DE DATOS
--   y no por la pantalla, que es lo que faltaba: hasta hoy `mesas_pkey`
--   (sobre `id`) era el único índice de la tabla.
--
--   PARCIAL, y las dos condiciones son deliberadas:
--
--     · `coalesce(is_merged, false) = false` — las fusionadas quedan FUERA.
--       Sus nombres son compuestos ("2+1", "11+10") y los pone el editor,
--       no una persona; además conviven a propósito con las originales
--       cuando la fusión se quedó a medias, y si entraran en el índice una
--       fusión legítima podría chocar con un nombre ya existente y hacer
--       fallar el guardado del plano.
--     · `coalesce(activa, true) = true` — las inactivas también quedan
--       fuera, para que el dueño pueda DESACTIVAR una mesa y reutilizar su
--       número en otra sin pelearse con la base. Mismo criterio que
--       `activa is not false` de las funciones, escrito con `coalesce`
--       porque en un predicado de índice se lee más claro.
--
--   La expresión normalizada es la misma que usa la pantalla; ver el bloque
--   "NORMALIZACIÓN DEL NOMBRE" de la cabecera, incluido el motivo de que el
--   `btrim` vaya DESPUÉS del `regexp_replace` y no antes.
--
--   SIN `concurrently` a propósito: `create index concurrently` no puede
--   ejecutarse dentro de una transacción, y esto va dentro de la de la
--   migración. La tabla tiene 20 filas: el bloqueo dura lo que tarda en no
--   hacer nada.
--
--   `if not exists` para que reaplicar la migración no falle.
create unique index if not exists uq_mesas_espacio_nombre_real
  on public.mesas (
    espacio_id,
    (lower(btrim(regexp_replace(nombre, '\s+', ' ', 'g'))))
  )
  where coalesce(is_merged, false) = false
    and coalesce(activa, true) = true;

comment on index public.uq_mesas_espacio_nombre_real is
  'Un número de mesa no se puede repetir dentro de la misma sala. ÚNICO y PARCIAL sobre (espacio_id, nombre normalizado) con nombre normalizado = lower(btrim(regexp_replace(nombre, whitespace+, espacio, g))), la misma normalización que normalizarNombreMesa() en src/components/espacios/nombresMesa.ts (colapsar primero y recortar después, porque btrim de un argumento solo quita espacios y .trim() de JavaScript quita también tabuladores). Deja FUERA las mesas fusionadas (is_merged: sus nombres son compuestos, los pone el editor, y conviven con las originales cuando la fusión se quedó a medias) y las inactivas (para poder desactivar una mesa y reutilizar su número). Creado por 20260927100000_mesas_numero_fiable.sql después de renombrar los duplicados que había en producción (dos mesas "9" en el Salón) y la mesa "o" del Comedor. Borrarlo reabre los números de mesa duplicados.';

commit;

-- ===========================================================================
-- CONSULTAS PREVIAS — EJECUTAR ANTES DE APLICAR (solo lectura)
-- ---------------------------------------------------------------------------
-- Ninguna escribe nada. Sirven para ver qué va a tocar la migración y para
-- guardar el estado de partida: los nombres originales NO se pueden reponer
-- automáticamente después.
-- ---------------------------------------------------------------------------
--
-- -- 1) FOTO COMPLETA de la tabla (20 filas a 2026-09-27). Guardar el
-- --    resultado: es el único respaldo de los nombres actuales.
-- select e.nombre                                                   as sala,
--        m.id, m.nombre, m.capacidad, m.activa, m.is_merged,
--        lower(btrim(regexp_replace(m.nombre, '\s+', ' ', 'g')))    as nombre_norm,
--        m.created_at,
--        (select count(*) from public.asignaciones_mesa a where a.mesa_id = m.id) as asignaciones
-- from public.mesas m
-- join public.espacios_reserva e on e.id = m.espacio_id
-- order by e.nombre, nombre_norm, m.created_at;
--
-- -- 2) QUÉ DUPLICADOS HAY, y cuál se va a quedar con el nombre (puesto = 1)
-- --    y cuáles se van a renombrar (puesto > 1):
-- with reales as (
--   select m.id, m.espacio_id, m.nombre, m.created_at,
--          lower(btrim(regexp_replace(m.nombre, '\s+', ' ', 'g'))) as nombre_norm,
--          exists (select 1 from public.asignaciones_mesa a where a.mesa_id = m.id) as tiene_asignaciones,
--          exists (
--            select 1 from public.mesas f
--            cross join lateral jsonb_array_elements(
--              case when jsonb_typeof(f.original_mesas) = 'array' then f.original_mesas else '[]'::jsonb end
--            ) as o
--            where f.id <> m.id and o->>'id' = m.id::text
--          ) as esta_referenciada
--   from public.mesas m
--   where coalesce(m.is_merged, false) = false
--     and coalesce(m.activa, true) = true
-- )
-- select e.nombre as sala, r.nombre, r.nombre_norm, r.id,
--        r.tiene_asignaciones, r.esta_referenciada, r.created_at,
--        row_number() over (
--          partition by r.espacio_id, r.nombre_norm
--          order by r.tiene_asignaciones desc, r.esta_referenciada desc,
--                   r.created_at asc nulls first, r.id asc
--        ) as puesto
-- from reales r
-- join public.espacios_reserva e on e.id = r.espacio_id
-- where (r.espacio_id, r.nombre_norm) in (
--   select espacio_id, nombre_norm from reales group by 1, 2 having count(*) > 1
-- )
-- order by e.nombre, r.nombre_norm, puesto;
--   -- esperado (datos de 2026-09-27): 2 filas, las dos mesas "9" del Salón.
--
-- -- 3) *** LA IMPORTANTE ***: qué mesas se van a DESACTIVAR y qué mesas solo
-- --    se van a renombrar. Si aquí sale alguna mesa que existe de verdad,
-- --    renómbrala a mano ANTES de aplicar la migración.
-- select e.nombre as sala, m.id, m.nombre, m.capacidad,
--        (select count(*) from public.asignaciones_mesa a where a.mesa_id = m.id) as asignaciones,
--        exists (
--          select 1 from public.mesas f
--          cross join lateral jsonb_array_elements(
--            case when jsonb_typeof(f.original_mesas) = 'array' then f.original_mesas else '[]'::jsonb end
--          ) as o
--          where f.id <> m.id and o->>'id' = m.id::text
--        ) as esta_referenciada,
--        case
--          when not exists (select 1 from public.asignaciones_mesa a where a.mesa_id = m.id)
--           and not exists (
--             select 1 from public.mesas f
--             cross join lateral jsonb_array_elements(
--               case when jsonb_typeof(f.original_mesas) = 'array' then f.original_mesas else '[]'::jsonb end
--             ) as o
--             where f.id <> m.id and o->>'id' = m.id::text
--           )
--          then 'SE DESACTIVA y se renombra'
--          else 'solo se renombra (sigue activa)'
--        end as que_le_pasa
-- from public.mesas m
-- join public.espacios_reserva e on e.id = m.espacio_id
-- where coalesce(m.is_merged, false) = false
--   and coalesce(m.activa, true) = true
--   and length(lower(btrim(regexp_replace(m.nombre, '\s+', ' ', 'g')))) = 1
--   and lower(btrim(regexp_replace(m.nombre, '\s+', ' ', 'g'))) !~ '[0-9]'
-- order by e.nombre, m.nombre;
--   -- esperado (datos de 2026-09-27): 1 fila, la mesa "o" del Comedor.
--
-- -- 4) LAS FUSIONES A MEDIAS: originales que el editor creyó borrar y no
-- --    borró, con el nombre de la fila fusionada que las cita. Esta es la
-- --    prueba del bug del `delete` sin comprobar el error.
-- select e.nombre as sala,
--        f.nombre as fusionada, f.capacidad as cap_fusionada,
--        o->>'nombre' as original_en_json,
--        orig.id as original_viva, orig.nombre, orig.capacidad
-- from public.mesas f
-- cross join lateral jsonb_array_elements(
--   case when jsonb_typeof(f.original_mesas) = 'array' then f.original_mesas else '[]'::jsonb end
-- ) as o
-- join public.mesas orig on orig.id::text = o->>'id'
-- join public.espacios_reserva e on e.id = f.espacio_id
-- where coalesce(f.is_merged, false) = true
-- order by e.nombre, f.nombre;
--   -- 0 filas en una sala = sus fusiones borraron bien las originales, y
--   -- entonces excluir las fusionadas INFRAVALORA esa sala (caso Terraza).
--
-- ===========================================================================

-- ===========================================================================
-- CONSULTAS DE VERIFICACIÓN — EJECUTAR DESPUÉS DE APLICAR (solo lectura)
-- ---------------------------------------------------------------------------
-- **NO SE HAN EJECUTADO**: esta migración se entrega sin aplicar y sin poder
-- leer la base de datos (MCP de Supabase sin autorizar en la sesión en que
-- se escribió). Las cifras "esperado" salen de la lectura del dueño del
-- 2026-09-27 y hay que confirmarlas.
-- ---------------------------------------------------------------------------
--
-- -- 1) EL NÚMERO QUE IMPORTA: plazas por sala, antes y después, en la misma
-- --    fila. `plazas_mesas` es el nuevo valor (reales), `plazas_mesas_todas`
-- --    el viejo, y `plazas_mesas_sin_duplicar` el honesto.
-- select nombre as sala, marca, activa,
--        capacidad_declarada,
--        plazas_mesas,                 -- NUEVO: activas y no fusionadas
--        plazas_mesas_todas,           -- lo que daba la vista vieja
--        plazas_mesas_fusionadas,
--        plazas_mesas_sin_duplicar,    -- la cuenta que no duplica ni pierde
--        mesas_reales, mesas_fusionadas, mesas_activas, mesas_totales,
--        mesas_originales_huerfanas,
--        diferencia, cuadra
-- from public.vista_capacidad_espacios
-- order by marca, nombre;
--   -- esperado (7 filas). Para las tres salas con mesas, según los datos
--   -- del 2026-09-27 y SI la mesa "o" del Comedor se desactiva:
--   --
--   --   sala     declarada  plazas_mesas      plazas_mesas_todas
--   --   Comedor  50         4 - cap("o")      4 - cap("o")
--   --   Salón    50         36                64
--   --   Terraza  50         0                 12
--   --
--   -- Comedor tiene 2 filas y 4 plazas entre las dos; al desactivar "o" se
--   -- va su capacidad, que no se ha podido leer (no se sabe si es 2, 3 o 4).
--   -- Si "o" resultara tener asignaciones, NO se desactiva y Comedor se
--   -- queda en 4. Salón: 8 reales (36) + 7 fusionadas (28) = 64.
--   -- Terraza: sus 3 filas son las 3 fusionadas, así que plazas_mesas = 0
--   -- aunque `plazas_mesas_sin_duplicar` siga diciendo 12. LEER EL PUNTO 3
--   -- DEL BUG 1 EN LA CABECERA ANTES DE ALARMARSE.
--
-- -- 2) Las funciones y la vista dicen lo mismo, sala por sala:
-- select v.nombre, v.plazas_mesas,
--        public.fn_capacidad_efectiva_espacio(v.espacio_id) as segun_funcion
-- from public.vista_capacidad_espacios v
-- where v.plazas_mesas <> public.fn_capacidad_efectiva_espacio(v.espacio_id);
--   -- esperado: 0 filas
--
-- -- 3) Y por marca, que es como validaría el aforo si algún día se enciende:
-- select coalesce(e.caracteristicas->>'marca', 'casa_tomas')     as marca,
--        sum(e.capacidad_maxima)                                 as declarado_hoy,
--        public.fn_capacidad_efectiva_marca(
--          coalesce(e.caracteristicas->>'marca', 'casa_tomas'))  as efectivo_mesas
-- from public.espacios_reserva e
-- where e.activa = true
-- group by 1
-- order by 1;
--   -- esperado: casa_tomas | 170 | 36 + (4 - cap("o"))   ~ 38-40
--   --           touza      |  80 | 0
--   -- El `declarado_hoy` es lo que sigue mandando de verdad. NO ENCENDER LA
--   -- REGLA con estos números.
--
-- -- 4) No queda ningún número de mesa repetido entre mesas reales:
-- select m.espacio_id,
--        lower(btrim(regexp_replace(m.nombre, '\s+', ' ', 'g'))) as nombre_norm,
--        count(*)
-- from public.mesas m
-- where coalesce(m.is_merged, false) = false
--   and coalesce(m.activa, true) = true
-- group by 1, 2
-- having count(*) > 1;
--   -- esperado: 0 filas
--
-- -- 5) El índice existe, es único, es parcial y NO es concurrente/inválido:
-- select i.relname, ix.indisunique, ix.indisvalid,
--        pg_get_indexdef(ix.indexrelid) as definicion
-- from pg_index ix
-- join pg_class i on i.oid = ix.indexrelid
-- where ix.indrelid = 'public.mesas'::regclass
-- order by i.relname;
--   -- esperado: aparece uq_mesas_espacio_nombre_real con indisunique = true,
--   -- indisvalid = true, y un WHERE en la definición. Y sigue estando
--   -- mesas_pkey.
--
-- -- 6) El índice HACE SU TRABAJO (prueba real, en una transacción que se
-- --    deshace — NO deja nada escrito):
-- --      begin;
-- --      insert into public.mesas (espacio_id, nombre, capacidad)
-- --      select espacio_id, nombre, 2
-- --      from public.mesas
-- --      where coalesce(is_merged, false) = false and coalesce(activa, true) = true
-- --      limit 1;
-- --      -- esperado: ERROR duplicate key value violates unique constraint
-- --      --           "uq_mesas_espacio_nombre_real"
-- --      rollback;
-- --    Y que mayúsculas y espacios también chocan (misma prueba con
-- --    `upper(nombre) || '  '` en vez de `nombre`): tiene que fallar igual.
--
-- -- 7) Qué filas quedaron marcadas para que las revise el dueño:
-- select e.nombre as sala, m.id, m.nombre, m.capacidad, m.activa
-- from public.mesas m
-- join public.espacios_reserva e on e.id = m.espacio_id
-- where m.nombre like '%(revisar%'
-- order by e.nombre, m.nombre;
--   -- Cada una hay que resolverla desde el editor de plano: darle su número
--   -- de verdad, o desactivarla si no existe.
--
-- -- 8) Las funciones siguen endurecidas (SECURITY DEFINER, STABLE,
-- --    search_path fijado) y sin permisos para anon/public:
-- select p.proname, p.prosecdef, p.provolatile, p.proconfig, p.proacl::text
-- from pg_proc p
-- where p.pronamespace = 'public'::regnamespace
--   and p.proname in ('fn_capacidad_efectiva_espacio', 'fn_capacidad_efectiva_marca');
--   -- esperado en ambas: prosecdef = true, provolatile = 's',
--   --                    proconfig = {search_path=public},
--   --                    y ni `anon` ni `PUBLIC` en proacl.
--
-- -- 9) La vista conserva security_invoker (si esto no sale 'on', salta la RLS
-- --    de espacios_reserva/mesas: arreglarlo ANTES de dar SELECT a nadie):
-- select c.relname, c.reloptions, c.relacl::text
-- from pg_class c
-- join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public' and c.relname = 'vista_capacidad_espacios';
--   -- esperado: reloptions = {security_invoker=on}, y sin anon/PUBLIC en relacl
--
-- -- 10) Y que el aforo NO se ha encendido por error: el trigger sigue
-- --     sumando capacidad_maxima y NO llama a fn_capacidad_efectiva_marca.
-- select pg_get_functiondef('public.validar_capacidad_reserva()'::regprocedure) like '%SUM(capacidad_maxima)%'     as suma_declarada,
--        pg_get_functiondef('public.validar_capacidad_reserva()'::regprocedure) like '%fn_capacidad_efectiva_marca%' as usa_las_mesas;
--   -- esperado: suma_declarada = true, usa_las_mesas = false
-- ---------------------------------------------------------------------------
