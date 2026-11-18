import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditLogEntry, AuditLogFiltros } from "@/hooks/useAuditLog";

const state = vi.hoisted(() => ({
  entradas: [] as AuditLogEntry[],
  filtros: [] as AuditLogFiltros[],
  paginas: [] as number[],
  total: 0,
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
  useAuditLog: (filtros: AuditLogFiltros, pagina: number) => {
    state.filtros.push(filtros);
    state.paginas.push(pagina);
    return {
      entradas: state.entradas,
      total: state.total || state.entradas.length,
      pageSize: 25,
      tablas: ["Platos", "Bebidas", "novedades"],
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
  state.paginas = [];
  state.total = 0;
});

it("recoger filtros mantiene la lectura de detalles y la paginación sin aplicar el borrador", () => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  state.entradas = [entry({ actor_label: "María", actor_user_id: "maria-id", actor_origin: "usuario" })];
  state.total = 60;
  render(<SuperAdminAuditoria />);
  fireEvent.click(screen.getByText("María"));
  expect(screen.getByText("Usuario: maria-id")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Mostrar filtros" }));
  fireEvent.change(screen.getByLabelText("Buscar en auditoría"), { target: { value: "paella" } });
  fireEvent.click(screen.getByRole("button", { name: "Recoger filtros" }));
  expect(screen.getByText("Usuario: maria-id")).toBeInTheDocument();
  expect(state.filtros.at(-1)).toEqual({ origen: "sin_servidor" });
  fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
  expect(state.paginas.at(-1)).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: "Mostrar filtros" }));
  expect(screen.getByLabelText("Buscar en auditoría")).toHaveValue("paella");
  fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));
  expect(state.paginas.at(-1)).toBe(0);
  expect(state.filtros.at(-1)).toMatchObject({ texto: "paella", origen: "sin_servidor" });
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

