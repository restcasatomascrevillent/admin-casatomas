/**
 * Tests para src/components/reservas/FormularioReserva.tsx
 *
 * reservas-sin-salas (decisión del dueño 2026-09-29): el negocio de una
 * reserva manual se ELIGE (obligatorio) y ya no lo decide la sala, que pasa a
 * ser interna, opcional y plegada.
 *   1. Sin negocio elegido no se guarda: error de validación, sin INSERT.
 *   2. Touza sin sala se guarda como Touza (marca 'touza', espacio_id null).
 *
 * Email OPCIONAL en el alta manual (2026-09-30): puede quedar vacío y entonces
 * se guarda `null` (nunca ''); si se rellena, se sigue validando el formato.
 * Sin email no se manda el correo "Confirma tu reserva" y la reserva nace
 * igual que siempre ('verificada', o 'pendiente' si está en lista negra).
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { addDays } from "date-fns";

// Espías compartidos: la lista negra y la configuración se leen desde los tests.
const mocks = vi.hoisted(() => ({
  verificarBlacklist: vi.fn(),
  config: {
    min_comensales_por_reserva: 1,
    max_comensales_por_reserva: 12,
    max_reservas_por_telefono_dia: 0,
    max_reservas_por_email_dia: 0,
    dias_max_antelacion: 60,
  },
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/hooks/useBlacklist", () => ({
  useVerificarBlacklist: () => ({ mutateAsync: mocks.verificarBlacklist }),
}));
vi.mock("@/hooks/useConfiguracionReservas", () => ({
  useConfiguracionReservas: () => ({ data: mocks.config }),
}));
vi.mock("@/hooks/useDisponibilidad", () => ({
  verificarAforoTurno: vi.fn().mockResolvedValue({ disponible: true, mensaje: "Hay aforo en el turno." }),
}));
vi.mock("@/hooks/useVerificacionReservas", () => ({ notificarCambioReserva: vi.fn() }));
vi.mock("@/hooks/useOcupacionSalasDia", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/useOcupacionSalasDia")>();
  return {
    ...real,
    useOcupacionSalasDia: () => ({
      data: {
        negocios: [
          {
            marca: "casa_tomas",
            espacios: [{ id: "salon", nombre: "Salón", capacidad_maxima: 60, marca: "casa_tomas" }],
            reservas: [],
            horasBase: ["21:00"],
            cerrado: false,
          },
          {
            marca: "touza",
            espacios: [{ id: "reservado", nombre: "El Reservado", capacidad_maxima: 20, marca: "touza" }],
            reservas: [],
            horasBase: ["21:00"],
            cerrado: false,
          },
        ],
      },
    }),
  };
});
vi.mock("@/components/reservas/OcupacionSalas", () => ({ OcupacionSalas: () => null }));
vi.mock("@/components/reservas/DisponibilidadCuartos", () => ({
  DisponibilidadCuartos: () => null,
  useRejillaCuartos: () => ({
    rejilla: { franjas: [{ hora: "21:00", origen: "turno" }], aforo: {} },
    isLoading: false,
    isError: false,
  }),
}));

import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { notificarCambioReserva } from "@/hooks/useVerificacionReservas";
import { FormularioReserva } from "@/components/reservas/FormularioReserva";
import { CLAVES_POR_CAMBIO } from "@/lib/reservas/clavesCache";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

/** Último builder de `supabase.from(...)` creado por `espiarInsert`, para mirar qué se consultó. */
let consultas: Record<string, ReturnType<typeof vi.fn>>;

/** Builder encadenable: cualquier consulta devuelve vacío; el INSERT se espía. */
function espiarInsert() {
  const insert = vi.fn();
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "not", "or", "order"]) builder[m] = vi.fn(() => builder);
  builder.insert = insert.mockImplementation(() => builder);
  builder.single = vi.fn().mockResolvedValue({ data: { id: "res-nueva" }, error: null });
  builder.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], count: 0, error: null }).then(ok);
  vi.mocked(supabase.from).mockReturnValue(builder as never);
  consultas = builder as Record<string, ReturnType<typeof vi.fn>>;
  return insert;
}

