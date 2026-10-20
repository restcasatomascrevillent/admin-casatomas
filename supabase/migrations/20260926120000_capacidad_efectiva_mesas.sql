-- ===========================================================================
-- ##                                                                       ##
-- ##                          NO APLICADA                                  ##
-- ##                                                                       ##
-- ##   Estado a 2026-09-26: este fichero queda ESCRITO Y LISTO pero SIN     ##
-- ##   APLICAR. `supabase db push` está BLOQUEADO porque el historial       ##
-- ##   local y el remoto no coinciden: un compañero aplicó en producción    ##
-- ##   `20260925150523` y `20260925154109` SIN commitear los ficheros, así  ##
-- ##   que `supabase_migrations.schema_migrations` tiene dos versiones que  ##
-- ##   no existen en `supabase/migrations/`. Hasta que esas dos migraciones ##
-- ##   se recuperen y se commiteen (o se repare el historial), cualquier    ##
-- ##   push falla o arrastraría cambios ajenos.                            ##
-- ##                                                                       ##
-- ##   Por tanto NADA de lo que hay aquí abajo existe todavía en la base    ##
-- ##   de datos, y NINGUNA de las consultas de verificación del final se    ##
-- ##   ha ejecutado. Los datos de producción que se citan en el bloque      ##
-- ##   "QUÉ PASARÍA SI SE ENCENDIERA HOY" sí están verificados (lectura     ##
-- ##   directa, 2026-09-26); lo que no se ha podido comprobar es el         ##
-- ##   despliegue de la vista y las funciones de este fichero.             ##
-- ##                                                                       ##
-- ===========================================================================
--
-- ENCARGO (dueño, 2026-09-26)
--
--   "Que mande la suma de las mesas; para eso lo dejamos cableado, y de
--    momento seguimos con la capacidad total."
--
--   Es decir: dejar CONSTRUIDA la infraestructura para calcular la
--   capacidad efectiva de un espacio como la SUMA de las plazas de sus
--   mesas activas, pero DORMIDA. Hoy sigue mandando
--   `espacios_reserva.capacidad_maxima`, exactamente igual que ayer. El día
--   que el dueño lo encienda, el cambio tiene que ser mínimo y reversible.
--
-- QUÉ HACE ESTA MIGRACIÓN
--
--   Solo AÑADE tres objetos de lectura que HOY NO LLAMA NADIE:
--
--     1. Vista    `public.vista_capacidad_espacios`         (informativa)
--     2. Función  `public.fn_capacidad_efectiva_espacio(uuid)`
--     3. Función  `public.fn_capacidad_efectiva_marca(text)`
--
--   Las dos funciones son las piezas que usaría el trigger de aforo el día
--   que se encienda la regla. La vista es la herramienta de diagnóstico
--   para ver, espacio por espacio, cuánto se separa el plano real de la
--   capacidad declarada — que es lo que hay que cuadrar ANTES de encender
--   nada (ver el bloque "QUÉ PASARÍA SI SE ENCENDIERA HOY").
--
-- QUÉ **NO** HACE ESTA MIGRACIÓN (crítico)
--
--   NO toca el trigger de aforo. Ni un `CREATE OR REPLACE FUNCTION
--   public.validar_capacidad_reserva()`, ni un `DROP TRIGGER`, ni un
--   `ALTER TRIGGER` sobre `trg_validar_capacidad`. El comportamiento del
--   aforo queda EXACTAMENTE igual: el paso 1 del trigger sigue sumando
--   `capacidad_maxima` de los espacios activos de la marca, tal como lo
--   dejó `20260922190000_aforo_por_marca.sql`.
--
--   Ni una sola reserva cambia de resultado por aplicar este fichero. No
--   toca tablas, ni datos, ni políticas RLS, ni el motor de estimación del
--   cliente (`supabase/functions/_shared/disponibilidad.ts`).
--
-- ---------------------------------------------------------------------------
-- POR QUÉ SUMAR **TODAS** LAS MESAS ACTIVAS NO DUPLICA PLAZAS
-- (leer esto antes de "corregir" la vista añadiendo `and is_merged = false`)
-- ---------------------------------------------------------------------------
--
--   `public.mesas` tiene `is_merged boolean` y `original_mesas jsonb`, así
--   que la primera reacción al leer la vista es pensar que una mesa
--   fusionada convive con las mesas originales que la componen y que
--   sumarlas todas contaría las mismas plazas dos veces. NO ES ASÍ.
--
--   Cuando el editor de plano fusiona mesas
--   (`src/components/espacios/EditorPlanoEspacio.tsx`, sobre la línea 183)
--   **BORRA las filas originales**:
--
--     // Eliminar mesas originales que ahora forman parte de mesas fusionadas
--     for (const originalId of idsOriginalesFusionadas) {
--       await supabase.from('mesas').delete().eq('id', originalId);
--     }
--
--   e inmediatamente inserta UNA fila nueva con `is_merged: true` y la
--   `capacidad` combinada del grupo. `original_mesas` guarda el detalle de
--   las que había (para poder deshacer la fusión en la UI), pero esas filas
--   YA NO EXISTEN en la tabla.
--
--   Conclusión: el conjunto de filas de `mesas` es en todo momento una
--   PARTICIÓN de las plazas del espacio, fusionadas o no. Sumar `capacidad`
--   de todas las mesas activas es correcto y **no hay que excluir
--   `is_merged`**. Excluirlas sería el bug: se perderían justo las plazas de
--   los grupos grandes, que son los que más pesan en el aforo.
--
-- ---------------------------------------------------------------------------
-- CRITERIO DE "MESA ACTIVA": `activa IS NOT FALSE`, no `activa = true`
-- ---------------------------------------------------------------------------
--
--   `mesas.activa` es `boolean DEFAULT true` pero NO es `NOT NULL`. Con
--   `activa = true` una fila con `activa IS NULL` (insertada por cualquier
--   camino que no pase por el default) desaparecería silenciosamente del
--   aforo: plazas reales que el sistema dejaría de contar. `activa IS NOT
--   FALSE` solo excluye lo que alguien marcó explícitamente como inactivo,
--   que es la intención del campo. Mismo espíritu que los `COALESCE(...,
--   'casa_tomas')` de `20260922190000`: ningún lado del cálculo se cae del
--   aforo por un NULL.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ LA VISTA LLEVA `WITH (security_invoker = on)`
-- ---------------------------------------------------------------------------
--
--   Es OBLIGATORIO en este repo y hay precedente explícito:
--   `20260919130000_fix_vista_ocupacion_hoy_estados.sql` lo declara y
--   explica que una vista sin esa cláusula se ejecuta con los permisos de
--   su PROPIETARIO, no del que consulta, así que salta la RLS de las tablas
--   de debajo y REABRE la fuga de datos al rol `anon` que cerró
--   `20260918084909_cerrar_fuga_rls_anonima.sql`. Con `security_invoker =
--   on` la vista respeta las políticas RLS de `espacios_reserva` y `mesas`
--   tal como las vería quien la consulta. Se declara desde el minuto uno
--   para que ningún `CREATE OR REPLACE VIEW` futuro se la coma por olvido.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ LAS FUNCIONES LLEVAN `SET search_path = 'public'`
-- ---------------------------------------------------------------------------
--
--   Convención dura del repo, razonada en
--   `20260922210000_search_path_validar_capacidad.sql` y aplicada en bloque
--   en `20260922200000_endurecer_funciones.sql`: una función
--   `SECURITY DEFINER` con `search_path` mutable se puede inducir a
--   resolver `mesas` o `espacios_reserva` contra objetos de otro esquema
--   (p. ej. `pg_temp`) y falsear el resultado. Es el vector clásico de
--   escalada en funciones DEFINER, y aquí importa doble porque
--   `fn_capacidad_efectiva_marca` está pensada para acabar DENTRO del
--   trigger que decide el aforo. Se usa `'public'` (no `''`) porque el
--   cuerpo referencia las tablas del esquema público.
--
--   Son `SECURITY DEFINER` a propósito: el aforo tiene que salir igual
--   quien quiera que esté insertando la reserva (incluido el formulario web
--   vía `anon`/`service_role`), sin depender de si ese rol puede o no leer
--   `mesas` por RLS. Lo que devuelven es un agregado de aforo, no un dato
--   personal.
--
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. VISTA `public.vista_capacidad_espacios` — informativa, no la usa nadie
-- ---------------------------------------------------------------------------
--   Una fila por espacio, TODOS los espacios (activos e inactivos: hace
--   falta ver también los apagados para saber qué hay pendiente de cuadrar
--   antes de reactivarlos).
--
--   `LEFT JOIN` sobre `mesas` a propósito: un espacio SIN mesas tiene que
--   SALIR con `plazas_mesas = 0`, no desaparecer de la vista. Es justo el
--   caso que hay que ver (hoy: 4 de los 7 espacios están así, y son los que
--   bloquearían el aforo — ver el bloque de abajo). Con un INNER JOIN esos
--   espacios se volverían invisibles y la vista diría que todo cuadra.
--
--   Cuidado con los `coalesce`:
--     - `sum(...) FILTER (...)` devuelve NULL si ninguna fila pasa el
--       filtro (espacio sin mesas, o con todas inactivas) -> `coalesce(..,0)`.
--     - `count(m.id)` ya devuelve 0 en el LEFT JOIN sin pareja, porque
--       `count(<columna>)` ignora los NULL. NO se usa `count(*)`, que
--       contaría 1 por la fila sintética del LEFT JOIN y diría que un
--       espacio sin mesas tiene una.
--     - `capacidad_maxima` se expone tal cual en `capacidad_declarada`
--       (si algún día fuera NULL, que se vea), pero en `diferencia` y
--       `cuadra` va con `coalesce(...,0)` para que esas dos columnas nunca
--       devuelvan NULL y se puedan ordenar/filtrar sin sorpresas.
create or replace view public.vista_capacidad_espacios
with (security_invoker = on)
as
select
  e.id                                                        as espacio_id,
  e.nombre                                                    as nombre,
  coalesce(e.caracteristicas->>'marca', 'casa_tomas')         as marca,
  e.activa                                                    as activa,

  -- La que MANDA HOY: lo que el trigger `trg_validar_capacidad` suma en su
  -- paso 1 (ver 20260922190000_aforo_por_marca.sql).
  e.capacidad_maxima                                          as capacidad_declarada,

  -- La capacidad efectiva "cableada pero dormida": lo que sientan las
  -- mesas del plano. Ver arriba por qué NO se excluye `is_merged`.
  coalesce(sum(m.capacidad) filter (where m.activa is not false), 0)::integer
                                                              as plazas_mesas,

  count(m.id) filter (where m.activa is not false)::integer    as mesas_activas,
  count(m.id)::integer                                         as mesas_totales,

  (coalesce(sum(m.capacidad) filter (where m.activa is not false), 0)
     - coalesce(e.capacidad_maxima, 0))::integer               as diferencia,

  (coalesce(sum(m.capacidad) filter (where m.activa is not false), 0)
     = coalesce(e.capacidad_maxima, 0))                        as cuadra

