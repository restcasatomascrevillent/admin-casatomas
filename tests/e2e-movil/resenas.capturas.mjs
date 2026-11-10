// Capturas de Super Admin › Reseñas Google (contestador) con el Supabase falso de esta carpeta: nada sale a Supabase ni a
// Internet. Reseñas sintéticas en todos los estados del contestador (pendiente, propuesta, aprobada, publicada, error).
//
//   VITE_SUPABASE_URL=https://e2e-falso.supabase.co VITE_SUPABASE_ANON_KEY=anon-falsa npx vite build
//   npx vite preview --port 4173 --strictPort --host 127.0.0.1 &
//   node tests/e2e-movil/resenas.capturas.mjs [carpeta-de-capturas]
//
// Saca escritorio (1280×800) y móvil (375×812): la lista y, en móvil, una reseña abierta. No entra en `npm test`.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { instalarSupabaseFalso } from "./supabase-falso.mjs";
import { tablas, rpcSinteticas, funcionesSinteticas } from "./datos-sinteticos.mjs";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173";
const URL_SUPABASE = process.env.E2E_SUPABASE_URL ?? "https://e2e-falso.supabase.co";
const SALIDA = process.argv[2] ?? "capturas-resenas";

const hace = (d) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
const r = (i, x) => ({
  id: `00000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`,
  fuente: "google", estado: "publicada", email: null, google_rating: x.valoracion, google_review_id: `g${i}`,
  respuesta: null, fecha_respuesta: null, respuesta_propuesta: null, respuesta_estado: "pendiente", respuesta_origen: null,
  respuesta_modelo: null, respuesta_automatica: false, respuesta_error: null, gbp_review_name: null,
  google_maps_uri: `https://www.google.com/maps/reviews/data=!4m8!14m7!1m6!2m5!1sCh${i}`,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...x,
});
const RESENAS = [
  r(1, { nombre_cliente: "Marta Ruiz", valoracion: 5, fecha: hace(1), comentario: "Fuimos a celebrar el cumpleaños de mi padre y todo perfecto. El pulpo a feira y el arroz con bogavante, espectaculares. El trato de Tomás y su familia, como en casa.", respuesta_estado: "propuesta", respuesta_origen: "ia", respuesta_modelo: "gpt-4.1-mini", respuesta_propuesta: "Gracias, Marta. Nos alegra mucho que el cumpleaños de tu padre saliera tan bien y que el pulpo y el arroz con bogavante estuvieran a la altura. Para nosotros sois parte de la casa: os esperamos pronto.\n\nEl equipo de Casa Tomás" }),
  r(2, { nombre_cliente: "Javier P.", valoracion: 2, fecha: hace(2), comentario: "La comida bien, pero esperamos casi 40 minutos al segundo plato y nadie nos dijo nada.", respuesta_estado: "propuesta", respuesta_origen: "ia", respuesta_modelo: "gpt-4.1-mini", respuesta_propuesta: "Gracias por contárnoslo, Javier. Sentimos mucho la espera del segundo plato y, sobre todo, no haberos avisado: no es como queremos que se sienta nadie en casa. Nos encantaría hablarlo contigo en persona la próxima vez que vengas.\n\nEl equipo de Casa Tomás" }),
  r(3, { nombre_cliente: "Lucía Fernández", valoracion: 5, fecha: hace(4), comentario: null }),
  r(4, { nombre_cliente: "Andrés M.", valoracion: 4, fecha: hace(6), comentario: "Muy buen producto. Los precios algo altos pero se nota la calidad.", respuesta_estado: "aprobada", respuesta_origen: "editada", respuesta_propuesta: "Gracias, Andrés. Trabajamos cada día con el mejor producto que encontramos y nos alegra que se note. Te esperamos.\n\nEl equipo de Casa Tomás" }),
  r(5, { nombre_cliente: "Elena", valoracion: 5, fecha: hace(12), comentario: "Las croquetas de jamón, de las mejores que he probado.", respuesta: "Gracias, Elena. Las croquetas son receta de la casa desde 1998: nos hace mucha ilusión que te gustaran.\n\nEl equipo de Casa Tomás", respuesta_estado: "publicada", respuesta_origen: "google", fecha_respuesta: new Date(Date.now() - 10 * 864e5).toISOString() }),
  r(6, { nombre_cliente: "Paul Smith", valoracion: 5, fecha: hace(15), comentario: "Amazing seafood, friendly staff. Highly recommended!", respuesta_estado: "error", respuesta_error: "Business Profile (responder): 403 · The caller does not have permission", respuesta_propuesta: "Thank you, Paul! We are so glad you enjoyed our seafood. We hope to welcome you back soon.\n\nEl equipo de Casa Tomás", gbp_review_name: "accounts/1/locations/2/reviews/x" }),
  r(7, { nombre_cliente: "Rosa Gil", valoracion: 3, fecha: hace(40), comentario: "Bien sin más. El local muy bonito.", estado: "oculta" }),
];

