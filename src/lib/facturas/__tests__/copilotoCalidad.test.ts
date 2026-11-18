import { describe, expect, it } from "vitest";
import {
  aTextoPlano,
  normalizarAyuda,
  pasosDeCoincidencias,
  pasosSiguientes,
  pieDeDatos,
  textoErrorChat,
  textoErrorTablero,
  textoErrorSubida,
  textoProgreso,
  textoSegundos,
} from "../copilotoCalidad";

describe("textoProgreso: lo que se lee mientras se espera", () => {
  it("cambia con los segundos", () => {
    expect(textoProgreso(0)).toBe("Buscando en las facturas…");
    expect(textoProgreso(5)).toBe("Calculando…");
    expect(textoProgreso(12)).toBe("Casi está…");
    expect(textoProgreso(25)).toMatch(/consulta es larga/);
    expect(textoProgreso(60)).toMatch(/Parar/);
  });
  it("los segundos solo salen a partir de 5", () => {
    expect(textoSegundos(3)).toBe("");
    expect(textoSegundos(12.7)).toBe("12 s");
  });
});

describe("aTextoPlano: copiar y compartir sin ** ni |", () => {
  it("quita negritas, cursivas, encabezados, código y enlaces", () => {
    const md = "## Luz\n**Heineken 1/3: 41,85 €** por caja, *sin IVA*. Mira [la factura](https://x.es/a) y `002816`.";
    expect(aTextoPlano(md)).toBe("Luz\nHeineken 1/3: 41,85 € por caja, sin IVA. Mira la factura y 002816.");
  });
  it("las tablas pasan a una línea por fila y sin la fila de guiones", () => {
    const md = "| Factura | Fecha | Total |\n|---|:---:|---:|\n| 002816 | 30/10/2026 | 41,85 € |\n| 002817 | 31/10/2026 | 10,00 € |";
    expect(aTextoPlano(md)).toBe("Factura · Fecha · Total\n002816 · 30/10/2026 · 41,85 €\n002817 · 31/10/2026 · 10,00 €");
  });
  it("las viñetas pasan a «• » y no sobran líneas en blanco", () => {
    expect(aTextoPlano("- uno\n* dos\n\n\n\n+ tres")).toBe("• uno\n• dos\n\n• tres");
  });
  it("no toca los asteriscos de una multiplicación ni el texto normal", () => {
    expect(aTextoPlano("Total 2 * 3 = 6 € (10 % de IVA)")).toBe("Total 2 * 3 = 6 € (10 % de IVA)");
    expect(aTextoPlano("")).toBe("");
  });
});

const traza = (nombre: string, argumentos: Record<string, unknown> = {}, resultado = "completada") => [{ nombre, argumentos, resultado }];

describe("pasosSiguientes: botones en lugar de «¿Quieres…?»", () => {
  it("compras_producto: ver la factura, comparar proveedores y evolución, con la pregunta ya hecha", () => {
    const pasos = pasosSiguientes(traza("compras_producto", { producto: "heineken 1/3" }));
    expect(pasos.map((p) => p.texto)).toEqual(["Ver la factura", "Comparar con otro proveedor", "Evolución del precio"]);
    expect(pasos[1].pregunta).toBe("¿Qué proveedor me vende heineken 1/3 más barato?");
    expect(pasos[2].pregunta).toBe("Enséñame la gráfica del precio de heineken 1/3");
  });
  it("ficha_proveedor usa el proveedor", () => {
    expect(pasosSiguientes(traza("ficha_proveedor", { proveedor: "Embajadores" }))[0].pregunta).toBe("¿Cuánto le he comprado a Embajadores cada mes?");
  });
  it("sin pasos si fue un fallo o un «no hay», si la herramienta no se ejecutó o si no hay producto", () => {
    expect(pasosSiguientes(traza("compras_producto", { producto: "x" }), "error")).toEqual([]);
    expect(pasosSiguientes(traza("compras_producto", { producto: "x" }), "sin_datos")).toEqual([]);
    expect(pasosSiguientes(traza("compras_producto", { producto: "x" }, "fallida"))).toEqual([]);
    expect(pasosSiguientes(traza("compras_producto", {}))).toEqual([]);
    expect(pasosSiguientes(undefined)).toEqual([]);
  });
  it("máximo 3 y con la última herramienta conocida", () => {
    const h = [...traza("compras_producto", { producto: "a" }), ...traza("estadisticas_globales")];
    const pasos = pasosSiguientes(h);
    expect(pasos.length).toBeLessThanOrEqual(3);
    expect(pasos[0].texto).toBe("Mayores proveedores");
  });
});

describe("pasosDeCoincidencias: «¿Es alguno de estos?»", () => {
  it("un botón por nombre, sin repetidos ni vacíos, con la pregunta de su precio", () => {
    const pasos = pasosDeCoincidencias(["LAURENT PERRIER CUVEE", " laurent perrier cuvee ", "", 5, "LP ROSE", "A", "B"]);
    expect(pasos.map((p) => p.texto)).toEqual(["LAURENT PERRIER CUVEE", "LP ROSE", "A"]);
    expect(pasos[0].pregunta).toBe("¿A cuánto compro LAURENT PERRIER CUVEE?");
    expect(pasosDeCoincidencias(null)).toEqual([]);
  });
});

