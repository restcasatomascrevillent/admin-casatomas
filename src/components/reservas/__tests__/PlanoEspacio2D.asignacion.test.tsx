/**
 * Tests de la ASIGNACIÓN DE MESAS de `src/components/reservas/PlanoEspacio2D.tsx`.
 *
 * ESTRATEGIA — doble en memoria de la base de datos, no mocks de la lógica
 * ----------------------------------------------------------------------------
 * La base de datos real todavía NO tiene la migración de asignación de mesas,
 * así que aquí se monta un DOBLE en memoria del cliente de Supabase que imita
 * lo que hará el servidor:
 *
 *   · `from("reservas")` / `from("asignaciones_mesa")` leen del almacén;
 *   · `rpc("asignar_mesas_reserva")` REEMPLAZA de golpe las mesas de una
 *     reserva, igual que el RPC, y antes de tocar nada comprueba la restricción
 *     `unique (mesa_id, fecha, turno)` devolviendo `MESA_OCUPADA: <mesa>`.
 *
 * Lo que NO se mockea (corre de verdad): `@/lib/reservas/asignacionMesas`
 * (turnos, ajuste de capacidad, traducción de errores) y
 * `@/hooks/useAsignacionesMesa` (lectura y el RPC). Así estos tests cubren
 * también que la pantalla habla bien con ese contrato.
 *
 * Solo se mockean los hooks de mesas y plano (datos de configuración, ajenos a
 * lo que se prueba) y `sonner`, para poder leer los avisos.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";

// ─── Doble en memoria ─────────────────────────────────────────────────────────

const h = vi.hoisted(() => {
  interface FilaAsignacion {
    id: string;
    reserva_id: string;
    mesa_id: string;
  }

  const store = {
    reservas: [] as any[],
    mesas: [] as any[],
    asignaciones: [] as FilaAsignacion[],
    /** Fuerza el SIGUIENTE rpc a fallar con este mensaje (se consume). */
    errorRpc: null as string | null,
    llamadasRpc: [] as Array<{ nombre: string; args: any }>,
    llamadasEq: [] as Array<{ tabla: string; columna: string; valor: unknown }>,
    contador: 0,
    /** Fila de `configuracion_reservas` (mesas que no se ofrecen al asignar). */
    config: { asignacion_mesas_excluidas: [] as string[] } as Record<string, unknown>,
  };

  // Mismo corte que el SQL: `hora < '17:00:00'` → comida.
  const turnoDe = (hora: string) => (String(hora ?? "") < "17:00:00" ? "comida" : "cena");
  const reservaDe = (id: string) => store.reservas.find((r) => r.id === id);
  const mesaDe = (id: string) => store.mesas.find((m) => m.id === id);

  const conDetalles = (fila: FilaAsignacion) => {
    const r = reservaDe(fila.reserva_id);
    const m = mesaDe(fila.mesa_id);
    return {
      ...fila,
      created_at: "2026-09-26T10:00:00Z",
      fecha: r?.fecha ?? null,
      turno: turnoDe(r?.hora ?? ""),
      espacio_id: m?.espacio_id ?? null,
      reservas: {
        id: r?.id,
        nombre: r?.nombre,
        hora: r?.hora,
        numero_comensales: r?.numero_comensales,
        estado: r?.estado,
        fecha: r?.fecha,
      },
      mesas: { id: m?.id, nombre: m?.nombre, capacidad: m?.capacidad, espacio_id: m?.espacio_id },
    };
  };

  const datosDe = (tabla: string) => {
    if (tabla === "reservas") return store.reservas.filter((r) => r.estado !== "cancelada");
    if (tabla === "asignaciones_mesa") return store.asignaciones.map(conDetalles);
    if (tabla === "configuracion_reservas") return store.config;
    return [];
  };

  const construirBuilder = (tabla: string) => {
    const b: any = {};
    const seguir = () => b;
    b.select = seguir;
    b.neq = seguir;
    b.order = seguir;
    b.in = seguir;
    b.is = seguir;
    b.limit = seguir;
    b.single = seguir;
    b.eq = (columna: string, valor: unknown) => {
      store.llamadasEq.push({ tabla, columna, valor });
      return b;
    };
    // Los datos se leen AL RESOLVER, no al construir: así un refetch ve el
    // almacén actualizado.
    b.then = (ok: any, mal?: any) =>
      Promise.resolve({ data: datosDe(tabla), error: null }).then(ok, mal);
    return b;
  };

  const supabaseDoble = {
    from: (tabla: string) => construirBuilder(tabla),
    rpc: async (nombre: string, args: any) => {
      store.llamadasRpc.push({ nombre, args });

      if (store.errorRpc) {
        const message = store.errorRpc;
        store.errorRpc = null;
        return { data: null, error: { message } };
      }

      const reservaId = args?.p_reserva_id as string;
      const mesaIds = (args?.p_mesa_ids ?? []) as string[];
      const reserva = reservaDe(reservaId);
      const turno = turnoDe(reserva?.hora ?? "");

      // La restricción real es `unique (mesa_id, fecha, turno)`: se comprueba
      // ANTES de escribir, como haría la transacción del RPC.
      for (const mesaId of mesaIds) {
        const choque = store.asignaciones.find((a) => {
          if (a.mesa_id !== mesaId || a.reserva_id === reservaId) return false;
          const otra = reservaDe(a.reserva_id);
          return otra?.fecha === reserva?.fecha && turnoDe(otra?.hora ?? "") === turno;
        });
        if (choque) {
          return { data: null, error: { message: `MESA_OCUPADA: ${mesaDe(mesaId)?.nombre ?? mesaId}` } };
        }
      }

      store.asignaciones = store.asignaciones.filter((a) => a.reserva_id !== reservaId);
      for (const mesaId of mesaIds) {
        store.asignaciones.push({ id: `a-${++store.contador}`, reserva_id: reservaId, mesa_id: mesaId });
      }
      return { data: store.asignaciones.filter((a) => a.reserva_id === reservaId), error: null };
    },
  };

  return { store, supabaseDoble };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: h.supabaseDoble }));
