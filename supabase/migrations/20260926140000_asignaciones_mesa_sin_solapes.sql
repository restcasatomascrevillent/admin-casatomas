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
-- ##   de datos. Este SQL **no se ha ejecutado nunca**, ni contra           ##
-- ##   producción ni contra un Postgres local: NINGUNA de las consultas de  ##
-- ##   verificación del final se ha lanzado, y la prueba de solape del      ##
-- ##   bloque 9 (la que demuestra que el índice único hace su trabajo)      ##
-- ##   está sin ejecutar. Lo único verificado es la LECTURA del esquema     ##
-- ##   contra los ficheros de `supabase/migrations/` — ver el bloque "LO    ##
-- ##   QUE SE HA COMPROBADO DEL ESQUEMA", que incluye DOS correcciones a    ##
-- ##   lo que se daba por supuesto al encargar esto.                       ##
-- ##                                                                       ##
-- ##   Tampoco se ha tocado `20260926120000_capacidad_efectiva_mesas.sql`,  ##
-- ##   que sigue pendiente y es de otro encargo. Las dos migraciones son    ##
-- ##   independientes y el orden en que se apliquen da igual.              ##
-- ##                                                                       ##
-- ===========================================================================
--
-- ENCARGO (dueño, 2026-09-26)
--
--   "Que la misma mesa no se le pueda dar a dos reservas del mismo turno."
--
--   Y, de paso, que el encargado pueda cerrar el día POR ETAPAS: primero
--   reparte reservas entre salas (el kanban), y más tarde, ya con el plano
--   delante, reparte mesas dentro de cada sala. Una reserva CON SALA Y SIN
--   MESA es un estado normal de mitad de faena, no un error.
--
-- QUÉ HACE ESTA MIGRACIÓN
--
--   1. Añade a `asignaciones_mesa` las cuatro columnas que le faltaban para
--      poder expresar el solape: `fecha`, `turno`, `espacio_id`,
--      `asignada_por`.
--   2. Crea el índice único `uq_asignaciones_mesa_mesa_fecha_turno`
--      (mesa_id, fecha, turno). **Esta es la pieza central**: una mesa no
--      puede estar en dos reservas del mismo día y turno, garantizado POR LA
--      BASE DE DATOS, no por el frontend.
--   3. Trigger `trg_asignaciones_mesa_denormalizar`: rellena las columnas
--      derivadas leyendo la reserva y la mesa (el cliente no las puede
--      falsear) y rechaza las combinaciones imposibles con prefijos de error
--      que el panel traduce a español.
--   4. RPC `public.asignar_mesas_reserva(uuid, uuid[])`: asigna el conjunto
--      de mesas de una reserva de forma ATÓMICA (todas o ninguna) y con un
--      mensaje legible cuando una mesa ya está pillada.
--   5. Trigger `trg_reservas_sincronizar_asignaciones`: cancelar, cambiar de
--      sala o mover de día/turno una reserva deja de dejar basura detrás.
--   6. Tabla `public.asignaciones_mesa_descartadas` + trigger
--      `trg_mesas_auditar_asignaciones`: cuando una mesa desaparece (fusión
--      en el editor de plano) las asignaciones que se pierden quedan
--      REGISTRADAS y, si eran de hoy en adelante, AVISADAS en la campana.
--   7. Vista `public.vista_asignacion_dia`: una fila por reserva viva con su
--      `grado` (`sin_sala` / `sin_mesa` / `con_mesa`).
--   8. `public.fn_asignaciones_futuras_de_mesas(uuid[])`: lectura para que el
--      editor de plano pueda AVISAR antes de guardar una fusión. Hoy no la
--      llama nadie; queda disponible y documentada.
--
-- QUÉ **NO** HACE ESTA MIGRACIÓN (crítico)
--
--   * NO toca el aforo. Ni `validar_capacidad_reserva()`, ni
--     `trg_validar_capacidad`, ni `espacios_reserva`, ni
--     `configuracion_reservas`. El aforo sigue siendo por MARCA y por turno,
--     tal como lo dejó `20260922190000_aforo_por_marca.sql`. Las mesas
--     asignadas NO entran en el cálculo de aforo, ni antes ni después de
--     esta migración.
--   * NO cambia `UNIQUE(reserva_id, mesa_id)`. Una reserva SÍ puede tener
--     varias mesas (juntar la 4 y la 5 para seis personas). Lo que no puede
--     es una mesa en dos reservas del mismo turno. Son dos restricciones
--     distintas y las dos hacen falta.
--   * NO cambia el `ON DELETE CASCADE` de `asignaciones_mesa.mesa_id` ni de
--     `asignaciones_mesa.reserva_id` (ver más abajo por qué).
--   * NO impide mover una reserva de sala ni de día. Prefiere LIBERAR la
--     mesa a BLOQUEAR el movimiento (ver más abajo).
--   * NO borra ni modifica ninguna fila existente: `asignaciones_mesa` está
--     VACÍA (0 filas, nunca usada), así que el backfill del paso 2 es un
--     no-op en la práctica.
--   * NO toca `src/`, ni las Edge Functions, ni el editor de plano
--     (`src/components/espacios/EditorPlanoEspacio.tsx`, que lo está
--     modificando otra persona en paralelo).
--
-- ---------------------------------------------------------------------------
-- POR QUÉ AQUÍ UN ÍNDICE ÚNICO Y NO UN ADVISORY LOCK
-- (leer esto antes de "arreglar" el solape añadiendo un candado al trigger)
-- ---------------------------------------------------------------------------
--
--   El repo ya tiene un candado para un problema que PARECE el mismo:
--   `validar_capacidad_reserva()` hace
--
--     PERFORM pg_advisory_xact_lock(
--       hashtext(NEW.fecha::text),
--       CASE WHEN v_es_comida THEN 1 ELSE 2 END
--     );
--
--   (`20260922190000_aforo_por_marca.sql`, paso 3). Pero el problema no es
--   el mismo, y la diferencia es exactamente la que decide la herramienta:
--
--     * El AFORO valida un AGREGADO: `SUM(numero_comensales)` sobre MUCHAS
--       filas de `reservas`. Eso NO se puede expresar como restricción de
--       tabla — no hay `CHECK` ni `UNIQUE` que sume otras filas. Por tanto
--       hay que leer, decidir y escribir; y entre la lectura y la escritura
--       cabe otra transacción que lea lo mismo y también decida que hay
--       hueco. De ahí el candado: serializa a los dos que compiten por el
--       mismo (fecha, turno).
--
--     * El SOLAPE DE MESA es una restricción de UNA SOLA FILA: "no puede
--       haber dos filas con el mismo (mesa_id, fecha, turno)". Eso SÍ se
--       expresa como restricción, y un índice único la garantiza en el
--       propio motor de almacenamiento, dentro de la inserción del índice.
--       No hay ventana entre "compruebo" y "escribo" porque no hay dos
--       pasos: el segundo insertor se bloquea en la entrada del índice y al
--       despertar recibe `unique_violation`. Es decir, el índice no es una
--       alternativa más débil al candado — es ESTRICTAMENTE MÁS FUERTE:
--
--         - No tiene ventana de carrera, ni siquiera teórica.
--         - No se puede olvidar. Un candado solo protege a quien lo pide;
--           un INSERT directo desde el SQL editor, desde otra RPC futura o
--           desde una Edge Function que no conozca el candado se lo salta
--           tranquilamente. El índice no se lo salta nadie.
--         - No depende de que dos trozos de código usen la misma clave de
--           candado (el error clásico: alguien hashea `fecha||turno||marca`
--           y deja de coincidir con quien hashea solo `fecha`).
--
--   Entonces, ¿para qué el `pg_advisory_xact_lock` de
--   `asignar_mesas_reserva()` (paso 7)? Para DOS cosas que el índice no da,
--   y para ninguna más:
--
--     a) ATOMICIDAD DEL CONJUNTO. La RPC borra las mesas actuales de la
--        reserva y mete las nuevas. Sin candado, dos encargados asignando a
--        la vez en el mismo turno pueden intercalarse y uno ve un estado
--        intermedio del otro. El candado hace que el reparto de mesas de un
--        (fecha, turno) sea de uno en uno. El índice seguiría impidiendo el
--        solape, pero con más reintentos y más errores feos.
--     b) UN ERROR LEGIBLE. Serializando, el fallo se produce de forma
--        determinista en la mesa concreta que está ocupada, y la RPC puede
--        traducirlo a `MESA_OCUPADA: la mesa <nombre> ...` en vez de dejar
--        salir un `duplicate key value violates unique constraint
--        "uq_asignaciones_mesa_mesa_fecha_turno"`.
--
--   El candado NO suple al índice. Si mañana alguien borra el candado, el
--   solape sigue siendo imposible; si alguien borra el índice, el solape
--   vuelve el mismo día.
--
--   La CLAVE del candado es, a propósito, EXACTAMENTE la misma que la del
--   aforo: `hashtext(fecha::text)` como clave 1 y `1`/`2` según turno como
--   clave 2. Comparten espacio de claves DELIBERADAMENTE. No es un descuido
--   ni una colisión que haya que evitar: una transacción que reparte mesas
--   del 12 de octubre a mediodía y otra que valida aforo del 12 de octubre a
--   mediodía tocan el mismo turno, y que se esperen entre sí es correcto y
--   más barato que razonar sobre dos candados independientes que se pueden
--   adquirir en orden distinto (eso sí sería un interbloqueo). Si algún día
--   se cambia el esquema de clave, hay que cambiarlo en LOS DOS SITIOS.
--
-- ---------------------------------------------------------------------------
-- EL TURNO SE DERIVA, NO SE GUARDA A MANO: `hora < '17:00:00'` = comida
-- ---------------------------------------------------------------------------
--
--   Misma regla, letra por letra, que `validar_capacidad_reserva()`
--   (`v_es_comida := NEW.hora < '17:00:00'::time;`) y que el resto del
--   panel. `turno` es una columna FÍSICA en `asignaciones_mesa` porque el
--   índice único la necesita (un índice sobre una expresión que lea OTRA
--   tabla es imposible), pero el cliente NUNCA la escribe: la rellena el
--   trigger leyendo `reservas.hora`. Si mañana el corte de turno deja de ser
--   las 17:00, hay que cambiarlo en:
--     * `validar_capacidad_reserva()`          (aforo, otro fichero)
--     * `asignaciones_mesa_denormalizar()`     (aquí)
--     * `reservas_sincronizar_asignaciones()`  (aquí)
--     * `asignar_mesas_reserva()`              (aquí, solo para el candado)
--     * `vista_asignacion_dia`                 (aquí)
--   y hacer un `UPDATE` de `asignaciones_mesa.turno` para las filas ya
--   guardadas, porque el valor viejo se queda como está.
--
-- ---------------------------------------------------------------------------
-- MESAS FUSIONADAS: SE MANTIENE EL `ON DELETE CASCADE`, PERO SE AUDITA
-- ---------------------------------------------------------------------------
--
--   Al fusionar mesas, el editor de plano
--   (`src/components/espacios/EditorPlanoEspacio.tsx`, sobre la línea 183)
--   **BORRA las filas originales** y crea una fila nueva con la capacidad
--   combinada:
--
--     // Eliminar mesas originales que ahora forman parte de mesas fusionadas
--     for (const originalId of idsOriginalesFusionadas) {
--       await supabase.from('mesas').delete().eq('id', originalId);
--     }
--
--   Con `asignaciones_mesa.mesa_id ... ON DELETE CASCADE`, ese borrado se
--   lleva las asignaciones EN SILENCIO: una reserva de mañana que tenía la
--   mesa 4 se queda sin mesa y nadie se entera.
--
--   Lo evidente sería cambiar la FK a `ON DELETE RESTRICT`. **No se hace, a
--   propósito**, por dos razones:
--
--     1. Haría FALLAR el guardado del plano. El editor borra e inserta en
--        una tanda de llamadas sueltas (no hay transacción que las envuelva),
--        así que un RESTRICT no daría "no puedes fusionar estas mesas": daría
--        un guardado A MEDIAS, con parte del plano nuevo y parte del viejo, y
--        un error opaco en mitad del bucle.
--     2. Ese fichero lo está tocando OTRA PERSONA ahora mismo. Cambiar por
--        debajo el contrato de borrado de `mesas` mientras alguien reescribe
--        el editor es la forma más rápida de romper su trabajo y el nuestro.
--
--   Decisión: que el borrado OCURRA, pero que quede REGISTRADO y AVISADO.
--   El trigger `trg_mesas_auditar_asignaciones` (BEFORE DELETE, para poder
--   leer las asignaciones y el `nombre` de la mesa ANTES de que la cascada
--   se los lleve) copia lo que se va a perder a
--   `public.asignaciones_mesa_descartadas` y, si había algo de HOY EN
--   ADELANTE, crea un aviso en `notificaciones_dashboard`. Lo que se pierde
--   es la ASIGNACIÓN, y queda por escrito.
--
--   Y para que el editor pueda avisar ANTES de guardar (que es lo correcto,
--   en vez de enterarse por la campana después), queda disponible
--   `public.fn_asignaciones_futuras_de_mesas(uuid[])`. Hoy no la llama
--   nadie: es una pieza preparada, no un cambio de comportamiento.
--
-- ---------------------------------------------------------------------------
-- CANCELAR Y MOVER RESERVAS: SE LIBERA LA MESA, NUNCA SE BLOQUEA EL CAMBIO
-- ---------------------------------------------------------------------------
--
--   `trg_reservas_sincronizar_asignaciones` (AFTER UPDATE ON reservas) toma
--   tres decisiones, y las tres van en la misma dirección: **una reserva
--   tiene que poder cambiar siempre; lo que cede es la mesa.**
--
--     * `estado` pasa a `'cancelada'` -> BORRA sus asignaciones. La mesa
--       queda libre para otro. Sin esto, una cancelación dejaría la mesa
--       ocupada para siempre por una reserva que no va a venir, y el índice
--       único impediría dársela a nadie más: el solape bien resuelto se
--       convertiría en mesas fantasma bloqueadas.
--       (Ojo: SOLO 'cancelada'. 'completada' y 'no_show' CONSERVAN su mesa:
--        el cliente se sentó ahí, o se le guardó y no vino, y en los dos
--        casos la mesa estuvo comprometida ese turno. Ver abajo la lista
--        real de estados, que es de SEIS valores y no de cuatro.)
--
--     * `espacio_id` cambia -> BORRA sus asignaciones. La mesa asignada
--       pertenece a la sala vieja; dejarla puesta sería un dato incoherente
--       (una reserva del Salón sentada en una mesa de la Terraza) y el
--       trigger de denormalización lo rechazaría con `MESA_OTRA_SALA`.
--       Se podría BLOQUEAR el movimiento en vez de liberar la mesa, y es
--       tentador — pero rompería el KANBAN que reparte reservas entre salas
--       arrastrando tarjetas, que es una pantalla que NO se puede tocar en
--       este encargo. Arrastrar una tarjeta dejaría de funcionar en cuanto
--       la reserva tuviera mesa, con un error que el kanban no sabe
--       interpretar. Se libera la mesa y la reserva vuelve al grado
--       `sin_mesa` de su nueva sala, que es justo el estado intermedio que
--       la vista está pensada para mostrar.
--
--     * `fecha` u `hora` cambian de forma que cambia `fecha` o `turno` ->
--       intenta MOVER la asignación (UPDATE de `fecha`/`turno`). Si el
--       movimiento choca contra el índice único (la mesa ya está pillada en
--       el nuevo día+turno), NO se hace fallar el UPDATE de la reserva:
--       se DESCARTA esa asignación (queda en
--       `asignaciones_mesa_descartadas`, motivo `conflicto_turno`) y la
--       reserva se mueve igualmente, quedando `sin_mesa`. Mover una reserva
--       es una operación del servicio; no puede fallar por un conflicto de
--       mesas que el encargado resolverá en treinta segundos con el plano
--       delante. La alternativa (hacer fallar el UPDATE) convertiría un
--       cambio de hora en un error incomprensible desde tres pantallas
--       distintas (lista, kanban, bot de teléfono).
--
--   El trigger lleva condición `WHEN` en la DEFINICIÓN, no un `IF` dentro de
--   la función: así Postgres no llega ni a llamarla en la mayoría de los
--   UPDATE de `reservas` (marcar llegada, cambiar notas, cambiar
--   comensales...). Importa porque `reservas` se actualiza mucho y ya tiene
--   varios triggers encima (`trg_validar_capacidad`,
--   `trigger_actualizar_ocupacion*`).
--
-- ---------------------------------------------------------------------------
-- PREFIJOS DE ERROR — CONTRATO CON EL PANEL, NO CAMBIAR
-- ---------------------------------------------------------------------------
--
--   El frontend busca estos prefijos en el mensaje para mostrar un texto en
--   español en vez de un error de Postgres. Todos salen con
--   `ERRCODE = 'check_violation'` (SQLSTATE 23514), igual que el aforo, para
--   que un cliente que solo mire el código sepa que es "dato rechazado por
--   regla de negocio" y no "error interno":
--
--     MESA_OCUPADA:      la mesa ya está en otra reserva de ese día+turno.
--                        Lleva el NOMBRE de la mesa, no el uuid.
--     MESA_OTRA_SALA:    la mesa es de una sala distinta a la de la reserva.
--     MESA_INACTIVA:     la mesa está marcada `activa = false`.
--     RESERVA_SIN_SALA:  la reserva no tiene sala; sin sala no hay mesa.
--     RESERVA_CANCELADA: la reserva está cancelada.
--
--   Hay dos mensajes más, `RESERVA_INEXISTENTE:` y `MESA_INEXISTENTE:`, que
--   **NO forman parte del contrato** y el panel no necesita reconocer: son
--   inalcanzables en la práctica porque las FK
--   `asignaciones_mesa_reserva_id_fkey` y `asignaciones_mesa_mesa_id_fkey`
--   hacen imposible insertar una asignación con un uuid que no existe.
--   Existen solo para que, si alguna vez se llega ahí (o si el que llama no
--   puede VER la fila por RLS), el fallo sea una frase legible en lugar de
--   un `null value in column "fecha" violates not-null constraint`.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ LOS TRES TRIGGERS SON `SECURITY DEFINER` Y LA RPC **NO**
-- ---------------------------------------------------------------------------
--
--   La RPC `asignar_mesas_reserva` es `SECURITY INVOKER` a propósito: es la
--   puerta por la que un camarero asigna mesas, y tiene que respetar la RLS
--   de `asignaciones_mesa` y de `reservas` exactamente como si el camarero
--   escribiera la tabla a mano. Nada de lo que hace necesita más permisos de
--   los que ya tiene (las políticas de `asignaciones_mesa` son
--   `FOR ALL TO authenticated USING (true) WITH CHECK (true)`,
--   `20260208164243_complete_admin_access_remaining_tables.sql`). Hacerla
--   DEFINER sería regalar escritura de asignaciones a cualquiera con
--   `EXECUTE`, y no hay ningún motivo.
--
--   Los tres triggers sí son DEFINER, y cada uno por una razón concreta:
--
--     * `asignaciones_mesa_denormalizar()` LEE `reservas` y `mesas` para
--       rellenar las columnas derivadas. Si corriera como invocante y la RLS
--       del que escribe no le dejara ver la reserva, el `SELECT` no
--       encontraría nada y el trigger abortaría con un mensaje engañoso.
--       Un valor derivado no puede depender de quién lo derive. (Mismo
--       criterio que `validar_capacidad_reserva()`, también DEFINER.)
--     * `reservas_sincronizar_asignaciones()` BORRA y MUEVE asignaciones a
--       consecuencia de un cambio en `reservas`. Quien cancela una reserva
--       puede no tener permiso de escritura sobre las asignaciones — y aun
--       así la mesa TIENE que liberarse. Si no, cancelar una reserva
--       fallaría por la RLS de una tabla que el usuario ni sabe que existe.
--     * `mesas_auditar_asignaciones()` escribe en
--       `asignaciones_mesa_descartadas` (donde NADIE tiene INSERT: a
--       propósito, es una tabla de auditoría) y en
--       `notificaciones_dashboard`, cuya política de INSERT exige
--       `can_write_section('dashboard')`
--       (`20260918120000_rls_por_permisos_de_seccion.sql`). Como invocante,
--       un usuario con permiso de Espacios pero sin permiso de Dashboard no
--       podría guardar el plano: el borrado de una mesa reventaría por la
--       RLS del aviso. Inaceptable — el aviso es un efecto secundario, no
--       puede vetar la operación principal.
--
--   Los tres llevan `SET search_path = 'public'` (convención dura del repo,
--   razonada en `20260922210000_search_path_validar_capacidad.sql` y aplicada
--   en bloque en `20260922200000_endurecer_funciones.sql`): una función
--   DEFINER con `search_path` mutable se puede inducir a resolver `reservas`
--   o `mesas` contra objetos de otro esquema (`pg_temp`) y falsear el
--   resultado. Se usa `'public'` y no `''` porque los cuerpos referencian
--   tablas y funciones del esquema público. La RPC y la función de lectura
--   lo llevan también, por coherencia.
--
-- ---------------------------------------------------------------------------
-- LO QUE SE HA COMPROBADO DEL ESQUEMA
-- (leído en `supabase/migrations/`, y DOS CORRECCIONES a lo que se daba por
--  supuesto al encargar esto)
-- ---------------------------------------------------------------------------
--
--   Confirmado:
--     * `asignaciones_mesa` = (id, reserva_id, mesa_id, created_at) +
--       `UNIQUE(reserva_id, mesa_id)`, las dos FK con `ON DELETE CASCADE`
--       (`20251207090324_a3f9d579-...sql`, líneas 19-25). Sin fecha y sin
--       turno: de ahí que el solape fuera hoy inexpresable.
--     * `mesas` = (id, espacio_id NOT NULL, nombre varchar(50) NOT NULL,
--       capacidad int NOT NULL, forma, ancho, alto, pos_x, pos_y, rotacion,
--       activa boolean NULL DEFAULT true, created_at, updated_at) +
--       `is_merged`/`original_mesas` (`20251212195936_...`) + `etiqueta`
--       (`20260116073454_...`).
--     * `reservas` tiene fecha (date NOT NULL), hora (time NOT NULL),
--       numero_comensales, espacio_id (uuid, FK a espacios_reserva SIN
--       acción de borrado), estado NOT NULL y marca NOT NULL DEFAULT
--       'casa_tomas' con CHECK in ('casa_tomas','touza')
--       (`20260922180000_marca_negocio_en_reservas.sql`).
--     * `espacios_reserva` tiene nombre NOT NULL y caracteristicas jsonb,
--       de donde sale la marca: `caracteristicas->>'marca'`.
--
--   CORRECCIÓN 1 — LOS ESTADOS DE RESERVA SON **SEIS**, NO CUATRO.
--     El `CHECK reservas_estado_check` admite
--       pendiente | verificada | confirmada | cancelada | completada | no_show
--     (verificado contra la BD y escrito en
--      `20260919130000_fix_vista_ocupacion_hoy_estados.sql`, línea 48;
--      'completada'/'no_show' los usa el registro de llegada,
--      `20260923180000_reservas_llegada.sql`). Importa en DOS sitios de este
--     fichero, y en los dos está tratado a conciencia:
--       - La liberación de mesa al cancelar mira SOLO 'cancelada'. Una
--         reserva 'completada' o 'no_show' CONSERVA su mesa (histórico de qué
--         mesa se usó o se comprometió ese turno).
--       - `vista_asignacion_dia` filtra `estado in ('pendiente','verificada',
--         'confirmada')` — el mismo conjunto "que ocupa plaza" del aforo —,
--         así que las 'completada'/'no_show' quedan FUERA de la vista aunque
--         sigan teniendo mesa. La vista es la herramienta de "a quién me
--         falta sentar", no un histórico.
--
--   CORRECCIÓN 2 — `reservas.espacio_id` LO PUSO `NOT NULL` UNA MIGRACIÓN
--   Y NINGUNA COMMITEADA LO DESHACE.
--     `20251114070455_bb295fa7-...sql`, línea 55, hace
--     `ALTER TABLE public.reservas ALTER COLUMN espacio_id SET NOT NULL;` y
--     no hay ningún `DROP NOT NULL` sobre `reservas` en todo
--     `supabase/migrations/` (los tres que existen son sobre
--     `ocupacion_diaria`). Aun así la columna es NULLABLE hoy: el panel
--     inserta reservas con `espacio_id: null`
--     (`src/components/reservas/FormularioReserva.tsx`, líneas 497 y 543) y
--     `src/integrations/supabase/types.ts` la declara `string | null`. O sea:
--     se relajó FUERA de las migraciones (consola de Supabase, o una de las
--     dos migraciones aplicadas sin commitear). Consecuencia para este
--     fichero: si resultara que en producción sigue siendo `NOT NULL`, el
--     grado `sin_sala` nunca aparecería y `RESERVA_SIN_SALA` sería código
--     muerto — pero NADA de esta migración fallaría por ello. Hay una
--     consulta en el bloque de verificación (la nº 8) para comprobarlo.
--
-- ---------------------------------------------------------------------------
-- UN AGUJERO QUE ESTA MIGRACIÓN **NO** ARREGLA (queda anotado)
-- ---------------------------------------------------------------------------
--
--   `asignaciones_mesa` se quedó FUERA del repaso de RLS por permisos de
--   sección (`20260918120000_rls_por_permisos_de_seccion.sql` no la
--   menciona). Sus políticas siguen siendo las permisivas de
--   `20251207090324` + `20260208164243`: **cualquier usuario autenticado
--   puede leer y escribir asignaciones de mesa**, sin pasar por
--   `can_write_section()`. No se toca aquí porque endurecerlo cambiaría quién
--   puede asignar mesas justo cuando otra persona está escribiendo el
--   TypeScript que lo va a llamar, y eso es un encargo aparte con su propia
--   decisión de negocio (¿la sección es 'reservas' o 'espacios'?). Queda
--   escrito para que no se pierda.
--
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. COLUMNAS NUEVAS EN `asignaciones_mesa`
-- ---------------------------------------------------------------------------
--   Se añaden NULLABLE y sin DEFAULT (cambio solo de catálogo en Postgres
--   >= 11: no reescribe la tabla). El `SET NOT NULL` va después, en el
--   paso 3, cuando ya están rellenas.
alter table public.asignaciones_mesa add column if not exists fecha        date;
alter table public.asignaciones_mesa add column if not exists turno        text;
alter table public.asignaciones_mesa add column if not exists espacio_id   uuid;
alter table public.asignaciones_mesa add column if not exists asignada_por uuid;

