/**
 * Tests para src/components/reservas/ModalVerificacionReserva.tsx
 *
 * Lo que fijan, que es lo que el dueño señaló en vivo (2026-09-29):
 *   1. Asignar sala SIN cambiar la hora no puede avisar de ninguna
 *      diferencia: el cliente no ve la sala en ningún correo.
 *   2. En la pantalla no queda vocabulario de regateo ("contraoferta").
 *   3. La sala vive fuera del recuadro de lo que se le dice al cliente, y la
 *      columna "Pidió el cliente" ya no inventa una sala que el cliente nunca
 *      pidió.
 *   4. Un solo botón de guardar, y guarda LO QUE SE VE (incluida la sala
 *      recién asignada, que el antiguo "Aceptar tal cual" tiraba).
 *   5. reservas-sin-salas (2026-09-29): las horas son TODOS los cuartos del
 *      turno (rejilla interna), la sala es opcional y va plegada, y plegada
 *      no se pierde: la que ya tenía la reserva se guarda tal cual.
 *
 * Estrategia: hooks de datos mockeados (espacios, disponibilidad, permisos) y
 * `supabase`/`sonner` mockeados; el ejecutor de acciones (`useAccionesServicioReserva`,
 * que desde el paso 2 es quien guarda «Verificar» y «Rechazar») corre DE VERDAD,
 * porque parte de lo que se prueba es justo lo que escribe en la reserva. Como usa React
 * Query (actualización optimista y refresco), el modal se monta dentro de un
 * `QueryClientProvider`.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/integrations/supabase/client");
vi.mock("sonner");
vi.mock("@/hooks/useEspaciosReserva", () => ({
  useEspaciosReserva: () => ({ data: ESPACIOS }),
}));
// La rejilla en cuartos se prueba aparte (DisponibilidadCuartos.test.tsx y
// lib/reservas/__tests__/rejillaCuartos.test.ts). Aquí solo interesan sus horas.
vi.mock("@/components/reservas/DisponibilidadCuartos", () => ({
  DisponibilidadCuartos: () => null,
  useRejillaCuartos: () => ({
    rejilla: {
      franjas: ["13:00", "13:15", "14:00", "21:00"].map((hora) => ({ hora })),
      aforo: {},
    },
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: () => ({ canAccess: true, loading: false }),
}));

import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ModalVerificacionReserva } from "@/components/reservas/ModalVerificacionReserva";
import type { ReservaParaVerificar } from "@/hooks/useVerificacionReservas";

// Los espacios se declaran arriba del `vi.mock` por el hoisting de vitest:
// la factoría se ejecuta tarde, así que la constante ya existe.
const ESPACIOS = [
  { id: "e-salon", nombre: "Salón", activa: true, caracteristicas: { marca: "casa_tomas" } },
  { id: "e-terraza", nombre: "Terraza", activa: true, caracteristicas: { marca: "casa_tomas" } },
];

// Radix Select necesita estos tres métodos, que jsdom no implementa.
beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

const reserva = (overrides: Partial<ReservaParaVerificar> = {}): ReservaParaVerificar => ({
  id: "res-1",
  nombre: "Miguel Benito Castellanos",
  telefono: "+34600111222",
  email: "miguel@ejemplo.com",
  fecha: "2026-10-02",
  hora: "14:00:00",
  numero_comensales: 4,
  estado: "pendiente",
  notas_cliente: null,
  espacio_id: null,
  marca: "casa_tomas",
  ...overrides,
});

/**
 * Builder de supabase con `update` espiable. La escritura del ejecutor es
 * `update(…).eq("id", …).in("estado", …).select("id")`: `respuesta` es lo que contesta
 * (por defecto, éxito con la fila afectada; `{ data: [] }` es una escritura denegada por RLS).
 * `relectura` es lo que contesta la RELECTURA del estado (`select("estado").eq(…).maybeSingle()`)
 * cuando la escritura condicionada no toca nada; sin ella no hay `maybeSingle` y se ignora.
 */
