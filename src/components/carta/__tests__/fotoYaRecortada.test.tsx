/**
 * Fotos que ya vienen sin fondo (recorte nativo del iPhone, 02-11-2026): se
 * detecta el alfa real (PNG recortado sí; JPEG, PNG opaco o PNG con poca
 * transparencia no), se salta el modelo y se puede pegar del portapapeles.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  navegador: vi.fn(async () => new Blob(["sticker-modelo"], { type: "image/png" })),
  componer: vi.fn(async () => new Blob(["carta"], { type: "image/webp" })),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { error: mocks.toastError, info: mocks.toastInfo, success: vi.fn(), warning: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("../recorte/quitarFondoNavegador", async (original) => {
  const real = await original<typeof import("../recorte/quitarFondoNavegador")>();
  return { ...real, quitarFondoNavegador: mocks.navegador };
});
vi.mock("../composicionCarta", async (original) => {
  const real = await original<typeof import("../composicionCarta")>();
  return { ...real, componerFotoCarta: mocks.componer };
});

import {
  aceptarFotoCarta,
  analizarAlfa,
  cabeceraConAlfa,
  detectarFotoRecortada,
  esStickerRecortado,
  pareceRecortada,
} from "../recorte/fotoYaRecortada";
import { fotoDeEventoPegar, leerFotoPortapapeles, AVISO_SIN_FOTO, TRUCO_IPHONE } from "../recorte/portapapelesFoto";
import { PegarFotoRecortada } from "../recorte/PegarFotoRecortada";
import { useFotoCarta } from "../recorte/useRecorteVino";

const ESCRITORIO = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

// --- Imágenes sintéticas (RGBA) -------------------------------------------

/** Plato recortado: círculo opaco en el centro, el resto alfa 0. */
function rgbaRecortado(n = 100): Uint8ClampedArray {
  const d = new Uint8ClampedArray(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const o = (y * n + x) * 4;
      d[o] = 200;
      d[o + 3] = (x - n / 2) ** 2 + (y - n / 2) ** 2 < (n * 0.35) ** 2 ? 255 : 0;
    }
  return d;
}
/** Foto normal (JPEG decodificado o PNG opaco): todo alfa 255. */
function rgbaOpaco(n = 100): Uint8ClampedArray {
  const d = new Uint8ClampedArray(n * n * 4).fill(180);
  for (let i = 3; i < d.length; i += 4) d[i] = 255;
  return d;
}
/** PNG con poca transparencia: marco transparente de 2 px (≈ 8 % de la imagen). */
function rgbaMarcoFino(n = 100): Uint8ClampedArray {
  const d = rgbaOpaco(n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) if (x < 2 || y < 2 || x >= n - 2 || y >= n - 2) d[(y * n + x) * 4 + 3] = 0;
  return d;
}
/** PNG con esquinas redondeadas: pocos píxeles transparentes en las esquinas. */
function rgbaEsquinas(n = 100): Uint8ClampedArray {
  const d = rgbaOpaco(n);
  const r = 8;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const cx = x < r ? r : x >= n - r ? n - r - 1 : x;
      const cy = y < r ? r : y >= n - r ? n - r - 1 : y;
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) d[(y * n + x) * 4 + 3] = 0;
    }
  return d;
}

// --- Cabeceras -------------------------------------------------------------

function cabeceraPng(tipoColor: number, extra: string[] = []): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdr = [0, 0, 0, 13, ...[..."IHDR"].map((c) => c.charCodeAt(0)), 0, 0, 0, 100, 0, 0, 0, 100, 8, tipoColor, 0, 0, 0, 1, 2, 3, 4];
  const resto: number[] = [];
  for (const nombre of extra) resto.push(0, 0, 0, 1, ...[...nombre].map((c) => c.charCodeAt(0)), 0, 9, 9, 9, 9);
  return new Uint8Array([...sig, ...ihdr, ...resto]);
}
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
function cabeceraWebp(trozo: string, b20: number, b24 = 0): Uint8Array {
  const b = new Uint8Array(30);
  b.set([..."RIFF"].map((c) => c.charCodeAt(0)), 0);
  b.set([..."WEBP"].map((c) => c.charCodeAt(0)), 8);
  b.set([...trozo].map((c) => c.charCodeAt(0)), 12);
  b[20] = b20;
  b[24] = b24;
  return b;
}