comment on column public.asignaciones_mesa.fecha is
  'DERIVADA de reservas.fecha, la rellena trg_asignaciones_mesa_denormalizar. No la escribe el cliente (lo que mande se ignora). Existe como columna física porque el índice único uq_asignaciones_mesa_mesa_fecha_turno la necesita y un índice no puede leer otra tabla.';

comment on column public.asignaciones_mesa.turno is
  'DERIVADA de reservas.hora: comida si hora < 17:00, cena si no (misma regla que validar_capacidad_reserva). La rellena trg_asignaciones_mesa_denormalizar; lo que mande el cliente se ignora.';

comment on column public.asignaciones_mesa.espacio_id is
  'DERIVADA de mesas.espacio_id, la rellena trg_asignaciones_mesa_denormalizar. Redundante a propósito: permite filtrar por sala sin ir a mesas y deja el dato en la fila para la auditoría. OJO: si alguien moviera una mesa de sala (UPDATE mesas.espacio_id) esta copia quedaria obsoleta hasta el siguiente UPDATE de la asignación; el editor de plano no mueve mesas entre salas, pero no hay nada que lo impida.';

comment on column public.asignaciones_mesa.asignada_por is
  'Quién asignó la mesa: auth.uid() en el momento del INSERT, forzado por el trigger para que no se pueda falsear. NULL cuando no hay sesión (service_role: bot de teléfono, Edge Functions) o si el usuario se borró (FK ON DELETE SET NULL). No se reescribe en los UPDATE: mover una reserva de día no cambia quién asignó la mesa.';

