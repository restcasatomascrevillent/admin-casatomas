/**
 * Kanban de «Hoy» (`GestorReservasKanban`): la TARJETA de una reserva — tests de
 * caracterización de EFECTOS.
 *
 * Fijan lo que hace HOY cada acción de la tarjeta: la estrella («importante»),
 * «Ha llegado» / «No se presentó» (vía `ControlLlegada`), «Mover a…» y «Añadir a
 * blacklist». Lo que se afirma son efectos y mutaciones —qué se escribe y con qué
 * filtros, quién manda correo (nadie), qué cachés se refrescan, qué pasa con una
 * escritura denegada por RLS, si se mira el permiso de edición—, NO el DOM ni el
 * número de botones: los controles se buscan por su nombre accesible, y esta
 * pantalla está siendo tocada por otro encargo (se le añade «Editar reserva»).
 *
 * `// BUG conocido` marca lo que está mal y se deja así a propósito: este fichero
 * NO arregla nada, describe el punto de partida para el paso que unifique cómo se
 * ejecutan las acciones sobre una reserva.
 *
 * Nada llega a Supabase: el cliente y `sonner` están mockeados.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  /** Filas que devuelve la consulta del kanban. */
  reservas: [] as Record<string, unknown>[],
  /** Cada escritura completa, en orden. */
  escrituras: [] as Array<{
    tabla: string;
    payload: Record<string, unknown>;
    eq: [string, unknown] | null;
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
      const escritura = { tabla, payload: {} as Record<string, unknown>, eq: null as [string, unknown] | null, select: null as string | null };
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
      b.neq = () => b;
      b.order = () => b;
      b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
        if (!esEscritura) return Promise.resolve({ data: h.reservas, error: null }).then(ok, ko);
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

import { toast } from "sonner";
import { GestorReservasKanban } from "@/components/reservas/GestorReservasKanban";
import { CLAVES_LISTAS_RESERVAS } from "@/hooks/useAccionesServicioReserva";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

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

/** Las once claves que refresca SIEMPRE una acción de servicio (ver useAccionesServicioReserva). */
const CLAVES_DE_SERVICIO = [
  "reservas-kanban",
  "reservas-hoy",
  "reservas-lista",
  "reservas_hoy_resumen",
  "reservas_hoy_todas",
  "ocupacion_hoy",
  "today-reservations",
  "today-confirmed-reservations",
  "dashboard-stats",
  "reservas_mes",
  "ocupacion-salas-dia",
];

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

/** La tarjeta de ese cliente (el nombre accesible de la tarjeta empieza por el nombre). */
const tarjeta = async (cliente: string) => await screen.findByRole("button", { name: new RegExp(`^${cliente},`) });

/** Abre el menú «⋮» de la tarjeta de ese cliente (Radix abre con el teclado en jsdom). */
async function abrirMenu(cliente: string) {
  const disparador = await screen.findByRole("button", { name: new RegExp(`^Acciones de la reserva de ${cliente}`) });
  fireEvent.keyDown(disparador, { key: "Enter" });
  return await screen.findByRole("menu");
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
  h.reservas = [reserva("r-ana", "confirmada", "Ana")];
  consolaError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consolaError.mockRestore();
});

