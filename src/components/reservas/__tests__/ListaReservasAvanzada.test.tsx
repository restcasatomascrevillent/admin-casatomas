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
 * Y lo que pidió el 2026-09-30: toda reserva se puede EDITAR, en cualquier
 * estado, fecha y canal. No hay una séptima ranura: la cuarta —«Gestionar», que
 * en una reserva estaba siempre deshabilitada— es el editor de las reservas (en
 * las solicitudes sigue siendo «Gestionar»). Se comprueba al final del fichero.
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
import { ESTADOS_RESERVA, type EstadoReserva } from "@/lib/reservas/estadosReserva";

const supa = vi.hoisted(() => ({
  // La escritura del ejecutor de acciones es `update(…).eq("id", …)[.in("estado", …)].select("id")`.
  update: vi.fn(),
  eq: vi.fn(),
  en: vi.fn(),
  select: vi.fn(),
  /** Cada vez que la lista pide las reservas (`select` de la consulta de la lista, no el de una escritura). */
  cargas: vi.fn(),
  /** Respuestas de las siguientes escrituras (sin más: éxito con la fila de ESA reserva). */
  respuestas: [] as Array<{ data?: unknown; error?: unknown }>,
  filas: [] as Record<string, unknown>[],
  // Props con las que se monta el alta al convertir una solicitud.
  formulario: vi.fn(),
  // Permiso de edición de la sección «reservas» y el editor que abre la ranura de editar.
  canEdit: true,
  editarReserva: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => {
        supa.cargas();
        return {
          order: () => ({ order: () => Promise.resolve({ data: supa.filas, error: null }) }),
        };
      },
      update: (valores: unknown) => {
        supa.update(valores);
        let id: unknown;
        const b: Record<string, unknown> = {
          eq: (col: string, valor: string) => {
            supa.eq(col, valor);
            id = valor;
            return b;
          },
          in: (col: string, valores: unknown[]) => {
            supa.en(col, valores);
            return b;
          },
          select: (columnas: string) => {
            supa.select(columnas);
            return b;
          },
          then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
            const r = supa.respuestas.shift() ?? {};
            const data = "data" in r ? r.data : r.error ? null : [{ id }];
            return Promise.resolve({ data, error: r.error ?? null }).then(ok, ko);
          },
        };
        return b;
      },
    }),
    functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: null }) },
  },
}));

vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: () => ({ canAccess: supa.canEdit, loading: false }),
}));
vi.mock("@/hooks/useEspaciosReserva", () => ({ useEspaciosReserva: () => ({ data: [] }) }));

