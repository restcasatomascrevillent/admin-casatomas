/**
 * Tests para supabase/functions/sync-trafico-web/{vercel,sync}.ts
 *
 * Mismo runner que emails-reserva (vitest, sin imports remotos). Cubre la
 * tarea 2.4: normalizador sin visitantes, 401 sin cabecera, 500 sin secreto,
 * cálculo de rango, 5xx -> error + notificación; más reintentos, fallback de
 * totales, aislamiento entre proyectos, dedupe del aviso e idempotencia.
 */
import { describe, it, expect } from "vitest";
import {
  construirUrlAggregate,
  crearClienteVercel,
  normalizarRespuesta,
  normalizarValor,
  calcularEspera,
  ErrorVercel,
  type ClienteVercel,
  type DimensionApi,
  type FilaVercel,
} from "../vercel.ts";
import {
  calcularRango,
  calcularTotales,
  compararTiempoConstante,
  fusionarPorClave,
  procesarPeticion,
  sincronizarProyecto,
  PROYECTOS,
  type Dependencias,
  type EstadoSync,
  type FilaDesglose,
  type FilaDiario,
  type FilaEstado,
  type Repositorio,
  type SlugProyecto,
} from "../sync.ts";

const AHORA = new Date("2026-09-23T03:30:00.000Z");

// ---------------------------------------------------------------------------
// Dobles
// ---------------------------------------------------------------------------
class RepoMemoria implements Repositorio {
  diario = new Map<string, FilaDiario>();
  desglose = new Map<string, FilaDesglose>();
  estado = new Map<SlugProyecto, EstadoSync & Omit<Partial<FilaEstado>, "ultimo_ok_en">>();
  avisos: Array<{ titulo: string; mensaje: string; creado: string }> = [];

  async leerEstado(p: SlugProyecto) {
    return this.estado.get(p) ?? null;
  }
  async upsertDiario(filas: FilaDiario[]) {
    for (const f of filas) this.diario.set(`${f.fecha}|${f.proyecto}|${f.ruta}`, f);
  }
  async upsertDesglose(filas: FilaDesglose[]) {
    for (const f of filas) this.desglose.set(`${f.fecha}|${f.proyecto}|${f.dimension}|${f.valor}`, f);
  }
  async guardarEstado(f: FilaEstado) {
    const prev = this.estado.get(f.proyecto) ?? { ultimo_ok_en: null, fallos_consecutivos: 0 };
    this.estado.set(f.proyecto, { ...prev, ...f, ultimo_ok_en: f.ultimo_ok_en ?? prev.ultimo_ok_en });
  }
  async existeAvisoDesde(desde: string) {
    return this.avisos.some((a) => a.creado >= desde);
  }
  async crearAviso(a: { titulo: string; mensaje: string }) {
    this.avisos.push({ ...a, creado: AHORA.toISOString() });
  }
}

function fila(fecha: string, visitas: number, valor: string | null = null, visitantes: number | null = 1): FilaVercel {
  return { fecha, valor, visitas, visitantes };
}

/** Cliente Vercel falso: respuesta por dimensión o error. */
function vercelFalso(
  resp: Partial<Record<DimensionApi | "day", FilaVercel[] | Error>>,
  llamadas: string[] = [],
): ClienteVercel {
  return {
    async aggregate(projectId, _d, _h, dim) {
      llamadas.push(`${projectId}:${dim ?? "day"}`);
      const r = resp[dim ?? "day"];
      if (r instanceof Error) throw r;
      return { filas: r ?? [], descartadas: 0 };
    },
  };
}

function deps(vercel: ClienteVercel, repo: Repositorio): Dependencias {
  return { vercel, repo, ahora: () => AHORA, log: () => {} };
}

function peticion(secreto?: string, method = "POST") {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secreto !== undefined) headers["x-webhook-secret"] = secreto;
  return new Request("http://localhost/sync-trafico-web", { method, headers, body: method === "POST" ? "{}" : undefined });
}

