/**
 * Lista unificada de reservas y solicitudes (pestaña "Lista" de /reservas).
 *
 * Cubre lo que pidió el dueño el 2026-09-26 mirando la pantalla:
 *   1. la columna de acciones va la PRIMERA y su cabecera no lleva título;
 *   2. TODAS las filas traen el mismo juego de acciones, en el mismo orden;
 *      lo que no aplica sale deshabilitado en vez de desaparecer (si no, los
 *      botones bailan de sitio al bajar por la lista);
 *   3. cancelar una reserva pide confirmación y, si se descarta el diálogo,
 *      no cancela nada.
 *
 * Y lo que pidió el 2026-09-28: desde la lista se puede "dar mesa", o sea
 * saltar al plano de la sala de ESA reserva, en SU fecha y con ella señalada.
 * Esa ranura es la sexta y obedece la misma regla que las demás: cuando no
 * aplica (reserva sin sala, solicitud del bot) se queda deshabilitada con el
 * porqué en el `title`, nunca desaparece.
 *
 * Lo de "cero scroll horizontal" no se puede comprobar en jsdom (no calcula
 * diseño): eso se mide en el navegador con datos reales.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { format, addDays } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { SolicitudPendiente } from "@/hooks/useSolicitudesPendientes";

const supa = vi.hoisted(() => ({
  update: vi.fn(),
  eq: vi.fn(),
  filas: [] as Record<string, unknown>[],
  // Props con las que se monta el alta al convertir una solicitud.
  formulario: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => ({ order: () => Promise.resolve({ data: supa.filas, error: null }) }),
      }),
      update: (valores: unknown) => {
        supa.update(valores);
        return {
          eq: (col: string, id: string) => {
            supa.eq(col, id);
            return Promise.resolve({ error: null });
          },
        };
      },
    }),
    functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: null }) },
  },
}));

vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: () => ({ canAccess: true, loading: false }),
}));
vi.mock("@/hooks/useEspaciosReserva", () => ({ useEspaciosReserva: () => ({ data: [] }) }));
vi.mock("@/hooks/useVerificacionReservas", () => ({
  aceptarComoSolicitado: vi.fn().mockResolvedValue({ ok: true }),
  aceptarVariasComoSolicitado: vi.fn().mockResolvedValue({ ok: true }),
}));

// Hijos pesados: aquí solo estorban.
vi.mock("@/components/reservas/ModalVerificacionReserva", () => ({ ModalVerificacionReserva: () => null }));
vi.mock("@/components/reservas/BlacklistModal", () => ({ BlacklistModal: () => null }));
vi.mock("@/components/reservas/SolicitudGestionPanel", () => ({ SolicitudGestionPanel: () => null }));
vi.mock("@/components/reservas/FormularioReserva", () => ({
  FormularioReserva: (props: unknown) => {
    supa.formulario(props);
    return null;
  },
  CLAVES_REFRESCO_RESERVAS: ["reservas-lista"],
}));
vi.mock("@/components/reservas/GestionSolicitudes", () => ({
  SolicitudCard: () => null,
  MOTIVO_LABELS: {
    grupo_grande: { label: "Grupo grande", color: "" },
    otro: { label: "Otro", color: "" },
  },
  ESTADO_LABELS: {
    pendiente: { label: "Pendiente" },
    contactado: { label: "Contactado" },
    resuelta: { label: "Resuelta" },
    descartada: { label: "Descartada" },
  },
}));

import { ListaReservasAvanzada } from "@/components/reservas/ListaReservasAvanzada";

const HOY = format(new Date(), "yyyy-MM-dd");
const MANANA = format(addDays(new Date(), 1), "yyyy-MM-dd");

/** `espacioId` = sala ya repartida; `null` = todavía sin sala (lo normal). */
const reserva = (id: string, estado: string, nombre: string, espacioId: string | null = null) => ({
  id,
  nombre,
  telefono: "+34 600 111 222",
  email: null,
  fecha: HOY,
  hora: "21:30:00",
  numero_comensales: 4,
  estado,
  canal: "telefono",
  notas_cliente: null,
  espacio_id: espacioId,
  importante: false,
  en_blacklist: false,
});

