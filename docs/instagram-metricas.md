# Instagram en el panel: métricas

Complementa a [instagram.md](instagram.md) (crear y publicar piezas). Este
documento solo cubre la pestaña **Métricas**.

## Métricas

Qué enseña la pestaña:

- **Resumen de 7 o 28 días** con la variación frente al periodo anterior de la
  misma duración: seguidores (y los ganados), alcance, visualizaciones,
  interacciones, cuentas que interactúan y visitas al perfil.
- **Gráfico diario** de alcance (eje izquierdo) y seguidores (eje derecho).
- **Publicaciones** con miniatura, enlace a Instagram, alcance, interacciones,
  me gusta y tasa de interacción. Se pueden ordenar por recientes o por alcance.
- **Qué funciona mejor**: alcance medio, interacción media y tasa de
  interacción por **plantilla**, por **marca** y por **tipo de foto**. Solo
  cuentan las publicaciones que salieron de una pieza del panel
  (`instagram_piezas.media_id`), porque de las demás no se sabe la plantilla ni
  la foto.
- Botón **Actualizar ahora**: pide las métricas a Meta en ese momento. Como
  mucho una vez cada 5 minutos y solo con permiso de **edición** de Marketing.
  Para ver la pestaña basta el permiso de **lectura**.

Cómo leer las cifras:

- **Alcance del periodo = suma del alcance de cada día.** Meta da el alcance
  diario (cuentas únicas de ese día). Una cuenta que vio contenido tres días
  cuenta tres veces. Lo mismo pasa con «cuentas que interactúan».
- **Seguidores**: se apunta `followers_count` en cada captura. El primer
  día solo hay un punto en el gráfico; la línea se completa con los días.
- **Publicaciones**: las cifras son las **acumuladas** desde que se publicó
  (*lifetime*). Se guarda una fila por día de captura, así que también queda
  la evolución de cada publicación.
- Meta avisa de que los datos **pueden tardar hasta 48 h**. Por eso cada
  captura vuelve a pedir los últimos 3 días y sobrescribe lo que había.
- Las **historias** solo se pueden medir durante sus 24 h. Con menos de 5
  interacciones Meta no da sus métricas (error 10), y en ese caso la captura
  lo apunta como aviso, no como error.

### Arquitectura

```
 pg_cron 05:00 UTC ── pg_net + x-webhook-secret (Vault) ──►  Edge Function instagram-metricas  ──► Graph API v26.0
 Panel «Actualizar ahora» ── JWT (can_write_section) ────►    acción «capturar»                       /{ig}/insights, /{ig}?fields=followers_count,
                                                               └─ guarda con la clave de servicio       /{ig}/media, /{ig}/stories, /{media}/insights
                                                                  ▼
                                              instagram_metricas_cuenta · instagram_metricas_publicacion · instagram_metricas_capturas
                                                                  ▲
 Panel pestaña «Métricas» ── JWT (can_read_section) ─────►    acción «leer» (lee COMO EL USUARIO, con RLS; no llama a Meta)
```

Código:

- Migración `supabase/migrations/20261106100000_instagram_metricas.sql` y su
  rollback `supabase/rollbacks/20261106100000_instagram_metricas_ROLLBACK.sql`.
  Pruebas PGlite: `npm run test:instagram-metricas:db`.
- Edge Function `supabase/functions/instagram-metricas/`: `index.ts`
  (envoltorio de auditoría), `metricas.ts` (quién llama y qué acción),
  `capturar.ts`, `leer.ts`, `resumen.ts` (7/28 días y variación) y
  `acceso.ts` (PostgREST como usuario o con la clave de servicio). Llamadas a
  Meta en `supabase/functions/_shared/instagram/insights.ts`, sobre el mismo
  `ClienteGraph` que publicar, sin cambiarlo. Pruebas sin red en
  `__tests__/` (vitest).
- Panel `src/components/instagram/metricas/`: `MetricasInstagram.tsx`
  (componente), `useMetricasInstagram.ts` (TanStack Query), `api.ts`,
  `agregacion.ts` («Qué funciona mejor») y `tipos.ts`. Pruebas en
  `__tests__/`.

### Tablas

| Tabla | Una fila por | Qué guarda |
|---|---|---|
| `instagram_metricas_cuenta` | día (Europe/Madrid) + `ig_user_id` | seguidores, alcance, visualizaciones, visitas al perfil, cuentas que interactúan, interacciones, me gusta, comentarios, guardados, compartidos, toques en enlaces del perfil |
| `instagram_metricas_publicacion` | `media_id` + día de captura | tipo de medio y producto (FEED/REELS/STORY), fecha de publicación, enlace, miniatura, pie (300 car.), alcance, me gusta, comentarios, guardados, compartidos, visualizaciones, interacciones; `pieza_id` → `instagram_piezas.id` (opcional) |
| `instagram_metricas_publicacion_ultima` (vista) | `media_id` | la última captura de cada publicación (`security_invoker`) |
| `instagram_metricas_capturas` | captura | origen (cron/panel/servicio), si salió bien, error y avisos (ya saneados) |

