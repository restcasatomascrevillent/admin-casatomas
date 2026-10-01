/**
 * `ElegirMesaDialog`: el diálogo que envuelve el plano de una sala para ELEGIR LA MESA de una
 * reserva recién movida a ella (lo abre el kanban de «Hoy»; ver `GestorReservasKanban.mapa.test.tsx`
 * para el recorrido completo).
 *
 * Aquí se fija lo propio del envoltorio, con el plano (`PlanoEspacio2D`) mockeado:
 *   · no pinta NADA hasta saber que la sala tiene mesas y que su lista de reservas está al día
 *     (si no, el plano se montaría con la lista de antes del movimiento y no encontraría la
 *     reserva señalada);
 *   · título, hora y comensales a la vista, y el plano abierto en su sala, día y turno;
 *   · cómo se cierra («Ahora no», Escape) y que la URL queda como estaba;
 *   · el pie dice «Listo» en cuanto la reserva tiene mesa; y se cierra solo si la reserva ya no
 *     está en la sala (la devolvieron con el «Deshacer» del aviso, o la movió otra persona).
 *
 * Los tests con el plano de verdad están en `ElegirMesaDialog.plano.test.tsx`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { diferido, vaciarAlmacen, type AlmacenDoble } from "./dobleSupabase";

const h = vi.hoisted(() => ({
  almacen: undefined as unknown as AlmacenDoble,
  plano: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { crearAlmacen, crearSupabaseDoble } = await import("./dobleSupabase");
  h.almacen = crearAlmacen();
  return { supabase: crearSupabaseDoble(h.almacen) };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/components/reservas/PlanoEspacio2D", async () => {
  const { useEffect } = await import("react");
  const { useSearchParams } = await import("react-router-dom");
  return {
    PlanoEspacio2D: (props: {
      espacioId: string;
      espacioNombre: string;
      fecha?: string;
      turno?: string;
      reservaId?: string;
      onBack: () => void;
    }) => {
      h.plano(props);
      const [, setSearchParams] = useSearchParams();
      // El plano de verdad apunta día y turno en la URL al atender la reserva señalada.
      useEffect(() => {
        setSearchParams(
          (prev) => {
            const params = new URLSearchParams(prev);
            if (props.fecha) params.set("fecha", props.fecha);
            if (props.turno) params.set("turno", props.turno);
            return params;
          },
          { replace: true },
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return (
        <div data-testid="plano">
          Plano de {props.espacioNombre}
          <button type="button" onClick={props.onBack}>
            Volver al kanban
          </button>
        </div>
      );
    },
  };
});

import { toast } from "sonner";
import { ElegirMesaDialog } from "@/components/reservas/ElegirMesaDialog";

const HOY = "2026-10-01";

const fila = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  nombre: "Ana",
  fecha: HOY,
  hora: "21:00:00",
  numero_comensales: 4,
  estado: "confirmada",
  espacio_id: "reservado",
  telefono: "+34612345678",
  notas_cliente: null,
  importante: false,
  ...extra,
});

const mesa = (id: string, nombre: string, capacidad: number, espacioId = "reservado") => ({
  id,
  espacio_id: espacioId,
  nombre,
  capacidad,
  forma: "rectangular",
  ancho: 80,
  alto: 80,
  pos_x: 1,
  pos_y: 1,
  rotacion: 0,
  activa: true,
  is_merged: false,
  original_mesas: null,
  etiqueta: null,
});

type ReservaProp = { id: string; nombre: string | null; hora: string; numero_comensales: number; estado: string };

const ANA: ReservaProp = { id: "r-ana", nombre: "Ana", hora: "21:00:00", numero_comensales: 4, estado: "confirmada" };

function SondaUrl() {
  const { search } = useLocation();
  return <span data-testid="url">{search}</span>;
}

function montar({
  reserva = ANA,
  espacioId = "reservado",
  espacioNombre = "Reservado",
  ruta = "/reservas?tab=hoy",
}: { reserva?: ReservaProp; espacioId?: string; espacioNombre?: string; ruta?: string } = {}) {
  const onCerrar = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[ruta]}>
        <ElegirMesaDialog
          reserva={reserva}
          fecha={HOY}
          espacioId={espacioId}
          espacioNombre={espacioNombre}
          onCerrar={onCerrar}
        />
        <SondaUrl />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onCerrar, queryClient, ...utils };
}

/** Deja pasar las peticiones y los efectos pendientes: para afirmar que NO ha salido nada. */
const dejarPasar = () => act(async () => void (await new Promise((r) => setTimeout(r, 60))));

