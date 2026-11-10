// Capturas de Reservas › Hoy en el MÓVIL (375 y 414 px), lista y mesas, con el Supabase falso de esta carpeta
// (10/11/2026): mesas con nombres largos («Reservado» de 14 plazas, «Barra», «Mesa 10»), reservas de menú del día,
// de carta, con menú cerrado y sentadas fuera. Comprueba que el nombre de la mesa no se monta sobre las plazas,
// que la ayuda (i) de «Cerrar comida / Cerrar noche» va en la misma fila y que la página no hace scroll horizontal.
//
//   VITE_SUPABASE_URL=https://e2e-falso.supabase.co VITE_SUPABASE_ANON_KEY=anon-falsa npx vite build
//   npx vite preview --port 4173 --strictPort --host 127.0.0.1 &
//   node tests/e2e-movil/hoy-movil-detalles.capturas.mjs [carpeta-de-capturas] [prefijo]
//
// No entra en `npm test`. Sale con código 1 si algo se solapa o se sale.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { instalarSupabaseFalso } from "./supabase-falso.mjs";
import { tablas, rpcSinteticas, funcionesSinteticas } from "./datos-sinteticos.mjs";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173";
const URL_SUPABASE = process.env.E2E_SUPABASE_URL ?? "https://e2e-falso.supabase.co";
const SALIDA = process.argv[2] ?? "capturas-hoy-movil";
const PREFIJO = process.argv[3] ?? "";

function datos() {
  const t = tablas();
  const nombres = { 0: ["Reservado", 14], 1: ["Barra", 6], 9: ["Mesa 10", 4] };
  t.mesas = t.mesas.map((m, i) => (nombres[i] ? { ...m, nombre: nombres[i][0], etiqueta: nombres[i][0], capacidad: nombres[i][1] } : m));
  const hoy = t.reservas[0].fecha;
  let i = 0;
  t.reservas = t.reservas.map((r) => {
    if (r.fecha !== hoy) return r;
    i++;
    return {
      ...r,
      hora: i % 2 ? "13:30:00" : r.hora,
      menu_del_dia: i % 3 === 0 ? true : i % 3 === 1 ? false : null,
      menu_cerrado: i % 5 === 0 ? true : undefined,
      menu_precio: i % 5 === 0 ? 55 : undefined,
      fuera_lugar: i === 4 ? "Terraza Touza" : null,
      estado: i === 4 ? "completada" : r.estado,
    };
  });
  return t;
}

const TAMANOS = [
  { nombre: "375", width: 375, height: 812 },
  { nombre: "414", width: 414, height: 896 },
];

await mkdir(SALIDA, { recursive: true });
const navegador = await chromium.launch();
let fallos = 0;
for (const t of TAMANOS) {
  for (const vista of ["comida", "mesas"]) {
    const context = await navegador.newContext({ viewport: { width: t.width, height: t.height }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await instalarSupabaseFalso(context, { urlSupabase: URL_SUPABASE, tablas: datos(), rpc: rpcSinteticas, funciones: funcionesSinteticas });
    const page = await context.newPage();
    page.on("pageerror", (e) => console.log(`  error JS (${t.nombre}): ${e.message}`));
    await page.goto(`${BASE}/reservas`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.getByTestId("hoy-movil-lista").waitFor({ state: "attached", timeout: 20_000 });
    // Turno: la comida (la de martes a jueves sale por menú del día / carta).
    await page.getByRole("combobox", { name: "Turno" }).click();
    await page.getByRole("option", { name: "Comida" }).click();
    if (vista === "mesas") {
      await page.getByRole("radio", { name: "Mesas" }).click();
      await page.locator("[data-testid='nombre-mesa-movil'], [data-estado]").first().waitFor({ state: "attached", timeout: 20_000 }).catch(() => {});
    }
    await page.waitForTimeout(700);
    const r = await page.evaluate(() => {
      const problemas = [];
      const el = document.scrollingElement;
      if (el.scrollWidth > window.innerWidth + 1) problemas.push(`scroll horizontal (${el.scrollWidth} px)`);
      // La (i) en la misma fila que los botones de cierre.
      const fila = document.querySelector("[data-testid='interruptores-servicios-online']");
      if (fila) {
        const tops = [...fila.children].filter((c) => c.getBoundingClientRect().height > 0).map((c) => Math.round(c.getBoundingClientRect().top));
        if (new Set(tops).size > 1) problemas.push(`la fila de cierre ocupa ${new Set(tops).size} líneas`);
      }
      // Casillas de mesa: nombre y plazas sin solaparse y dentro de la casilla.
      for (const n of document.querySelectorAll("[data-testid='nombre-mesa-movil']")) {
        const casilla = n.closest("button").getBoundingClientRect();
        const a = n.getBoundingClientRect();
        const plazas = n.nextElementSibling?.getBoundingClientRect();
        if (a.right > casilla.right + 0.5) problemas.push(`«${n.textContent}» se sale de la casilla`);
        if (plazas && !(a.right <= plazas.left + 0.5 || a.bottom <= plazas.top + 0.5)) problemas.push(`«${n.textContent}» pisa las plazas`);
      }
      const nombresLista = [...document.querySelectorAll("[data-testid='hoy-movil-lista'] li")].slice(0, 5);
      return { problemas, filas: nombresLista.length };
    });
    console.log(`${t.nombre} ${vista}: ${r.problemas.length ? r.problemas.join(" · ") : "sin solapes"}`);
    fallos += r.problemas.length;
    await page.screenshot({ path: path.join(SALIDA, `${PREFIJO}${t.nombre}-${vista}.png`) });
    await context.close();
  }
}
await navegador.close();
process.exit(fallos ? 1 : 0);
