# Scripts de rollback

**Estos ficheros NO son migraciones y no deben volver a `supabase/migrations/`.**

Vivían dentro de `supabase/migrations/`, donde la CLI los indexaba como migraciones normales
y `supabase db push` los habría ejecutado en orden alfabético justo después de la migración
que revierten. El caso peor era `20260919120000_rebuild_webs_state_ROLLBACK.sql`, que hace
`drop table if exists public.web_rebuild_state`: la tabla se habría creado y borrado en el
mismo push. Además, dos de ellos compartían versión con su migración (`20260918084909`,
`20260918120000`) y el tercero participaba en la colisión triple de `20260919120000`.

Se ejecutan **a mano** (psql / SQL editor) y solo para deshacer un despliegue que salió mal.

| Fichero | Revierte | Efecto de ejecutarlo |
|---|---|---|
| `20260918084909_cerrar_fuga_rls_anonima_ROLLBACK.sql` | `migrations/20260918084909_cerrar_fuga_rls_anonima.sql` | **Reabre la fuga de datos personales accesible con la anon key.** Quita `security_invoker` de las vistas, restaura las políticas `USING (true)` y devuelve `EXECUTE` a `public`/`anon` en las funciones `SECURITY DEFINER`. |
| `20260918120000_rls_por_permisos_de_seccion_ROLLBACK.sql` | `migrations/20260918120000_rls_por_permisos_de_seccion.sql` | Vuelve al estado que dejó la Fase 1. **Devuelve a cualquier usuario autenticado lectura y escritura totales** sobre reservas, trabajadores, facturas, blacklist, llamadas y newsletter. No revierte la Fase 1 y deja `can_read_section()` / `can_write_section()` creadas y sin uso. |
| `20260919120000_rebuild_webs_state_ROLLBACK.sql` | `migrations/20260919120002_rebuild_webs_state.sql` (antes `20260919120000_…`, renumerada para deshacer la colisión de versión) | Borra la política y la tabla `public.web_rebuild_state`. |
| `20260922170000_cerrar_insert_anonimo_reservas_ROLLBACK.sql` | `migrations/20260922170000_cerrar_insert_anonimo_reservas.sql` | **Reabre el INSERT anónimo sin validar contenido sobre `reservas`.** Devuelve el `GRANT INSERT ... TO anon` y recrea la política `reservas_insert_anon_formulario_web`. No recrea la política vieja `"Público puede crear reservas"` (ya estaba borrada antes de la migración que revierte; ver su cabecera). |
| `20260926120000_capacidad_efectiva_mesas_ROLLBACK.sql` | `migrations/20260926120000_capacidad_efectiva_mesas.sql` | Borra la vista `vista_capacidad_espacios` y las funciones `fn_capacidad_efectiva_espacio(uuid)` y `fn_capacidad_efectiva_marca(text)`. No hay datos que perder: la migración es puramente aditiva y de solo lectura, y **no toca el aforo** (el trigger `trg_validar_capacidad` sigue sumando `capacidad_maxima` tanto con la migración como sin ella). **AVISO: si alguien ya encendió la regla de capacidad por mesas**, el trigger llama a `fn_capacidad_efectiva_marca` y borrarla deja **todas las reservas rotas** en la siguiente inserción (`function ... does not exist`, no un error de aforo). Hay que revertir el trigger PRIMERO; ver el aviso crítico dentro del propio fichero. |
| `20260926140000_asignaciones_mesa_sin_solapes_ROLLBACK.sql` | `migrations/20260926140000_asignaciones_mesa_sin_solapes.sql` | **Reabre el solape de mesas.** Borra el índice único `uq_asignaciones_mesa_mesa_fecha_turno`, que es la única garantía de que la misma mesa no se le dé a dos reservas del mismo día y turno (el advisory lock de la RPC serializa y da un mensaje legible, pero no garantiza nada por sí solo). Borra además los tres triggers (`trg_asignaciones_mesa_denormalizar`, `trg_reservas_sincronizar_asignaciones`, `trg_mesas_auditar_asignaciones`), la RPC `asignar_mesas_reserva(uuid, uuid[])`, `fn_asignaciones_futuras_de_mesas(uuid[])`, la vista `vista_asignacion_dia` y las cuatro columnas nuevas de `asignaciones_mesa` (`fecha`, `turno`, `espacio_id`, `asignada_por`). **Las filas de `asignaciones_mesa` NO se borran**, y la tabla de auditoría `asignaciones_mesa_descartadas` **se conserva a propósito** (su `drop table` queda comentado al final del fichero): es el único registro de qué reservas se quedaron sin mesa. Lo único irrecuperable es `asignada_por` — hay una consulta de respaldo dentro del fichero. **AVISO: si el panel ya llama a la RPC**, borrarla no falla aquí pero rompe la pantalla de asignación de mesas con un `PGRST202` ("function not found in schema cache") en el primer intento; hay que revertir el frontend PRIMERO. No toca el aforo. |
| `20260926150000_modo_servicio_config_y_salida_ROLLBACK.sql` | `migrations/20260926150000_modo_servicio_config_y_salida.sql` | Devuelve `fn_reservas_limpiar_llegada()` y su trigger a la versión de `20260923180000_reservas_llegada.sql` (solo limpian `llegada_at`, no `salida_at`), borra las tres columnas de umbral de `configuracion_reservas` (`estancia_comida_minutos`, `estancia_cena_minutos`, `retraso_gracia_minutos`) y borra `reservas.salida_at`. Se pierde cualquier `salida_at` guardado y cualquier ajuste de esos tres umbrales. **No toca `asignaciones_mesa`** (la migración tampoco la tocó): el historial de mesas por reserva se conserva. |
| `20260927100000_mesas_numero_fiable_ROLLBACK.sql` | `migrations/20260927100000_mesas_numero_fiable.sql` | **Reabre los números de mesa duplicados.** Borra el índice único parcial `uq_mesas_espacio_nombre_real`, que es la única garantía de que dos mesas de la misma sala no lleven el mismo número (el aviso de `src/components/espacios/nombresMesa.ts` vive en el navegador: cualquier escritura que no pase por ese formulario puede volver a dejar dos mesas «9» en el Salón, que es justo el bug que el dueño quiso cerrar). Devuelve además `vista_capacidad_espacios`, `fn_capacidad_efectiva_espacio(uuid)` y `fn_capacidad_efectiva_marca(text)` a la versión de `20260926120000`, es decir a **volver a sumar las mesas fusionadas junto con las originales que el editor de plano no consiguió borrar**: el Salón vuelve a declarar 64 plazas en vez de 36. La vista se recrea con DROP + CREATE (`create or replace view` no puede quitar columnas), así que **pierde las seis columnas nuevas**, entre ellas `plazas_mesas_sin_duplicar` y `mesas_originales_huerfanas`, que son las que miden las fusiones a medias. **Los renombrados de datos NO se revierten**: las mesas marcadas con el sufijo ` (revisar)` se quedan con ese nombre, y la que se desactivó se queda desactivada — el nombre original no está guardado en ninguna parte (solo salió por el `raise notice` al aplicar la migración) y hay que reponerlo a mano desde el editor de plano; el fichero lleva dentro las consultas para localizar esas filas. Ninguna fila se borra ni hay que recuperar ninguna: la migración no hace ningún DELETE, a propósito. **AVISO: si alguien encendió la regla de aforo por mesas**, esto no rompe nada de golpe (al contrario que el rollback de `20260926120000`, aquí las funciones no se borran, solo vuelven al cuerpo viejo) pero **infla el aforo en silencio**: el trigger vuelve a contar plazas duplicadas y el sistema acepta reservas para sillas que no existen, sin ningún error. Ver el «AVISO 2» dentro del fichero. No toca el trigger de aforo ni `EditorPlanoEspacio.tsx`. |
| `20260928120000_mesas_asignaciones_rls_por_seccion_ROLLBACK.sql` | `migrations/20260928120000_mesas_asignaciones_rls_por_seccion.sql` | **Reabre la escritura libre sobre el comedor.** Devuelve a cualquier usuario autenticado crear, editar y borrar mesas y asignar mesas a reservas sin pasar por `can_write_section()`: borra las 12 políticas `*_seccion` / `*_service_role` de `mesas`, `asignaciones_mesa` y `asignaciones_mesa_descartadas`, y recrea las **14** originales tal y como estaban en `pg_policies` el 2026-09-28, duplicados incluidos (`mesas` vuelve a tener dos políticas por cada verbo: las de 20251207090324 con rol `public` y `auth.uid() IS NOT NULL`, y las de 20260208164215 con `TO authenticated USING (true)`). Se recrean las dos a propósito: el estado al que se vuelve las tenía las dos, y dejar solo una no sería un rollback sino otro cambio. Devuelve además los dos privilegios que la RLS no cubre y que la migración había quitado: `TRUNCATE` a `authenticated` en las tres tablas — **TRUNCATE no pasa por las políticas**, así que por sí solo basta para vaciar `mesas` y `asignaciones_mesa` — y `SELECT, REFERENCES, TRIGGER` a `anon` en esas dos (`asignaciones_mesa_descartadas` no recupera nada de `anon`: nunca lo tuvo, ya se lo había revocado `20260926140000`). **No hay datos que perder ni que recuperar**: la migración no hace ningún INSERT, UPDATE ni DELETE sobre filas, solo políticas y privilegios. **No toca ninguna función ni ningún trigger**: `asignar_mesas_reserva` sigue `SECURITY INVOKER` y los tres triggers `SECURITY DEFINER` (`trg_asignaciones_mesa_denormalizar`, `trg_reservas_sincronizar_asignaciones`, `trg_mesas_auditar_asignaciones`) quedan igual antes y después, y ninguna de las 10 funciones implicadas necesitaba `search_path` (ya lo tenían todas). **AVISO: si para entonces el panel ya deshabilita botones por permiso** (hoy `PlanoEspacio2D.tsx` no comprueba ninguno), revertir el frontend **DESPUÉS** de esto, no antes: al revés deja botones apagados sobre una base de datos abierta, pero nunca al revés. No toca el aforo, ni `espacios_reserva`, ni `reservas`. |

