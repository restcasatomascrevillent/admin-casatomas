// Facturas › Análisis CON DATOS en UNA pantalla (07/11/2026, maqueta del dueño): ni la página ni el tablero hacen
// scroll vertical; solo las listas, dentro de su caja. Barra única (pestañas + periodo + local + Personalizar + IA +
// Avisos) en UNA línea en escritorio y tablet horizontal.
//
// Historia: QA 05/11/2026, a 1180×820 la página medía 1063 px (resúmenes `sr-only` sin antepasado posicionado y
// `scrollIntoView` que movía la ventana). Ahora además se mide cada vista.
//
// Uso (ver README.md): build con VITE_SUPABASE_URL=https://e2e-falso.supabase.co y
//   npx playwright test -c tests/e2e-movil/playwright.config.mjs analisis-sin-scroll --project=390x844
// (cada prueba fija ella misma su tamaño).
import { test, expect } from "@playwright/test";
import { instalarSupabaseFalso } from "./supabase-falso.mjs";
import { tablas, rpcSinteticas, funcionesSinteticas } from "./datos-sinteticos.mjs";

const URL_SUPABASE = process.env.E2E_SUPABASE_URL ?? "https://e2e-falso.supabase.co";

const MESES = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"];
const prov = (i) => ({ id: 300 + i, nombre: `SIM PROVEEDOR CON UN NOMBRE BASTANTE LARGO ${i + 1}, S.L.`, gasto: 90000 - i * 7000, pct: 9 - i * 0.5, documentos: 30 - i });