function espiarUpdate(respuesta: { data?: unknown; error?: unknown } = {}, relectura?: { data?: unknown }) {
  const update = vi.fn();
  const builder: Record<string, unknown> = {
    update,
    eq: vi.fn(),
    in: vi.fn(),
    select: vi.fn(),
    maybeSingle: relectura ? vi.fn(() => Promise.resolve({ data: relectura.data ?? null, error: null })) : undefined,
    then: (onfulfilled: (v: unknown) => unknown) =>
      Promise.resolve({ data: "data" in respuesta ? respuesta.data : [{ id: "res-1" }], error: respuesta.error ?? null }).then(
        onfulfilled,
      ),
  };
  for (const metodo of ["update", "eq", "in", "select"]) (builder[metodo] as ReturnType<typeof vi.fn>).mockReturnValue(builder);
  vi.mocked(supabase.from).mockReturnValue(builder as never);
  return Object.assign(update, { builder });
}

const alAbrir = { onOpenChange: vi.fn(), onSuccess: vi.fn() };

function abrir(r: ReservaParaVerificar) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ModalVerificacionReserva reserva={r} open onOpenChange={alAbrir.onOpenChange} onSuccess={alAbrir.onSuccess} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ModalVerificacionReserva", () => {
  it("misma hora y sala distinta: NO avisa de ninguna diferencia", () => {
    // El caso de la captura: solicitud a las 14:00 a la que se le pone el
    // Salón. Antes salía "SE LE OFRECE (CONTRAOFERTA)" en ámbar.
    const { container } = abrir(
      reserva({ hora: "14:00:00", hora_solicitada: "14:00:00", espacio_id: "e-salon", espacio_solicitado_id: null }),
    );

    expect(screen.getByText("Se le confirma")).toBeInTheDocument();
    expect(screen.queryByText(/distinta/i)).not.toBeInTheDocument();
    expect(container.textContent?.toLowerCase()).not.toContain("contraoferta");
  });

  it("no queda vocabulario de regateo en ningún sitio de la pantalla", () => {
    const { container } = abrir(reserva({ hora_solicitada: "14:00:00" }));
    const texto = (container.textContent ?? "").toLowerCase();

    expect(texto).not.toContain("contraoferta");
    expect(texto).not.toContain("se le ofrece");
    expect(texto).not.toContain("tal cual");
    expect(texto).not.toContain("propuesta");
  });

  it("la sala está fuera de lo que se le dice al cliente, y dice que no se le dice", () => {
    abrir(reserva({ hora_solicitada: "14:00:00", espacio_id: "e-salon" }));

    expect(screen.getByText("Solo para el restaurante")).toBeInTheDocument();
    expect(screen.getByText(/la sala no se le dice al cliente/i)).toBeInTheDocument();
    // Plegada: se ve la sala actual en el resumen, pero no el selector.
    const plegable = screen.getByRole("button", { name: /asignación interna \(opcional\)/i });
    expect(plegable).toHaveTextContent("Salón");
    expect(screen.queryByRole("combobox", { name: /sala/i })).not.toBeInTheDocument();
    // Al desplegar, la sala tiene su propio selector, separado del de la hora.
    fireEvent.click(plegable);
    expect(screen.getByRole("combobox", { name: /sala/i })).toHaveTextContent("Salón");
  });

  it('la columna "Pidió el cliente" ya no inventa una sala que nadie pidió', () => {
    const { container } = abrir(reserva({ hora_solicitada: "14:00:00", espacio_id: null }));

    // Antes ponía "Sin zona asignada" como si el cliente hubiera pedido eso.
    expect(screen.queryByText("Sin zona asignada")).not.toBeInTheDocument();
    const bloquePedido = screen.getByText("Pidió el cliente").parentElement as HTMLElement;
    expect(within(bloquePedido).getByText("14:00")).toBeInTheDocument();
    expect(bloquePedido.textContent).not.toMatch(/salón|terraza|sala/i);
    expect(container).toBeTruthy();
  });

  it("cambiar la hora sí avisa, y con el lenguaje nuevo", async () => {
    abrir(reserva({ hora: "14:00:00", hora_solicitada: "14:00:00" }));

    fireEvent.click(screen.getByRole("combobox", { name: /hora/i }));
    fireEvent.click(await screen.findByRole("option", { name: "21:00" }));

    const aviso = await screen.findByText(/hora distinta a la que pidió/i);
    expect(aviso).toBeInTheDocument();
    expect(aviso.textContent?.toLowerCase()).not.toContain("contraoferta");
  });

  it("el pie tiene tres botones, no cuatro", () => {
    abrir(reserva({ hora_solicitada: "14:00:00" }));

    expect(screen.getByRole("button", { name: "Rechazar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Verificar con esta hora" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /aceptar tal cual/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /enviar propuesta/i })).not.toBeInTheDocument();
  });

  it("guardar manda lo que se ve, incluida la sala recién asignada", async () => {
    const update = espiarUpdate();
    abrir(reserva({ hora: "14:00:00", hora_solicitada: "14:00:00", espacio_id: "e-salon" }));

    fireEvent.click(screen.getByRole("button", { name: "Verificar con esta hora" }));

    // La sala NO se pierde: el antiguo "Aceptar tal cual" escribía
    // `espacio_solicitado_id` (null) y se cargaba la asignación.
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({ hora: "14:00", espacio_id: "e-salon", estado: "verificada" }),
    );
  });

  it("las horas son los cuartos del turno, no solo las que ofrece la escalera", async () => {
    abrir(reserva({ hora: "14:00:00", hora_solicitada: "14:00:00" }));

    fireEvent.click(screen.getByRole("combobox", { name: /hora/i }));
    expect(await screen.findByRole("option", { name: "13:15" })).toBeInTheDocument();
  });

  it("sin tocar la sala plegada, se guarda la que ya tenía (nunca null)", async () => {
    const update = espiarUpdate();
    abrir(reserva({ hora: "21:00:00", hora_solicitada: "21:00:00", espacio_id: "e-terraza" }));

    fireEvent.click(screen.getByRole("button", { name: "Verificar con esta hora" }));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({ hora: "21:00", espacio_id: "e-terraza", estado: "verificada" }),
    );
  });

  it("una reserva que ya tenía otra hora guardada lo avisa al abrir", () => {
    abrir(reserva({ hora: "21:00:00", hora_solicitada: "14:00:00" }));
    expect(screen.getByText(/ya tenía guardada una hora distinta/i)).toBeInTheDocument();
  });

  it("una reserva a la que solo le cambiaron la sala NO lo avisa al abrir", () => {
    abrir(
      reserva({ hora: "14:00:00", hora_solicitada: "14:00:00", espacio_id: "e-terraza", espacio_solicitado_id: null }),
    );
    expect(screen.queryByText(/ya tenía guardada una hora distinta/i)).not.toBeInTheDocument();
  });
});

