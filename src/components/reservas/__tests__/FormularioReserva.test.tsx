/**
 * Tests para src/components/reservas/FormularioReserva.tsx
 *
 * reservas-sin-salas (decisión del dueño 2026-09-29): la sala es interna,
 * opcional y plegada. Touza no admite reservas (decisión del dueño 2026-10-01):
 * ya no hay selector «Negocio»; el alta escribe SIEMPRE la marca de Casa Tomás
 * (la BD tiene un CHECK sobre `marca` y el trigger de aforo cuenta por marca).
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
    // El día de Casa Tomás (las salas de Touza ya no llegan: las descarta el hook).
    useOcupacionSalasDia: () => ({
      data: {
        espacios: [{ id: "salon", nombre: "Salón", capacidad_maxima: 60 }],
        reservas: [],
        horasBase: ["21:00"],
        cerrado: false,
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

type Llamada = [string, ...unknown[]];

/**
 * Como `espiarInsert`, pero con un builder POR consulta que anota sus llamadas (`[método, ...argumentos]`),
 * para saber qué filtros lleva cada una (el de duplicados, el límite por teléfono, el límite por email…).
 */
function espiarCadenas() {
  const cadenas: Llamada[][] = [];
  const insert = vi.fn();
  vi.mocked(supabase.from).mockImplementation((() => {
    const llamadas: Llamada[] = [];
    cadenas.push(llamadas);
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "in", "not", "or", "order"]) {
      builder[m] = vi.fn((...args: unknown[]) => {
        llamadas.push([m, ...args]);
        return builder;
      });
    }
    builder.insert = (...args: unknown[]) => {
      insert(...args);
      llamadas.push(["insert", ...args]);
      return builder;
    };
    builder.single = vi.fn().mockResolvedValue({ data: { id: "res-nueva" }, error: null });
    builder.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], count: 0, error: null }).then(ok);
    return builder;
  }) as never);
  return { cadenas, insert };
}

