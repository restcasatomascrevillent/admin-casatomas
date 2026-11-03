/**
 * «Añadir vino» en el MÓVIL con lectura de la etiqueta por IA (fallo del
 * 03-11-2026 en producción v0.145: en el iPhone se guardaba la foto y «no
 * pasaba nada»). Con el hook de la foto REAL (useRecorteVino) y la lectura
 * real: foto → la IA rellena y encuadra la botella → Guardar → se lanza el
 * recorte en el servidor con la foto encuadrada y la ruta original.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DatosVinoFoto } from "../leerVinoFoto";

const m = vi.hoisted(() => ({
  leer: vi.fn(),
  crear: vi.fn(),
  actualizar: vi.fn(),
  subir: vi.fn(),
  recortarEnMovil: vi.fn(),
  avisarSinRecorte: vi.fn(),
  noRecortar: vi.fn(),
}));

vi.mock("@/hooks/useVinos", () => ({
  useVinos: () => ({
    crearVino: { mutateAsync: m.crear, isPending: false },
    actualizarVino: { mutateAsync: m.actualizar, isPending: false },
    categorias: ["TINTOS", "BLANCOS"],
    denominaciones: [],
    regiones: [],
    paises: [],
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn(), message: vi.fn(), loading: vi.fn(), dismiss: vi.fn() },
}));
vi.mock("../leerVinoFoto", async (original) => {
  const real = await original<typeof import("../leerVinoFoto")>();
  return { ...real, leerDatosVinoDeFoto: m.leer };
});
// Móvil: el modelo no se ejecuta en el navegador.
vi.mock("../recorte/quitarFondoNavegador", async (original) => {
  const real = await original<typeof import("../recorte/quitarFondoNavegador")>();
  return { ...real, recorteNavegadorSeguro: () => false };
});
vi.mock("../recorte/fotoYaRecortada", () => ({
  aceptarFotoCarta: async (f: File) => f,
  esStickerRecortado: () => false,
  candidataRecortada: () => false,
  detectarFotoRecortada: async () => null,
}));
vi.mock("../recorte/PegarFotoRecortada", () => ({ PegarFotoRecortada: () => null }));
vi.mock("../recorte/SelectorFotoCarta", () => ({
  SelectorFotoCarta: ({ superpuesto }: { superpuesto?: ReactNode }) => <div data-testid="foto">{superpuesto}</div>,
}));
vi.mock("../subirFotoCarta", async (original) => {
  const real = await original<typeof import("../subirFotoCarta")>();
  return { ...real, subirFotoCarta: m.subir };
});
vi.mock("../recorte/recorteEnSegundoPlano", () => ({
  recortarEnMovil: m.recortarEnMovil,
  avisarSinRecorte: m.avisarSinRecorte,
  noRecortar: m.noRecortar,
}));

import { VinoForm } from "../VinoForm";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

const DATOS: DatosVinoFoto = {
  nombre: "Viña Pomal Crianza 2020",
  categoria: "TINTOS",
  descripcion: "Tinto de Rioja.",
  ingredientes: "Tempranillo",
  denominacion_origen: "D.O.Ca. Rioja",
  ubicacion_region: "Haro, La Rioja",
  ubicacion_pais: "España",
  precio_sugerido: 24,
  precio_razon: "",
  precio_mercado: null,
  precio_mercado_fuentes: [],
  // La IA da el encuadre de la botella: el formulario cambia la foto por la encuadrada.
  recorte: { x: 0.2, y: 0.05, w: 0.5, h: 0.9 },
};

function envolver(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  m.crear.mockImplementation(async (v: { nombre: string }) => ({ id: "v1", nombre: v.nombre }));
  m.actualizar.mockResolvedValue({});
  m.subir.mockResolvedValue({ url: "https://x/vinos/v1.jpg" });
  m.recortarEnMovil.mockResolvedValue(true);
});

describe("«Añadir vino» en el móvil con lectura IA", () => {
  it("al guardar lanza el recorte en el servidor con la foto encuadrada (nunca en silencio)", async () => {
    const encuadrada = new File(["encuadrada"], "botella.jpg", { type: "image/jpeg" });
    m.leer.mockResolvedValue({ datos: DATOS, encuadrar: vi.fn(async () => encuadrada) });
    const onOpenChange = vi.fn();
    envolver(<VinoForm open onOpenChange={onOpenChange} />);

    const input = document.querySelector('input[type="file"]:not([capture])') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["foto"], "IMG_0001.JPG", { type: "image/jpeg" })] } });

    await waitFor(() => expect((screen.getByLabelText("Nombre del vino") as HTMLInputElement).value).toBe(DATOS.nombre));
    fireEvent.change(screen.getByLabelText("Precio en carta (€)"), { target: { value: "24" } });
    await act(async () => {});

    fireEvent.click(screen.getByRole("button", { name: "Guardar Vino" }));

    await waitFor(() => expect(m.recortarEnMovil).toHaveBeenCalledTimes(1));
    // Se sube la foto ORIGINAL (la encuadrada), sin compuesta: el fondo lo pone el servidor después.
    expect(m.subir).toHaveBeenCalledWith("vinos", "v1", { original: encuadrada, compuesta: null });
    const [datos, foto] = m.recortarEnMovil.mock.calls[0];
    expect(datos).toMatchObject({ tabla: "Vinos", registroId: "v1", nombre: DATOS.nombre, rutaOriginal: "v1.jpg" });
    expect(typeof datos.tema).toBe("string");
    expect(foto).toBe(encuadrada);
    expect(m.avisarSinRecorte).not.toHaveBeenCalled();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("sin encuadre de la IA se guarda y recorta la foto tal cual", async () => {
    m.leer.mockResolvedValue({ datos: { ...DATOS, recorte: null }, encuadrar: vi.fn() });
    envolver(<VinoForm open onOpenChange={vi.fn()} />);
    const original = new File(["foto"], "IMG_0002.JPG", { type: "image/jpeg" });
    const input = document.querySelector('input[type="file"]:not([capture])') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [original] } });
    await waitFor(() => expect((screen.getByLabelText("Nombre del vino") as HTMLInputElement).value).toBe(DATOS.nombre));
    fireEvent.change(screen.getByLabelText("Precio en carta (€)"), { target: { value: "12" } });
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Guardar Vino" }));
    await waitFor(() => expect(m.recortarEnMovil).toHaveBeenCalledTimes(1));
    expect(m.recortarEnMovil.mock.calls[0][1]).toBe(original);
    expect(m.recortarEnMovil.mock.calls[0][0].rutaOriginal).toBe("v1.jpg");
  });
});
