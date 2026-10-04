# Newsletter: baja automática y conexión con Resend Marketing

Fecha: 2026-10-03. Fase 1: rama `feat/newsletter-baja-automatica` (sobre `feat/newsletter-consentimiento`). Fase 2 (Resend Marketing): rama `feat/newsletter-resend-broadcasts` (sobre la anterior) — ver secciones 7 (doble opt-in) y 8–10 (Resend Marketing).

Encargo del dueño: *"añade en el admin panel que en la newsletter se ponga automático el darse de baja; lo siguiente es montar la conexión para hacer esto a través de los 1000 mensajes de marketing que tenemos en Resend al mes"*.

---

## 1. Cómo estaba (auditoría del 2026-10-03)

| Pieza | Estado encontrado |
|---|---|
| `enviar-newsletter` | Un `resend.emails.send` (correo **transaccional**) por suscriptor activo, con el enlace de baja firmado (HMAC `id:via`) en el pie y las cabeceras `List-Unsubscribe` + `List-Unsubscribe-Post` (RFC 8058). Pero: **remitente fijo `onboarding@resend.dev`** (sandbox: solo entrega al dueño de la cuenta); **daba por enviado cualquier correo** (el SDK v2 devuelve el error, no lo lanza); **título/mensaje/imagen sin escapar** en el HTML (el personal podía esconder el pie con un `<style>`); **solo exigía "usuario autenticado"**, no permiso de Marketing. |
| `newsletter-baja` | Correcto: GET no muta (redirige a la página de la web), POST da de baja; one-click de Gmail/Outlook; escribe `fecha_baja` y `origen_baja` (`enlace_email` / `cabecera_one_click`). |
| `resend-webhook` | Verifica la firma svix y archiva en `email_eventos`; actúa sobre `envios_email_reserva` (rebote/queja/supresión de correos de **reserva**). **No tocaba `newsletter_suscriptores`**: una queja de spam o un rebote de un newsletter no daba de baja a nadie. Los eventos `contact.*` habrían fallado (`email_eventos.email_id` es NOT NULL). |
| BD | `newsletter_suscriptores.activo/fecha_baja/origen_baja` (CHECK con 3 valores). Las políticas RLS dejan a quien escribe en Marketing hacer `UPDATE`: **se podía reactivar a mano a un dado de baja**. El alta/reactivación legítima es el trigger de reservas, solo con la casilla marcada. |
| Panel (`GestionCorreos`) | Lista de activos + un contador de bajas. No se veía a los dados de baja, ni cuándo ni por qué. Vista previa = copia a mano de las plantillas. |
| Secrets (`supabase secrets list`, solo nombres) | Existen `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (dominio verificado `send.miguelbenito.space`, el de los correos de reserva), `RESEND_WEBHOOK_SECRET`, `NEWSLETTER_UNSUB_SECRET`. No existe `NEWSLETTER_FROM_EMAIL`. |

## 2. Qué incluye de verdad el plan de Resend

Fuentes oficiales (consultadas el 2026-10-03):
[pricing](https://resend.com/pricing) ·
[cuotas y límites](https://resend.com/docs/knowledge-base/account-quotas-and-limits) ·
[usage limits / rate limit](https://resend.com/docs/api-reference/rate-limit) ·
[Broadcasts](https://resend.com/docs/dashboard/broadcasts/introduction) ·
[Broadcast API](https://resend.com/docs/dashboard/broadcasts/send-broadcast-with-api) ·
[editor: enlace de baja](https://resend.com/docs/dashboard/broadcasts/editor) ·
[Contacts](https://resend.com/docs/dashboard/contacts/introduction) ·
[bajas](https://resend.com/docs/dashboard/contacts/managing-unsubscribe-list) ·
[Audiences → Segments](https://resend.com/docs/dashboard/contacts/migrating-from-audiences-to-segments) ·
[Topics](https://resend.com/docs/dashboard/contacts/manage-topics) ·
[baja en transaccionales](https://resend.com/docs/dashboard/emails/add-unsubscribe-to-transactional-emails) ·
[webhooks](https://resend.com/docs/webhooks/event-types) ·
[blog: requisitos Gmail/Yahoo](https://resend.com/blog/gmail-and-yahoo-bulk-sending-requirements-for-2024).

- **No son "1.000 mensajes", son 1.000 contactos.** Plan Marketing gratuito: *envíos ilimitados a hasta 1.000 contactos al mes*. Los planes de pago van de 5.000 contactos (40 $/mes) a 150.000; "no están limitados por número de correos, solo por contactos".
- **La cuota de contactos cuenta los contactos guardados**, también los dados de baja (Resend no los borra). Pasado el límite se pueden seguir añadiendo, pero **no se puede enviar ningún Broadcast** (403 *"You have reached your contacts quota"*). → Hay que borrar de Resend a los que se dan de baja (la constancia queda en nuestra tabla).
- **Solo cuenta como marketing lo que se envía como Broadcast.** Lo que hace hoy `enviar-newsletter` (`emails.send`, uno por suscriptor) es **transaccional**: en el plan gratuito, 100 correos/día y 3.000/mes, **compartidos con los correos de reservas**. Un newsletter de 150 suscriptores agotaría la cuota del día y dejaría sin confirmaciones de reserva hasta las 00:00 UTC.
- **Rate limit**: 10 peticiones/s por equipo (todas las claves juntas); el Batch API manda hasta 100 correos por petición. Los Broadcasts los encola y regula Resend.
- **Modelo actual (desde nov. 2025)**: *Contacts* globales (1 email = 1 contacto) con propiedades (`first_name`… y propiedades propias), **Segments** (a quién se envía; internos) y **Topics** (preferencias que el destinatario ve y gestiona). La *Audiences API* está deprecada.
- **Baja nativa**: el Broadcast lleva `{{{RESEND_UNSUBSCRIBE_URL}}}` (enlace único por destinatario y envío) que abre la página de preferencias alojada por Resend (personalizable; "Powered by Resend" solo se quita en Pro). Resend **añade solo** `List-Unsubscribe` y `List-Unsubscribe-Post` en los Broadcasts. Un Broadcast **no admite cabeceras propias**.
- **Webhooks útiles**: `email.bounced` (solo rechazo permanente), `email.complained`, `email.suppressed`, `contact.created/updated/deleted` (`updated` trae `unsubscribed`), `contact.topics.updated`, `suppression.added`. Los eventos de correo de un Broadcast llevan `broadcast_id`; las `tags` que se pongan en un envío vuelven en `data.tags`.
- **Otros límites**: rebotes < 4 % y quejas < 0,08 % o Resend pausa el envío; datos retenidos 30 días (nosotros guardamos los eventos en `email_eventos`); 3 dominios verificados en gratuito.

## 3. Diseño decidido

1. **`newsletter_suscriptores` es la fuente de verdad.** Resend (ahora y en la fase 2) es solo el cartero. El panel lee solo esta tabla.
2. **La baja es siempre automática y la escribe el sistema**, con `fecha_baja` y `origen_baja`:
   - clic en el enlace del pie (web + confirmar) → `enlace_email`;
   - botón «Cancelar suscripción» del cliente de correo (POST one-click, inmediato) → `cabecera_one_click`;
   - queja de spam / rebote permanente / supresión de Resend (webhook) → `queja_spam` / `rebote_permanente` / `suprimido_resend`;
   - fase 2: página de baja de Resend (`contact.updated` con `unsubscribed: true`) → `resend_baja_nativa`.
3. **Nadie reactiva a mano.** Un trigger en BD solo deja pasar de baja a activo si `reserva_consentimiento_id` cambia a una reserva del mismo email con la casilla marcada **posterior a la baja** (justo lo que hace el trigger de reservas). Cualquier otro intento da error; dentro del alta de una reserva no se lanza error (no se tumba la reserva) y se ignora.
4. **El pie de baja no depende del personal**: lo añade la plantilla (código puro compartido con la vista previa), el texto del personal se escapa, y si un HTML final no lleva el enlace, ese correo no sale.
5. **Transición a Resend Marketing (fase 2): las dos bajas a la vez.** Nuestro enlace HMAC (`newsletter-baja`) se mantiene para siempre: los correos ya enviados tienen que seguir funcionando y sirve de vía propia. Los Broadcasts usan la baja **nativa** de Resend (no admiten cabeceras propias y Resend pone las suyas), sincronizada a la tabla por `contact.updated` + una reconciliación diaria. Dirección inversa: cuando alguien se da de baja por nuestra vía, se borra su contacto en Resend (libera cuota y garantiza que no recibe el siguiente Broadcast).
6. **Mientras no esté la fase 2**, `enviar-newsletter` sigue por la vía transaccional pero **limitado** (`NEWSLETTER_LIMITE_TRANSACCIONAL`, 80 por defecto, `0` = sin límite) para no comerse la cuota de las reservas, y con remitente `NEWSLETTER_FROM_EMAIL` → `RESEND_FROM_EMAIL` → sandbox.

## 4. Implementado en esta rama (fase 1)

- `supabase/functions/enviar-newsletter/plantillas.ts` (nuevo, puro): plantillas, `escapeHtml`, `pieBaja` obligatorio, `tieneEnlaceBaja`, `cabecerasBaja`, `validarPayload`, `asuntoNewsletter`, `limiteTransaccional`.
- `supabase/functions/enviar-newsletter/permiso.ts` (nuevo): `can_write_section('marketing')` con el JWT del usuario.
- `supabase/functions/enviar-newsletter/index.ts`: usa lo anterior; comprueba el `error` de Resend (y reintenta una vez si es 429); etiquetas `categoria=newsletter` + `suscriptor=<id>`; excluye `direcciones_email_suprimidas`; límite transaccional; remitente configurable; 502 si no sale ninguno.
- `supabase/functions/resend-webhook/newsletter.ts` (nuevo, puro) + `index.ts`: queja/rebote/supresión/`contact.updated` → baja vía `newsletter_registrar_baja()`; archiva los eventos sin `email_id` con un id sintético.
- `supabase/migrations/20261003171500_newsletter_baja_automatica.sql` (**NO APLICADA**) + rollback + `supabase/tests/newsletter_baja_automatica_test.sql`.
- Panel: `GestionCorreos.tsx` (aviso "la baja es automática", contadores), `ListaSuscriptores.tsx` (nuevo: pestañas Activos / Dados de baja con fecha y motivo, sin botón de reactivar), `PreviewNewsletter.tsx` (usa la misma plantilla que el envío; muestra el pie), hooks `useNewsletterSuscriptores` (activos + bajas, refresco cada 60 s) y `useEnviarNewsletter` (muestra el motivo real del error), `src/lib/newsletter/bajas.ts`.

## 5. Pasos del dueño para desplegar la fase 1

> **Rama integrada (`integracion/newsletter`):** no seguir estos pasos sueltos; usar el orden único de la sección 9, que incluye esta fase.

1. Aplicar migraciones, en orden (si la primera no está ya):
   `npx supabase db query --linked -f supabase/migrations/20261003143000_reserva_web_prueba_consentimiento.sql`
   `npx supabase db query --linked -f supabase/migrations/20261003171500_newsletter_baja_automatica.sql`
   y comprobar con `npx supabase db query --linked -f supabase/tests/newsletter_baja_automatica_test.sql` (no deja nada escrito).
2. Secrets (opcionales):
   - `NEWSLETTER_FROM_EMAIL='Casa Tomás <novedades@DOMINIO-VERIFICADO>'` si el newsletter no debe salir con el remitente de reservas. **Ojo:** sin él, el newsletter pasa a salir con `RESEND_FROM_EMAIL` (`send.miguelbenito.space`) y empieza a llegar de verdad a los suscriptores.
   - `NEWSLETTER_LIMITE_TRANSACCIONAL` (80 por defecto; `0` si el plan transaccional es de pago).
3. Desplegar: `npx supabase functions deploy enviar-newsletter resend-webhook` (`newsletter-baja` no cambia).
4. Resend → Webhooks: el endpoint `…/functions/v1/resend-webhook` debe tener marcados `email.bounced`, `email.complained`, `email.suppressed` (ya los usa reservas) y, para la fase 2, `contact.updated`. El secreto sigue siendo `RESEND_WEBHOOK_SECRET`.
5. Desplegar el panel (Vercel, al fusionar).

## 6. Fase 2: enviar por Resend Marketing (plan y estimación original — implementado, ver sección 8)

| # | Tarea | Estimación |
|---|---|---|
| 1 | Migración: `newsletter_suscriptores.resend_contact_id`, `resend_sincronizado_at`; `newsletter_envios.canal` (`transaccional`/`broadcast`) y `resend_broadcast_id` | 0,5 h |
| 2 | Función `newsletter-sync-resend`: alta/actualización de contactos activos en el Segment (propiedad `first_name`), borrado de los dados de baja; incremental (`updated_at > resend_sincronizado_at`), a ≤ 8 peticiones/s; botón en el panel + `pg_cron` diario | 3–4 h |
| 3 | Reconciliación diaria: listar contactos `unsubscribed=true` en Resend → baja `resend_baja_nativa` (red de seguridad si se pierde un webhook) | 1 h |
| 4 | `enviar-newsletter` modo Broadcast (`NEWSLETTER_CANAL=broadcast`): mismo `renderNewsletter` con `{{{RESEND_UNSUBSCRIBE_URL}}}` como enlace del pie, `broadcasts.create({ segment_id, send: true })`, sincroniza antes; guarda `resend_broadcast_id` | 2 h |
| 5 | `newsletter-baja`: al dar de baja por nuestra vía, borrar el contacto en Resend (best-effort) | 1 h |
| 6 | Panel: estado de sincronización, contactos usados / 1.000, enlace a estadísticas del Broadcast | 1–2 h |
| 7 | Tests + documentación + prueba con `delivered@resend.dev` | 2 h |
| | **Total** | **≈ 10–12 h** |

Decisiones que necesita el dueño antes de empezar:

1. **Dominio de envío.** Hoy el único verificado es `send.miguelbenito.space` (del desarrollador, sin DMARC propio). Para marketing se recomienda un subdominio de Casa Tomás (p. ej. `noticias.restaurantecasatomascrevillente.es`) con SPF, DKIM y DMARC, separado del de reservas para que la reputación del marketing no afecte a las confirmaciones. El gratuito admite 3 dominios.
2. **Plan.** 1.000 contactos gratis bastan si la lista es menor; contando que los dados de baja se borran de Resend. Si se pasa, Marketing Pro (5.000 contactos, 40 $/mes).
3. **Segment y Topics.** Propuesta: un Segment "Newsletter Casa Tomás" y **sin Topics** al principio (la página de Resend solo ofrecerá "darse de baja de todo", que es lo que guarda nuestra tabla). Con Topics habría que mapear también `contact.topics.updated`.
4. **API key.** Contacts y Broadcasts necesitan una clave con *full access*; propuesta: una clave nueva `RESEND_MARKETING_API_KEY` solo para las funciones de marketing y dejar la actual para los correos de reserva.
5. **Página de baja de Resend**: personalizar título, logo y colores en *Settings → Unsubscribe page*.
6. **Webhook**: añadir `contact.updated` (y `contact.deleted` si se quiere archivar) al endpoint actual.

## 7. Doble opt-in, email normalizado y solicitudes (rama `feat/newsletter-doble-optin`)

Migración `20261003184500_newsletter_doble_optin_y_email_normalizado.sql` (**NO APLICADA**, después de `20261003171500`) + rollback + `supabase/tests/newsletter_doble_optin_test.sql`.

- **El alta ya no ocurre al insertar la reserva.** La reserva guarda la casilla (`consentimiento_newsletter`, `consentimiento_newsletter_at`); el alta la hace `newsletter_alta_reserva_verificada_upd` cuando se marca `reservas.email_verificado_at`, que solo escriben las Edge Functions cuando el **cliente pulsa «Confirmo»** en el correo (`emails-reserva` `/enlace/ejecutar` aceptar, `reservas-web` `/confirmar`) o **acepta desde el correo la propuesta de su solicitud** (`fn_aceptar_propuesta_solicitud` vía email). Código común: `supabase/functions/_shared/verificacion-email.ts`.
- **No cuentan**: `verificada` (la pone el personal), confirmar a mano, «Rechazar» desde el correo, reservas canceladas antes de verificar, reservas sin email.
- **El personal no puede escribir** la casilla, su fecha, `condiciones_aceptadas_at` ni `email_verificado_at` (trigger `reservas_proteger_consentimiento_newsletter`, usa el rol del JWT); cambiar el email anula casilla y verificación.
- **Solicitudes**: `solicitudes_pendientes.consentimiento_newsletter` / `condiciones_aceptadas_at` (las rellena `reservas-web`); una reserva con `solicitud_id` las hereda en la BD si el email coincide. Sin cambios en el panel ni en `fn_aceptar_propuesta_solicitud`.
- **Email**: trigger `newsletter_suscriptores_normalizar_email` (`lower(btrim())`) + índice único `newsletter_suscriptores_email_lower_key` (sustituye al no único de 171500). Duplicados existentes fusionados en el más antiguo (la baja manda, consentimiento más reciente), copia en `newsletter_suscriptores_depurados`.
- **Altas antiguas sin verificar** (nacidas del trigger de INSERT): se retiran (constancia sin email/nombre en `newsletter_suscriptores_depurados`); vuelven solas si el cliente confirma.
- **Reactivar** exige además que la reserva del consentimiento nuevo esté verificada y que la casilla sea posterior a la baja.
- `origen_alta` admite `reserva_manual` y `solicitud_web` (antes una reserva `manual` quedaba como `reserva_web`).
- Pasos del dueño: los de la sección 9 (orden único para las tres migraciones).

---

## 8. Fase 2 implementada (rama `feat/newsletter-resend-broadcasts`, 2026-10-03)

**Estado:** código y tests hechos; **nada desplegado ni aplicado**. Por defecto (`NEWSLETTER_CANAL` sin poner) el newsletter sigue saliendo por la vía transaccional de la fase 1: desplegar no cambia el comportamiento hasta que el dueño ponga `NEWSLETTER_CANAL=broadcast`.

### Qué hace

- **`newsletter-sync-resend`** (función nueva, `verify_jwt = false`): la tabla manda y Resend es el cartero. Cada pasada lee todos los contactos de Resend y los del Segment, planifica **solo las diferencias** (incremental: una pasada sin cambios no escribe nada en Resend) y ejecuta, a ≤ 8 peticiones/s y con reintento en 429 `rate_limit_exceeded` (respeta `retry-after`):
  1. **Reconciliación**: activo en la tabla pero `unsubscribed = true` en Resend → baja `resend_baja_nativa` (vía `newsletter_registrar_baja`) y después se borra el contacto. Nunca se pone `unsubscribed: false` ni se reactiva a nadie.
  2. **Borrar de Resend** a los dados de baja (y a los activos cuya dirección está en `direcciones_email_suprimidas`): libera cuota.
  3. **Quitar del Segment** a contactos que no son de la tabla (metidos a mano en el dashboard).
  4. Altas (contacto creado ya dentro del Segment), añadir al Segment a los que ya existían y actualizar `first_name`.
  - Cerrojo: una sola pasada a la vez (`newsletter_sincronizaciones_resend`, índice único parcial); las colgadas se cierran a los 15 min. Presupuesto de 100 s: lo que no cabe queda **pendiente** para la siguiente pasada.
  - Llamadores: panel (permiso de Marketing: leer para `estado`, escribir para `sincronizar`) y cron (cabecera `x-webhook-secret` = `NEWSLETTER_SYNC_CRON_SECRET`, falla cerrado).
  - Segment: `RESEND_NEWSLETTER_SEGMENT_ID` o, si no está, busca "Newsletter Casa Tomás" y si no existe **lo crea** (el id sale en la respuesta y en la tabla de pasadas).
- **`enviar-newsletter` con `NEWSLETTER_CANAL=broadcast`**: sincroniza **dentro del cerrojo**; si queda algún dado de baja sin quitar de Resend, la sincronización falla o se supera el límite de contactos, **no envía nada** (409/502 con el motivo). Si todo cuadra: misma plantilla con `{{{RESEND_UNSUBSCRIBE_URL}}}` en el pie, Broadcast creado como borrador → apuntado en `newsletter_envios` (`canal = 'broadcast'`, `resend_broadcast_id`) → enviado. Si la respuesta del envío es dudosa (red/5xx) consulta el estado del Broadcast en vez de reenviar.
- **Prueba segura** (`{"prueba": true}`, botón «Enviar prueba por Resend» en el panel): Broadcast a un Segment de pruebas que solo tiene `NEWSLETTER_EMAIL_PRUEBA` (por defecto `delivered@resend.dev`). Se niega si ese Segment tiene a alguien más o si es el del newsletter. No sincroniza ni escribe historial. Funciona con cualquier `NEWSLETTER_CANAL`.
- **`newsletter-baja`**: tras guardar la baja local (que es la que manda), borra el contacto en Resend en segundo plano (`EdgeRuntime.waitUntil`). Si falla, lo registra y la siguiente sincronización lo borra (y ningún Broadcast sale mientras quede).
- **`resend-webhook`**: `contact.updated` con `unsubscribed: true` → baja `resend_baja_nativa` (ya estaba en fase 1); `contact.deleted` → solo desvincula `resend_contact_id` (no es una baja); los eventos de un Broadcast guardan `metadata.broadcast_id` para las estadísticas. El 500 por `email_eventos.email_id` NOT NULL ya estaba arreglado en la rama base (id sintético `contact.updated:<id>`).
- **Migración `20261003193000_newsletter_resend_broadcasts.sql`** (NO APLICADA): `resend_contact_id`, `resend_sincronizado_at`; `newsletter_envios.canal` y `resend_broadcast_id`; tabla `newsletter_sincronizaciones_resend`; `newsletter_marcar_sincronizados()` (service_role) y `newsletter_estadisticas_broadcasts()` (SECURITY INVOKER). Rollback en `supabase/rollbacks/`, test en `supabase/tests/newsletter_resend_broadcasts_test.sql`.
- **Panel**: en *Suscriptores*, tarjeta «Resend Marketing» (canal actual, contactos usados / 1.000 con aviso al 80 % y al 100 %, última sincronización, botón «Sincronizar con Resend»); en *Enviar Newsletter*, por qué canal saldrá y el botón de prueba; en *Estadísticas*, historial de envíos con canal y entregados/abiertos/clics/rebotes de cada Broadcast.

### Ficheros

`supabase/functions/_shared/resend-marketing/{config,cliente,sync,repositorio,servicio}.ts`, `_shared/permiso-marketing.ts` (movido desde `enviar-newsletter/permiso.ts`, que lo reexporta), `newsletter-sync-resend/{index,peticion}.ts`, `enviar-newsletter/{broadcast,prueba,registro}.ts` + `index.ts`, `newsletter-baja/resend.ts` + `index.ts`, `resend-webhook/{newsletter,index}.ts`, `supabase/config.toml`; panel: `src/lib/newsletter/resend.ts`, `src/hooks/useResendMarketing.ts`, `useEnviarNewsletter.ts`, `src/components/marketing/{SincronizacionResend,HistorialEnvios}.tsx`, `GestionCorreos.tsx`, `CreadorNewsletter.tsx`, `src/pages/Marketing.tsx`.

## 9. Pasos del dueño para desplegar todo (doble opt-in + fase 2, en orden)

> Todo desde la carpeta **`adminpanelct`** una vez fusionada la rama (allí está el proyecto enlazado: `supabase/.temp`). Si se hace desde el worktree `adminpanelct-newsletter-resend`, los `functions deploy` llevan `--project-ref jeamoczmbfsnwkfjxcyo` y para `db query --linked` hay que enlazar antes: `npx supabase link --project-ref jeamoczmbfsnwkfjxcyo`.

1. **Migraciones**, en este orden exacto (la 143000 ya está aplicada; la 150000 de salas privadas es de otra rama y es independiente). Cada una se detiene sola si falta la anterior:
   ```
   npx supabase db query --linked -f supabase/migrations/20261003171500_newsletter_baja_automatica.sql
   npx supabase db query --linked -f supabase/tests/newsletter_baja_automatica_test.sql
   npx supabase db query --linked -f supabase/migrations/20261003184500_newsletter_doble_optin_y_email_normalizado.sql
   npx supabase db query --linked -f supabase/tests/newsletter_doble_optin_test.sql
   npx supabase db query --linked -f supabase/tests/consentimiento_newsletter.test.sql
   npx supabase db query --linked -f supabase/migrations/20261003193000_newsletter_resend_broadcasts.sql
   npx supabase db query --linked -f supabase/tests/newsletter_resend_broadcasts_test.sql
   ```
   (Los tests van en `BEGIN … ROLLBACK`: no dejan nada escrito. Si terminan sin ERROR, todo bien.)
   **Por qué la 184500 va antes que cualquier sincronización con Resend:** retira las altas antiguas sin email verificado y fusiona los duplicados por mayúsculas. Si se sincronizara antes, se subirían a Resend contactos que no deben recibir nada (y gastarían cuota). La 193000 no depende de la 184500 para cargar (solo exige la 171500), pero **no se pulsa «Sincronizar con Resend» ni se activa el cron hasta tener aplicadas las tres**; si se sincronizó antes por error, la siguiente pasada borra de Resend a los retirados (ya no están activos en la tabla).
2. **Resend (dashboard)**:
   - *API Keys → Create*: permiso **Full access** (Contacts y Broadcasts no funcionan con *Sending access*). Es la `RESEND_MARKETING_API_KEY`; la clave actual de reservas no se toca.
   - *Webhooks*: en el endpoint que ya existe (`https://jeamoczmbfsnwkfjxcyo.supabase.co/functions/v1/resend-webhook`) marcar además **`contact.updated`** y **`contact.deleted`** (deben seguir `email.bounced`, `email.complained`, `email.suppressed`). El secreto sigue siendo `RESEND_WEBHOOK_SECRET`.
   - *Settings → Unsubscribe page*: título, logo y colores de Casa Tomás (el "Powered by Resend" solo se quita en Pro).
   - Segment: **no hace falta crearlo**; la primera sincronización crea "Newsletter Casa Tomás". Si se prefiere crearlo a mano (*Audience → Segments*), poner su id en `RESEND_NEWSLETTER_SEGMENT_ID`. Tampoco hace falta crear el de pruebas ("Newsletter Casa Tomás (pruebas)"); **no meter a nadie en él**.