function montar(datos: Record<string, unknown>, soloCrear = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidar = vi.spyOn(qc, "invalidateQueries");
  const onSuccess = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <FormularioReserva
          onSuccess={onSuccess}
          soloCrear={soloCrear}
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

// Touza no admite reservas (decisión del dueño 2026-10-01): se retiran «sin negocio elegido no guarda» y
// «Touza sin sala se guarda como Touza». No hay campo «Negocio» y el alta es siempre de Casa Tomás.
describe("FormularioReserva · siempre Casa Tomás, sala interna", () => {
  it("no hay selector «Negocio» ni se nombra ningún negocio", () => {
    espiarInsert();
    montar({});

    expect(screen.queryByText("Negocio")).not.toBeInTheDocument();
    expect(screen.queryByText(/Elige el negocio|Touza|Casa Tomás/)).not.toBeInTheDocument();
  });

  it("sin sala se guarda con la marca de Casa Tomás y sin espacio", async () => {
    const insert = espiarInsert();
    const { onSuccess } = montar({ espacio_id: null });

    // La sala va plegada: el selector no se ve hasta desplegarla.
    expect(screen.getByRole("button", { name: /asignación interna \(opcional\)/i })).toHaveTextContent("sin sala");
    fireEvent.click(await screen.findByRole("button", { name: "Crear Reserva" }));

    await waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
    expect(insert.mock.calls[0][0]).toMatchObject({ marca: "casa_tomas", espacio_id: null, hora: "21:00" });
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it("aunque llegue una marca de otro negocio en los datos de partida, se guarda como Casa Tomás", async () => {
    const insert = espiarInsert();
    montar({ marca: "touza" });

    fireEvent.click(await screen.findByRole("button", { name: "Crear Reserva" }));

    await waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
    expect(insert.mock.calls[0][0]).toMatchObject({ marca: "casa_tomas", espacio_id: null });
  });
});

// Touza no admite reservas (decisión del dueño 2026-10-01): una reserva suya con el mismo teléfono o email ni
// sale como duplicado ni gasta el cupo diario del cliente (antes contaba, aunque fuera de otro negocio).
describe("FormularioReserva · duplicados y límites, solo con reservas de Casa Tomás", () => {
  it("el aviso de duplicados y los límites por teléfono y por email filtran por la marca de Casa Tomás", async () => {
    mocks.config.max_reservas_por_telefono_dia = 2;
    mocks.config.max_reservas_por_email_dia = 2;
    const { cadenas, insert } = espiarCadenas();
    montar({});

    // El aviso de duplicados es una consulta con retardo de 600 ms al abrir el formulario.
    await waitFor(() => expect(cadenas.some((c) => c.some(([m]) => m === "or"))).toBe(true));
    fireEvent.click(await screen.findByRole("button", { name: "Crear Reserva" }));
    await waitFor(() => expect(insert).toHaveBeenCalledTimes(1));

    const deCasaTomas = (c: Llamada[]) => c.some(([m, col, valor]) => m === "eq" && col === "marca" && valor === "casa_tomas");
    const duplicados = cadenas.filter((c) => c.some(([m]) => m === "or"));
    const porTelefono = cadenas.filter((c) => c.some(([m, col]) => m === "in" && col === "telefono"));
    const porEmail = cadenas.filter((c) => c.some(([m, col]) => m === "in" && col === "email"));
    expect(duplicados.length).toBeGreaterThan(0);
    expect(porTelefono).toHaveLength(1);
    expect(porEmail).toHaveLength(1);
    for (const c of duplicados) expect(deCasaTomas(c), "duplicados").toBe(true);
    expect(deCasaTomas(porTelefono[0]), "límite por teléfono").toBe(true);
    expect(deCasaTomas(porEmail[0]), "límite por email").toBe(true);
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

// Crear una reserva exige permiso de EDICIÓN en «Reservas» (RLS de 20261001170000). Si la RLS rechaza el INSERT
// (también desde «Convertir en reserva», que es este mismo alta), se dice qué pasa y qué hacer, no un error genérico,
// y el formulario sigue ahí, con lo escrito, para reintentarlo.
describe("FormularioReserva · sin permiso para crear (RLS)", () => {
  const RECHAZO_RLS = { code: "42501", message: 'new row violates row-level security policy for table "reservas"' };

  async function crearYQueFalle(error: unknown) {
    const insert = espiarInsert();
    consultas.single.mockResolvedValue({ data: null, error });
    const { onSuccess } = montar({});
    fireEvent.click(await screen.findByRole("button", { name: "Crear Reserva" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    return { insert, onSuccess };
  }

  it("42501: «No tienes permiso para crear reservas» y a quién pedirlo; el formulario no se queda bloqueado", async () => {
    const { insert, onSuccess } = await crearYQueFalle(RECHAZO_RLS);

    expect(toast.error).toHaveBeenCalledWith(
      "No tienes permiso para crear reservas. Pide a un super admin que te dé «Puede editar» en Reservas.",
    );
    expect(onSuccess).not.toHaveBeenCalled();
    expect(notificarCambioReserva).not.toHaveBeenCalled();
    // Sigue con lo escrito y se puede volver a intentar.
    expect(screen.getByLabelText("Nombre completo")).toHaveValue("Ana López");
    const crear = await screen.findByRole("button", { name: "Crear Reserva" });
    expect(crear).toBeEnabled();
    fireEvent.click(crear);
    await waitFor(() => expect(insert).toHaveBeenCalledTimes(2));
  });

  it("también si el error de la RLS llega sin código, solo con su texto", async () => {
    await crearYQueFalle({ message: RECHAZO_RLS.message });

    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/^No tienes permiso para crear reservas\. Pide a un super admin/));
  });
});

// Tipo de usuario «Reservas» (10/11/2026): solo crea. «Ocupa la sala entera» cierra la sala y exige «Editar».
describe("FormularioReserva · solo crear («Reservas · Crear»)", () => {
  const desplegarSala = () => fireEvent.click(screen.getByRole("button", { name: /asignación interna \(opcional\)/i }));

  it("sin «Editar» no se ofrece «Ocupa la sala entera (evento)»", async () => {
    espiarInsert();
    montar({}, true);
    desplegarSala();
    await screen.findByText(/No se le dice al cliente ni limita la hora/);
    expect(screen.queryByTestId("casilla-sala-entera")).not.toBeInTheDocument();
  });

  it("con «Editar» sigue ahí", async () => {
    espiarInsert();
    montar({});
    desplegarSala();
    expect(await screen.findByTestId("casilla-sala-entera")).toBeInTheDocument();
  });
});