// Desde el paso 2, «Verificar» y «Rechazar» pasan por el ejecutor único de acciones
// (`useAccionesServicioReserva`): comprueba que la escritura de verdad se ha guardado, la
// condiciona al estado de partida y avisa al cliente con la respuesta comprobada.
describe("ModalVerificacionReserva · lo que hace al guardar", () => {
  it("«Verificar» escribe solo si la reserva sigue PENDIENTE, avisa al cliente con lo escrito y cierra el modal avisando a la lista", async () => {
    const update = espiarUpdate();
    abrir(reserva({ hora: "14:00:00", hora_solicitada: "14:00:00", espacio_id: "e-salon" }));

    fireEvent.click(screen.getByRole("button", { name: "Verificar con esta hora" }));

    await waitFor(() => expect(alAbrir.onSuccess).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.builder.in).toHaveBeenCalledWith("estado", ["pendiente"]);
    expect(update.builder.eq).toHaveBeenCalledWith("id", "res-1");
    expect(update.builder.select).toHaveBeenCalledWith("id");
    expect(alAbrir.onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() =>
      expect(supabase.functions.invoke).toHaveBeenCalledWith("notify-reservation-change", {
        body: { id: "res-1", hora: "14:00", espacio_id: "e-salon", estado: "verificada" },
      }),
    );
  });

  it("CORREGIDO: si la RLS deniega la escritura (0 filas) el modal NO se cierra, NO avisa a la lista ni al cliente, y lo dice", async () => {
    // Antes la escritura no pedía la fila de vuelta: la denegación pasaba por éxito, el modal
    // se cerraba diciendo «Reserva verificada» y el cliente recibía el correo.
    espiarUpdate({ data: [] });
    abrir(reserva({ hora: "14:00:00", hora_solicitada: "14:00:00" }));

    fireEvent.click(screen.getByRole("button", { name: "Verificar con esta hora" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/^No se pudo guardar: no tienes permiso/)));
    expect(alAbrir.onSuccess).not.toHaveBeenCalled();
    expect(alAbrir.onOpenChange).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
    // El botón vuelve a estar disponible para reintentar.
    expect(screen.getByRole("button", { name: "Verificar con esta hora" })).toBeEnabled();
  });

  it("«Rechazar» pasa la reserva a 'cancelada' SOLO si sigue pendiente (B1), avisa al cliente y cierra", async () => {
    const update = espiarUpdate();
    abrir(reserva());

    fireEvent.click(screen.getByRole("button", { name: "Rechazar" }));

    await waitFor(() => expect(alAbrir.onSuccess).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith({ estado: "cancelada" });
    // B1: si otra persona aceptó la solicitud con el modal abierto, al cliente ya le salió la «propuesta»:
    // rechazarla ahora mandaría «rechazada» encima. La escritura solo toca una pendiente.
    expect(update.builder.in).toHaveBeenCalledWith("estado", ["pendiente"]);
    await waitFor(() =>
      expect(supabase.functions.invoke).toHaveBeenCalledWith("notify-reservation-change", {
        body: { id: "res-1", estado: "cancelada" },
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Solicitud rechazada", { description: "Se le manda el correo a miguel@ejemplo.com" });
  });

  it("«Rechazar» con la RLS denegando: no cierra ni da por rechazada la solicitud", async () => {
    espiarUpdate({ data: [] });
    abrir(reserva());

    fireEvent.click(screen.getByRole("button", { name: "Rechazar" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/^No se pudo rechazar la solicitud: no tienes permiso/)),
    );
    expect(alAbrir.onSuccess).not.toHaveBeenCalled();
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it("(c) si la reserva YA HABÍA CAMBIADO de estado (otra persona la aceptó con el modal abierto) el modal se CIERRA: con la reserva vieja no tiene sentido seguir; sin avisar a la lista ni al cliente", async () => {
    // El aviso dice «Se ha refrescado la pantalla»: el modal tiene que dejar de enseñar la solicitud vieja.
    espiarUpdate({ data: [] }, { data: { estado: "verificada" } });
    abrir(reserva({ hora: "14:00:00", hora_solicitada: "14:00:00" }));

    fireEvent.click(screen.getByRole("button", { name: "Verificar con esta hora" }));

    await waitFor(() => expect(alAbrir.onOpenChange).toHaveBeenCalledWith(false));
    expect(toast.error).toHaveBeenCalledWith(
      "No se pudo guardar: la reserva ya ha cambiado de estado (ahora está «Verificada»). Se ha refrescado la pantalla.",
    );
    // No es un éxito: no se llama a `onSuccess` (el ejecutor ya ha refrescado las listas) ni se avisa al cliente.
    expect(alAbrir.onSuccess).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it("(c) «Rechazar» sobre una solicitud que otra persona ya aceptó (B1): tampoco se queda abierto con la reserva vieja", async () => {
    espiarUpdate({ data: [] }, { data: { estado: "verificada" } });
    abrir(reserva());

    fireEvent.click(screen.getByRole("button", { name: "Rechazar" }));

    await waitFor(() => expect(alAbrir.onOpenChange).toHaveBeenCalledWith(false));
    expect(toast.error).toHaveBeenCalledWith(
      "No se pudo rechazar la solicitud: la reserva ya ha cambiado de estado (ahora está «Verificada»). Se ha refrescado la pantalla.",
    );
    expect(alAbrir.onSuccess).not.toHaveBeenCalled();
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it("(c) pero si la reserva SIGUE pendiente y aun así no se escribe (la RLS), el modal se queda abierto para reintentar", async () => {
    espiarUpdate({ data: [] }, { data: { estado: "pendiente" } });
    abrir(reserva({ hora: "14:00:00", hora_solicitada: "14:00:00" }));

    fireEvent.click(screen.getByRole("button", { name: "Verificar con esta hora" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("No se pudo guardar: no tienes permiso para cambiar esta reserva."),
    );
    expect(alAbrir.onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Verificar con esta hora" })).toBeEnabled();
  });

  it("si el correo no sale, el modal se cierra igual (lo guardado sigue guardado) y se avisa al personal", async () => {
    espiarUpdate();
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({
      data: null,
      error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code" },
    } as never);
    abrir(reserva({ hora: "14:00:00", hora_solicitada: "14:00:00" }));

    fireEvent.click(screen.getByRole("button", { name: "Verificar con esta hora" }));

    await waitFor(() => expect(alAbrir.onSuccess).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("El correo al cliente no ha salido", expect.objectContaining({ duration: 10_000 })),
    );
  });
});
