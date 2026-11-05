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
  --project-ref sfonaclosuafvlhutkon
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
supabase functions deploy procesar-factura --project-ref sfonaclosuafvlhutkon
supabase functions deploy chat-facturas     --project-ref sfonaclosuafvlhutkon
```

## 4. Prueba

- **OCR**: en el panel, pestaña de subida de facturas → sube un PDF/imagen. Debe aparecer
  factura/albarán al instante y la fila nueva en la tabla. Revisa logs:
  `supabase functions logs procesar-factura`.
- **Chatbot**: pestaña de chat de facturas → "¿cuánto he gastado este mes?" / "última
  factura de Salazones Garre". Revisa `supabase functions logs chat-facturas`.

## 5. Apagar n8n (cuando ambas estén validadas; n8n ya está retirado, apartado conservado como histórico)

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
# Procedimiento del repo (docs/PROCESO-DE-CAMBIOS.md): NUNCA `db push` ni `migration repair`.
# Demo primero; en producción (haqmmdfdzzatdnrrcgez) solo con el «sí» del dueño. Una a una, en orden de nombre:
supabase link --project-ref sfonaclosuafvlhutkon
supabase db query --linked -f supabase/migrations/<fichero>.sql
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
supabase functions deploy procesar-factura --project-ref sfonaclosuafvlhutkon
supabase functions deploy chat-facturas    --project-ref sfonaclosuafvlhutkon
```

**3) Panel** (build normal).

### Archivo del documento original (desde el 05-nov-2026: solo Google Drive)

Orden del dueño: «no se puede guardar nada en Supabase Storage». El original va
SIEMPRE a Drive (carpeta del proveedor → «2026-03 Marzo») y se guarda
`facturas.drive_url`. El bucket `facturas-originales` es solo almacén temporal:

- `pendientes/{uid}/{trabajo}/…`: piezas del OCR por trabajos. Se borran al
  terminar o fallar el trabajo (los «duplicado» las guardan hasta decidir).
- `temporal/{factura}-{nombre}`: el original cuando Drive falla al guardar. La
  factura queda «pendiente de Drive» (`archivo_path` sin `drive_url`; el botón del
  original lo dice) y la Edge Function `facturas-originales-drive` (pg_cron
  `facturas-originales-drive`, cada 10 min, solo si hay algo que hacer) la sube y
  borra la copia. A los 5 fallos seguidos: aviso de prioridad alta en la campana
  (`original_sin_drive`); después reintenta cada 6 h.

La misma función rescata lo antiguo (rutas `AAAA/MM/…`, huérfanos de
sustituciones y restos de `pendientes/`). Migración
`20261105193000_facturas_originales_drive.sql` (test en
`supabase/tests/facturas_originales_drive_test.sql`). A mano (admin):

```bash
curl -X POST "$SUPABASE_URL/functions/v1/facturas-originales-drive" \
  -H "Authorization: Bearer <JWT de un admin>" -H "Content-Type: application/json" \
  -d '{"accion":"informe"}'      # o {"accion":"pasar"}
```

### QA de «Cargar» (06-nov-2026, migración `20261106200000_facturas_cargar_qa.sql`)

Orden: desplegar `procesar-factura`, `ocr-trabajo`, `importar-factura-historica`
y `facturas-originales-drive`; después la migración y su test
(`supabase/tests/facturas_cargar_qa_test.sql`). Qué cambia:

- Ningún original se pierde: si una consolidación se corta tras crear la
  factura, el reintento archiva el original (y mete las líneas si faltan); la
  limpieza nunca borra lo de `pendientes/` de una factura sin original, y el
  cron se lo devuelve (va a Drive y se le pone como `drive_url`).
- Drive: subida en UNA llamada (multipart; sin ficheros vacíos), carpetas sin
  duplicar con subidas a la vez, cachés que se olvidan ante 401/404, el UPDATE
  de `drive_url` se reintenta en vez de subir otra copia, aviso de Drive caído
  agrupado (uno por hora).
