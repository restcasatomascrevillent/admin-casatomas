/**
 * FormularioReserva en MODO EDICIÓN (`reservaAEditar`).
 *
 * Encargo del dueño (2026-09-30): las reservas se editan SIEMPRE desde el panel,
 * en cualquier estado, con cualquier fecha (también pasada) y de cualquier
 * canal. «Editar» cambia los DATOS; el estado sigue cambiándose con las
 * acciones de siempre. Lo que se comprueba aquí:
 *   1. el formulario arranca con los datos de la reserva y guarda con UPDATE
 *      (nunca INSERT), y SOLO con las columnas que han cambiado — el trigger de
 *      aforo de la BD se dispara por columna (`UPDATE OF fecha, hora,
 *      numero_comensales, estado`), así que no se le manda lo que no cambia;
 *   2. vale para los seis estados, los tres canales y fechas pasadas;
 *   3. conserva lo que ya hacía el sistema: límites por teléfono/email, lista
 *      negra, aforo (errores legibles), aviso a notify-reservation-change;
 *   4. avisa de lo que pasa con la mesa y con el cliente;
 *   5. no bloquea por datos heredados que no se han tocado.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import type { ComponentProps } from "react";

/** El aforo previo y la lista negra son efectos con retardo (400/500 ms): para asegurar que NO ocurren hay que dejarles pasar. */
const dejarPasarLosRetardos = () => new Promise((resolve) => setTimeout(resolve, 700));

const mocks = vi.hoisted(() => ({
  verificarBlacklist: vi.fn(),
  verificarAforo: vi.fn(),
  cuartos: vi.fn(),
  salas: vi.fn(),
  rejilla: vi.fn(),
  config: {
    min_comensales_por_reserva: 1,
    max_comensales_por_reserva: 12,
    max_reservas_por_telefono_dia: 0,
    max_reservas_por_email_dia: 0,
    dias_max_antelacion: 60,
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn(), functions: { invoke: vi.fn() } },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/hooks/useBlacklist", () => ({
  useVerificarBlacklist: () => ({ mutateAsync: mocks.verificarBlacklist }),
}));
vi.mock("@/hooks/useConfiguracionReservas", () => ({
  useConfiguracionReservas: () => ({ data: mocks.config }),
}));
vi.mock("@/hooks/useDisponibilidad", () => ({
  // Misma firma que la real: (fecha, hora, comensales, marca, reservaEditada). Al
  // EDITAR, `reservaEditada` es la reserva ANTERIOR entera (regla del UPDATE:
  // «editar no puede subir la ocupación»), no solo su id.
  verificarAforoTurno: (...args: Parameters<typeof import("@/hooks/useDisponibilidad").verificarAforoTurno>) =>
    mocks.verificarAforo(...args),
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
            espacios: [
              { id: "salon", nombre: "Salón", capacidad_maxima: 60, marca: "casa_tomas" },
              { id: "terraza", nombre: "Terraza", capacidad_maxima: 30, marca: "casa_tomas" },
            ],
            reservas: [],
            horasBase: ["13:00", "21:00"],
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
// Las dos rejillas se sustituyen por un botón que elige hora / sala: así se cambia
// la hora o la sala sin pelearse con un Select de Radix en jsdom, y se ven las props.
vi.mock("@/components/reservas/OcupacionSalas", () => ({
  OcupacionSalas: (props: { onSeleccionar?: (espacioId: string, hora: string) => void }) => {
    mocks.salas(props);
    return (
      <button type="button" onClick={() => props.onSeleccionar?.("terraza", "21:00")}>
        elegir terraza
      </button>
    );
  },
}));
vi.mock("@/components/reservas/DisponibilidadCuartos", () => ({
  DisponibilidadCuartos: (props: { onSeleccionarHora?: (hora: string) => void }) => {
    mocks.cuartos(props);
    return (
      <button type="button" onClick={() => props.onSeleccionarHora?.("13:00")}>
        elegir 13:00
      </button>
    );
  },
  useRejillaCuartos: (args: unknown) => {
    mocks.rejilla(args);
    return {
      rejilla: {
        franjas: [
          { hora: "13:00", origen: "turno" },
          { hora: "21:00", origen: "turno" },
        ],
        aforo: {},
      },
      isLoading: false,
      isError: false,
    };
  },
}));

import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { FormularioReserva } from "@/components/reservas/FormularioReserva";
import { TEXTO_ENLACE_INVALIDADO, TEXTO_ENLACE_NUEVO, type ReservaEditable } from "@/lib/reservas/edicionReserva";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

const EN_DIEZ_DIAS = format(addDays(new Date(), 10), "yyyy-MM-dd");

/** Una reserva confirmada de dentro de 10 días, con email y sin nada raro. */
const reserva = (over: Partial<ReservaEditable> = {}): ReservaEditable => ({
  id: "res-1",
  nombre: "Ana López",
  telefono: "+34612345678",
  email: "ana@ejemplo.com",
  fecha: EN_DIEZ_DIAS,
  hora: "21:00:00",
  numero_comensales: 4,
  estado: "confirmada",
  notas_cliente: "Sin gluten",
  espacio_id: "salon",
  marca: "casa_tomas",
  canal: "telefono",
  importante: false,
  en_blacklist: false,
  ...over,
});

type Builder = Record<string, ReturnType<typeof vi.fn>> & { then: unknown };

/**
 * Doble de `supabase.from(...)`: un builder NUEVO por consulta (encadenable).
 * Lo que acaba en `.update(...)` responde con `filasUpdate`/`errorUpdate`; el
 * resto (límites, duplicados) responde vacío.
 */
function prepararBD(opciones: { filasUpdate?: unknown[]; errorUpdate?: unknown } = {}) {
  const update = vi.fn();
  const insert = vi.fn();
  const builders: Builder[] = [];
  vi.mocked(supabase.from).mockImplementation((() => {
    let esUpdate = false;
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "in", "not", "or", "order"]) b[m] = vi.fn(() => b);
    b.update = vi.fn((valores: unknown) => {
      update(valores);
      esUpdate = true;
      return b;
    });
    b.insert = vi.fn((valores: unknown) => {
      insert(valores);
      return b;
    });
    b.single = vi.fn().mockResolvedValue({ data: { id: "x" }, error: null });
    b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve(
        esUpdate
          ? { data: opciones.filasUpdate ?? [{ id: "res-1" }], error: opciones.errorUpdate ?? null }
          : { data: [], count: 0, error: null },
      ).then(ok, ko);
    builders.push(b as Builder);
    return b;
  }) as never);
  return { update, insert, builders };
}

function montar(
  over: Partial<ReservaEditable> = {},
  props: Partial<ComponentProps<typeof FormularioReserva>> = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidar = vi.spyOn(qc, "invalidateQueries");
  const onSuccess = vi.fn();
  const vista = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <FormularioReserva reservaAEditar={reserva(over)} onSuccess={onSuccess} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onSuccess, invalidar, unmount: vista.unmount };
}

const guardar = () => screen.findByRole("button", { name: "Guardar cambios" });
const escribir = (valorActual: string, nuevo: string) =>
  fireEvent.change(screen.getByDisplayValue(valorActual), { target: { value: nuevo } });

