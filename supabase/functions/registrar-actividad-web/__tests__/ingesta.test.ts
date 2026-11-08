/** registrar-actividad-web: contrato HTTP de la ingesta (ingesta.ts). */
import { describe, expect, it, vi } from "vitest";
import { procesarIngesta, type DependenciasIngesta } from "../ingesta";

const ORIGEN = "https://restaurantecasatomascrevillente.es";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";

const peticion = (cuerpo: unknown, cabeceras: Record<string, string> = {}, metodo = "POST") =>
  new Request("https://x.supabase.co/functions/v1/registrar-actividad-web", {
    method: metodo,
    headers: { "Content-Type": "text/plain;charset=UTF-8", origin: ORIGEN, "user-agent": UA, ...cabeceras },
    body: metodo === "POST" ? (typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo)) : undefined,
  });

function deps(over: Partial<DependenciasIngesta> = {}) {
  const ingerir = vi.fn(async (eventos: unknown[]) => ({ aceptados: eventos.length, duplicados: 0, descartados: 0, rechazados: 0 }));
  return { d: { ingerir, claveIp: "clave", ip: "203.0.113.7", ahora: () => new Date("2026-11-08T12:00:00Z"), ...over } as DependenciasIngesta, ingerir };
}
const lote = (n = 2, consentimiento = true) => ({
  v: 1,
  contexto: { consentimiento, version: "0.40" },
  eventos: Array.from({ length: n }, (_, i) => ({ id: crypto.randomUUID(), t: "2026-11-08T11:59:00Z", tipo: i === 0 ? "pagina_vista" : "clic", ruta: "/", objetivo: "Reservar", seq: i + 1, sesion: crypto.randomUUID() })),
});

describe("registrar-actividad-web", () => {
  it("202 y guarda con el entorno del origen y la IP en HMAC (nunca en claro)", async () => {
    const { d, ingerir } = deps();
    const res = await procesarIngesta(peticion(lote()), d);
    expect(res.status).toBe(202);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGEN);
    expect(await res.json()).toMatchObject({ aceptados: 2 });
    const [eventos, ctx] = ingerir.mock.calls[0] as unknown as [Array<Record<string, unknown>>, { entorno: string; ip_hash: string }];
    expect(ctx.entorno).toBe("produccion");
    expect(ctx.ip_hash).toMatch(/^[a-f0-9]{32}$/);
    expect(JSON.stringify(ingerir.mock.calls)).not.toContain("203.0.113.7");
    expect(eventos[0]).toMatchObject({ dispositivo: "movil", navegador: "Safari", so: "iOS", es_bot: false });
  });
  it("la misma IP da otro hash otro día (sal diaria)", async () => {
    const a = deps(), b = deps({ ahora: () => new Date("2026-11-09T12:00:00Z") });
    await procesarIngesta(peticion(lote()), a.d);
    await procesarIngesta(peticion(lote()), b.d);
    const h = (m: typeof a.ingerir) => (m.mock.calls[0] as unknown as [unknown, { ip_hash: string }])[1].ip_hash;
    expect(h(a.ingerir)).not.toBe(h(b.ingerir));
  });
  it("403 desde un origen no permitido, sin guardar", async () => {
    const { d, ingerir } = deps();
    const res = await procesarIngesta(peticion(lote(), { origin: "https://evil.example" }), d);
    expect(res.status).toBe(403);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(ingerir).not.toHaveBeenCalled();
  });
  it("preflight, método, cuerpo ilegible y demasiado grande", async () => {
    const { d } = deps();
    expect((await procesarIngesta(peticion(null, {}, "OPTIONS"), d)).status).toBe(204);
    expect((await procesarIngesta(peticion(null, {}, "GET"), d)).status).toBe(405);
    expect((await procesarIngesta(peticion("{no es json"), d)).status).toBe(400);
    expect((await procesarIngesta(peticion("x".repeat(70_000)), d)).status).toBe(413);
  });
  it("sin consentimiento, la actividad se descarta en la función (no llega a la BD)", async () => {
    const { d, ingerir } = deps();
    const res = await procesarIngesta(peticion(lote(3, false)), d);
    expect(await res.json()).toMatchObject({ aceptados: 0, descartados: 3 });
    expect(ingerir).not.toHaveBeenCalled();
  });
  it("503 si la BD falla: el navegador reintenta el mismo lote", async () => {
    const { d } = deps({ ingerir: vi.fn(async () => { throw new Error("db caída"); }) });
    expect((await procesarIngesta(peticion(lote()), d)).status).toBe(503);
  });
  it("un bot se guarda marcado (para excluirlo), no como visitante", async () => {
    const { d, ingerir } = deps();
    await procesarIngesta(peticion(lote(1), { "user-agent": "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)" }), d);
    expect((ingerir.mock.calls[0] as unknown as [Array<{ es_bot: boolean }>])[0][0].es_bot).toBe(true);
  });
});