const solicitud: SolicitudPendiente = {
  id: "sol-1",
  nombre: "Familia Ballester",
  telefono: "+34 655 481 209",
  email: null,
  fecha_solicitada: MANANA,
  hora_solicitada: "14:00",
  numero_comensales: 12,
  notas_cliente: null,
  motivo_rechazo: "grupo_grande",
  descripcion_rechazo: null,
  estado: "pendiente",
  notas_internas: null,
  created_at: null,
  updated_at: null,
  espacio_propuesto_id: null,
  propuesta_estado: "borrador",
} as SolicitudPendiente;

const estadoSolicitudes = {
  solicitudes: [solicitud],
  loading: false,
  countPendientes: 1,
  fetchSolicitudes: vi.fn(),
  updateEstado: vi.fn().mockResolvedValue(true),
  updateNotasInternas: vi.fn().mockResolvedValue(true),
  updatePropuesta: vi.fn().mockResolvedValue(true),
  enviarPropuesta: vi.fn().mockResolvedValue(true),
  aceptarPropuestaTelefono: vi.fn().mockResolvedValue({ ok: true }),
  rechazarPropuestaTelefono: vi.fn().mockResolvedValue({ ok: true }),
  marcarConvertida: vi.fn().mockResolvedValue(true),
} as unknown as Parameters<typeof ListaReservasAvanzada>[0]["solicitudesState"];

async function montar(props: Partial<Parameters<typeof ListaReservasAvanzada>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const vista = render(
    <QueryClientProvider client={client}>
      <ListaReservasAvanzada solicitudesState={estadoSolicitudes} {...props} />
    </QueryClientProvider>,
  );
  // En jsdom NO hay media queries, así que se montan a la vez la tabla y las
  // tarjetas de móvil. Todo lo que se mire aquí va acotado a la tabla.
  const tabla = await waitFor(() => {
    const t = vista.container.querySelector("table");
    if (!t || !t.querySelector("tbody tr td")) throw new Error("tabla sin filas todavía");
    return t;
  });
  return { ...vista, tabla };
}

/** Botones de la celda de acciones de una fila, en orden de pantalla. */
const botonesDeFila = (fila: HTMLElement) =>
  [...fila.querySelector("td")!.querySelectorAll("button")].filter((b) => b.getAttribute("role") !== "checkbox");

/** Etiquetas de los botones de la celda de acciones de una fila. */
const accionesDeFila = (fila: HTMLElement) =>
  botonesDeFila(fila).map((b) => ({
    etiqueta: b.getAttribute("aria-label") ?? b.textContent?.trim() ?? "",
    deshabilitado: b.hasAttribute("disabled"),
  }));

/** Fila de la tabla que habla de ese cliente. */
const filaDe = (tabla: HTMLElement, texto: string) =>
  ([...tabla.querySelectorAll("tbody tr")] as HTMLElement[]).find((f) => f.textContent?.includes(texto))!;

beforeEach(() => {
  vi.clearAllMocks();
  supa.filas = [
    reserva("res-pendiente", "pendiente", "Ana Pendiente"),
    reserva("res-verificada", "verificada", "Berta Verificada"),
    reserva("res-confirmada", "confirmada", "Carlos Confirmado"),
    reserva("res-cancelada", "cancelada", "Diana Cancelada"),
    // Única con sala repartida: es la que puede saltar al plano.
    reserva("res-con-sala", "confirmada", "Elena ConSala", "esp-comedor"),
  ];
});

