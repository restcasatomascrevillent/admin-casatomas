// Capturas de Super Admin › Tráfico web con el Supabase falso de esta carpeta: nada sale a Supabase ni a Internet.
// Datos sintéticos con el volumen real de las webs (decenas de visitas al día, con días flojos y picos), un hueco de
// sincronización, anomalías, Fast Data Transfer del mes y comportamiento de los visitantes.
//
//   VITE_SUPABASE_URL=https://e2e-falso.supabase.co VITE_SUPABASE_ANON_KEY=anon-falsa npx vite build
//   npx vite preview --port 4173 --strictPort --host 127.0.0.1 &
//   node tests/e2e-movil/trafico-web.capturas.mjs [carpeta-de-capturas]
//
// Saca escritorio (1440×900 y 1280×711) y móvil (390×844): la vista tal cual y la página entera (sin el recorte de la
// región con scroll). No entra en `npm test`.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { instalarSupabaseFalso } from "./supabase-falso.mjs";
import { tablas, rpcSinteticas, funcionesSinteticas } from "./datos-sinteticos.mjs";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173";
const URL_SUPABASE = process.env.E2E_SUPABASE_URL ?? "https://e2e-falso.supabase.co";
const SALIDA = process.argv[2] ?? "capturas-trafico-web";

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s) => new Date(`${s}T00:00:00`);
const masDias = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const hoy = iso(new Date());

// ── Serie diaria determinista por web: estacionalidad semanal, ruido, picos y un hueco de sync ──
const ruido = (n) => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };
const BASE_WEB = { "casa-tomas-story": 26, "touza-restaurant-website": 9 };
const PESO_DIA = [0.7, 0.75, 0.85, 1.0, 1.35, 1.6, 1.25]; // lun..dom
function visitasDia(proyecto, fecha) {
  const d = parse(fecha);
  const n = Math.round(d.getTime() / 864e5) + (proyecto === "touza-restaurant-website" ? 999 : 0);
  const desdeHoy = Math.round((parse(hoy).getTime() - d.getTime()) / 864e5);
  if (desdeHoy >= 11 && desdeHoy <= 13) return null; // tres días sin sincronizar
  const crecimiento = 1 + Math.max(0, 120 - desdeHoy) / 260;
  let v = BASE_WEB[proyecto] * PESO_DIA[(d.getDay() + 6) % 7] * crecimiento * (0.65 + 0.7 * ruido(n));
  if (desdeHoy === 6 || desdeHoy === 23) v *= 3.2; // picos (anomalías)
  if (desdeHoy === 38) v *= 0.08; // caída
  return Math.max(0, Math.round(v));
}
const media = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const desv = (xs) => { const m = media(xs); return xs.length > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)) : null; };
function filaSerie(proyecto, fecha) {
  const webs = proyecto ? [proyecto] : Object.keys(BASE_WEB);
  const val = (f) => { const vs = webs.map((w) => visitasDia(w, f)); return vs.some((v) => v === null) ? null : vs.reduce((a, b) => a + b, 0); };
  const v = val(fecha);
  const atras = (n) => Array.from({ length: n }, (_, i) => val(masDias(fecha, -i))).filter((x) => x !== null);
  const dow = Array.from({ length: 8 }, (_, i) => val(masDias(fecha, -7 * (i + 1)))).filter((x) => x !== null);
  const mDow = media(dow), sDow = desv(dow);
  const z = v === null || mDow === null || !sDow ? null : (v - mDow) / sDow;
  return {
    fecha, visitas: v, visitantes: v === null ? null : Math.max(0, Math.round(v * 0.62)),
    media_7: media(atras(7)), media_30: media(atras(30)), desv_30: desv(atras(30)),
    media_dow: mDow, desv_dow: sDow, z_dow: z, es_anomalia: z === null ? null : Math.abs(z) > 2,
    desviacion_pct: v === null || !mDow ? null : (100 * (v - mDow)) / mDow,
  };
}
function serie({ p_proyecto, p_desde, p_hasta }) {
  const filas = [];
  for (let f = p_desde; f <= p_hasta; f = masDias(f, 1)) filas.push(filaSerie(p_proyecto ?? null, f));
  return filas;
}
function tendencia({ p_proyecto, p_dias }) {
  const filas = serie({ p_proyecto, p_desde: masDias(hoy, -p_dias), p_hasta: masDias(hoy, -1) }).filter((f) => f.visitas !== null);
  const n = filas.length; const xs = filas.map((_, i) => i - n); const ys = filas.map((f) => f.visitas);
  const mx = media(xs), my = media(ys);
  const sxy = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0), sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  const pendiente = sxx ? sxy / sxx : 0; const intercepto = my - pendiente * mx;
  const ssr = ys.reduce((a, y, i) => a + (y - (intercepto + pendiente * xs[i])) ** 2, 0), sst = ys.reduce((a, y) => a + (y - my) ** 2, 0);
  // Como la RPC: x = 0 es hoy y la proyección son los 30 días siguientes.
  const proyeccion = Array.from({ length: 30 }, (_, i) => ({ fecha: masDias(hoy, i + 1), visitas: Math.max(0, intercepto + pendiente * (i + 1)) }));
  return [{ pendiente, intercepto, r2: sst ? 1 - ssr / sst : null, n, fiable: n >= 14, total_30d: proyeccion.reduce((a, p) => a + p.visitas, 0), proyeccion }];
}

