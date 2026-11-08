/**
 * `ElegirMesaDialog` con el PLANO DE VERDAD dentro (`PlanoEspacio2D`) y los hooks de datos de
 * verdad, contra un doble en memoria de Supabase (`dobleSupabase.ts`).
 *
 * Es el test de CONTRATO entre el diálogo y el plano: que el diálogo le pase bien sala, día,
 * turno y reserva, y que lo que el plano hace con ellos —dejar la reserva «sentándose», guardar
 * al hacer clic en una mesa libre, rechazar una mesa ocupada, avisar de la capacidad— funcione
 * dentro del diálogo igual que en la pantalla de siempre. Las reglas de asignación en sí
 * (solapes, juntar mesas, deshacer…) las prueba `PlanoEspacio2D.asignacion.test.tsx`; aquí solo
 * hace falta ver que el diálogo no las estorba ni las duplica.
 *
 * Solo se mockean el permiso de edición, el editor de reservas (que abre el lápiz del panel del
 * plano) y `sonner`, para leer los avisos.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { diferido, vaciarAlmacen, type AlmacenDoble } from "./dobleSupabase";

const h = vi.hoisted(() => ({ almacen: undefined as unknown as AlmacenDoble }));

vi.mock("@/integrations/supabase/client", async () => {
  const { crearAlmacen, crearSupabaseDoble } = await import("./dobleSupabase");
  h.almacen = crearAlmacen();
  return { supabase: crearSupabaseDoble(h.almacen) };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: () => ({ canAccess: true, loading: false }),
}));
vi.mock("@/hooks/useEdicionReserva", () => ({
  useEdicionReserva: () => ({ editarReserva: vi.fn(), dialogoEdicion: null }),
}));

import { toast } from "sonner";
import { ElegirMesaDialog } from "@/components/reservas/ElegirMesaDialog";
// El diálogo carga el plano bajo demanda (`React.lazy`, 07/11/2026): se carga ya aquí para que la
// primera apertura no tarde más que lo que esperan los `findBy`.
import "@/components/reservas/PlanoEspacio2D";

const HOY = "2026-10-01";

const reserva = (id: string, nombre: string, hora: string, comensales: number, extra: Record<string, unknown> = {}) => ({
  id,
  nombre,
  fecha: HOY,
  hora,
  numero_comensales: comensales,
  estado: "confirmada",
  espacio_id: "e-reservado",
  telefono: "+34600000000",
  notas_cliente: null,
  importante: false,
  ...extra,
});

const mesa = (id: string, nombre: string, capacidad: number, x: number) => ({
  id,
  espacio_id: "e-reservado",
  nombre,
  capacidad,
  forma: "rectangular",
  ancho: 90,
  alto: 90,
  pos_x: x,
  pos_y: 1,
  rotacion: 0,
  activa: true,
  is_merged: false,
  original_mesas: null,
  etiqueta: null,
});

/** Ana acaba de llegar a Reservado (4 comensales, cena); Romero ya tiene la Mesa 5. */
const ANA = { id: "r-ana", nombre: "Ana", hora: "21:00:00", numero_comensales: 4, estado: "confirmada" };

function montar({ preparar }: { preparar?: (queryClient: QueryClient) => void } = {}) {
  const onCerrar = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 0 }, mutations: { retry: false } },
  });
  preparar?.(queryClient);
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/reservas?tab=hoy"]}>
        <ElegirMesaDialog reserva={ANA} fecha={HOY} espacioId="e-reservado" espacioNombre="Reservado" onCerrar={onCerrar} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onCerrar, queryClient };
}

/** Botón de una mesa del plano, por su nombre (el estado va detrás). */
const botonMesa = (nombre: string) => screen.findByRole("button", { name: new RegExp(`^${nombre} · `) });

/** El diálogo, ya con el plano cargado y la reserva señalada. */
async function abierto() {
  const dialogo = await screen.findByRole("dialog", { name: "Elige la mesa de Ana en Reservado" });
  // «Sentando a Ana»: la reserva está señalada, lista para hacer clic en una mesa.
  await within(dialogo).findByText("Toca una mesa del plano. Puedes elegir varias para juntarlas.");
  return dialogo;
}

const avisos = (metodo: "success" | "error" | "warning" | "info") =>
  vi.mocked(toast[metodo]).mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  vi.clearAllMocks();
  vaciarAlmacen(h.almacen);
  h.almacen.reservas = [
    reserva("r-ana", "Ana", "21:00:00", 4),
    reserva("r-romero", "Romero", "21:15:00", 2),
    // Otro turno y otra sala: no salen en este mapa.
    reserva("r-comida", "Comida Pérez", "14:00:00", 3),
    reserva("r-salon", "Del Salón", "21:00:00", 2, { espacio_id: "e-salon" }),
  ];
  h.almacen.mesas = [mesa("m4", "Mesa 4", 4, 1), mesa("m5", "Mesa 5", 2, 3), mesa("m6", "Mesa 6", 6, 5), mesa("m7", "Mesa 7", 2, 7)];
  h.almacen.asignaciones = [{ id: "a-romero", reserva_id: "r-romero", mesa_id: "m5" }];
});

