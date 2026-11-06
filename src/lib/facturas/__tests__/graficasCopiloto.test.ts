// Gráficas del copiloto de IA: las de cada respuesta, las fijadas en el
// tablero (lo guardado se lee sin fiarse) y el contexto dentro del mensaje.
import { describe, expect, it } from "vitest";
import {
  asuntoDeContexto,
  componerMensaje,
  fijar,
  graficasDeMensaje,
  MAX_FIJADAS,
  normalizarFijadas,
  separarContexto,
  tituloSerie,
} from "../graficasCopiloto";
import type { MensajeChat } from "@/hooks/useChatFacturas";
import type { SeriePrecio } from "../seriePrecio";

const SERIE: SeriePrecio = {
  producto: "Merluza",
  unidad: "kg",
  proveedores: ["Flope", "Pescados Paco"],
  puntos: [
    ["2026-08-01", 10.5, 0],
    ["2026-10-02", 12.9, 1],
  ],
  n: 2,
  min: 10.5,
  max: 12.9,
  ultimo: 12.9,
  variacion_pct: 22.9,
};

const mensaje = (over: Partial<MensajeChat>): MensajeChat => ({
  id: "m1",
  contenido: "",
  rol: "assistant",
  conversacion_id: "c1",
  created_at: "2026-11-05T10:00:00Z",
  ...over,
});

describe("gráficas de una respuesta", () => {
  it("una por adjunto con datos; las «sin datos», los documentos y los mensajes del usuario no", () => {
    const m = mensaje({
      adjuntos: [
        { tipo: "serie_precio", datos: SERIE },
        { tipo: "serie_precio", datos: { sin_datos: true, buscado: "rape" } },
        { tipo: "documentos", datos: [] },
      ],
    });
    expect(graficasDeMensaje(m)).toEqual([{ id: "m1#0", serie: SERIE }]);
    expect(graficasDeMensaje(mensaje({ rol: "user", adjuntos: [{ tipo: "serie_precio", datos: SERIE }] }))).toEqual([]);
    expect(tituloSerie(SERIE)).toBe("Evolución del precio · Merluza");
  });
});

describe("gráficas fijadas", () => {
  it("fijar no repite y recorta al tope (se quedan las últimas)", () => {
    const ahora = new Date("2026-11-05T10:00:00Z");
    let lista = fijar([], { id: "a", serie: SERIE }, ahora);
    expect(fijar(lista, { id: "a", serie: SERIE }, ahora)).toBe(lista);
    for (let i = 0; i < MAX_FIJADAS + 2; i++) lista = fijar(lista, { id: `g${i}`, serie: SERIE }, ahora);
    expect(lista).toHaveLength(MAX_FIJADAS);
    expect(lista[lista.length - 1].id).toBe(`g${MAX_FIJADAS + 1}`);
    expect(lista[0].fijadaEn).toBe("2026-11-05T10:00:00.000Z");
  });

  it("lo guardado se lee sin fiarse: basura, series rotas y repetidas fuera", () => {
    expect(normalizarFijadas("hola")).toEqual([]);
    const leidas = normalizarFijadas([
      { id: "a", serie: SERIE, fijadaEn: "x" },
      { id: "a", serie: SERIE },
      { id: "b", serie: { producto: "Rota" } },
      { id: 3, serie: SERIE },
      null,
    ]);
    expect(leidas.map((g) => g.id)).toEqual(["a"]);
  });
});

describe("contexto dentro del mensaje", () => {
  it("viaja al final y se separa para enseñarlo; los corchetes no rompen el formato", () => {
    const contexto = "gráfica de evolución del precio unitario sin IVA de «Merluza» (unidad kg)";
    const msg = componerMensaje("  ¿Por qué subió?  ", contexto);
    expect(msg.startsWith("¿Por qué subió?\n\n[Sobre la gráfica seleccionada: ")).toBe(true);
    expect(separarContexto(msg)).toEqual({ pregunta: "¿Por qué subió?", contexto });
    expect(asuntoDeContexto(contexto)).toBe("precio de Merluza");
    expect(componerMensaje("¿Y el IVA?", null)).toBe("¿Y el IVA?");
    expect(separarContexto(componerMensaje("Hola", "con [corchetes]"))).toEqual({ pregunta: "Hola", contexto: "con corchetes" });
  });
});
