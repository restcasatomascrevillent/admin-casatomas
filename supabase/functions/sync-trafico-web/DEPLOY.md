# sync-trafico-web — checklist de despliegue

Estado: **código listo, SIN desplegar**. Nada de lo de abajo está hecho.
El orden importa: migración -> secrets -> deploy -> Vault -> primer run.

## 0. Requisitos previos
- [ ] `<Analytics />` desplegado en casa-tomas-story y touza-restaurant-website, y Web Analytics activado en ambos proyectos de Vercel.
- [ ] Token **personal** de Vercel con acceso al team `team_wUrFe4kT5oMBrGSl6b3Gvl9Z`.
      El token del conector MCP de Vercel da 404 en `/v1/query/web-analytics`: no sirve.
      Comprobación manual (no pegar el token en ningún fichero del repo):
      `curl -H "Authorization: Bearer $TOKEN" "https://api.vercel.com/v1/query/web-analytics/visits/aggregate?teamId=team_wUrFe4kT5oMBrGSl6b3Gvl9Z&projectId=prj_c2Wks17JsKHSG5slQ8zRlLI5Vkgu&since=<ayer>&until=<ayer>&by=day&limit=100"`
      -> 200 con `data:[{timestamp, visitors, pageviews}]`. **Anotar qué devuelve `by=day` solo** (no verificado; si da 400, la función cae a sumar rutas y el total es cota inferior).

## 1. Migración (Fase 1)
- [ ] `supabase db query --linked -f supabase/migrations/20260923200000_trafico_web.sql` (demo primero; nunca `db push`).
      El job `sync-trafico-web` queda creado pero MUDO (no hay secreto en Vault todavía).

## 2. Secrets de la Edge Function
- [ ] Generar un valor aleatorio largo para el cron (p.ej. `openssl rand -hex 32`).
- [ ] `supabase secrets set VERCEL_ANALYTICS_TOKEN=<token personal>`
- [ ] `supabase secrets set TRAFICO_WEB_CRON_SECRET=<valor aleatorio>`
- [ ] `supabase secrets list` muestra las dos (sin valores).
- Si falta `TRAFICO_WEB_CRON_SECRET` la función responde 500 a todo (fail closed). Si falta `VERCEL_ANALYTICS_TOKEN`, 500 tras autenticar.

## 3. Deploy
- [ ] `supabase/config.toml` tiene `[functions.sync-trafico-web] verify_jwt = false` (ya añadido).
- [ ] `supabase functions deploy sync-trafico-web`
- [ ] Prueba de humo sin cabecera -> **401**:
      `curl -i -X POST https://<project-ref>.supabase.co/functions/v1/sync-trafico-web`

## 4. Vault (enciende el cron) — SOLO después del deploy
- [ ] `select vault.create_secret('<MISMO valor que TRAFICO_WEB_CRON_SECRET>', 'trafico_web_cron_secret');`

## 5. Primer run manual (backfill de 30 días, límite Hobby = 31)
- [ ] Lanzar:
      ```sql
      select net.http_post(
        url := 'https://<project-ref>.supabase.co/functions/v1/sync-trafico-web',
        headers := jsonb_build_object('Content-Type','application/json',
          'x-webhook-secret',(select decrypted_secret from vault.decrypted_secrets where name='trafico_web_cron_secret')),
        body := '{}'::jsonb, timeout_milliseconds := 55000);
      ```
- [ ] Respuesta (`select status_code, content from net._http_response order by created desc limit 1;`): 200, `backfill:true`, `dias:30`, `total_origen` (`by_day` esperado; si sale `suma_rutas`, `by=day` solo no está soportado).
- [ ] `select * from public.trafico_web_sync_estado;` -> 2 filas, `fallos_consecutivos=0`, `ultimo_error` NULL, `dias_ultimo_sync=30`.
- [ ] `select proyecto, count(*), min(fecha), max(fecha) from public.trafico_web_diario where ruta='*' group by 1;` -> 30 días por proyecto, hasta ayer (UTC).

## 6. Idempotencia (tarea 2.5)
- [ ] Anotar `select count(*) from trafico_web_diario` y `... trafico_web_desglose`.
- [ ] Relanzar el paso 5 -> los dos recuentos NO cambian (ahora es run normal de 3 días; upsert por PK).

## 7. Cron
- [ ] `select jobname, schedule, active from cron.job where jobname='sync-trafico-web';` -> 1 fila, `30 3 * * *`.
- [ ] Al día siguiente: `ultimo_ok_en` de hoy ~03:30 UTC.

## Comportamiento ante fallos (para no alarmarse)
- 429/5xx/red: hasta 3 intentos por llamada (backoff 1 s, 2 s; respeta Retry-After ≤ 10 s). 400 no se reintenta.
- Un proyecto que falla no bloquea al otro: HTTP 207 (uno) o 502 (los dos).
- En fallo: `ultimo_error`, `fallos_consecutivos+1`, `ultimo_ok_en` se conserva. Aviso en la campana (`notificaciones_dashboard`, tipo `sistema`, título `Tráfico web: ...`), máximo 1 por día UTC.
- Tras una caída de varios días, el siguiente run amplía el rango para cubrir el hueco (hasta 30 días atrás; lo anterior se pierde por el límite Hobby).

## Rollback
- `select cron.unschedule('sync-trafico-web');` y borrar el secreto de Vault.
- `supabase functions delete sync-trafico-web`; `supabase secrets unset VERCEL_ANALYTICS_TOKEN TRAFICO_WEB_CRON_SECRET`.
- Tablas/RPC: ver ROLLBACK al final de la migración.
