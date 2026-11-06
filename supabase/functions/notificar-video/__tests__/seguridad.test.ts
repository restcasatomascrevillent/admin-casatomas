// @vitest-environment node
/**
 * notificar-video y el bloque A de la evaluación (05/11/2026): un aviso de
 * encargo sale UNA sola vez por evento (B4) y Instagram pide «Editar»; los
 * reels los avisa el trabajador de render con su sección propia (A6).
 */
import { describe, expect, it, vi } from "vitest";
import { modoPermisoDeTipo, reclamarAvisoEncargo, SECCIONES_REEL, seccionesDeTipo, type ClienteAviso } from "../logica.ts";
import { comprobarPermisoSeccion, type ClientePermiso } from "../../_shared/permiso-marketing.ts";

/** Tabla de eventos en memoria con UPDATE … WHERE notificado_at IS NULL. */
function admin(o: { error?: { message: string; code?: string } } = {}) {
  const avisados = new Set<string>();
  const cliente: ClienteAviso = {
    from: () => ({
      update: (v) => ({
        eq: (_c, id) => ({
          is: () => ({
            select: async () => {
              if (o.error) return { data: null, error: o.error };
              if (avisados.has(id)) return { data: [], error: null };
              expect(v).toHaveProperty("notificado_at");
              avisados.add(id);
              return { data: [{ id }], error: null };
            },
          }),
        }),
      }),
    }),
  };
  return cliente;
}

describe("aviso de encargo una sola vez", () => {
  it("la primera llamada avisa; las siguientes, no", async () => {
    const a = admin();
    expect(await reclamarAvisoEncargo(a, "e1")).toBe("avisar");
    expect(await reclamarAvisoEncargo(a, "e1")).toBe("ya_avisado");
    expect(await reclamarAvisoEncargo(a, "e1")).toBe("ya_avisado");
    expect(await reclamarAvisoEncargo(a, "e2")).toBe("avisar");
  });

  it("sin la columna (migración sin aplicar) avisa como antes; otro error, no avisa", async () => {
    expect(await reclamarAvisoEncargo(admin({ error: { code: "42703", message: 'column "notificado_at" does not exist' } }), "e1")).toBe("avisar");
    expect(await reclamarAvisoEncargo(admin({ error: { message: "timeout" } }), "e1")).toBe("ya_avisado");
  });
});

describe("permisos: «Editar» en Instagram y en la carta (06/11/2026)", () => {
  it("secciones y modo por tipo", () => {
    expect(seccionesDeTipo("reel")).toEqual(SECCIONES_REEL);
    expect(SECCIONES_REEL[0]).toBe("instagram_render");
    expect(seccionesDeTipo("encargo")).toEqual(["marketing", "instagram_agencia"]);
    expect(seccionesDeTipo("video")).toEqual(["gestor_carta"]);
    expect(modoPermisoDeTipo("reel")).toBe("editar");
    expect(modoPermisoDeTipo("encargo")).toBe("editar");
    // La carta también: con solo «Ver» no se avisa de vídeos ni recortes (no los puede ni leer).
    expect(modoPermisoDeTipo("video")).toBe("editar");
    expect(modoPermisoDeTipo("recorte")).toBe("editar");
  });

  it("«editar» pregunta a can_edit_section", async () => {
    const rpc = vi.fn(async () => ({ data: false, error: null }));
    const cliente: ClientePermiso = { auth: { getUser: async () => ({ data: { user: { id: "u" } }, error: null }) }, rpc };
    const r = await comprobarPermisoSeccion(cliente, "marketing", "editar", "sin permiso");
    expect(r).toMatchObject({ ok: false, status: 403 });
    expect(rpc).toHaveBeenCalledWith("can_edit_section", { _section: "marketing" });
  });
});
