/**
 * Cliente REST de Resend Marketing (_shared/resend-marketing/cliente.ts).
 * fetch FALSO en todos los casos: estos tests nunca llaman a Resend.
 */
import { describe, it, expect, vi } from "vitest";
import {
  ClienteResendMarketing,
  LimitadorPeticiones,
  clasificarError,
  esperaReintento,
  type FetchLike,
} from "../resend-marketing/cliente.ts";

type Llamada = { url: string; method: string; body?: unknown; headers: Record<string, string> };

function respuesta(status: number, cuerpo: unknown, cabeceras: Record<string, string> = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (n: string) => cabeceras[n.toLowerCase()] ?? null },
    text: async () => (cuerpo === undefined ? "" : JSON.stringify(cuerpo)),
  };
}

function fetchFalso(respuestas: ReturnType<typeof respuesta>[]) {
  const llamadas: Llamada[] = [];
  const fn: FetchLike = async (url, init) => {
    llamadas.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    const r = respuestas.shift();
    if (!r) throw new Error(`petición inesperada: ${init.method} ${url}`);
    return r;
  };
  return { fn, llamadas };
}

function cliente(respuestas: ReturnType<typeof respuesta>[], extra: Partial<ConstructorParameters<typeof ClienteResendMarketing>[0]> = {}) {
  const f = fetchFalso(respuestas);
  const dormir = vi.fn(async () => {});
  const c = new ClienteResendMarketing({
    apiKey: "re_test",
    fetch: f.fn,
    dormir,
    limitador: new LimitadorPeticiones(1000, () => 0, async () => {}),
    log: () => {},
    ...extra,
  });
  return { c, llamadas: f.llamadas, dormir };
}

describe("LimitadorPeticiones", () => {
  it("con 8/s deja al menos 125 ms entre peticiones", async () => {
    let t = 0;
    const esperas: number[] = [];
    const lim = new LimitadorPeticiones(8, () => t, async (ms) => {
      esperas.push(ms);
      t += ms;
    });
    for (let i = 0; i < 4; i++) await lim.esperarTurno();
    expect(esperas).toEqual([125, 125, 125]);
    expect(t).toBe(375);
  });

  it("no espera si ya ha pasado el intervalo", async () => {
    let t = 0;
    const dormir = vi.fn(async () => {});
    const lim = new LimitadorPeticiones(8, () => t, dormir);
    await lim.esperarTurno();
    t = 1000;
    await lim.esperarTurno();
    expect(dormir).not.toHaveBeenCalled();
  });
});

describe("clasificarError", () => {
  it("429 rate_limit_exceeded se reintenta", () => {
    expect(clasificarError(429, { name: "rate_limit_exceeded", message: "Too many" }, false)).toEqual({
      tipo: "rate_limit_exceeded",
      mensaje: "Too many",
      reintentable: true,
    });
  });

  it("429 de cuota diaria o mensual NO se reintenta (no se arregla esperando)", () => {
    expect(clasificarError(429, { name: "daily_quota_exceeded" }, true).reintentable).toBe(false);
    expect(clasificarError(429, { name: "monthly_quota_exceeded" }, true).reintentable).toBe(false);
  });

  it("5xx y red según la opción; 4xx nunca", () => {
    expect(clasificarError(500, {}, true).reintentable).toBe(true);
    expect(clasificarError(503, {}, false).reintentable).toBe(false);
    expect(clasificarError(0, { name: "network_error" }, true).reintentable).toBe(true);
    expect(clasificarError(422, { name: "validation_error" }, true).reintentable).toBe(false);
    expect(clasificarError(409, { name: "resource_locked" }, false).reintentable).toBe(true);
  });
});

describe("esperaReintento", () => {
  it("respeta retry-after (segundos)", () => {
    expect(esperaReintento(1, "2")).toBe(2050);
  });
  it("exponencial con tope si no hay retry-after", () => {
    expect(esperaReintento(1, null, 10_000, () => 0)).toBe(1000);
    expect(esperaReintento(2, null, 10_000, () => 0)).toBe(2000);
    expect(esperaReintento(3, null, 10_000, () => 0)).toBe(4000);
    expect(esperaReintento(10, null, 10_000, () => 0)).toBe(10_000);
  });
});

