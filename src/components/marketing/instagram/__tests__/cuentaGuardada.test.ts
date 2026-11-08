/**
 * Cuenta recordada para el indicador «● @cuenta» (sin llamar a instagram-estado
 * en cada carga): se guarda solo lo justo, caduca a los 45 min (el @usuario se
 * sigue viendo, en gris) y sin almacenamiento no rompe nada.
 */
import { describe, expect, it } from "vitest";
import { CADUCIDAD_CUENTA_MS, CLAVE_CUENTA_GUARDADA, guardarCuenta, igUserIdGuardado, leerCuentaGuardada, resumirEstado } from "../cuentaGuardada";
import type { RespuestaEstado } from "../api";

function almacen() {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

const ESTADO: RespuestaEstado = {
  ok: true,
  cuentasPorMarca: [
    { marca: "casa-tomas", propia: false, igUserId: "111", username: "casatomas", variableIgUserId: "IG_USER_ID", variableToken: "IG_ACCESS_TOKEN", estado: "ok", detalle: "token …abcd" },
    { marca: "touza", propia: true, igUserId: "222", username: "touza", variableIgUserId: "IG_USER_ID_TOUZA", variableToken: "IG_ACCESS_TOKEN_TOUZA", estado: "ok", detalle: "" },
  ],
  variables: [{ nombre: "IG_ACCESS_TOKEN", estado: "ok", detalle: "…abcd" }],
  comprobaciones: [],
  cuenta: { id: "111", username: "casatomas" },
  cuota: { usadas: 3, total: 100, ventanaHoras: 24 },
  avisos: [],
  comoArreglarlo: [],
  drive: null,
};

describe("cuentaGuardada", () => {
  it("guarda solo lo que pinta el indicador (ni variables, ni detalles, ni cuota)", () => {
    const a = almacen();
    guardarCuenta(ESTADO, a, 1_000);
    const crudo = a.m.get(CLAVE_CUENTA_GUARDADA) ?? "";
    expect(crudo).not.toMatch(/abcd|IG_ACCESS_TOKEN|cuota|usadas/);
    expect(JSON.parse(crudo)).toEqual(resumirEstado(ESTADO, 1_000));
    expect(leerCuentaGuardada(1_000 + 60_000, a)).toEqual({ cuenta: resumirEstado(ESTADO, 1_000), vigente: true });
  });

  it("caduca a los 45 min (sigue ahí, pero no vigente) y se borra con null", () => {
    const a = almacen();
    guardarCuenta(ESTADO, a, 0);
    expect(leerCuentaGuardada(CADUCIDAD_CUENTA_MS - 1, a)?.vigente).toBe(true);
    expect(leerCuentaGuardada(CADUCIDAD_CUENTA_MS, a)?.vigente).toBe(false);
    guardarCuenta(null, a);
    expect(leerCuentaGuardada(0, a)).toBeNull();
  });

  it("sin almacenamiento, con basura o con un almacén que lanza: null, sin romper", () => {
    expect(leerCuentaGuardada(0, null)).toBeNull();
    const a = almacen();
    a.m.set(CLAVE_CUENTA_GUARDADA, "{no es json");
    expect(leerCuentaGuardada(0, a)).toBeNull();
    a.m.set(CLAVE_CUENTA_GUARDADA, JSON.stringify({ v: 99 }));
    expect(leerCuentaGuardada(0, a)).toBeNull();
    const roto = { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("lleno"); }, removeItem: () => undefined };
    expect(() => guardarCuenta(ESTADO, roto)).not.toThrow();
    expect(leerCuentaGuardada(0, roto)).toBeNull();
  });

  it("igUserIdGuardado: la de la marca si tiene, si no la general", () => {
    const g = resumirEstado(ESTADO, 0);
    expect(igUserIdGuardado("touza", g)).toBe("222");
    expect(igUserIdGuardado(null, g)).toBe("111");
    expect(igUserIdGuardado("touza", { ...g, cuentasPorMarca: [] })).toBe("111");
    expect(igUserIdGuardado("touza", null)).toBeNull();
  });
});
