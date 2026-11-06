# Banco QA de Facturas › Cargar (05/11/2026)

Playwright 1.63 + el Supabase falso de `tests/e2e-movil`. `servidor-falso.mjs` simula `procesar-factura`
(iniciar / sustituir / añadir página / síncrono), los trabajos de `ocr_trabajos` (que el panel sondea), Storage
(`pendientes/`), `importar-factura-historica` y las RPC `ocr_descartar_trabajo` / `ocr_reintentar_trabajo`
(con `sinRpcTrabajos: true` se comporta como un servidor sin la migración: 204 y el panel cae a lo de antes).
El comportamiento sale del NOMBRE del fichero subido (`ok`, `albaran`, `avisos`, `drive` → `archivo_estado:"temporal"`,
`sinorig` → `"perdido"`, `sust`, `pagina`, `dup`, `fallido`, `colgado`/`lento`). Nada sale a Internet ni a OpenAI.
Tamaños: 1180×820, 820×1180 y 390×844.

```bash
VITE_SUPABASE_URL=https://e2e-falso.supabase.co VITE_SUPABASE_ANON_KEY=anon-falsa npx vite build --outDir <DIST>
QA_DIST=<DIST> npx playwright test -c tests/qa-cargar/playwright.config.mjs
```

En un worktree sin `node_modules` propio, el `webServer` del config no encuentra `node_modules/vite`: arranca antes
`npx vite preview --outDir <DIST> --port 4183 --strictPort --host 127.0.0.1` y pasa `E2E_BASE_URL=http://127.0.0.1:4183`.

Variables: `QA_DIST` (build), `QA_PUERTO` (4183), `QA_CAPTURAS` (carpeta de capturas y `hallazgos.txt`),
`E2E_WORKERS`, `E2E_BASE_URL`. Los fallos UI-1…UI-16 del informe del 05/11 ya se comprueban con `expect`
(comportamiento correcto). Lo que quede mal de presentación (scroll de página, botones fuera de un diálogo) se anota
como «FALLO» y las carencias de producto (p. ej. no hay importación desde Excel/CSV) como «CARENCIA» en
`hallazgos.txt`, sin hacer fallar la prueba.
