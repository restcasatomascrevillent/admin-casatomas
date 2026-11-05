// @vitest-environment node
/**
 * Edge Function instagram-metricas sin red: fetch falso de Supabase (Auth,
 * RPC de permisos, PostgREST) y de la Graph API. Permisos (usuario, cron,
 * servicio), lectura con la RLS del usuario, captura con la clave de
 * servicio, error de permiso de Meta y que ningún secreto salga.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { manejarMetricas } from "../metricas.ts";
import { olvidarSecretos } from "../../_shared/instagram/secretos.ts";
import { desfaseMadrid, fechaMadrid, inicioDiaMadrid, leerValores, sumarDias } from "../../_shared/instagram/insights.ts";
import { ENV_META, GRAPH, JWT, SB, TOKEN_META, resp } from "../../_shared/instagram/__tests__/simulacion.ts";

const CLAVE_SERVICIO = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.claveDeServicioSuperSecreta99";
const SECRETO_CRON = "secreto-del-cron-de-metricas-0123456789";
const ENV = { ...ENV_META, SUPABASE_SERVICE_ROLE_KEY: CLAVE_SERVICIO, INSTAGRAM_METRICAS_CRON_SECRET: SECRETO_CRON };
const IG = ENV_META.IG_USER_ID;
const PIEZA = "3f2b8a52-6c1e-4d7a-9b0f-1a2b3c4d5e6f";
const FOTO_SUBIDA = "9a8b7c6d-1111-4222-8333-444455556666";
// 05/11/2026 a las 06:00 en Madrid (05:00 UTC, horario de invierno).
const AHORA = Date.UTC(2026, 10, 5, 5, 0, 0);

type Llamada = { url: string; metodo: string; cabeceras: Record<string, string>; cuerpo: string | null };

interface Escenario {
  leer?: boolean;
  escribir?: boolean;
  /** Respuesta de /{ig}/insights de la cuenta (por defecto, valores). */
  cuenta?: (l: Llamada) => Response;
  /** Meta rechaza profile_views. */
  sinVisitas?: boolean;
  /** Error de las historias en /insights. */
  historiaFalla?: boolean;
  tablas?: Record<string, unknown[]>;
  ultimaCapturaPanel?: string | null;
}

function simular(e: Escenario = {}) {
  const llamadas: Llamada[] = [];
  const guardado: Record<string, unknown[]> = {};
  const f = vi.fn(async (entrada: string | URL | Request, init: RequestInit = {}) => {
    const url = String(entrada);
    const metodo = (init.method ?? "GET").toUpperCase();
    const cabeceras = Object.fromEntries(new Headers(init.headers as HeadersInit).entries());
    const cuerpo = typeof init.body === "string" ? init.body : null;
    const l = { url, metodo, cabeceras, cuerpo };
    llamadas.push(l);
    if (url === `${SB}/auth/v1/user`) return resp(200, { id: "usuario-1" });
    if (url === `${SB}/rest/v1/rpc/can_read_section`) return resp(200, e.leer ?? true);
    if (url === `${SB}/rest/v1/rpc/can_edit_section`) return resp(200, e.escribir ?? true);
    if (url.startsWith(`${SB}/rest/v1/`)) {
      const tabla = url.slice(`${SB}/rest/v1/`.length).split("?")[0];
      if (metodo === "POST") {
        (guardado[tabla] ??= []).push(...(JSON.parse(cuerpo!) as unknown[]));
        return new Response(null, { status: 201 });
      }
      if (tabla === "instagram_metricas_capturas" && url.includes("origen=eq.panel")) {
        return resp(200, e.ultimaCapturaPanel ? [{ inicio: e.ultimaCapturaPanel }] : []);
      }
      return resp(200, e.tablas?.[tabla] ?? []);
    }
    if (url.startsWith(GRAPH)) {
      const u = new URL(url);
      const ruta = u.pathname.replace("/v26.0", "");
      if (ruta === `/${IG}/insights`) {
        if (u.searchParams.get("metric") === "profile_views") {
          return e.sinVisitas
            ? resp(400, { error: { code: 100, message: "(#100) metric[0] must be one of the following values: reach, …" } })
            : resp(200, { data: [{ name: "profile_views", period: "day", total_value: { value: 12 } }] });
        }
        if (e.cuenta) return e.cuenta(l);
        return resp(200, {
          data: [
            { name: "reach", period: "day", total_value: { value: 300 } },
            { name: "views", period: "day", total_value: { value: 900 } },
            { name: "accounts_engaged", period: "day", total_value: { value: 40 } },
            { name: "total_interactions", period: "day", total_value: { value: 55 } },
            { name: "likes", period: "day", total_value: { value: 45 } },
          ],
        });
      }
      if (ruta === `/${IG}` && u.searchParams.get("fields") === "followers_count") return resp(200, { followers_count: 1234, id: IG });
      if (ruta === `/${IG}/media`) {
        return resp(200, {
          data: [
            { id: "1790000000000001", caption: "Chuletón #casatomas", media_type: "IMAGE", media_product_type: "FEED", media_url: "https://cdn.example/1.jpg", permalink: "https://www.instagram.com/p/AAA/", timestamp: "2026-11-03T12:00:00+0000", like_count: 20, comments_count: 3 },
            { id: "1790000000000002", media_type: "VIDEO", media_product_type: "REELS", thumbnail_url: "https://cdn.example/2.jpg", media_url: "https://cdn.example/2.mp4", permalink: "https://www.instagram.com/reel/BBB/", timestamp: "2026-11-01T12:00:00+0000" },
          ],
        });
      }
      if (ruta === `/${IG}/stories`) {
        return resp(200, { data: [{ id: "1790000000000003", media_type: "IMAGE", media_url: "https://cdn.example/3.jpg", timestamp: "2026-11-05T01:00:00+0000" }] });
      }
      if (ruta === "/1790000000000003/insights" && e.historiaFalla) {
        return resp(400, { error: { code: 10, message: "(#10) Not enough viewers for the media to show insights" } });
      }
      const m = /^\/(\d+)\/insights$/.exec(ruta);
      if (m) {
        const metricas = (u.searchParams.get("metric") ?? "").split(",");
        return resp(200, { data: metricas.map((name, i) => ({ name, period: "lifetime", values: [{ value: 10 * (i + 1) }] })) });
      }
    }
    throw new Error(`URL inesperada en el test: ${metodo} ${url}`);
  });
  return { f, llamadas, guardado };
}

