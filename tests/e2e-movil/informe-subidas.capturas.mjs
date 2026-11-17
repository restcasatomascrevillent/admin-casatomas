// Capturas de Facturas › Análisis › «Subidas y proveedor» (17/11/2026, arreglo de la revisión de la release:
// cada lista medía 36 px a 768×1024). Cinco tamaños; estados con datos, ahorro, error 500, sin permiso, vacío y
// cargando. Mide el desborde horizontal, el scroll vertical de PÁGINA (regla del dueño: solo las listas hacen
// scroll) y el alto visible de la lista; sale con código 1 si algo falla.
//
//   node tests/e2e-movil/informe-subidas.capturas.mjs <url> [carpeta]
//
// <url>: el panel servido con VITE_SUPABASE_URL=https://e2e-falso.supabase.co (vite o vite preview).
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { instalarSupabaseFalso } from "./supabase-falso.mjs";
import { tablas, rpcSinteticas, funcionesSinteticas } from "./datos-sinteticos.mjs";

const BASE = process.argv[2] ?? "http://localhost:4173";
const SALIDA = process.argv[3] ?? "test-results/informe-subidas";
const URL_SUPABASE = process.env.E2E_SUPABASE_URL ?? "https://e2e-falso.supabase.co";

const doc = (id, prov) => ({ id, fecha: "2026-11-03", proveedor: prov, proveedor_id: 7, numero: `F-${id}`, tipo: "factura", local: "casa_tomas", total: 812.4, drive_url: null, archivo_path: null });
const NIVELES = ["alta", "media", "media", "alta", "baja"];
const subidas = (meses) => {
  const filas = Array.from({ length: 60 }, (_, i) => {
    const confianza = i >= 52 ? "baja" : NIVELES[i % 4];
    const ref = 10 + i;
    return {
      id: `${i}:7:kg`, producto_id: 100 + i, producto: i % 6 === 0 ? `Producto SIM con un nombre bastante largo de catálogo ${i}` : `Producto SIM ${i}`,
      proveedor_id: 7, proveedor: `SIM DISTRIBUCIONES ALIMENTARIAS DEL LEVANTE ${i % 5}, S.L.`, unidad: i % 3 ? "kg" : "ud",
      precio: ref * 1.12, fecha: "2026-11-03", precio_ref: ref, fecha_ref: "2025-11-04", variacion_pct: 12,
      hace_3: { precio: ref * 1.05, fecha: "2026-08-02", variacion_pct: 6.7 }, hace_6: i % 2 ? null : { precio: ref, fecha: "2026-05-01", variacion_pct: 12 },
      hace_12: { precio: ref, fecha: "2025-11-04", variacion_pct: 12 }, compras_12m: 12, cantidad_12m: 300 - i * 3, impacto_anual: 4000 - i * 60,
      confianza, motivo: confianza === "baja" ? "Una factura lo trae a precios muy distintos (de 39,00 a 65,00 €/kg): seguramente son tallas o calidades distintas, no se promedian" : confianza === "media" ? "Pocas compras: 3 en 12 meses" : "Mismo proveedor y misma unidad; 12 compras en 12 meses",
      doc: doc(1000 + i, "SIM DISTRIBUCIONES"), doc_ref: doc(2000 + i, "SIM DISTRIBUCIONES"),
    };
  });
  return {
    hoy: "2026-11-17", meses,
    totales: { impacto_fiable: 11498.51, n_fiable: 52, por_confianza: { alta: { n: 26, impacto: 5335.27 }, media: { n: 26, impacto: 6163.24 }, baja: { n: 8, impacto: 6101.71 } }, bajadas_fiable: { n: 73, importe: -13617.63 }, sin_referencia: 850, comparados: 469 },
    total_filas: 60, filas,
    proveedores: [{ id: 7, nombre: "SIM DISTRIBUCIONES ALIMENTARIAS DEL LEVANTE, S.L.", n: 60 }], familias: [{ id: 2, nombre: "Pescado y marisco", n: 60 }],
    excluidos: { n_genericos: 2, gasto_genericos: 41000, genericos: [{ producto_id: 9, producto: "Macruros", motivo: "Cajón de la lonja: la nota de venta no dice la especie", gasto_12m: 33791, proveedores: 30 }] },
  };
};
const barato = () => ({
  totales: { ahorro_fiable: 12288.48, n_fiable: 45, por_confianza: { alta: { n: 2, ahorro: 56.21 }, media: { n: 43, ahorro: 12232.27 }, baja: { n: 15, ahorro: 16580.03 } }, productos_varios_proveedores: 203 },
  total_filas: 60,
  filas: Array.from({ length: 60 }, (_, i) => ({
    id: `${i}:2:l`, producto_id: 300 + i, producto: i === 50 ? "Coca-Cola Zero 33 cl" : `Producto SIM ${i}`, unidad: "l", proveedor_id: 2, proveedor: "SERVICIOS HOSTELEROS SIM, S.L.", precio: 2.4929, fecha: "2026-10-30",
    compras_12m: 30, cantidad_12m: 1873, es_habitual: true, proveedor_barato_id: 3, proveedor_barato: "Makro SIM distribuidor mayorista S.A.", precio_barato: 1.9381, fecha_barato: "2026-08-04", compras_barato_12m: 4,
    diferencia_pct: 22.3, ahorro_anual: 2500 - i * 30, confianza: i >= 45 ? "baja" : i % 2 ? "media" : "alta",
    motivo: i >= 45 ? "Envases distintos (35 cl de vidrio y 33 cl en lata): no es el mismo artículo" : "Pescado, marisco, fruta o verdura: el tamaño y la calidad pueden no ser iguales",
    doc: doc(3000 + i, "SERVICIOS HOSTELEROS SIM"), doc_barato: doc(4000 + i, "Makro SIM"),
  })),
  proveedores: [{ id: 2, nombre: "SERVICIOS HOSTELEROS SIM, S.L.", n: 60 }, { id: 3, nombre: "Makro SIM", n: 60 }], familias: [{ id: 5, nombre: "Refrescos y aguas", n: 60 }],
  excluidos: { n_genericos: 0, gasto_genericos: 0, genericos: [] },
});
const vacioSub = (meses) => ({ ...subidas(meses), totales: { ...subidas(meses).totales, comparados: 0, n_fiable: 0, impacto_fiable: 0, por_confianza: { alta: { n: 0, impacto: 0 }, media: { n: 0, impacto: 0 }, baja: { n: 0, impacto: 0 } }, bajadas_fiable: { n: 0, importe: 0 } }, filas: [], total_filas: 0 });

