/**
 * Kanban de «Hoy»: tras MOVER una reserva a otra sala se abre el MAPA de esa sala para
 * elegirle la mesa (petición del dueño, 2026-10-01: «si yo paso a la persona de Salón a
 * Reservado, que al llevarla me enseñe el mapa de esa sala para ponerle la mesa que quiero»).
 *
 * Qué corre de verdad y qué no
 * ----------------------------------------------------------------------------
 *   · De verdad: el kanban, el ejecutor de acciones (`useAccionesServicioReserva`), el diálogo
 *     que envuelve el mapa (`ElegirMesaDialog`) y los hooks de datos (`useMesas`,
 *     `useReservasDeSala`, `useAsignacionesMesa`, `useAsignarMesasReserva`). Hablan con un doble
 *     en memoria de Supabase (`dobleSupabase.ts`): mover una reserva cambia lo que lee el plano
 *     después, y el RPC de asignación reemplaza las mesas de la reserva.
 *   · Mockeado: `PlanoEspacio2D` (la pantalla de plano, con su propio fichero de tests). El
 *     mock apunta las props que recibe, escribe `?fecha=&turno=` en la URL como hace el
 *     plano de verdad y trae un botón que da mesa por el MISMO hook de escritura que él.
 *
 * Los dos caminos de mover (arrastrar la tarjeta y «Mover a…» del menú ⋮) pasan por la
 * misma función del kanban (`solicitarMovimiento`); aquí se ejercita el del menú, que es el
 * que se puede pulsar en jsdom (dnd-kit necesita geometría real para el arrastre).
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { format } from "date-fns";
import { diferido, vaciarAlmacen, type AlmacenDoble } from "./dobleSupabase";

const h = vi.hoisted(() => ({
  /** Almacén del doble de Supabase (lo rellena cada test). Lo crea el mock del cliente; se muta, nunca se reasigna. */
  almacen: undefined as unknown as AlmacenDoble,
  /** Permiso de edición de «reservas». */
  canEdit: true,
  /** El Reservado lleva `caracteristicas.privada = true` (una reserva se queda la sala entera). */
  reservadoPrivado: false,
  /** Props con las que se ha pintado el plano, en orden. */
  plano: vi.fn(),
  /** Props con las que se ha pintado el `DndContext` del kanban (para soltar una tarjeta sin geometría). */
  dnd: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { crearAlmacen, crearSupabaseDoble } = await import("./dobleSupabase");
  h.almacen = crearAlmacen();
  return { supabase: crearSupabaseDoble(h.almacen) };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/hooks/useEspaciosReserva", () => ({
  useEspaciosReserva: () => ({
    data: [
      { id: "salon", nombre: "Salón", capacidad_maxima: 60, activa: true, caracteristicas: { marca: "casa_tomas" } },
      {
        id: "reservado",
        nombre: "Reservado",
        capacidad_maxima: 20,
        activa: true,
        caracteristicas: h.reservadoPrivado ? { marca: "casa_tomas", privada: true } : { marca: "casa_tomas" },
      },
      { id: "terraza", nombre: "Terraza", capacidad_maxima: 30, activa: true, caracteristicas: { marca: "casa_tomas" } },
    ],
  }),
}));
// Solo se sustituye el permiso; el resto del módulo es el de verdad.
vi.mock("@/hooks/useUserRole", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useUserRole")>()),
  useCanAccessSection: () => ({ canAccess: h.canEdit, loading: false }),
}));
vi.mock("@/hooks/useEdicionReserva", () => ({
  useEdicionReserva: () => ({ editarReserva: vi.fn(), dialogoEdicion: null }),
}));
vi.mock("@/components/reservas/BlacklistModal", () => ({ BlacklistModal: () => null }));
// El DndContext sigue siendo el de verdad; solo se apuntan sus props para poder SOLTAR una tarjeta sobre una
// columna sin geometría (jsdom no mide nada, así que el arrastre con ratón no se puede simular).
vi.mock("@dnd-kit/core", async (importOriginal) => {
  const real = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...real,
    DndContext: (props: React.ComponentProps<typeof real.DndContext>) => {
      h.dnd(props);
      return <real.DndContext {...props} />;
    },
  };
});
vi.mock("@/components/reservas/PlanoEspacio2D", async () => {
  const { useEffect } = await import("react");
  const { useSearchParams } = await import("react-router-dom");
  const { useAsignarMesasReserva } = await import("@/hooks/useAsignacionesMesa");
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
      const asignar = useAsignarMesasReserva();
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
        <div data-testid="plano" data-espacio={props.espacioId} data-reserva={props.reservaId}>
          Plano de {props.espacioNombre}
          <button
            type="button"
            onClick={() =>
              void asignar.mutateAsync({ reserva_id: props.reservaId as string, mesa_ids: ["m-r1"], silencioso: true })
            }
          >
            Dar la Mesa 1
          </button>
          <button type="button" onClick={props.onBack}>
            Volver al kanban
          </button>
        </div>
      );
    },
  };
});

