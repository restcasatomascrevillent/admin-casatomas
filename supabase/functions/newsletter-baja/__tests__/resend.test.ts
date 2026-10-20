/**
 * Baja por nuestra vía -> borrar el contacto en Resend (newsletter-baja/resend.ts).
 * fetch falso: nunca se llama a Resend.
 */
import { describe, it, expect, vi } from "vitest";
import { quitarDeResendTrasBaja } from "../resend.ts";
import type { FetchLike } from "../../_shared/resend-marketing/cliente.ts";

function fetchQueDevuelve(status: number, cuerpo: unknown = {}) {
  const llamadas: { url: string; method: string }[] = [];
  const fn: FetchLike = async (url, init) => {
    llamadas.push({ url, method: init.method });
    return { status, ok: status >= 200 && status < 300, headers: { get: () => null }, text: async () => JSON.stringify(cuerpo) };
  };
  return { fn, llamadas };
}

const base = { email: " Ana@Ejemplo.ES ", suscriptorId: "s1", dormir: async () => {}, log: () => {} };

describe("quitarDeResendTrasBaja", () => {
  it("sin RESEND_MARKETING_API_KEY no hace nada (lo hará la sincronización)", async () => {
    const f = fetchQueDevuelve(200);
    expect(await quitarDeResendTrasBaja({ ...base, apiKey: undefined, fetch: f.fn })).toBe("sin_clave");
    expect(f.llamadas).toHaveLength(0);
  });

  it("borra el contacto por email (minúsculas, codificado)", async () => {
    const f = fetchQueDevuelve(200, { deleted: true });
    expect(await quitarDeResendTrasBaja({ ...base, apiKey: "re_x", fetch: f.fn })).toBe("borrado");
    expect(f.llamadas).toEqual([{ method: "DELETE", url: "https://api.resend.com/contacts/ana%40ejemplo.es" }]);
  });

  it("404 = no estaba en Resend", async () => {
    const f = fetchQueDevuelve(404, { name: "not_found", message: "Contact not found" });
    expect(await quitarDeResendTrasBaja({ ...base, apiKey: "re_x", fetch: f.fn })).toBe("no_estaba");
  });

  it("si Resend falla NO lanza (la baja local ya está hecha) y lo deja en el log", async () => {
    const log = vi.fn();
    const f = fetchQueDevuelve(500, { name: "application_error", message: "boom" });
    expect(await quitarDeResendTrasBaja({ ...base, apiKey: "re_x", fetch: f.fn, log })).toBe("error");
    expect(f.llamadas.length).toBeLessThanOrEqual(2); // como mucho un reintento: no retrasa la respuesta
    expect(log.mock.calls.flat().join(" ")).toMatch(/próxima sincronización/);
  });

  it("error de red tampoco lanza", async () => {
    const fn: FetchLike = async () => {
      throw new Error("ECONNREFUSED");
    };
    expect(await quitarDeResendTrasBaja({ ...base, apiKey: "re_x", fetch: fn })).toBe("error");
  });
});
