# Avisos de reserva por WhatsApp (prueba de concepto)

Petición del dueño (21/11/2026): que los avisos de reserva («confirma tu reserva» y demás) puedan llegar por WhatsApp con botones en el propio mensaje, usando la API de WhatsApp de Meta, y que el cliente elija al reservar si los quiere por email o por WhatsApp.

Estado: **solo en la demo**, con el número de prueba de Meta (solo escribe a los móviles registrados en la app de Meta, como máximo 5). En producción no cambia nada mientras no se active (ver «Cómo se activa»).

## Qué ve el cliente

1. **Al reservar en la web** (si WhatsApp está activo): «¿Cómo quieres recibir los avisos de tu reserva?» con **Por email** (marcado por defecto) o **Por WhatsApp**.
2. **Reserva recibida** (pendiente de que la revise el restaurante): WhatsApp con los datos y los botones **Gestionar mi reserva** (abre la web: ver la reserva y cancelarla, con un «¿seguro?») y **Ver la carta**. Por email este aviso sigue silenciado para las reservas de la web.
3. **Reserva verificada** («confirma tu asistencia»): botones **Sí, confirmo**, **No puedo, cancelar** y **Cómo llegar** (Google Maps). Al pulsar uno, la reserva cambia como con el botón del correo y se le contesta en el mismo chat.
4. **Reserva confirmada** desde el panel: aviso con **Cómo llegar**.
5. **Reserva cancelada por el restaurante**: aviso sin botones.
6. Si escribe a mano al número: respuesta automática con el teléfono del restaurante (nadie lee ese número).

El recordatorio de dos días antes y el aviso de «reserva modificada» siguen yendo por correo (aún no tienen plantilla).

## Cómo funciona

| Pieza | Qué hace |
| --- | --- |
| `reservas.canal_avisos` (migración `20261215100000`) | `email` (por defecto) o `whatsapp`. Vuelta atrás en `supabase/rollbacks/`. |
| `reservas-web` | Con WhatsApp activo, anuncia `avisos_whatsapp: true` en `/disponibilidad` y guarda `canal_avisos` en `/crear` (WhatsApp exige teléfono). |
| `emails-reserva` | Antes de cada aviso, si el cliente eligió WhatsApp se lo pide a `whatsapp-reservas`; si no sale, manda el correo de siempre. Nuevo enlace «Gestionar mi reserva» (token `gestionar`, vale hasta el día de la reserva) y `via: "whatsapp"` en `/enlace/ejecutar` (el clic de WhatsApp no verifica el email del newsletter ni manda el aviso de después). |
| `whatsapp-reservas` (función nueva) | Manda las plantillas, recibe el webhook de Meta (pulsaciones y estados de entrega) y registra las plantillas en Meta. Al pulsar un botón llama a `emails-reserva /enlace/ejecutar`: la misma lógica que el botón del correo. |
| Web (`web-casatomas`) | Selector en el formulario de reserva y modo «Gestionar mi reserva» en `/reserva/respuesta`. |

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

Webhook en Meta: `https://<proyecto>.supabase.co/functions/v1/whatsapp-reservas/webhook`, campo `messages`.

Rutas internas (cabecera `x-webhook-secret`): `POST /plantillas` (estado en Meta), `POST /plantillas/crear`, `POST /suscribir`, `POST /prueba {telefono, tipo}`.

## Para pasar a producción

- Verificar el negocio en Meta y dar de alta un número propio (o la coexistencia con la app WhatsApp Business), con su nombre visible y método de pago.
- Registrar las plantillas en la cuenta de producción (los enlaces apuntan a la web de producción: `WEB_CASA_TOMAS_URL`).
- Política de privacidad: mencionar WhatsApp/Meta como encargado.
- Touza: plantillas y número propios (hoy sus avisos van por correo).
- Pendiente de decidir: newsletter de quien elige WhatsApp (el alta llega al confirmar desde el correo), recordatorio y «reserva modificada» por WhatsApp, y mandar el correo automáticamente si un WhatsApp no se entrega.

## Pruebas

- `whatsapp-reservas/__tests__/logica.test.ts`, `emails-reserva/__tests__/whatsapp-y-gestion.integracion.test.ts`, `reservas-web/__tests__/canal-avisos-whatsapp.integracion.test.ts`, `npm run test:canal-avisos:db`.
- Web: `ReservationForm.canal-avisos.test.tsx` y `respuesta-reserva.test.tsx`.
