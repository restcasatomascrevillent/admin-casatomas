// Acciones del contestador con un repo en memoria y Google/IA simulados.
// La regla que más importa: NADA se publica en Google sin aprobación, salvo
// la respuesta automática encendida y solo para las estrellas elegidas.
import { describe, expect, it, vi } from "vitest";
import {
  aprobar,
  ciclo,
  completarConexion,
  descartar,
  desconectar,
  ErrorAccion,
  estado,
  guardarBorrador,
  iniciarConexion,
  marcarRespondida,
  proponer,
  sincronizarGbp,
  type AjustesFila,
  type Deps,
  type Repo,
} from "../acciones";
import type { Resena } from "../../_shared/resenas/contestador";

const ID1 = "00000000-0000-4000-8000-000000000001";
const ID2 = "00000000-0000-4000-8000-000000000002";
const ID3 = "00000000-0000-4000-8000-000000000003";
const VOLVER = "https://admin-casatomas-git-staging-casa-tomas.vercel.app";

function crearRepo(resenas: Resena[], ajustes: Partial<AjustesFila> = {}, token: string | null = null) {
  const db = {
    resenas: resenas.map((r) => ({ ...r })) as Array<Resena & Record<string, unknown>>,
    ajustes: {
      proponer_automatico: true, autorespuesta_activa: false, autorespuesta_estrellas: [4, 5], autorespuesta_sin_texto: true,
      firma: "El equipo de Casa Tomás", indicaciones: "", gbp_cuenta: null, gbp_ubicacion: null, gbp_ubicacion_nombre: null,
      gbp_email: null, gbp_conectada_en: null, gbp_ultima_sincronizacion: null, gbp_ultimo_error: null, ultimo_ciclo: null,
      ultimo_ciclo_resumen: null, ...ajustes,
    } as AjustesFila,
    token,
    insertadas: [] as Record<string, unknown>[],
  };
  const repo: Repo = {
    ajustes: async () => ({ ...db.ajustes }),
    actualizarAjustes: async (c) => { Object.assign(db.ajustes, c); },
    resena: async (id) => db.resenas.find((r) => r.id === id) ?? null,
    actualizarResena: async (id, c) => { Object.assign(db.resenas.find((r) => r.id === id)!, c); },
    pendientesDePropuesta: async (n) => db.resenas.filter((r) => (r.respuesta_estado ?? "pendiente") === "pendiente" && !r.respuesta).slice(0, n),
    candidatasAutorespuesta: async (n) => db.resenas.filter((r) => ["propuesta", "aprobada"].includes(r.respuesta_estado ?? "") && !r.respuesta && r.gbp_review_name).slice(0, n),
    porGbp: async (nombre) => db.resenas.find((r) => r.gbp_review_name === nombre) ?? null,
    sinGbpCerca: async () => db.resenas.filter((r) => !r.gbp_review_name),
    insertarResena: async (f) => { db.insertadas.push(f); db.resenas.push({ id: `nueva-${db.insertadas.length}`, ...(f as object) } as never); },
    leerToken: async () => db.token,
    guardarToken: async (t) => { db.token = t.refresh_token; },
    borrarToken: async () => { db.token = null; },
    placeId: async () => "ChIJplace",
    guia: async () => null,
  };
  return { db, repo };
}

const R = (x: Partial<Resena>): Resena => ({ id: ID1, nombre_cliente: "Ana", valoracion: 5, comentario: "Muy bien", fecha: "2026-11-01", respuesta: null, respuesta_propuesta: null, respuesta_estado: "pendiente", gbp_review_name: null, ...x });

