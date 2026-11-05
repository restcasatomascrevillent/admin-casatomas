// QA de Facturas › Cargar (05/11/2026): subida por OCR (simulada), cola, duplicados, página suelta,
// errores, Drive caído, trabajos colgados, navegación y sin scroll de página en 3 tamaños.
// Los fallos UI-1…UI-16 ya arreglados se comprueban con `expect` (comportamiento correcto); lo que
// quede mal de presentación (scroll, botones fuera) se sigue anotando como «FALLO» en hallazgos.txt.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { montar, png, pdf, REVISAR, CAPTURAS, EXISTENTE } from "./servidor-falso.mjs";

fs.mkdirSync(CAPTURAS, { recursive: true });
const hallazgos = [];
const nota = (testInfo, texto) => { testInfo.annotations.push({ type: "FALLO", description: texto }); hallazgos.push(`[${testInfo.project.name}] ${testInfo.title}: ${texto}`); };
test.afterAll(() => { if (hallazgos.length) fs.appendFileSync(path.join(CAPTURAS, "hallazgos.txt"), hallazgos.join("\n") + "\n"); });

async function capturar(page, testInfo, nombre) {
  const f = path.join(CAPTURAS, `${nombre}-${testInfo.project.name}.png`);
  await page.screenshot({ path: f });
  return f;
}

