// Capturas de Super Admin › Logs › Errores e incidencias (10/11/2026) con el Supabase falso de esta carpeta:
// nada sale a Supabase ni a Internet. Datos SINTÉTICOS que imitan lo visto en producción ese día
// (fallo de pg_cron, fichero caducado tras publicar, incidencias de solo bots), sin datos reales.
//
//   VITE_SUPABASE_URL=https://e2e-falso.supabase.co VITE_SUPABASE_ANON_KEY=anon-falsa npx vite build
//   npx vite preview --port 4173 --strictPort --host 127.0.0.1 &
//   node tests/e2e-movil/logs-incidencias.capturas.mjs [carpeta] [prefijo]
//
// Saca la lista y dos detalles en 375×812 y 1280×800. No entra en `npm test`.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { instalarSupabaseFalso } from "./supabase-falso.mjs";
import { tablas } from "./datos-sinteticos.mjs";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173";
const URL_SUPABASE = process.env.E2E_SUPABASE_URL ?? "https://e2e-falso.supabase.co";
const SALIDA = process.argv[2] ?? "capturas-logs";
const PREFIJO = process.argv[3] ?? "";
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const AHORA = "2026-11-10T10:45:00Z";

const base = {
  entorno: "produccion", proyecto: "casa-tomas-story", estado: "nueva", ocurrencias_ventana: 0, sesiones_ventana: 0, ocurrencias_24h: 0, rutas: [],
  version_primera: "1.1.1", version_ultima: "1.1.1", despliegue_ultimo: null, pila: null, requiere_ticket: false, motivo_ticket: null,
  linear_estado: "sin_ticket", linear_issue_id: null, linear_identificador: null, linear_url: null, linear_estado_remoto: null, linear_destino: null,
  linear_intentos: 0, linear_ultimo_error: null, linear_proximo_intento: null, linear_creado_en: null, linear_pendiente_reapertura: false,
  linear_uuid: "00000000-0000-4000-8000-000000000000", ocurrencias_en_ticket: 0, analisis_ia: null, analisis_ia_en: null, analisis_ia_error: null,
  resuelta_en: null, reabierta_veces: 0, nota: null, actualizado_en: AHORA, ejemplo_evento_id: null,
};
const incidencias = [
  { ...base, id: 21, huella: "a1".repeat(16), titulo: "job startup timeout · cron:*", tipo: "error_integracion", fuente: "integracion", proyecto: "supabase",
    gravedad: "error", estado: "abierta", primera_vez: "2026-11-08T16:20:00Z", ultima_vez: "2026-11-08T21:53:00Z", ocurrencias: 94, sesiones_afectadas: 0,
    mensaje: "job startup timeout", version_primera: null, version_ultima: null, linear_estado: "creado", linear_identificador: "PRUEBA-8", linear_destino: "prueba",
    motivo_ticket: "94 ocurrencias y 0 sesiones en 24 h (umbral 3 y 2)" },
  { ...base, id: 22, huella: "b2".repeat(16), titulo: "TypeError: Failed to fetch dynamically imported module: https://restaurante.example/assets/NovedadesSection.js · novedades",
    tipo: "error_react", fuente: "navegador", gravedad: "error", primera_vez: "2026-11-10T01:26:53Z", ultima_vez: "2026-11-10T02:45:35Z", ocurrencias: 2, sesiones_afectadas: 2,
    rutas: [{ ruta: "/en", n: 1 }, { ruta: "/", n: 1 }], mensaje: "TypeError: Failed to fetch dynamically imported module: https://restaurante.example/assets/NovedadesSection-D-0lW2q6.js",
    pila: "TypeError: Failed to fetch dynamically imported module: https://restaurante.example/assets/NovedadesSection-D-0lW2q6.js\nat Lazy\nat Suspense\nat uD (https://restaurante.example/assets/app-CNgJpX6V.js:158:[num])" },
  { ...base, id: 23, huella: "c3".repeat(16), titulo: "TypeError: Cannot read properties of null (reading 'precio')", tipo: "error_js", fuente: "navegador", gravedad: "error",
    primera_vez: "2026-11-09T18:00:00Z", ultima_vez: "2026-11-10T09:12:00Z", ocurrencias: 7, sesiones_afectadas: 5, ocurrencias_24h: 4, rutas: [{ ruta: "/carta/vinos", n: 7 }],
    mensaje: "TypeError: Cannot read properties of null (reading 'precio')", pila: "TypeError: Cannot read properties of null (reading 'precio')\nat CartaVinos (https://restaurante.example/assets/CartaVinos-B7x9Qa1c.js:1:2345)",
    linear_estado: "pendiente", motivo_ticket: "4 ocurrencias y 3 sesiones en 24 h (umbral 3 y 2)" },
  { ...base, id: 24, huella: "d4".repeat(16), titulo: "Sin respuesta de rest:menus_diarios · rest:menus_diarios", tipo: "error_peticion", fuente: "navegador", gravedad: "error",
    primera_vez: "2026-11-10T00:00:04Z", ultima_vez: "2026-11-10T00:00:04Z", ocurrencias: 0, sesiones_afectadas: 0, mensaje: "Sin respuesta de rest:menus_diarios" },
  { ...base, id: 25, huella: "e5".repeat(16), titulo: "Página no encontrada", tipo: "error_404", fuente: "navegador", gravedad: "aviso",
    primera_vez: "2026-11-09T21:51:33Z", ultima_vez: "2026-11-09T21:51:33Z", ocurrencias: 0, sesiones_afectadas: 0, mensaje: "Página no encontrada" },
];