// ── Fast Data Transfer del mes ──
function fdt() {
  const d = new Date(); const diasMes = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); const dia = d.getDate() - 1;
  const fila = (proyecto, visitas, porVisita) => {
    const bytes = visitas * porVisita; const lineal = dia ? (bytes / dia) * diasMes : null;
    return { proyecto, mes: iso(new Date(d.getFullYear(), d.getMonth(), 1)), visitas_mes: visitas, bytes_acumulados: bytes, bytes_medios_por_visita: porVisita, bytes_proy_lineal: lineal, bytes_proy_regresion: lineal ? lineal * 1.06 : null, limite_bytes: 100e9, pct_limite: (100 * bytes) / 100e9, pct_proyectado: lineal ? (100 * lineal * 1.06) / 100e9 : null, dias_con_dato: dia, dias_mes: diasMes, dias_restantes: diasMes - dia, alerta_80: false };
  };
  const ct = fila("casa-tomas-story", 31 * dia, 4.1e6), tz = fila("touza-restaurant-website", 11 * dia, 2.6e6);
  const total = fila("*", ct.visitas_mes + tz.visitas_mes, (ct.bytes_acumulados + tz.bytes_acumulados) / (ct.visitas_mes + tz.visitas_mes));
  return [total, ct, tz];
}

// ── Páginas y desgloses ──
const PAGINAS = [
  ["casa-tomas-story", "/", 412, 5.8e6], ["casa-tomas-story", "/carta", 233, 7.4e6], ["casa-tomas-story", "/carta/vinos", 151, 9.2e6],
  ["casa-tomas-story", "/reservas", 128, 2.1e6], ["touza-restaurant-website", "/", 96, 3.1e6], ["casa-tomas-story", "/cheques-regalo", 64, 2.4e6],
  ["casa-tomas-story", "/menu-del-dia", 58, 1.9e6], ["touza-restaurant-website", "/menu", 41, 2.8e6], ["casa-tomas-story", "/contacto", 33, 1.2e6],
  ["casa-tomas-story", "/carta/vinos/tintos/ribera-del-duero/una-ruta-bastante-larga-de-ejemplo", 12, 3.3e6],
];
function topPaginas({ p_proyecto, p_orden, p_limite }) {
  const filas = PAGINAS.filter(([p]) => !p_proyecto || p === p_proyecto).map(([proyecto, ruta, visitas, peso]) => ({ proyecto, ruta, visitas, bytes_estimados: visitas * peso }));
  const tv = filas.reduce((a, f) => a + f.visitas, 0), tb = filas.reduce((a, f) => a + f.bytes_estimados, 0);
  return filas.map((f) => ({ ...f, pct_visitas: (100 * f.visitas) / tv, pct_bytes: (100 * f.bytes_estimados) / tb }))
    .sort((a, b) => (p_orden === "bytes" ? b.bytes_estimados - a.bytes_estimados : b.visitas - a.visitas)).slice(0, p_limite ?? 15);
}
const DESGLOSE = {
  device: [["mobile", 812], ["desktop", 301], ["tablet", 38]],
  country: [["ES", 1004], ["FR", 41], ["GB", 33], ["DE", 22], ["NL", 14], ["US", 9], ["IT", 7]],
  referrer: [["google.com", 498], ["(directo)", 377], ["instagram.com", 151], ["l.facebook.com", 46], ["tripadvisor.es", 31], ["bing.com", 12], ["maps.google.com", 9]],
};
function desglose({ p_dimension, p_limite }) {
  const filas = DESGLOSE[p_dimension] ?? []; const t = filas.reduce((a, [, v]) => a + v, 0);
  return filas.slice(0, p_limite ?? 8).map(([valor, visitas]) => ({ valor, visitas, visitantes: Math.round(visitas * 0.6), pct: (100 * visitas) / t }));
}