// --- Canvas / createImageBitmap falsos (jsdom no pinta) --------------------

let pixeles: Uint8ClampedArray = rgbaRecortado();
const LADO = 100;

function instalarCanvasFalso() {
  const crear = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    if (tag !== "canvas") return crear(tag);
    const c = {
      width: 0,
      height: 0,
      getContext: () => ({
        imageSmoothingQuality: "high",
        drawImage: vi.fn(),
        getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: pixeles, width: w, height: h }),
        putImageData: vi.fn(),
      }),
      toBlob: (cb: (b: Blob | null) => void, tipo: string) => cb(new Blob([cabeceraPng(6)], { type: tipo })),
    };
    return c as unknown as HTMLCanvasElement;
  }) as typeof document.createElement);
}

const crearBitmap = vi.fn(async () => ({ width: LADO, height: LADO, close: vi.fn() }));

function archivo(bytes: Uint8Array, tipo: string, nombre = "foto", relleno = 0): File {
  return new File([bytes, new Uint8Array(relleno)], nombre, { type: tipo });
}

function ponerNavegador(userAgent: string, maxTouchPoints = 0) {
  Object.defineProperty(navigator, "userAgent", { value: userAgent, configurable: true });
  Object.defineProperty(navigator, "maxTouchPoints", { value: maxTouchPoints, configurable: true });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  pixeles = rgbaRecortado();
  vi.stubGlobal("createImageBitmap", crearBitmap);
  vi.stubGlobal("Worker", class {});
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q }));
  instalarCanvasFalso();
  ponerNavegador(ESCRITORIO);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("analizarAlfa / pareceRecortada", () => {
  it("PNG recortado (plato sin fondo): sí", () => {
    const a = analizarAlfa(rgbaRecortado(), 100, 100);
    expect(a.borde).toBe(1);
    expect(a.transparente).toBeGreaterThan(0.5);
    expect(a.caja).toMatchObject({ x: expect.any(Number), w: expect.any(Number) });
    expect(pareceRecortada(a)).toBe(true);
  });
  it("JPEG / PNG opaco: no", () => {
    const a = analizarAlfa(rgbaOpaco(), 100, 100);
    expect(a.transparente).toBe(0);
    expect(pareceRecortada(a)).toBe(false);
  });
  it("PNG con poca transparencia (marco fino, esquinas redondeadas): no", () => {
    expect(pareceRecortada(analizarAlfa(rgbaMarcoFino(), 100, 100))).toBe(false);
    expect(pareceRecortada(analizarAlfa(rgbaEsquinas(), 100, 100))).toBe(false);
  });
  it("PNG totalmente transparente (vacío): no", () => {
    expect(pareceRecortada(analizarAlfa(new Uint8ClampedArray(100 * 100 * 4), 100, 100))).toBe(false);
  });
});

describe("cabeceraConAlfa", () => {
  it("PNG RGBA / gris+alfa: sí; PNG RGB sin tRNS: no; con tRNS antes de IDAT: sí", () => {
    expect(cabeceraConAlfa(cabeceraPng(6))).toBe(true);
    expect(cabeceraConAlfa(cabeceraPng(4))).toBe(true);
    expect(cabeceraConAlfa(cabeceraPng(2, ["IDAT"]))).toBe(false);
    expect(cabeceraConAlfa(cabeceraPng(3, ["PLTE", "tRNS", "IDAT"]))).toBe(true);
  });
  it("JPEG: nunca", () => {
    expect(cabeceraConAlfa(JPEG)).toBe(false);
  });
  it("WebP: VP8X con marca de alfa o VP8L con alfa: sí; VP8 con pérdida: no", () => {
    expect(cabeceraConAlfa(cabeceraWebp("VP8X", 0x10))).toBe(true);
    expect(cabeceraConAlfa(cabeceraWebp("VP8X", 0))).toBe(false);
    expect(cabeceraConAlfa(cabeceraWebp("VP8L", 0x2f, 0x10))).toBe(true);
    expect(cabeceraConAlfa(cabeceraWebp("VP8 ", 0))).toBe(false);
  });
});