describe("ElegirMesaDialog + PlanoEspacio2D", () => {
  it("abre el plano de la sala con la reserva ya señalada, en su día y su turno (cena)", async () => {
    montar();

    const dialogo = await abierto();

    // «Sentando a Ana» + sus datos: hora y comensales.
    expect(within(dialogo).getByText("Ana", { selector: "strong" })).toBeInTheDocument();
    // El panel del turno de cena de Reservado: Ana y Romero; ni la comida ni la reserva de otra sala.
    expect(within(dialogo).getByRole("button", { name: "Arrastrar Ana al plano" })).toBeInTheDocument();
    expect(within(dialogo).getByRole("button", { name: "Arrastrar Romero al plano" })).toBeInTheDocument();
    expect(within(dialogo).queryByRole("button", { name: "Arrastrar Comida Pérez al plano" })).not.toBeInTheDocument();
    expect(within(dialogo).queryByRole("button", { name: "Arrastrar Del Salón al plano" })).not.toBeInTheDocument();
    // Sin avisos de «esa reserva no está en la sala».
    expect(avisos("info")).toEqual([]);
  });

  it("aunque la caché traiga la lista de la sala de ANTES del movimiento (sin la reserva), la encuentra: el plano espera a la lista al día", async () => {
    // Pasa de verdad: se abre el plano de Reservado, se vuelve al kanban, se mueve a otra persona a Reservado
    // y la lista de la sala que quedó cacheada no la trae. Sin esperar al refresco, el plano buscaría a Ana
    // en esa lista vieja, no la vería y daría el encargo por perdido («Esa reserva no está en Reservado…»).
    const lista = diferido();
    h.almacen.antesDeLeer = (l) => (l.tabla === "reservas" && l.eq.some(([c]) => c === "espacio_id") ? lista.promesa : undefined);
    montar({
      preparar: (qc) =>
        qc.setQueryData(["reservas_sala_dia", "e-reservado", HOY], [reserva("r-romero", "Romero", "21:15:00", 2)]),
    });

    // La lista nueva tarda: con la vieja a mano el diálogo NO monta el plano.
    await waitFor(() => expect(h.almacen.lecturas.some((l) => l.tabla === "mesas")).toBe(true));
    await act(async () => void (await new Promise((r) => setTimeout(r, 60))));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    lista.resolver();

    const dialogo = await abierto();

    expect(within(dialogo).getByRole("button", { name: "Arrastrar Ana al plano" })).toBeInTheDocument();
    expect(avisos("info")).toEqual([]);
  });

  it("un clic en una mesa libre la asigna: guarda por el RPC de siempre, el pie pasa a «Listo» y dice cuál", async () => {
    montar();
    const dialogo = await abierto();

    fireEvent.click(await botonMesa("Mesa 6"));

    await waitFor(() =>
      expect(h.almacen.llamadasRpc).toEqual([
        { nombre: "asignar_mesas_reserva", args: { p_reserva_id: "r-ana", p_mesa_ids: ["m6"] } },
      ]),
    );
    expect(await within(dialogo).findByText("Mesa 6 asignada")).toBeInTheDocument();
    expect(within(dialogo).getByRole("button", { name: "Listo" })).toBeInTheDocument();
    expect(within(dialogo).queryByRole("button", { name: "Ahora no" })).not.toBeInTheDocument();
    expect(avisos("success")).toContain("Ana → Mesa 6");
    // Y no hay nada que corregir: 6 plazas para 4.
    expect(avisos("warning")).toEqual([]);
  });

  it("si la mesa es corta la guarda igualmente y avisa de lo que falta (no bloquea)", async () => {
    montar();
    await abierto();

    fireEvent.click(await botonMesa("Mesa 7"));

    await waitFor(() => expect(h.almacen.asignaciones.some((a) => a.reserva_id === "r-ana" && a.mesa_id === "m7")).toBe(true));
    await waitFor(() =>
      expect(avisos("warning")).toEqual([
        "Mesa 7 da 2 plazas y son 4: faltan 2. Puedes juntar otra mesa o dejarlo así.",
      ]),
    );
  });

  it("una mesa que ya es de otra reserva a una hora que se pisa se rechaza, diciendo de quién y hasta cuándo", async () => {
    montar();
    const dialogo = await abierto();

    fireEvent.click(await botonMesa("Mesa 5"));

    // Romero 21:15 ocupa la mesa hasta las 23:15 (120 min de cena); Ana es a las 21:00.
    await waitFor(() =>
      expect(avisos("error")).toEqual([
        "La mesa Mesa 5 está ocupada de 21:15 a 23:15 por Romero. Elige otra mesa o quítasela primero.",
      ]),
    );
    expect(h.almacen.llamadasRpc).toEqual([]);
    expect(within(dialogo).getByRole("button", { name: "Ahora no" })).toBeInTheDocument();
  });

  it("«Ahora no» cierra sin asignar nada", async () => {
    const { onCerrar } = montar();
    const dialogo = await abierto();

    fireEvent.click(within(dialogo).getByRole("button", { name: "Ahora no" }));

    expect(onCerrar).toHaveBeenCalledTimes(1);
    expect(h.almacen.llamadasRpc).toEqual([]);
    expect(h.almacen.asignaciones).toEqual([{ id: "a-romero", reserva_id: "r-romero", mesa_id: "m5" }]);
  });
});
