// Desbordes y solapes en móvil: recorre las pantallas del panel con un Supabase falso (supabase-falso.mjs) y comprueba
// que ninguna se sale por los lados, que los textos no se pisan y que los casos conocidos de la auditoría móvil siguen
// (o dejan de estar) rotos. Los defectos conocidos van con `test.fail`: cuando se arreglen, la prueba "falla" y avisa
// de que hay que quitar la marca.
import { test, expect } from "@playwright/test";
import { instalarSupabaseFalso } from "./supabase-falso.mjs";
import { tablas, rpcSinteticas, funcionesSinteticas } from "./datos-sinteticos.mjs";

// Marca un defecto conocido. Con E2E_SIN_MARCAS=1 se quitan las marcas para ver el fallo real de cada uno.
const conocido = (motivo) => { if (!process.env.E2E_SIN_MARCAS) test.fail(true, motivo); };

const URL_SUPABASE = process.env.E2E_SUPABASE_URL ?? "https://e2e-falso.supabase.co";

const RUTAS = [
  "/dashboard", "/reservas", "/reservas?tab=reservas", "/reservas?tab=calendario", "/reservas?tab=asignacion", "/reservas?tab=blacklist", "/reservas?tab=configuracion",
  "/gestion-web", "/gestion-web?tab=novedades", "/gestion-web?tab=menus", "/gestion-web?tab=tapas", "/marketing", "/cheques", "/facturas", "/facturas?tab=cargar", "/usuarios", "/ayuda",
  "/super-admin", "/super-admin/ecommerce", "/super-admin/asistente-telefonico", "/super-admin/gestor-gasto", "/super-admin/costes", "/super-admin/resenas",
  "/super-admin/plantillas-email", "/super-admin/trafico-web", "/super-admin/espacios", "/super-admin/bot-web", "/super-admin/usuarios", "/super-admin/auditoria",
];

test.beforeEach(async ({ context }) => {
  await instalarSupabaseFalso(context, { urlSupabase: URL_SUPABASE, tablas: tablas(), rpc: rpcSinteticas, funciones: funcionesSinteticas });
});

async function abrir(page, ruta) {
  const errores = [];
  page.on("pageerror", (e) => errores.push(e.message));
  await page.goto(ruta, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(900);
  return errores;
}

/** Elementos que se salen por los lados del viewport y no están dentro de una zona con scroll propio. */
const DESBORDES = () => {
  const vw = document.documentElement.clientWidth;
  const conScroll = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(p).overflowX)) return true; return false; };
  const fuera = [];
  for (const el of document.body.querySelectorAll("*")) {
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || cs.visibility === "hidden" || cs.display === "none" || cs.position === "fixed") continue;
    if ((r.right > vw + 2 || r.left < -2) && !conScroll(el) && !el.closest("[data-radix-popper-content-wrapper],[role=dialog]")) fuera.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 2).join(".")} [${Math.round(r.left)}..${Math.round(r.right)}]`);
  }
  return { vw, scrollW: document.documentElement.scrollWidth, fuera: fuera.slice(0, 5) };
};

for (const ruta of RUTAS) {
  test(`sin desborde horizontal · ${ruta}`, async ({ page }) => {
    const errores = await abrir(page, ruta);
    const r = await page.evaluate(DESBORDES);
    expect(r.scrollW, `la página mide ${r.scrollW}px en un viewport de ${r.vw}px`).toBeLessThanOrEqual(r.vw + 1);
    expect(r.fuera, "elementos fuera del viewport").toEqual([]);
    expect(errores, "errores de JavaScript").toEqual([]);
  });
}

// ───────── Defectos conocidos de la auditoría móvil (test.fail = «sigue roto»; si pasa, quita la marca) ─────────

test("Calendario de ocupación: la cifra de comensales no pisa el número del día", async ({ page }) => {
  conocido("P-01: casilla de ~46 px con número de día y cifra de 2-3 dígitos en la misma fila (CasillaOcupacion.tsx)");
  await abrir(page, "/reservas?tab=calendario");
  const pisados = await page.evaluate(() => {
    const out = [];
    for (const celda of document.querySelectorAll("button[aria-label*='comensal']")) {
      const hojas = [...celda.querySelectorAll("span")].filter((s) => s.children.length === 0 && s.textContent.trim() && /^\d+$/.test(s.textContent.trim()));
      for (let i = 0; i < hojas.length; i++) for (let j = i + 1; j < hojas.length; j++) {
        const a = hojas[i].getBoundingClientRect(), b = hojas[j].getBoundingClientRect();
        const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left), iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ix > 2 && iy > 2) out.push(`${hojas[i].textContent.trim()} / ${hojas[j].textContent.trim()}`);
      }
    }
    return out;
  });
  expect(pisados, "pares de cifras que se solapan en las casillas").toEqual([]);
});

test("Facturas › Cargar: la línea «Lectura de facturas este mes» cabe en pantalla", async ({ page }) => {
  conocido("P-03: el contenedor `shrink-0 self-end` crece más que la pantalla y se sale por la izquierda (Facturas.tsx)");
  await abrir(page, "/facturas?tab=cargar");
  const caja = await page.getByTestId("monitor-gasto-ia-ocr").boundingBox();
  expect(caja, "no se pintó el monitor de gasto").not.toBeNull();
  expect(caja.x, "el botón empieza fuera de la pantalla por la izquierda").toBeGreaterThanOrEqual(0);
});

test("Costes: la frase de cabecera no queda aplastada en una columna estrecha", async ({ page }) => {
  conocido("P-02: `p.flex-1` con basis 0 junto a dos botones `shrink-0` en una fila `flex-wrap` (Costes.tsx)");
  await abrir(page, "/super-admin/costes");
  const ancho = await page.evaluate(() => { const p = [...document.querySelectorAll("main p")].find((x) => /Lo que cuesta mantener/.test(x.textContent ?? "")); return p ? p.getBoundingClientRect().width : -1; });
  expect(ancho, "ancho del párrafo de cabecera").toBeGreaterThan(200);
});
