// Barrido visual de la Fase 3 (11/11/2026): recorre TODAS las pantallas del panel en 7 anchos con el Supabase
// falso (sin cuenta ni datos reales) y, por pantalla y ancho, mide:
//   · desborde horizontal de la página y elementos fuera del viewport (fuera de zonas con scroll propio),
//   · pestañas con el nombre cortado (texto truncado con «…»),
//   · contadores de pestañas ocultos,
//   · objetivos táctiles < 24 px en móvil/tablet (botones, enlaces, pestañas; sin contar los de `touch-hit`),
//   · textos de menos de 12 px,
//   · errores de JavaScript.
// Guarda un JSON con todo y capturas (viewport) en 375, 768 y 1366 px. No entra en `npm test`.
//
//   VITE_SUPABASE_URL=https://e2e-falso.supabase.co VITE_SUPABASE_ANON_KEY=anon-falsa npx vite build --outDir /tmp/dist
//   npx vite preview --outDir /tmp/dist --port 4180 --strictPort --host 127.0.0.1 &
//   node tests/e2e-movil/barrido-fase3.mjs http://127.0.0.1:4180 /tmp/barrido [--anchos 375,1366] [--rutas /dashboard,/facturas]
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { instalarSupabaseFalso } from "./supabase-falso.mjs";
import { tablas, rpcSinteticas, funcionesSinteticas } from "./datos-sinteticos.mjs";

const [base = "http://127.0.0.1:4180", salida = "barrido"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const opcion = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : null; };

export const RUTAS = [
  "/dashboard",
  "/reservas", "/reservas?tab=reservas", "/reservas?tab=calendario", "/reservas?tab=blacklist",
  "/reservas?tab=configuracion", "/reservas?tab=configuracion&sub=servicio", "/reservas?tab=configuracion&sub=mesas",
  "/reservas?tab=configuracion&sub=turnos", "/reservas?tab=configuracion&sub=plantillas",
  "/gestion-web", "/gestion-web?tab=bebidas", "/gestion-web?tab=vinos", "/gestion-web?tab=novedades", "/gestion-web?tab=menus", "/gestion-web?tab=tapas",
  "/marketing", "/rrss", "/cheques", "/tienda",
  "/facturas", "/facturas?tab=margenes", "/facturas?tab=compras", "/facturas?tab=cargar",
  "/albaranes", "/usuarios", "/avisos", "/ayuda",
  "/super-admin", "/super-admin/ecommerce", "/super-admin/asistente-telefonico", "/super-admin/gestor-gasto", "/super-admin/resenas",
  "/super-admin/trafico-web", "/super-admin/logs", "/super-admin/espacios", "/super-admin/bot-web", "/super-admin/usuarios",
  "/super-admin/auditoria", "/super-admin/servicios", "/super-admin/servicios?tab=costes", "/super-admin/informes",
];
const ANCHOS = (opcion("anchos") ?? "320,375,430,768,1024,1366,1920").split(",").map(Number);
const ALTO = { 320: 640, 375: 812, 430: 932, 768: 1024, 1024: 768, 1366: 768, 1920: 1080 };
const CAPTURAS = new Set([375, 768, 1366]);
const rutas = opcion("rutas")?.split(",") ?? RUTAS;
const URL_SUPABASE = process.env.E2E_SUPABASE_URL ?? "https://e2e-falso.supabase.co";