-- ---------------------------------------------------------------------------
-- 2. BACKFILL — hoy es un NO-OP, pero la migración tiene que ser correcta
--    también si alguien la aplica sobre datos
-- ---------------------------------------------------------------------------
--   `asignaciones_mesa` tiene 0 filas (verificado 2026-09-26: tabla creada
--   en diciembre y nunca usada), así que estos dos UPDATE afectan a 0 filas
--   y el `SET NOT NULL` del paso 3 no puede fallar. Se dejan escritos igual,
--   en el orden correcto (añadir nullable -> rellenar -> SET NOT NULL),
--   porque una migración que solo funciona con la tabla vacía es una bomba:
--   si mañana se restaura un backup con filas y se re-aplica, esto es lo que
--   la salva.
--
--   Ninguna de las tres columnas puede quedar NULL después del relleno:
--   `reservas.fecha` y `reservas.hora` son NOT NULL, y `mesas.espacio_id`
--   también. Las FK garantizan que la reserva y la mesa existen.
update public.asignaciones_mesa a
set fecha = r.fecha,
    turno = case when r.hora < '17:00:00'::time then 'comida' else 'cena' end
from public.reservas r
where r.id = a.reserva_id
  and (a.fecha is null or a.turno is null);

update public.asignaciones_mesa a
set espacio_id = m.espacio_id
from public.mesas m
where m.id = a.mesa_id
  and a.espacio_id is null;

-- ---------------------------------------------------------------------------
-- 3. NOT NULL, CHECK DE TURNO Y FK DE `asignada_por` / `espacio_id`
-- ---------------------------------------------------------------------------
alter table public.asignaciones_mesa
  alter column fecha      set not null,
  alter column turno      set not null,
  alter column espacio_id set not null;

do $do$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.asignaciones_mesa'::regclass
      and conname  = 'asignaciones_mesa_turno_valido'
  ) then
    alter table public.asignaciones_mesa
      add constraint asignaciones_mesa_turno_valido
      check (turno in ('comida', 'cena'));
  end if;

  -- `on delete set null`: si se borra el usuario que asignó, la asignación
  -- NO se borra (la mesa sigue asignada; lo que se pierde es la autoría).
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.asignaciones_mesa'::regclass
      and conname  = 'asignaciones_mesa_asignada_por_fkey'
  ) then
    alter table public.asignaciones_mesa
      add constraint asignaciones_mesa_asignada_por_fkey
      foreign key (asignada_por) references auth.users(id) on delete set null;
  end if;

  -- `espacio_id` es una copia de `mesas.espacio_id`, pero se le pone FK
  -- igualmente para que no pueda apuntar a una sala inexistente. CASCADE por
  -- coherencia con `mesas.espacio_id`, que ya es CASCADE: borrar una sala se
  -- lleva sus mesas y, con ellas, sus asignaciones (auditadas por
  -- trg_mesas_auditar_asignaciones). En la práctica es casi inalcanzable: la
  -- FK `reservas.espacio_id` es NO ACTION, así que una sala con reservas no
  -- se puede borrar.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.asignaciones_mesa'::regclass
      and conname  = 'asignaciones_mesa_espacio_id_fkey'
  ) then
    alter table public.asignaciones_mesa
      add constraint asignaciones_mesa_espacio_id_fkey
      foreign key (espacio_id) references public.espacios_reserva(id) on delete cascade;
  end if;
