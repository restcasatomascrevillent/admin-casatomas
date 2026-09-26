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

Los dos primeros revierten migraciones **ya aplicadas en producción**. Los cuatro restantes
revierten migraciones **todavía pendientes**: si nunca se aplican, no hay nada que revertir.
Los dos últimos (`20260926120000` y `20260926140000`) lo están por el mismo motivo concreto: a
fecha 2026-09-26 `supabase db push` está bloqueado porque el historial local y el remoto no
coinciden (`20260925150523` y `20260925154109` se aplicaron en producción sin commitear los
ficheros).
