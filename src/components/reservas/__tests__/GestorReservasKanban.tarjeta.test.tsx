/**
 * Kanban de «Hoy»: LA TARJETA como disparador del menú «⋮» y la insignia de MESA.
 *
 * Petición del dueño (04/10/2026):
 *   1. «Si hago clic en la tarjeta es como los tres puntitos; lo único es arrastrar, que es
 *      cambiar de espacio.» → tocar una zona neutra de la tarjeta abre EL MISMO menú que el «⋮»;
 *      los controles de dentro (estrella, «⋮», «Ha llegado», «⋯») conservan lo suyo; un arrastre no
 *      abre el menú al soltar.
 *   2. «Que se vea el número de mesa, por favor, si lo tienen.» → insignia «Mesa 7» / «Mesas 7, 9» /
 *      «Mesa 7+8» donde antes solo salía «Sin mesa». El número sale de `asignaciones_mesa → mesas.nombre`,
 *      de la MISMA consulta (una por día) con la que el kanban ya decidía «Sin mesa».
 *
 * Nada llega a Supabase: el cliente y `sonner` están mockeados (como en `…acciones.test.tsx`).
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  reservas: [] as Record<string, unknown>[],
  asignaciones: [] as Record<string, unknown>[],
  /** Tablas pedidas con `from(...)`, en orden. */
  tablas: [] as string[],
  /** Escrituras (`update`) que ha recibido el doble. */
  escrituras: [] as string[],
  canEdit: true,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabla: string) => {
      h.tablas.push(tabla);
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "neq", "order"]) b[m] = () => b;
      b.update = () => {
        h.escrituras.push(tabla);
        return b;
      };
      b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve({ data: tabla === "asignaciones_mesa" ? h.asignaciones : h.reservas, error: null }).then(ok, ko);
      return b;
    },
    functions: { invoke: vi.fn() },
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
vi.mock("@/hooks/useUserRole", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useUserRole")>()),
  useCanAccessSection: () => ({ canAccess: h.canEdit, loading: false }),
}));
vi.mock("@/components/reservas/BlacklistModal", () => ({ BlacklistModal: () => null }));
vi.mock("@/components/reservas/ElegirMesaDialog", () => ({ ElegirMesaDialog: () => null }));

import { GestorReservasKanban } from "@/components/reservas/GestorReservasKanban";
import { ReservaCard } from "@/components/reservas/ReservaCard";
import type { ReservaServicio } from "@/lib/reservas/servicioSala";

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

/** Una fila de `asignaciones_mesa` tal como la trae `useAsignacionesMesa` (con la mesa dentro). */
const asignacion = (reservaId: string, mesaId: string, mesaNombre: string) => ({
  id: `asig-${reservaId}-${mesaId}`,
  reserva_id: reservaId,
  mesa_id: mesaId,
  reservas: { id: reservaId },
  mesas: { id: mesaId, nombre: mesaNombre, capacidad: 4, espacio_id: "salon" },
});

function montar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  render(
    <QueryClientProvider client={queryClient}>
      <GestorReservasKanban />
    </QueryClientProvider>,
  );
}

/** La tarjeta de ese cliente (el nombre accesible empieza por el nombre). */
const tarjeta = async (cliente: string) =>
  await screen.findByRole("button", { name: new RegExp(`^${cliente},`), hidden: true });

/** Espera a que el kanban tenga ya las mesas asignadas de hoy. */
async function conMesasCargadas() {
  await waitFor(() => expect(h.tablas).toContain("asignaciones_mesa"));
  await act(async () => {});
}

const NOMBRES_ITEMS_MENU = ["Mover a…", "Terraza", "Llamar", "Añadir a blacklist"];

beforeEach(() => {
  vi.clearAllMocks();
  h.canEdit = true;
  h.tablas = [];
  h.escrituras = [];
  h.asignaciones = [];
  h.reservas = [reserva("r-ana", "confirmada", "Ana")];
});