/** Las llamadas a `notify-reservation-change` (la edición la ESPERA: no es fire-and-forget). */
const notificaciones = () => vi.mocked(supabase.functions.invoke);
/** Lo que contesta el proxy: el texto JSON de `emails-reserva` va dentro de `resultado`. */
const respuestaProxy = (resultado: unknown) => ({
  data: { success: true, status: 200, resultado: typeof resultado === "string" ? resultado : JSON.stringify(resultado) },
  error: null,
});
/** La descripción del último aviso de «guardado». */
const descripcionDelAviso = () => {
  const [, opciones] = vi.mocked(toast.success).mock.calls.at(-1) as [string, { description: string; duration?: number }];
  return opciones;
};
/** La casilla «Avisar al cliente del cambio» (solo sale si cambia día, hora o comensales). */
const casillaAviso = () => screen.getByRole("checkbox", { name: "Avisar al cliente del cambio" });

beforeEach(() => {
  vi.clearAllMocks();
  // Cada función contesta con su forma: el proxy envuelve el `{ ok, motivo }` de
  // emails-reserva en `resultado`; la ruta del aviso de cambio lo devuelve tal cual.
  notificaciones().mockImplementation((async (nombre: string) =>
    nombre === "emails-reserva/notificar-modificacion"
      ? { data: { ok: true }, error: null }
      : respuestaProxy({ ok: true })) as never);
  mocks.verificarBlacklist.mockResolvedValue(null);
  mocks.verificarAforo.mockResolvedValue({ disponible: true, mensaje: "Hay aforo en el turno." });
  mocks.config.min_comensales_por_reserva = 1;
  mocks.config.max_reservas_por_telefono_dia = 0;
  mocks.config.max_reservas_por_email_dia = 0;
});

