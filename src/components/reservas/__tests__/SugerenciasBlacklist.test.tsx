/**
 * Tests para src/components/reservas/SugerenciasBlacklist.tsx
 *
 * Estrategia: mock completo de useSugerenciasBlacklist y useUserRole para
 * aislar el renderizado del componente, mismo patrón que
 * GestionSolicitudes.test.tsx (mock del hook de datos, sin tocar Supabase
 * ni react-query de verdad).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/hooks/useSugerenciasBlacklist");
vi.mock("@/hooks/useUserRole");
vi.mock("sonner");

import {
  useSugerenciasBlacklistPendientes,
  useAprobarSugerenciaBlacklist,
  useRechazarSugerenciaBlacklist,
  MENSAJE_MIGRACION_SUGERENCIAS_PENDIENTE,
  type SugerenciaBlacklist,
} from "@/hooks/useSugerenciasBlacklist";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { SugerenciasBlacklist } from "@/components/reservas/SugerenciasBlacklist";

const makeSugerencia = (overrides: Partial<SugerenciaBlacklist> = {}): SugerenciaBlacklist => ({
  id: "sug-1",
  reserva_id: "res-1",
  telefono: "+34 666 111 222",
  email: null,
  nombre_cliente: "Juan García",
  motivo: "no_show",
  historial: {
    total_reservas_previas: 5,
    no_shows_previos: 2,
    completadas_previas: 3,
    canceladas_previas: 0,
    es_primera_falta: false,
  },
  estado: "pendiente",
  blacklist_id: null,
  creada_at: "2026-09-20T10:00:00Z",
  revisada_por: null,
  revisada_at: null,
  nota_revision: null,
  ...overrides,
});

const mutacionOk = () => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn().mockResolvedValue({}),
  isPending: false,
});

const defaultQueryReturn = {
  data: [] as SugerenciaBlacklist[],
  isLoading: false,
  isError: false,
  error: null as unknown,
  refetch: vi.fn(),
};

describe("SugerenciasBlacklist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCanAccessSection).mockReturnValue({ canAccess: true, loading: false });
    vi.mocked(useAprobarSugerenciaBlacklist).mockReturnValue(mutacionOk() as any);
    vi.mocked(useRechazarSugerenciaBlacklist).mockReturnValue(mutacionOk() as any);
  });

  it("muestra spinner mientras carga", () => {
    vi.mocked(useSugerenciasBlacklistPendientes).mockReturnValue({
      ...defaultQueryReturn,
      isLoading: true,
    } as any);

    const { container } = render(<SugerenciasBlacklist />);
    expect(container.querySelectorAll("svg").length).toBeGreaterThan(0);
  });

  it("no revienta y avisa (sin alarmar) cuando la migración no está aplicada", () => {
    vi.mocked(useSugerenciasBlacklistPendientes).mockReturnValue({
      ...defaultQueryReturn,
      isError: true,
      error: new Error(MENSAJE_MIGRACION_SUGERENCIAS_PENDIENTE),
    } as any);

    render(<SugerenciasBlacklist />);
    expect(screen.getByText(MENSAJE_MIGRACION_SUGERENCIAS_PENDIENTE)).toBeDefined();
  });

  it("muestra un error real (no de migración) con opción de reintentar", () => {
    vi.mocked(useSugerenciasBlacklistPendientes).mockReturnValue({
      ...defaultQueryReturn,
      isError: true,
      error: new Error("Fallo de red inesperado"),
    } as any);

    render(<SugerenciasBlacklist />);
    expect(screen.getByText(/no se han podido cargar/i)).toBeDefined();
  });

  it("muestra estado vacío cuando no hay sugerencias pendientes", () => {
    vi.mocked(useSugerenciasBlacklistPendientes).mockReturnValue(defaultQueryReturn as any);

    render(<SugerenciasBlacklist />);
    expect(screen.getByText(/sin sugerencias de lista negra pendientes/i)).toBeDefined();
  });

  it("renderiza una sugerencia con su historial (ausencias, completadas, canceladas)", () => {
    vi.mocked(useSugerenciasBlacklistPendientes).mockReturnValue({
      ...defaultQueryReturn,
      data: [makeSugerencia()],
    } as any);

    render(<SugerenciasBlacklist />);
    expect(screen.getByText("Juan García")).toBeDefined();
    expect(screen.getByText("Ausencia sin avisar")).toBeDefined();
    // Historial: 2 ausencias, 3 completadas, 0 canceladas, 5 total previas
    expect(screen.getByText("2")).toBeDefined();
    expect(screen.getByText("3")).toBeDefined();
    expect(screen.getByText("5")).toBeDefined();
    // Reincidente porque es_primera_falta: false
    expect(screen.getByText("Reincidente")).toBeDefined();
  });

  it("sin historial disponible lo dice explícitamente en vez de mostrar ceros", () => {
    vi.mocked(useSugerenciasBlacklistPendientes).mockReturnValue({
      ...defaultQueryReturn,
      data: [makeSugerencia({ historial: null })],
    } as any);

    render(<SugerenciasBlacklist />);
    expect(screen.getByText(/sin historial previo registrado/i)).toBeDefined();
  });

  it("con permiso de edición ofrece Aprobar y Rechazar", () => {
    vi.mocked(useSugerenciasBlacklistPendientes).mockReturnValue({
      ...defaultQueryReturn,
      data: [makeSugerencia()],
    } as any);

    render(<SugerenciasBlacklist />);
    expect(screen.getByText("Aprobar")).toBeDefined();
    expect(screen.getByText("Rechazar")).toBeDefined();
  });

  it("sin permiso de edición NO ofrece aprobar ni rechazar (usuario de solo lectura)", () => {
    vi.mocked(useCanAccessSection).mockReturnValue({ canAccess: false, loading: false });
    vi.mocked(useSugerenciasBlacklistPendientes).mockReturnValue({
      ...defaultQueryReturn,
      data: [makeSugerencia()],
    } as any);

    render(<SugerenciasBlacklist />);
    expect(screen.queryByText("Aprobar")).toBeNull();
    expect(screen.queryByText("Rechazar")).toBeNull();
    expect(screen.getByText(/solo lectura/i)).toBeDefined();
  });

  it("abrir el diálogo de Aprobar propone una fecha de caducidad por defecto (editable)", () => {
    vi.mocked(useSugerenciasBlacklistPendientes).mockReturnValue({
      ...defaultQueryReturn,
      data: [makeSugerencia()],
    } as any);

    render(<SugerenciasBlacklist />);
    fireEvent.click(screen.getByText("Aprobar"));

    // El diálogo se abre con un botón de fecha ya relleno (Popover+Calendar,
    // no texto libre) y el propio diálogo de confirmación.
    expect(screen.getByText("Aprobar y añadir a lista negra")).toBeDefined();
    expect(screen.getByText(/90 días desde hoy/i)).toBeDefined();
  });
});
