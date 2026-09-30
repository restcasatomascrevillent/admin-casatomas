/**
 * `ControlLlegada` — tests de caracterización de EFECTOS.
 *
 * `ControlLlegada` es la botonera de servicio de la tarjeta del kanban («Ha
 * llegado», «No se presentó», «Deshacer»). Aquí se fija qué ACCIÓN dispara cada
 * control, sobre qué reserva, y —con el hook real detrás— qué acaba escribiéndose
 * y que NINGUNA de estas acciones manda correo (`notify-reservation-change`).
 * No se afirma nada del aspecto ni del número de botones: los controles se buscan
 * por su nombre accesible.
 *
 * `// BUG conocido` marca lo que está mal y se deja así a propósito: este fichero
 * NO arregla nada, describe el punto de partida.
 *
 * Nada llega a Supabase: el cliente y `sonner` están mockeados.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/integrations/supabase/client");
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ControlLlegada } from "@/components/reservas/ControlLlegada";
import { useAccionesServicioReserva, __resetColumnaLlegadaParaTests } from "@/hooks/useAccionesServicioReserva";
import type { ReservaServicio } from "@/lib/reservas/servicioSala";

// Radix (DropdownMenu) necesita estos tres métodos, que jsdom no implementa.
beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

const reserva = (extra: Partial<ReservaServicio> = {}): ReservaServicio => ({
  id: "r1",
  nombre: "Ana",
  hora: "21:00:00",
  numero_comensales: 4,
  estado: "confirmada",
  espacio_id: null,
  ...extra,
});

/** `acciones` de mentira: las cuatro acciones son espías y nada se escribe. */
function accionesFalsas(enCurso = false) {
  return {
    moverEspacio: vi.fn(),
    marcarLlegada: vi.fn(),
    marcarNoShow: vi.fn(),
    deshacerLlegadaONoShow: vi.fn(),
    estaEnCurso: vi.fn(() => enCurso),
  };
}

const botonLlegada = (nombre = "Ana") => screen.getByRole("button", { name: `Marcar que ${nombre} ha llegado` });

/** Abre el menú «…» de llegada (Radix abre con el teclado en jsdom) y devuelve el ítem «No se presentó». */
async function abrirMenuYElegirNoShow(nombre = "Ana") {
  const disparador = screen.getByRole("button", { name: `Más opciones de llegada para ${nombre}` });
  fireEvent.keyDown(disparador, { key: "Enter" });
  return await screen.findByRole("menuitem", { name: /No se presentó/ });
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetColumnaLlegadaParaTests();
});

