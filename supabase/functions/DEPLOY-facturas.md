# Despliegue · Migración facturas (OCR + Chatbot) fuera de n8n

Las funciones `procesar-factura` y `chat-facturas` ya **no llaman a n8n**: hacen todo el
trabajo directamente (GPT Vision, embeddings, RPCs de Postgres, Google Drive).
El frontend (`SubidaFacturas.tsx`, `useChatFacturas.ts`) **no necesita cambios**: el
contrato de entrada/salida es idéntico.

## 1. Secrets necesarios

```bash
supabase secrets set \
  OPENAI_API_KEY=sk-... \
  GOOGLE_CLIENT_ID=...apps.googleusercontent.com \
  GOOGLE_CLIENT_SECRET=... \
  GOOGLE_REFRESH_TOKEN=1//0... \
  GOOGLE_DRIVE_PARENT_FOLDER_ID=<ID de la carpeta raíz de facturas en Drive> \
  --project-ref jeamoczmbfsnwkfjxcyo
```

`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` ya los inyecta Supabase automáticamente.

> Si NO defines las variables `GOOGLE_*`, la función procesa y guarda la factura igual,
> solo se omite la subida a Drive (lo avisa en logs). Útil para probar el OCR primero.

## 2. Conseguir el refresh token de Google (Opción A — OAuth de usuario real)

Drive es Gmail de consumidor, así que un service account NO sirve (cuota 0). Se usa el
OAuth del usuario real, una sola vez:

1. Google Cloud Console → habilita **Google Drive API**.
2. Crea credenciales **OAuth client ID** tipo *Web application*. Añade como redirect URI
   `https://developers.google.com/oauthplayground`.
3. Ve a https://developers.google.com/oauthplayground →  ⚙ (arriba dcha) → marca
   *Use your own OAuth credentials* → pega Client ID y Secret.
4. En *Step 1* selecciona el scope `https://www.googleapis.com/auth/drive.file`
   (o `.../auth/drive` si quieres acceso a carpetas ya existentes).
5. Autoriza con la cuenta dueña de la carpeta de facturas → *Exchange authorization code*.
6. Copia el **Refresh token** → ese es `GOOGLE_REFRESH_TOKEN`.

La carpeta raíz: créala en Drive, abre y copia el ID de la URL
(`https://drive.google.com/drive/folders/<ESTE_ID>`).

## 3. Desplegar

```bash
supabase functions deploy procesar-factura --project-ref jeamoczmbfsnwkfjxcyo
supabase functions deploy chat-facturas     --project-ref jeamoczmbfsnwkfjxcyo
```

## 4. Prueba

- **OCR**: en el panel, pestaña de subida de facturas → sube un PDF/imagen. Debe aparecer
  factura/albarán al instante y la fila nueva en la tabla. Revisa logs:
  `supabase functions logs procesar-factura`.
- **Chatbot**: pestaña de chat de facturas → "¿cuánto he gastado este mes?" / "última
  factura de Salazones Garre". Revisa `supabase functions logs chat-facturas`.

## 5. Apagar n8n (cuando ambas estén validadas)

- Desactivar los workflows en `n8npersonal.miguelbenito.space`.
- Ya no se usan los webhooks `/webhook/d96678f4-...` (OCR) ni `/webhook/chatbot`.

## Notas técnicas / decisiones

- **Síncrono, no cola**: el frontend sube archivos en paralelo y espera el `tipo` al
  instante. Un documento por gpt-5-mini cabe de sobra en los límites de Edge Functions.
  Si algún día se suben lotes muy grandes, se añade pgmq + worker (no ahora).
- **Embeddings de productos en batch**: 1 sola llamada a OpenAI por factura (antes n8n
  hacía una por producto en serie).
- **Pendiente de endurecer**: las RPCs `*_agente` y `verificar_duplicado_factura` eran
  invocables con el `anon key` desde n8n. Aquí las llamamos con service role (RLS no
  aplica), pero conviene revisar que `anon` no deba poder ejecutarlas directamente.
- **Modelos**: OCR `gpt-5-mini` (Vision, json_object); chat `gpt-4.1-mini`; embeddings
  `text-embedding-3-small` (1536).
