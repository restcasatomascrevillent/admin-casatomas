import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditLogEntry, AuditLogFiltros } from "@/hooks/useAuditLog";

const state = vi.hoisted(() => ({
  entradas: [] as AuditLogEntry[],
  filtros: [] as AuditLogFiltros[],
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/components/SuperAdminLayout", () => ({
  SuperAdminLayout: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@/hooks/useAlturaDisponible", () => ({
  useAlturaDisponible: () => undefined,
}));
vi.mock("@/hooks/useAuditLog", async (original) => ({
  ...(await original<typeof import("@/hooks/useAuditLog")>()),
  useAuditLog: (filtros: AuditLogFiltros) => {
    state.filtros.push(filtros);
    return {
      entradas: state.entradas,
      total: state.entradas.length,
      pageSize: 25,
      loading: false,
      error: null,
    };
  },
}));
import SuperAdminAuditoria from "../SuperAdminAuditoria";

const entry = (overrides: Partial<AuditLogEntry>): AuditLogEntry => ({
  id: "event-1",
  created_at: "2026-10-07T10:00:00Z",
  actor_user_id: null,
  actor_email: null,
  accion: "login",
  tabla: null,
  registro_id: null,
  detalles: null,
  user_agent: null,
  ...overrides,
});
beforeEach(() => {
  state.entradas = [];
  state.filtros = [];
});

describe("tabla de auditoría", () => {
  it("muestra y despliega la identidad incluso en accesos sin detalles", () => {
    state.entradas = [
      entry({
        actor_user_id: "admin-id",
        actor_email: "admin@staff.local",
        actor_label: "admin@staff.local",
        actor_origin: "usuario",
      }),
    ];
    render(<SuperAdminAuditoria />);
    fireEvent.click(screen.getByText("admin@staff.local"));
    expect(screen.getByText("Usuario: admin-id")).toBeInTheDocument();
    expect(
      screen.getByText("Registro de auditoría: event-1"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Sin identificar")).not.toBeInTheDocument();
  });
  it("muestra el origen de los procesos y advierte si un histórico no conservó autor", () => {
    state.entradas = [
      entry({
        actor_label: "API · service_role · tarea",
        actor_origin: "servicio",
      }),
      entry({
        id: "event-2",
        actor_origin: "historico",
        actor_label: "Registro histórico · event-2",
      }),
    ];
    render(<SuperAdminAuditoria />);
    expect(screen.getByText("API · service_role · tarea")).toBeInTheDocument();
    expect(
      screen.getByText("Registro histórico · event-2"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("El registro original no conservó el autor."),
    ).toBeInTheDocument();
  });
});

it("muestra el dispositivo, la IP y la identidad no verificada de los intentos fallidos", () => {
  state.entradas = [
    entry({
      accion: "login_fallido",
      actor_label: "inventado@test.local · identidad no verificada",
      actor_origin: "intento",
      device_id: "phone-1",
      ip_address: "203.0.113.10",
      user_agent: "iPhone Safari",
      tabla: "accesos_panel",
    }),
  ];
  render(<SuperAdminAuditoria />);
  expect(
    within(screen.getByRole("article")).getByText("Acceso fallido"),
  ).toBeInTheDocument();
  expect(screen.getByText("iPhone · Safari")).toBeInTheDocument();
  expect(screen.getByText("phone-1")).toBeInTheDocument();
  expect(screen.getByText("IP: 203.0.113.10")).toBeInTheDocument();
  expect(screen.getByText(/identidad no verificada/)).toBeInTheDocument();
});

it("los filtros rápidos conservan la exclusión de los procesos del servidor", () => {
  render(<SuperAdminAuditoria />);
  expect(state.filtros.at(-1)).toEqual({ origen: "sin_servidor" });
  fireEvent.click(screen.getByRole("button", { name: "IA facturas" }));
  expect(state.filtros.at(-1)).toEqual({
    origen: "sin_servidor",
    accion: "grupo_ia",
  });
  fireEvent.click(screen.getByRole("button", { name: "Cambios" }));
  expect(state.filtros.at(-1)).toEqual({
    origen: "sin_servidor",
    accion: "grupo_cambios",
  });
  fireEvent.click(screen.getByRole("button", { name: "Todos", exact: true }));
  expect(state.filtros.at(-1)?.origen).toBe("sin_servidor");
  expect(state.filtros.at(-1)?.accion).toBeUndefined();
});
