# Instagram en el panel: métricas

Complementa a [instagram.md](instagram.md) (crear y publicar piezas). Este
documento solo cubre la pestaña **Métricas**.

## Métricas

Qué enseña la pestaña:

- **Resumen de 7 o 28 días** con la variación frente al periodo anterior de la
  misma duración: seguidores (y los ganados), alcance, visualizaciones,
  interacciones, cuentas que interactúan y visitas al perfil.
- **Gráfico diario** de alcance (eje izquierdo) y seguidores (eje derecho).
- **Publicaciones con más alcance** (ranking): puesto, miniatura, enlace a
  Instagram, formato, alcance, interacciones, guardados y tasa de interacción.
  Con «Recientes» se ordenan por fecha.
- **Qué funciona** (fase 3, ver más abajo): barras con la tasa de interacción
  por **formato**, **plantilla**, **tipo de foto**, **día**, **hora** y
  **hashtag** de los últimos 90 días, la mejor en oro y una frase en castellano
  llano con datos reales («Los martes funcionan mejor: 9 % de interacción en
  4 publicaciones, frente al 5,5 % de media»). Con pocos datos sale el aviso
  **«Faltan datos»** y ninguna conclusión. Es lo mismo que lee la IA.
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
                                                               └─ RPC instagram_que_funciona («Qué funciona», 90 días)
 instagram-ia (campañas, ideas, textos) ── JWT ──────────►    RPC instagram_que_funciona (la misma)
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
- Fase 3: migración `supabase/migrations/20261110000000_instagram_aprender.sql`
  (columnas nuevas y RPC `instagram_que_funciona`), rollback
  `supabase/rollbacks/20261110000000_instagram_aprender_ROLLBACK.sql` y
  pruebas PGlite `npm run test:instagram-aprender:db`. Para la IA,
  `supabase/functions/_shared/instagram/que-funciona.ts`.
- Panel `src/components/instagram/metricas/`: `MetricasInstagram.tsx`
  (componente y ranking), `QueFunciona.tsx` (bloque «Qué funciona»),
  `vistaQueFunciona.ts` (nombres y frases), `useMetricasInstagram.ts`
  (TanStack Query), `api.ts`, `agregacion.ts` (tasa, nombres y formatos) y
  `tipos.ts`. Pruebas en `__tests__/`.

### Tablas

| Tabla | Una fila por | Qué guarda |
|---|---|---|
| `instagram_metricas_cuenta` | día (Europe/Madrid) + `ig_user_id` | seguidores, alcance, visualizaciones, visitas al perfil, cuentas que interactúan, interacciones, me gusta, comentarios, guardados, compartidos, toques en enlaces del perfil |
| `instagram_metricas_publicacion` | `media_id` + día de captura | tipo de medio y producto (FEED/REELS/STORY), fecha de publicación y su **hora local de Madrid** (`publicado_local`), enlace, miniatura, **pie completo** (2200 car.; 300 antes de la fase 3) y sus **hashtags**, alcance, me gusta, comentarios, guardados, compartidos, visualizaciones, interacciones; en los reels, **tiempo medio y total de reproducción** y **tasa de salto**; `pieza_id` → `instagram_piezas.id` (opcional) |
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
| Publicaciones | `GET /{ig-user-id}/media?fields=id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count&limit=50&since=<hace 90 días>`, siguiendo `paging.next`, + `GET /{ig-user-id}/stories` | — |
| Por publicación (FEED) | `GET /{media-id}/insights` (lifetime) | `reach`, `likes`, `comments`, `saved`, `shares`, `views`, `total_interactions` (si Meta rechaza las dos últimas, «en desarrollo», se repite con las cinco primeras) |
| Por reel (REELS) | `GET /{media-id}/insights` (lifetime) | las de FEED + `ig_reels_avg_watch_time`, `ig_reels_video_view_total_time` y `reels_skip_rate` (si Meta rechaza alguna: sin `reels_skip_rate`, luego las de FEED y al final las básicas) |
| Por historia | `GET /{media-id}/insights` | `reach`, `views`, `shares`, `total_interactions` |

