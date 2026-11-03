/**
 * Tras un recorte fallido la ficha se guarda con la foto normal. Ese aviso se
 * da al guardar (el formulario se cierra y su línea gris desaparece) y el botón
 * de la ficha pasa a llamarse «Quitar fondo» mientras la foto no tenga fondo
 * de carta. Caso real: vino añadido desde un iPhone, 02-11-2026.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: { warning: mocks.warning, error: vi.fn(), success: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { avisarGuardadoSinFondo, MS_AVISO_SIN_FONDO } from "../recorte/avisoGuardadoSinFondo";
import { BotonCambiarFondo } from "../recorte/BotonCambiarFondo";
import { SelectorFotoCarta } from "../recorte/SelectorFotoCarta";
import type { FotoCarta } from "../recorte/useRecorteVino";

beforeEach(() => vi.clearAllMocks());

describe("avisarGuardadoSinFondo", () => {
  it("avisa, con lo que hay que hacer, cuando el recorte falló", () => {
    expect(avisarGuardadoSinFondo({ fase: "fallo" })).toBe(true);
    expect(mocks.warning).toHaveBeenCalledTimes(1);
    const [titulo, opciones] = mocks.warning.mock.calls[0];
    expect(titulo).toMatch(/sin el fondo de carta/);
    expect(opciones.description).toContain("«Quitar fondo»");
    expect(opciones.description).toContain("La foto original está guardada");
    expect(opciones.duration).toBe(MS_AVISO_SIN_FONDO);
  });

  it.each([{ fase: "nada" }, { fase: "trabajando" }, { fase: "listo" }] as const)(
    "no avisa si el recorte no falló (%o): elegir «Usar foto original» a propósito no es un fallo",
    (estado) => {
      expect(avisarGuardadoSinFondo(estado)).toBe(false);
      expect(mocks.warning).not.toHaveBeenCalled();
    },
  );
});

function recorteSimulado(parcial: Partial<FotoCarta>): FotoCarta {
  return {
    tipo: "vino",
    original: null,
    estado: { fase: "nada" },
    eleccion: "carta",
    vista: "sticker",
    tema: "crema",
    urls: {},
    repetir: vi.fn(),
    setEleccion: vi.fn(),
    setVista: vi.fn(),
    setTema: vi.fn(),
    iniciar: vi.fn(),
    trabajando: false,
    ...parcial,
  } as unknown as FotoCarta;
}

describe("SelectorFotoCarta ante un recorte fallido", () => {
  it("enseña el aviso como alerta visible (no como línea gris) y deja repetir el recorte", () => {
    const repetir = vi.fn();
    const aviso = "Quitar el fondo ha tardado demasiado. Se guarda la foto normal. Pulsa «Repetir recorte».";
    render(
      <SelectorFotoCarta
        recorte={recorteSimulado({ original: new File(["x"], "f.jpg"), estado: { fase: "fallo", aviso }, eleccion: "original", repetir })}
      />,
    );
    const alerta = screen.getByRole("alert");
    expect(alerta).toHaveTextContent(aviso);
    expect(alerta).toHaveTextContent("No se ha podido quitar el fondo");
    fireEvent.click(screen.getByRole("button", { name: /Repetir recorte/ }));
    expect(repetir).toHaveBeenCalled();
  });

  it("sin fallo no hay alerta", () => {
    render(<SelectorFotoCarta recorte={recorteSimulado({ original: new File(["x"], "f.jpg") })} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("BotonCambiarFondo", () => {
  const sinRecorte = () => recorteSimulado({ original: null });

  it("con una foto sin fondo de carta se llama «Quitar fondo»", async () => {
    render(<BotonCambiarFondo recorte={sinRecorte()} url="https://x.supabase.co/storage/v1/object/public/vinos/abc.jpg?t=1" />);
    expect(await screen.findByRole("button", { name: /Quitar fondo/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cambiar fondo/ })).toBeNull();
  });

  it("con una foto que ya tiene fondo de carta sigue llamándose «Cambiar fondo»", () => {
    render(
      <BotonCambiarFondo recorte={sinRecorte()} url="https://x.supabase.co/storage/v1/object/public/vinos/abc-carta-jpg.webp?t=1" />,
    );
    expect(screen.getByRole("button", { name: /Cambiar fondo/ })).toBeInTheDocument();
  });

  it("al pulsarlo baja la foto y arranca el recorte con ella", async () => {
    const recorte = sinRecorte();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, blob: async () => new Blob(["img"], { type: "image/jpeg" }) })),
    );
    render(<BotonCambiarFondo recorte={recorte} url="https://x.supabase.co/storage/v1/object/public/vinos/abc.jpg" />);
    fireEvent.click(screen.getByRole("button", { name: /Quitar fondo/ }));
    await waitFor(() => expect(recorte.iniciar).toHaveBeenCalledTimes(1));
    vi.unstubAllGlobals();
  });

  it("sin foto guardada no se enseña", () => {
    const { container } = render(<BotonCambiarFondo recorte={sinRecorte()} url={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
