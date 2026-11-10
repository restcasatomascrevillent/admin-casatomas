// Capturas de «añada en el nombre» (10/11/2026) con el Supabase falso de esta carpeta: nada sale a
// Supabase ni a Internet. Datos marcados «SIM».
//
//   VITE_SUPABASE_URL=https://e2e-falso.supabase.co VITE_SUPABASE_ANON_KEY=anon-falsa npx vite build
//   npx vite preview --port 4173 --strictPort --host 127.0.0.1 &
//   node tests/e2e-movil/anadas-nombre.capturas.mjs [carpeta-de-capturas]
//
// Escenarios (escritorio 1280 y móvil 375): 1) edición de un vino sin añada: se pone la añada que se
// sirve y aparece «Añadir 2022 al nombre»; 2) tras pulsarlo, el nombre lleva la añada; 3) nombre con
// otra añada: aviso con «Poner … en el nombre». Sin los botones (rama anterior) solo se ve el aviso.
// No entra en `npm test`.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { instalarSupabaseFalso } from "./supabase-falso.mjs";
import { tablas } from "./datos-sinteticos.mjs";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173";
const URL_SUPABASE = process.env.E2E_SUPABASE_URL ?? "https://e2e-falso.supabase.co";
const SALIDA = process.argv[2] ?? "capturas-anadas";
const ahora = "2026-11-10T10:00:00Z";

const vino = (id, nombre, extra = {}) => ({
  id, nombre, categoria: "VINOS TINTOS — RIBERA DEL DUERO", denominacion_origen: "D.O. Ribera del Duero", precio_eur: 60,
  ubicacion_pais: "España", ubicacion_region: "Peñafiel, Valladolid", activado: true, restaurante: true, touza: true, expanded: false,
  imagen_url: null, orden: 1, alergenos_oficiales: [], copeo: false, anada: null, sin_anada: false, puntuacion_parker: null,
  puntuacion_parker_anada: null, puntuacion_parker_texto: null, created_at: ahora, updated_at: ahora, ...extra,
});

function datos() {
  const t = tablas();
  t.Vinos = [
    vino("sim-ps", "SIM Aalto PS"),
    vino("sim-mauro", "SIM Mauro 2019", { orden: 2, anada: 2023 }),
  ];
  t.vinos_puntuacion_parker = [
    { id: "p2", vino_id: "sim-ps", anada: 2022, sin_anada: false, estado: "verificada", puntos_texto: "94", puntos_min: 94, puntos_max: 94,
      vino_evaluado: "2022 Aalto PS", critico: "Luis Gutiérrez", fecha_valoracion: "2025-06", fuente_nombre: "SIM JJ Buckley",
      fuente_url: "https://www.jjbuckley.com/wine/2022-aalto-ps/2022-1717-750/", fuente_tipo: "secundaria", cita: "94 Wine Advocate",
      notas: null, origen: "revision", updated_at: ahora, entidad: "Robert Parker Wine Advocate", fecha_consulta: "2026-11-10",
      discrepancias: [], provisional: false, motivo: null },
  ];
  return t;
}

async function abrirVinos(pagina) {
  await pagina.goto(`${BASE}/gestion-web?tab=carta`, { waitUntil: "networkidle" });
  await pagina.getByRole("button", { name: /^Vinos/ }).first().click().catch(() => pagina.getByText("Vinos", { exact: true }).first().click());
  await pagina.getByRole("button", { name: /Añadir vino/ }).first().waitFor({ timeout: 15000 });
}

async function captura(pagina, nombre) {
  const ruta = path.join(SALIDA, `${nombre}.png`);
  await pagina.getByTestId("panel-parker").scrollIntoViewIfNeeded();
  await pagina.locator("[role=dialog]").last().screenshot({ path: ruta });
  console.log("captura", ruta);
}

async function editar(pagina, nombre) {
  const tarjeta = pagina.getByRole("heading", { name: nombre }).locator("xpath=ancestor::*[contains(@class,'rounded-lg')][1]");
  await tarjeta.getByRole("button", { name: /Editar/ }).first().click();
  await pagina.getByTestId("panel-parker").waitFor({ timeout: 15000 });
}

async function main() {
  await mkdir(SALIDA, { recursive: true });
  const navegador = await chromium.launch();
  for (const [ancho, alto, sufijo] of [[1280, 900, "escritorio"], [375, 812, "movil"]]) {
    const contexto = await navegador.newContext({ viewport: { width: ancho, height: alto }, deviceScaleFactor: 2, locale: "es-ES" });
    await instalarSupabaseFalso(contexto, { urlSupabase: URL_SUPABASE, tablas: datos(), funciones: {} });
    const pagina = await contexto.newPage();

    await abrirVinos(pagina);
    await editar(pagina, "SIM Aalto PS");
    await pagina.getByLabel("Añada que se sirve").fill("2022");
    await captura(pagina, `1-anada-sin-nombre-${sufijo}`);
    const boton = pagina.getByTestId("parker-anada-al-nombre");
    if (await boton.count()) {
      await boton.click();
      await captura(pagina, `2-nombre-con-anada-${sufijo}`);
    }
    await pagina.keyboard.press("Escape");

    await abrirVinos(pagina);
    await editar(pagina, "SIM Mauro 2019");
    await captura(pagina, `3-nombre-otra-anada-${sufijo}`);
    await pagina.keyboard.press("Escape");
    await contexto.close();
  }
  await navegador.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