El bloqueo de
`supabase db push` que tenía pendientes a `20260926120000`, `20260926140000` y
`20260926150000` (el historial local y el remoto no coincidían porque `20260925150523` y
`20260925154109` se habían aplicado sin commitear los ficheros) se resolvió recuperando y
commiteando esas cinco migraciones sin fichero, en el commit `e0796e3`.

**Todos los rollbacks de esta tabla revierten migraciones ya aplicadas en producción, salvo
`20260928120000_mesas_asignaciones_rls_por_seccion_ROLLBACK.sql`**, que revierte una
migración escrita el 2026-09-28 y **todavía sin aplicar**: el dueño pidió expresamente no
aplicar nada sin su confirmación, y queda pendiente una decisión suya (si crear y borrar
mesas debe exigir super admin en vez de la sección `reservas`; ver el bloque «DECISIÓN
PENDIENTE» dentro de la migración). Mientras esa migración no se aplique, **ejecutar su
rollback no hace falta y no haría nada útil**: intentaría recrear políticas que ya existen y
fallaría en el primer `create policy` por nombre duplicado. `supabase db push` ya **no** está
bloqueado.

El resto sí revierten migraciones ya aplicadas,
incluido `20260927100000_mesas_numero_fiable_ROLLBACK.sql`. Corregido el 2026-09-28: la
versión anterior de este párrafo decía que `20260927100000` estaba pendiente y que la última
aplicada era `20260926150000`, y lo advertía porque se escribió sin acceso de lectura a
Supabase. Ya se comprobó contra `supabase_migrations.schema_migrations`, y las cinco últimas
versiones aplicadas son `20260927100000`, `20260926150000`, `20260926140000`,
`20260926130000` y `20260926121000`.

Consecuencia práctica: el índice `uq_mesas_espacio_nombre_real` **existe hoy en producción**,
con esta definición (verificada, no deducida):

```sql
CREATE UNIQUE INDEX uq_mesas_espacio_nombre_real ON public.mesas
USING btree (espacio_id, lower(btrim(regexp_replace((nombre)::text, '\s+'::text, ' '::text, 'g'::text))))
WHERE ((COALESCE(is_merged, false) = false) AND (COALESCE(activa, true) = true));
```

Por ser **parcial sobre `coalesce(activa,true) = true`**, desactivar una mesa (`activa =
false`) libera su número para otra mesa de la misma sala. De eso depende que el editor de
plano pueda fusionar sin borrar filas; ver `EditorPlanoEspacio.tsx`. Ejecutar ese rollback
ya NO es inofensivo: borra un índice que está en uso.