import { toast } from "sonner";
import { GestorReservasKanban } from "@/components/reservas/GestorReservasKanban";
// El mapa carga el plano bajo demanda (`React.lazy` en `ElegirMesaDialog`, 07/11/2026): ya cargado aquí.
import "@/components/reservas/PlanoEspacio2D";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

/** El día que pinta el kanban (lo calcula igual: fecha local de hoy). */
const HOY = format(new Date(), "yyyy-MM-dd");

const reserva = (id: string, estado: string, nombre: string, extra: Record<string, unknown> = {}) => ({
  id,
  nombre,
  telefono: "+34612345678",
  email: null,
  fecha: HOY,
  hora: "21:00:00",
  numero_comensales: 4,
  estado,
  espacio_id: "salon",
  marca: "casa_tomas",
  canal: "telefono",
  importante: false,
  en_blacklist: false,
  ...extra,
});

const mesa = (id: string, espacioId: string, nombre: string, capacidad: number) => ({
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

/** Salón y Reservado tienen plano con mesas; la Terraza no tiene ninguna. */
const MESAS = [mesa("m-s1", "salon", "Mesa 1", 4), mesa("m-r1", "reservado", "Mesa 1", 4), mesa("m-r2", "reservado", "Mesa 2", 6)];

function SondaUrl() {
  const { search } = useLocation();
  return <span data-testid="url">{search}</span>;
}

function montar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const invalidadas: string[] = [];
  const invalidar = queryClient.invalidateQueries.bind(queryClient);
  vi.spyOn(queryClient, "invalidateQueries").mockImplementation((filtros, opciones) => {
    invalidadas.push(String((filtros as { queryKey: unknown[] }).queryKey[0]));
    return invalidar(filtros, opciones);
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/reservas?tab=hoy"]}>
        <GestorReservasKanban />
        <SondaUrl />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { queryClient, invalidadas };
}

/** Abre el menú «⋮» de la tarjeta de ese cliente. `hidden`: con un diálogo abierto el resto queda `aria-hidden`. */
async function abrirMenu(cliente: string) {
  const disparador = await screen.findByRole("button", {
    name: new RegExp(`^Acciones de la reserva de ${cliente}`),
    hidden: true,
  });
  fireEvent.keyDown(disparador, { key: "Enter" });
  return await screen.findByRole("menu", { hidden: true });
}

/** «Mover a…» → la sala. */
async function moverA(cliente: string, sala: RegExp) {
  const menu = await abrirMenu(cliente);
  fireEvent.click(within(menu).getByRole("menuitem", { name: sala }));
}

/** Espera a que el kanban haya pintado las reservas y las mesas asignadas de hoy. */
async function conTablero(cliente = "Ana") {
  await screen.findByRole("button", { name: new RegExp(`^${cliente},`), hidden: true });
  await waitFor(() => expect(h.almacen.lecturas.some((l) => l.tabla === "asignaciones_mesa")).toBe(true));
  await act(async () => {});
}

/** El diálogo del mapa de esa reserva en esa sala (`findBy`: aparece cuando la sala está comprobada). */
const mapaDe = (cliente: string, sala: string) =>
  screen.findByRole("dialog", { name: `Elige la mesa de ${cliente} en ${sala}` });

/** Deja pasar las peticiones y los efectos pendientes: para afirmar que NO ha salido nada. */
const dejarPasar = () => act(async () => void (await new Promise((r) => setTimeout(r, 60))));

/** La columna de una sala: ahí tiene que seguir la reserva movida. */
const columna = (sala: string) => screen.getByRole("region", { name: `Columna ${sala}`, hidden: true });

/** Cuántas veces se han pedido las mesas de una sala (la comprobación de «tiene plano»). */
const lecturasDeMesas = (sala: string) =>
  h.almacen.lecturas.filter((l) => l.tabla === "mesas" && l.eq.some(([c, v]) => c === "espacio_id" && v === sala)).length;

let consolaError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  vaciarAlmacen(h.almacen);
  h.canEdit = true;
  h.reservadoPrivado = false;
  h.almacen.reservas = [reserva("r-ana", "confirmada", "Ana"), reserva("r-berta", "confirmada", "Berta", { hora: "21:30:00", numero_comensales: 2 })];
  h.almacen.mesas = MESAS.map((m) => ({ ...m }));
  consolaError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consolaError.mockRestore();
});

describe("mover a una sala CON plano: se abre su mapa con la reserva ya señalada", () => {
  it("por «Mover a…»: guarda la sala y abre el mapa de ESA sala con ESA reserva, su día y su turno", async () => {
    montar();
    await conTablero();

    await moverA("Ana", /^Reservado/);

    const dialogo = await mapaDe("Ana", "Reservado");
    // Qué reserva es, a simple vista: hora y comensales en el propio diálogo.
    expect(within(dialogo).getByText("21:00")).toBeInTheDocument();
    expect(within(dialogo).getByText("4 comensales")).toBeInTheDocument();
    // El plano se abre en SU sala, SU día y SU turno (21:00 = cena), con la reserva señalada.
    expect(await within(dialogo).findByTestId("plano")).toHaveAttribute("data-espacio", "reservado");
    expect(h.plano).toHaveBeenLastCalledWith(
      expect.objectContaining({ espacioId: "reservado", espacioNombre: "Reservado", reservaId: "r-ana", fecha: HOY, turno: "cena" }),
    );
    // Y la sala se ha guardado ANTES, sin avisar al cliente.
    expect(h.almacen.escrituras).toEqual([{ tabla: "reservas", payload: { espacio_id: "reservado" }, ids: ["r-ana"] }]);
    expect(h.almacen.invocaciones).toEqual([]);
  });

  it("el mapa de una reserva de COMIDA abre el turno de comida", async () => {
    h.almacen.reservas = [reserva("r-ana", "confirmada", "Ana", { hora: "14:00:00" })];
    montar();
    await conTablero();

    await moverA("Ana", /^Reservado/);

    await mapaDe("Ana", "Reservado");
    expect(h.plano).toHaveBeenLastCalledWith(expect.objectContaining({ turno: "comida" }));
  });

  it("NO se abre mientras la sala se está guardando: primero el cambio, luego el mapa", async () => {
    const guardar = diferido();
    h.almacen.antesDeEscribir = () => guardar.promesa;
    montar();
    await conTablero();

    await moverA("Ana", /^Reservado/);
    await dejarPasar();

    expect(screen.queryByRole("dialog", { hidden: true })).not.toBeInTheDocument();
    expect(h.plano).not.toHaveBeenCalled();

    guardar.resolver();
    await mapaDe("Ana", "Reservado");
  });

  it("si la escritura falla, la reserva no se mueve y NO se abre ningún mapa", async () => {
    h.almacen.respuestasEscritura = [{ error: { code: "42501", message: "permission denied for table reservas" } }];
    montar();
    await conTablero();

    await moverA("Ana", /^Reservado/);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/No se pudo mover la reserva/)));
    await dejarPasar();
    expect(screen.queryByRole("dialog", { hidden: true })).not.toBeInTheDocument();
    expect(h.plano).not.toHaveBeenCalled();
  });
});

