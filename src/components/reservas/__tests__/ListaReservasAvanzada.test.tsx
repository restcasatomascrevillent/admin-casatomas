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
 * Y lo que pidió el 2026-10-01 («este timeline ponlo en la lista también»): arriba
 * de la lista va «Cómo avanza una reserva», con los estados pulsables como filtro;
 * desde el 2026-10-06, en una fila fina y sin cifras. Se comprueba al final del fichero.
 *
 * Y la LECTURA POR LOTES (2026-10-01): PostgREST corta cada consulta a 1000 filas y la Lista pedía todas
 * las reservas de una vez, así que con 1.241 en la base de datos el histórico más antiguo desaparecía de la
 * pantalla sin error. Ahora la consulta (`leerReservasLista`) lee por lotes de 1.000: aquí se comprueba, con
 * un doble de Supabase que respeta `range`, el recuento y el tope de 1000 filas por petición, que la Lista
 * recibe TODAS, que la caché `reservas-lista` sigue siendo un array de reservas y que solo avisan los errores
 * reales (ni un aborto —cada acción optimista cancela la consulta— ni una lectura inconsistente). Se
 * comprueba al final del fichero.
 *
 * Y lo que pidió el 2026-10-05 («pon aquí un filtro de solo pendientes y en los dos filtros pon lo que es el
 * filtro en lugar de "Todos"»): los desplegables cerrados dicen qué filtran («Estado», «Estado: Confirmada») y hay
 * un atajo «Por atender» (reservas pendientes + solicitudes sin resolver; el nombre lo decidió el dueño) que va a
 * la par con el desplegable. Se
 * comprueba en su propio describe, antes del de la lectura por lotes.
 *
 * Y lo que pidió el 2026-10-06 («perdemos mucho espacio vertical»): sin el recuento «N reservas ·
 * M solicitudes», sin scroll de página (el bloque de la lista mide lo que queda de ventana y solo se
 * desplazan las filas, que conservan su posición al refrescar y vuelven arriba al cambiar de filtro) y sin
 * scroll horizontal en la tabla (reparto fijo de columnas). Se comprueba en su propio describe, al final.
 *
 * Que todo QUEPA de verdad no se puede medir en jsdom (no calcula diseño): aquí se comprueba la
 * estructura que lo garantiza; las medidas se toman en el navegador.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, type MockInstance } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { format, addDays } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { SolicitudPendiente } from "@/hooks/useSolicitudesPendientes";
import { ESTADOS_RESERVA, type EstadoReserva } from "@/lib/reservas/estadosReserva";
import { ErrorLecturaInconsistente } from "@/lib/reservas/paginarConsulta";
import type { DobleSupabase } from "@/lib/reservas/__tests__/dobleSupabaseLotes";

