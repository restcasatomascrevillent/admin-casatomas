# Proceso de cambios: del desarrollo a producción

Vale para los dos repos, `restcasatomascrevillent/web-casatomas` (web) y `restcasatomascrevillent/admin-casatomas` (panel). Este documento es el mismo en ambos.

```
 feature/x ──PR──┐
 fix/y     ──PR──┼──►  staging  (la demo: todo junto, para probar)
 feature/z ──PR──┘
                         │  eliges qué sale:  #12 y #15, pero no #14
                         ▼
 main ──────────►  release/1.4.0 = main + SOLO #12 y #15 + versión + CHANGELOG
                         │  preview propia, CI, prueba rápida, capturas
                         ▼
                   PR release/1.4.0 → main  ──►  TÚ lo aceptas en GitHub  ──►  producción v1.4.0
```

Nada llega a producción sin que el dueño acepte en GitHub el PR de una release, y una release solo lleva los cambios que se eligen.

## Por qué funciona así

Hasta el 08/11/2026 había un único PR `staging → main` que se actualizaba solo, y Vercel solo publicaba ese merge. Aceptarlo publicaba **todo** lo acumulado en staging, también lo que aún no se quería lanzar (ese día, en el panel, Reservas, Instagram y los originales de la carta iban juntos). Ahora staging sigue siendo la demo donde se prueba todo junto, pero producción se alimenta de ramas `release/X.Y.Z` que parten de `main` y llevan solo la selección.

## Ramas y entornos

| Rama | Para qué | Vercel despliega | Supabase |
|---|---|---|---|
| `main` | Lo que está en producción | **Producción**, solo al aceptar un PR desde `release/X.Y.Z` | `haqmmdfdzzatdnrrcgez` (prod) |
| `staging` | Integración: todo lo terminado, junto | **Demo**, en cada subida | `sfonaclosuafvlhutkon` (demo) |
| `release/X.Y.Z` | Una publicación: `main` + la selección | **Preview de la candidata**, en cada subida | demo |
| `feature/*`, `fix/*` | Un cambio cada una | No (el CI corre en su PR) | — |

- Demo web: https://web-casatomas-git-staging-casa-tomas.vercel.app · panel: https://admin-casatomas-git-staging-casa-tomas.vercel.app
- Producción web: https://web-casatomas.vercel.app · panel: https://admin-casatomas.vercel.app
- La demo y las previews usan una **copia de los datos reales**, sin Stripe ni Resend: no cobran ni mandan correos. Desde el 04/11/2026 se abren sin la cuenta de Vercel (se quitó *Vercel Authentication*; para volver a cerrarlas: Vercel → proyecto → *Settings → Deployment Protection*). El panel sigue pidiendo usuario y contraseña.
- El proyecto viejo (`jeamoczmbfsnwkfjxcyo`, repos de `oficiososia`) no se toca.

## Guía práctica

### 1. Desarrollar un cambio

1. Rama desde `staging`: `feature/<tema>` para algo nuevo, `fix/<tema>` para un arreglo. **Un cambio por rama**: es la unidad que luego se puede publicar o dejar fuera.
2. Commits con tipo: `feat(reservas): …`, `fix(carta): …`, `refactor`, `perf`, `docs`, `test`, `chore`. Si cambia un comportamiento, añade en el cuerpo dos líneas `Antes: …` y `Ahora: …`: salen tal cual en el informe del PR de la release.
3. Tests en local (`npm test`; en la web también `npm run test:e2e` si tocas reservas, carta, cheques o maquetación; en el panel `npm run test:cheques:db` y `npm run build`).
4. PR de la rama a `staging` y fusión con **Create a merge commit** (o *Squash*). Así el cambio se puede elegir luego por su número (`#12`). Si se integra en local, el mensaje debe llevar el número: `Merge branch 'fix/x' into staging (#12)`.
5. Vercel publica la demo en 1–3 minutos. Se prueba ahí.