describe("ListaReservasAvanzada · columna de acciones", () => {
  it("va la primera, antes de «Fecha y hora», y su cabecera no lleva título", async () => {
    const { tabla } = await montar();
    const cabeceras = [...tabla.querySelectorAll("thead th")];
    expect(cabeceras[0].textContent?.trim()).toBe("");
    expect(cabeceras[1].textContent).toContain("Fecha");
    // Y no hay ninguna columna rotulada "Acciones".
    expect(cabeceras.some((th) => th.textContent?.includes("Acciones"))).toBe(false);
  });

  it("pinta el MISMO juego de acciones, en el mismo orden, en todas las filas", async () => {
    const { tabla } = await montar();
    const filas = [...tabla.querySelectorAll("tbody tr")] as HTMLElement[];
    expect(filas.length).toBe(6); // 5 reservas + 1 solicitud

    const cuantas = filas.map((f) => accionesDeFila(f).length);
    expect(new Set(cuantas).size).toBe(1);
    expect(cuantas[0]).toBe(6);

    // El orden es siempre el mismo: principal, "dar mesa", "Verificar",
    // "Gestionar", "Cancelar" y "lista negra".
    for (const fila of filas) {
      const acciones = accionesDeFila(fila);
      expect(acciones[1].etiqueta).toMatch(/mesa/i);
      expect(acciones[2].etiqueta).toMatch(/^Verificar/);
      expect(acciones[3].etiqueta).toMatch(/^Gestionar/);
      expect(acciones[4].etiqueta).toMatch(/cancelada|Cancelar|permiso|Descartar/i);
      expect(acciones[5].etiqueta).toMatch(/lista negra/i);
    }
  });

  it("lo que no aplica a una fila sale deshabilitado, no se quita", async () => {
    const { tabla } = await montar({ onAsignarMesa: vi.fn() });
    const porNombre = (texto: string) => filaDe(tabla, texto);

    // Reserva pendiente: puede aceptarse y verificarse; no se gestiona, y sin
    // sala tampoco se le puede dar mesa todavía.
    const pendiente = accionesDeFila(porNombre("Ana Pendiente"));
    expect(pendiente[0].etiqueta).toBe("Aceptar");
    expect(pendiente[0].deshabilitado).toBe(false);
    expect(pendiente[1].deshabilitado).toBe(true); // dar mesa (todavía sin sala)
    expect(pendiente[2].deshabilitado).toBe(false); // verificar
    expect(pendiente[3].deshabilitado).toBe(true); // gestionar (solo solicitudes)

    // Verificada: la principal pasa a "Confirmar" y ya no se verifica.
    const verificada = accionesDeFila(porNombre("Berta Verificada"));
    expect(verificada[0].etiqueta).toBe("Confirmar");
    expect(verificada[0].deshabilitado).toBe(false);
    expect(verificada[2].deshabilitado).toBe(true);

    // Confirmada: no hay nada que aceptar ni confirmar, pero el botón sigue ahí.
    const confirmada = accionesDeFila(porNombre("Carlos Confirmado"));
    expect(confirmada[0].deshabilitado).toBe(true);
    expect(confirmada[4].deshabilitado).toBe(false); // cancelar sí

    // Cancelada: tampoco se vuelve a cancelar.
    const cancelada = accionesDeFila(porNombre("Diana Cancelada"));
    expect(cancelada[4].deshabilitado).toBe(true);

    // Con sala: la única que puede saltar al plano a por su mesa.
    const conSala = accionesDeFila(porNombre("Elena ConSala"));
    expect(conSala[1].deshabilitado).toBe(false);

    // Solicitud del bot: su acción principal es "Convertir" y se gestiona,
    // pero no se le da mesa, ni se verifica, ni se cancela, ni se mete en la
    // lista negra.
    const sol = accionesDeFila(porNombre("Familia Ballester"));
    expect(sol[0].etiqueta).toBe("Convertir");
    expect(sol[0].deshabilitado).toBe(false);
    expect(sol[1].deshabilitado).toBe(true);
    expect(sol[2].deshabilitado).toBe(true);
    expect(sol[3].deshabilitado).toBe(false);
    expect(sol[4].deshabilitado).toBe(true);
    expect(sol[5].deshabilitado).toBe(true);
  });
});