describe("detectarFotoRecortada", () => {
  it("PNG recortado → sticker PNG encuadrado, marcado como recortado", async () => {
    const f = await detectarFotoRecortada(archivo(cabeceraPng(6), "image/png"));
    expect(f).toBeInstanceOf(File);
    expect(f!.type).toBe("image/png");
    expect(esStickerRecortado(f)).toBe(true);
  });
  it("JPEG → null sin decodificar", async () => {
    expect(await detectarFotoRecortada(archivo(JPEG, "image/jpeg"))).toBeNull();
    expect(crearBitmap).not.toHaveBeenCalled();
  });
  it("PNG sin canal alfa → null sin decodificar", async () => {
    expect(await detectarFotoRecortada(archivo(cabeceraPng(2, ["IDAT"]), "image/png"))).toBeNull();
    expect(crearBitmap).not.toHaveBeenCalled();
  });
  it("PNG RGBA pero opaco o con poca transparencia → null", async () => {
    pixeles = rgbaOpaco();
    expect(await detectarFotoRecortada(archivo(cabeceraPng(6), "image/png"))).toBeNull();
    pixeles = rgbaMarcoFino();
    expect(await detectarFotoRecortada(archivo(cabeceraPng(6), "image/png"))).toBeNull();
  });
  it("si no se puede decodificar, null (no lanza)", async () => {
    crearBitmap.mockRejectedValueOnce(new Error("decode"));
    expect(await detectarFotoRecortada(archivo(cabeceraPng(6), "image/png"))).toBeNull();
  });
});

describe("aceptarFotoCarta", () => {
  it("un PNG recortado de más de 5 MB vale (se usa el sticker reducido)", async () => {
    const grande = archivo(cabeceraPng(6), "image/png", "grande.png", 6 * 1024 * 1024);
    const r = await aceptarFotoCarta(grande);
    expect(r).not.toBe(grande);
    expect(esStickerRecortado(r)).toBe(true);
    expect(mocks.toastError).not.toHaveBeenCalled();
  });
  it("un JPEG sigue el camino de siempre", async () => {
    const j = archivo(JPEG, "image/jpeg", "plato.jpg");
    expect(await aceptarFotoCarta(j)).toBe(j);
  });
});

describe("useFotoCarta con foto ya recortada", () => {
  it("salta el modelo: listo con metodo «recortada» y foto de carta compuesta", async () => {
    const { result } = renderHook(() => useFotoCarta("plato"));
    act(() => result.current.iniciar(archivo(cabeceraPng(6), "image/png", "pegada.png")));
    await waitFor(() => expect(result.current.estado.fase).toBe("listo"));
    const estado = result.current.estado as { fase: "listo"; r: { metodo: string } };
    expect(estado.r.metodo).toBe("recortada");
    expect(mocks.navegador).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.usaCarta).toBe(true));
    expect(mocks.componer).toHaveBeenCalledWith(expect.any(Blob), { tipo: "plato", tema: result.current.tema });
    // Se guarda el sticker (pequeño) como original, no el PNG enorme.
    expect(esStickerRecortado(result.current.original)).toBe(true);
    expect(mocks.navegador).not.toHaveBeenCalled();
  });

  it("también en el iPhone (sin pasar el modelo ni crear trabajo para un ordenador)", async () => {
    ponerNavegador(IPHONE, 5);
    const { result } = renderHook(() => useFotoCarta("bebida"));
    act(() => result.current.iniciar(archivo(cabeceraPng(6), "image/png")));
    await waitFor(() => expect(result.current.estado.fase).toBe("listo"));
    expect(mocks.navegador).not.toHaveBeenCalled();
  });

  it("un JPEG en el iPhone se recorta en el formulario, como en el ordenador", async () => {
    ponerNavegador(IPHONE, 5);
    const { result } = renderHook(() => useFotoCarta("plato"));
    act(() => result.current.iniciar(archivo(JPEG, "image/jpeg")));
    expect(result.current.estado.fase).toBe("trabajando");
  });

  it("un PNG opaco en el ordenador pasa por el modelo", async () => {
    pixeles = rgbaOpaco();
    const { result } = renderHook(() => useFotoCarta("plato"));
    act(() => result.current.iniciar(archivo(cabeceraPng(6), "image/png")));
    await waitFor(() => expect(mocks.navegador).toHaveBeenCalled());
  });
});