describe("ClienteResendMarketing", () => {
  it("exige API key", () => {
    expect(() => new ClienteResendMarketing({ apiKey: "" })).toThrow(/RESEND_MARKETING_API_KEY/);
  });

  it("manda Bearer y JSON", async () => {
    const { c, llamadas } = cliente([respuesta(200, { object: "list", has_more: false, data: [] })]);
    await c.listarSegmentos();
    expect(llamadas[0].headers.Authorization).toBe("Bearer re_test");
    expect(llamadas[0].headers["Content-Type"]).toBe("application/json");
    expect(llamadas[0].url).toBe("https://api.resend.com/segments?limit=100");
  });

  it("429 rate limit: espera retry-after y reintenta", async () => {
    const { c, llamadas, dormir } = cliente([
      respuesta(429, { name: "rate_limit_exceeded", message: "slow down" }, { "retry-after": "1" }),
      respuesta(200, { id: "c1" }),
    ]);
    const r = await c.borrarContacto("c1");
    expect(r.ok).toBe(true);
    expect(llamadas).toHaveLength(2);
    expect(dormir).toHaveBeenCalledWith(1050);
  });

  it("deja de reintentar al llegar al máximo y devuelve el error", async () => {
    const rl = () => respuesta(429, { name: "rate_limit_exceeded", message: "x" });
    const { c, llamadas } = cliente([rl(), rl(), rl()], { maxReintentos: 2 });
    const r = await c.borrarContacto("c1");
    expect(r).toMatchObject({ ok: false, status: 429, tipo: "rate_limit_exceeded" });
    expect(llamadas).toHaveLength(3);
  });

  it("429 de cuota: un solo intento", async () => {
    const { c, llamadas } = cliente([respuesta(429, { name: "daily_quota_exceeded", message: "quota" })]);
    const r = await c.borrarContacto("c1");
    expect(r.ok).toBe(false);
    expect(llamadas).toHaveLength(1);
  });

  it("enviar un Broadcast NO se reintenta en 5xx (podría salir dos veces)", async () => {
    const { c, llamadas } = cliente([respuesta(500, { name: "application_error" })]);
    const r = await c.enviarBroadcast("b1");
    expect(r).toMatchObject({ ok: false, status: 500 });
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]).toMatchObject({ method: "POST", url: "https://api.resend.com/broadcasts/b1/send" });
  });

  it("un GET sí se reintenta en 5xx", async () => {
    const { c, llamadas } = cliente([respuesta(503, {}), respuesta(200, { id: "b1", status: "sent" })]);
    const r = await c.obtenerBroadcast("b1");
    expect(r.ok && r.data.status).toBe("sent");
    expect(llamadas).toHaveLength(2);
  });

  it("error de red = status 0", async () => {
    const fn: FetchLike = async () => {
      throw new Error("ECONNRESET");
    };
    const c = new ClienteResendMarketing({ apiKey: "k", fetch: fn, dormir: async () => {}, maxReintentos: 0, log: () => {} });
    const r = await c.obtenerContacto("a@b.es");
    expect(r).toMatchObject({ ok: false, status: 0, tipo: "network_error" });
  });

  it("lista todos los contactos paginando con after", async () => {
    const { c, llamadas } = cliente([
      respuesta(200, { object: "list", has_more: true, data: [{ id: "c1", email: "a@x.es", unsubscribed: false }, { id: "c2", email: "b@x.es", unsubscribed: false }] }),
      respuesta(200, { object: "list", has_more: false, data: [{ id: "c3", email: "c@x.es", unsubscribed: true }] }),
    ]);
    const r = await c.listarContactos();
    expect(r.ok && r.data.map((x) => x.id)).toEqual(["c1", "c2", "c3"]);
    expect(llamadas[0].url).toBe("https://api.resend.com/contacts?limit=100");
    expect(llamadas[1].url).toBe("https://api.resend.com/contacts?limit=100&after=c2");
  });

  it("contactos de un Segment por /segments/{id}/contacts", async () => {
    const { c, llamadas } = cliente([respuesta(200, { has_more: false, data: [] })]);
    await c.listarContactosSegmento("seg-1");
    expect(llamadas[0].url).toBe("https://api.resend.com/segments/seg-1/contacts?limit=100");
  });

  it("crear contacto: dentro del Segment y SIN unsubscribed (nunca re-suscribe)", async () => {
    const { c, llamadas } = cliente([respuesta(201, { object: "contact", id: "c9" })]);
    const r = await c.crearContacto("ana@x.es", "Ana", "seg-1");
    expect(r.ok && r.data.id).toBe("c9");
    expect(llamadas[0]).toMatchObject({ method: "POST", url: "https://api.resend.com/contacts" });
    expect(llamadas[0].body).toEqual({ email: "ana@x.es", first_name: "Ana", segments: [{ id: "seg-1" }] });
    expect(llamadas[0].body).not.toHaveProperty("unsubscribed");
  });

  it("actualizar solo cambia first_name", async () => {
    const { c, llamadas } = cliente([respuesta(200, { id: "c1" })]);
    await c.actualizarNombre("c1", "Luis");
    expect(llamadas[0]).toMatchObject({ method: "PATCH", url: "https://api.resend.com/contacts/c1", body: { first_name: "Luis" } });
  });

  it("borrar por email lo codifica en la ruta", async () => {
    const { c, llamadas } = cliente([respuesta(200, { deleted: true })]);
    await c.borrarContacto("a+b@x.es");
    expect(llamadas[0]).toMatchObject({ method: "DELETE", url: "https://api.resend.com/contacts/a%2Bb%40x.es" });
  });

  it("añadir/quitar del Segment", async () => {
    const { c, llamadas } = cliente([respuesta(200, { id: "seg-1" }), respuesta(200, {})]);
    await c.anadirASegmento("c1", "seg-1");
    await c.quitarDeSegmento("c1", "seg-1");
    expect(llamadas.map((l) => `${l.method} ${l.url}`)).toEqual([
      "POST https://api.resend.com/contacts/c1/segments/seg-1",
      "DELETE https://api.resend.com/contacts/c1/segments/seg-1",
    ]);
  });

  it("crear Broadcast como borrador con segment_id", async () => {
    const { c, llamadas } = cliente([respuesta(200, { id: "b1" })]);
    await c.crearBroadcast({ segmentId: "seg-1", from: "CT <n@x.es>", subject: "Hola", html: "<p>x</p>", name: "N" });
    expect(llamadas[0].body).toEqual({ segment_id: "seg-1", from: "CT <n@x.es>", subject: "Hola", html: "<p>x</p>", name: "N", send: false });
  });
});
