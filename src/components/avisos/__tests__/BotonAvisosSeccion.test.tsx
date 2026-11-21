import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { BotonAvisosSeccion } from "@/components/avisos/BotonAvisosSeccion";

// Supabase falso: cuenta y lista de notificaciones_dashboard con los filtros que use el hook.
const bd = vi.hoisted(() => ({
  filas: [] as Record<string, unknown>[],
  /** Llamadas a la RPC marcar_avisos_revisados (11/11/2026: «Revisado» ya no es un UPDATE directo). */
  revisados: [] as { p_ids: string[] | null; p_tipos: string[] | null }[],
}));
// «Ver» en una reserva abre su ficha en un modal si se pueden editar reservas (11/11/2026, `useAbrirAviso`).
const permiso = vi.hoisted(() => ({ editaReservas: false }));
// Las reservas avisadas (12/11/2026: su estado; 17/11/2026, CAS-9: los datos para «Verificar»): sin consulta.
const reservasAvisadas = vi.hoisted(() => ({ estado: "pendiente" }));
vi.mock("@/hooks/useEstadosReservasAvisos", () => ({
  useEstadosReservasAvisos: () => new Map([["res-r1", reservasAvisadas.estado]]),
  useReservasAvisos: () =>
    new Map([["res-r1", { id: "res-r1", nombre: "Lucía", telefono: null, email: "lucia@x.test", fecha: "2026-12-01", hora: "21:00:00", numero_comensales: 2, estado: reservasAvisadas.estado, notas_cliente: null, espacio_id: null, canal: "web" }]]),
  EstadoReservaAviso: ({ aviso, estados }: { aviso: { referencia_id?: string | null }; estados: Map<string, string> }) =>
    aviso.referencia_id && estados.get(aviso.referencia_id) ? <span data-testid="estado-reserva-aviso">{estados.get(aviso.referencia_id)}</span> : null,
}));
vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: () => ({ canAccess: permiso.editaReservas, loading: false }),
}));
// «Verificar» desde el aviso usa la acción de siempre (correo al cliente): aquí se simula.
const acciones = vi.hoisted(() => ({ aceptar: vi.fn(async (_r: { id: string }) => ({ ok: true })) }));
vi.mock("@/hooks/useAccionesServicioReserva", () => ({
  useAccionesServicioReserva: () => ({ aceptar: acciones.aceptar, estaEnCurso: () => false }),
}));
vi.mock("@/components/reservas/EditarReservaDialog", () => ({
  EditarReservaDialog: ({ reservaId }: { reservaId: string }) => <div data-testid="ficha-reserva">{reservaId}</div>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (head = false) => {
    const filtros: [string, string, unknown][] = [];
    let rango: [number, number] | null = null;
    const api: Record<string, unknown> = {
      eq: (c: string, v: unknown) => { filtros.push(["eq", c, v]); return api; },
      in: (c: string, v: unknown) => { filtros.push(["in", c, v]); return api; },
      order: () => api,
      range: (a: number, b: number) => { rango = [a, b]; return api; },
      then: (ok: (r: unknown) => unknown) => {
        let filas = bd.filas.filter((f) => filtros.every(([op, c, v]) => (op === "eq" ? f[c] === v : (v as unknown[]).includes(f[c]))));
        if (rango) filas = filas.slice(rango[0], rango[1] + 1);
        return Promise.resolve(head ? { count: filas.length, error: null } : { data: filas, error: null }).then(ok);
      },
    };
    return api;
  };
  return {
    supabase: {
      from: () => ({
        select: (_c: string, opts?: { head?: boolean }) => consulta(opts?.head),
      }),
      rpc: (fn: string, args: { p_ids: string[] | null; p_tipos: string[] | null }) => {
        if (fn !== "marcar_avisos_revisados") throw new Error(`RPC inesperada: ${fn}`);
        bd.revisados.push(args);
        const marcadas = bd.filas.filter(
          (f) => !f.leida && (!args.p_ids || args.p_ids.includes(f.id as string)) && (!args.p_tipos || args.p_tipos.includes(f.tipo as string)),
        );
        for (const f of marcadas) f.leida = true;
        return Promise.resolve({ data: marcadas.length, error: null });
      },
    },
  };
});

const hoy = new Date().toISOString();
const aviso = (id: string, tipo: string, leida = false, extra: Record<string, unknown> = {}) =>
  ({ id, tipo, titulo: `Aviso ${id}`, mensaje: null, leida, created_at: hoy, referencia_tipo: null, referencia_id: null, ...extra });

const Ruta = () => <p data-testid="ruta">{useLocation().pathname + useLocation().search}</p>;
const pintar = (seccion: "reservas" | "facturas", inicio = "/inicio") =>
  render(
    <MemoryRouter initialEntries={[inicio]}>
      <BotonAvisosSeccion seccion={seccion} />
      <Routes><Route path="*" element={<Ruta />} /></Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  bd.revisados = [];
  reservasAvisadas.estado = "pendiente";
  acciones.aceptar.mockClear();
  bd.filas = [
    aviso("r1", "reserva_nueva", false, { referencia_tipo: "reserva", referencia_id: "res-r1" }),
    aviso("r2", "reserva_cancelada", false, { referencia_tipo: "reserva" }),
    aviso("r3", "reserva_nueva", true, { referencia_tipo: "reserva" }),
    // Ya no salen en el botón de Reservas (10/11/2026): solo nuevas y canceladas.
    aviso("s1", "solicitud_pendiente", false, { referencia_tipo: "solicitud" }),
    aviso("s2", "reserva_sin_asignar"),
    aviso("f1", "subida_precio"),
    aviso("o1", "instagram_encargo"),
  ];
});

