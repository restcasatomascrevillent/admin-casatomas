// @vitest-environment node
/**
 * Fase 3 «Métricas para aprender», sin red: la captura sigue las páginas de
 * /media hasta 90 días, pide las métricas de los reels (con su repliegue si
 * Meta rechaza alguna), guarda el texto completo, los hashtags y la hora de
 * Madrid, y sigue guardando si falta la migración 20261110000000. La lectura
 * trae «Qué funciona» (RPC instagram_que_funciona) o null.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClienteGraph } from "../../_shared/instagram/cliente.ts";
import { extraerHashtags, horaLocalMadrid, inicioDiaMadrid, sumarDias } from "../../_shared/instagram/insights.ts";
import { olvidarSecretos } from "../../_shared/instagram/secretos.ts";
import { GRAPH, TOKEN_META, resp } from "../../_shared/instagram/__tests__/simulacion.ts";
import { ErrorBaseDatos, type Rest } from "../acceso.ts";
import { capturarMetricas, DIAS_PUBLICACIONES, MIGRACION_APRENDER } from "../capturar.ts";
import { leerMetricas, leerQueFunciona } from "../leer.ts";

const IG = "17841400000000001";
// 05/11/2026 a las 06:00 en Madrid.
const AHORA = Date.UTC(2026, 10, 5, 5, 0, 0);
const DESDE = inicioDiaMadrid(sumarDias("2026-11-05", -DIAS_PUBLICACIONES));

type Fila = Record<string, unknown>;

/** Rest falso (clave de servicio): guarda lo que le llega; `fallaColumnas` simula la migración sin aplicar. */
function servicioFalso(o: { fallaColumnas?: boolean } = {}) {
  const guardado: Record<string, Fila[]> = {};
  const intentos: Array<{ tabla: string; filas: Fila[] }> = [];
  const rest: Rest = {
    async leer<T>(): Promise<T[]> {
      return [];
    },
    async guardar(tabla: string, filas: Fila[]): Promise<void> {
      intentos.push({ tabla, filas });
      if (o.fallaColumnas && tabla === "instagram_metricas_publicacion" && filas.some((f) => "hashtags" in f)) {
        throw new ErrorBaseDatos("No se pudo guardar en instagram_metricas_publicacion (400): Could not find the 'hashtags' column", 400, "PGRST204");
      }
      (guardado[tabla] ??= []).push(...filas);
    },
  };
  return { rest, guardado, intentos };
}

const medio = (id: number, fecha: string, extra: Fila = {}) => ({
  id: String(1790000000000000 + id),
  media_type: "IMAGE",
  media_product_type: "FEED",
  media_url: `https://cdn.example/${id}.jpg`,
  permalink: `https://www.instagram.com/p/${id}/`,
  timestamp: fecha,
  ...extra,
});

interface EscenarioGraph {
  paginas: Array<{ data: unknown[]; next?: string | null }>;
  /** Métricas que Meta rechaza (error 100) en /{media}/insights. */
  rechaza?: string[];
}

function graphFalso(e: EscenarioGraph) {
  const llamadas: URL[] = [];
  const f = vi.fn(async (entrada: string | URL | Request) => {
    const u = new URL(String(entrada));
    llamadas.push(u);
    const ruta = u.pathname.replace("/v26.0", "");
    if (ruta === `/${IG}/insights`) return resp(200, { data: [{ name: "reach", total_value: { value: 300 } }] });
    if (ruta === `/${IG}` && u.searchParams.get("fields") === "followers_count") return resp(200, { followers_count: 10 });
    if (ruta === `/${IG}/stories`) return resp(200, { data: [] });
    if (ruta === `/${IG}/media`) {
      const n = Number(u.searchParams.get("after")?.replace("cursor", "") ?? "0");
      const p = e.paginas[n];
      const next = p.next === undefined && n + 1 < e.paginas.length ? `${GRAPH}/${IG}/media?access_token=NO&after=cursor${n + 1}&limit=50` : p.next;
      return resp(200, { data: p.data, ...(next ? { paging: { cursors: { after: `cursor${n + 1}` }, next } } : {}) });
    }
    const m = /^\/(\d+)\/insights$/.exec(ruta);
    if (m) {
      const metricas = (u.searchParams.get("metric") ?? "").split(",");
      const mala = metricas.find((x) => e.rechaza?.includes(x));
      if (mala) return resp(400, { error: { code: 100, message: `(#100) metric[${metricas.indexOf(mala)}] must be one of the following values` } });
      return resp(200, {
        data: metricas.map((name) => ({
          name,
          values: [{ value: name === "reels_skip_rate" ? 23.456 : name === "ig_reels_avg_watch_time" ? 4210 : name === "ig_reels_video_view_total_time" ? 987654 : 100 }],
        })),
      });
    }
    throw new Error(`URL inesperada: ${u}`);
  });
  const cliente = new ClienteGraph({ token: TOKEN_META, versionApi: "v26.0", igUserId: IG, fetch: (url, init) => f(url, init), dormir: async () => {} });
  return { cliente, llamadas };
}

