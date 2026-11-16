// Capturas de Facturas › Márgenes › Coste vinos en móvil, tablet (vertical y apaisada) y escritorio
// (16/11/2026). Mide el desborde horizontal y el scroll vertical de PÁGINA (regla del dueño: solo las
// listas hacen scroll) y sale con código 1 si alguna vista falla.
//
//   node tests/e2e-movil/coste-vinos.capturas.mjs <url> [carpeta] [datos.json]
//
// <url>: el panel servido con VITE_SUPABASE_URL=https://e2e-falso.supabase.co (vite o vite preview).
// [datos.json]: opcional, { coste, margenes, cand } con la salida real de vinos_coste_carta,
// margenes_carta y vinos_coste_candidatos (p. ej. de la demo); sin él, datos sintéticos.
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { instalarSupabaseFalso } from "./supabase-falso.mjs";
import { tablas, rpcSinteticas, funcionesSinteticas } from "./datos-sinteticos.mjs";

const BASE = process.argv[2] ?? "http://localhost:4173";
const SALIDA = process.argv[3] ?? "test-results/coste-vinos";
const REALES = process.argv[4] ? JSON.parse(readFileSync(process.argv[4], "utf8")) : null;
const URL_SUPABASE = process.env.E2E_SUPABASE_URL ?? "https://e2e-falso.supabase.co";

const fac = (i) => ({ id: 900 + i, linea_id: 9000 + i, fecha: "2026-09-30", proveedor: `SIM DISTRIBUCIONES DE VINOS CON NOMBRE LARGO ${i + 1}, S.L.`, numero_documento: `F-${i}`, tipo: "factura",
  local: "casa_tomas", total: 1200, drive_url: null, archivo_path: null, nombre_linea: `VINO SIM ${2019 + (i % 5)}`, cantidad: 30, unidad: "botella", unidad_compra: i % 5 === 4 ? "caja" : "botella",
  importe: 579, precio_unidad: 19.3, medida: "l", eur_base: 25.73, iva_pct: 21, iva_origen: "linea" });
