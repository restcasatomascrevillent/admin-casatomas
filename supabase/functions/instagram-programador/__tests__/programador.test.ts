// @vitest-environment node
/**
 * Edge Function instagram-programador sin red: Supabase falso (RPC
 * instagram_programador_reclamar / _cerrar con la misma semántica que la
 * migración, e instagram_piezas y Storage de la simulación compartida) y
 * Graph API falsa. Cubre: autenticación del cron (fail-closed, tiempo
 * constante), solo vencidas, bloqueo (dos pasadas a la vez publican una sola
 * vez), reintentos con espera creciente hasta error, cuota (aplaza sin contar
 * y corta la pasada), idempotencia (media_id → sin Meta), 202 con el mismo
 * contenedor, contenedor ya publicado, cabecera de auditoría y secretos.
 * La semántica SQL real (SKIP LOCKED, bloqueos caducados) se prueba en
 * scripts/test-instagram-programar.mjs (PGlite).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clasificar,
  ESPERA_CUOTA_SEG,
  ESPERAS_REINTENTO_SEG,
  manejarProgramador,
  type FuncionPublicar,
} from "../programador.ts";
import { olvidarSecretos } from "../../_shared/instagram/secretos.ts";
import { ENV_META, falso, FILA_GENERADA, ID, metaPublicacion, resp, SB, TOKEN_META, type Llamada } from "../../_shared/instagram/__tests__/simulacion.ts";

const SECRETO = "secreto-del-cron-de-instagram-0123456789";
const CLAVE_SERVICIO = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.claveDeServicioSuperSecreta";
const ENV = { ...ENV_META, SUPABASE_SERVICE_ROLE_KEY: CLAVE_SERVICIO, INSTAGRAM_PROGRAMADOR_SECRET: SECRETO };
const T0 = Date.parse("2026-11-10T09:00:00Z");

type Prog = {
  id: string; pieza_id: string; marca: string; programada_para: string; estado: string; intentos: number;
  siguiente: number; contenedor_id: string | null; bloqueo_id: string | null; media_id: string | null;
  permalink: string | null; ultimo_error: string | null;
};

function prog(id: string, o: Partial<Prog> = {}): Prog {
  return {
    id, pieza_id: ID, marca: "casa-tomas", programada_para: new Date(T0 - 60_000).toISOString(), estado: "programada",
    intentos: 0, siguiente: T0 - 60_000, contenedor_id: null, bloqueo_id: null, media_id: null, permalink: null, ultimo_error: null, ...o,
  };
}

/** Supabase falso: RPC del programador en memoria + la simulación de piezas/Storage/Meta. */
function entorno(o: { progs: Prog[]; fila?: Record<string, unknown> | null; meta?: Parameters<typeof falso>[0]["meta"] }) {
  const reloj = { t: T0 };
  const base = falso({ fila: o.fila === undefined ? FILA_GENERADA : o.fila, meta: o.meta });
  const llamadas: Llamada[] = [];
  let n = 0;
  const f = vi.fn(async (entrada: string | URL | Request, init: RequestInit = {}) => {
    const url = String(entrada);
    const cabeceras = Object.fromEntries(new Headers(init.headers as HeadersInit).entries());
    llamadas.push({ url, metodo: (init.method ?? "GET").toUpperCase(), cabeceras, cuerpo: typeof init.body === "string" ? init.body : null });
    if (url === `${SB}/rest/v1/rpc/instagram_programador_reclamar`) {
      const p = o.progs.filter((x) => x.estado === "programada" && x.siguiente <= reloj.t).sort((a, b) => a.siguiente - b.siguiente)[0];
      if (!p) return resp(200, []);
      p.estado = "publicando";
      p.bloqueo_id = `bloqueo-${++n}`;
      return resp(200, [{ ...p }]);
    }
    if (url === `${SB}/rest/v1/rpc/instagram_programador_cerrar`) {
      const c = JSON.parse(String(init.body));
      const p = o.progs.find((x) => x.id === c.p_id && x.estado === "publicando" && x.bloqueo_id === c.p_bloqueo);
      if (!p) return resp(400, { message: "La programación ya no está bloqueada por esta pasada" });
      p.bloqueo_id = null;
      const siguiente = reloj.t + (c.p_espera_seg ?? 0) * 1000;
      if (c.p_resultado === "publicada") Object.assign(p, { estado: "publicada", media_id: c.p_media_id, permalink: c.p_permalink, ultimo_error: c.p_mensaje });
      else if (c.p_resultado === "aplazar") Object.assign(p, { estado: "programada", siguiente, contenedor_id: c.p_contenedor_id, ultimo_error: c.p_mensaje });
      else if (c.p_resultado === "reintentar") {
        const intentos = Math.min(3, p.intentos + 1);
        Object.assign(p, intentos >= 3
          ? { estado: "error", intentos, ultimo_error: c.p_mensaje, contenedor_id: null }
          : { estado: "programada", intentos, siguiente, ultimo_error: c.p_mensaje, contenedor_id: c.p_contenedor_id });
      } else Object.assign(p, { estado: "error", intentos: Math.min(3, p.intentos + 1), ultimo_error: c.p_mensaje, contenedor_id: null });
      return resp(200, { ...p });
    }
    return base.f(entrada, init);
  });
  const peticion = (secreto: string | null = SECRETO, metodo = "POST") =>
    new Request(`${SB}/functions/v1/instagram-programador`, {
      method: metodo,
      headers: { "Content-Type": "application/json", ...(secreto === null ? {} : { "x-webhook-secret": secreto }) },
      ...(metodo === "GET" ? {} : { body: "{}" }),
    });
  const deps = (extra: Record<string, unknown> = {}) => ({
    env: ENV, fetch: f as unknown as typeof fetch, ahora: () => reloj.t, dormir: async () => undefined, intervaloMs: 1, ...extra,
  });
  return { reloj, f, llamadas, fila: base.fila, peticion, deps };
}

