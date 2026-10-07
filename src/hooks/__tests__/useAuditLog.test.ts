import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { agruparEntradas, identificarActor, resumirCambios, type AuditLogEntry } from "../useAuditLog";

const entry = (overrides: Partial<AuditLogEntry> = {}): AuditLogEntry => ({
  id: "event-1", created_at: "2026-10-07T10:00:00Z", actor_user_id: null,
  actor_email: null, accion: "crear", tabla: "user_permissions", registro_id: null,
  detalles: null, user_agent: null, ...overrides,
});

describe("identidad de auditoría", () => {
  it("explica un permiso nuevo como un cambio de acceso, sin inventar una fila anterior", () => {
    expect(resumirCambios({
      despues: { id: "new-row", user_id: "target", section_key: "reservas", can_view: true, can_edit: false },
      permiso_antes: { user_id: "target", section_key: "reservas", can_view: false, can_edit: false },
      permiso_despues: { user_id: "target", section_key: "reservas", can_view: true, can_edit: false },
    })).toEqual([{ campo: "can_view", antes: false, despues: true }]);
  });
  it("explica retirar un permiso como pérdida de acceso", () => {
    expect(resumirCambios({
      antes: { id: "old-row", can_view: true, can_edit: true },
      permiso_antes: { can_view: true, can_edit: true },
      permiso_despues: { can_view: false, can_edit: false },
    })).toEqual([
      { campo: "can_view", antes: true, despues: false },
      { campo: "can_edit", antes: true, despues: false },
    ]);
  });
  it("mantiene el resumen de los cambios que no son permisos", () => {
    expect(resumirCambios({ antes: { enabled: false, updated_at: "a" }, despues: { enabled: true, updated_at: "b" } }))
      .toEqual([{ campo: "enabled", antes: false, despues: true }]);
  });
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

