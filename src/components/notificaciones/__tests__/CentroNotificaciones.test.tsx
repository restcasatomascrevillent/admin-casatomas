// La campana: abrir un aviso lo da por revisado, salvo una «Reserva nueva» (24/11/2026, dueño: «¿por qué la
// reserva se ha quitado de avisos si aún sigue pendiente?»). Mirarla no es responderla.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const h = vi.hoisted(() => ({
  notificaciones: [] as Array<Record<string, unknown>>,
  marcarLeida: vi.fn(),
  abrirAviso: vi.fn(),
}));

vi.mock("@/hooks/useNotificacionesDashboard", () => ({
  useNotificacionesDashboard: () => ({
    notificaciones: h.notificaciones,
    countNoLeidas: h.notificaciones.length,
    marcarLeida: h.marcarLeida,
    marcarTodasLeidas: vi.fn(),
    eliminarNotificacion: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAbrirAviso", () => ({
  useAbrirAviso: () => ({ abrirAviso: h.abrirAviso, dialogoAviso: null }),
}));
vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: () => ({ canAccess: false, loading: false }),
}));
vi.mock("@/hooks/useReservasPorGestionar", () => ({
  useReservasPorGestionar: () => ({ items: [], count: 0, loading: false, listo: true }),
}));
vi.mock("@/hooks/useAvisosEnVivo", () => ({
  useEstadoAvisosEnVivo: () => ({ sinVer: 0 }),
}));
vi.mock("@/components/notificaciones/AvisosEnVivo", () => ({
  AjustesAvisosEnVivo: () => null,
}));
vi.mock("@/components/instagram/tapas/AvisoStoryTapas", () => ({
  AccionesAvisoStoryTapas: () => null,
  datosAvisoStoryTapas: () => null,
}));

import { CentroNotificaciones } from "../CentroNotificaciones";

const aviso = (extra: Record<string, unknown> = {}) => ({
  id: "n1",
  tipo: "sistema",
  titulo: "Aviso 1",
  mensaje: null,
  referencia_id: null,
  referencia_tipo: null,
  leida: false,
  created_at: new Date().toISOString(),
  ...extra,
});

const abrirCampana = () => {
  render(
    <MemoryRouter>
      <CentroNotificaciones />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: /pendientes de gestionar o sin leer/ }));
};

beforeEach(() => {
  h.notificaciones = [];
  h.marcarLeida.mockClear();
  h.abrirAviso.mockClear();
});

describe("CentroNotificaciones: abrir un aviso", () => {
  it("ver una «Reserva nueva» la abre pero no la da por revisada", async () => {
    h.notificaciones = [aviso({ tipo: "reserva_nueva", titulo: "Reserva nueva", referencia_tipo: "reserva", referencia_id: "res-1" })];
    abrirCampana();
    fireEvent.click(await screen.findByText("Reserva nueva"));
    expect(h.abrirAviso).toHaveBeenCalledWith(expect.objectContaining({ id: "n1" }));
    expect(h.marcarLeida).not.toHaveBeenCalled();
  });

  it("«Marcar como leída» sigue cerrando a mano una «Reserva nueva»", async () => {
    h.notificaciones = [aviso({ tipo: "reserva_nueva", titulo: "Reserva nueva", referencia_tipo: "reserva", referencia_id: "res-1" })];
    abrirCampana();
    fireEvent.click(await screen.findByRole("button", { name: "Marcar como leída" }));
    expect(h.marcarLeida).toHaveBeenCalledWith("n1");
    expect(h.abrirAviso).not.toHaveBeenCalled();
  });

  it.each([
    ["una reserva cancelada", { tipo: "reserva_cancelada", referencia_tipo: "reserva", referencia_id: "res-1" }],
    ["un aviso de facturas", { tipo: "facturas_subida", referencia_tipo: "facturas_cargar" }],
  ])("ver %s sí lo da por revisado", async (_nombre, extra) => {
    h.notificaciones = [aviso(extra)];
    abrirCampana();
    fireEvent.click(await screen.findByText("Aviso 1"));
    expect(h.marcarLeida).toHaveBeenCalledWith("n1");
    expect(h.abrirAviso).toHaveBeenCalled();
  });
});