const peticion = (metodo: "GET" | "POST", cuerpo: unknown, cabeceras: Record<string, string> = {}) =>
  new Request(`${SB}/functions/v1/instagram-metricas`, {
    method: metodo,
    headers: { "Content-Type": "application/json", ...cabeceras },
    ...(metodo === "POST" ? { body: JSON.stringify(cuerpo) } : {}),
  });
const usuario = { Authorization: `Bearer ${JWT}` };
const cron = (s = SECRETO_CRON) => ({ "x-webhook-secret": s });
const deps = (f: typeof fetch, env: Record<string, string | undefined> = ENV) => ({ env, fetch: f, ahora: () => AHORA, dormir: async () => {} });

let consola: string[] = [];
beforeEach(() => {
  olvidarSecretos();
  consola = [];
  for (const nivel of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, nivel).mockImplementation((...a: unknown[]) => void consola.push(a.map(String).join(" ")));
  }
});
afterEach(() => {
  const todo = consola.join("\n");
  for (const secreto of [TOKEN_META, CLAVE_SERVICIO, SECRETO_CRON, JWT]) expect(todo).not.toContain(secreto);
  vi.restoreAllMocks();
});

describe("días de Europe/Madrid", () => {
  it("medianoche en invierno, en verano y el día del cambio de hora", () => {
    expect(inicioDiaMadrid("2026-11-01")).toBe(Date.UTC(2026, 9, 31, 23) / 1000);
    expect(inicioDiaMadrid("2026-07-01")).toBe(Date.UTC(2026, 5, 30, 22) / 1000);
    expect(inicioDiaMadrid("2026-10-25")).toBe(Date.UTC(2026, 9, 24, 22) / 1000); // ese día dura 25 h
    expect(inicioDiaMadrid("2026-10-26") - inicioDiaMadrid("2026-10-25")).toBe(25 * 3600);
    expect(desfaseMadrid(Date.UTC(2026, 0, 15))).toBe(60);
    expect(fechaMadrid(Date.UTC(2026, 10, 4, 23, 30))).toBe("2026-11-05");
    expect(sumarDias("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("leerValores toma total_value o values[0] y descarta lo que no es un número válido", () => {
    expect(leerValores({ data: [{ name: "reach", total_value: { value: 5 } }, { name: "likes", values: [{ value: 7 }] }, { name: "x", values: [{ value: "a" }] }] }))
      .toEqual({ reach: 5, likes: 7, x: null });
  });
});

describe("leer", () => {
  it("401 sin sesión y 403 sin permiso de lectura de Marketing", async () => {
    expect((await manejarMetricas(peticion("GET", null), deps(simular().f))).status).toBe(401);
    expect((await manejarMetricas(peticion("GET", null, usuario), deps(simular({ leer: false }).f))).status).toBe(403);
  });

  it("lee como el usuario (su JWT, nunca la clave de servicio) y mezcla piezas y tipo de foto", async () => {
    const cuenta = Array.from({ length: 14 }, (_, i) => ({
      fecha: sumarDias("2026-11-04", -i),
      ig_user_id: IG,
      seguidores: i === 0 ? 1100 : i === 7 ? 1000 : null,
      alcance: i < 7 ? 200 : 100,
      visualizaciones: 500,
      visitas_perfil: null,
      cuentas_interaccion: 10,
      interacciones: 20,
    }));
    const { f, llamadas } = simular({
      tablas: {
        instagram_metricas_cuenta: cuenta,
        instagram_metricas_publicacion_ultima: [
          { media_id: "1790000000000001", pieza_id: PIEZA, fecha_captura: "2026-11-05", producto: "FEED", alcance: 150, interacciones: 15 },
          { media_id: "1790000000000002", pieza_id: null, fecha_captura: "2026-11-05", producto: "REELS", alcance: 400 },
        ],
        instagram_piezas: [{ id: PIEZA, media_id: "1790000000000001", marca: "casa-tomas", plantilla: "ct-foto-titular", formato: "post", foto: FOTO_SUBIDA }],
        instagram_fotos: [{ id: FOTO_SUBIDA, tipo: "plato" }],
        instagram_metricas_capturas: [{ inicio: "2026-11-05T05:00:00Z", fin: "2026-11-05T05:00:30Z", ok: true, origen: "cron", error_tipo: null, error: null, avisos: [] }],
      },
    });
    const r = await manejarMetricas(peticion("GET", null, usuario), deps(f));
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.ultimoDia).toBe("2026-11-04");
    expect(j.resumen.d7.metricas.alcance).toEqual({ actual: 1400, anterior: 700, variacion: 100 });
    expect(j.resumen.d7.metricas.seguidores).toMatchObject({ actual: 1100, anterior: 1000, cambio: 100, variacion: 10 });
    expect(j.resumen.d7.metricas.visitasPerfil).toEqual({ actual: null, anterior: null, variacion: null });
    expect(j.serie).toHaveLength(28);
    expect(j.serie.at(-1)).toMatchObject({ fecha: "2026-11-04", alcance: 200, seguidores: 1100 });
    expect(j.publicaciones[0]).toMatchObject({ mediaId: "1790000000000001", marca: "casa-tomas", plantilla: "ct-foto-titular", foto: FOTO_SUBIDA, tipoFoto: "plato" });
    expect(j.publicaciones[1]).toMatchObject({ mediaId: "1790000000000002", marca: null, plantilla: null });
    expect(j.ultimaCaptura).toMatchObject({ ok: true, origen: "cron" });
    const rest = llamadas.filter((l) => l.url.startsWith(`${SB}/rest/v1/`) && !l.url.includes("/rpc/"));
    expect(rest.length).toBeGreaterThan(0);
    expect(rest.every((l) => l.cabeceras.authorization === `Bearer ${JWT}` && l.cabeceras.apikey === "clave-publica")).toBe(true);
    expect(rest.every((l) => l.metodo === "GET")).toBe(true);
    // La cuenta se filtra por IG_USER_ID.
    expect(rest.find((l) => l.url.includes("instagram_metricas_cuenta"))!.url).toContain(`ig_user_id=eq.${IG}`);
  });

  it("tipo de foto de las piezas con fotos de Drive («drive:<id>», por drive_id) y de la carta («plato»)", async () => {
    const DRIVE = "1AbcDriveFoto00000000001";
    const PIEZA2 = "4f2b8a52-6c1e-4d7a-9b0f-1a2b3c4d5e6f";
    const { f, llamadas } = simular({
      tablas: {
        instagram_metricas_publicacion_ultima: [
          { media_id: "1790000000000001", pieza_id: PIEZA, fecha_captura: "2026-11-05", producto: "FEED" },
          { media_id: "1790000000000002", pieza_id: PIEZA2, fecha_captura: "2026-11-05", producto: "FEED" },
        ],
        instagram_piezas: [
          { id: PIEZA, media_id: "1790000000000001", marca: "casa-tomas", plantilla: "ct-foto-titular", formato: "post", foto: `drive:${DRIVE}` },
          { id: PIEZA2, media_id: "1790000000000002", marca: "casa-tomas", plantilla: "ct-foto-titular", formato: "post", foto: "carta:42" },
        ],
        instagram_fotos: [{ drive_id: DRIVE, tipo: "ambiente" }],
      },
    });
    const j = await (await manejarMetricas(peticion("GET", null, usuario), deps(f))).json();
    expect(j.publicaciones[0]).toMatchObject({ foto: `drive:${DRIVE}`, tipoFoto: "ambiente" });
    expect(j.publicaciones[1]).toMatchObject({ foto: "carta:42", tipoFoto: "plato" });
    expect(llamadas.some((l) => l.url.includes(`instagram_fotos?select=drive_id,tipo&drive_id=in.(%22${DRIVE}%22)`) || l.url.includes(`drive_id=in.("${DRIVE}")`))).toBe(true);
  });

  it("leer con «marca»: la cuenta de esa marca (IG_USER_ID_TOUZA) o la general, y la lista de cuentas", async () => {
    const TOUZA = "17841400000000077";
    const env = { ...ENV, IG_USER_ID_TOUZA: TOUZA };
    const a = simular();
    const j = await (await manejarMetricas(new Request(`${SB}/functions/v1/instagram-metricas?marca=touza`, { headers: usuario }), deps(a.f, env))).json();
    expect(a.llamadas.find((l) => l.url.includes("instagram_metricas_cuenta"))!.url).toContain(`ig_user_id=eq.${TOUZA}`);
    expect(j.cuentas).toEqual([{ igUserId: IG, marcas: ["casa-tomas"] }, { igUserId: TOUZA, marcas: ["touza"] }]);
    const b = simular();
    const j2 = await (await manejarMetricas(new Request(`${SB}/functions/v1/instagram-metricas?marca=touza`, { headers: usuario }), deps(b.f))).json();
    expect(b.llamadas.find((l) => l.url.includes("instagram_metricas_cuenta"))!.url).toContain(`ig_user_id=eq.${IG}`);
    expect(j2.cuentas).toEqual([{ igUserId: IG, marcas: ["casa-tomas", "touza"] }]);
    expect((await manejarMetricas(new Request(`${SB}/functions/v1/instagram-metricas?marca=otra`, { headers: usuario }), deps(simular().f))).status).toBe(400);
  });

  it("sin datos: resumen null, serie vacía", async () => {
    const r = await manejarMetricas(peticion("POST", { accion: "leer" }, usuario), deps(simular().f));
    expect(await r.json()).toMatchObject({ ok: true, resumen: null, serie: [], publicaciones: [], ultimaCaptura: null });
  });

  it("acción desconocida → 400; método no permitido → 405", async () => {
    expect((await manejarMetricas(peticion("POST", { accion: "borrar" }, usuario), deps(simular().f))).status).toBe(400);
    const put = new Request(`${SB}/functions/v1/instagram-metricas`, { method: "PUT" });
    expect((await manejarMetricas(put, deps(simular().f))).status).toBe(405);
  });
});

describe("capturar", () => {
  it("cron: falla cerrado sin secreto configurado, 401 con secreto incorrecto y 400 si no es capturar", async () => {
    const { f, llamadas } = simular();
    expect((await manejarMetricas(peticion("POST", { accion: "capturar" }, cron()), deps(f, { ...ENV, INSTAGRAM_METRICAS_CRON_SECRET: "" }))).status).toBe(500);
    expect((await manejarMetricas(peticion("POST", { accion: "capturar" }, cron("otro-secreto-cualquiera")), deps(f))).status).toBe(401);
    expect((await manejarMetricas(peticion("POST", { accion: "leer" }, cron()), deps(f))).status).toBe(400);
    expect(llamadas).toHaveLength(0);
  });

  it("cron: pide las métricas vigentes y guarda con la clave de servicio", async () => {
    const { f, llamadas, guardado } = simular({ tablas: { instagram_piezas: [{ id: PIEZA, media_id: "1790000000000001" }] } });
    const r = await manejarMetricas(peticion("POST", { accion: "capturar" }, cron()), deps(f));
    const texto = await r.text();
    expect(r.status).toBe(200);
    const j = JSON.parse(texto);
    expect(j).toMatchObject({ ok: true, fechaCaptura: "2026-11-05", dias: ["2026-11-04", "2026-11-03", "2026-11-02"], publicaciones: 3 });

    // Cuenta: métricas vigentes (views, nunca impressions), por día de Madrid.
    const cuenta = llamadas.filter((l) => l.url.startsWith(`${GRAPH}/${IG}/insights`) && !l.url.includes("profile_views"));
    expect(cuenta).toHaveLength(3);
    const u = new URL(cuenta[0].url);
    expect(u.searchParams.get("metric")).toBe("reach,views,accounts_engaged,total_interactions,likes,comments,saves,shares,profile_links_taps");
    expect(u.searchParams.get("metric_type")).toBe("total_value");
    expect(u.searchParams.get("period")).toBe("day");
    expect(u.searchParams.get("since")).toBe(String(inicioDiaMadrid("2026-11-04")));
    expect(u.searchParams.get("until")).toBe(String(inicioDiaMadrid("2026-11-05")));
    expect(llamadas.some((l) => l.url.includes("impressions"))).toBe(false);
    // Token de Meta solo en la cabecera, hacia graph.facebook.com.
    expect(llamadas.filter((l) => l.url.startsWith(GRAPH)).every((l) => l.cabeceras.authorization === `Bearer ${TOKEN_META}` && !l.url.includes(TOKEN_META))).toBe(true);
    // Métricas de cada tipo de publicación.
    const metricasDe = (id: string) => new URL(llamadas.find((l) => l.url.startsWith(`${GRAPH}/${id}/insights`))!.url).searchParams.get("metric");
    expect(metricasDe("1790000000000001")).toBe("reach,likes,comments,saved,shares,views,total_interactions");
    expect(metricasDe("1790000000000003")).toBe("reach,views,shares,total_interactions");

    // Guardado: con la clave de servicio, upsert por las claves únicas.
    const escrituras = llamadas.filter((l) => l.url.startsWith(`${SB}/rest/v1/`) && l.metodo === "POST");
    expect(escrituras.every((l) => l.cabeceras.authorization === `Bearer ${CLAVE_SERVICIO}`)).toBe(true);
    expect(escrituras.filter((l) => l.url.includes("instagram_metricas_cuenta")).every((l) => l.url.includes("on_conflict=fecha%2Cig_user_id") && l.cabeceras.prefer.includes("merge-duplicates"))).toBe(true);
    const dias = guardado.instagram_metricas_cuenta as Array<Record<string, unknown>>;
    expect(dias.map((d) => d.fecha)).toEqual(["2026-11-04", "2026-11-03", "2026-11-02"]);
    expect(dias[0]).toMatchObject({ ig_user_id: IG, alcance: 300, visualizaciones: 900, cuentas_interaccion: 40, interacciones: 55, me_gusta: 45, comentarios: null, seguidores: 1234, visitas_perfil: 12 });
    expect("seguidores" in dias[1]).toBe(false); // los días anteriores no pisan los seguidores que tuvieran
    const pubs = guardado.instagram_metricas_publicacion as Array<Record<string, unknown>>;
    expect(pubs.find((p) => p.media_id === "1790000000000001")).toMatchObject({ pieza_id: PIEZA, fecha_captura: "2026-11-05", producto: "FEED", alcance: 10, me_gusta: 20, visualizaciones: 60, miniatura_url: "https://cdn.example/1.jpg" });
    expect(pubs.find((p) => p.media_id === "1790000000000002")).toMatchObject({ pieza_id: null, producto: "REELS", miniatura_url: "https://cdn.example/2.jpg" });
    expect(pubs.find((p) => p.media_id === "1790000000000003")).toMatchObject({ producto: "STORY" });
    expect(guardado.instagram_metricas_capturas).toEqual([expect.objectContaining({ origen: "cron", ok: true, dias: 3, publicaciones: 3 })]);
    for (const s of [TOKEN_META, CLAVE_SERVICIO, SECRETO_CRON]) expect(texto).not.toContain(s);
  });

  it("sin instagram_manage_insights: 502 con qué permiso añadir y dónde, y no guarda métricas", async () => {
    const { f, guardado } = simular({
      cuenta: () => resp(403, { error: { code: 10, message: "(#10) Application does not have permission for this action", type: "OAuthException", fbtrace_id: "Abc" } }),
    });
    const r = await manejarMetricas(peticion("POST", { accion: "capturar" }, cron()), deps(f));
    expect(r.status).toBe(502);
    const j = await r.json();
    expect(j).toMatchObject({ ok: false, tipo: "permiso_insights", permiso: "instagram_manage_insights" });
    expect(j.error).toMatch(/instagram_manage_insights/);
    expect(j.comoArreglarlo).toMatch(/Configuración del negocio → Usuarios → Usuarios del sistema/);
    expect(j.comoArreglarlo).toMatch(/IG_ACCESS_TOKEN/);
    expect(guardado.instagram_metricas_cuenta).toBeUndefined();
    expect(guardado.instagram_metricas_publicacion).toBeUndefined();
    expect(guardado.instagram_metricas_capturas).toEqual([expect.objectContaining({ ok: false, error_tipo: "permiso_insights" })]);
  });

  it("token inválido: error de token (no de permiso)", async () => {
    const { f } = simular({ cuenta: () => resp(400, { error: { code: 190, message: "Invalid OAuth access token." } }) });
    const r = await manejarMetricas(peticion("POST", { accion: "capturar" }, cron()), deps(f));
    expect(r.status).toBe(502);
    expect((await r.json()).tipo).toBe("token");
  });

  it("profile_views rechazada e historia sin métricas: captura igual con avisos", async () => {
    const { f, guardado, llamadas } = simular({ sinVisitas: true, historiaFalla: true });
    const r = await manejarMetricas(peticion("POST", { accion: "capturar" }, cron()), deps(f));
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.avisos.join(" ")).toMatch(/profile_views/);
    expect(j.avisos.join(" ")).toMatch(/1 historia\(s\) sin métricas/);
    // profile_views solo se intenta una vez.
    expect(llamadas.filter((l) => l.url.includes("metric=profile_views"))).toHaveLength(1);
    expect((guardado.instagram_metricas_cuenta as Array<Record<string, unknown>>)[0].visitas_perfil).toBeUndefined();
  });

  it("panel: 403 sin permiso de escritura, 429 si se actualizó hace poco y 200 si no", async () => {
    expect((await manejarMetricas(peticion("POST", { accion: "capturar" }, usuario), deps(simular({ escribir: false }).f))).status).toBe(403);
    const pronto = await manejarMetricas(
      peticion("POST", { accion: "capturar" }, usuario),
      deps(simular({ ultimaCapturaPanel: new Date(AHORA - 60_000).toISOString() }).f),
    );
    expect(pronto.status).toBe(429);
    expect(await pronto.json()).toMatchObject({ tipo: "demasiado_pronto", reintentarEn: 240 });
    const { f, guardado } = simular({ ultimaCapturaPanel: new Date(AHORA - 10 * 60_000).toISOString() });
    const r = await manejarMetricas(peticion("POST", { accion: "capturar" }, usuario), deps(f));
    expect(r.status).toBe(200);
    expect(guardado.instagram_metricas_capturas).toEqual([expect.objectContaining({ origen: "panel", ok: true })]);
  });

  it("clave de servicio: puede capturar; leer no", async () => {
    const servicio = { Authorization: `Bearer ${CLAVE_SERVICIO}` };
    expect((await manejarMetricas(peticion("POST", { accion: "capturar" }, servicio), deps(simular().f))).status).toBe(200);
    expect((await manejarMetricas(peticion("POST", { accion: "leer" }, servicio), deps(simular().f))).status).toBe(400);
  });

  it("faltan secretos de Meta: 503 con «cómo arreglarlo» y sin llamar a Meta", async () => {
    const { f, llamadas } = simular();
    const env = { ...ENV, IG_ACCESS_TOKEN: undefined, IG_USER_ID: undefined };
    const r = await manejarMetricas(peticion("POST", { accion: "capturar" }, cron()), deps(f, env));
    expect(r.status).toBe(503);
    const j = await r.json();
    expect(j).toMatchObject({ ok: false, tipo: "configuracion" });
    expect(j.error).toMatch(/IG_ACCESS_TOKEN, IG_USER_ID/);
    expect(j.comoArreglarlo.join(" ")).toMatch(/npx supabase secrets set IG_ACCESS_TOKEN/);
    expect(llamadas.some((l) => l.url.startsWith(GRAPH))).toBe(false);
  });
});