describe("arrastrando la tarjeta: el mismo camino que «Mover a…»", () => {
  /** Suelta la tarjeta de esa reserva sobre una columna, como haría dnd-kit al terminar el arrastre. */
  const soltar = (reservaId: string, columnaId: string | null) => {
    const { onDragEnd } = h.dnd.mock.lastCall![0] as { onDragEnd: (e: unknown) => void };
    act(() => onDragEnd({ active: { id: reservaId }, over: columnaId ? { id: columnaId } : null }));
  };

  it("soltarla en la columna de otra sala guarda la sala y abre el mapa de esa sala, igual que por el menú", async () => {
    montar();
    await conTablero();

    soltar("r-ana", "reservado");

    await mapaDe("Ana", "Reservado");
    expect(h.almacen.escrituras).toEqual([{ tabla: "reservas", payload: { espacio_id: "reservado" }, ids: ["r-ana"] }]);
    expect(h.plano).toHaveBeenLastCalledWith(expect.objectContaining({ espacioId: "reservado", reservaId: "r-ana", turno: "cena" }));
  });

  it("con mesas asignadas también pasa por el aviso de quitarlas y el mapa se abre al confirmar", async () => {
    h.almacen.asignaciones = [{ id: "a-1", reserva_id: "r-ana", mesa_id: "m-s1" }];
    montar();
    await conTablero();

    soltar("r-ana", "reservado");

    const aviso = await screen.findByRole("alertdialog");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(within(aviso).getByRole("button", { name: "Cambiar de sala" }));
    await mapaDe("Ana", "Reservado");
  });

  it("soltarla en «Sin asignar» o en una sala sin mesas la mueve y no abre nada", async () => {
    montar();
    await conTablero();

    soltar("r-ana", "sin-asignar");
    await waitFor(() => expect(h.almacen.escrituras).toHaveLength(1));
    soltar("r-berta", "terraza");
    await waitFor(() => expect(h.almacen.escrituras).toHaveLength(2));
    await waitFor(() => expect(lecturasDeMesas("terraza")).toBeGreaterThan(0));
    await dejarPasar();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(h.plano).not.toHaveBeenCalled();
  });

  it("soltarla fuera de las columnas o en la misma sala no mueve nada ni abre nada", async () => {
    montar();
    await conTablero();

    soltar("r-ana", null);
    soltar("r-ana", "salon");
    await dejarPasar();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(h.almacen.escrituras).toEqual([]);
  });
});