describe("portapapeles", () => {
  const item = (tipos: Record<string, Blob>) => ({ types: Object.keys(tipos), getType: vi.fn(async (t: string) => tipos[t]) });

  it("lee la imagen copiada (prefiere PNG)", async () => {
    const png = new Blob(["png"], { type: "image/png" });
    const clip = { read: vi.fn(async () => [item({ "text/plain": new Blob(["x"]), "image/jpeg": new Blob(["j"], { type: "image/jpeg" }), "image/png": png })]) };
    const f = await leerFotoPortapapeles(clip as unknown as Clipboard);
    expect(f).toBeInstanceOf(File);
    expect(f!.type).toBe("image/png");
    expect(f!.name).toBe("foto-pegada.png");
  });
  it("sin imagen → null; sin permiso → lanza", async () => {
    expect(await leerFotoPortapapeles({ read: vi.fn(async () => [item({ "text/plain": new Blob(["x"]) })]) } as unknown as Clipboard)).toBeNull();
    await expect(leerFotoPortapapeles({ read: vi.fn(async () => Promise.reject(new DOMException("no", "NotAllowedError"))) } as unknown as Clipboard)).rejects.toThrow();
  });
  it("evento paste: saca la imagen; con solo texto, null", () => {
    const png = new File(["p"], "a.png", { type: "image/png" });
    expect(fotoDeEventoPegar({ clipboardData: { files: [png], items: [] } as unknown as DataTransfer })).toBe(png);
    expect(fotoDeEventoPegar({ clipboardData: { files: [], items: [{ kind: "string", type: "text/plain" }] } as unknown as DataTransfer })).toBeNull();
  });
});

describe("<PegarFotoRecortada>", () => {
  function conPortapapeles(read: () => Promise<unknown>) {
    Object.defineProperty(navigator, "clipboard", { value: { read }, configurable: true });
  }

  it("iPhone: botón «Pegar foto recortada» + truco; al pulsar entrega la foto", async () => {
    ponerNavegador(IPHONE, 5);
    const png = new Blob(["png"], { type: "image/png" });
    conPortapapeles(async () => [{ types: ["image/png"], getType: async () => png }]);
    const onFoto = vi.fn();
    render(<PegarFotoRecortada onFoto={onFoto} />);
    expect(screen.getByText(TRUCO_IPHONE)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Pegar foto recortada/ }));
    await waitFor(() => expect(onFoto).toHaveBeenCalledTimes(1));
    expect((onFoto.mock.calls[0][0] as File).type).toBe("image/png");
  });

  it("ordenador: discreto y sin truco del iPhone; Ctrl+V con imagen la entrega", async () => {
    conPortapapeles(async () => []);
    const onFoto = vi.fn();
    render(<PegarFotoRecortada onFoto={onFoto} />);
    expect(screen.queryByTestId("truco-iphone")).toBeNull();
    expect(screen.getByRole("button", { name: /Pegar foto \(Ctrl\+V\)/ })).toBeInTheDocument();
    const png = new File(["p"], "a.png", { type: "image/png" });
    const evento = new Event("paste") as Event & { clipboardData: unknown };
    evento.clipboardData = { files: [png], items: [] };
    act(() => {
      document.dispatchEvent(evento);
    });
    expect(onFoto).toHaveBeenCalledWith(png);
  });

  it("sin foto copiada avisa cómo hacerlo", async () => {
    ponerNavegador(IPHONE, 5);
    conPortapapeles(async () => [{ types: ["text/plain"], getType: async () => new Blob(["x"]) }]);
    const onFoto = vi.fn();
    render(<PegarFotoRecortada onFoto={onFoto} />);
    fireEvent.click(screen.getByRole("button", { name: /Pegar foto recortada/ }));
    await waitFor(() => expect(mocks.toastInfo).toHaveBeenCalledWith(AVISO_SIN_FOTO, expect.anything()));
    expect(onFoto).not.toHaveBeenCalled();
  });
});