function googleSimulado(opciones: { fallarResponder?: boolean; resenas?: unknown[] } = {}) {
  const respuestas: Array<{ url: string; body: string }> = [];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith("https://oauth2.googleapis.com/token")) {
      const b = new URLSearchParams(String(init?.body));
      if (b.get("grant_type") === "authorization_code") return new Response(JSON.stringify({ refresh_token: "RT", access_token: "AT", scope: "business.manage" }));
      return new Response(JSON.stringify({ access_token: "AT" }));
    }
    if (u.includes("mybusinessaccountmanagement")) return new Response(JSON.stringify({ accounts: [{ name: "accounts/1" }] }));
    if (u.includes("mybusinessbusinessinformation")) return new Response(JSON.stringify({ locations: [{ name: "locations/2", title: "Casa Tomás", metadata: { placeId: "ChIJplace" } }] }));
    if (u.endsWith("/reply")) {
      respuestas.push({ url: u, body: String(init?.body) });
      return opciones.fallarResponder ? new Response(JSON.stringify({ error: { message: "quota", status: "PERMISSION_DENIED" } }), { status: 403 }) : new Response("{}");
    }
    if (u.includes("/reviews?")) return new Response(JSON.stringify({ reviews: opciones.resenas ?? [], averageRating: 4.7, totalReviewCount: 120 }));
    return new Response("{}", { status: 404 });
  });
  return { f: f as unknown as typeof fetch, respuestas };
}

function deps(repo: Repo, extra: Partial<Deps> = {}): Deps {
  return {
    repo,
    ia: vi.fn(async () => ({ texto: '"Gracias, Ana 😊. El equipo de Casa Tomás"', modelo: "gpt-4.1-mini" })),
    fetch: googleSimulado().f,
    oauth: { clientId: "cid", clientSecret: "cs", redirectUri: "https://x.supabase.co/functions/v1/resenas-contestador" },
    claveEstado: "clave",
    ahora: () => new Date("2026-11-10T10:00:00Z"),
    ...extra,
  };
}

describe("proponer", () => {
  it("guarda la propuesta limpia y NO publica nada", async () => {
    const g = googleSimulado();
    const { db, repo } = crearRepo([R({ gbp_review_name: "accounts/1/locations/2/reviews/a" })], { gbp_ubicacion: "accounts/1/locations/2" }, "RT");
    const r = await proponer(deps(repo, { fetch: g.f }), ID1, "más corta");
    expect(r.propuesta).toBe("Gracias, Ana. El equipo de Casa Tomás");
    expect(db.resenas[0]).toMatchObject({ respuesta_estado: "propuesta", respuesta_origen: "ia", respuesta_modelo: "gpt-4.1-mini", respuesta: null });
    expect(g.respuestas).toEqual([]);
  });
  it("errores claros: id, reseña que no existe, sin IA, indicación larga", async () => {
    const { repo } = crearRepo([R({})]);
    await expect(proponer(deps(repo), "x")).rejects.toMatchObject({ status: 400 });
    await expect(proponer(deps(repo), ID2)).rejects.toMatchObject({ status: 404 });
    await expect(proponer(deps(repo, { ia: null }), ID1)).rejects.toMatchObject({ status: 503, codigo: "sin_clave_ia" });
    await expect(proponer(deps(repo), ID1, "x".repeat(501))).rejects.toBeInstanceOf(ErrorAccion);
  });
  it("una reseña ya publicada sigue publicada (el borrador no toca lo publicado)", async () => {
    const { db, repo } = crearRepo([R({ respuesta: "Ya respondida", respuesta_estado: "publicada" })]);
    await proponer(deps(repo), ID1);
    expect(db.resenas[0]).toMatchObject({ respuesta: "Ya respondida", respuesta_estado: "publicada" });
  });
});

