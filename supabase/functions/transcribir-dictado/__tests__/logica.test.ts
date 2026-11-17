// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { manejarDictado, MAX_BYTES_AUDIO, type DependenciasDictado } from "../logica";

function peticion(audio: Blob | null, extra: Record<string, string> = {}) {
  const f = new FormData();
  if (audio) f.append("audio", audio, "d");
  for (const [k, v] of Object.entries(extra)) f.append(k, v);
  return new Request("http://x/", { method: "POST", body: f });
}
const audioOk = () => new Blob(["x".repeat(3000)], { type: "audio/webm;codecs=opus" });
function deps(o: Partial<DependenciasDictado> = {}): DependenciasDictado {
  return {
    autenticar: async () => ({ ok: true, userId: "u1" }),
    clave: () => "sk-test",
    modelo: "gpt-4o-mini-transcribe",
    fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: " hola mundo ", usage: { input_tokens: 100, output_tokens: 5 } }))) as unknown as typeof fetch,
    registrar: vi.fn().mockResolvedValue(undefined),
    ...o,
  };
}

describe("transcribir-dictado", () => {
  it("exige sesión", async () => {
    const d = deps({ autenticar: async () => ({ ok: false, status: 401, error: "No autorizado" }) });
    expect((await manejarDictado(peticion(audioOk()), d)).status).toBe(401);
    expect(d.fetch).not.toHaveBeenCalled();
    expect(d.registrar).not.toHaveBeenCalled();
  });
  it("transcribe, devuelve el texto limpio y registra el uso", async () => {
    const d = deps();
    const r = await manejarDictado(peticion(audioOk(), { segundos: "12" }), d);
    expect(await r.json()).toEqual({ ok: true, texto: "hola mundo" });
    expect(d.registrar).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1", error: false, usage: { input_tokens: 100, output_tokens: 5 } }));
    const envio = (d.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as FormData;
    expect(envio.get("language")).toBe("es");
    expect(envio.get("model")).toBe("gpt-4o-mini-transcribe");
  });
  it("rechaza audio demasiado grande, demasiado largo o de otro tipo", async () => {
    expect((await manejarDictado(peticion(new Blob([new Uint8Array(MAX_BYTES_AUDIO + 1)], { type: "audio/webm" })), deps())).status).toBe(413);
    expect((await manejarDictado(peticion(audioOk(), { segundos: "200" }), deps())).status).toBe(413);
    expect((await manejarDictado(peticion(new Blob(["x".repeat(3000)], { type: "application/pdf" })), deps())).status).toBe(415);
    expect((await manejarDictado(peticion(null), deps())).status).toBe(400);
  });
  it("un audio casi vacío no gasta IA", async () => {
    const d = deps();
    const r = await manejarDictado(peticion(new Blob(["x"], { type: "audio/webm" })), d);
    expect(await r.json()).toEqual({ ok: true, texto: "" });
    expect(d.fetch).not.toHaveBeenCalled();
  });
  it("si OpenAI falla devuelve 502 sin filtrar detalles y registra el error", async () => {
    const d = deps({ fetch: vi.fn().mockResolvedValue(new Response("sk-secreto boom", { status: 500 })) as unknown as typeof fetch });
    const r = await manejarDictado(peticion(audioOk()), d);
    expect(r.status).toBe(502);
    expect(JSON.stringify(await r.json())).not.toContain("sk-");
    expect(d.registrar).toHaveBeenCalledWith(expect.objectContaining({ error: true }));
  });
  it("503 si falta la clave", async () => {
    expect((await manejarDictado(peticion(audioOk()), deps({ clave: () => "" }))).status).toBe(503);
  });
});
