import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { BotonAvisosSeccion } from "@/components/avisos/BotonAvisosSeccion";

// Supabase falso: cuenta y lista de notificaciones_dashboard con los filtros que use el hook.
const bd = vi.hoisted(() => ({
  filas: [] as Record<string, unknown>[],
  updates: [] as { cambios: unknown; filtros: [string, string, unknown][] }[],
}));
vi.mock("@/integrations/supabase/client", () => {
  const consulta = (modo: "select" | "update", cambios?: unknown, head = false) => {
    const filtros: [string, string, unknown][] = [];
    let rango: [number, number] | null = null;
    const api: Record<string, unknown> = {
      eq: (c: string, v: unknown) => { filtros.push(["eq", c, v]); return api; },
      in: (c: string, v: unknown) => { filtros.push(["in", c, v]); return api; },
      order: () => api,
      range: (a: number, b: number) => { rango = [a, b]; return api; },
      then: (ok: (r: unknown) => unknown) => {
        if (modo === "update") { bd.updates.push({ cambios, filtros }); return Promise.resolve({ error: null }).then(ok); }
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
        select: (_c: string, opts?: { head?: boolean }) => consulta("select", undefined, opts?.head),
        update: (cambios: unknown) => consulta("update", cambios),
      }),
    },
  };
});

const hoy = new Date().toISOString();
const aviso = (id: string, tipo: string, leida = false, extra: Record<string, unknown> = {}) =>
  ({ id, tipo, titulo: `Aviso ${id}`, mensaje: null, leida, created_at: hoy, referencia_tipo: null, referencia_id: null, ...extra });

const Ruta = () => <p data-testid="ruta">{useLocation().pathname + useLocation().search}</p>;
const pintar = (seccion: "reservas" | "facturas") =>
  render(
    <MemoryRouter initialEntries={["/inicio"]}>
      <BotonAvisosSeccion seccion={seccion} />
      <Routes><Route path="*" element={<Ruta />} /></Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  bd.updates = [];
  bd.filas = [
    aviso("r1", "reserva_nueva", false, { referencia_tipo: "reserva" }),
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
    await waitFor(() => expect(bd.updates).toHaveLength(1));
    expect(bd.updates[0].filtros).toEqual([
      ["eq", "leida", false],
      ["in", "tipo", ["reserva_nueva", "reserva_cancelada"]],
    ]);
  });

  it("«Ver» lleva al origen del aviso, lo marca revisado y cierra el modal", async () => {
    pintar("reservas");
    fireEvent.click(await screen.findByRole("button", { name: "Avisos: 2 sin revisar" }));
    const modal = await screen.findByRole("dialog");
    fireEvent.click(await within(modal).findByRole("button", { name: "Ver: Aviso r1" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("ruta")).toHaveTextContent("/reservas?tab=reservas");
    expect(bd.updates[0]).toMatchObject({ cambios: { leida: true }, filtros: [["eq", "id", "r1"]] });
  });
});
