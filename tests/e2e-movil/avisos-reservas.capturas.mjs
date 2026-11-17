// Capturas de Reservas › Avisos (CAS-9, 17/11/2026) con el Supabase falso de esta carpeta: nada sale a Supabase ni a
// Internet. Avisos de reservas nuevas (unas pendientes, otra ya verificada) y canceladas, con sus reservas sintéticas.
//
//   VITE_SUPABASE_URL=https://e2e-falso.supabase.co VITE_SUPABASE_ANON_KEY=anon-falsa npx vite build
//   npx vite preview --port 4173 --strictPort --host 127.0.0.1 &
//   node tests/e2e-movil/avisos-reservas.capturas.mjs [carpeta-de-capturas]
//
// Saca móvil (390×844) y escritorio (1280×800): el modal de avisos abierto desde el Dashboard (`?avisos=reservas`),
// comprueba que no hay botón «Pendientes» y avisa si algo se desborda en horizontal. No entra en `npm test`.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { instalarSupabaseFalso } from "./supabase-falso.mjs";
import { tablas, rpcSinteticas, funcionesSinteticas } from "./datos-sinteticos.mjs";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173";
const URL_SUPABASE = process.env.E2E_SUPABASE_URL ?? "https://e2e-falso.supabase.co";
const SALIDA = process.argv[2] ?? "capturas-avisos-reservas";
const ahora = Date.now();
const hace = (min) => new Date(ahora - min * 60_000).toISOString();

function datos() {
  const t = tablas();
  const pend = t.reservas.filter((r) => r.estado === "pendiente").slice(0, 3);
  const verif = t.reservas.find((r) => r.estado === "verificada");
  const conf = t.reservas.filter((r) => r.estado === "confirmada").slice(0, 2);
  for (const r of conf) Object.assign(r, { estado: "cancelada", cancelada_por: "cliente" });
  const detalle = (r) => `${r.nombre} · ${r.fecha.slice(8, 10)}/${r.fecha.slice(5, 7)} ${r.hora.slice(0, 5)} · ${r.numero_comensales} pers. · ${r.canal === "web" ? "web" : "teléfono"}`;
  let n = 0;
  const aviso = (tipo, titulo, r, min, leida = false) => ({
    id: `00000000-0000-4000-8000-${String(900000 + ++n).padStart(12, "0")}`, tipo, titulo, mensaje: detalle(r) + (tipo === "reserva_cancelada" ? " · la canceló el cliente" : ""),
    referencia_id: r.id, referencia_tipo: "reserva", prioridad: "normal", leida, created_at: hace(min), caduca_en: null, datos: null,
  });
  t.notificaciones_dashboard = [
    aviso("reserva_nueva", "Reserva nueva", pend[0], 5),
    aviso("reserva_cancelada", "Reserva cancelada", conf[0], 12),
    aviso("reserva_nueva", "Reserva nueva", pend[1], 30),
    aviso("reserva_nueva", "Reserva nueva", verif, 45),
    aviso("reserva_cancelada", "Reserva cancelada", conf[1], 70),
    aviso("reserva_nueva", "Reserva nueva", pend[2], 90),
  ];
  return t;
}
const rpc = { ...rpcSinteticas, marcar_avisos_revisados: () => 1 };

const VISTAS = [
  { nombre: "movil-390", viewport: { width: 390, height: 844 }, dpr: 2, movil: true },
  { nombre: "escritorio-1280", viewport: { width: 1280, height: 800 }, dpr: 1 },
];

await mkdir(SALIDA, { recursive: true });
const navegador = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
let fallos = 0;
for (const v of VISTAS) {
  const context = await navegador.newContext({ viewport: v.viewport, deviceScaleFactor: v.dpr, isMobile: !!v.movil, hasTouch: !!v.movil, locale: "es-ES", timezoneId: "Europe/Madrid" });
  await instalarSupabaseFalso(context, { urlSupabase: URL_SUPABASE, tablas: datos(), rpc, funciones: funcionesSinteticas });
  const page = await context.newPage();
  const errores = [];
  page.on("pageerror", (e) => errores.push(e.message));
  // Sin «Pendientes» en Reservas.
  await page.goto(`${BASE}/reservas`);
  await page.waitForTimeout(2500);
  if (await page.getByTestId("boton-pendientes").count()) { fallos++; console.log(`${v.nombre}: sigue el botón «Pendientes» en Reservas`); }
  await page.screenshot({ path: path.join(SALIDA, `reservas-${v.nombre}.png`) });
  // Lista: tampoco.
  if (!v.movil) {
    await page.goto(`${BASE}/reservas?tab=reservas`);
    await page.waitForTimeout(2000);
    if (await page.getByRole("button", { name: /^Pendientes/ }).count()) { fallos++; console.log(`${v.nombre}: sigue el botón «Pendientes» en la Lista`); }
    await page.screenshot({ path: path.join(SALIDA, `lista-${v.nombre}.png`) });
  }
  // Desde el Dashboard: Reservas con el modal de avisos abierto.
  await page.goto(`${BASE}/reservas?avisos=reservas`);
  const modal = page.getByRole("dialog", { name: /Avisos de reservas/ });
  await modal.waitFor({ timeout: 20_000 }).catch(() => { fallos++; console.log(`${v.nombre}: no se abrió el modal con ?avisos=reservas`); });
  await page.waitForTimeout(1500);
  const verificar = await modal.getByRole("button", { name: /^Verificar la reserva/ }).count();
  const revisado = await modal.getByRole("button", { name: /^Marcar como revisado/ }).count();
  console.log(`${v.nombre}: ${verificar} «Verificar» y ${revisado} «Revisado» en el modal`);
  await page.screenshot({ path: path.join(SALIDA, `avisos-${v.nombre}.png`) });
  await modal.screenshot({ path: path.join(SALIDA, `avisos-modal-${v.nombre}.png`) }).catch(() => {});
  const [ancho, visible] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  if (ancho > visible) { fallos++; console.log(`${v.nombre}: la página se desborda en horizontal (${ancho} px de ${visible})`); }
  if (errores.length) { fallos++; console.log(`${v.nombre}: errores de la página: ${errores.join(" | ")}`); }
  await context.close();
}
await navegador.close();
console.log(fallos ? `Capturas en ${SALIDA} con ${fallos} aviso(s).` : `Capturas en ${SALIDA}: todo bien.`);
process.exitCode = fallos ? 1 : 0;