- Duplicados: el panel los descarta con `ocr_descartar_trabajo`; los que nadie
  decide caducan a los 7 días (original a Drive como «anterior-…»).
- «Reintentar» del panel: `ocr_reintentar_trabajo` reanuda el MISMO trabajo
  (los «fallido» guardan sus ficheros 24 h).
- URL de las Edge Functions desde Vault `project_url` (antes iba fija la del
  proyecto viejo en `ocr_despachar` y dos despachadores más): **en producción
  tiene que existir el secreto de Vault `project_url`**; sin él, el OCR por
  trabajos queda mudo.
- Cron `reanudar-trabajos-ocr` cada minuto (en la demo faltaba).
- Storage: solo `pendientes/{uid}/` para el panel; bucket a 20 MB (PDF de la
  importación histórica con Drive caído).
- Rescate a mano de una factura sin original cuyo fichero está en Drive:
  `{"accion":"buscar_original","factura_id":354,"nombre":"anterior-….jpeg","enlazar":true}`.

### Revision pendiente para el dueño

- **Albaran id 38 (Carnicas Joselito, nº 2509134, 15-dic-2025): 120.580,00 €**, con
  12 jamones a 9.316,67 €/ud. Casi seguro un x10 del OCR. La migracion lo deja
  marcado en `alertas_validacion` (3 alertas de severidad alta). **La correccion del
  importe es decision del dueño**: no se ha tocado el dato.
- Los 4 secrets de Google Drive siguen sin configurar (ver §1 de este documento).

---

## 7. Documentos largos y «Sustituir la existente» (octubre de 2026)

Diseño: `docs/funcionalidades/04b-facturas-multipagina-plan.md` (raíz del repo
`codigo-restaurante`). Qué cambia para el usuario: **nada que pulsar**. Una imagen muy
alta (captura de móvil con varias páginas de un PDF apiladas) o un PDF de varias páginas
se trocea en el navegador y se lee en segundo plano por trozos; el resto de documentos
sigue por el camino de siempre. Si un documento ya existe, el panel ofrece
**«Sustituir la existente»** (con confirmación que enseña la fila actual).

**Orden obligatorio** (todo desde `adminpanelct/`; Claude no puede desplegar ni aplicar):

```bash
# 1) Migración (+ su test, que termina en ROLLBACK y no deja nada)
npx supabase db query --linked -f supabase/migrations/20261005120000_ocr_trabajos_multipagina.sql
#    → tiene que imprimir «ocr_trabajos_multipagina: aplicada | <nº líneas> | true | false»
npx supabase db query --linked -f supabase/tests/ocr_trabajos_multipagina_test.sql
#    → «ocr_trabajos_multipagina_test: OK»

# 2) Funciones (procesar-factura sigue funcionando aunque se despliegue antes que la
#    migración; ocr-trabajo necesita la migración)
npx supabase functions deploy procesar-factura --project-ref sfonaclosuafvlhutkon
npx supabase functions deploy ocr-trabajo      --project-ref sfonaclosuafvlhutkon

# 3) Secreto compartido de ocr-trabajo (un valor aleatorio largo; NO lo pegues en ningún chat)
#    PowerShell:  -join ((48..57)+(97..102) | Get-Random -Count 64 | % {[char]$_})
#    Git Bash:    openssl rand -hex 32
npx supabase secrets set OCR_TRABAJOS_SECRET=<VALOR> --project-ref sfonaclosuafvlhutkon
#    Modelo (opcional; por defecto gpt-5.6-luna con detail original, ver 04b §1.14):
#    npx supabase secrets set OCR_MODELO=gpt-5.4-mini --project-ref sfonaclosuafvlhutkon
#    npx supabase secrets set OCR_MODELO_PIEZAS=gpt-5.6-luna --project-ref sfonaclosuafvlhutkon
```

