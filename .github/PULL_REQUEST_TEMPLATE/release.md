<!--
Plantilla del PR de una release (release/X.Y.Z → main). Normalmente NO se rellena a mano:
la genera `node scripts/release.mjs informe --head release/X.Y.Z` a partir de la diferencia
real con main, y el workflow «Release · candidata» la actualiza con los resultados.
Úsala a mano solo si no se puede generar. Ver docs/PROCESO-DE-CAMBIOS.md.
-->
## vX.Y.Z · <proyecto>

**Producción ahora:** vA.B.C (`commit`) · **al aprobar:** vX.Y.Z (`commit`) · rama `release/X.Y.Z`

**Objetivo:** qué se publica y para qué, en una frase.

### Qué cambia
- **Título** (#PR): antes … → ahora …

### Qué se añade
- **Título** (#PR): qué puede hacer el usuario que antes no.

### Cambios incluidos
| Cambio | Tipo | Ficheros | Líneas |
| --- | --- | --- | --- |
| #PR Título | PR | n | +x −y |

### Qué queda pendiente
- Lo que sigue en staging y no sale con esta versión.

### Validación
- Tests, build y e2e de esta combinación: checks **CI**.
- Reglas de la release: check **Validar release a producción**.
- Candidata en preview: URL · versión y commit comprobados · prueba rápida.

### Impacto operativo
<!-- Solo si hay migraciones, funciones de Supabase, variables nuevas, dependencias o pasos a mano. -->

### Capturas
<!-- Solo si hay cambios visuales: antes (main) / después (candidata), con datos de prueba. -->

### Reversión
- Vercel → Deployments → despliegue de producción de vA.B.C → Instant Rollback.
- Límites: lo que Vercel no deshace (migraciones, funciones, datos).