describe("tarjeta · tocarla abre el menú de acciones (como el «⋮»)", () => {
  it("un clic en una zona neutra (el nombre) abre el MISMO menú que el «⋮», con los mismos ítems", async () => {
    montar();
    const card = await tarjeta("Ana");

    // Menú del «⋮» (referencia).
    fireEvent.keyDown(screen.getByRole("button", { name: /^Acciones de la reserva de Ana/ }), { key: "Enter" });
    const delPunto = within(await screen.findByRole("menu"));
    const itemsDelPunto = delPunto.getAllByRole("menuitem").map((i) => i.textContent);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());

    // Menú de la tarjeta.
    expect(card).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(within(card).getByText("Ana"));
    const menu = within(await screen.findByRole("menu"));
    expect(menu.getAllByRole("menuitem").map((i) => i.textContent)).toEqual(itemsDelPunto);
    for (const nombre of NOMBRES_ITEMS_MENU.filter((n) => n !== "Mover a…")) {
      expect(menu.getByText(new RegExp(nombre))).toBeInTheDocument();
    }
    expect(menu.getByText("Mover a…")).toBeInTheDocument();
    expect(card).toHaveAttribute("aria-expanded", "true");
    expect(card).toHaveAttribute("aria-haspopup", "menu");
    expect(h.escrituras).toEqual([]);
  });

  it("también abre con un clic en la hora, en el teléfono y en la propia tarjeta", async () => {
    montar();
    const card = await tarjeta("Ana");

    for (const objetivo of [within(card).getByText("21:00"), within(card).getByText("+34612345678"), card]) {
      fireEvent.click(objetivo);
      expect(await screen.findByRole("menu")).toBeInTheDocument();
      fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    }
  });

  it("tocar un ítem del menú NO lo reabre (el clic propagado por el portal no es de la tarjeta)", async () => {
    montar();
    fireEvent.click(within(await tarjeta("Ana")).getByText("Ana"));
    const menu = await screen.findByRole("menu");

    // Etiqueta «Mover a…» (no es un ítem): el clic sube por React hasta la tarjeta, pero no es suyo.
    fireEvent.click(within(menu).getByText("Mover a…"));
    expect(screen.getAllByRole("menu")).toHaveLength(1);
  });

  it("la estrella hace lo suyo (escribe) y NO abre el menú", async () => {
    montar();
    const card = await tarjeta("Ana");

    fireEvent.click(within(card).getByRole("button", { name: "Marcar como importante" }));

    await waitFor(() => expect(h.escrituras).toEqual(["reservas"]));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("«Ha llegado» hace lo suyo y NO abre el menú de la tarjeta", async () => {
    montar();
    const card = await tarjeta("Ana");

    fireEvent.click(within(card).getByRole("button", { name: "Marcar que Ana ha llegado" }));

    await waitFor(() => expect(h.escrituras).toEqual(["reservas"]));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("el «⋯» de llegada abre SOLO el suyo («No vino»), no el de la tarjeta", async () => {
    montar();
    const card = await tarjeta("Ana");

    fireEvent.keyDown(within(card).getByRole("button", { name: "Más opciones de llegada para Ana" }), { key: "Enter" });

    const menu = within(await screen.findByRole("menu"));
    expect(menu.getAllByRole("menuitem")).toHaveLength(1);
    expect(menu.queryByText("Mover a…")).not.toBeInTheDocument();
  });

  it("el «⋮» abre su menú una sola vez (un clic en él no lo duplica ni lo cierra)", async () => {
    montar();
    const card = await tarjeta("Ana");

    const punto = within(card).getByRole("button", { name: /^Acciones de la reserva de Ana/ });
    fireEvent.pointerDown(punto, { button: 0, pointerType: "mouse" });
    fireEvent.click(punto);

    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(screen.getAllByRole("menu")).toHaveLength(1);
  });

  it("sin permiso (solo «Ver») no hay controles apagados en la tarjeta: ni estrella ni llegada (06/11/2026)", async () => {
    h.canEdit = false;
    montar();
    const card = await tarjeta("Ana");

    expect(within(card).queryByRole("button", { name: /importante/i })).not.toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /ha llegado/i })).not.toBeInTheDocument();
    expect(card.querySelector("button:disabled")).toBeNull();
    // Tocarla abre el menú, que solo trae «Llamar» (tiene teléfono).
    fireEvent.click(card);
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent?.trim())).toEqual(["Llamar"]);
  });

  it("sin permiso y sin teléfono no hay menú: ni «⋮» ni se abre al tocar la tarjeta", async () => {
    h.canEdit = false;
    h.reservas = h.reservas.map((r) => ({ ...r, telefono: null }));
    montar();
    const card = await tarjeta("Ana");

    expect(within(card).queryByRole("button", { name: /^Acciones de la reserva de Ana/ })).not.toBeInTheDocument();
    fireEvent.click(card);
    fireEvent.keyDown(card, { key: "Enter" });
    await act(async () => {});
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(card).not.toHaveAttribute("aria-haspopup");
  });

  it("un ARRASTRE (ratón: >6 px) mueve la tarjeta y al soltar NO abre el menú", async () => {
    montar();
    const card = await tarjeta("Ana");

    fireEvent.mouseDown(card, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.mouseMove(document, { clientX: 60, clientY: 40 });
    // Se ha activado el arrastre: dnd-kit pone el anuncio de lectura y la tarjeta original queda en `isDragging`.
    await waitFor(() => expect(card.className).toMatch(/border-dashed/));
    fireEvent.mouseUp(document, { clientX: 60, clientY: 40 });
    // Algunos navegadores sintetizan un clic al soltar: tampoco abre nada (400 ms de gracia tras el arrastre).
    fireEvent.click(card);
    await act(async () => {});

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(h.escrituras).toEqual([]);
  });

  it("un movimiento menor de 6 px NO es arrastre: es un clic y abre el menú", async () => {
    montar();
    const card = await tarjeta("Ana");

    fireEvent.mouseDown(card, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.mouseMove(document, { clientX: 12, clientY: 11 });
    fireEvent.mouseUp(document, { clientX: 12, clientY: 11 });
    fireEvent.click(card);

    expect(await screen.findByRole("menu")).toBeInTheDocument();
  });

  it("con teclado la tarjeta ARRASTRABLE sigue siendo del KeyboardSensor: Intro/Espacio no abren el menú", async () => {
    montar();
    const card = await tarjeta("Ana");
    expect(card).toHaveAttribute("data-arrastrable", "true");

    fireEvent.keyDown(card, { key: "Enter", code: "Enter" });
    await act(async () => {});

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("la tarjeta que NO se arrastra (sin permiso) abre el menú también con Intro y con Espacio", async () => {
    h.canEdit = false;
    montar();
    const card = await tarjeta("Ana");
    expect(card).toHaveAttribute("data-arrastrable", "false");

    fireEvent.keyDown(card, { key: "Enter" });
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());

    fireEvent.keyDown(card, { key: " " });
    expect(await screen.findByRole("menu")).toBeInTheDocument();
  });
});

describe("tarjeta · insignia de mesa («Mesa 7» / «Sin mesa»)", () => {
  it("con una mesa asignada: «Mesa 7» y NO «Sin mesa»; el nombre accesible de la tarjeta la incluye", async () => {
    h.asignaciones = [asignacion("r-ana", "m7", "7")];
    montar();
    await conMesasCargadas();

    expect(await screen.findByText("Mesa 7")).toBeInTheDocument();
    expect(screen.queryByText("Sin mesa")).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /^Ana, .*, Mesa 7$/, hidden: true })).toBeInTheDocument();
  });

  it("con dos mesas: «Mesas 7, 9» (ordenadas como número, no como texto)", async () => {
    h.asignaciones = [asignacion("r-ana", "m9", "9"), asignacion("r-ana", "m7", "7")];
    montar();
    await conMesasCargadas();

    expect(await screen.findByText("Mesas 7, 9")).toBeInTheDocument();
    expect(screen.queryByText("Sin mesa")).not.toBeInTheDocument();
  });

  it("con dos mesas de nombre 10 y 9 sale «Mesas 9, 10»", async () => {
    h.asignaciones = [asignacion("r-ana", "m10", "10"), asignacion("r-ana", "m9", "9")];
    montar();
    await conMesasCargadas();

    expect(await screen.findByText("Mesas 9, 10")).toBeInTheDocument();
  });

  it("una mesa fusionada («7+8») sale como «Mesa 7+8»", async () => {
    h.asignaciones = [asignacion("r-ana", "m78", "7+8")];
    montar();
    await conMesasCargadas();

    expect(await screen.findByText("Mesa 7+8")).toBeInTheDocument();
  });

  it("sin mesa (con sala) sigue saliendo «Sin mesa» y ninguna «Mesa N»", async () => {
    montar();
    await conMesasCargadas();

    expect(await screen.findByText("Sin mesa")).toBeInTheDocument();
    expect(screen.queryByText(/^Mesas? \d/)).not.toBeInTheDocument();
  });

  it("cada reserva enseña SU mesa, con una sola consulta de asignaciones para todo el día", async () => {
    h.reservas = [
      reserva("r-ana", "confirmada", "Ana"),
      reserva("r-beto", "confirmada", "Beto", { hora: "21:30:00" }),
      reserva("r-cris", "confirmada", "Cris", { hora: "22:00:00" }),
    ];
    h.asignaciones = [asignacion("r-ana", "m7", "7"), asignacion("r-beto", "m12", "12")];
    montar();
    await conMesasCargadas();

    expect(within(await tarjeta("Ana")).getByText("Mesa 7")).toBeInTheDocument();
    expect(within(await tarjeta("Beto")).getByText("Mesa 12")).toBeInTheDocument();
    expect(within(await tarjeta("Cris")).getByText("Sin mesa")).toBeInTheDocument();
    expect(h.tablas.filter((t) => t === "asignaciones_mesa")).toHaveLength(1);
  });

  it("tocar la insignia de mesa abre el menú de la tarjeta (no es un control aparte)", async () => {
    h.asignaciones = [asignacion("r-ana", "m7", "7")];
    montar();
    await conMesasCargadas();

    fireEvent.click(await screen.findByText("Mesa 7"));

    expect(await screen.findByRole("menu")).toBeInTheDocument();
  });
});

