/**
 * Hoja de una mesa libre o prevista (10/11/2026, petición del dueño: «al hacer clic en la mesa tiene que ser
 * para sentar a alguien, con o sin reserva»): «Sentar a <prevista>», «Sentar sin reserva» y la lista.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({ puedeEditar: true, llamadas: [] as string[] }));

vi.mock("@/integrations/supabase/client");
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: (_seccion: string, tipo: string = "view") => ({ canAccess: tipo === "view" || h.puedeEditar, loading: false }),
}));
vi.mock("@/hooks/useAccionesServicioReserva", () => ({
  useAccionesServicioReserva: () => ({
    marcarLlegada: async (r: { id: string }) => {
      h.llamadas.push(`llegada:${r.id}`);
      return true;
    },
    marcarNoShow: async () => true,
    deshacerLlegadaONoShow: async () => true,
    moverEspacio: async (r: { id: string }, destino: string) => {
      h.llamadas.push(`mover:${r.id}:${destino}`);
      return true;
    },
  }),
}));
vi.mock("@/hooks/useMesaFijada", () => ({
  useFijarMesa: () => async (r: { id: string }, fijar: boolean) => {
    h.llamadas.push(`fijar:${r.id}:${fijar}`);
    return true;
  },
}));
vi.mock("@/hooks/useAccionesModoServicio", () => ({ useAccionesModoServicio: () => ({ liberarMesa: async () => true }) }));
vi.mock("@/hooks/useAsignacionesMesa", () => ({
  useAsignacionesMesa: () => ({ data: [] }),
  useAsignarMesasReserva: () => ({
    mutateAsync: async ({ reserva_id, mesa_ids }: { reserva_id: string; mesa_ids: string[] }) => {
      h.llamadas.push(`asignar:${reserva_id}:[${mesa_ids.join(",")}]`);
      return [];
    },
  }),
}));
vi.mock("@/hooks/useSentarSinReserva", () => ({
  useSentarSinReserva: () => ({
    mutateAsync: async ({ personas, mesa, nombre }: { personas: number; mesa: { id: string }; nombre?: string }) => {
      h.llamadas.push(`sinReserva:${personas}:${mesa.id}:${nombre ?? ""}`);
      return { id: "nueva", nombre: "Sin reserva 21:05", errorMesa: null };
    },
  }),
  deshacerSinReserva: vi.fn(),
}));

import { Sheet, SheetContent } from "@/components/ui/sheet";
import { PanelMesaLibre } from "@/components/reservas/movil/VistaHoyMovil";

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

const MESAS = [
  { id: "m3", nombre: "3", espacio_id: "s1", capacidad: 4, activa: true },
  { id: "m7", nombre: "7", espacio_id: "s1", capacidad: 4, activa: true },
  { id: "m9", nombre: "9", espacio_id: "s1", capacidad: 4, activa: true },
  { id: "t1", nombre: "T1", espacio_id: "s2", capacidad: 6, activa: true },
] as never[];
const SALAS = [
  { id: "s1", nombre: "Comedor" },
  { id: "s2", nombre: "Terraza" },
];

const asig = (mesa: string, reserva: string, nombre: string, hora: string, estado: string) => ({
  id: `${reserva}-${mesa}`,
  reserva_id: reserva,
  mesa_id: mesa,
  created_at: "x",
  reservas: { id: reserva, nombre, hora, numero_comensales: 2, estado, salida_at: null },
  mesas: { id: mesa, nombre: mesa.slice(1), capacidad: 4, espacio_id: "s1" },
});
const ASIGNACIONES = [asig("m7", "g", "García", "21:30:00", "confirmada"), asig("m9", "p", "Pérez", "20:30:00", "completada")] as never[];


const garcia = {
  id: "g",
  nombre: "García",
  hora: "21:30:00",
  numero_comensales: 2,
  estado: "confirmada",
  espacio_id: "s1",
  telefono: null,
  notas_cliente: null,
  llegada_at: null,
  salida_at: null,
} as never;
const ana = { ...(garcia as object), id: "r1", nombre: "Ana López", hora: "21:00:00" } as never;

const MESA3 = { id: "m3", nombre: "3", espacioId: "s1", salaNombre: "Comedor", plazas: 4 };
const MESA7 = { id: "m7", nombre: "7", espacioId: "s1", salaNombre: "Comedor", plazas: 4 };

function hoja(props: Partial<Parameters<typeof PanelMesaLibre>[0]> = {}) {
  return enHoja(
    <PanelMesaLibre
      mesa={MESA3}
      fecha="2026-11-07"
      turno="cena"
      reservas={[ana, garcia]}
      mesas={MESAS}
      asignaciones={ASIGNACIONES}
      minutoAhora={20 * 60 + 30}
      onCerrar={vi.fn()}
      {...props}
    />,
  );
}

beforeEach(() => {
  h.puedeEditar = true;
  h.llamadas = [];
});

describe("Tocar una mesa en turno es para SENTAR (10/11/2026)", () => {
  it("mesa libre: arriba «Sentar sin reserva» y debajo las reservas por llegar", () => {
    hoja();
    expect(screen.getByRole("heading", { name: "Mesa 3 · Comedor" })).toBeInTheDocument();
    const sin = screen.getByRole("button", { name: "Sentar sin reserva" });
    const lista = screen.getByRole("region", { name: "Sentar una reserva" });
    expect(sin.compareDocumentPosition(lista) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(lista).getByRole("button", { name: /Ana López/ })).toBeInTheDocument();
    expect(screen.queryByTestId("sentar-prevista")).toBeNull();
  });

  it("sin reserva: de 1 a 12, nombre opcional, y sienta en ESTA mesa sin preguntar si caben", async () => {
    hoja();
    fireEvent.click(screen.getByRole("button", { name: "Sentar sin reserva" }));
    const caja = screen.getByTestId("sin-reserva-mesa");
    expect(within(caja).getAllByRole("button", { pressed: false }).map((b) => b.textContent)).toEqual(
      ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"],
    );
    expect(within(caja).getByRole("button", { name: "Elige cuántos son" })).toBeDisabled();
    fireEvent.click(within(caja).getByRole("button", { name: "3" }));
    fireEvent.change(within(caja).getByRole("textbox", { name: "Nombre (opcional)" }), { target: { value: "Paco" } });
    fireEvent.click(within(caja).getByRole("button", { name: "Sentar 3 en mesa 3" }));
    await waitFor(() => expect(h.llamadas).toEqual(["sinReserva:3:m3:Paco"]));
  });

  it("sin reserva con más gente que plazas (campo libre): avisa antes de sentar", async () => {
    hoja();
    fireEvent.click(screen.getByRole("button", { name: "Sentar sin reserva" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Número de personas" }), { target: { value: "14" } });
    fireEvent.click(screen.getByRole("button", { name: "Sentar 14 en mesa 3" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Son 14 y la mesa 3 es de 4.");
    expect(h.llamadas).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Sentar igualmente" }));
    await waitFor(() => expect(h.llamadas).toEqual(["sinReserva:14:m3:"]));
  });

  it("mesa prevista: lo primero «Sentar a García» (llegó); después sin reserva y otra reserva", async () => {
    hoja({ mesa: MESA7, prevista: { reservaId: "g", nombre: "García", hora: "21:30:00" } });
    const prevista = screen.getByTestId("sentar-prevista");
    expect(prevista).toHaveTextContent("Sentar a García");
    expect(prevista.compareDocumentPosition(screen.getByRole("button", { name: "Sentar sin reserva" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const otra = screen.getByRole("region", { name: "Sentar una reserva" });
    expect(within(otra).getByText("Otra reserva")).toBeInTheDocument();
    // García no se repite en la lista.
    expect(within(otra).queryByRole("button", { name: /García/ })).toBeNull();
    fireEvent.click(prevista);
    await waitFor(() => expect(h.llamadas).toEqual(["asignar:g:[m7]", "llegada:g"]));
  });

  it("con solo «Ver» no hay nada para sentar", () => {
    h.puedeEditar = false;
    hoja({ mesa: MESA7, prevista: { reservaId: "g", nombre: "García", hora: "21:30:00" } });
    expect(screen.queryByTestId("sentar-prevista")).toBeNull();
    expect(screen.queryByRole("button", { name: "Sentar sin reserva" })).toBeNull();
  });
});
