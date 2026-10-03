/**
 * Tests de supabase/functions/enviar-newsletter/permiso.ts — antes bastaba con
 * estar autenticado para mandar el newsletter a toda la lista.
 */
import { describe, it, expect, vi } from "vitest";
import { comprobarPermisoNewsletter, type ClientePermiso } from "../permiso.ts";

function cliente(opts: { user?: { id: string } | null; errUser?: unknown; permitido?: unknown; errRpc?: { message: string } | null }) {
  const rpc = vi.fn(async () => ({ data: opts.permitido ?? null, error: opts.errRpc ?? null }));
  const c: ClientePermiso = {
    auth: { getUser: async () => ({ data: { user: opts.user ?? null }, error: opts.errUser ?? null }) },
    rpc,
  };
  return { c, rpc };
}

describe("comprobarPermisoNewsletter", () => {
  it("401 sin usuario (p. ej. la anon key suelta)", async () => {
    const { c, rpc } = cliente({ user: null });
    expect(await comprobarPermisoNewsletter(c)).toEqual({ ok: false, status: 401, error: "Unauthorized" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("pregunta can_write_section('marketing')", async () => {
    const { c, rpc } = cliente({ user: { id: "u1" }, permitido: true });
    expect(await comprobarPermisoNewsletter(c)).toEqual({ ok: true, userId: "u1" });
    expect(rpc).toHaveBeenCalledWith("can_write_section", { _section: "marketing" });
  });

  it("403 si el usuario no tiene permiso de escritura en marketing", async () => {
    const { c } = cliente({ user: { id: "u1" }, permitido: false });
    const r = await comprobarPermisoNewsletter(c);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.status).toBe(403);
  });

  it("403 también si la RPC devuelve algo que no es true", async () => {
    const { c } = cliente({ user: { id: "u1" }, permitido: null });
    const r = await comprobarPermisoNewsletter(c);
    expect(r.ok === false && r.status).toBe(403);
  });

  it("500 si falla la comprobación (falla cerrado, no deja enviar)", async () => {
    const { c } = cliente({ user: { id: "u1" }, errRpc: { message: "boom" } });
    const r = await comprobarPermisoNewsletter(c);
    expect(r.ok === false && r.status).toBe(500);
  });
});