const ESTADOS = ["bajo", "bien", "sin_enlazar", "dudoso", "revisar", "sin_compra", "bajo", "bien"];
const vinoSim = (i) => {
  const estado = ESTADOS[i % ESTADOS.length];
  const conCoste = !["sin_enlazar", "sin_compra"].includes(estado);
  const precio = 24.5 + i * 7;
  const coste = estado === "dudoso" ? precio * 1.4 : estado === "bien" ? precio / 1.1 / 2.6 : precio / 1.1 / 1.8;
  return {
    id: `v${i}`, nombre: `Bodega SIM Gran Reserva Viñas Viejas de Parcela ${2015 + (i % 8)}${i % 7 === 4 ? " (Magnum)" : ""}`,
    categoria: i % 2 ? "VINOS TINTOS — RIBERA DEL DUERO" : "VINOS BLANCOS — RÍAS BAIXAS", precio, venta: precio / 1.1,
    producto_id: estado === "sin_enlazar" ? null : 600 + i, producto: estado === "sin_enlazar" ? null : `Vino SIM Gran Reserva ${i} 75 cl`, origen: "estimado",
    litros: i % 7 === 4 ? 1.5 : 0.75, litros_producto: 0.75,
    coste_factura: conCoste ? coste * (i % 3 === 0 ? 1.2 : 1) : null, coste_efectivo: conCoste ? coste : null,
    botellas_pagadas: conCoste ? 30 : null, botellas_sin_cargo: conCoste && i % 3 === 0 ? 6 : 0, importe_pagado: conCoste ? coste * 36 : null, facturas: conCoste ? 1 : null,
    factura: conCoste ? fac(i) : null,
    multiplicador: conCoste && estado !== "revisar" ? Math.round((precio / 1.1 / coste) * 100) / 100 : null,
    margen: conCoste && estado !== "revisar" ? precio / 1.1 - coste : null, margen_pct: conCoste && estado !== "revisar" ? (1 - coste / (precio / 1.1)) * 100 : null,
    estado, avisos: estado === "dudoso" ? ["coste_mayor_que_carta", "coste_por_caja"] : estado === "revisar" ? ["formato_distinto"] : i % 4 === 1 ? ["anada_distinta"] : [],
    anada_carta: 2019, anada_compra: 2021, precio_sugerido: estado === "bajo" ? Math.ceil(coste * 2.3 * 1.1 * 2) / 2 : null,
    copeo: i % 2 === 1, precio_copa: i % 2 === 1 ? 6.5 : null,
    copa: i % 2 === 1 && (estado === "bien" || estado === "bajo") ? { venta: 5.91, coste: coste / 6, multiplicador: 2.1, margen: 5.91 - coste / 6, margen_pct: 60 } : null,
    mejor_candidato: estado === "sin_enlazar" ? { id: 7000 + i, nombre: `Vino SIM parecido de nombre largo ${i} 75 cl`, similitud: 0.82 } : null,
  };
};
const costeSim = () => {
  const vinos = Array.from({ length: 40 }, (_, i) => vinoSim(i));
  const n = (e) => vinos.filter((v) => v.estado === e).length;
  return {
    hoy: "2026-11-09", meses: null, copas_por_botella: 6, config: { multiplicador_min_vino: 2.3, iva_pct: 10 },
    resumen: { total: vinos.length, con_coste: n("bien") + n("bajo"), sin_coste: n("sin_enlazar") + n("sin_compra"), sin_enlazar: n("sin_enlazar"), sin_compra: n("sin_compra"), sin_precio: 0,
      dudosos: n("dudoso"), revisar: n("revisar"), anada_distinta: 10, por_debajo: n("bajo"), con_sin_cargo: 9, con_candidato: n("sin_enlazar"), multiplicador_mediana: 1.92 },
    vinos,
  };
};
const candSim = () => Array.from({ length: 5 }, (_, i) => ({ id: 7000 + i, nombre: `Vino SIM parecido de nombre bastante largo ${i} 75 cl`, categoria: "Vinos", similitud: 0.95 - i * 0.1, lineas: 3 - (i % 3),
  ultima: "2026-09-30", litros: i === 2 ? 1.5 : 0.75, formato_distinto: i === 2, coste_botella: 18.4 + i * 9, factura: fac(i), dudoso: i === 3, enlazado_a: i === 1 ? ["Otro vino SIM de la carta 2020"] : null }));
const margenesSim = () => ({ hoy: "2026-11-09", config: { coste_max_plato_pct: 35, multiplicador_min_vino: 2.3, multiplicador_min_tienda: 1.5, multiplicador_min_peso: 2, subida_coste_pct: 10, iva_pct: 10, iva_tienda_pct: 21, dias_referencia: 90 },
  tienda: { activa: true, descuento_pct: 30 }, resumen: { platos: {}, vinos: {} }, platos: [], vinos: [], peso: [] });

const TAMANOS = [
  { nombre: "movil", width: 375, height: 812, movil: true },
  { nombre: "tablet-vertical", width: 768, height: 1024, movil: true },
  { nombre: "tablet-apaisada", width: 1180, height: 820, movil: true },
  { nombre: "escritorio", width: 1440, height: 900, movil: false },
];

const medir = (page) => page.evaluate(() => {
  const ancho = document.documentElement.clientWidth;
  const fuera = [];
  for (const el of document.querySelectorAll("main *, [role=dialog] *")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > ancho + 1 || r.left < -1) {
      let p = el.parentElement, recortado = false;
      while (p && p !== document.body) {
        const s = getComputedStyle(p);
        if (["auto", "scroll", "hidden", "clip"].includes(s.overflowX)) { const pr = p.getBoundingClientRect(); if (pr.right <= ancho + 1 && pr.left >= -1) { recortado = true; break; } }
        p = p.parentElement;
      }
      if (!recortado) fuera.push(`${el.tagName.toLowerCase()} ${Math.round(r.left)}→${Math.round(r.right)} «${(el.textContent ?? "").trim().slice(0, 40)}»`);
    }
  }
  const lista = document.querySelector('[data-testid="coste-vinos-lista"]');
  return {
    paginaX: document.scrollingElement.scrollWidth - ancho,
    paginaY: document.scrollingElement.scrollHeight - document.documentElement.clientHeight,
    fuera: fuera.slice(0, 8),
    lista: lista ? { alto: lista.clientHeight, contenido: lista.scrollHeight, filas: lista.children.length } : null,
  };
});