const TAMANOS = [
  { nombre: "375", width: 375, height: 812, movil: true },
  { nombre: "768", width: 768, height: 1024, movil: true },
  { nombre: "1024", width: 1024, height: 768, movil: true },
  { nombre: "1180", width: 1180, height: 820, movil: true },
  { nombre: "1440", width: 1440, height: 900, movil: false },
];

const ESTADOS = [
  { id: "subidas", rpc: {}, bloque: "subidas" },
  { id: "ahorro", rpc: {}, bloque: "barato" },
  { id: "error-500", error: { status: 500, cuerpo: { code: "XX000", message: "internal error" } }, bloque: "subidas" },
  { id: "sin-permiso", error: { status: 403, cuerpo: { code: "42501", message: "permission denied for function informe_subidas_precio" } }, bloque: "subidas" },
  { id: "vacio", rpc: { informe_subidas_precio: (a) => vacioSub(a.p_meses ?? 12) }, bloque: "subidas" },
  { id: "cargando", colgado: true, bloque: "subidas" },
];

const medir = (page) => page.evaluate(() => {
  const ancho = document.documentElement.clientWidth;
  const fuera = [];
  for (const el of document.querySelectorAll("main *")) {
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
  const caja = document.querySelector('[data-testid="informe-subidas-proveedor"] [data-testid="caja-scroll"]');
  const visible = caja ? Math.max(0, Math.min(caja.getBoundingClientRect().bottom, window.innerHeight) - Math.max(caja.getBoundingClientRect().top, 0)) : null;
  return {
    paginaX: document.scrollingElement.scrollWidth - ancho,
    paginaY: document.scrollingElement.scrollHeight - document.documentElement.clientHeight,
    fuera: fuera.slice(0, 8),
    lista: caja ? { alto: caja.clientHeight, visibleEnPantalla: Math.round(visible), contenido: caja.scrollHeight, filas: caja.querySelectorAll("li[data-confianza]").length } : null,
  };
});

mkdirSync(SALIDA, { recursive: true });
const navegador = await chromium.launch();
const resultados = [];
try {
  for (const t of TAMANOS) {
    for (const e of ESTADOS) {
      const contexto = await navegador.newContext({ viewport: { width: t.width, height: t.height }, isMobile: t.movil, hasTouch: t.movil, deviceScaleFactor: 1, locale: "es-ES", timezoneId: "Europe/Madrid", reducedMotion: "reduce" });
      await instalarSupabaseFalso(contexto, {
        urlSupabase: URL_SUPABASE, tablas: tablas(),
        rpc: { ...rpcSinteticas, informe_subidas_precio: (a) => subidas(a.p_meses ?? 12), informe_proveedor_mas_barato: () => barato(), ...(e.rpc ?? {}) },
        funciones: funcionesSinteticas,
      });
      // Las rutas registradas después mandan sobre las del Supabase falso.
      if (e.error) await contexto.route(/\/rest\/v1\/rpc\/informe_(subidas_precio|proveedor_mas_barato)/, (r) => r.fulfill({ status: e.error.status, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: JSON.stringify(e.error.cuerpo) }));
      if (e.colgado) await contexto.route(/\/rest\/v1\/rpc\/informe_(subidas_precio|proveedor_mas_barato)/, () => new Promise(() => {}));
      const page = await contexto.newPage();
      const errores = [];
      page.on("pageerror", (x) => errores.push(x.message));
      await page.goto(`${BASE}/facturas?tab=chat&vista=informe`, { waitUntil: "domcontentloaded" });
      await page.getByTestId("informe-subidas-proveedor").waitFor({ timeout: 30_000 });
      if (e.bloque === "barato") await page.getByTestId("total-ahorro").getByRole("button").first().click();
      if (e.error) await page.getByText("No se ha podido calcular").first().waitFor({ timeout: 15_000 });
      else if (!e.colgado) await page.waitForTimeout(1200);
      else await page.waitForTimeout(800);
      const archivo = `informe-${e.id}-${t.nombre}.png`;
      await page.screenshot({ path: path.join(SALIDA, archivo) });
      // En el móvil el tablero desplaza como una página: otra captura con la lista a la vista.
      if (t.width < 640) {
        await page.locator('[data-testid="informe-subidas-proveedor"] [data-testid^="caja-informe-"]').scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(SALIDA, archivo.replace(".png", "-lista.png")) });
      }
      resultados.push({ tamano: `${t.width}x${t.height}`, estado: e.id, archivo, ...(await medir(page)), errores });
      await contexto.close();
    }
  }
} finally {
  await navegador.close();
}
writeFileSync(path.join(SALIDA, "resultados.json"), JSON.stringify(resultados, null, 2));
for (const r of resultados) {
  console.log(r.tamano, "|", r.estado, "| X:", r.paginaX, "| Y página:", r.paginaY, "| lista:", JSON.stringify(r.lista), "|", [...r.fuera, ...r.errores].join(" ; "));
}
// En el móvil el tablero desplaza como una página (como las demás vistas): no se mide el alto de la lista.
const malos = resultados.filter((r) => r.errores.length || r.paginaX > 0 || r.paginaY > 0 || r.fuera.length
  || (["subidas", "ahorro"].includes(r.estado) && !r.tamano.startsWith("375") && (!r.lista || r.lista.alto < 200)));
process.exit(malos.length ? 1 : 0);