`NULL` significa que Meta no dio el dato. **RLS**: leer con
`can_read_section('marketing')` y sesión de panel viva. Escribir, **solo
`service_role`**: ningún usuario, ni el super admin, puede editarlas a mano.

### Métricas que se piden (Graph API v26.0)

Fuente, consultada el 04/11/2026 (la referencia ya va por v27.0 y no cambia
estas métricas):

- Cuenta: [developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights](https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights)
- Publicación: [developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights](https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights)
  (la URL `…/api-reference/instagram-media/insights` da 404).

| Qué | Llamada | Métricas |
|---|---|---|
| Cuenta, por día | `GET /{ig-user-id}/insights?period=day&metric_type=total_value&since=<00:00 Madrid>&until=<00:00 del día siguiente>` | `reach`, `views`, `accounts_engaged`, `total_interactions`, `likes`, `comments`, `saves`, `shares`, `profile_links_taps` |
| Visitas al perfil | la misma, aparte | `profile_views` (**no figura** en la tabla de la referencia v26; si Meta la rechaza, queda `NULL` y se avisa una vez) |
| Seguidores | `GET /{ig-user-id}?fields=followers_count` | campo del nodo IG User |
| Publicaciones | `GET /{ig-user-id}/media?fields=id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count&limit=30` + `GET /{ig-user-id}/stories` | — |
| Por publicación (FEED y REELS) | `GET /{media-id}/insights` (lifetime) | `reach`, `likes`, `comments`, `saved`, `shares`, `views`, `total_interactions` (si Meta rechaza las dos últimas, «en desarrollo», se repite con las cinco primeras) |
| Por historia | `GET /{media-id}/insights` | `reach`, `views`, `shares`, `total_interactions` |

- **`impressions` está retirada** (v22.0 en adelante, y todas las versiones
  desde el 21/04/2025). La sustituye `views`, que es lo que se guarda como
  «visualizaciones».
- Las métricas de cuenta con `period=day` admiten `metric_type=total_value`.
  Solo `reach` admite además `time_series`, así que se pide un día por
  llamada.
- **No verificado:** si `since`/`until` con medianoche de Madrid se respetan
  exactamente o Meta los redondea a sus propios días. La referencia solo dice
  que son marcas Unix y que el rango es inclusivo.
- Permisos del token (usuario del sistema, Unified login, `graph.facebook.com`):
  `instagram_basic` + **`instagram_manage_insights`**. Para publicar ya hacía
  falta `instagram_content_publish`, así que el token necesita los tres.

### Si falta el permiso `instagram_manage_insights`

La captura falla en la primera llamada de la cuenta y no guarda nada. La
función responde **502** con `tipo: "permiso_insights"`, el panel muestra un
aviso con los pasos y la captura queda registrada con
`error_tipo = 'permiso_insights'`. Por eso el aviso sale aunque el fallo haya
sido del cron.

Cómo arreglarlo:

1. **Meta Business Suite → Configuración del negocio → Usuarios → Usuarios
   del sistema** → (el usuario) → **Generar token**.
2. Elige la app y marca `instagram_basic`, `instagram_content_publish` e
   **`instagram_manage_insights`**, con caducidad «Nunca». Si el permiso no
   aparece, añádelo antes a la app en developers.facebook.com → (app) → Casos
   de uso / Permisos.
3. Cambia `IG_ACCESS_TOKEN` en los secretos de Supabase (`npx supabase
   secrets set IG_ACCESS_TOKEN=… --project-ref <ref>` o Dashboard → Edge
   Functions → Secrets). No hace falta volver a desplegar.
4. Pulsa **Actualizar ahora** en la pestaña.

### Contrato de la función

`${SUPABASE_URL}/functions/v1/instagram-metricas`. Respuestas JSON saneadas:
nunca llevan el token de Meta, la clave de servicio, el secreto del cron ni el
JWT.

- **Leer**: `GET` (o `POST {"accion":"leer"}`) con `Authorization: Bearer
  <JWT>` + `apikey`. 401 sin sesión, 403 sin lectura de Marketing.
  Devuelve 200 `{ ok, igUserId, hoy, ultimoDia, resumen: { d7, d28 } | null,
  serie[28], publicaciones[≤60], ultimaCaptura, ultimaCorrecta }`. Cada
  periodo es `{ dias, desde, hasta, diasConDatos, diasConDatosAnterior,
  metricas: { alcance, visualizaciones, interacciones, cuentasInteraccion,
  visitasPerfil, toquesEnlaces: { actual, anterior, variacion },
  seguidores: { …, cambio } } }`. Cada publicación lleva `marca`,
  `plantilla`, `formato`, `foto` y `tipoFoto`. `tipoFoto` solo viene
  relleno para las fotos subidas (`instagram_fotos`); el de las fotos del
  catálogo estático lo pone el panel.