mkdirSync(SALIDA, { recursive: true });
const navegador = await chromium.launch();
const resultados = [];
try {
  for (const t of TAMANOS) {
    const contexto = await navegador.newContext({ viewport: { width: t.width, height: t.height }, isMobile: t.movil, hasTouch: t.movil, deviceScaleFactor: 1, locale: "es-ES", timezoneId: "Europe/Madrid", reducedMotion: "reduce" });
    await instalarSupabaseFalso(contexto, {
      urlSupabase: URL_SUPABASE, tablas: tablas(),
      rpc: { ...rpcSinteticas, margenes_carta: () => REALES?.margenes ?? margenesSim(), vinos_coste_carta: () => REALES?.coste ?? costeSim(),
        vinos_coste_candidatos: () => REALES?.cand ?? candSim(), margenes_buscar_productos: () => [] },
      funciones: funcionesSinteticas,
    });
    const page = await contexto.newPage();
    const errores = [];
    page.on("pageerror", (e) => errores.push(e.message));
    const captura = async (pantalla, archivo) => {
      await page.screenshot({ path: path.join(SALIDA, archivo) });
      resultados.push({ tamano: t.nombre, pantalla, archivo, ...(await medir(page)) });
    };

    await page.goto(`${BASE}/facturas?tab=margenes`, { waitUntil: "domcontentloaded" });
    await page.getByRole("radio", { name: "Coste de la carta de vinos" }).click({ timeout: 30_000 });
    await page.getByTestId("coste-vinos-lista").waitFor({ timeout: 30_000 });
    await page.waitForTimeout(600);
    await captura("Coste vinos", `coste-vinos-${t.nombre}.png`);

    await page.getByLabel("Estado").selectOption("bajo");
    await page.waitForTimeout(300);
    await captura("Coste vinos · por debajo", `coste-vinos-bajo-${t.nombre}.png`);

    await page.getByLabel("Estado").selectOption("sin_enlazar");
    await page.waitForTimeout(300);
    await captura("Coste vinos · sin enlazar", `coste-vinos-sin-enlazar-${t.nombre}.png`);

    const enlazar = page.getByTestId("coste-vinos-lista").getByRole("button", { name: /^Enlazar / }).first();
    if (await enlazar.count()) {
      await enlazar.click();
      await page.getByRole("dialog").waitFor({ timeout: 10_000 });
      await page.waitForTimeout(500);
      await captura("Coste vinos · enlazar", `coste-vinos-enlazar-${t.nombre}.png`);
    }
    if (errores.length) resultados.push({ tamano: t.nombre, errores });
    await contexto.close();
  }
} finally {
  await navegador.close();
}
writeFileSync(path.join(SALIDA, "resultados.json"), JSON.stringify(resultados, null, 2));
for (const r of resultados) {
  console.log(r.tamano, "|", r.pantalla ?? "errores", "| desborde X:", r.paginaX, "| scroll de página Y:", r.paginaY, "| lista:", JSON.stringify(r.lista ?? null), "|", (r.fuera ?? r.errores ?? []).join(" ; "));
}
const malos = resultados.filter((r) => r.errores?.length || r.paginaX > 0 || r.paginaY > 0 || r.fuera?.length || (r.lista && r.tamano !== "movil" && r.tamano !== "tablet-vertical" && r.lista.alto < 250));
process.exit(malos.length ? 1 : 0);