const publicarFalso = (respuestas: Array<[number, unknown]>) => {
  const cola = [...respuestas];
  return vi.fn<FuncionPublicar>(async (_s, req) => {
    const [estado, cuerpo] = cola.length > 1 ? cola.shift()! : cola[0];
    void (await req.json());
    return resp(estado, cuerpo);
  });
};

beforeEach(() => olvidarSecretos());
afterEach(() => vi.restoreAllMocks());

describe("instagram-programador: autenticación del cron", () => {
  it("401 sin cabecera o con un secreto incorrecto, sin tocar Supabase", async () => {
    const e = entorno({ progs: [prog("p1")] });
    expect((await manejarProgramador(e.peticion(null), e.deps())).status).toBe(401);
    expect((await manejarProgramador(e.peticion("otro"), e.deps())).status).toBe(401);
    expect((await manejarProgramador(e.peticion(SECRETO.slice(0, -1)), e.deps())).status).toBe(401);
    expect(e.f).not.toHaveBeenCalled();
  });

  it("falla cerrado (500) si falta INSTAGRAM_PROGRAMADOR_SECRET, y 405 con GET", async () => {
    const e = entorno({ progs: [prog("p1")] });
    const r = await manejarProgramador(e.peticion(""), e.deps({ env: { ...ENV, INSTAGRAM_PROGRAMADOR_SECRET: "" } }));
    expect(r.status).toBe(500);
    expect((await manejarProgramador(e.peticion(SECRETO, "GET"), e.deps())).status).toBe(405);
    expect(e.f).not.toHaveBeenCalled();
  });
});

