# Proceso de cambios: del desarrollo a producción

Vale para los dos repos, `restcasatomascrevillent/web-casatomas` (web) y `restcasatomascrevillent/admin-casatomas` (panel). Este documento es el mismo en ambos.

```
 1. Desarrollo  ──►  2. Demo (staging)  ──►  3. Se comprueba  ──►  4. PR staging → main  ──►  5. TÚ lo aceptas en GitHub  ──►  Producción
```

Nada llega a producción sin el paso 5, y el paso 5 solo lo da el dueño, a mano y en GitHub.

## Entornos

| | Rama | Supabase | Web | Panel |
|---|---|---|---|---|
| **Demo** | `staging` | `sfonaclosuafvlhutkon` (casatomas-staging) | https://web-casatomas-git-staging-casa-tomas.vercel.app | https://admin-casatomas-git-staging-casa-tomas.vercel.app |
| **Producción** | `main` | `haqmmdfdzzatdnrrcgez` (casatomas-prod) | https://web-casatomas.vercel.app | https://admin-casatomas.vercel.app |

- La demo es una **copia de los datos reales**, pero sin Stripe ni Resend: no cobra ni manda correos. Las URL de demo piden entrar con la cuenta de Vercel.
- El proyecto viejo (`jeamoczmbfsnwkfjxcyo`, repos de `oficiososia`) ya no es producción. No se toca.

## Paso a paso

### 1. Desarrollo

Quien desarrolla (normalmente Claude) hace los cambios en la rama `staging`, o en una rama aparte que luego se fusiona en `staging`. Los tests tienen que pasar en local antes de subir.

Si el cambio toca **Supabase**, que no pasa por Vercel:

- Las **migraciones** van a `admin-casatomas/supabase/migrations/` y se aplican **primero en la demo**.
- Las **funciones** se despliegan **primero en la demo**: `npx supabase functions deploy <función> --project-ref sfonaclosuafvlhutkon`.

### 2. Subida a la demo

Al subir a `staging`:

- Vercel publica la demo en 1–3 minutos.
- El CI pasa los tests en GitHub (pestaña *Actions*).
- La versión de la demo sube; se ve en el pie del menú del panel: `v0.14 · Demo`.

### 3. Comprobación

Se prueba en la demo lo que ha cambiado. Quien desarrolló debe decir qué probar.

### 4. PR a producción (automático)

En cada subida a `staging`, el workflow *Propuesta a producción* abre o actualiza **un único PR `staging → main`**. Lleva:

- **Título:** `Producción admin-casatomas: v0.14 (ahora v0.9)`, es decir, la versión que tendrá producción y la que tiene ahora.
- **Descripción:**
  - Enlace a la demo.
  - Lista de comprobación.
  - Todos los commits que entrarían.
  - Los cambios de **Supabase** que habrá que aplicar en producción, si los hay.

El PR se va actualizando solo mientras siga habiendo subidas a `staging`. Lo que aceptes es lo que haya en ese momento.

### 5. Aceptación (solo el dueño, en GitHub)

1. En GitHub, **con la cuenta `restcasatomascrevillent`**, abre el repo y entra en **Pull requests**. Abre el PR *Producción …*. No lo aceptes con otra cuenta (por ejemplo `oficiososia`): el plan Hobby de Vercel bloquea los despliegues de usuarios que no son del equipo y producción se queda en *BLOCKED* aunque el PR esté fusionado.
2. Revisa la descripción y la pestaña **Files changed** si quieres, y marca la lista de comprobación.
3. Pulsa **Merge pull request** con la opción **Create a merge commit**. **No** uses *Squash and merge* ni *Rebase and merge*: con ellas Vercel **no** publica.
4. Pulsa **Confirm merge**.

Después, sin hacer nada más:

- **Vercel** publica producción en 1–3 minutos.
- El workflow *Versión de producción* crea la etiqueta `vM.N` y una **Release** en GitHub con los cambios. Es el historial de lo que se ha publicado y cuándo.
- El panel de producción muestra la nueva versión: `v0.14 · Producción`.
- Si el PR traía cambios de **Supabase**, hay que aplicarlos en producción justo después. Se le pide a Claude: «aplica en producción lo de la v0.14». Nadie lo hace sin ese «sí».

### Si algo va mal en producción

