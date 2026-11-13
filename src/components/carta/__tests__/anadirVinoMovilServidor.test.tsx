/**
 * «Añadir vino» en el MÓVIL con lectura de la etiqueta por IA (fallo del
 * 03-11-2026 en producción v0.145: en el iPhone y en Android se guardaba la
 * foto y «no pasaba nada»). Ahora el móvil recorta EN EL FORMULARIO como el
 * portátil: con el hook de la foto REAL (useRecorteVino) y la lectura real.
 * Desde el 13/11/2026 («me ha echado» en el iPhone): primero la IA lee la
 * etiqueta y DESPUÉS se quita el fondo en el servidor, uno detrás de otro.
 *   - foto → IA → recorte (servidor) → Guardar → se sube la foto de carta;
 *   - si el servidor falla → se ve el motivo y NO deja guardar hasta
 *     «Reintentar» o «Usar foto original» (antes se subía sola la foto normal).
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
  it("primero lee la etiqueta y después quita el fondo en el formulario; guarda la foto de carta", async () => {
    const orden: string[] = [];
    m.leer.mockImplementation(async () => {
      orden.push("leer:empieza");
      await new Promise((r) => setTimeout(r, 20));
      orden.push("leer:acaba");
      return { datos: DATOS };
    });
    m.movil.mockImplementation(async () => {
      orden.push("recorte");
      return { sticker: new Blob(["s"], { type: "image/png" }), metodo: "servidor" };
    });
    const onOpenChange = vi.fn();
    envolver(<VinoForm open onOpenChange={onOpenChange} />);
    const foto = new File(["foto"], "IMG_0001.JPG", { type: "image/jpeg" });
    await ponerFotoYRellenar(foto);

    // Antes de guardar: recortada en el formulario y compuesta con el fondo.
    await waitFor(() => expect(m.movil).toHaveBeenCalledWith(foto, expect.any(Function)));
    // Uno detrás de otro (memoria del iPhone): el recorte no empieza hasta acabar la lectura.
    expect(orden).toEqual(["leer:empieza", "leer:acaba", "recorte"]);
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

  it("si el servidor falla: se ve el motivo y no deja guardar (ni sube la foto sin recortar ni la manda a un ordenador)", async () => {
    m.movil.mockRejectedValue(new ErrorRecorteServidor("Se ha alcanzado el tope mensual de recortes en el servidor", "tope", 429));
    envolver(<VinoForm open onOpenChange={vi.fn()} />);
    const foto = new File(["foto"], "IMG_0002.JPG", { type: "image/jpeg" });
    await ponerFotoYRellenar(foto);

    await waitFor(() => expect(screen.getByTestId("foto").dataset.fase).toBe("fallo"));
    expect(screen.getByTestId("foto").textContent).toMatch(/tope mensual de recortes en el servidor.*«Reintentar».*«Usar foto original»/);

    const guardar = screen.getByRole("button", { name: "Falta el fondo de la foto" });
    expect(guardar).toBeDisabled();
    fireEvent.click(guardar);
    await act(async () => {});
    expect(m.crear).not.toHaveBeenCalled();
    expect(m.subir).not.toHaveBeenCalled();
    expect(m.noRecortar).not.toHaveBeenCalled();
  });
});
