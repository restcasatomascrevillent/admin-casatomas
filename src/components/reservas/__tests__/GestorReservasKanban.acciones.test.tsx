/**
 * Kanban de «Hoy» (`GestorReservasKanban`): la TARJETA de una reserva — tests de
 * EFECTOS.
 *
 * Fijan lo que hace cada acción de la tarjeta: la estrella («importante»), «Ha
 * llegado» / «No vino» (vía `ControlLlegada`), «Mover a…» y «Añadir a blacklist».
 * Lo que se afirma son efectos y mutaciones —qué se escribe y con qué filtros,
 * quién manda correo (nadie), qué cachés se refrescan, qué pasa con una escritura
 * denegada por RLS, qué pasa sin permiso de edición, cuándo se avisa antes de
 * mover—, NO el número de botones: los controles se buscan por su nombre accesible.
 *
 * PASO 1 del refactor de acciones. Este fichero nació como caracterización del
 * kanban tal como estaba y dos de sus `// BUG conocido` pasaron a «corregido»:
 *   · el kanban no miraba el permiso de edición: ahora lo lee de
 *     `accionesDisponibles(reserva, { vista: "hoy", canEdit })` y deja deshabilitado
 *     —con el motivo visible— todo lo que escribe (estrella, llegada, no vino,
 *     deshacer, mover, lista negra);
 *   · mover de sala no avisaba de que el trigger de la BD borra las mesas asignadas
 *     ni las refrescaba: ahora pregunta antes (como Asignación) y las refresca.
 * PASO 2: la estrella pasa por el ejecutor único (`useAccionesServicioReserva.alternarImportante`)
 * y el último `// BUG conocido` (RLS denegada dada por buena en la estrella) pasa a
 * «corregido»: ahora pide la fila de vuelta, y avisa y revierte si no se guardó. La
 * estrella también refresca lo que enseña en el modo servicio y en el plano de sala, y
 * llegada / «No vino» refrescan además las mesas asignadas y la disponibilidad (lista
 * única de claves: `clavesCache.ts`).
 *
 * Nada llega a Supabase: el cliente y `sonner` están mockeados.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  /** Filas que devuelve la consulta del kanban. */
  reservas: [] as Record<string, unknown>[],
  /** Filas de `asignaciones_mesa` (mesas asignadas de hoy). */
  asignaciones: [] as Record<string, unknown>[],
  /** Cada escritura completa, en orden. */
  escrituras: [] as Array<{
    tabla: string;
    payload: Record<string, unknown>;
    eq: [string, unknown] | null;
    /** Condición de estado de partida (`.in("estado", …)`); `null` si la escritura no la lleva. */
    en: [string, unknown[]] | null;
    select: string | null;
  }>,
  /** Tablas a las que se ha llamado con `from(...)`, en orden. */
  tablas: [] as string[],
  /** Respuesta de la siguiente escritura (sin más: éxito). */
  respuestasEscritura: [] as Array<{ error?: unknown; data?: unknown }>,
  invoke: vi.fn(),
  /** Permiso de edición de «reservas». */
  canEdit: true,
  /** Últimas props con las que se pintó el modal de la lista negra. */
  modalBlacklist: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabla: string) => {
      h.tablas.push(tabla);
      const escritura = {
        tabla,
        payload: {} as Record<string, unknown>,
        eq: null as [string, unknown] | null,
        en: null as [string, unknown[]] | null,
        select: null as string | null,
      };
      let esEscritura = false;
      const b: Record<string, unknown> = {};
      b.select = (columnas: string) => {
        if (esEscritura) escritura.select = columnas;
        return b;
      };
      b.update = (payload: Record<string, unknown>) => {
        esEscritura = true;
        escritura.payload = { ...payload };
        h.escrituras.push(escritura);
        return b;
      };
      b.eq = (columna: string, valor: unknown) => {
        if (esEscritura) escritura.eq = [columna, valor];
        return b;
      };
      b.in = (columna: string, valores: unknown[]) => {
        if (esEscritura) escritura.en = [columna, valores];
        return b;
      };
      b.neq = () => b;
      b.order = () => b;
      b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
        if (!esEscritura) {
          const filas = tabla === "asignaciones_mesa" ? h.asignaciones : h.reservas;
          return Promise.resolve({ data: filas, error: null }).then(ok, ko);
        }
        const r = h.respuestasEscritura.shift() ?? {};
        // Sin `.select`, Supabase devuelve `data: null` también cuando la RLS deniega la escritura.
        const data = "data" in r ? r.data : r.error ? null : escritura.select ? [{ id: escritura.eq?.[1] }] : null;
        return Promise.resolve({ data, error: r.error ?? null }).then(ok, ko);
      };
      return b;
    },
    functions: { invoke: (...args: unknown[]) => h.invoke(...args) },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/hooks/useEspaciosReserva", () => ({
  useEspaciosReserva: () => ({
    data: [
      { id: "salon", nombre: "Salón", capacidad_maxima: 60, activa: true, caracteristicas: { marca: "casa_tomas" } },
      { id: "terraza", nombre: "Terraza", capacidad_maxima: 30, activa: true, caracteristicas: { marca: "casa_tomas" } },
    ],
  }),
}));
// Solo se sustituye el permiso; el resto del módulo es el de verdad.
vi.mock("@/hooks/useUserRole", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useUserRole")>()),
  useCanAccessSection: () => ({ canAccess: h.canEdit, loading: false }),
}));
vi.mock("@/components/reservas/BlacklistModal", () => ({
  BlacklistModal: (props: { reserva: { id: string } | null; open: boolean }) => {
    h.modalBlacklist(props.reserva?.id ?? null, props.open);
    return null;
  },
}));
// El mapa de mesas que se abre tras mover una reserva (`ElegirMesaDialog`, con su plano y su Router) tiene
// sus propios tests (`GestorReservasKanban.mapa.test.tsx`): aquí se aparta para que estos sigan hablando
// solo de lo que escribe y refresca cada acción de la tarjeta.
vi.mock("@/components/reservas/ElegirMesaDialog", () => ({ ElegirMesaDialog: () => null }));