end
$do$;

-- ---------------------------------------------------------------------------
-- 4. EL ÍNDICE ÚNICO DEL SOLAPE (el núcleo del encargo)
-- ---------------------------------------------------------------------------
--   Una mesa, un día, un turno: UNA reserva. Ver arriba "POR QUÉ AQUÍ UN
--   ÍNDICE ÚNICO Y NO UN ADVISORY LOCK".
--
--   Sin `concurrently` a propósito: esto va dentro de la transacción de la
--   migración (CREATE INDEX CONCURRENTLY no puede) y la tabla está vacía,
--   así que el bloqueo dura lo que tarda en no hacer nada.
--
--   Si alguien aplica esto sobre datos que YA tienen solapes, este CREATE
--   INDEX **falla** y la migración entera se revierte. Es lo correcto: mejor
--   parar y que un humano decida qué asignación sobra, que elegir una al azar
--   y borrar la otra en silencio. La consulta para encontrarlos está en el
--   bloque de verificación (la nº 7).
create unique index if not exists uq_asignaciones_mesa_mesa_fecha_turno
  on public.asignaciones_mesa (mesa_id, fecha, turno);

--   Índice de apoyo para la vista y para "qué hay asignado este día": la
--   pantalla de asignación filtra siempre por (fecha, turno).
--   `UNIQUE(reserva_id, mesa_id)` ya cubre las búsquedas por reserva_id, así
--   que no hace falta un índice más para eso.
create index if not exists idx_asignaciones_mesa_fecha_turno
  on public.asignaciones_mesa (fecha, turno);

-- ---------------------------------------------------------------------------
-- 5. `public.asignaciones_mesa_descartadas` — auditoría de lo que se pierde
-- ---------------------------------------------------------------------------
--   SIN NINGUNA FK, a propósito. Ni a `mesas` (la mesa ya no existirá: el
--   caso típico es justo su borrado), ni a `reservas`, ni a
--   `espacios_reserva`. Una fila de auditoría tiene que sobrevivir a la
--   desaparición de todo lo que menciona; una FK con CASCADE borraría
--   precisamente la prueba de lo que pasó, y una con RESTRICT convertiría
--   esta tabla en un freno para borrar reservas viejas. Por eso también se
--   guarda `mesa_nombre` copiado: es el único rastro legible que queda.
--
--   Columnas nullables (salvo el `id`) siguiendo el contrato acordado con el
--   frontend. Nada inserta NULL en la práctica.
create table if not exists public.asignaciones_mesa_descartadas (
  id             uuid primary key default gen_random_uuid(),
  reserva_id     uuid,
  mesa_id        uuid,
  mesa_nombre    text,
  espacio_id     uuid,
  fecha          date,
  turno          text,
  motivo         text,
  descartada_at  timestamptz default now()
);

comment on table public.asignaciones_mesa_descartadas is
  'AUDITORÍA. Asignaciones de mesa que el sistema tuvo que descartar, para que ninguna se pierda en silencio. Sin FK a propósito (la mesa borrada ya no existe; una fila de auditoría no puede depender de lo que audita), por eso guarda mesa_nombre copiado. Motivos: mesa_borrada (el editor de plano borró la mesa, típicamente al fusionar — ver EditorPlanoEspacio.tsx ~183), conflicto_turno (se movió la reserva de día/turno y la mesa ya estaba pillada allí), revalidacion_fallida:<SQLSTATE> <mensaje> (el movimiento chocó con otra regla: mesa inactiva, sala distinta...). OJO CON fecha/turno: en mesa_borrada son los de la asignación que se pierde; en conflicto_turno y revalidacion_fallida son los de DESTINO — el día y turno a los que la reserva SE MOVIÓ y donde se quedó sin mesa, que es lo que hace falta para volver a asignarla, no el sitio del que venía. Nadie escribe aquí desde el cliente: solo los triggers SECURITY DEFINER.';

create index if not exists idx_asignaciones_descartadas_descartada_at
  on public.asignaciones_mesa_descartadas (descartada_at desc);

create index if not exists idx_asignaciones_descartadas_reserva
  on public.asignaciones_mesa_descartadas (reserva_id);

alter table public.asignaciones_mesa_descartadas enable row level security;

--   Solo SELECT, y solo para autenticados, igual que el resto de tablas de
--   lectura del panel. El INSERT lo hacen los triggers (SECURITY DEFINER: el
--   propietario de la tabla no pasa por la RLS), así que NADIE necesita
--   permiso de escritura y nadie puede manipular la auditoría. Sin UPDATE ni
--   DELETE: una auditoría que se puede editar no es una auditoría.
drop policy if exists "Autenticados leen asignaciones descartadas" on public.asignaciones_mesa_descartadas;
create policy "Autenticados leen asignaciones descartadas"
  on public.asignaciones_mesa_descartadas for select
  to authenticated
  using (true);

revoke all on public.asignaciones_mesa_descartadas from public, anon;
revoke insert, update, delete, truncate on public.asignaciones_mesa_descartadas from authenticated;
grant select on public.asignaciones_mesa_descartadas to authenticated;
grant select on public.asignaciones_mesa_descartadas to service_role;

-- ---------------------------------------------------------------------------
-- 6. `trg_asignaciones_mesa_denormalizar` — columnas derivadas y coherencia
-- ---------------------------------------------------------------------------
--   BEFORE INSERT OR UPDATE: es el único sitio donde se escriben `fecha`,
--   `turno` y `espacio_id`. Lo que venga del cliente en esas tres columnas
--   se SOBREESCRIBE sin mirarlo — no son datos de entrada, son datos
--   derivados, y si se pudieran falsear el índice único no serviría para
--   nada (bastaría mandar `turno = 'cena'` en una reserva de comida para dar
--   la misma mesa dos veces).
--
--   ORDEN DE LAS COMPROBACIONES: `RESERVA_SIN_SALA` va ANTES de
--   `MESA_OTRA_SALA` por necesidad, no por gusto. Con `espacio_id` NULL en la
--   reserva, `mesa.espacio_id <> reserva.espacio_id` evalúa a NULL (no a
--   TRUE), el `IF` no entra y la asignación se colaría con una sala
--   incoherente. Usar `is distinct from` lo arreglaría a medias (daría el
--   error equivocado). Primero se descarta el NULL, y solo entonces se
--   comparan las dos salas.
create or replace function public.asignaciones_mesa_denormalizar()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $fn$
declare
  v_res_fecha    date;
  v_res_hora     time;
  v_res_estado   text;
  v_res_espacio  uuid;
  v_mesa_espacio uuid;
  v_mesa_nombre  text;
  v_mesa_activa  boolean;
begin
  select r.fecha, r.hora, r.estado, r.espacio_id
    into v_res_fecha, v_res_hora, v_res_estado, v_res_espacio
  from public.reservas r
  where r.id = new.reserva_id;

  if not found then
    -- Inalcanzable: la FK asignaciones_mesa_reserva_id_fkey lo impide.
    -- NO es un prefijo del contrato (ver cabecera).
    raise exception 'RESERVA_INEXISTENTE: la reserva % no existe', new.reserva_id
      using errcode = 'check_violation';
  end if;

  if v_res_espacio is null then
    raise exception 'RESERVA_SIN_SALA: la reserva % no tiene sala asignada; primero la sala, luego la mesa', new.reserva_id
      using errcode = 'check_violation';
  end if;

  if v_res_estado = 'cancelada' then
    raise exception 'RESERVA_CANCELADA: la reserva % está cancelada y no puede tener mesa', new.reserva_id
      using errcode = 'check_violation';
  end if;

  select m.espacio_id, m.nombre::text, m.activa
    into v_mesa_espacio, v_mesa_nombre, v_mesa_activa
  from public.mesas m
  where m.id = new.mesa_id;

  if not found then
    -- Inalcanzable: FK asignaciones_mesa_mesa_id_fkey. Ver cabecera.
    raise exception 'MESA_INEXISTENTE: la mesa % no existe', new.mesa_id
      using errcode = 'check_violation';
  end if;

  --  `activa is false` y no `not activa`: `mesas.activa` es nullable
  --  (boolean DEFAULT true, sin NOT NULL), y una mesa con `activa IS NULL`
  --  NO está desactivada — nadie la desactivó. Mismo criterio que el
  --  `activa is not false` de 20260926120000_capacidad_efectiva_mesas.sql.
  if v_mesa_activa is false then
    raise exception 'MESA_INACTIVA: la mesa % está marcada como inactiva', v_mesa_nombre
      using errcode = 'check_violation';
  end if;

  if v_mesa_espacio <> v_res_espacio then
    raise exception 'MESA_OTRA_SALA: la mesa % pertenece a otra sala que la reserva', v_mesa_nombre
      using errcode = 'check_violation';
  end if;

  new.fecha      := v_res_fecha;
  new.turno      := case when v_res_hora < '17:00:00'::time then 'comida' else 'cena' end;
  new.espacio_id := v_mesa_espacio;

  --  Autoría solo en el INSERT, y solo si hay sesión:
  --    - En UPDATE no se toca: el UPDATE típico lo hace
  --      reservas_sincronizar_asignaciones() al mover la reserva de día, y
  --      quien mueve la reserva no es quien asignó la mesa.
  --    - `coalesce(auth.uid(), new.asignada_por)`: con sesión manda la
  --      sesión (el cliente no puede atribuir la asignación a otro); sin
  --      sesión (service_role: bot de teléfono, Edge Functions) se respeta
  --      lo que venga, que puede ser NULL.
  if tg_op = 'INSERT' then
    new.asignada_por := coalesce(auth.uid(), new.asignada_por);
  end if;

  return new;
end;
$fn$;

comment on function public.asignaciones_mesa_denormalizar() is
  'Trigger BEFORE INSERT/UPDATE de asignaciones_mesa. Rellena fecha/turno (de reservas) y espacio_id (de mesas) ignorando lo que mande el cliente, y rechaza lo imposible con los prefijos de contrato MESA_OTRA_SALA / MESA_INACTIVA / RESERVA_SIN_SALA / RESERVA_CANCELADA (todos con ERRCODE check_violation). SECURITY DEFINER porque un valor derivado no puede depender de si el que escribe ve la reserva por RLS.';

drop trigger if exists trg_asignaciones_mesa_denormalizar on public.asignaciones_mesa;
create trigger trg_asignaciones_mesa_denormalizar
  before insert or update on public.asignaciones_mesa
  for each row
  execute function public.asignaciones_mesa_denormalizar();

