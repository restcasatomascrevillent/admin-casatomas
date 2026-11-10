/**
 * «Hoy» con mala cobertura (09/11/2026): con la copia del día en el dispositivo (`cacheOffline.ts`), la
 * pestaña pinta las reservas AL MOMENTO, sin esperar a la red, y dice «Actualizando…» mientras se vuelven a
 * pedir; cuando llegan, enseña las nuevas y la pastilla se va. Sin copia, no hay pastilla.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  /** Cada lectura de `reservas` espera a que el test la suelte con `soltar(filas)`. */
  pendientes: [] as Array<(filas: Record<string, unknown>[]) => void>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const builder = () => {
    const q: Record<string, unknown> = {};
    const seguir = () => q;
    q.select = seguir;
    q.eq = seguir;
    q.neq = seguir;
    q.order = seguir;
    q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      new Promise<Record<string, unknown>[]>((resolver) => h.pendientes.push(resolver))
        .then((filas) => ({ data: filas, error: null }))
        .then(ok, ko);
    return q;
  };
  return { supabase: { from: vi.fn(() => builder()) } };
});

// La lista (izquierda) enseña los nombres que recibe; el plano, aparte (tiene sus tests).
vi.mock("@/components/reservas/movil/VistaHoyMovil", () => ({
  VistaHoyMovil: ({ reservas }: { reservas?: { id: string; nombre: string }[] }) => (
    <ul data-testid="vista-lista">
      {reservas === undefined ? <li>Cargando reservas…</li> : reservas.map((r) => <li key={r.id}>{r.nombre}</li>)}
    </ul>
  ),
}));
vi.mock("@/components/reservas/servicio/VistaPlanoHoy", () => ({ VistaPlanoHoy: () => <div data-testid="vista-plano" /> }));
vi.mock("@/hooks/useUserRole", () => ({ useCanAccessSection: () => ({ canAccess: true, loading: false }) }));
vi.mock("@/components/reservas/SentarSinReserva", () => ({ BotonSentarSinReserva: () => null }));
vi.mock("@/hooks/useReservasEnVivo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useReservasEnVivo")>()),
  useReservasEnVivo: vi.fn(),
}));

import { VistaHoy } from "@/components/reservas/VistaHoy";
import { hoyLocal } from "@/components/reservas/asignacionPlano";
import { guardarCopiaHoy, hidratarCopiaHoy } from "@/lib/cacheOffline";

const HOY = hoyLocal();
const CLAVE = ["reservas-hoy", "pendientes-mesa", HOY];
const fila = (id: string, nombre: string) => ({ id, nombre, hora: "21:00:00", numero_comensales: 2, estado: "confirmada", marca: "casa_tomas", fecha: HOY });

const nuevoCliente = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });

/** Deja en el dispositivo la copia de una visita de hace 10 minutos, como `activarCopiaHoy`. */
function dejarCopiaDeHaceDiezMinutos(usuario: string) {
  const anterior = nuevoCliente();
  anterior.setQueryData(CLAVE, [fila("r1", "Ana de la copia")], { updatedAt: Date.now() - 10 * 60_000 });
  guardarCopiaHoy(anterior, usuario);
}

function montar(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <VistaHoy />
    </QueryClientProvider>,
  );
}

describe("VistaHoy desde la copia del dispositivo", () => {
  beforeEach(() => {
    localStorage.clear();
    h.pendientes = [];
  });

  it("pinta lo de la copia al momento, con «Actualizando…», y al llegar la red lo cambia y la quita", async () => {
    dejarCopiaDeHaceDiezMinutos("ana");
    const qc = nuevoCliente();
    expect(hidratarCopiaHoy(qc, "ana")).toBe(1);

    montar(qc);
    // Sin haber contestado la red: ya están las reservas, y la pastilla dice que son de antes.
    expect(screen.getByText("Ana de la copia")).toBeInTheDocument();
    expect(screen.queryByText("Cargando reservas…")).not.toBeInTheDocument();
    expect(await screen.findByTestId("hoy-actualizando")).toHaveTextContent(/Actualizando/);

    // Llega la respuesta (la primera lectura pendiente es la de las reservas sin canceladas).
    await act(async () => {
      for (const soltar of h.pendientes.splice(0)) soltar([fila("r2", "Bea de ahora")]);
    });
    expect(await screen.findByText("Bea de ahora")).toBeInTheDocument();
    expect(screen.queryByText("Ana de la copia")).not.toBeInTheDocument();
    expect(screen.queryByTestId("hoy-actualizando")).not.toBeInTheDocument();
  });

  it("la copia de OTRO usuario no se carga: «Cargando reservas…» y sin pastilla", () => {
    dejarCopiaDeHaceDiezMinutos("bea");
    const qc = nuevoCliente();
    expect(hidratarCopiaHoy(qc, "ana")).toBe(0);

    montar(qc);
    expect(screen.getByText("Cargando reservas…")).toBeInTheDocument();
    expect(screen.queryByText("Ana de la copia")).not.toBeInTheDocument();
    expect(screen.queryByTestId("hoy-actualizando")).not.toBeInTheDocument();
  });

  it("con datos recientes (la relectura de cada minuto) no sale la pastilla", async () => {
    const qc = nuevoCliente();
    qc.setQueryData(CLAVE, [fila("r1", "Ana reciente")], { updatedAt: Date.now() - 20_000 });
    montar(qc);
    expect(screen.getByText("Ana reciente")).toBeInTheDocument();
    // Se vuelve a pedir (como el sondeo de cada minuto) y la red no contesta todavía.
    await act(async () => {
      void qc.refetchQueries({ queryKey: CLAVE, type: "active" });
    });
    expect(qc.getQueryState(CLAVE)?.fetchStatus).toBe("fetching");
    expect(screen.queryByTestId("hoy-actualizando")).not.toBeInTheDocument();
  });
});