function montar(datos: Record<string, unknown>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidar = vi.spyOn(qc, "invalidateQueries");
  const onSuccess = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <FormularioReserva
          onSuccess={onSuccess}
          datosPreseleccionados={{
            fecha: addDays(new Date(), 3),
            hora: "21:00",
            nombre: "Ana López",
            telefono: "612345678",
            email: "ana@ejemplo.com",
            numero_comensales: 4,
            ...datos,
          }}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onSuccess, invalidar };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verificarBlacklist.mockResolvedValue(null);
  mocks.config.max_reservas_por_telefono_dia = 0;
  mocks.config.max_reservas_por_email_dia = 0;
});

describe("FormularioReserva · negocio obligatorio y sala interna", () => {
  it("sin negocio elegido no guarda y lo pide", async () => {
    const insert = espiarInsert();
    montar({ marca: "" });

    fireEvent.click(screen.getByRole("button", { name: "Crear Reserva" }));

    expect((await screen.findAllByText("Elige el negocio")).length).toBeGreaterThan(0);
    expect(insert).not.toHaveBeenCalled();
  });

  it("Touza sin sala se guarda como Touza y sin espacio", async () => {
    const insert = espiarInsert();
    const { onSuccess } = montar({ marca: "touza", espacio_id: null });

    // La sala va plegada: el selector no se ve hasta desplegarla.
    expect(screen.getByRole("button", { name: /asignación interna \(opcional\)/i })).toHaveTextContent("sin sala");
    fireEvent.click(await screen.findByRole("button", { name: "Crear Reserva" }));

    await waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
    expect(insert.mock.calls[0][0]).toMatchObject({ marca: "touza", espacio_id: null, hora: "21:00" });
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it("Casa Tomás por defecto si no viene negocio", async () => {
    const insert = espiarInsert();
    montar({});

    fireEvent.click(await screen.findByRole("button", { name: "Crear Reserva" }));

    await waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
    expect(insert.mock.calls[0][0]).toMatchObject({ marca: "casa_tomas", espacio_id: null });
  });
});

describe("FormularioReserva · qué se refresca al crear", () => {
  it("las claves de cualquier cambio de ocupación (`clavesCache.ts`): sin las dos que no existían y con `disponibilidad-calculada`", async () => {
    const insert = espiarInsert();
    const { invalidar, onSuccess } = montar({});

    fireEvent.click(await screen.findByRole("button", { name: "Crear Reserva" }));

    await waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    const claves = invalidar.mock.calls.map(([filtro]) => (filtro as { queryKey: string[] }).queryKey[0]);
    for (const clave of CLAVES_POR_CAMBIO.ocupacion) expect(claves, clave).toContain(clave);
    expect(claves).toContain("disponibilidad-calculada");
    // Nombres que ninguna consulta usa: refrescarlos no refrescaba nada.
    expect(claves).not.toContain("ocupacion-reservas-hoy");
    expect(claves).not.toContain("resumen-ocupacion-hoy-completo");
  });
});

describe("FormularioReserva · email opcional", () => {
  const CAMPO_EMAIL = "juan@email.com"; // placeholder del campo

  it("el campo se rotula «Email (opcional)»", () => {
    espiarInsert();
    montar({});

    expect(screen.getByText("Email (opcional)")).toBeInTheDocument();
  });

  it("sin email crea la reserva y guarda email null (nunca cadena vacía)", async () => {
    const insert = espiarInsert();
    const { onSuccess } = montar({ email: undefined });

    fireEvent.click(await screen.findByRole("button", { name: "Crear Reserva" }));

    await waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
    const fila = insert.mock.calls[0][0];
    expect(fila).toHaveProperty("email", null);
    expect(fila.email).not.toBe("");
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it("solo espacios en el email: también se guarda null", async () => {
    const insert = espiarInsert();
    montar({ email: "   " });

    fireEvent.click(await screen.findByRole("button", { name: "Crear Reserva" }));

    await waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
    expect(insert.mock.calls[0][0]).toHaveProperty("email", null);
  });

  it("escrito y luego borrado (queda '' en el formulario): se guarda null", async () => {
    const insert = espiarInsert();
    montar({ email: undefined });

    const campo = screen.getByPlaceholderText(CAMPO_EMAIL);
    fireEvent.change(campo, { target: { value: "ana@ejemplo.com" } });
    fireEvent.change(campo, { target: { value: "" } });
    fireEvent.click(await screen.findByRole("button", { name: "Crear Reserva" }));

    await waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
    expect(insert.mock.calls[0][0]).toHaveProperty("email", null);
  });

  it("un email mal formado sigue rechazándose: lo dice y no guarda", async () => {
    const insert = espiarInsert();
    montar({ email: "ana@ejemplo" });

    fireEvent.click(await screen.findByRole("button", { name: "Crear Reserva" }));

    expect((await screen.findAllByText("Email no válido")).length).toBeGreaterThan(0);
    expect(insert).not.toHaveBeenCalled();
  });

  it("con email válido se guarda recortado y se manda el correo 'Confirma tu reserva'", async () => {
    const insert = espiarInsert();
    montar({ email: "  ana@ejemplo.com " });

    fireEvent.click(await screen.findByRole("button", { name: "Crear Reserva" }));

    await waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
    expect(insert.mock.calls[0][0]).toMatchObject({ email: "ana@ejemplo.com", estado: "verificada" });
    await waitFor(() =>
      expect(notificarCambioReserva).toHaveBeenCalledWith("res-nueva", { estado: "verificada" }),
    );
    expect(vi.mocked(toast.success).mock.calls.at(-1)?.[0]).toMatch(/correo para que la confirme/);
  });

  it("sin email no se dispara el correo y el aviso no dice que se ha enviado", async () => {
    const insert = espiarInsert();
    montar({ email: undefined });

    fireEvent.click(await screen.findByRole("button", { name: "Crear Reserva" }));

    await waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
    // La reserva nace igual que siempre (verificada); solo que no hay a quién escribirle.
    expect(insert.mock.calls[0][0]).toMatchObject({ estado: "verificada", canal: "manual" });
    expect(notificarCambioReserva).not.toHaveBeenCalled();
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const [mensaje, opciones] = vi.mocked(toast.success).mock.calls.at(-1) as [string, { description?: string }?];
    expect(mensaje).toMatch(/sin email/i);
    expect(opciones?.description).toMatch(/ningún correo/i);
    expect(mensaje).not.toMatch(/se ha enviado/i);
  });

  it("la nota del formulario cambia según haya email o no", async () => {
    espiarInsert();
    montar({ email: undefined });

    expect(screen.getByText(/Sin email: no se puede enviar el correo/i)).toBeInTheDocument();
    expect(screen.queryByText(/Se enviará al cliente un correo/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(CAMPO_EMAIL), { target: { value: "ana@ejemplo.com" } });

    expect(await screen.findByText(/Se enviará al cliente un correo/)).toBeInTheDocument();
    expect(screen.queryByText(/Sin email: no se puede enviar el correo/i)).not.toBeInTheDocument();
  });

  it("sin email, lista negra, límites y duplicados se resuelven solo con el teléfono", async () => {
    mocks.config.max_reservas_por_telefono_dia = 2;
    mocks.config.max_reservas_por_email_dia = 2;
    const insert = espiarInsert();
    montar({ email: undefined });

    // El aviso de duplicados es una consulta con retardo de 600 ms al abrir el formulario.
    await waitFor(() => expect(consultas.or).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole("button", { name: "Crear Reserva" }));

    await waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
    // Lista negra: sin email en la comprobación.
    expect(mocks.verificarBlacklist).toHaveBeenCalled();
    for (const [criterios] of mocks.verificarBlacklist.mock.calls) {
      expect(criterios.telefono).toBe("612345678");
      expect(criterios.email ?? null).toBeNull();
    }
    // Límites: se cuenta por teléfono y no se consulta ningún email.
    const columnas = consultas.in.mock.calls.map(([columna]) => columna);
    expect(columnas).toContain("telefono");
    expect(columnas).not.toContain("email");
    // Duplicados del día: el filtro solo habla del teléfono.
    for (const [filtro] of consultas.or.mock.calls) {
      expect(String(filtro)).toMatch(/telefono\.in\./);
      expect(String(filtro)).not.toMatch(/email/);
    }
  });
});
