import { describe, expect, it } from "vitest";
import { crearMutex, esDispositivoMovil, numeroWorkersRecorte, procesarEnPool } from "../video/paralelo";

const PC = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD_COMO_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

describe("esDispositivoMovil", () => {
  it("UA de móvil/tablet", () => {
    expect(esDispositivoMovil({ userAgent: ANDROID })).toBe(true);
    expect(esDispositivoMovil({ userAgent: IPHONE })).toBe(true);
  });
  it("iPad que se presenta como Mac (táctil)", () => {
    expect(esDispositivoMovil({ userAgent: IPAD_COMO_MAC, maxTouchPoints: 5 })).toBe(true);
    expect(esDispositivoMovil({ userAgent: IPAD_COMO_MAC, maxTouchPoints: 0 })).toBe(false);
  });
  it("PC con ≤ 4 GB cuenta como móvil", () => {
    expect(esDispositivoMovil({ userAgent: PC, deviceMemory: 4 })).toBe(true);
    expect(esDispositivoMovil({ userAgent: PC, deviceMemory: 8 })).toBe(false);
    expect(esDispositivoMovil({ userAgent: PC })).toBe(false);
  });
});

describe("numeroWorkersRecorte", () => {
  it("con WebGPU siempre 1", () => {
    expect(numeroWorkersRecorte({ userAgent: PC, hardwareConcurrency: 16, deviceMemory: 8, webgpu: true })).toBe(1);
  });
  it("en móvil siempre 1", () => {
    expect(numeroWorkersRecorte({ userAgent: ANDROID, hardwareConcurrency: 8, deviceMemory: 8, webgpu: false })).toBe(1);
    expect(numeroWorkersRecorte({ userAgent: PC, hardwareConcurrency: 8, deviceMemory: 4, webgpu: false })).toBe(1);
  });
  it("PC sin WebGPU: mitad de núcleos, tope 4 y por memoria", () => {
    expect(numeroWorkersRecorte({ userAgent: PC, hardwareConcurrency: 16, deviceMemory: 8, webgpu: false })).toBe(4);
    expect(numeroWorkersRecorte({ userAgent: PC, hardwareConcurrency: 8, deviceMemory: 8, webgpu: false })).toBe(4);
    expect(numeroWorkersRecorte({ userAgent: PC, hardwareConcurrency: 6, deviceMemory: 8, webgpu: false })).toBe(3);
    expect(numeroWorkersRecorte({ userAgent: PC, hardwareConcurrency: 4, deviceMemory: 8, webgpu: false })).toBe(2);
    expect(numeroWorkersRecorte({ userAgent: PC, hardwareConcurrency: 2, deviceMemory: 8, webgpu: false })).toBe(1);
  });
  it("memoria desconocida (Firefox/Safari) → como mucho 2; 6 GB → 3", () => {
    expect(numeroWorkersRecorte({ userAgent: PC, hardwareConcurrency: 16, webgpu: false })).toBe(2);
    expect(numeroWorkersRecorte({ userAgent: PC, hardwareConcurrency: 16, deviceMemory: 6, webgpu: false })).toBe(3);
  });
  it("sin hardwareConcurrency → 1", () => {
    expect(numeroWorkersRecorte({ userAgent: PC, deviceMemory: 8, webgpu: false })).toBe(1);
  });
});

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("procesarEnPool", () => {
  it("procesa todos una vez y devuelve por índice aunque lleguen desordenados", async () => {
    const vistos: number[] = [];
    const lento = async (i: number) => {
      vistos.push(i);
      await dormir(i % 2 ? 15 : 1);
      return `r${i}`;
    };
    const r = await procesarEnPool([3, 5, 7, 9, 11, 13], [lento, lento, lento]);
    expect([...r.keys()].sort((a, b) => a - b)).toEqual([3, 5, 7, 9, 11, 13]);
    expect(r.get(9)).toBe("r9");
    expect(vistos.sort((a, b) => a - b)).toEqual([3, 5, 7, 9, 11, 13]);
  });
  it("nunca hay más tareas a la vez que ejecutores", async () => {
    let enCurso = 0;
    let max = 0;
    const ej = async (i: number) => {
      enCurso++;
      max = Math.max(max, enCurso);
      await dormir(2);
      enCurso--;
      return i;
    };
    await procesarEnPool([...Array(10).keys()], [ej, ej]);
    expect(max).toBe(2);
  });
  it("el rápido coge más trabajo que el lento", async () => {
    const quien: Record<string, number> = { rapido: 0, lento: 0 };
    const rapido = async () => {
      quien.rapido++;
      await dormir(1);
    };
    const lento = async () => {
      quien.lento++;
      await dormir(30);
    };
    await procesarEnPool([...Array(12).keys()], [rapido, lento]);
    expect(quien.rapido).toBeGreaterThan(quien.lento);
    expect(quien.rapido + quien.lento).toBe(12);
  });
  it("avisa de cada uno hecho con el recuento", async () => {
    const hechos: number[] = [];
    await procesarEnPool([1, 2, 3], [async (i) => i], (_i, n) => hechos.push(n));
    expect(hechos).toEqual([1, 2, 3]);
  });
  it("al primer error deja de repartir y lo lanza", async () => {
    const hechos: number[] = [];
    const ej = async (i: number) => {
      if (i === 2) throw new Error("falla 2");
      hechos.push(i);
      return i;
    };
    await expect(procesarEnPool([1, 2, 3, 4, 5], [ej])).rejects.toThrow("falla 2");
    expect(hechos).toEqual([1]);
  });
  it("lista vacía → mapa vacío; sin ejecutores → error", async () => {
    expect((await procesarEnPool([], [async () => 1])).size).toBe(0);
    await expect(procesarEnPool([1], [])).rejects.toThrow();
  });
});

describe("crearMutex", () => {
  it("ejecuta en serie y en orden, aunque una falle", async () => {
    const enSerie = crearMutex();
    const orden: string[] = [];
    const t = (n: string, ms: number, falla = false) =>
      enSerie(async () => {
        orden.push(`+${n}`);
        await dormir(ms);
        orden.push(`-${n}`);
        if (falla) throw new Error(n);
        return n;
      });
    const r = await Promise.allSettled([t("a", 10), t("b", 1, true), t("c", 1)]);
    expect(orden).toEqual(["+a", "-a", "+b", "-b", "+c", "-c"]);
    expect(r.map((x) => x.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
  });
});