3. **Secrets** (`npx supabase secrets set … --project-ref jeamoczmbfsnwkfjxcyo`):
   - `RESEND_MARKETING_API_KEY=re_…` (la del paso 2).
   - `NEWSLETTER_SYNC_CRON_SECRET=<valor aleatorio largo>` (para el cron).
   - **No** poner todavía `NEWSLETTER_CANAL` (o ponerlo a `transaccional`).
   - Opcionales: `NEWSLETTER_FROM_EMAIL` (sin él sale con `RESEND_FROM_EMAIL`, dominio `send.miguelbenito.space`, decisión del dueño), `NEWSLETTER_REPLY_TO`, `RESEND_NEWSLETTER_SEGMENT_ID` (tras la primera sincronización, copiar el id que muestra la respuesta / `newsletter_sincronizaciones_resend.segment_id`), `NEWSLETTER_LIMITE_CONTACTOS` (si se cambia de plan), `NEWSLETTER_EMAIL_PRUEBA`.
4. **Desplegar funciones**:
   ```
   npx supabase functions deploy emails-reserva reservas-web newsletter-sync-resend enviar-newsletter newsletter-baja resend-webhook --project-ref jeamoczmbfsnwkfjxcyo
   ```
   (`emails-reserva` y `reservas-web` llevan el clic de «Confirmo» que verifica el email (doble opt-in); `newsletter-sync-resend` es nueva y va con `verify_jwt = false` desde `supabase/config.toml`; comprobar en el dashboard que quedó así.)
