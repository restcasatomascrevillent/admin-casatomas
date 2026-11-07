// Alertas de Facturas en Análisis (20261107300000, 07/11/2026): «Requiere
// atención», marcas en «Gasto por mes» y «Lo que más ha subido» destacando lo
// que pasa del umbral. Todo se toca (sin «pasar el ratón»).
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: () => ({ limit: async () => ({ data: [], error: null }) }) }),
    rpc: async () => ({ data: null, error: { code: "PGRST202", message: "no" } }),
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));

import { normalizarAlertas } from "@/lib/facturas/alertas";
import { EVENTO_ABRIR_AVISOS } from "@/lib/avisos";
import { RequiereAtencion, MarcaAlerta } from "@/components/facturas/analisis/Alertas";
import { LoQueMasHaSubido } from "@/components/facturas/analisis/TarjetasDetalle";
import { GastoPorMesModulo } from "@/components/facturas/analisis/ModulosExtra";

const conQuery = (n: ReactNode) => <QueryClientProvider client={new QueryClient()}>{n}</QueryClientProvider>;

const alerta = (i: number, extra: Record<string, unknown> = {}) => ({
  id: `a${i}`,
  tipo: "facturas_importe_inusual",
  prioridad: "normal",
  titulo: `Alerta ${i}`,
  mensaje: `Detalle ${i}`,
  leida: false,
  datos: { enlace: `?tab=compras&modo=documentos&doc=${i}`, mes: "2026-10", desde: "2026-10-05", hasta: "2026-10-05", proveedor_id: 100 + i },
  ...extra,
});

describe("Requiere atención", () => {
  it("enseña las 5 primeras, «Ver todas» abre los avisos de Facturas y cada una lleva a su documento", () => {
    const alertas = normalizarAlertas([
      alerta(1, { prioridad: "alta", titulo: "Sube Merluza: +30 %", tipo: "facturas_precio_sube", datos: { enlace: "?tab=compras&modo=documentos&doc=1", producto: "MERLUZA", unidad: "kg", proveedor_id: 5 } }),
      ...[2, 3, 4, 5, 6].map((i) => alerta(i)),
    ]);
    const onIrA = vi.fn();
    const onExplorar = vi.fn();
    const abrir = vi.fn();
    window.addEventListener(EVENTO_ABRIR_AVISOS, abrir);
    render(<RequiereAtencion alertas={alertas} onIrA={onIrA} onExplorar={onExplorar} />);
    const tarjeta = screen.getByTestId("tarjeta-requiere-atencion");
    expect(within(tarjeta).getAllByRole("listitem")).toHaveLength(5);
    expect(within(tarjeta).getByText("Importante")).toBeTruthy();

    fireEvent.click(within(tarjeta).getByRole("button", { name: /Ver todas \(6\)/ }));
    expect(abrir).toHaveBeenCalledTimes(1);
    expect((abrir.mock.calls[0][0] as CustomEvent).detail).toEqual({ seccion: "facturas" });
    window.removeEventListener(EVENTO_ABRIR_AVISOS, abrir);

    // La subida: su precio en el explorador o su documento.
    fireEvent.click(within(tarjeta).getByRole("button", { name: /Importante: Sube Merluza/ }));
    fireEvent.click(screen.getByRole("button", { name: "Ver su precio en el explorador" }));
    expect(onExplorar).toHaveBeenCalledWith(expect.objectContaining({ medida: "precio", agrupar: "mes", filtros: expect.objectContaining({ productos: ["MERLUZA"], unidad: "kg" }) }));
    fireEvent.click(within(tarjeta).getByRole("button", { name: /Alerta 2/ }));
    fireEvent.click(screen.getByRole("button", { name: "Abrir el documento" }));
    expect(onIrA).toHaveBeenCalledWith("?tab=compras&modo=documentos&doc=2");
  });

  it("sin alertas no ocupa sitio", () => {
    const { container } = render(<RequiereAtencion alertas={[]} onIrA={vi.fn()} onExplorar={vi.fn()} />);
    expect(container.textContent).toBe("");
  });
});

describe("marcas en las gráficas", () => {
  it("la marca de un punto se toca y enseña sus alertas con su enlace", () => {
    const onIrA = vi.fn();
    render(<MarcaAlerta alertas={normalizarAlertas([alerta(1), alerta(2)])} etiqueta="octubre de 2026" onIrA={onIrA} />);
    const marca = screen.getByRole("button", { name: /2 alertas en octubre de 2026: Alerta 1 · Alerta 2/ });
    fireEvent.click(marca);
    expect(screen.getByText("Detalle 1")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Abrir el documento" })[1]);
    expect(onIrA).toHaveBeenCalledWith("?tab=compras&modo=documentos&doc=2");
  });

  it("«Gasto por mes» marca los meses con alerta (y no los demás)", () => {
    const meses = [
      { mes: "2026-09", casa_tomas: 1000, touza: 0, total: 1000, documentos: 10 },
      { mes: "2026-10", casa_tomas: 1200, touza: 0, total: 1200, documentos: 12 },
    ];
    render(
      conQuery(
        <GastoPorMesModulo
          meses={meses}
          periodo={{ desde: "2026-09-01", hasta: "2026-10-31" }}
          local={null}
          onDocumentos={vi.fn()}
          alertas={normalizarAlertas([alerta(1), { ...alerta(2, { tipo: "facturas_familia_gasto", titulo: "Congelados: +32 %" }), datos: { mes: "2026-09", desde: "2026-09-01", hasta: "2026-09-30", familia_id: 8 } }])}
        />,
      ),
    );
    expect(screen.getByRole("button", { name: /1 alerta en octubre.*2026: Alerta 1/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /1 alerta en septiembre.*2026: Congelados/i })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /alerta en/ })).toHaveLength(2);
  });

  it("«Lo que más ha subido» destaca lo que pasa del umbral y dice si tiene alerta", () => {
    const subida = (producto: string, variacion: number) => ({
      producto,
      nombre_normalizado: producto.toLowerCase(),
      unidad: "kg",
      proveedor_id: 5,
      proveedor: "MAYORISTA",
      precio_inicio: 10,
      precio_fin: 10 * (1 + variacion / 100),
      variacion_pct: variacion,
      compras_inicio: 2,
      compras_fin: 2,
      importe: 100,
    });
    render(
      conQuery(
        <LoQueMasHaSubido
          tamano="m"
          subidas={{ productos: [subida("Merluza", 30), subida("Aceite", 5)], tramoInicio: null, tramoFin: null, comparados: 2 }}
          acciones={() => []}
          umbralPct={10}
          alertas={normalizarAlertas([{ ...alerta(1, { tipo: "facturas_precio_sube", titulo: "Sube Merluza" }), datos: { proveedor_id: 5, nombre_normalizado: "merluza" } }])}
        />,
      ),
    );
    const filas = screen.getAllByRole("listitem");
    expect(filas[0].getAttribute("data-supera-umbral")).toBe("true");
    expect(filas[1].getAttribute("data-supera-umbral")).toBeNull();
    expect(within(filas[0]).getByRole("button").getAttribute("aria-label")).toMatch(/supera el umbral de alerta del 10 %; alerta: Sube Merluza/);
    expect(screen.getByText(/en ámbar, más del 10 %/)).toBeTruthy();
  });
});
