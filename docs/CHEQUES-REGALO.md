# Cheques regalo: validador y factura

El menú **Cheques** abre `/cheques`: verificación por código, canje con confirmación y plantilla con datos fiscales, logo PNG/JPG y vista previa. El permiso `cheques / view` permite verificar y ver la plantilla; `cheques / edit` permite canjear y guardarla. Se conceden desde Usuarios por un super admin. Los super admins conservan acceso.

La compra está en `oficiososia/casa-tomas-story`. La casilla de factura exige razón social, NIF y dirección fiscal completa. El webhook confirma el cobro y genera una factura numerada por cheque. La factura conserva una copia de los datos y del IVA de la plantilla. Resend adjunta el PDF al email del comprador. Si falla, Stripe reintenta con el mismo número y código y la misma clave de idempotencia de email. No se envía al destinatario del regalo.

## Activación (mismo proyecto Supabase del panel y la web)

1. Desde este repositorio, aplicar `supabase/migrations/20261003170000_cheques_validador_facturas.sql` con el flujo habitual de migraciones. Comprobar primero las migraciones pendientes: `supabase db push --dry-run`. Después: `supabase db push`.
2. Desde `casa-tomas-story`, desplegar las dos funciones (incluyen `_shared/factura-cheque-pdf.ts` y `_shared/enviar-factura-cheque.ts`):

   ```sh
   supabase functions deploy cheques-regalo-web
   supabase functions deploy stripe-webhook-cheques-regalo --no-verify-jwt
   ```

3. Conservar las variables existentes `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY` y `RESEND_FROM_EMAIL`, y las de Supabase. La clave de Stripe debe permitir crear sesiones de Checkout. Resend debe tener un remitente verificado.
4. Abrir **Cheques → Plantilla de factura**, completar y guardar los datos reales del emisor y su logo. Configurar el porcentaje de IVA apropiado: se desglosa dentro del importe pagado, sin incrementar el total. Con 0 no aparece una línea de IVA. No se inventan datos fiscales.
5. Conceder los permisos de Cheques a las personas que lo gestionarán. Desplegar las webs con su configuración habitual de Supabase, apuntando ambas al mismo proyecto.
6. Hacer una compra en modo de pruebas de Stripe con y sin factura. Verificar el email del cheque y el PDF adjunto en un email separado; verificar el código en el panel, canjearlo y confirmar que un segundo canje falla. Probar también un evento de pago diferido y un reintento del webhook.

Si la plantilla aún no tiene datos fiscales, la compra con factura informa del problema antes de iniciar el pago. Si la web está actualizada pero la función de compra aún es antigua, la web no redirige al pago con factura, para evitar prometer una factura que no se haya registrado.

La migración no permite lectura pública de códigos, emails o datos de compradores. La consulta y el canje usan RPC con autorización en la base de datos; el canje es una actualización condicional atómica. La emisión se limita a `service_role`, bloquea la fila y reutiliza la factura existente. Los reembolsos mantienen el comportamiento del webhook existente; no se emiten facturas rectificativas automáticamente.

## Verificación del cambio

- Pruebas de interfaz: `npm test -- src/pages/__tests__/Cheques.test.tsx src/components/usuarios/__tests__/permisosSecciones.test.ts` (requieren variables de entorno de prueba para importar el cliente de Supabase).
- Compilación del panel: `npm run build`.
- En la web: `npm test -- src/__tests__/Contacto.factura.test.tsx`.
- PDF: `deno test supabase/functions/_shared/factura-cheque-pdf.test.ts` desde `casa-tomas-story`.
- Esquema validado en PostgreSQL local: permisos de consulta/canje, lectura privada, cheque cancelado, segundo canje rechazado y factura estable al cambiar la plantilla.

Este cambio necesita el despliegue de Supabase anterior; un commit o despliegue de Vercel no aplica SQL ni actualiza Edge Functions.

## Plantilla Casa Tomás

La migración `20261003180000_plantilla_casa_tomas.sql` prepara el logo original, la dirección y el contacto en plantillas vacías. Conserva datos fiscales personalizados y el NIF existente. Revisa razón social y NIF antes de emitir. El botón «Usar plantilla Casa Tomás» recupera el logo y el pie de contacto, conservando datos fiscales e IVA.

Para actualizar la apariencia de las facturas enviadas, desplegar de nuevo `stripe-webhook-cheques-regalo` desde `casa-tomas-story`; incluye los módulos compartidos de marca y PDF. Las facturas existentes conservan sus datos; el cambio modifica su presentación si se vuelve a generar el PDF.