describe("pieDeDatos: de dónde sale la cifra", () => {
  it("fecha de los datos y «sin IVA» solo con lo que hay", () => {
    expect(pieDeDatos(traza("compras_producto"), { datos_hasta: "2026-11-12" })).toBe("Datos hasta 12/11/2026 · sin IVA");
    expect(pieDeDatos(traza("estadisticas_globales"), { datos_hasta: "2026-11-12" })).toBe("Datos hasta 12/11/2026");
    expect(pieDeDatos(traza("compras_producto"), undefined)).toBe("sin IVA");
    expect(pieDeDatos(traza("detalle_documento"), undefined)).toBe("");
  });
  it("nada en una respuesta con aviso", () => {
    expect(pieDeDatos(traza("compras_producto"), { datos_hasta: "2026-11-12" }, "error")).toBe("");
  });
  it("normalizarAyuda descarta lo que no tiene forma", () => {
    expect(normalizarAyuda({ sugerencias: ["a", 3, " "], datos_hasta: "2026-11-12T10:00" })).toEqual({ sugerencias: ["a"], datos_hasta: "2026-11-12" });
    expect(normalizarAyuda({ datos_hasta: "ayer" })).toBeUndefined();
    expect(normalizarAyuda(null)).toBeUndefined();
  });
});

describe("textoErrorSubida: nunca texto de base de datos", () => {
  it("el statement timeout del guardado se explica y manda reintentar", () => {
    const t = textoErrorSubida("insert factura: canceling statement due to statement timeout");
    expect(t).toMatch(/guardado ha tardado/);
    expect(t).toMatch(/Reintentar/);
    expect(t).not.toMatch(/statement|insert/i);
  });
  it("sin crédito / saturado, duplicado y red", () => {
    expect(textoErrorSubida("OpenAI 429: insufficient_quota")).toMatch(/saturado/);
    expect(textoErrorSubida('duplicate key value violates unique constraint "facturas_pkey"')).toMatch(/ya estaba guardada/);
    expect(textoErrorSubida("Failed to fetch")).toMatch(/conexión/);
  });
  it("texto técnico desconocido: frase genérica; texto ya escrito para el usuario: se respeta; vacío: genérica", () => {
    expect(textoErrorSubida('column "x" of relation "facturas" does not exist')).toMatch(/No se ha podido guardar/);
    expect(textoErrorSubida("El servidor ya no tiene el documento: vuelve a subirlo.")).toBe("El servidor ya no tiene el documento: vuelve a subirlo.");
    expect(textoErrorSubida("")).toMatch(/Reintentar/);
    expect(textoErrorSubida(undefined)).toMatch(/Reintentar/);
  });
});

describe("F3: lista blanca (texto genérico por defecto, nunca el mensaje de máquina)", () => {
  const TECNICOS = [
    "permission denied for table facturas",
    "invalid input syntax for type bigint: \"abc\"",
    "OpenAI 400: invalid_request_error",
    "TypeError: Cannot read properties of undefined (reading 'id')",
    "Algo raro pasó con el JWT",
    "ReferenceError: x is not defined",
  ];
  it("subida: ninguno de esos textos se enseña", () => {
    for (const t of TECNICOS) {
      const r = textoErrorSubida(t);
      expect(r).toMatch(/Reintentar/);
      expect(r).not.toMatch(/permission|invalid|OpenAI|TypeError|JWT|Reference/i);
    }
  });
  it("subida: las frases de la lista blanca sí se enseñan; con jerga dentro, no", () => {
    expect(textoErrorSubida("Elige al menos dos fotos para unirlas.")).toBe("Elige al menos dos fotos para unirlas.");
    expect(textoErrorSubida("Ese trabajo pertenece a otro usuario")).toBe("Ese trabajo pertenece a otro usuario");
    expect(textoErrorSubida("Elige al menos dos fotos TypeError")).not.toMatch(/TypeError/);
  });
  it("chat: texto genérico por defecto; tiempo, saturación y red se explican", () => {
    for (const t of TECNICOS) expect(textoErrorChat(t)).not.toMatch(/permission|invalid|OpenAI|TypeError|JWT|Reference/i);
    expect(textoErrorChat(undefined)).toMatch(/Reintentar/);
    expect(textoErrorChat("OpenAI chat 429: rate limit")).toMatch(/saturado/);
    expect(textoErrorChat("canceling statement due to statement timeout")).toMatch(/tardado/);
    expect(textoErrorChat("Failed to fetch")).toMatch(/conexión/);
  });
});

describe("textoErrorTablero", () => {
  it("enseña el aviso de migración y «timeout»; el resto, genérico", () => {
    const m = "El tablero aún no está activado en esta base de datos: falta aplicar la migración 20261105150500_tablero_compras.";
    expect(textoErrorTablero(m)).toBe(m);
    expect(textoErrorTablero("timeout")).toBe("timeout");
    expect(textoErrorTablero("permission denied for table facturas")).toMatch(/Reintentar/);
  });
});
