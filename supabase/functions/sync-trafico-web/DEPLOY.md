# sync-trafico-web — despliegue

Lee Vercel Web Analytics de las dos webs y lo guarda en `trafico_web_diario`,
`trafico_web_desglose` y `trafico_web_sync_estado`. La llama el job de pg_cron
`sync-trafico-web` a las 03:30 UTC con la cabecera `x-webhook-secret` (Vault).

| Slug guardado | Proyecto de Vercel (equipo "Casa tomas", `team_18KKVg7ueSX0PL4Ycy1QakZj`) |
|---|---|
| `casa-tomas-story` | `web-casatomas` · `prj_0sGVG2CWWPpZWwy1zrr0nCPftcYQ` |
| `touza-restaurant-website` | `touza-casatomas` · `prj_rV4u5MRropGlLxSVPCCJV8kbwkgv` |

Los IDs están fijos en `sync.ts` (`PROYECTOS`) y `vercel.ts` (`VERCEL_TEAM_ID`).

## Por qué dejó de funcionar tras la migración de cuenta (27-10-2026)

Desde el primer cron en el proyecto nuevo (28-10, 03:30 UTC) Vercel responde
`400 web_analytics_not_enabled — Web Analytics is not enabled for this project`
a los dos proyectos: se crearon en el equipo nuevo **sin Web Analytics
activado**. El token, el secreto del cron y el job de PROD están bien. Con
Web Analytics apagado Vercel no guarda las visitas: **los días en que estuvo
apagado no se pueden recuperar**, ni con el backfill de 30 días.

## Orden de despliegue (DEMO primero, después PROD)

El orden importa: si se activa Web Analytics con la versión anterior de la
función desplegada, guardará como «0 visitas» los días en que estuvo apagado.

1. Migración `supabase/migrations/20261101093700_trafico_web_datos_desde.sql`
   (columna `datos_desde`, sembrada con el 01-11-2026). Nunca `db push`.
2. Desplegar la función (lee `datos_desde`):
   `npx supabase functions deploy sync-trafico-web --project-ref <ref>`
   (`supabase/config.toml` ya tiene `verify_jwt = false`).
3. Solo la DEMO, o PROD cuando exista `project_url` en Vault: migración
   `20261101093800_trafico_web_cron_url_desde_vault.sql`. En la DEMO crea el
   job (no existía); en PROD lo reescribe sin la URL en duro. Falla sin
   cambiar nada si falta `project_url` o `trafico_web_cron_secret` en Vault.
4. Secrets que tiene que tener la función (`npx supabase secrets list --project-ref <ref>`):
   `TRAFICO_WEB_CRON_SECRET` (mismo valor que el secreto de Vault
   `trafico_web_cron_secret`) y `VERCEL_ANALYTICS_TOKEN` (token personal de
   alguien del equipo "Casa tomas", con ese equipo como *scope*; el token del
   conector MCP da 404 en esta API).
5. El dueño activa Web Analytics en `web-casatomas` y `touza-casatomas` y
   vuelve a desplegar las dos webs (las dos ya llevan `@vercel/analytics`).
6. Run manual (sin esperar al cron):
   ```sql
   select net.http_post(
     url := (select rtrim(decrypted_secret, '/') from vault.decrypted_secrets where name = 'project_url')
            || '/functions/v1/sync-trafico-web',
     headers := jsonb_build_object('Content-Type', 'application/json',
       'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'trafico_web_cron_secret')),
     body := '{}'::jsonb, timeout_milliseconds := 55000);
   -- (en PROD, sin project_url, poner la URL https://haqmmdfdzzatdnrrcgez.supabase.co/functions/v1/sync-trafico-web)
   select status_code, content from net._http_response order by created desc limit 1;
   select proyecto, ultimo_ok_en, ultimo_error, fallos_consecutivos, datos_desde from public.trafico_web_sync_estado;
   ```
   Antes del paso 5: 502 y `ultimo_error` = «Web Analytics está desactivado
   en el proyecto … de Vercel…». Después: 200, `ultimo_error` NULL,
   `fallos_consecutivos` 0. El mismo día de activarlo no hay ningún día
   cerrado que traer (`dias: 0`): la función solo comprueba el acceso. Los
   datos llegan con el cron de la noche siguiente.

## Comportamiento

- Rango: últimos 3 días cerrados; tras una caída, desde el último éxito − 2
  días, como mucho 30 días atrás (Hobby da 31). Nunca antes de `PRIMER_DIA`
  (27-10-2026, corte) ni de `datos_desde` del proyecto.
- `datos_desde`: primer día en que Vercel puede tener datos. Cada intento que
  encuentra Web Analytics apagado lo sube a ese día. La API rellena con 0 los
  días sin datos, así que sin este suelo esos días saldrían como 0 visitas en
  vez de como hueco. El día de la activación queda parcial (desde esa hora);
  si se activa entre las 00:00 y las 03:30 UTC, el día anterior puede quedar a 0.
- 429/5xx/red: hasta 3 intentos por llamada (backoff 1 s, 2 s; respeta
  Retry-After ≤ 10 s). 400 no se reintenta. Con `web_analytics_not_enabled`
  corta tras la primera consulta.
- Un proyecto que falla no bloquea al otro: HTTP 207 (uno) o 502 (los dos).
- En fallo: `ultimo_error`, `fallos_consecutivos+1`, se conserva `ultimo_ok_en`.
  Aviso en la campana (`notificaciones_dashboard`, tipo `sistema`, título
  `Tráfico web: ...`), máximo 1 por día UTC. El panel traduce el error de Web
  Analytics desactivado a qué hay que hacer.

## Si se activó Web Analytics antes de desplegar esta versión

La versión anterior habrá guardado ceros desde el 27-10 hasta el día de
activarlo. Para dejarlos como hueco (sustituir `<día anterior a activarlo>`):

```sql
delete from public.trafico_web_diario   where fecha between '2026-10-27' and '<día anterior a activarlo>';
delete from public.trafico_web_desglose where fecha between '2026-10-27' and '<día anterior a activarlo>';
```

## Rollback

- Función: volver a desplegar la versión anterior.
- Migraciones, a mano y en este orden: `supabase/rollbacks/20261101093800_trafico_web_cron_url_desde_vault_ROLLBACK.sql`
  y, con la función anterior ya desplegada, `supabase/rollbacks/20261101093700_trafico_web_datos_desde_ROLLBACK.sql`.
- Apagarlo del todo: `select cron.unschedule('sync-trafico-web');`.
