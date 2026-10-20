/**
 * Kanban de «Hoy» SIN realtime (2026-10-01: `reservas` no estaba en la publicación
 * `supabase_realtime` y el kanban no tenía ni suscripción ni refresco: solo se ponía al día al
 * volver a la pestaña). Ahora relee sus reservas y sus mesas cada minuto mientras la pestaña está
 * a la vista (`REFRESCO_PERIODICO`); los cambios en vivo le llegan por `useReservasEnVivo`, que
 * monta `VistaHoy` (ver VistaHoy.test.tsx y useReservasEnVivo.test.tsx).
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { format } from "date-fns";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.neq = () => b;
      b.order = () => b;
      b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve({
          data: [
            {
              id: "ct1",
              nombre: "Ana Casa",
              telefono: null,
              email: null,
              hora: "21:00:00",
              numero_comensales: 4,
              estado: "confirmada",
              espacio_id: null,
              marca: "casa_tomas",
              canal: "web",
              importante: false,
              en_blacklist: false,
            },
          ],
          error: null,
        }).then(ok, ko);
      return b;
    },
  },
}));
vi.mock("@/hooks/useEspaciosReserva", () => ({
  useEspaciosReserva: () => ({
    data: [{ id: "ct-comedor", nombre: "Comedor", capacidad_maxima: 50, activa: true, caracteristicas: {} }],
  }),
}));
vi.mock("@/hooks/useAsignacionesMesa", () => ({ useAsignacionesMesa: vi.fn(() => ({ data: [] })) }));
vi.mock("@/hooks/useUserRole", () => ({ useCanAccessSection: () => ({ canAccess: true, loading: false }) }));
vi.mock("@/hooks/useEdicionReserva", () => ({ useEdicionReserva: () => ({ editarReserva: vi.fn(), dialogoEdicion: null }) }));
vi.mock("@/components/reservas/BlacklistModal", () => ({ BlacklistModal: () => null }));
vi.mock("@/components/reservas/ControlLlegada", () => ({ ControlLlegada: () => null }));
vi.mock("@/components/reservas/ElegirMesaDialog", () => ({ ElegirMesaDialog: () => null }));

import { GestorReservasKanban } from "@/components/reservas/GestorReservasKanban";
import { useAsignacionesMesa } from "@/hooks/useAsignacionesMesa";
import { REFRESCO_PERIODICO } from "@/lib/realtimeCanal";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

describe("GestorReservasKanban · respaldo sin realtime", () => {
  it("relee las reservas de hoy cada minuto, solo con la pestaña a la vista", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={client}>
        <GestorReservasKanban />
      </QueryClientProvider>,
    );
    await screen.findByText("Ana Casa");

    const hoy = format(new Date(), "yyyy-MM-dd");
    const consulta = client.getQueryCache().find({ queryKey: ["reservas-kanban", hoy] });
    expect(consulta?.observers[0]?.options).toMatchObject({
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
    });
    // Y las mesas de hoy (las de cada tarjeta y el aviso antes de mover de sala), igual.
    expect(vi.mocked(useAsignacionesMesa)).toHaveBeenCalledWith(hoy, undefined, undefined, REFRESCO_PERIODICO);
  });
});