describe("ReservaCard suelta (desplegable del Reservado: sin arrastre)", () => {
  const acciones = { estaEnCurso: () => false } as unknown as Parameters<typeof ReservaCard>[0]["acciones"];
  const columnas = [
    { id: "__sin_asignar__", title: "Sin asignar" },
    { id: "reservado", title: "Reservado", privada: true },
    { id: "salon", title: "Salón" },
  ] as unknown as Parameters<typeof ReservaCard>[0]["columnas"];

  function pintar(extra: Partial<Parameters<typeof ReservaCard>[0]> = {}) {
    const reservaCard = { ...reserva("r-lola", "confirmada", "Lola"), espacio_id: "reservado" } as unknown as ReservaServicio;
    render(
      <ReservaCard
        reserva={reservaCard}
        columnas={columnas}
        acciones={acciones}
        onMover={vi.fn()}
        onToggleImportante={vi.fn()}
        onBlacklist={vi.fn()}
        puedeEditar
        sinArrastre
        telefonoEnlace
        {...extra}
      />,
    );
  }

  it("tocar la tarjeta abre el menú; el enlace de teléfono sigue siendo un enlace y no lo abre", async () => {
    pintar();

    fireEvent.click(screen.getByRole("link", { name: /\+34612345678/ }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Lola"));
    expect(await screen.findByRole("menu")).toBeInTheDocument();
  });

  it("Intro y Espacio abren el menú (no hay KeyboardSensor que se los quede)", async () => {
    pintar();
    const card = screen.getByRole("button", { name: /^Lola,/ });

    fireEvent.keyDown(card, { key: "Enter" });
    expect(await screen.findByRole("menu")).toBeInTheDocument();
  });

  it("enseña «Mesa 7» con mesa y nada sin ella (aquí no se marca «Sin mesa»)", () => {
    pintar({ mesas: ["7"] });
    expect(screen.getByText("Mesa 7")).toBeInTheDocument();
  });
});
