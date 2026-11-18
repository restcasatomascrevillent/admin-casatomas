// Calidad percibida del chat (18/11/2026): espera con información y «Parar»,
// «Copiar» en texto plano, «Compartir», botones de paso siguiente, nombres
// parecidos y pie de datos.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { BotonCompartir, BotonCopiar, BotonesPaso, Escribiendo, PanelCopiloto } from "../PanelCopiloto";
import type { MensajeChat } from "@/hooks/useChatFacturas";

describe("Escribiendo: la espera con información", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("el texto cambia con los segundos y sale el contador", () => {
    render(<Escribiendo onParar={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent("Buscando en las facturas…");
    act(() => void vi.advanceTimersByTime(5000));
    expect(screen.getByRole("status")).toHaveTextContent("Calculando…");
    expect(screen.getByRole("status")).toHaveTextContent("5 s");
    act(() => void vi.advanceTimersByTime(7000));
    expect(screen.getByRole("status")).toHaveTextContent("Casi está…");
  });

  it("«Parar» llama a onParar; sin onParar o al cargar un historial no hay botón", () => {
    const onParar = vi.fn();
    const { rerender } = render(<Escribiendo onParar={onParar} />);
    fireEvent.click(screen.getByRole("button", { name: "Parar" }));
    expect(onParar).toHaveBeenCalledTimes(1);
    rerender(<Escribiendo />);
    expect(screen.queryByRole("button", { name: "Parar" })).toBeNull();
    rerender(<Escribiendo cargando onParar={onParar} />);
    expect(screen.queryByRole("button", { name: "Parar" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Abriendo la conversación…");
  });
});

describe("Copiar y compartir en texto plano", () => {
  const MD = "**Heineken 1/3: 41,85 €**, sin IVA\n\n| Factura | Total |\n|---|---|\n| 002816 | 41,85 € |";
  const PLANO = "Heineken 1/3: 41,85 €, sin IVA\n\nFactura · Total\n002816 · 41,85 €";

  afterEach(() => {
    Reflect.deleteProperty(navigator, "share");
  });

  it("«Copiar» deja en el portapapeles texto sin ** ni |", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<BotonCopiar texto={MD} />);
    fireEvent.click(screen.getByRole("button", { name: /copiar/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(PLANO));
    expect(writeText.mock.calls[0][0]).not.toMatch(/\*\*|\|/);
  });

  it("«Compartir» usa navigator.share con el texto plano", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    render(<BotonCompartir texto={MD} />);
    fireEvent.click(screen.getByRole("button", { name: /compartir/i }));
    await waitFor(() => expect(share).toHaveBeenCalledWith({ text: PLANO }));
  });

  it("sin navigator.share no hay botón «Compartir»", () => {
    render(<BotonCompartir texto={MD} />);
    expect(screen.queryByRole("button", { name: /compartir/i })).toBeNull();
  });
});

describe("BotonesPaso", () => {
  it("cada botón manda su pregunta ya hecha", () => {
    const onEnviar = vi.fn();
    render(<BotonesPaso pasos={[{ texto: "Ver la factura", pregunta: "Enséñame la última factura de heineken" }]} onEnviar={onEnviar} />);
    fireEvent.click(screen.getByRole("button", { name: "Ver la factura" }));
    expect(onEnviar).toHaveBeenCalledWith("Enséñame la última factura de heineken");
  });
});

const MSG = (extra: Partial<MensajeChat>): MensajeChat => ({
  id: "m1",
  contenido: "**Heineken 1/3: 41,85 €** por caja.",
  rol: "assistant",
  conversacion_id: "c1",
  created_at: "2026-11-18T10:00:00Z",
  persistido: true,
  ...extra,
});

function panel(mensajes: MensajeChat[], extra: Partial<ComponentProps<typeof PanelCopiloto>> = {}) {
  const props: ComponentProps<typeof PanelCopiloto> = {
    mensajes,
    isLoading: false,
    isSending: false,
    sugerencias: ["¿Cuáles son mis mayores proveedores?"],
    onEnviar: vi.fn(),
    fijadas: new Set(),
    onFijar: vi.fn(),
    onQuitarFijada: vi.fn(),
    ...extra,
  };
  render(<PanelCopiloto {...props} />);
  return props;
}

describe("PanelCopiloto: lo que nota el usuario", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("esperando: texto de progreso y «Parar» que cancela", () => {
    const onParar = vi.fn();
    panel([MSG({ rol: "user", contenido: "Precio heineken" })], { isSending: true, onParar });
    expect(within(screen.getByRole("log")).getByRole("status")).toHaveTextContent("Buscando en las facturas…");
    fireEvent.click(screen.getByRole("button", { name: "Parar" }));
    expect(onParar).toHaveBeenCalled();
  });

  it("tras una respuesta con herramienta: botones de paso siguiente que mandan la pregunta, y pie con la fecha", () => {
    const { onEnviar } = panel([
      MSG({
        traza: { modelo: "m", herramientas: [{ nombre: "compras_producto", argumentos: { producto: "heineken 1/3" }, resultado: "completada" }], ayuda: { datos_hasta: "2026-11-12" } },
      }),
    ]);
    expect(screen.getByText("Datos hasta 12/11/2026 · sin IVA")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Comparar con otro proveedor" }));
    expect(onEnviar).toHaveBeenCalledWith("¿Qué proveedor me vende heineken 1/3 más barato?");
  });

  it("«no lo encuentro»: los nombres parecidos son botones", () => {
    const { onEnviar } = panel([
      MSG({ contenido: "No lo encuentro con ese nombre.", aviso: "sin_datos", traza: { modelo: null, herramientas: [], aviso: "sin_datos", ayuda: { sugerencias: ["LAURENT PERRIER CUVEE", "LP ROSE"] } } }),
    ]);
    expect(screen.getByText("¿Es alguno de estos?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "LAURENT PERRIER CUVEE" }));
    expect(onEnviar).toHaveBeenCalledWith("¿A cuánto compro LAURENT PERRIER CUVEE?");
  });

  it("un error enseña «Reintentar» y ningún botón de paso", () => {
    const h = [{ nombre: "compras_producto", argumentos: { producto: "x" }, resultado: "completada" }];
    panel(
      [
        MSG({ id: "u", rol: "user", contenido: "otra" }),
        MSG({ id: "e", contenido: "⚠️ La consulta ha tardado demasiado. Pulsa «Reintentar».", aviso: "error", traza: { modelo: null, herramientas: h, aviso: "error" } }),
      ],
      { onRegenerar: vi.fn() },
    );
    expect(screen.getAllByRole("button", { name: "Reintentar" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Ver la factura" })).toBeNull();
  });

  it("solo la última respuesta lleva botones de paso", () => {
    const h = [{ nombre: "compras_producto", argumentos: { producto: "x" }, resultado: "completada" }];
    panel([
      MSG({ id: "a", traza: { modelo: null, herramientas: h } }),
      MSG({ id: "u", rol: "user", contenido: "otra" }),
      MSG({ id: "b", traza: { modelo: null, herramientas: h } }),
    ]);
    expect(screen.getAllByRole("button", { name: "Ver la factura" })).toHaveLength(1);
  });

  it("las sugerencias de inicio empiezan por «Precio de…» (la rellena el usuario)", () => {
    panel([]);
    expect(screen.getAllByRole("button").map((b) => b.textContent).slice(0, 2)).toEqual(["Precio de…", "¿Cuáles son mis mayores proveedores?"]);
  });

  it("el hilo anuncia las respuestas nuevas (role=log)", () => {
    panel([MSG({})]);
    expect(screen.getByRole("log", { name: "Conversación con la IA" })).toHaveAttribute("aria-live", "polite");
  });
});
