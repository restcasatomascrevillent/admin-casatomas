import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));

import { supabase } from "@/integrations/supabase/client";
import { completeAuditEnabled, precargarVersionAuditoria, reiniciarCacheVersionAuditoria } from "../audit-version";

const rpc = vi.mocked(supabase.rpc);

beforeEach(() => {
  rpc.mockReset();
  reiniciarCacheVersionAuditoria();
});

describe("completeAuditEnabled · caché (login más rápido)", () => {
  it("precargar al montar el login y luego pulsar «Entrar» hace UNA sola petición", async () => {
    rpc.mockResolvedValue({ data: 2, error: null } as never);
    precargarVersionAuditoria();
    await expect(completeAuditEnabled()).resolves.toBe(true);
    await expect(completeAuditEnabled()).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("ct.auditoria-panel.v2")).toBe("1");
  });

  it("recuerda «activa» en sessionStorage (recargar la pestaña no vuelve a preguntar)", async () => {
    sessionStorage.setItem("ct.auditoria-panel.v2", "1");
    await expect(completeAuditEnabled()).resolves.toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("el servidor antiguo (PGRST202) no se recuerda: se vuelve a preguntar", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202" } } as never);
    await expect(completeAuditEnabled()).resolves.toBe(false);
    await expect(completeAuditEnabled()).resolves.toBe(false);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("un error de red no se recuerda y sigue bloqueando (lanza)", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "fetch" } } as never);
    await expect(completeAuditEnabled()).rejects.toThrow(/registro de accesos/);
    rpc.mockResolvedValueOnce({ data: 2, error: null } as never);
    await expect(completeAuditEnabled()).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("un fallo de la precarga no se queda pegado: al entrar se pregunta otra vez", async () => {
    rpc.mockRejectedValueOnce(new Error("sin red"));
    precargarVersionAuditoria();
    await new Promise((r) => setTimeout(r, 0));
    rpc.mockResolvedValueOnce({ data: 2, error: null } as never);
    await expect(completeAuditEnabled()).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