5. **Desplegar el panel** (Vercel, al fusionar en `main`).
6. **Primera sincronización** desde el panel: *Newsletter → Suscriptores → «Sincronizar con Resend»*. No envía nada; solo copia los activos a Resend. Comprobar en Resend → *Audience* que el Segment tiene tantos contactos como activos hay en el panel. Si sale "quedan N cambios", volver a pulsar hasta que termine.
7. **Prueba segura**: en *Enviar Newsletter*, escribir un newsletter y pulsar **«Enviar prueba por Resend (no llega a clientes)»**. Va solo a `delivered@resend.dev`. Comprobar en Resend → *Broadcasts* que el `[PRUEBA] …` salió como *Sent*, con el remitente correcto y el enlace de baja de Resend en el pie.
8. **Cron diario** (elige uno, ver el final de la migración 20261003193000):
   - A) SQL: `select vault.create_secret('<mismo valor que NEWSLETTER_SYNC_CRON_SECRET>', 'newsletter_sync_cron_secret');` y el `cron.schedule('newsletter-sync-resend-diario', '30 5 * * *', …)` que está comentado en la migración (requiere `pg_net`).
   - B) Dashboard → *Integrations → Cron → Create job* → Edge Function `newsletter-sync-resend`, POST, `30 5 * * *`, cabecera `x-webhook-secret`, cuerpo `{"accion":"sincronizar"}`.
