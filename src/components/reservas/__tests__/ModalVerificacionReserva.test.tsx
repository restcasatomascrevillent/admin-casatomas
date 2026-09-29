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
 * `supabase`/`sonner` mockeados; `useVerificacionReservas` corre DE VERDAD,
 * porque parte de lo que se prueba es justo lo que escribe en la reserva.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

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

/** Builder de supabase con `update` espiable. */
function espiarUpdate() {
  const update = vi.fn().mockReturnThis();
  const builder: Record<string, unknown> = {
    update,
    eq: vi.fn(function (this: unknown) {
      return this;
    }),
    then: (onfulfilled: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(onfulfilled),
  };
  builder.eq = vi.fn().mockReturnValue(builder);
  update.mockReturnValue(builder);
  vi.mocked(supabase.from).mockReturnValue(builder as never);
  return update;
}

function abrir(r: ReservaParaVerificar) {
  return render(<ModalVerificacionReserva reserva={r} open onOpenChange={vi.fn()} onSuccess={vi.fn()} />);
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
