// Capturas del flujo «foto de la etiqueta → puntuación Parker» (08/11/2026) con el Supabase falso de esta carpeta:
// nada sale a Supabase ni a Internet; la lectura de la etiqueta (extraer-vino-foto) y la búsqueda
// (buscar-puntuacion-parker) están simuladas con retardo para ver el estado «buscando». Datos marcados «SIM».
//
//   VITE_SUPABASE_URL=https://e2e-falso.supabase.co VITE_SUPABASE_ANON_KEY=anon-falsa npx vite build
//   npx vite preview --port 4173 --strictPort --host 127.0.0.1 &
//   node tests/e2e-movil/parker-foto.capturas.mjs [carpeta-de-capturas]
//
// Escenarios: 1) añada legible → busca sola → verificada con fuente; 2) añada no legible → la pide → revisión con
// fuentes contradictorias; 3) la búsqueda falla y la ficha se puede guardar; 4) edición: puntuaciones guardadas,
// «Se sirve esta añada» y avisos de la lista. No entra en `npm test`.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { instalarSupabaseFalso } from "./supabase-falso.mjs";
import { tablas } from "./datos-sinteticos.mjs";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173";
const URL_SUPABASE = process.env.E2E_SUPABASE_URL ?? "https://e2e-falso.supabase.co";
const SALIDA = process.argv[2] ?? "capturas-parker";
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const ahora = "2026-11-08T10:00:00Z";

const vino = (id, nombre, extra = {}) => ({
  id, nombre, categoria: "VINOS TINTOS — RIBERA DEL DUERO", denominacion_origen: "D.O. Ribera del Duero", precio_eur: 60,
  ubicacion_pais: "España", ubicacion_region: "Peñafiel, Valladolid", activado: true, restaurante: true, touza: true, expanded: false,
  imagen_url: null, orden: 1, alergenos_oficiales: [], copeo: false, anada: null, sin_anada: false, puntuacion_parker: null,
  puntuacion_parker_anada: null, puntuacion_parker_texto: null, created_at: ahora, updated_at: ahora, ...extra,
});
const fuente = { entidad: "Robert Parker Wine Advocate", fecha_consulta: "2026-11-08", discrepancias: [], provisional: false, motivo: null };

function datos() {
  const t = tablas();
  t.Vinos = [
    vino("sim-aalto", "SIM Aalto 2021", { anada: 2021, puntuacion_parker: 94, puntuacion_parker_anada: 2021, puntuacion_parker_texto: "94" }),
    vino("sim-ps", "SIM Aalto PS", { orden: 2 }),
    vino("sim-pingus", "SIM Pingus", { orden: 3 }),
    vino("sim-collet", "SIM Collet Brut", { orden: 4, categoria: "VINOS ESPUMOSOS — CHAMPAGNE", denominacion_origen: "AOC Champagne", ubicacion_pais: "Francia", ubicacion_region: "Aÿ, Champagne" }),
  ];
  t.vinos_puntuacion_parker = [
    { id: "p1", vino_id: "sim-aalto", anada: 2021, sin_anada: false, estado: "verificada", puntos_texto: "94", puntos_min: 94, puntos_max: 94, vino_evaluado: "2021 Aalto", critico: "Luis Gutiérrez", fecha_valoracion: "2024-06-13", fuente_nombre: "SIM Vin Chicago", fuente_url: "https://vinchicago.com/products/aalto-ribera-del-duero-2021", fuente_tipo: "secundaria", cita: "Wine Advocate : 94 Points (6/13/2024)", notas: null, origen: "revision", updated_at: ahora, ...fuente },
    { id: "p2", vino_id: "sim-ps", anada: 2022, sin_anada: false, estado: "verificada", puntos_texto: "94", puntos_min: 94, puntos_max: 94, vino_evaluado: "2022 Aalto PS", critico: "Luis Gutiérrez", fecha_valoracion: "2025-06", fuente_nombre: "SIM JJ Buckley", fuente_url: "https://www.jjbuckley.com/wine/2022-aalto-ps/2022-1717-750/", fuente_tipo: "secundaria", cita: "94 Wine Advocate — 2022 Aalto PS", notas: null, origen: "revision", updated_at: ahora, ...fuente },
    { id: "p3", vino_id: "sim-pingus", anada: 2023, sin_anada: false, estado: "revision", puntos_texto: "99", puntos_min: 99, puntos_max: 99, vino_evaluado: "Pingus 2023", critico: null, fecha_valoracion: null, fuente_nombre: "SIM Millesima USA", fuente_url: "https://www.millesima-usa.com/dominio-de-pingus-pingus-2023.html", fuente_tipo: "secundaria", cita: null, notas: "Fuente secundaria vista solo en los resultados del buscador: ábrela y, si es correcta, pulsa «Confirmar».", origen: "revision", updated_at: ahora, ...fuente, motivo: "fuentes_contradictorias", discrepancias: [{ fuente_nombre: "SIM Vinissimus", fuente_url: null, puntos_texto: "98-100", nota: "Nota de barrica" }] },
    { id: "p4", vino_id: "sim-collet", anada: null, sin_anada: false, estado: "no_localizada", motivo: "anada_desconocida", puntos_texto: null, puntos_min: null, puntos_max: null, provisional: false, entidad: "Robert Parker Wine Advocate", fuente_nombre: null, fuente_url: null, notas: "La carta no dice qué añada se sirve.", origen: "revision", updated_at: ahora, discrepancias: [] },
  ];
  return t;
}