// ── Comportamiento (RPC web_comportamiento) ──
const resumen = (k) => ({ sesiones: Math.round(184 * k), visitantes_estimados: Math.round(151 * k), paginas_vistas: Math.round(702 * k), paginas_por_sesion: 3.8, sesiones_una_pagina: Math.round(51 * k), tiempo_activo_medio_s: 82, tiempo_activo_mediana_s: 47 * k, scroll_medio: 58, sesiones_inicio_operacion: Math.round(31 * k), sesiones_con_conversion: Math.round(14 * k), conversiones: Math.round(15 * k), errores: Math.round(4 * k), sesiones_con_error: Math.round(3 * k) });
const comportamiento = ({ p_desde, p_hasta }) => ({
  periodo: { desde: p_desde, hasta: p_hasta, dias: 30, zona: "Europe/Madrid", entorno: "demo" }, datos_desde: "2026-09-01T00:00:00Z",
  resumen: resumen(1), anterior: resumen(0.8), excluidas: { bots: 12, internas_pruebas: 5, incluidas_internas: false }, serie: [],
  paginas: [["/", 188, 34, 62], ["/carta", 141, 71, 55], ["/carta/vinos", 97, 88, 48], ["/reservas", 74, 52, 81], ["/cheques-regalo", 31, 40, 70], ["/menu-del-dia", 27, 22, 66]].map(([ruta, vistas, t, s]) => ({ ruta, vistas, sesiones: Math.round(vistas * 0.8), tiempo_medio_s: t, scroll_medio: s })),
  contenidos: [{ tipo: "vino_abierto", objetivo: "SIM Marqués de Riscal Reserva", n: 14, sesiones: 9 }, { tipo: "vino_abierto", objetivo: "SIM Aalto 2021", n: 9, sesiones: 7 }, { tipo: "plato_abierto", objetivo: "SIM Arroz de langosta", n: 22, sesiones: 15 }, { tipo: "plato_abierto", objetivo: "SIM Croquetas de jamón", n: 12, sesiones: 10 }],
  clics: [{ tipo: "contacto", accion: "telefono", objetivo: "cabecera", n: 21, sesiones: 18 }, { tipo: "boton", accion: null, objetivo: "Reservar mesa", n: 44, sesiones: 31 }, { tipo: "enlace", accion: null, objetivo: "Ver carta de vinos", n: 26, sesiones: 20 }],
  contactos: [{ accion: "telefono", n: 21, sesiones: 18 }, { accion: "whatsapp", n: 9, sesiones: 8 }, { accion: "como_llegar", n: 13, sesiones: 12 }],
  busquedas: { total: 18, sin_resultados: 3, sesiones: 11 }, filtros: [{ accion: "categoria", objetivo: "Tintos", n: 12 }, { accion: "categoria", objetivo: "Blancos", n: 7 }],
  origenes: [{ origen_tipo: "buscador", sesiones: 82, sesiones_con_conversion: 7 }, { origen_tipo: "directo", sesiones: 54, sesiones_con_conversion: 5 }, { origen_tipo: "red_social", sesiones: 33, sesiones_con_conversion: 2 }, { origen_tipo: "qr", sesiones: 15, sesiones_con_conversion: 0 }],
  campanas: [{ origen_tipo: "qr", nombre: "mesa", sesiones: 15, inicios: 2, sesiones_con_conversion: 0 }],
  dispositivos: [{ dispositivo: "movil", sesiones: 131, sesiones_con_conversion: 9 }, { dispositivo: "escritorio", sesiones: 47, sesiones_con_conversion: 5 }, { dispositivo: "tablet", sesiones: 6, sesiones_con_conversion: 0 }],
  horas: Array.from({ length: 24 }, (_, h) => ({ hora: h, sesiones: Math.round(Math.max(0, 14 * Math.exp(-((h - 13) ** 2) / 8) + 18 * Math.exp(-((h - 21) ** 2) / 6) + (h > 8 ? 2 : 0))) })),
  dias_semana: [18, 19, 22, 25, 33, 41, 26].map((sesiones, i) => ({ dia: i + 1, sesiones })),
  tiempo: { menos_10s: 38, de_10s_a_1m: 71, de_1m_a_3m: 49, mas_3m: 26 }, scroll: { hasta_25: 120, de_25_a_50: 170, de_50_a_75: 190, de_75_a_100: 222, vistas_medidas: 702 },
  recorridos: [{ recorrido: "/ → /carta → /reservas", sesiones: 19 }, { recorrido: "/ → /carta/vinos", sesiones: 12 }, { recorrido: "/reservas", sesiones: 9 }],
  ultimas_paginas: [{ ruta: "/reservas", sesiones: 41 }, { ruta: "/carta", sesiones: 37 }, { ruta: "/", sesiones: 33 }],
  embudos: [{ operacion: "reserva", entrada: 184, consulta: 61, inicio: 31, envio: 17, fin: 13, rechazos: 1 }, { operacion: "cheque", entrada: 184, consulta: 22, inicio: 6, envio: 3, fin: 2, rechazos: 0 }],
  formularios: [{ objetivo: "reserva", inicios: 31, envios: 17, abandonos: 14, errores_validacion: 6 }],
  errores_por_ruta: [{ ruta: "/carta/vinos", tipo: "error_js", n: 3, sesiones: 2 }], errores_por_operacion: [{ operacion: "reservar", n: 1, sesiones: 1 }],
  operaciones_bd: { reservas_web: 15, reservas_confirmadas: 12, cheques_web: 2 },
});