describe("aprobar", () => {
  it("sin cuenta conectada: queda aprobada para copiar, sin llamar a Google", async () => {
    const g = googleSimulado();
    const { db, repo } = crearRepo([R({ respuesta_estado: "propuesta", respuesta_propuesta: "Hola", gbp_review_name: "accounts/1/locations/2/reviews/a" })]);
    const r = await aprobar(deps(repo, { fetch: g.f }), ID1, "Gracias, Ana", "dueno");
    expect(r).toMatchObject({ estado: "aprobada", publicada: false, motivo: "sin_conexion" });
    expect(db.resenas[0]).toMatchObject({ respuesta_estado: "aprobada", respuesta_propuesta: "Gracias, Ana", respuesta_aprobada_por: "dueno", respuesta: null });
    expect(g.respuestas).toEqual([]);
  });
  it("sin enlace a Business Profile: aprobada para copiar", async () => {
    const { repo } = crearRepo([R({})], { gbp_ubicacion: "accounts/1/locations/2" }, "RT");
    expect(await aprobar(deps(repo), ID1, "Gracias", "dueno")).toMatchObject({ publicada: false, motivo: "sin_enlace_gbp" });
  });
  it("con la cuenta conectada publica el texto aprobado", async () => {
    const g = googleSimulado();
    const { db, repo } = crearRepo([R({ gbp_review_name: "accounts/1/locations/2/reviews/a" })], { gbp_ubicacion: "accounts/1/locations/2" }, "RT");
    const r = await aprobar(deps(repo, { fetch: g.f }), ID1, "Gracias, Ana", "dueno");
    expect(r).toMatchObject({ estado: "publicada", publicada: true });
    expect(g.respuestas).toEqual([{ url: "https://mybusiness.googleapis.com/v4/accounts/1/locations/2/reviews/a/reply", body: JSON.stringify({ comment: "Gracias, Ana" }) }]);
    expect(db.resenas[0]).toMatchObject({ respuesta: "Gracias, Ana", respuesta_estado: "publicada", respuesta_automatica: false, fecha_respuesta: "2026-11-10T10:00:00.000Z" });
  });
  it("si Google lo rechaza queda en error con el motivo", async () => {
    const g = googleSimulado({ fallarResponder: true });
    const { db, repo } = crearRepo([R({ gbp_review_name: "accounts/1/locations/2/reviews/a" })], { gbp_ubicacion: "accounts/1/locations/2" }, "RT");
    const r = await aprobar(deps(repo, { fetch: g.f }), ID1, "Gracias", "dueno");
    expect(r).toMatchObject({ estado: "error", publicada: false, codigo: "google_api_sin_acceso" });
    expect(db.resenas[0]).toMatchObject({ respuesta_estado: "error", respuesta: null, respuesta_intentos: 1 });
    expect(String(db.resenas[0].respuesta_error)).toContain("403");
  });
  it("texto vacío o demasiado largo → 400", async () => {
    const { repo } = crearRepo([R({})]);
    await expect(aprobar(deps(repo), ID1, "  ", "d")).rejects.toMatchObject({ status: 400 });
    await expect(aprobar(deps(repo), ID1, "x".repeat(4100), "d")).rejects.toMatchObject({ codigo: "texto_largo" });
  });
});

describe("borrador, marcar y descartar", () => {
  it("guardar deja la edición como propuesta editada", async () => {
    const { db, repo } = crearRepo([R({})]);
    await guardarBorrador(deps(repo), ID1, "Mi texto");
    expect(db.resenas[0]).toMatchObject({ respuesta_propuesta: "Mi texto", respuesta_estado: "propuesta", respuesta_origen: "editada" });
  });
  it("marcar respondida guarda lo que se publicó a mano", async () => {
    const { db, repo } = crearRepo([R({ respuesta_estado: "aprobada", respuesta_propuesta: "Aprobada" })]);
    await marcarRespondida(deps(repo), ID1, undefined, "dueno");
    expect(db.resenas[0]).toMatchObject({ respuesta: "Aprobada", respuesta_estado: "publicada", respuesta_origen: "manual" });
  });
  it("descartar vuelve a pendiente (o a lo publicado)", async () => {
    const { db, repo } = crearRepo([R({ respuesta_estado: "propuesta", respuesta_propuesta: "x" }), R({ id: ID2, respuesta: "Pub", respuesta_estado: "propuesta", respuesta_propuesta: "otra" })]);
    await descartar(deps(repo), ID1);
    await descartar(deps(repo), ID2);
    expect(db.resenas[0]).toMatchObject({ respuesta_estado: "pendiente", respuesta_propuesta: null });
    expect(db.resenas[1]).toMatchObject({ respuesta_estado: "publicada", respuesta_propuesta: "Pub" });
  });
});

