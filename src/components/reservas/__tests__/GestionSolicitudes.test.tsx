/**
 * Tests para src/components/reservas/GestionSolicitudes.tsx: la tarjeta de una
 * solicitud del bot (`SolicitudCard`).
 *
 * La pestaña propia que la montaba (`GestionSolicitudes()`, con su filtro por estado
 * y su contador) era código muerto —ninguna pantalla la usaba: las solicitudes viven
 * mezcladas en la Lista de reservas— y se borró en el paso 4 del refactor de acciones.
 * Lo que estos tests comprobaban de la TARJETA a través de ella se comprueba ahora
 * sobre la tarjeta directamente, que es lo que siguen usando la Lista (móvil) y el
 * diálogo de gestión.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { SolicitudPendiente } from "@/hooks/useSolicitudesPendientes";
import { SolicitudCard } from "@/components/reservas/GestionSolicitudes";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const makeSolicitud = (overrides: Partial<SolicitudPendiente> = {}) =>
  ({
    id: "sol-1",
    nombre: "Juan García",
    telefono: "+34 666 111 222",
    email: "juan@test.com",
    fecha_solicitada: "2026-04-01",
    hora_solicitada: "13:00",
    numero_comensales: 8,
    notas_cliente: "Cumpleaños",
    motivo_rechazo: "grupo_grande",
    descripcion_rechazo: "Grupo superior al máximo permitido",
    estado: "pendiente",
    notas_internas: null,
    created_at: "2026-03-21T10:00:00Z",
    updated_at: "2026-03-21T10:00:00Z",
    ...overrides,
  }) as SolicitudPendiente;

const montar = (solicitud: SolicitudPendiente, props: Partial<Parameters<typeof SolicitudCard>[0]> = {}) => {
  const onUpdateEstado = vi.fn().mockResolvedValue(true);
  const onUpdateNotas = vi.fn().mockResolvedValue(true);
  render(<SolicitudCard solicitud={solicitud} onUpdateEstado={onUpdateEstado} onUpdateNotas={onUpdateNotas} {...props} />);
  return { onUpdateEstado, onUpdateNotas };
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SolicitudCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Renderizado básico ─────────────────────────────────────────────────────

  it("renderiza correctamente una solicitud pendiente", () => {
    montar(makeSolicitud());
    expect(screen.getByText("Juan García")).toBeDefined();
  });

  it("renderiza el badge del motivo de rechazo", () => {
    montar(makeSolicitud({ motivo_rechazo: "grupo_grande" }));
    expect(screen.getByText("Grupo grande")).toBeDefined();
  });

  it("renderiza el badge de estado 'Pendiente'", () => {
    montar(makeSolicitud({ estado: "pendiente" }));
    expect(screen.getByText("Pendiente")).toBeDefined();
  });

  it("muestra notas internas cuando existen", () => {
    montar(makeSolicitud({ notas_internas: "Llamar a las 10h mañana" }));
    expect(screen.getByText("Llamar a las 10h mañana")).toBeDefined();
  });

  // ── Interacciones ───────────────────────────────────────────────────────────

  it("botón Gestionar expande las opciones de la tarjeta", () => {
    montar(makeSolicitud());
    fireEvent.click(screen.getByText("Gestionar"));

    // Después de expandir, deben aparecer los botones de acción
    expect(screen.getByText("Resuelta")).toBeDefined();
    expect(screen.getByText("Descartar")).toBeDefined();
  });

  it("al hacer clic en Resuelta se llama updateEstado con 'resuelta'", async () => {
    const { onUpdateEstado } = montar(makeSolicitud({ id: "sol-1" }));
    fireEvent.click(screen.getByText("Gestionar"));
    fireEvent.click(screen.getByText("Resuelta"));

    await waitFor(() => {
      expect(onUpdateEstado).toHaveBeenCalledWith("sol-1", "resuelta");
    });
  });

  it("al hacer clic en Descartar se llama updateEstado con 'descartada'", async () => {
    const { onUpdateEstado } = montar(makeSolicitud({ id: "sol-1" }));
    fireEvent.click(screen.getByText("Gestionar"));
    fireEvent.click(screen.getByText("Descartar"));

    await waitFor(() => {
      expect(onUpdateEstado).toHaveBeenCalledWith("sol-1", "descartada");
    });
  });

  it("una solicitud resuelta no ofrece «Resuelta» (ya lo está) y sí «Volver a pendiente»", () => {
    montar(makeSolicitud({ estado: "resuelta" }));
    fireEvent.click(screen.getByText("Gestionar"));

    expect(screen.queryByRole("button", { name: /^Resuelta$/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Volver a pendiente/ })).toBeDefined();
  });

  it("«Convertir en reserva» solo si se pasa `onConvertir` y la solicitud sigue abierta", () => {
    const onConvertir = vi.fn();
    montar(makeSolicitud({ estado: "contactado" }), { onConvertir });
    fireEvent.click(screen.getByText("Gestionar"));
    fireEvent.click(screen.getByRole("button", { name: /Convertir en reserva/ }));
    expect(onConvertir).toHaveBeenCalledTimes(1);
  });

  it("sin `onConvertir` (sin permiso) no hay «Convertir en reserva»", () => {
    montar(makeSolicitud());
    fireEvent.click(screen.getByText("Gestionar"));
    expect(screen.queryByRole("button", { name: /Convertir en reserva/ })).toBeNull();
  });
});