describe("tarjeta · la estrella («importante»)", () => {
  it("marcar: escribe `{ importante: true }` filtrando por id (SIN pedir la fila de vuelta) y refresca solo las tres listas", async () => {
    const { invalidadas } = montar();

    fireEvent.click(within(await tarjeta("Ana")).getByRole("button", { name: "Marcar como importante" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Reserva marcada como importante"));
    expect(escrituras()).toEqual([
      { tabla: "reservas", payload: { importante: true }, eq: ["id", "r-ana"], select: null },
    ]);
    // Solo `CLAVES_LISTAS_RESERVAS`: los contadores y el dashboard no se refrescan (la
    // estrella no cambia ninguna cifra, pero sí el resaltado en «Reservas de hoy»).
    expect(invalidadas).toEqual([...CLAVES_LISTAS_RESERVAS]);
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("desmarcar: escribe `{ importante: false }` y avisa «Reserva desmarcada»", async () => {
    h.reservas = [reserva("r-ana", "confirmada", "Ana", { importante: true })];
    montar();

    fireEvent.click(within(await tarjeta("Ana")).getByRole("button", { name: "Quitar importante" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Reserva desmarcada"));
    expect(escrituras()[0].payload).toEqual({ importante: false });
  });

  it("si la BD falla: avisa con el mensaje, no refresca nada y lo deja en el log", async () => {
    h.respuestasEscritura = [{ error: { code: "42501", message: "permission denied for table reservas" } }];
    const { invalidadas } = montar();

    fireEvent.click(within(await tarjeta("Ana")).getByRole("button", { name: "Marcar como importante" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("No se pudo actualizar la reserva: permission denied for table reservas"),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(invalidadas).toEqual([]);
    expect(consolaError).toHaveBeenCalledWith("Error actualizando la reserva:", expect.anything());
  });

  it("BUG conocido: con la RLS denegando la escritura en silencio (sin error) da «marcada como importante» y refresca", async () => {
    // A diferencia de llegada / no vino / mover (`ErrorSinFilasReserva`), la estrella no
    // pide la fila de vuelta: una escritura denegada por RLS devuelve `data: null` sin error
    // y aquí pasa por éxito. Con permiso denegado, el usuario lee «marcada» y no lo está.
    h.respuestasEscritura = [{ data: null }];
    const { invalidadas } = montar();

    fireEvent.click(within(await tarjeta("Ana")).getByRole("button", { name: "Marcar como importante" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Reserva marcada como importante"));
    expect(toast.error).not.toHaveBeenCalled();
    expect(invalidadas).toEqual([...CLAVES_LISTAS_RESERVAS]);
  });

  it("BUG conocido: no mira el permiso de edición; sin él, la estrella escribe igual (y confía en la RLS)", async () => {
    h.canEdit = false;
    montar();

    fireEvent.click(within(await tarjeta("Ana")).getByRole("button", { name: "Marcar como importante" }));

    await waitFor(() => expect(escrituras()).toHaveLength(1));
    expect(escrituras()[0].payload).toEqual({ importante: true });
  });
});

describe("tarjeta · «Ha llegado» y «No se presentó» (ControlLlegada)", () => {
  it("«Ha llegado»: estado 'completada' + llegada_at, con la fila de vuelta pedida; refresca las 11 claves y NO manda correo", async () => {
    const { invalidadas } = montar();

    fireEvent.click(await screen.findByRole("button", { name: "Marcar que Ana ha llegado" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Ana ha llegado", expect.anything()));
    const [escritura] = escrituras();
    expect(escritura).toMatchObject({ tabla: "reservas", eq: ["id", "r-ana"], select: "id", payload: { estado: "completada" } });
    expect(typeof escritura.payload.llegada_at).toBe("string");
    await waitFor(() => expect(invalidadas).toEqual(expect.arrayContaining(CLAVES_DE_SERVICIO)));
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("«No se presentó»: estado 'no_show' y llegada_at null, y NO manda correo", async () => {
    montar();

    fireEvent.keyDown(await screen.findByRole("button", { name: "Más opciones de llegada para Ana" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /No se presentó/ }));

    await waitFor(() => expect(escrituras()).toHaveLength(1));
    expect(escrituras()[0].payload).toEqual({ estado: "no_show", llegada_at: null });
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

  it("BUG conocido: no mira el permiso de edición; sin él, «Ha llegado» y «No se presentó» se ofrecen y escriben igual", async () => {
    // Hoy solo la RLS (y, tras escribir, el aviso «no tienes permiso») frena a quien no puede editar.
    h.canEdit = false;
    montar();

    const llegada = await screen.findByRole("button", { name: "Marcar que Ana ha llegado" });
    expect(llegada).toBeEnabled();
    fireEvent.click(llegada);

    await waitFor(() => expect(escrituras()).toHaveLength(1));
    expect(escrituras()[0].payload).toMatchObject({ estado: "completada" });
  });
});

describe("tarjeta · «Mover a…»", () => {
  it("mover a una sala con sitio: escribe `{ espacio_id }` AL MOMENTO (sin pedir confirmación), refresca las 11 claves y NO manda correo", async () => {
    const { invalidadas } = montar();

    const menu = await abrirMenu("Ana");
    fireEvent.click(within(menu).getByRole("menuitem", { name: /^Terraza/ }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Ana → Terraza", expect.anything()));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(escrituras()).toEqual([
      { tabla: "reservas", payload: { espacio_id: "terraza" }, eq: ["id", "r-ana"], select: "id" },
    ]);
    await waitFor(() => expect(invalidadas).toEqual(expect.arrayContaining(CLAVES_DE_SERVICIO)));
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("BUG conocido: no avisa de que el trigger de la BD borra las mesas asignadas, ni siquiera lo consulta", async () => {
    // Cambiar la sala hace que `trg_reservas_sincronizar_asignaciones` BORRE las mesas de
    // la reserva. El kanban solo lee `reservas`: no sabe si tiene mesas, no pregunta y no
    // refresca `asignaciones_mesa` (ver los tests de `useAccionesServicioReserva`). El panel
    // de asignación (`useCambiarSalaReserva`) deja esa confirmación a quien lo llama.
    montar();

    const menu = await abrirMenu("Ana");
    fireEvent.click(within(menu).getByRole("menuitem", { name: /^Terraza/ }));
    await waitFor(() => expect(escrituras()).toHaveLength(1));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(new Set(h.tablas)).toEqual(new Set(["reservas"]));
  });

  it("si la sala se pasa de aforo pide confirmación y NO escribe hasta que se acepta", async () => {
    // Terraza: 30 plazas; ya hay 28 en la cena + 4 de Ana = 32.
    h.reservas = [reserva("r-ana", "confirmada", "Ana"), reserva("r-berta", "confirmada", "Berta", { espacio_id: "terraza", numero_comensales: 28 })];
    montar();

    const menu = await abrirMenu("Ana");
    fireEvent.click(within(menu).getByRole("menuitem", { name: /^Terraza/ }));

    const dialogo = await screen.findByRole("alertdialog");
    expect(within(dialogo).getByText(/¿Superar la capacidad de Terraza\?/)).toBeInTheDocument();
    expect(escrituras()).toEqual([]);

    fireEvent.click(within(dialogo).getByRole("button", { name: "Mover igualmente" }));

    await waitFor(() => expect(escrituras()).toHaveLength(1));
    expect(escrituras()[0].payload).toEqual({ espacio_id: "terraza" });
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("si se descarta el aviso de aforo no se escribe nada", async () => {
    h.reservas = [reserva("r-ana", "confirmada", "Ana"), reserva("r-berta", "confirmada", "Berta", { espacio_id: "terraza", numero_comensales: 28 })];
    montar();

    const menu = await abrirMenu("Ana");
    fireEvent.click(within(menu).getByRole("menuitem", { name: /^Terraza/ }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "No mover" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(escrituras()).toEqual([]);
  });

  it("BUG conocido: no mira el permiso de edición; sin él, mover se ofrece y escribe igual", async () => {
    h.canEdit = false;
    montar();

    const menu = await abrirMenu("Ana");
    const terraza = within(menu).getByRole("menuitem", { name: /^Terraza/ });
    expect(terraza).not.toHaveAttribute("data-disabled");
    fireEvent.click(terraza);

    await waitFor(() => expect(escrituras()).toHaveLength(1));
    expect(escrituras()[0].payload).toEqual({ espacio_id: "terraza" });
  });

  it("una reserva que no ocupa sitio («No vino») no ofrece destinos: nada que escribir", async () => {
    h.reservas = [reserva("r-fede", "no_show", "Fede")];
    montar();

    const menu = await abrirMenu("Fede");

    expect(within(menu).getByText("No se puede mover en este estado")).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: /^Terraza/ })).not.toBeInTheDocument();
    expect(escrituras()).toEqual([]);
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

  it("no mira el permiso de edición de reservas (la lista negra es otra tabla y otro modal)", async () => {
    h.canEdit = false;
    montar();

    const menu = await abrirMenu("Ana");
    const item = within(menu).getByRole("menuitem", { name: /Añadir a blacklist/ });
    expect(item).not.toHaveAttribute("data-disabled");
    fireEvent.click(item);

    await waitFor(() => expect(h.modalBlacklist).toHaveBeenLastCalledWith("r-ana", true));
  });
});
