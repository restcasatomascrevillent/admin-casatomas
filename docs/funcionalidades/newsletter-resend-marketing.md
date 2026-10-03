# Newsletter: baja automática y conexión con Resend Marketing

Fecha: 2026-10-03. Rama: `feat/newsletter-baja-automatica` (sobre `feat/newsletter-consentimiento`).

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

## 6. Fase 2: enviar por Resend Marketing (plan y estimación)

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
