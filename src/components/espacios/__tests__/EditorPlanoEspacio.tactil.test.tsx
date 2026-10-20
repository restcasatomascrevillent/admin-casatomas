/**
 * EditorPlanoEspacio con el DEDO (tablet) — encargo del dueño, 2026-10-03.
 *
 * Se comprueba el CABLEADO entre barra, lienzo y panel (lo que no puede probar
 * un test del lienzo suelto): los interruptores de pantalla que sustituyen a
 * Espacio / Mayús / doble clic llegan al lienzo, «Terminar pared» aparece y
 * funciona sin ratón, y el panel lateral va plegado debajo en tablet vertical.
 * El Fabric de verdad se prueba aparte (`gestosTactiles.test.ts`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

interface PropsCanvasMock {
  modoMano?: boolean;
  seleccionMultiple?: boolean;
  anguloLibre?: boolean;
  onParedEnCursoChange?: (n: number) => void;
  onMesaCreada?: (id: string, nombre: string) => void;
  onZoomChange?: (z: number) => void;
}

const h = vi.hoisted(() => ({
  canvasProps: { current: null as PropsCanvasMock | null },
  terminarPared: vi.fn(),
  cancelarDibujo: vi.fn(),
  setZoom: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({}) } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/hooks/usePlanosEspacio");
vi.mock("@/hooks/useMesas");

vi.mock("../CanvasPlano", async () => {
  const React = await import("react");
  return {
    CanvasPlano: React.forwardRef<unknown, PropsCanvasMock>((props, ref) => {
      h.canvasProps.current = props;
      React.useImperativeHandle(ref, () => ({
        renameMesaId: vi.fn(),
        removeElement: vi.fn(),
        reloadFromSnapshot: vi.fn(),
        clearCanvas: vi.fn(),
        exportImage: vi.fn(),
        setZoom: h.setZoom,
        centerOnContent: vi.fn(),
        terminarPared: h.terminarPared,
        cancelarDibujo: h.cancelarDibujo,
        unmergeMesa: vi.fn(),
        updateMesaNombre: vi.fn(),
        updateMesaBocadillo: vi.fn(),
      }));
      return React.createElement("div", { "data-testid": "canvas-mock" });
    }),
  };
});

vi.mock("../PanelLateral", async () => {
  const React = await import("react");
  return { PanelLateral: () => React.createElement("div", { "data-testid": "panel-mock" }) };
});

import { usePlanoEspacio, useCrearOActualizarPlano } from "@/hooks/usePlanosEspacio";
import { useMesas, useActualizarMesasSilent, useEliminarMesa } from "@/hooks/useMesas";
import { EditorPlanoEspacio } from "../EditorPlanoEspacio";

function montar() {
  vi.mocked(usePlanoEspacio).mockReturnValue({
    data: { configuracion: {}, ancho_metros: 12, alto_metros: 8 },
    isLoading: false,
  } as never);
  vi.mocked(useCrearOActualizarPlano).mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never);
  vi.mocked(useMesas).mockReturnValue({ data: [], isLoading: false, refetch: vi.fn() } as never);
  vi.mocked(useActualizarMesasSilent).mockReturnValue({ mutateAsync: vi.fn() } as never);
  vi.mocked(useEliminarMesa).mockReturnValue({ mutateAsync: vi.fn() } as never);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <EditorPlanoEspacio espacioId="e-1" espacioNombre="Salón" onBack={() => {}} />
    </QueryClientProvider>,
  );
}

describe("EditorPlanoEspacio · táctil", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.canvasProps.current = null;
  });

  it("Mano, Varias y Ángulo libre llegan al lienzo (alternativa a Espacio, Mayús+clic y Mayús)", () => {
    montar();
    expect(h.canvasProps.current).toMatchObject({ modoMano: false, seleccionMultiple: false, anguloLibre: false });

    fireEvent.click(screen.getByRole("button", { name: "Mano" }));
    expect(h.canvasProps.current?.modoMano).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Varias" }));
    expect(h.canvasProps.current?.seleccionMultiple).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Ángulo libre" }));
    expect(h.canvasProps.current?.anguloLibre).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Mano" }));
    expect(h.canvasProps.current?.modoMano).toBe(false);
  });

  it("«Terminar pared» y «Cancelar» salen al haber una pared a medias y llaman al lienzo", () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Pared" }));
    expect(screen.queryByRole("button", { name: /Terminar pared/ })).toBeNull();

    act(() => h.canvasProps.current?.onParedEnCursoChange?.(3));
    fireEvent.click(screen.getByRole("button", { name: /Terminar pared/ }));
    expect(h.terminarPared).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /Cancelar/ }));
    expect(h.cancelarDibujo).toHaveBeenCalledTimes(1);

    act(() => h.canvasProps.current?.onParedEnCursoChange?.(0));
    expect(screen.queryByRole("button", { name: /Terminar pared/ })).toBeNull();
  });

  it("el % de zoom es el que comunica el lienzo (pellizco, rueda, reencuadre)", () => {
    montar();
    act(() => h.canvasProps.current?.onZoomChange?.(1.5));
    expect(screen.getByText("150%")).toBeInTheDocument();
    act(() => h.canvasProps.current?.onZoomChange?.(0.5));
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("los botones de zoom llaman al lienzo con pasos de 25 %", () => {
    montar();
    act(() => h.canvasProps.current?.onZoomChange?.(1));
    fireEvent.click(screen.getByRole("button", { name: "Acercar" }));
    expect(h.setZoom).toHaveBeenLastCalledWith(1.25);
    fireEvent.click(screen.getByRole("button", { name: "Alejar" }));
    // 1,25 (tras acercar) / 1,25 = vuelve a 1
    expect(h.setZoom.mock.calls.at(-1)?.[0]).toBeCloseTo(1);
  });

  it("el panel lateral va plegado debajo (tablet vertical) y se abre con un toque", () => {
    montar();
    const boton = screen.getByRole("button", { name: /Mesas y propiedades/ });
    expect(boton).toHaveAttribute("aria-expanded", "false");
    expect(boton.className).toMatch(/\bh-12\b/);
    const panel = document.getElementById("panel-lateral-plano")!;
    expect(panel.className).toMatch(/\bhidden\b/);
    expect(panel.className).toMatch(/\blg:flex\b/);

    fireEvent.click(boton);
    expect(boton).toHaveAttribute("aria-expanded", "true");
    expect(panel.className).not.toMatch(/(^|\s)hidden(\s|$)/);
  });

  it("al dibujar una mesa nueva el panel se abre solo (ahí se escribe su número real)", () => {
    montar();
    const panel = document.getElementById("panel-lateral-plano")!;
    expect(panel.className).toMatch(/(^|\s)hidden(\s|$)/);
    act(() => h.canvasProps.current?.onMesaCreada?.("m-1", "1"));
    expect(panel.className).not.toMatch(/(^|\s)hidden(\s|$)/);
  });

  it("los botones de la cabecera miden al menos 44 px", () => {
    montar();
    for (const nombre of ["Guardar", "Exportar", "Limpiar", "Alejar", "Acercar", "Volver a los espacios"]) {
      expect(screen.getByRole("button", { name: nombre }).className, nombre).toMatch(/\bh-11\b/);
    }
  });

  it("el lienzo no deja hacer scroll ni zoom de página con el dedo", () => {
    montar();
    expect(screen.getByTestId("canvas-mock").parentElement?.className).toMatch(/\btouch-none\b/);
  });
});