-- ---------------------------------------------------------------------------
-- 7. `public.asignar_mesas_reserva(uuid, uuid[])` — asignación atómica
-- ---------------------------------------------------------------------------
--   Contrato: "estas son TODAS las mesas de esta reserva". Borra lo que
--   hubiera y pone lo que se pide, todo o nada.
--
--   `p_mesa_ids` vacío o NULL = quitar todas las mesas. **NO es un error**:
--   deja la reserva con sala y sin mesa, que es el estado intermedio normal
--   del cierre por etapas (grado `sin_mesa` en `vista_asignacion_dia`).
--
--   SECURITY INVOKER (ver cabecera): respeta la RLS del camarero.
create or replace function public.asignar_mesas_reserva(
  p_reserva_id uuid,
  p_mesa_ids   uuid[]
)
returns setof public.asignaciones_mesa
language plpgsql
security invoker
set search_path = 'public'
as $fn$
declare
  v_fecha       date;
  v_hora        time;
  v_es_comida   boolean;
  v_mesa_id     uuid;
  v_mesa_nombre text;
  v_constraint  text;
begin
  select r.fecha, r.hora
    into v_fecha, v_hora
  from public.reservas r
  where r.id = p_reserva_id;

  if not found then
    -- También se llega aquí si la RLS de `reservas` no deja VER la fila: de
    -- ahí el "o no es visible con tus permisos". No es prefijo de contrato.
    raise exception 'RESERVA_INEXISTENTE: la reserva % no existe (o no es visible con tus permisos)', p_reserva_id
      using errcode = 'check_violation';
  end if;

  v_es_comida := v_hora < '17:00:00'::time;

  --  MISMO ESQUEMA DE CLAVE que validar_capacidad_reserva() (paso 3 de
  --  20260922190000_aforo_por_marca.sql): hashtext(fecha) como clave 1 y
  --  1/2 según turno como clave 2. Comparten espacio de claves A PROPÓSITO
  --  — ver el bloque "POR QUÉ AQUÍ UN ÍNDICE ÚNICO Y NO UN ADVISORY LOCK"
  --  de la cabecera. Si se cambia aquí, hay que cambiarlo allí.
  perform pg_advisory_xact_lock(
    hashtext(v_fecha::text),
    case when v_es_comida then 1 else 2 end
  );

  --  Se borra SIEMPRE primero. Así reasignar la misma mesa a la misma
  --  reserva no choca consigo misma, y el caso "quitar todas" es el mismo
  --  camino sin ramas especiales.
  delete from public.asignaciones_mesa where reserva_id = p_reserva_id;

  if p_mesa_ids is null or coalesce(array_length(p_mesa_ids, 1), 0) = 0 then
    -- Sala sin mesa: estado LEGÍTIMO. Sin excepción y sin aviso.
    return;
  end if;

  --  Mesa a mesa (no un INSERT ... SELECT) por una razón concreta: al
  --  capturar `unique_violation` necesitamos saber QUÉ mesa falló para poder
  --  decir su NOMBRE. Con un INSERT en bloque solo tendríamos el texto del
  --  error del índice.
  --
  --  `select distinct` deduplica: si llegan repetidos (el plano los manda
  --  dos veces, el usuario hace doble clic), se insertan una vez en lugar de
  --  reventar contra UNIQUE(reserva_id, mesa_id).
  --
  --  ATOMICIDAD: el bloque BEGIN/EXCEPTION solo deshace SU iteración, pero
  --  el `raise` posterior no se captura, así que aborta la llamada entera y
  --  con ella las inserciones anteriores. O todas las mesas o ninguna.
  --  `as t(mesa_id)` con alias de tabla Y de columna, y la referencia
  --  cualificada: `select distinct u from unnest(arr) as u` funciona, pero
  --  deja a Postgres decidiendo si `u` es la columna o la fila entera del
  --  alias. Nombrar la columna quita esa duda.
  for v_mesa_id in
    select distinct t.mesa_id
    from unnest(p_mesa_ids) as t(mesa_id)
    where t.mesa_id is not null
  loop
    begin
      insert into public.asignaciones_mesa (reserva_id, mesa_id)
      values (p_reserva_id, v_mesa_id);
    exception
      when unique_violation then
        get stacked diagnostics v_constraint = constraint_name;

        if v_constraint = 'uq_asignaciones_mesa_mesa_fecha_turno' then
          select m.nombre::text
            into v_mesa_nombre
          from public.mesas m
          where m.id = v_mesa_id;

          raise exception 'MESA_OCUPADA: la mesa % ya está asignada a otra reserva en ese turno',
            coalesce(v_mesa_nombre, v_mesa_id::text)
            using errcode = 'check_violation';
        end if;

        --  Cualquier otra unicidad (hoy solo UNIQUE(reserva_id, mesa_id),
        --  que el `distinct` ya hace imposible) se relanza tal cual: mentir
        --  con MESA_OCUPADA sería peor que un error crudo.
        raise;
    end;
  end loop;

  --  Se devuelve lo que ha quedado, leyéndolo de la tabla (no de una
  --  variable): así el llamante recibe las columnas derivadas tal como las
  --  dejó el trigger, no como las imaginaba el cliente.
  return query
    select a.*
    from public.asignaciones_mesa a
    join public.mesas m on m.id = a.mesa_id
    where a.reserva_id = p_reserva_id
    order by m.nombre;
end;
$fn$;

comment on function public.asignar_mesas_reserva(uuid, uuid[]) is
  'Asigna EL CONJUNTO de mesas de una reserva, de forma atómica: borra las actuales y pone las de p_mesa_ids (deduplicadas). p_mesa_ids vacío o NULL = quitar todas, lo que deja la reserva CON SALA Y SIN MESA: estado legítimo del cierre por etapas, no un error. Si una mesa ya está en otra reserva del mismo día+turno lanza MESA_OCUPADA con el NOMBRE de la mesa (ERRCODE check_violation). Toma pg_advisory_xact_lock(hashtext(fecha), 1|2 según turno), la MISMA clave que validar_capacidad_reserva(), a propósito. SECURITY INVOKER: respeta la RLS del que llama.';

-- ---------------------------------------------------------------------------
-- 8. `trg_reservas_sincronizar_asignaciones` — cancelar y mover reservas
-- ---------------------------------------------------------------------------
--   Ver el bloque "CANCELAR Y MOVER RESERVAS" de la cabecera para el por qué
--   de cada una de las tres decisiones.
create or replace function public.reservas_sincronizar_asignaciones()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $fn$
declare
  v_turno_ant text;
  v_turno_nue text;
  v_asig      record;
begin
  -- (1) CANCELADA -> liberar las mesas. Solo 'cancelada': 'completada' y
  --     'no_show' conservan la mesa (ver CORRECCIÓN 1 de la cabecera).
  --     Va primero: si el mismo UPDATE cancela Y mueve, cancelar gana.
  if new.estado = 'cancelada' and old.estado is distinct from 'cancelada' then
    delete from public.asignaciones_mesa where reserva_id = new.id;
    return null;
  end if;

  -- (2) CAMBIO DE SALA -> liberar las mesas. No se bloquea el movimiento,
  --     para no romper el kanban de salas (ver cabecera).
  if new.espacio_id is distinct from old.espacio_id then
    delete from public.asignaciones_mesa where reserva_id = new.id;
    return null;
  end if;

  -- (3) CAMBIO DE DÍA O DE TURNO -> mover las asignaciones.
  v_turno_ant := case when old.hora < '17:00:00'::time then 'comida' else 'cena' end;
  v_turno_nue := case when new.hora < '17:00:00'::time then 'comida' else 'cena' end;

  --  Un cambio de hora DENTRO del mismo turno (19:00 -> 20:30) no toca
  --  nada: la asignación sigue siendo válida.
  if new.fecha is not distinct from old.fecha and v_turno_nue = v_turno_ant then
    return null;
  end if;

  for v_asig in
    select a.id, a.mesa_id, a.espacio_id, m.nombre::text as mesa_nombre
    from public.asignaciones_mesa a
    left join public.mesas m on m.id = a.mesa_id
    where a.reserva_id = new.id
  loop
    begin
      --  El UPDATE dispara trg_asignaciones_mesa_denormalizar, que vuelve a
      --  leer la reserva (ya actualizada: estamos en un AFTER) y recalcula
      --  fecha/turno a los mismos valores. Se escriben aquí igualmente para
      --  que la intención quede explícita y el UPDATE tenga algo que cambiar.
      update public.asignaciones_mesa
         set fecha = new.fecha,
             turno = v_turno_nue
       where id = v_asig.id;
    exception
      when unique_violation then
        --  La mesa ya está pillada en el nuevo día+turno. Se DESCARTA la
        --  asignación y la reserva se mueve igual: mover una reserva no
        --  puede fallar por un conflicto de mesas (ver cabecera).
        insert into public.asignaciones_mesa_descartadas
          (reserva_id, mesa_id, mesa_nombre, espacio_id, fecha, turno, motivo)
        values
          (new.id, v_asig.mesa_id, v_asig.mesa_nombre, v_asig.espacio_id,
           new.fecha, v_turno_nue, 'conflicto_turno');

        delete from public.asignaciones_mesa where id = v_asig.id;

      when others then
        --  Misma lógica para el resto de motivos por los que la
        --  revalidación del trigger puede rechazar la asignación movida:
        --  MESA_INACTIVA (alguien desactivó la mesa después de asignarla),
        --  MESA_OTRA_SALA... Capturar `others` es deliberadamente amplio
        --  porque la regla es dura: **el UPDATE de la reserva no puede
        --  fallar**. No es silencioso: el SQLSTATE **y el mensaje** quedan
        --  escritos en el motivo, así que en la auditoría se lee literalmente
        --  `revalidacion_fallida:23514 MESA_INACTIVA: la mesa 4 ...` y el
        --  descarte es diagnosticable sin adivinar. `left(...,200)` para que
        --  un mensaje kilométrico no infle la fila.
        insert into public.asignaciones_mesa_descartadas
          (reserva_id, mesa_id, mesa_nombre, espacio_id, fecha, turno, motivo)
        values
          (new.id, v_asig.mesa_id, v_asig.mesa_nombre, v_asig.espacio_id,
           new.fecha, v_turno_nue,
           'revalidacion_fallida:' || sqlstate || ' ' || left(coalesce(sqlerrm, ''), 200));

        delete from public.asignaciones_mesa where id = v_asig.id;
    end;
  end loop;

  return null;
end;
$fn$;