from public.espacios_reserva e
left join public.mesas m on m.espacio_id = e.id
group by
  e.id,
  e.nombre,
  e.caracteristicas,
  e.activa,
  e.capacidad_maxima;

comment on view public.vista_capacidad_espacios is
  'INFORMATIVA — no la usa el aforo. Compara, por espacio, la capacidad declarada (espacios_reserva.capacidad_maxima, la que MANDA HOY en trg_validar_capacidad) con la suma de plazas de las mesas activas del plano (capacidad efectiva, cableada pero dormida). Incluye espacios inactivos y espacios sin mesas (LEFT JOIN, plazas_mesas = 0). No se excluyen las mesas con is_merged porque el editor de plano BORRA las filas originales al fusionar (EditorPlanoEspacio.tsx ~183): sumar todas las mesas activas no duplica plazas. Sirve para cuadrar cada espacio ANTES de encender la regla de capacidad efectiva.';

-- ---------------------------------------------------------------------------
-- 2. `public.fn_capacidad_efectiva_espacio(uuid)` — por espacio
-- ---------------------------------------------------------------------------
--   Plazas que sienta el plano de UN espacio. 0 si no tiene mesas (o si
--   todas están inactivas, o si el uuid no existe: `sum` de cero filas es
--   NULL y el `coalesce` lo baja a 0 — nunca devuelve NULL).
--
--   No filtra por `espacios_reserva.activa`: es una pregunta sobre el plano
--   de ese espacio concreto, no sobre el aforo del negocio. Quien necesite
--   el aforo del negocio usa `fn_capacidad_efectiva_marca`, que sí filtra.
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
    and m.activa is not false;
