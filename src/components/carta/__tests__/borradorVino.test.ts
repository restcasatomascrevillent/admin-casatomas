import { describe, expect, it } from "vitest";
import { borrarBorradorVino, guardarBorradorVino, haceCuantoBorrador, leerBorradorVino, VIDA_BORRADOR_MS, type AlmacenBorradorVino, type BorradorVino } from "../borradorVino";
import type { DatosVinoFoto } from "../leerVinoFoto";

function enMemoria(): AlmacenBorradorVino & { valor: BorradorVino | null } {
  const a = {
    valor: null as BorradorVino | null,
    leer: async () => a.valor,
    guardar: async (b: BorradorVino) => {
      a.valor = b;
    },
    borrar: async () => {
      a.valor = null;
    },
  };
  return a;
}

const DATOS = { nombre: "Viña Pomal" } as DatosVinoFoto;
const FOTO = new Blob(["x"], { type: "image/jpeg" });

describe("borrador del vino a medias", () => {
  it("guarda y lee el último, con la hora", async () => {
    const almacen = enMemoria();
    await guardarBorradorVino({ foto: FOTO, nombreFoto: "a.jpg", datos: DATOS }, { almacen, ahora: 1000 });
    expect(await leerBorradorVino({ almacen, ahora: 2000 })).toEqual({ foto: FOTO, nombreFoto: "a.jpg", datos: DATOS, guardadoEn: 1000 });
  });

  it("caducado: no se ofrece y se borra", async () => {
    const almacen = enMemoria();
    await guardarBorradorVino({ foto: FOTO, nombreFoto: "a.jpg", datos: DATOS }, { almacen, ahora: 0 });
    expect(await leerBorradorVino({ almacen, ahora: VIDA_BORRADOR_MS + 1 })).toBeNull();
    expect(almacen.valor).toBeNull();
  });

  it("borrar lo quita; sin almacén (Safari privado) no pasa nada", async () => {
    const almacen = enMemoria();
    await guardarBorradorVino({ foto: FOTO, nombreFoto: "a.jpg", datos: DATOS }, { almacen });
    await borrarBorradorVino({ almacen });
    expect(await leerBorradorVino({ almacen })).toBeNull();
    await expect(guardarBorradorVino({ foto: FOTO, nombreFoto: "a.jpg", datos: DATOS }, { almacen: null })).resolves.toBeUndefined();
    expect(await leerBorradorVino({ almacen: null })).toBeNull();
  });

  it("un almacén que falla nunca rompe el formulario", async () => {
    const roto: AlmacenBorradorVino = {
      leer: async () => {
        throw new Error("sin espacio");
      },
      guardar: async () => {
        throw new Error("sin espacio");
      },
      borrar: async () => {
        throw new Error("sin espacio");
      },
    };
    await expect(guardarBorradorVino({ foto: FOTO, nombreFoto: "a.jpg", datos: DATOS }, { almacen: roto })).resolves.toBeUndefined();
    expect(await leerBorradorVino({ almacen: roto })).toBeNull();
    await expect(borrarBorradorVino({ almacen: roto })).resolves.toBeUndefined();
  });

  it("«hace X»", () => {
    expect(haceCuantoBorrador(0, 20_000)).toBe("hace un momento");
    expect(haceCuantoBorrador(0, 5 * 60_000)).toBe("hace 5 min");
    expect(haceCuantoBorrador(0, 2 * 3600_000)).toBe("hace 2 h");
  });
});
