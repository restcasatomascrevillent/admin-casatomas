// Capturas de Facturas › Análisis y Márgenes en móvil (375×812) y escritorio (1440×900), con datos sintéticos
// (12/11/2026). Mide el desborde horizontal de cada vista y sale con código 1 si alguna desborda en móvil.
//
//   node tests/e2e-movil/facturas-movil.capturas.mjs <url> [carpeta]
//
// <url>: el panel servido con VITE_SUPABASE_URL=https://e2e-falso.supabase.co (vite o vite preview).
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { instalarSupabaseFalso } from "./supabase-falso.mjs";
import { tablas, rpcSinteticas, funcionesSinteticas } from "./datos-sinteticos.mjs";

const BASE = process.argv[2] ?? "http://localhost:4173";
const SALIDA = process.argv[3] ?? "test-results/facturas-movil";
const URL_SUPABASE = process.env.E2E_SUPABASE_URL ?? "https://e2e-falso.supabase.co";

const MESES = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"];
const prov = (i) => ({ id: 300 + i, nombre: `SIM PROVEEDOR CON UN NOMBRE BASTANTE LARGO ${i + 1}, S.L.`, gasto: 90000 - i * 7000, pct: 9 - i * 0.5, documentos: 30 - i });

const tablero = (a) => ({
  periodo: { desde: a.p_desde ?? null, hasta: a.p_hasta ?? null, hasta_efectivo: "2026-11-05", local: a.p_local ?? null, anterior: { desde: "2025-01-01", hasta: "2025-11-05" } },
  sin_datos: false,
  indicadores: {
    gasto: 1362491.57, gasto_anterior: 1200000, documentos_anterior: 1700, variacion_pct: 13.5, documentos: 1884, facturas: 1844,
    albaranes_sin_factura: 40, albaranes_sin_factura_importe: 14915.34, sin_total: 3, abonos: -14376.94, abonos_n: 43,
    regalado: 28204.41, regalado_valia: 107581.24, regalado_lineas: 861, regalado_estimadas: 69, regalado_estimado_importe: 6231.06, proveedores: 245,
  },
  meses: MESES.map((mes, i) => ({ mes, casa_tomas: 120000 + i * 3000, touza: i % 3 === 0 ? 0 : 2500 + i * 100, total: 122500 + i * 3100, documentos: 160 + i })),
  proveedores: Array.from({ length: 10 }, (_, i) => prov(i)),
  subidas: { tramo_inicio: null, tramo_fin: null, comparados: 0, productos: [] },
  familias: {
    importe_total: 1200548.07, lineas: 12321, sin_clasificar: { lineas: 10396, importe: 1019048.6 },
    familias: Array.from({ length: 8 }, (_, i) => ({ id: i + 1, familia: `Familia SIM ${i + 1}`, importe: 81614.84 - i * 5000, lineas: 459 - i * 20 })),
  },
  fijos: {
    ventana: { desde: "2026-01-01", hasta: "2026-11-05", meses_con_datos: 11 }, total_medio_mes: 14400,
    proveedores: Array.from({ length: 12 }, (_, i) => ({ id: 398 + i, nombre: `SIM SUMINISTRO ${i + 1}, S.L.U.`, medio_mes: 3611.03 - i * 200, meses: 11, meses_con_datos: 11, documentos: 11 })),
  },
  abonos: Array.from({ length: 10 }, (_, i) => ({ id: 377 + i, nombre: `SIM DISTRIBUCIONES ${i + 1}, S.L.`, importe: -5716.71 + i * 500, documentos: 5 })),
  locales: { casa_tomas: { gasto: 1333190.24, documentos: 1857 }, touza: { gasto: 29301.33, documentos: 27 }, meses: [] },
});