// ---------------------------------------------------------------------------
// vercel.ts
// ---------------------------------------------------------------------------
describe("construirUrlAggregate", () => {
  it("incluye teamId, projectId, since/until, by=day + dimensión y limit=100", () => {
    const u = new URL(construirUrlAggregate({ projectId: "prj_x", desde: "2026-09-20", hasta: "2026-09-22", dimension: "country" }));
    expect(u.pathname).toBe("/v1/query/web-analytics/visits/aggregate");
    expect(u.searchParams.get("teamId")).toBe("team_wUrFe4kT5oMBrGSl6b3Gvl9Z");
    expect(u.searchParams.get("projectId")).toBe("prj_x");
    expect(u.searchParams.get("since")).toBe("2026-09-20");
    expect(u.searchParams.get("until")).toBe("2026-09-22");
    expect(u.searchParams.getAll("by")).toEqual(["day", "country"]);
    expect(u.searchParams.get("limit")).toBe("100");
  });

  it("by=day solo cuando no hay dimensión (total diario)", () => {
    const u = new URL(construirUrlAggregate({ projectId: "p", desde: "2026-09-01", hasta: "2026-09-01", dimension: null }));
    expect(u.searchParams.getAll("by")).toEqual(["day"]);
  });
});

describe("normalizarRespuesta", () => {
  it("mapea pageviews/visitors y fecha UTC desde timestamp", () => {
    const r = normalizarRespuesta(
      { data: [{ timestamp: "2026-09-22T00:00:00.000Z", pageviews: 12, visitors: 7, requestPath: "/carta" }] },
      "requestPath",
    );
    expect(r).toEqual({ filas: [{ fecha: "2026-09-22", valor: "/carta", visitas: 12, visitantes: 7 }], descartadas: 0 });
  });

  it("sin visitors -> visitantes NULL (no 0) y no aborta", () => {
    const r = normalizarRespuesta({ data: [{ timestamp: "2026-09-22T00:00:00.000Z", pageviews: 3 }] }, null);
    expect(r.filas).toEqual([{ fecha: "2026-09-22", valor: null, visitas: 3, visitantes: null }]);
  });

  it("día sin tráfico (relleno con 0) se guarda como 0 real", () => {
    const r = normalizarRespuesta({ data: [{ timestamp: "2026-09-21T00:00:00.000Z", pageviews: 0, visitors: 0 }] }, null);
    expect(r.filas[0].visitas).toBe(0);
    expect(r.filas[0].visitantes).toBe(0);
  });

  it("descarta filas sin fecha o sin pageviews numérico; tolera cuerpo sin data", () => {
    const r = normalizarRespuesta(
      { data: [{ pageviews: 1 }, { timestamp: "2026-09-21T00:00:00Z", pageviews: null }, null, { timestamp: "2026-09-21T00:00:00Z", pageviews: "4" }] },
      null,
    );
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0].visitas).toBe(4);
    expect(r.descartadas).toBe(3);
    expect(normalizarRespuesta({}, null)).toEqual({ filas: [], descartadas: 0 });
  });

  it("valores vacíos se convierten en literales (valor está en la PK)", () => {
    expect(normalizarValor("referrerHostname", "")).toBe("(directo)");
    expect(normalizarValor("country", null)).toBe("(desconocido)");
    expect(normalizarValor("requestPath", "*")).toBe("/*"); // no pisa el centinela de totales
    expect(normalizarValor("requestPath", "x".repeat(3000))).toHaveLength(2048);
  });
});

describe("crearClienteVercel (reintentos)", () => {
  const ok = () => new Response(JSON.stringify({ data: [{ timestamp: "2026-09-22T00:00:00.000Z", pageviews: 5, visitors: 2 }] }), { status: 200 });

  it("reintenta 429/5xx y acaba devolviendo filas", async () => {
    const estados = [503, 429];
    let n = 0;
    const esperas: number[] = [];
    const c = crearClienteVercel({
      token: "t",
      fetchFn: async (_u, init) => {
        expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer t");
        n++;
        const s = estados.shift();
        return s ? new Response("{}", { status: s }) : ok();
      },
      esperar: async (ms) => void esperas.push(ms),
    });
    const r = await c.aggregate("p", "2026-09-22", "2026-09-22", null);
    expect(n).toBe(3);
    expect(esperas).toHaveLength(2);
    expect(r.filas[0].visitas).toBe(5);
  });

  it("no reintenta un 400 (p.ej. límite Hobby de 31 días) y expone el mensaje", async () => {
    let n = 0;
    const c = crearClienteVercel({
      token: "t",
      fetchFn: async () => {
        n++;
        return new Response(JSON.stringify({ error: { code: "bad_request", message: "the hobby plan only grants access to the latest 31 days of data" } }), { status: 400 });
      },
      esperar: async () => {},
    });
    await expect(c.aggregate("p", "2026-07-01", "2026-09-22", null)).rejects.toMatchObject({ status: 400, reintentable: false });
    expect(n).toBe(1);
  });

  it("5xx persistente -> ErrorVercel tras agotar intentos", async () => {
    let n = 0;
    const c = crearClienteVercel({ token: "t", intentos: 3, fetchFn: async () => (n++, new Response("boom", { status: 500 })), esperar: async () => {} });
    await expect(c.aggregate("p", "2026-09-20", "2026-09-22", "country")).rejects.toBeInstanceOf(ErrorVercel);
    expect(n).toBe(3);
  });

  it("calcularEspera respeta Retry-After con tope de 10 s", () => {
    expect(calcularEspera(1, "2")).toBe(2000);
    expect(calcularEspera(1, "120")).toBe(10_000);
    expect(calcularEspera(2, null)).toBe(2000);
  });
});

