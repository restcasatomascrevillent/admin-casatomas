/**
 * Lógica pura del asistente móvil: lista de fotos (añadir hasta 10, quitar,
 * mover), firma del montaje, hora inicial al programar, texto inicial,
 * almacén en memoria y reintentos con la red del móvil.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession: () => Promise.resolve({ data: { session: null } }) } } }));

import { madridAUtc, utcAMadrid } from "@/components/instagram/programar/logica";
import { ErrorIA } from "@/components/instagram/ia/api";
import { ErrorInstagram } from "@/components/marketing/instagram/api";
import { crearAlmacenMemoria, type BorradorMovil } from "../almacen";
import { fotosParaMontar, moverEnLista, reducirFotos, resumenSubidas, subidaCaducada, todasSubidas, VIDA_SUBIDA_MS, type FotoMovil } from "../estado";
import { firmaMontaje, horaInicial, unirCaption } from "../logica";
import { Cancelado, conReintentos, esErrorReintentable, ErrorReintentable } from "../reintentos";

const foto = (clave: string, extra: Partial<FotoMovil> = {}): FotoMovil => ({
  clave,
  origen: "subida",
  nombre: `${clave}.jpg`,
  blob: null,
  vista: "",
  ancho: 1080,
  alto: 1350,
  estado: "subida",
  subida: { id: `subida:${clave}`, url: `https://x/${clave}.jpg` },
  ...extra,
});

describe("lista de fotos", () => {
  it("añade hasta 10 y descarta las que sobran", () => {
    const l = reducirFotos([], { tipo: "anadir", fotos: Array.from({ length: 12 }, (_, i) => foto(`f${i}`)) });
    expect(l).toHaveLength(10);
    expect(l[9].clave).toBe("f9");
  });

  it("mueve y quita", () => {
    const l = [foto("a"), foto("b"), foto("c")];
    expect(reducirFotos(l, { tipo: "mover", desde: 2, hasta: 0 }).map((f) => f.clave)).toEqual(["c", "a", "b"]);
    expect(reducirFotos(l, { tipo: "quitar", clave: "b" }).map((f) => f.clave)).toEqual(["a", "c"]);
    expect(moverEnLista([1, 2, 3], 5, 0)).toEqual([1, 2, 3]);
  });

  it("actualizar una foto que ya no está no cambia nada", () => {
    const l = [foto("a")];
    expect(reducirFotos(l, { tipo: "actualizar", clave: "zzz", cambios: { estado: "error" } })).toBe(l);
  });

  it("para montar solo van las subidas, en orden", () => {
    const l = [foto("a"), foto("b", { estado: "subiendo", subida: null }), foto("c")];
    expect(fotosParaMontar(l).map((f) => f.id)).toEqual(["subida:a", "subida:c"]);
    expect(todasSubidas(l)).toBe(false);
    expect(resumenSubidas(l)).toEqual({ subidas: 2, total: 3, errores: 0, pendientes: 1 });
  });

  it("una copia tmp/ de más de 20 h se vuelve a subir", () => {
    const ahora = Date.now();
    expect(subidaCaducada({ subidaEn: ahora - 1000 }, ahora)).toBe(false);
    expect(subidaCaducada({ subidaEn: ahora - VIDA_SUBIDA_MS - 1 }, ahora)).toBe(true);
    expect(subidaCaducada({ subidaEn: null }, ahora)).toBe(true);
  });
});

describe("montaje y programación", () => {
  it("la firma cambia con el orden, la marca o el texto, no con la URL", () => {
    const a = [foto("a"), foto("b")];
    const f = firmaMontaje("casa-tomas", a, "centolla");
    expect(firmaMontaje("casa-tomas", [foto("a", { subida: { id: "subida:a", url: "otra" } }), foto("b")], " centolla ")).toBe(f);
    expect(firmaMontaje("casa-tomas", [a[1], a[0]], "centolla")).not.toBe(f);
    expect(firmaMontaje("touza", a, "centolla")).not.toBe(f);
    expect(firmaMontaje("casa-tomas", a, "")).not.toBe(f);
  });

  it("texto inicial = caption + hashtags", () => {
    expect(unirCaption({ caption: "Hola ", hashtags: ["#a", "#b"] })).toBe("Hola\n\n#a #b");
    expect(unirCaption({ caption: "Solo", hashtags: [] })).toBe("Solo");
  });

  it("hora inicial: la sugerida si vale; si no, 13:00 o 20:30 de Madrid", () => {
    const ahora = madridAUtc("2026-11-05", "10:00")!;
    const sugerida = madridAUtc("2026-11-06", "19:45")!.toISOString();
    expect(horaInicial(sugerida, ahora)).toEqual({ fecha: "2026-11-06", hora: "19:45" });
    expect(horaInicial(null, ahora)).toEqual({ fecha: "2026-11-05", hora: "13:00" });
    expect(horaInicial(null, madridAUtc("2026-11-05", "12:45")!)).toEqual({ fecha: "2026-11-05", hora: "20:30" });
    expect(horaInicial(null, madridAUtc("2026-11-05", "22:00")!)).toEqual({ fecha: "2026-11-06", hora: "13:00" });
    // Sugerida en el pasado: se ignora.
    expect(horaInicial(madridAUtc("2026-11-04", "13:00")!.toISOString(), ahora)).toEqual({ fecha: "2026-11-05", hora: "13:00" });
    expect(utcAMadrid(madridAUtc("2026-11-05", "13:00")!).hora).toBe("13:00");
  });
});

describe("almacén del móvil", () => {
  it("guarda, lee y borra; olvida los borradores de más de 7 días", async () => {
    const a = crearAlmacenMemoria();
    const b: BorradorMovil = { version: 1, marca: "casa-tomas", indicacion: "x", tono: "cercano", fotos: [], montaje: null, firmaMontaje: null, caption: "", paso: "fotos", guardadoEn: Date.now() };
    await a.guardar(b);
    expect(await a.leer()).toEqual(b);
    await a.guardar({ ...b, guardadoEn: Date.now() - 8 * 24 * 3600 * 1000 });
    expect(await a.leer()).toBeNull();
    await a.guardar(b);
    await a.borrar();
    expect(await a.leer()).toBeNull();
  });
});

describe("reintentos", () => {
  const sinEspera = { dormir: async () => {}, esperarConexion: async () => {} };

  it("reintenta los fallos de red y acaba bien", async () => {
    let n = 0;
    const r = await conReintentos(
      async () => {
        n++;
        if (n < 3) throw new TypeError("Failed to fetch");
        return "ok";
      },
      { ...sinEspera, enLinea: () => true },
    );
    expect(r).toBe("ok");
    expect(n).toBe(3);
  });

  it("no reintenta un error que no es de red", async () => {
    const fn = vi.fn(async () => {
      throw new ErrorReintentable("Sin permiso", false, 403);
    });
    await expect(conReintentos(fn, sinEspera)).rejects.toThrow("Sin permiso");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("se rinde tras los intentos", async () => {
    const fn = vi.fn(async () => {
      throw new TypeError("Load failed");
    });
    await expect(conReintentos(fn, { ...sinEspera, enLinea: () => true, intentos: 3 })).rejects.toThrow("Load failed");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("sin cobertura no gasta intentos: espera a la red", async () => {
    let red = false;
    let n = 0;
    const esperas: number[] = [];
    const r = await conReintentos(
      async () => {
        n++;
        if (!red) throw new TypeError("Failed to fetch");
        return n;
      },
      {
        intentos: 1,
        dormir: async () => {},
        enLinea: () => red,
        esperarConexion: async () => {
          esperas.push(n);
          if (esperas.length === 3) red = true;
        },
      },
    );
    expect(r).toBe(4);
    expect(esperas).toEqual([1, 2, 3]);
  });

  it("clasifica los errores", () => {
    expect(esErrorReintentable(new ErrorInstagram("x", "red"))).toBe(true);
    expect(esErrorReintentable(new ErrorInstagram("x", "servidor", 503))).toBe(true);
    expect(esErrorReintentable(new ErrorInstagram("x", "validacion", 422))).toBe(false);
    // La cuota de IA nunca se reintenta sola.
    expect(esErrorReintentable(new ErrorIA("x", "cupo", 429))).toBe(false);
    expect(esErrorReintentable(new Cancelado())).toBe(false);
  });
});