describe("mover a donde no hay nada que elegir: no se abre nada", () => {
  it("«Sin asignar» no tiene plano: se mueve y no se abre el mapa ni se pide ninguna mesa", async () => {
    montar();
    await conTablero();

    await moverA("Ana", /^Sin asignar/);

    await waitFor(() => expect(h.almacen.escrituras).toHaveLength(1));
    expect(h.almacen.escrituras[0].payload).toEqual({ espacio_id: null });
    await dejarPasar();
    expect(screen.queryByRole("dialog", { hidden: true })).not.toBeInTheDocument();
    expect(h.plano).not.toHaveBeenCalled();
    expect(h.almacen.lecturas.filter((l) => l.tabla === "mesas")).toEqual([]);
  });

  it("una sala SIN mesas (la Terraza) se mueve y no abre un mapa vacío, ni un instante", async () => {
    montar();
    await conTablero();

    await moverA("Ana", /^Terraza/);

    await waitFor(() => expect(h.almacen.escrituras).toHaveLength(1));
    expect(h.almacen.escrituras[0].payload).toEqual({ espacio_id: "terraza" });
    // Se ha comprobado que la sala no tiene mesas…
    await waitFor(() => expect(lecturasDeMesas("terraza")).toBeGreaterThan(0));
    await dejarPasar();
    // …y no ha salido ningún diálogo, ni siquiera cargando.
    expect(screen.queryByRole("dialog", { hidden: true })).not.toBeInTheDocument();
    expect(h.plano).not.toHaveBeenCalled();
  });

  it("si la reserva no se puede mover (la BD dice que ya cambió de estado), tampoco se abre", async () => {
    h.almacen.reservas = [reserva("r-ana", "confirmada", "Ana")];
    montar();
    await conTablero();

    // Otra persona la cancela antes de que se guarde el movimiento: la escritura va condicionada al estado.
    h.almacen.reservas[0].estado = "cancelada";
    await moverA("Ana", /^Reservado/);

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    await dejarPasar();
    expect(screen.queryByRole("dialog", { hidden: true })).not.toBeInTheDocument();
    expect(h.plano).not.toHaveBeenCalled();
  });

  it("sin permiso de edición no hay destinos que elegir: no se mueve y no se abre nada", async () => {
    h.canEdit = false;
    montar();
    await conTablero();

    const menu = await abrirMenu("Ana");

    expect(within(menu).queryByRole("menuitem", { name: /^Reservado/ })).not.toBeInTheDocument();
    await dejarPasar();
    expect(screen.queryByRole("dialog", { hidden: true })).not.toBeInTheDocument();
    expect(h.almacen.escrituras).toEqual([]);
  });
});