async function abrirCargar(page) {
  const errores = [];
  page.on("pageerror", (e) => errores.push(e.message));
  await page.goto("/facturas?tab=cargar", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Elegir archivos" })).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(600);
  return errores;
}

const inputArchivos = (page) => page.locator('input[type=file][multiple]').first();

/** Revisa sin scroll de página, sin desborde horizontal y diálogos dentro del viewport. */
async function revisar(page, testInfo, momento) {
  const r = await page.evaluate(REVISAR);
  if (r.scrollV > 1) nota(testInfo, `${momento}: scroll vertical de página de ${r.scrollV}px (alto ${r.vh})`);
  if (r.scrollH > 1) nota(testInfo, `${momento}: desborde horizontal de ${r.scrollH}px`);
  for (const d of r.dialogos) {
    if (d.cortado && !d.scrollPropio) nota(testInfo, `${momento}: diálogo «${d.titulo}» cortado (${d.top}..${d.bottom} / ${d.left}..${d.right})`);
    if (d.fueraBotones.length) nota(testInfo, `${momento}: botones del diálogo «${d.titulo}» fuera de pantalla: ${d.fueraBotones.join(" | ")}`);
  }
  return r;
}

const filaEnviado = (page, nombre) => page.getByRole("region", { name: "Documentos de la subida" }).locator("li", { hasText: nombre }).first();

async function esperarTerminado(page, nombre, timeout = 25_000) {
  await expect(filaEnviado(page, nombre)).not.toHaveAttribute("data-nivel", "marcha", { timeout });
}

// ─────────────────────────────────────────────────────────────────────────────

test("1 · pantalla vacía: sin scroll, botones y monitor de gasto", async ({ page, context }, testInfo) => {
  await montar(context);
  const errores = await abrirCargar(page);
  await revisar(page, testInfo, "vacía");
  await capturar(page, testInfo, "01-vacia");
  const imp = page.getByRole("button", { name: /Importación histórica/ });
  if (await imp.isVisible()) {
    const b = await imp.boundingBox();
    if (b.height < 44) nota(testInfo, `botón «Importación histórica» de ${Math.round(b.height)}px de alto (< 44 px táctil)`);
  }
  // Monitor de gasto: el popover cabe.
  await page.getByTestId("monitor-gasto-ia-ocr").click();
  await page.waitForTimeout(300);
  const pop = page.locator("[data-radix-popper-content-wrapper]").first();
  const bb = await pop.boundingBox();
  const vp = page.viewportSize();
  if (bb && (bb.x < 0 || bb.x + bb.width > vp.width + 1 || bb.y + bb.height > vp.height + 1)) nota(testInfo, `desglose del gasto fuera de pantalla (${Math.round(bb.x)},${Math.round(bb.y)} ${Math.round(bb.width)}×${Math.round(bb.height)})`);
  await capturar(page, testInfo, "01b-monitor-gasto");
  await page.keyboard.press("Escape");
  expect.soft(errores, "errores JS").toEqual([]);
});

test("2 · rechazos: tipo no admitido, >10 MB, 0 bytes y nombres raros", async ({ page, context }, testInfo) => {
  await montar(context);
  await abrirCargar(page);
  await inputArchivos(page).setInputFiles([
    { name: "notas.txt", mimeType: "text/plain", buffer: Buffer.from("hola") },
    { name: "grande.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(10 * 1024 * 1024 + 10) },
    { name: "vacio.png", mimeType: "image/png", buffer: Buffer.alloc(0) },
    { name: "foto.heic", mimeType: "image/heic", buffer: Buffer.from("x") },
    png("Factura nº 12 — «Ñandú» (copia) 😀 #1 %20 ../../etc.png"),
    png("image.jpg".replace(".jpg", ".png")),
  ]);
  await page.waitForTimeout(500);
  await expect(page.getByText("Tipo de archivo no permitido").first()).toBeVisible();
  await expect(page.getByText("Archivo demasiado grande")).toBeVisible();
  // UI-10: el fichero de 0 bytes se rechaza con aviso en español.
  await expect(page.getByText("Archivo vacío")).toBeVisible();
  await capturar(page, testInfo, "02-rechazos");
  const sel = page.getByRole("region", { name: "Archivos seleccionados" }).or(page.locator("section[aria-label='Archivos seleccionados']"));
  expect(await sel.innerText()).not.toMatch(/vacio\.png/);
  await revisar(page, testInfo, "con seleccionados");
});

test("3 · tanda de 6: éxito, albarán, avisos, Drive caído, sin original y fallido; progreso y toasts", async ({ page, context }, testInfo) => {
  const srv = await montar(context, { demoraMs: 2500 });
  await abrirCargar(page);
  await inputArchivos(page).setInputFiles([png("ok-factura.png"), png("albaran-1.png"), png("avisos.png"), png("drive-caido.png"), png("sinorig.png"), png("fallido.png")]);
  await page.getByRole("button", { name: /Enviar 6 documentos/ }).click();
  await expect(page.getByText(/Procesando \d de 6/)).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(800);
  await revisar(page, testInfo, "procesando");
  await capturar(page, testInfo, "03a-procesando");
  for (const n of ["ok-factura", "albaran-1", "avisos", "drive-caido", "sinorig", "fallido"]) await esperarTerminado(page, n);
  await page.waitForTimeout(400);
  await revisar(page, testInfo, "terminado");
  await capturar(page, testInfo, "03b-terminado");
  expect(srv.registro.iniciar.length).toBe(6);
  // UI-8: Drive caído → texto VISIBLE en la fila (no solo en un tooltip).
  await expect(filaEnviado(page, "drive-caido")).toContainText("Guardada · original pendiente de subir a Drive");
  // Sin original: en rojo y diciéndolo.
  const sinorig = filaEnviado(page, "sinorig");
  await expect(sinorig).toContainText(/sin original/);
  await expect(sinorig.locator("p.text-destructive")).toHaveCount(1);
  const fallido = await filaEnviado(page, "fallido").innerText();
  expect.soft(fallido).toMatch(/OpenAI no ha respondido/);
  await expect(page.getByText("No se ha podido archivar el original")).toBeVisible();
  const alb = await filaEnviado(page, "albaran-1").innerText();
  expect.soft(alb).toMatch(/Albarán/);
});

test("4 · errores al iniciar: 401, 403, 500, cuerpo no JSON, success:false y Storage 413", async ({ page, context }, testInfo) => {
  const srv = await montar(context, {
    iniciar: (nombre) => {
      if (nombre.includes("e401")) return { status: 401, body: { success: false, error: "Usuario no autenticado" } };
      if (nombre.includes("e403")) return { status: 403, body: { success: false, error: "Sin permisos sobre la sección de facturas" } };
      if (nombre.includes("e500")) return { status: 500, body: "<html><body>Internal Server Error</body></html>", contentType: "text/html" };
      if (nombre.includes("nojson")) return { status: 200, body: "<html>oops</html>", contentType: "text/html" };
      if (nombre.includes("falso")) return { status: 200, body: { success: false, error: "Demasiadas piezas: como mucho 40" } };
      return null;
    },
  });
  await abrirCargar(page);
  await inputArchivos(page).setInputFiles([png("e401.png"), png("e403.png"), png("e500.png"), png("nojson.png"), png("falso.png")]);
  await page.getByRole("button", { name: /Enviar 5 documentos/ }).click();
  for (const n of ["e401", "e403", "e500", "nojson", "falso"]) await esperarTerminado(page, n);
  await page.waitForTimeout(300);
  await capturar(page, testInfo, "04-errores-iniciar");
  // UI-3: el motivo del servidor (o un texto en español por código), nunca «Edge Function returned a non-2xx…».
  for (const [n, esperado] of [["e401", /sesi[oó]n|autenticad/i], ["e403", /permiso/i], ["e500", /El servidor ha fallado/i]]) {
    const txt = (await filaEnviado(page, n).innerText()).replace(/\s+/g, " ");
    expect.soft(txt, n).toMatch(esperado);
    expect.soft(txt, n).not.toMatch(/Edge Function|non-2xx/i);
  }
  const falso = await filaEnviado(page, "falso").innerText();
  expect.soft(falso).toMatch(/Demasiadas piezas/);
  // Reintentar uno: vuelve a subir y a iniciar.
  const antes = srv.registro.iniciar.length;
  await filaEnviado(page, "falso").getByRole("button", { name: /Reintentar/ }).click();
  await esperarTerminado(page, "falso");
  expect(srv.registro.iniciar.length).toBe(antes + 1);
  await revisar(page, testInfo, "errores");
});

test("4b · Storage rechaza la subida (413) y Storage con RLS 403 (sesión caducada)", async ({ page, context }, testInfo) => {
  let modo = "413";
  const srv = await montar(context, {
    storage: () => (modo === "413"
      ? { status: 400, body: { statusCode: "413", error: "Payload too large", message: "The object exceeded the maximum allowed size" } }
      : { status: 400, body: { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" } }),
  });
  await abrirCargar(page);
  await inputArchivos(page).setInputFiles([png("grande-storage.png")]);
  await page.getByRole("button", { name: /Enviar 1 documento/ }).click();
  await esperarTerminado(page, "grande-storage");
  // UI-12: Storage 413 en español.
  const t413 = (await filaEnviado(page, "grande-storage").innerText()).replace(/\s+/g, " ");
  expect(t413).toMatch(/pesa demasiado para subirlo \(máximo 10 MB\)/);
  expect(t413).not.toMatch(/exceeded|maximum allowed/i);
  await capturar(page, testInfo, "04b-storage-413");
  modo = "403";
  await inputArchivos(page).setInputFiles([png("rls.png")]);
  await page.getByRole("button", { name: /Enviar 1 documento/ }).click();
  await esperarTerminado(page, "rls");
  // UI-5: un 403/RLS de Storage es sesión caducada o sin permiso: se dice y NO se cae al camino síncrono.
  expect(srv.registro.sincrono).not.toContain("rls.png");
  await expect(filaEnviado(page, "rls")).toContainText(/sesión ha caducado o no tienes permiso/);
  await expect(filaEnviado(page, "rls")).toHaveAttribute("data-nivel", "fallido");
});

test("5 · duplicado sustituible: pop-up → Sustituir → confirmar", async ({ page, context }, testInfo) => {
  const srv = await montar(context);
  await abrirCargar(page);
  await inputArchivos(page).setInputFiles([png("sust-1.png")]);
  await page.getByRole("button", { name: /Enviar 1 documento/ }).click();
  const pop = page.getByRole("dialog", { name: /ya estaba subida/ });
  await expect(pop).toBeVisible({ timeout: 25_000 });
  await page.waitForTimeout(400);
  const r = await revisar(page, testInfo, "pop-up duplicado");
  await capturar(page, testInfo, "05a-popup-duplicado");
  // UI-2: los 5 botones caben (se parten en filas): ninguno fuera de pantalla.
  for (const d of r.dialogos) expect(d.fueraBotones, `botones fuera del pop-up «${d.titulo}»`).toEqual([]);
  // UI-13: concordancia con «Esta factura».
  const desc = await pop.innerText();
  expect(desc).toMatch(/ya estaba guardada\. No se ha creado otra\./);
  await pop.getByRole("button", { name: "Sustituir por la nueva" }).click();
  const conf = page.getByRole("alertdialog");
  await expect(conf).toBeVisible();
  await page.waitForTimeout(500);
  await revisar(page, testInfo, "confirmar sustituir");
  await capturar(page, testInfo, "05b-confirmar-sustituir");
  // UI-13: fechas en formato es-ES.
  const textoConf = await conf.innerText();
  expect(textoConf).not.toMatch(/2026-10-01/);
  expect(textoConf).toMatch(/01\/10\/2026/);
  await expect(conf.getByRole("button", { name: "Sí, sustituir" })).toBeEnabled();
  await conf.getByRole("button", { name: "Sí, sustituir" }).click();
  await expect(conf).toBeHidden({ timeout: 10_000 });
  await expect(page.getByText("Factura sustituida")).toBeVisible();
  expect(srv.registro.decisiones.length).toBe(1);
  await expect(page.locator("section[aria-label='Pendientes de decidir']")).toHaveCount(0);
  await capturar(page, testInfo, "05c-sustituida");
});

test("6 · «No, dejar la que hay» en la confirmación DESCARTA el pendiente en el servidor (ocr_descartar_trabajo)", async ({ page, context }, testInfo) => {
  const srv = await montar(context);
  await abrirCargar(page);
  await inputArchivos(page).setInputFiles([png("sust-2.png")]);
  await page.getByRole("button", { name: /Enviar 1 documento/ }).click();
  const pop = page.getByRole("dialog", { name: /ya estaba subida/ });
  await expect(pop).toBeVisible({ timeout: 25_000 });
  await pop.getByRole("button", { name: "Sustituir por la nueva" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "No, dejar la que hay" }).click();
  // UI-4: se descarta en el servidor y desaparece de «Pendientes de decidir» (y del indicador).
  await expect.poll(() => srv.registro.descartes.length, { timeout: 10_000 }).toBe(1);
  expect(srv.tablas.ocr_trabajos[0].estado).toBe("cancelado");
  await expect(page.locator("section[aria-label='Pendientes de decidir']")).toHaveCount(0);
  await expect(filaEnviado(page, "sust-2")).toContainText(/has decidido dejar la que había/);
  await expect(page.getByRole("button", { name: /por decidir/ })).toHaveCount(0);
  await capturar(page, testInfo, "06-dejar-la-que-hay");
});

test("6b · servidor sin la RPC: «No, dejar la que hay» se recuerda en este navegador (como antes)", async ({ page, context }) => {
  const srv = await montar(context, { sinRpcTrabajos: true });
  await abrirCargar(page);
  await inputArchivos(page).setInputFiles([png("sust-6b.png")]);
  await page.getByRole("button", { name: /Enviar 1 documento/ }).click();
  const pop = page.getByRole("dialog", { name: /ya estaba subida/ });
  await expect(pop).toBeVisible({ timeout: 25_000 });
  await pop.getByRole("button", { name: "Dejar la que hay" }).click();
  await expect(page.locator("section[aria-label='Pendientes de decidir']")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("facturas.pendientesDescartados") ?? "")).toContain(srv.tablas.ocr_trabajos[0].id);
  expect(srv.registro.descartes).toEqual([]);
});

test("7 · sustituir: la factura cambió (FacturaCambiada) y sin permiso de edición (403)", async ({ page, context }, testInfo) => {
  let vez = 0;
  await montar(context, {
    decision: () => {
      vez++;
      if (vez === 1) return { status: 200, body: { success: false, error: "No se ha sustituido nada: la factura ha cambiado desde que la viste (tiene ahora 7 líneas)" } };
      return { status: 403, body: { success: false, error: "Sustituir una factura exige permiso de edición en Facturas" } };
    },
  });
  await abrirCargar(page);
  await inputArchivos(page).setInputFiles([png("sust-3.png")]);
  await page.getByRole("button", { name: /Enviar 1 documento/ }).click();
  await expect(page.getByRole("dialog", { name: /ya estaba subida/ })).toBeVisible({ timeout: 25_000 });
  await page.getByRole("dialog").getByRole("button", { name: "Sustituir por la nueva" }).click();
  const conf = page.getByRole("alertdialog");
  await conf.getByRole("button", { name: "Sí, sustituir" }).click();
  await expect(conf.getByRole("alert")).toContainText("La factura ha cambiado");
  await capturar(page, testInfo, "07a-factura-cambiada");
  await conf.getByRole("button", { name: "Sí, sustituir" }).click();
  await expect(conf.getByRole("alert")).toContainText("permiso de edición");
  await revisar(page, testInfo, "403 sustituir");
  await capturar(page, testInfo, "07b-sin-permiso");
});

test("8 · página suelta (añadir como página 2 de 3)", async ({ page, context }, testInfo) => {
  const srv = await montar(context);
  await abrirCargar(page);
  await inputArchivos(page).setInputFiles([png("pagina-2.png")]);
  await page.getByRole("button", { name: /Enviar 1 documento/ }).click();
  await expect(page.getByText(/es otra página de A26\/60875/)).toBeVisible({ timeout: 25_000 });
  const boton = page.getByRole("button", { name: /Añadir como página 2 a la factura A26\/60875/ });
  await expect(boton).toBeVisible();
  await revisar(page, testInfo, "pendiente página");
  await capturar(page, testInfo, "08a-pagina-suelta");
  const bb = await boton.boundingBox();
  if (bb.x + bb.width > page.viewportSize().width + 1) nota(testInfo, `botón «Añadir como página…» se sale por la derecha (${Math.round(bb.x + bb.width)}px)`);
  await boton.click();
  const conf = page.getByRole("alertdialog");
  await expect(conf).toContainText("¿Añadir como página 2 de 3");
  await revisar(page, testInfo, "confirmar añadir");
  await capturar(page, testInfo, "08b-confirmar-anadir");
  await conf.getByRole("button", { name: "Sí, añadir la página" }).click();
  await expect(conf).toBeHidden({ timeout: 10_000 });
  expect(srv.registro.decisiones[0].modo).toBe("anadir_pagina");
  await expect(filaEnviado(page, "pagina-2")).toContainText("Añadido como página");
});

test("9 · tres duplicados no sustituibles seguidos: pop-ups en fila, Escape y foco", async ({ page, context }, testInfo) => {
  await montar(context);
  await abrirCargar(page);
  await inputArchivos(page).setInputFiles([png("dup-a.png"), png("dup-b.png"), png("dup-c.png")]);
  await page.getByRole("button", { name: /Enviar 3 documentos/ }).click();
  const pop = page.getByRole("dialog", { name: /ya estaba subida/ });
  await expect(pop).toBeVisible({ timeout: 25_000 });
  await page.waitForTimeout(3500);
  await revisar(page, testInfo, "pop-up dup");
  await capturar(page, testInfo, "09a-duplicados");
  await expect(pop).toContainText(/Hay 2 avisos más/);
  // Foco dentro del diálogo y Escape lo cierra (pasa al siguiente).
  const focoDentro = await page.evaluate(() => !!document.activeElement?.closest("[role=dialog]"));
  expect.soft(focoDentro, "el foco entra en el pop-up").toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toContainText(/Hay 1 aviso más/);
  await page.waitForTimeout(500);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toContainText(/aviso más/);
  await page.waitForTimeout(500);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(filaEnviado(page, "dup-a")).toContainText("No se ofrece sustituirlo: la existente tiene ediciones a mano");
  await capturar(page, testInfo, "09b-duplicados-lista");
});

test("10 · trabajo que tarda en el servidor: a los 16 min «Sigue en el servidor» (no rojo) y se sigue EL MISMO trabajo", async ({ page, context }, testInfo) => {
  await page.clock.install();
  const srv = await montar(context);
  await abrirCargar(page);
  await inputArchivos(page).setInputFiles([png("colgado.png")]);
  await page.getByRole("button", { name: /Enviar 1 documento/ }).click();
  await expect(filaEnviado(page, "colgado")).toContainText(/Leyendo el documento|En cola/, { timeout: 20_000 });
  await page.clock.fastForward("16:30");
  await page.clock.runFor(4000);
  // UI-1: no es un fallo: sigue en marcha, sin rojo y sin «Reintentar» que cree otro trabajo.
  await expect(filaEnviado(page, "colgado")).toContainText("Sigue en el servidor", { timeout: 20_000 });
  await expect(filaEnviado(page, "colgado")).toHaveAttribute("data-nivel", "marcha");
  await expect(filaEnviado(page, "colgado").getByRole("button", { name: /Reintentar/ })).toHaveCount(0);
  await capturar(page, testInfo, "10-colgado");
  // El servidor termina: se recoge con el sondeo lento (30 s) y sin crear otro trabajo.
  srv.terminarTrabajo(srv.tablas.ocr_trabajos[0].id, "colgado.png");
  await expect(async () => {
    await page.clock.runFor(31_000);
    await expect(filaEnviado(page, "colgado")).toHaveAttribute("data-nivel", "ok", { timeout: 1500 });
  }).toPass({ timeout: 20_000 });
  expect(srv.registro.iniciar.length).toBe(1);
});

test("10b · trabajo fallido: «Reintentar» reanuda EL MISMO trabajo (ocr_reintentar_trabajo), sin volver a subirlo", async ({ page, context }, testInfo) => {
  const srv = await montar(context);
  await abrirCargar(page);
  await inputArchivos(page).setInputFiles([png("fallido-10b.png")]);
  await page.getByRole("button", { name: /Enviar 1 documento/ }).click();
  await expect(filaEnviado(page, "fallido-10b")).toHaveAttribute("data-nivel", "fallido", { timeout: 25_000 });
  const subidasAntes = srv.registro.subidas.length;
  await filaEnviado(page, "fallido-10b").getByRole("button", { name: /Reintentar/ }).click();
  await expect(filaEnviado(page, "fallido-10b")).toHaveAttribute("data-nivel", "ok", { timeout: 25_000 });
  expect(srv.registro.reintentos).toEqual([srv.tablas.ocr_trabajos[0].id]);
  expect(srv.registro.iniciar.length).toBe(1);
  expect(srv.registro.subidas.length).toBe(subidasAntes);
  await capturar(page, testInfo, "10b-reanudado");
});

test("10c · el servidor ya no tiene los ficheros: lo explica y «Volver a subir» (trabajo nuevo)", async ({ page, context }, testInfo) => {
  const srv = await montar(context, { ficherosBorrados: () => true });
  await abrirCargar(page);
  await inputArchivos(page).setInputFiles([png("fallido-10c.png")]);
  await page.getByRole("button", { name: /Enviar 1 documento/ }).click();
  await expect(filaEnviado(page, "fallido-10c")).toHaveAttribute("data-nivel", "fallido", { timeout: 25_000 });
  await filaEnviado(page, "fallido-10c").getByRole("button", { name: /Reintentar/ }).click();
  await expect(filaEnviado(page, "fallido-10c")).toContainText(/ya no están en el servidor: vuelve a subirlo/, { timeout: 10_000 });
  expect(srv.registro.iniciar.length).toBe(1);
  await capturar(page, testInfo, "10c-volver-a-subir");
  await filaEnviado(page, "fallido-10c").getByRole("button", { name: /Volver a subir/ }).click();
  await expect.poll(() => srv.registro.iniciar.length, { timeout: 10_000 }).toBe(2);
});

test("11 · navegar fuera con subidas en curso, volver y campana al terminar", async ({ page, context }, testInfo) => {
  const srv = await montar(context, { demoraMs: 7000 });
  await abrirCargar(page);
  await inputArchivos(page).setInputFiles([png("ok-nav.png")]);
  await page.getByRole("button", { name: /Enviar 1 documento/ }).click();
  await expect(filaEnviado(page, "ok-nav")).toContainText(/Leyendo|En cola/, { timeout: 15_000 });
  // Navegación SPA (menú) a otra sección.
  await page.evaluate(() => { window.history.pushState({}, "", "/dashboard"); window.dispatchEvent(new PopStateEvent("popstate")); });
  await page.waitForTimeout(1200);
  // UI-14: fuera de Facturas se ve el indicador (pie del menú ≥ 1024 px; flotante por debajo).
  const indicador = page.getByRole("button", { name: /Facturas: 1 procesando/ });
  await expect(indicador).toBeVisible();
  await expect(indicador).toBeInViewport();
  await capturar(page, testInfo, "11a-fuera-de-cargar");
  await expect.poll(() => srv.falso.escrituras.filter((e) => e.includes("notificaciones_dashboard")).length, { timeout: 25_000 }).toBe(1);
  await expect(page.getByText("Factura guardada")).toBeVisible();
  await page.evaluate(() => { window.history.pushState({}, "", "/facturas?tab=cargar"); window.dispatchEvent(new PopStateEvent("popstate")); });
  await expect(filaEnviado(page, "ok-nav")).toHaveAttribute("data-nivel", "ok");
});

test("12 · recargar: adopta trabajos en curso (y uno colgado desde hace 20 h)", async ({ page, context }, testInfo) => {
  const hace = (h) => new Date(Date.now() - h * 3600_000).toISOString();
  const srv = await montar(context, {
    trabajosPrevios: [
      { id: "00000000-0000-4000-8000-0000000000a1", estado: "paginas", num_paginas: 4, nombre_original: "largo-en-curso.pdf", error: null, resultado: null, factura_id: null, creado_por: "00000000-0000-4000-8000-00000000e2e1", created_at: hace(0.05), updated_at: hace(0.01) },
      { id: "00000000-0000-4000-8000-0000000000a2", estado: "pagina1", num_paginas: 1, nombre_original: "colgado-de-ayer.jpg", error: null, resultado: null, factura_id: null, creado_por: "00000000-0000-4000-8000-00000000e2e1", created_at: hace(20), updated_at: hace(20) },
    ],
  });
  await abrirCargar(page);
  await page.waitForTimeout(1500);
  const lista = page.getByRole("region", { name: "Documentos de la subida" });
  await expect(lista).toContainText("largo-en-curso.pdf");
  // UI-9: el parado desde hace 20 h sale con su estado real y NO cuenta como «procesando».
  const colgado = filaEnviado(page, "colgado-de-ayer.jpg");
  await expect(colgado).toContainText("Parado en el servidor");
  await expect(colgado).not.toContainText("Leyendo");
  await expect(colgado).toHaveAttribute("data-nivel", "aviso");
  await expect(page.getByText(/Procesando 0 de 1/)).toBeVisible();
  await revisar(page, testInfo, "adoptados");
  await capturar(page, testInfo, "12-adoptados");
  // «Quitar» el parado lo descarta en el servidor (deja de adoptarse en cada carga).
  await colgado.getByRole("button", { name: /Quitar colgado-de-ayer\.jpg/ }).click();
  await expect.poll(() => srv.registro.descartes).toEqual(["00000000-0000-4000-8000-0000000000a2"]);
  await expect(lista.getByText("colgado-de-ayer.jpg")).toHaveCount(0);
});

test("13 · cerrar la pestaña mientras se sube avisa (beforeunload) y el envío se puede cancelar", async ({ page, context }, testInfo) => {
  await montar(context, { storage: () => ({ demoraMs: 8000 }) });
  await abrirCargar(page);
  await inputArchivos(page).setInputFiles([png("subida-lenta.png")]);
  await page.getByRole("button", { name: /Enviar 1 documento/ }).click();
  await expect(filaEnviado(page, "subida-lenta")).toContainText(/Subiendo/, { timeout: 10_000 });
  // UI-11: hay botón para cancelarlo.
  await expect(filaEnviado(page, "subida-lenta").getByRole("button", { name: "Cancelar subida-lenta.png" })).toBeVisible();
  await capturar(page, testInfo, "13-subiendo");
  let avisado = false;
  page.on("dialog", async (d) => { avisado = d.type() === "beforeunload"; await d.dismiss(); });
  await page.close({ runBeforeUnload: true });
  await new Promise((r) => setTimeout(r, 800));
  expect.soft(avisado, "aviso beforeunload al cerrar con una subida en el navegador").toBe(true);
});

test("13b · cancelar: subiendo (no se crea el trabajo) y leyéndose en el servidor (ocr_descartar_trabajo)", async ({ page, context }, testInfo) => {
  const srv0 = { lenta: true };
  const srv = await montar(context, { storage: (p) => (p.includes("/01.") && srv0.lenta ? { demoraMs: 4000 } : null) });
  await abrirCargar(page);
  await inputArchivos(page).setInputFiles([png("cancelar-subiendo.png")]);
  await page.getByRole("button", { name: /Enviar 1 documento/ }).click();
  await expect(filaEnviado(page, "cancelar-subiendo")).toContainText(/Subiendo/, { timeout: 10_000 });
  await filaEnviado(page, "cancelar-subiendo").getByRole("button", { name: "Cancelar cancelar-subiendo.png" }).click();
  await expect(page.getByText("cancelar-subiendo.png")).toHaveCount(0);
  await page.waitForTimeout(5000); // termina la subida: aun así no se crea el trabajo
  expect(srv.registro.iniciar).toEqual([]);

  srv0.lenta = false;
  await inputArchivos(page).setInputFiles([png("colgado-cancelar.png")]);
  await page.getByRole("button", { name: /Enviar 1 documento/ }).click();
  await expect(filaEnviado(page, "colgado-cancelar")).toContainText(/Leyendo el documento|En cola/, { timeout: 15_000 });
  await capturar(page, testInfo, "13b-leyendo-con-cancelar");
  await filaEnviado(page, "colgado-cancelar").getByRole("button", { name: "Cancelar colgado-cancelar.png" }).click();
  await expect.poll(() => srv.registro.descartes.length, { timeout: 10_000 }).toBe(1);
  expect(srv.tablas.ocr_trabajos.find((t) => t.nombre_original === "colgado-cancelar.png")?.estado).toBe("cancelado");
  await expect(page.getByText("colgado-cancelar.png")).toHaveCount(0);
});

test("14 · unir fotos como un documento y enviarlo (documento largo)", async ({ page, context }, testInfo) => {
  const srv = await montar(context);
  await abrirCargar(page);
  await inputArchivos(page).setInputFiles([png("hoja-1.png"), png("hoja-2.png"), png("hoja-3.png")]);
  for (const n of ["hoja-1.png", "hoja-2.png", "hoja-3.png"]) await page.getByRole("checkbox", { name: `Marcar ${n} para unirla con otras fotos` }).check();
  await page.getByRole("button", { name: /Unir 3 fotos como un documento/ }).click();
  const subir = page.getByRole("button", { name: /Subir la página 2/ });
  await expect(subir).toBeVisible();
  // UI-15: objetivo táctil de 44 px.
  const b = await subir.boundingBox();
  expect(Math.round(b.height), "alto de la flecha").toBeGreaterThanOrEqual(44);
  expect(Math.round(b.width), "ancho de la flecha").toBeGreaterThanOrEqual(44);
  await revisar(page, testInfo, "fotos unidas");
  await capturar(page, testInfo, "14a-unidas");
  await page.getByRole("button", { name: /Enviar 1 documento/ }).click();
  await esperarTerminado(page, "hoja-1 (3 páginas)");
  expect(srv.registro.subidas.length, "original PDF + 3 piezas").toBe(4);
  await capturar(page, testInfo, "14b-unidas-enviadas");
});

test("15 · PDF de 3 páginas (documento largo) y PDF de una", async ({ page, context }, testInfo) => {
  const srv = await montar(context, { demoraMs: 2500 });
  await abrirCargar(page);
  await inputArchivos(page).setInputFiles([await pdf("largo-3.pdf", 3), await pdf("una.pdf", 1)]);
  await page.getByRole("button", { name: /Enviar 2 documentos/ }).click();
  await expect(filaEnviado(page, "largo-3")).toContainText(/3 trozos/, { timeout: 15_000 });
  await capturar(page, testInfo, "15a-pdf-largo");
  await esperarTerminado(page, "largo-3");
  await esperarTerminado(page, "una.pdf");
  expect(srv.registro.subidas.filter((p) => p.includes("pendientes/")).length).toBe(4 + 1);
  await capturar(page, testInfo, "15b-pdf-largo-fin");
});

test("16 · muchos documentos: la lista hace scroll por dentro, la página no", async ({ page, context }, testInfo) => {
  await montar(context, { demoraMs: 800 });
  await abrirCargar(page);
  const files = Array.from({ length: 18 }, (_, i) => png(`${i % 3 === 0 ? "avisos" : i % 3 === 1 ? "dup" : "ok"}-lote-${String(i + 1).padStart(2, "0")}-con-un-nombre-de-fichero-larguisimo-de-escaner.png`));
  await inputArchivos(page).setInputFiles(files);
  await revisar(page, testInfo, "18 seleccionados");
  await capturar(page, testInfo, "16a-18-seleccionados");
  const enviar = page.getByRole("button", { name: /Enviar 18 documentos/ });
  await expect(enviar).toBeInViewport();
  await enviar.click();
  await page.waitForTimeout(25_000);
  // Cerrar los pop-ups de duplicado que se acumulan.
  for (let i = 0; i < 8 && (await page.getByRole("dialog").count()); i++) { await page.keyboard.press("Escape"); await page.waitForTimeout(250); }
  await revisar(page, testInfo, "18 enviados");
  await capturar(page, testInfo, "16b-18-enviados");
  const limpiar = page.getByRole("button", { name: "Limpiar terminados" });
  await expect(limpiar).toBeInViewport();
  // UI-16: ningún aviso (toast) lo tapa: lo que hay en su centro es el propio botón.
  const tapado = await limpiar.evaluate((b) => {
    const r = b.getBoundingClientRect();
    const arriba = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !(arriba && (arriba === b || b.contains(arriba)));
  });
  expect(tapado, "«Limpiar terminados» tapado por un aviso").toBe(false);
});

test("17 · contraste del botón principal (F8) y barra de progreso con fondo claro (UI-7)", async ({ page, context }) => {
  await montar(context, { demoraMs: 6000 });
  await abrirCargar(page);
  const lum = (rgb) => {
    const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const foto = page.getByRole("button", { name: /Hacer foto/ });
  const colores = await foto.evaluate((b) => ({ fondo: getComputedStyle(b).backgroundColor, texto: getComputedStyle(b).color }));
  const [l1, l2] = [lum(colores.fondo), lum(colores.texto)].sort((a, b) => b - a);
  expect((l1 + 0.05) / (l2 + 0.05), "contraste de «Hacer foto»").toBeGreaterThanOrEqual(4.5);
  await inputArchivos(page).setInputFiles([png("ok-17a.png"), png("ok-17b.png")]);
  await page.getByRole("button", { name: /Enviar 2 documentos/ }).click();
  const barra = page.getByRole("progressbar", { name: "Progreso de la subida" });
  await expect(barra).toBeVisible({ timeout: 10_000 });
  const { fondo, relleno } = await barra.evaluate((b) => ({ fondo: getComputedStyle(b).backgroundColor, relleno: getComputedStyle(b.firstElementChild).backgroundColor }));
  expect(lum(fondo), "fondo de la barra claro").toBeGreaterThan(0.5);
  expect(lum(fondo) / Math.max(lum(relleno), 0.001), "relleno visible sobre el fondo").toBeGreaterThan(3);
});
