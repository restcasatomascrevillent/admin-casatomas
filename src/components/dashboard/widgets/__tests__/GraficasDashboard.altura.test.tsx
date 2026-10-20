/**
 * Gráficas del Dashboard («Reservas por Día» y «Curva de Reservas por Hora») a la ALTURA QUE LES DEJA EL DASHBOARD
 * (06/10/2026: el Dashboard ocupa el alto de la pantalla sin scroll). Antes cada una dibujaba 250 px fijos y, con
 * «Reservas de Hoy» encima, se salían por abajo (147 px a 1280×711, la ventana del dueño). Ahora:
 *   · la tarjeta llena su hueco (`h-full`, columna flex) y la gráfica se queda con lo que hay bajo el título
 *     (`flex-1`, con un mínimo para que se lea), en una capa absoluta: el ResponsiveContainer mide el hueco al
 *     100 % × 100 % y no su propio contenido;
 *   · el título es pequeño y comparte fila con la leyenda (la curva no tenía leyenda: dos líneas sin nombre);
 *   · si la consulta falla, el aviso de error también ocupa el hueco.
 * jsdom no calcula layout: se comprueba la estructura; los píxeles, con el arnés de capturas.
 */
import type { ComponentType } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { DashboardProvider } from "@/contexts/DashboardContext";

const h = vi.hoisted(() => ({ reservas: [] as Array<Record<string, unknown>>, error: false }));

vi.mock("@/hooks/useDashboardStats", () => ({
  useDashboardStats: () => ({
    data: h.error ? undefined : { reservas: h.reservas },
    isError: h.error,
    error: h.error ? new Error("sin conexión") : null,
    refetch: vi.fn(),
  }),
  useTodayConfirmedReservations: () => ({
    data: h.error ? undefined : h.reservas,
    isError: h.error,
    error: h.error ? new Error("sin conexión") : null,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/useSalasPrivadas", () => ({ useIdsSalasPrivadas: () => [] }));

import { GraficoReservasPorDia } from "@/components/dashboard/widgets/GraficoReservasPorDia";
import { CurvaReservasPorHora } from "@/components/dashboard/widgets/CurvaReservasPorHora";

const reserva = (fecha: string, hora: string, pax: number) => ({
  id: `${fecha}-${hora}-${pax}`,
  fecha,
  hora,
  numero_comensales: pax,
  estado: "confirmada",
  espacio_id: null,
  marca: "casa_tomas",
});

beforeEach(() => {
  h.error = false;
  const hoy = new Date();
  const dia = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`;
  h.reservas = [reserva(dia, "14:00:00", 4), reserva(dia, "21:00:00", 2), reserva(dia, "21:00:00", 6)];
});

const GRAFICAS: Array<[string, ComponentType]> = [
  ["Reservas por Día", GraficoReservasPorDia],
  ["Curva de Reservas por Hora", CurvaReservasPorHora],
];

function montar(Grafica: ComponentType) {
  return render(
    <DashboardProvider>
      <div data-testid="hueco" style={{ height: 400 }}>
        <Grafica />
      </div>
    </DashboardProvider>,
  );
}

describe("Gráficas del Dashboard · llenan el hueco que les toca", () => {
  it.each(GRAFICAS)("«%s»: la tarjeta ocupa todo el hueco y la gráfica todo lo que queda bajo el título, al 100 %", (titulo, Grafica) => {
    montar(Grafica);
    const tarjeta = screen.getByTestId("hueco").firstElementChild as HTMLElement;

    expect(tarjeta).toHaveClass("h-full", "flex", "flex-col");
    // Debajo de la cabecera (con el título), la zona de la gráfica: se estira y tiene un mínimo legible.
    const [cabecera, zona] = [...tarjeta.children] as HTMLElement[];
    expect(within(cabecera).getByText(titulo)).toBeInTheDocument();
    expect(zona).toHaveClass("relative", "flex-1");
    expect(zona.className).toMatch(/min-h-\[\d+px\]/);
    // La gráfica, en una capa absoluta que ocupa la zona, y el ResponsiveContainer al 100 % de ella (antes, 250 px).
    const capa = within(zona).getByTestId("area-grafica");
    expect(capa).toHaveClass("absolute");
    const contenedor = capa.querySelector(".recharts-responsive-container") as HTMLElement;
    expect(contenedor).not.toBeNull();
    expect(contenedor.style.width).toBe("100%");
    expect(contenedor.style.height).toBe("100%");
  });

  it("la curva lleva su leyenda (Reservas y Comensales) en la misma fila que el título, no debajo", () => {
    montar(GRAFICAS[1][1]);
    const titulo = screen.getByText("Curva de Reservas por Hora");
    const cabecera = titulo.parentElement as HTMLElement;

    const leyenda = within(cabecera).getByRole("list", { name: "Leyenda" });
    expect(within(leyenda).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Reservas", "Comensales"]);
    expect(cabecera).toHaveClass("flex-row", "items-center");
    expect(titulo).toHaveClass("text-sm");
  });

  it.each(GRAFICAS)("«%s»: si la consulta falla, el aviso de error también llena el hueco", (_titulo, Grafica) => {
    h.error = true;
    montar(Grafica);

    expect(screen.getByText(/No se han podido cargar/)).toBeInTheDocument();
    expect(screen.getByTestId("hueco").firstElementChild).toHaveClass("h-full");
  });
});