vi.mock("@/hooks/useMesas");
vi.mock("@/hooks/usePlanosEspacio");
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

import { toast } from "sonner";
import {
  useMesas,
  useCrearMesa,
  useActualizarMesasSilent,
  useEliminarMesa,
} from "@/hooks/useMesas";
import { usePlanoEspacio } from "@/hooks/usePlanosEspacio";
import { hoyLocal } from "@/components/reservas/asignacionPlano";
import { PlanoEspacio2D } from "@/components/reservas/PlanoEspacio2D";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const FECHA = "2026-09-26";
const ESPACIO = "e-salon";

const mesa = (id: string, nombre: string, capacidad: number, extra: Record<string, unknown> = {}) => ({
  id,
  espacio_id: ESPACIO,
  nombre,
  capacidad,
  forma: "rectangular",
  ancho: 90,
  alto: 90,
  pos_x: 1,
  pos_y: 1,
  rotacion: 0,
  activa: true,
  is_merged: false,
  original_mesas: null,
  etiqueta: null,
  created_at: "2026-09-01T10:00:00Z",
  updated_at: "2026-09-01T10:00:00Z",
  ...extra,
});

const reserva = (
  id: string,
  nombre: string,
  hora: string,
  numero_comensales: number,
  extra: Record<string, unknown> = {},
) => ({
  id,
  nombre,
  hora,
  numero_comensales,
  estado: "confirmada",
  fecha: FECHA,
  espacio_id: ESPACIO,
  telefono: "+34600000000",
  ...extra,
});

// Mesa 4 (4 plazas) + Mesa 5 (2 plazas) = 6 → el caso del dueño: "estos 6
// caben juntando la 4 y la 5".
const MESAS = [mesa("m4", "Mesa 4", 4), mesa("m5", "Mesa 5", 2), mesa("m6", "Mesa 6", 6)];

const RESERVAS = [
  reserva("r-perez", "Familia Pérez", "14:00:00", 6),
  reserva("r-ana", "Ana López", "13:30:00", 2),
  reserva("r-romero", "Cena Romero", "21:00:00", 4),
];

/**
 * Espía de la URL: deja los parámetros a la vista para poder comprobar qué
 * escribe la pantalla (`?fecha=`, `?turno=` y el `?reserva=` que se consume).
 */
function SondaUrl() {
  const { search } = useLocation();
  return <span data-testid="url-search">{search}</span>;
}

function montar({
  ruta = `/reservas?fecha=${FECHA}&turno=comida`,
  mesas = MESAS,
  reservas = RESERVAS,
  asignaciones = [] as Array<{ id: string; reserva_id: string; mesa_id: string }>,
  fechaProp,
  turnoProp,
  reservaIdProp,
}: {
  ruta?: string;
  mesas?: unknown[];
  reservas?: unknown[];
  asignaciones?: Array<{ id: string; reserva_id: string; mesa_id: string }>;
  fechaProp?: string;
  turnoProp?: "comida" | "cena";
  reservaIdProp?: string;
} = {}) {
  h.store.reservas = reservas as any[];
  h.store.mesas = mesas as any[];
  h.store.asignaciones = [...asignaciones];

  vi.mocked(useMesas).mockReturnValue({ data: mesas, isLoading: false } as never);
  vi.mocked(usePlanoEspacio).mockReturnValue({
    data: { pixels_per_meter: 50, ancho_metros: 12, alto_metros: 8, configuracion: { elementos: [] } },
  } as never);
  vi.mocked(useCrearMesa).mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never);
  vi.mocked(useActualizarMesasSilent).mockReturnValue({ mutate: vi.fn(), isPending: false } as never);
  vi.mocked(useEliminarMesa).mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never);

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });

  // El árbol se arma aparte para poder REPINTARLO con otra reserva señalada sin
  // desmontar el plano (dos saltos seguidos).
  const arbol = (reservaId?: string, turno?: "comida" | "cena") => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[ruta]}>
        <PlanoEspacio2D
          espacioId={ESPACIO}
          espacioNombre="Salón"
          onBack={vi.fn()}
          fecha={fechaProp}
          turno={turno}
          reservaId={reservaId}
        />
        <SondaUrl />
      </MemoryRouter>
    </QueryClientProvider>
  );

  const utils = render(arbol(reservaIdProp, turnoProp));
  return {
    ...utils,
    /**
     * Señala otro destino, como haría el padre sin cambiar de pantalla: el
     * turno viaja CON la reserva, igual que en `saltoAsignacion.ts`.
     */
    saltarA: (id: string, turno?: "comida" | "cena") => utils.rerender(arbol(id, turno)),
  };
}

/** Parámetros de la URL tal como están ahora mismo. */
const paramsUrl = () => new URLSearchParams(screen.getByTestId("url-search").textContent ?? "");

/** Botón de una mesa del plano, por su nombre (el estado va detrás). */
const botonMesa = (nombre: string) =>
  screen.getByRole("button", { name: new RegExp(`^${nombre} · `) });

/**
 * Espera a que el panel tenga la fila de esa reserva.
 *
 * Se ancla en el asa de arrastre porque su etiqueta es ÚNICA y no cambia según
 * la reserva tenga mesa o no; el nombre a secas sale dos veces (panel y cartel
 * del plano) en cuanto está sentada.
 */
const esperarReserva = (nombre: string) =>
  screen.findByRole("button", { name: `Arrastrar ${nombre} al plano` });

/** Fila del panel de esa reserva, para leer sus mesas y sus plazas. */
const filaDe = (nombre: string) =>
  screen
    .getByRole("button", { name: `Arrastrar ${nombre} al plano` })
    .closest("div.rounded-lg") as HTMLElement;

/** Mesas que el almacén tiene asignadas a una reserva. */
const mesasEnAlmacen = (reservaId: string) =>
  h.store.asignaciones.filter((a) => a.reserva_id === reservaId).map((a) => a.mesa_id);