function datos() {
  const t = tablas();
  const ayer = new Date(Date.now() - 4 * 36e5).toISOString();
  t.trafico_web_sync_estado = [
    { proyecto: "casa-tomas-story", ultimo_ok_en: ayer, ultimo_intento_en: ayer, ultimo_error: null, actualizado_en: ayer },
    { proyecto: "touza-restaurant-website", ultimo_ok_en: ayer, ultimo_intento_en: ayer, ultimo_error: null, actualizado_en: ayer },
  ];
  t.peso_paginas = [];
  t.web_logs_config = [{ id: true, entorno_bd: "demo", activo: true }];
  t.web_resumenes_ia = [];
  return t;
}
const rpc = {
  ...rpcSinteticas,
  trafico_web_serie: serie,
  trafico_web_tendencia: tendencia,
  trafico_web_fdt_mes: fdt,
  trafico_web_top_paginas: topPaginas,
  trafico_web_desglose_resumen: desglose,
  web_comportamiento: comportamiento,
};

const VISTAS = [
  { nombre: "escritorio-1440", viewport: { width: 1440, height: 900 }, dpr: 2 },
  { nombre: "escritorio-1280", viewport: { width: 1280, height: 711 }, dpr: 2 },
  { nombre: "movil-390", viewport: { width: 390, height: 844 }, dpr: 3, movil: true },
];

await mkdir(SALIDA, { recursive: true });
const navegador = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
for (const v of VISTAS) {
    const context = await navegador.newContext({ viewport: v.viewport, deviceScaleFactor: v.dpr, isMobile: !!v.movil, hasTouch: !!v.movil, locale: "es-ES", timezoneId: "Europe/Madrid" });
    const { sinMock } = await instalarSupabaseFalso(context, { urlSupabase: URL_SUPABASE, tablas: datos(), rpc, funciones: funcionesSinteticas });
    const page = await context.newPage();
    await page.goto(`${BASE}/super-admin/trafico-web`);
    await page.getByTestId("grafico-visitas").waitFor({ timeout: 20_000 });
    await page.getByTestId("comportamiento-web").waitFor({ timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(800);
    const base = path.join(SALIDA, v.nombre);
    await page.screenshot({ path: `${base}-vista.png` });
    const [ancho, visible] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    if (ancho > visible) console.log(`${v.nombre}: la página se desborda en horizontal (${ancho} px de ${visible})`);
    // Página entera: se quita el alto fijo de la página y el scroll propio de la región para ver todo de una vez.
    await page.evaluate(() => {
      const kpis = document.querySelector("[data-testid='grafico-visitas']");
      const region = kpis?.closest(".overflow-y-auto");
      const raiz = region?.parentElement;
      if (region) Object.assign(region.style, { overflow: "visible", flex: "none" });
      if (raiz) raiz.style.height = "auto";
      for (let n = raiz?.parentElement; n && n !== document.body; n = n.parentElement) Object.assign(n.style, { height: "auto", maxHeight: "none", overflowY: "visible" });
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${base}-entera.png`, fullPage: true });
    if (sinMock.size) console.log(`${v.nombre}: sin mock →`, [...sinMock].join(", "));
    await context.close();
}
await navegador.close();
console.log(`Capturas en ${SALIDA}`);
