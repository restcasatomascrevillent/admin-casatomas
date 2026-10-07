import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { agruparEntradas, identificarActor, type AuditLogEntry } from "../useAuditLog";

const entry = (overrides: Partial<AuditLogEntry> = {}): AuditLogEntry => ({
  id: "event-1", created_at: "2026-10-07T10:00:00Z", actor_user_id: null,
  actor_email: null, accion: "crear", tabla: "user_permissions", registro_id: null,
  detalles: null, user_agent: null, ...overrides,
});

describe("identidad de auditoría", () => {
  it("conserva el origen resuelto por el servidor", () => {
    expect(identificarActor(entry({ actor_label: "API · service_role · admin-create-user" })))
      .toBe("API · service_role · admin-create-user");
  });
  it("muestra el UUID si el usuario no tiene email", () => {
    expect(identificarActor(entry({ actor_email: "  ", actor_user_id: "user-1" })))
      .toBe("Usuario · user-1");
  });
  it("conserva una referencia individual para históricos sin evidencia de autor", () => {
    expect(identificarActor(entry())).toBe("Registro histórico · event-1");
    expect(agruparEntradas([entry(), entry({ id: "event-2" })])).toHaveLength(2);
  });
  it("no mezcla usuarios diferentes aunque compartan email y transacción", () => {
    expect(agruparEntradas([
      entry({ actor_email: "admin@staff.local", actor_user_id: "a" }),
      entry({ id: "event-2", actor_email: "admin@staff.local", actor_user_id: "b" }),
    ])).toHaveLength(2);
  });
  it("agrupa los cambios de una misma persona en una transacción", () => {
    const groups = agruparEntradas([
      entry({ actor_email: "admin@staff.local", actor_user_id: "a" }),
      entry({ id: "event-2", actor_email: "admin@staff.local", actor_user_id: "a" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].actor_user_id).toBe("a");
    expect(groups[0].entradas).toHaveLength(2);
  });
  it("no mezcla dos procesos automáticos diferentes", () => {
    expect(agruparEntradas([
      entry({ actor_origin: "servicio", actor_label: "API · servicio A" }),
      entry({ id: "event-2", actor_origin: "servicio", actor_label: "API · servicio B" }),
    ])).toHaveLength(2);
  });
});