const ev = (id, incidencia_id, o) => ({
  id, evento_id: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`, recibido_en: o.ocurrido_en, entorno: "produccion", proyecto: "casa-tomas-story",
  fuente: "navegador", categoria: "error", accion: null, sesion_id: null, visitante_id: null, secuencia: null, ruta: null, objetivo: null, valor: null, propiedades: {},
  dispositivo: null, navegador: null, so: null, es_bot: false, es_interno: false, es_prueba: false, consentimiento: false, version: null, despliegue: null,
  gravedad: "error", huella: null, mensaje: null, pila: null, incidencia_id, ...o,
});
const tareas = ["reanudar-trabajos-ocr", "reanudar-trabajos-ocr", "instagram-programador", "clasificar-productos", "facturas-originales-drive", "reservas-aviso-sin-asignar", "emails-reserva-reintentar-fallidos"];
const eventos = [
  ...tareas.map((t, n) => ev(100 + n, 21, { tipo: "error_integracion", fuente: "integracion", proyecto: "supabase", objetivo: "cron:*", propiedades: { tarea: t },
    mensaje: "job startup timeout", ocurrido_en: `2026-11-08T21:${String(53 - n).padStart(2, "0")}:00Z` })),
  ev(200, 22, { tipo: "error_react", ruta: "/en", objetivo: "novedades", propiedades: { componente: "novedades" }, navegador: "Chrome", so: "Android", dispositivo: "movil", version: "1.1.1",
    sesion_id: "11111111-1111-4111-8111-111111111111", mensaje: incidencias[1].mensaje, pila: incidencias[1].pila, ocurrido_en: "2026-11-10T01:26:53Z" }),
  ev(201, 22, { tipo: "error_react", ruta: "/", objetivo: "espacios", propiedades: { componente: "espacios" }, navegador: "Chrome", so: "Windows", dispositivo: "escritorio", version: "1.1.1",
    sesion_id: "22222222-2222-4222-8222-222222222222", mensaje: "Error: Unable to preload CSS for /assets/EspaciosGallery-CmTTVDlw.css",
    pila: "Error: Unable to preload CSS for /assets/EspaciosGallery-CmTTVDlw.css\nat HTMLLinkElement.<anonymous> (https://restaurante.example/assets/app-CNgJpX6V.js:69:8659)", ocurrido_en: "2026-11-10T02:45:35Z" }),
];

function datos() {
  const t = tablas();
  t.web_incidencias = incidencias;
  t.web_eventos = eventos;
  t.web_linear_prueba = [];
  t.web_logs_config = [{ id: true, entorno_bd: "produccion", linear_modo: "prueba", entornos_aceptados: ["produccion", "demo"], entornos_ticket: ["produccion"],
    recoger_actividad: true, recoger_errores_navegador: true, ia_activada: true }];
  return t;
}
const rpc = {
  web_logs_estado_recogida: () => ({
    ahora: AHORA, entorno: "produccion", fuentes: [{ fuente: "navegador", ultimo_recibido: "2026-11-10T10:40:00Z", n_1h: 12, n_24h: 240 }], primer_evento: "2026-11-08T19:56:00Z",
    primer_evento_por_categoria: {}, primer_evento_por_tipo: {}, ingesta: [{ dia: "2026-11-10", aceptados: 240, duplicados: 0, descartados: 0, rechazados: 0, bots: 9 }],
    proceso: { ultimo_proceso_inicio: AHORA, ultimo_proceso_fin: AHORA, ultimo_proceso_ok: AHORA, ultimo_error: null, ultimo_resumen: {}, ultima_purga: null },
    config: { linear_modo: "prueba", entornos_aceptados: ["produccion", "demo"], entornos_ticket: ["produccion"], recoger_actividad: true, recoger_errores_navegador: true },
    vercel_ultimo_dia: { fecha: "2026-11-09", visitas: 40 },
  }),
  web_contexto_evento: () => [],
  web_buscar_eventos: () => [],
};

const TAMANOS = [{ nombre: "movil", width: 375, height: 812 }, { nombre: "escritorio", width: 1280, height: 800 }];
const PANTALLAS = [
  { nombre: "lista", ruta: "/super-admin/logs?tab=errores" },
  { nombre: "detalle-cron", ruta: "/super-admin/logs?tab=errores&incidencia=21" },
  { nombre: "detalle-chunk", ruta: "/super-admin/logs?tab=errores&incidencia=22" },
];

await mkdir(SALIDA, { recursive: true });
const navegador = await chromium.launch();
try {
  for (const t of TAMANOS) {
    const contexto = await navegador.newContext({ viewport: { width: t.width, height: t.height }, deviceScaleFactor: 2, locale: "es-ES", timezoneId: "Europe/Madrid", reducedMotion: "reduce" });
    await contexto.addInitScript(() => {
      const fija = new Date("2026-11-10T11:45:00+01:00").valueOf();
      const DateReal = Date;
      // eslint-disable-next-line no-global-assign
      Date = class extends DateReal { constructor(...a) { super(...(a.length ? a : [fija])); } static now() { return fija; } };
    });
    await instalarSupabaseFalso(contexto, { urlSupabase: URL_SUPABASE, tablas: datos(), rpc });
    const pagina = await contexto.newPage();
    for (const p of PANTALLAS) {
      await pagina.goto(`${BASE}${p.ruta}`);
      await pagina.getByTestId("logs-web").waitFor({ timeout: 20_000 });
      if (p.nombre === "lista") await pagina.getByTestId("tabla-incidencias").or(pagina.getByTestId("sin-incidencias")).first().waitFor({ timeout: 20_000 });
      else await pagina.getByTestId("detalle-incidencia").getByText("Ocurrencias", { exact: true }).first().waitFor({ timeout: 20_000 });
      await espera(600);
      const archivo = path.join(SALIDA, `${PREFIJO}${p.nombre}-${t.nombre}.png`);
      if (p.nombre === "lista") await pagina.screenshot({ path: archivo, fullPage: true });
      else await pagina.getByTestId("detalle-incidencia").screenshot({ path: archivo });
      console.log(archivo);
    }
    await contexto.close();
  }
} finally {
  await navegador.close();
}