const esLecturaDeSala = (l: { tabla: string; eq: Array<[string, unknown]> }) =>
  l.tabla === "reservas" && l.eq.some(([c]) => c === "espacio_id");

let consolaError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  vaciarAlmacen(h.almacen);
  h.almacen.reservas = [fila("r-ana")];
  h.almacen.mesas = [mesa("m-1", "Mesa 1", 4), mesa("m-2", "Mesa 2", 6)];
  consolaError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consolaError.mockRestore();
});

describe("ElegirMesaDialog · qué enseña", () => {
  it("título «Elige la mesa de {nombre} en {sala}», con hora y comensales a la vista", async () => {
    montar();

    const dialogo = await screen.findByRole("dialog", { name: "Elige la mesa de Ana en Reservado" });

    expect(within(dialogo).getByText("21:00")).toBeInTheDocument();
    expect(within(dialogo).getByText("4 comensales")).toBeInTheDocument();
    // Le dice dónde está y que la mesa puede esperar, sin hablar de error: sin mesa es un estado normal.
    expect(within(dialogo).getByText("Ya está en Reservado. Puedes darle mesa ahora o más tarde.")).toBeInTheDocument();
  });

  it("un solo comensal va en singular, y sin nombre sale «esta reserva»", async () => {
    montar({ reserva: { ...ANA, nombre: null, numero_comensales: 1 } });

    const dialogo = await screen.findByRole("dialog", { name: "Elige la mesa de esta reserva en Reservado" });

    expect(within(dialogo).getByText("1 comensal")).toBeInTheDocument();
  });

  it("abre el plano de ESA sala, ese día y con la reserva señalada, en el turno de su hora", async () => {
    montar();
    await screen.findByRole("dialog");

    expect(h.plano).toHaveBeenLastCalledWith(
      expect.objectContaining({
        espacioId: "reservado",
        espacioNombre: "Reservado",
        fecha: HOY,
        reservaId: "r-ana",
        turno: "cena",
      }),
    );
  });

  it("una reserva de mediodía abre el turno de comida", async () => {
    h.almacen.reservas = [fila("r-ana", { hora: "14:00:00" })];
    montar({ reserva: { ...ANA, hora: "14:00:00" } });
    await screen.findByRole("dialog");

    expect(h.plano).toHaveBeenLastCalledWith(expect.objectContaining({ turno: "comida" }));
  });

  it("es un diálogo modal con su descripción: no se pueden pulsar las tarjetas de detrás", async () => {
    montar();

    const dialogo = await screen.findByRole("dialog");

    expect(dialogo).toHaveAttribute("aria-describedby");
    expect(dialogo).toHaveAttribute("data-state", "open");
  });
});

