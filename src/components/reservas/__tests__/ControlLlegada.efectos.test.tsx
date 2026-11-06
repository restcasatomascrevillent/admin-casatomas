/**
 * `ControlLlegada` — tests de caracterización de EFECTOS.
 *
 * `ControlLlegada` es la botonera de servicio de la tarjeta del kanban («Ha
 * llegado», «No vino», «Deshacer»). Aquí se fija qué ACCIÓN dispara cada control,
 * sobre qué reserva, cuándo se queda deshabilitado (en curso, `disabled`, sin
 * permiso de edición) y —con el hook real detrás— qué acaba escribiéndose y que
 * NINGUNA de estas acciones manda correo (`notify-reservation-change`). No se
 * afirma nada del aspecto ni del número de botones: los controles se buscan por su
 * nombre accesible.
 *
 * PASO 1 del refactor de acciones: la botonera lee `accionesDisponibles(reserva,
 * { vista: "hoy", canEdit })`, y el vocabulario es el único «Ha llegado» / «No vino».
 * El `// BUG conocido` del permiso pasó a «corregido». Desde el 06/11/2026 (decisión
 * del dueño), sin permiso de edición NO hay controles: se ocultan, no se desactivan;
 * solo queda el chip del estado («Llegó» / «No vino»).
 *
 * PASO 2: el hook real de detrás es ya el ejecutor único. Las escrituras van condicionadas
 * al estado de partida (`.in("estado", …)`) y el «Deshacer» del chip vuelve al estado que
 * la reserva tenía antes de llegar, o a «Confirmada» si no se sabe (aquí, la reserva llega
 * ya «Llegó», sin pasado conocido).
 *
 * Nada llega a Supabase: el cliente y `sonner` están mockeados.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
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

/** `canEdit` es obligatorio en el componente; aquí, con permiso salvo que el test diga otra cosa. */
const Control = (props: Omit<ComponentProps<typeof ControlLlegada>, "canEdit"> & { canEdit?: boolean }) => (
  <ControlLlegada canEdit {...props} />
);

const botonLlegada = (nombre = "Ana") => screen.getByRole("button", { name: `Marcar que ${nombre} ha llegado` });

