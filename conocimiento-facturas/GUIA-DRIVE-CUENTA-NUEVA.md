# Conectar el Drive de la cuenta nueva de Google

Hoy (04/11/2026) **ni la demo ni producción tienen la conexión a Drive configurada**: los
PDF de las facturas caen en el almacenamiento de reserva de Supabase
(`facturas-originales`). El código del panel ya sabe subir a Drive y crear las carpetas
**año → mes** según la fecha de cada factura; solo le faltan 4 claves.

Todo lo de Google lo haces **tú, con la cuenta nueva**. No pegues claves ni tokens en el
chat: van directas a Supabase (paso 6).

---

## 1. Carpetas en el Drive nuevo
Entra en drive.google.com con la cuenta nueva y crea dos carpetas en «Mi unidad»:
- `Facturas Casa Tomás` → la de verdad (producción).
- `Facturas Casa Tomás (DEMO)` → para las pruebas, así no se mezclan.

Abre cada una y copia el código del final de la dirección:
`https://drive.google.com/drive/folders/`**`ESTE_CODIGO`**. Son los «ID de carpeta».

## 2. Proyecto en Google Cloud
1. Entra en https://console.cloud.google.com con la cuenta nueva.
2. Arriba, selector de proyecto → **Proyecto nuevo** → nombre `Casa Tomas Facturas` → Crear.

## 3. Activar la API de Drive
Menú ☰ → **APIs y servicios → Biblioteca** → busca **Google Drive API** → **Habilitar**.

## 4. Pantalla de consentimiento
Menú ☰ → **APIs y servicios → Pantalla de consentimiento de OAuth** (o «Google Auth Platform»):
1. Tipo de usuario **Externo**. Nombre de la app `Casa Tomás Facturas`, correo de soporte = la cuenta nueva.
2. En **Público / Audience** → **Usuarios de prueba** → añade la cuenta nueva.
3. **Publicar la app** («Publicar app» / «In production»).
   ⚠️ Importante: si se queda en modo «Prueba», Google caduca el acceso **cada 7 días** y
   las subidas dejarían de funcionar sin avisar. Al publicarla, Google mostrará «app no
   verificada» al autorizar: es normal para uso propio.

## 5. Credenciales y token
1. **APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth**.
   - Tipo: **Aplicación web**.
   - **URI de redirección autorizados**: `https://developers.google.com/oauthplayground`
   - Crear → apunta el **ID de cliente** y el **Secreto de cliente** (no los mandes por chat).
2. Abre https://developers.google.com/oauthplayground
   - Rueda ⚙ arriba a la derecha → marca **Use your own OAuth credentials** → pega ID y secreto.
     Deja *Access type* en **Offline**.
   - A la izquierda, en el cuadro de abajo escribe `https://www.googleapis.com/auth/drive`
     → **Authorize APIs** → entra con la **cuenta nueva** → si sale «app no verificada»:
     *Configuración avanzada → Ir a Casa Tomás Facturas* → Permitir.
   - **Exchange authorization code for tokens** → copia el **Refresh token** (empieza por `1//`).

## 6. Meter las 4 claves en Supabase (primero la DEMO)
supabase.com → proyecto **sfonaclosuafvlhutkon** (demo) → **Edge Functions → Secrets**
(«Manage secrets») → añade:

| Nombre | Valor |
|---|---|
| `GOOGLE_CLIENT_ID` | el ID de cliente (acaba en `.apps.googleusercontent.com`) |
| `GOOGLE_CLIENT_SECRET` | el secreto de cliente |
| `GOOGLE_REFRESH_TOKEN` | el refresh token (`1//…`) |
| `GOOGLE_DRIVE_PARENT_FOLDER_ID` | ID de la carpeta **`Facturas Casa Tomás (DEMO)`** |

Avísame cuando estén y lo compruebo yo: subo una factura de prueba en la demo y miro
que aparezca en `Facturas Casa Tomás (DEMO)/2026/11`.

## 7. Producción (más adelante, con el «sí» del dueño)
Mismas 4 claves en el proyecto **haqmmdfdzzatdnrrcgez**, pero con el ID de la carpeta
**`Facturas Casa Tomás`** (la de verdad). Las facturas que ya están en el almacenamiento de
reserva se pueden pasar luego a Drive en una tarea aparte.

## Si algo falla
- «redirect_uri_mismatch» → la URI del paso 5.1 no está exactamente igual.
- No sale el refresh token → falta *Access type: Offline* o hay que quitar el permiso en
  https://myaccount.google.com/permissions y autorizar otra vez.
- Las subidas paran a los 7 días → la app quedó en modo «Prueba» (paso 4.3).