describe("ElegirMesaDialog · no pinta nada hasta saber que hay algo que elegir", () => {
  it("mientras se comprueba la sala NO sale ningún diálogo ni se monta el plano", async () => {
    const mesas = diferido();
    h.almacen.antesDeLeer = (l) => (l.tabla === "mesas" ? mesas.promesa : undefined);
    montar();

    await dejarPasar();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(h.plano).not.toHaveBeenCalled();

    mesas.resolver();
    await screen.findByRole("dialog");
  });

  it("el plano no se monta hasta que la lista de la sala está al día: si no, no encontraría la reserva señalada", async () => {
    const lista = diferido();
    h.almacen.antesDeLeer = (l) => (esLecturaDeSala(l) ? lista.promesa : undefined);
    montar();

    // Las mesas ya están, pero la lista de reservas de la sala todavía no ha llegado.
    await waitFor(() => expect(h.almacen.lecturas.some((l) => l.tabla === "mesas")).toBe(true));
    await dejarPasar();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(h.plano).not.toHaveBeenCalled();

    lista.resolver();
    await screen.findByRole("dialog");
    expect(h.plano).toHaveBeenCalled();
  });

  it("sin cargar de nuevo: una vez abierto, un refresco en segundo plano no lo esconde", async () => {
    const { queryClient } = montar();
    await screen.findByRole("dialog");

    const nuevaLista = diferido();
    h.almacen.antesDeLeer = (l) => (esLecturaDeSala(l) ? nuevaLista.promesa : undefined);
    await act(async () => {
      void queryClient.invalidateQueries({ queryKey: ["reservas_sala_dia"] });
      void queryClient.invalidateQueries({ queryKey: ["mesas"] });
    });
    await dejarPasar();

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    nuevaLista.resolver();
  });

  it("una sala SIN mesas no abre nada: avisa al padre de que se cierre, una sola vez, y no monta el plano", async () => {
    h.almacen.mesas = [mesa("m-otra", "Mesa 1", 4, "salon")];
    const { onCerrar } = montar();

    await waitFor(() => expect(onCerrar).toHaveBeenCalledTimes(1));
    await dejarPasar();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(h.plano).not.toHaveBeenCalled();
    expect(onCerrar).toHaveBeenCalledTimes(1);
    // Es lo normal (la Terraza no tiene mesas): ni un aviso.
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("si no se pueden cargar las mesas, avisa de qué hacer (la reserva ya está en la sala) y se cierra", async () => {
    h.almacen.antesDeLeer = (l) => {
      if (l.tabla === "mesas") throw new Error("sin red");
    };
    const { onCerrar } = montar();

    await waitFor(() => expect(onCerrar).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("No se pudo abrir el mapa de Reservado"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(h.plano).not.toHaveBeenCalled();
  });

  it("una reserva cancelada no se puede sentar: no abre nada", async () => {
    const { onCerrar } = montar({ reserva: { ...ANA, estado: "cancelada" } });

    await waitFor(() => expect(onCerrar).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(h.plano).not.toHaveBeenCalled();
  });
});

describe("ElegirMesaDialog · cerrar", () => {
  it("«Ahora no» cierra y no toca nada: ni escrituras ni asignaciones", async () => {
    const { onCerrar } = montar();
    const dialogo = await screen.findByRole("dialog");

    fireEvent.click(within(dialogo).getByRole("button", { name: "Ahora no" }));

    expect(onCerrar).toHaveBeenCalledTimes(1);
    expect(h.almacen.escrituras).toEqual([]);
    expect(h.almacen.llamadasRpc).toEqual([]);
  });

  it("Escape cierra", async () => {
    const { onCerrar } = montar();
    const dialogo = await screen.findByRole("dialog");
    // Radix engancha el Escape cuando el diálogo ya tiene el foco dentro: antes de eso no escucha.
    await waitFor(() => expect(dialogo).toContainElement(document.activeElement as HTMLElement));

    fireEvent.keyDown(dialogo, { key: "Escape" });

    expect(onCerrar).toHaveBeenCalledTimes(1);
  });

  it("el «Volver» del propio plano cierra el diálogo", async () => {
    const { onCerrar } = montar();

    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Volver al kanban" }));

    expect(onCerrar).toHaveBeenCalledTimes(1);
  });

  it("devuelve la URL como estaba: lo que el plano apunta (?fecha=, ?turno=) se quita o se restaura", async () => {
    const { onCerrar } = montar({ ruta: "/reservas?tab=hoy&turno=comida" });
    const dialogo = await screen.findByRole("dialog");
    // El plano (mock) ha puesto el día de la reserva y su turno.
    await waitFor(() => expect(screen.getByTestId("url").textContent).toContain("fecha=2026-10-01"));
    expect(screen.getByTestId("url").textContent).toContain("turno=cena");

    fireEvent.click(within(dialogo).getByRole("button", { name: "Ahora no" }));

    expect(onCerrar).toHaveBeenCalledTimes(1);
    // `tab` no se toca; `turno` vuelve a lo que había; `fecha` (que no había) desaparece.
    await waitFor(() => expect(screen.getByTestId("url")).toHaveTextContent(/^\?tab=hoy&turno=comida$/));
  });

  it("si el plano nunca llegó a montarse (sala sin mesas) no toca la URL", async () => {
    h.almacen.mesas = [];
    const { onCerrar } = montar({ ruta: "/reservas?tab=hoy" });

    await waitFor(() => expect(onCerrar).toHaveBeenCalled());

    expect(screen.getByTestId("url")).toHaveTextContent(/^\?tab=hoy$/);
  });
});

describe("ElegirMesaDialog · darle mesa", () => {
  it("mientras la reserva no tiene mesa, el pie es «Ahora no»", async () => {
    montar();

    const dialogo = await screen.findByRole("dialog");

    expect(within(dialogo).getByRole("button", { name: "Ahora no" })).toBeInTheDocument();
    expect(within(dialogo).queryByRole("button", { name: "Listo" })).not.toBeInTheDocument();
  });

  it("en cuanto la reserva tiene mesa dice cuál y el pie pasa a «Listo»", async () => {
    const { queryClient } = montar();
    const dialogo = await screen.findByRole("dialog");

    h.almacen.asignaciones = [{ id: "a-1", reserva_id: "r-ana", mesa_id: "m-1" }];
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["asignaciones_mesa"] });
    });

    expect(await within(dialogo).findByText("Mesa 1 asignada")).toBeInTheDocument();
    expect(within(dialogo).getByRole("button", { name: "Listo" })).toBeInTheDocument();
    expect(within(dialogo).queryByRole("button", { name: "Ahora no" })).not.toBeInTheDocument();
  });

  it("con dos mesas juntas las nombra a las dos, en plural", async () => {
    h.almacen.asignaciones = [
      { id: "a-1", reserva_id: "r-ana", mesa_id: "m-1" },
      { id: "a-2", reserva_id: "r-ana", mesa_id: "m-2" },
    ];
    montar();

    expect(await screen.findByText("Mesa 1 + Mesa 2 asignadas")).toBeInTheDocument();
  });

  it("las mesas de OTRA reserva no cuentan: Ana sigue sin mesa", async () => {
    h.almacen.reservas = [fila("r-ana"), fila("r-berta", { nombre: "Berta" })];
    h.almacen.asignaciones = [{ id: "a-1", reserva_id: "r-berta", mesa_id: "m-1" }];
    montar();

    const dialogo = await screen.findByRole("dialog");

    expect(within(dialogo).getByRole("button", { name: "Ahora no" })).toBeInTheDocument();
    expect(within(dialogo).queryByText(/asignada/)).not.toBeInTheDocument();
  });
});

describe("ElegirMesaDialog · si la reserva se va de la sala", () => {
  it("se cierra solo: la devolvieron con el «Deshacer» del aviso (o la movió otra persona) y el mapa ya no es suyo", async () => {
    const { onCerrar, queryClient } = montar();
    await screen.findByRole("dialog");
    expect(onCerrar).not.toHaveBeenCalled();

    // Vuelve a Salón: la lista de Reservado ya no la trae.
    h.almacen.reservas[0].espacio_id = "salon";
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["reservas_sala_dia"] });
    });

    await waitFor(() => expect(onCerrar).toHaveBeenCalledTimes(1));
  });

  it("y no se cierra por un refresco normal: mientras siga en la sala, el diálogo se queda", async () => {
    const { onCerrar, queryClient } = montar();
    await screen.findByRole("dialog");

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["reservas_sala_dia"] });
    });
    await dejarPasar();

    expect(onCerrar).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