/** Abre el menú «…» de llegada (Radix abre con el teclado en jsdom) y devuelve el ítem «No vino». */
async function abrirMenuYElegirNoShow(nombre = "Ana") {
  const disparador = screen.getByRole("button", { name: `Más opciones de llegada para ${nombre}` });
  fireEvent.keyDown(disparador, { key: "Enter" });
  return await screen.findByRole("menuitem", { name: "No vino" });
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
      render(<Control reserva={r} acciones={acciones as never} />);

      fireEvent.click(botonLlegada());

      expect(acciones.marcarLlegada).toHaveBeenCalledTimes(1);
      expect(acciones.marcarLlegada).toHaveBeenCalledWith(r);
      expect(acciones.marcarNoShow).not.toHaveBeenCalled();
      expect(acciones.deshacerLlegadaONoShow).not.toHaveBeenCalled();
      expect(acciones.moverEspacio).not.toHaveBeenCalled();
    },
  );

  it("reserva viva: «No vino» (menú «…») llama a marcarNoShow con ESA reserva", async () => {
    const acciones = accionesFalsas();
    const r = reserva({ estado: "verificada" });
    render(<Control reserva={r} acciones={acciones as never} />);

    fireEvent.click(await abrirMenuYElegirNoShow());

    await waitFor(() => expect(acciones.marcarNoShow).toHaveBeenCalledTimes(1));
    expect(acciones.marcarNoShow).toHaveBeenCalledWith(r);
    expect(acciones.marcarLlegada).not.toHaveBeenCalled();
  });

  it("reserva «Llegó»: ya no hay «Ha llegado»; «Deshacer llegada» llama a deshacerLlegadaONoShow", () => {
    const acciones = accionesFalsas();
    const r = reserva({ estado: "completada", llegada_at: "2026-09-30T19:23:00.000Z" });
    render(<Control reserva={r} acciones={acciones as never} />);

    expect(screen.queryByRole("button", { name: /ha llegado/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Deshacer llegada de Ana" }));

    expect(acciones.deshacerLlegadaONoShow).toHaveBeenCalledTimes(1);
    expect(acciones.deshacerLlegadaONoShow).toHaveBeenCalledWith(r);
    expect(acciones.marcarLlegada).not.toHaveBeenCalled();
  });

  it("reserva «No vino»: no hay «Ha llegado» ni menú; el deshacer llama a la MISMA acción que el de «Llegó»", () => {
    const acciones = accionesFalsas();
    const r = reserva({ estado: "no_show" });
    render(<Control reserva={r} acciones={acciones as never} />);

    expect(screen.queryByRole("button", { name: /ha llegado/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /más opciones de llegada/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Deshacer «No vino» de Ana" }));

    expect(acciones.deshacerLlegadaONoShow).toHaveBeenCalledTimes(1);
    expect(acciones.deshacerLlegadaONoShow).toHaveBeenCalledWith(r);
  });

  it.each(["cancelada", "rechazada", ""])("una reserva %j no pinta ningún control: «cancelada no sale»", (estado) => {
    const { container } = render(<Control reserva={reserva({ estado })} acciones={accionesFalsas() as never} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("sin nombre, los controles hablan de «el cliente»", () => {
    render(<Control reserva={reserva({ nombre: null })} acciones={accionesFalsas() as never} />);

    expect(screen.getByRole("button", { name: "Marcar que el cliente ha llegado" })).toBeInTheDocument();
  });

  it("mientras la reserva tiene una acción en curso los controles quedan deshabilitados y no disparan nada", () => {
    const acciones = accionesFalsas(true);
    render(<Control reserva={reserva()} acciones={acciones as never} />);

    expect(botonLlegada()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Más opciones de llegada para Ana" })).toBeDisabled();
    fireEvent.click(botonLlegada());
    expect(acciones.marcarLlegada).not.toHaveBeenCalled();
    expect(acciones.estaEnCurso).toHaveBeenCalledWith("r1");
  });

  it("`disabled` desde fuera lo apaga igual, y también a los botones de deshacer", () => {
    const acciones = accionesFalsas();
    const { rerender } = render(<Control reserva={reserva()} acciones={acciones as never} disabled />);
    expect(botonLlegada()).toBeDisabled();

    rerender(<Control reserva={reserva({ estado: "completada" })} acciones={acciones as never} disabled />);
    expect(screen.getByRole("button", { name: "Deshacer llegada de Ana" })).toBeDisabled();
  });

  it("con permiso ningún control lleva motivo: no hay nada que explicar", () => {
    render(<Control reserva={reserva()} acciones={accionesFalsas() as never} />);

    expect(botonLlegada()).toBeEnabled();
    expect(botonLlegada().parentElement).not.toHaveAttribute("title");
  });

  it("los eventos de puntero y de teclado no suben: pulsar aquí no arranca el arrastre de la tarjeta", () => {
    const alPulsarElPadre = vi.fn();
    const alTeclearEnElPadre = vi.fn();
    render(
      <div onPointerDown={alPulsarElPadre} onKeyDown={alTeclearEnElPadre}>
        <span data-testid="fuera">fuera de la botonera</span>
        <Control reserva={reserva()} acciones={accionesFalsas() as never} />
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

describe("ControlLlegada · con texto y `soloIcono` (las columnas estrechas del kanban)", () => {
  // `soloIcono` quita los textos de la botonera (petición del dueño, 2026-09-26) para que
  // las cinco columnas de Casa Tomás quepan a 1024 px. El texto NO se pierde: sigue en
  // `aria-label` y en `title`. Este comportamiento no se toca con el permiso ni con el
  // vocabulario, y aquí se fija en los dos modos.
  const LLEGADA = new Date(2026, 8, 30, 14, 32).toISOString(); // 14:32 hora local, sea cual sea la zona

  it("con texto: «Ha llegado» se ve escrito y el menú lleva su nombre accesible", () => {
    render(<Control reserva={reserva()} acciones={accionesFalsas() as never} />);

    expect(botonLlegada()).toHaveTextContent("Ha llegado");
    expect(botonLlegada()).toHaveAttribute("title", "Ha llegado");
  });

  it("`soloIcono`: «Ha llegado» sin texto, pero con el nombre accesible y el globo intactos", () => {
    render(<Control reserva={reserva()} acciones={accionesFalsas() as never} soloIcono />);

    expect(botonLlegada().textContent).toBe("");
    expect(botonLlegada()).toHaveAttribute("title", "Ha llegado");
    expect(botonLlegada()).toHaveAttribute("aria-label", "Marcar que Ana ha llegado");
  });

  it("`soloIcono` deja bajar de línea a los controles (`flex-wrap`) antes que recortarlos", () => {
    const { container } = render(<Control reserva={reserva()} acciones={accionesFalsas() as never} soloIcono />);

    expect(container.firstElementChild).toHaveClass("flex-wrap");
  });

  it("chip «Llegó» con texto: «Llegó 14:32»", () => {
    render(<Control reserva={reserva({ estado: "completada", llegada_at: LLEGADA })} acciones={accionesFalsas() as never} />);

    const chip = screen.getByTitle("Llegó 14:32");
    expect(chip).toHaveTextContent("Llegó 14:32");
    expect(chip).toHaveAttribute("aria-label", "Llegó 14:32");
  });

  it("chip «Llegó» con `soloIcono`: solo la hora (la palomita ya dice «Llegó»), y el texto entero en el globo", () => {
    render(
      <Control reserva={reserva({ estado: "completada", llegada_at: LLEGADA })} acciones={accionesFalsas() as never} soloIcono />,
    );

    const chip = screen.getByTitle("Llegó 14:32");
    expect(chip).toHaveTextContent(/^14:32$/);
    expect(chip).toHaveAttribute("aria-label", "Llegó 14:32");
  });

  it("chip «Llegó» sin hora registrada (migración de `llegada_at` sin aplicar): «Llegó» a secas, y con `soloIcono` ningún texto", () => {
    const { rerender } = render(
      <Control reserva={reserva({ estado: "completada", llegada_at: null })} acciones={accionesFalsas() as never} />,
    );
    expect(screen.getByTitle("Llegó")).toHaveTextContent(/^Llegó$/);

    rerender(
      <Control reserva={reserva({ estado: "completada", llegada_at: null })} acciones={accionesFalsas() as never} soloIcono />,
    );
    expect(screen.getByTitle("Llegó").textContent).toBe("");
  });

  it("chip «No vino»: con texto dice «No vino»; con `soloIcono` solo el icono y el nombre en el globo", () => {
    const { rerender } = render(<Control reserva={reserva({ estado: "no_show" })} acciones={accionesFalsas() as never} />);
    expect(screen.getByTitle("No vino")).toHaveTextContent(/^No vino$/);

    rerender(<Control reserva={reserva({ estado: "no_show" })} acciones={accionesFalsas() as never} soloIcono />);
    expect(screen.getByTitle("No vino").textContent).toBe("");
    expect(screen.getByTitle("No vino")).toHaveAttribute("aria-label", "No vino");
  });

  it("`compacto` solo cambia el tamaño: los mismos controles", () => {
    render(<Control reserva={reserva()} acciones={accionesFalsas() as never} compacto />);

    expect(botonLlegada()).toHaveClass("h-6");
    expect(screen.getByRole("button", { name: "Más opciones de llegada para Ana" })).toBeInTheDocument();
  });
});

describe("ControlLlegada · sin permiso de edición (canEdit = false): solo «Ver», nada que pulsar", () => {
  it.each(["pendiente", "verificada", "confirmada"])(
    "reserva %s: ni «Ha llegado» ni el menú «…» (06/11/2026: se ocultan, no se desactivan)",
    (estado) => {
      const acciones = accionesFalsas();
      const { container } = render(<Control reserva={reserva({ estado })} acciones={acciones as never} canEdit={false} />);

      expect(screen.queryByRole("button", { name: /ha llegado/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Más opciones de llegada para Ana" })).not.toBeInTheDocument();
      expect(container).toBeEmptyDOMElement();
      expect(acciones.marcarLlegada).not.toHaveBeenCalled();
      expect(acciones.marcarNoShow).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["completada", "Deshacer llegada de Ana"],
    ["no_show", "Deshacer «No vino» de Ana"],
  ])("reserva %s: sin «Deshacer» (oculto, no desactivado)", (estado, nombreBoton) => {
    const acciones = accionesFalsas();
    render(<Control reserva={reserva({ estado })} acciones={acciones as never} canEdit={false} />);

    expect(screen.queryByRole("button", { name: nombreBoton })).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(acciones.deshacerLlegadaONoShow).not.toHaveBeenCalled();
  });

  it("el chip «Llegó» / «No vino» se sigue viendo: sin permiso se ve el estado, no se cambia", () => {
    const { rerender } = render(
      <Control reserva={reserva({ estado: "completada" })} acciones={accionesFalsas() as never} canEdit={false} />,
    );
    expect(screen.getByTitle("Llegó")).toBeInTheDocument();

    rerender(<Control reserva={reserva({ estado: "no_show" })} acciones={accionesFalsas() as never} canEdit={false} />);
    expect(screen.getByTitle("No vino")).toBeInTheDocument();
  });

  it("una reserva cancelada no pinta nada, tenga o no permiso", () => {
    const { container } = render(
      <Control reserva={reserva({ estado: "cancelada" })} acciones={accionesFalsas() as never} canEdit={false} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

// ─── Con el hook REAL detrás: qué se escribe y que no hay correo ─────────────

interface Escritura {
  tabla: string;
  payload: Record<string, unknown>;
  eq: [string, unknown] | null;
  /** La condición de estado de partida (`.in("estado", …)`); `null` si la escritura no la lleva. */
  en: [string, unknown[]] | null;
  select: string | null;
}

function mockEscrituras(respuestas: Array<{ error?: unknown; data?: unknown }> = []) {
  const escrituras: Escritura[] = [];
  vi.mocked(supabase.from).mockImplementation(((tabla: string) => {
    const escritura: Escritura = { tabla, payload: {}, eq: null, en: null, select: null };
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
      in: vi.fn((columna: string, valores: unknown[]) => {
        escritura.en = [columna, valores];
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
  return <Control reserva={r} acciones={acciones} />;
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
    // Solo si la BD sigue en el estado que VIO el personal (aquí, «Pendiente»): el estado previo que se
    // recuerda para el «Deshacer» del chip tiene que ser verdad aunque la tarjeta esté desfasada (M1).
    expect(escrituras[0].en).toEqual(["estado", ["pendiente"]]);
    expect(invalidadas).toEqual(expect.arrayContaining(["reservas-kanban", "reservas-hoy", "reservas-lista", "dashboard-stats"]));
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it("«No vino» escribe estado 'no_show' y llegada_at null, y NO manda correo", async () => {
    const escrituras = mockEscrituras();
    const { invalidadas } = montarConHookReal(reserva());

    fireEvent.click(await abrirMenuYElegirNoShow());

    await waitFor(() => expect(invalidadas.length).toBeGreaterThan(0));
    expect(escrituras[0].payload).toEqual({ estado: "no_show", llegada_at: null });
    // La tarjeta de la prueba es «Confirmada».
    expect(escrituras[0].en).toEqual(["estado", ["confirmada"]]);
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it.each([
    ["completada", "Deshacer llegada de Ana"],
    ["no_show", "Deshacer «No vino» de Ana"],
  ])("deshacer desde %s devuelve a 'confirmada' con llegada_at null, y NO manda correo", async (estado, nombreBoton) => {
    const escrituras = mockEscrituras();
    const { invalidadas } = montarConHookReal(reserva({ estado }));

    fireEvent.click(screen.getByRole("button", { name: nombreBoton }));

    await waitFor(() => expect(invalidadas.length).toBeGreaterThan(0));
    expect(escrituras[0].payload).toEqual({ estado: "confirmada", llegada_at: null });
    // Solo si la BD sigue en el estado que vio el personal («Llegó» o «No vino»): no se pisa lo que haya
    // pasado entre tanto (p. ej. que otro dispositivo la marcara «No vino» después de «Llegó»).
    expect(escrituras[0].en).toEqual(["estado", [estado]]);
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