const alerta = (id, tipo, datos, extra = {}) => ({ id, tipo, prioridad: "normal", titulo: `${datos.producto ?? "Aviso"}`, mensaje: "x", datos, ...extra });
const decision = (a) => ({
  periodo: { desde: a.p_desde ?? "2026-01-01", hasta: a.p_hasta ?? "2026-12-31", en_curso: true, meses_equivalentes: 10.2, meses_incompletos: ["2026-11"],
    comparado: { modo: "ultimo_mes", desde: "2026-09-01", hasta: "2026-09-30" } },
  referencia: { meses: ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"], desde: "2026-03-01", hasta: "2026-08-31" },
  resumen: { gasto: 1362491.57, documentos: 1884, base: 115168, base_referencia: 132000 },
  familias: Array.from({ length: 14 }, (_, i) => ({ id: i + 1, familia: `Familia SIM ${i + 1}`, importe: 30000 - i * 1500, media_mes: 25000 - i * 1500, referencia: 25000 - i * 1500, variacion_pct: 20 - i * 3, aviso: i < 2, alerta: null })),
  cambios: {
    sube: Array.from({ length: 14 }, (_, i) => ({ ...alerta(`s${i}`, "facturas_precio_sube", { producto: `PRODUCTO SUBE CON NOMBRE LARGO ${i + 1}`, proveedor: prov(i % 10).nombre, proveedor_id: 300 + (i % 10), precio: 14 + i, precio_ref: 11 + i, variacion_pct: 25 - i, medida: "kg", unidad: "kg", fecha: "2026-10-03", impacto_mes: 80 - i * 4, factura_id: 7 }), campana: true, impacto_mes: 80 - i * 4, doc: { id: 7, fecha: "2026-10-03", proveedor: "SIM", numero: "1", tipo: "factura", local: "casa_tomas", total: 900 } })),
    baja: [], proveedor: [], pactado: [], familia: [],
    mejor: Array.from({ length: 9 }, (_, i) => ({ ...alerta(`m${i}`, "facturas_precio_mejor", { producto: `BERBERECHO SIM ${i + 1}`, proveedor: "Cetárea SIM", proveedor_otro: "Casimiro SIM", precio: 35.5, precio_otro: 29, ahorro: 117 - i * 5, medida: "kg" }), doc: { id: 8, total: 100 }, doc_otro: { id: 9, total: 90 } })),
    otros: Array.from({ length: 8 }, (_, i) => alerta(`o${i}`, "facturas_proveedor_nuevo", {}, { titulo: `Proveedor nuevo SIM ${i + 1}`, mensaje: "Primer documento el 10/10. Revisa sus datos." })),
  },
  top: Array.from({ length: 6 }, (_, i) => ({ clave: `c:${i}`, producto: `TOP SIM ${i + 1}`, producto_id: i, unidad: "kg", importe_90: 9000 - i * 500, proveedor_id: 300 + i, proveedor: prov(i).nombre, nombre_normalizado: `top sim ${i}`, linea: `TOP SIM ${i + 1}`,
    meses: ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"].map((mes, k) => ({ mes, precio: 10 + k * 0.4 + i })), alertas: [], pactado: null })),
  revisar_unidades: [],
  top_desde: "2026-05-01",
  umbrales: { familia_pct: 25, campana_impacto_min_eur: 10, silencio_dias: 90 },
});

const explorar = (a) => {
  const tiempo = ["dia", "semana", "mes", "trimestre"].includes(String(a.p_agrupar));
  const local = a.p_desglose === "local";
  return {
    parametros: { desde: a.p_desde, hasta: a.p_hasta, hasta_efectivo: "2026-11-05", medida: a.p_medida, agrupar: a.p_agrupar, desglose: a.p_desglose, por_lineas: false, solo_productos: false, unidad: null },
    sin_datos: false,
    total: { valor: 1362491.57, documentos: 1884, lineas: null, variacion_pct: 13.5 },
    anterior: { desde: "2025-01-01", hasta: "2025-11-05", valor: 1200000, documentos: 1700 },
    unidades: null,
    series: local ? [{ clave: "casa_tomas", etiqueta: "Casa Tomás", id: null, valor: 1333190.24 }, { clave: "touza", etiqueta: "Touza", id: null, valor: 29301.33 }] : [],
    puntos: tiempo
      ? MESES.map((mes, i) => ({ clave: mes, etiqueta: mes, id: null, valor: a.p_medida === "precio" ? 12 + i * 0.3 : 122500 + i * 3100, documentos: 160 + i, desglose: local ? { casa_tomas: 120000 + i * 3000, ...(i % 3 ? { touza: 2500 } : {}) } : null }))
      : Array.from({ length: 10 }, (_, i) => ({ clave: String(300 + i), etiqueta: prov(i).nombre, id: 300 + i, valor: prov(i).gasto, documentos: 3, desglose: null })),
    resto: tiempo ? null : { entidades: 4, valor: 18000, documentos: 12 },
  };
};

const ing = (i) => ({ id: i, producto_id: 500 + i, producto: `INGREDIENTE SIM CON NOMBRE ${i}`, cantidad: 120 + i * 10, unidad: "g", origen: "estimado", nota: null, eur: 18.4 + i, eur_6m: 17.9 + i, medida: "kg", unidad_compra: "kg", coste: 2.2 + i * 0.3, coste_6m: 2.1 + i * 0.3, lineas: 6, ultima: "2026-10-20", iva_pct: 10, iva_origen: "linea", eur_iva: 20.2 + i, coste_iva: 2.4 + i * 0.3 });
const margenes = () => ({
  hoy: "2026-11-09",
  config: { coste_max_plato_pct: 35, multiplicador_min_vino: 2.3, multiplicador_min_tienda: 1.5, multiplicador_min_peso: 2, subida_coste_pct: 10, iva_pct: 10, iva_tienda_pct: 21, dias_referencia: 90 },
  tienda: { activa: true, descuento_pct: 30 },
  resumen: {
    platos: { total: 84, con_datos: 61, food_cost_medio: 31.4, food_cost_mediana: 29.8, en_rojo: 12, sube_coste: 7, sin_datos: 23, revisados: 18 },
    vinos: { total: 212, con_datos: 180, multiplicador_medio: 2.6, multiplicador_mediana: 2.5, en_rojo: 34, sube_coste: 9, sin_datos: 32, revisados: 40, en_tienda: 150, multiplicador_tienda_mediana: 1.7, tienda_en_rojo: 21 },
  },
  platos: Array.from({ length: 14 }, (_, i) => ({
    id: `p${i}`, nombre: `Chuletón de vaca madurada a la brasa con guarnición SIM ${i + 1}`, categoria: i % 2 ? "Carnes" : "Entrantes para compartir", precio: 24.5 + i, unidad: null, gramos_venta: null,
    venta: 22.27 + i, coste: 7.1 + i * 0.6, coste_6m: 6.5 + i * 0.5, coste_iva: 7.8 + i * 0.6, iva_supuesto: i % 4 === 0, pct: 31 + i * 1.5, margen: 15.2 - i * 0.2, variacion_pct: i % 3 ? 12.5 : -3.1,
    principal: `INGREDIENTE PRINCIPAL SIM ${i}`, principal_coste: 5.2, origen: i % 2 ? "manual" : "estimado", revisado: i % 5 === 0, motivo: null,
    banderas: i % 3 === 0 ? ["coste_alto", "sube_coste"] : i % 3 === 1 ? ["incompleto"] : [], ingredientes: [ing(1), ing(2), ing(3)],
  })),
  vinos: Array.from({ length: 14 }, (_, i) => ({
    id: `v${i}`, nombre: `Bodega SIM Gran Reserva Viñas Viejas ${2015 + (i % 8)}`, categoria: i % 2 ? "Tintos D.O. Ribera del Duero" : "Blancos", precio: 32 + i * 3, precio_copa: i % 2 ? 6.5 : null, venta: 29.09 + i * 2.7,
    producto_id: 600 + i, producto: `VINO SIM GRAN RESERVA ${i} 75CL`, litros: 0.75, litros_producto: 0.75, formato_distinto: i === 3, coste: 11.2 + i, coste_6m: 10.8 + i, coste_iva: 13.55 + i,
    iva_compra_pct: 21, iva_origen: "linea", multiplicador: 2.6 - i * 0.05, pct: 38 + i, margen: 17.9 + i, en_tienda: i % 2 === 0, precio_tienda: 22.4 + i * 2, venta_tienda: 18.5 + i * 1.6,
    multiplicador_tienda: 1.65 - i * 0.03, pct_tienda: 60, margen_tienda: 7.3, variacion_pct: i % 4 ? 4.2 : 15.3, lineas: 4, ultima: "2026-10-12", origen: "estimado", nota: null, revisado: false, motivo: null,
    banderas: i % 3 === 0 ? ["multiplicador_bajo", "tienda_bajo"] : [],
  })),
  peso: Array.from({ length: 8 }, (_, i) => ({
    id: `k${i}`, nombre: `Jamón ibérico de bellota cortado a cuchillo SIM ${i + 1}`, categoria: "Ibéricos", precio: 14 + i, unidad: "100 g", gramos_venta: 100, venta_kg_iva: 140 + i * 10, venta_kg: 127.3 + i * 9,
    producto_id: 700 + i, producto: `PALETA IBÉRICA SIM ${i}`, compra_kg: 48.2 + i, compra_kg_6m: 46 + i, compra_kg_iva: 53 + i, iva_compra_pct: 10, iva_origen: "factura", lineas: 3,
    ultimo_proveedor: prov(i).nombre, ultima_fecha: "2026-10-30", multiplicador: 2.64 - i * 0.1, pct: 37.9 + i, variacion_pct: 2.1, origen: "estimado", revisado: false, motivo: null,
    banderas: i % 2 ? ["multiplicador_bajo"] : [],
  })),
});

const TAMANOS = [
  { nombre: "movil", width: 375, height: 812, movil: true },
  { nombre: "escritorio", width: 1440, height: 900, movil: false },
];

const desborde = (page) => page.evaluate(() => {
  const ancho = document.documentElement.clientWidth;
  const fuera = [];
  for (const el of document.querySelectorAll("main *")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > ancho + 1 || r.left < -1) {
      // ¿Lo recorta un contenedor con scroll horizontal propio? Entonces no cuenta.
      let p = el.parentElement, recortado = false;
      while (p && p !== document.body) {
        const s = getComputedStyle(p);
        if (["auto", "scroll", "hidden", "clip"].includes(s.overflowX)) { const pr = p.getBoundingClientRect(); if (pr.right <= ancho + 1 && pr.left >= -1) { recortado = true; break; } }
        p = p.parentElement;
      }
      if (!recortado) fuera.push(`${el.tagName.toLowerCase()}${el.getAttribute("data-testid") ? `[${el.getAttribute("data-testid")}]` : ""} ${Math.round(r.left)}→${Math.round(r.right)} «${(el.textContent ?? "").trim().slice(0, 40)}»`);
    }
  }
  return { paginaX: document.scrollingElement.scrollWidth - ancho, fuera: fuera.slice(0, 8) };
});

/** En móvil, además, baja por el contenedor con scroll más alto y saca una captura por tramo. */
async function tramos(page, base, t) {
  if (!t.movil || process.env.SIN_TRAMOS) return;
  for (let i = 1; i <= 6; i++) {
    const siguio = await page.evaluate(() => {
      const cajas = [...document.querySelectorAll("main *")].filter((el) => { const s = getComputedStyle(el).overflowY; return (s === "auto" || s === "scroll") && el.scrollHeight > el.clientHeight + 4 && el.clientHeight > 200; });
      cajas.sort((a, b) => b.scrollHeight - a.scrollHeight);
      const c = cajas[0] ?? document.scrollingElement;
      const antes = c.scrollTop;
      c.scrollTop = antes + c.clientHeight - 80;
      return c.scrollTop > antes;
    });
    if (!siguio) break;
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(SALIDA, base.replace(".png", `-t${i}.png`)) });
  }
}

const VISTAS = ["Qué decidir hoy", "Precios", "Ahorro", "Gasto", "Proveedores", "Por revisar"];

mkdirSync(SALIDA, { recursive: true });
const navegador = await chromium.launch();
const resultados = [];
try {
  for (const t of TAMANOS) {
    const contexto = await navegador.newContext({ viewport: { width: t.width, height: t.height }, isMobile: t.movil, hasTouch: t.movil, deviceScaleFactor: 1, locale: "es-ES", timezoneId: "Europe/Madrid", reducedMotion: "reduce" });
    await contexto.addInitScript(() => {
      const fija = new Date("2026-11-09T12:00:00+01:00").valueOf();
      const DateReal = Date;
      Date = class extends DateReal { constructor(...a) { super(...(a.length ? a : [fija])); } static now() { return fija; } };
    });
    await instalarSupabaseFalso(contexto, {
      urlSupabase: URL_SUPABASE, tablas: tablas(),
      rpc: { ...rpcSinteticas, tablero_compras: tablero, facturas_decision: decision, explorar_compras: explorar, margenes_carta: margenes,
        documentos_de_cifra: () => ({ cifra: 0, documentos: 0, importe_total: 0, desplazamiento: 0, filas: [] }) },
      funciones: funcionesSinteticas,
    });
    const page = await contexto.newPage();
    const errores = [];
    page.on("pageerror", (e) => errores.push(e.message));

    await page.goto(`${BASE}/facturas?tab=chat`, { waitUntil: "domcontentloaded" });
    const tableroEl = page.getByTestId("tablero-analisis");
    await tableroEl.waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1200);
    for (const nombre of VISTAS) {
      const boton = tableroEl.getByRole("group", { name: "Vista del análisis" }).getByRole("button", { name: nombre, exact: true });
      if (await boton.count()) { await boton.click(); await page.waitForTimeout(500); }
      const archivo = `analisis-${nombre.replace(/\s/g, "-")}-${t.nombre}.png`;
      await page.screenshot({ path: path.join(SALIDA, archivo) });
      resultados.push({ tamano: t.nombre, pantalla: `Análisis · ${nombre}`, archivo, ...(await desborde(page)) });
      await tramos(page, archivo, t);
    }

    await page.goto(`${BASE}/facturas?tab=margenes`, { waitUntil: "domcontentloaded" });
    await page.getByText(/Chuletón|Bodega SIM|Jamón/).first().waitFor({ timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(1200);
    let archivo = `margenes-${t.nombre}.png`;
    await page.screenshot({ path: path.join(SALIDA, archivo) });
    resultados.push({ tamano: t.nombre, pantalla: "Márgenes", archivo, ...(await desborde(page)) });
    await tramos(page, archivo, t);
    for (const pestana of ["Vinos", "Platos"]) {
      const b = page.getByRole("radio", { name: new RegExp(`^${pestana}`) }).first();
      if (await b.count()) {
        await b.click(); await page.waitForTimeout(500);
        archivo = `margenes-${pestana.replace(/\s/g, "-")}-${t.nombre}.png`;
        await page.screenshot({ path: path.join(SALIDA, archivo) });
        resultados.push({ tamano: t.nombre, pantalla: `Márgenes · ${pestana}`, archivo, ...(await desborde(page)) });
        await tramos(page, archivo, t);
      }
    }
    const fila = page.getByTestId("margenes-lista").getByRole("button").first();
    if (await fila.count()) {
      await fila.click(); await page.waitForTimeout(700);
      archivo = `margenes-detalle-${t.nombre}.png`;
      await page.screenshot({ path: path.join(SALIDA, archivo) });
      resultados.push({ tamano: t.nombre, pantalla: "Márgenes · detalle", archivo, ...(await desborde(page)) });
      await tramos(page, archivo, t);
    }
    if (errores.length) resultados.push({ tamano: t.nombre, errores });
    await contexto.close();
  }
} finally {
  await navegador.close();
}
writeFileSync(path.join(SALIDA, "resultados.json"), JSON.stringify(resultados, null, 2));
for (const r of resultados) console.log(r.tamano, "|", r.pantalla ?? "errores", "| desborde página:", r.paginaX, "|", (r.fuera ?? r.errores ?? []).join(" ; "));
const malos = resultados.filter((r) => r.tamano === "movil" && (r.paginaX > 0 || r.fuera?.length));
process.exit(malos.length ? 1 : 0);