/** `tablero_compras` lleno: todas las tarjetas con filas. */
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
/** `facturas_decision` lleno (listas largas: deben hacer scroll DENTRO de su caja). */
const decision = (a) => ({
  periodo: { desde: a.p_desde ?? "2026-01-01", hasta: a.p_hasta ?? "2026-12-31", en_curso: true, meses_equivalentes: 10.2, meses_incompletos: ["2026-11"],
    comparado: { modo: "ultimo_mes", desde: "2026-09-01", hasta: "2026-09-30" } },
  referencia: { meses: ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"], desde: "2026-03-01", hasta: "2026-08-31" },
  resumen: { gasto: 1362491.57, documentos: 1884, base: 115168, base_referencia: 132000 },
  familias: Array.from({ length: 14 }, (_, i) => ({ id: i + 1, familia: `Familia SIM ${i + 1}`, importe: 30000 - i * 1500, media_mes: 25000 - i * 1500, referencia: 25000 - i * 1500, variacion_pct: 20 - i * 3, aviso: i < 2, alerta: null })),
  cambios: {
    sube: Array.from({ length: 14 }, (_, i) => ({ ...alerta(`s${i}`, "facturas_precio_sube", { producto: `PRODUCTO SUBE ${i + 1}`, proveedor: prov(i % 10).nombre, proveedor_id: 300 + (i % 10), precio: 14 + i, precio_ref: 11 + i, variacion_pct: 25 - i, medida: "kg", unidad: "kg", fecha: "2026-10-03", impacto_mes: 80 - i * 4, factura_id: 7 }), campana: true, impacto_mes: 80 - i * 4, doc: { id: 7, fecha: "2026-10-03", proveedor: "SIM", numero: "1", tipo: "factura", local: "casa_tomas", total: 900 } })),
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

/** `explorar_compras` (por mes y local, o un ranking). */
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

const TAMANOS = [
  { nombre: "escritorio", width: 1280, height: 800, unaLinea: true },
  { nombre: "tablet horizontal", width: 1024, height: 768, unaLinea: true },
  { nombre: "tablet vertical", width: 820, height: 1180, unaLinea: false },
  { nombre: "móvil", width: 390, height: 844, unaLinea: false },
];
const VISTAS = ["Qué decidir hoy", "Precios", "Ahorro", "Gasto", "Proveedores", "Por revisar"];

/** Lo que sobra de la PÁGINA (0 = sin scroll vertical). */
const sobraPagina = (page) => page.evaluate(() => {
  const el = document.scrollingElement;
  return { scrollH: el.scrollHeight, clientH: el.clientHeight, scrollY: window.scrollY };
});

test.beforeEach(async ({ context }) => {
  await instalarSupabaseFalso(context, {
    urlSupabase: URL_SUPABASE,
    tablas: tablas(),
    rpc: {
      ...rpcSinteticas,
      tablero_compras: tablero,
      facturas_decision: decision,
      explorar_compras: explorar,
      documentos_de_cifra: () => ({ cifra: 0, documentos: 0, importe_total: 0, desplazamiento: 0, filas: [] }),
    },
    funciones: funcionesSinteticas,
  });
});

for (const v of TAMANOS) {
  test(`Análisis en una pantalla · ${v.nombre} ${v.width}×${v.height}`, async ({ page }) => {
    const errores = [];
    page.on("pageerror", (e) => errores.push(e.message));
    await page.setViewportSize({ width: v.width, height: v.height });
    await page.goto("/facturas?tab=chat", { waitUntil: "domcontentloaded" });
    const tableroEl = page.getByTestId("tablero-analisis");
    await expect(tableroEl.getByTestId("cifra-precios")).toContainText("14", { timeout: 30_000 });
    await page.waitForTimeout(500);

    await page.screenshot({ path: `test-results/analisis-${v.width}x${v.height}-inicio.png` });
    // 1. Barra única: las pestañas y los controles de Análisis en la misma fila (escritorio y tablet horizontal).
    const barraPestanas = await page.getByTestId("pestanas-pagina").boundingBox();
    const barraAnalisis = await page.getByTestId("barra-analisis").boundingBox();
    expect(barraAnalisis).not.toBeNull();
    if (v.unaLinea) {
      expect(barraPestanas.height, `la barra mide ${barraPestanas.height}px: no cabe en una línea`).toBeLessThanOrEqual(56);
      expect(Math.abs(barraAnalisis.y - barraPestanas.y)).toBeLessThan(12);
    }
    for (const nombre of ["Personalizar el tablero", "Pregúntale a la IA", "Elegir fechas"]) {
      await expect(page.getByRole("button", { name: nombre }).first()).toBeVisible();
    }

    // 2. Cada vista: la página mide lo que la ventana y, en ancho, el tablero tampoco desborda.
    for (const nombre of VISTAS) {
      await tableroEl.getByRole("group", { name: "Vista del análisis" }).getByRole("button", { name: nombre, exact: true }).click();
      await page.waitForTimeout(350);
      const r = await sobraPagina(page);
      expect(r.scrollH, `«${nombre}»: la página mide ${r.scrollH}px con una ventana de ${r.clientH}px`).toBe(r.clientH);
      if (v.unaLinea) {
        const desborda = await page.getByTestId("vista-analisis").evaluate((el) => el.scrollHeight - el.clientHeight);
        expect(desborda, `«${nombre}»: la vista desborda ${desborda}px`).toBeLessThanOrEqual(1);
      }
      await page.screenshot({ path: `test-results/analisis-${v.width}x${v.height}-${nombre.replace(/\s/g, "-")}.png` });
    }

    // 3. Las cifras también son navegación: «Puedes ahorrar» abre «Ahorro» y queda marcada; la URL lo recuerda.
    await tableroEl.getByTestId("cifra-ahorro").click();
    await expect(tableroEl.getByTestId("cifra-ahorro")).toHaveAttribute("aria-pressed", "true");
    await expect(tableroEl.getByText(/Compraste 18 kg en 90 días/).first()).toBeVisible();
    expect(page.url()).toContain("vista=ahorro");

    // 4. La rueda sobre la barra no mueve la página.
    const barra = await page.getByTestId("barra-analisis").boundingBox();
    await page.mouse.move(barra.x + 4, barra.y + 4);
    await page.mouse.wheel(0, 800);
    await page.waitForTimeout(300);
    expect((await sobraPagina(page)).scrollY).toBe(0);
    expect(errores).toEqual([]);
  });
}