Si el cambio toca **Supabase** (Vercel no lo aplica): migraciones en `admin-casatomas/supabase/migrations/` y funciones en `supabase/functions/`, **primero en la demo** (`npx supabase functions deploy <función> --project-ref sfonaclosuafvlhutkon`). Si un cambio necesita a otro (p. ej. el panel usa una tabla que crea otro PR), dilo en su PR: «Depende de #12».

### 2. Ver qué está pendiente de publicar

```bash
git fetch origin
node scripts/release.mjs pendientes
```

Lista lo que hay en staging y no en producción, por PR o commit, con el identificador para elegirlo.

### 3. Preparar la release con lo que quieres publicar

**En GitHub (sin instalar nada):** *Actions → Release · preparar → Run workflow*. Escribe la selección (`#12 #15 a1b2c3d`) y el objetivo («Mesas al final en Reservas»). Crea `release/X.Y.Z`, abre el PR a `main` con el informe y lanza las comprobaciones. GitHub solo deja lanzar a mano los workflows que ya están en `main`: aparece a partir de la v1.0.0, así que esa primera release se prepara en local.

**En local (lo hace Claude):**

```bash
node scripts/release.mjs preparar '#12' '#15' --objetivo "Mesas al final en Reservas" --simular
node scripts/release.mjs preparar '#12' '#15' --objetivo "Mesas al final en Reservas"
git push -u origin release/1.4.0
node scripts/release.mjs informe --head release/1.4.0 --salida informe.md
```

Y se abre el PR `release/1.4.0 → main` con `informe.md` como descripción. `--simular` comprueba sin crear nada.

Qué hace, en una copia temporal que no toca tu carpeta:

- Parte del `main` actual (lo que está en producción) y aplica **solo** lo elegido, en el orden en que entró en staging. Un PR fusionado con merge commit entra entero; uno con squash es un commit.
- **Ya publicado:** si algo ya está en producción, lo dice y lo omite.
- **Dependencias:** si un cambio elegido modifica líneas que escribió otro que no está en producción ni en la selección, o **usa** algo que crea otro (una tabla o función de SQL, una acción de una Edge Function, un export), **se bloquea** y dice cuál falta y por qué. No lo añade por su cuenta. Si estás seguro de que no hace falta (p. ej. solo comparten un nombre), repite con `--no-depende <sha>`: queda anotado en el commit de la release.
- **Conflictos:** si un cambio no entra limpio sobre `main`, se bloquea con los ficheros y el commit que probablemente falta.
- **Merges de integración** (staging metido en una rama) no se pueden elegir: hay que elegir el PR o los commits del cambio.
- **Versión y CHANGELOG:** sube la versión (ver *Versiones*), escribe la entrada del CHANGELOG solo con lo incluido y crea la rama `release/X.Y.Z`. Opciones: `--tipo patch|minor|major`, `--version X.Y.Z`.

Las dependencias que no se ven en el código (p. ej. un dato que tiene que existir en la base de datos de producción) no las detecta nadie: por eso se valida la candidata y el informe lista el impacto operativo.

### 4. Validar la candidata (la combinación exacta)

En el PR de la release corren solos:

| Check | Qué valida |
|---|---|
| **CI** (`tests-y-e2e`/`tests-y-build`, `calidad`) | Tests, build y e2e de `main` + la selección, no de staging |
| **Validar release a producción** | La rama es `release/X.Y.Z`, `versionado.json` y el CHANGELOG dicen esa versión, parte del último `main` y la etiqueta no existe |
| **Release · candidata** | Vercel despliega la rama; su `/version.json` lleva la versión y el commit exactos; en la web, la prueba rápida (humo) contra esa preview; capturas antes/después si hay cambios visuales. Actualiza el informe del PR con los resultados |

La preview de la candidata está en el PR (check de Vercel y apartado *Validación*). Pruébala ahí: es exactamente lo que se publicará.

- **Si hay que corregir algo:** mejor arreglarlo en staging (PR a staging) y volver a preparar la release (`git push origin --delete release/1.4.0`, cerrar el PR y repetir el paso 3). Un commit directo en la rama de la release también vale; el informe lo marca como «hecho en la release» y al publicar vuelve a staging solo.
- **Si `main` cambia** mientras la release está abierta, «Validar release a producción» falla: hay que prepararla otra vez.