describe("ciclo", () => {
  it("por defecto propone y NO publica nada (respuesta automática apagada)", async () => {
    const g = googleSimulado();
    const places = vi.fn(async () => ({ encontradas: 5 }));
    const { db, repo } = crearRepo(
      [R({ gbp_review_name: "accounts/1/locations/2/reviews/a" }), R({ id: ID2, valoracion: 2, gbp_review_name: "accounts/1/locations/2/reviews/b" })],
      { gbp_ubicacion: "accounts/1/locations/2" },
      "RT",
    );
    const r = await ciclo(deps(repo, { fetch: g.f, sincronizarPlaces: places }), "cron");
    expect(places).toHaveBeenCalledOnce();
    expect(r).toMatchObject({ propuestas: 2, automaticas: 0 });
    expect(g.respuestas).toEqual([]);
    expect(db.resenas.map((x) => x.respuesta_estado)).toEqual(["propuesta", "propuesta"]);
    expect(db.ajustes.ultimo_ciclo).toBe("2026-11-10T10:00:00.000Z");
  });
  it("con la respuesta automática encendida publica SOLO las estrellas elegidas", async () => {
    const g = googleSimulado();
    const { db, repo } = crearRepo(
      [
        R({ gbp_review_name: "accounts/1/locations/2/reviews/a" }),
        R({ id: ID2, valoracion: 2, gbp_review_name: "accounts/1/locations/2/reviews/b" }),
        R({ id: ID3, valoracion: 5, gbp_review_name: null }),
      ],
      { gbp_ubicacion: "accounts/1/locations/2", autorespuesta_activa: true, autorespuesta_estrellas: [5] },
      "RT",
    );
    const r = await ciclo(deps(repo, { fetch: g.f }), "cron");
    expect(r).toMatchObject({ propuestas: 3, automaticas: 1 });
    expect(g.respuestas.map((x) => x.url)).toEqual(["https://mybusiness.googleapis.com/v4/accounts/1/locations/2/reviews/a/reply"]);
    expect(db.resenas[0]).toMatchObject({ respuesta_estado: "publicada", respuesta_automatica: true });
    expect(db.resenas[1]).toMatchObject({ respuesta_estado: "propuesta", respuesta: null });
    expect(db.resenas[2]).toMatchObject({ respuesta_estado: "propuesta", respuesta: null });
  });
  it("encendida pero sin cuenta conectada: no publica", async () => {
    const g = googleSimulado();
    const { repo } = crearRepo([R({ gbp_review_name: "accounts/1/locations/2/reviews/a" })], { autorespuesta_activa: true });
    expect(await ciclo(deps(repo, { fetch: g.f }), "cron")).toMatchObject({ automaticas: 0 });
    expect(g.respuestas).toEqual([]);
  });
  it("sin proponer automático no gasta IA; un fallo de Places no para el resto", async () => {
    const { repo } = crearRepo([R({})], { proponer_automatico: false });
    const d = deps(repo, { sincronizarPlaces: async () => { throw new Error("sin clave"); } });
    const r = await ciclo(d, "panel");
    expect(d.ia).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
    expect(r.errores).toEqual(["Places: sin clave"]);
  });
});