describe("ControlLlegada · qué dispara cada control (con un `acciones` de mentira)", () => {
  it.each(["pendiente", "verificada", "confirmada"])(
    "reserva %s: «Ha llegado» llama a marcarLlegada con ESA reserva, una vez, y a nada más",
    (estado) => {
      const acciones = accionesFalsas();
      const r = reserva({ estado });
      render(<ControlLlegada reserva={r} acciones={acciones as never} />);

      fireEvent.click(botonLlegada());

      expect(acciones.marcarLlegada).toHaveBeenCalledTimes(1);
      expect(acciones.marcarLlegada).toHaveBeenCalledWith(r);
      expect(acciones.marcarNoShow).not.toHaveBeenCalled();
      expect(acciones.deshacerLlegadaONoShow).not.toHaveBeenCalled();
      expect(acciones.moverEspacio).not.toHaveBeenCalled();
    },
  );

  it("reserva viva: «No se presentó» (menú «…») llama a marcarNoShow con ESA reserva", async () => {
    // Vocabulario pendiente de unificar: hoy el menú dice «No se presentó»; el resto de
    // pantallas dicen «No vino».
    const acciones = accionesFalsas();
    const r = reserva({ estado: "verificada" });
    render(<ControlLlegada reserva={r} acciones={acciones as never} />);

    fireEvent.click(await abrirMenuYElegirNoShow());

    await waitFor(() => expect(acciones.marcarNoShow).toHaveBeenCalledTimes(1));
    expect(acciones.marcarNoShow).toHaveBeenCalledWith(r);
    expect(acciones.marcarLlegada).not.toHaveBeenCalled();
  });

  it("reserva «Llegó»: ya no hay «Ha llegado»; «Deshacer llegada» llama a deshacerLlegadaONoShow", () => {
    const acciones = accionesFalsas();
    const r = reserva({ estado: "completada", llegada_at: "2026-09-30T19:23:00.000Z" });
    render(<ControlLlegada reserva={r} acciones={acciones as never} />);

    expect(screen.queryByRole("button", { name: /ha llegado/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Deshacer llegada de Ana" }));

    expect(acciones.deshacerLlegadaONoShow).toHaveBeenCalledTimes(1);
    expect(acciones.deshacerLlegadaONoShow).toHaveBeenCalledWith(r);
    expect(acciones.marcarLlegada).not.toHaveBeenCalled();
  });

  it("reserva «No vino»: no hay «Ha llegado» ni menú; el deshacer llama a la MISMA acción que el de «Llegó»", () => {
    const acciones = accionesFalsas();
    const r = reserva({ estado: "no_show" });
    render(<ControlLlegada reserva={r} acciones={acciones as never} />);

    expect(screen.queryByRole("button", { name: /ha llegado/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /más opciones de llegada/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Quitar «no se presentó» de Ana" }));

    expect(acciones.deshacerLlegadaONoShow).toHaveBeenCalledTimes(1);
    expect(acciones.deshacerLlegadaONoShow).toHaveBeenCalledWith(r);
  });

  it.each(["cancelada", "rechazada", ""])("una reserva %j no pinta ningún control: «cancelada no sale»", (estado) => {
    const { container } = render(<ControlLlegada reserva={reserva({ estado })} acciones={accionesFalsas() as never} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("sin nombre, los controles hablan de «el cliente»", () => {
    render(<ControlLlegada reserva={reserva({ nombre: null })} acciones={accionesFalsas() as never} />);

    expect(screen.getByRole("button", { name: "Marcar que el cliente ha llegado" })).toBeInTheDocument();
  });

  it("mientras la reserva tiene una acción en curso los controles quedan deshabilitados y no disparan nada", () => {
    const acciones = accionesFalsas(true);
    render(<ControlLlegada reserva={reserva()} acciones={acciones as never} />);

    expect(botonLlegada()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Más opciones de llegada para Ana" })).toBeDisabled();
    fireEvent.click(botonLlegada());
    expect(acciones.marcarLlegada).not.toHaveBeenCalled();
    expect(acciones.estaEnCurso).toHaveBeenCalledWith("r1");
  });

  it("`disabled` desde fuera lo apaga igual, y también a los botones de deshacer", () => {
    const acciones = accionesFalsas();
    const { rerender } = render(<ControlLlegada reserva={reserva()} acciones={acciones as never} disabled />);
    expect(botonLlegada()).toBeDisabled();

    rerender(<ControlLlegada reserva={reserva({ estado: "completada" })} acciones={acciones as never} disabled />);
    expect(screen.getByRole("button", { name: "Deshacer llegada de Ana" })).toBeDisabled();
  });

  it("BUG conocido: no mira ningún permiso; el componente ni tiene una propiedad `canEdit`", () => {
    // Hoy solo la RLS de la BD impide que un usuario sin permiso de edición registre
    // llegadas (y, con la escritura comprobada por `ErrorSinFilasReserva`, le sale el
    // aviso «no tienes permiso»). La botonera se ofrece a todos los que ven el kanban.
    const acciones = accionesFalsas();
    render(<ControlLlegada reserva={reserva()} acciones={acciones as never} />);

    expect(botonLlegada()).toBeEnabled();
    fireEvent.click(botonLlegada());
    expect(acciones.marcarLlegada).toHaveBeenCalledTimes(1);
  });

  it("los eventos de puntero y de teclado no suben: pulsar aquí no arranca el arrastre de la tarjeta", () => {
    const alPulsarElPadre = vi.fn();
    const alTeclearEnElPadre = vi.fn();
    render(
      <div onPointerDown={alPulsarElPadre} onKeyDown={alTeclearEnElPadre}>
        <span data-testid="fuera">fuera de la botonera</span>
        <ControlLlegada reserva={reserva()} acciones={accionesFalsas() as never} />
      </div>,
    );

    // Los espías están vivos: un evento de fuera de la botonera SÍ llega al padre…
    fireEvent.pointerDown(screen.getByTestId("fuera"));
    fireEvent.keyDown(screen.getByTestId("fuera"), { key: "Enter" });
    expect(alPulsarElPadre).toHaveBeenCalledTimes(1);
    expect(alTeclearEnElPadre).toHaveBeenCalledTimes(1);

    // …y uno de dentro de la botonera no.
    fireEvent.pointerDown(botonLlegada());
    fireEvent.keyDown(botonLlegada(), { key: "Enter" });
    expect(alPulsarElPadre).toHaveBeenCalledTimes(1);
    expect(alTeclearEnElPadre).toHaveBeenCalledTimes(1);
  });
});

// ─── Con el hook REAL detrás: qué se escribe y que no hay correo ─────────────

interface Escritura {
  tabla: string;
  payload: Record<string, unknown>;
  eq: [string, unknown] | null;
  select: string | null;
}

function mockEscrituras(respuestas: Array<{ error?: unknown; data?: unknown }> = []) {
  const escrituras: Escritura[] = [];
  vi.mocked(supabase.from).mockImplementation(((tabla: string) => {
    const escritura: Escritura = { tabla, payload: {}, eq: null, select: null };
    const builder: Record<string, unknown> = {
      update: vi.fn((payload: Record<string, unknown>) => {
        escritura.payload = { ...payload };
        escrituras.push(escritura);
        return builder;
      }),
      eq: vi.fn((columna: string, valor: unknown) => {
        escritura.eq = [columna, valor];
        return builder;
      }),
      select: vi.fn((columnas: string) => {
        escritura.select = columnas;
        return builder;
      }),
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
        const r = respuestas.shift() ?? {};
        const data = "data" in r ? r.data : r.error ? null : [{ id: "r1" }];
        return Promise.resolve({ data, error: r.error ?? null }).then(ok, ko);
      },
    };
    return builder;
  }) as never);
  return escrituras;
}

function Arnes({ reserva: r }: { reserva: ReservaServicio }) {
  const acciones = useAccionesServicioReserva();
  return <ControlLlegada reserva={r} acciones={acciones} />;
}

function montarConHookReal(r: ReservaServicio) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const invalidadas: string[] = [];
  const invalidar = queryClient.invalidateQueries.bind(queryClient);
  vi.spyOn(queryClient, "invalidateQueries").mockImplementation((filtros, opciones) => {
    invalidadas.push(String((filtros as { queryKey: unknown[] }).queryKey[0]));
    return invalidar(filtros, opciones);
  });
  render(
    <QueryClientProvider client={queryClient}>
      <Arnes reserva={r} />
    </QueryClientProvider>,
  );
  return { invalidadas };
}

describe("ControlLlegada + useAccionesServicioReserva (hook real, Supabase mockeado)", () => {
  it("«Ha llegado» escribe estado 'completada' + llegada_at, refresca y NO manda correo", async () => {
    const escrituras = mockEscrituras();
    const { invalidadas } = montarConHookReal(reserva({ estado: "pendiente" }));

    fireEvent.click(botonLlegada());

    await waitFor(() => expect(invalidadas.length).toBeGreaterThan(0));
    expect(escrituras).toHaveLength(1);
    expect(escrituras[0]).toMatchObject({
      tabla: "reservas",
      eq: ["id", "r1"],
      select: "id",
      payload: { estado: "completada" },
    });
    expect(typeof escrituras[0].payload.llegada_at).toBe("string");
    expect(invalidadas).toEqual(expect.arrayContaining(["reservas-kanban", "reservas-hoy", "reservas-lista", "dashboard-stats"]));
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it("«No se presentó» escribe estado 'no_show' y llegada_at null, y NO manda correo", async () => {
    const escrituras = mockEscrituras();
    const { invalidadas } = montarConHookReal(reserva());

    fireEvent.click(await abrirMenuYElegirNoShow());

    await waitFor(() => expect(invalidadas.length).toBeGreaterThan(0));
    expect(escrituras[0].payload).toEqual({ estado: "no_show", llegada_at: null });
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it.each([
    ["completada", "Deshacer llegada de Ana"],
    ["no_show", "Quitar «no se presentó» de Ana"],
  ])("deshacer desde %s devuelve a 'confirmada' con llegada_at null, y NO manda correo", async (estado, nombreBoton) => {
    const escrituras = mockEscrituras();
    const { invalidadas } = montarConHookReal(reserva({ estado }));

    fireEvent.click(screen.getByRole("button", { name: nombreBoton }));

    await waitFor(() => expect(invalidadas.length).toBeGreaterThan(0));
    expect(escrituras[0].payload).toEqual({ estado: "confirmada", llegada_at: null });
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it("con la escritura denegada por RLS (0 filas) avisa, no da el cambio por hecho y NO manda correo", async () => {
    mockEscrituras([{ data: [] }]);
    const { invalidadas } = montarConHookReal(reserva());

    fireEvent.click(botonLlegada());

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/registrar la llegada: no tienes permiso/));
    expect(toast.success).not.toHaveBeenCalled();
    // Se refresca igual: el `finally` del hook vuelve a pedir el dato real.
    await waitFor(() => expect(invalidadas.length).toBeGreaterThan(0));
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });
});