describe("instagram-programador: pasada", () => {
  it("publica la vencida con el núcleo real y deja la futura; Supabase con x-audit-source y service_role, Meta sin ellos", async () => {
    const { m, orden } = metaPublicacion();
    const futura = prog("p2", { siguiente: T0 + 3_600_000, pieza_id: "otra" });
    const progs = [prog("p1"), futura];
    const e = entorno({ progs, meta: m });
    const r = await manejarProgramador(e.peticion(), e.deps());
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, procesadas: 1, resultados: [{ id: "p1", resultado: "publicada", estado: "publicada" }] });
    expect(orden).toEqual(["cuota", "media", "estado:FINISHED", "publish", "permalink"]);
    expect(progs[0]).toMatchObject({ estado: "publicada", media_id: "1800000000000009", permalink: "https://www.instagram.com/p/ABC123/" });
    expect(futura.estado).toBe("programada");
    expect(e.fila()).toMatchObject({ estado: "publicada", media_id: "1800000000000009" });
    const aSupabase = e.llamadas.filter((l) => l.url.startsWith(`${SB}/rest/`) || l.url.startsWith(`${SB}/storage/v1/object/instagram`));
    expect(aSupabase.length).toBeGreaterThan(0);
    for (const l of aSupabase) {
      expect(l.cabeceras["x-audit-source"]).toBe("instagram-programador");
      expect(l.cabeceras.authorization).toBe(`Bearer ${CLAVE_SERVICIO}`);
    }
    for (const l of e.llamadas.filter((x) => x.url.startsWith("https://graph.facebook.com/"))) {
      expect(l.cabeceras["x-audit-source"]).toBeUndefined();
      expect(JSON.stringify(l.cabeceras)).not.toContain(CLAVE_SERVICIO);
    }
  });

  it("sin vencidas no llama a Meta ni al núcleo", async () => {
    const publicar = publicarFalso([[200, {}]]);
    const e = entorno({ progs: [prog("p1", { siguiente: T0 + 60_000 })] });
    const r = await manejarProgramador(e.peticion(), e.deps({ publicar }));
    expect(await r.json()).toMatchObject({ ok: true, procesadas: 0 });
    expect(publicar).not.toHaveBeenCalled();
  });

  it("bloqueo: dos pasadas a la vez sobre la misma vencida publican UNA sola vez", async () => {
    const { m, orden } = metaPublicacion();
    const progs = [prog("p1")];
    const e = entorno({ progs, meta: m });
    const [a, b] = await Promise.all([manejarProgramador(e.peticion(), e.deps()), manejarProgramador(e.peticion(), e.deps())]);
    const total = (await a.json()).procesadas + (await b.json()).procesadas;
    expect(total).toBe(1);
    expect(orden.filter((x) => x === "publish")).toHaveLength(1);
    expect(progs[0].estado).toBe("publicada");
  });

  it("idempotencia: si la pieza ya tiene media_id, la cierra como publicada sin llamar a Meta", async () => {
    const meta = vi.fn(() => undefined);
    const progs = [prog("p1")];
    const e = entorno({ progs, meta, fila: { ...FILA_GENERADA, estado: "error", media_id: "1800000000000055", permalink: "https://www.instagram.com/p/YA/" } });
    const r = await manejarProgramador(e.peticion(), e.deps());
    expect(await r.json()).toMatchObject({ resultados: [{ resultado: "publicada" }] });
    expect(progs[0]).toMatchObject({ estado: "publicada", media_id: "1800000000000055" });
    expect(meta).not.toHaveBeenCalled();
  });

  it("reintentos: espera creciente (5 y 15 min) y error al 3.er fallo, sin volver a intentarlo antes de tiempo", async () => {
    const publicar = publicarFalso([[502, { ok: false, error: "Error de Meta", tipo: "otro" }]]);
    const progs = [prog("p1")];
    const e = entorno({ progs });
    await manejarProgramador(e.peticion(), e.deps({ publicar }));
    expect(progs[0]).toMatchObject({ estado: "programada", intentos: 1, ultimo_error: expect.stringContaining("Error de Meta") });
    expect(progs[0].siguiente).toBe(e.reloj.t + ESPERAS_REINTENTO_SEG[0] * 1000);

    e.reloj.t += ESPERAS_REINTENTO_SEG[0] * 1000 - 1_000; // aún no toca
    await manejarProgramador(e.peticion(), e.deps({ publicar }));
    expect(publicar).toHaveBeenCalledTimes(1);

    e.reloj.t += 1_000;
    await manejarProgramador(e.peticion(), e.deps({ publicar }));
    expect(progs[0]).toMatchObject({ estado: "programada", intentos: 2 });
    expect(progs[0].siguiente).toBe(e.reloj.t + ESPERAS_REINTENTO_SEG[1] * 1000);
    expect(ESPERAS_REINTENTO_SEG[1]).toBeGreaterThan(ESPERAS_REINTENTO_SEG[0]);

    e.reloj.t = progs[0].siguiente;
    await manejarProgramador(e.peticion(), e.deps({ publicar }));
    expect(progs[0]).toMatchObject({ estado: "error", intentos: 3 });
    e.reloj.t += 3_600_000;
    await manejarProgramador(e.peticion(), e.deps({ publicar }));
    expect(publicar).toHaveBeenCalledTimes(3);
  });

  it("cuota agotada (núcleo real): aplaza sin contar intento, no crea contenedor y deja las demás para la siguiente pasada", async () => {
    const { m, orden } = metaPublicacion({ usadas: 100, total: 100 });
    const otra = prog("p2", { siguiente: T0 - 30_000 });
    const progs = [prog("p1"), otra];
    const e = entorno({ progs, meta: m });
    const r = await manejarProgramador(e.peticion(), e.deps());
    expect(await r.json()).toMatchObject({ procesadas: 1, resultados: [{ id: "p1", resultado: "aplazar" }] });
    expect(orden).toEqual(["cuota"]);
    expect(progs[0]).toMatchObject({ estado: "programada", intentos: 0, ultimo_error: expect.stringContaining("Cuota de publicación agotada") });
    expect(progs[0].siguiente).toBe(T0 + ESPERA_CUOTA_SEG * 1000);
    expect(otra).toMatchObject({ estado: "programada", intentos: 0, bloqueo_id: null });
  });

  it("202 (Meta aún procesa): la siguiente pasada reutiliza el MISMO contenedor, sin crear otro", async () => {
    const { m, orden } = metaPublicacion({ estados: ["IN_PROGRESS", "IN_PROGRESS", "IN_PROGRESS", "FINISHED"] });
    const progs = [prog("p1")];
    const e = entorno({ progs, meta: m });
    // Primera pasada: sondeo con presupuesto mínimo → 202.
    let reloj = 0;
    const ahoraQueAvanza = () => (e.reloj.t += ++reloj % 2 ? 0 : 2_000);
    await manejarProgramador(e.peticion(), e.deps({ ahora: ahoraQueAvanza, presupuestoSondeoMs: 1 }));
    expect(progs[0]).toMatchObject({ estado: "programada", intentos: 1, contenedor_id: "1790000000000001" });
    expect(orden.filter((x) => x === "media")).toHaveLength(1);
    // Segunda pasada: publica con ese contenedor.
    e.reloj.t = progs[0].siguiente;
    await manejarProgramador(e.peticion(), e.deps());
    expect(progs[0]).toMatchObject({ estado: "publicada", media_id: "1800000000000009" });
    expect(orden.filter((x) => x === "media")).toHaveLength(1);
    expect(orden.filter((x) => x === "publish")).toHaveLength(1);
  });

  it("errores definitivos (422, 404, contenedor ya publicado) no se reintentan", async () => {
    for (const [estado, cuerpo, texto] of [
      [422, { ok: false, error: "Meta no podría descargar la imagen", problemas: ["La URL pública del JPEG responde 404"] }, "404"],
      [404, { ok: false, error: "No existe esa pieza (o no tienes acceso)" }, "No existe"],
      [502, { ok: false, error: "x", tipo: "contenedor_ya_publicado" }, "ya se publicó"],
    ] as Array<[number, unknown, string]>) {
      const publicar = publicarFalso([[estado, cuerpo]]);
      const progs = [prog("p1")];
      const e = entorno({ progs });
      await manejarProgramador(e.peticion(), e.deps({ publicar }));
      expect(progs[0].estado).toBe("error");
      expect(progs[0].ultimo_error).toContain(texto);
    }
  });

  it("nunca devuelve ni registra el token de Meta, la clave de servicio ni el secreto del cron", async () => {
    const consola = [vi.spyOn(console, "log"), vi.spyOn(console, "info"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    consola.forEach((c) => c.mockImplementation(() => undefined));
    const publicar = vi.fn<FuncionPublicar>(async () => {
      throw new Error(`fallo con ${TOKEN_META} y ${CLAVE_SERVICIO} y ${SECRETO}`);
    });
    const progs = [prog("p1")];
    const e = entorno({ progs });
    const r = await manejarProgramador(e.peticion(), e.deps({ publicar }));
    const texto = await r.text();
    const registrado = consola.flatMap((c) => c.mock.calls.map((a) => JSON.stringify(a))).join("\n");
    for (const s of [TOKEN_META, CLAVE_SERVICIO, SECRETO]) {
      expect(texto).not.toContain(s);
      expect(registrado).not.toContain(s);
      expect(progs[0].ultimo_error ?? "").not.toContain(s);
    }
    expect(progs[0]).toMatchObject({ estado: "programada", intentos: 1 });
  });
});

