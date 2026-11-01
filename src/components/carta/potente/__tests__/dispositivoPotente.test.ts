import { describe, expect, it, vi } from "vitest";
import {
  CADUCIDAD_FALLO_MS,
  CADUCIDAD_MS,
  CLAVE_POTENTE,
  decidirPotente,
  leerMedidaCacheada,
  medirDispositivoPotente,
  UMBRAL_MS_FOTOGRAMA,
  webgpuDisponible,
  type MedidaPotente,
} from "../dispositivoPotente";

function almacen() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    m,
  };
}

describe("decidirPotente", () => {
  it("exige recorte seguro, WebGPU, proveedor webgpu y menos del umbral por fotograma", () => {
    expect(decidirPotente({ seguro: false, webgpu: true, ms: 100, proveedor: "webgpu" }).potente).toBe(false);
    expect(decidirPotente({ seguro: true, webgpu: false, ms: 100, proveedor: "webgpu" }).potente).toBe(false);
    expect(decidirPotente({ seguro: true, webgpu: true, ms: null, proveedor: null }).potente).toBe(false);
    expect(decidirPotente({ seguro: true, webgpu: true, ms: 300, proveedor: "wasm" }).potente).toBe(false);
    expect(decidirPotente({ seguro: true, webgpu: true, ms: UMBRAL_MS_FOTOGRAMA, proveedor: "webgpu" }).potente).toBe(false);
    const ok = decidirPotente({ seguro: true, webgpu: true, ms: 450, proveedor: "webgpu" });
    expect(ok).toEqual({ potente: true, motivo: "450 ms por fotograma (WebGPU)" });
  });
});

describe("caché de la medida", () => {
  const medida = (p: Partial<MedidaPotente>): MedidaPotente => ({ potente: true, ms: 400, proveedor: "webgpu", motivo: "", medidoEn: 1_000, ...p });

  it("devuelve la medida mientras no caduca y null después", () => {
    const a = almacen();
    a.setItem(CLAVE_POTENTE, JSON.stringify(medida({})));
    expect(leerMedidaCacheada(a, 1_000 + CADUCIDAD_MS - 1)?.potente).toBe(true);
    expect(leerMedidaCacheada(a, 1_000 + CADUCIDAD_MS + 1)).toBeNull();
  });

  it("un fallo sin medida caduca antes (se reintenta)", () => {
    const a = almacen();
    a.setItem(CLAVE_POTENTE, JSON.stringify(medida({ potente: false, ms: null })));
    expect(leerMedidaCacheada(a, 1_000 + CADUCIDAD_FALLO_MS - 1)).not.toBeNull();
    expect(leerMedidaCacheada(a, 1_000 + CADUCIDAD_FALLO_MS + 1)).toBeNull();
  });

  it("ignora basura y fechas del futuro", () => {
    const a = almacen();
    a.setItem(CLAVE_POTENTE, "{no json");
    expect(leerMedidaCacheada(a, 5)).toBeNull();
    a.setItem(CLAVE_POTENTE, JSON.stringify(medida({ medidoEn: 10_000_000 })));
    expect(leerMedidaCacheada(a, 1_000)).toBeNull();
    expect(leerMedidaCacheada(null)).toBeNull();
  });
});

describe("webgpuDisponible", () => {
  it("necesita un adaptador real", async () => {
    expect(await webgpuDisponible({} as Navigator)).toBe(false);
    expect(await webgpuDisponible({ gpu: { requestAdapter: async () => null } } as unknown as Navigator)).toBe(false);
    expect(await webgpuDisponible({ gpu: { requestAdapter: async () => { throw new Error("x"); } } } as unknown as Navigator)).toBe(false);
    expect(await webgpuDisponible({ gpu: { requestAdapter: async () => ({}) } } as unknown as Navigator)).toBe(true);
  });
});

describe("medirDispositivoPotente", () => {
  const base = { nav: {} as Navigator, ahora: () => 50_000 };

  it("móvil: no potente, sin medir el modelo, y queda cacheado", async () => {
    const a = almacen();
    const medir = vi.fn();
    const m = await medirDispositivoPotente({ ...base, almacen: a, seguro: () => false, webgpu: async () => true, medir });
    expect(m.potente).toBe(false);
    expect(medir).not.toHaveBeenCalled();
    expect(a.m.has(CLAVE_POTENTE)).toBe(true);
  });

  it("PC con WebGPU rápido: potente y cacheado; la segunda vez no vuelve a medir", async () => {
    const a = almacen();
    const medir = vi.fn(async () => ({ ms: 380, proveedor: "webgpu" as const }));
    const deps = { ...base, almacen: a, seguro: () => true, webgpu: async () => true, modeloGuardado: async () => true, medir };
    expect((await medirDispositivoPotente(deps)).potente).toBe(true);
    expect((await medirDispositivoPotente(deps)).potente).toBe(true);
    expect(medir).toHaveBeenCalledTimes(1);
    expect((await medirDispositivoPotente({ ...deps, forzar: true })).ms).toBe(380);
    expect(medir).toHaveBeenCalledTimes(2);
  });

  it("PC lento (WASM / > umbral): no potente", async () => {
    const m = await medirDispositivoPotente({
      ...base, almacen: almacen(), seguro: () => true, webgpu: async () => true, modeloGuardado: async () => true,
      medir: async () => ({ ms: 3200, proveedor: "webgpu" }),
    });
    expect(m.potente).toBe(false);
    expect(m.motivo).toMatch(/Lento/);
  });

  it("modelo sin descargar: no mide ni cachea (se reintenta en el siguiente sondeo)", async () => {
    const a = almacen();
    const medir = vi.fn();
    const m = await medirDispositivoPotente({ ...base, almacen: a, seguro: () => true, webgpu: async () => true, modeloGuardado: async () => false, medir });
    expect(m.potente).toBe(false);
    expect(medir).not.toHaveBeenCalled();
    expect(a.m.has(CLAVE_POTENTE)).toBe(false);
  });

  it("si la prueba revienta, no lanza: no potente", async () => {
    const m = await medirDispositivoPotente({
      ...base, almacen: almacen(), seguro: () => true, webgpu: async () => true, modeloGuardado: async () => true,
      medir: async () => { throw new Error("GPU perdida"); },
    });
    expect(m).toMatchObject({ potente: false, motivo: "Prueba fallida: GPU perdida" });
  });
});