$$;

comment on function public.fn_capacidad_efectiva_espacio(uuid) is
  'INFORMATIVA — hoy no la llama el trigger de aforo. Suma la capacidad de las mesas activas (activa IS NOT FALSE) de un espacio; 0 si no tiene mesas o el uuid no existe. No excluye is_merged (el editor de plano borra las originales al fusionar). No filtra por espacios_reserva.activa a propósito: pregunta por el plano de ESE espacio.';

-- ---------------------------------------------------------------------------
-- 3. `public.fn_capacidad_efectiva_marca(text)` — por negocio
-- ---------------------------------------------------------------------------
--   ESTA es la que usaría el trigger el día que se encienda la regla: es el
--   sustituto exacto del paso 1 de `validar_capacidad_reserva()`.
--
--   Replica el criterio del trigger LETRA POR LETRA para que no puedan
--   divergir:
--     - `e.activa = true`  (solo espacios activos suman aforo)
--     - `coalesce(e.caracteristicas->>'marca','casa_tomas')
--          = coalesce(p_marca,'casa_tomas')`
--       COALESCE en AMBOS lados, igual que en 20260922190000: un espacio sin
--       etiquetar y una marca nula caen los dos en 'casa_tomas' (el negocio
--       mayoritario e histórico, mismo valor que `MARCA_POR_DEFECTO` en
--       `_shared/disponibilidad.ts` y que el DEFAULT de `reservas.marca`).
--       Comparar por IGUALDAD y no con un `IN ('casa_tomas','touza')` es lo
--       que hace que un tercer negocio futuro no obligue a tocar esto.
--
--   El JOIN es INNER y eso NO cambia el resultado: un espacio activo sin
--   mesas aportaría 0 plazas tanto con INNER como con LEFT, y a una SUMA le
--   da igual. Se deja INNER porque es lo que se lee más claro. (Ojo: esto
--   es precisamente lo que hace que un negocio con TODAS sus salas sin
--   mesas devuelva 0 y no NULL — ver el bloque de abajo, es el caso Touza.)
--
--   DIVERGENCIA CONOCIDA Y DELIBERADA con el helper del panel
--   (`src/lib/reservas/aforoMesas.ts`, sin commitear a 2026-09-26): ese
--   fichero trata un espacio con `activa IS NULL` como ACTIVO
--   (`espacio.activa !== false`), mientras que aquí se usa `e.activa = true`,
--   que lo EXCLUYE. No es un despiste: esta función tiene que replicar el
--   paso 1 del trigger LETRA POR LETRA, y el trigger usa `activa = true`.
--   Si la divergencia llegara a importar (hoy no: los 7 espacios tienen
--   `activa` con valor), lo correcto es alinear el helper con el trigger,
--   NO relajar esta función — el servidor es la autoridad. En cambio el
--   criterio de MESA sí coincide exactamente: `mesa.activa !== false` allí,
--   `m.activa is not false` aquí.
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
    and m.activa is not false;