function datos() {
  const t = tablas();
  t.resenas = RESENAS;
  t.config_google_places = [{ id: "c1", place_id: "ChIJsS3PCWq5Yw0RL0gH6hiZvu0", place_name: "Casa Tomás Restaurante", rating_promedio: 4.7, total_resenas: 412, ultima_sincronizacion: new Date(Date.now() - 3 * 3600e3).toISOString() }];
  t.resenas_ajustes = [{ id: true, proponer_automatico: true, autorespuesta_activa: false, autorespuesta_estrellas: [4, 5], autorespuesta_sin_texto: true, firma: "El equipo de Casa Tomás", indicaciones: "", gbp_ubicacion: null, gbp_ubicacion_nombre: null, gbp_email: null, ultimo_ciclo: new Date(Date.now() - 3 * 3600e3).toISOString(), ultimo_ciclo_resumen: { propuestas: 2, automaticas: 0 } }];
  return t;
}
const funciones = {
  ...funcionesSinteticas,
  "resenas-contestador": async (req) => {
    let c = {}; try { c = JSON.parse(req.postData() || "{}"); } catch { /* vacío */ }
    if (c.accion === "estado") return { ok: true, ia: true, google: { configurada: false, conectada: false, redirect_uri: `${URL_SUPABASE}/functions/v1/resenas-contestador` } };
    return { ok: true };
  },
};

const VISTAS = [
  { nombre: "escritorio-1280", viewport: { width: 1280, height: 800 }, dpr: 1 },
  { nombre: "movil-375", viewport: { width: 375, height: 812 }, dpr: 2, movil: true },
];

await mkdir(SALIDA, { recursive: true });
const navegador = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
for (const v of VISTAS) {
  const context = await navegador.newContext({ viewport: v.viewport, deviceScaleFactor: v.dpr, isMobile: !!v.movil, hasTouch: !!v.movil, locale: "es-ES", timezoneId: "Europe/Madrid" });
  const { sinMock } = await instalarSupabaseFalso(context, { urlSupabase: URL_SUPABASE, tablas: datos(), rpc: rpcSinteticas, funciones });
  const page = await context.newPage();
  await page.goto(`${BASE}/super-admin/resenas`);
  await page.getByTestId("lista-resenas").waitFor({ timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const base = path.join(SALIDA, v.nombre);
  await page.screenshot({ path: `${base}-lista.png` });
  const [ancho, visible] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  if (ancho > visible) console.log(`${v.nombre}: la página se desborda en horizontal (${ancho} px de ${visible})`);
  const abrir = page.getByTestId("resena-abrir").first();
  if (await abrir.count()) {
    await abrir.click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${base}-respuesta.png` });
  }
  const ajustes = page.getByTestId("resenas-contestador-ajustes");
  if (await ajustes.count()) {
    await page.keyboard.press("Escape").catch(() => {});
    await ajustes.getByRole("button").first().click().catch(() => {});
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${base}-ajustes.png`, fullPage: true });
  }
  const google = page.getByTestId("resenas-google-plegable");
  if (await google.count()) {
    await page.reload();
    await page.getByTestId("lista-resenas").waitFor({ timeout: 20_000 }).catch(() => {});
    await google.getByRole("button").first().click().catch(() => {});
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${base}-google.png`, fullPage: true });
  }
  if (sinMock.size) console.log(`${v.nombre}: sin mock →`, [...sinMock].join(", "));
  await context.close();
}
await navegador.close();
console.log(`Capturas en ${SALIDA}`);
