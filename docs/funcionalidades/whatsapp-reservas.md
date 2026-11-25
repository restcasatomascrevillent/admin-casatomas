# Avisos de reserva por WhatsApp (prueba de concepto)

Petición del dueño (21/11/2026): que los avisos de reserva («confirma tu reserva» y demás) puedan llegar por WhatsApp con botones en el propio mensaje, usando la API de WhatsApp de Meta, y que el cliente elija al reservar si los quiere por email o por WhatsApp.

Estado: **solo en la demo**, con el número de prueba de Meta (solo escribe a los móviles registrados en la app de Meta, como máximo 5). En producción no cambia nada mientras no se active (ver «Cómo se activa»).

## Qué ve el cliente

1. **Al reservar en la web** (si WhatsApp está activo): «¿Cómo quieres recibir los avisos de tu reserva?» con **Por email** (marcado por defecto) o **Por WhatsApp**.
2. **Reserva recibida** (pendiente de que la revise el restaurante): WhatsApp con los datos y los botones **Gestionar mi reserva** (abre la web: ver la reserva y cancelarla, con un «¿seguro?») y **Ver la carta**. Por email este aviso sigue silenciado para las reservas de la web.
3. **Reserva verificada** («confirma tu asistencia»): botones **Sí, confirmo**, **No puedo, cancelar** y **Cómo llegar** (Google Maps). Al pulsar uno, la reserva cambia como con el botón del correo y se le contesta en el mismo chat.
4. **Reserva confirmada** desde el panel: aviso con **Cómo llegar**.
5. **Reserva cancelada por el restaurante**: aviso sin botones.
6. Si escribe a mano al número: respuesta automática con el teléfono del restaurante (nadie lee ese número). Con `WHATSAPP_RESPUESTA_AUTOMATICA=false` no se contesta (para cuando el número se use también en la app WhatsApp Business).
7. **Después de comer** (dueño, 25/11/2026): a la hora de la reserva + 3 h (la de las 14:00, a las 17:00) le llega «gracias por venir… ¿nos dejas tu opinión en Google?» con el botón **Dejar mi opinión** (abre la ficha de Google para escribir la reseña). Si cae después de las 22:00, al día siguiente a las 12:00. Solo reservas confirmadas o completadas de Casa Tomás, una vez por reserva y, por defecto, solo a quien eligió WhatsApp (Meta exige que el cliente haya aceptado recibir WhatsApp del negocio); con `WHATSAPP_RESENAS_DESTINATARIOS=todos`, a todas las reservas con móvil.

El recordatorio de dos días antes y el aviso de «reserva modificada» siguen yendo por correo (aún no tienen plantilla).

## Cómo funciona

| Pieza | Qué hace |
| --- | --- |
| `reservas.canal_avisos` (migración `20261215100000`) | `email` (por defecto) o `whatsapp`. Vuelta atrás en `supabase/rollbacks/`. |
| `reservas-web` | Con WhatsApp activo, anuncia `avisos_whatsapp: true` en `/disponibilidad` y guarda `canal_avisos` en `/crear` (WhatsApp exige teléfono). |
| `emails-reserva` | Antes de cada aviso, si el cliente eligió WhatsApp se lo pide a `whatsapp-reservas`; si no sale, manda el correo de siempre. Nuevo enlace «Gestionar mi reserva» (token `gestionar`, vale hasta el día de la reserva) y `via: "whatsapp"` en `/enlace/ejecutar` (el clic de WhatsApp no verifica el email del newsletter ni manda el aviso de después). |
| `whatsapp-reservas` (función nueva) | Manda las plantillas, recibe el webhook de Meta (pulsaciones y estados de entrega) y registra las plantillas en Meta. Al pulsar un botón llama a `emails-reserva /enlace/ejecutar`: la misma lógica que el botón del correo. |
| Web (`web-casatomas`) | Selector en el formulario de reserva y modo «Gestionar mi reserva» en `/reserva/respuesta`. |
| `whatsapp_mensajes` (migración `20261222100000`) | Un registro por WhatsApp enviado (tipo, categoría de Meta, estado). El webhook le añade si Meta lo cobra (`pricing.billable`, `pricing.category`). |
| `whatsapp_resenas` + cron `whatsapp-resenas` (misma migración) | Reseñas ya pedidas (una por reserva). Cada 10 min, si hay alguna reserva a la que ya le toca (`whatsapp_resena_momento`), el cron llama a `whatsapp-reservas POST /resenas`. Sin el secreto de Vault `whatsapp_resenas_cron_secret` no hace nada. Si Meta aún no ha aprobado la plantilla (o está pausada), no gasta el intento: se reintenta en la siguiente pasada. |
| `servicios-uso` | WhatsApp como un servicio más en Super Admin › Servicios: mensajes del mes y coste con la tarifa de Meta para España (`_shared/whatsapp-tarifas.ts`). |

Los botones de respuesta llevan un dato oculto corto y firmado (no el token del correo, que es demasiado largo para Meta). Si el restaurante cambia la hora después de mandar el WhatsApp, el botón viejo deja de valer, igual que el enlace del correo.

