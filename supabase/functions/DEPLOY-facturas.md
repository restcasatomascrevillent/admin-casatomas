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

---

## 6. Cambios de septiembre de 2026 (orden de despliegue)

**1) Migraciones primero, SIEMPRE.** El frontend ya lee columnas que solo existen
tras aplicarlas; si se despliega el panel antes, la tabla de facturas fallara.

```bash
supabase db push --project-ref jeamoczmbfsnwkfjxcyo
#  20260919100000_facturas_busqueda_y_herramientas_chatbot.sql
#  20260919110000_facturas_archivo_original_y_validacion.sql
```

Lo que traen:
- Indice HNSW sobre `facturas.embedding` (la busqueda semantica ya no hace
  recorrido secuencial) y se elimina `idx_facturas_embedding`, que apuntaba a
  `embedding_observaciones`, vacia al 100 %.
- `buscar_facturas_agente` con filtro `p_tipo` (factura / albaran).
- Tres RPC nuevas para el chatbot: `buscar_documentos_agente`,
  `historial_precios_agente`, `resumen_periodo_agente`.
- `estadisticas_globales_agente` deja de mezclar facturas y albaranes en el
  ranking de proveedores.
- Columnas `facturas.archivo_path` y `facturas.alertas_validacion`.
- Bucket **privado** `facturas-originales` (10 MB, PDF/JPEG/PNG/WEBP) con
  politicas por permiso de seccion.
- `validar_cordura_factura()` y marcado de los documentos ya existentes.

**2) Edge Functions.**

```bash
supabase functions deploy procesar-factura --project-ref jeamoczmbfsnwkfjxcyo
supabase functions deploy chat-facturas    --project-ref jeamoczmbfsnwkfjxcyo
```

**3) Panel** (build normal).

### Archivo del documento original

Mientras los secrets `GOOGLE_*` no existan, `procesar-factura` guarda el PDF o la
imagen en el bucket `facturas-originales` y deja la ruta en `facturas.archivo_path`.
Antes se descartaba el fichero con un `console.warn`. En cuanto se configuren los
secrets de Drive, vuelve a usarse Drive sin tocar codigo; Storage queda como red de
seguridad si Drive falla.

### Revision pendiente para el dueño

- **Albaran id 38 (Carnicas Joselito, nº 2509134, 15-dic-2025): 120.580,00 €**, con
  12 jamones a 9.316,67 €/ud. Casi seguro un x10 del OCR. La migracion lo deja
  marcado en `alertas_validacion` (3 alertas de severidad alta). **La correccion del
  importe es decision del dueño**: no se ha tocado el dato.
- Los 4 secrets de Google Drive siguen sin configurar (ver §1 de este documento).