describe("ListaReservasAvanzada · «Dar mesa» salta al plano de su sala", () => {
  /** La ranura "dar mesa" es la segunda: principal · DAR MESA · verificar… */
  const botonDarMesa = (tabla: HTMLElement, cliente: string) => botonesDeFila(filaDe(tabla, cliente))[1];

  it("con sala y fecha: abre el plano de ESA sala, en SU día y con ella señalada", async () => {
    const onAsignarMesa = vi.fn();
    const { tabla } = await montar({ onAsignarMesa });
    const boton = botonDarMesa(tabla, "Elena ConSala");

    expect(boton.hasAttribute("disabled")).toBe(false);
    expect(boton.getAttribute("aria-label")).toMatch(/darle mesa/i);
    // "Con sala pero sin mesa" es trabajo pendiente normal, no un error: este
    // botón NUNCA se pinta como destructivo (petición del dueño).
    expect(boton.className).not.toMatch(/destructive/);

    fireEvent.click(boton);
    expect(onAsignarMesa).toHaveBeenCalledTimes(1);
    expect(onAsignarMesa).toHaveBeenCalledWith({
      espacioId: "esp-comedor",
      fecha: HOY,
      reservaId: "res-con-sala",
      // La fixture es de las 21:30, así que el destino manda al plano al turno
      // de CENA. Sin esto el plano abriría en el turno del reloj y la reserva
      // no saldría en su panel.
      turno: "cena",
    });
  });

  it("sin sala: el botón NO desaparece, se queda deshabilitado y dice qué falta", async () => {
    const onAsignarMesa = vi.fn();
    const { tabla } = await montar({ onAsignarMesa });
    const boton = botonDarMesa(tabla, "Ana Pendiente");

    expect(boton).toBeInTheDocument();
    expect(boton.hasAttribute("disabled")).toBe(true);
    // El motivo lo escribe el módulo compartido con la pestaña Hoy: primero
    // hay que darle sala, y se hace desde «Gestionar».
    const titulo = boton.getAttribute("aria-label") ?? "";
    expect(titulo).toMatch(/sala/i);
    expect(titulo).toMatch(/Gestionar/);
    // El `title` va también en el botón para que se vea al pasar por encima.
    expect(boton.getAttribute("title")).toBe(titulo);

    fireEvent.click(boton);
    expect(onAsignarMesa).not.toHaveBeenCalled();
  });

  it("una solicitud del bot tiene el botón, deshabilitado: todavía no es una reserva", async () => {
    const onAsignarMesa = vi.fn();
    const { tabla } = await montar({ onAsignarMesa });
    const boton = botonDarMesa(tabla, "Familia Ballester");

    expect(boton).toBeInTheDocument();
    expect(boton.hasAttribute("disabled")).toBe(true);
    expect(boton.getAttribute("aria-label")).toMatch(/todavía no es una reserva/i);

    fireEvent.click(boton);
    expect(onAsignarMesa).not.toHaveBeenCalled();
  });

  it("una fila de solicitud tiene EXACTAMENTE los mismos botones que una de reserva", async () => {
    const { tabla } = await montar({ onAsignarMesa: vi.fn() });
    const reservaConSala = botonesDeFila(filaDe(tabla, "Elena ConSala"));
    const solicitudBot = botonesDeFila(filaDe(tabla, "Familia Ballester"));

    expect(solicitudBot.length).toBe(reservaConSala.length);
    expect(solicitudBot.length).toBe(6);
  });
});

