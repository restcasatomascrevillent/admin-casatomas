/**
 * Hoy en móvil: confirmar la mesa REAL al sentar (07/11/2026, idea del dueño: la mesa asignada es solo la
 * previsión). El selector enseña las mesas de todas las salas donde cabe, libre / prevista para otra
 * reserva / ocupada por alguien sentado. Elegir una prevista para otra pide confirmación en la propia ficha
 * y, al aceptar, primero le quita esa mesa a la otra reserva y después sienta a la actual.
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
    mutateAsync: async ({ personas, mesa }: { personas: number; mesa: { id: string } }) => {
      h.llamadas.push(`sinReserva:${personas}:${mesa.id}`);
      return { id: "nueva", nombre: "Sin reserva 21:05", errorMesa: null };
    },
  }),
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

const ana = {
  id: "r1",
  nombre: "Ana López",
  hora: "21:00:00",
  numero_comensales: 2,
  estado: "confirmada",
  espacio_id: "s1",
  telefono: null,
  notas_cliente: null,
  llegada_at: null,
  salida_at: null,
} as never;

const fichaAna = () =>
  enHoja(
    <PanelReservaMovil
      reserva={ana}
      fecha="2026-11-07"
      salas={SALAS}
      mesas={MESAS}
      asignaciones={ASIGNACIONES}
      ajustesDia={[]}
      mesasExcluidas={[]}
      configOcupacion={configServicioSalaDesde(undefined)}
      nombresMesa={[]}
      onCerrar={vi.fn()}
    />,
  );

beforeEach(() => {
  h.puedeEditar = true;
  h.llamadas = [];
});

describe("Selector de mesa al sentar (móvil)", () => {
  it("enseña las mesas de todas las salas donde cabe, con su estado; la ocupada no se puede pulsar", () => {
    fichaAna();
    const selector = within(screen.getByTestId("selector-mesa"));
    expect(selector.getByRole("region", { name: "Comedor" })).toBeInTheDocument();
    expect(selector.getByRole("region", { name: "Terraza" })).toBeInTheDocument();
    expect(selector.getByRole("button", { name: /Mesa 3, .*Libre/ })).toBeEnabled();
    expect(selector.getByRole("button", { name: /Mesa 7, .*Prevista: García 21:30/ })).toBeEnabled();
    expect(selector.getByRole("button", { name: /Mesa 9, .*Ocupada · Pérez/ })).toBeDisabled();
  });

  it("una mesa libre: la da y sienta sin preguntar", async () => {
    fichaAna();
    fireEvent.click(screen.getByRole("button", { name: /Mesa 3, / }));
    await waitFor(() => expect(h.llamadas).toEqual(["asignar:r1:[m3]", "llegada:r1"]));
  });

  it("prevista para otra: avisa en la ficha y, con «Sentar igualmente», primero pasa a García a otra mesa libre", async () => {
    fichaAna();
    fireEvent.click(screen.getByRole("button", { name: /Mesa 7, / }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "La mesa 7 estaba prevista para García (21:30). García pasa a la mesa 3.",
    );
    expect(h.llamadas).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Sentar igualmente" }));
    await waitFor(() => expect(h.llamadas).toEqual(["asignar:g:[m3]", "asignar:r1:[m7]", "llegada:r1"]));
  });

  it("«Cancelar» no escribe nada y vuelve al selector", () => {
    fichaAna();
    fireEvent.click(screen.getByRole("button", { name: /Mesa 7, / }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.getByTestId("selector-mesa")).toBeInTheDocument();
    expect(h.llamadas).toEqual([]);
  });

  it("una mesa de otra sala: primero la cambia de sala", async () => {
    fichaAna();
    fireEvent.click(screen.getByRole("button", { name: /Mesa T1, / }));
    await waitFor(() => expect(h.llamadas).toEqual(["mover:r1:s2", "asignar:r1:[t1]", "llegada:r1"]));
  });

  it("con solo «Ver» no hay selector", () => {
    h.puedeEditar = false;
    fichaAna();
    expect(screen.queryByTestId("selector-mesa")).toBeNull();
  });
});

describe("«Sentar · Mesa 3» de la fila comprueba la prevista (ficha con `inicio`)", () => {
  const fichaConPrevista = (asignaciones: never[], inicio: "elegir" | "confirmar") =>
    enHoja(
      <PanelReservaMovil
        reserva={ana}
        fecha="2026-11-07"
        salas={SALAS}
        mesas={MESAS}
        asignaciones={asignaciones}
        ajustesDia={[]}
        mesasExcluidas={[]}
        configOcupacion={configServicioSalaDesde(undefined)}
        nombresMesa={["3"]}
        inicio={inicio}
        onCerrar={vi.fn()}
      />,
    );

  it("ocupada por alguien sentado: abre el selector con su mesa marcada ocupada", () => {
    fichaConPrevista(
      [asig("m3", "r1", "Ana López", "21:00:00", "confirmada"), asig("m3", "p", "Pérez", "20:30:00", "completada")] as never[],
      "elegir",
    );
    const selector = within(screen.getByTestId("selector-mesa"));
    expect(selector.getByRole("button", { name: /Mesa 3, .*Ocupada · Pérez/ })).toBeDisabled();
  });

  it("pisada por otra reserva por llegar: confirmación en la ficha; al aceptar la pasa a otra libre y sienta en la suya", async () => {
    fichaConPrevista(
      [asig("m3", "r1", "Ana López", "21:00:00", "confirmada"), asig("m3", "g", "García", "21:30:00", "confirmada")] as never[],
      "confirmar",
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("La mesa 3 estaba prevista para García (21:30). García pasa a la mesa 7.");
    fireEvent.click(screen.getByRole("button", { name: "Sentar igualmente" }));
    await waitFor(() => expect(h.llamadas).toEqual(["asignar:g:[m7]", "llegada:r1"]));
  });
});

describe("Sin reserva en una mesa prevista para otro (móvil)", () => {
  it("avisa y, al aceptar, le quita la mesa a García antes de sentar", async () => {
    // A las 21:05 una mesa prevista para las 21:30 se pisa con quien entra ahora.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 10, 7, 21, 5));
    try {
      enHoja(
        <PanelMesaLibre
          mesa={{ id: "m7", nombre: "7", espacioId: "s1", salaNombre: "Comedor", plazas: 4 }}
          prevista={{ reservaId: "g", nombre: "García", hora: "21:30:00" }}
          fecha="2026-11-07"
          turno="cena"
          reservas={[]}
          mesas={MESAS}
          asignaciones={ASIGNACIONES}
          minutoAhora={21 * 60 + 5}
          onCerrar={vi.fn()}
        />,
      );
      expect(screen.getByText("Prevista para García (21:30) · 4 plazas")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "2" }));
      expect(screen.getByRole("alert")).toHaveTextContent("García se quedará sin mesa prevista.");
      fireEvent.click(screen.getByRole("button", { name: "Sentar igualmente" }));
      await waitFor(() => expect(h.llamadas).toEqual(["asignar:g:[]", "sinReserva:2:m7"]));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Mesa fijada y recolocar al sentar (07/11/2026)", () => {
  const conFijada = () => ({
    ...asig("m7", "g", "García", "21:30:00", "confirmada"),
    reservas: { id: "g", nombre: "García", hora: "21:30:00", numero_comensales: 2, estado: "confirmada", salida_at: null, mesa_fijada: true },
  });

  it("una mesa fijada para otra sale con «Fijada · García 21:30» y no se puede pulsar", () => {
    enHoja(
      <PanelReservaMovil
        reserva={ana}
        fecha="2026-11-07"
        salas={SALAS}
        mesas={MESAS}
        asignaciones={[conFijada(), asig("m9", "p", "Pérez", "20:30:00", "completada")] as never[]}
        ajustesDia={[]}
        mesasExcluidas={[]}
        configOcupacion={configServicioSalaDesde(undefined)}
        nombresMesa={[]}
        onCerrar={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /Mesa 7, .*Fijada · García 21:30/ })).toBeDisabled();
  });

  it("si la propia reserva tiene la mesa fijada, cambiarla pide confirmación y quita la fijación", async () => {
    const anaFijada = { ...(ana as object), mesa_fijada: true } as never;
    enHoja(
      <PanelReservaMovil
        reserva={anaFijada}
        fecha="2026-11-07"
        salas={SALAS}
        mesas={MESAS}
        asignaciones={[asig("m3", "r1", "Ana López", "21:00:00", "confirmada")] as never[]}
        ajustesDia={[]}
        mesasExcluidas={[]}
        configOcupacion={configServicioSalaDesde(undefined)}
        nombresMesa={["3"]}
        inicio="elegir"
        onCerrar={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Mesa 7, / }));
    expect(screen.getByRole("alert")).toHaveTextContent("Esta reserva tiene la mesa fijada. ¿Cambiarla igualmente?");
    expect(h.llamadas).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Cambiar igualmente" }));
    await waitFor(() => expect(h.llamadas).toEqual(["asignar:r1:[m7]", "fijar:r1:false", "llegada:r1"]));
  });

  it("sin reserva en una mesa fijada para otro: no deja sentar", () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 10, 7, 21, 5));
    try {
      enHoja(
        <PanelMesaLibre
          mesa={{ id: "m7", nombre: "7", espacioId: "s1", salaNombre: "Comedor", plazas: 4 }}
          prevista={{ reservaId: "g", nombre: "García", hora: "21:30:00", fijada: true }}
          fecha="2026-11-07"
          turno="cena"
          reservas={[]}
          mesas={MESAS}
          asignaciones={[conFijada()] as never[]}
          minutoAhora={21 * 60 + 5}
          onCerrar={vi.fn()}
        />,
      );
      expect(screen.getByText(/Mesa fijada para García \(21:30\)/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "2" })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("sin reserva con las salas: a García se le busca otra mesa y, si no hay, se dice", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 10, 7, 21, 5));
    try {
      enHoja(
        <PanelMesaLibre
          mesa={{ id: "m7", nombre: "7", espacioId: "s1", salaNombre: "Comedor", plazas: 4 }}
          prevista={{ reservaId: "g", nombre: "García", hora: "21:30:00" }}
          fecha="2026-11-07"
          turno="cena"
          reservas={[]}
          mesas={MESAS}
          asignaciones={ASIGNACIONES}
          salas={SALAS}
          mesasExcluidas={["m3"]}
          minutoAhora={21 * 60 + 5}
          onCerrar={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "2" }));
      expect(screen.getByRole("alert")).toHaveTextContent("García se queda sin mesa: no hay ninguna libre.");
      fireEvent.click(screen.getByRole("button", { name: "Sentar igualmente" }));
      await waitFor(() => expect(h.llamadas).toEqual(["asignar:g:[]", "sinReserva:2:m7"]));
    } finally {
      vi.useRealTimers();
    }
  });
});
