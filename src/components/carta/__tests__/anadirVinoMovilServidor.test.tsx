/**
 * «Añadir vino» en el MÓVIL con lectura de la etiqueta por IA (fallo del
 * 03-11-2026 en producción v0.145: en el iPhone y en Android se guardaba la
 * foto y «no pasaba nada»). Ahora el móvil recorta EN EL FORMULARIO como el
 * portátil, en paralelo a la lectura: con el hook de la foto REAL
 * (useRecorteVino) y la lectura real.
 *   - foto → recorte (móvil o, de respaldo, servidor) + IA → Guardar → se sube
 *     la foto de carta compuesta;
 *   - si el móvil y el servidor fallan → se ve el motivo y, al guardar, la
 *     foto normal va a un ordenador.
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
  movil: vi.fn(),
  componer: vi.fn(async () => new Blob(["carta"], { type: "image/webp" })),
  noRecortar: vi.fn(async () => undefined),
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
// Móvil (no es un ordenador): quitarFondo pasa por quitarFondoMovil.
vi.mock("../recorte/quitarFondoNavegador", async (original) => {
  const real = await original<typeof import("../recorte/quitarFondoNavegador")>();
  return { ...real, recorteNavegadorSeguro: () => false };
});
vi.mock("../recorte/quitarFondoMovil", () => ({ quitarFondoMovil: m.movil }));
vi.mock("../composicionCarta", async (original) => ({ ...(await original<typeof import("../composicionCarta")>()), componerFotoCarta: m.componer }));
vi.mock("../recorte/fotoYaRecortada", () => ({
  aceptarFotoCarta: async (f: File) => f,
  esStickerRecortado: () => false,
  candidataRecortada: () => false,
  detectarFotoRecortada: async () => null,
}));
vi.mock("../recorte/PegarFotoRecortada", () => ({ PegarFotoRecortada: () => null }));
vi.mock("../recorte/SelectorFotoCarta", () => ({
  SelectorFotoCarta: ({ superpuesto, recorte }: { superpuesto?: ReactNode; recorte: { estado: { fase: string; aviso?: string } } }) => (
    <div data-testid="foto" data-fase={recorte.estado.fase}>
      {recorte.estado.aviso}
      {superpuesto}
    </div>
  ),
}));
vi.mock("../subirFotoCarta", async (original) => {
  const real = await original<typeof import("../subirFotoCarta")>();
  return { ...real, subirFotoCarta: m.subir };
});
vi.mock("../recorte/recorteEnSegundoPlano", () => ({ noRecortar: m.noRecortar, avisarSinRecorte: vi.fn() }));

import { VinoForm } from "../VinoForm";
import { ErrorRecorteServidor } from "../recorte/quitarFondoServidor";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() }));
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
  recorte: { x: 0.2, y: 0.05, w: 0.5, h: 0.9 },
};

function envolver(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

async function ponerFotoYRellenar(foto: File) {
  const input = document.querySelector('input[type="file"]:not([capture])') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [foto] } });
  await waitFor(() => expect((screen.getByLabelText("Nombre del vino") as HTMLInputElement).value).toBe(DATOS.nombre));
  fireEvent.change(screen.getByLabelText("Precio en carta (€)"), { target: { value: "24" } });
  await act(async () => {});
}

beforeEach(() => {
  vi.clearAllMocks();
  m.crear.mockImplementation(async (v: { nombre: string }) => ({ id: "v1", nombre: v.nombre }));
  m.actualizar.mockResolvedValue({});
  m.subir.mockResolvedValue({ url: "https://x/vinos/v1-carta.webp" });
  m.leer.mockResolvedValue({ datos: DATOS });
});

describe("«Añadir vino» en el móvil con lectura IA", () => {
  it("recorta en el formulario a la vez que lee la etiqueta y guarda la foto de carta", async () => {
    m.movil.mockResolvedValue({ sticker: new Blob(["s"], { type: "image/png" }), metodo: "navegador" });
    const onOpenChange = vi.fn();
    envolver(<VinoForm open onOpenChange={onOpenChange} />);
    const foto = new File(["foto"], "IMG_0001.JPG", { type: "image/jpeg" });
    await ponerFotoYRellenar(foto);

    // Antes de guardar: recortada en el formulario y compuesta con el fondo.
    expect(m.movil).toHaveBeenCalledWith(foto, expect.any(Function));
    await waitFor(() => expect(screen.getByTestId("foto").dataset.fase).toBe("listo"));
    await waitFor(() => expect(m.componer).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("button", { name: "Guardar Vino" })).not.toBeDisabled());

    fireEvent.click(screen.getByRole("button", { name: "Guardar Vino" }));
    await waitFor(() => expect(m.subir).toHaveBeenCalledTimes(1));
    const archivos = m.subir.mock.calls[0][2];
    expect(archivos.original).toBe(foto);
    expect(archivos.compuesta).toBeInstanceOf(File);
    expect(m.noRecortar).not.toHaveBeenCalled();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("si el móvil y el servidor fallan: se ve el motivo antes de guardar y, al guardar, la foto normal va a un ordenador", async () => {
    m.movil.mockRejectedValue(new ErrorRecorteServidor("Se ha alcanzado el tope mensual de recortes en el servidor", "tope", 429));
    envolver(<VinoForm open onOpenChange={vi.fn()} />);
    const foto = new File(["foto"], "IMG_0002.JPG", { type: "image/jpeg" });
    await ponerFotoYRellenar(foto);

    await waitFor(() => expect(screen.getByTestId("foto").dataset.fase).toBe("fallo"));
    expect(screen.getByTestId("foto").textContent).toMatch(/tope mensual de recortes en el servidor.*se recortará en un ordenador/);

    fireEvent.click(screen.getByRole("button", { name: "Guardar Vino" }));
    await waitFor(() => expect(m.noRecortar).toHaveBeenCalledTimes(1));
    expect(m.subir.mock.calls[0][2]).toEqual({ original: foto, compuesta: null });
    expect(m.noRecortar).toHaveBeenCalledWith(
      expect.objectContaining({ tabla: "Vinos", registroId: "v1", rutaOriginal: "v1.jpg" }),
      "Se ha alcanzado el tope mensual de recortes en el servidor.",
    );
  });
});