describe("clasificar", () => {
  const p = { intentos: 0 };
  it("decide el cierre según la respuesta del núcleo", () => {
    expect(clasificar(200, { publicado: true, mediaId: "1", permalink: "u", avisos: [] }, p, null)).toMatchObject({ resultado: "publicada", mediaId: "1", mensaje: null });
    expect(clasificar(429, { error: "Cuota" }, p, null)).toMatchObject({ resultado: "aplazar", esperaSeg: ESPERA_CUOTA_SEG });
    expect(clasificar(202, { reintentar: { contenedorId: "17" } }, p, null)).toMatchObject({ resultado: "reintentar", contenedorId: "17" });
    expect(clasificar(503, { error: "Faltan secretos" }, { intentos: 1 }, null)).toMatchObject({ resultado: "reintentar", esperaSeg: ESPERAS_REINTENTO_SEG[1] });
    expect(clasificar(502, { error: "x", contenedor: { id: "17" } }, p, null)).toMatchObject({ resultado: "reintentar", contenedorId: "17" });
    expect(clasificar(502, { error: "x", tipo: "contenedor_caducado" }, p, "17")).toMatchObject({ resultado: "reintentar", contenedorId: null });
    expect(clasificar(409, { error: "Ese contenedor no es el de esta pieza" }, p, "17")).toMatchObject({ resultado: "reintentar", contenedorId: null });
    expect(clasificar(409, { error: "La pieza no tiene imagen" }, p, null)).toMatchObject({ resultado: "error" });
    expect(clasificar(200, { publicado: false }, p, null)).toMatchObject({ resultado: "reintentar" });
    // Alguien la está probando o publicando a mano: a la siguiente pasada, sin contar intento.
    expect(clasificar(409, { tipo: "publicacion_en_curso", error: "en curso" }, p, "17")).toMatchObject({ resultado: "aplazar", contenedorId: "17" });
    expect(clasificar(409, { tipo: "imagen_borrada", error: "La imagen se borró" }, p, null)).toMatchObject({ resultado: "error" });
  });
});