it("cambia de sección sin arrastrar filtros y separa los procesos de las personas", () => {
  render(<SuperAdminAuditoria />);
  const elegir = (name: string) =>
    fireEvent.click(screen.getByRole("button", { name, exact: true }));
  elegir("Platos");
  expect(state.filtros.at(-1)).toMatchObject({
    origen: "sin_servidor",
    accion: "actualizar",
    tabla: "Platos",
  });
  expect(
    screen.getByRole("button", { name: "Platos", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  elegir("Bebidas");
  expect(state.filtros.at(-1)).toMatchObject({
    accion: "actualizar",
    tabla: "Bebidas",
  });
  elegir("Novedades");
  expect(state.filtros.at(-1)).toMatchObject({
    accion: "grupo_cambios",
    tabla: "novedades",
  });
  elegir("IA facturas");
  expect(state.filtros.at(-1)).toMatchObject({
    origen: "sin_servidor",
    accion: "grupo_ia",
  });
  expect(state.filtros.at(-1)?.tabla).toBeUndefined();
  elegir("Procesos");
  expect(state.filtros.at(-1)).toEqual({
    origen: "servidor",
    accion: undefined,
    tabla: undefined,
  });
  expect(
    screen.getByRole("button", { name: "Procesos", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    screen.getByRole("button", { name: "IA facturas", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  elegir("Inicios de sesión");
  expect(state.filtros.at(-1)).toEqual({
    origen: "sin_servidor",
    accion: "login",
    tabla: undefined,
  });
  elegir("Todos");
  expect(state.filtros.at(-1)).toEqual({
    origen: "sin_servidor",
    accion: undefined,
    tabla: undefined,
  });
});

it("conserva búsqueda y fechas al elegir una categoría rápida", () => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1280,
  });
  render(<SuperAdminAuditoria />);
  fireEvent.click(screen.getByRole("button", { name: "Mostrar filtros" }));
  fireEvent.change(screen.getByLabelText("Buscar en auditoría"), {
    target: { value: "paella" },
  });
  fireEvent.change(screen.getByLabelText("Desde"), {
    target: { value: "2026-10-01" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));
  fireEvent.click(screen.getByRole("button", { name: "Platos", exact: true }));
  expect(state.filtros.at(-1)).toMatchObject({
    origen: "sin_servidor",
    accion: "actualizar",
    tabla: "Platos",
    texto: "paella",
    desde: "2026-10-01",
  });
  // La categoría ya lo dice: no se repite como chip; los demás filtros siguen a la vista.
  expect(screen.getByRole("button", { name: "Platos" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByText("Sección: Platos")).not.toBeInTheDocument();
  expect(screen.getByText("Búsqueda: paella")).toBeInTheDocument();
  expect(screen.getByText("Desde: 1 oct 2026")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Mostrar filtros" }));
  expect(screen.getByLabelText("Sección")).toHaveValue("Platos");
});

it("la «×» de un chip quita ese filtro al momento y conserva la categoría", () => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
  render(<SuperAdminAuditoria />);
  fireEvent.click(screen.getByRole("button", { name: "Bebidas" }));
  const buscador = screen.getByLabelText("Buscar en auditoría");
  fireEvent.change(buscador, { target: { value: "vermut" } });
  fireEvent.submit(buscador);
  expect(state.filtros.at(-1)).toMatchObject({ tabla: "Bebidas", texto: "vermut" });
  fireEvent.click(screen.getByRole("button", { name: "Quitar el filtro Búsqueda: vermut" }));
  expect(state.filtros.at(-1)).toEqual({ origen: "sin_servidor", accion: "actualizar", tabla: "Bebidas" });
  expect(screen.getByRole("button", { name: "Bebidas" })).toHaveAttribute("aria-pressed", "true");
});

it("en el móvil las categorías rápidas son un desplegable, con «Procesos» entre ellas", () => {
  render(<SuperAdminAuditoria />);
  const ver = screen.getByLabelText("Ver");
  expect(ver).toHaveValue("todos");
  fireEvent.change(ver, { target: { value: "ia" } });
  expect(state.filtros.at(-1)).toEqual({ origen: "sin_servidor", accion: "grupo_ia", tabla: undefined });
  fireEvent.change(ver, { target: { value: "procesos" } });
  expect(state.filtros.at(-1)).toEqual({ origen: "servidor", accion: undefined, tabla: undefined });
  expect(screen.getByLabelText("Ver")).toHaveValue("procesos");
});

it("la lista separa los registros por día y enseña la hora en cada fila", () => {
  state.entradas = [
    entry({ id: "a", created_at: "2026-10-07T10:15:00Z", actor_label: "Ana", actor_origin: "usuario" }),
    entry({ id: "b", created_at: "2026-10-07T08:00:00Z", actor_label: "Luis", actor_origin: "usuario" }),
    entry({ id: "c", created_at: "2026-10-05T18:30:00Z", actor_label: "Ana", actor_origin: "usuario" }),
  ];
  render(<SuperAdminAuditoria />);
  const dias = screen.getAllByRole("heading", { level: 2 });
  expect(dias).toHaveLength(2);
  expect(dias[0]).toHaveTextContent(/7 de octubre/i);
  expect(dias[1]).toHaveTextContent(/5 de octubre/i);
  expect(screen.getAllByRole("article")).toHaveLength(3);
});

it("sin resultados ofrece volver a ver toda la actividad", () => {
  render(<SuperAdminAuditoria />);
  fireEvent.click(screen.getByRole("button", { name: "Reversiones" }));
  expect(screen.getByText("No hay registros con estos filtros.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Ver toda la actividad" }));
  expect(state.filtros.at(-1)).toEqual({ origen: "sin_servidor" });
});

it("al aplicar el panel con una búsqueda de 1 o 2 letras, aplica lo demás sin mandar la búsqueda", () => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
  render(<SuperAdminAuditoria />);
  fireEvent.change(screen.getByLabelText("Buscar en auditoría"), { target: { value: "ia" } });
  fireEvent.click(screen.getByRole("button", { name: "Mostrar filtros" }));
  fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-11-01" } });
  fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));
  expect(state.filtros.at(-1)).toMatchObject({ origen: "sin_servidor", desde: "2026-11-01" });
  expect(state.filtros.at(-1)?.texto).toBeUndefined();
  expect(screen.getByLabelText("Buscar en auditoría")).toHaveValue("ia");
  expect(screen.getByText("Escribe al menos 3 letras para buscar.")).toBeInTheDocument();
});