### 5. Revisar el PR de la release

La descripción la genera `scripts/release.mjs informe` a partir de la diferencia real con `main` (no de los mensajes): versión y objetivo, qué cambia (antes → ahora), qué se añade, cambios incluidos con enlaces, qué queda pendiente en staging, validación, impacto operativo (migraciones, funciones, variables, dependencias; solo si hay), capturas (solo si hay cambios visuales) y cómo volver atrás. Si la diferencia trae algo que no está en la lista, lo avisa con ⚠️. Lo que se escriba fuera de las marcas `informe-release` se conserva al regenerarlo.

Antes de aceptar: que los checks estén en verde, haber mirado la preview y leer *Impacto operativo*.

### 6. Publicar

1. En GitHub, **con la cuenta `restcasatomascrevillent`**, abre el PR *Release vX.Y.Z* y pulsa **Merge pull request** con **Create a merge commit**. No uses otra cuenta (el plan Hobby de Vercel bloquea sus despliegues) ni *Squash* o *Rebase* (Vercel no publica).
2. Después, sin hacer nada más:
   - **Vercel** publica producción en 1–3 minutos.
   - **Release · publicar** crea la etiqueta `vX.Y.Z` y la **GitHub Release** con la entrada del CHANGELOG, integra `main` en `staging` (si choca, abre un PR `main → staging`) y, cuando Vercel termina, comprueba que producción sirve `vX.Y.Z` con ese commit y lo anota en la Release.
3. Si la release trae cambios de **Supabase**, se aplican en producción justo después, con el «sí» del dueño: «aplica en producción lo de la v1.4.0».

### Urgencias

Rama `fix/<tema>` desde **`main`**, PR a `staging` para verlo en la demo, y release solo con ese arreglo. Si no puede esperar a staging: `node scripts/release.mjs preparar <sha> --desde origin/fix/<tema>`.

### Volver atrás

1. Inmediato: Vercel → proyecto → **Deployments** → el despliegue de producción anterior → **⋯ → Instant Rollback**. El informe de cada release dice cuál es (versión y commit). Después de un Instant Rollback, Vercel deja de asignar solos los dominios de producción a los despliegues nuevos: la siguiente release no se publicaría hasta pulsar **Undo Rollback** (o **⋯ → Promote** sobre ella). Para volver a un despliegue de producción anterior sin ese efecto, usa **⋯ → Promote** sobre él: no reconstruye nada.
2. Límites: no deshace migraciones ni funciones de Supabase (las migraciones traen su `*_ROLLBACK.sql`), ni datos guardados ni variables. `main` sigue con la versión retirada hasta que una release nueva lo revierta (`git revert -m 1 <merge>` en un `fix/`, y release patch).

## Versiones

Formato **`X.Y.Z`** (desde la 1.0.0; antes era `0.N`, que contaba commits). La versión identifica una **publicación**: no sube con cada commit.

- La fija `scripts/release.mjs` al preparar la release: **minor** (1.**4**.0) si incluye alguna función nueva (`feat`), **patch** (1.4.**1**) si solo arreglos u otros, **major** solo a petición (`--tipo major`). Desde 0.x la primera es siempre **1.0.0**.
- Vive en `versionado.json`; nadie lo edita a mano. `main` tiene la de producción.
- **CHANGELOG.md**: una entrada por release, solo con lo incluido. Etiqueta `vX.Y.Z` y GitHub Release con ese texto.
- Versión, commit y despliegue quedan unidos: `/version.json` de cada entorno da versión y commit; la GitHub Release dice el commit y la comprobación de producción; la etiqueta apunta al merge commit que publicó Vercel.

Dónde se ve:

- En el **panel**, arriba del menú: `v1.4.0 · Producción` (verde), `v1.4.0 · Preview` (azul, la candidata) o `v1.3.2 · Demo` (ámbar; la demo enseña la última publicada y, al pasar el ratón, `v1.3.2+abc1234`: lleva cambios sin publicar).
- En **`/version.json`** de la web y del panel: `version` (`1.4.0`, o `1.3.2+abc1234` en la demo), `publicada`, `commit`, `rama`, `entorno`.
- En el **título del PR** de la release, la **etiqueta** y la **GitHub Release**.