// Hijos pesados: aquí solo estorban.
vi.mock("@/hooks/useEdicionReserva", () => ({
  useEdicionReserva: () => ({ editarReserva: supa.editarReserva, dialogoEdicion: null }),
}));
vi.mock("@/components/reservas/ModalVerificacionReserva", () => ({ ModalVerificacionReserva: () => null }));
vi.mock("@/components/reservas/BlacklistModal", () => ({ BlacklistModal: () => null }));
vi.mock("@/components/reservas/SolicitudGestionPanel", () => ({ SolicitudGestionPanel: () => null }));
vi.mock("@/components/reservas/FormularioReserva", () => ({
  FormularioReserva: (props: unknown) => {
    supa.formulario(props);
    return null;
  },
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
  supa.respuestas = [];
  supa.canEdit = true;
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
    // "Gestionar" (en una reserva, el editor), "Cancelar" y "lista negra".
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

    // Reserva pendiente: puede aceptarse, verificarse y editarse; sin sala
    // tampoco se le puede dar mesa todavía.
    const pendiente = accionesDeFila(porNombre("Ana Pendiente"));
    expect(pendiente[0].etiqueta).toBe("Aceptar");
    expect(pendiente[0].deshabilitado).toBe(false);
    expect(pendiente[1].deshabilitado).toBe(true); // dar mesa (todavía sin sala)
    expect(pendiente[2].deshabilitado).toBe(false); // verificar
    expect(pendiente[3].deshabilitado).toBe(false); // editar (siempre, en cualquier estado)

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

// Toda reserva se puede EDITAR (2026-09-30): en cualquier estado, con cualquier
// fecha y de cualquier canal. La ranura es la cuarta: principal · dar mesa ·
// verificar · EDITAR · cancelar · lista negra. En una reserva antes era
// «Gestionar», siempre deshabilitada; ahora es el editor (con lápiz), y su texto
// sigue empezando por «Gestionar». En una solicitud sigue siendo «Gestionar».
describe("ListaReservasAvanzada · editar una reserva, siempre", () => {
  const botonEditar = (tabla: HTMLElement, cliente: string) => botonesDeFila(filaDe(tabla, cliente))[3];

  it("la ranura de editar existe y está activa en las reservas de CUALQUIER estado", async () => {
    supa.filas = [
      reserva("res-pendiente", "pendiente", "Ana Pendiente"),
      reserva("res-verificada", "verificada", "Berta Verificada"),
      reserva("res-confirmada", "confirmada", "Carlos Confirmado"),
      reserva("res-cancelada", "cancelada", "Diana Cancelada"),
      reserva("res-llego", "completada", "Elena Llegó"),
      reserva("res-no-vino", "no_show", "Fede NoVino"),
    ];
    const { tabla } = await montar();

    for (const [cliente, id] of [
      ["Ana Pendiente", "res-pendiente"],
      ["Berta Verificada", "res-verificada"],
      ["Carlos Confirmado", "res-confirmada"],
      ["Diana Cancelada", "res-cancelada"],
      ["Elena Llegó", "res-llego"],
      ["Fede NoVino", "res-no-vino"],
    ]) {
      const boton = botonEditar(tabla, cliente);
      expect(boton.getAttribute("aria-label")).toMatch(new RegExp(`^Gestionar: editar la reserva de ${cliente}`));
      expect(boton.hasAttribute("disabled")).toBe(false);
      // Es un botón normal, no uno destructivo, y lleva el lápiz (no el engranaje de «Gestionar» de las solicitudes).
      expect(boton.className).not.toMatch(/destructive/);
      expect(boton.querySelector("svg")?.getAttribute("class")).toMatch(/square-pen/);

      supa.editarReserva.mockClear();
      fireEvent.click(boton);
      expect(supa.editarReserva).toHaveBeenCalledTimes(1);
      expect(supa.editarReserva).toHaveBeenCalledWith(id);
    }
  });

  it("también las de un día que ya pasó y las de cualquier canal", async () => {
    supa.filas = [
      { ...reserva("res-vieja-web", "completada", "Gema Antigua"), fecha: "2020-01-15", canal: "web" },
      { ...reserva("res-vieja-manual", "no_show", "Hugo Antiguo"), fecha: "2021-06-01", canal: "manual" },
      { ...reserva("res-sin-canal", "confirmada", "Inés SinCanal"), canal: null },
    ];
    const { tabla } = await montar();

    for (const [cliente, id] of [
      ["Gema Antigua", "res-vieja-web"],
      ["Hugo Antiguo", "res-vieja-manual"],
      ["Inés SinCanal", "res-sin-canal"],
    ]) {
      const boton = botonEditar(tabla, cliente);
      expect(boton.hasAttribute("disabled")).toBe(false);
      fireEvent.click(boton);
      expect(supa.editarReserva).toHaveBeenLastCalledWith(id);
    }
  });

  it("una reserva sin nombre (la BD lo permite) se puede editar igual", async () => {
    supa.filas = [{ ...reserva("res-anonima", "confirmada", ""), nombre: null }];
    const { tabla } = await montar();

    // (Las solicitudes abiertas van primero: la fila de la reserva se busca por su texto.)
    const boton = botonEditar(tabla, "Sin nombre");
    expect(boton.getAttribute("aria-label")).toMatch(/^Gestionar: editar la reserva de este cliente/);
    expect(boton.hasAttribute("disabled")).toBe(false);
  });

  it("la ranura sigue en su sitio: cada fila (reservas y solicitud) mantiene sus seis botones", async () => {
    const { tabla } = await montar();
    const filas = [...tabla.querySelectorAll("tbody tr")] as HTMLElement[];

    expect(filas.length).toBe(6);
    for (const fila of filas) expect(botonesDeFila(fila).length).toBe(6);
  });

  it("en una solicitud del bot la cuarta ranura sigue siendo «Gestionar» y no abre el editor de reservas", async () => {
    const { tabla } = await montar();
    const gestionar = botonEditar(tabla, "Familia Ballester");

    expect(gestionar.getAttribute("aria-label")).toMatch(/^Gestionar/);
    fireEvent.click(gestionar);
    expect(supa.editarReserva).not.toHaveBeenCalled();
  });

  it("en las tarjetas de móvil también está: mismo botón, mismo editor", async () => {
    await montar();

    // jsdom monta a la vez la tabla y las tarjetas: el mismo nombre sale dos veces.
    const botones = screen.getAllByRole("button", { name: /^Gestionar: editar la reserva de Diana Cancelada/ });
    expect(botones).toHaveLength(2);
    const enTarjeta = botones.find((b) => !b.closest("table"))!;
    expect(enTarjeta.hasAttribute("disabled")).toBe(false);
    fireEvent.click(enTarjeta);
    expect(supa.editarReserva).toHaveBeenCalledWith("res-cancelada");
  });

  it("sin permiso de edición sobre «reservas» el botón se queda, deshabilitado y explicándolo", async () => {
    supa.canEdit = false;
    const { tabla } = await montar();
    const boton = botonEditar(tabla, "Ana Pendiente");

    expect(boton).toBeInTheDocument();
    expect(boton.hasAttribute("disabled")).toBe(true);
    expect(boton.getAttribute("aria-label")).toMatch(/No tienes permiso para editar reservas/);
    fireEvent.click(boton);
    expect(supa.editarReserva).not.toHaveBeenCalled();
  });
});

// Desde el paso 2 del refactor de acciones, TODO lo que cambia una reserva desde la lista
// (Aceptar de un clic, aceptar en bloque, Confirmar, Cancelar y la estrella) pasa por el
// ejecutor único (`useAccionesServicioReserva`): pide la fila de vuelta, condiciona la
// escritura al estado de partida y avisa al cliente con la respuesta comprobada. La lista
// sigue siendo la vista de GESTIÓN (no cambia qué botones tiene cada fila).
describe("ListaReservasAvanzada · las acciones pasan por el ejecutor único", () => {
  const botones = (tabla: HTMLElement, cliente: string) => botonesDeFila(filaDe(tabla, cliente));
  const notificaciones = () =>
    vi
      .mocked(supabase.functions.invoke)
      .mock.calls.map(([funcion, opciones]) => ({ funcion, body: (opciones as { body: unknown }).body }));
  const casilla = (tabla: HTMLElement, cliente: string) =>
    within(filaDe(tabla, cliente)).getByRole("checkbox", { name: "Seleccionar para aceptar en bloque" });

  it("«Aceptar»: verifica la reserva TAL COMO ESTÁ (solo el estado), SOLO si sigue pendiente, y avisa al cliente con lo escrito", async () => {
    // cambio acordado con el dueño (2026-10-01): antes el UPDATE llevaba también `hora` y `espacio_id` (los pedidos).
    const { tabla } = await montar();

    fireEvent.click(botones(tabla, "Ana Pendiente")[0]);

    await waitFor(() => expect(supa.update).toHaveBeenCalledWith({ estado: "verificada" }));
    expect(supa.eq).toHaveBeenCalledWith("id", "res-pendiente");
    expect(supa.en).toHaveBeenCalledWith("estado", ["pendiente"]);
    expect(supa.select).toHaveBeenCalledWith("id");
    await waitFor(() =>
      expect(notificaciones()).toEqual([
        {
          funcion: "notify-reservation-change",
          body: { id: "res-pendiente", estado: "verificada" },
        },
      ]),
    );
    expect(toast.success).toHaveBeenCalledWith("Reserva verificada para las 21:30", {
      description: "No tiene correo: hay que avisarle por teléfono",
    });
  });

  it("«Aceptar» con la sala que ya repartió el personal (Casa Tomás: el cliente no pidió sala): NO la toca, así que el trigger de la BD no borra ni sala ni mesas", async () => {
    // cambio acordado con el dueño (2026-10-01). Antes escribía `espacio_id = espacio_solicitado_id` (null aquí).
    supa.filas = [
      { ...reserva("res-sala", "pendiente", "Ana ConSala", "esp-comedor"), hora_solicitada: "21:30:00", espacio_solicitado_id: null },
    ];
    const { tabla } = await montar();

    fireEvent.click(botones(tabla, "Ana ConSala")[0]);

    await waitFor(() => expect(supa.update).toHaveBeenCalledTimes(1));
    expect(supa.update).toHaveBeenCalledWith({ estado: "verificada" });
    expect(supa.update.mock.calls[0][0]).not.toHaveProperty("espacio_id");
  });

  it("«Aceptar» con la hora EDITADA por el personal: no la revierte (el UPDATE no lleva `hora`) y el aviso dice la hora actual", async () => {
    // cambio acordado con el dueño (2026-10-01). Antes reescribía la hora con la que pidió el cliente (21:30).
    supa.filas = [
      { ...reserva("res-editada", "pendiente", "Ana Editada"), hora: "22:00:00", hora_solicitada: "21:30:00", espacio_solicitado_id: null },
    ];
    const { tabla } = await montar();

    fireEvent.click(botones(tabla, "Ana Editada")[0]);

    await waitFor(() => expect(supa.update).toHaveBeenCalledTimes(1));
    expect(supa.update).toHaveBeenCalledWith({ estado: "verificada" });
    expect(supa.update.mock.calls[0][0]).not.toHaveProperty("hora");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Reserva verificada para las 22:00", expect.anything()));
  });

  it("CORREGIDO: «Aceptar» con la RLS denegando la escritura (0 filas) NO da «verificada» ni avisa al cliente", async () => {
    supa.respuestas = [{ data: [] }];
    const { tabla } = await montar();

    fireEvent.click(botones(tabla, "Ana Pendiente")[0]);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/^No se pudo guardar: no tienes permiso/)),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it("«Confirmar» (verificada) escribe solo si sigue verificada y avisa al cliente con `{ id, estado }` (antes, la fila entera de la reserva)", async () => {
    const { tabla } = await montar();

    fireEvent.click(botones(tabla, "Berta Verificada")[0]);

    await waitFor(() => expect(supa.en).toHaveBeenCalledWith("estado", ["verificada"]));
    await waitFor(() => expect(notificaciones()).toHaveLength(1));
    expect(notificaciones()[0]).toEqual({
      funcion: "notify-reservation-change",
      body: { id: "res-verificada", estado: "confirmada" },
    });
  });

  it("cancelar solo parte de un estado VIVO (la escritura va condicionada) y avisa al cliente con `{ id, estado }`", async () => {
    const { tabla } = await montar();

    fireEvent.click(botones(tabla, "Carlos Confirmado")[4]);
    const dialogo = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialogo).getByRole("button", { name: /^Sí, cancelar/ }));

    await waitFor(() => expect(supa.en).toHaveBeenCalledWith("estado", ["pendiente", "verificada", "confirmada"]));
    await waitFor(() => expect(notificaciones()).toHaveLength(1));
    expect(notificaciones()[0].body).toEqual({ id: "res-confirmada", estado: "cancelada" });
  });

  it("CORREGIDO (decisión del dueño): una reserva «Llegó» o «No vino» ya no se puede cancelar: el botón sale deshabilitado con el motivo", async () => {
    // Antes solo quedaba deshabilitado el de una cancelada; podía cancelarse una «Llegó» o una «No vino».
    supa.filas = [
      reserva("res-llego", "completada", "Elena Llegó"),
      reserva("res-no-vino", "no_show", "Fede NoVino"),
      reserva("res-cancelada", "cancelada", "Diana Cancelada"),
      reserva("res-confirmada", "confirmada", "Carlos Confirmado"),
    ];
    const { tabla } = await montar();
    const cancelar = (cliente: string) => botones(tabla, cliente)[4];

    expect(cancelar("Elena Llegó").hasAttribute("disabled")).toBe(true);
    expect(cancelar("Elena Llegó").getAttribute("aria-label")).toBe("No se puede cancelar una reserva que ya llegó");
    expect(cancelar("Fede NoVino").hasAttribute("disabled")).toBe(true);
    expect(cancelar("Fede NoVino").getAttribute("aria-label")).toBe("No se puede cancelar una reserva marcada como «No vino»");
    expect(cancelar("Diana Cancelada").hasAttribute("disabled")).toBe(true);
    expect(cancelar("Diana Cancelada").getAttribute("aria-label")).toBe("La reserva ya está cancelada");
    // Y una viva sigue pudiéndose cancelar.
    expect(cancelar("Carlos Confirmado").hasAttribute("disabled")).toBe(false);
    expect(cancelar("Carlos Confirmado").getAttribute("aria-label")).toMatch(/^Cancelar la reserva de Carlos Confirmado/);
  });

  it("la estrella: escribe `{ importante: true }` pidiendo la fila de vuelta y sin condición de estado, y avisa", async () => {
    const { tabla } = await montar();

    fireEvent.click(within(filaDe(tabla, "Ana Pendiente")).getByRole("button", { name: "Marcar Ana Pendiente como importante" }));

    await waitFor(() => expect(supa.update).toHaveBeenCalledWith({ importante: true }));
    expect(supa.eq).toHaveBeenCalledWith("id", "res-pendiente");
    expect(supa.select).toHaveBeenCalledWith("id");
    expect(supa.en).not.toHaveBeenCalled();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Reserva marcada como importante"));
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it("CORREGIDO: la estrella con la RLS denegando la escritura NO da «marcada como importante»", async () => {
    supa.respuestas = [{ data: [] }];
    const { tabla } = await montar();

    fireEvent.click(within(filaDe(tabla, "Ana Pendiente")).getByRole("button", { name: "Marcar Ana Pendiente como importante" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "No se pudo actualizar la reserva: no tienes permiso para cambiar esta reserva, o ya no existe.",
      ),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  /** Dos pendientes seleccionadas y el «Sí, aceptar» del diálogo de aceptar en bloque. */
  async function aceptarEnBloqueDosPendientes() {
    supa.filas = [
      reserva("res-a", "pendiente", "Ana Pendiente"),
      reserva("res-b", "pendiente", "Berta Pendiente"),
      reserva("res-c", "confirmada", "Carlos Confirmado"),
    ];
    const { tabla } = await montar();
    fireEvent.click(casilla(tabla, "Ana Pendiente"));
    fireEvent.click(casilla(tabla, "Berta Pendiente"));
    // Cambio acordado (2026-10-01): se aceptan TAL COMO ESTÁN; antes decía «con la hora que pidieron».
    fireEvent.click(screen.getByRole("button", { name: /Verificar tal como están/ }));
    const dialogo = await screen.findByRole("alertdialog");
    expect(dialogo.textContent).toMatch(/¿Verificar 2 reservas tal como están\?/);
    expect(dialogo.textContent).not.toMatch(/pidi(ó|eron)/);
    fireEvent.click(within(dialogo).getByRole("button", { name: /^Sí, aceptar las reservas/ }));
  }

  it("aceptar en bloque: una escritura y un aviso al cliente por reserva, UN resumen, y se vacía la selección", async () => {
    await aceptarEnBloqueDosPendientes();

    await waitFor(() => expect(supa.update).toHaveBeenCalledTimes(2));
    expect(supa.eq.mock.calls.map(([, id]) => id).sort()).toEqual(["res-a", "res-b"]);
    // cambio acordado con el dueño (2026-10-01): cada una se acepta TAL COMO ESTÁ (solo el estado), sin tocar hora ni sala.
    expect(supa.update.mock.calls.map(([valores]) => valores)).toEqual([{ estado: "verificada" }, { estado: "verificada" }]);
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalledWith("2 solicitudes verificadas", {
      description: "2 sin correo: hay que avisarles por teléfono",
    });
    await waitFor(() => expect(notificaciones()).toHaveLength(2));
    // La selección se vacía al terminar: la barra de acción en bloque desaparece.
    await waitFor(() => expect(screen.queryByText(/solicitudes seleccionadas/)).not.toBeInTheDocument());
  });

  it("CORREGIDO: aceptar en bloque con la RLS denegando todo no cuenta ninguna como verificada ni avisa a los clientes", async () => {
    supa.respuestas = [{ data: [] }, { data: [] }];
    await aceptarEnBloqueDosPendientes();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("2 solicitudes sin verificar", expect.anything()));
    expect(toast.success).not.toHaveBeenCalled();
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it("al terminar una acción, la lista vuelve a pedir las reservas (el ejecutor refresca `reservas-lista`)", async () => {
    const { tabla } = await montar();
    const cargasAntes = supa.cargas.mock.calls.length;

    fireEvent.click(botones(tabla, "Ana Pendiente")[0]);

    await waitFor(() => expect(supa.cargas.mock.calls.length).toBeGreaterThan(cargasAntes));
  });
});

// Paso 3 del refactor de acciones: la Lista ya no tiene copia propia de los estados ni decide sus
// botones. La insignia de estado sale del mapa único (`ESTADOS_RESERVA`) y los botones, de
// `AccionesReserva` (`accionesDisponibles`): lo que se ve es lo de antes, salvo lo acordado.
describe("ListaReservasAvanzada · estados y botones desde la fuente única", () => {
  const SEIS: [string, EstadoReserva, string][] = [
    ["res-p", "pendiente", "Ana Pendiente"],
    ["res-v", "verificada", "Berta Verificada"],
    ["res-c", "confirmada", "Carlos Confirmado"],
    ["res-l", "completada", "Elena Llegó"],
    ["res-x", "cancelada", "Diana Cancelada"],
    ["res-n", "no_show", "Fede NoVino"],
  ];
  const montarSeis = () => {
    supa.filas = SEIS.map(([id, estado, nombre]) => reserva(id, estado, nombre));
    return montar();
  };
  /** Las clases `lucide-…` de un icono: dicen QUÉ icono es. */
  const clasesIcono = (svg: Element | null | undefined) =>
    (svg?.getAttribute("class") ?? "").split(/\s+/).filter((c) => c.startsWith("lucide-")).sort();

  it("la insignia de cada estado lleva el nombre, el icono, el color y la variante del mapa", async () => {
    const { tabla } = await montarSeis();

    for (const [, estado, nombre] of SEIS) {
      const insignia = filaDe(tabla, nombre).querySelectorAll("td")[5].firstElementChild!;
      const ficha = ESTADOS_RESERVA[estado];
      expect(insignia.textContent?.trim(), estado).toBe(ficha.etiqueta);
      for (const clase of ficha.insignia.split(/\s+/)) expect(insignia.classList.contains(clase), `${estado}: ${clase}`).toBe(true);
      const { container, unmount } = render(<ficha.Icono />);
      expect(clasesIcono(insignia.querySelector("svg")), estado).toEqual(clasesIcono(container.querySelector("svg")));
      unmount();
    }
    // Cancelada y «No vino» van con SU variante del Badge, como antes (su fondo al pasar el ratón).
    expect(filaDe(tabla, "Diana Cancelada").querySelectorAll("td")[5].firstElementChild!.className).toMatch(/hover:bg-destructive\/80/);
    expect(filaDe(tabla, "Fede NoVino").querySelectorAll("td")[5].firstElementChild!.className).toMatch(/hover:bg-secondary\/80/);
  });

  it("CAMBIO ACORDADO: nada dice «servida»; la principal de una «Llegó» lo explica con «Llegó»", async () => {
    const { tabla, container } = await montarSeis();

    expect(container.innerHTML).not.toMatch(/servida/i);
    const [principal] = botonesDeFila(filaDe(tabla, "Elena Llegó"));
    expect(principal.textContent?.trim()).toBe("Confirmar");
    expect(principal.getAttribute("title")).toBe("Nada que aceptar ni confirmar: la reserva está marcada como «Llegó»");
  });

  it("CAMBIO ACORDADO (2026-10-01): «Aceptar» dice que acepta la reserva tal como está", async () => {
    const { tabla } = await montarSeis();

    const [aceptar] = botonesDeFila(filaDe(tabla, "Ana Pendiente"));
    expect(aceptar.textContent?.trim()).toBe("Aceptar");
    expect(aceptar.getAttribute("title")).toMatch(/^Aceptar la reserva tal como está/);
    expect(aceptar.getAttribute("title")).not.toMatch(/pidió/);
  });

  it("lo deshabilitado enseña su motivo al pasar el ratón (en el envoltorio: el botón no recibe el ratón)", async () => {
    const { tabla } = await montarSeis();

    const cancelar = botonesDeFila(filaDe(tabla, "Elena Llegó"))[4];
    expect(cancelar.hasAttribute("disabled")).toBe(true);
    expect(cancelar.parentElement?.getAttribute("title")).toBe("No se puede cancelar una reserva que ya llegó");
    // Lo habilitado lleva su texto en el propio botón y nada en el envoltorio.
    const editar = botonesDeFila(filaDe(tabla, "Elena Llegó"))[3];
    expect(editar.hasAttribute("disabled")).toBe(false);
    expect(editar.parentElement?.hasAttribute("title")).toBe(false);
  });

  it("sin permiso, la principal dice «Aceptar» en todas las filas, deshabilitada y explicándolo (como antes)", async () => {
    supa.canEdit = false;
    const { tabla } = await montarSeis();

    for (const [, estado, nombre] of SEIS) {
      const [principal] = botonesDeFila(filaDe(tabla, nombre));
      expect(principal.textContent?.trim(), estado).toBe("Aceptar");
      expect(principal.hasAttribute("disabled"), estado).toBe(true);
      expect(principal.getAttribute("title"), estado).toBe("No tienes permiso para editar reservas");
    }
  });

  it("CAMBIO ACORDADO (2026-10-01): sin permiso, «Verificar», la estrella y la lista negra salen deshabilitados y lo dicen", async () => {
    // Antes no miraban el permiso: «Verificar» abría el modal en solo lectura y la estrella y la
    // lista negra escribían (las paraba la RLS). Va con la RLS de `reservas` endurecida.
    supa.canEdit = false;
    const { tabla } = await montarSeis();
    const fila = filaDe(tabla, "Ana Pendiente");
    const botones = botonesDeFila(fila);
    const estrella = within(fila).getByRole("button", { name: "Marcar Ana Pendiente como importante" });

    for (const boton of [botones[2], botones[5], estrella]) {
      expect(boton.hasAttribute("disabled")).toBe(true);
      expect(boton.parentElement?.getAttribute("title")).toBe("No tienes permiso para editar reservas");
      fireEvent.click(boton);
    }
    expect(supa.update).not.toHaveBeenCalled();
    // «Dar mesa» no escribe nada (abre el plano): sigue sin mirar el permiso.
    expect(botones[1].getAttribute("aria-label")).not.toMatch(/permiso/);
  });

  it("una reserva sin nombre: los botones dicen «este cliente», como el editor y la tarjeta de móvil", async () => {
    supa.filas = [{ ...reserva("res-anonima", "confirmada", ""), nombre: null }];
    const { tabla } = await montar();
    const fila = filaDe(tabla, "Sin nombre");
    const botones = botonesDeFila(fila);

    expect(botones[4].getAttribute("aria-label")).toBe("Cancelar la reserva de este cliente — pedirá confirmación");
    expect(botones[5].getAttribute("aria-label")).toBe("Añadir a este cliente a la lista negra");
    expect(within(fila).getByRole("button", { name: "Marcar este cliente como importante" })).toBeInTheDocument();
  });

  it("la estrella de la tarjeta de móvil también dice qué hace y marca la misma reserva", async () => {
    await montarSeis();

    // jsdom monta a la vez la tabla y las tarjetas: la misma estrella sale dos veces.
    const estrellas = screen.getAllByRole("button", { name: "Marcar Carlos Confirmado como importante" });
    expect(estrellas).toHaveLength(2);
    fireEvent.click(estrellas.find((b) => !b.closest("table"))!);
    await waitFor(() => expect(supa.update).toHaveBeenCalledWith({ importante: true }));
    expect(supa.eq).toHaveBeenCalledWith("id", "res-c");
  });
});