Si Meta no deja usar una plantilla (aún sin aprobar, pausada…), `whatsapp-reservas` manda el mismo aviso **sin plantilla**: los botones de respuesta como botones normales y los de enlace como líneas con la URL. Meta solo lo admite dentro de las 24 h siguientes a que el cliente escriba al número; fuera de esa ventana falla y va el correo.

Si Meta acepta el mensaje pero luego no llega (por ejemplo, el número no tiene WhatsApp), sale un aviso en el panel («No le ha llegado el WhatsApp…, llámale»).

## Cómo se activa (variables de las funciones de Supabase)

| Variable | Quién la pone | Para qué |
| --- | --- | --- |
| `WHATSAPP_ACCESS_TOKEN` | Dueño (usuario del sistema de Meta, sin caducidad) | Hablar con la API de Meta |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID` | Dueño (pantalla de la API de WhatsApp en Meta) | Número y cuenta que envían |
| `WHATSAPP_APP_SECRET` | Dueño (configuración básica de la app de Meta) | Comprobar la firma del webhook |
| `WHATSAPP_VERIFY_TOKEN` | Dueño (se la inventa) | Verificar el webhook al configurarlo en Meta |
| `WHATSAPP_RESERVAS_SECRET` | Generada al desplegar | Rutas internas de `whatsapp-reservas` |
| `WHATSAPP_RESERVAS_ACTIVO=true` | Al activar | Enciende el selector de la web y el desvío de los avisos |
| `WHATSAPP_RESENAS_ACTIVO=true` | Al activar | Enciende la petición de reseña (plantilla `resena_tras_visita` aprobada antes) |
| `WHATSAPP_RESENAS_CRON_SECRET` | Generada al desplegar | El cron de reseñas; **el mismo valor** en Vault: `select vault.create_secret('<valor>', 'whatsapp_resenas_cron_secret');` |
| `WHATSAPP_RESENAS_DESTINATARIOS=todos` | Opcional | Pedir reseña a todas las reservas con móvil (por defecto, solo a quien eligió WhatsApp) |
| `WHATSAPP_RESPUESTA_AUTOMATICA=false` | Opcional | No contestar a los mensajes escritos (número compartido con la app WhatsApp Business) |

Webhook en Meta: `https://<proyecto>.supabase.co/functions/v1/whatsapp-reservas/webhook`, campo `messages`.

Rutas internas (cabecera `x-webhook-secret`): `POST /plantillas` (estado en Meta), `POST /plantillas/crear`, `POST /suscribir`, `POST /prueba {telefono, tipo}` (`tipo: "resena"` para la de reseña), `POST /resenas` (la del cron). `/resenas` y `/plantillas*` aceptan también `WHATSAPP_RESENAS_CRON_SECRET`.

## Coste (Super Admin › Servicios)

Meta cobra **por mensaje entregado** (desde el 01/07/2025), según la categoría y el país del móvil. España, en EUR y sin IVA, desde el 01/07/2026: plantilla de **utilidad** (avisos y reseña) **0,0166 €**, **marketing 0,0585 €**. Desde el 01/10/2026 se cobran también los mensajes de servicio (texto libre: respuestas del chat) a partir del 1.001 del mes; los 1.000 primeros, gratis. Fuente: [precios de la plataforma de WhatsApp](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing) (las cifras en EUR son las de su tarjeta de precios). Si Meta clasifica la plantilla de reseña como marketing, la cobra como tal: el webhook lo dice y Servicios lo cuenta. Sin webhook, el coste sale como «estimado».

## Para pasar a producción

- Verificar el negocio en Meta y dar de alta un número propio (o la coexistencia con la app WhatsApp Business), con su nombre visible y método de pago.
- Registrar las plantillas en la cuenta de producción (los enlaces apuntan a la web de producción: `WEB_CASA_TOMAS_URL`).
- Política de privacidad: mencionar WhatsApp/Meta como encargado.
- Touza: plantillas y número propios (hoy sus avisos van por correo).
- Pendiente de decidir: newsletter de quien elige WhatsApp (el alta llega al confirmar desde el correo), recordatorio y «reserva modificada» por WhatsApp, y mandar el correo automáticamente si un WhatsApp no se entrega.

## Pruebas

- `whatsapp-reservas/__tests__/logica.test.ts`, `whatsapp-reservas/__tests__/resenas.test.ts`, `_shared/__tests__/whatsapp-tarifas.test.ts`, `servicios-uso/index.test.ts` (WhatsApp), `node scripts/test-whatsapp-resenas.mjs` (PGlite), `emails-reserva/__tests__/whatsapp-y-gestion.integracion.test.ts`, `reservas-web/__tests__/canal-avisos-whatsapp.integracion.test.ts`, `npm run test:canal-avisos:db`.
- Web: `ReservationForm.canal-avisos.test.tsx` y `respuesta-reserva.test.tsx`.
