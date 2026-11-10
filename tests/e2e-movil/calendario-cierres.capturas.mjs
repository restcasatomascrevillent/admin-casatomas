// Capturas de Reservas › Calendario con días cerrados enteros y días con un solo servicio cerrado, con el Supabase
// falso de esta carpeta: nada sale a Supabase ni a Internet. Comprueba además que ninguna etiqueta de cierre
// («Cerrado», «Sin comida», «Sin cena») sale cortada: el texto tiene que caber en su casilla.
//
//   VITE_SUPABASE_URL=https://e2e-falso.supabase.co VITE_SUPABASE_ANON_KEY=anon-falsa npx vite build
//   npx vite preview --port 4173 --strictPort --host 127.0.0.1 &
//   node tests/e2e-movil/calendario-cierres.capturas.mjs [carpeta-de-capturas]
//
// Cierres simulados: la regla semanal (lunes entero, jueves sin reservas web —el panel lo enseña abierto con
// «Sin reservas web» desde el 10/11/2026— y domingo noche), un sábado sin comida y un martes cerrado a mano. Saca tablet (768×1024, 820×1180 y 1024×768) y escritorio (1280×800 y
// 1440×900); en un teléfono (< 768 px) Reservas solo enseña «Hoy» (07/11/2026) y no hay calendario. No entra en `npm test`; sale con código 1 si alguna etiqueta queda cortada.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { instalarSupabaseFalso } from "./supabase-falso.mjs";
import { tablas, rpcSinteticas, funcionesSinteticas } from "./datos-sinteticos.mjs";
import { serviciosCerradosPorSemana } from "../../supabase/functions/_shared/cierres.ts";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173";
const URL_SUPABASE = process.env.E2E_SUPABASE_URL ?? "https://e2e-falso.supabase.co";
const SALIDA = process.argv[2] ?? "capturas-calendario-cierres";

function cierres({ p_desde, p_hasta }) {
  const semanales = serviciosCerradosPorSemana(p_desde, p_hasta);
  const extra = [];
  const mes = p_desde.slice(0, 8);
  // Un sábado sin comida y un martes entero cerrados a mano (busca el primero de cada uno en el mes).
  for (let d = 1; d <= 28; d++) {
    const f = `${mes}${String(d).padStart(2, "0")}`;
    const dow = new Date(`${f}T12:00:00Z`).getUTCDay();
    if (dow === 6 && !extra.some((c) => c.turno === "comida" && c.motivo === "Evento")) extra.push({ fecha: f, turno: "comida", origen: "manual", motivo: "Evento" });
    if (dow === 2 && !extra.some((c) => c.motivo === "Obras")) {
      extra.push({ fecha: f, turno: "comida", origen: "manual", motivo: "Obras" }, { fecha: f, turno: "cena", origen: "manual", motivo: "Obras" });
    }
  }
  return [...semanales, ...extra];
}

const TAMANOS = [
  { nombre: "tablet-768", width: 768, height: 1024, movil: true },
  { nombre: "tablet-820", width: 820, height: 1180, movil: true },
  { nombre: "tablet-1024", width: 1024, height: 768, movil: true },
  { nombre: "escritorio-1280", width: 1280, height: 800, movil: false },
  { nombre: "escritorio-1440", width: 1440, height: 900, movil: false },
];

await mkdir(SALIDA, { recursive: true });
const navegador = await chromium.launch();
let cortadas = 0;
for (const t of TAMANOS) {
  const context = await navegador.newContext({
    viewport: { width: t.width, height: t.height },
    deviceScaleFactor: 2,
    hasTouch: t.movil,
    isMobile: t.movil,
  });
  await instalarSupabaseFalso(context, {
    urlSupabase: URL_SUPABASE,
    tablas: tablas(),
    rpc: { ...rpcSinteticas, servicios_cerrados_reserva: cierres },
    funciones: funcionesSinteticas,
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log(`  error JS (${t.nombre}): ${e.message}`));
  await page.goto(`${BASE}/reservas?tab=calendario`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByTestId("rejilla-mes").waitFor({ state: "attached", timeout: 20_000 });
  await page.getByTestId("cierre-casilla").first().waitFor({ state: "attached", timeout: 20_000 });
  await page.waitForTimeout(600);
  const problemas = await page.evaluate(() =>
    [...document.querySelectorAll("[data-testid='cierre-casilla']")]
      .filter((e) => getComputedStyle(e).display !== "none")
      .map((e) => {
        const casilla = e.closest("button").getBoundingClientRect();
        const r = e.getBoundingClientRect();
        const fecha = e.closest("button").dataset.fecha;
        if (e.scrollWidth > e.clientWidth + 1 || r.right > casilla.right + 0.5 || r.bottom > casilla.bottom + 0.5) {
          return `${fecha}: «${e.textContent}» se sale de la casilla (${e.scrollWidth}px en ${e.clientWidth}px)`;
        }
        if (e.getBoundingClientRect().height < parseFloat(getComputedStyle(e).fontSize) * 0.95) {
          return `${fecha}: «${e.textContent}» aplastada (${r.height.toFixed(1)}px de alto)`;
        }
        // La cifra de comensales no puede montarse encima de la etiqueta.
        const cifra = e.closest("button").querySelector("[data-testid='comensales-casilla']");
        if (cifra) {
          const c = cifra.getBoundingClientRect();
          // Caja de la tinta de la cifra (sin el interlineado): ~80 % centrado.
          const tintaArriba = c.top + c.height * 0.1;
          if (tintaArriba < r.bottom - 0.5) return `${fecha}: la cifra ${cifra.textContent} pisa «${e.textContent}»`;
        }
        // Nada de la casilla (cifra, «N res.», barras, %) puede quedar cortado por abajo.
        for (const hijo of e.closest("button").querySelectorAll("[data-testid]")) {
          const h = hijo.getBoundingClientRect();
          if (h.height > 0 && getComputedStyle(hijo).display !== "none" && h.bottom > casilla.bottom - 1) {
            return `${fecha}: «${hijo.textContent}» (${hijo.dataset.testid}) queda cortado abajo`;
          }
        }
        return null;
      })
      .filter(Boolean),
  );
  if (problemas.length) {
    cortadas += problemas.length;
    console.log(`✗ ${t.nombre}: ${problemas.length} etiquetas cortadas\n  ${problemas.join("\n  ")}`);
  } else console.log(`✓ ${t.nombre}: ninguna etiqueta de cierre cortada`);
  await page.getByTestId("tarjeta-mes").screenshot({ path: path.join(SALIDA, `calendario-${t.nombre}.png`) });
  await context.close();
}
await navegador.close();
process.exit(cortadas ? 1 : 0);
