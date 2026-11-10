# CI/CD · referencia técnica

> **Proceso y guía práctica:** [PROCESO-DE-CAMBIOS.md](PROCESO-DE-CAMBIOS.md). Aquí solo qué pieza hace qué. Es igual en la web y en el panel salvo donde se indica.

## Quién despliega qué

| Evento | Vercel | GitHub Actions |
|---|---|---|
| Push a `feature/*`, `fix/*` | nada (`git.deploymentEnabled`) | CI en su PR |
| Push a `staging` | **Demo** (Supabase demo) | CI |
| Push a `release/X.Y.Z` | **Preview de la candidata** (Supabase demo) | CI y *Release · candidata* en el PR |
| PR `release/X.Y.Z` → `main` aceptado | **Producción**, si el merge viene de `release/X.Y.Z` y `versionado.json` coincide (`scripts/vercel-produccion.mjs`) | *Release · publicar* |
| Cualquier otro commit en `main` | cancelado (*Ignored Build Step*) | aviso, sin versión |

## Workflows (`.github/workflows/`)

| Fichero | Cuándo | Qué hace |
|---|---|---|
| `ci.yml` | PR, push a `staging`/`main`, a mano | Tests, build y e2e (web) o PGlite (panel); calidad; en PR a `main`, **Validar release a producción** (`release.mjs comprobar`) |
| `release-preparar.yml` | A mano | `release.mjs preparar` con la selección, sube `release/X.Y.Z`, abre el PR con el informe y lanza el CI y la candidata |
| `release-candidata.yml` | PR `release/*` → `main` | Espera la preview de Vercel, comprueba versión y commit (`comprobar-despliegue.mjs`), humo (web), capturas antes/después con datos de prueba (`capturas-release.mjs`, a la rama `capturas-release`) y regenera el informe del PR |
| `release.yml` | Push a `main`, a mano | Etiqueta `vX.Y.Z`, GitHub Release con el CHANGELOG, integra `main` en `staging` y comprueba producción (`esperar-despliegue.mjs` + `comprobar-despliegue.mjs`) |
| `humo.yml` (web) | A mano o tras desplegar producción | Prueba rápida de solo lectura; en producción exige el commit y la versión de `versionado.json` |

## Scripts (`scripts/`)

| Script | Uso |
|---|---|
| `release.mjs` | `pendientes`, `preparar`, `comprobar`, `informe`, `notas`. Selección, dependencias, conflictos, versión y CHANGELOG. Pruebas: `scripts/__tests__/release.test.mjs` |
| `version.mjs` | Versión del build (`/version.json` y etiqueta del panel) a partir de `versionado.json` y la rama |
| `vercel-produccion.mjs` | *Ignored Build Step* de Vercel: qué commits de `main` se publican |
| `comprobar-despliegue.mjs` | Que una URL sirve la versión y el commit esperados |
| `esperar-despliegue.mjs` | Espera el despliegue de Vercel de un commit (deployments de GitHub) y da su URL |
| `capturas-release.mjs` | Capturas antes/después en móvil y escritorio con datos de prueba |

## Ficheros de versión

- `versionado.json` → `{"version": "X.Y.Z"}`: la de producción en `main`, la candidata en `release/X.Y.Z`.
- `CHANGELOG.md` → una entrada por release (la crea la primera).
- Etiquetas `vX.Y.Z` y GitHub Releases (las `v0.N` anteriores son del sistema viejo).

## Seguridad y datos

- Los workflows no usan secretos de Supabase ni de Stripe; las capturas usan datos de prueba (web: build de los e2e; panel: Supabase falso de `tests/e2e-movil`).
- Las previews (demo y candidatas) usan el Supabase de la demo, que es una copia de los datos reales sin Stripe ni Resend.
- No ejecutar pruebas de pago, reservas o envíos reales contra producción.