1. En Vercel, abre el proyecto y ve a **Deployments**. Busca el despliegue anterior y pulsa **⋯ → Instant Rollback** para volver atrás al momento.
2. El arreglo se hace en `staging` y vuelve a pasar por un PR. **Nunca** se arregla directamente en `main`.

## Por qué nada llega a producción sin tu aceptación

- **Vercel** solo publica producción si el último commit de `main` es la aceptación de un PR desde `staging`, es decir, el mensaje `Merge pull request #N from …/staging`. Lo comprueba `scripts/vercel-produccion.mjs`, enganchado en `vercel.json` (`ignoreCommand`). Si alguien empuja directamente a `main` o fusiona con *squash* o *rebase*, Vercel cancela el despliegue y lo marca como *Canceled by Ignored Build Step*. Producción sigue con lo que tenía.
- **Claude** tiene prohibido empujar a `main` y fusionar PR (`CLAUDE.md`).
- **Límite conocido:** en repos privados del plan gratuito, GitHub no permite reglas de protección de ramas. Alguien con permisos de escritura podría escribir en `main`, pero no se publicaría. Con GitHub Team se puede cerrar del todo (ver *Configuración*).

## Versiones

Formato **`M.N`**, calculado solo, sin tocar nada a mano (`scripts/version.mjs`):

- **M** es el número `mayor` de `versionado.json`. Vale **0 hasta la salida a producción**.
- **N** es el número de commits desde el último cambio de `versionado.json`, **sin contar merges**. **Cada commit suma 1.**

Consecuencias:

- **La demo va igual o por delante de producción.** Aceptar el PR es un merge y no suma, así que producción queda exactamente con la versión que tenía la demo. Las subidas siguientes a la demo la vuelven a adelantar.
- **Para pasar a 1.0** se cambia `"mayor": 0` por `"mayor": 1` en `versionado.json`, con un commit en `staging`. La demo pasa a `1.0` y producción al aceptar ese PR. Después: `1.1`, `1.2`… Solo se cambia de mayor cuando lo decide el dueño.

Dónde se ve:

- En el **pie del menú del panel**: `v0.14 · Demo` en ámbar o `v0.14 · Producción` en verde. Al pasar el ratón sale el commit.
- En **`/version.json`** de la web y del panel, en cada entorno.
- En el **título del PR** a producción y en las **Releases** de GitHub.

La versión necesita el historial completo de git al compilar. Por defecto, Vercel clona solo los últimos commits; por eso los dos proyectos tienen la variable `VERCEL_DEEP_CLONE=true` (Preview y Production, puesta el 27-10-2026). No está en la documentación oficial de Vercel, pero es la forma conocida de pedir el clon completo. Si alguna vez la versión sale como `v0.?`, falta esa variable o ha dejado de funcionar. El motivo aparece al pasar el ratón y en el log del build: `Versión 0.? · … · AVISO: …`.

## Configuración necesaria (una vez)

**Vercel** (hecho el 27-10-2026): `VERCEL_DEEP_CLONE=true` en Preview y Production de `web-casatomas` y `admin-casatomas`.

**GitHub** (la hace el dueño), en **los dos repos**:

1. **Settings → Actions → General → Workflow permissions:** marca **Read and write permissions** y **Allow GitHub Actions to create and approve pull requests**. Sin esto no se crea el PR automático y el workflow avisa con el enlace para abrirlo a mano. Si la opción sale bloqueada, hay que activarla antes en **Organization settings → Actions → General**.
2. **Settings → General → Pull Requests:** deja marcada solo **Allow merge commits** y desmarca **Allow squash merging** y **Allow rebase merging**. Así el único botón disponible es el correcto.
3. *(Solo con GitHub Team o superior)* **Settings → Rules → Rulesets** para la rama `main`:
   - Exigir pull request.
   - Bloquear *force push* y borrado.
   - Exigir los checks del CI: `tests-y-build` en el panel y `tests-y-e2e` en la web.

## Reglas para quien desarrolla

- Trabajar en `staging`. Nunca empujar a `main`, nunca *force push*.
- Los commits que se suban deben ir a nombre de alguien del equipo de Vercel o de `Claude <noreply@anthropic.com>`. El plan Hobby de Vercel **bloquea** (`BLOCKED`) los commits cuyo autor tiene cuenta de Vercel pero no es del equipo.
- Supabase: demo primero; producción solo después de aceptar el PR y con el «sí» del dueño.
- No editar `versionado.json` salvo para cambiar de mayor.