beforeEach(() => olvidarSecretos());
afterEach(() => vi.restoreAllMocks());

describe("hashtags y hora de Madrid", () => {
  it("hashtags: minúsculas, sin repetir, con tildes y «_», sin puntuación", () => {
    expect(extraerHashtags("Cocido #CocidoGallego, #casa_tomás. #cocidogallego #Crevillent! #2026 #")).toEqual([
      "#cocidogallego",
      "#casa_tomás",
      "#crevillent",
      "#2026",
    ]);
    expect(extraerHashtags(null)).toEqual([]);
  });

  it("hora local: +1 en invierno, +2 en verano", () => {
    expect(horaLocalMadrid(Date.parse("2026-11-03T12:15:00Z"))).toBe("2026-11-03T13:15:00");
    expect(horaLocalMadrid(Date.parse("2026-07-14T11:30:00Z"))).toBe("2026-07-14T13:30:00");
    expect(horaLocalMadrid(Date.parse("2026-11-03T23:30:00Z"))).toBe("2026-11-04T00:30:00");
  });
});

describe("captura de 90 días", () => {
  it("sigue las páginas de /media hasta la primera publicación de hace más de 90 días", async () => {
    const pagina1 = Array.from({ length: 50 }, (_, i) => medio(i, `2026-11-0${(i % 4) + 1}T12:00:00+0000`));
    const pagina2 = [
      medio(60, "2026-09-01T10:00:00+0000", { caption: `Pulpo ${"y más texto ".repeat(40)}#Pulpo #CasaTomás` }),
      medio(61, "2026-07-01T10:00:00+0000"), // hace más de 90 días: se para aquí
    ];
    const pagina3 = [medio(70, "2026-06-01T10:00:00+0000")];
    const g = graphFalso({ paginas: [{ data: pagina1 }, { data: pagina2 }, { data: pagina3 }] });
    const s = servicioFalso();
    const r = await capturarMetricas({ cliente: g.cliente, igUserId: IG, servicio: s.rest, ahora: () => AHORA });

    const listas = g.llamadas.filter((u) => u.pathname.endsWith(`/${IG}/media`));
    expect(listas).toHaveLength(2); // no pide la tercera
    expect(listas[0].searchParams.get("since")).toBe(String(DESDE));
    expect(listas[0].searchParams.get("limit")).toBe("50");
    expect(listas[1].searchParams.get("after")).toBe("cursor1");
    expect(listas.every((u) => !u.searchParams.has("access_token"))).toBe(true);
    expect(r.publicaciones).toBe(51);

    const pubs = s.guardado.instagram_metricas_publicacion;
    expect(pubs.map((p) => p.media_id)).not.toContain("1790000000000061");
    const larga = pubs.find((p) => p.media_id === "1790000000000060")!;
    expect(String(larga.caption).length).toBeGreaterThan(300); // texto completo
    expect(larga.hashtags).toEqual(["#pulpo", "#casatomás"]);
    expect(larga.publicado_local).toBe("2026-09-01T12:00:00");
    expect(pubs[0]).toMatchObject({ tiempo_medio_ms: null, tasa_salto: null }); // las fotos no llevan métricas de reels
  });

  it("avisa si hay más publicaciones de las que se capturan", async () => {
    const paginas = Array.from({ length: 5 }, (_, p) => ({
      data: Array.from({ length: 50 }, (_, i) => medio(p * 50 + i, "2026-11-01T12:00:00+0000")),
    }));
    const g = graphFalso({ paginas });
    const s = servicioFalso();
    const r = await capturarMetricas({ cliente: g.cliente, igUserId: IG, servicio: s.rest, ahora: () => AHORA });
    expect(r.publicaciones).toBe(200);
    expect(r.avisos.some((a) => /Hay más publicaciones/.test(a))).toBe(true);
  });

  it("reels: tiempo medio, total y tasa de salto; si Meta rechaza reels_skip_rate, se repite sin ella", async () => {
    const reel = medio(1, "2026-11-01T12:00:00+0000", { media_type: "VIDEO", media_product_type: "REELS", thumbnail_url: "https://cdn.example/1.jpg" });
    const g = graphFalso({ paginas: [{ data: [reel] }] });
    const s = servicioFalso();
    await capturarMetricas({ cliente: g.cliente, igUserId: IG, servicio: s.rest, ahora: () => AHORA });
    const pedidas = g.llamadas.filter((u) => u.pathname.endsWith("/1790000000000001/insights")).map((u) => u.searchParams.get("metric"));
    expect(pedidas).toEqual(["reach,likes,comments,saved,shares,views,total_interactions,ig_reels_avg_watch_time,ig_reels_video_view_total_time,reels_skip_rate"]);
    expect(s.guardado.instagram_metricas_publicacion[0]).toMatchObject({ producto: "REELS", tiempo_medio_ms: 4210, tiempo_total_ms: 987654, tasa_salto: 23.46, alcance: 100 });

    const g2 = graphFalso({ paginas: [{ data: [reel] }], rechaza: ["reels_skip_rate"] });
    const s2 = servicioFalso();
    const r2 = await capturarMetricas({ cliente: g2.cliente, igUserId: IG, servicio: s2.rest, ahora: () => AHORA });
    expect(g2.llamadas.filter((u) => u.pathname.endsWith("/insights") && u.pathname.includes("1790000000000001"))).toHaveLength(2);
    expect(s2.guardado.instagram_metricas_publicacion[0]).toMatchObject({ tiempo_medio_ms: 4210, tasa_salto: null });
    expect(r2.avisos).toEqual([]);

    // Si Meta no da ninguna de las de reels, quedan las de FEED.
    const g3 = graphFalso({ paginas: [{ data: [reel] }], rechaza: ["ig_reels_avg_watch_time"] });
    const s3 = servicioFalso();
    await capturarMetricas({ cliente: g3.cliente, igUserId: IG, servicio: s3.rest, ahora: () => AHORA });
    expect(s3.guardado.instagram_metricas_publicacion[0]).toMatchObject({ alcance: 100, tiempo_medio_ms: null });
  });

  it("sin la migración 20261110000000: guarda como antes y avisa", async () => {
    const g = graphFalso({ paginas: [{ data: [medio(1, "2026-11-01T12:00:00+0000", { caption: `${"x".repeat(400)} #algo` })] }] });
    const s = servicioFalso({ fallaColumnas: true });
    const r = await capturarMetricas({ cliente: g.cliente, igUserId: IG, servicio: s.rest, ahora: () => AHORA });
    const pub = s.guardado.instagram_metricas_publicacion[0];
    expect("hashtags" in pub || "publicado_local" in pub || "tasa_salto" in pub).toBe(false);
    expect(String(pub.caption)).toHaveLength(300);
    expect(r.avisos.some((a) => a.includes(MIGRACION_APRENDER))).toBe(true);
  });
});