```sql
-- 4) EL MISMO valor en Vault (SQL Editor de Supabase). Hasta este paso el cron está
--    instalado pero MUDO: no llama a nada.
select vault.create_secret('<VALOR>', 'ocr_trabajos_secret');

-- 5) Comprobaciones
select jobname, schedule, active from cron.job where jobname = 'reanudar-trabajos-ocr';
--    → reanudar-trabajos-ocr | * * * * * | true
select count(*) from vault.secrets where name = 'ocr_trabajos_secret';   -- → 1
-- Tras subir el primer documento largo:
select id, estado, num_paginas, coste_usd, error from public.ocr_trabajos order by created_at desc limit 5;
select status_code, count(*) from net._http_response
 where created > now() - interval '1 hour' group by 1;                    -- 202/200, nunca 401/500
```

- `ocr-trabajo` tiene `verify_jwt = false` (la llama pg_net, sin JWT) y se autentica con
  la cabecera `x-ocr-secret`; sin `OCR_TRABAJOS_SECRET` responde 500 a todo (falla cerrado).
- Para **rotar el secreto**: `secrets set` con el valor nuevo y
  `select vault.update_secret((select id from vault.secrets where name='ocr_trabajos_secret'), '<NUEVO>');`
- **Panel**: se puede publicar antes o después. Si el servidor aún no admite documentos
  largos (función vieja o migración sin aplicar), el panel lo detecta y manda el
  documento entero por el camino de una página, como hasta ahora.
- **Volver atrás**: `supabase/rollbacks/20261005120000_ocr_trabajos_multipagina_ROLLBACK.sql`
  (antes, desplegar la `procesar-factura` anterior y borrar `ocr-trabajo`).

### Una página también en segundo plano (05-oct-2026)

Sin migración. Desplegar PRIMERO `ocr-trabajo` y DESPUÉS `procesar-factura`: mientras
`procesar-factura` sea la antigua rechaza los trabajos de una pieza y el panel cae al camino síncrono;
al revés, una `ocr-trabajo` antigua leería la pieza única como trozo de documento largo (modelo y
lectura de piezas, no los del síncrono).

```
npx supabase functions deploy ocr-trabajo --project-ref sfonaclosuafvlhutkon
npx supabase functions deploy procesar-factura --project-ref sfonaclosuafvlhutkon
```

Comprobar: subir una foto de una página y cerrar la pestaña en cuanto pase a «En cola…»; al volver
aparece guardada. En `ocr_trabajos` queda una fila con `num_paginas = 1` y `origen` pdf/imagen.

### Sustituir Luga (54) y Salazones Garre (39) cuando lleguen los PDF

1. Facturas → Subir → «Elegir archivos» → el PDF (o la captura de 945×2048 que ya hay).
   El PDF de Luga (2 páginas) se trocea solo por páginas; la captura, en 5 franjas.
2. El resultado dirá «Ya existe la factura ML/101511 (8 líneas)…» con el botón
   **Sustituir la existente** (exige permiso de EDICIÓN en Facturas).
3. El diálogo enseña «Ahora» (total, nº de líneas, avisos) frente a «Documento nuevo».
   Al confirmar, en una sola transacción: copia de la fila, sus líneas y su historial en
   `facturas_sustituciones`; borra el historial de precios y las líneas viejas; actualiza
   la cabecera con el **mismo id**; inserta las líneas nuevas (el trigger rehace el
   historial); archiva el original nuevo y lo enlaza en `archivo_path`.
4. Garre (39): el número guardado es «F/25011959»; aunque el PDF lo imprima
   «F / 25011959» se detecta igual (comparación sin espacios ni signos). El CIF del
   cliente (B54583356, MASIDE) ya no puede quedar como CIF del proveedor.
5. Ver la copia de una sustitución:
   `select id, factura_id, sustituida_at, resumen_antes, resumen_despues from facturas_sustituciones order by id desc;`
