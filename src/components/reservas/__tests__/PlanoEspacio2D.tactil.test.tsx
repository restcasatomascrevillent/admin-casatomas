/**
 * PlanoEspacio2D con el DEDO (tablet táctil) — encargo del dueño, 2026-10-03.
 *
 * Qué se comprueba aquí (el resto de la pantalla ya lo cubren
 * `PlanoEspacio2D.asignacion` y `PlanoEspacio2D.altaMesa`):
 *   · Sentando: un toque que no se mueve elige la mesa (llega como `click`),
 *     pero APOYAR el dedo no hace nada — así un pellizco que empieza encima de
 *     una mesa no la elige.
 *   · La zona sensible de la mesa es su contenedor (≥ 44 px), no solo el botón.
 *   · Pellizco = zoom, un dedo sobre el vacío = pan, sobre una mesa = la mesa.
 *   · Recolocar una mesa con el dedo: zona muerta de 6 px y sin escritura si no
 *     se ha movido.
 *   · Los controles táctiles miden ≥ 44 px.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const h = vi.hoisted(() => {
  const store = {
    reservas: [] as any[],
    mesas: [] as any[],
    asignaciones: [] as any[],
    llamadasRpc: [] as Array<{ nombre: string; args: any }>,
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
    b.eq = seguir;
    b.then = (ok: any, mal?: any) =>
      Promise.resolve({
        data: tabla === "reservas" ? store.reservas : tabla === "asignaciones_mesa" ? store.asignaciones : {},
        error: null,
      }).then(ok, mal);
    return b;
  };
  const supabaseDoble = {
    from: (tabla: string) => construirBuilder(tabla),
    rpc: async (nombre: string, args: any) => {
      store.llamadasRpc.push({ nombre, args });
      return { data: [], error: null };
    },
  };
  return { store, supabaseDoble, actualizar: vi.fn() };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: h.supabaseDoble }));
vi.mock("@/hooks/useMesas");
vi.mock("@/hooks/usePlanosEspacio");
vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: () => ({ canAccess: true, loading: false }),
}));
vi.mock("@/hooks/useEdicionReserva", () => ({
  useEdicionReserva: () => ({ editarReserva: vi.fn(), dialogoEdicion: null }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

import { useMesas, useCrearMesa, useActualizarMesasSilent, useEliminarMesa } from "@/hooks/useMesas";
import { usePlanoEspacio } from "@/hooks/usePlanosEspacio";
import { PlanoEspacio2D } from "@/components/reservas/PlanoEspacio2D";

const FECHA = "2026-09-26";
const ESPACIO = "e-salon";

const mesa = (id: string, nombre: string, capacidad: number, pos_x: number) => ({
  id,
  espacio_id: ESPACIO,
  nombre,
  capacidad,
  forma: "rectangular",
  ancho: 90,
  alto: 90,
  pos_x,
  pos_y: 1,
  rotacion: 0,
  activa: true,
  is_merged: false,
  original_mesas: null,
  etiqueta: null,
  created_at: "2026-09-01T10:00:00Z",
  updated_at: "2026-09-01T10:00:00Z",
});

function montar() {
  h.store.reservas = [
    {
      id: "r-ana",
      nombre: "Ana López",
      hora: "13:30:00",
      numero_comensales: 2,
      estado: "confirmada",
      fecha: FECHA,
      espacio_id: ESPACIO,
      telefono: "+34600000000",
    },
  ];
  h.store.asignaciones = [];
  h.store.llamadasRpc = [];
  const mesas = [mesa("m4", "Mesa 4", 4, 1), mesa("m5", "Mesa 5", 2, 4)];
  vi.mocked(useMesas).mockReturnValue({ data: mesas, isLoading: false } as never);
  vi.mocked(usePlanoEspacio).mockReturnValue({
    data: { pixels_per_meter: 50, ancho_metros: 12, alto_metros: 8, configuracion: { elementos: [] } },
  } as never);
  vi.mocked(useCrearMesa).mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never);
  vi.mocked(useActualizarMesasSilent).mockReturnValue({ mutate: h.actualizar, isPending: false } as never);
  vi.mocked(useEliminarMesa).mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never);

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/reservas?fecha=${FECHA}&turno=comida`]}>
        <PlanoEspacio2D espacioId={ESPACIO} espacioNombre="Salón" onBack={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const botonMesa = (nombre: string) => screen.getByRole("button", { name: new RegExp(`^${nombre} · `) });
const zonaMesa = (id: string) => document.querySelector(`[data-mesa-id="${id}"]`) as HTMLElement;
const lienzo = () => document.querySelector(".touch-none") as HTMLElement;
const porcentaje = () => Number(screen.getByText(/^\d+%$/).textContent!.replace("%", ""));
const rpcs = () => h.store.llamadasRpc.filter((l) => l.nombre === "asignar_mesas_reserva");

function puntero(tipo: string, id: number, x: number, y: number) {
  const ev = new MouseEvent(tipo, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperty(ev, "pointerId", { value: id });
  Object.defineProperty(ev, "pointerType", { value: "touch" });
  return ev;
}

async function empezarASentar() {
  fireEvent.click(await screen.findByRole("button", { name: "Sentar a Ana López" }));
  await screen.findByText(/Sentando a/);
}

describe("PlanoEspacio2D · con el dedo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sentando: apoyar el dedo sobre una mesa NO la elige; el toque (click) sí", async () => {
    montar();
    await empezarASentar();

    fireEvent.touchStart(botonMesa("Mesa 4"), { touches: [{ clientX: 50, clientY: 50 }] });
    await new Promise((r) => setTimeout(r, 30));
    expect(rpcs()).toHaveLength(0);

    fireEvent.click(botonMesa("Mesa 4"));
    await waitFor(() => expect(rpcs()).toHaveLength(1));
    expect(rpcs()[0].args.p_mesa_ids).toEqual(["m4"]);
  });

  it("la zona sensible es el contenedor de la mesa, no solo su botón (≥ 44 px)", async () => {
    montar();
    await empezarASentar();

    // Un toque en el relleno de la zona (fuera del botón) también elige la mesa.
    fireEvent.click(zonaMesa("m5"));
    await waitFor(() => expect(rpcs()).toHaveLength(1));
    expect(rpcs()[0].args.p_mesa_ids).toEqual(["m5"]);
  });

  it("pellizco con dos dedos: separarlos acerca el plano y juntarlos lo aleja", async () => {
    montar();
    await screen.findByRole("button", { name: "Acercar" });
    const antes = porcentaje();

    act(() => {
      lienzo().dispatchEvent(puntero("pointerdown", 1, 100, 100));
      lienzo().dispatchEvent(puntero("pointerdown", 2, 140, 100));
    });
    act(() => {
      window.dispatchEvent(puntero("pointermove", 1, 60, 100));
      window.dispatchEvent(puntero("pointermove", 2, 180, 100));
    });
    const acercado = porcentaje();
    expect(acercado).toBeGreaterThan(antes);

    act(() => {
      window.dispatchEvent(puntero("pointermove", 1, 100, 100));
      window.dispatchEvent(puntero("pointermove", 2, 110, 100));
    });
    expect(porcentaje()).toBeLessThan(acercado);

    act(() => {
      window.dispatchEvent(puntero("pointerup", 1, 100, 100));
      window.dispatchEvent(puntero("pointerup", 2, 110, 100));
    });
  });

  it("un dedo sobre el vacío arrastra el plano; sobre una mesa lo deja a la mesa", async () => {
    montar();
    await screen.findByRole("button", { name: "Acercar" });
    const plano = lienzo().querySelector("div.absolute") as HTMLElement;
    const izquierdaAntes = plano.style.left;

    // Sobre el vacío: el contenido se desplaza.
    act(() => {
      lienzo().dispatchEvent(puntero("pointerdown", 1, 300, 300));
      window.dispatchEvent(puntero("pointermove", 1, 360, 330));
      window.dispatchEvent(puntero("pointerup", 1, 360, 330));
    });
    expect(plano.style.left).not.toBe(izquierdaAntes);
    const izquierdaTrasPan = plano.style.left;

    // Encima de una mesa: no mueve el plano (es de la mesa).
    act(() => {
      botonMesa("Mesa 4").dispatchEvent(puntero("pointerdown", 1, 300, 300));
      window.dispatchEvent(puntero("pointermove", 1, 400, 380));
      window.dispatchEvent(puntero("pointerup", 1, 400, 380));
    });
    expect(plano.style.left).toBe(izquierdaTrasPan);
  });

  it("recolocar una mesa: un toque sin mover no escribe; arrastrarla de verdad sí", async () => {
    montar();
    await screen.findByRole("button", { name: "Sentar a Ana López" });

    const mesa4 = botonMesa("Mesa 4");
    // Toque suelto con un temblor de 2 px.
    fireEvent.touchStart(mesa4, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchMove(mesa4, { touches: [{ clientX: 102, clientY: 101 }] });
    fireEvent.touchEnd(mesa4);
    expect(h.actualizar).not.toHaveBeenCalled();

    // Arrastre de 80 px.
    fireEvent.touchStart(mesa4, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchMove(mesa4, { touches: [{ clientX: 140, clientY: 120 }] });
    fireEvent.touchMove(mesa4, { touches: [{ clientX: 180, clientY: 140 }] });
    fireEvent.touchEnd(mesa4);
    expect(h.actualizar).toHaveBeenCalledTimes(1);
    const [cambios] = h.actualizar.mock.calls[0];
    expect(cambios[0].id).toBe("m4");
    expect(cambios[0].pos_x).toBeGreaterThan(1);
  });

  it("los controles de zoom y de cabecera miden al menos 44 px", async () => {
    montar();
    for (const nombre of ["Alejar", "Acercar", "Centrar plano", "Día anterior", "Día siguiente"]) {
      const boton = await screen.findByRole("button", { name: nombre });
      expect(boton.className, nombre).toMatch(/\bh-11\b/);
    }
    expect(screen.getByRole("button", { name: "Sentar a Ana López" }).className).toMatch(/\bh-11\b/);
    expect(screen.getByRole("button", { name: "Arrastrar Ana López al plano" }).className).toMatch(/\bh-11\b/);
  });
});