const supa = vi.hoisted(() => ({
  /** Las salas que devuelve `useEspaciosReserva` (por defecto, ninguna). */
  espacios: [] as unknown[],
  // La escritura del ejecutor de acciones es `update(…).eq("id", …)[.in("estado", …)].select("id")`.
  update: vi.fn(),
  eq: vi.fn(),
  en: vi.fn(),
  select: vi.fn(),
  /**
   * Cada vez que la lista pide las reservas (`select` de la consulta de la lista, no el de una escritura):
   * una por LOTE (con 1.000 reservas o menos, una sola).
   */
  cargas: vi.fn(),
  /** Respuestas de las siguientes escrituras (sin más: éxito con la fila de ESA reserva). */
  respuestas: [] as Array<{ data?: unknown; error?: unknown }>,
  /** Lo que hay en la tabla `reservas`: la consulta de la lista lo lee por lotes con `range`. */
  filas: [] as Record<string, unknown>[],
  /**
   * El doble en memoria que sirve esas LECTURAS (se crea en el `vi.mock` del cliente): aquí se miran sus
   * `peticiones` (tabla, columnas, filtros, orden, rango, recuento y señal de cada lote) y se le dan
   * `opciones` (fallos, esperas, lotes cortos, abortos). Se reinicia en cada test.
   */
  lecturas: undefined as unknown as DobleSupabase,
  // Props con las que se monta el alta al convertir una solicitud.
  formulario: vi.fn(),
  // Props de la tarjeta de solicitud (móvil) y del panel «Gestionar»: ¿llevan «Convertir»?
  tarjetaSolicitud: vi.fn(),
  panelGestion: vi.fn(),
  // Permiso de edición de la sección «reservas» y el editor que abre la ranura de editar.
  canEdit: true,
  editarReserva: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// Las LECTURAS de `reservas` las sirve el doble en memoria de las lecturas por lotes
// (`src/lib/reservas/__tests__/dobleSupabaseLotes.ts`): respeta `order`, `range`, el recuento exacto, el tope
// de 1000 filas por petición de PostgREST y `.abortSignal`, sobre `supa.filas`. Así la Lista se prueba con la
// misma consulta que en producción. Las escrituras (`update`) y las funciones siguen siendo las de siempre.
vi.mock("@/integrations/supabase/client", async () => {
  const { crearDobleSupabase } = await import("@/lib/reservas/__tests__/dobleSupabaseLotes");
  const lecturas = crearDobleSupabase();
  // `supa.filas` se reasigna en casi todos los tests: la tabla del doble lo lee siempre de ahí.
  lecturas.tablas = new Proxy({} as Record<string, Record<string, unknown>[]>, {
    get: (_destino, tabla) => (tabla === "reservas" ? supa.filas : undefined),
  });
  supa.lecturas = lecturas;

  return {
    supabase: {
      from: () => ({
        select: (columnas?: string, opciones?: { count?: string }) => {
          supa.cargas();
          return lecturas.from("reservas").select(columnas, opciones);
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
  };
});

vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: () => ({ canAccess: supa.canEdit, loading: false }),
}));
vi.mock("@/hooks/useEspaciosReserva", () => ({ useEspaciosReserva: () => ({ data: supa.espacios }) }));

// Hijos pesados: aquí solo estorban.
vi.mock("@/hooks/useEdicionReserva", () => ({
  useEdicionReserva: () => ({ editarReserva: supa.editarReserva, dialogoEdicion: null }),
}));
vi.mock("@/components/reservas/ModalVerificacionReserva", () => ({ ModalVerificacionReserva: () => null }));
vi.mock("@/components/reservas/BlacklistModal", () => ({ BlacklistModal: () => null }));
vi.mock("@/components/reservas/SolicitudGestionPanel", () => ({
  SolicitudGestionPanel: (props: unknown) => {
    supa.panelGestion(props);
    return null;
  },
}));
vi.mock("@/components/reservas/FormularioReserva", () => ({
  FormularioReserva: (props: unknown) => {
    supa.formulario(props);
    return null;
  },
}));
vi.mock("@/components/reservas/GestionSolicitudes", () => ({
  SolicitudCard: (props: unknown) => {
    supa.tarjetaSolicitud(props);
    return null;
  },
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
  fetchSolicitudes: vi.fn(),
  updateEstado: vi.fn().mockResolvedValue(true),
  updateNotasInternas: vi.fn().mockResolvedValue(true),
  updatePropuesta: vi.fn().mockResolvedValue(true),
  enviarPropuesta: vi.fn().mockResolvedValue(true),
  aceptarPropuestaTelefono: vi.fn().mockResolvedValue({ ok: true }),
  rechazarPropuestaTelefono: vi.fn().mockResolvedValue({ ok: true }),
  marcarConvertida: vi.fn().mockResolvedValue(true),
} as unknown as Parameters<typeof ListaReservasAvanzada>[0]["solicitudesState"];

/**
 * Monta la lista SIN esperar a la tabla: es lo que hace falta cuando la carga falla o se cancela y la tabla no
 * llega a pintarse. `reintentos` son los que hace TanStack Query cuando la consulta falla (por defecto, ninguno;
 * sin espera entre intentos). Devuelve el `client`, para mirar o cancelar la caché `reservas-lista`.
 */
function renderizar(props: Partial<Parameters<typeof ListaReservasAvanzada>[0]> = {}, reintentos: number | false = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: reintentos, retryDelay: 0, gcTime: 0 } } });
  const vista = render(
    <QueryClientProvider client={client}>
      <ListaReservasAvanzada solicitudesState={estadoSolicitudes} {...props} />
    </QueryClientProvider>,
  );
  return { ...vista, client };
}

async function montar(props: Partial<Parameters<typeof ListaReservasAvanzada>[0]> = {}, reintentos: number | false = false) {
  const montada = renderizar(props, reintentos);
  // En jsdom NO hay media queries, así que se montan a la vez la tabla y las
  // tarjetas de móvil. Todo lo que se mire aquí va acotado a la tabla.
  const tabla = await waitFor(() => {
    const t = montada.container.querySelector("table");
    if (!t || !t.querySelector("tbody tr td")) throw new Error("tabla sin filas todavía");
    return t;
  });
  return { ...montada, tabla };
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
  supa.lecturas.reiniciar(); // sin opciones, sin peticiones anotadas y la numeración de peticiones desde 1
  // Los fixtures de estos tests ya vienen en el orden en que se espera verlos (varias reservas empatan en día y
  // hora): el doble no las reordena por `id`, como haría el servidor. Lo que pide la consulta (`fecha` desc,
  // `hora` asc, `id`) se comprueba en su describe, mirando las peticiones.
  supa.lecturas.opciones.conservarOrdenDeLaTabla = true;
  supa.respuestas = [];
  supa.canEdit = true;
  supa.espacios = [];
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

// Touza no admite reservas (decisión del dueño 2026-10-01): se retira «convertir una solicitud de Touza usa la
// marca guardada (touza)». Una solicitud de Touza que quedara en la base de datos ni sale en la lista (así no se
// puede convertir sin querer en una reserva de Casa Tomás), y las de Casa Tomás se convierten sin negocio: el
// alta escribe siempre la marca de Casa Tomás.
describe("ListaReservasAvanzada · solicitudes: solo Casa Tomás", () => {
  it("una solicitud de Touza no sale en la lista", async () => {
    const deTouza = { ...solicitud, id: "sol-tz", nombre: "Grupo Touza", marca: "touza" } as SolicitudPendiente;
    const { tabla } = await montar({
      solicitudesState: { ...estadoSolicitudes, solicitudes: [solicitud, deTouza] } as typeof estadoSolicitudes,
    });

    expect(within(tabla).getByText("Familia Ballester")).toBeInTheDocument();
    expect(screen.queryByText("Grupo Touza")).not.toBeInTheDocument();
    // Una sola fila de solicitud: la de Casa Tomás.
    expect(within(tabla).getAllByText(/^Solicitud ·/)).toHaveLength(1);
  });

  it("convertir una solicitud de Casa Tomás no pasa ningún negocio al alta", async () => {
    const { tabla } = await montar({
      solicitudesState: { ...estadoSolicitudes, solicitudes: [{ ...solicitud, marca: "casa_tomas" }] } as typeof estadoSolicitudes,
    });
    fireEvent.click(botonesDeFila(filaDe(tabla, "Familia Ballester"))[0]);

    await waitFor(() => expect(supa.formulario).toHaveBeenCalled());
    const props = supa.formulario.mock.calls.at(-1)![0] as { datosPreseleccionados: Record<string, unknown> };
    expect(props.datosPreseleccionados).not.toHaveProperty("marca");
    expect(props.datosPreseleccionados).toMatchObject({ canal: "telefono", solicitud_id: "sol-1", espacio_id: null });
  });
});

// «Convertir en reserva» es un ALTA: pide permiso de edición en «reservas», como «Nueva Reserva» (con la RLS de
// 20261001170000 el INSERT de quien solo puede VER falla). Tiene tres entradas: el botón de la fila (escritorio),
// la tarjeta (móvil) y el panel «Gestionar» (que además crea la reserva al «Registrar que aceptó por teléfono»).
describe("ListaReservasAvanzada · «Convertir en reserva» pide permiso de edición", () => {
  const ultimasProps = (espia: ReturnType<typeof vi.fn>) => espia.mock.calls.at(-1)![0] as Record<string, unknown>;
  const accionesDeLaSolicitud = (tabla: HTMLElement) => botonesDeFila(filaDe(tabla, "Familia Ballester"));

  it("sin permiso: el botón de la fila sale deshabilitado y lo explica, y ni la tarjeta ni «Gestionar» lo ofrecen", async () => {
    supa.canEdit = false;
    const { tabla } = await montar();
    const [convertir, , , gestionar] = accionesDeLaSolicitud(tabla);

    expect(convertir.textContent?.trim()).toBe("Convertir");
    expect(convertir).toBeDisabled();
    expect(convertir.parentElement).toHaveAttribute("title", "No tienes permiso para editar reservas");
    fireEvent.click(convertir);
    expect(supa.formulario).not.toHaveBeenCalled();
    expect(ultimasProps(supa.tarjetaSolicitud).onConvertir).toBeUndefined();

    fireEvent.click(gestionar);
    await waitFor(() => expect(supa.panelGestion).toHaveBeenCalled());
    expect(ultimasProps(supa.panelGestion).onConvertir).toBeUndefined();
    expect(ultimasProps(supa.panelGestion).onAceptarTelefono).toBeUndefined();
  });

  it("con permiso: el botón de la fila abre el alta con la solicitud y la tarjeta también lo ofrece", async () => {
    const { tabla } = await montar();
    const [convertir] = accionesDeLaSolicitud(tabla);

    expect(convertir).toBeEnabled();
    expect(typeof ultimasProps(supa.tarjetaSolicitud).onConvertir).toBe("function");
    fireEvent.click(convertir);
    await waitFor(() => expect(supa.formulario).toHaveBeenCalled());
    expect(ultimasProps(supa.formulario).datosPreseleccionados).toMatchObject({ nombre: "Familia Ballester", solicitud_id: "sol-1" });
  });

  it("con permiso: «Gestionar» ofrece «Convertir en reserva» y «Registrar que aceptó por teléfono»", async () => {
    const { tabla } = await montar();
    const [, , , gestionar] = accionesDeLaSolicitud(tabla);

    fireEvent.click(gestionar);
    await waitFor(() => expect(supa.panelGestion).toHaveBeenCalled());
    expect(typeof ultimasProps(supa.panelGestion).onConvertir).toBe("function");
    expect(typeof ultimasProps(supa.panelGestion).onAceptarTelefono).toBe("function");
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

// «Cómo avanza una reserva» también en la Lista (2026-10-01, petición del dueño): arriba de la lista, con los
// estados pulsables como filtro (volver a pulsar el que está puesto lo quita). El 2026-10-06 el dueño pidió
// «achatar más» y quitar los totales: ahora es UNA fila fina, SIN cifras y sin la frase debajo de cada estado
// (va en el tooltip y en `aria-description`). No hace consultas propias. Touza no admite reservas
// (`admiteReservas`): sus reservas no salen en la tabla.
// Tiempo límite holgado (30 s) para todo el bloque: cada test monta la lista entera (tabla + tarjetas) y,
// con la máquina cargada, alguno pasa de los 5 s por defecto sin que haya ningún problema.
describe("ListaReservasAvanzada · «Cómo avanza una reserva»: una fila, sin cifras, y sus estados filtran", { timeout: 30_000 }, () => {
  const CLAVE_ABIERTO = "reservas:timeline-estados:abierto";
  /** Orden del timeline: pendiente, verificada, confirmada, llegó, cancelada, no vino. */
  const ESTADOS_EN_ORDEN = ["pendiente", "verificada", "confirmada", "completada", "cancelada", "no_show"] as const;
  const NOMBRES_EN_ORDEN = ["Pendiente", "Verificada", "Confirmada", "Llegó", "Cancelada", "No vino"];

  const region = () => screen.getByRole("region", { name: /Cómo avanza una reserva/ });
  const nodos = () => within(region()).getAllByRole("listitem");
  const pulsados = () => nodos().map((li) => within(li).getByRole("button").getAttribute("aria-pressed"));
  const botonDeEstado = (nombre: string) => within(region()).getByRole("button", { name: nombre });
  /** El texto que se VE en un elemento (sin lo que solo oye el lector de pantalla). */
  const textoVisible = (el: HTMLElement) => {
    const copia = el.cloneNode(true) as HTMLElement;
    copia.querySelectorAll(".sr-only").forEach((n) => n.remove());
    return copia.textContent?.replace(/\s+/g, " ").trim() ?? "";
  };
  /** Filas de la tabla con datos (sin la fila «No se encontraron reservas…», que ocupa las seis columnas). */
  const filasDeDatos = (tabla: HTMLElement) =>
    ([...tabla.querySelectorAll("tbody tr")] as HTMLElement[]).filter((f) => !f.querySelector("td[colspan]"));
  const buscador = () => screen.getByRole("textbox", { name: "Buscar reservas y solicitudes" });
  const desplegableDeEstado = () => screen.getByRole("combobox", { name: "Filtrar por estado" });
  async function elegirOpcion(trigger: HTMLElement, opcion: string | RegExp) {
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("option", { name: opcion }));
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  }
  const SEIS_SIN_PULSAR = ["false", "false", "false", "false", "false", "false"];

  // Radix Select necesita estos métodos, que jsdom no implementa (mismo apaño que el resto de tests). Y
  // `scrollTo`, que usa el cambio de página (`irAPagina`) y tampoco existe en los elementos de jsdom.
  beforeAll(() => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
    window.HTMLElement.prototype.releasePointerCapture = vi.fn();
    window.HTMLElement.prototype.scrollTo = vi.fn();
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  });
  // La preferencia de plegado vive en el almacenamiento del navegador y se comparte entre tests: se limpia.
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  it("va arriba de la lista, antes de los filtros y de la tabla, con los seis estados en su orden", async () => {
    const { tabla } = await montar();

    expect(nodos()).toHaveLength(6);
    expect(nodos().map((li) => li.getAttribute("data-estado"))).toEqual([...ESTADOS_EN_ORDEN]);
    nodos().forEach((li, i) => expect(within(li).getByText(NOMBRES_EN_ORDEN[i])).toBeInTheDocument());
    // En el documento va antes que el buscador (los filtros) y que la tabla.
    expect(region().compareDocumentPosition(buscador()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(region().compareDocumentPosition(tabla) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("SIN cifras (2026-10-06): cada estado enseña solo su nombre y su botón se llama así, sin número", async () => {
    // El fixture trae 5 reservas (pendiente, verificada, 2 confirmadas, cancelada) y 1 solicitud del bot: antes
    // el timeline decía «1», «1», «2», «0», «1», «0».
    await montar();

    expect(region().querySelectorAll("[data-cifra]")).toHaveLength(0);
    nodos().forEach((li, i) => {
      expect(textoVisible(li)).toBe(NOMBRES_EN_ORDEN[i]);
      expect(within(li).getByRole("button")).toHaveAccessibleName(NOMBRES_EN_ORDEN[i]);
    });
    // Ni un número a la vista en toda la fila, ni el rótulo «cifras de la lista».
    expect(textoVisible(region())).not.toMatch(/\d/);
    expect(region()).not.toHaveTextContent(/cifras/);
  });

  it("UNA fila fina: sin frases debajo de los estados; la de cada uno va en su tooltip y en `aria-description`", async () => {
    await montar();

    expect(region()).toHaveClass("flex", "items-center");
    expect(region().querySelectorAll("p")).toHaveLength(0);
    expect(screen.queryByText("Solicitada por web o teléfono. Toca verificarla.")).toBeNull();
    expect(botonDeEstado("Pendiente")).toHaveAttribute("aria-description", "Solicitada por web o teléfono. Toca verificarla.");
    expect(botonDeEstado("Pendiente")).toHaveAttribute(
      "title",
      "Solicitada por web o teléfono. Toca verificarla.\nVer solo las reservas «Pendiente»",
    );
  });

  it("no hace ninguna consulta propia: la única carga es la de la lista", async () => {
    await montar();

    // La única carga es la de la propia lista (`reservas-lista`).
    expect(supa.cargas).toHaveBeenCalledTimes(1);
  });

  it("TOUZA NO ADMITE RESERVAS: las reservas de `marca = 'touza'` no salen en la tabla", async () => {
    // Decisión del dueño (2026-10-01; en los datos de demo hay 5 de Touza). La regla es la común,
    // `admiteReservas`: lo comprueba aquí el resultado. Una reserva sin marca es de Casa Tomás y sí sale.
    supa.filas = [
      reserva("ct", "pendiente", "De Casa Tomas"),
      { ...reserva("sin-marca", "verificada", "Sin Marca"), marca: null },
      { ...reserva("tz-1", "confirmada", "De Touza Uno"), marca: "touza" },
      { ...reserva("tz-2", "confirmada", "De Touza Dos"), marca: "touza" },
      { ...reserva("tz-3", "cancelada", "De Touza Tres"), marca: "touza" },
    ];
    const { tabla } = await montar();

    expect(filasDeDatos(tabla).filter((f) => !f.textContent?.includes("Familia Ballester"))).toHaveLength(2);
    expect(screen.queryByText(/De Touza/)).not.toBeInTheDocument();
    // Ni siquiera filtrando por el estado de las de Touza.
    fireEvent.click(botonDeEstado("Confirmada"));
    expect(filasDeDatos(tabla)).toHaveLength(0);
    expect(screen.queryByRole("combobox", { name: "Filtrar por negocio" })).not.toBeInTheDocument();
  });

  it("con «Pendiente» puesto desde la URL, la tabla enseña solo esa fila y ese paso sale pulsado", async () => {
    const { tabla } = await montar({ initialStatusFilter: "pendiente" });

    expect(filasDeDatos(tabla).map((f) => f.textContent)).toEqual([expect.stringContaining("Ana Pendiente")]);
    expect(pulsados()).toEqual(["true", "false", "false", "false", "false", "false"]);
  });

  it("con «Solicitudes sin resolver», la tabla enseña solo la solicitud y ningún paso sale pulsado", async () => {
    const { tabla } = await montar({ initialStatusFilter: "solicitudes" });

    expect(filasDeDatos(tabla)).toHaveLength(1);
    expect(pulsados()).toEqual(SEIS_SIN_PULSAR);
  });

  it("sin filtro de estado ningún paso sale pulsado", async () => {
    await montar();

    expect(pulsados()).toEqual(SEIS_SIN_PULSAR);
  });

  it("pulsar cada estado enseña justo sus reservas, y solo ese queda pulsado", async () => {
    supa.filas = [
      reserva("p1", "pendiente", "Pe Uno"),
      reserva("p2", "pendiente", "Pe Dos"),
      reserva("p3", "pendiente", "Pe Tres"),
      reserva("v1", "verificada", "Ve Uno"),
      reserva("c1", "confirmada", "Co Uno"),
      reserva("c2", "confirmada", "Co Dos"),
      reserva("l1", "completada", "Ll Uno"),
      reserva("x1", "cancelada", "Ca Uno"),
      reserva("x2", "cancelada", "Ca Dos"),
    ];
    const { tabla } = await montar();
    // pendiente, verificada, confirmada, llegó, cancelada, no vino
    const cuantas = [3, 1, 2, 1, 2, 0];

    for (const [i, estado] of ESTADOS_EN_ORDEN.entries()) {
      fireEvent.click(botonDeEstado(NOMBRES_EN_ORDEN[i]));

      expect(filasDeDatos(tabla), estado).toHaveLength(cuantas[i]);
      for (const fila of filasDeDatos(tabla)) {
        expect(fila.querySelectorAll("td")[5], estado).toHaveTextContent(NOMBRES_EN_ORDEN[i]);
      }
      expect(pulsados(), estado).toEqual(SEIS_SIN_PULSAR.map((_, j) => (j === i ? "true" : "false")));
    }
  });

  it("pulsar un estado filtra la lista, y el desplegable «Estado» de los filtros lo refleja", async () => {
    const { tabla } = await montar();
    expect(filasDeDatos(tabla)).toHaveLength(6);

    fireEvent.click(botonDeEstado("Confirmada"));

    expect(filasDeDatos(tabla).map((f) => f.textContent)).toEqual([
      expect.stringContaining("Carlos Confirmado"),
      expect.stringContaining("Elena ConSala"),
    ]);
    expect(desplegableDeEstado()).toHaveTextContent("Confirmada");
    expect(botonDeEstado("Confirmada")).toHaveAttribute("aria-pressed", "true");
  });

  it("«Llegó» filtra por «completada» (la clave de la base de datos); el desplegable cerrado dice «Estado: Llegó» y, abierto, «Llegó / completada»", async () => {
    // Cambio acordado (2026-10-05, «pon lo que es el filtro en lugar de "Todos"»): cerrado, el desplegable dice
    // «Estado: …» con el nombre de la insignia; antes decía «Llegó / completada», que ya no cabe tras «Estado: ».
    supa.filas = [reserva("l1", "completada", "Elena Llegó"), reserva("p1", "pendiente", "Ana Pendiente")];
    const { tabla } = await montar();

    fireEvent.click(botonDeEstado("Llegó"));

    expect(filasDeDatos(tabla).map((f) => f.textContent)).toEqual([expect.stringContaining("Elena Llegó")]);
    expect(desplegableDeEstado().textContent?.trim()).toBe("Estado: Llegó");
    fireEvent.click(desplegableDeEstado());
    expect(await screen.findByRole("option", { name: "Llegó / completada" })).toHaveAttribute("data-state", "checked");
  });

  it("volver a pulsar el estado pulsado quita el filtro y la lista vuelve a enseñarlo todo", async () => {
    const { tabla } = await montar();

    fireEvent.click(botonDeEstado("Pendiente"));
    expect(filasDeDatos(tabla)).toHaveLength(1);

    fireEvent.click(botonDeEstado("Pendiente"));

    expect(filasDeDatos(tabla)).toHaveLength(6);
    expect(pulsados()).toEqual(SEIS_SIN_PULSAR);
    // Sin filtro, el desplegable dice el nombre del filtro (antes, «Todos»).
    expect(desplegableDeEstado().textContent?.trim()).toBe("Estado");
  });

  it("pulsar otro estado cambia el filtro (no suma): solo uno a la vez, como el desplegable", async () => {
    const { tabla } = await montar();

    fireEvent.click(botonDeEstado("Pendiente"));
    fireEvent.click(botonDeEstado("Verificada"));

    expect(filasDeDatos(tabla).map((f) => f.textContent)).toEqual([expect.stringContaining("Berta Verificada")]);
    expect(pulsados()).toEqual(["false", "true", "false", "false", "false", "false"]);
  });

  it("si venía filtrado por «Solicitudes sin resolver», pulsar un estado lo sustituye", async () => {
    const { tabla } = await montar({ initialStatusFilter: "solicitudes" });
    expect(filasDeDatos(tabla)).toHaveLength(1);

    fireEvent.click(botonDeEstado("Cancelada"));

    expect(filasDeDatos(tabla).map((f) => f.textContent)).toEqual([expect.stringContaining("Diana Cancelada")]);
  });

  it("el desplegable «Estado» también mueve el timeline: elegir «Confirmada» ahí la deja pulsada aquí", async () => {
    await montar();

    await elegirOpcion(desplegableDeEstado(), "Confirmada");

    expect(pulsados()).toEqual(["false", "false", "true", "false", "false", "false"]);
  });

  it("un estado sin reservas se puede pulsar: la lista dice que no hay ninguna y se deshace igual", async () => {
    const { tabla } = await montar();

    fireEvent.click(botonDeEstado("No vino"));
    expect(filasDeDatos(tabla)).toHaveLength(0);
    expect(tabla).toHaveTextContent("No se encontraron reservas con los filtros aplicados");
    expect(botonDeEstado("No vino")).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(botonDeEstado("No vino"));
    expect(filasDeDatos(tabla)).toHaveLength(6);
  });

  // Pesado a propósito (50 filas por página, en tabla y en tarjetas).
  it("filtrar por estado no se salta la paginación: al pulsar un estado se vuelve a la primera página", async () => {
    // 52 pendientes + 3 verificadas (+ la solicitud del bot): con 50 filas por página, «Todos» tiene dos páginas.
    supa.filas = [
      ...Array.from({ length: 52 }, (_, i) => reserva(`p-${i}`, "pendiente", `Pen ${String(i).padStart(2, "0")}`)),
      ...Array.from({ length: 3 }, (_, i) => reserva(`v-${i}`, "verificada", `Ver ${i}`)),
    ];
    const { tabla } = await montar();
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(screen.getByText(/Página 2 de 2/)).toBeInTheDocument();

    fireEvent.click(botonDeEstado("Verificada"));

    // 3 filas: ya no hay paginación y se ven todas.
    expect(filasDeDatos(tabla)).toHaveLength(3);
    expect(screen.queryByText(/Página \d+ de/)).not.toBeInTheDocument();
  });

  it("sin desplegable (15/10/2026): el timeline está siempre a la vista, aunque quede guardado «plegado» de antes", async () => {
    window.localStorage.setItem(CLAVE_ABIERTO, "0");
    const { tabla } = await montar();

    expect(screen.queryByRole("button", { name: /Cómo avanza una reserva/ })).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: /Cómo avanza una reserva/ })).toBeInTheDocument();
    expect(filasDeDatos(tabla)).toHaveLength(6);
    expect(buscador()).toBeInTheDocument();
  });

  it("deja intactos los filtros de siempre: un solo buscador, el atajo «Hoy» y el desplegable «Estado»", async () => {
    await montar();

    expect(screen.getAllByRole("textbox", { name: "Buscar reservas y solicitudes" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Hoy" })).toHaveLength(1);
    expect(desplegableDeEstado().textContent?.trim()).toBe("Estado");
  });
});

// Lo que pidió el dueño el 2026-10-05 con dos capturas: «pon aquí un filtro de solo pendientes y en los dos filtros
// pon lo que es el filtro en lugar de "Todos" para que se entienda».
//   · Los dos desplegables, cerrados, dicen QUÉ filtran: «Estado» / «Canal» sin filtro y «Estado: Confirmada» /
//     «Canal: Web» con uno. Abiertos, «Todos» pasa a «Todos los estados» / «Todos los canales».
//   · «Por atender» (el nombre lo decidió el dueño; no «Pendientes»): botón de alternancia junto a «Hoy» y «Fecha»
//     que enseña SOLO lo que espera al personal —las reservas `pendiente` y las solicitudes del asistente sin
//     resolver—. Es la opción `por_atender` del desplegable «Estado» (botón y desplegable van a la par) y se
//     combina con los demás filtros. Su cifra se cuenta como las del timeline: la lista con sus filtros menos el
//     de estado.
//   · El paso «Pendiente» del timeline sigue siendo SOLO reservas pendientes.
describe("ListaReservasAvanzada · los desplegables dicen qué filtran y el atajo «Por atender»", { timeout: 30_000 }, () => {
  const desplegableEstado = () => screen.getByRole("combobox", { name: "Filtrar por estado" });
  const desplegableCanal = () => screen.getByRole("combobox", { name: "Filtrar por canal" });
  const textoDe = (el: HTMLElement) => el.textContent?.replace(/\s+/g, " ").trim();
  const clasesDe = (el: HTMLElement) => el.className.split(/\s+/);
  const botonPorAtender = () => screen.getByRole("button", { name: /^Por atender/ });
  const cifraDelBoton = () => botonPorAtender().querySelector("[data-cifra-por-atender]")?.textContent?.replace(/\D/g, "");
  const buscador = () => screen.getByRole("textbox", { name: "Buscar reservas y solicitudes" });
  const timeline = () => screen.getByRole("region", { name: /Cómo avanza una reserva/ });
  const pasoDelTimeline = (nombre: string) => within(timeline()).getByRole("button", { name: nombre });
  const pulsadosDelTimeline = () => within(timeline()).queryAllByRole("button", { pressed: true });
  /** Los clientes de las filas de la tabla, en orden (sin la fila de «lista vacía»). */
  const clientes = (tabla: HTMLElement) =>
    ([...tabla.querySelectorAll("tbody tr")] as HTMLElement[])
      .filter((f) => !f.querySelector("td[colspan]"))
      .map((f) => f.querySelectorAll("td")[2].querySelector("p")?.textContent);
  async function elegirOpcion(trigger: HTMLElement, opcion: string | RegExp) {
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("option", { name: opcion }));
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  }
  const OPCION_POR_ATENDER = "Por atender (reservas y solicitudes sin resolver)";

  const solicitudDe = (id: string, estado: string, nombre: string) =>
    ({ ...solicitud, id, estado, nombre }) as SolicitudPendiente;
  /** 2 sin resolver (pendiente y contactado) y 2 cerradas. Todas de mañana y por teléfono (las del asistente). */
  const SOLICITUDES = [
    solicitudDe("sol-abierta", "pendiente", "Familia Ballester"),
    solicitudDe("sol-contactada", "contactado", "Grupo Contactado"),
    solicitudDe("sol-resuelta", "resuelta", "Grupo Resuelto"),
    solicitudDe("sol-descartada", "descartada", "Grupo Descartado"),
  ];
  const conSolicitudes = (solicitudes: SolicitudPendiente[] = SOLICITUDES) => ({
    solicitudesState: { ...estadoSolicitudes, solicitudes } as typeof estadoSolicitudes,
  });

  beforeAll(() => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
    window.HTMLElement.prototype.releasePointerCapture = vi.fn();
    window.HTMLElement.prototype.scrollTo = vi.fn();
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  });
  beforeEach(() => {
    window.localStorage.clear();
    // Una reserva de cada estado y DOS pendientes: una de hoy por teléfono y otra de mañana por la web.
    supa.filas = [
      reserva("p-hoy", "pendiente", "Ana Pendiente"),
      { ...reserva("p-web", "pendiente", "Pepa PendienteWeb"), canal: "web", fecha: MANANA },
      reserva("v", "verificada", "Berta Verificada"),
      reserva("c", "confirmada", "Carlos Confirmado"),
      reserva("l", "completada", "Elena Llegó"),
      reserva("x", "cancelada", "Diana Cancelada"),
      reserva("n", "no_show", "Fede NoVino"),
    ];
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  // ── Los dos desplegables ────────────────────────────────────────────────────

  it("cerrados y sin filtro dicen el NOMBRE del filtro («Estado», «Canal») en vez de «Todos», con nombre accesible", async () => {
    await montar();

    expect(textoDe(desplegableEstado())).toBe("Estado");
    expect(textoDe(desplegableCanal())).toBe("Canal");
    // Sin filtro no hay nada que aclarar en el `title`.
    expect(desplegableEstado()).not.toHaveAttribute("title");
    expect(desplegableCanal()).not.toHaveAttribute("title");
  });

  it("con un valor elegido dicen «Nombre: valor» (también en el `title`, por si no cabe y se recorta)", async () => {
    await montar();

    await elegirOpcion(desplegableEstado(), "Confirmada");
    expect(textoDe(desplegableEstado())).toBe("Estado: Confirmada");
    expect(desplegableEstado()).toHaveAttribute("title", "Estado: Confirmada");

    await elegirOpcion(desplegableCanal(), /Web/);
    expect(textoDe(desplegableCanal())).toBe("Canal: Web");
    expect(desplegableCanal()).toHaveAttribute("title", "Canal: Web");

    // Teléfono, con la palabra entera (la de la insignia de la columna Canal), no «📞 Tel».
    await elegirOpcion(desplegableCanal(), /Tel/);
    expect(textoDe(desplegableCanal())).toBe("Canal: Teléfono");

    // Las opciones largas dicen entero lo que son (y el `title` lo repite).
    await elegirOpcion(desplegableEstado(), "Solicitudes sin resolver");
    expect(textoDe(desplegableEstado())).toBe("Estado: Solicitudes sin resolver");
    expect(desplegableEstado()).toHaveAttribute("title", "Estado: Solicitudes sin resolver");
  });

  it("volver a «Todos los estados» / «Todos los canales» les devuelve el nombre del filtro", async () => {
    await montar({ initialStatusFilter: "confirmada" });
    expect(textoDe(desplegableEstado())).toBe("Estado: Confirmada");
    await elegirOpcion(desplegableCanal(), /Manual/);
    expect(textoDe(desplegableCanal())).toBe("Canal: Manual");

    await elegirOpcion(desplegableEstado(), "Todos los estados");
    await elegirOpcion(desplegableCanal(), "Todos los canales");

    expect(textoDe(desplegableEstado())).toBe("Estado");
    expect(textoDe(desplegableCanal())).toBe("Canal");
  });

  it("abiertos, «Todos» pasa a «Todos los estados» / «Todos los canales», y «Por atender (…)» va justo después de «Todos los estados»", async () => {
    await montar();

    fireEvent.click(desplegableEstado());
    const deEstado = (await screen.findAllByRole("option")).map((o) => textoDe(o));
    expect(deEstado.slice(0, 3)).toEqual(["Todos los estados", OPCION_POR_ATENDER, "Solicitudes sin resolver"]);
    expect(deEstado).not.toContain("Todos");
    fireEvent.click(screen.getByRole("option", { name: "Todos los estados" }));
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());

    fireEvent.click(desplegableCanal());
    const deCanal = (await screen.findAllByRole("option")).map((o) => textoDe(o));
    expect(deCanal).toEqual(["Todos los canales", "📞 Tel", "🌐 Web", "✏️ Manual"]);
  });

  // ── «Por atender» ───────────────────────────────────────────────────────────

  it("«Por atender» es un botón de alternancia, sin pulsar al entrar, con la cifra de lo que hay por atender: reservas pendientes + solicitudes sin resolver", async () => {
    await montar(conSolicitudes());

    expect(botonPorAtender()).toHaveAttribute("aria-pressed", "false");
    expect(botonPorAtender()).toBeEnabled();
    // Sin pulsar, con borde, como «Hoy» cuando no está puesto (variante `outline`).
    expect(clasesDe(botonPorAtender())).toContain("border-input");
    expect(clasesDe(botonPorAtender())).not.toContain("bg-primary");
    // 2 reservas pendientes + 2 solicitudes sin resolver (las 2 cerradas no cuentan).
    expect(cifraDelBoton()).toBe("4");
    // Se ve «Por atender» y la cifra; el lector de pantalla oye también qué se cuenta.
    expect(botonPorAtender()).toHaveAccessibleName("Por atender 4 reservas y solicitudes");
    expect(botonPorAtender()).toHaveAttribute(
      "title",
      "Ver solo lo que está por atender: reservas pendientes y solicitudes sin resolver",
    );
  });

  it("pulsado enseña SOLO las reservas pendientes y las solicitudes sin resolver (ningún otro estado, ninguna cerrada)", async () => {
    const { tabla } = await montar(conSolicitudes());
    expect(clientes(tabla)).toHaveLength(9); // 7 reservas + 2 solicitudes sin resolver

    fireEvent.click(botonPorAtender());

    expect(botonPorAtender()).toHaveAttribute("aria-pressed", "true");
    expect(botonPorAtender()).toHaveAttribute("title", "Quitar el filtro «Por atender»");
    // Pulsado, el estilo activo de «Hoy» (variante `default`, relleno oscuro).
    expect(clasesDe(botonPorAtender())).toContain("bg-primary");
    // Las solicitudes abiertas van primero (orden de la lista); luego las reservas, de la más reciente a la más antigua.
    expect(clientes(tabla)).toEqual(["Familia Ballester", "Grupo Contactado", "Pepa PendienteWeb", "Ana Pendiente"]);
    // La cifra del botón es justo lo que se ve.
    expect(cifraDelBoton()).toBe("4");
  });

  it("volver a pulsarlo quita el filtro: todos los estados otra vez", async () => {
    const { tabla } = await montar(conSolicitudes());

    fireEvent.click(botonPorAtender());
    fireEvent.click(botonPorAtender());

    expect(botonPorAtender()).toHaveAttribute("aria-pressed", "false");
    expect(textoDe(desplegableEstado())).toBe("Estado");
    expect(clientes(tabla)).toHaveLength(9); // 7 reservas + 2 solicitudes sin resolver
  });

  it("el botón y el desplegable «Estado» van a la par, en los dos sentidos", async () => {
    const { tabla } = await montar(conSolicitudes());

    // Botón → desplegable: dice «Estado: Por atender» y, abierto, esa opción es la marcada.
    fireEvent.click(botonPorAtender());
    expect(textoDe(desplegableEstado())).toBe("Estado: Por atender");
    expect(desplegableEstado()).toHaveAttribute("title", "Estado: Por atender");
    fireEvent.click(desplegableEstado());
    expect(await screen.findByRole("option", { name: OPCION_POR_ATENDER })).toHaveAttribute("data-state", "checked");
    // Otro estado en el desplegable suelta el botón…
    fireEvent.click(screen.getByRole("option", { name: "Confirmada" }));
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    expect(botonPorAtender()).toHaveAttribute("aria-pressed", "false");
    expect(clientes(tabla)).toEqual(["Carlos Confirmado"]);

    // … y elegir «Por atender (…)» en el desplegable lo pulsa.
    await elegirOpcion(desplegableEstado(), OPCION_POR_ATENDER);
    expect(botonPorAtender()).toHaveAttribute("aria-pressed", "true");
    expect(clientes(tabla)).toHaveLength(4);
  });

  it("se combina con el canal y con «Hoy», y la cifra los sigue", async () => {
    const { tabla } = await montar(conSolicitudes());

    // Web: solo la pendiente de la web (las solicitudes son del teléfono).
    await elegirOpcion(desplegableCanal(), /Web/);
    expect(cifraDelBoton()).toBe("1");
    fireEvent.click(botonPorAtender());
    expect(clientes(tabla)).toEqual(["Pepa PendienteWeb"]);

    // Teléfono: la pendiente de hoy y las dos solicitudes sin resolver.
    await elegirOpcion(desplegableCanal(), /Tel/);
    expect(cifraDelBoton()).toBe("3");
    expect(clientes(tabla)).toEqual(["Familia Ballester", "Grupo Contactado", "Ana Pendiente"]);

    // Y además «Hoy»: solo la de hoy (las solicitudes y la de la web son de mañana).
    fireEvent.click(screen.getByRole("button", { name: "Hoy" }));
    expect(cifraDelBoton()).toBe("1");
    expect(clientes(tabla)).toEqual(["Ana Pendiente"]);
    expect(botonPorAtender()).toHaveAttribute("aria-pressed", "true");
  });

  it("se combina con la búsqueda, y la cifra la sigue", async () => {
    const { tabla } = await montar(conSolicitudes());

    fireEvent.change(buscador(), { target: { value: "Ballester" } });
    expect(cifraDelBoton()).toBe("1");
    expect(botonPorAtender()).toHaveAccessibleName("Por atender 1 reserva o solicitud");
    fireEvent.click(botonPorAtender());
    expect(clientes(tabla)).toEqual(["Familia Ballester"]);

    // Una búsqueda que solo casa con lo que NO está pendiente: nada.
    fireEvent.change(buscador(), { target: { value: "Carlos" } });
    expect(cifraDelBoton()).toBe("0");
    expect(clientes(tabla)).toEqual([]);
  });

  it("la cifra se cuenta SIN el filtro de estado, como las del timeline: elegir otro estado no la cambia", async () => {
    await montar(conSolicitudes());

    await elegirOpcion(desplegableEstado(), "Confirmada");
    expect(cifraDelBoton()).toBe("4");
    fireEvent.click(pasoDelTimeline("Cancelada"));
    expect(cifraDelBoton()).toBe("4");
    await elegirOpcion(desplegableEstado(), "Solicitudes cerradas");
    expect(cifraDelBoton()).toBe("4");
  });

  it("el paso «Pendiente» del timeline sigue enseñando SOLO las reservas pendientes, sin solicitudes, y no pulsa el botón", async () => {
    const { tabla } = await montar(conSolicitudes());

    fireEvent.click(pasoDelTimeline("Pendiente"));

    expect(clientes(tabla)).toEqual(["Pepa PendienteWeb", "Ana Pendiente"]);
    expect(botonPorAtender()).toHaveAttribute("aria-pressed", "false");
    expect(textoDe(desplegableEstado())).toBe("Estado: Pendiente");

    // Y con «Por atender» puesto, ningún paso del timeline sale pulsado (no es uno de sus estados).
    fireEvent.click(botonPorAtender());
    expect(pulsadosDelTimeline()).toEqual([]);
    expect(clientes(tabla)).toHaveLength(4);
  });

  it("sin nada por atender la cifra es 0, el botón sigue disponible y la lista dice que no hay nada por atender", async () => {
    supa.filas = [reserva("c", "confirmada", "Carlos Confirmado")];
    const { tabla } = await montar(conSolicitudes([solicitudDe("sol-resuelta", "resuelta", "Grupo Resuelto")]));

    expect(cifraDelBoton()).toBe("0");
    expect(botonPorAtender()).toBeEnabled();
    fireEvent.click(botonPorAtender());

    expect(botonPorAtender()).toHaveAttribute("aria-pressed", "true");
    expect(clientes(tabla)).toEqual([]);
    expect(tabla).toHaveTextContent("No hay nada por atender: ninguna reserva pendiente ni solicitud sin resolver");
  });

  it("con más filtros puestos, la lista vacía de «Por atender» lo dice («con los filtros aplicados»)", async () => {
    const { tabla } = await montar(conSolicitudes());

    fireEvent.click(botonPorAtender());
    fireEvent.change(buscador(), { target: { value: "nadie-se-llama-asi" } });

    expect(tabla).toHaveTextContent(
      "No hay nada por atender con los filtros aplicados: ninguna reserva pendiente ni solicitud sin resolver",
    );
  });
});

// La Lista lee TODO el histórico por lotes de 1.000 (2026-10-01). PostgREST corta cada petición a 1000 filas y la
// consulta de antes no paginaba: con 1.241 reservas desaparecían las 241 más antiguas, sin error. Aquí el doble de
// Supabase aplica `order`, `range`, el recuento y el tope de 1000 filas, así que lo que se prueba es la consulta de
// verdad (`leerReservasLista`) puesta en la pantalla.
describe("ListaReservasAvanzada · lee todo el histórico por lotes", () => {
  const ESTADOS_VARIOS = ["confirmada", "pendiente", "completada", "cancelada", "no_show", "verificada"];
  /**
   * `n` reservas repartidas en 14 meses hacia atrás (de 0 a 419 días antes de hoy, a tres horas). La lista va de la
   * más reciente a la más antigua, así que las últimas en llegar son las más antiguas: justo lo que una consulta
   * cortada a 1000 filas dejaba fuera.
   */
  const historico = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      ...reserva(`h-${String(i).padStart(5, "0")}`, ESTADOS_VARIOS[i % ESTADOS_VARIOS.length], `Cliente ${i}`),
      fecha: format(addDays(new Date(), -(i % 420)), "yyyy-MM-dd"),
      hora: ["13:00:00", "14:30:00", "21:00:00"][i % 3],
    }));

  const cederTurno = (ms = 0) => new Promise<void>((resolver) => setTimeout(resolver, ms));
  /** Una promesa que se resuelve cuando el test quiere: retiene una petición en vuelo. */
  const diferido = () => {
    let resolver!: () => void;
    const promesa = new Promise<void>((ok) => {
      resolver = ok;
    });
    return { promesa, resolver };
  };

  /** `console.error`: se silencia (un error real lo escribe, y es lo que se comprueba) y se mira qué se registró. */
  let registro: MockInstance;
  /** Lo que la lista ha registrado de la CARGA (`console.error(error)`: un objeto), sin el ruido de React (avisos de `act`…, que son texto). */
  const registrosDeCarga = () => registro.mock.calls.filter(([primero]) => typeof primero !== "string");
  beforeEach(() => {
    registro = vi.spyOn(console, "error").mockImplementation(() => {});
    // Aquí SÍ se ordena como el servidor (`fecha` desc, `hora` asc, `id`): los lotes cortan por ese orden.
    supa.lecturas.opciones.conservarOrdenDeLaTabla = false;
  });
  afterEach(() => {
    registro.mockRestore();
  });

  const ERROR_REAL = { code: "57014", message: "canceling statement due to statement timeout" };
  const hayErrorDeCarga = () => screen.findByText(/No se han podido cargar el listado de reservas/);

  // ── Todas las reservas ─────────────────────────────────────────────────────

  it("con 1.241 reservas (más de las 1.000 que corta PostgREST) la Lista las recibe TODAS, también las más antiguas", async () => {
    supa.filas = historico(1241);

    const { client } = await montar();

    const enCache = client.getQueryData<Array<{ id: string; fecha: string }>>(["reservas-lista"])!;
    expect(enCache).toHaveLength(1241);
    expect(new Set(enCache.map((r) => r.id)).size).toBe(1241);
    // Las más antiguas (las que una consulta de 1.000 dejaba fuera) están: son las dos del día más lejano.
    const masAntigua = format(addDays(new Date(), -419), "yyyy-MM-dd");
    expect(enCache.filter((r) => r.fecha === masAntigua).map((r) => r.id).sort()).toEqual(["h-00419", "h-00839"]);
    // Y la pantalla las cuenta todas: la paginación dice 1.242 filas (las 1.241 reservas y la solicitud del bot).
    expect(screen.getByText(/^Mostrando/)).toHaveTextContent("Mostrando 1–50 de 1242");
  });

  it("la consulta pide dos lotes de la MISMA consulta: `select(\"*\")`, sin filtros, `fecha` desc, `hora` asc y `id`, el recuento solo en el primero", async () => {
    supa.filas = historico(1241);

    await montar();

    const lotes = supa.lecturas.peticiones;
    expect(lotes.map((p) => p.rango)).toEqual([[0, 999], [1000, 1240]]);
    expect(lotes.map((p) => p.contar)).toEqual([true, false]);
    expect(supa.cargas).toHaveBeenCalledTimes(2);
    for (const p of lotes) {
      expect(p.tabla).toBe("reservas");
      expect(p.columnas).toBe("*");
      // Ni por estado, ni por fecha, ni por negocio: la Lista los filtra en pantalla.
      expect(p.filtros).toEqual([]);
      expect(p.orden).toEqual([
        { columna: "fecha", ascendente: false },
        { columna: "hora", ascendente: true },
        { columna: "id", ascendente: true },
      ]);
      // La señal de cancelación de TanStack Query llega a cada lote.
      expect(p.signal).toBeInstanceOf(AbortSignal);
    }
    expect(new Set(lotes.map((p) => p.signal)).size).toBe(1);
  });

  it("la caché `reservas-lista` es un ARRAY de reservas, no el resultado de la lectura (los parches optimistas dependen de ello)", async () => {
    const { client } = await montar();

    const enCache = client.getQueryData<unknown>(["reservas-lista"]);
    expect(Array.isArray(enCache)).toBe(true);
    expect((enCache as Array<{ id: string }>).map((r) => r.id).sort()).toEqual(supa.filas.map((f) => String(f.id)).sort());
  });

  // ── Errores reales: avisan UNA vez ─────────────────────────────────────────

  it("un error REAL de la consulta avisa UNA vez, lo registra y la Lista dice que no se ha podido cargar", async () => {
    supa.lecturas.opciones.fallar = () => ERROR_REAL;

    const { client } = renderizar();

    expect(await hayErrorDeCarga()).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith("Error al cargar reservas");
    expect(registro).toHaveBeenCalledWith(ERROR_REAL);
    expect(client.getQueryData(["reservas-lista"])).toBeUndefined();
  });

  it("un error real en el SEGUNDO lote también avisa una sola vez y no deja una lista a medias", async () => {
    supa.filas = historico(1241);
    supa.lecturas.opciones.fallar = (p) => (p.rango?.[0] === 1000 ? ERROR_REAL : undefined);

    const { client } = renderizar();

    expect(await hayErrorDeCarga()).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(registro).toHaveBeenCalledWith(ERROR_REAL);
    expect(client.getQueryData(["reservas-lista"])).toBeUndefined();
    expect(screen.queryByText(/^Mostrando/)).not.toBeInTheDocument();
    expect(document.querySelector("table")).toBeNull();
  });

  // ── Lo que NO es un error de carga: no avisa ni registra ───────────────────

  it("un ABORTO (`cancelQueries` con la carga en vuelo) no avisa ni registra: la lectura se corta y nada más", async () => {
    supa.filas = historico(1241);
    const puerta = diferido();
    supa.lecturas.opciones.antesDeResponder = (p) => (p.numero === 1 ? puerta.promesa : undefined);
    const { client } = renderizar();
    await waitFor(() => expect(supa.lecturas.peticiones).toHaveLength(1));
    const senal = supa.lecturas.peticiones[0].signal!;

    await act(async () => {
      await client.cancelQueries({ queryKey: ["reservas-lista"] });
    });
    expect(senal.aborted).toBe(true);
    // El lote en vuelo vuelve abortado: `AbortError`, en el error de la respuesta, como en supabase-js.
    await act(async () => {
      puerta.resolver();
      await cederTurno(30);
    });

    expect(toast.error).not.toHaveBeenCalled();
    expect(registrosDeCarga()).toEqual([]);
    expect(supa.lecturas.peticiones).toHaveLength(1); // y no se pide ningún lote más
  });

  it("un aborto ENTRE lotes (la lectura vieja ya ha servido uno y iba a pedir otro) tampoco avisa ni registra", async () => {
    supa.filas = historico(1241);
    // Sin recuento se lee en serie: tras cada lote decide si pide otro. El 2.º queda en vuelo y NO se aborta solo.
    supa.lecturas.opciones.sinRecuento = true;
    supa.lecturas.opciones.noAbortarEnVuelo = true;
    const puerta = diferido();
    supa.lecturas.opciones.antesDeResponder = (p) => (p.numero === 2 ? puerta.promesa : undefined);
    const { client } = renderizar();
    await waitFor(() => expect(supa.lecturas.peticiones).toHaveLength(2));

    await act(async () => {
      await client.cancelQueries({ queryKey: ["reservas-lista"] });
    });
    // El 2.º lote termina bien; al ir a pedir el 3.º, la lectura ve la cancelación y lanza `signal.reason`.
    await act(async () => {
      puerta.resolver();
      await cederTurno(30);
    });

    expect(supa.lecturas.peticiones).toHaveLength(2); // el 3.º no se pidió
    expect(toast.error).not.toHaveBeenCalled();
    expect(registrosDeCarga()).toEqual([]);
  });

  it("una ACCIÓN que pilla una recarga en vuelo (el parche optimista cancela `reservas-lista`) no la da por «error de carga»", async () => {
    const { tabla, client } = await montar();
    // Una recarga (p. ej. por el foco de la ventana) queda en vuelo, retenida en su primer lote.
    const puerta = diferido();
    const numeroDeLaRecarga = supa.lecturas.peticiones.length + 1;
    supa.lecturas.opciones.antesDeResponder = (p) => (p.numero === numeroDeLaRecarga ? puerta.promesa : undefined);
    act(() => {
      void client.invalidateQueries({ queryKey: ["reservas-lista"] });
    });
    await waitFor(() => expect(supa.lecturas.peticiones).toHaveLength(numeroDeLaRecarga));
    const senalDeLaRecarga = supa.lecturas.peticiones[numeroDeLaRecarga - 1].signal!;

    // «Aceptar»: el ejecutor de acciones empieza cancelando las consultas de las listas, entre ellas esta.
    fireEvent.click(botonesDeFila(filaDe(tabla, "Ana Pendiente"))[0]);
    await waitFor(() => expect(senalDeLaRecarga.aborted).toBe(true));
    await waitFor(() => expect(supa.update).toHaveBeenCalledWith({ estado: "verificada" }));
    await act(async () => {
      puerta.resolver();
      await cederTurno(30);
    });

    expect(toast.error).not.toHaveBeenCalled();
    expect(registrosDeCarga()).toEqual([]);
  });

  it("`ErrorLecturaInconsistente` (los datos cambiaron entre lotes) NO avisa ni registra: la Lista lo dice en su estado de error", async () => {
    supa.filas = historico(1241);
    // El 2.º lote llega corto (200 de las 241): lo leído no es lo que el servidor contó.
    supa.lecturas.opciones.recortar = (p) => (p.rango?.[0] === 1000 ? 200 : undefined);

    const { client } = renderizar();

    expect(await hayErrorDeCarga()).toBeInTheDocument();
    expect(client.getQueryState(["reservas-lista"])?.error).toBeInstanceOf(ErrorLecturaInconsistente);
    expect(screen.getByText(/Lectura por lotes inconsistente/)).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
    expect(registrosDeCarga()).toEqual([]);
  });

  it("con un reintento, una lectura inconsistente se recupera sola: la Lista enseña las 1.241 y no hubo ningún aviso", async () => {
    supa.filas = historico(1241);
    // Solo el primer intento sale mal: su 2.º lote llega corto.
    supa.lecturas.opciones.recortar = (p) => (p.numero === 2 ? 200 : undefined);

    const { client } = await montar({}, 1);

    expect(client.getQueryData<unknown[]>(["reservas-lista"])).toHaveLength(1241);
    expect(screen.getByText(/^Mostrando/)).toHaveTextContent("de 1242");
    expect(supa.lecturas.peticiones).toHaveLength(4); // los 2 lotes del primer intento y los 2 del reintento
    expect(toast.error).not.toHaveBeenCalled();
    expect(registrosDeCarga()).toEqual([]);
  });
});

describe("ListaReservasAvanzada · el Reservado (sala privada) está fuera de aforo", () => {
  beforeEach(() => {
    supa.espacios = [
      { id: "esp-comedor", nombre: "Comedor", activa: true, caracteristicas: { marca: "casa_tomas" } },
      { id: "esp-reservado", nombre: "Reservado", activa: true, caracteristicas: { marca: "casa_tomas", privada: true } },
    ];
    supa.filas = [
      reserva("res-comedor", "confirmada", "Carmen Comedor", "esp-comedor"),
      reserva("res-reservado", "confirmada", "Rosa Reservada", "esp-reservado"),
      reserva("res-sin-sala", "confirmada", "Sara SinSala"),
    ];
  });

  it("ninguna reserva lleva la etiqueta «Fuera de aforo»: el Reservado solo se ve en Hoy (dueño, 2026-10-15)", async () => {
    const { tabla } = await montar();

    expect(within(filaDe(tabla, "Rosa Reservada")).queryByTestId("etiqueta-fuera-de-aforo")).not.toBeInTheDocument();
    expect(within(filaDe(tabla, "Carmen Comedor")).queryByTestId("etiqueta-fuera-de-aforo")).not.toBeInTheDocument();
  });

  it("sin salas privadas (o con la sala desactivada) no hay etiqueta", async () => {
    supa.espacios = [
      { id: "esp-reservado", nombre: "Reservado", activa: false, caracteristicas: { marca: "casa_tomas", privada: true } },
    ];
    const { tabla } = await montar();

    expect(within(tabla).queryByTestId("etiqueta-fuera-de-aforo")).not.toBeInTheDocument();
  });
});

// Lo que pidió el dueño el 2026-10-06 mirando la Lista a 1280×711 (150 % de zoom): «Perdemos mucho espacio
// vertical… quita también lo de "1239 reservas · 2 solicitudes"… hay que hacer que NO haya scroll horizontal
// dentro de la tabla de reservas… la página sigue teniendo scroll vertical: que no lo haya».
//   · Sin el recuento de la barra de filtros (la cifra de «Por atender» sigue).
//   · El bloque de la lista (barra de «N seleccionadas», tabla o tarjetas, paginación) mide lo que queda de
//     ventana, como «Hoy» (`useAlturaDisponible`); lo de arriba queda fijo y solo se desplazan las filas, que
//     conservan su posición al refrescar o al hacer algo y vuelven arriba al cambiar de filtro o de página.
//   · Sin scroll horizontal: reparto FIJO de columnas; Cliente se queda con lo que sobra.
// jsdom no calcula layout: las medidas se dan a mano (el bloque empieza en y = 200, dentro de un <main> con 24 px
// de relleno abajo) y lo demás se comprueba por estructura, como en `PanelAsignacion.altura.test.tsx`. Que todo
// quepa de verdad se mide en el navegador (capturas del 2026-10-06).
describe("ListaReservasAvanzada · más alto para las filas: sin recuento, sin scroll de página ni horizontal", { timeout: 30_000 }, () => {
  const original = { innerHeight: window.innerHeight };
  function altoVentana(px: number) {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: px });
  }
  /** El bloque de la lista empieza en y = 200; el resto de nodos, con tamaño pero arriba del todo. */
  function conLayout(alto: number) {
    altoVentana(alto);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const top = this.dataset.testid === "lista-bloque" ? 200 : 0;
      return { top, bottom: top + 100, left: 0, right: 100, width: 100, height: 100, x: 0, y: top, toJSON: () => ({}) };
    });
  }
  /** Como `montar`, pero dentro de un <main> con el relleno inferior del layout (24 px, `sm:p-6`). */
  async function montarEnMain() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } } });
    const vista = render(
      <QueryClientProvider client={client}>
        <main style={{ paddingBottom: 24 }}>
          <ListaReservasAvanzada solicitudesState={estadoSolicitudes} />
        </main>
      </QueryClientProvider>,
    );
    const tabla = await waitFor(() => {
      const t = vista.container.querySelector("table");
      if (!t || !t.querySelector("tbody tr td")) throw new Error("tabla sin filas todavía");
      return t;
    });
    return { ...vista, client, tabla };
  }
  const bloque = () => screen.getByTestId("lista-bloque");
  /** El contenedor con scroll de las tarjetas (< 1024 px; en jsdom se pinta a la vez que la tabla). */
  const tarjetas = () => bloque().querySelector<HTMLElement>(":scope > .lg\\:hidden")!;
  const buscador = () => screen.getByRole("textbox", { name: "Buscar reservas y solicitudes" });

  beforeAll(() => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
    window.HTMLElement.prototype.releasePointerCapture = vi.fn();
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  });
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    altoVentana(original.innerHeight);
    window.localStorage.clear();
  });

  // ── Lo que se quita ─────────────────────────────────────────────────────────

  it("sin el recuento «N reservas · M solicitudes» en la barra de filtros; «Por atender» conserva su cifra", async () => {
    await montar();

    expect(screen.queryByText(/^\d+ reservas( · \d+ solicitud(es)?)?$/)).not.toBeInTheDocument();
    // Lo que hay por atender sigue a la vista: 1 reserva pendiente + 1 solicitud sin resolver.
    expect(screen.getByRole("button", { name: /^Por atender/ })).toHaveAccessibleName("Por atender 2 reservas y solicitudes");
  });

  // ── Sin scroll de página: el bloque de la lista mide lo que queda ──────────

  it("el bloque de la lista mide justo lo que queda de ventana: alto visible − su posición − relleno inferior del <main>", async () => {
    conLayout(800);
    await montarEnMain();

    // 800 − 200 − 24: termina en el borde inferior del <main>, sin scroll de página.
    expect(bloque()).toHaveAttribute("data-altura-fija", "576");
    expect(bloque().style.height).toBe("576px");
    // Una columna con su alto propio (`flex-none`: con `flex-1`, Chrome ignoraría el `height`).
    expect(bloque()).toHaveClass("flex", "flex-col", "flex-none");
  });

  it("lo de arriba (timeline y filtros) queda FUERA del bloque y no encoge; dentro, la tabla se queda con lo que sobra y desplaza sus filas por dentro", async () => {
    conLayout(800);
    const { tabla } = await montarEnMain();

    const timeline = screen.getByRole("region", { name: /Cómo avanza una reserva/ });
    const filtros = buscador().closest(".rounded-lg") as HTMLElement;
    for (const fijo of [timeline, filtros]) {
      expect(bloque()).not.toContainElement(fijo);
      expect(fijo).toHaveClass("shrink-0");
    }
    // La tabla: su tarjeta crece hasta llenar el bloque y el contenedor de la tabla la llena y hace scroll.
    const scroller = tabla.parentElement as HTMLElement;
    const contenido = scroller.parentElement as HTMLElement;
    const tarjetaTabla = contenido.parentElement as HTMLElement;
    expect(bloque()).toContainElement(tabla);
    expect(tarjetaTabla).toHaveClass("flex-1", "min-h-0");
    expect(contenido).toHaveClass("h-full", "[&>div]:h-full");
    expect(scroller).toHaveClass("overflow-auto");
    // La cabecera de columnas, pegada arriba dentro de ese scroll.
    expect(tabla.querySelector("thead")).toHaveClass("sticky", "top-0");
    // Las tarjetas (< 1024 px) también se desplazan por dentro, como el kanban de Hoy en el móvil.
    expect(tarjetas()).toHaveClass("min-h-0", "flex-1", "overflow-y-auto");
  });

  it("sin medida (jsdom, primer pintado) se queda como antes: sin alto fijo y con el tope de siempre en la tabla", async () => {
    const { tabla } = await montar();

    expect(bloque()).not.toHaveAttribute("data-altura-fija");
    expect(bloque().style.height).toBe("");
    expect(tabla.parentElement!.parentElement).toHaveClass("[&>div]:max-h-[calc(100vh-17rem)]");
    expect(tarjetas()).not.toHaveClass("overflow-y-auto");
  });

  it("se recalcula al redimensionar la ventana y no baja del suelo de 280 px (entonces, y solo entonces, la página hace scroll)", async () => {
    conLayout(800);
    await montarEnMain();
    expect(bloque()).toHaveAttribute("data-altura-fija", "576");

    act(() => {
      altoVentana(700);
      window.dispatchEvent(new Event("resize"));
    });
    expect(bloque()).toHaveAttribute("data-altura-fija", "476");

    act(() => {
      altoVentana(420);
      window.dispatchEvent(new Event("resize"));
    });
    // 420 − 200 − 24 = 196 < 280: se queda en el suelo.
    expect(bloque()).toHaveAttribute("data-altura-fija", "280");
  });

  it("la barra de «N seleccionadas» va DENTRO del bloque, encima de la tabla y a su alto: al aparecer no mueve el bloque", async () => {
    conLayout(800);
    const { tabla } = await montarEnMain();

    fireEvent.click(within(filaDe(tabla, "Ana Pendiente")).getByRole("checkbox"));

    const barra = screen.getByRole("button", { name: "Quitar selección" }).closest(".rounded-lg") as HTMLElement;
    expect(bloque()).toContainElement(barra);
    expect(barra).toHaveClass("shrink-0");
    expect(barra.compareDocumentPosition(tabla) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bloque()).toHaveAttribute("data-altura-fija", "576");
  });

  // ── Sin scroll horizontal ───────────────────────────────────────────────────

  it("la tabla es de reparto FIJO al ancho de su contenedor: cada columna con su ancho menos Cliente, que se queda lo que sobra", async () => {
    const { tabla } = await montar();

    expect(tabla).toHaveClass("table-fixed", "w-full");
    expect([...tabla.classList].some((c) => c.startsWith("min-w"))).toBe(false);
    const conAncho = [...tabla.querySelectorAll("thead th")].map((th) => [...th.classList].some((c) => /^w-\[/.test(c)));
    // Acciones, Fecha, Cliente (sin ancho), Pax, Canal, Estado.
    expect(conAncho).toEqual([true, true, false, true, true, true]);
    // Lo largo de Cliente se recorta con «…» y va entero en el `title`.
    const fila = filaDe(tabla, "Ana Pendiente");
    expect(within(fila).getByText("Ana Pendiente")).toHaveClass("truncate");
    expect(within(fila).getByText("Ana Pendiente")).toHaveAttribute("title", "Ana Pendiente");
    expect(within(fila).getByText("+34 600 111 222")).toHaveClass("truncate");
    // Con nombre accesible: el título que había encima de la lista se quitó.
    expect(tabla).toHaveAccessibleName("Reservas y solicitudes");
  });

  it("la acción principal mide lo mismo en todas las filas también con dedo (la columna de acciones cuenta con ese ancho)", async () => {
    const { tabla } = await montar();

    const principales = ([...tabla.querySelectorAll("tbody tr")] as HTMLElement[]).map((f) => botonesDeFila(f)[0]);
    expect(principales.map((b) => b.textContent?.trim())).toEqual(
      expect.arrayContaining(["Aceptar", "Confirmar", "Convertir"]),
    );
    for (const b of principales) {
      expect(b).toHaveClass("w-[76px]", "xl:w-[88px]", "pointer-coarse:w-[6.25rem]", "pointer-coarse:px-2");
      expect(b).not.toHaveClass("pointer-coarse:w-auto");
    }
  });

  // ── La posición de las filas ────────────────────────────────────────────────

  it("al refrescar los datos (otra lectura de `reservas-lista`, con algo nuevo) las filas conservan su posición", async () => {
    const { tabla, client } = await montar();
    const scroller = tabla.parentElement as HTMLElement;
    scroller.scrollTop = 300;
    tarjetas().scrollTop = 120;
    // Mientras tanto, otro dispositivo ha dado de alta una reserva: la relectura trae datos DISTINTOS (con los
    // mismos, TanStack Query conservaría la misma lista y no se probaría nada).
    supa.filas = [...supa.filas, reserva("res-nueva", "confirmada", "Zoe Nueva")];

    await act(async () => {
      await client.invalidateQueries({ queryKey: ["reservas-lista"] });
    });
    await waitFor(() => expect(within(tabla).getByText("Zoe Nueva")).toBeInTheDocument());

    // El mismo contenedor (no se ha vuelto a montar) y en el mismo sitio.
    expect(supa.cargas).toHaveBeenCalledTimes(2);
    expect(tabla.parentElement).toBe(scroller);
    expect(scroller.scrollTop).toBe(300);
    expect(tarjetas().scrollTop).toBe(120);
  });

  it("al hacer algo en una fila («Aceptar»: parche al instante y relectura) tampoco se mueven", async () => {
    const { tabla } = await montar();
    const scroller = tabla.parentElement as HTMLElement;
    scroller.scrollTop = 300;

    fireEvent.click(botonesDeFila(filaDe(tabla, "Ana Pendiente"))[0]);
    await waitFor(() => expect(supa.update).toHaveBeenCalledWith({ estado: "verificada" }));
    await waitFor(() => expect(supa.cargas.mock.calls.length).toBeGreaterThanOrEqual(2));

    expect(scroller.scrollTop).toBe(300);
  });

  it("al cambiar de filtro (búsqueda, «Por atender», un estado del timeline, «Hoy») vuelven arriba, en la tabla y en las tarjetas", async () => {
    const { tabla } = await montar();
    const scroller = tabla.parentElement as HTMLElement;
    const bajar = () => {
      scroller.scrollTop = 300;
      tarjetas().scrollTop = 200;
    };
    const arriba = () => [scroller.scrollTop, tarjetas().scrollTop];

    bajar();
    fireEvent.change(buscador(), { target: { value: "a" } });
    expect(arriba()).toEqual([0, 0]);

    bajar();
    fireEvent.click(screen.getByRole("button", { name: /^Por atender/ }));
    expect(arriba()).toEqual([0, 0]);

    bajar();
    fireEvent.click(within(screen.getByRole("region", { name: /Cómo avanza una reserva/ })).getByRole("button", { name: "Confirmada" }));
    expect(arriba()).toEqual([0, 0]);

    bajar();
    fireEvent.click(screen.getByRole("button", { name: "Hoy" }));
    expect(arriba()).toEqual([0, 0]);
  });

  // Pesado a propósito (50 filas por página, en tabla y en tarjetas).
  it("al cambiar de página también vuelven arriba", async () => {
    supa.filas = Array.from({ length: 55 }, (_, i) => reserva(`p-${i}`, "pendiente", `Pen ${String(i).padStart(2, "0")}`));
    const { tabla } = await montar();
    const scroller = tabla.parentElement as HTMLElement;
    scroller.scrollTop = 900;
    tarjetas().scrollTop = 700;

    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));

    expect(screen.getByText(/Página 2 de 2/)).toBeInTheDocument();
    expect([scroller.scrollTop, tarjetas().scrollTop]).toEqual([0, 0]);
  });
});
