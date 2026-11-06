/**
 * Pestaña Reels con vídeo (fase 6): lógica pura (estado del trabajo, firma
 * estable, botones, pistas) y el panel «Generar vídeo» con Supabase simulado
 * (encolar por RPC, estado en cola / renderizando / listo, vista previa del
 * MP4, probar y publicar, reel «procesando»).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { crearReelDesdeBase } from "@/lib/instagram/reels";

const sbFalso = vi.hoisted(() => ({
  datos: {} as Record<string, unknown[]>,
  rpc: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabla: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "in", "order", "limit", "eq", "not"]) q[m] = () => q;
    q.maybeSingle = () => Promise.resolve({ data: (sbFalso.datos[tabla] ?? [])[0] ?? null, error: null });
    q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve({ data: sbFalso.datos[tabla] ?? [], error: null }).then(ok, ko);
    return q;
  };
  return { supabase: { from: consulta, rpc: (...a: unknown[]) => sbFalso.rpc(...a), storage: { from: () => ({ upload: vi.fn() }) }, auth: { getSession: async () => ({ data: { session: null } }) } } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), message: vi.fn() } }));

import { PanelVideoReel } from "../PanelVideoReel";
import { botonesReel, estadoVisible, firmaEstable, fotosAPreparar, revisarPista, type PiezaReel, type TrabajoRender } from "../logica";

const REEL = crearReelDesdeBase("del-mar");
const PIEZA_ID = "3f2b8a52-6c1e-4d7a-9b0f-1a2b3c4d5e6f";
const ahora = Date.parse("2026-11-09T10:00:00Z");

function trabajo(o: Partial<TrabajoRender> = {}): TrabajoRender {
  return {
    id: "11111111-2222-4333-8444-555555555555", pieza_id: PIEZA_ID, estado: "pendiente", progreso: 0, fotogramas: null, dispositivo: null,
    error: null, avisos: [], intentos: 0, created_at: new Date(ahora).toISOString(), reclamado_en: null, latido_en: null, terminado_en: null, ...o,
  };
}
function pieza(o: Partial<PiezaReel> = {}): PiezaReel {
  return {
    id: PIEZA_ID, marca: "casa-tomas", plantilla: "del-mar", tipo_medio: "reel", estado: "generada", datos: JSON.parse(JSON.stringify(REEL)),
    caption: "Del mar #casatomas", video_ruta: `reels/2026-11/${PIEZA_ID}-11111111.mp4`, portada_ruta: `reels/2026-11/${PIEZA_ID}-11111111.jpg`,
    duracion_s: "20.50", video_bytes: 18_874_368, contenedor_id: null, permalink: null, error: null, procesando_accion: null, procesando_desde: null,
    updated_at: "2026-11-09T10:00:00Z", created_at: "2026-11-09T09:00:00Z", ...o,
  };
}
function envolver(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  sbFalso.datos = {};
  sbFalso.rpc.mockReset();
});

describe("lógica del vídeo de los reels", () => {
  it("estado del trabajo: en cola (y aviso si el equipo de render no lo coge), renderizando con progreso, listo y error", () => {
    expect(estadoVisible(trabajo(), ahora + 30_000)).toMatchObject({ etiqueta: "En cola", activo: true, detalle: "Lo estamos montando; te avisamos cuando esté." });
    expect(estadoVisible(trabajo(), ahora + 5 * 60_000)?.detalle).toMatch(/en cuanto el ordenador de vídeo esté encendido/);
    expect(estadoVisible(trabajo({ estado: "renderizando", progreso: 42, dispositivo: "PC Oficiosos", fotogramas: 615 }))).toMatchObject({ etiqueta: "Renderizando", progreso: 42, detalle: "Montándolo en PC Oficiosos" });
    expect(estadoVisible(trabajo({ estado: "listo" }))).toMatchObject({ etiqueta: "Listo", activo: false });
    expect(estadoVisible(trabajo({ estado: "error", error: "ffmpeg" }))).toMatchObject({ etiqueta: "Error", detalle: "ffmpeg", tono: "mal" });
    expect(estadoVisible(null)).toBeNull();
  });

  it("firma estable: el orden de las claves (jsonb) no importa", () => {
    expect(firmaEstable({ b: 1, a: [{ y: 2, x: 1 }] })).toBe(firmaEstable({ a: [{ x: 1, y: 2 }], b: 1 }));
    expect(firmaEstable({ a: 1 })).not.toBe(firmaEstable({ a: 2 }));
    expect(firmaEstable({ a: 1, b: undefined })).toBe(firmaEstable({ a: 1 }));
  });

  it("fotos a preparar: Drive y carta, no las muestras", () => {
    const r = { ...REEL, escenas: [{ ...REEL.escenas[0], foto: "drive:abc" }, { ...REEL.escenas[1], foto: "carta:p1" }, ...REEL.escenas.slice(2)] };
    expect(fotosAPreparar(r)).toEqual(["drive:abc", "carta:p1"]);
    expect(fotosAPreparar(REEL)).toEqual([]);
  });

  it("botones: probar con el vídeo al día; publicar solo tras una prueba con el mismo texto", () => {
    const base = { valido: true, ocupado: false, trabajoActivo: false, reelAlDia: true, caption: "Hola", captionValido: true };
    expect(botonesReel({ ...base, pieza: null })).toMatchObject({ generar: true, probar: false, publicar: false, motivo: "Primero genera el vídeo." });
    expect(botonesReel({ ...base, pieza: { estado: "generada", video_ruta: "x", caption: "Hola" } })).toMatchObject({ probar: true, publicar: false });
    expect(botonesReel({ ...base, pieza: { estado: "prueba_ok", video_ruta: "x", caption: "Hola" } })).toMatchObject({ probar: true, publicar: true, motivo: null });
    expect(botonesReel({ ...base, caption: "Otro", pieza: { estado: "prueba_ok", video_ruta: "x", caption: "Hola" } }).publicar).toBe(false);
    expect(botonesReel({ ...base, reelAlDia: false, pieza: { estado: "prueba_ok", video_ruta: "x", caption: "Hola" } })).toMatchObject({ probar: false, motivo: "Has cambiado el reel: vuelve a generar el vídeo." });
    expect(botonesReel({ ...base, trabajoActivo: true, pieza: { estado: "generada", video_ruta: "x", caption: "" } })).toMatchObject({ generar: false, probar: false });
    expect(botonesReel({ ...base, pieza: { estado: "procesando", video_ruta: "x", caption: "Hola" } })).toMatchObject({ generar: false, probar: false });
  });

  it("pistas de audio: M4A, MP3, AAC o WAV de hasta 50 MB", () => {
    expect(revisarPista("tema.M4A", 1000)).toEqual({ ok: true, ext: "m4a" });
    expect(revisarPista("tema.ogg", 1000)).toMatchObject({ ok: false });
    expect(revisarPista("tema.mp3", 60 * 1024 * 1024)).toMatchObject({ ok: false });
  });
});

describe("PanelVideoReel", () => {
  it("«Generar vídeo» guarda el reel y lo encola por RPC", async () => {
    sbFalso.rpc.mockResolvedValue({ data: { ok: true, piezaId: PIEZA_ID, trabajo: trabajo() }, error: null });
    const onPiezaId = vi.fn();
    envolver(<PanelVideoReel reel={REEL} piezaId={null} onPiezaId={onPiezaId} />);
    fireEvent.click(screen.getByRole("button", { name: /Generar vídeo/ }));
    await waitFor(() => expect(onPiezaId).toHaveBeenCalledWith(PIEZA_ID));
    const [nombre, args] = sbFalso.rpc.mock.calls[0];
    expect(nombre).toBe("instagram_render_encolar");
    expect(args).toMatchObject({ p_pieza_id: null, p_marca: "casa-tomas", p_fotos: {}, p_audio_ruta: null });
    expect((args as { p_reel: { base: string } }).p_reel.base).toBe("del-mar");
  });

  it("enseña el trabajo renderizando con su progreso y sin poder volver a generar", async () => {
    sbFalso.datos = { instagram_piezas: [pieza({ video_ruta: null, portada_ruta: null, estado: "borrador" })], instagram_trabajos_render: [trabajo({ estado: "renderizando", progreso: 40, dispositivo: "PC Oficiosos" })] };
    envolver(<PanelVideoReel reel={REEL} piezaId={PIEZA_ID} onPiezaId={vi.fn()} />);
    expect(await screen.findByText("Renderizando")).toBeInTheDocument();
    expect(screen.getByText(/Montándolo en PC Oficiosos/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Generar vídeo/ })).toBeDisabled();
  });

  it("con el vídeo listo: vista previa del MP4, prueba activa y publicar solo tras la prueba", async () => {
    sbFalso.datos = { instagram_piezas: [pieza()], instagram_trabajos_render: [trabajo({ estado: "listo", progreso: 100, avisos: ["El texto «titulo» queda muy pegado al borde"] })] };
    const { container } = envolver(<PanelVideoReel reel={REEL} piezaId={PIEZA_ID} onPiezaId={vi.fn()} />);
    await screen.findByText("Listo");
    const video = container.querySelector("video");
    expect(video?.getAttribute("src")).toContain(`/storage/v1/object/public/instagram-video/reels/2026-11/${PIEZA_ID}-11111111.mp4`);
    expect(screen.getByText(/18 MB · 20,5 s/)).toBeInTheDocument();
    expect(screen.getByText(/pegado al borde/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Prueba sin publicar/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Publicar en Instagram/ })).toBeDisabled();
    expect((screen.getByLabelText("Texto de la publicación") as HTMLTextAreaElement).value).toBe("Del mar #casatomas");
  });

  it("si el reel cambia, el vídeo deja de valer", async () => {
    sbFalso.datos = { instagram_piezas: [pieza()], instagram_trabajos_render: [trabajo({ estado: "listo" })] };
    const cambiado = { ...REEL, cierre: { ...REEL.cierre, frase: "Otra frase distinta" } };
    envolver(<PanelVideoReel reel={cambiado} piezaId={PIEZA_ID} onPiezaId={vi.fn()} />);
    expect((await screen.findAllByText(/vuelve a generar el vídeo/)).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Prueba sin publicar/ })).toBeDisabled();
  });

  it("reel «procesando» en Instagram: aviso y «Comprobar ahora»", async () => {
    sbFalso.datos = { instagram_piezas: [pieza({ estado: "procesando", procesando_accion: "prueba", contenedor_id: "1790000000000001" })], instagram_trabajos_render: [trabajo({ estado: "listo" })] };
    envolver(<PanelVideoReel reel={REEL} piezaId={PIEZA_ID} onPiezaId={vi.fn()} />);
    expect(await screen.findByTestId("reel-procesando")).toHaveTextContent(/procesando el vídeo \(prueba\)/);
    expect(screen.getByRole("button", { name: /Comprobar ahora/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Generar vídeo|Volver a generar/ })).toBeDisabled();
  });
});