- **Capturar**: `POST {"accion":"capturar"}`. La aceptan:
  - el **cron**, con `x-webhook-secret` igual a
    `INSTAGRAM_METRICAS_CRON_SECRET`, comparado en tiempo constante (sin el
    secreto configurado, rechaza todo);
  - la **clave de servicio**, con `Authorization: Bearer <service_role>`;
  - un **usuario** con `can_write_section('marketing')`.

  Respuestas:
  - 200 `{ ok, fechaCaptura, dias, publicaciones, avisos }`.
  - 502 `permiso_insights`.
  - 503 `configuracion`, si faltan secretos de Meta (lleva `problemas` y
    `comoArreglarlo`).
  - 429 `demasiado_pronto` (solo desde el panel).
  - Los demás errores de Meta siguen los mismos códigos que
    `instagram-publicar`.

`verify_jwt = false` en `supabase/config.toml` porque el cron llama sin JWT,
igual que `sync-trafico-web`. Por la misma razón está en
`ADMITE_INTEGRACION` (`_shared/audit-client.ts`), con su mecanismo declarado
en `_shared/__tests__/admite-integracion.test.ts`.

### Cron y secretos

La tarea `instagram-metricas-diarias` se ejecuta a las `0 5 * * *` UTC, es
decir, a las 06:00 en Madrid en invierno y a las 07:00 en verano: pg_cron va
en UTC. Copia el patrón de `20261101093800_trafico_web_cron_url_desde_vault.sql`:
en cada ejecución lee de Vault la URL del proyecto y el secreto. Si falta
alguno, la tarea no llama a nadie, pero la migración se aplica igual y avisa
con un NOTICE.

| Dónde | Nombre | Valor |
|---|---|---|
| Vault | `project_url` | `https://<ref>.supabase.co` (ya existe si se aplicó `20261030153000`) |
| Vault | `instagram_metricas_cron_secret` | un valor largo aleatorio |
| Secretos de la función | `INSTAGRAM_METRICAS_CRON_SECRET` | **el mismo** valor |
| Secretos de la función | `IG_ACCESS_TOKEN`, `IG_USER_ID`, `META_APP_ID` (y opcionales) | los de [instagram.md](instagram.md) |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` los pone la
plataforma.

### Desplegar en la demo (`sfonaclosuafvlhutkon`)

Desde la raíz del repo (`admin-casatomas/`). Producción
(`haqmmdfdzzatdnrrcgez`) solo después de aceptar el PR y con el «sí» del
dueño.

```
# 1. Migración (necesita 20261105090000_instagram.sql aplicada)
npx supabase db query --linked -f supabase/migrations/20261106100000_instagram_metricas.sql

# 2. Secreto del cron: genera un valor largo y aleatorio y ponlo en los dos sitios.
#    En el SQL Editor de la demo:
#      select vault.create_secret('<valor>', 'instagram_metricas_cron_secret');
#      select name from vault.secrets where name = 'project_url';  -- si no sale:
#      select vault.create_secret('https://sfonaclosuafvlhutkon.supabase.co', 'project_url');
npx supabase secrets set INSTAGRAM_METRICAS_CRON_SECRET=<valor> --project-ref sfonaclosuafvlhutkon

# 3. Función (verify_jwt = false sale de config.toml)
npx supabase functions deploy instagram-metricas --project-ref sfonaclosuafvlhutkon
```

Para probar, entra con un usuario de Marketing (edición), abre la pestaña y
pulsa **Actualizar ahora**. Para ver el cron:
`select * from public.instagram_metricas_capturas order by inicio desc limit 5;`
y, al día siguiente, una fila con `origen = 'cron'`.

### Límites

- Una captura hace unas 7 llamadas de cuenta (3 días con sus visitas al
  perfil, más los seguidores), 2 de listas y 1 por publicación (hasta 30 más
  las historias), de 5 en 5. En total unas 40 llamadas, muy por debajo del
  límite de uso de la app.
- Las **miniaturas** son URL del CDN de Instagram y caducan. Se renuevan en
  cada captura diaria; si una no carga, sale un icono.
- Las métricas de cada publicación las guarda Meta 2 años. Las diarias de la
  cuenta solo se pueden volver a pedir dentro de la ventana que dé Meta, así
  que el histórico de verdad es el de estas tablas: no se borra solo.
