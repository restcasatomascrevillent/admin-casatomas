// Capturas de Newsletter › Enviar (plantillas nuevas y «Crear con IA») para el PR, con el Supabase falso de esta
// carpeta: ninguna petición sale a Supabase ni a Internet (el logo del correo se sirve desde el disco si se pasa
// LOGO=<png>). La Edge Function newsletter-ia está simulada: devuelve una propuesta fija. Nada se envía.
//
//   VITE_SUPABASE_URL=https://e2e-falso.supabase.co VITE_SUPABASE_ANON_KEY=anon-falsa npx vite build
//   npx vite preview --port 4173 --strictPort --host 127.0.0.1 &
//   node tests/e2e-movil/newsletter.capturas.mjs [carpeta] [--antes]
//
// --antes: solo la pantalla inicial y una plantilla elegida (para comparar con la versión anterior del panel).
// Variables: E2E_BASE_URL, E2E_SUPABASE_URL, LOGO, FOTO (jpg para la galería). No entra en `npm test`.
import { chromium } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import { USER_ID, instalarSupabaseFalso } from "./supabase-falso.mjs";
import { tablas } from "./datos-sinteticos.mjs";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173";
const URL_SUPABASE = process.env.E2E_SUPABASE_URL ?? "https://e2e-falso.supabase.co";
const args = process.argv.slice(2);
const ANTES = args.includes("--antes");
const SALIDA = args.find((a) => !a.startsWith("--")) ?? "docs/newsletter/capturas";
const LOGO = process.env.LOGO ? await readFile(process.env.LOGO).catch(() => null) : null;
const FOTO = process.env.FOTO ? await readFile(process.env.FOTO).catch(() => null) : null;

const PROPUESTA = {
  tipo: "evento",
  insignia: "San Valentín",
  titulo: "Una cena para dos en Casa Tomás",
  preheader: "Menú especial el 14 de febrero. Plazas limitadas.",
  bloques: [
    { tipo: "texto", texto: "Este San Valentín os proponemos una cena tranquila, con velas y el mejor producto de temporada." },
    { tipo: "platos", titulo: "El menú", platos: [{ nombre: "Gamba roja de Santa Pola", descripcion: "A la sal, con aceite de ajo" }, { nombre: "Arroz meloso de bogavante" }, { nombre: "Coulant de chocolate", descripcion: "Con helado de vainilla" }] },
    { tipo: "evento", fecha: "Sábado 14 de febrero", hora: "21:00", precio: "[precio por persona]" },
    { tipo: "boton", texto: "Reservar mesa", url: "https://restaurantecasatomascrevillente.es/reservas" },
    { tipo: "firma", texto: "Un abrazo,\nEl equipo de Casa Tomás" },
  ],
};

function tablasCaptura() {
  const t = tablas();
  t.super_admins = [];
  t.user_roles = [{ id: "00000000-0000-4000-8000-000000000002", user_id: USER_ID, role: "manager", created_at: new Date().toISOString() }];
  t.user_permissions = [
    { id: "00000000-0000-4000-8000-000000000300", user_id: USER_ID, section_key: "dashboard", can_view: true, can_edit: false },
    { id: "00000000-0000-4000-8000-000000000302", user_id: USER_ID, section_key: "marketing", can_view: true, can_edit: true },
  ];
  t.newsletter_suscriptores = Array.from({ length: 64 }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(1000 + i).padStart(12, "0")}`, email: `cliente${i}@ejemplo.test`, nombre: `Cliente ${i}`,
    activo: i % 9 !== 0, created_at: new Date(Date.now() - i * 86400000).toISOString(), origen: "reserva",
  }));
  t.newsletter_plantillas = [
    { id: "00000000-0000-4000-8000-000000000a01", nombre: "Jornadas del arroz", descripcion: "", tipo: "menu_temporada", titulo: "Jornadas del arroz",
      insignia: "Jornadas", preheader: "Del 10 al 20 de octubre", bloques: [{ tipo: "texto", texto: "Vuelven las jornadas del arroz." }], origen: "ia",
      creado_por: USER_ID, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  ];
  return t;
}

const funciones = {
  "newsletter-ia": async () => ({ ok: true, propuesta: PROPUESTA, avisos: ["Falta completar: precio por persona."], modelo: "gpt-5.6-luna" }),
};

async function capturar(navegador, ancho, alto, nombre, pasos) {
  const contexto = await navegador.newContext({ viewport: { width: ancho, height: alto }, deviceScaleFactor: 2, locale: "es-ES", timezoneId: "Europe/Madrid" });
  await instalarSupabaseFalso(contexto, { urlSupabase: URL_SUPABASE, tablas: tablasCaptura(), funciones });
  if (LOGO) await contexto.route("https://restaurantecasatomascrevillente.es/logo-casa-tomas.png", (r) => r.fulfill({ status: 200, contentType: "image/png", body: LOGO }));
  if (FOTO) await contexto.route(/supabase\.co\/storage\/v1\/object\/public\//, (r) => r.fulfill({ status: 200, contentType: "image/jpeg", body: FOTO }));
  const pagina = await contexto.newPage();
  const errores = [];
  pagina.on("pageerror", (e) => errores.push(String(e)));
  await pagina.goto(`${BASE}/marketing`);
  await pagina.waitForLoadState("networkidle");
  await pagina.waitForTimeout(600);
  let n = 0;
  for (const [etiqueta, paso] of pasos) {
    if (paso) await paso(pagina);
    await pagina.waitForTimeout(700);
    const scroll = await pagina.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (scroll) console.warn(`  ⚠ ${nombre}-${etiqueta}: scroll horizontal`);
    await pagina.screenshot({ path: `${SALIDA}/${nombre}-${String(++n).padStart(2, "0")}-${etiqueta}.png`, fullPage: false });
  }
  if (errores.length) console.warn(`  errores en ${nombre}:`, errores);
  await contexto.close();
}

await mkdir(SALIDA, { recursive: true });
const navegador = await chromium.launch();
for (const [ancho, alto, disp] of [[375, 812, "movil"], [1280, 800, "escritorio"]]) {
  if (ANTES) {
    await capturar(navegador, ancho, alto, `antes-${disp}`, [
      ["inicio", null],
      ["plantilla", (p) => p.getByRole("radio", { name: /Nuevo Menú/ }).click()],
    ]);
    continue;
  }
  await capturar(navegador, ancho, alto, `despues-${disp}`, [
    ["inicio", null],
    ["plantilla", (p) => p.getByRole("radio", { name: /Menú de temporada/ }).click()],
    ...(disp === "movil" ? [["vista-previa", (p) => p.getByText("Vista previa del email", { exact: true }).first().scrollIntoViewIfNeeded()]] : []),
    ["ia-dialogo", async (p) => {
      await p.getByRole("button", { name: /Crear con IA/ }).first().click();
      await p.getByLabel(/Qué quieres contar/).fill("Cena de San Valentín el sábado 14 de febrero a las 21:00 con menú de gamba roja, arroz de bogavante y coulant. Plazas limitadas.");
    }],
    ["ia-propuesta", async (p) => {
      await p.getByRole("button", { name: /Redactar con IA/ }).click();
      await p.getByText(/Propuesta de la IA cargada/).first().waitFor({ timeout: 5000 }).catch(() => undefined);
    }],
    ["guardar", (p) => p.getByRole("button", { name: /Guardar como plantilla/ }).first().click()],
  ]);
}
await navegador.close();
console.log(`Capturas en ${SALIDA}`);