// ── Funciones simuladas ──
let escenario = "legible";
const etiqueta = {
  nombre: "SIM Cuesta de las Liebres 2021", categoria: "VINOS TINTOS — RIBERA DEL DUERO", descripcion: "Elaboración: SIM. · Cata: SIM. · Maridaje: SIM.",
  ingredientes: "Tempranillo", denominacion_origen: "D.O. Ribera del Duero", ubicacion_region: "Peñafiel, Valladolid", ubicacion_pais: "España",
  precio_sugerido: 220, precio_razon: "SIM Tienda ~85 € × 2,6", precio_mercado: 85, precio_mercado_fuentes: [], recorte: null,
  bodega: "Pago de Carraovejas", cuvee: "Cuesta de las Liebres", anada: 2021, sin_anada: false, identificacion_ambigua: false, motivo_ambiguedad: null,
  puntuaciones_etiqueta: [{ texto: "94 Guía Peñín", puntos: 94, entidad: "Guía Peñín", entidad_tipo: "otra", anada: 2021 }],
};
const funciones = {
  "extraer-vino-foto": async () => {
    await espera(1200);
    if (escenario === "sin-anada") {
      return { ok: true, vino: { ...etiqueta, nombre: "SIM Pícaro del Águila", cuvee: "Pícaro", bodega: "Dominio del Águila", anada: null,
        puntuaciones_etiqueta: [{ texto: "95 points", puntos: 95, entidad: null, entidad_tipo: "desconocida", anada: null }] } };
    }
    return { ok: true, vino: etiqueta };
  },
  "buscar-puntuacion-parker": async (req) => {
    const cuerpo = JSON.parse(req.postData() || "{}");
    await espera(3500);
    if (escenario === "falla") return { ok: false, error: "La búsqueda ha tardado demasiado; prueba otra vez", resultado: { estado: "fallida", motivo: "busqueda_fallida" } };
    if (escenario === "sin-anada") {
      return { ok: true, desde_cache: false, resultado: { ...fuente, estado: "revision", motivo: "fuentes_contradictorias", anada: cuerpo.anada, sin_anada: false,
        puntos_texto: "94", puntos_min: 94, puntos_max: 94, vino_evaluado: `Pícaro del Águila ${cuerpo.anada}`, critico: "Luis Gutiérrez", fecha_valoracion: "2025-06",
        fuente_nombre: "SIM Gourmet Hunters", fuente_url: "https://www.gourmethunters.com/", fuente_tipo: "secundaria", cita: "SIM Robert Parker 94 — 2023",
        discrepancias: [{ fuente_nombre: "SIM Decántalo", fuente_url: "https://www.decantalo.com/", puntos_texto: "93", nota: "Otra tienda da 93 a la misma añada" }],
        notas: "Dos tiendas dan notas distintas: revisa la fuente antes de confirmarla.", comprobado_en_pagina: false } };
    }
    return { ok: true, desde_cache: false, resultado: { ...fuente, estado: "verificada", anada: cuerpo.anada, sin_anada: false, puntos_texto: "95", puntos_min: 95, puntos_max: 95,
      vino_evaluado: "2021 Pago de Carraovejas Cuesta de las Liebres", critico: "Luis Gutiérrez", fecha_valoracion: "2024-06",
      fuente_nombre: "SIM Decántalo", fuente_url: "https://www.decantalo.com/es/pago-de-carraovejas-cuesta-de-las-liebres-2021", fuente_tipo: "secundaria",
      cita: "SIM Robert Parker: 95 (2021) — Luis Gutiérrez", notas: null, comprobado_en_pagina: true } };
  },
  "traducir-contenido": async () => ({ ok: true, translations: {} }),
};

async function botella(pagina) {
  const b64 = await pagina.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 900; c.height = 1200;
    const g = c.getContext("2d");
    g.fillStyle = "#e9e4da"; g.fillRect(0, 0, 900, 1200);
    g.fillStyle = "#2b1d14"; g.fillRect(330, 120, 240, 1000); g.fillRect(400, 20, 100, 140);
    g.fillStyle = "#f5efe2"; g.fillRect(345, 560, 210, 300);
    g.fillStyle = "#7a2e1d"; g.font = "bold 28px Georgia"; g.textAlign = "center";
    g.fillText("SIM ETIQUETA", 450, 650); g.fillText("CUESTA DE", 450, 700); g.fillText("LAS LIEBRES", 450, 740);
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = ""; for (const b of buf) bin += String.fromCharCode(b);
    return btoa(bin);
  });
  return { name: "etiqueta.jpg", mimeType: "image/jpeg", buffer: Buffer.from(b64, "base64") };
}

