// Capturas del chat de facturas «calidad percibida» (18/11/2026) en móvil (375) y tablet (768), con datos sintéticos:
// espera con texto de progreso y «Parar», respuesta con pie de datos y botones de paso siguiente, y «no lo encuentro»
// con nombres parecidos. Mide el desborde horizontal y que la página no tenga scroll vertical.
//
//   node tests/e2e-movil/chat-calidad.capturas.mjs <url> [carpeta]
//
// <url>: el panel servido con VITE_SUPABASE_URL=https://e2e-falso.supabase.co (vite o vite preview).
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { instalarSupabaseFalso } from "./supabase-falso.mjs";
import { tablas, rpcSinteticas, funcionesSinteticas } from "./datos-sinteticos.mjs";

const BASE = process.argv[2] ?? "http://localhost:4173";
const SALIDA = process.argv[3] ?? "test-results/chat-calidad";
const URL_SUPABASE = process.env.E2E_SUPABASE_URL ?? "https://e2e-falso.supabase.co";
mkdirSync(SALIDA, { recursive: true });

const TAMANOS = [
  { nombre: "movil-375", width: 375, height: 812, movil: true },
  { nombre: "tablet-768", width: 768, height: 1024, movil: true },
];

const RESPUESTA = {
  success: true,
  respuesta: "**Heineken 1/3: 41,85 € por caja de 24**, sin IVA.\n\nÚltima factura: 002816, de Distribuciones de Bebidas Catral, 30/10/2026.",
  modelo: "sim",
  traza: { herramientas: [{ nombre: "compras_producto", argumentos: { producto: "heineken 1/3" }, resultado: "completada" }] },
  ayuda: { datos_hasta: "2026-11-12" },
};
const SIN_NOMBRE = {
  success: true,
  respuesta: "No lo encuentro con ese nombre. Lo he buscado entero y por partes. ¿Será alguno de estos?",
  sin_datos: true,
  modelo: "sim",
  traza: { herramientas: [{ nombre: "compras_producto", argumentos: { producto: "laurent perrier" }, resultado: "completada" }] },
  ayuda: { sugerencias: ["C/6B LP LA CUVEE", "LAURENT-PERRIER ROSE BRUT"] },
};

const medir = (page) =>
  page.evaluate(() => {
    const ancho = document.documentElement.clientWidth;
    return {
      paginaX: document.scrollingElement.scrollWidth - ancho,
      paginaY: document.scrollingElement.scrollHeight - window.innerHeight,
    };
  });

const resultados = [];
const navegador = await chromium.launch();
try {
  for (const t of TAMANOS) {
    const contexto = await navegador.newContext({ viewport: { width: t.width, height: t.height }, isMobile: t.movil, hasTouch: t.movil, deviceScaleFactor: 1, locale: "es-ES", timezoneId: "Europe/Madrid", reducedMotion: "reduce" });
    let n = 0;
    await instalarSupabaseFalso(contexto, {
      urlSupabase: URL_SUPABASE,
      tablas: tablas(),
      rpc: rpcSinteticas,
      funciones: {
        ...funcionesSinteticas,
        "chat-facturas": async () => {
          n += 1;
          await new Promise((r) => setTimeout(r, n === 1 ? 9000 : 500));
          return n === 1 ? RESPUESTA : SIN_NOMBRE;
        },
      },
    });
    const page = await contexto.newPage();
    const errores = [];
    page.on("pageerror", (e) => errores.push(e.message));
    await page.goto(`${BASE}/facturas/ia`, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Pregunta para el asistente").waitFor({ timeout: 90_000 });
    await page.waitForTimeout(800);

    const foto = async (nombre, pantalla) => {
      const archivo = `${nombre}-${t.nombre}.png`;
      await page.screenshot({ path: path.join(SALIDA, archivo) });
      resultados.push({ tamano: t.nombre, pantalla, archivo, ...(await medir(page)) });
    };

    await foto("0-inicio", "Sugerencias de inicio");
    await page.getByLabel("Pregunta para el asistente").fill("precio heineken 1/3");
    await page.getByRole("button", { name: "Enviar pregunta" }).click();
    await page.waitForTimeout(6500);
    await foto("1-espera", "Espera con progreso y Parar");
    await page.getByText("Datos hasta 12/11/2026").waitFor({ timeout: 20_000 });
    await page.waitForTimeout(400);
    await foto("2-respuesta", "Respuesta con pie y pasos siguientes");

    await page.getByLabel("Pregunta para el asistente").fill("precio laurent perrier");
    await page.getByRole("button", { name: "Enviar pregunta" }).click();
    await page.getByText("¿Es alguno de estos?").waitFor({ timeout: 20_000 });
    await page.waitForTimeout(400);
    await foto("3-no-lo-encuentro", "No lo encuentro con pista");
    if (errores.length) resultados.push({ tamano: t.nombre, errores });
    await contexto.close();
  }
} finally {
  await navegador.close();
}
writeFileSync(path.join(SALIDA, "resultados.json"), JSON.stringify(resultados, null, 2));
for (const r of resultados) console.log(r.tamano, "|", r.pantalla ?? "errores", "| desborde X:", r.paginaX, "| scroll Y página:", r.paginaY, r.errores ? r.errores.join(" ; ") : "");
process.exit(resultados.some((r) => r.paginaX > 0) ? 1 : 0);