describe("FormularioReserva · edición · arranque y guardado", () => {
  it("arranca con los datos de la reserva y el botón dice «Guardar cambios», no «Crear Reserva»", async () => {
    prepararBD();
    montar();

    expect(screen.getByDisplayValue("Ana López")).toBeInTheDocument();
    expect(screen.getByDisplayValue("+34612345678")).toBeInTheDocument();
    expect(screen.getByDisplayValue("ana@ejemplo.com")).toBeInTheDocument();
    expect(screen.getByDisplayValue("4")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Sin gluten")).toBeInTheDocument();
    expect(await guardar()).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Crear Reserva" })).not.toBeInTheDocument();
  });

  it("cambiar solo el nombre hace UN update de esa reserva con solo el nombre, y ningún insert", async () => {
    const bd = prepararBD();
    const { onSuccess } = montar();

    escribir("Ana López", "Ana María López");
    fireEvent.click(await guardar());

    await waitFor(() => expect(bd.update).toHaveBeenCalledTimes(1));
    // Ni fecha, ni hora, ni comensales, ni estado: el trigger de aforo no se entera.
    expect(bd.update.mock.calls[0][0]).toEqual({ nombre: "Ana María López" });
    const constructorDelUpdate = bd.builders.find((b) => b.update.mock.calls.length > 0)!;
    expect(constructorDelUpdate.eq).toHaveBeenCalledWith("id", "res-1");
    expect(bd.insert).not.toHaveBeenCalled();
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith("Reserva actualizada", {
      description: expect.stringContaining("nombre"),
    });
  });

  it.each(["pendiente", "verificada", "confirmada", "cancelada", "completada", "no_show"])(
    "se puede guardar una reserva en estado «%s» sin tocar su estado",
    async (estado) => {
      const bd = prepararBD();
      const { onSuccess } = montar({ estado });

      escribir("Ana López", "Otro Nombre");
      fireEvent.click(await guardar());

      await waitFor(() => expect(bd.update).toHaveBeenCalledTimes(1));
      expect(bd.update.mock.calls[0][0]).toEqual({ nombre: "Otro Nombre" });
      expect(bd.update.mock.calls[0][0]).not.toHaveProperty("estado");
      await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    },
  );

  it.each(["web", "telefono", "manual"])("una reserva de canal «%s» se edita igual y conserva su canal", async (canal) => {
    const bd = prepararBD();
    montar({ canal });

    escribir("Ana López", "Otro Nombre");
    fireEvent.click(await guardar());

    await waitFor(() => expect(bd.update).toHaveBeenCalledTimes(1));
    expect(bd.update.mock.calls[0][0]).not.toHaveProperty("canal");
  });

  it("una reserva de un día que ya pasó se guarda sin el «La fecha ya ha pasado» del alta", async () => {
    const bd = prepararBD();
    montar({ fecha: "2020-03-10", estado: "completada" });

    escribir("Ana López", "Ana Corregida");
    fireEvent.click(await guardar());

    await waitFor(() => expect(bd.update).toHaveBeenCalledTimes(1));
    expect(bd.update.mock.calls[0][0]).toEqual({ nombre: "Ana Corregida" });
    expect(screen.queryByText("La fecha ya ha pasado")).not.toBeInTheDocument();
  });

  it("en el calendario se puede elegir otro día pasado y el UPDATE lleva esa fecha", async () => {
    const bd = prepararBD();
    montar({ fecha: "2020-03-10", estado: "no_show" });

    // El selector de fecha (su etiqueta es «Fecha») enseña el día de la reserva.
    const selectorDeFecha = screen.getByRole("button", { name: "Fecha" });
    expect(selectorDeFecha).toHaveTextContent("10 de marzo 2020");
    fireEvent.click(selectorDeFecha);
    // El calendario se abre en el mes de la reserva (no en el de hoy), y los
    // días pasados NO están deshabilitados.
    const dia = await screen.findByRole("gridcell", { name: "12" });
    expect(dia).not.toBeDisabled();
    fireEvent.click(dia);
    fireEvent.click(await guardar());

    await waitFor(() => expect(bd.update).toHaveBeenCalledTimes(1));
    expect(bd.update.mock.calls[0][0]).toEqual({ fecha: "2020-03-12" });
  });

  it("sin cambios no hay UPDATE: lo dice y cierra", async () => {
    const bd = prepararBD();
    const { onSuccess } = montar();

    fireEvent.click(await guardar());

    await waitFor(() => expect(toast.info).toHaveBeenCalledWith("No hay cambios que guardar"));
    expect(bd.update).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalled();
  });

  it("refresca las pantallas que enseñan reservas, asignación, mesas y servicio", async () => {
    prepararBD();
    const { invalidar } = montar();

    escribir("Ana López", "Otro Nombre");
    fireEvent.click(await guardar());

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const claves = invalidar.mock.calls.map(([f]) => (f as { queryKey: string[] }).queryKey[0]);
    for (const clave of [
      "reservas-lista",
      "reservas-kanban",
      "reservas-hoy",
      "reservas_mes",
      "ocupacion-salas-dia",
      "resumen-asignacion-dia",
      "asignaciones_mesa",
      "reservas-servicio-dia",
      "reservas_sala_dia",
      "reservas_hoy_resumen",
      // La fila que tiene abierta el editor.
      "reserva-edicion",
      // Desde que la lista sale de `clavesCache.ts` (paso 4): la rejilla de horas calculada también.
      "disponibilidad-calculada",
    ]) {
      expect(claves).toContain(clave);
    }
    // Y ya no refresca nombres que ninguna consulta usa.
    expect(claves).not.toContain("ocupacion-reservas-hoy");
    expect(claves).not.toContain("resumen-ocupacion-hoy-completo");
  });
});

describe("FormularioReserva · edición · lo que no se toca no bloquea", () => {
  it("una reserva de un turno donde ya no cabe nadie se corrige de nombre sin consultar ni mandar el aforo", async () => {
    mocks.verificarAforo.mockResolvedValue({ disponible: false, mensaje: "Aforo superado en el turno de cena" });
    const bd = prepararBD();
    montar();

    escribir("Ana López", "Otro Nombre");
    fireEvent.click(await guardar());

    await waitFor(() => expect(bd.update).toHaveBeenCalledTimes(1));
    await dejarPasarLosRetardos();
    expect(mocks.verificarAforo).not.toHaveBeenCalled();
    expect(bd.update.mock.calls[0][0]).toEqual({ nombre: "Otro Nombre" });
  });

  it("nombre y teléfono antiguos que hoy no pasarían el alta no impiden cambiar otra cosa", async () => {
    const bd = prepararBD();
    montar({ nombre: "J", telefono: "600123" });

    escribir("Sin gluten", "Sin gluten ni lactosa");
    fireEvent.click(await guardar());

    await waitFor(() => expect(bd.update).toHaveBeenCalledTimes(1));
    expect(bd.update.mock.calls[0][0]).toEqual({ notas_cliente: "Sin gluten ni lactosa" });
    expect(screen.queryByText(/Faltan datos/)).not.toBeInTheDocument();
  });

  it("pero en cuanto se toca el teléfono se valida como en el alta", async () => {
    const bd = prepararBD();
    montar({ telefono: "600123" });

    escribir("600123", "12345");
    fireEvent.click(await guardar());

    expect((await screen.findAllByText("Teléfono no válido (mínimo 9 cifras)")).length).toBeGreaterThan(0);
    expect(screen.getByText(/Faltan datos para guardar los cambios/)).toBeInTheDocument();
    expect(bd.update).not.toHaveBeenCalled();
  });

  it("una reserva sin teléfono (la BD lo permite) se puede editar sin inventarse uno", async () => {
    const bd = prepararBD();
    montar({ telefono: null });

    escribir("Ana López", "Otro Nombre");
    fireEvent.click(await guardar());

    await waitFor(() => expect(bd.update).toHaveBeenCalledTimes(1));
    expect(bd.update.mock.calls[0][0]).toEqual({ nombre: "Otro Nombre" });
  });

  it("el mínimo de comensales no se exige si no se toca el número de comensales", async () => {
    mocks.config.min_comensales_por_reserva = 3;
    const bd = prepararBD();
    montar({ numero_comensales: 2 });

    escribir("Ana López", "Otro Nombre");
    fireEvent.click(await guardar());

    await waitFor(() => expect(bd.update).toHaveBeenCalledTimes(1));
    expect(bd.update.mock.calls[0][0]).toEqual({ nombre: "Otro Nombre" });
  });

  it("pero si se cambia el número de comensales, sí se respeta el mínimo configurado", async () => {
    mocks.config.min_comensales_por_reserva = 3;
    const bd = prepararBD();
    montar({ numero_comensales: 5 });

    escribir("5", "1");
    fireEvent.click(await guardar());

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Mínimo 3 comensal(es)"));
    expect(bd.update).not.toHaveBeenCalled();
  });
});

describe("FormularioReserva · edición · email", () => {
  it("una reserva sin email se guarda sin pedirlo, sin mandar correo", async () => {
    const bd = prepararBD();
    montar({ email: null, estado: "verificada" });

    escribir("Ana López", "Otro Nombre");
    fireEvent.click(await guardar());

    await waitFor(() => expect(bd.update).toHaveBeenCalledTimes(1));
    expect(bd.update.mock.calls[0][0]).toEqual({ nombre: "Otro Nombre" });
    expect(notificaciones()).not.toHaveBeenCalled();
  });

  it("vaciar el email lo guarda como null (nunca cadena vacía)", async () => {
    const bd = prepararBD();
    montar();

    escribir("ana@ejemplo.com", "");
    fireEvent.click(await guardar());

    await waitFor(() => expect(bd.update).toHaveBeenCalledTimes(1));
    expect(bd.update.mock.calls[0][0]).toEqual({ email: null });
    expect(notificaciones()).not.toHaveBeenCalled();
  });

  it("un email mal formado se rechaza y no se guarda", async () => {
    const bd = prepararBD();
    montar();

    escribir("ana@ejemplo.com", "ana@ejemplo");
    fireEvent.click(await guardar());

    expect((await screen.findAllByText("Email no válido")).length).toBeGreaterThan(0);
    expect(bd.update).not.toHaveBeenCalled();
  });

  it("añadir un email a una reserva VERIFICADA pide el correo «Confirma tu reserva» (misma regla que el alta)", async () => {
    const bd = prepararBD();
    montar({ email: null, estado: "verificada" });

    fireEvent.change(screen.getByPlaceholderText("juan@email.com"), { target: { value: " juan@ejemplo.com " } });
    fireEvent.click(await guardar());

    await waitFor(() => expect(bd.update).toHaveBeenCalledTimes(1));
    expect(bd.update.mock.calls[0][0]).toEqual({ email: "juan@ejemplo.com" });
    await waitFor(() =>
      expect(notificaciones()).toHaveBeenCalledWith("notify-reservation-change", {
        body: { id: "res-1", estado: "verificada" },
      }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(descripcionDelAviso().description).toMatch(/Se le ha enviado el correo «Confirma tu reserva»/);
  });

  it("en cualquier otro estado, añadir un email NO manda ningún correo", async () => {
    for (const estado of ["confirmada", "cancelada", "completada", "no_show"]) {
      vi.clearAllMocks();
      const bd = prepararBD();
      const { unmount } = montar({ id: `res-${estado}`, email: null, estado });

      fireEvent.change(screen.getByPlaceholderText("juan@email.com"), { target: { value: "juan@ejemplo.com" } });
      fireEvent.click(await guardar());

      await waitFor(() => expect(bd.update).toHaveBeenCalledTimes(1));
      expect(notificaciones()).not.toHaveBeenCalled();
      unmount();
    }
  });

  it("no se escribe a un cliente en lista negra aunque se le ponga email", async () => {
    mocks.verificarBlacklist.mockResolvedValue({ id: "bl-1", tipo: "telefono", valor: "+34612345678", nombre: "Ana", motivo: "No vino" });
    prepararBD();
    montar({ email: null, estado: "verificada" });

    fireEvent.change(screen.getByPlaceholderText("juan@email.com"), { target: { value: "juan@ejemplo.com" } });
    fireEvent.click(await guardar());

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(notificaciones()).not.toHaveBeenCalled();
  });

  it("no se escribe para un día que ya pasó", async () => {
    prepararBD();
    montar({ email: null, estado: "verificada", fecha: "2020-03-10" });

    fireEvent.change(screen.getByPlaceholderText("juan@email.com"), { target: { value: "juan@ejemplo.com" } });
    fireEvent.click(await guardar());

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(notificaciones()).not.toHaveBeenCalled();
  });

  it("cambiar la hora de una reserva con email: «Avisar al cliente del cambio» sale MARCADA y se pide el aviso con el «antes»", async () => {
    const bd = prepararBD();
    montar();

    fireEvent.click(screen.getByRole("button", { name: "elegir 13:00" }));
    expect(casillaAviso()).toBeChecked();
    fireEvent.click(await guardar());

    await waitFor(() => expect(bd.update).toHaveBeenCalledTimes(1));
    expect(bd.update.mock.calls[0][0]).toEqual({ hora: "13:00" });
    await waitFor(() => expect(notificaciones()).toHaveBeenCalledTimes(1));
    // Directo a emails-reserva (no por notify-reservation-change): lo de ahora lo lee la función de la BD.
    expect(notificaciones()).toHaveBeenCalledWith("emails-reserva/notificar-modificacion", {
      body: { reserva_id: "res-1", antes: { fecha: EN_DIEZ_DIAS, hora: "21:00", comensales: 4 } },
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(descripcionDelAviso().description).toMatch(/Se le ha enviado al cliente un correo con el cambio\./);
  });

  it("si se desmarca, no se pide nada y el aviso dice que el cliente no recibe nada", async () => {
    const bd = prepararBD();
    montar();

    fireEvent.click(screen.getByRole("button", { name: "elegir 13:00" }));
    fireEvent.click(casillaAviso());
    expect(casillaAviso()).not.toBeChecked();
    fireEvent.click(await guardar());

    await waitFor(() => expect(bd.update).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(notificaciones()).not.toHaveBeenCalled();
    expect(descripcionDelAviso().description).toMatch(/El cliente no recibe ningún aviso/);
  });
});

describe("FormularioReserva · edición · casilla «Avisar al cliente del cambio»", () => {
  it("no aparece si no cambia el día, la hora ni los comensales", async () => {
    prepararBD();
    montar();

    escribir("Ana López", "Otro Nombre");
    escribir("Sin gluten", "Sin gluten ni lactosa");
    await guardar();
    expect(screen.queryByRole("checkbox", { name: "Avisar al cliente del cambio" })).not.toBeInTheDocument();
  });

  it("aparece marcada al cambiar los comensales y explica qué se le manda", async () => {
    prepararBD();
    montar();

    escribir("4", "6");
    expect(casillaAviso()).toBeChecked();
    expect(casillaAviso()).toBeEnabled();
    expect(screen.getByText(/Al guardar se le enviará un correo con lo que cambia/)).toBeInTheDocument();
  });

  it("a una VERIFICADA le explica que el correo lleva un enlace nuevo para confirmar", async () => {
    prepararBD();
    montar({ estado: "verificada" });

    escribir("4", "6");
    expect(screen.getByText(/enlace nuevo «Confirma tu reserva»/)).toBeInTheDocument();
  });

  it.each([
    ["sin email", { email: null }, /No tiene email/],
    ["cancelada", { estado: "cancelada" }, /cancelada/],
    ["ya pasada", { fecha: "2020-03-10" }, /ya ha pasado/],
    // La web pendiente no recibe ningún correo hasta la propuesta (sin doble correo).
    ["pendiente de la web", { estado: "pendiente", canal: "web" }, /Aún no ha recibido ningún correo/],
  ])("%s: deshabilitada, sin marcar y con el motivo; al guardar no se pide nada", async (_caso, over, motivo) => {
    const bd = prepararBD();
    montar(over as Partial<ReservaEditable>);

    fireEvent.click(screen.getByRole("button", { name: "elegir 13:00" }));
    expect(casillaAviso()).toBeDisabled();
    expect(casillaAviso()).not.toBeChecked();
    expect(screen.getByText(motivo)).toBeInTheDocument();
    fireEvent.click(await guardar());

    await waitFor(() => expect(bd.update).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(notificaciones()).not.toHaveBeenCalled();
  });

  it("cliente en lista negra: deshabilitada y no se le escribe", async () => {
    mocks.verificarBlacklist.mockResolvedValue({ id: "bl-1", tipo: "telefono", valor: "+34612345678", nombre: "Ana", motivo: "No vino" });
    const bd = prepararBD();
    montar();

    fireEvent.click(screen.getByRole("button", { name: "elegir 13:00" }));
    await waitFor(() => expect(casillaAviso()).toBeDisabled());
    expect(screen.getByText(/lista negra: no se le escribe/)).toBeInTheDocument();
    fireEvent.click(await guardar());

    await waitFor(() => expect(bd.update).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(notificaciones()).not.toHaveBeenCalled();
  });

  it("ESPERA la respuesta de emails-reserva: hasta que llega no dice nada ni cierra", async () => {
    let responder: (r: unknown) => void = () => {};
    notificaciones().mockReturnValue(new Promise((resolve) => (responder = resolve)) as never);
    const bd = prepararBD();
    const { onSuccess } = montar();

    escribir("4", "6");
    fireEvent.click(await guardar());

    await waitFor(() => expect(notificaciones()).toHaveBeenCalledTimes(1));
    expect(bd.update).toHaveBeenCalledTimes(1);
    await dejarPasarLosRetardos();
    expect(toast.success).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();

    responder({ data: { ok: true }, error: null });
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(descripcionDelAviso().description).toMatch(/Se le ha enviado al cliente un correo con el cambio/);
    expect(descripcionDelAviso().duration).toBeGreaterThanOrEqual(10_000);
    expect(onSuccess).toHaveBeenCalled();
  });

  it.each([
    ["ya enviado (el último aviso ya llevaba estos datos)", { data: { ok: false, motivo: "ya_enviado_o_en_curso" }, error: null }, /ya tiene un aviso con estos mismos datos/],
    ["email bloqueado", { data: { ok: false, motivo: "destinatario_suprimido" }, error: null }, /bloqueado/],
    ["reintento en marcha", { data: { ok: false, motivo: "fallido_reintentable" }, error: null }, /se reintentará solo/],
    ["otro motivo", { data: { ok: false, motivo: "token_no_configurado" }, error: null }, /token_no_configurado\)\. Llámale/],
    ["la función falla o aún no está desplegada", { data: null, error: new Error("non-2xx") }, /No se ha podido pedir el envío del aviso del cambio/],
  ])("%s: lo dice tal cual, sin afirmar que se le ha enviado", async (_caso, respuesta, texto) => {
    notificaciones().mockResolvedValue(respuesta as never);
    prepararBD();
    montar();

    escribir("4", "6");
    fireEvent.click(await guardar());

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(descripcionDelAviso().description).toMatch(texto);
    expect(descripcionDelAviso().description).not.toMatch(/Se le ha enviado/);
  });

  it("si la llamada LANZA (red caída), lo guardado queda guardado y se avisa", async () => {
    const consola = vi.spyOn(console, "error").mockImplementation(() => {});
    notificaciones().mockRejectedValue(new Error("Failed to fetch"));
    const bd = prepararBD();
    const { onSuccess } = montar();

    escribir("4", "6");
    fireEvent.click(await guardar());

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(bd.update).toHaveBeenCalledTimes(1);
    expect(descripcionDelAviso().description).toMatch(/No se ha podido pedir el envío del aviso del cambio/);
    expect(toast.error).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalled();
    consola.mockRestore();
  });

  it("doble clic en «Guardar cambios»: un solo guardado y un solo aviso pedido", async () => {
    const bd = prepararBD();
    montar();

    escribir("4", "6");
    const boton = await guardar();
    fireEvent.click(boton);
    fireEvent.click(boton);

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(bd.update).toHaveBeenCalledTimes(1);
    expect(notificaciones()).toHaveBeenCalledTimes(1);
  });

  it("si el guardado falla, no se pide ningún aviso", async () => {
    prepararBD({ errorUpdate: { code: "23514", message: "Aforo superado para el turno" } });
    montar();

    escribir("4", "6");
    fireEvent.click(await guardar());

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(notificaciones()).not.toHaveBeenCalled();
  });
});

describe("FormularioReserva · edición · el aviso dice lo que pasó de verdad con el correo", () => {
  /** Una reserva VERIFICADA sin email a la que se le pone uno: la única edición que pide «Confirma tu reserva». */
  const ponerEmail = async () => {
    const bd = prepararBD();
    const vista = montar({ email: null, estado: "verificada" });
    fireEvent.change(screen.getByPlaceholderText("juan@email.com"), { target: { value: "juan@ejemplo.com" } });
    fireEvent.click(await guardar());
    return { bd, ...vista };
  };

  it("ESPERA la respuesta de notify-reservation-change: hasta que llega no dice nada ni cierra", async () => {
    let responder: (r: unknown) => void = () => {};
    notificaciones().mockReturnValue(new Promise((resolve) => (responder = resolve)) as never);
    const { bd, onSuccess } = await ponerEmail();

    await waitFor(() => expect(notificaciones()).toHaveBeenCalledTimes(1));
    expect(bd.update).toHaveBeenCalledTimes(1);
    await dejarPasarLosRetardos();
    expect(toast.success).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Guardando..." })).toBeDisabled();

    responder(respuestaProxy({ ok: true }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(descripcionDelAviso().description).toMatch(/Se le ha enviado el correo «Confirma tu reserva»/);
    expect(onSuccess).toHaveBeenCalled();
  });

  it("si ya se había enviado (un rebote también ocupa el hueco): NO dice que se le manda, dice que no se repite y qué hacer", async () => {
    notificaciones().mockResolvedValue(respuestaProxy({ ok: false, motivo: "ya_enviado_o_en_curso" }) as never);
    await ponerEmail();

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const { description } = descripcionDelAviso();
    expect(description).not.toMatch(/Se le (ha enviado|manda)/);
    expect(description).toMatch(/ya se le había enviado/);
    expect(description).toMatch(/NO se repite/);
    expect(description).toMatch(/confírmala tú o llámale/);
  });

  it("si el email está suprimido (rebotó o se quejó antes): dice que está bloqueado y que hay que llamarle", async () => {
    notificaciones().mockResolvedValue(respuestaProxy({ ok: false, motivo: "destinatario_suprimido" }) as never);
    await ponerEmail();

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const { description } = descripcionDelAviso();
    expect(description).toMatch(/bloqueado/);
    expect(description).toMatch(/Llámale/);
    expect(description).not.toMatch(/Se le (ha enviado|manda)/);
  });

  it("si emails-reserva no lo envía por otro motivo, lo cita", async () => {
    notificaciones().mockResolvedValue(respuestaProxy({ ok: false, motivo: "plantilla_no_configurada_propuesta" }) as never);
    await ponerEmail();

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(descripcionDelAviso().description).toMatch(/plantilla_no_configurada_propuesta/);
    expect(descripcionDelAviso().description).toMatch(/Llámale/);
  });

  it("si la respuesta no se puede leer, dice solo que se ha pedido el envío (no afirma que salió)", async () => {
    notificaciones().mockResolvedValue(respuestaProxy("esto no es json") as never);
    await ponerEmail();

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const { description } = descripcionDelAviso();
    expect(description).toMatch(/Se ha pedido el envío/);
    expect(description).not.toMatch(/Se le (ha enviado|manda)/);
  });

  it("si no se pudo pedir (error de la función o de red), los datos ya están guardados y se avisa de que hay que llamarle", async () => {
    notificaciones().mockResolvedValue({ data: null, error: new Error("Edge Function returned a non-2xx status code") } as never);
    const { bd, onSuccess } = await ponerEmail();

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(bd.update).toHaveBeenCalledTimes(1);
    expect(descripcionDelAviso().description).toMatch(/No se ha podido pedir el envío/);
    expect(descripcionDelAviso().description).toMatch(/teléfono/);
    expect(onSuccess).toHaveBeenCalled();
  });

  it("si la llamada LANZA (red caída) tampoco rompe: lo guardado queda guardado y se avisa", async () => {
    const consola = vi.spyOn(console, "error").mockImplementation(() => {});
    notificaciones().mockRejectedValue(new Error("Failed to fetch"));
    const { onSuccess } = await ponerEmail();

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(descripcionDelAviso().description).toMatch(/No se ha podido pedir el envío/);
    expect(toast.error).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalled();
    consola.mockRestore();
  });

  it("un aviso que el personal tiene que leer no desaparece en los 4 segundos de siempre", async () => {
    notificaciones().mockResolvedValue(respuestaProxy({ ok: false, motivo: "ya_enviado_o_en_curso" }) as never);
    await ponerEmail();

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(descripcionDelAviso().duration).toBeGreaterThanOrEqual(10_000);
  });
});

describe("FormularioReserva · edición · cambiar la hora rompe el enlace «Confirma tu reserva»", () => {
  it("VERIFICADA con email: al cambiar la hora avisa ANTES de guardar (y solo entonces); con la casilla marcada, que se le manda uno nuevo", async () => {
    prepararBD();
    montar({ estado: "verificada" });

    expect(screen.queryByText(TEXTO_ENLACE_NUEVO)).not.toBeInTheDocument();
    expect(screen.queryByText(TEXTO_ENLACE_INVALIDADO)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "elegir 13:00" }));

    // Casilla marcada (por defecto): el aviso del cambio le lleva un enlace nuevo.
    expect(await screen.findByText(TEXTO_ENLACE_NUEVO)).toBeInTheDocument();
    expect(screen.queryByText(TEXTO_ENLACE_INVALIDADO)).not.toBeInTheDocument();
    // Desmarcada: vuelve el aviso de siempre.
    fireEvent.click(casillaAviso());
    expect(await screen.findByText(TEXTO_ENLACE_INVALIDADO)).toBeInTheDocument();
    expect(screen.queryByText(TEXTO_ENLACE_NUEVO)).not.toBeInTheDocument();
    // La rejilla de salas devuelve la hora a las 21:00 (la de la reserva): el aviso
    // refleja lo que se guardaría AHORA, así que se va.
    fireEvent.click(screen.getByRole("button", { name: /asignación interna \(opcional\)/i }));
    fireEvent.click(await screen.findByRole("button", { name: "elegir terraza" }));
    await waitFor(() => expect(screen.queryByText(TEXTO_ENLACE_INVALIDADO)).not.toBeInTheDocument());
  });

  it("con la casilla marcada y el aviso ENVIADO (lleva enlace nuevo): ni aviso de enlace roto ni «Confirma tu reserva» aparte", async () => {
    const bd = prepararBD();
    montar({ estado: "verificada" });

    fireEvent.click(screen.getByRole("button", { name: "elegir 13:00" }));
    fireEvent.click(await guardar());

    await waitFor(() => expect(bd.update).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(notificaciones()).toHaveBeenCalledTimes(1);
    expect(notificaciones()).toHaveBeenCalledWith("emails-reserva/notificar-modificacion", expect.anything());
    expect(descripcionDelAviso().description).toMatch(/enlace nuevo para confirmar la reserva/);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("con la casilla marcada pero el aviso SIN salir: el enlace viejo sigue roto y se avisa", async () => {
    notificaciones().mockResolvedValue({ data: null, error: new Error("non-2xx") } as never);
    prepararBD();
    montar({ estado: "verificada" });

    fireEvent.click(screen.getByRole("button", { name: "elegir 13:00" }));
    fireEvent.click(await guardar());

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(TEXTO_ENLACE_INVALIDADO, expect.anything()));
  });

  it("y, DESMARCADA, otro aviso DESPUÉS de guardar, que no desaparece enseguida", async () => {
    const bd = prepararBD();
    const { onSuccess } = montar({ estado: "verificada" });

    fireEvent.click(screen.getByRole("button", { name: "elegir 13:00" }));
    fireEvent.click(casillaAviso());
    fireEvent.click(await guardar());

    await waitFor(() => expect(bd.update).toHaveBeenCalledTimes(1));
    expect(bd.update.mock.calls[0][0]).toEqual({ hora: "13:00" });
    await waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1));
    const [texto, opciones] = vi.mocked(toast.warning).mock.calls[0] as [string, { duration?: number }?];
    expect(texto).toBe(TEXTO_ENLACE_INVALIDADO);
    expect(opciones?.duration).toBeGreaterThanOrEqual(10_000);
    expect(onSuccess).toHaveBeenCalled();
    // Cambiar la hora no escribe a nadie: no se pide ningún correo.
    expect(notificaciones()).not.toHaveBeenCalled();
  });

  it("DESMARCADA, si se cambian hora y email a la vez, el correo ya enviado al antiguo sigue roto: los dos avisos", async () => {
    notificaciones().mockResolvedValue(respuestaProxy({ ok: false, motivo: "ya_enviado_o_en_curso" }) as never);
    prepararBD();
    montar({ estado: "verificada", email: "mal@ejemplo.com" });

    fireEvent.click(screen.getByRole("button", { name: "elegir 13:00" }));
    fireEvent.change(screen.getByPlaceholderText("juan@email.com"), { target: { value: "bien@ejemplo.com" } });
    fireEvent.click(casillaAviso());
    fireEvent.click(await guardar());

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(TEXTO_ENLACE_INVALIDADO, expect.anything()));
    expect(notificaciones()).toHaveBeenCalledWith("notify-reservation-change", expect.anything());
    expect(descripcionDelAviso().description).toMatch(/NO se repite/);
  });

  it("MARCADA, un cambio de hora y de email pide SOLO el aviso del cambio (lleva el enlace nuevo), no «Confirma tu reserva» aparte", async () => {
    notificaciones().mockResolvedValue({ data: { ok: true }, error: null } as never);
    prepararBD();
    montar({ estado: "verificada", email: "mal@ejemplo.com" });

    fireEvent.click(screen.getByRole("button", { name: "elegir 13:00" }));
    fireEvent.change(screen.getByPlaceholderText("juan@email.com"), { target: { value: "bien@ejemplo.com" } });
    fireEvent.click(await guardar());

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(notificaciones()).toHaveBeenCalledTimes(1);
    expect(notificaciones()).toHaveBeenCalledWith("emails-reserva/notificar-modificacion", expect.anything());
    expect(notificaciones()).not.toHaveBeenCalledWith("notify-reservation-change", expect.anything());
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("si el guardado falla no se da por rota ni por arreglada: no sale el aviso de después", async () => {
    prepararBD({ errorUpdate: { code: "23514", message: "Aforo superado para el turno" } });
    montar({ estado: "verificada" });

    fireEvent.click(screen.getByRole("button", { name: "elegir 13:00" }));
    fireEvent.click(await guardar());

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it.each(["pendiente", "confirmada", "cancelada", "completada", "no_show"])(
    "en estado «%s» el enlace no existe o ya no vale: ni aviso previo ni posterior",
    async (estado) => {
      const bd = prepararBD();
      montar({ estado });

      fireEvent.click(screen.getByRole("button", { name: "elegir 13:00" }));
      expect(screen.queryByText(TEXTO_ENLACE_INVALIDADO)).not.toBeInTheDocument();
      fireEvent.click(await guardar());

      await waitFor(() => expect(bd.update).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(toast.success).toHaveBeenCalled());
      expect(toast.warning).not.toHaveBeenCalled();
    },
  );

  it("sin email no se mandó ningún correo: no hay enlace que romper", async () => {
    const bd = prepararBD();
    montar({ estado: "verificada", email: null });

    fireEvent.click(screen.getByRole("button", { name: "elegir 13:00" }));
    expect(screen.queryByText(TEXTO_ENLACE_INVALIDADO)).not.toBeInTheDocument();
    fireEvent.click(await guardar());

    await waitFor(() => expect(bd.update).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("cambiar los comensales o el nombre NO lo invalida (la huella del enlace solo lleva la hora)", async () => {
    const bd = prepararBD();
    montar({ estado: "verificada" });

    escribir("4", "6");
    escribir("Ana López", "Otro Nombre");
    expect(screen.queryByText(TEXTO_ENLACE_INVALIDADO)).not.toBeInTheDocument();
    fireEvent.click(await guardar());

    await waitFor(() => expect(bd.update).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.warning).not.toHaveBeenCalled();
  });
});

describe("FormularioReserva · edición · lo que no se toca no lo bloquea el navegador", () => {
  it("el formulario de edición no deja que la validación nativa decida (lleva la suya); el alta la conserva", () => {
    prepararBD();
    const { unmount } = montar();
    expect(document.querySelector("form")).toHaveAttribute("novalidate");
    unmount();

    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <FormularioReserva />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(document.querySelector("form")).not.toHaveAttribute("novalidate");
  });

  it("una reserva del bot con «josé@gmail.com» (el navegador no lo acepta) puede cambiar de nombre", async () => {
    const bd = prepararBD();
    const { onSuccess } = montar({ email: "josé@gmail.com" });

    escribir("Ana López", "Ana María López");
    fireEvent.click(await guardar());

    await waitFor(() => expect(bd.update).toHaveBeenCalledTimes(1));
    // Ni se toca ni se reescribe el email heredado.
    expect(bd.update.mock.calls[0][0]).toEqual({ nombre: "Ana María López" });
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it("uno que el navegador acepta pero el alta no («ana@ejemplo», sin punto) tampoco lo impide", async () => {
    const bd = prepararBD();
    montar({ email: "ana@ejemplo" });

    escribir("Ana López", "Ana María López");
    fireEvent.click(await guardar());

    await waitFor(() => expect(bd.update).toHaveBeenCalledTimes(1));
    expect(bd.update.mock.calls[0][0]).toEqual({ nombre: "Ana María López" });
    expect(screen.queryByText("Email no válido")).not.toBeInTheDocument();
  });

  it("una reserva a las 21:07 (fuera de la rejilla de 5 minutos del campo de hora) puede cambiar de nombre", async () => {
    const bd = prepararBD();
    montar({ hora: "21:07:00" });

    // Es una hora fuera de las franjas: el formulario enseña el campo de hora libre
    // (`type="time" step=300`). Ojo: jsdom no aplica `step` al validar, así que aquí el
    // que garantiza lo del navegador real es el `novalidate` del primer test del bloque.
    expect(screen.getByDisplayValue("21:07")).toHaveAttribute("type", "time");
    escribir("Ana López", "Ana María López");
    fireEvent.click(await guardar());

    await waitFor(() => expect(bd.update).toHaveBeenCalledTimes(1));
    expect(bd.update.mock.calls[0][0]).toEqual({ nombre: "Ana María López" });
  });

  it("pero en cuanto se toca el email, se valida: un email nuevo mal escrito no se guarda, aunque el anterior fuera raro", async () => {
    const bd = prepararBD();
    montar({ email: "josé@gmail.com" });

    escribir("josé@gmail.com", "jose@gmail");
    fireEvent.click(await guardar());

    expect((await screen.findAllByText("Email no válido")).length).toBeGreaterThan(0);
    expect(bd.update).not.toHaveBeenCalled();
  });

  it("y corregirlo por uno válido sí se guarda", async () => {
    const bd = prepararBD();
    montar({ email: "josé@gmail.com" });

    escribir("josé@gmail.com", "jose@gmail.com");
    fireEvent.click(await guardar());

    await waitFor(() => expect(bd.update).toHaveBeenCalledTimes(1));
    expect(bd.update.mock.calls[0][0]).toEqual({ email: "jose@gmail.com" });
  });
});

describe("FormularioReserva · edición · avisa al que lo abrió de si hay cambios sin guardar", () => {
  it("empieza sin cambios, avisa en cuanto se toca algo y vuelve a «sin cambios» si se deja como estaba", async () => {
    prepararBD();
    const onCambiosSinGuardar = vi.fn();
    montar({}, { onCambiosSinGuardar });

    await waitFor(() => expect(onCambiosSinGuardar).toHaveBeenLastCalledWith(false));

    escribir("Ana López", "Ana María López");
    await waitFor(() => expect(onCambiosSinGuardar).toHaveBeenLastCalledWith(true));

    escribir("Ana María López", "Ana López");
    await waitFor(() => expect(onCambiosSinGuardar).toHaveBeenLastCalledWith(false));
  });

  it("cuenta también lo que se cambia sin escribir (la hora, desde la rejilla)", async () => {
    prepararBD();
    const onCambiosSinGuardar = vi.fn();
    montar({}, { onCambiosSinGuardar });

    fireEvent.click(screen.getByRole("button", { name: "elegir 13:00" }));
    await waitFor(() => expect(onCambiosSinGuardar).toHaveBeenLastCalledWith(true));
  });

  it("el alta no avisa de nada (no es edición)", async () => {
    const onCambiosSinGuardar = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <FormularioReserva onCambiosSinGuardar={onCambiosSinGuardar} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await dejarPasarLosRetardos();
    expect(onCambiosSinGuardar).not.toHaveBeenCalledWith(true);
  });
});

describe("FormularioReserva · edición · lista negra, límites y aforo", () => {
  it("cambiar el teléfono a uno de la lista negra marca la reserva y NO toca su estado", async () => {
    mocks.verificarBlacklist.mockResolvedValue({ id: "bl-1", tipo: "telefono", valor: "+34699000111", nombre: "Mal Cliente", motivo: "No vino" });
    const bd = prepararBD();
    montar();

    escribir("+34612345678", "699000111");
    fireEvent.click(await guardar());

    await waitFor(() => expect(bd.update).toHaveBeenCalledTimes(1));
    expect(bd.update.mock.calls[0][0]).toEqual({ telefono: "+34699000111", en_blacklist: true });
    expect(bd.update.mock.calls[0][0]).not.toHaveProperty("estado");
  });

  it("si el contacto no cambia, la marca de lista negra se deja como está", async () => {
    mocks.verificarBlacklist.mockResolvedValue({ id: "bl-1", tipo: "telefono", valor: "+34612345678", nombre: "Ana", motivo: "x" });
    const bd = prepararBD();
    montar({ en_blacklist: false });

    escribir("Ana López", "Otro Nombre");
    fireEvent.click(await guardar());

    await waitFor(() => expect(bd.update).toHaveBeenCalledTimes(1));
    expect(bd.update.mock.calls[0][0]).toEqual({ nombre: "Otro Nombre" });
  });

  it("los límites por teléfono/día no se miran si solo cambia el nombre", async () => {
    mocks.config.max_reservas_por_telefono_dia = 1;
    const bd = prepararBD();
    montar();

    escribir("Ana López", "Otro Nombre");
    fireEvent.click(await guardar());

    await waitFor(() => expect(bd.update).toHaveBeenCalledTimes(1));
    expect(bd.builders.some((b) => b.in.mock.calls.some(([columna]) => columna === "telefono"))).toBe(false);
  });

  it("al cambiar el teléfono sí se miran, y sin contar la propia reserva", async () => {
    mocks.config.max_reservas_por_telefono_dia = 1;
    const bd = prepararBD();
    montar();

    escribir("+34612345678", "699000111");
    fireEvent.click(await guardar());

    await waitFor(() => expect(bd.update).toHaveBeenCalledTimes(1));
    const consultaDeLimites = bd.builders.find((b) => b.in.mock.calls.some(([columna]) => columna === "telefono"))!;
    expect(consultaDeLimites.neq).toHaveBeenCalledWith("id", "res-1");
  });

  it("si otras reservas ya llenan el límite del teléfono ese día, no guarda y lo dice", async () => {
    mocks.config.max_reservas_por_telefono_dia = 1;
    const bd = prepararBD();
    // Las consultas de conteo devuelven count 1 (otra reserva viva del mismo teléfono ese día).
    vi.mocked(supabase.from).mockImplementation(((): unknown => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "neq", "in", "not", "or", "order"]) b[m] = vi.fn(() => b);
      b.update = vi.fn(() => {
        bd.update("NO DEBERÍA LLAMARSE");
        return b;
      });
      b.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], count: 1, error: null }).then(ok);
      return b;
    }) as never);
    montar();

    escribir("+34612345678", "699000111");
    fireEvent.click(await guardar());

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/ya tiene 1 reserva/)));
    expect(bd.update).not.toHaveBeenCalled();
  });

  it("una reserva cancelada no cuenta para los límites: cambiar su teléfono no los consulta", async () => {
    mocks.config.max_reservas_por_telefono_dia = 1;
    const bd = prepararBD();
    montar({ estado: "cancelada" });

    escribir("+34612345678", "699000111");
    fireEvent.click(await guardar());

    await waitFor(() => expect(bd.update).toHaveBeenCalledTimes(1));
    expect(bd.builders.some((b) => b.in.mock.calls.length > 0)).toBe(false);
  });

  it("el aforo previo recibe la reserva ANTERIOR entera (no se cuenta contra sí misma y aplica la regla del UPDATE), solo se mira si cambia día/hora/comensales y NO bloquea", async () => {
    mocks.verificarAforo.mockResolvedValue({ disponible: false, mensaje: "Aforo superado en el turno de comida" });
    const bd = prepararBD();
    montar();

    fireEvent.click(screen.getByRole("button", { name: "elegir 13:00" }));

    await waitFor(() =>
      expect(mocks.verificarAforo).toHaveBeenCalledWith(
        EN_DIEZ_DIAS,
        "13:00",
        4,
        "casa_tomas",
        expect.objectContaining({
          id: "res-1",
          fecha: EN_DIEZ_DIAS,
          hora: "21:00:00",
          numero_comensales: 4,
          estado: "confirmada",
          marca: "casa_tomas",
        }),
      ),
    );
    expect(await screen.findByText(/Aforo superado en el turno de comida/)).toBeInTheDocument();
    // La BD tiene la última palabra: el botón no se deshabilita por el aviso previo.
    const boton = await guardar();
    expect(boton).toBeEnabled();
    fireEvent.click(boton);
    await waitFor(() => expect(bd.update).toHaveBeenCalledTimes(1));
  });

  it("una reserva que no está viva (cancelada) no pasa por el aforo previo al cambiar la hora", async () => {
    prepararBD();
    montar({ estado: "cancelada" });

    fireEvent.click(screen.getByRole("button", { name: "elegir 13:00" }));

    await dejarPasarLosRetardos();
    expect(mocks.verificarAforo).not.toHaveBeenCalled();
  });

  it("si el trigger de aforo rechaza (23514) lo explica y no cierra", async () => {
    prepararBD({ errorUpdate: { code: "23514", message: "Aforo superado para el turno. Capacidad total: 60" } });
    const { onSuccess } = montar();

    fireEvent.click(screen.getByRole("button", { name: "elegir 13:00" }));
    fireEvent.click(await guardar());

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "No hay aforo suficiente en ese turno. Elige otra hora o reduce los comensales.",
      ),
    );
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("si RLS no deja escribir (0 filas, sin error) no dice «guardado»", async () => {
    prepararBD({ filasUpdate: [] });
    const { onSuccess } = montar();

    escribir("Ana López", "Otro Nombre");
    fireEvent.click(await guardar());

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/No tienes permiso para editar esta reserva, o ya no existe/)),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });
});

describe("FormularioReserva · edición · negocio, sala, importante y mesa", () => {
  it("el negocio se ve pero no se cambia (una reserva no salta de negocio: se cancela y se crea otra)", async () => {
    prepararBD();
    montar({ marca: "touza", espacio_id: "reservado" });

    const negocio = screen.getByLabelText("Negocio");
    expect(negocio).toBeDisabled();
    expect(negocio).toHaveValue("Touza · El Reservado");
    expect(screen.getByText(/cancela la reserva y crea otra/i)).toBeInTheDocument();
  });

  it("«Marcar como importante» se guarda como importante: true", async () => {
    const bd = prepararBD();
    montar();

    fireEvent.click(screen.getByRole("checkbox", { name: "Marcar como importante" }));
    fireEvent.click(await guardar());

    await waitFor(() => expect(bd.update).toHaveBeenCalledTimes(1));
    expect(bd.update.mock.calls[0][0]).toEqual({ importante: true });
  });

  it("cambiar de sala guarda espacio_id y nada más", async () => {
    const bd = prepararBD();
    montar();

    fireEvent.click(screen.getByRole("button", { name: /asignación interna \(opcional\)/i }));
    fireEvent.click(await screen.findByRole("button", { name: "elegir terraza" }));
    fireEvent.click(await guardar());

    await waitFor(() => expect(bd.update).toHaveBeenCalledTimes(1));
    expect(bd.update.mock.calls[0][0]).toEqual({ espacio_id: "terraza" });
  });

  it("con mesa asignada, cambiar de turno avisa de que la mesa se mantiene solo si está libre", async () => {
    prepararBD();
    montar({}, { mesasAsignadas: ["Mesa 4"] });

    expect(screen.queryByText(/tiene mesa asignada/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "elegir 13:00" }));

    const aviso = await screen.findByText(/tiene mesa asignada \(Mesa 4\)/);
    expect(aviso.textContent).toMatch(/si está libre/);
    expect(aviso.textContent).toMatch(/pendiente de mesa/);
  });

  it("con mesa asignada, cambiar de sala avisa de que se quitan las mesas", async () => {
    prepararBD();
    montar({}, { mesasAsignadas: ["Mesa 4", "Mesa 5"] });

    fireEvent.click(screen.getByRole("button", { name: /asignación interna \(opcional\)/i }));
    fireEvent.click(await screen.findByRole("button", { name: "elegir terraza" }));

    const aviso = await screen.findByText(/tiene mesa asignada \(Mesa 4, Mesa 5\)/);
    expect(aviso.textContent).toMatch(/se quitan/);
  });

  it("sin mesa asignada, o si solo cambia el nombre, no hay aviso de mesas", async () => {
    prepararBD();
    montar({}, { mesasAsignadas: [] });
    fireEvent.click(screen.getByRole("button", { name: "elegir 13:00" }));
    await waitFor(() => expect(mocks.verificarAforo).toHaveBeenCalled());
    expect(screen.queryByText(/tiene mesa asignada/)).not.toBeInTheDocument();
  });

  it("las rejillas de hora y de salas no cuentan la reserva contra sí misma", async () => {
    prepararBD();
    montar();

    expect(mocks.rejilla).toHaveBeenCalledWith(expect.objectContaining({ excluirReservaId: "res-1" }));
    expect(mocks.cuartos).toHaveBeenCalledWith(expect.objectContaining({ excluirReservaId: "res-1" }));
    fireEvent.click(screen.getByRole("button", { name: /asignación interna \(opcional\)/i }));
    await screen.findByRole("button", { name: "elegir terraza" });
    expect(mocks.salas).toHaveBeenCalledWith(expect.objectContaining({ excluirReservaId: "res-1" }));
  });

  it("una reserva con una sala que ya no está entre las activas no la pierde al abrirla", async () => {
    prepararBD();
    montar({ espacio_id: "sala-desactivada" });

    fireEvent.click(screen.getByRole("button", { name: /asignación interna \(opcional\)/i }));
    // El desplegable sigue mostrando un valor para esa sala (no queda en blanco).
    const trigger = await screen.findByLabelText("Sala");
    expect(trigger).toHaveTextContent(/sala actual/i);
  });
});