$$;

comment on function public.fn_capacidad_efectiva_marca(text) is
  'INFORMATIVA HOY — el trigger trg_validar_capacidad NO la llama todavía (sigue sumando capacidad_maxima). Es el sustituto preparado del paso 1 de validar_capacidad_reserva(): suma las plazas de las mesas activas de todos los espacios ACTIVOS de una marca, con el mismo criterio exacto que el trigger (coalesce(caracteristicas->>marca, casa_tomas) por igualdad). Devuelve 0, nunca NULL: si una marca no tiene ninguna mesa cargada devuelve 0 y encenderla bloquearía el 100% de sus reservas. Ver el bloque "CÓMO ENCENDER LA REGLA" en 20260926120000_capacidad_efectiva_mesas.sql antes de usarla.';

-- ---------------------------------------------------------------------------
-- 4. GRANTS — nunca a `anon` ni a `public`
-- ---------------------------------------------------------------------------
--   Mismo patrón que el final de
--   `20260923210000_solicitud_propuesta_espacio.sql`: `revoke all` de
--   `public` y `anon` primero (por si algún `alter default privileges`
--   reparte permisos de serie) y `grant` explícito solo a `authenticated` y
--   `service_role`.
--
--   Importa especialmente en las dos funciones porque son SECURITY DEFINER:
--   ejecutan con los permisos del propietario y saltan la RLS de `mesas`,
--   así que dárselas a `anon` sería regalar lectura de aforo a cualquiera
--   con la anon key — exactamente la clase de agujero que cerró
--   `20260918084909_cerrar_fuga_rls_anonima.sql`.
--
--   La vista, al ser `security_invoker = on`, ya está protegida por la RLS
--   de las tablas de debajo, pero se le quita el SELECT a `anon`/`public`
--   igualmente: defensa en profundidad y coherencia con el resto del repo.
revoke all on public.vista_capacidad_espacios from public, anon;
grant select on public.vista_capacidad_espacios to authenticated, service_role;

revoke all on function public.fn_capacidad_efectiva_espacio(uuid) from public, anon;
grant execute on function public.fn_capacidad_efectiva_espacio(uuid) to authenticated, service_role;

revoke all on function public.fn_capacidad_efectiva_marca(text) from public, anon;
grant execute on function public.fn_capacidad_efectiva_marca(text) to authenticated, service_role;

commit;

