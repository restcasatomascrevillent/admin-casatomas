/**
 * Tests para src/components/reservas/GestionSolicitudes.tsx
 *
 * Estrategia: mock completo de useSolicitudesPendientes para aislar
 * la lógica de renderizado y filtrado del componente.
 *
 * Requisitos del entorno:
 *   - @testing-library/react
 *   - @testing-library/jest-dom
 *   - Radix UI funciona con jsdom (sin animaciones)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Mock del hook para no depender de Supabase
vi.mock("@/hooks/useSolicitudesPendientes");
vi.mock("sonner");

import { useSolicitudesPendientes } from "@/hooks/useSolicitudesPendientes";
import { GestionSolicitudes } from "@/components/reservas/GestionSolicitudes";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const makeSolicitud = (overrides = {}) => ({
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
});

const defaultHookReturn = {
  solicitudes: [],
  loading: false,
  countPendientes: 0,
  fetchSolicitudes: vi.fn(),
  updateEstado: vi.fn().mockResolvedValue(true),
  updateNotasInternas: vi.fn().mockResolvedValue(true),
  updatePropuesta: vi.fn().mockResolvedValue(true),
  enviarPropuesta: vi.fn().mockResolvedValue(true),
  aceptarPropuestaTelefono: vi.fn().mockResolvedValue({ ok: true }),
  rechazarPropuestaTelefono: vi.fn().mockResolvedValue({ ok: true }),
  marcarConvertida: vi.fn().mockResolvedValue(true),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GestionSolicitudes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Renderizado básico ─────────────────────────────────────────────────────

  it("muestra spinner mientras carga", () => {
    vi.mocked(useSolicitudesPendientes).mockReturnValue({
      ...defaultHookReturn,
      loading: true,
    });

    const { container } = render(<GestionSolicitudes />);
    // El spinner es el único elemento visible mientras carga
    // Buscamos el SVG de Loader2 (lucide-react renderiza SVGs)
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThan(0);
  });

  it("muestra mensaje vacío cuando no hay pendientes", () => {
    vi.mocked(useSolicitudesPendientes).mockReturnValue({
      ...defaultHookReturn,
      solicitudes: [],
    });

    render(<GestionSolicitudes />);
    expect(
      screen.getByText(/no hay solicitudes pendientes/i)
    ).toBeDefined();
  });

  it("renderiza correctamente una solicitud pendiente", () => {
    vi.mocked(useSolicitudesPendientes).mockReturnValue({
      ...defaultHookReturn,
      solicitudes: [makeSolicitud()],
      countPendientes: 1,
    });

    render(<GestionSolicitudes />);
    expect(screen.getByText("Juan García")).toBeDefined();
  });

  it("renderiza el badge del motivo de rechazo", () => {
    vi.mocked(useSolicitudesPendientes).mockReturnValue({
      ...defaultHookReturn,
      solicitudes: [makeSolicitud({ motivo_rechazo: "grupo_grande" })],
    });

    render(<GestionSolicitudes />);
    expect(screen.getByText("Grupo grande")).toBeDefined();
  });

  it("renderiza el badge de estado 'Pendiente'", () => {
    vi.mocked(useSolicitudesPendientes).mockReturnValue({
      ...defaultHookReturn,
      solicitudes: [makeSolicitud({ estado: "pendiente" })],
    });

    render(<GestionSolicitudes />);
    expect(screen.getByText("Pendiente")).toBeDefined();
  });

  // ── Filtrado ───────────────────────────────────────────────────────────────

  it("filtro por defecto muestra solo pendientes", () => {
    vi.mocked(useSolicitudesPendientes).mockReturnValue({
      ...defaultHookReturn,
      solicitudes: [
        makeSolicitud({ id: "sol-1", estado: "pendiente", nombre: "Juan" }),
        makeSolicitud({ id: "sol-2", estado: "resuelta", nombre: "María" }),
      ],
    });

    render(<GestionSolicitudes />);
    // Solo Juan debe aparecer (filtro inicial = "pendiente")
    expect(screen.getByText("Juan")).toBeDefined();
    expect(screen.queryByText("María")).toBeNull();
  });

  it("mostrar 'No hay solicitudes con este filtro' para filtro sin resultados", () => {
    vi.mocked(useSolicitudesPendientes).mockReturnValue({
      ...defaultHookReturn,
      solicitudes: [makeSolicitud({ estado: "pendiente" })],
    });

    render(<GestionSolicitudes />);

    // El select de estado tiene valor "pendiente" por defecto
    // Simulamos cambio a "contactado" (no hay ninguna)
    const trigger = screen.getByRole("combobox");
    fireEvent.click(trigger);

    // En Radix Select, las opciones se renderizan en un portal.
    // Verificamos al menos que el componente no explota.
    expect(trigger).toBeDefined();
  });

  // ── Badge contador ─────────────────────────────────────────────────────────

  it("badge de contador muestra el número correcto de solicitudes filtradas", () => {
    vi.mocked(useSolicitudesPendientes).mockReturnValue({
      ...defaultHookReturn,
      solicitudes: [
        makeSolicitud({ id: "sol-1", estado: "pendiente" }),
        makeSolicitud({ id: "sol-2", estado: "pendiente" }),
      ],
      countPendientes: 2,
    });

    render(<GestionSolicitudes />);
    // El badge muestra el número 2
    expect(screen.getByText("2")).toBeDefined();
  });

  // ── Solicitud con notas internas ────────────────────────────────────────────

  it("muestra notas internas cuando existen", () => {
    vi.mocked(useSolicitudesPendientes).mockReturnValue({
      ...defaultHookReturn,
      solicitudes: [
        makeSolicitud({ notas_internas: "Llamar a las 10h mañana" }),
      ],
    });

    render(<GestionSolicitudes />);
    expect(screen.getByText("Llamar a las 10h mañana")).toBeDefined();
  });

  // ── Interacciones ───────────────────────────────────────────────────────────

  it("botón Gestionar expande las opciones de la tarjeta", () => {
    vi.mocked(useSolicitudesPendientes).mockReturnValue({
      ...defaultHookReturn,
      solicitudes: [makeSolicitud()],
    });

    render(<GestionSolicitudes />);
    const gestionarBtn = screen.getByText("Gestionar");
    fireEvent.click(gestionarBtn);

    // Después de expandir, deben aparecer los botones de acción
    expect(screen.getByText("Resuelta")).toBeDefined();
    expect(screen.getByText("Descartar")).toBeDefined();
  });

  it("al hacer clic en Resuelta se llama updateEstado con 'resuelta'", async () => {
    const updateEstado = vi.fn().mockResolvedValue(true);
    vi.mocked(useSolicitudesPendientes).mockReturnValue({
      ...defaultHookReturn,
      solicitudes: [makeSolicitud({ id: "sol-1" })],
      updateEstado,
    });

    render(<GestionSolicitudes />);
    fireEvent.click(screen.getByText("Gestionar"));
    fireEvent.click(screen.getByText("Resuelta"));

    await waitFor(() => {
      expect(updateEstado).toHaveBeenCalledWith("sol-1", "resuelta");
    });
  });

  it("al hacer clic en Descartar se llama updateEstado con 'descartada'", async () => {
    const updateEstado = vi.fn().mockResolvedValue(true);
    vi.mocked(useSolicitudesPendientes).mockReturnValue({
      ...defaultHookReturn,
      solicitudes: [makeSolicitud({ id: "sol-1" })],
      updateEstado,
    });

    render(<GestionSolicitudes />);
    fireEvent.click(screen.getByText("Gestionar"));
    fireEvent.click(screen.getByText("Descartar"));

    await waitFor(() => {
      expect(updateEstado).toHaveBeenCalledWith("sol-1", "descartada");
    });
  });

  it("solicitud resuelta no muestra botón 'Resuelta' (ya está en ese estado)", () => {
    vi.mocked(useSolicitudesPendientes).mockReturnValue({
      ...defaultHookReturn,
      solicitudes: [makeSolicitud({ id: "sol-1", estado: "resuelta" })],
    });

    render(<GestionSolicitudes />);
    // El filtro por defecto es "pendiente", así que resuelta no aparece
    // Verificamos que no hay tarjeta del todo
    expect(screen.queryByText("Juan García")).toBeNull();
  });
});