import { toast } from "sonner";
import { GestorReservasKanban } from "@/components/reservas/GestorReservasKanban";
import { CLAVES_POR_CAMBIO } from "@/lib/reservas/clavesCache";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

const MOTIVO_SIN_PERMISO = "No tienes permiso para editar reservas";

const reserva = (id: string, estado: string, nombre: string, extra: Record<string, unknown> = {}) => ({
  id,
  nombre,
  telefono: "+34612345678",
  email: null,
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

/** Una fila de `asignaciones_mesa` tal como la trae `useAsignacionesMesa` (con la mesa dentro). */
const asignacion = (reservaId: string, mesaId: string, mesaNombre: string, espacioId = "salon") => ({
  id: `asig-${reservaId}-${mesaId}`,
  reserva_id: reservaId,
  mesa_id: mesaId,
  reservas: { id: reservaId },
  mesas: { id: mesaId, nombre: mesaNombre, capacidad: 4, espacio_id: espacioId },
});

/** Lo que refresca SIEMPRE una acción de estado o de sala: la lista única de `clavesCache.ts`. */
const CLAVES_DE_SERVICIO = [...CLAVES_POR_CAMBIO.ocupacion];
/** Cambiar la sala refresca lo mismo (incluidas las mesas asignadas: el trigger de la BD las borra). */
const CLAVES_AL_CAMBIAR_SALA = CLAVES_DE_SERVICIO;
/** Lo que refresca la estrella: las listas y lo que enseña en el modo servicio y en el plano de sala. */
const CLAVES_DE_LA_ESTRELLA = [...CLAVES_POR_CAMBIO.importante];

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
      <GestorReservasKanban />
    </QueryClientProvider>,
  );
  return { invalidadas };
}

/**
 * La tarjeta de ese cliente (el nombre accesible de la tarjeta empieza por el nombre).
 * `hidden`: con un menú de Radix abierto, el resto de la página queda `aria-hidden`.
 */
const tarjeta = async (cliente: string) =>
  await screen.findByRole("button", { name: new RegExp(`^${cliente},`), hidden: true });

