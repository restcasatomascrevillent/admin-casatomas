/**
 * Reservas con solo «Ver» (06/11/2026, decisión del dueño): lo que escribe se OCULTA (no se desactiva) en las
 * piezas que no tienen test propio de permisos: la lista negra, las piezas de una mesa y los botones «Sin
 * reserva» y «Organizar» (que se ocultan solos, estén donde estén). Con «Editar», o siendo super admin, salen.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({ puedeEditar: true }));

vi.mock("@/integrations/supabase/client");
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: (_seccion: string, tipo: string = "view") => ({ canAccess: tipo === "view" || h.puedeEditar, loading: false }),
}));
vi.mock("@/hooks/useBlacklist", () => ({
  useBlacklist: () => ({
    data: [
      { id: "b1", tipo: "email", valor: "malo@example.com", nombre: "Pepe", motivo: "No vino 3 veces", created_at: "2026-10-01T10:00:00Z", caduca_el: null, aprobada_en: null },
    ],
    isLoading: false,
  }),
  useCrearBlacklist: () => ({ mutateAsync: vi.fn() }),
  useActualizarBlacklist: () => ({ mutateAsync: vi.fn() }),
  useEliminarBlacklist: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/components/reservas/SugerenciasBlacklist", () => ({ SugerenciasBlacklist: () => null }));

import { GestionBlacklist } from "@/components/reservas/GestionBlacklist";
import { PanelPiezasMesa } from "@/components/reservas/PiezasMesa";
import { BotonSentarSinReserva } from "@/components/reservas/SentarSinReserva";
import { BotonOrganizarServicio } from "@/components/reservas/OrganizarServicio";
import { estadoServicio, type MesaPiezas } from "@/lib/reservas/piezasMesa";

const conCliente = (contenido: ReactNode) =>
  render(<QueryClientProvider client={new QueryClient()}>{contenido}</QueryClientProvider>);

beforeEach(() => {
  h.puedeEditar = true;
});

describe("Blacklist", () => {
  it("con «Editar»: «Añadir», y editar y eliminar en cada entrada", () => {
    conCliente(<GestionBlacklist />);
    expect(screen.getByRole("button", { name: /Añadir/ })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Editar la entrada malo@example.com" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Eliminar malo@example.com de la lista negra" }).length).toBeGreaterThan(0);
  });

  it("con solo «Ver»: la lista se ve, sin «Añadir», sin editar ni eliminar, y sin columna «Acciones»", () => {
    h.puedeEditar = false;
    conCliente(<GestionBlacklist />);
    expect(screen.getAllByText("malo@example.com").length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(screen.queryByRole("columnheader", { name: "Acciones" })).toBeNull();
    expect(screen.getByText("Emails y teléfonos bloqueados para reservas")).toBeInTheDocument();
  });
});

describe("Piezas de una mesa (`PanelPiezasMesa`)", () => {
  const MESA: MesaPiezas = { id: "m1", nombre: "1", piezas: 2, picos: 0, picosMax: 2, piezasMax: 4, grupo: "g", redonda: false, x: 1, y: 1 };
  const OTRA: MesaPiezas = { ...MESA, id: "m2", nombre: "2", x: 2 };
  const pintar = (soloLectura: boolean) =>
    render(
      <PanelPiezasMesa
        mesa={MESA}
        mesas={[MESA, OTRA]}
        estado={estadoServicio([MESA, OTRA], [])}
        reservas={[]}
        hayServicio
        turno="cena"
        ocupado={false}
        soloLectura={soloLectura}
        onGuardar={vi.fn()}
        onProponer={vi.fn()}
      />,
    );

  it("con «Editar»: pico, mesa en fila, juntar y separar", () => {
    pintar(false);
    for (const nombre of [/Pico/, /Mesa en fila/, /Juntar con/, /Separar/]) {
      expect(screen.getByRole("button", { name: nombre })).toBeInTheDocument();
    }
  });

  it("con solo «Ver»: cómo está la mesa (piezas y plazas), sin ningún botón", () => {
    pintar(true);
    expect(screen.getByText(/2 piezas · \d+ plazas/)).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toEqual([]);
  });

  it("un sitio de terraza con solo «Ver»: sus plazas, sin «+» ni «−»", () => {
    const SITIO: MesaPiezas = { ...MESA, id: "t1", nombre: "T1", piezas: 1, picosMax: 0, piezasMax: 1, sitio: { plazas: 4, min: 2, max: 6 } };
    render(
      <PanelPiezasMesa mesa={SITIO} mesas={[SITIO]} estado={estadoServicio([SITIO], [])} reservas={[]} hayServicio turno="cena" ocupado={false} soloLectura onGuardar={vi.fn()} onProponer={vi.fn()} />,
    );
    expect(screen.getByText("4 plazas")).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toEqual([]);
  });
});

describe("«Sin reserva» y «Organizar» se ocultan solos", () => {
  it("con «Editar» están", () => {
    conCliente(
      <>
        <BotonSentarSinReserva />
        <BotonOrganizarServicio fecha="2026-11-06" turno="cena" />
      </>,
    );
    expect(screen.getByRole("button", { name: /Sin reserva/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Organizar/ })).toBeInTheDocument();
  });

  it("con solo «Ver» no existen", () => {
    h.puedeEditar = false;
    const { container } = conCliente(
      <div data-testid="caja">
        <BotonSentarSinReserva />
        <BotonOrganizarServicio fecha="2026-11-06" turno="cena" />
      </div>,
    );
    expect(within(container).getByTestId("caja")).toBeEmptyDOMElement();
  });
});
