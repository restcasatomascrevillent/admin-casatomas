// Facturas › Análisis CON DATOS: la página no hace scroll vertical (solo el tablero por dentro).
//
// QA 05/11/2026: a 1180×820 la página medía 1063 px. Los resúmenes `sr-only` (position: absolute) de las tarjetas no
// tenían un antepasado posicionado y se colocaban respecto a la página, alargándola; con la rueda sobre la barra la
// página bajaba y se quedaba en blanco. Además `scrollIntoView` (tocar una barra, «Abrir en el explorador») movía la
// ventana. Aquí se mide `document.scrollingElement` con el tablero lleno, tras la rueda y tras elegir un punto.
//
// Uso (ver README.md): build con VITE_SUPABASE_URL=https://e2e-falso.supabase.co y
//   npx playwright test -c tests/e2e-movil/playwright.config.mjs analisis-sin-scroll --project=390x844
// (cada prueba fija ella misma su tamaño: tablet horizontal, tablet vertical y móvil).
import { test, expect } from "@playwright/test";
import { instalarSupabaseFalso } from "./supabase-falso.mjs";
import { tablas, rpcSinteticas, funcionesSinteticas } from "./datos-sinteticos.mjs";

const URL_SUPABASE = process.env.E2E_SUPABASE_URL ?? "https://e2e-falso.supabase.co";

const MESES = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"];
const prov = (i) => ({ id: 300 + i, nombre: `SIM PROVEEDOR CON UN NOMBRE BASTANTE LARGO ${i + 1}, S.L.`, gasto: 90000 - i * 7000, pct: 9 - i * 0.5, documentos: 30 - i });

/** `tablero_compras` lleno: todas las tarjetas con filas (lo que alargaba la página). */
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
  subidas: {
    tramo_inicio: { desde: "2026-01-12", hasta: "2026-04-11" },
    tramo_fin: { desde: "2026-07-09", hasta: "2026-10-06" },
    comparados: 216,
    productos: Array.from({ length: 5 }, (_, i) => ({
      producto: `PRODUCTO SIM ${i + 1} CON NOMBRE LARGO`, nombre_normalizado: `producto sim ${i + 1}`, unidad: "kg", proveedor_id: 300 + i,
      proveedor: prov(i).nombre, precio_inicio: 1.4 + i, precio_fin: 2.05 + i, variacion_pct: 46.5 - i * 5, compras_inicio: 3, compras_fin: 3, importe: 2851.8,
    })),
  },
  familias: {
    importe_total: 1200548.07, lineas: 12321, sin_clasificar: { lineas: 10396, importe: 1019048.6 },
    familias: Array.from({ length: 8 }, (_, i) => ({ id: i + 1, familia: `Familia SIM ${i + 1}`, importe: 81614.84 - i * 5000, lineas: 459 - i * 20 })),
  },
  fijos: {
    ventana: { desde: "2026-01-01", hasta: "2026-11-05", meses_con_datos: 11 }, total_medio_mes: 14400,
    proveedores: Array.from({ length: 8 }, (_, i) => ({ id: 398 + i, nombre: `SIM SUMINISTRO ${i + 1}, S.L.U.`, medio_mes: 3611.03 - i * 200, meses: 11, meses_con_datos: 11, documentos: 11 })),
  },
  abonos: Array.from({ length: 8 }, (_, i) => ({ id: 377 + i, nombre: `SIM DISTRIBUCIONES ${i + 1}, S.L.`, importe: -5716.71 + i * 500, documentos: 5 })),
  locales: { casa_tomas: { gasto: 1333190.24, documentos: 1857 }, touza: { gasto: 29301.33, documentos: 27 }, meses: [] },
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
      ? MESES.map((mes, i) => ({ clave: mes, etiqueta: mes, id: null, valor: 122500 + i * 3100, documentos: 160 + i, desglose: local ? { casa_tomas: 120000 + i * 3000, ...(i % 3 ? { touza: 2500 } : {}) } : null }))
      : Array.from({ length: 10 }, (_, i) => ({ clave: String(300 + i), etiqueta: prov(i).nombre, id: 300 + i, valor: prov(i).gasto, documentos: 3, desglose: null })),
    resto: tiempo ? null : { entidades: 4, valor: 18000, documentos: 12 },
  };
};

const VISTAS = [
  { nombre: "tablet horizontal", width: 1180, height: 820 },
  { nombre: "tablet vertical", width: 820, height: 1180 },
  { nombre: "móvil", width: 390, height: 844 },
];

/** Lo que sobra de la PÁGINA (0 = sin scroll vertical). */
const sobraPagina = (page) => page.evaluate(() => {
  const el = document.scrollingElement;
  return { scrollH: el.scrollHeight, clientH: el.clientHeight, scrollY: window.scrollY };
});

test.beforeEach(async ({ context }) => {
  await instalarSupabaseFalso(context, {
    urlSupabase: URL_SUPABASE,
    tablas: tablas(),
    rpc: { ...rpcSinteticas, tablero_compras: tablero, explorar_compras: explorar, documentos_de_cifra: () => ({ cifra: 0, documentos: 0, importe_total: 0, desplazamiento: 0, filas: [] }) },
    funciones: funcionesSinteticas,
  });
});

for (const v of VISTAS) {
  test(`Análisis con datos: sin scroll de página · ${v.nombre} ${v.width}×${v.height}`, async ({ page }) => {
    const errores = [];
    page.on("pageerror", (e) => errores.push(e.message));
    await page.setViewportSize({ width: v.width, height: v.height });
    await page.goto("/facturas?tab=chat", { waitUntil: "domcontentloaded" });
    const tableroEl = page.getByTestId("tablero-analisis");
    await expect(tableroEl.getByText("Gasto con IVA").first()).toBeVisible({ timeout: 30_000 });
    await expect(tableroEl.getByRole("region", { name: "Abonos por proveedor" })).toBeAttached();
    await page.waitForTimeout(500);

    // 1. Con el tablero lleno, la página mide lo que la ventana.
    const r = await sobraPagina(page);
    expect(r.scrollH, `la página mide ${r.scrollH}px con una ventana de ${r.clientH}px`).toBe(r.clientH);
    // …y el tablero sí tiene más contenido (hace scroll por dentro).
    expect(await tableroEl.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);

    // 2. La rueda sobre la barra de periodo no mueve la página.
    const barra = await page.locator("[data-tour=facturas-analisis-barra]").boundingBox();
    if (barra) {
      await page.mouse.move(barra.x + 4, barra.y + 4);
      await page.mouse.wheel(0, 800);
      await page.waitForTimeout(300);
      expect((await sobraPagina(page)).scrollY).toBe(0);
    }

    // 3. Elegir un punto del explorador (desplaza el tablero hasta la tira) no mueve la página.
    const ex = page.getByTestId("explorador");
    await ex.getByRole("button", { name: /ver como tabla/i }).click();
    await ex.getByRole("button", { name: "Octubre 2026", exact: true }).click();
    await expect(ex.getByRole("region", { name: "Punto elegido" })).toBeVisible();
    await page.waitForTimeout(600);
    const tras = await sobraPagina(page);
    expect(tras.scrollY).toBe(0);
    expect(tras.scrollH).toBe(tras.clientH);
    expect(errores).toEqual([]);
  });
}