const MEDIR = (ancho) => {
  const vw = document.documentElement.clientWidth;
  const visible = (el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
  const conScroll = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(p).overflowX)) return true; return false; };
  const nombre = (el) => `${el.tagName.toLowerCase()}${el.getAttribute("role") ? `[${el.getAttribute("role")}]` : ""} «${(el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40)}»`;
  const fuera = [];
  for (const el of document.body.querySelectorAll("*")) {
    if (!visible(el) || getComputedStyle(el).position === "fixed") continue;
    const r = el.getBoundingClientRect();
    if ((r.right > vw + 2 || r.left < -2) && !conScroll(el) && !el.closest("[data-radix-popper-content-wrapper],[role=dialog]")) fuera.push(`${nombre(el)} [${Math.round(r.left)}..${Math.round(r.right)}]`);
  }
  // Pestañas con el nombre cortado: algún hijo con text-overflow: ellipsis que no cabe.
  const cortadas = [];
  for (const tab of document.querySelectorAll("[role=tab]")) {
    if (!visible(tab)) continue;
    for (const el of [tab, ...tab.querySelectorAll("*")]) {
      if (getComputedStyle(el).textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1) { cortadas.push(nombre(tab)); break; }
    }
  }
  // Contadores de pestañas ocultos: un número dentro de una pestaña que no se ve (display:none / sr-only no cuenta).
  const contadoresOcultos = [];
  for (const tab of document.querySelectorAll("[role=tab]")) {
    for (const el of tab.querySelectorAll("span")) {
      if (/^\d[\d.]*\+?$/.test(el.textContent.trim()) && getComputedStyle(el).display === "none") contadoresOcultos.push(nombre(tab));
    }
  }
  // Objetivos táctiles pequeños (solo en móvil/tablet): sin `touch-hit` ni pseudo-elemento ampliado.
  const pequenos = [];
  if (ancho <= 1024) {
    for (const el of document.querySelectorAll("button, a[href], [role=tab], [role=switch], [role=checkbox], input[type=checkbox], input[type=radio]")) {
      if (!visible(el) || el.closest("[aria-hidden=true]")) continue;
      const r = el.getBoundingClientRect();
      if (r.height >= 24 && r.width >= 24) continue;
      if (el.className && String(el.className).includes("touch-hit")) continue;
      const antes = getComputedStyle(el, "::before"); if (antes.content && antes.content !== "none" && antes.position === "absolute") continue;
      pequenos.push(`${nombre(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
  }
  // Textos de menos de 12 px (hojas de texto visibles).
  const letraPequena = new Set();
  for (const el of document.body.querySelectorAll("*")) {
    if (el.children.length || !el.textContent.trim() || !visible(el)) continue;
    const t = parseFloat(getComputedStyle(el).fontSize);
    if (t < 12) letraPequena.add(`${Math.round(t * 10) / 10}px «${el.textContent.trim().slice(0, 25)}»`);
  }
  const h1 = document.querySelector("main h1, h1");
  return {
    vw, scrollW: document.documentElement.scrollWidth, fuera: fuera.slice(0, 6), cortadas: [...new Set(cortadas)].slice(0, 6),
    contadoresOcultos: [...new Set(contadoresOcultos)].slice(0, 6), pequenos: pequenos.slice(0, 8), nPequenos: pequenos.length,
    letraPequena: [...letraPequena].slice(0, 6), nLetraPequena: letraPequena.size, titulo: h1 ? h1.textContent.trim().slice(0, 60) : null,
  };
};

mkdirSync(salida, { recursive: true });
const nav = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium" });
const resultados = [];
for (const ancho of ANCHOS) {
  const movil = ancho < 768;
  const ctx = await nav.newContext({ viewport: { width: ancho, height: ALTO[ancho] ?? 900 }, isMobile: movil, hasTouch: ancho <= 1024, locale: "es-ES", reducedMotion: "reduce" });
  await instalarSupabaseFalso(ctx, { urlSupabase: URL_SUPABASE, tablas: tablas(), rpc: rpcSinteticas, funciones: funcionesSinteticas });
  for (const ruta of rutas) {
    const page = await ctx.newPage();
    const errores = [];
    page.on("pageerror", (e) => errores.push(e.message.slice(0, 160)));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|favicon/.test(m.text())) errores.push(`console: ${m.text().slice(0, 160)}`); });
    try {
      await page.goto(base + ruta, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(700);
      const m = await page.evaluate(MEDIR, ancho);
      resultados.push({ ruta, ancho, ...m, errores: [...new Set(errores)].slice(0, 4) });
      if (CAPTURAS.has(ancho)) await page.screenshot({ path: `${salida}/${ruta.replace(/[/?&=]+/g, "_").replace(/^_/, "") || "inicio"}-${ancho}.png` });
      const malo = m.scrollW > m.vw + 1 || m.fuera.length || m.cortadas.length || m.contadoresOcultos.length;
      console.log(`${malo ? "✗" : "✓"} ${ancho} ${ruta}${m.scrollW > m.vw + 1 ? ` desborde ${m.scrollW}` : ""}${m.cortadas.length ? ` cortadas ${m.cortadas.length}` : ""}${m.contadoresOcultos.length ? ` contadores ocultos ${m.contadoresOcultos.length}` : ""}${m.nPequenos ? ` táctiles<24 ${m.nPequenos}` : ""}${errores.length ? ` errores ${errores.length}` : ""}`);
    } catch (e) {
      resultados.push({ ruta, ancho, fallo: String(e).slice(0, 200) });
      console.log(`! ${ancho} ${ruta} ${String(e).slice(0, 120)}`);
    }
    await page.close();
  }
  await ctx.close();
}
await nav.close();
writeFileSync(`${salida}/resultados.json`, JSON.stringify(resultados, null, 1));
console.log(`\n${resultados.length} medidas → ${salida}/resultados.json`);