// ---------------------------------------------------------------------------
// sync.ts — puras
// ---------------------------------------------------------------------------
describe("compararTiempoConstante", () => {
  it("true solo si son idénticos", () => {
    expect(compararTiempoConstante("abc", "abc")).toBe(true);
    expect(compararTiempoConstante("abc", "abd")).toBe(false);
    expect(compararTiempoConstante("abc", "abcd")).toBe(false);
    expect(compararTiempoConstante("", "x")).toBe(false);
  });
});

describe("calcularRango", () => {
  it("primer run (sin ultimo_ok_en) = backfill de 30 días hasta ayer", () => {
    expect(calcularRango(null, AHORA)).toEqual({ desde: "2026-08-24", hasta: "2026-09-22", dias: 30, backfill: true });
  });

  it("run normal = últimos 3 días cerrados", () => {
    expect(calcularRango("2026-09-22T03:30:05Z", AHORA)).toEqual({ desde: "2026-09-20", hasta: "2026-09-22", dias: 3, backfill: false });
  });

  it("tras una caída amplía hacia atrás para cerrar el hueco", () => {
    expect(calcularRango("2026-09-15T03:30:00Z", AHORA)).toMatchObject({ desde: "2026-09-13", hasta: "2026-09-22", dias: 10 });
  });

  it("nunca pide más de 30 días (límite Hobby 31)", () => {
    expect(calcularRango("2026-06-01T00:00:00Z", AHORA).desde).toBe("2026-08-24");
  });

  it("cruza cambio de mes/año en UTC", () => {
    expect(calcularRango("2026-12-31T03:30:00Z", new Date("2027-01-01T03:30:00Z"))).toMatchObject({ desde: "2026-12-29", hasta: "2026-12-31" });
  });
});

describe("fusionarPorClave / calcularTotales", () => {
  it("fusiona valores repetidos sumando visitas y anulando visitantes", () => {
    const r = fusionarPorClave([fila("2026-09-22", 2, "(directo)", 2), fila("2026-09-22", 3, "(directo)", 1), fila("2026-09-22", 1, "g.com", 1)]);
    expect(r).toContainEqual({ fecha: "2026-09-22", valor: "(directo)", visitas: 5, visitantes: null });
    expect(r).toContainEqual({ fecha: "2026-09-22", valor: "g.com", visitas: 1, visitantes: 1 });
  });

  it("usa by=day como total; si la suma de rutas es mayor toma la suma", () => {
    const t = calcularTotales([fila("2026-09-21", 10, null, 6), fila("2026-09-22", 1, null, 1)], [fila("2026-09-22", 4, "/"), fila("2026-09-21", 3, "/")]);
    expect(t).toEqual([
      { fecha: "2026-09-21", visitas: 10, visitantes: 6 },
      { fecha: "2026-09-22", visitas: 4, visitantes: 1 },
    ]);
  });

  it("fallback: sin by=day suma rutas y deja visitantes NULL", () => {
    expect(calcularTotales(null, [fila("2026-09-22", 4, "/"), fila("2026-09-22", 2, "/carta")])).toEqual([{ fecha: "2026-09-22", visitas: 6, visitantes: null }]);
  });
});

// ---------------------------------------------------------------------------
// sincronizarProyecto
// ---------------------------------------------------------------------------
const CASA = PROYECTOS[0];