describe("leer «Qué funciona»", () => {
  const QF = { publicaciones: 12, suficiente: true, conclusiones: [{ eje: "dia", estado: "mejor", clave: "martes", texto: "Los martes funcionan mejor: 9 %…" }] };

  function dbFalsa(rpc: () => unknown) {
    const rutas: string[] = [];
    const db: Rest = {
      async leer<T>(ruta: string): Promise<T[]> {
        rutas.push(ruta);
        if (ruta.startsWith("rpc/instagram_que_funciona")) return rpc() as T[];
        return [];
      },
      async guardar() {},
    };
    return { db, rutas };
  }

  it("llama a la RPC con la cuenta, la marca y 90 días, y la devuelve", async () => {
    const { db, rutas } = dbFalsa(() => QF);
    const r = await leerMetricas(db, { igUserId: IG, ahora: AHORA, marca: "touza" });
    expect(r.queFunciona).toEqual(QF);
    const ruta = rutas.find((x) => x.startsWith("rpc/"))!;
    const q = new URLSearchParams(ruta.split("?")[1]);
    expect(Object.fromEntries(q)).toEqual({ p_dias: "90", p_ig_user_id: IG, p_marca: "touza" });
  });

  it("sin la migración (404) o con un fallo: null, y la pestaña sigue", async () => {
    const sin = dbFalsa(() => {
      throw new ErrorBaseDatos("No se pudo leer qué funciona (404): Could not find the function", 404, "PGRST202");
    });
    expect(await leerQueFunciona(sin.db, IG, null)).toBeNull();
    const roto = dbFalsa(() => {
      throw new Error("se cayó");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await leerMetricas(roto.db, { igUserId: null, ahora: AHORA });
    expect(r.queFunciona).toBeNull();
    expect(r.ok).toBe(true);
    // Respuesta que no es un objeto de la RPC.
    expect(await leerQueFunciona(dbFalsa(() => []).db, IG, null)).toBeNull();
  });

  it("no pasa una marca o una cuenta raras a la RPC", async () => {
    const { db, rutas } = dbFalsa(() => QF);
    await leerQueFunciona(db, "@cuenta", "otra");
    expect(rutas[0]).toBe("rpc/instagram_que_funciona?p_dias=90");
  });
});
