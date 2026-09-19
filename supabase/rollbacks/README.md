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

Los dos primeros revierten migraciones **ya aplicadas en producción**. El tercero revierte una
migración **todavía pendiente**: si nunca se aplica, no hay nada que revertir.