describe("sincronizarGbp", () => {
  it("inserta nuevas, enlaza la de Places y trae las respuestas que ya hay en Google", async () => {
    const { db, repo } = crearRepo([R({ nombre_cliente: "Ana López", fecha: "2026-11-01", gbp_review_name: null })]);
    const resenas = [
      { name: "accounts/1/locations/2/reviews/a", reviewer: { displayName: "Ana López" }, starRating: "FIVE", comment: "Muy bien", createTime: "2026-11-02T09:00:00Z", reviewReply: { comment: "Gracias Ana", updateTime: "2026-11-03T00:00:00Z" } },
      { name: "accounts/1/locations/2/reviews/b", reviewer: { displayName: "Luis" }, starRating: "THREE", comment: "Normal", createTime: "2026-10-02T09:00:00Z" },
      { name: "basura", starRating: "FIVE" },
    ];
    const g = googleSimulado({ resenas });
    const { crearClienteGbp } = await import("../../_shared/resenas/google-business");
    const r = await sincronizarGbp(deps(repo), { gbp: crearClienteGbp(g.f, "AT"), ubicacion: "accounts/1/locations/2" });
    expect(r).toEqual({ leidas: 3, nuevas: 1, enlazadas: 1, actualizadas: 1, descartadas: 1 });
    expect(db.resenas[0]).toMatchObject({ gbp_review_name: "accounts/1/locations/2/reviews/a", respuesta: "Gracias Ana", respuesta_estado: "publicada", respuesta_origen: "google" });
    expect(db.insertadas[0]).toMatchObject({ nombre_cliente: "Luis", valoracion: 3, estado: "publicada", fuente: "google", gbp_review_name: "accounts/1/locations/2/reviews/b" });
    expect(db.insertadas[0]).not.toHaveProperty("respuesta");
  });
});

describe("conectar Google", () => {
  it("sin credenciales explica qué falta", async () => {
    const { repo } = crearRepo([]);
    await expect(iniciarConexion(deps(repo, { oauth: null }), "u", VOLVER)).rejects.toMatchObject({ status: 503, codigo: "google_sin_configurar" });
  });
  it("solo vuelve al panel", async () => {
    const { repo } = crearRepo([]);
    await expect(iniciarConexion(deps(repo), "u", "https://evil.com")).rejects.toMatchObject({ status: 400 });
  });
  it("ida y vuelta: guarda el token, elige la ficha por place_id y vuelve al panel", async () => {
    const g = googleSimulado();
    const { db, repo } = crearRepo([]);
    const d = deps(repo, { fetch: g.f });
    const { url } = await iniciarConexion(d, "dueno", VOLVER);
    const state = new URL(url).searchParams.get("state");
    const destino = await completarConexion(d, "CODE", state);
    expect(destino).toBe(`${VOLVER}/super-admin/resenas?google=conectado`);
    expect(db.token).toBe("RT");
    expect(db.ajustes).toMatchObject({ gbp_ubicacion: "accounts/1/locations/2", gbp_cuenta: "accounts/1", gbp_ubicacion_nombre: "Casa Tomás" });
    const e = await estado(d);
    expect(e.google).toMatchObject({ configurada: true, conectada: true, ubicacion: "accounts/1/locations/2" });
    await desconectar(d);
    expect(db.token).toBeNull();
    expect(db.ajustes.gbp_ubicacion).toBeNull();
  });
  it("un state falso o caducado no guarda nada", async () => {
    const { db, repo } = crearRepo([]);
    await expect(completarConexion(deps(repo), "CODE", "falso.firma")).rejects.toMatchObject({ status: 400 });
    expect(db.token).toBeNull();
  });
  it("si el dueño cancela en Google vuelve sin conectar", async () => {
    const { db, repo } = crearRepo([]);
    const d = deps(repo);
    const state = new URL((await iniciarConexion(d, "dueno", VOLVER)).url).searchParams.get("state");
    expect(await completarConexion(d, null, state, "access_denied")).toBe(`${VOLVER}/super-admin/resenas?google=cancelado`);
    expect(db.token).toBeNull();
  });
});
