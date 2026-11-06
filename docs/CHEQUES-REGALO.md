# Cheques regalo: expedición, compra manual, correo y PDF

## Factura en compra manual (8 de octubre de 2026)

**Compra manual → Solicitar factura** muestra nombre o razón social, NIF/CIF y dirección fiscal. Se envía al email del comprador con la plantilla y el importe real, aunque el regalo oculte la cifra. Para cortesías, seleccionar un método de cobro antes de solicitar factura.

Los datos se validan en la base de datos antes de expedir. La solicitud conserva el mismo código y los mismos datos al reintentar. El envío de factura usa la numeración y el PDF existentes. Si falta un envío, **Reintentar envío** continúa con el mismo cheque y factura; no vuelve a crear la compra.

Activación:

1. Aplicar `supabase/migrations/20261008060000_factura_compra_manual.sql` en el proyecto compartido, después de `20261007190000_cheques_manual_plantilla.sql`.
2. Desde `casa-tomas-story`, actualizar y desplegar:

   ```sh
   git pull origin main
   npx supabase functions deploy cheques-regalo-admin --project-ref sfonaclosuafvlhutkon
   ```

3. Comprobar los datos del emisor en **Cheques → Plantilla de factura**. Expedir una compra de prueba solicitando factura y comprobar ambos correos, el número de factura en la ficha y el reintento sin duplicados.

La función `crear_cheque_manual_v2` permite detectar si falta esta migración antes de crear una compra con una solicitud de factura ignorada.

## Opciones de cada regalo y vista previa

La compra manual y la compra web permiten mostrar u ocultar el importe en el regalo y elegir si el PDF incluye dedicatoria. Sin dedicatoria se guarda el mensaje vacío; el destinatario continúa siendo opcional. El precio cobrado y la factura conservan el importe real.

Antes de confirmar se muestra una vista del PDF con código de ejemplo, usando la plantilla del restaurante. En **Correo y PDF** se pueden probar ambas casillas sin cambiar las opciones de otros cheques. El código está situado un poco más abajo dentro de su recuadro.

Esta actualización no necesita una migración nueva si ya se aplicó `20261007190000_cheques_manual_plantilla.sql`. Desde `casa-tomas-story`, desplegar:

```sh
supabase functions deploy cheques-regalo-web
supabase functions deploy cheques-regalo-admin
supabase functions deploy stripe-webhook-cheques-regalo --no-verify-jwt
```

La función web añade `/vista-previa`, que devuelve el diseño del PDF con los datos introducidos, sin crear compras ni códigos. Las selecciones de importe se guardan antes de abrir Stripe y el webhook las respeta al enviar el regalo. GitHub/Vercel no despliegan estas funciones.

## Actualización de compra manual y plantilla (7 de octubre de 2026)

- **Expedición de tickets** solo incluye cheques con código expedido. El filtro se aplica antes de contar y paginar, también en la búsqueda. Se muestran teléfono, comprador y estado; al pulsar la fila o el código se abre la ficha completa, incluidos email, dedicatoria, entrega, pago y datos de factura.
- **Compra manual** registra importe, comprador, teléfono, destinatario, dedicatoria y método de pago (efectivo, tarjeta, transferencia o cortesía). Se confirma el cobro antes de expedir. El código se crea en una transacción autorizada, con referencia de solicitud única para reintentar sin duplicarlo. Se puede ocultar el importe del regalo. Si falla el envío, se conserva el código y se reintenta solo el correo.
- **Correo y PDF** permite guardar asunto, mensaje, título, subtítulo, logo PNG/JPG, colores, instrucciones y pie. Los tokens `{comprador}`, `{destinatario}`, `{codigo}` y `{importe}` usan los datos de cada cheque. La vista previa y la descarga usan el mismo generador que el PDF adjunto del email.
- La plantilla se copia en el cheque al expedir una compra manual o antes del primer envío de una compra web. Los reintentos conservan ese diseño. Las cortesías se cuentan como expedidas, pero no se suman al importe cobrado.
- Consultar exige `cheques / view`; crear, enviar o editar exige `cheques / edit`, tanto en SQL como en la función del servidor. No hay lectura pública de datos del comprador.

### Activar esta actualización

1. Aplicar `supabase/migrations/20261007190000_cheques_manual_plantilla.sql` en la demo `sfonaclosuafvlhutkon` (producción solo con el «sí» del dueño; `supabase db query --linked -f`, nunca `db push`), después de las migraciones de Cheques anteriores.
2. Desde el repositorio `casa-tomas-story`, desplegar las funciones actualizadas:

   ```sh
   supabase functions deploy cheques-regalo-admin
   supabase functions deploy stripe-webhook-cheques-regalo --no-verify-jwt
   ```

