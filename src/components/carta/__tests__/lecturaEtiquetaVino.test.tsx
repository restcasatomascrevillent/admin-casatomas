/**
 * Lectura de la etiqueta con IA dentro del formulario de vino (03-11-2026,
 * dueño: «al tener la foto, que la IA saque qué vino es y rellene la ficha»):
 * vino nuevo → automática al poner la foto; nunca pisa lo escrito; con
 * precarga del lote no se vuelve a leer; vino existente → botón manual.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Vino } from "@/hooks/useVinos";
import type { DatosVinoFoto } from "../leerVinoFoto";

const m = vi.hoisted(() => ({
  leer: vi.fn(),
  crear: vi.fn(),
  actualizar: vi.fn(),
  toastWarning: vi.fn(),
  toastSuccess: vi.fn(),
  toastInfo: vi.fn(),
}));

vi.mock("@/hooks/useVinos", () => ({
  useVinos: () => ({
    crearVino: { mutateAsync: m.crear, isPending: false },
    actualizarVino: { mutateAsync: m.actualizar, isPending: false },
    categorias: ["TINTOS", "BLANCOS", "VINOS TINTOS — ORIGEN PENDIENTE"],
    denominaciones: [],
    regiones: [],
    paises: [],
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), warning: m.toastWarning, success: m.toastSuccess, info: m.toastInfo, message: vi.fn() },
}));
vi.mock("../leerVinoFoto", async (original) => {
  const real = await original<typeof import("../leerVinoFoto")>();
  return { ...real, leerDatosVinoDeFoto: m.leer };
});
// La foto entra tal cual (sin detectar alfa) y el recorte es un estado mínimo.
vi.mock("../recorte/fotoYaRecortada", () => ({ aceptarFotoCarta: async (f: File) => f }));
vi.mock("../recorte/PegarFotoRecortada", () => ({ PegarFotoRecortada: () => null }));
vi.mock("../recorte/BotonCambiarFondo", () => ({ BotonCambiarFondo: () => null }));
vi.mock("../recorte/SelectorFotoCarta", () => ({
  SelectorFotoCarta: ({ superpuesto }: { superpuesto?: ReactNode }) => <div data-testid="foto">{superpuesto}</div>,
}));
vi.mock("../recorte/useRecorteVino", async () => {
  const React = await import("react");
  return {
    useRecorteVino: () => {
      const [original, setOriginal] = React.useState<File | null>(null);
      const iniciar = React.useCallback((f: File) => setOriginal(f), []);
      const limpiar = React.useCallback(() => setOriginal(null), []);
      return {
        original,
        estado: { fase: original ? "listo" : "nada" },
        archivoFinal: original,
        usaCarta: false,
        compuesta: null,
        trabajando: false,
        iniciar,
        limpiar,
      };
    },
  };
});

import { VinoForm } from "../VinoForm";
import { EditarVinoModal } from "../EditarVinoModal";
import { camposVaciosARellenar, valoresDesdeDatosVino } from "../lecturaEtiquetaVino";
import { MENSAJE_CATEGORIA_PENDIENTE } from "@/lib/origen-vino";
import { MENSAJE_SIN_SALDO_OPENAI, motivoLecturaVino } from "../leerVinoFoto";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

const DATOS: DatosVinoFoto = {
  nombre: "Viña Pomal Crianza 2020",
  categoria: "TINTOS",
  descripcion: "Tinto de Rioja con crianza en barrica.",
  ingredientes: "Tempranillo",
  denominacion_origen: "D.O.Ca. Rioja",
  ubicacion_region: "Haro, La Rioja",
  ubicacion_pais: "España",
  precio_sugerido: 24,
  precio_razon: "como otros Rioja crianza",
  precio_mercado: 11.5,
  precio_mercado_fuentes: [{ tienda: "Bodeboca", url: "https://www.bodeboca.com/x", precio: 11.5 }],
  recorte: null,
};

function respuesta(datos: DatosVinoFoto = DATOS) {
  return { datos };
}

function envolver(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const foto = () => new File(["botella"], "botella.jpg", { type: "image/jpeg" });

function ponerFoto(f = foto()) {
  const input = document.querySelector('input[type="file"]:not([capture])') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [f] } });
  return f;
}

const valor = (etiqueta: RegExp | string) => (screen.getByLabelText(etiqueta) as HTMLInputElement).value;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("camposVaciosARellenar", () => {
  it("solo devuelve los campos vacíos que la IA sabe", () => {
    expect(
      camposVaciosARellenar({ nombre: "Mi vino", categoria: "", descripcion: "  ", ingredientes: undefined }, { ...DATOS, ingredientes: null }),
    ).toEqual({
      categoria: "TINTOS",
      descripcion: DATOS.descripcion,
      denominacion_origen: DATOS.denominacion_origen,
      ubicacion_pais: "España",
      ubicacion_region: "Haro, La Rioja",
    });
  });
});

describe("motivoLecturaVino", () => {
  it("traduce el texto crudo de «sin saldo» de OpenAI y deja el resto tal cual", () => {
    expect(motivoLecturaVino("429 insufficient_quota")).toBe(MENSAJE_SIN_SALDO_OPENAI);
    expect(motivoLecturaVino("La imagen es demasiado grande")).toBe("La imagen es demasiado grande");
    expect(motivoLecturaVino("")).toBe("La IA no ha devuelto datos");
  });
});

describe("VinoForm: lectura de la etiqueta con IA", () => {
  it("vino nuevo: al poner la foto lee la etiqueta sola y rellena la ficha y el precio sugerido", async () => {
    let resolver!: (v: ReturnType<typeof respuesta>) => void;
    m.leer.mockReturnValue(new Promise((r) => (resolver = r)));
    envolver(<VinoForm open onOpenChange={vi.fn()} />);

    const f = ponerFoto();
    await waitFor(() => expect(m.leer).toHaveBeenCalledTimes(1));
    expect(m.leer.mock.calls[0][0]).toBe(f);
    expect(screen.getByText("Leyendo la etiqueta…")).toBeInTheDocument();

    await act(async () => resolver(respuesta()));
    await waitFor(() => expect(valor("Nombre del vino")).toBe("Viña Pomal Crianza 2020"));
    expect(screen.getByDisplayValue("Tempranillo")).toBeInTheDocument();
    expect(screen.getByText("España")).toBeInTheDocument();
    expect(screen.getByText(/Sugerido:/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Bodeboca/ })).toBeInTheDocument();
    expect(screen.queryByText("Leyendo la etiqueta…")).not.toBeInTheDocument();
  });

  it("no pisa lo que el usuario escribe mientras la IA lee", async () => {
    let resolver!: (v: ReturnType<typeof respuesta>) => void;
    m.leer.mockReturnValue(new Promise((r) => (resolver = r)));
    envolver(<VinoForm open onOpenChange={vi.fn()} />);

    ponerFoto();
    await waitFor(() => expect(m.leer).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Nombre del vino"), { target: { value: "Pomal de la casa" } });

    await act(async () => resolver(respuesta()));
    await waitFor(() => expect(screen.getByDisplayValue("Tempranillo")).toBeInTheDocument());
    expect(valor("Nombre del vino")).toBe("Pomal de la casa");
  });

  it("con nombre ya escrito no lee sola: botón «Leer etiqueta con IA»", async () => {
    m.leer.mockResolvedValue(respuesta());
    envolver(<VinoForm open onOpenChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Nombre del vino"), { target: { value: "Mi tinto" } });

    ponerFoto();
    const boton = await screen.findByRole("button", { name: /Leer etiqueta con IA/ });
    expect(m.leer).not.toHaveBeenCalled();

    fireEvent.click(boton);
    await waitFor(() => expect(screen.getByDisplayValue("Tempranillo")).toBeInTheDocument());
    expect(valor("Nombre del vino")).toBe("Mi tinto");
  });

  it("con precarga del lote no vuelve a llamar a la IA", async () => {
    envolver(<VinoForm open onOpenChange={vi.fn()} precarga={{ datos: DATOS, foto: foto() }} />);
    await waitFor(() => expect(valor("Nombre del vino")).toBe("Viña Pomal Crianza 2020"));
    expect(screen.getByText(/Sugerido:/)).toBeInTheDocument();

    ponerFoto(); // cambiar la foto tampoco relee
    await act(async () => {});
    expect(m.leer).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Leer etiqueta con IA/ })).not.toBeInTheDocument();
  });

  it("si la IA falla avisa con el motivo y el formulario sigue usable", async () => {
    m.leer.mockRejectedValue(new Error("La cuenta de OpenAI se ha quedado sin saldo: añade crédito en platform.openai.com → Billing"));
    envolver(<VinoForm open onOpenChange={vi.fn()} />);
    ponerFoto();
    await waitFor(() => expect(m.toastWarning).toHaveBeenCalled());
    expect(m.toastWarning.mock.calls[0][1].description).toMatch(/sin saldo/);
    fireEvent.change(screen.getByLabelText("Nombre del vino"), { target: { value: "A mano" } });
    expect(valor("Nombre del vino")).toBe("A mano");
    expect(screen.getByRole("button", { name: /Leer etiqueta con IA/ })).toBeInTheDocument();
  });
});

describe("EditarVinoModal: vino existente", () => {
  const vino = {
    id: "v1",
    nombre: "Pomal",
    categoria: "TINTOS",
    precio_eur: 20,
    descripcion: null,
    ingredientes: null,
    denominacion_origen: null,
    ubicacion_pais: "España",
    ubicacion_region: null,
    imagen_url: null,
  } as unknown as Vino;

  it("no lee sola; el botón rellena solo los campos vacíos", async () => {
    m.leer.mockResolvedValue(respuesta());
    envolver(<EditarVinoModal open onOpenChange={vi.fn()} vino={vino} />);

    ponerFoto();
    const boton = await screen.findByRole("button", { name: /Leer etiqueta con IA/ });
    expect(m.leer).not.toHaveBeenCalled();

    fireEvent.click(boton);
    await waitFor(() => expect(screen.getByDisplayValue("Tempranillo")).toBeInTheDocument());
    expect(m.leer).toHaveBeenCalledTimes(1);
    expect(valor("Nombre del vino")).toBe("Pomal");
    expect(screen.getByText("Haro, La Rioja")).toBeInTheDocument();
    expect(screen.getByText(/Sugerido:/)).toBeInTheDocument();
  });

  it("si todo está lleno no toca nada y avisa", async () => {
    m.leer.mockResolvedValue(respuesta());
    const lleno = {
      ...vino,
      descripcion: "Mía",
      ingredientes: "Garnacha",
      denominacion_origen: "D.O. Alicante",
      ubicacion_region: "Villena",
    } as unknown as Vino;
    envolver(<EditarVinoModal open onOpenChange={vi.fn()} vino={lleno} />);
    ponerFoto();
    fireEvent.click(await screen.findByRole("button", { name: /Leer etiqueta con IA/ }));
    await waitFor(() => expect(m.toastInfo).toHaveBeenCalled());
    expect(valor("Nombre del vino")).toBe("Pomal");
    expect(screen.getByDisplayValue("Garnacha")).toBeInTheDocument();
  });
});

// Origen obligatorio (04/11/2026, dueño: «deja de subir vinos si el origen no
// está claro»): si la IA no lo saca claro, el formulario lo pide y no guarda.
describe("Origen obligatorio al guardar un vino", () => {
  const DUDOSO: DatosVinoFoto = {
    ...DATOS,
    categoria: "VINOS TINTOS — ORIGEN PENDIENTE",
    denominacion_origen: null,
    ubicacion_pais: null,
    ubicacion_region: null,
  };

  it("la categoría «ORIGEN PENDIENTE» de la IA no se rellena", () => {
    expect(valoresDesdeDatosVino(DUDOSO).categoria).toBe("");
    expect(valoresDesdeDatosVino(DATOS).categoria).toBe("TINTOS");
    expect(camposVaciosARellenar({ categoria: "" }, DUDOSO).categoria).toBeUndefined();
  });

  it("alta con IA sin origen claro: lo pide y no guarda hasta completarlo", async () => {
    m.leer.mockResolvedValue(respuesta(DUDOSO));
    envolver(<VinoForm open onOpenChange={vi.fn()} />);
    ponerFoto();
    await waitFor(() => expect(valor("Nombre del vino")).toBe("Viña Pomal Crianza 2020"));
    expect(
      await screen.findByText(
        "La IA no ha sacado claro el origen de este vino. Falta el país, la región y la categoría con su denominación (no vale «Origen pendiente»): sin el origen claro el mapa de la carta no sabe dónde poner el vino. Complétalo para poder guardarlo.",
      ),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Precio en carta/), { target: { value: "24" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar Vino" }));
    expect(await screen.findByText(/El país es obligatorio: sin él el vino no sale en el mapa/)).toBeInTheDocument();
    expect(screen.getByText(/La región es obligatoria: sin ella el vino no sale en el mapa/)).toBeInTheDocument();
    expect(screen.getByText("La categoría es obligatoria")).toBeInTheDocument();
    expect(m.crear).not.toHaveBeenCalled();
  });

  it("lote: una botella con origen pendiente llega al formulario con la categoría vacía y el aviso", async () => {
    envolver(<VinoForm open onOpenChange={vi.fn()} precarga={{ datos: { ...DUDOSO, ubicacion_pais: "España", ubicacion_region: "Haro" }, foto: foto() }} />);
    await waitFor(() => expect(valor("Nombre del vino")).toBe("Viña Pomal Crianza 2020"));
    expect(screen.getByRole("status")).toHaveTextContent(/Falta la categoría con su denominación/);
    fireEvent.click(screen.getByRole("button", { name: "Guardar Vino" }));
    expect(await screen.findByText("La categoría es obligatoria")).toBeInTheDocument();
    expect(m.crear).not.toHaveBeenCalled();
  });

  it("editar un vino de «ORIGEN PENDIENTE»: lo marca y no guarda sin elegir su denominación", async () => {
    const pendiente = {
      id: "v9", nombre: "Burbujas", categoria: "VINOS TINTOS — ORIGEN PENDIENTE", precio_eur: 40, descripcion: null,
      ingredientes: null, denominacion_origen: null, ubicacion_pais: "Francia", ubicacion_region: "Champagne", imagen_url: null,
    } as unknown as Vino;
    envolver(<EditarVinoModal open onOpenChange={vi.fn()} vino={pendiente} />);
    expect(await screen.findByRole("status")).toHaveTextContent(
      /^Origen por confirmar\. Falta la categoría con su denominación .* Complétalo para poder guardar; después ya se puede publicar\.$/,
    );
    fireEvent.click(screen.getByRole("button", { name: /Guardar cambios/ }));
    expect(await screen.findByText(MENSAJE_CATEGORIA_PENDIENTE)).toBeInTheDocument();
    expect(m.actualizar).not.toHaveBeenCalled();
  });

  it("editar un vino con origen claro no avisa", async () => {
    const bueno = {
      id: "v8", nombre: "Pomal", categoria: "TINTOS", precio_eur: 20, ubicacion_pais: "España", ubicacion_region: "Haro", imagen_url: null,
    } as unknown as Vino;
    envolver(<EditarVinoModal open onOpenChange={vi.fn()} vino={bueno} />);
    await waitFor(() => expect(valor("Nombre del vino")).toBe("Pomal"));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