comment on function public.reservas_sincronizar_asignaciones() is
  'Trigger AFTER UPDATE de reservas. Cancelar (solo el estado cancelada) o cambiar de sala BORRA las asignaciones de mesa: la mesa queda libre en vez de bloquear el cambio, para no romper el kanban de salas. Cambiar de día o de turno MUEVE las asignaciones; si la mesa ya está pillada en el destino, se descarta esa asignación (queda en asignaciones_mesa_descartadas) en vez de hacer fallar el UPDATE de la reserva. SECURITY DEFINER: liberar la mesa no puede depender de que el que cancela tenga permiso de escritura sobre asignaciones_mesa.';

drop trigger if exists trg_reservas_sincronizar_asignaciones on public.reservas;
create trigger trg_reservas_sincronizar_asignaciones
  after update of estado, espacio_id, fecha, hora on public.reservas
  for each row
  when (
    (new.estado = 'cancelada' and old.estado is distinct from 'cancelada')
    or new.espacio_id is distinct from old.espacio_id
    or new.fecha      is distinct from old.fecha
    or new.hora       is distinct from old.hora
  )
  execute function public.reservas_sincronizar_asignaciones();

-- ---------------------------------------------------------------------------
-- 9. MESAS BORRADAS: auditoría + aviso, manteniendo el CASCADE
-- ---------------------------------------------------------------------------
--   BEFORE DELETE (no AFTER) porque hace falta leer las asignaciones y el
--   `nombre` de la mesa ANTES de que la cascada de
--   `asignaciones_mesa_mesa_id_fkey` se las lleve. En un AFTER DELETE las
--   asignaciones ya no estarían.
create or replace function public.mesas_auditar_asignaciones()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $fn$
declare
  v_futuras integer := 0;
begin
  insert into public.asignaciones_mesa_descartadas
    (reserva_id, mesa_id, mesa_nombre, espacio_id, fecha, turno, motivo)
  select a.reserva_id, a.mesa_id, old.nombre::text, a.espacio_id, a.fecha, a.turno, 'mesa_borrada'
  from public.asignaciones_mesa a
  where a.mesa_id = old.id;

  select count(*)
    into v_futuras
  from public.asignaciones_mesa a
  where a.mesa_id = old.id
    and a.fecha >= current_date;

  --  Aviso en la campana SOLO si había asignaciones de hoy en adelante. Las
  --  pasadas se auditan pero no molestan a nadie: el servicio ya ocurrió.
  --
  --  COLUMNAS DE `notificaciones_dashboard` VERIFICADAS (contra
  --  20260313000000_solicitudes_y_notificaciones.sql líneas 64-76,
  --  20260923120000_origen_prioridad_notificaciones.sql y
  --  20260923140000_webhook_resend_actua_sobre_eventos.sql). La tabla es
  --  (id, tipo, titulo, mensaje, referencia_id, referencia_tipo, leida,
  --   created_at, origen, prioridad) — las dos últimas se añadieron el
  --  23/09 y hay que tenerlas en cuenta:
  --    * `tipo` NO tiene CHECK. Los valores 'solicitud_pendiente' /
  --      'reserva_nueva' / 'sistema' son un COMENTARIO en la migración
  --      original, no una restricción, así que un valor nuevo es seguro. Y
  --      en el panel, `CentroNotificaciones.tsx` (línea 105) resuelve el
  --      icono con `TIPO_ICON[notif.tipo] || Info`: un tipo desconocido cae
  --      en el icono genérico, no rompe nada.
  --    * `origen` SÍ tiene CHECK y solo admite NULL | 'reservas_web' |
  --      'emails_reserva' | 'resend_webhook'. Este aviso no viene de
  --      ninguna de esas tuberías, así que **se deja NULL** (NULL es válido
  --      y es la respuesta honesta: "no aplica"). Poner 'panel' o similar
  --      reventaría el CHECK.
  --    * `prioridad` es NOT NULL DEFAULT 'normal' con CHECK in
  --      ('alta','normal'); se usa 'alta' porque hay reservas FUTURAS que se
  --      han quedado sin mesa.
  --    * `referencia_tipo` no tiene CHECK. Se usa 'espacio' y no 'mesa'
  --      porque la mesa ya no existe y lo que el encargado necesita abrir es
  --      la sala. `CentroNotificaciones.tsx` (línea 45) solo navega cuando
  --      `referencia_tipo === 'solicitud'`, así que este valor es inerte en
  --      la UI: la notificación se lee, no lleva a ningún sitio roto.
  if v_futuras > 0 then
    insert into public.notificaciones_dashboard
      (tipo, titulo, mensaje, referencia_id, referencia_tipo, prioridad)
    values (
      'mesa_borrada_con_asignaciones',
      'Mesa borrada con reservas asignadas',
      format(
        'La mesa "%s" se ha borrado (normalmente al fusionar mesas en el editor de plano) y tenía %s asignación(es) de hoy en adelante. Esas reservas siguen con su sala pero se han quedado SIN MESA. Revisa la asignación de mesas del día.',
        old.nombre, v_futuras
      ),
      old.espacio_id,
      'espacio',
      'alta'
    );
  end if;

  return old;
end;
$fn$;

comment on function public.mesas_auditar_asignaciones() is
  'Trigger BEFORE DELETE de mesas. Copia a asignaciones_mesa_descartadas (motivo mesa_borrada) las asignaciones que la cascada de asignaciones_mesa_mesa_id_fkey se va a llevar, guardando el nombre de la mesa antes de que desaparezca, y avisa en notificaciones_dashboard si alguna era de hoy en adelante. Se MANTIENE el ON DELETE CASCADE a propósito: cambiarlo a RESTRICT haría fallar el guardado del plano al fusionar mesas (EditorPlanoEspacio.tsx ~183 borra las originales en llamadas sueltas, sin transacción que las envuelva). SECURITY DEFINER porque la política de INSERT de notificaciones_dashboard exige can_write_section(dashboard) y un usuario de Espacios sin permiso de Dashboard tiene que poder guardar el plano igualmente.';

drop trigger if exists trg_mesas_auditar_asignaciones on public.mesas;
create trigger trg_mesas_auditar_asignaciones
  before delete on public.mesas
  for each row
  execute function public.mesas_auditar_asignaciones();

-- ---------------------------------------------------------------------------
-- 10. `fn_asignaciones_futuras_de_mesas(uuid[])` — avisar ANTES de borrar
-- ---------------------------------------------------------------------------
--   HOY NO LA LLAMA NADIE. Queda disponible para que el editor de plano
--   pueda preguntar "si fusiono o borro estas mesas, ¿qué reservas futuras me
--   llevo por delante?" y avisar ANTES de guardar, en vez de dejar que el
--   encargado se entere por la campana cuando ya está hecho.
--
--   Solo lectura, `security invoker`: lo que devuelve son nombres de
--   clientes, y tiene que pasar por la RLS de `reservas` del que pregunta.
--
--   OJO al editar esto: en una función `language sql` con `RETURNS TABLE`,
--   los nombres de las columnas de salida SON parámetros y colisionan con las
--   columnas de las tablas. Por eso TODA referencia va cualificada con su
--   alias (`a.mesa_id`, `m.nombre`...). Una sola referencia sin alias daría
--   `column reference "mesa_id" is ambiguous`.
create or replace function public.fn_asignaciones_futuras_de_mesas(p_mesa_ids uuid[])
returns table (
  mesa_id        uuid,
  mesa_nombre    text,
  fecha          date,
  turno          text,
  reserva_nombre text
)
language sql
stable
security invoker
set search_path = 'public'
as $fn$
  select a.mesa_id,
         m.nombre::text,
         a.fecha,
         a.turno,
         r.nombre::text
  from public.asignaciones_mesa a
  join public.mesas m    on m.id = a.mesa_id
  join public.reservas r on r.id = a.reserva_id
  where a.mesa_id = any (coalesce(p_mesa_ids, '{}'::uuid[]))
    and a.fecha >= current_date
  order by a.fecha, a.turno, m.nombre;
$fn$;

comment on function public.fn_asignaciones_futuras_de_mesas(uuid[]) is
  'SOLO LECTURA, hoy no la llama nadie. Devuelve las asignaciones de HOY EN ADELANTE (fecha >= current_date) de las mesas indicadas, con el nombre de la mesa y del cliente, para que el editor de plano pueda AVISAR antes de guardar una fusión o un borrado que se llevaría esas asignaciones por delante (el ON DELETE CASCADE se mantiene a propósito; ver la cabecera de 20260926140000_asignaciones_mesa_sin_solapes.sql). SECURITY INVOKER: devuelve nombres de clientes y respeta la RLS de reservas.';

-- ---------------------------------------------------------------------------
-- 11. `public.vista_asignacion_dia` — quién está sin sala y quién sin mesa
-- ---------------------------------------------------------------------------
--   Una fila por reserva VIVA (pendiente/verificada/confirmada: el mismo
--   conjunto "que ocupa plaza" que usa el aforo). Las 'completada' y
--   'no_show' quedan fuera aunque conserven su mesa — esto es la pantalla de
--   "a quién me falta sentar", no un histórico.
--
--   `with (security_invoker = on)` es OBLIGATORIO en este repo y hay
--   precedente explícito: `20260919130000_fix_vista_ocupacion_hoy_estados.sql`
--   explica que una vista sin esa cláusula corre con los permisos de su
--   PROPIETARIO, salta la RLS de las tablas de debajo y reabre la fuga de
--   datos personales al rol `anon` que cerró
--   `20260918084909_cerrar_fuga_rls_anonima.sql`. Aquí la vista expone
--   NOMBRES DE CLIENTE, así que importa el doble.
--
--   El agregado va en un `cross join lateral` en vez de un LEFT JOIN +
--   GROUP BY por dos motivos: (a) una subconsulta agregada sin GROUP BY
--   devuelve SIEMPRE exactamente una fila, así que está garantizado que la
--   vista no puede duplicar reservas; (b) no hay que arrastrar media docena
--   de columnas de `reservas` a un GROUP BY, donde es fácil olvidarse una al
--   añadir columnas más adelante.
create or replace view public.vista_asignacion_dia
with (security_invoker = on)
as
select
  r.id                                                          as reserva_id,
  r.fecha::date                                                 as fecha,
  r.hora::time                                                  as hora,
  (case when r.hora < '17:00:00'::time then 'comida' else 'cena' end)::text
                                                                as turno,
  r.nombre::text                                                as nombre,
  r.numero_comensales::integer                                  as numero_comensales,
  r.estado::text                                                as estado,

  --  La marca sale de la SALA cuando hay sala (es donde se sienta la gente,
  --  y es el criterio que usa el aforo para sumar capacidad) y de la propia
  --  reserva cuando todavía no hay sala. Si `reservas.marca` y la marca de
  --  la sala no coincidieran, aquí manda la de la sala — y ese desajuste se
  --  ve precisamente comparando esta columna con `reservas.marca`.
  (case
     when r.espacio_id is null then coalesce(r.marca, 'casa_tomas')
     else coalesce(e.caracteristicas->>'marca', 'casa_tomas')
   end)::text                                                   as marca,

  r.espacio_id                                                  as espacio_id,
  e.nombre::text                                                as espacio_nombre,

  a.mesas_asignadas                                             as mesas_asignadas,
  a.plazas_asignadas                                            as plazas_asignadas,
  a.mesas_nombres                                               as mesas_nombres,

  (case
     when r.espacio_id is null   then 'sin_sala'
     when a.mesas_asignadas = 0  then 'sin_mesa'
     else                             'con_mesa'
   end)::text                                                   as grado

