import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

import { BotonDictado } from "../BotonDictado";

let ultimo: FakeRec | null = null;
const guardar = (r: FakeRec) => {
  ultimo = r;
};
class FakeRec {
  lang = "";
  continuous = true;
  interimResults = false;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  abort = vi.fn();
  stop = vi.fn();
  constructor() {
    guardar(this);
  }
  emitir(items: Array<{ t: string; final: boolean }>) {
    const results = items.map((i) => Object.assign([{ transcript: i.t }], { isFinal: i.final }));
    this.onresult?.({ resultIndex: 0, results });
  }
}

function Caja({ inicial = "" }: { inicial?: string }) {
  const [v, setV] = useState(inicial);
  return (
    <div>
      <textarea aria-label="caja" value={v} onChange={(e) => setV(e.target.value)} />
      <BotonDictado valor={v} onCambio={setV} />
    </div>
  );
}
const caja = () => (screen.getByLabelText("caja") as HTMLTextAreaElement).value;
const ua = (s: string) => Object.defineProperty(navigator, "userAgent", { value: s, configurable: true });
const w = () => window as unknown as Record<string, unknown>;
const g = () => globalThis as unknown as Record<string, unknown>;

class FakeMR {
  static isTypeSupported = () => true;
  mimeType = "audio/mp4";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() {}
  stop() {
    this.ondataavailable?.({ data: new Blob(["x".repeat(2000)], { type: "audio/mp4" }) });
    this.onstop?.();
  }
}

describe("BotonDictado", () => {
  const uaOriginal = navigator.userAgent;
  beforeEach(() => {
    ultimo = null;
    invoke.mockReset();
    ua("Mozilla/5.0 (Linux; Android 14) Chrome/130");
  });
  afterEach(() => {
    delete w().webkitSpeechRecognition;
    delete g().MediaRecorder;
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
    ua(uaOriginal);
  });

  it("dicta en es-ES con texto provisional y final, a continuación de lo escrito, sin enviar", () => {
    w().webkitSpeechRecognition = FakeRec;
    render(<Caja inicial="hola" />);
    fireEvent.click(screen.getByRole("button", { name: "Dictar con la voz" }));
    expect(ultimo?.lang).toBe("es-ES");
    expect(ultimo?.interimResults).toBe(true);
    expect(screen.getByRole("button", { name: "Parar el dictado" })).toHaveAttribute("aria-pressed", "true");
    act(() => ultimo!.emitir([{ t: "cuánto gasté", final: false }]));
    expect(caja()).toBe("hola cuánto gasté");
    expect(screen.getByTestId("estado-dictado")).toHaveTextContent("Escuchando… cuánto gasté");
    act(() => ultimo!.emitir([{ t: "cuánto gasté en pescado", final: true }]));
    expect(caja()).toBe("hola cuánto gasté en pescado");
    // La frase acaba y el navegador se reengancha solo.
    act(() => ultimo!.onend?.());
    expect(ultimo!.start).toHaveBeenCalledTimes(2);
    act(() => ultimo!.emitir([{ t: "este mes", final: true }]));
    expect(caja()).toBe("hola cuánto gasté en pescado este mes");
    fireEvent.click(screen.getByRole("button", { name: "Parar el dictado" }));
    expect(ultimo!.abort).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Dictar con la voz" })).toBeInTheDocument();
    expect(caja()).toBe("hola cuánto gasté en pescado este mes");
  });

  it("avisa si no hay permiso de micrófono", () => {
    w().webkitSpeechRecognition = FakeRec;
    render(<Caja />);
    fireEvent.click(screen.getByRole("button", { name: "Dictar con la voz" }));
    act(() => ultimo!.onerror?.({ error: "not-allowed" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/permiso para el micrófono/i);
    expect(screen.getByRole("button", { name: "Dictar con la voz" })).toBeInTheDocument();
  });

  it("avisa si el navegador no soporta dictado", () => {
    render(<Caja />);
    fireEvent.click(screen.getByRole("button", { name: "Dictar con la voz" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/no permite dictar/i);
  });

  it("en iPhone graba y transcribe en servidor", async () => {
    ua("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1");
    w().webkitSpeechRecognition = FakeRec; // existe pero en iOS no se usa
    const pista = { stop: vi.fn() };
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [pista] }) }, configurable: true });
    g().MediaRecorder = FakeMR;
    invoke.mockResolvedValue({ data: { ok: true, texto: "precio del bacalao" }, error: null });
    render(<Caja inicial="mira" />);
    fireEvent.click(screen.getByRole("button", { name: "Dictar con la voz" }));
    const parar = await screen.findByRole("button", { name: "Parar el dictado" });
    expect(ultimo).toBeNull();
    fireEvent.click(parar);
    await waitFor(() => expect(caja()).toBe("mira precio del bacalao"));
    expect(invoke).toHaveBeenCalledWith("transcribir-dictado", expect.objectContaining({ body: expect.any(FormData) }));
    expect(pista.stop).toHaveBeenCalled();
  });

  it("muestra el error si la transcripción en servidor falla", async () => {
    ua("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Safari/604.1");
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) }, configurable: true });
    g().MediaRecorder = FakeMR;
    invoke.mockResolvedValue({ data: null, error: new Error("500") });
    render(<Caja />);
    fireEvent.click(screen.getByRole("button", { name: "Dictar con la voz" }));
    fireEvent.click(await screen.findByRole("button", { name: "Parar el dictado" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/No se pudo transcribir/);
  });
});