-- ===========================================================================
-- CÓMO ENCENDER LA REGLA
-- ---------------------------------------------------------------------------
-- (No hacer nada de esto hoy: leer primero "QUÉ PASARÍA SI SE ENCENDIERA
--  HOY", más abajo. Encenderlo ahora mismo sería una regresión grave.)
--
-- Son DOS cambios que van JUNTOS, en la misma sesión y el mismo despliegue:
-- el servidor (trigger) y el motor de estimación del cliente. Si se hace
-- solo uno de los dos, el cliente ofrece huecos que el servidor rechaza.
--
-- ---------------------------------------------------------------------------
-- PASO A — el trigger (servidor, autoridad final)
-- ---------------------------------------------------------------------------
--
-- Se hace en una migración NUEVA (timestamp nuevo). NUNCA editando este
-- fichero ni `20260922190000_aforo_por_marca.sql`: las dos ya están (o
-- estarán) en `supabase_migrations.schema_migrations`, y reescribir una
-- migración aplicada descuadra el historial — que es exactamente el lío que
-- tiene el repo bloqueado a fecha de hoy.
--
-- En esa migración nueva se hace un `CREATE OR REPLACE FUNCTION
-- public.validar_capacidad_reserva()` reproduciendo el cuerpo actual
-- ENTERO (el de 20260922190000) y sustituyendo SOLO estas 5 líneas del
-- paso 1:
--
--     SELECT COALESCE(SUM(capacidad_maxima), 0)
--     INTO v_capacidad_total
--     FROM espacios_reserva
--     WHERE activa = true
--       AND COALESCE(caracteristicas->>'marca', 'casa_tomas') = v_marca;
--
-- por esta ÚNICA línea:
--
--     v_capacidad_total := public.fn_capacidad_efectiva_marca(v_marca);
--
-- Copiable y pegable, el cuerpo resultante completo es:
--
--   CREATE OR REPLACE FUNCTION public.validar_capacidad_reserva()
--   RETURNS trigger
--   LANGUAGE plpgsql
--   SECURITY DEFINER
--   SET search_path = 'public'
--   AS $function$
--   DECLARE
--     v_capacidad_total INT;
--     v_ocupacion_turno INT := 0;
--     v_es_comida BOOLEAN;
--     v_marca TEXT;
--   BEGIN
--     -- Solo validar si está en un estado que ocupa lugar
--     IF NEW.estado NOT IN ('pendiente', 'verificada', 'confirmada') THEN
--       RETURN NEW;
--     END IF;
--
--     v_marca := COALESCE(NEW.marca, 'casa_tomas');
--
--     -- 1. Capacidad EFECTIVA: suma de plazas de las mesas activas de los
--     --    espacios activos de esta marca. Antes sumaba capacidad_maxima.
--     v_capacidad_total := public.fn_capacidad_efectiva_marca(v_marca);
--
--     -- 2. Determinar turno (comida < 17:00, cena >= 17:00)
--     v_es_comida := NEW.hora < '17:00:00'::time;
--
--     -- 3. Candado de concurrencia por fecha+turno (SIN marca, a propósito)
--     PERFORM pg_advisory_xact_lock(
--       hashtext(NEW.fecha::text),
--       CASE WHEN v_es_comida THEN 1 ELSE 2 END
--     );
--
--     -- 4. Ocupación del mismo turno y la misma marca
--     SELECT COALESCE(SUM(numero_comensales), 0)
--     INTO v_ocupacion_turno
--     FROM reservas
--     WHERE fecha = NEW.fecha
--       AND (TG_OP = 'INSERT' OR id != NEW.id)
--       AND estado IN ('pendiente', 'verificada', 'confirmada')
--       AND COALESCE(marca, 'casa_tomas') = v_marca
--       AND (
--         (v_es_comida AND hora < '17:00:00'::time) OR
--         (NOT v_es_comida AND hora >= '17:00:00'::time)
--       );
--
--     -- 5. Validar capacidad
--     IF v_ocupacion_turno + NEW.numero_comensales > v_capacidad_total THEN
--       RAISE EXCEPTION 'Aforo superado para el turno. Capacidad total: %, Ocupación actual: %, Pedidos: %',
--         v_capacidad_total, v_ocupacion_turno, NEW.numero_comensales
--         USING ERRCODE = 'check_violation';
--     END IF;
--
--     RETURN NEW;
--   END;
--   $function$;
--
-- Y después, por si el CREATE OR REPLACE no trajera el SET dentro:
--
--   alter function public.validar_capacidad_reserva() set search_path = 'public';
--
-- (Es idempotente y seguro de re-ejecutar. Ver
--  `20260922210000_search_path_validar_capacidad.sql`: esa función es
--  SECURITY DEFINER y con search_path mutable se la puede inducir a
--  resolver `espacios_reserva`/`reservas`/`mesas` contra otro esquema y
--  falsear el aforo. Comprobar luego que `pg_proc.proconfig` sigue siendo
--  `{search_path=public}`.)
--
-- LO QUE **NO** HAY QUE TOCAR AL ENCENDERLO
--
--   * El trigger `trg_validar_capacidad`. NO hace falta DROP ni CREATE
--     TRIGGER: fue creado en
--     `20260305175122_trigger_concurrencia_reservas.sql` con
--     `EXECUTE FUNCTION validar_capacidad_reserva()`, y apunta a la función
--     POR NOMBRE. Un `CREATE OR REPLACE FUNCTION` sobre la misma firma
--     (mismo nombre, sin argumentos) cambia el cuerpo que el trigger
--     ejecuta sin tocar el trigger.
--   * El candado `pg_advisory_xact_lock(hashtext(fecha), turno)` del paso 3:
--     sigue siendo por fecha+turno y SIN marca. Es lo correcto: dos
--     transacciones que leen/escriben el mismo (fecha, turno) no deben
--     tener carrera aunque sean de negocios distintos.
--   * El corte de turno en 17:00 (`v_es_comida`).
--   * La exclusión de la propia fila en UPDATE
--     (`TG_OP = 'INSERT' OR id != NEW.id`).
--   * El `USING ERRCODE = 'check_violation'` y el texto del mensaje. De
--     ESO dependen DOS consumidores, no uno:
--       - `supabase/functions/reservas-web/index.ts` (~línea 1240):
--         `insertError.code === "23514" || /aforo/i.test(...)`
--       - `supabase/functions/emails-reserva/enlaces-web.ts` (~línea 265):
--         `if (codigo === "23514" || /aforo/i.test(mensaje ?? "")) return "sin_aforo";`
--         (confirmación de contraoferta por email)
--     Si el errcode cambia, los dos dejan de distinguir "sin aforo" de
--     "error interno" y el cliente ve un 500 donde debería ver "no hay
--     sitio".
--
-- ---------------------------------------------------------------------------
-- PASO B — el motor de estimación del cliente (OBLIGATORIO, a la vez)
-- ---------------------------------------------------------------------------
--
-- El trigger es la AUTORIDAD; el motor de disponibilidad es la ESTIMACIÓN
-- que el cliente ve ANTES de reservar. Si filtran/suman distinto, el
-- cliente ve un hueco que el servidor luego rechaza (o al revés). Misma
-- lección que la cabecera de `20260922190000` ya dejó escrita para la
-- marca; aquí vuelve a aplicar para las mesas.
--
--   `sumarCapacidadPorMarca()` en
--   `supabase/functions/_shared/disponibilidad.ts` (~línea 149) suma
--   `capacidad_maxima` de los espacios de la marca:
--
--     return filtrarEspaciosPorMarca(espacios, marca).reduce(
--       (suma, e) => suma + (... Number(e.capacidad_maxima) ...), 0,
--     );
--
-- Si se enciende el trigger y esto no se cambia, el cliente seguiría
-- ofreciendo 170 plazas a Casa Tomás cuando el servidor solo acepta 80, y
-- ofrecería 80 a Touza cuando el servidor rechaza TODO.
--
-- Consumidores de `sumarCapacidadPorMarca` que hay que revisar (son MÁS de
-- los dos obvios — verificado con grep el 2026-09-26):
--
--   * `supabase/functions/reservas-web/index.ts`  (líneas ~324, ~802, ~1131)
--   * `src/hooks/useDisponibilidad.ts`            (lo importa y lo REEXPORTA
--                                                  para el resto de `src/`)
--   * `src/components/dashboard/widgets/ReservasHoy.tsx`      (~línea 90)
--   * `src/components/reservas/ConfiguracionTurnos.tsx`       (~línea 142)
--   * `supabase/functions/_shared/__tests__/disponibilidad.test.ts`
--     — tiene tests que fijan 150 para casa_tomas y 20 para touza sobre
--     `ESPACIOS_PRODUCCION`; habría que rehacer esas fixtures con plazas de
--     mesas, no con `capacidad_maxima`.
--
-- El cambio en `disponibilidad.ts` NO puede ser una llamada a
-- `fn_capacidad_efectiva_marca` desde dentro del reduce: ese módulo no
-- importa nada y recibe los espacios ya leídos (regla de oro de su
-- cabecera). Las dos vías razonables son (a) que quien llama lea la
-- capacidad efectiva con un RPC a `fn_capacidad_efectiva_marca` y la pase
-- como `capacidadTotal`, o (b) que quien llama traiga las mesas y
-- `sumarCapacidadPorMarca` sume `plazas_mesas` en vez de
-- `capacidad_maxima`. Decidirlo al encenderlo, no ahora.
--
-- ---------------------------------------------------------------------------
-- CÓMO REVERTIR SI SE ENCIENDE Y SALE MAL
-- ---------------------------------------------------------------------------
--
--   Volver a poner las 5 líneas originales del paso 1 en un nuevo
--   `CREATE OR REPLACE FUNCTION public.validar_capacidad_reserva()`
--   (las que están citadas arriba, `SELECT COALESCE(SUM(capacidad_maxima)
--   , 0) ... = v_marca`), o ejecutar a mano el fichero de
--   `supabase/rollbacks/` de la migración que lo encendió. Y deshacer el
--   PASO B a la vez, por el mismo motivo por el que van juntos.
--
--   OJO: el rollback de ESTA migración
--   (`supabase/rollbacks/20260926120000_capacidad_efectiva_mesas_ROLLBACK.sql`)
--   borra `fn_capacidad_efectiva_marca`. Si la regla ya está encendida, el
--   trigger la llama, y borrarla rompería TODAS las reservas. Hay que
--   revertir el trigger PRIMERO y solo después ejecutar ese rollback.
--
-- ===========================================================================

-- ===========================================================================
-- QUÉ PASARÍA SI SE ENCENDIERA HOY
-- (datos verificados en producción el 2026-09-26, solo lectura)
-- ---------------------------------------------------------------------------
--
--   Espacio        | Marca      | capacidad_maxima | nº mesas | plazas mesas
--   ---------------+------------+------------------+----------+-------------
--   Comedor        | casa_tomas | 50               | 2        | 4
--   Salón          | casa_tomas | 50               | 15       | 64
--   Terraza        | casa_tomas | 50               | 3        | 12
--   Reservado      | casa_tomas | 20               | 0        | 0
--   Interior       | touza      | 30               | 0        | 0
--   Terraza        | touza      | 30               | 0        | 0
--   El Reservado   | touza      | 20               | 0        | 0
--
-- LO PRIMERO: EL TRIGGER VALIDA **POR MARCA**, NO POR ESPACIO
--
--   El paso 1 suma TODOS los espacios activos de la marca de la reserva.
--   No mira en qué sala se va a sentar la gente (`espacio_id` no entra en
--   el cálculo). Así que las cuentas que importan son estas dos:
--
--   CASA TOMÁS
--     declarado hoy : 50 + 50 + 50 + 20 = 170
--     sumando mesas :  4 + 64 + 12 +  0 =  80
--     -> caída de 90 plazas por turno, un -53 % (90/170 = 52,9 %).
--
--   TOUZA
--     declarado hoy : 30 + 30 + 20 = 80
--     sumando mesas :  0 +  0 +  0 =  0
--     -> `v_capacidad_total = 0`. Y el paso 5 compara
--        `v_ocupacion_turno + NEW.numero_comensales > v_capacidad_total`,
--        así que con 0 ocupación y 1 comensal ya es `0 + 1 > 0` = TRUE:
--        **CUALQUIER reserva de Touza (numero_comensales >= 1) dispararía
--        la excepción de aforo. Touza quedaría 100 % bloqueada**, por
--        teléfono, por web y desde el panel.
--
-- EL MATIZ CONTRAINTUITIVO (dejarlo escrito para el que lea esto de nuevas)
--
--   Un espacio individual con 0 mesas **NO** bloquea por sí solo, porque la
--   suma es por marca y no por espacio. El "Reservado" de Casa Tomás tiene
--   0 mesas y NO impide reservar en Casa Tomás: sus otras tres salas
--   aportan 80 plazas y el aforo de la marca sigue siendo 80 > 0. Lo que
--   bloquea es que **TODAS** las salas de una marca estén a 0 — que es
--   exactamente el caso de Touza y sus 3 salas.
--
--   Dicho de otro modo: el riesgo no se mide sala por sala, se mide
--   sumando por marca. Cuadrar el "Reservado" es deuda; cargar las mesas de
--   Touza es un bloqueo total.
--
-- EL CASO QUE ENGAÑA: SALÓN
--
--   Salón declara 50 pero su plano sienta 64 (15 mesas). Bajo la regla
--   nueva APORTARÍA MÁS de lo declarado: +14 plazas. Es el único espacio
--   que mejora, y no compensa ni de lejos el desplome de los otros:
--     Comedor   4 frente a 50  -> -46
--     Salón    64 frente a 50  -> +14
--     Terraza  12 frente a 50  -> -38
--     Reservado 0 frente a 20  -> -20
--     ------------------------------------
--     total casa_tomas             -90
--
--   (Y de paso: que Salón declare 50 cuando su plano sienta 64 significa
--   que hoy el aforo declarado le está QUITANDO 14 plazas reales. Eso es un
--   dato a favor de la regla nueva… en cuanto el resto esté cargado.)
--
-- CONCLUSIÓN
--
--   Encender la regla HOY sería una regresión grave: Casa Tomás perdería
--   más de la mitad del aforo y Touza dejaría de poder reservar en
--   absoluto. El orden correcto es:
--
--     1. Cargar las mesas que faltan espacio por espacio (hay una pantalla
--        nueva para eso en la Configuración de `/reservas`; el editor de
--        plano vive en `src/components/espacios/EditorPlanoEspacio.tsx` y
--        la página en `src/pages/Espacios.tsx`).
--     2. Cuadrar cada espacio hasta que `vista_capacidad_espacios.cuadra`
--        sea `true` en todas las filas activas (o hasta que la diferencia
--        sea una decisión consciente del dueño y no un olvido).
--     3. Solo entonces, el PASO A + PASO B de "CÓMO ENCENDER LA REGLA".
--
--   Mientras eso no esté hecho, esta migración es lo correcto: cablear y
--   dejar dormido.
--
-- ===========================================================================

-- ===========================================================================
-- CONSULTAS DE VERIFICACIÓN
-- ---------------------------------------------------------------------------
-- **NO SE HAN EJECUTADO**: `supabase db push` está bloqueado (ver el
-- recuadro del principio), así que ni la vista ni las funciones existen
-- todavía en la base de datos. Ejecutar esto el día que la migración se
-- aplique. Todas son de SOLO LECTURA: no escriben nada.
-- ---------------------------------------------------------------------------
--
-- -- 1) La vista existe, tiene security_invoker y trae los 7 espacios
-- --    (4 de ellos con plazas_mesas = 0: si faltan filas, se ha colado un
-- --    INNER JOIN donde debe haber un LEFT JOIN):
-- select espacio_id, nombre, marca, activa,
--        capacidad_declarada, plazas_mesas,
--        mesas_activas, mesas_totales, diferencia, cuadra
-- from public.vista_capacidad_espacios
-- order by marca, nombre;
--   -- esperado (datos de 2026-09-26): 7 filas.
--   --   casa_tomas Comedor    50 /  4  -> diferencia -46, cuadra false
--   --   casa_tomas Reservado  20 /  0  -> diferencia -20, cuadra false
--   --   casa_tomas Salón      50 / 64  -> diferencia +14, cuadra false
--   --   casa_tomas Terraza    50 / 12  -> diferencia -38, cuadra false
--   --   touza      El Reservado 20 / 0 -> diferencia -20, cuadra false
--   --   touza      Interior   30 /  0  -> diferencia -30, cuadra false
--   --   touza      Terraza    30 /  0  -> diferencia -30, cuadra false
--
-- -- 2) La vista se creó con security_invoker (si esto no sale 'on', la
-- --    vista salta la RLS de espacios_reserva/mesas -> arreglarlo ANTES de
-- --    dar SELECT a nadie):
-- select c.relname, c.reloptions
-- from pg_class c
-- join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public' and c.relname = 'vista_capacidad_espacios';
--   -- esperado: reloptions = {security_invoker=on}
--
-- -- 3) Las dos funciones son SECURITY DEFINER y con search_path fijado:
-- select p.proname, p.prosecdef, p.provolatile, p.proconfig
-- from pg_proc p
-- where p.pronamespace = 'public'::regnamespace
--   and p.proname in ('fn_capacidad_efectiva_espacio', 'fn_capacidad_efectiva_marca');
--   -- esperado en ambas: prosecdef = true, provolatile = 's' (STABLE),
--   --                    proconfig = {search_path=public}
--
-- -- 4) Nadie salvo authenticated/service_role puede usarlas (NO debe
-- --    aparecer anon ni PUBLIC en ninguna de las tres filas):
-- select 'vista' as objeto, relacl::text as permisos
-- from pg_class where oid = 'public.vista_capacidad_espacios'::regclass
-- union all
-- select 'fn_espacio', proacl::text
-- from pg_proc where oid = 'public.fn_capacidad_efectiva_espacio(uuid)'::regprocedure
-- union all
-- select 'fn_marca', proacl::text
-- from pg_proc where oid = 'public.fn_capacidad_efectiva_marca(text)'::regprocedure;
--
-- -- 5) La función por espacio coincide con la vista, fila por fila
-- --    (si alguna fila sale, una de las dos definiciones se ha desviado):
-- select v.nombre, v.plazas_mesas,
--        public.fn_capacidad_efectiva_espacio(v.espacio_id) as segun_funcion
-- from public.vista_capacidad_espacios v
-- where v.plazas_mesas <> public.fn_capacidad_efectiva_espacio(v.espacio_id);
--   -- esperado: 0 filas
--
-- -- 6) Un uuid que no existe devuelve 0, NUNCA null:
-- select public.fn_capacidad_efectiva_espacio('00000000-0000-0000-0000-000000000000'::uuid);
--   -- esperado: 0
--
-- -- 7) COMPARACIÓN DECLARADO vs MESAS, AGRUPADA POR MARCA — la cuenta que
-- --    de verdad decide si se puede encender la regla (el trigger valida
-- --    por marca, no por espacio):
-- select coalesce(e.caracteristicas->>'marca', 'casa_tomas')          as marca,
--        sum(e.capacidad_maxima)                                      as declarado_hoy,
--        public.fn_capacidad_efectiva_marca(
--          coalesce(e.caracteristicas->>'marca', 'casa_tomas'))       as efectivo_mesas,
--        count(*)                                                     as espacios_activos,
--        count(*) filter (
--          where public.fn_capacidad_efectiva_espacio(e.id) = 0
--        )                                                            as espacios_sin_mesas
-- from public.espacios_reserva e
-- where e.activa = true
-- group by 1
-- order by 1;
--   -- esperado (datos de 2026-09-26):
--   --   casa_tomas | 170 | 80 | 4 | 1
--   --   touza      |  80 |  0 | 3 | 3
--   --
--   -- LECTURA: `efectivo_mesas = 0` con `espacios_activos = espacios_sin_mesas`
--   -- (caso touza) es la señal de bloqueo total. MIENTRAS ESA FILA EXISTA,
--   -- NO SE ENCIENDE LA REGLA.
--
-- -- 8) Que `declarado_hoy` de la consulta 7 sigue siendo lo que el trigger
-- --    usa DE VERDAD (debe coincidir: esta migración no toca el trigger):
-- select coalesce(caracteristicas->>'marca', 'casa_tomas') as marca,
--        coalesce(sum(capacidad_maxima), 0) as capacidad_total_segun_trigger
-- from public.espacios_reserva
-- where activa = true
-- group by 1;
--   -- esperado: ('casa_tomas', 170), ('touza', 80) — idéntico a la columna
--   -- `declarado_hoy` de arriba. Si no coincide, algo más cambió el aforo.
--
-- -- 9) Y que el cuerpo del trigger NO ha cambiado con esta migración
-- --    (debe seguir siendo el de 20260922190000, con su
-- --     `SELECT COALESCE(SUM(capacidad_maxima), 0)` en el paso 1 y SIN
-- --     ninguna llamada a fn_capacidad_efectiva_marca):
-- select pg_get_functiondef('public.validar_capacidad_reserva()'::regprocedure) as def;
--   -- esperado: contiene 'SUM(capacidad_maxima)' y NO contiene
--   --           'fn_capacidad_efectiva_marca'
-- ---------------------------------------------------------------------------