from public.reservas r
left join public.espacios_reserva e on e.id = r.espacio_id
cross join lateral (
  --  JOIN interno contra `mesas` a propósito: `asignaciones_mesa.mesa_id` es
  --  NOT NULL con FK, así que la mesa existe siempre. Y si alguna vez no
  --  existiera, es mejor no contar la plaza que contar una mesa fantasma con
  --  capacidad desconocida.
  select
    count(*)::integer                                           as mesas_asignadas,
    coalesce(sum(m.capacidad), 0)::integer                      as plazas_asignadas,
    --  `array_agg` de cero filas devuelve NULL, no un array vacío: el
    --  coalesce evita que el frontend tenga que distinguir NULL de [].
    coalesce(array_agg(m.nombre::text order by m.nombre), '{}'::text[])
                                                                as mesas_nombres
  from public.asignaciones_mesa am
  join public.mesas m on m.id = am.mesa_id
  where am.reserva_id = r.id
) a
where r.estado in ('pendiente', 'verificada', 'confirmada');

comment on view public.vista_asignacion_dia is
  'Una fila por reserva viva (pendiente/verificada/confirmada) con su grado de asignación: sin_sala (espacio_id NULL) -> sin_mesa (tiene sala, 0 mesas) -> con_mesa. LOS DOS GRADOS SON EL ESTADO INTERMEDIO LEGÍTIMO DEL CIERRE POR ETAPAS: el encargado reparte primero las salas (kanban) y más tarde las mesas dentro de cada sala, con el plano delante. **sin_mesa NO es un error ni un dato incompleto**: es la mitad normal de la faena, y una reserva puede quedarse así hasta el mismo día del servicio. Lo que sí merece atención es sin_sala a pocas horas del turno. plazas_asignadas suma mesas.capacidad de las mesas asignadas (0 si ninguna) y puede ser MENOR que numero_comensales: eso significa que falta mesa, no que la reserva esté mal. Excluye completada/no_show aunque conserven su mesa: esto es "a quién me falta sentar", no un histórico.';

-- ---------------------------------------------------------------------------
-- 12. GRANTS — nunca a `anon` ni a `public`
-- ---------------------------------------------------------------------------
--   Mismo patrón que el final de
--   `20260923210000_solicitud_propuesta_espacio.sql` y de
--   `20260926120000_capacidad_efectiva_mesas.sql`: `revoke all` de `public` y
--   `anon` primero (por si algún `alter default privileges` reparte permisos
--   de serie) y `grant` explícito solo a `authenticated` y `service_role`.
--
--   La vista, al ser `security_invoker = on`, ya está protegida por la RLS de
--   `reservas`/`espacios_reserva`/`mesas`/`asignaciones_mesa`, pero se le
--   quita el SELECT a `anon`/`public` igualmente: defensa en profundidad y
--   coherencia con el resto del repo. Expone nombres de clientes.
revoke all on public.vista_asignacion_dia from public, anon;
grant select on public.vista_asignacion_dia to authenticated, service_role;

revoke all on function public.asignar_mesas_reserva(uuid, uuid[]) from public, anon;
grant execute on function public.asignar_mesas_reserva(uuid, uuid[]) to authenticated, service_role;

revoke all on function public.fn_asignaciones_futuras_de_mesas(uuid[]) from public, anon;
grant execute on function public.fn_asignaciones_futuras_de_mesas(uuid[]) to authenticated, service_role;

--   Las funciones de trigger no se invocan por nombre: las llama el motor al
--   disparar el trigger, y eso no pasa por el EXECUTE del que escribe. Se les
--   quita el EXECUTE a `public`/`anon` para que nadie pueda llamarlas a mano
--   (son SECURITY DEFINER; ejecutarlas fuera de su trigger no tiene sentido y
--   no debe ser posible). No se le da EXECUTE a nadie: el trigger funciona
--   igual.
revoke all on function public.asignaciones_mesa_denormalizar() from public, anon;
revoke all on function public.reservas_sincronizar_asignaciones() from public, anon;
revoke all on function public.mesas_auditar_asignaciones() from public, anon;

-- ---------------------------------------------------------------------------
-- 13. `search_path` explícito en todas las funciones nuevas
-- ---------------------------------------------------------------------------
--   Redundante con el `SET search_path` de cada `CREATE FUNCTION`, y a
--   propósito: `20260922210000_search_path_validar_capacidad.sql` documenta
--   que un `CREATE OR REPLACE` futuro que se olvide de la cláusula deja la
--   función con search_path mutable sin que nadie se dé cuenta. Estos `ALTER`
--   son idempotentes y baratos, y dejan el catálogo en el estado correcto
--   aunque el CREATE de arriba cambie.
alter function public.asignaciones_mesa_denormalizar()          set search_path = 'public';
alter function public.asignar_mesas_reserva(uuid, uuid[])       set search_path = 'public';
alter function public.reservas_sincronizar_asignaciones()       set search_path = 'public';
alter function public.mesas_auditar_asignaciones()              set search_path = 'public';
alter function public.fn_asignaciones_futuras_de_mesas(uuid[])  set search_path = 'public';

commit;