3. Conservar `RESEND_API_KEY`, `RESEND_FROM_EMAIL` y las variables de Supabase/Stripe existentes. Publicar el panel desde `main`.
4. Configurar **Cheques → Correo y PDF**; hacer una expedición de prueba, revisar el email con adjunto, comprobar el teléfono y la ficha, verificar el código y canjearlo una sola vez. Comprobar también una compra web pagada.

Subir a GitHub o publicar Vercel no ejecuta esta migración ni despliega Edge Functions. Sin esos pasos, las pestañas nuevas informan de la configuración que falta y no permiten guardar datos ficticios.

Validación: pruebas de interfaz de `src/components/cheques/__tests__` y del verificador, build de producción y pruebas Deno de `supabase/functions/_shared/cheques-regalo/plantilla.test.ts`. La migración se comprobó en PostgreSQL local con paginación, búsqueda por teléfono/email, permisos, datos inválidos, referencia repetida, snapshot y canje único.

El menú **Cheques** abre `/cheques`: verificación por código, canje con confirmación y plantilla con datos fiscales, logo PNG/JPG y vista previa. El permiso `cheques / view` permite consultar, verificar y **canjear** (desde el 06/11/2026, decisión del dueño; migración `20261106520000_permisos_reservas_cheques_tienda`); `cheques / edit` permite además la compra manual, la configuración del cheque y la plantilla de factura (pestañas que con solo `view` no salen). Se conceden desde Usuarios por un super admin. Los super admins conservan acceso.

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


## Caducidad de los cheques

En **Cheques → Correo y PDF → Validez del cheque (meses)** se configura el plazo, de 1 a 120 meses. Por defecto son 12 meses (un año natural). Cada cheque guarda `emitido_en` y `caduca_el` al emitirse: al confirmar Stripe el pago o al registrar la compra manual. El día de caducidad está incluido y se interpreta en `Europe/Madrid`. Cambiar el plazo solo afecta a futuras emisiones.

Los cheques anteriores reciben un año desde su fecha de compra. Se conserva su código, estado y diseño. No se reenvían correos automáticamente.

La expedición y la ficha muestran la fecha y los días restantes; el verificador muestra «Caduca hoy» en el último día y rechaza los caducados. El canje vuelve a comprobar la fecha de forma atómica en el servidor. Un trigger también impide marcar como usado un cheque caducado y mantiene fija la fecha frente a reintentos.

El correo (HTML y texto), la tarjeta PDF y las vistas previas incluyen la fecha incluso al ocultar el importe. Se admite `{caducidad}` en los textos personalizados. Las funciones `cheques-regalo-web`, `cheques-regalo-admin` y `stripe-webhook-cheques-regalo`, en `casa-tomas-story`, deben desplegarse tras aplicar la migración de caducidad.

## Gastos de gestión de la compra online (27 de octubre de 2026)

En **Cheques → Configuración → Gastos de gestión de la compra online** se activan y se ajusta la tarifa que deben cubrir: por defecto 1,5 % + 0,25 €, la estándar de Stripe para tarjetas europeas. Vienen **apagados**. Al activarlos, la web suma al cobro `total = (importe + fijo) / (1 − %)`, redondeado al céntimo hacia arriba, para que tras la comisión al restaurante le quede el valor del cheque: un cheque de 50 € cuesta 51,02 €. El comprador ve el desglose (cheque, gastos y total) en el resumen antes de pagar, y en Stripe como una línea aparte, «Gastos de gestión». La factura los recoge en su propia línea y el total pagado los incluye. El valor del cheque, el que se canjea, no cambia.

Son iguales para cualquier forma de pago: en España el comercio no puede cobrar un recargo por usar un medio de pago concreto (art. 35.2 del Real Decreto-ley 19/2018). Actívalos solo con el visto bueno de la gestoría, que también debe confirmar su IVA en la factura. Las tarjetas premium (2,8 %), internacionales (3,15 %) y Klarna cuestan más a Stripe; en esos pagos los gastos no cubren toda la comisión.

La pestaña **Stripe** separa lo cobrado en valor de los cheques y gastos de gestión, muestra lo que se lleva Stripe (la comisión real que guarda el webhook; estimada si falta) y la ganancia neta, y si los gastos cubren la comisión. La ficha de cada compra web muestra valor, gastos, total cobrado, comisión y neto.

El cálculo vive en `casa-tomas-story/supabase/functions/_shared/cheques-regalo/gastos-gestion.ts`; lo usan la web para enseñarlo y `cheques-regalo-web` para cobrarlo. El panel lleva una copia en `src/lib/cheques/gastosGestion.ts` solo para los ejemplos. La web solo enseña gastos si se los anuncia la función que los cobra (`/plantilla-vista`), así que activar el interruptor antes de desplegar la función no cobra nada.

Activación: aplicar `supabase/migrations/20261027090000_gastos_gestion_cheques.sql` y desplegar `cheques-regalo-web` y `stripe-webhook-cheques-regalo` (este último, para la línea de gastos en la factura). Estado: aplicada en prod y demo; funciones desplegadas en demo.