describe("sincronizarProyecto", () => {
  it("guarda totales '*', rutas y desgloses y marca estado OK", async () => {
    const repo = new RepoMemoria();
    const r = await sincronizarProyecto(
      CASA,
      deps(
        vercelFalso({
          day: [fila("2026-09-22", 9, null, 5)],
          requestPath: [fila("2026-09-22", 6, "/"), fila("2026-09-22", 3, "/carta")],
          deviceType: [fila("2026-09-22", 9, "mobile")],
          country: [fila("2026-09-22", 9, "ES")],
          referrerHostname: [fila("2026-09-22", 9, "(directo)")],
        }),
        repo,
      ),
    );
    expect(r.ok).toBe(true);
    expect(r.backfill).toBe(true);
    expect(r.total_origen).toBe("by_day");
    expect(repo.diario.get("2026-09-22|casa-tomas-story|*")).toMatchObject({ visitas: 9, visitantes: 5 });
    expect(repo.diario.get("2026-09-22|casa-tomas-story|/carta")?.visitas).toBe(3);
    expect(repo.desglose.get("2026-09-22|casa-tomas-story|device|mobile")?.visitas).toBe(9);
    expect(repo.desglose.get("2026-09-22|casa-tomas-story|referrer|(directo)")).toBeDefined();
    expect(repo.estado.get("casa-tomas-story")).toMatchObject({ fallos_consecutivos: 0, ultimo_error: null, dias_ultimo_sync: 30 });
  });

  it("ejecutarlo dos veces no duplica filas (upsert por PK)", async () => {
    const repo = new RepoMemoria();
    const v = vercelFalso({ day: [fila("2026-09-22", 9)], requestPath: [fila("2026-09-22", 9, "/")], country: [fila("2026-09-22", 9, "ES")] });
    await sincronizarProyecto(CASA, deps(v, repo));
    const n1 = repo.diario.size + repo.desglose.size;
    await sincronizarProyecto(CASA, deps(v, repo));
    expect(repo.diario.size + repo.desglose.size).toBe(n1);
  });

  it("by=day rechazado con 400 -> total = suma de rutas, sigue siendo éxito", async () => {
    const repo = new RepoMemoria();
    const r = await sincronizarProyecto(
      CASA,
      deps(vercelFalso({ day: new ErrorVercel("Vercel 400: invalid groupBy", 400, false), requestPath: [fila("2026-09-22", 4, "/"), fila("2026-09-22", 2, "/carta")] }), repo),
    );
    expect(r.ok).toBe(true);
    expect(r.total_origen).toBe("suma_rutas");
    expect(repo.diario.get("2026-09-22|casa-tomas-story|*")).toMatchObject({ visitas: 6, visitantes: null });
  });

  it("una dimensión de desglose que falla solo genera aviso", async () => {
    const repo = new RepoMemoria();
    const r = await sincronizarProyecto(CASA, deps(vercelFalso({ day: [fila("2026-09-22", 1)], country: new ErrorVercel("Vercel 400: x", 400, false) }), repo));
    expect(r.ok).toBe(true);
    expect(r.avisos.some((a) => a.includes("country"))).toBe(true);
  });

  it("5xx de Vercel -> estado con error y fallos_consecutivos+1, conserva el último OK", async () => {
    const repo = new RepoMemoria();
    repo.estado.set("casa-tomas-story", { ultimo_ok_en: "2026-09-22T03:30:00Z", fallos_consecutivos: 1 });
    const e = new ErrorVercel("Vercel 503 (by=day): unavailable", 503, true);
    const r = await sincronizarProyecto(CASA, deps(vercelFalso({ day: e, requestPath: e }), repo));
    expect(r.ok).toBe(false);
    expect(repo.estado.get("casa-tomas-story")).toMatchObject({ fallos_consecutivos: 2, ultimo_error: expect.stringContaining("503"), ultimo_ok_en: "2026-09-22T03:30:00Z" });
    expect(repo.diario.size).toBe(0);
  });

  it("401 en by=day NO cae al fallback aunque las rutas funcionen", async () => {
    const repo = new RepoMemoria();
    const r = await sincronizarProyecto(CASA, deps(vercelFalso({ day: new ErrorVercel("Vercel 401", 401, false), requestPath: [fila("2026-09-22", 1, "/")] }), repo));
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// procesarPeticion (HTTP)
// ---------------------------------------------------------------------------
describe("procesarPeticion", () => {
  function cfg(repo: RepoMemoria, vercel: ClienteVercel, over: Partial<{ secreto: string; token: string }> = {}) {
    let creadas = 0;
    return {
      cfg: {
        secreto: over.secreto ?? "s3creto",
        token: over.token ?? "tok",
        crearDependencias: () => (creadas++, deps(vercel, repo)),
        log: () => {},
      },
      creadas: () => creadas,
    };
  }

  it("500 si falta TRAFICO_WEB_CRON_SECRET (fail closed) y no llama a Vercel", async () => {
    const llamadas: string[] = [];
    const { cfg: c, creadas } = cfg(new RepoMemoria(), vercelFalso({}, llamadas), { secreto: "" });
    const res = await procesarPeticion(peticion("lo-que-sea"), c);
    expect(res.status).toBe(500);
    expect(creadas()).toBe(0);
    expect(llamadas).toHaveLength(0);
  });

  it("401 sin cabecera x-webhook-secret", async () => {
    const llamadas: string[] = [];
    const { cfg: c } = cfg(new RepoMemoria(), vercelFalso({}, llamadas));
    expect((await procesarPeticion(peticion(), c)).status).toBe(401);
    expect(llamadas).toHaveLength(0);
  });

  it("401 con cabecera incorrecta", async () => {
    const { cfg: c } = cfg(new RepoMemoria(), vercelFalso({}));
    expect((await procesarPeticion(peticion("s3creto-no"), c)).status).toBe(401);
  });

  it("405 si no es POST", async () => {
    const { cfg: c } = cfg(new RepoMemoria(), vercelFalso({}));
    expect((await procesarPeticion(peticion("s3creto", "GET"), c)).status).toBe(405);
  });

  it("500 si falta VERCEL_ANALYTICS_TOKEN (tras autenticar)", async () => {
    const { cfg: c } = cfg(new RepoMemoria(), vercelFalso({}), { token: "" });
    expect((await procesarPeticion(peticion("s3creto"), c)).status).toBe(500);
  });

  it("200 con ambos proyectos OK y sin aviso", async () => {
    const repo = new RepoMemoria();
    const { cfg: c } = cfg(repo, vercelFalso({ day: [fila("2026-09-22", 1)] }));
    const res = await procesarPeticion(peticion("s3creto"), c);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body.proyectos)).toEqual(["casa-tomas-story", "touza-restaurant-website"]);
    expect(repo.avisos).toHaveLength(0);
  });

  it("un proyecto con 5xx no bloquea al otro -> 207 + 1 notificación", async () => {
    const repo = new RepoMemoria();
    const caido = new ErrorVercel("Vercel 502: bad gateway", 502, true);
    const vercel: ClienteVercel = {
      async aggregate(projectId, d, h, dim) {
        if (projectId === PROYECTOS[1].projectId) throw caido;
        return vercelFalso({ day: [fila("2026-09-22", 2)] }).aggregate(projectId, d, h, dim);
      },
    };
    const { cfg: c } = cfg(repo, vercel);
    const res = await procesarPeticion(peticion("s3creto"), c);
    expect(res.status).toBe(207);
    expect(repo.diario.get("2026-09-22|casa-tomas-story|*")?.visitas).toBe(2);
    expect(repo.estado.get("touza-restaurant-website")).toMatchObject({ fallos_consecutivos: 1, ultimo_error: expect.stringContaining("502") });
    expect(repo.avisos).toHaveLength(1);
    expect(repo.avisos[0].titulo).toContain("touza-restaurant-website");
  });

  it("ambos caídos -> 502; relanzar el mismo día NO crea un segundo aviso (R3)", async () => {
    const repo = new RepoMemoria();
    const e = new ErrorVercel("Vercel 500", 500, true);
    const { cfg: c } = cfg(repo, vercelFalso({ day: e, requestPath: e }));
    expect((await procesarPeticion(peticion("s3creto"), c)).status).toBe(502);
    expect((await procesarPeticion(peticion("s3creto"), c)).status).toBe(502);
    expect(repo.avisos).toHaveLength(1);
    expect(repo.estado.get("casa-tomas-story")?.fallos_consecutivos).toBe(2);
  });
});