const rpcDeAsignacion = () =>
  h.store.llamadasRpc.filter((l) => l.nombre === "asignar_mesas_reserva");

const ultimoRpc = () => rpcDeAsignacion().at(-1);

const avisos = (metodo: "success" | "error" | "warning" | "info") =>
  vi.mocked(toast[metodo]).mock.calls.map((c) => String(c[0]));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PlanoEspacio2D · asignación de mesas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.store.asignaciones = [];
    h.store.llamadasRpc = [];
    h.store.llamadasEq = [];
    h.store.errorRpc = null;
    h.store.contador = 0;
    h.store.config = { asignacion_mesas_excluidas: [] };
  });

  // ── Lectura: día, turno y sala ───────────────────────────────────────────

  it("solo pide las reservas de ESTA sala y ESTE día", async () => {
    montar();
    await esperarReserva("Familia Pérez");

    const deReservas = h.store.llamadasEq.filter((l) => l.tabla === "reservas");
    expect(deReservas).toEqual(
      expect.arrayContaining([
        { tabla: "reservas", columna: "fecha", valor: FECHA },
        { tabla: "reservas", columna: "espacio_id", valor: ESPACIO },
      ]),
    );
  });

  it("toma el día del parámetro `fecha` de la URL", async () => {
    montar({ ruta: "/reservas?fecha=2026-10-01&turno=comida" });
    await waitFor(() =>
      expect(h.store.llamadasEq).toEqual(
        expect.arrayContaining([{ tabla: "reservas", columna: "fecha", valor: "2026-10-01" }]),
      ),
    );
    expect(screen.getAllByText(/jueves, 1 de octubre de 2026/i).length).toBeGreaterThan(0);
  });

  it("ignora un `fecha` de la URL que no sea una fecha de calendario", async () => {
    montar({ ruta: "/reservas?fecha=2026-02-30&turno=comida" });
    await esperarReserva("Familia Pérez");
    const fechas = h.store.llamadasEq.filter((l) => l.columna === "fecha").map((l) => l.valor);
    expect(fechas).not.toContain("2026-02-30");
  });

  it("la prop `fecha` manda sobre la URL (la sigue pasando el calendario)", async () => {
    montar({ ruta: "/reservas?fecha=2026-10-01&turno=comida", fechaProp: "2026-11-05" });
    await waitFor(() =>
      expect(h.store.llamadasEq).toEqual(
        expect.arrayContaining([{ tabla: "reservas", columna: "fecha", valor: "2026-11-05" }]),
      ),
    );
  });

  it("el paso de día mueve la fecha y la guarda en la URL", async () => {
    montar({ ruta: `/reservas?fecha=${FECHA}&turno=comida` });
    await esperarReserva("Familia Pérez");

    fireEvent.click(screen.getByRole("button", { name: "Día siguiente" }));
    await waitFor(() =>
      expect(h.store.llamadasEq).toEqual(
        expect.arrayContaining([{ tabla: "reservas", columna: "fecha", valor: "2026-09-27" }]),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Día anterior" }));
    await waitFor(() =>
      expect(h.store.llamadasEq.filter((l) => l.valor === FECHA).length).toBeGreaterThan(1),
    );
  });

  it("el botón Hoy vuelve al día de hoy", async () => {
    montar({ ruta: "/reservas?fecha=2026-10-01&turno=comida" });
    await waitFor(() =>
      expect(h.store.llamadasEq).toEqual(
        expect.arrayContaining([{ tabla: "reservas", columna: "fecha", valor: "2026-10-01" }]),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Hoy" }));
    await waitFor(() =>
      expect(h.store.llamadasEq).toEqual(
        expect.arrayContaining([
          { tabla: "reservas", columna: "fecha", valor: hoyLocal() },
        ]),
      ),
    );
  });

  it("cambiar de día o de turno deja de sentar a la reserva que había", async () => {
    montar();
    await esperarReserva("Familia Pérez");

    fireEvent.click(screen.getByRole("button", { name: "Sentar a Familia Pérez" }));
    expect(screen.getByText(/Sentando a/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Cena" }));
    await waitFor(() => expect(screen.queryByText(/Sentando a/)).not.toBeInTheDocument());
  });

  it("separa las reservas en 'Pendientes de mesa' y 'Con mesa'", async () => {
    montar({ asignaciones: [{ id: "a1", reserva_id: "r-ana", mesa_id: "m5" }] });

    expect(await screen.findByText("Pendientes de mesa")).toBeInTheDocument();
    expect(await screen.findByText("Con mesa")).toBeInTheDocument();
    // Ana ya tiene la Mesa 5; Pérez sigue pendiente.
    expect(screen.getByRole("button", { name: "Cambiar mesas de Ana López" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sentar a Familia Pérez" })).toBeInTheDocument();
  });

  it("nunca llama error a una reserva sin mesa: la llama 'pendiente de mesa'", async () => {
    montar();
    await esperarReserva("Familia Pérez");
    expect(screen.getAllByText(/Pendiente de mesa/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Sin mesa no es un error/i)).toBeInTheDocument();
  });

  // ── Filtro de turno ───────────────────────────────────────────────────────

  it("el filtro de turno separa los dos servicios del día", async () => {
    montar();
    await esperarReserva("Familia Pérez");

    // Turno comida: Pérez (14:00) y Ana (13:30); no la cena de Romero.
    expect(screen.getByText("Ana López")).toBeInTheDocument();
    expect(screen.queryByText("Cena Romero")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Cena" }));

    expect(await screen.findByText("Cena Romero")).toBeInTheDocument();
    expect(screen.queryByText("Familia Pérez")).not.toBeInTheDocument();
    expect(screen.queryByText("Ana López")).not.toBeInTheDocument();
  });

  it("una mesa ocupada en la comida sale LIBRE en la cena", async () => {
    montar({ asignaciones: [{ id: "a1", reserva_id: "r-ana", mesa_id: "m5" }] });

    await waitFor(() =>
      expect(botonMesa("Mesa 5")).toHaveAccessibleName(/ocupada por Ana López a las 13:30/),
    );

    fireEvent.click(screen.getByRole("radio", { name: "Cena" }));

    await waitFor(() => expect(botonMesa("Mesa 5")).toHaveAccessibleName(/· libre$/));
  });

  it("la insignia de turno en cada fila solo sale en 'Todo el día'", async () => {
    montar();
    await esperarReserva("Familia Pérez");
    // Con un turno elegido todas las filas son de ese turno: la insignia sobra
    // y el sitio lo necesita el nombre.
    expect(filaDe("Familia Pérez")).not.toHaveTextContent("Comida");

    fireEvent.click(screen.getByRole("radio", { name: "Todo el día" }));

    await waitFor(() => expect(filaDe("Familia Pérez")).toHaveTextContent("Comida"));
    expect(filaDe("Cena Romero")).toHaveTextContent("Cena");
  });

  it("avisa de que 'todo el día' mezcla los dos servicios", async () => {
    montar();
    await esperarReserva("Familia Pérez");
    fireEvent.click(screen.getByRole("radio", { name: "Todo el día" }));
    expect(await screen.findByText(/los dos servicios a la vez/i)).toBeInTheDocument();
  });

  // ── Entrar señalando una reserva concreta ─────────────────────────────────
  //
  // El caso que hay que proteger: el plano abre en COMIDA (`?turno=comida`) y
  // se señala una reserva de CENA. Si el turno no acabara en cena, el salto
  // llevaría a un panel donde esa reserva NO está.
  //
  // Hay DOS vías y las dos se prueban:
  //   · la buena, la del salto de verdad: el turno llega hecho en la prop
  //     `turno` (lo deduce `saltoAsignacion.ts` de la hora) y entra al montar;
  //   · el respaldo, para `?reserva=` de la URL, que no trae prop: ahí el turno
  //     se deduce de la hora de la reserva ya dentro del plano.

  it("con el turno en la prop, abre en ese turno aunque la URL diga otro", async () => {
    // Nada de `reservaId`: se prueba SOLO la prioridad del turno.
    montar({ ruta: `/reservas?fecha=${FECHA}&turno=comida`, turnoProp: "cena" });

    expect(await screen.findByText("Cena Romero")).toBeInTheDocument();
    expect(screen.queryByText("Familia Pérez")).not.toBeInTheDocument();
  });

  it("el salto por prop abre en el turno de la reserva y la deja activa", async () => {
    // Justo el caso medido en el navegador: mediodía, reserva de cena.
    montar({ reservaIdProp: "r-romero", turnoProp: "cena" });

    await esperarReserva("Cena Romero");
    expect(screen.queryByText("Familia Pérez")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Dejar de elegir mesa para Cena Romero" }),
    ).toBeInTheDocument();
  });

  it("el turno deducido de la hora no pisa el que manda el padre", async () => {
    // Combinación que en la práctica no se da (prop `turno` y `reservaId`
    // salen del MISMO destino), pero fija quién manda: la prop.
    montar({ reservaIdProp: "r-ana", turnoProp: "cena" });

    await screen.findByText("Cena Romero");
    expect(screen.queryByText("Ana López")).not.toBeInTheDocument();
  });

  it("dos saltos seguidos a turnos distintos sin volver a montar el plano", async () => {
    const { saltarA } = montar({ reservaIdProp: "r-romero", turnoProp: "cena" });
    await esperarReserva("Cena Romero");

    saltarA("r-ana", "comida");

    await esperarReserva("Ana López");
    expect(
      screen.getByRole("button", { name: "Dejar de elegir mesa para Ana López" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Cena Romero")).not.toBeInTheDocument();
  });

  it("un salto nuevo al mismo turno lo recoloca aunque el usuario lo hubiera cambiado", async () => {
    const { saltarA } = montar({
      // Dos cenas distintas: el segundo salto trae la MISMA prop `turno`, así
      // que lo único que cambia es la reserva.
      reservas: [...RESERVAS, reserva("r-vidal", "Cena Vidal", "21:30:00", 2)],
      reservaIdProp: "r-romero",
      turnoProp: "cena",
    });
    await esperarReserva("Cena Romero");

    // El encargado se va a mirar la comida...
    fireEvent.click(screen.getByRole("radio", { name: "Comida" }));
    await esperarReserva("Familia Pérez");

    // ...y desde la lista le mandan otra cena. Como `turno` vale lo mismo que
    // antes, sin mirar también a la reserva el filtro se quedaría en comida y
    // la reserva a sentar no saldría.
    saltarA("r-vidal", "cena");
    await esperarReserva("Cena Vidal");
    expect(
      screen.getByRole("button", { name: "Dejar de elegir mesa para Cena Vidal" }),
    ).toBeInTheDocument();
  });

  it("sin prop, el `?reserva=` de la URL sigue deduciendo el turno de la hora", async () => {
    montar({ ruta: `/reservas?fecha=${FECHA}&turno=comida&reserva=r-romero` });

    await esperarReserva("Cena Romero");
    expect(screen.queryByText("Familia Pérez")).not.toBeInTheDocument();
  });

  it("señalar una reserva de cena abriendo en comida mueve el turno al suyo", async () => {
    montar({ reservaIdProp: "r-romero" });

    // Sale la de cena...
    await esperarReserva("Cena Romero");
    // ...y ya no las de comida: el turno es el de la reserva señalada.
    expect(screen.queryByText("Familia Pérez")).not.toBeInTheDocument();
    expect(screen.queryByText("Ana López")).not.toBeInTheDocument();
  });

  it("deja la reserva señalada activa y lista para sentar", async () => {
    montar({ reservaIdProp: "r-romero" });
    await esperarReserva("Cena Romero");

    // El botón de su fila ya está en "Eligiendo" y la barra de trabajo abierta.
    expect(
      screen.getByRole("button", { name: "Dejar de elegir mesa para Cena Romero" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Sentando a/)).toBeInTheDocument();
  });

  it("se asoma a la tarjeta de la reserva señalada, aunque el panel sea largo", async () => {
    // jsdom no implementa `scrollIntoView`; se pone uno de mentira que apunte
    // sobre QUÉ elemento se ha llamado.
    const asomadas: HTMLElement[] = [];
    const original = (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView = function (
      this: HTMLElement,
    ) {
      asomadas.push(this);
    };

    try {
      montar({ reservaIdProp: "r-romero" });
      await esperarReserva("Cena Romero");

      await waitFor(() =>
        expect(asomadas.some((el) => el.dataset.reservaFila === "r-romero")).toBe(true),
      );
    } finally {
      (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView = original;
    }
  });

  it("hace lo mismo cuando la reserva llega por `?reserva=` de la URL", async () => {
    montar({ ruta: `/reservas?fecha=${FECHA}&turno=comida&reserva=r-romero` });

    await esperarReserva("Cena Romero");
    expect(screen.queryByText("Familia Pérez")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Dejar de elegir mesa para Cena Romero" }),
    ).toBeInTheDocument();
  });

  it("la prop manda sobre el `?reserva=` de la URL", async () => {
    montar({
      ruta: `/reservas?fecha=${FECHA}&turno=cena&reserva=r-romero`,
      reservaIdProp: "r-ana",
    });

    await esperarReserva("Ana López");
    expect(
      screen.getByRole("button", { name: "Dejar de elegir mesa para Ana López" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Cena Romero")).not.toBeInTheDocument();
  });

  it("si la reserva señalada no es de esta sala ni de este día, avisa sin romper nada", async () => {
    montar({ reservaIdProp: "r-de-otra-sala" });

    // El plano se queda como estaba: mismo día, mismo turno, todo en su sitio.
    await esperarReserva("Familia Pérez");
    await waitFor(() => expect(avisos("info").join(" ")).toMatch(/no está en Salón/i));
    // Ni rojo ni lenguaje de error.
    expect(avisos("error")).toHaveLength(0);
    // Y no queda ninguna reserva sentándose.
    expect(screen.queryByText(/Sentando a/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sentar a Familia Pérez" })).toBeInTheDocument();
  });

  it("consume `?reserva=` y lo borra de la URL, dejando fecha y turno", async () => {
    montar({ ruta: `/reservas?fecha=${FECHA}&turno=comida&reserva=r-romero` });
    await esperarReserva("Cena Romero");

    // Se borra para que al cambiar de día (o al recargar) no se vuelva a
    // preseleccionar una reserva que ya no pinta nada ahí.
    await waitFor(() => expect(paramsUrl().get("reserva")).toBeNull());
    expect(paramsUrl().get("fecha")).toBe(FECHA);
    // Y el turno que queda guardado es el DERIVADO de la reserva.
    expect(paramsUrl().get("turno")).toBe("cena");
  });

  it("dos saltos seguidos a reservas distintas sin volver a montar el plano", async () => {
    const { saltarA } = montar({ reservaIdProp: "r-romero" });
    await esperarReserva("Cena Romero");

    saltarA("r-ana");

    // Vuelve a comida, con Ana activa: el segundo encargo se atiende igual.
    await esperarReserva("Ana López");
    expect(
      screen.getByRole("button", { name: "Dejar de elegir mesa para Ana López" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Cena Romero")).not.toBeInTheDocument();
  });

  it("no se le pelea el turno al usuario si lo cambia a mano tras el salto", async () => {
    montar({ reservaIdProp: "r-romero" });
    await esperarReserva("Cena Romero");

    fireEvent.click(screen.getByRole("radio", { name: "Comida" }));

    // El salto ya se consumió: nadie devuelve el filtro a cena.
    await esperarReserva("Familia Pérez");
    expect(screen.queryByText("Cena Romero")).not.toBeInTheDocument();
  });

  // ── Sentar en 2 clics ─────────────────────────────────────────────────────

  it("sienta una reserva en dos clics: reserva y mesa", async () => {
    montar();
    await esperarReserva("Ana López");

    fireEvent.click(screen.getByRole("button", { name: "Sentar a Ana López" }));
    fireEvent.click(botonMesa("Mesa 5"));

    await waitFor(() => expect(rpcDeAsignacion()).toHaveLength(1));
    expect(ultimoRpc()!.args).toEqual({ p_reserva_id: "r-ana", p_mesa_ids: ["m5"] });

    // Y se ve quién ocupa la mesa, con su hora.
    await waitFor(() =>
      expect(botonMesa("Mesa 5")).toHaveAccessibleName(/ocupada por Ana López a las 13:30/),
    );
    expect(avisos("success").join(" ")).toMatch(/Ana López → Mesa 5/);
  });

  it("al cuadrar las plazas cierra la barra para pasar a la siguiente reserva", async () => {
    montar();
    await esperarReserva("Ana López");

    fireEvent.click(screen.getByRole("button", { name: "Sentar a Ana López" }));
    expect(screen.getByText(/Sentando a/)).toBeInTheDocument();

    fireEvent.click(botonMesa("Mesa 5"));
    await waitFor(() => expect(screen.queryByText(/Sentando a/)).not.toBeInTheDocument());
  });

  // ── Capacidad: AVISO, nunca bloqueo ───────────────────────────────────────

  it("deja sentar 6 comensales en una mesa de 4 y avisa sin bloquear", async () => {
    montar();
    await esperarReserva("Familia Pérez");

    fireEvent.click(screen.getByRole("button", { name: "Sentar a Familia Pérez" }));
    fireEvent.click(botonMesa("Mesa 4"));

    // SE GUARDA: esto es lo que el bloqueo anterior hacía imposible.
    await waitFor(() => expect(rpcDeAsignacion()).toHaveLength(1));
    expect(ultimoRpc()!.args).toEqual({ p_reserva_id: "r-perez", p_mesa_ids: ["m4"] });

    // Y se avisa de que faltan 2 plazas, invitando a juntar otra mesa.
    await waitFor(() => expect(avisos("warning").join(" ")).toMatch(/faltan 2/i));
    expect(avisos("warning").join(" ")).toMatch(/juntar otra mesa/i);
    expect(avisos("error")).toHaveLength(0);
  });

  it("la barra se queda abierta cuando no caben, con las plazas que faltan", async () => {
    montar();
    await esperarReserva("Familia Pérez");

    fireEvent.click(screen.getByRole("button", { name: "Sentar a Familia Pérez" }));
    fireEvent.click(botonMesa("Mesa 4"));

    const barra = await screen.findByText(/Sentando a/);
    const caja = barra.closest("div")!.parentElement!;
    await waitFor(() => expect(caja).toHaveTextContent(/= 4 plazas para 6/));
    expect(caja).toHaveTextContent(/Faltan 2 plazas/);
  });

  // ── Juntar mesas ──────────────────────────────────────────────────────────

  it("junta la Mesa 4 y la Mesa 5 para los 6 de Pérez, en una sola operación", async () => {
    montar();
    await esperarReserva("Familia Pérez");

    fireEvent.click(screen.getByRole("button", { name: "Sentar a Familia Pérez" }));
    fireEvent.click(botonMesa("Mesa 4"));
    await waitFor(() => expect(rpcDeAsignacion()).toHaveLength(1));

    fireEvent.click(botonMesa("Mesa 5"));
    await waitFor(() => expect(rpcDeAsignacion()).toHaveLength(2));

    // El RPC recibe la lista COMPLETA, no un añadido suelto.
    expect(ultimoRpc()!.args).toEqual({ p_reserva_id: "r-perez", p_mesa_ids: ["m4", "m5"] });

    // Y se ve que la 4 + la 5 hacen 6 para 6 comensales.
    await waitFor(() => expect(filaDe("Familia Pérez")).toHaveTextContent("Mesa 4 + Mesa 5"));
    expect(filaDe("Familia Pérez")).toHaveTextContent("6/6");
  });

  it("las dos mesas juntas se ven como un solo grupo en el plano", async () => {
    montar({
      asignaciones: [
        { id: "a1", reserva_id: "r-perez", mesa_id: "m4" },
        { id: "a2", reserva_id: "r-perez", mesa_id: "m5" },
      ],
    });

    await waitFor(() =>
      expect(botonMesa("Mesa 4")).toHaveAccessibleName(/ocupada por Familia Pérez/),
    );
    expect(botonMesa("Mesa 5")).toHaveAccessibleName(/ocupada por Familia Pérez/);
    // Un solo cartel con el nombre, y la otra marcada como "Junta".
    expect(screen.getAllByText("Familia Pérez")).toHaveLength(2); // panel + cartel
    expect(screen.getByText("Junta")).toBeInTheDocument();
  });

  // ── Mover de mesa ─────────────────────────────────────────────────────────

  it("mueve una reserva de mesa: se añade la nueva y se suelta la vieja", async () => {
    montar({ asignaciones: [{ id: "a1", reserva_id: "r-ana", mesa_id: "m5" }] });
    await esperarReserva("Ana López");

    fireEvent.click(screen.getByRole("button", { name: "Cambiar mesas de Ana López" }));
    fireEvent.click(botonMesa("Mesa 6"));
    await waitFor(() => expect(ultimoRpc()!.args.p_mesa_ids).toEqual(["m5", "m6"]));

    fireEvent.click(screen.getByRole("button", { name: "Cambiar mesas de Ana López" }));
    fireEvent.click(botonMesa("Mesa 5"));
    await waitFor(() => expect(ultimoRpc()!.args.p_mesa_ids).toEqual(["m6"]));

    await waitFor(() => expect(botonMesa("Mesa 5")).toHaveAccessibleName(/· libre$/));
    expect(botonMesa("Mesa 6")).toHaveAccessibleName(/ocupada por Ana López/);
  });

  // ── Quitar mesas: confirmación y sin lenguaje de error ────────────────────

  it("pide confirmación antes de quitarle las mesas a una reserva", async () => {
    montar({ asignaciones: [{ id: "a1", reserva_id: "r-ana", mesa_id: "m5" }] });
    await esperarReserva("Ana López");

    fireEvent.click(screen.getByRole("button", { name: "Quitar mesas de Ana López" }));

    const dialogo = await screen.findByRole("alertdialog");
    expect(dialogo).toHaveTextContent(/¿Quitar las mesas de Ana López\?/i);
    // Y lo explica sin llamarlo error.
    expect(dialogo).toHaveTextContent(/pendiente de mesa/i);
    expect(dialogo).toHaveTextContent(/La reserva sigue en pie/i);
    expect(rpcDeAsignacion()).toHaveLength(0);
  });

  it("no quita nada si se cancela la confirmación", async () => {
    montar({ asignaciones: [{ id: "a1", reserva_id: "r-ana", mesa_id: "m5" }] });
    await esperarReserva("Ana López");

    fireEvent.click(screen.getByRole("button", { name: "Quitar mesas de Ana López" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(rpcDeAsignacion()).toHaveLength(0);
    expect(botonMesa("Mesa 5")).toHaveAccessibleName(/ocupada por Ana López/);
  });

  it("al confirmar manda una lista vacía y la reserva queda pendiente de mesa", async () => {
    montar({ asignaciones: [{ id: "a1", reserva_id: "r-ana", mesa_id: "m5" }] });
    await esperarReserva("Ana López");

    fireEvent.click(screen.getByRole("button", { name: "Quitar mesas de Ana López" }));
    fireEvent.click(await screen.findByRole("button", { name: "Quitar las mesas" }));

    await waitFor(() => expect(rpcDeAsignacion()).toHaveLength(1));
    expect(ultimoRpc()!.args).toEqual({ p_reserva_id: "r-ana", p_mesa_ids: [] });

    await waitFor(() => expect(botonMesa("Mesa 5")).toHaveAccessibleName(/· libre$/));
    expect(avisos("success").join(" ")).toMatch(/Ana López se queda pendiente de mesa/);
    expect(avisos("error")).toHaveLength(0);
  });

  it("quitar la última mesa desde el plano también pide confirmación", async () => {
    montar({ asignaciones: [{ id: "a1", reserva_id: "r-ana", mesa_id: "m5" }] });
    await esperarReserva("Ana López");

    fireEvent.click(screen.getByRole("button", { name: "Cambiar mesas de Ana López" }));
    // Volver a hacer clic en su única mesa = quitársela → confirmación.
    fireEvent.click(botonMesa("Mesa 5"));

    expect(await screen.findByRole("alertdialog")).toHaveTextContent(/¿Quitar las mesas de Ana López\?/i);
    expect(rpcDeAsignacion()).toHaveLength(0);
  });

  // ── Dos camareros peleando por la misma mesa ──────────────────────────────

  it("explica en español que otro se ha quedado la mesa y refresca el plano", async () => {
    montar();
    await esperarReserva("Familia Pérez");

    // Otro camarero sienta a Ana en la Mesa 4 mientras esta pantalla tiene su
    // caché antigua: para ella la Mesa 4 sigue libre.
    h.store.asignaciones.push({ id: "a-otro", reserva_id: "r-ana", mesa_id: "m4" });
    expect(botonMesa("Mesa 4")).toHaveAccessibleName(/· libre$/);

    fireEvent.click(screen.getByRole("button", { name: "Sentar a Familia Pérez" }));
    fireEvent.click(botonMesa("Mesa 4"));

    // La base de datos rechaza y el mensaje llega traducido, nombrando la mesa.
    await waitFor(() => expect(avisos("error").join(" ")).toMatch(/ya está asignada a otra reserva/i));
    expect(avisos("error").join(" ")).toMatch(/Mesa 4/);

    // Y el plano se refresca con la verdad: la Mesa 4 es de Ana.
    await waitFor(() => expect(botonMesa("Mesa 4")).toHaveAccessibleName(/ocupada por Ana López/));
    // Pérez no se ha quedado con una asignación fantasma...
    expect(mesasEnAlmacen("r-perez")).toEqual([]);
    // ...y la barra sigue abierta para poder elegirle otra mesa sin empezar de cero.
    expect(
      screen.getByRole("button", { name: "Dejar de elegir mesa para Familia Pérez" }),
    ).toBeInTheDocument();
  });

  it("traduce también los demás errores del contrato del RPC", async () => {
    montar();
    await esperarReserva("Ana López");

    h.store.errorRpc = "RESERVA_SIN_SALA: la reserva no tiene sala";
    fireEvent.click(screen.getByRole("button", { name: "Sentar a Ana López" }));
    fireEvent.click(botonMesa("Mesa 5"));

    await waitFor(() =>
      expect(avisos("error").join(" ")).toMatch(/hay que darle sala a la reserva/i),
    );
  });

  it("avisa sin ir al servidor si la mesa ya es de otra reserva del turno", async () => {
    montar({ asignaciones: [{ id: "a1", reserva_id: "r-ana", mesa_id: "m4" }] });
    await esperarReserva("Familia Pérez");

    fireEvent.click(screen.getByRole("button", { name: "Sentar a Familia Pérez" }));
    fireEvent.click(botonMesa("Mesa 4"));

    await waitFor(() => expect(avisos("error").join(" ")).toMatch(/Mesa 4 ya es de Ana López/));
    expect(rpcDeAsignacion()).toHaveLength(0);
  });

  // ── Deshacer ──────────────────────────────────────────────────────────────

  it("no ofrece deshacer hasta que hay algo que deshacer", async () => {
    montar();
    await esperarReserva("Ana López");
    expect(screen.getByRole("button", { name: /Deshacer/ })).toBeDisabled();
  });

  it("deshace la última asignación devolviendo la reserva a como estaba", async () => {
    montar();
    await esperarReserva("Ana López");

    fireEvent.click(screen.getByRole("button", { name: "Sentar a Ana López" }));
    fireEvent.click(botonMesa("Mesa 5"));
    await waitFor(() => expect(rpcDeAsignacion()).toHaveLength(1));

    const deshacer = screen.getByRole("button", { name: /Deshacer/ });
    await waitFor(() => expect(deshacer).not.toBeDisabled());
    fireEvent.click(deshacer);

    await waitFor(() => expect(rpcDeAsignacion()).toHaveLength(2));
    expect(ultimoRpc()!.args).toEqual({ p_reserva_id: "r-ana", p_mesa_ids: [] });

    await waitFor(() => expect(botonMesa("Mesa 5")).toHaveAccessibleName(/· libre$/));
    expect(avisos("success").join(" ")).toMatch(/Deshecho: Ana López vuelve a estar pendiente de mesa/);
  });

  it("deshace también una desasignación, devolviendo la mesa que tenía", async () => {
    montar({ asignaciones: [{ id: "a1", reserva_id: "r-ana", mesa_id: "m5" }] });
    await esperarReserva("Ana López");

    fireEvent.click(screen.getByRole("button", { name: "Quitar mesas de Ana López" }));
    fireEvent.click(await screen.findByRole("button", { name: "Quitar las mesas" }));
    await waitFor(() => expect(botonMesa("Mesa 5")).toHaveAccessibleName(/· libre$/));

    fireEvent.click(screen.getByRole("button", { name: /Deshacer/ }));

    await waitFor(() => expect(ultimoRpc()!.args.p_mesa_ids).toEqual(["m5"]));
    await waitFor(() => expect(botonMesa("Mesa 5")).toHaveAccessibleName(/ocupada por Ana López/));
  });

  // ── Estado de cierre del día ──────────────────────────────────────────────

  it("enseña cuántas reservas tienen mesa y cuántas siguen pendientes", async () => {
    montar({ asignaciones: [{ id: "a1", reserva_id: "r-ana", mesa_id: "m5" }] });

    await esperarReserva("Ana López");

    await waitFor(() =>
      expect(screen.getByTitle("Reservas que ya tienen mesa")).toHaveTextContent("1 con mesa"),
    );
    expect(
      screen.getByTitle(/Tienen sala pero todavía no mesa/i),
    ).toHaveTextContent("1 pendientes de mesa");
    expect(screen.getByTitle(/Mesas de esta sala libres/i)).toHaveTextContent("2/3 mesas libres");
    expect(screen.getByTitle("Comensales del turno")).toHaveTextContent("8 comensales");
  });

  it("marca el servicio como cerrado cuando ya no queda nada por repartir", async () => {
    montar({
      asignaciones: [
        { id: "a1", reserva_id: "r-ana", mesa_id: "m5" },
        { id: "a2", reserva_id: "r-perez", mesa_id: "m6" },
      ],
    });

    expect(await screen.findByText("Servicio cerrado")).toBeInTheDocument();
  });

  it("no dice 'cerrado' mientras quede alguna reserva sin mesa", async () => {
    montar({ asignaciones: [{ id: "a1", reserva_id: "r-ana", mesa_id: "m5" }] });
    await esperarReserva("Ana López");
    expect(screen.queryByText("Servicio cerrado")).not.toBeInTheDocument();
  });

  // ── Sala vacía ────────────────────────────────────────────────────────────

  it("dice que no hay reservas del servicio sin hablar de errores", async () => {
    montar({ reservas: [] });
    expect(await screen.findByText(/Sin reservas en comida/i)).toBeInTheDocument();
    expect(screen.getByText(/solo salen las reservas que ya tienen esta sala/i)).toBeInTheDocument();
  });

  // ── Detalle de mesa ───────────────────────────────────────────────────────

  it("al hacer clic en una mesa ocupada dice quién la tiene", async () => {
    montar({ asignaciones: [{ id: "a1", reserva_id: "r-ana", mesa_id: "m5" }] });
    await esperarReserva("Ana López");

    fireEvent.click(botonMesa("Mesa 5"));

    const ficha = await screen.findByText("Ocupada por");
    const caja = ficha.closest("div")!;
    expect(within(caja).getByText("Ana López")).toBeInTheDocument();
    expect(caja).toHaveTextContent("13:30");
  });

  // ── Mesas que no se ofrecen al asignar (Configuración) ──────────────────────
  // `configuracion_reservas.asignacion_mesas_excluidas` (reservas-sin-salas,
  // Fase B): no cambian el aforo, pero no se ofrecen al sentar a nadie.

  it("una mesa excluida se ve como no ofrecida y no se asigna: avisa sin ir al servidor", async () => {
    h.store.config = { asignacion_mesas_excluidas: ["m5"] };
    montar();
    await esperarReserva("Ana López");

    fireEvent.click(screen.getByRole("button", { name: "Sentar a Ana López" }));
    await waitFor(() => expect(botonMesa("Mesa 5")).toHaveAccessibleName(/no se ofrece al asignar/));
    expect(botonMesa("Mesa 4")).not.toHaveAccessibleName(/no se ofrece/);

    fireEvent.click(botonMesa("Mesa 5"));
    await waitFor(() => expect(avisos("error").join(" ")).toMatch(/Mesa 5 no se ofrece al asignar/));
    expect(rpcDeAsignacion()).toHaveLength(0);
  });

  it("juntar una excluida a la mesa que ya tiene también se bloquea", async () => {
    h.store.config = { asignacion_mesas_excluidas: ["m6"] };
    montar();
    await esperarReserva("Familia Pérez");

    // Una mesa usable sí se sigue asignando con normalidad.
    fireEvent.click(screen.getByRole("button", { name: "Sentar a Familia Pérez" }));
    fireEvent.click(botonMesa("Mesa 4"));
    await waitFor(() => expect(rpcDeAsignacion()).toHaveLength(1));
    expect(ultimoRpc()!.args).toEqual({ p_reserva_id: "r-perez", p_mesa_ids: ["m4"] });

    // Añadir la excluida a la que ya tiene: bloqueado, sin segunda llamada.
    fireEvent.click(botonMesa("Mesa 6"));
    await waitFor(() => expect(avisos("error").join(" ")).toMatch(/Mesa 6 no se ofrece al asignar/));
    expect(rpcDeAsignacion()).toHaveLength(1);
  });

  it("una mesa excluida que la reserva YA tenía no bloquea soltar las demás", async () => {
    h.store.config = { asignacion_mesas_excluidas: ["m5"] };
    montar({
      asignaciones: [
        { id: "a1", reserva_id: "r-perez", mesa_id: "m4" },
        { id: "a2", reserva_id: "r-perez", mesa_id: "m5" },
      ],
    });
    await esperarReserva("Familia Pérez");

    fireEvent.click(screen.getByRole("button", { name: "Cambiar mesas de Familia Pérez" }));
    fireEvent.click(botonMesa("Mesa 4"));

    await waitFor(() => expect(rpcDeAsignacion()).toHaveLength(1));
    expect(ultimoRpc()!.args).toEqual({ p_reserva_id: "r-perez", p_mesa_ids: ["m5"] });
  });

  it("Repartir no usa las mesas excluidas", async () => {
    // Sin exclusiones, los 6 de Pérez irían a la Mesa 6 (la justa).
    h.store.config = { asignacion_mesas_excluidas: ["m6"] };
    montar();
    await esperarReserva("Familia Pérez");

    fireEvent.click(screen.getByRole("button", { name: /Repartir/ }));

    await waitFor(() => expect(rpcDeAsignacion().length).toBeGreaterThan(0));
    const usadas = rpcDeAsignacion().flatMap((l) => l.args.p_mesa_ids as string[]);
    expect(usadas).not.toContain("m6");
  });
});