9. **Activar Broadcasts**: `npx supabase secrets set NEWSLETTER_CANAL=broadcast --project-ref jeamoczmbfsnwkfjxcyo`. El panel pasa a mostrar «Envío actual: Broadcast de Resend Marketing». El siguiente «Enviar Newsletter» ya va a los clientes.
10. **Vuelta atrás** en cualquier momento: `NEWSLETTER_CANAL=transaccional` (o borrar el secret). Rollback de la BD: `supabase/rollbacks/20261003193000_newsletter_resend_broadcasts_ROLLBACK.sql` (antes quitar el cron).

## 10. Gotchas de la API de Resend (comprobados en la doc oficial el 2026-10-03)

- **El SDK `resend@2.0.0` del repo no sirve** para esto (es anterior a la Contacts API global, los Segments y `segment_id`; el SDK actual es la v6.32). Se usa `fetch` directo con tipos propios (`_shared/resend-marketing/cliente.ts`) y se deja el SDK viejo para los correos de reserva.
- Endpoints: `GET /contacts?limit=100&after=<id>` (paginado, `has_more`), `GET /segments/{id}/contacts`, `POST /contacts {email, first_name, segments:[{id}]}`, `PATCH|DELETE /contacts/{id|email}`, `POST|DELETE /contacts/{id}/segments/{segment_id}`, `GET|POST /segments`, `POST /broadcasts {segment_id, from, subject, html, name, send}`, `POST /broadcasts/{id}/send`, `GET /broadcasts/{id}` (`status`: draft/queued/sent). Errores: `{statusCode, name, message}`.
- **429 no siempre es "espera un segundo"**: `rate_limit_exceeded` sí se reintenta (`retry-after`), pero `daily_quota_exceeded` / `monthly_quota_exceeded` también son 429 y no se arreglan reintentando.
- Rate limit **10 req/s por equipo** (todas las claves, también la de reservas): por eso la sincronización va a 8/s en serie.
- La cuota de marketing cuenta **contactos guardados**, también los `unsubscribed`; pasado el límite, Broadcast → **403** `validation_error` "You have reached your contacts quota". Hay que borrar a los dados de baja.
- **Nunca mandar `unsubscribed: false`** al crear/actualizar: re-suscribiría a quien se dio de baja en la página de Resend si el webhook se perdió. La sincronización solo manda `first_name` y Segments.
- Un Broadcast **no admite cabeceras ni tags propios**; Resend pone `List-Unsubscribe`/`List-Unsubscribe-Post`. El enlace es `{{{RESEND_UNSUBSCRIBE_URL}}}` (único por destinatario).
- Los eventos `email.*` de un Broadcast traen `broadcast_id`; los `contact.*` traen `id`, `email`, `unsubscribed`, `segment_ids` y **no** `email_id`.
- `contact.deleted` llega también cuando borramos nosotros: no se trata como baja.
- El "Send Broadcast" solo funciona con Broadcasts creados por API; se crea como borrador (`send: false`) para guardar el id antes de enviar. No se reintenta el envío en 5xx (podría salir dos veces): se consulta el estado.
- La respuesta de crear contacto cuando el email ya existe **no está documentada**: si falla, se busca con `GET /contacts/{email}` y se cuadra (o, si está `unsubscribed`, se registra la baja).
