// ---------------------------------------------------------------------------
// Graba los vídeos del Centro de Ayuda: abre cada sección, lanza su tour
// guiado y lo avanza paso a paso (~4 s por paso), en 1280x800. El tour cambia
// solo de pestaña; el script solo pulsa «Siguiente»: nunca envía preguntas al
// chatbot (cuestan dinero) ni guarda nada.
// Salida: public/ayuda/videos/<seccion>.webm (los usa centroAyuda.ts → videoUrl).
//
// Uso (con el panel en marcha: `npm run dev`, puerto 8080):
//   1) Una vez:   npx playwright install chromium
//   2) Sesión:    node scripts/videos-ayuda/grabar.mjs --login
//                 (se abre un navegador: inicia sesión a mano y se guarda
//                  scripts/videos-ayuda/.sesion.json; NO se sube a git)
//   3) Grabar:    npm run videos:ayuda   (o node scripts/videos-ayuda/grabar.mjs)
//
// Variables opcionales: PANEL_URL (por defecto http://localhost:8080),
// SEGUNDOS_PASO (por defecto 4), SOLO=facturas|gestor-web.
// ---------------------------------------------------------------------------
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, "..", "..");
const SESION = join(AQUI, ".sesion.json");
const SALIDA = join(RAIZ, "public", "ayuda", "videos");
const BASE = process.env.PANEL_URL ?? "http://localhost:8080";
const MS_PASO = Number(process.env.SEGUNDOS_PASO ?? 4) * 1000;
const TAMANO = { width: 1280, height: 800 };

const SECCIONES = [
  { id: "facturas", ruta: "/facturas?tab=compras" },
  { id: "gestor-web", ruta: "/gestion-web?tab=carta" },
];

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function guardarSesion() {
  const navegador = await chromium.launch({ headless: false });
  const contexto = await navegador.newContext({ viewport: TAMANO });
  const pagina = await contexto.newPage();
  await pagina.goto(`${BASE}/auth`);
  console.log("Inicia sesión en la ventana que se ha abierto (tienes 5 minutos)…");
  await pagina.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 5 * 60_000 });
  await esperar(2000); // que Supabase termine de guardar la sesión en localStorage
  await contexto.storageState({ path: SESION });
  await navegador.close();
  console.log(`Sesión guardada en ${SESION}`);
}

async function grabarSeccion(navegador, { id, ruta }) {
  const carpetaVideo = mkdtempSync(join(tmpdir(), `video-ayuda-${id}-`));
  const contexto = await navegador.newContext({
    storageState: SESION,
    viewport: TAMANO,
    recordVideo: { dir: carpetaVideo, size: TAMANO },
  });
  const pagina = await contexto.newPage();
  await pagina.goto(`${BASE}${ruta}`, { waitUntil: "networkidle" });
  if (new URL(pagina.url()).pathname.startsWith("/auth")) {
    await contexto.close();
    throw new Error("La sesión ha caducado: vuelve a ejecutar con --login.");
  }

  // El tour puede lanzarse solo (primera visita del usuario); si no, se pulsa «?».
  await esperar(1500);
  if (!(await pagina.locator(".driver-popover").isVisible())) {
    await pagina.locator('[data-tour="boton-ayuda"]:visible').first().click();
  }
  await pagina.locator(".driver-popover").waitFor({ state: "visible", timeout: 10_000 });

  let pasos = 0;
  for (;;) {
    await esperar(MS_PASO);
    pasos += 1;
    const popover = pagina.locator(".driver-popover");
    if (!(await popover.isVisible())) break;
    const siguiente = popover.locator(".driver-popover-next-btn");
    const texto = (await siguiente.textContent())?.trim();
    await siguiente.click();
    if (texto === "Entendido") break;
    if (pasos > 40) throw new Error(`El tour de ${id} no termina`);
  }
  await esperar(1200);

  const video = pagina.video();
  await contexto.close(); // el vídeo se escribe al cerrar el contexto
  const destino = join(SALIDA, `${id}.webm`);
  rmSync(destino, { force: true });
  renameSync(await video.path(), destino);
  rmSync(carpetaVideo, { recursive: true, force: true });
  const mb = statSync(destino).size / 1024 / 1024;
  console.log(`${id}: ${pasos} pasos → ${destino} (${mb.toFixed(1)} MB)`);
}

async function grabar() {
  if (!existsSync(SESION)) {
    console.error("No hay sesión guardada. Ejecuta antes: node scripts/videos-ayuda/grabar.mjs --login");
    process.exit(1);
  }
  mkdirSync(SALIDA, { recursive: true });
  const navegador = await chromium.launch();
  try {
    const solo = process.env.SOLO;
    for (const seccion of SECCIONES.filter((s) => !solo || s.id === solo)) {
      await grabarSeccion(navegador, seccion);
    }
  } finally {
    await navegador.close();
  }
  console.log("Vídeos en public/ayuda/videos:", readdirSync(SALIDA).join(", "));
}

if (process.argv.includes("--login")) await guardarSesion();
else await grabar();
