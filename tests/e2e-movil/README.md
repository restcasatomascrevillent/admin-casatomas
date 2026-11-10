# e2e móvil del panel (desbordes y solapes)

Recorre todas las pantallas del panel en 8 tamaños de móvil/tablet con un **Supabase falso** (`supabase-falso.mjs`): ninguna
petición sale a Supabase ni a Internet, y los datos son sintéticos (`datos-sinteticos.mjs`). No necesita cuenta de pruebas.

No toca la configuración del producto (ni `package.json` ni `vite.config.ts`) y **no entra en `npm test`** (los ficheros se llaman
`*.e2e.mjs` para que Vitest no los recoja). Tampoco está en el CI todavía.

```bash
# 1. Build con una URL de Supabase ficticia (el cliente exige la variable; el mock intercepta *.supabase.co)
VITE_SUPABASE_URL=https://e2e-falso.supabase.co VITE_SUPABASE_ANON_KEY=anon-falsa npm run build

# 2. Navegador de Playwright (una vez)
npx playwright install chromium

# 3. Pruebas (sirve `dist` con `vite preview` en el 4173)
npx playwright test -c tests/e2e-movil/playwright.config.mjs
npx playwright test -c tests/e2e-movil/playwright.config.mjs --project=375x812 -g "Calendario"
```

Variables: `E2E_BASE_URL` (servidor ya levantado), `E2E_SUPABASE_URL` (la que se usó en el build), `E2E_WORKERS` (2 por defecto).

Los defectos conocidos de la auditoría móvil llevan `test.fail(...)`: mientras sigan rotos la prueba pasa en verde; cuando alguien
los arregle, la prueba avisará («expected to fail, but passed») y habrá que quitar la marca.

Capturas del flujo «foto de la etiqueta → puntuación Parker» (08/11/2026): `node tests/e2e-movil/parker-foto.capturas.mjs [carpeta]`, con el mismo build y `vite preview`. Simula la lectura de la etiqueta y la búsqueda (verificada, sin añada legible, contradicción, fallo, lista y edición).

Medición de «Reservas › Hoy» con mala cobertura (09/11/2026): `node tests/e2e-movil/medir-hoy.mjs [--base URL] [--latencia 600] [--veces 3]`, con el mismo build y `vite preview`. Da el tiempo hasta ver la lista de reservas y las salas (escritorio 1440×900 y móvil 390×844), en frío y en caliente (volver a abrir el panel con la copia del dispositivo). No es una prueba: no entra en `npm test`.

Etiquetas de cierre del calendario de Reservas (10/11/2026): `node tests/e2e-movil/calendario-cierres.capturas.mjs [carpeta]`, con el mismo build y `vite preview`. Simula la regla semanal (lunes y domingo noche; `E2E_REGLA=antigua` añade los jueves, como antes) y dos cierres a mano, saca capturas en tablet y escritorio y sale con código 1 si alguna etiqueta «Cerrado» / «Sin comida» / «Sin cena» queda cortada, aplastada o pisada por la cifra.