-- ===========================================================================
-- CONSULTAS DE VERIFICACIÓN
-- ---------------------------------------------------------------------------
-- **NO SE HAN EJECUTADO**: `supabase db push` está bloqueado (ver el recuadro
-- del principio), así que nada de lo de arriba existe todavía en la base de
-- datos. Ejecutar esto el día que la migración se aplique.
--
-- De la 1 a la 8 son de SOLO LECTURA. Los bloques 9 y 10 ESCRIBEN y van
-- dentro de `begin; ... rollback;` — son las pruebas de que el solape y el
-- descarte funcionan de verdad. Leer el `rollback` final antes de empezar.
-- ---------------------------------------------------------------------------
--
-- -- 1) Las cuatro columnas nuevas existen, con la nulabilidad correcta:
-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'asignaciones_mesa'
-- order by ordinal_position;
--   -- esperado: fecha(date,NO), turno(text,NO), espacio_id(uuid,NO),
--   --           asignada_por(uuid,YES), además de
--   --           id/reserva_id/mesa_id/created_at
--
-- -- 2) EL ÍNDICE DEL SOLAPE existe, es ÚNICO y es (mesa_id, fecha, turno).
-- --    Y el viejo UNIQUE(reserva_id, mesa_id) SIGUE ahí (no se sustituye uno
-- --    por otro: hacen falta los dos):
-- select i.relname as indice, ix.indisunique as es_unico,
--        pg_get_indexdef(ix.indexrelid) as definicion
-- from pg_index ix
-- join pg_class i on i.oid = ix.indexrelid
-- where ix.indrelid = 'public.asignaciones_mesa'::regclass
-- order by i.relname;
--   -- esperado:
--   --   uq_asignaciones_mesa_mesa_fecha_turno      es_unico = true
--   --   idx_asignaciones_mesa_fecha_turno          es_unico = false
--   --   asignaciones_mesa_reserva_id_mesa_id_key   es_unico = true  <-- sigue vivo
--   --   (+ la clave primaria)
--
-- -- 3) Los tres triggers existen, en la tabla correcta y habilitados:
-- select t.tgname, t.tgrelid::regclass as tabla, t.tgenabled,
--        pg_get_triggerdef(t.oid) as definicion
-- from pg_trigger t
-- where not t.tgisinternal
--   and t.tgname in (
--     'trg_asignaciones_mesa_denormalizar',
--     'trg_reservas_sincronizar_asignaciones',
--     'trg_mesas_auditar_asignaciones'
--   )
-- order by t.tgname;
--   -- esperado: 3 filas, tgenabled = 'O' en las tres.
--   --   denormalizar -> BEFORE INSERT OR UPDATE ON asignaciones_mesa
--   --   sincronizar  -> AFTER UPDATE OF estado, espacio_id, fecha, hora
--   --                   ON reservas ... WHEN (...)
--   --                   La cláusula WHEN TIENE que aparecer: si no, el
--   --                   trigger se dispara en CADA update de reservas.
--   --   auditar      -> BEFORE DELETE ON mesas
--
-- -- 4) Las cinco funciones tienen el search_path fijado y la seguridad que
-- --    les toca (la RPC INVOKER, los tres triggers DEFINER):
-- select p.proname, p.prosecdef as es_definer, p.provolatile, p.proconfig
-- from pg_proc p
-- where p.pronamespace = 'public'::regnamespace
--   and p.proname in (
--     'asignaciones_mesa_denormalizar', 'asignar_mesas_reserva',
--     'reservas_sincronizar_asignaciones', 'mesas_auditar_asignaciones',
--     'fn_asignaciones_futuras_de_mesas'
--   )
-- order by p.proname;
--   -- esperado: proconfig = {search_path=public} en las CINCO.
--   --   es_definer = true  en asignaciones_mesa_denormalizar,
--   --                      reservas_sincronizar_asignaciones,
--   --                      mesas_auditar_asignaciones
--   --   es_definer = FALSE en asignar_mesas_reserva  <-- si sale true,
--   --                      alguien la ha convertido en DEFINER y hay que
--   --                      revertirlo: dejaría de respetar la RLS.
--   --   provolatile = 's' (STABLE) en fn_asignaciones_futuras_de_mesas
--
-- -- 5) La vista tiene security_invoker (si no sale 'on', salta la RLS y
-- --    expone nombres de clientes -> arreglarlo ANTES de dar SELECT):
-- select c.relname, c.reloptions
-- from pg_class c
-- join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public' and c.relname = 'vista_asignacion_dia';
--   -- esperado: reloptions = {security_invoker=on}
--
-- -- 6) LA VISTA DEVUELVE LOS TRES GRADOS. Cuenta cuántas reservas vivas hay
-- --    en cada grado (nada más aplicar, con asignaciones_mesa vacía, TODO
-- --    tiene que salir sin_sala o sin_mesa y con_mesa = 0; ese es el punto
-- --    de partida correcto, no un fallo):
-- select grado, count(*) as reservas, sum(numero_comensales) as comensales
-- from public.vista_asignacion_dia
-- group by grado
-- order by grado;
--   -- esperado nada más aplicar: solo 'sin_sala' y/o 'sin_mesa'.
--   -- Después de asignar mesas de verdad (o tras la prueba del bloque 9),
--   -- las tres filas.
--
-- -- 6b) Y que la vista es una PARTICIÓN exacta de las reservas vivas
-- --     (ninguna se queda fuera, ninguna se duplica):
-- select (select count(*) from public.reservas
--         where estado in ('pendiente','verificada','confirmada')) as reservas_vivas,
--        (select count(*) from public.vista_asignacion_dia)        as filas_vista;
--   -- esperado: los dos números IGUALES. Si filas_vista es mayor, el lateral
--   -- está duplicando reservas; si es menor, sobra un filtro.
--
-- -- 6c) Que el `turno` de la vista y el `turno` guardado en las
-- --     asignaciones NUNCA se separan (si esto devuelve filas, un UPDATE de
-- --     hora se ha colado sin pasar por el trigger de sincronización):
-- select v.reserva_id, v.turno as turno_vista, a.turno as turno_guardado,
--        v.fecha as fecha_vista, a.fecha as fecha_guardada
-- from public.vista_asignacion_dia v
-- join public.asignaciones_mesa a on a.reserva_id = v.reserva_id
-- where a.turno <> v.turno or a.fecha <> v.fecha;
--   -- esperado: 0 filas
--
-- -- 7) NO HAY SOLAPES (tiene que dar 0 filas siempre; si diera alguna, el
-- --    índice único no existe o se ha borrado). Esta misma consulta es la
-- --    que hay que ejecutar ANTES de aplicar la migración si la tabla
-- --    tuviera filas, para encontrar los solapes que harían fallar el
-- --    CREATE INDEX del paso 4:
-- select mesa_id, fecha, turno, count(*) as veces,
--        array_agg(reserva_id) as reservas
-- from public.asignaciones_mesa
-- group by mesa_id, fecha, turno
-- having count(*) > 1;
--   -- esperado: 0 filas
--
-- -- 8) COMPROBAR LA "CORRECCIÓN 2" DE LA CABECERA: ¿es `reservas.espacio_id`
-- --    realmente nullable? Si saliera 'NO', el grado `sin_sala` es
-- --    inalcanzable y `RESERVA_SIN_SALA` es código muerto (nada falla, pero
-- --    conviene saberlo antes de construir la UI de los dos grados):
-- select is_nullable
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'reservas'
--   and column_name = 'espacio_id';
--   -- esperado: YES (es lo que asume el panel, que inserta espacio_id: null)
--
-- ---------------------------------------------------------------------------
-- -- 9) *** PRUEBA DE SOLAPE *** — la prueba que de verdad importa.
-- --    Escribe, pero termina en ROLLBACK: no deja nada.
-- ---------------------------------------------------------------------------
-- -- 9a) Primero, buscar el material de la prueba: DOS reservas vivas del
-- --     MISMO día, MISMO turno y MISMA sala, y una mesa de esa sala:
-- select r1.id as reserva_a, r2.id as reserva_b, r1.fecha, r1.espacio_id,
--        (select m.id from public.mesas m
--         where m.espacio_id = r1.espacio_id and m.activa is not false
--         limit 1) as mesa
-- from public.reservas r1
-- join public.reservas r2
--   on r2.fecha = r1.fecha
--  and r2.espacio_id = r1.espacio_id
--  and r2.id <> r1.id
--  and (r1.hora < '17:00:00'::time) = (r2.hora < '17:00:00'::time)
-- where r1.estado in ('pendiente','verificada','confirmada')
--   and r2.estado in ('pendiente','verificada','confirmada')
--   and r1.espacio_id is not null
-- limit 1;
--   -- Si no devuelve ninguna fila (o `mesa` sale NULL), crear a mano dos
--   -- reservas de prueba en una sala QUE TENGA MESAS (a fecha 2026-09-26
--   -- solo Comedor, Salón y Terraza de casa_tomas tienen mesas cargadas) y
--   -- borrarlas después.
--
-- -- 9b) La prueba. Sustituir <A>, <B> y <MESA> por los uuid de 9a:
-- begin;
--   -- (i) La reserva A se queda la mesa. Debe devolver 1 fila, con fecha y
--   --     turno rellenos por el trigger:
--   select mesa_id, fecha, turno, espacio_id, asignada_por
--   from public.asignar_mesas_reserva('<A>'::uuid, array['<MESA>']::uuid[]);
--
--   -- (ii) La reserva B pide LA MISMA mesa, mismo día y mismo turno.
--   --      *** TIENE QUE FALLAR ***:
--   select * from public.asignar_mesas_reserva('<B>'::uuid, array['<MESA>']::uuid[]);
--   --   esperado: ERROR  MESA_OCUPADA: la mesa <nombre> ya está asignada a
--   --             otra reserva en ese turno
--   --             SQLSTATE 23514 (check_violation)
--   --   Y con el **NOMBRE de la mesa, no un uuid**: si sale un uuid, el
--   --   `select m.nombre` del manejador no encontró la mesa.
--   --   Si esto NO falla: el índice único no está. PARAR Y ARREGLARLO.
-- rollback;
--
-- -- 9c) Que el rollback ha funcionado y no queda nada de la prueba:
-- select count(*) as debe_ser_0 from public.asignaciones_mesa;
--   -- esperado: 0 (si la tabla estaba vacía antes de la prueba)
--
-- ---------------------------------------------------------------------------
-- -- 10) LAS OTRAS TRES PRUEBAS QUE MERECEN UN ROLLBACK
-- ---------------------------------------------------------------------------
-- -- 10a) Varias mesas en la misma reserva SÍ se puede (UNIQUE(reserva_id,
-- --      mesa_id) no se toca), y los repetidos se deduplican:
-- begin;
--   select count(*) as mesas_asignadas
--   from public.asignar_mesas_reserva(
--     '<A>'::uuid,
--     array['<MESA1>','<MESA2>','<MESA1>']::uuid[]   -- MESA1 repetida
--   );
--   -- esperado: 2 (no 3, y sin error)
--
--   -- Y quitar todas NO es un error: devuelve 0 filas y deja la reserva con
--   -- sala y sin mesa (grado sin_mesa):
--   select count(*) as debe_ser_0
--   from public.asignar_mesas_reserva('<A>'::uuid, null);
--   select grado from public.vista_asignacion_dia where reserva_id = '<A>'::uuid;
--   -- esperado: 0  y  grado = 'sin_mesa'
-- rollback;
--
-- -- 10b) Cancelar libera la mesa:
-- begin;
--   select count(*) from public.asignar_mesas_reserva('<A>'::uuid, array['<MESA>']::uuid[]);
--   update public.reservas set estado = 'cancelada' where id = '<A>'::uuid;
--   select count(*) as debe_ser_0
--   from public.asignaciones_mesa where reserva_id = '<A>'::uuid;
--   -- esperado: 0 (la mesa ha quedado libre para otro)
-- rollback;
--
-- -- 10c) Mover una reserva a un día+turno donde la mesa ya está pillada NO
-- --      hace fallar el UPDATE: descarta la asignación y lo deja anotado:
-- begin;
--   -- A se queda la mesa en su día; B la misma mesa un día después.
--   select count(*) from public.asignar_mesas_reserva('<A>'::uuid, array['<MESA>']::uuid[]);
--   update public.reservas set fecha = fecha + 1 where id = '<B>'::uuid;
--   select count(*) from public.asignar_mesas_reserva('<B>'::uuid, array['<MESA>']::uuid[]);
--
--   -- Ahora se mueve A al día de B: la mesa ya está pillada allí.
--   -- El UPDATE **NO debe fallar**; la asignación de A debe DESCARTARSE:
--   update public.reservas set fecha = fecha + 1 where id = '<A>'::uuid;
--
--   select motivo, mesa_nombre, fecha, turno
--   from public.asignaciones_mesa_descartadas
--   where reserva_id = '<A>'::uuid;
--   -- esperado: 1 fila, motivo = 'conflicto_turno'
--
--   select grado from public.vista_asignacion_dia where reserva_id = '<A>'::uuid;
--   -- esperado: 'sin_mesa' (se movió igual, pero sin mesa)
-- rollback;
--
-- -- 10d) Borrar una mesa con asignación futura audita y avisa (esta es la
-- --      que cubre la fusión del editor de plano):
-- begin;
--   select count(*) from public.asignar_mesas_reserva('<A>'::uuid, array['<MESA>']::uuid[]);
--   delete from public.mesas where id = '<MESA>'::uuid;
--
--   select motivo, mesa_nombre, fecha, turno
--   from public.asignaciones_mesa_descartadas where mesa_id = '<MESA>'::uuid;
--   -- esperado: 1 fila, motivo = 'mesa_borrada', con el NOMBRE de la mesa
--
--   select tipo, titulo, prioridad, origen, referencia_tipo
--   from public.notificaciones_dashboard
--   order by created_at desc limit 1;
--   -- esperado (solo si la reserva era de hoy en adelante):
--   --   tipo = 'mesa_borrada_con_asignaciones', prioridad = 'alta',
--   --   origen = NULL (obligatorio: el CHECK de origen no admite otro
--   --   valor para esta tubería), referencia_tipo = 'espacio'
-- rollback;
--
-- ---------------------------------------------------------------------------
-- -- 11) Y que los grants quedaron como se quería (NO debe aparecer `anon`
-- --     ni `PUBLIC` en ninguna fila):
-- select 'vista_asignacion_dia' as objeto, relacl::text as permisos
-- from pg_class where oid = 'public.vista_asignacion_dia'::regclass
-- union all
-- select 'asignaciones_mesa_descartadas', relacl::text
-- from pg_class where oid = 'public.asignaciones_mesa_descartadas'::regclass
-- union all
-- select 'asignar_mesas_reserva', proacl::text
-- from pg_proc where oid = 'public.asignar_mesas_reserva(uuid, uuid[])'::regprocedure
-- union all
-- select 'fn_asignaciones_futuras_de_mesas', proacl::text
-- from pg_proc where oid = 'public.fn_asignaciones_futuras_de_mesas(uuid[])'::regprocedure;
-- ---------------------------------------------------------------------------
