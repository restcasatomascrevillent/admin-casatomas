// QA de Facturas › Cargar › Importación histórica (05/11/2026): carpetas mal formadas, errores parciales,
// pausa/cierre y que el diálogo quepa en los 3 tamaños. Sin red real: importar-factura-historica es falsa.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { montar, pdf, REVISAR, CAPTURAS } from "./servidor-falso.mjs";

const hallazgos = [];
const nota = (testInfo, texto, tipo = "FALLO") => { testInfo.annotations.push({ type: tipo, description: texto }); hallazgos.push(`[${tipo}] [${testInfo.project.name}] ${testInfo.title}: ${texto}`); };
test.afterAll(() => { if (hallazgos.length) fs.appendFileSync(path.join(CAPTURAS, "hallazgos.txt"), hallazgos.join("\n") + "\n"); });

/** Crea una carpeta temporal con los ficheros dados ({ ruta: contenido }). */
function carpeta(nombre, ficheros) {
  const dir = path.join(os.tmpdir(), `qa-historica-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, nombre);
  for (const [r, c] of Object.entries(ficheros)) {
    const f = path.join(dir, r);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, c);
  }
  return dir;
}

async function abrirDialogo(page) {
  await page.goto("/facturas?tab=cargar", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Importación histórica/ }).click();
  const d = page.getByRole("dialog", { name: /Importación histórica/ });
  await expect(d).toBeVisible();
  return d;
}

const elegir = (page, dir) => page.getByRole("dialog").locator("input[type=file]").setInputFiles(dir);

async function revisar(page, testInfo, momento) {
  const r = await page.evaluate(REVISAR);
  if (r.scrollV > 1) nota(testInfo, `${momento}: scroll vertical de página de ${r.scrollV}px`);
  if (r.scrollH > 1) nota(testInfo, `${momento}: desborde horizontal de ${r.scrollH}px`);
  for (const d of r.dialogos) {
    if (d.cortado) nota(testInfo, `${momento}: diálogo «${d.titulo}» cortado (${d.top}..${d.bottom} / ${d.left}..${d.right})`);
    if (d.fueraBotones.length) nota(testInfo, `${momento}: botones del diálogo fuera: ${d.fueraBotones.join(" | ")}`);
  }
}

test("H1 · carpetas mal formadas: sin manifest, vacío, JSON roto, no lista, Excel/CSV", async ({ page, context }, testInfo) => {
  await montar(context);
  const d = await abrirDialogo(page);
  await revisar(page, testInfo, "diálogo vacío");
  await page.screenshot({ path: path.join(CAPTURAS, `H1a-historica-vacia-${testInfo.project.name}.png`) });
  const casos = [
    ["sin-manifest", { "json/a.json": "{}" }, /no tiene manifest\.json/],
    ["vacio", { "manifest.json": "[]" }, /está vacío/],
    ["no-lista", { "manifest.json": '{"clave":"x"}' }, /tiene que ser una lista/],
    ["excel-csv", { "facturas.xlsx": "PK\u0003\u0004", "facturas.csv": "proveedor;total\nSIM;10" }, /manifest/],
    // UI-12: JSON roto → aviso en español, no el de JSON.parse en inglés.
    ["json-roto", { "manifest.json": "[{ clave: 'x', }" }, /^manifest\.json no es un JSON válido/],
  ];
  for (const [nombre, ficheros, esperado] of casos) {
    await elegir(page, carpeta(nombre, ficheros));
    const aviso = d.locator(".text-red-800, .dark\\:text-red-200").first();
    await expect(aviso).toBeVisible();
    const txt = (await aviso.innerText()).trim();
    expect.soft(txt, nombre).toMatch(esperado);
    expect.soft(txt, nombre).not.toMatch(/Unexpected|Expected|JSON at position|property name/i);
    // Carencia de producto (no un fallo): no hay importación desde hoja de cálculo. Se deja anotada.
    if (nombre === "excel-csv") nota(testInfo, `una carpeta con Excel/CSV no se admite: solo manifest.json + json/ + pdf/ («${txt}»); no hay importación desde hoja de cálculo`, "CARENCIA");
  }
  await page.screenshot({ path: path.join(CAPTURAS, `H1b-historica-json-roto-${testInfo.project.name}.png`) });
});

test("H2 · importación con errores parciales, reintentar, parar y cierre bloqueado", async ({ page, context }, testInfo) => {
  const una = (await pdf("R1.pdf", 2)).buffer;
  const manifest = [
    { clave: "R1#0", json: "json/r1.json", paginas: [{ pdf: "pdf/R1.pdf", pages: [1] }], proveedor: "SIM Distribuciones Alimentarias del Norte de España, S.L.U. con nombre larguísimo", total: 1234.5, fecha: "2026-03-14", local: "casa_tomas" },
    { clave: "R1#1", json: "json/r1.json", paginas: [{ pdf: "pdf/R1.pdf", pages: [2] }], proveedor: "SIM Dos", total: "88,10", fecha: "2026-03-15", local: "touza" },
    { clave: "R2", json: "json/no-esta.json", paginas: [{ pdf: "pdf/R1.pdf", pages: [1] }], proveedor: "SIM Falta JSON", total: 10, fecha: null, local: null },
    { clave: "R3", json: "json/r3.json", paginas: [{ pdf: "pdf/R1.pdf", pages: [7] }], proveedor: "SIM Página fuera", total: 20, fecha: "2026-03-16", local: "casa_tomas" },
    { clave: "R4", json: "json/r3.json", paginas: [{ pdf: "pdf/R1.pdf", pages: [1] }], proveedor: "SIM Duplicada", total: 30, fecha: "2026-03-17", local: "casa_tomas" },
    { clave: "R5", json: "json/r3.json", paginas: [{ pdf: "pdf/R1.pdf", pages: [1] }], proveedor: "SIM 500", total: 40, fecha: "2026-03-18", local: "casa_tomas" },
    { clave: "R6", json: "json/r3.json", paginas: [{ pdf: "pdf/R1.pdf", pages: [1] }], proveedor: "SIM 401", total: 50, fecha: "2026-03-19", local: "casa_tomas" },
  ];
  const dir = carpeta("lote-historico", {
    "manifest.json": JSON.stringify(manifest),
    "json/r1.json": JSON.stringify([{ numero_documento: "A-1", fecha: "2026-03-14" }, { numero_documento: "A-2", fecha: "2026-03-15" }]),
    "json/r3.json": JSON.stringify({ numero_documento: "B/3", fecha: "2026-03-16" }),
    "pdf/R1.pdf": una,
  });
  let fallarServidor = true;
  const srv = await montar(context, {
    historica: (c) => {
      if (c.clave === "R4") return { status: 200, body: { estado: "duplicado", facturaId: 77, mensaje: "Ya existe A26/60875 del mismo proveedor" } };
      if (c.clave === "R5" && fallarServidor) return { status: 500, body: "<html>502 Bad Gateway</html>", contentType: "text/html", demoraMs: 300 };
      if (c.clave === "R6" && fallarServidor) return { status: 401, body: { error: "No autorizado" } };
      return { status: 200, body: { estado: "importada", facturaId: 1000 + Number(String(c.clave).replace(/\D/g, "") || 0), mensaje: "" }, demoraMs: 600 };
    },
  });
  const d = await abrirDialogo(page);
  await elegir(page, dir);
  await expect(d.getByText(/7 factura\(s\)/)).toBeVisible();
  await revisar(page, testInfo, "lote cargado");
  await page.screenshot({ path: path.join(CAPTURAS, `H2a-historica-lote-${testInfo.project.name}.png`) });
  await d.getByRole("button", { name: "Importar" }).click();
  // UI-6: mientras importa hay un «Parar» visible.
  await expect(d.getByRole("button", { name: "Parar la importación" })).toBeVisible();
  await expect(d.getByRole("button", { name: "Parar la importación" })).toBeInViewport();
  // Cerrar mientras importa: no deja.
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await expect(page.getByText("Para la importación antes de cerrar")).toBeVisible();
  await expect(d).toBeVisible();
  await expect(d.getByRole("button", { name: /Reintentar errores|Reanudar/ })).toBeVisible({ timeout: 20_000 });
  await revisar(page, testInfo, "lote terminado");
  await page.screenshot({ path: path.join(CAPTURAS, `H2b-historica-errores-${testInfo.project.name}.png`) });
  const texto = await d.innerText();
  expect.soft(texto).toMatch(/2 importadas/);
  expect.soft(texto).toMatch(/1 duplicadas/);
  expect.soft(texto).toMatch(/4 con error/);
  // Fila (tabla) o tarjeta (móvil) visible de cada clave.
  const fila = (clave) => d.locator(`[data-clave="${clave}"]:visible`);
  // UI-12: un 500 con cuerpo HTML sale en español.
  const r5 = (await fila("R5").innerText()).replace(/\s+/g, " ");
  expect.soft(r5).not.toMatch(/non-2xx|Edge Function/i);
  expect.soft(r5).toMatch(/El servidor ha fallado/);
  const r2 = (await fila("R2").innerText()).replace(/\s+/g, " ");
  expect.soft(r2).toMatch(/No está en la carpeta: json\/no-esta\.json/);
  // El total con coma del manifiesto («88,10») se lee como importe (88,10 €), no «—».
  expect.soft((await fila("R1#1").innerText()).replace(/\s+/g, " ")).toMatch(/88,10\s?€/);
  // Mejora: sin scroll lateral (en móvil, tarjetas).
  const ancho = await fila("R5").evaluate((el) => { const c = el.closest(".overflow-auto"); return { t: c.scrollWidth, c: c.clientWidth }; });
  expect.soft(ancho.t, `la lista mide ${ancho.t}px en un hueco de ${ancho.c}px`).toBeLessThanOrEqual(ancho.c + 1);
  // Reintentar errores: solo vuelve a mandar los que fallaron en el servidor (y los de preparación).
  fallarServidor = false;
  const antes = srv.registro.historica.length;
  await d.getByRole("button", { name: /Reintentar errores|Reanudar/ }).click();
  await expect(d.getByRole("button", { name: /Reintentar errores|Reanudar/ })).toBeVisible({ timeout: 20_000 });
  expect(srv.registro.historica.slice(antes).sort()).toEqual(["R5", "R6"]);
  // El filtro «Errores».
  await d.getByRole("combobox", { name: "Filtrar la lista" }).click();
  await page.getByRole("option", { name: "Errores" }).click();
  await page.screenshot({ path: path.join(CAPTURAS, `H2c-historica-filtro-errores-${testInfo.project.name}.png`) });
});

test("H3 · salir con «Atrás» del navegador en plena importación: la importación se PARA", async ({ page, context }, testInfo) => {
  const una = (await pdf("R1.pdf", 1)).buffer;
  const manifest = Array.from({ length: 6 }, (_, i) => ({ clave: `K${i}`, json: "json/a.json", paginas: [{ pdf: "pdf/R1.pdf", pages: [1] }], proveedor: `SIM ${i}`, total: i, fecha: "2026-01-01", local: "casa_tomas" }));
  const dir = carpeta("lote-atras", { "manifest.json": JSON.stringify(manifest), "json/a.json": JSON.stringify({ numero_documento: "Z" }), "pdf/R1.pdf": una });
  const srv = await montar(context, { historica: () => ({ status: 200, body: { estado: "importada", facturaId: 5, mensaje: "" }, demoraMs: 1200 }) });
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  // Entrar en Facturas › Cargar SIN recargar (como desde el menú), para que «Atrás» sea navegación de la app.
  await page.evaluate(() => { window.history.pushState({}, "", "/facturas?tab=cargar"); window.dispatchEvent(new PopStateEvent("popstate")); });
  await page.getByRole("button", { name: /Importación histórica/ }).click();
  const d = page.getByRole("dialog", { name: /Importación histórica/ });
  await expect(d).toBeVisible();
  await elegir(page, dir);
  await d.getByRole("button", { name: "Importar" }).click();
  await expect.poll(() => srv.registro.historica.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
  await page.goBack();
  await expect(page).toHaveURL(/\/dashboard/);
  // Se avisa de que se ha parado (y cómo reanudarla).
  await expect(page.getByText("Importación histórica parada")).toBeVisible();
  const alSalir = srv.registro.historica.length;
  await page.waitForTimeout(6000);
  const despues = srv.registro.historica.length;
  // UI-6: al desmontar se corta el bucle (como mucho sale la que ya se estaba preparando).
  expect(despues, `envíos tras salir (${alSalir} → ${despues})`).toBeLessThanOrEqual(alSalir + 1);
  expect(despues).toBeLessThan(6);
  await page.screenshot({ path: path.join(CAPTURAS, `H3-historica-atras-${testInfo.project.name}.png`) });
});

test("H4 · «Parar» corta la importación y avisa al cerrar la pestaña mientras importa", async ({ page, context }) => {
  const una = (await pdf("R1.pdf", 1)).buffer;
  const manifest = Array.from({ length: 6 }, (_, i) => ({ clave: `P${i}`, json: "json/a.json", paginas: [{ pdf: "pdf/R1.pdf", pages: [1] }], proveedor: `SIM ${i}`, total: i, fecha: "2026-01-01", local: "casa_tomas" }));
  const dir = carpeta("lote-parar", { "manifest.json": JSON.stringify(manifest), "json/a.json": JSON.stringify({ numero_documento: "Z" }), "pdf/R1.pdf": una });
  const srv = await montar(context, { historica: () => ({ status: 200, body: { estado: "importada", facturaId: 5, mensaje: "" }, demoraMs: 1500 }) });
  const d = await abrirDialogo(page);
  await elegir(page, dir);
  await d.getByRole("button", { name: "Importar" }).click();
  await expect.poll(() => srv.registro.historica.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
  // Cerrar la pestaña en plena importación: hay un oyente de beforeunload que lo frena.
  const bloqueado = await page.evaluate(() => { const ev = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(ev); return ev.defaultPrevented; });
  expect(bloqueado, "beforeunload mientras importa").toBe(true);
  await d.getByRole("button", { name: "Parar la importación" }).click();
  await expect(d.getByRole("button", { name: /Reanudar/ })).toBeVisible({ timeout: 10_000 });
  const alParar = srv.registro.historica.length;
  await page.waitForTimeout(3500);
  expect(srv.registro.historica.length).toBe(alParar);
  expect(alParar).toBeLessThan(6);
});