describe("instagram-programador: núcleo con origen y limpieza del bucket", () => {
  it("publica como «programador» (el cerrojo no le pide cancelar su propia programación)", async () => {
    const progs = [prog("p1")];
    const e = entorno({ progs });
    const publicar = publicarFalso([[200, { publicado: true, mediaId: "1800000000000009", permalink: "u" }]]);
    await manejarProgramador(e.peticion(), e.deps({ publicar }));
    expect(publicar.mock.calls[0][2]).toMatchObject({ origen: "programador" });
    // Con el núcleo real, la reserva va sin comprobar la programación.
    const e2 = entorno({ progs: [prog("p2")], meta: metaPublicacion().m });
    await manejarProgramador(e2.peticion(), e2.deps());
    const reserva = e2.llamadas.find((l) => l.url.endsWith("/rpc/instagram_pieza_reservar_publicacion"))!;
    expect(JSON.parse(reserva.cuerpo!)).toMatchObject({ p_comprobar_programacion: false });
  });

  it("«limpiar»: reclama los JPEG caducados (RPC), los borra por Storage solo en piezas/ y limpia tmp/ de más de 24 h", async () => {
    const e = entorno({ progs: [] });
    const borrados: string[][] = [];
    const f = vi.fn(async (entrada: string | URL | Request, init: RequestInit = {}) => {
      const url = String(entrada);
      if (url === `${SB}/rest/v1/rpc/instagram_piezas_reclamar_jpeg_caducados`) {
        expect(JSON.parse(String(init.body))).toEqual({ p_dias: 7, p_limite: 100 });
        expect(new Headers(init.headers as HeadersInit).get("authorization")).toBe(`Bearer ${CLAVE_SERVICIO}`);
        return resp(200, [{ id: "a", imagen_ruta: "piezas/2026-11/a.jpg" }, { id: "b", imagen_ruta: "fotos/raro.jpg" }]);
      }
      if (url === `${SB}/storage/v1/object/list/instagram`) {
        return resp(200, [{ name: "vieja.jpg", created_at: new Date(T0 - 48 * 3600_000).toISOString() }, { name: "nueva.jpg", created_at: new Date(T0 - 3600_000).toISOString() }]);
      }
      if (url === `${SB}/storage/v1/object/instagram` && init.method === "DELETE") {
        const prefijos = JSON.parse(String(init.body)).prefixes as string[];
        borrados.push(prefijos);
        return resp(200, prefijos.map((name) => ({ name })));
      }
      throw new Error(`URL inesperada ${url}`);
    });
    const r = await manejarProgramador(
      new Request(`${SB}/functions/v1/instagram-programador`, { method: "POST", headers: { "x-webhook-secret": SECRETO, "Content-Type": "application/json" }, body: JSON.stringify({ accion: "limpiar" }) }),
      { ...e.deps(), fetch: f as unknown as typeof fetch },
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, accion: "limpiar", jpegMarcados: 2, jpegBorrados: 1, tmpBorrados: 1 });
    expect(borrados).toEqual([["piezas/2026-11/a.jpg"], ["tmp/vieja.jpg"]]);
  });

  it("acción desconocida → 400 (con el secreto correcto)", async () => {
    const e = entorno({ progs: [] });
    const r = await manejarProgramador(
      new Request(`${SB}/functions/v1/instagram-programador`, { method: "POST", headers: { "x-webhook-secret": SECRETO }, body: JSON.stringify({ accion: "borrar-todo" }) }),
      e.deps(),
    );
    expect(r.status).toBe(400);
  });
});