describe("Botón «Avisos» de cada sección", () => {
  it("Reservas: rojo con el número de avisos de reservas sin revisar (no cuenta los de otras secciones)", async () => {
    pintar("reservas");
    const boton = await screen.findByRole("button", { name: "Avisos: 2 sin revisar" });
    expect(boton).toHaveTextContent("2");
  });

  it("Facturas: cuenta solo los suyos; sin pendientes, el botón no es rojo", async () => {
    pintar("facturas");
    expect(await screen.findByRole("button", { name: "Avisos: 1 sin revisar" })).toBeInTheDocument();
    bd.filas = bd.filas.filter((f) => f.id !== "f1");
    window.dispatchEvent(new Event("avisos-seccion-cambiados"));
    expect(await screen.findByRole("button", { name: "Avisos: ninguno sin revisar" })).toBeInTheDocument();
  });

  it("el modal filtra por estado y por tipo, y marca como revisados solo los de su sección", async () => {
    pintar("reservas");
    fireEvent.click(await screen.findByRole("button", { name: "Avisos: 2 sin revisar" }));
    const modal = await screen.findByRole("dialog", { name: /Avisos de reservas/ });
    await waitFor(() => expect(within(modal).getAllByRole("listitem")).toHaveLength(2));
    fireEvent.click(within(modal).getByRole("button", { name: "Todos" }));
    await waitFor(() => expect(within(modal).getAllByRole("listitem")).toHaveLength(3));
    fireEvent.click(within(modal).getByRole("button", { name: "Canceladas" }));
    await waitFor(() => expect(within(modal).getAllByRole("listitem")).toHaveLength(1));
    expect(within(modal).getByText("Aviso r2")).toBeInTheDocument();
    fireEvent.click(within(modal).getByRole("button", { name: "Marcar todos como revisados" }));
    await waitFor(() => expect(bd.revisados).toHaveLength(1));
    expect(bd.revisados[0]).toEqual({ p_ids: null, p_tipos: ["reserva_nueva", "reserva_cancelada"] });
    // Los de otras secciones (y los retirados) no se tocan.
    expect(bd.filas.filter((f) => !f.leida).map((f) => f.id)).toEqual(["s1", "s2", "f1", "o1"]);
    // El botón queda detrás del modal (aria-hidden): `hidden: true`.
    expect(await screen.findByRole("button", { name: "Avisos: ninguno sin revisar", hidden: true })).toBeInTheDocument();
  });

  it("«Revisado» marca el aviso con la RPC, lo quita de «Sin revisar» y baja el número", async () => {
    pintar("reservas");
    fireEvent.click(await screen.findByRole("button", { name: "Avisos: 2 sin revisar" }));
    const modal = await screen.findByRole("dialog", { name: /Avisos de reservas/ });
    fireEvent.click(await within(modal).findByRole("button", { name: "Marcar como revisado: Aviso r1" }));
    await waitFor(() => expect(within(modal).getAllByRole("listitem")).toHaveLength(1));
    expect(within(modal).queryByText("Aviso r1")).not.toBeInTheDocument();
    expect(bd.revisados).toEqual([{ p_ids: ["r1"], p_tipos: null }]);
    expect(await screen.findByRole("button", { name: "Avisos: 1 sin revisar", hidden: true })).toBeInTheDocument();
    // En «Todos» sigue saliendo, marcado como revisado.
    fireEvent.click(within(modal).getByRole("button", { name: "Todos" }));
    await waitFor(() => expect(within(modal).getAllByRole("listitem")).toHaveLength(3));
    expect(within(modal).getByText("Aviso r1").closest("li")).toHaveTextContent("Revisado");
    expect(within(modal).queryByRole("button", { name: "Marcar como revisado: Aviso r1" })).not.toBeInTheDocument();
  });

  it("si la RPC falla, el aviso vuelve a «sin revisar» y se avisa", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    const original = supabase.rpc;
    (supabase as unknown as { rpc: unknown }).rpc = () => Promise.resolve({ data: null, error: { message: "caída" } });
    try {
      pintar("reservas");
      fireEvent.click(await screen.findByRole("button", { name: "Avisos: 2 sin revisar" }));
      const modal = await screen.findByRole("dialog", { name: /Avisos de reservas/ });
      fireEvent.click(await within(modal).findByRole("button", { name: "Marcar como revisado: Aviso r1" }));
      expect(await within(modal).findByRole("button", { name: "Marcar como revisado: Aviso r1" })).toBeInTheDocument();
      expect(within(modal).getAllByRole("listitem")).toHaveLength(2);
    } finally {
      (supabase as unknown as { rpc: unknown }).rpc = original;
    }
  });

  it("Reservas sin permiso de editar: «Ver» lleva al origen y cierra el modal, pero NO da el aviso por revisado (CAS-9)", async () => {
    pintar("reservas");
    fireEvent.click(await screen.findByRole("button", { name: "Avisos: 2 sin revisar" }));
    const modal = await screen.findByRole("dialog");
    fireEvent.click(await within(modal).findByRole("button", { name: "Ver: Aviso r1" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("ruta")).toHaveTextContent("/reservas?tab=reservas");
    expect(bd.revisados).toEqual([]);
  });

  it("Facturas: «Ver» sigue dando el aviso por revisado al ir a su origen", async () => {
    pintar("facturas");
    fireEvent.click(await screen.findByRole("button", { name: "Avisos: 1 sin revisar" }));
    const modal = await screen.findByRole("dialog");
    const ver = within(modal).queryByRole("button", { name: "Ver: Aviso f1" });
    if (ver) {
      fireEvent.click(ver);
      await waitFor(() => expect(bd.revisados[0]).toEqual({ p_ids: ["f1"], p_tipos: null }));
    } else {
      // Sin ruta de origen no hay «Ver»: queda «Revisado».
      expect(within(modal).getByRole("button", { name: "Marcar como revisado: Aviso f1" })).toBeInTheDocument();
    }
  });

  it("con permiso de editar reservas, «Ver» en una reserva abre su ficha encima y el modal sigue abierto", async () => {
    permiso.editaReservas = true;
    try {
      pintar("reservas");
      fireEvent.click(await screen.findByRole("button", { name: "Avisos: 2 sin revisar" }));
      const modal = await screen.findByRole("dialog");
      // El estado actual de la reserva avisada sale junto al título (12/11/2026).
      expect(within(modal).getAllByTestId("estado-reserva-aviso")[0]).toHaveTextContent("pendiente");
      fireEvent.click(await within(modal).findByRole("button", { name: "Ver: Aviso r1" }));
      expect(await screen.findByTestId("ficha-reserva")).toHaveTextContent("res-r1");
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      // «Ver» solo enseña la reserva: el aviso se cierra con «Verificar» o «Revisado» (CAS-9).
      expect(bd.revisados).toEqual([]);
    } finally {
      permiso.editaReservas = false;
    }
  });
});

describe("Reservas › Avisos: colores, «Verificar» y «Revisado» (CAS-9, 17/11/2026)", () => {
  const abrir = async () => {
    pintar("reservas");
    fireEvent.click(await screen.findByRole("button", { name: "Avisos: 2 sin revisar" }));
    const modal = await screen.findByRole("dialog", { name: /Avisos de reservas/ });
    await waitFor(() => expect(within(modal).getAllByRole("listitem")).toHaveLength(2));
    return modal;
  };
  const fila = (modal: HTMLElement, texto: string) => within(modal).getByText(texto).closest("li") as HTMLElement;

  it("cada tipo tiene su color de fila y su leyenda: azul la reserva nueva, rojo la cancelada", async () => {
    const modal = await abrir();
    expect(within(modal).getByTestId("leyenda-avisos-reservas")).toHaveTextContent(/Nueva: verificar.*Cancelada: revisar/);
    expect(within(modal).getByTestId("leyenda-avisos-reservas")).not.toHaveTextContent(/Confirmada/);
    expect(fila(modal, "Aviso r1")).toHaveAttribute("data-tipo-aviso", "reserva_nueva");
    expect(fila(modal, "Aviso r1").className).toMatch(/border-l-sky-500/);
    expect(fila(modal, "Aviso r2")).toHaveAttribute("data-tipo-aviso", "reserva_cancelada");
    expect(fila(modal, "Aviso r2").className).toMatch(/border-l-red-500/);
  });

  it("reserva nueva pendiente: «Ver» y «Verificar» (sin «Revisado»); cancelada: «Ver» y «Revisado»", async () => {
    permiso.editaReservas = true;
    try {
      const modal = await abrir();
      const nueva = within(fila(modal, "Aviso r1"));
      expect(nueva.getByRole("button", { name: "Ver: Aviso r1" })).toBeInTheDocument();
      expect(nueva.getByRole("button", { name: /^Verificar la reserva: Aviso r1/ })).toBeInTheDocument();
      expect(nueva.queryByRole("button", { name: /Marcar como revisado/ })).toBeNull();
      const cancelada = within(fila(modal, "Aviso r2"));
      expect(cancelada.getByRole("button", { name: "Marcar como revisado: Aviso r2" })).toBeInTheDocument();
      expect(cancelada.queryByRole("button", { name: /^Verificar/ })).toBeNull();
    } finally {
      permiso.editaReservas = false;
    }
  });

  it("«Verificar» verifica la reserva (correo al cliente) y deja el aviso revisado: un solo botón", async () => {
    permiso.editaReservas = true;
    try {
      const modal = await abrir();
      fireEvent.click(within(modal).getByRole("button", { name: /^Verificar la reserva: Aviso r1/ }));
      await waitFor(() => expect(acciones.aceptar).toHaveBeenCalledWith(expect.objectContaining({ id: "res-r1", estado: "pendiente", email: "lucia@x.test" })));
      await waitFor(() => expect(bd.revisados).toEqual([{ p_ids: ["r1"], p_tipos: null }]));
      await waitFor(() => expect(within(modal).queryByText("Aviso r1")).not.toBeInTheDocument());
      expect(await screen.findByRole("button", { name: "Avisos: 1 sin revisar", hidden: true })).toBeInTheDocument();
    } finally {
      permiso.editaReservas = false;
    }
  });

  it("si la verificación falla, el aviso sigue sin revisar", async () => {
    permiso.editaReservas = true;
    acciones.aceptar.mockResolvedValueOnce({ ok: false });
    try {
      const modal = await abrir();
      fireEvent.click(within(modal).getByRole("button", { name: /^Verificar la reserva: Aviso r1/ }));
      await waitFor(() => expect(acciones.aceptar).toHaveBeenCalled());
      expect(bd.revisados).toEqual([]);
      expect(within(modal).getByText("Aviso r1")).toBeInTheDocument();
    } finally {
      permiso.editaReservas = false;
    }
  });

  it("si la reserva ya no está pendiente (verificada en la ficha), su «Reserva nueva» no sale en «Sin revisar»; en «Todos», sin «Verificar» (18/11/2026)", async () => {
    permiso.editaReservas = true;
    reservasAvisadas.estado = "verificada";
    try {
      pintar("reservas");
      fireEvent.click(await screen.findByRole("button", { name: "Avisos: 2 sin revisar" }));
      const modal = await screen.findByRole("dialog", { name: /Avisos de reservas/ });
      await waitFor(() => expect(within(modal).getByText("Aviso r2")).toBeInTheDocument());
      expect(within(modal).queryByText("Aviso r1")).toBeNull();
      fireEvent.click(within(modal).getByRole("button", { name: "Todos" }));
      await waitFor(() => expect(within(modal).getByText("Aviso r1")).toBeInTheDocument());
      const nueva = within(fila(modal, "Aviso r1"));
      expect(nueva.queryByRole("button", { name: /^Verificar/ })).toBeNull();
      expect(nueva.getByRole("button", { name: "Marcar como revisado: Aviso r1" })).toBeInTheDocument();
    } finally {
      permiso.editaReservas = false;
    }
  });

  it("«Confirmada por el cliente» ya no sale en los avisos de Reservas, ni su filtro (CAS-24, 20/11/2026)", async () => {
    // Un verde viejo sin revisar (la migración 20261213050000 los da por revisados; aquí, por si el panel llega antes).
    bd.filas.push(aviso("c1", "reserva_confirmada", false, { referencia_tipo: "reserva", referencia_id: "res-c1", titulo: "Confirmada por el cliente" }));
    pintar("reservas");
    fireEvent.click(await screen.findByRole("button", { name: "Avisos: 2 sin revisar" }));
    const modal = await screen.findByRole("dialog", { name: /Avisos de reservas/ });
    await waitFor(() => expect(within(modal).getAllByRole("listitem")).toHaveLength(2));
    expect(within(modal).queryByText("Confirmada por el cliente")).toBeNull();
    expect(within(modal).queryByRole("button", { name: "Confirmadas por el cliente" })).toBeNull();
  });

  it("sin permiso de editar reservas no sale «Verificar»: solo «Revisado»", async () => {
    const modal = await abrir();
    expect(within(modal).queryByRole("button", { name: /^Verificar/ })).toBeNull();
    expect(within(fila(modal, "Aviso r1")).getByRole("button", { name: "Marcar como revisado: Aviso r1" })).toBeInTheDocument();
  });

  it("verificada desde otro sitio (la ficha, la Lista…), su aviso «Reserva nueva» sale solo de «Sin revisar»", async () => {
    const modal = await abrir();
    const { avisarReservaAtendida } = await import("@/hooks/useAvisosSeccion");
    avisarReservaAtendida("res-r1");
    await waitFor(() => expect(within(modal).queryByText("Aviso r1")).not.toBeInTheDocument());
    expect(within(modal).getByText("Aviso r2")).toBeInTheDocument();
  });

  it("`?avisos=reservas` en la URL (desde el Dashboard) abre el modal al llegar y se quita de la URL", async () => {
    pintar("reservas", "/reservas?avisos=reservas");
    expect(await screen.findByRole("dialog", { name: /Avisos de reservas/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("ruta").textContent).toBe("/reservas"));
  });
});
