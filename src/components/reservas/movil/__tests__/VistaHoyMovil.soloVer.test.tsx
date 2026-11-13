/**
 * Hoy en móvil con solo «Ver» en Reservas (06/11/2026, decisión del dueño): las fichas de una reserva y de una
 * mesa libre enseñan los datos (y «Llamar») pero ningún botón que escriba: se ocultan, no se desactivan. Con
 * «Editar» (o siendo super admin) siguen todos.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({ puedeEditar: true, escrituras: [] as string[] }));

vi.mock("@/integrations/supabase/client");
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: (_seccion: string, tipo: string = "view") => ({ canAccess: tipo === "view" || h.puedeEditar, loading: false }),
}));
const anota = (nombre: string) => async () => {
  h.escrituras.push(nombre);
  return true;
};
vi.mock("@/hooks/useAccionesServicioReserva", () => ({
  useAccionesServicioReserva: () => ({
    marcarLlegada: anota("marcarLlegada"),
    marcarNoShow: anota("marcarNoShow"),
    deshacerLlegadaONoShow: anota("deshacer"),
    moverEspacio: anota("moverEspacio"),
  }),
}));
vi.mock("@/hooks/useAccionesModoServicio", () => ({ useAccionesModoServicio: () => ({ liberarMesa: anota("liberarMesa") }) }));
vi.mock("@/hooks/useAsignacionesMesa", () => ({
  useAsignacionesMesa: () => ({ data: [] }),
  useAsignarMesasReserva: () => ({ mutateAsync: anota("asignar") }),
}));
vi.mock("@/hooks/useSentarSinReserva", () => ({
  useSentarSinReserva: () => ({ mutateAsync: anota("sinReserva") }),
  deshacerSinReserva: vi.fn(),
}));

import { Sheet, SheetContent } from "@/components/ui/sheet";
import { PanelMesaLibre, PanelReservaMovil } from "@/components/reservas/movil/VistaHoyMovil";
import { configServicioSalaDesde } from "@/lib/reservas/servicioSala";

function enHoja(contenido: ReactNode) {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={cliente}>
      <Sheet open>
        <SheetContent side="bottom">{contenido}</SheetContent>
      </Sheet>
    </QueryClientProvider>,
  );
}

const reserva = (estado: string, extra: Record<string, unknown> = {}) =>
  ({
    id: "r1",
    nombre: "Ana López",
    hora: "21:00:00",
    numero_comensales: 2,
    estado,
    espacio_id: "s1",
    telefono: "+34618190432",
    notas_cliente: "Trona",
    llegada_at: null,
    salida_at: null,
    ...extra,
  }) as never;

const panelReserva = (estado: string, nombresMesa: string[] = []) =>
  enHoja(
    <PanelReservaMovil
      reserva={reserva(estado)}
      fecha="2026-11-06"
      salas={[{ id: "s1", nombre: "Comedor" }]}
      mesas={[{ id: "m3", nombre: "3", espacio_id: "s1", capacidad: 4, activa: true } as never]}
      asignaciones={[]}
      ajustesDia={[]}
      mesasExcluidas={[]}
      configOcupacion={configServicioSalaDesde(undefined)}
      nombresMesa={nombresMesa}
      onCerrar={vi.fn()}
    />,
  );

const MESA_LIBRE = { id: "m3", nombre: "3", espacioId: "s1", salaNombre: "Comedor", plazas: 4 };
const panelMesaLibre = () =>
  enHoja(
    <PanelMesaLibre mesa={MESA_LIBRE} fecha="2026-11-06" turno="cena" reservas={[reserva("confirmada")]} minutoAhora={21 * 60} onCerrar={vi.fn()} />,
  );

/** Nombres de los botones de la hoja, sin la X de la propia hoja («Cerrar panel»). */
const botones = () =>
  within(screen.getByRole("dialog"))
    .queryAllByRole("button")
    .map((b) => b.textContent?.trim() ?? "")
    .filter((t) => t && t !== "Cerrar panel");

beforeEach(() => {
  h.puedeEditar = true;
  h.escrituras = [];
});

describe("Ficha de una reserva (móvil)", () => {
  it("con «Editar»: sentar, cambiar mesa y «No vino»", () => {
    panelReserva("confirmada", ["3"]);
    expect(botones()).toEqual(expect.arrayContaining(["Sentar en mesa 3", "Cambiar mesa", "No vino", "Cerrar"]));
  });

  it("«Anular mesa» (13/11/2026): pide confirmación y deja la reserva sin mesa", async () => {
    panelReserva("confirmada", ["3"]);
    fireEvent.click(screen.getByTestId("ficha-anular-mesa"));
    expect(screen.getByRole("alert")).toHaveTextContent("Se libera mesa 3");
    expect(h.escrituras).toEqual([]);
    fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "Anular mesa" }));
    await waitFor(() => expect(h.escrituras).toEqual(["asignar"]));
  });

  it("con solo «Ver»: datos, nota y «Llamar», pero ningún botón que escriba", () => {
    h.puedeEditar = false;
    panelReserva("confirmada", ["3"]);
    const hoja = within(screen.getByRole("dialog"));
    expect(hoja.getByText("Ana López")).toBeInTheDocument();
    expect(hoja.getByText("Trona")).toBeInTheDocument();
    expect(hoja.getByRole("link", { name: /Llamar/ })).toHaveAttribute("href", "tel:+34618190432");
    expect(botones()).toEqual(["Cerrar"]);
  });

  it("con solo «Ver», una reserva sin mesa tampoco abre «Elegir mesa» ni las mesas libres", () => {
    h.puedeEditar = false;
    panelReserva("pendiente");
    expect(botones()).toEqual(["Cerrar"]);
    expect(screen.queryByText(/Mesa 3/)).toBeNull();
  });

  it("con solo «Ver», una reserva que ya llegó no ofrece liberar, cambiar ni deshacer", () => {
    h.puedeEditar = false;
    panelReserva("completada", ["3"]);
    expect(botones()).toEqual(["Cerrar"]);
    expect(h.escrituras).toEqual([]);
  });
});

describe("Ficha de una mesa libre (móvil)", () => {
  it("con «Editar»: «Sentar sin reserva» y sentar una reserva", () => {
    panelMesaLibre();
    expect(screen.getByRole("button", { name: "Sentar sin reserva" })).toBeInTheDocument();
    expect(screen.getByText("Sentar una reserva")).toBeInTheDocument();
  });

  it("con solo «Ver»: solo «Libre · 4 plazas» y «Cerrar»", () => {
    h.puedeEditar = false;
    panelMesaLibre();
    expect(screen.getByText("Libre · 4 plazas")).toBeInTheDocument();
    expect(screen.queryByText(/Sentar/)).toBeNull();
    expect(botones()).toEqual(["Cerrar"]);
  });
});