/** Abre el menú «⋮» de la tarjeta de ese cliente (Radix abre con el teclado en jsdom). */
async function abrirMenu(cliente: string) {
  const disparador = await screen.findByRole("button", { name: new RegExp(`^Acciones de la reserva de ${cliente}`) });
  fireEvent.keyDown(disparador, { key: "Enter" });
  return await screen.findByRole("menu");
}

/** Espera a que el kanban tenga ya las mesas asignadas de hoy (se piden a la vez que las reservas). */
async function conMesasCargadas() {
  await waitFor(() => expect(h.tablas).toContain("asignaciones_mesa"));
  await act(async () => {});
}

/** Escrituras a `reservas`, sin ruido. */
const escrituras = () => h.escrituras.map(({ tabla, payload, eq, select }) => ({ tabla, payload, eq, select }));

let consolaError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  h.canEdit = true;
  h.escrituras = [];
  h.tablas = [];
  h.respuestasEscritura = [];
  h.asignaciones = [];
  h.reservas = [reserva("r-ana", "confirmada", "Ana")];
  consolaError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consolaError.mockRestore();
});

describe("tarjeta · la estrella («importante»)", () => {
  it("marcar: escribe `{ importante: true }` filtrando por id, AHORA pidiendo la fila de vuelta y sin condición de estado; refresca las listas y lo que enseña la estrella", async () => {
    const { invalidadas } = montar();

    fireEvent.click(within(await tarjeta("Ana")).getByRole("button", { name: "Marcar como importante" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Reserva marcada como importante"));
    expect(escrituras()).toEqual([
      { tabla: "reservas", payload: { importante: true }, eq: ["id", "r-ana"], select: "id" },
    ]);
    // La estrella vale en cualquier estado: la escritura no lleva condición de estado de partida.
    expect(h.escrituras[0].en).toBeNull();
    // Las tres listas y el modo servicio / plano de sala: los contadores y el dashboard no se
    // refrescan (la estrella no cambia ninguna cifra, pero sí el resaltado).
    await waitFor(() => expect(invalidadas).toEqual(CLAVES_DE_LA_ESTRELLA));
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("desmarcar: escribe `{ importante: false }` y avisa «Reserva desmarcada»", async () => {
    h.reservas = [reserva("r-ana", "confirmada", "Ana", { importante: true })];
    montar();

    fireEvent.click(within(await tarjeta("Ana")).getByRole("button", { name: "Quitar importante" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Reserva desmarcada"));
    expect(escrituras()[0].payload).toEqual({ importante: false });
  });

  it("si la BD falla: avisa con el mensaje, REFRESCA igual (antes no) y lo deja en el log", async () => {
    h.respuestasEscritura = [{ error: { code: "42501", message: "permission denied for table reservas" } }];
    const { invalidadas } = montar();

    fireEvent.click(within(await tarjeta("Ana")).getByRole("button", { name: "Marcar como importante" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("No se pudo actualizar la reserva: permission denied for table reservas"),
    );
    expect(toast.success).not.toHaveBeenCalled();
    // Como todas las acciones: el refresco está en el `finally`, y vuelve a enseñar lo que hay en la BD.
    await waitFor(() => expect(invalidadas).toEqual(CLAVES_DE_LA_ESTRELLA));
    expect(consolaError).toHaveBeenCalledWith("[servicio-reserva] Error al actualizar la reserva:", expect.anything());
  });

  it("CORREGIDO (antes BUG conocido): con la RLS denegando la escritura en silencio (sin error) NO da «marcada como importante»: avisa y revierte", async () => {
    // A diferencia de llegada / no vino / mover (`ErrorSinFilasReserva`), la estrella no pedía
    // la fila de vuelta: una escritura denegada por RLS devolvía `data: null` sin error y
    // pasaba por éxito. Con permiso denegado, el usuario leía «marcada» y no lo estaba.
    h.respuestasEscritura = [{ data: null }];
    montar();

    fireEvent.click(within(await tarjeta("Ana")).getByRole("button", { name: "Marcar como importante" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "No se pudo actualizar la reserva: no tienes permiso para cambiar esta reserva, o ya no existe.",
      ),
    );
    expect(toast.success).not.toHaveBeenCalled();
    // La estrella vuelve a quedar sin marcar (se deshace el parche en local).
    expect(await screen.findByRole("button", { name: "Marcar como importante" })).toBeInTheDocument();
  });

  it("sin permiso de edición la estrella sale deshabilitada, con el motivo visible, y no escribe", async () => {
    h.canEdit = false;
    montar();

    const estrella = within(await tarjeta("Ana")).getByRole("button", { name: "Marcar como importante" });

    expect(estrella).toBeDisabled();
    // Un botón deshabilitado no recibe el ratón: el motivo se ve en su envoltorio.
    expect(estrella.parentElement).toHaveAttribute("title", MOTIVO_SIN_PERMISO);
    fireEvent.click(estrella);
    expect(escrituras()).toEqual([]);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("con permiso la estrella no lleva ningún motivo", async () => {
    montar();

    const estrella = within(await tarjeta("Ana")).getByRole("button", { name: "Marcar como importante" });

    expect(estrella).toBeEnabled();
    expect(estrella.parentElement).not.toHaveAttribute("title");
  });
});

describe("tarjeta · «Ha llegado» y «No vino» (ControlLlegada)", () => {
  it("«Ha llegado»: estado 'completada' + llegada_at, con la fila de vuelta pedida; refresca las 11 claves y NO manda correo", async () => {
    const { invalidadas } = montar();

    fireEvent.click(await screen.findByRole("button", { name: "Marcar que Ana ha llegado" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Ana ha llegado", expect.anything()));
    const [escritura] = escrituras();
    expect(escritura).toMatchObject({ tabla: "reservas", eq: ["id", "r-ana"], select: "id", payload: { estado: "completada" } });
    expect(typeof escritura.payload.llegada_at).toBe("string");
    await waitFor(() => expect(invalidadas).toEqual(expect.arrayContaining(CLAVES_DE_SERVICIO)));
    // Llegar saca a la reserva de la vista de asignación (solo tiene las vivas): ahora también
    // refresca las mesas asignadas (antes solo lo hacía mover), el modo servicio y la disponibilidad.
    expect(invalidadas).toEqual(
      expect.arrayContaining(["asignaciones_mesa", "resumen-asignacion-dia", "reservas-servicio-dia", "disponibilidad"]),
    );
    // Y la escritura exige que la BD siga en el estado que VIO el personal (la tarjeta es «Confirmada»):
    // así el estado previo que se recuerda para el «Deshacer» es verdad (M1 de la revisión independiente).
    expect(h.escrituras[0].en).toEqual(["estado", ["confirmada"]]);
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("«No vino»: estado 'no_show' y llegada_at null, y NO manda correo", async () => {
    montar();

    fireEvent.keyDown(await screen.findByRole("button", { name: "Más opciones de llegada para Ana" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "No vino" }));

    await waitFor(() => expect(escrituras()).toHaveLength(1));
    expect(escrituras()[0].payload).toEqual({ estado: "no_show", llegada_at: null });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Ana: no vino", expect.anything()));
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("con la escritura denegada por RLS (0 filas): avisa «no tienes permiso», no da «ha llegado» y NO manda correo", async () => {
    h.respuestasEscritura = [{ data: [] }];
    montar();

    fireEvent.click(await screen.findByRole("button", { name: "Marcar que Ana ha llegado" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/registrar la llegada: no tienes permiso/)),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("sin permiso de edición «Ha llegado» y el menú «…» salen deshabilitados, con el motivo visible, y no escriben", async () => {
    h.canEdit = false;
    montar();

    const llegada = await screen.findByRole("button", { name: "Marcar que Ana ha llegado" });
    const menu = screen.getByRole("button", { name: "Más opciones de llegada para Ana" });

    for (const boton of [llegada, menu]) {
      expect(boton).toBeDisabled();
      expect(boton.parentElement).toHaveAttribute("title", MOTIVO_SIN_PERMISO);
    }
    fireEvent.click(llegada);
    fireEvent.keyDown(menu, { key: "Enter" });
    expect(screen.queryByRole("menuitem", { name: "No vino" })).not.toBeInTheDocument();
    expect(escrituras()).toEqual([]);
  });

  it("sin permiso, el «Deshacer» de una reserva que ya llegó también sale deshabilitado", async () => {
    h.canEdit = false;
    h.reservas = [reserva("r-ana", "completada", "Ana", { llegada_at: "2026-09-30T19:23:00.000Z" })];
    montar();

    const deshacer = await screen.findByRole("button", { name: "Deshacer llegada de Ana" });

    expect(deshacer).toBeDisabled();
    expect(deshacer.parentElement).toHaveAttribute("title", MOTIVO_SIN_PERMISO);
    fireEvent.click(deshacer);
    expect(escrituras()).toEqual([]);
  });
});

describe("tarjeta · «Mover a…»", () => {
  it("mover a una sala con sitio y sin mesas asignadas: escribe `{ espacio_id }` AL MOMENTO (sin pedir confirmación), refresca las mesas y NO manda correo", async () => {
    const { invalidadas } = montar();
    await conMesasCargadas();

    const menu = await abrirMenu("Ana");
    fireEvent.click(within(menu).getByRole("menuitem", { name: /^Terraza/ }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Ana → Terraza", expect.anything()));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(escrituras()).toEqual([
      { tabla: "reservas", payload: { espacio_id: "terraza" }, eq: ["id", "r-ana"], select: "id" },
    ]);
    await waitFor(() => expect(invalidadas).toEqual(expect.arrayContaining(CLAVES_AL_CAMBIAR_SALA)));
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("CON mesas asignadas avisa ANTES de que el trigger las borre, y NO escribe hasta que se acepta", async () => {
    // Mismo aviso que el panel de Asignación (`textoQuitarMesas`): el trigger
    // `trg_reservas_sincronizar_asignaciones` BORRA las mesas al cambiar la sala.
    h.asignaciones = [asignacion("r-ana", "m5", "5"), asignacion("r-ana", "m4", "4")];
    montar();
    await conMesasCargadas();

    const menu = await abrirMenu("Ana");
    fireEvent.click(within(menu).getByRole("menuitem", { name: /^Terraza/ }));

    const dialogo = await screen.findByRole("alertdialog");
    expect(within(dialogo).getByText("¿Cambiar de sala y quitar sus mesas?")).toBeInTheDocument();
    expect(dialogo.textContent).toContain(
      "Ana tiene 2 mesas asignadas (4, 5) en Salón. Al pasarla a Terraza se quitarán esas mesas y habrá que asignarlas de nuevo.",
    );
    expect(dialogo.textContent).toContain("Es un cambio interno: al cliente no se le envía nada.");
    expect(escrituras()).toEqual([]);
  });

  it("al aceptar el aviso de mesas se mueve, se refrescan las mesas asignadas y NO se manda correo", async () => {
    h.asignaciones = [asignacion("r-ana", "m4", "4")];
    const { invalidadas } = montar();
    await conMesasCargadas();

    const menu = await abrirMenu("Ana");
    fireEvent.click(within(menu).getByRole("menuitem", { name: /^Terraza/ }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cambiar de sala" }));

    await waitFor(() => expect(escrituras()).toHaveLength(1));
    expect(escrituras()[0]).toMatchObject({ payload: { espacio_id: "terraza" }, eq: ["id", "r-ana"] });
    await waitFor(() => expect(invalidadas).toEqual(expect.arrayContaining(CLAVES_AL_CAMBIAR_SALA)));
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("si se descarta el aviso de mesas no se escribe nada", async () => {
    h.asignaciones = [asignacion("r-ana", "m4", "4")];
    montar();
    await conMesasCargadas();

    const menu = await abrirMenu("Ana");
    fireEvent.click(within(menu).getByRole("menuitem", { name: /^Terraza/ }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "No mover" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(escrituras()).toEqual([]);
  });

  it("las mesas de OTRA reserva no cuentan: Ana no tiene ninguna y se mueve sin preguntar", async () => {
    h.reservas = [reserva("r-ana", "confirmada", "Ana"), reserva("r-berta", "confirmada", "Berta")];
    h.asignaciones = [asignacion("r-berta", "m4", "4")];
    montar();
    await conMesasCargadas();

    const menu = await abrirMenu("Ana");
    fireEvent.click(within(menu).getByRole("menuitem", { name: /^Terraza/ }));

    await waitFor(() => expect(escrituras()).toHaveLength(1));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("también avisa al pasarla a «Sin asignar» (cambia `espacio_id` igual)", async () => {
    h.asignaciones = [asignacion("r-ana", "m4", "4")];
    montar();
    await conMesasCargadas();

    const menu = await abrirMenu("Ana");
    fireEvent.click(within(menu).getByRole("menuitem", { name: /^Sin asignar/ }));

    const dialogo = await screen.findByRole("alertdialog");
    expect(dialogo.textContent).toContain("Al pasarla a Sin asignar se quitarán esas mesas");
    expect(escrituras()).toEqual([]);
  });

  it("si además la sala se pasa de aforo, UN solo aviso con las dos cosas; «Mover igualmente» escribe", async () => {
    // Terraza: 30 plazas; ya hay 28 en la cena + 4 de Ana = 32.
    h.reservas = [reserva("r-ana", "confirmada", "Ana"), reserva("r-berta", "confirmada", "Berta", { espacio_id: "terraza", numero_comensales: 28 })];
    h.asignaciones = [asignacion("r-ana", "m4", "4")];
    montar();
    await conMesasCargadas();

    const menu = await abrirMenu("Ana");
    fireEvent.click(within(menu).getByRole("menuitem", { name: /^Terraza/ }));

    const dialogo = await screen.findByRole("alertdialog");
    expect(within(dialogo).getByText(/¿Superar la capacidad de Terraza\?/)).toBeInTheDocument();
    expect(dialogo.textContent).toContain("quedaría en 32 de 30 plazas");
    expect(dialogo.textContent).toContain("Ana tiene 1 mesa asignada (4) en Salón");
    expect(escrituras()).toEqual([]);

    fireEvent.click(within(dialogo).getByRole("button", { name: "Mover igualmente" }));

    await waitFor(() => expect(escrituras()).toHaveLength(1));
    expect(escrituras()[0].payload).toEqual({ espacio_id: "terraza" });
  });

  it("si la sala se pasa de aforo pide confirmación y NO escribe hasta que se acepta", async () => {
    // Terraza: 30 plazas; ya hay 28 en la cena + 4 de Ana = 32.
    h.reservas = [reserva("r-ana", "confirmada", "Ana"), reserva("r-berta", "confirmada", "Berta", { espacio_id: "terraza", numero_comensales: 28 })];
    montar();
    await conMesasCargadas();

    const menu = await abrirMenu("Ana");
    fireEvent.click(within(menu).getByRole("menuitem", { name: /^Terraza/ }));

    const dialogo = await screen.findByRole("alertdialog");
    expect(within(dialogo).getByText(/¿Superar la capacidad de Terraza\?/)).toBeInTheDocument();
    // Sin mesas asignadas, el aviso es solo el de aforo (el de siempre).
    expect(dialogo.textContent).not.toContain("mesas asignadas");
    expect(escrituras()).toEqual([]);

    fireEvent.click(within(dialogo).getByRole("button", { name: "Mover igualmente" }));

    await waitFor(() => expect(escrituras()).toHaveLength(1));
    expect(escrituras()[0].payload).toEqual({ espacio_id: "terraza" });
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("si se descarta el aviso de aforo no se escribe nada", async () => {
    h.reservas = [reserva("r-ana", "confirmada", "Ana"), reserva("r-berta", "confirmada", "Berta", { espacio_id: "terraza", numero_comensales: 28 })];
    montar();
    await conMesasCargadas();

    const menu = await abrirMenu("Ana");
    fireEvent.click(within(menu).getByRole("menuitem", { name: /^Terraza/ }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "No mover" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(escrituras()).toEqual([]);
  });

  it("sin permiso de edición no se ofrece ningún destino: el motivo sale en el menú, la tarjeta no se arrastra y no se escribe", async () => {
    h.canEdit = false;
    montar();

    const menu = await abrirMenu("Ana");

    expect(within(menu).getByText("Mover a…")).toBeInTheDocument();
    const aviso = within(menu).getByRole("menuitem", { name: MOTIVO_SIN_PERMISO });
    expect(aviso).toHaveAttribute("data-disabled");
    expect(within(menu).queryByRole("menuitem", { name: /^Terraza/ })).not.toBeInTheDocument();
    // dnd-kit apaga el arrastre (ratón, tacto y teclado) con `aria-disabled` en la tarjeta.
    expect(await tarjeta("Ana")).toHaveAttribute("aria-disabled", "true");
    expect(escrituras()).toEqual([]);
  });

  it("con permiso la tarjeta de una reserva viva SÍ se arrastra", async () => {
    montar();

    expect(await tarjeta("Ana")).toHaveAttribute("aria-disabled", "false");
  });

  it("una reserva que no ocupa sitio («No vino») no ofrece destinos: nada que escribir, ni arrastre", async () => {
    h.reservas = [reserva("r-fede", "no_show", "Fede")];
    montar();

    const menu = await abrirMenu("Fede");

    expect(within(menu).getByText("No se puede mover en este estado")).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: /^Terraza/ })).not.toBeInTheDocument();
    expect(await tarjeta("Fede")).toHaveAttribute("aria-disabled", "true");
    expect(escrituras()).toEqual([]);
  });

  it("«Llamar» no escribe nada y sigue disponible sin permiso", async () => {
    h.canEdit = false;
    montar();

    const menu = await abrirMenu("Ana");

    expect(within(menu).getByRole("menuitem", { name: /Llamar/ })).not.toHaveAttribute("data-disabled");
  });
});

describe("tarjeta · «Añadir a blacklist»", () => {
  it("abre el modal de la lista negra con ESA reserva y no escribe nada todavía", async () => {
    montar();

    const menu = await abrirMenu("Ana");
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Añadir a blacklist/ }));

    await waitFor(() => expect(h.modalBlacklist).toHaveBeenLastCalledWith("r-ana", true));
    expect(escrituras()).toEqual([]);
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("sin permiso de edición sale deshabilitado, con el motivo visible, y no abre el modal", async () => {
    h.canEdit = false;
    montar();

    const menu = await abrirMenu("Ana");
    const item = within(menu).getByRole("menuitem", { name: /Añadir a blacklist/ });

    expect(item).toHaveAttribute("data-disabled");
    expect(item.parentElement).toHaveAttribute("title", MOTIVO_SIN_PERMISO);
    fireEvent.click(item);
    expect(h.modalBlacklist).not.toHaveBeenCalledWith("r-ana", true);
  });
});

describe("tarjeta · la insignia de estado sale del mapa único (`ESTADOS_RESERVA`)", () => {
  it.each([
    ["pendiente", "Pendiente", ["bg-status-pending", "text-status-pending-foreground"]],
    ["verificada", "Verificada", ["bg-status-verified", "text-status-verified-foreground"]],
    ["confirmada", "Confirmada", ["bg-status-confirmed", "text-status-confirmed-foreground"]],
    ["completada", "Llegó", ["bg-emerald-600", "text-white"]],
    ["no_show", "No vino", ["bg-secondary", "text-secondary-foreground"]],
  ])("%s se pinta como «%s» con los tokens del tema, no con la paleta cruda de Tailwind", async (estado, etiqueta, clases) => {
    h.reservas = [reserva("r-ana", estado, "Ana")];
    montar();

    const insignia = within(await tarjeta("Ana")).getByText(etiqueta, { selector: "div" });

    for (const clase of clases) expect(insignia.classList.contains(clase), clase).toBe(true);
    // Ninguno de los colores crudos que tenía el kanban (yellow-500, blue-500, green-500, red-500, gray-500).
    expect(insignia.className).not.toMatch(/bg-(yellow|blue|green|red|gray)-500/);
  });

  it("el nombre accesible de la tarjeta lleva el nombre del estado del mapa", async () => {
    h.reservas = [reserva("r-ana", "completada", "Ana")];
    montar();

    expect(await screen.findByRole("button", { name: "Ana, 21:00, 4 comensales, Llegó" })).toBeInTheDocument();
  });

  it("un estado que no existe se pinta tal cual y en gris (nunca revienta)", async () => {
    h.reservas = [reserva("r-ana", "rechazada", "Ana")];
    montar();

    const insignia = within(await tarjeta("Ana")).getByText("rechazada", { selector: "div" });

    expect(insignia.classList.contains("bg-gray-500")).toBe(true);
  });
});