## Qué protege producción

- **Vercel** solo publica producción si el último commit de `main` es la aceptación de un PR desde `release/X.Y.Z` **y** `versionado.json` dice esa versión (`scripts/vercel-produccion.mjs`, en `vercel.json` → `ignoreCommand`). Un push directo, un *squash*, un *rebase* o un PR desde `staging` se cancelan (*Canceled by Ignored Build Step*).
- El check **Validar release a producción** falla en cualquier PR a `main` que no sea una release correcta.
- **Claude** no empuja a `main` ni fusiona PR hacia `main` (`CLAUDE.md`).
- **Límite conocido:** en repos privados del plan gratuito GitHub no permite reglas de protección; alguien con permiso de escritura podría escribir en `main`, pero no se publicaría. Con GitHub Team se cierra del todo (ver abajo).
- **Límite conocido:** el control de Vercel solo actúa sobre lo que llega desde git. Un despliegue a mano con la CLI o la API de Vercel (`vercel --prod`, `vercel deploy --prod`, `vercel promote`, o sus equivalentes desde una integración) con una cuenta del equipo publica lo que haya en ese ordenador sin pasar por nada. Pasó el 09/11/2026: las dos producciones se desplegaron así (con el mismo código, pero sin versión ni commit en `/version.json` y, en el panel, sin identificador para el service worker) y se volvieron a poner los despliegues de git con **Promote**. Por eso está prohibido (ver *Reglas*). Señal de alarma: `/version.json` de producción sin `commit` o con una versión que no es la de `main`.

## Configuración necesaria (la hace el dueño, una vez, en los dos repos)

1. **GitHub Actions tiene que poder arrancar.** Desde el 04/11/2026 todos los jobs fallan en 3 segundos sin que GitHub les asigne máquina (sin registro): ni el CI ni las releases se ejecutan. Es lo que pasa cuando se agotan los minutos o el límite de gasto de Actions en repos privados. Revisar en **Settings (de la cuenta u organización) → Billing and plans → Usage / Spending limits** y en **Actions → la ejecución → Annotations**.
2. **Settings → Actions → General → Workflow permissions:** **Read and write permissions** y **Allow GitHub Actions to create and approve pull requests** (para «Release · preparar» y la vuelta a staging).
3. **Settings → General → Pull Requests:** solo **Allow merge commits** (desmarca *squash* y *rebase*).
4. *(Con GitHub Team o superior)* **Settings → Rules → Rulesets** para `main`: exigir pull request, bloquear *force push* y borrado, y exigir los checks `tests-y-e2e` + `calidad` (web) o `tests-y-build` (panel), **Validar release a producción** y **Candidata en preview**.
5. *(Solo si se vuelve a proteger la demo con Vercel Authentication)* secreto `VERCEL_AUTOMATION_BYPASS_SECRET` en los dos repos, para que la validación de la candidata pueda abrir la preview.

`VERCEL_DEEP_CLONE=true` (Preview y Production) ya no hace falta para la versión; se puede dejar.

## Reglas para quien desarrolla

- Un cambio por rama `feature/*` o `fix/*`, PR a `staging`. Nunca empujar a `main`, nunca *force push*, nunca fusionar hacia `main`.
- **Nunca desplegar ni promocionar en Vercel a mano** (CLI, API o integraciones): producción solo se publica desde git, al aceptar el PR de una release. La única excepción es volver atrás cuando el dueño lo pida expresamente.
- Commits a nombre de alguien del equipo de Vercel o de `Claude <noreply@anthropic.com>` (el plan Hobby **bloquea** los de autores con cuenta de Vercel que no son del equipo).
- Las releases llevan solo lo que pide el dueño. Si `preparar` se bloquea, se le explica qué falta; no se añaden cambios por cuenta propia.
- `versionado.json` y `CHANGELOG.md` solo los escribe `scripts/release.mjs`.
- Supabase: demo primero; producción solo después de aceptar el PR de la release y con el «sí» del dueño.
