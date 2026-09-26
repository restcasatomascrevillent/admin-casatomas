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
 * Lo de "cero scroll horizontal" no se puede comprobar en jsdom (no calcula
 * diseño): eso se mide en el navegador con datos reales.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { format, addDays } from "date-fns";
import type { SolicitudPendiente } from "@/hooks/useSolicitudesPendientes";

const supa = vi.hoisted(() => ({
  update: vi.fn(),
  eq: vi.fn(),
  filas: [] as Record<string, unknown>[],
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
  FormularioReserva: () => null,
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

const reserva = (id: string, estado: string, nombre: string) => ({
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
  espacio_id: null,
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

async function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const vista = render(
    <QueryClientProvider client={client}>
      <ListaReservasAvanzada solicitudesState={estadoSolicitudes} />
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

/** Etiquetas de los botones de la celda de acciones de una fila. */
const accionesDeFila = (fila: HTMLElement) => {
  const celda = fila.querySelector("td")!;
  return [...celda.querySelectorAll("button")]
    .filter((b) => b.getAttribute("role") !== "checkbox")
    .map((b) => ({
      etiqueta: b.getAttribute("aria-label") ?? b.textContent?.trim() ?? "",
      deshabilitado: b.hasAttribute("disabled"),
    }));
};

beforeEach(() => {
  vi.clearAllMocks();
  supa.filas = [
    reserva("res-pendiente", "pendiente", "Ana Pendiente"),
    reserva("res-verificada", "verificada", "Berta Verificada"),
    reserva("res-confirmada", "confirmada", "Carlos Confirmado"),
    reserva("res-cancelada", "cancelada", "Diana Cancelada"),
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
    expect(filas.length).toBe(5); // 4 reservas + 1 solicitud

    const cuantas = filas.map((f) => accionesDeFila(f).length);
    expect(new Set(cuantas).size).toBe(1);
    expect(cuantas[0]).toBe(5);

    // La segunda acción de cada fila es siempre "Verificar", la tercera
    // "Gestionar", la cuarta "Cancelar" y la quinta "lista negra".
    for (const fila of filas) {
      const acciones = accionesDeFila(fila);
      expect(acciones[1].etiqueta).toMatch(/^Verificar/);
      expect(acciones[2].etiqueta).toMatch(/^Gestionar/);
      expect(acciones[3].etiqueta).toMatch(/cancelada|Cancelar|permiso|Descartar/i);
      expect(acciones[4].etiqueta).toMatch(/lista negra/i);
    }
  });

  it("lo que no aplica a una fila sale deshabilitado, no se quita", async () => {
    const { tabla } = await montar();
    const porNombre = (texto: string) =>
      ([...tabla.querySelectorAll("tbody tr")] as HTMLElement[]).find((f) => f.textContent?.includes(texto))!;

    // Reserva pendiente: puede aceptarse y verificarse; no se gestiona.
    const pendiente = accionesDeFila(porNombre("Ana Pendiente"));
    expect(pendiente[0].etiqueta).toBe("Aceptar");
    expect(pendiente[0].deshabilitado).toBe(false);
    expect(pendiente[1].deshabilitado).toBe(false); // verificar
    expect(pendiente[2].deshabilitado).toBe(true); // gestionar (solo solicitudes)

    // Verificada: la principal pasa a "Confirmar" y ya no se verifica.
    const verificada = accionesDeFila(porNombre("Berta Verificada"));
    expect(verificada[0].etiqueta).toBe("Confirmar");
    expect(verificada[0].deshabilitado).toBe(false);
    expect(verificada[1].deshabilitado).toBe(true);

    // Confirmada: no hay nada que aceptar ni confirmar, pero el botón sigue ahí.
    const confirmada = accionesDeFila(porNombre("Carlos Confirmado"));
    expect(confirmada[0].deshabilitado).toBe(true);
    expect(confirmada[3].deshabilitado).toBe(false); // cancelar sí

    // Cancelada: tampoco se vuelve a cancelar.
    const cancelada = accionesDeFila(porNombre("Diana Cancelada"));
    expect(cancelada[3].deshabilitado).toBe(true);

    // Solicitud del bot: su acción principal es "Convertir" y se gestiona,
    // pero no se verifica, ni se cancela, ni se mete en la lista negra.
    const sol = accionesDeFila(porNombre("Familia Ballester"));
    expect(sol[0].etiqueta).toBe("Convertir");
    expect(sol[0].deshabilitado).toBe(false);
    expect(sol[1].deshabilitado).toBe(true);
    expect(sol[2].deshabilitado).toBe(false);
    expect(sol[3].deshabilitado).toBe(true);
    expect(sol[4].deshabilitado).toBe(true);
  });
});

describe("ListaReservasAvanzada · cancelar pide confirmación", () => {
  const abrirCancelacion = async () => {
    const { tabla } = await montar();
    const fila = ([...tabla.querySelectorAll("tbody tr")] as HTMLElement[]).find((f) =>
      f.textContent?.includes("Ana Pendiente"),
    )!;
    fireEvent.click(accionesBotones(fila)[3]);
    return await screen.findByRole("alertdialog");
  };
  const accionesBotones = (fila: HTMLElement) =>
    [...fila.querySelector("td")!.querySelectorAll("button")].filter((b) => b.getAttribute("role") !== "checkbox");

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