- **Lista de publicaciones** (fuente, consultada el 05/11/2026, referencia
  v27.0): [developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media).
  Documenta paginación **por tiempo** (`since`/`until`) y como mucho las
  10 000 más recientes; no documenta `limit` ni los cursores. Por eso se pide
  con `since` y se siguen los parámetros de `paging.next` (`after`, `until`…,
  nunca el token), parando en la primera publicación de hace más de 90 días,
  a las 200 publicaciones o a las 10 páginas (si quedan más, la captura lo
  avisa).
- **Métricas de reels** (fuente, consultada el 05/11/2026; la página va por
  v27.0 y las de v26 son las mismas): la referencia de
  [Instagram Media Insights](https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights)
  lista para REELS `comments`, `likes`, `reach`, `saved`, `shares`,
  `reposts`, `total_interactions`, `views`, `ig_reels_avg_watch_time`,
  `ig_reels_video_view_total_time` («en desarrollo»), `reels_skip_rate`
  (% que lo salta en los 3 primeros segundos; «estimada y en desarrollo»),
  `facebook_views` y `crossposted_views` (falla si no se compartió en
  Facebook), más `total_*` solo con Facebook Login. Ya **no** figuran
  `plays`, `clips_replays_count` ni `ig_reels_aggregated_all_plays_count`
  (sustituidas por `views`). **No verificado:** la tabla no dice la unidad
  de los tiempos; se guardan tal cual en `tiempo_medio_ms` y
  `tiempo_total_ms` suponiendo milisegundos.
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

### Qué funciona (fase 3)

Diseño: `instagram-studio/propuesta/PROPUESTA.md`, fila «3» del apartado 7 y
puntos 5.6.8 y 6.5; maqueta: pantalla «Métricas» de
`instagram-studio/propuesta/maqueta/`.

La agrega la base de datos, en la RPC
`instagram_que_funciona(p_marca, p_ig_user_id, p_dias = 90, p_minimo = 3)`
(`SECURITY INVOKER`: manda la RLS de Marketing y la sesión de panel viva;
`anon`, nada). La llaman como el usuario la pestaña (acción «leer», campo
`queFunciona`) y la IA (`instagram-ia`).

- **Qué publicaciones cuentan**: las de los últimos 90 días con alcance (> 0),
  de la cuenta pedida, con su última captura. Con `p_marca`, las piezas de la
  otra marca no cuentan (las de fuera del panel sí, si son de esa cuenta).
- **Ejes**: formato (el de Meta: REELS → reel, STORY → story, FEED → post),
  plantilla y tipo de foto (solo las que salieron del panel; el tipo de foto
  de `instagram_fotos` por `drive_id` o por uuid, y «plato» para las de la
  carta), día de la semana y franja de 2 horas (hora de Madrid) y hashtag.
- **Cifras por grupo**: publicaciones, alcance medio, **tasa de interacción =
  Σ interacciones ÷ Σ alcance** (no la media de las tasas) y guardados por
  alcance.
- **Muestra mínima**: un grupo cuenta con `p_minimo` (3) publicaciones o más.
  Con menos de 2 × 3 = 6 publicaciones en total no se saca ninguna
  conclusión: `suficiente = false` y un `aviso` («Solo hay 2 publicaciones…:
  hacen falta al menos 6 para sacar conclusiones»).
- **Conclusión de cada eje** (`conclusiones[]`, con `estado`):
  - `mejor`: hay al menos dos grupos con muestra y el mejor supera en un 10 %
    la tasa media. Frase: «Los martes funcionan mejor: 9 % de interacción en 4
    publicaciones, frente al 5,5 % de media».
  - `parecido`: «Por plantilla no hay diferencias claras todavía».
  - `faltan_datos`: «Por tipo de foto faltan datos: hacen falta al menos 3
    publicaciones en dos grupos distintos».
- `por`: los grupos de cada eje (12 como mucho; hashtags, solo los que tienen
  muestra, 8 como mucho), con muestra primero y por tasa.
- `mejores` y `peores`: las 5 mejores y las 5 peores por tasa (fecha,
  formato, plantilla, gancho, alcance y tasa), solo con muestra suficiente.

**En el panel** (`QueFunciona.tsx`): las barras de cada eje (como mucho 4;
si un eje tiene grupos con muestra, solo esos), la mejor en oro y la frase con
los nombres del panel (la plantilla con su nombre, no su id). Con pocos datos,
el aviso «Faltan datos» y las barras marcadas «(pocos datos)», sin frases. Si
la función o la migración aún no están, el bloque lo dice y el resto de la
pestaña funciona igual.