describe("cerrar el mapa", () => {
  it("«Ahora no» cierra el mapa y el cambio de sala se conserva, sin mesa y sin más escrituras", async () => {
    montar();
    await conTablero();
    await moverA("Ana", /^Reservado/);
    const dialogo = await mapaDe("Ana", "Reservado");

    fireEvent.click(within(dialogo).getByRole("button", { name: "Ahora no" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // Sigue en Reservado (la tarjeta está en su columna) y sin mesa.
    await waitFor(() => expect(within(columna("Reservado")).getByText("Ana")).toBeInTheDocument());
    expect(h.almacen.escrituras).toHaveLength(1);
    expect(h.almacen.llamadasRpc).toEqual([]);
    expect(h.almacen.asignaciones).toEqual([]);
  });

  it("Escape y la X de cerrar hacen lo mismo que «Ahora no»", async () => {
    montar();
    await conTablero();

    await moverA("Ana", /^Reservado/);
    const primero = await mapaDe("Ana", "Reservado");
    // Radix engancha el Escape cuando el diálogo ya tiene el foco dentro: antes de eso no escucha.
    await waitFor(() => expect(primero).toContainElement(document.activeElement as HTMLElement));
    fireEvent.keyDown(primero, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await moverA("Berta", /^Reservado/);
    fireEvent.click(within(await mapaDe("Berta", "Reservado")).getByRole("button", { name: "Cerrar ventana" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    expect(h.almacen.escrituras).toHaveLength(2);
    expect(h.almacen.llamadasRpc).toEqual([]);
  });

  it("al cerrar la URL queda como estaba: el plano apunta ?fecha= y ?turno= y no se quedan pegados", async () => {
    montar();
    await conTablero();
    expect(screen.getByTestId("url")).toHaveTextContent(/^\?tab=hoy$/);

    await moverA("Ana", /^Reservado/);
    const dialogo = await mapaDe("Ana", "Reservado");
    await waitFor(() => expect(screen.getByTestId("url").textContent).toContain("turno=cena"));

    fireEvent.click(within(dialogo).getByRole("button", { name: "Ahora no" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("url")).toHaveTextContent(/^\?tab=hoy$/);
  });
});

describe("el aviso previo de mover no cambia: el mapa se abre DESPUÉS de confirmar", () => {
  it("con mesas asignadas sale el aviso de quitarlas, el mapa no se abre hasta confirmar, y al confirmar se abre", async () => {
    h.almacen.asignaciones = [{ id: "a-1", reserva_id: "r-ana", mesa_id: "m-s1" }];
    montar();
    await conTablero();

    await moverA("Ana", /^Reservado/);

    const aviso = await screen.findByRole("alertdialog");
    expect(within(aviso).getByText("¿Cambiar de sala y quitar sus mesas?")).toBeInTheDocument();
    await dejarPasar();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(h.almacen.escrituras).toEqual([]);

    fireEvent.click(within(aviso).getByRole("button", { name: "Cambiar de sala" }));

    const mapa = await mapaDe("Ana", "Reservado");
    expect(await within(mapa).findByTestId("plano")).toHaveAttribute("data-reserva", "r-ana");
    // El trigger de la BD le ha quitado las mesas de Salón: ahora toca elegir la de Reservado.
    expect(h.almacen.asignaciones).toEqual([]);
    expect(within(mapa).getByRole("button", { name: "Ahora no" })).toBeInTheDocument();
  });

  it("«No mover» en el aviso: no se escribe y no se abre ningún mapa", async () => {
    h.almacen.asignaciones = [{ id: "a-1", reserva_id: "r-ana", mesa_id: "m-s1" }];
    montar();
    await conTablero();

    await moverA("Ana", /^Reservado/);
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "No mover" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    await dejarPasar();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(h.almacen.escrituras).toEqual([]);
    expect(h.plano).not.toHaveBeenCalled();
  });

  it("si además la sala se pasa de aforo, «Mover igualmente» también abre el mapa", async () => {
    // Reservado: 20 plazas; ya hay 18 en la cena + 4 de Ana = 22.
    h.almacen.reservas = [
      reserva("r-ana", "confirmada", "Ana"),
      reserva("r-berta", "confirmada", "Berta", { espacio_id: "reservado", numero_comensales: 18 }),
    ];
    montar();
    await conTablero();

    await moverA("Ana", /^Reservado/);
    const aviso = await screen.findByRole("alertdialog");
    expect(within(aviso).getByText(/¿Superar la capacidad de Reservado\?/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(within(aviso).getByRole("button", { name: "Mover igualmente" }));

    await mapaDe("Ana", "Reservado");
    expect(h.almacen.escrituras).toEqual([{ tabla: "reservas", payload: { espacio_id: "reservado" }, ids: ["r-ana"] }]);
  });
});

describe("otra reserva con el mapa abierto: el mapa pasa a la nueva y no se apilan", () => {
  it("mover a Berta con el mapa de Ana abierto: queda UN solo diálogo, el de Berta", async () => {
    montar();
    await conTablero();
    await moverA("Ana", /^Reservado/);
    await mapaDe("Ana", "Reservado");

    await moverA("Berta", /^Reservado/);

    await mapaDe("Berta", "Reservado");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.queryByRole("dialog", { name: /Ana/ })).not.toBeInTheDocument();
    // El plano pasa a la reserva nueva (y a su hora: 21:30, cena).
    expect(h.plano).toHaveBeenLastCalledWith(expect.objectContaining({ reservaId: "r-berta", turno: "cena" }));
    expect(h.almacen.escrituras.map((e) => e.ids)).toEqual([["r-ana"], ["r-berta"]]);
  });

  it("si la nueva va a una sala SIN mesas, el mapa anterior se cierra y no se abre otro: nunca queda un mapa señalando a una reserva que ya no es la última", async () => {
    montar();
    await conTablero();
    await moverA("Ana", /^Reservado/);
    await mapaDe("Ana", "Reservado");

    await moverA("Berta", /^Terraza/);

    await waitFor(() => expect(h.almacen.escrituras).toHaveLength(2));
    await waitFor(() => expect(screen.queryByRole("dialog", { hidden: true })).not.toBeInTheDocument());
    // Ana se queda en Reservado, sin mesa; Berta en la Terraza.
    expect(h.almacen.reservas.map((r) => [r.id, r.espacio_id])).toEqual([
      ["r-ana", "reservado"],
      ["r-berta", "terraza"],
    ]);
    expect(h.almacen.asignaciones).toEqual([]);
  });
});

describe("darle mesa desde el mapa", () => {
  it("al dar mesa se refrescan las mesas asignadas del kanban y las vistas de asignación, y el pie pasa a «Listo»", async () => {
    const { invalidadas } = montar();
    await conTablero();
    await moverA("Ana", /^Reservado/);
    const dialogo = await mapaDe("Ana", "Reservado");
    const lecturasAntes = h.almacen.lecturas.filter((l) => l.tabla === "asignaciones_mesa").length;
    invalidadas.length = 0;

    fireEvent.click(within(dialogo).getByRole("button", { name: "Dar la Mesa 1" }));

    await waitFor(() => expect(h.almacen.asignaciones).toEqual([{ id: "a-r-ana-m-r1", reserva_id: "r-ana", mesa_id: "m-r1" }]));
    expect(h.almacen.llamadasRpc).toEqual([
      { nombre: "asignar_mesas_reserva", args: { p_reserva_id: "r-ana", p_mesa_ids: ["m-r1"] } },
    ]);
    // Las claves que ya usa la asignación: la lista de mesas asignadas (la del kanban incluida) y el resumen del día.
    await waitFor(() => expect(invalidadas).toEqual(expect.arrayContaining(["asignaciones_mesa", "resumen-asignacion-dia"])));
    await waitFor(() =>
      expect(h.almacen.lecturas.filter((l) => l.tabla === "asignaciones_mesa").length).toBeGreaterThan(lecturasAntes),
    );
    // El diálogo lo dice: ya tiene mesa y el botón de salida deja de ser «Ahora no».
    expect(await within(dialogo).findByText("Mesa 1 asignada")).toBeInTheDocument();
    expect(within(dialogo).getByRole("button", { name: "Listo" })).toBeInTheDocument();
    expect(within(dialogo).queryByRole("button", { name: "Ahora no" })).not.toBeInTheDocument();

    // «Listo» cierra; la mesa y la sala se quedan.
    fireEvent.click(within(dialogo).getByRole("button", { name: "Listo" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(h.almacen.asignaciones).toHaveLength(1);
    expect(h.almacen.escrituras).toHaveLength(1);
    expect(h.almacen.invocaciones).toEqual([]);
  });
});

describe("Reservado como sala PRIVADA: una reserva se queda la sala entera", () => {
  it("mover una segunda reserva al Reservado en el mismo turno se bloquea con un aviso, sin escribir ni abrir el mapa", async () => {
    h.reservadoPrivado = true;
    // Berta (2 comensales, cena) ya tiene el Reservado: Ana (cena) no puede entrar.
    h.almacen.reservas = [
      reserva("r-ana", "confirmada", "Ana"),
      reserva("r-berta", "confirmada", "Berta", { espacio_id: "reservado", numero_comensales: 2 }),
    ];
    montar();
    await conTablero();

    await moverA("Ana", /^Reservado/);

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    const aviso = String(vi.mocked(toast.error).mock.calls[0][0]);
    expect(aviso).toContain("La sala privada «Reservado» ya está reservada en ese turno");
    expect(aviso).toContain("Ya la tiene Berta");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(h.almacen.escrituras).toEqual([]);
    expect(h.plano).not.toHaveBeenCalled();
  });

  it("si el Reservado está libre en ese turno (la otra es de la comida), sí se mueve y se abre el mapa", async () => {
    h.reservadoPrivado = true;
    h.almacen.reservas = [
      reserva("r-ana", "confirmada", "Ana"),
      reserva("r-berta", "confirmada", "Berta", { espacio_id: "reservado", numero_comensales: 2, hora: "14:00:00" }),
    ];
    montar();
    await conTablero();

    await moverA("Ana", /^Reservado/);

    await mapaDe("Ana", "Reservado");
    expect(h.almacen.escrituras).toEqual([{ tabla: "reservas", payload: { espacio_id: "reservado" }, ids: ["r-ana"] }]);
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe("Reservado como sala PRIVADA: sin columna en el kanban (04/10/2026)", () => {
  it("no pinta columna del Reservado: quien está en él no sale en ninguna columna (ni en «Sin asignar»); las demás siguen", async () => {
    h.reservadoPrivado = true;
    h.almacen.reservas = [
      reserva("r-ana", "confirmada", "Ana"),
      reserva("r-berta", "confirmada", "Berta", { espacio_id: "reservado", numero_comensales: 2 }),
      reserva("r-carla", "confirmada", "Carla", { espacio_id: "salon", numero_comensales: 3 }),
    ];
    montar();
    await conTablero();

    expect(screen.queryByRole("region", { name: "Columna Reservado" })).not.toBeInTheDocument();
    // Berta está en el Reservado: no se pinta en ninguna columna (se ve en el aviso desplegable de «Hoy»).
    expect(screen.queryByText("Berta")).not.toBeInTheDocument();
    expect(screen.queryByTestId("etiqueta-fuera-de-aforo")).not.toBeInTheDocument();
    const salon = within(screen.getByRole("region", { name: "Columna Salón" }));
    expect(salon.getByText("Carla")).toBeInTheDocument();
    expect(salon.getByText("Ana")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Columna Sin asignar" })).queryByText("Berta")).not.toBeInTheDocument();
  });

  it("«Mover a…» sigue ofreciendo el Reservado aunque no tenga columna, y la reserva sale de la columna al moverla", async () => {
    h.reservadoPrivado = true;
    h.almacen.reservas = [reserva("r-ana", "confirmada", "Ana")];
    montar();
    await conTablero();

    await moverA("Ana", /^Reservado/);

    await mapaDe("Ana", "Reservado");
    expect(h.almacen.escrituras).toEqual([{ tabla: "reservas", payload: { espacio_id: "reservado" }, ids: ["r-ana"] }]);
    // Ya no está en «Sin asignar» ni en ninguna otra columna: vive en el Reservado.
    await waitFor(() => expect(screen.queryByText("Ana")).not.toBeInTheDocument());
  });

  it("si el Reservado no es privado (sin el flag), no lleva etiqueta", async () => {
    h.reservadoPrivado = false;
    h.almacen.reservas = [reserva("r-berta", "confirmada", "Berta", { espacio_id: "reservado", numero_comensales: 2 })];
    montar();
    await conTablero("Berta");

    expect(screen.queryByTestId("etiqueta-fuera-de-aforo")).not.toBeInTheDocument();
  });
});
