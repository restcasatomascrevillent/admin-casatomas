/**
 * Tests para src/components/reservas/GestionMesasEspacios.tsx
 *
 * Estrategia: se mockean los hooks de Supabase (`useMesas`, `useEspaciosReserva`)
 * pero NO la lógica de cuadre (`src/lib/reservas/aforoMesas.ts`), que corre de
 * verdad — así estos tests también cubren que la pantalla lee bien las cifras.
 *
 * El escenario por defecto es el ESTADO REAL DE PRODUCCIÓN del 2026-09-26, que
 * es el que motivó el encargo:
 *
 *   Comedor (casa_tomas)      50 declaradas ·  2 mesas ·  4 plazas
 *   Salón (casa_tomas)        50 declaradas · 15 mesas · 64 plazas
 *   Terraza (casa_tomas)      50 declaradas ·  3 mesas · 12 plazas
 *   Reservado (casa_tomas)    20 declaradas ·  0 mesas ·  0 plazas
 *   Interior (touza)          30 declaradas ·  0 mesas ·  0 plazas
 *   Terraza (touza)           30 declaradas ·  0 mesas ·  0 plazas
 *   El Reservado (touza)      20 declaradas ·  0 mesas ·  0 plazas
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("@/hooks/useMesas");
vi.mock("@/hooks/useEspaciosReserva");
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import {
  useMesas,
  useCrearMesa,
  useActualizarMesa,
  useEliminarMesa,
} from "@/hooks/useMesas";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { GestionMesasEspacios } from "@/components/reservas/GestionMesasEspacios";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const espacio = (
  id: string,
  nombre: string,
  capacidad_maxima: number,
  marca: string,
  activa = true,
) => ({
  id,
  nombre,
  descripcion: null,
  capacidad_maxima,
  activa,
  caracteristicas: { marca },
});

const mesa = (
  id: string,
  espacio_id: string,
  nombre: string,
  capacidad: number,
  extra: Record<string, unknown> = {},
) => ({
  id,
  espacio_id,
  nombre,
  capacidad,
  forma: "rectangular",
  ancho: 100,
  alto: 80,
  pos_x: 0,
  pos_y: 0,
  rotacion: 0,
  activa: true,
  is_merged: false,
  original_mesas: null,
  etiqueta: null,
  created_at: "2026-09-01T10:00:00Z",
  updated_at: "2026-09-01T10:00:00Z",
  ...extra,
});

const ESPACIOS_PRODUCCION = [
  espacio("e-comedor", "Comedor", 50, "casa_tomas"),
  espacio("e-salon", "Salón", 50, "casa_tomas"),
  espacio("e-terraza-ct", "Terraza", 50, "casa_tomas"),
  espacio("e-reservado-ct", "Reservado", 20, "casa_tomas"),
  espacio("e-interior-tz", "Interior", 30, "touza"),
  espacio("e-terraza-tz", "Terraza", 30, "touza"),
  espacio("e-reservado-tz", "El Reservado", 20, "touza"),
];

// Comedor: 2 mesas = 4 plazas. Salón: 15 mesas = 64 plazas. Terraza CT: 3 = 12.
const MESAS_PRODUCCION = [
  mesa("m-c1", "e-comedor", "Comedor 1", 2),
  mesa("m-c2", "e-comedor", "Comedor 2", 2),
  ...Array.from({ length: 14 }, (_, i) => mesa(`m-s${i + 1}`, "e-salon", `Salón ${i + 1}`, 4)),
  mesa("m-s15", "e-salon", "Salón 15", 8),
  mesa("m-t1", "e-terraza-ct", "Terraza 1", 4),
  mesa("m-t2", "e-terraza-ct", "Terraza 2", 4),
  mesa("m-t3", "e-terraza-ct", "Terraza 3", 4),
];

const crearMutate = vi.fn().mockResolvedValue({ id: "m-nueva" });
const actualizarMutate = vi.fn().mockResolvedValue({ id: "m-c1" });
const eliminarMutate = vi.fn().mockResolvedValue(undefined);

function montar({
  espacios = ESPACIOS_PRODUCCION,
  mesas = MESAS_PRODUCCION,
  cargando = false,
}: {
  espacios?: unknown[];
  mesas?: unknown[];
  cargando?: boolean;
} = {}) {
  vi.mocked(useEspaciosReserva).mockReturnValue({
    data: espacios,
    isLoading: cargando,
  } as never);
  vi.mocked(useMesas).mockReturnValue({
    data: mesas,
    isLoading: cargando,
  } as never);
  vi.mocked(useCrearMesa).mockReturnValue({
    mutateAsync: crearMutate,
    isPending: false,
  } as never);
  vi.mocked(useActualizarMesa).mockReturnValue({
    mutateAsync: actualizarMutate,
    isPending: false,
  } as never);
  vi.mocked(useEliminarMesa).mockReturnValue({
    mutateAsync: eliminarMutate,
    isPending: false,
  } as never);
  return render(<GestionMesasEspacios />);
}

/** Bloque (tarjeta) de un espacio, localizado por su nombre visible. */
function bloqueDe(nombre: string, ocurrencia = 0): HTMLElement {
  const titulos = screen.getAllByText(nombre);
  const bloque = titulos[ocurrencia].closest("div.rounded-lg.border");
  if (!bloque) throw new Error(`No se encontró el bloque del espacio "${nombre}"`);
  return bloque as HTMLElement;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GestionMesasEspacios", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    crearMutate.mockResolvedValue({ id: "m-nueva" });
    actualizarMutate.mockResolvedValue({ id: "m-c1" });
    eliminarMutate.mockResolvedValue(undefined);
  });

  // ── Carga y estructura ─────────────────────────────────────────────────────

  it("muestra un indicador de carga mientras llegan espacios y mesas", () => {
    montar({ cargando: true });
    expect(screen.getByLabelText("Cargando")).toBeInTheDocument();
  });

  it("avisa cuando no hay ningún espacio dado de alta", () => {
    montar({ espacios: [], mesas: [] });
    expect(screen.getByText(/No hay espacios de reserva dados de alta/i)).toBeInTheDocument();
  });

  it("agrupa los espacios por negocio, Casa Tomás antes que Touza", () => {
    montar();
    const insignias = screen.getAllByTitle(/^Negocio:/);
    expect(insignias[0]).toHaveTextContent("Casa Tomás");
    expect(insignias[1]).toHaveTextContent("Touza");
  });

  it("pinta los siete espacios de producción", () => {
    montar();
    expect(screen.getByText("Comedor")).toBeInTheDocument();
    expect(screen.getByText("Salón")).toBeInTheDocument();
    expect(screen.getByText("Reservado")).toBeInTheDocument();
    expect(screen.getByText("Interior")).toBeInTheDocument();
    expect(screen.getByText("El Reservado")).toBeInTheDocument();
    // "Terraza" está en los dos negocios
    expect(screen.getAllByText("Terraza")).toHaveLength(2);
  });

  // ── El descuadre se ve ─────────────────────────────────────────────────────

  it("enseña capacidad declarada y plazas de las mesas de cada espacio", () => {
    montar();
    const salon = bloqueDe("Salón");
    expect(salon).toHaveTextContent(/Declarada\s*50/);
    expect(salon).toHaveTextContent(/15 mesas\s*=\s*64 plazas/);

    const comedor = bloqueDe("Comedor");
    expect(comedor).toHaveTextContent(/Declarada\s*50/);
    expect(comedor).toHaveTextContent(/2 mesas\s*=\s*4 plazas/);
  });

  it("avisa de que sobran plazas cuando las mesas pasan de la capacidad declarada", () => {
    montar();
    // Salón: 64 plazas frente a 50 declaradas
    expect(bloqueDe("Salón")).toHaveTextContent(/Sobran 14 plazas/i);
  });

  it("avisa de que faltan plazas cuando las mesas no llegan a la capacidad declarada", () => {
    montar();
    // Comedor: 4 plazas frente a 50 declaradas
    expect(bloqueDe("Comedor")).toHaveTextContent(/Faltan 46 plazas/i);
  });

  it("marca los espacios sin ninguna mesa dada de alta", () => {
    montar();
    const reservado = bloqueDe("Reservado");
    expect(reservado).toHaveTextContent(/Sin mesas/i);
    expect(reservado).toHaveTextContent(/no tiene mesas dadas de alta/i);
  });

  it("deja claro que el descuadre no impide reservar ni guardar", () => {
    montar();
    expect(bloqueDe("Salón")).toHaveTextContent(/No impide reservar/i);
    expect(
      screen.getByText(/Los avisos de arriba no\s+impiden guardar ni reservar/i),
    ).toBeInTheDocument();
  });

  it("no avisa cuando un espacio cuadra", () => {
    montar({
      espacios: [espacio("e-ok", "Sala Cuadrada", 8, "casa_tomas")],
      mesas: [mesa("m-1", "e-ok", "Mesa 1", 4), mesa("m-2", "e-ok", "Mesa 2", 4)],
    });
    const bloque = bloqueDe("Sala Cuadrada");
    expect(bloque).toHaveTextContent(/Cuadra/);
    expect(bloque).not.toHaveTextContent(/No impide reservar/i);
  });

  it("resume por negocio el aforo declarado frente a la suma de mesas", () => {
    montar();
    // Casa Tomás: 50+50+50+20 = 170 declaradas, 4+64+12+0 = 80 sumando mesas.
    const declarados = screen.getAllByText(/Aforo declarado/i);
    expect(declarados[0]).toHaveTextContent(/170/);
    // Touza: 30+30+20 = 80 declaradas.
    expect(declarados[1]).toHaveTextContent(/80/);
    const resumenes = screen.getAllByText(/sumando mesas/i);
    expect(resumenes[0]).toHaveTextContent("80");
    // Touza: 30+30+20 = 80 declaradas, 0 sumando mesas → se quedaría sin aforo.
    expect(resumenes[1]).toHaveTextContent("0");
    expect(screen.getByText(/Sin mesas en ninguna sala/i)).toBeInTheDocument();
  });

  it("no marca a un negocio como bloqueado si alguna de sus salas tiene mesas", () => {
    montar();
    // Casa Tomás tiene "Reservado" a 0 mesas, pero sus otras salas suman 80:
    // el trigger de aforo suma por MARCA, así que no se quedaría sin aforo.
    const insigniasBloqueo = screen.queryAllByText(/Sin mesas en ninguna sala/i);
    expect(insigniasBloqueo).toHaveLength(1);
  });

  // ── Mesas: listado ─────────────────────────────────────────────────────────

  it("lista las mesas de cada espacio con sus plazas", () => {
    montar();
    const comedor = bloqueDe("Comedor");
    expect(within(comedor).getByText("Comedor 1")).toBeInTheDocument();
    expect(within(comedor).getByText("Comedor 2")).toBeInTheDocument();
    expect(within(comedor).getAllByText("2 plazas")).toHaveLength(2);
  });

  it("muestra las mesas desactivadas sin que sumen plazas", () => {
    montar({
      espacios: [espacio("e-x", "Sala X", 10, "casa_tomas")],
      mesas: [
        mesa("m-1", "e-x", "Mesa viva", 4),
        mesa("m-2", "e-x", "Mesa guardada", 6, { activa: false }),
      ],
    });
    const bloque = bloqueDe("Sala X");
    expect(within(bloque).getByText("Mesa guardada")).toBeInTheDocument();
    expect(within(bloque).getByText("Sin usar")).toBeInTheDocument();
    // Solo cuenta la activa: 1 mesa = 4 plazas
    expect(bloque).toHaveTextContent(/1 mesa\s*=\s*4 plazas/);
  });

  it("señala las mesas unidas en el plano", () => {
    montar({
      espacios: [espacio("e-x", "Sala X", 10, "casa_tomas")],
      mesas: [mesa("m-1", "e-x", "Mesa 1+2", 8, { is_merged: true })],
    });
    expect(within(bloqueDe("Sala X")).getByText("Unida")).toBeInTheDocument();
  });

  // ── Mesas: alta ────────────────────────────────────────────────────────────

  it("da de alta una mesa en el espacio elegido", async () => {
    montar();
    fireEvent.click(within(bloqueDe("Reservado")).getByRole("button", { name: /Añadir mesa/i }));

    expect(await screen.findByRole("dialog")).toHaveTextContent("Nueva mesa");
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "  Mesa 1  " } });
    fireEvent.change(screen.getByLabelText("Plazas"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: /Crear mesa/i }));

    await waitFor(() => expect(crearMutate).toHaveBeenCalledTimes(1));
    expect(crearMutate).toHaveBeenCalledWith({
      espacio_id: "e-reservado-ct",
      nombre: "Mesa 1",
      etiqueta: null,
      capacidad: 6,
      forma: "rectangular",
      activa: true,
    });
  });

  it("no manda posiciones al crear: eso se hace en el editor de plano", async () => {
    montar();
    fireEvent.click(within(bloqueDe("Interior")).getByRole("button", { name: /Añadir mesa/i }));
    fireEvent.change(await screen.findByLabelText("Nombre"), { target: { value: "Barra" } });
    fireEvent.click(screen.getByRole("button", { name: /Crear mesa/i }));

    await waitFor(() => expect(crearMutate).toHaveBeenCalled());
    const payload = crearMutate.mock.calls[0][0];
    expect(payload).not.toHaveProperty("pos_x");
    expect(payload).not.toHaveProperty("pos_y");
    expect(payload).not.toHaveProperty("ancho");
    expect(payload).not.toHaveProperty("alto");
  });

  it("guarda la etiqueta opcional cuando se rellena", async () => {
    montar();
    fireEvent.click(within(bloqueDe("Interior")).getByRole("button", { name: /Añadir mesa/i }));
    fireEvent.change(await screen.findByLabelText("Nombre"), { target: { value: "Mesa 9" } });
    fireEvent.change(screen.getByLabelText(/Etiqueta/i), { target: { value: "Junto a la ventana" } });
    fireEvent.click(screen.getByRole("button", { name: /Crear mesa/i }));

    await waitFor(() => expect(crearMutate).toHaveBeenCalled());
    expect(crearMutate.mock.calls[0][0].etiqueta).toBe("Junto a la ventana");
  });

  it("no crea la mesa si falta el nombre", async () => {
    montar();
    fireEvent.click(within(bloqueDe("Interior")).getByRole("button", { name: /Añadir mesa/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Crear mesa/i }));

    expect(await screen.findByText(/Ponle un nombre a la mesa/i)).toBeInTheDocument();
    expect(crearMutate).not.toHaveBeenCalled();
  });

  it("no crea la mesa si las plazas están fuera de rango", async () => {
    montar();
    fireEvent.click(within(bloqueDe("Interior")).getByRole("button", { name: /Añadir mesa/i }));
    fireEvent.change(await screen.findByLabelText("Nombre"), { target: { value: "Mesa rara" } });
    fireEvent.change(screen.getByLabelText("Plazas"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /Crear mesa/i }));

    expect(await screen.findByText(/Entre 1 y 50 plazas/i)).toBeInTheDocument();
    expect(crearMutate).not.toHaveBeenCalled();
  });

  // ── Mesas: edición ─────────────────────────────────────────────────────────

  it("precarga los datos de la mesa al editarla y guarda los cambios", async () => {
    montar();
    fireEvent.click(
      within(bloqueDe("Comedor")).getByRole("button", { name: "Editar Comedor 1" }),
    );

    const dialogo = await screen.findByRole("dialog");
    expect(dialogo).toHaveTextContent("Editar mesa");
    expect(screen.getByLabelText("Nombre")).toHaveValue("Comedor 1");
    expect(screen.getByLabelText("Plazas")).toHaveValue(2);

    fireEvent.change(screen.getByLabelText("Plazas"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: /Guardar cambios/i }));

    await waitFor(() => expect(actualizarMutate).toHaveBeenCalledTimes(1));
    expect(actualizarMutate).toHaveBeenCalledWith({
      id: "m-c1",
      nombre: "Comedor 1",
      etiqueta: null,
      capacidad: 4,
      forma: "rectangular",
      activa: true,
    });
  });

  it("permite desactivar una mesa sin borrarla", async () => {
    montar();
    fireEvent.click(
      within(bloqueDe("Comedor")).getByRole("button", { name: "Editar Comedor 1" }),
    );
    fireEvent.click(await screen.findByLabelText("Mesa en uso"));
    fireEvent.click(screen.getByRole("button", { name: /Guardar cambios/i }));

    await waitFor(() => expect(actualizarMutate).toHaveBeenCalled());
    expect(actualizarMutate.mock.calls[0][0].activa).toBe(false);
  });

  it("cierra el diálogo sin guardar al cancelar", async () => {
    montar();
    fireEvent.click(within(bloqueDe("Interior")).getByRole("button", { name: /Añadir mesa/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Cancelar/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(crearMutate).not.toHaveBeenCalled();
  });

  // ── Mesas: borrado ─────────────────────────────────────────────────────────

  it("pide confirmación antes de borrar una mesa", async () => {
    montar();
    fireEvent.click(
      within(bloqueDe("Comedor")).getByRole("button", { name: "Borrar Comedor 2" }),
    );

    expect(await screen.findByText(/¿Borrar la mesa Comedor 2\?/i)).toBeInTheDocument();
    expect(eliminarMutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Borrar mesa/i }));
    await waitFor(() => expect(eliminarMutate).toHaveBeenCalledWith("m-c2"));
  });

  it("no borra nada si se cancela la confirmación", async () => {
    montar();
    fireEvent.click(
      within(bloqueDe("Comedor")).getByRole("button", { name: "Borrar Comedor 2" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: /^Cancelar$/i }));

    await waitFor(() =>
      expect(screen.queryByText(/¿Borrar la mesa Comedor 2\?/i)).not.toBeInTheDocument(),
    );
    expect(eliminarMutate).not.toHaveBeenCalled();
  });

  // ── Espacios desactivados ──────────────────────────────────────────────────

  it("marca los espacios desactivados y los deja fuera del resumen del negocio", () => {
    montar({
      espacios: [
        espacio("e-on", "Sala Activa", 10, "casa_tomas"),
        espacio("e-off", "Sala Cerrada", 40, "casa_tomas", false),
      ],
      mesas: [mesa("m-1", "e-on", "Mesa 1", 10)],
    });
    expect(within(bloqueDe("Sala Cerrada")).getByText("Desactivado")).toBeInTheDocument();
    // El resumen por negocio replica el filtro del trigger (`activa = true`):
    // solo cuenta la sala activa, así que declara 10 y no 50.
    expect(screen.getByText(/Aforo declarado/i).closest("span")).toHaveTextContent(/10/);
  });
});