async function abrirVinos(pagina) {
  await pagina.goto(`${BASE}/gestion-web?tab=carta`, { waitUntil: "networkidle" });
  await pagina.getByRole("button", { name: /^Vinos/ }).first().click().catch(() => pagina.getByText("Vinos", { exact: true }).first().click());
  await pagina.getByRole("button", { name: /Añadir vino/ }).first().waitFor({ timeout: 15000 });
}

async function captura(pagina, nombre, selector = "[role=dialog]") {
  const ruta = path.join(SALIDA, `${nombre}.png`);
  const el = selector ? pagina.locator(selector).last() : null;
  if (el && (await el.count())) await el.screenshot({ path: ruta });
  else await pagina.screenshot({ path: ruta, fullPage: false });
  console.log("captura", ruta);
}

async function alPanelParker(pagina) {
  await pagina.getByTestId("panel-parker").scrollIntoViewIfNeeded();
}

async function main() {
  await mkdir(SALIDA, { recursive: true });
  const navegador = await chromium.launch();
  for (const [ancho, alto, sufijo] of [[1280, 900, "escritorio"], [390, 844, "movil"]]) {
    const contexto = await navegador.newContext({ viewport: { width: ancho, height: alto }, deviceScaleFactor: 2, locale: "es-ES" });
    await instalarSupabaseFalso(contexto, { urlSupabase: URL_SUPABASE, tablas: datos(), funciones });
    const pagina = await contexto.newPage();

    // 1) Añada legible → busca sola → verificada.
    escenario = "legible";
    await abrirVinos(pagina);
    await pagina.getByRole("button", { name: /Añadir vino/ }).first().click();
    await pagina.locator("[role=dialog] input[type=file]").first().setInputFiles(await botella(pagina));
    await pagina.getByTestId("parker-buscando").waitFor({ timeout: 20000 });
    await alPanelParker(pagina);
    await captura(pagina, `1-buscando-${sufijo}`);
    await pagina.getByTestId("parker-resultado").waitFor({ timeout: 20000 });
    await alPanelParker(pagina);
    await captura(pagina, `2-verificada-${sufijo}`);
    await pagina.keyboard.press("Escape");
    await espera(500);

    // 2) Añada no legible → la pide → revisión con fuentes contradictorias.
    escenario = "sin-anada";
    await abrirVinos(pagina); // el formulario cancelado conserva lo escrito: se empieza de cero
    await pagina.getByRole("button", { name: /Añadir vino/ }).first().click();
    await pagina.locator("[role=dialog] input[type=file]").first().setInputFiles(await botella(pagina));
    await pagina.getByTestId("parker-pide-anada").waitFor({ timeout: 20000 });
    await alPanelParker(pagina);
    await captura(pagina, `3-pide-anada-${sufijo}`);
    await pagina.getByLabel("Añada que se sirve").fill("2023");
    await pagina.getByRole("button", { name: "Buscar puntuación" }).click();
    await pagina.getByTestId("parker-resultado").waitFor({ timeout: 20000 });
    await alPanelParker(pagina);
    await captura(pagina, `4-revision-contradictoria-${sufijo}`);
    await pagina.keyboard.press("Escape");
    await espera(500);

    // 3) Falla la búsqueda: aviso y «Guardar Vino» disponible.
    escenario = "falla";
    await abrirVinos(pagina);
    await pagina.getByRole("button", { name: /Añadir vino/ }).first().click();
    await pagina.locator("[role=dialog] input[type=file]").first().setInputFiles(await botella(pagina));
    await pagina.getByText(/La búsqueda falló/).first().waitFor({ timeout: 25000 });
    await alPanelParker(pagina);
    await captura(pagina, `5-fallida-${sufijo}`);
    await pagina.keyboard.press("Escape");
    await espera(500);

    // 4) Lista con avisos y edición con puntuaciones guardadas.
    await abrirVinos(pagina);
    await pagina.getByRole("heading", { name: "SIM Aalto PS" }).scrollIntoViewIfNeeded();
    await captura(pagina, `6-lista-${sufijo}`, null);
    const tarjeta = pagina.getByRole("heading", { name: "SIM Aalto PS" }).locator("xpath=ancestor::*[contains(@class,'rounded-lg')][1]");
    await tarjeta.getByRole("button", { name: /Editar/ }).first().click();
    await pagina.getByTestId("parker-filas").waitFor({ timeout: 15000 });
    await alPanelParker(pagina);
    await captura(pagina, `7-edicion-guardadas-${sufijo}`);
    await pagina.keyboard.press("Escape");
    await contexto.close();
  }
  await navegador.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