describe("ListaReservasAvanzada · cancelar pide confirmación", () => {
  const abrirCancelacion = async () => {
    const { tabla } = await montar();
    // Quinta ranura: principal · dar mesa · verificar · gestionar · CANCELAR.
    fireEvent.click(accionesBotones(filaDe(tabla, "Ana Pendiente"))[4]);
    return await screen.findByRole("alertdialog");
  };
  const accionesBotones = botonesDeFila;

  it("no cancela al primer clic: abre un diálogo que dice qué reserva es", async () => {
    const dialogo = await abrirCancelacion();
    expect(within(dialogo).getByText(/¿Cancelar la reserva de Ana Pendiente\?/)).toBeInTheDocument();
    // Día y hora, para no cancelar la de al lado.
    expect(dialogo.textContent).toContain("21:30");
    expect(dialogo.textContent).toContain("4 comensales");
    expect(supa.update).not.toHaveBeenCalled();
  });

  it("si se descarta el diálogo, la reserva NO se cancela", async () => {
    const dialogo = await abrirCancelacion();
    fireEvent.click(within(dialogo).getByRole("button", { name: "No, volver" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(supa.update).not.toHaveBeenCalled();
    expect(supa.eq).not.toHaveBeenCalled();
  });

  it("solo al confirmar se cancela, y solo esa reserva", async () => {
    const dialogo = await abrirCancelacion();
    fireEvent.click(within(dialogo).getByRole("button", { name: /^Sí, cancelar/ }));
    await waitFor(() => expect(supa.update).toHaveBeenCalledWith({ estado: "cancelada" }));
    expect(supa.eq).toHaveBeenCalledWith("id", "res-pendiente");
    expect(supa.update).toHaveBeenCalledTimes(1);
  });
});

// El alta manual ya no exige email (2026-09-30): una reserva 'verificada' sin
// email solo llega a 'confirmada' con el botón «Confirmar» de la lista, y ese
// cambio no manda ningún correo. El aviso tiene que decirlo.
describe("ListaReservasAvanzada · reservas sin email", () => {
  /** El principal de la fila de "Berta Verificada" es «Confirmar». */
  const confirmarVerificada = async () => {
    const { tabla } = await montar();
    const [confirmar] = botonesDeFila(filaDe(tabla, "Berta Verificada"));
    expect(confirmar.textContent).toMatch(/Confirmar/);
    fireEvent.click(confirmar);
  };

  it("«Confirmar» una verificada sin email cambia el estado y avisa de que no sale ningún correo", async () => {
    await confirmarVerificada();

    await waitFor(() => expect(supa.update).toHaveBeenCalledWith({ estado: "confirmada" }));
    expect(supa.eq).toHaveBeenCalledWith("id", "res-verificada");
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Estado actualizado correctamente", {
        description: "Sin email: no se envía ningún correo al cliente.",
      }),
    );
  });

  it("con email el aviso es el de siempre (sin la advertencia)", async () => {
    supa.filas = [{ ...reserva("res-verificada", "verificada", "Berta Verificada"), email: "berta@ejemplo.com" }];
    await confirmarVerificada();

    await waitFor(() => expect(supa.update).toHaveBeenCalledWith({ estado: "confirmada" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(vi.mocked(toast.success).mock.calls.at(-1)).toEqual(["Estado actualizado correctamente"]);
    // Y se sigue avisando a notify-reservation-change, que es quien manda el correo.
    expect(supabase.functions.invoke).toHaveBeenCalledWith(
      "notify-reservation-change",
      expect.objectContaining({ body: expect.objectContaining({ id: "res-verificada", estado: "confirmada" }) }),
    );
  });

  it("email en blanco cuenta como sin email", async () => {
    supa.filas = [{ ...reserva("res-verificada", "verificada", "Berta Verificada"), email: "   " }];
    await confirmarVerificada();

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Estado actualizado correctamente", {
        description: "Sin email: no se envía ningún correo al cliente.",
      }),
    );
  });
});

describe("ListaReservasAvanzada · convertir una solicitud respeta su marca", () => {
  it("usa la marca GUARDADA en la solicitud, no la deduce de la sala", async () => {
    // Solicitud de Touza sin sala propuesta ni marcador en las notas: antes se
    // deducía Casa Tomás. Ahora manda la columna solicitudes_pendientes.marca.
    const deTouza = { ...solicitud, marca: "touza" } as SolicitudPendiente;
    const { tabla } = await montar({
      solicitudesState: { ...estadoSolicitudes, solicitudes: [deTouza] } as typeof estadoSolicitudes,
    });
    const fila = filaDe(tabla, "Familia Ballester");
    fireEvent.click(botonesDeFila(fila)[0]);

    await waitFor(() => expect(supa.formulario).toHaveBeenCalled());
    const props = supa.formulario.mock.calls.at(-1)![0] as { datosPreseleccionados: { marca: string } };
    expect(props.datosPreseleccionados.marca).toBe("touza");
  });
});