**En la IA** (`instagram-ia`, `_shared/instagram/que-funciona.ts`):

- `proponer_campana` e `ideas_semana`: `DATOS.metricas` pasa a ser el
  resumen de «Qué funciona» (si no está la RPC, el de `instagram_ia_contexto`,
  como en la fase 2). `sugerir_texto`: `DATOS.que_funciona`, solo para elegir
  enfoque, gancho y hashtags; nunca se cita en el texto de la publicación.
- El modelo solo ve conclusiones `mejor` y grupos con muestra; con pocos
  datos, ninguna conclusión y el aviso.
- La cuenta es la de la marca: `IG_USER_ID_<MARCA>` o, si no, `IG_USER_ID`
  (solo el ID, que no es secreto).
- **Cifras reales, nunca inventadas**: del razonamiento, los «por qué» de las
  piezas y las ideas se quitan las frases con un porcentaje que no sale de
  «Qué funciona» (sin muestra suficiente, ninguno vale), y se avisa.

### Contrato de la función

`${SUPABASE_URL}/functions/v1/instagram-metricas`. Respuestas JSON saneadas:
nunca llevan el token de Meta, la clave de servicio, el secreto del cron ni el
JWT.

- **Leer**: `GET` (o `POST {"accion":"leer"}`) con `Authorization: Bearer
  <JWT>` + `apikey`. 401 sin sesión, 403 sin lectura de Marketing.
  Devuelve 200 `{ ok, igUserId, hoy, ultimoDia, resumen: { d7, d28 } | null,
  serie[28], publicaciones[≤120], ultimaCaptura, ultimaCorrecta,
  queFunciona | null, cuentas }`. El texto de cada publicación va recortado a
  300 caracteres (el completo lo usa «Qué funciona»). `queFunciona` es la
  respuesta de la RPC (con `?marca=`, la de esa marca); `null` si falta la
  migración 20261110000000. Cada
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

### Desplegar la fase 3 («Qué funciona»)

Orden: migración → funciones → panel. Demo primero; producción solo después
de aceptar el PR y con el «sí» del dueño.

```
# 1. Migración (necesita 20261106100000_instagram_metricas.sql). Tiene que terminar en «instagram_aprender: aplicada».
npx supabase db query --linked -f supabase/migrations/20261110000000_instagram_aprender.sql

# 2. Funciones: hay que VOLVER A DESPLEGAR las dos.
npx supabase functions deploy instagram-metricas --project-ref sfonaclosuafvlhutkon
npx supabase functions deploy instagram-ia --project-ref sfonaclosuafvlhutkon
```

No hay secretos nuevos (`instagram-ia` lee ahora `IG_USER_ID` e
`IG_USER_ID_<MARCA>`, que ya existen). Si la función llega antes que la
migración, la captura guarda como antes y avisa; si el panel llega antes, el
bloque dice que falta la migración. Para comprobarlo: «Actualizar ahora» y
luego, en el SQL Editor,
`select public.instagram_que_funciona(null, null);` (como `postgres` no se
aplica la RLS).

Deshacer: volver a desplegar las versiones anteriores de las dos funciones y
ejecutar el rollback (recorta los textos a 300 y borra hashtags, hora local
y métricas de reels).

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
  perfil, más los seguidores), 1 por cada página de 50 publicaciones (hasta
  4), 1 de historias y 1 por publicación de los últimos 90 días (hasta 200,
  más alguna repetición si Meta rechaza una métrica de reels), de 8 en 8.
  Con 2 publicaciones al día, unas 190 llamadas al día. **Sin verificar** con
  la cuenta real: el límite de la app depende de las impresiones de la
  cuenta; si Meta corta (error de cuota), bajar `MAX_PUBLICACIONES` en
  `capturar.ts`.
- Las **miniaturas** son URL del CDN de Instagram y caducan. Se renuevan en
  cada captura diaria; si una no carga, sale un icono.
- Las métricas de cada publicación las guarda Meta 2 años. Las diarias de la
  cuenta solo se pueden volver a pedir dentro de la ventana que dé Meta, así
  que el histórico de verdad es el de estas tablas: no se borra solo.
