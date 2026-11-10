# Reseñas de Google y contestador

Super Admin › **Reseñas Google**. Petición del dueño (10/11/2026): «Conectar reseñas + un contestador».

## Qué hace

- **Se traen solas** dos veces al día (09:10 y 21:10, job `resenas-ciclo`) y con «Sincronizar ahora».
  - Con **Google Places API** (lo que ya había, `GOOGLE_PLACES_API_KEY`): la valoración media, el total y las **5 reseñas más
    recientes** (Google no deja leer más por esta vía). ~60 consultas al mes, dentro de las 1.000 gratuitas.
  - Con **Google Business Profile** conectado: **todas** las reseñas y las respuestas que ya haya en Google.
- **Contestador**: para cada reseña nueva (últimos 60 días, máx. 10 por ciclo) la IA deja una **respuesta propuesta** en el tono de
  Casa Tomás (guía de marca de `instagram_guias_marca` si existe, firma e indicaciones del dueño). La IA va por el servidor
  (`resenas-contestador`, `OPENAI_API_KEY`, modelo elegible en Servicios › Modelos) y cada llamada se apunta en **Gasto IA**.
- **Nada se publica sin aprobación.** El dueño abre la reseña, edita el texto (o pide «Otra propuesta» con una indicación) y pulsa:
  - **Aprobar y publicar** (con Business Profile conectado): se publica en Google.
  - **Aprobar** (sin conexión): queda aprobada; **Copiar y abrir en Google** copia el texto y abre la reseña, y
    **Ya la he respondido** la marca como respondida.
- **Responder solas algunas reseñas** (apagado por defecto): solo si el dueño lo enciende, solo para las estrellas que marque
  (p. ej. 4 y 5) y solo con Business Profile conectado, la propuesta se publica sin pasar por él.
- **Ocultar en la web / Mostrar en la web** por reseña (columna `estado`, que es lo que lee la web pública).

Estados de la respuesta (`resenas.respuesta_estado`): `pendiente` → `propuesta` → `aprobada` → `publicada` (o `error` si Google la
rechaza, con el motivo en `respuesta_error`). `resenas.respuesta` es siempre lo publicado en Google.

## Conectar Google Business Profile (lo hace el dueño, una vez)

Publicar respuestas desde el panel exige la API de Google Business Profile con OAuth de la cuenta que administra la ficha.

1. **Pedir acceso a la API** de Business Profile: formulario «Request access to the Business Profile APIs» en
   developers.google.com/my-business (gratis; Google tarda unos días; sin acceso, la cuota es 0 y todo falla con 403).
2. En **Google Cloud** (puede ser el mismo proyecto del cliente OAuth de Drive) habilitar *My Business Account Management API*,
   *My Business Business Information API* y *Google My Business API*.
3. En *APIs y servicios → Credenciales → ID de cliente OAuth (Aplicación web)* añadir la **URI de redirección autorizada**
   `https://<proyecto>.supabase.co/functions/v1/resenas-contestador` (demo: `sfonaclosuafvlhutkon`, producción:
   `haqmmdfdzzatdnrrcgez`). La pantalla de Google Business Profile del panel la enseña.
4. Si la pantalla de consentimiento OAuth está en modo «Prueba», añadir la cuenta de Google del negocio como usuario de prueba.
5. En **Supabase → Edge Functions → Secrets**: `GOOGLE_BUSINESS_CLIENT_ID` y `GOOGLE_BUSINESS_CLIENT_SECRET` (si no se crean, se
   usan `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, los de Drive).
6. En el panel: Reseñas Google › Google Business Profile › **Conectar cuenta de Google del negocio**, entrando con la cuenta que
   administra la ficha. Si la cuenta tiene una sola ficha (o una con el mismo Place ID), se elige sola.

El refresh token se guarda en `resenas_google_token`, que solo lee la service role (ni un super admin lo ve). «Desconectar» lo borra.

## Piezas

| Pieza | Qué |
|---|---|
| `supabase/migrations/20261122143000_resenas_contestador.sql` | Columnas del contestador en `resenas`, `resenas_ajustes`, `resenas_google_token`, alta en Gasto IA |
| `supabase/migrations/20261122143100_resenas_cron.sql` | Job `resenas-ciclo` (necesita `RESENAS_CRON_SECRET` y Vault `resenas_cron_secret`) |
| `supabase/functions/resenas-contestador/` | Proponer, aprobar/publicar, ciclo, OAuth de Google |
| `supabase/functions/_shared/resenas/` | Lógica pura (prompts, limpieza, Business Profile, estado OAuth firmado) e IA |
| `supabase/functions/sync-google-reviews/` | Places API (sin cambios salvo guardar el enlace a la reseña) |
| `src/pages/GestionResenas.tsx`, `src/components/resenas/` | La pantalla |
| `scripts/test-resenas-contestador.mjs` | Pruebas PGlite (`npm run test:resenas:db`) |
| `tests/e2e-movil/resenas.capturas.mjs` | Capturas con Supabase falso (`docs/resenas/capturas/`) |
