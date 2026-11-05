// Lógica pura del tablero de gráficas del copiloto (pestaña «Análisis»).
import { describe, expect, it } from "vitest";
import {
  asuntoDeContexto,
  chipsSeguimiento,
  componerMensaje,
  contextoTarjeta,
  explicacionCorta,
  separarContexto,
  serieDeTarjeta,
  tarjetasDeMensajes,
  tarjetasTablero,
  tituloTarjeta,
  type Tarjeta,
} from "../tableroGraficas";
import type { MensajeChat } from "@/hooks/useChatFacturas";
import type { ResultadoRapido } from "@/hooks/usePreguntasRapidas";
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
  id: "m",
  contenido: "",
  rol: "assistant",
  conversacion_id: "c1",
  created_at: "2026-11-05T10:00:00Z",
  ...over,
});

const rapida = (over: Partial<ResultadoRapido>): ResultadoRapido => ({
  id: "r1",
  preguntaId: "gasto-por-mes",
  estado: "ok",
  datos: {},
  creadoEn: "2026-11-05T10:05:00Z",
  despuesDe: 0,
  ...over,
});

const tarjetaIa = (serie: SeriePrecio = SERIE): Tarjeta => ({
  origen: "ia",
  id: "m1#0",
  mensajeId: "m1",
  creadoEn: "2026-11-05T10:00:00Z",
  titulo: "Evolución del precio · Merluza",
  serie,
  explicacion: "",
});

describe("tarjetas del tablero", () => {
  it("una tarjeta por adjunto con datos de cada respuesta de la IA; las «sin datos» no", () => {
    const tarjetas = tarjetasDeMensajes([
      mensaje({ id: "u1", rol: "user", contenido: "merluza" }),
      mensaje({
        id: "m1",
        contenido: "La merluza ha subido un **22,9 %** desde agosto. Te dejo la gráfica debajo.",
        adjuntos: [
          { tipo: "serie_precio", datos: SERIE },
          { tipo: "serie_precio", datos: { sin_datos: true, buscado: "rape" } },
        ],
      }),
      mensaje({ id: "m2", contenido: "Sin gráfica." }),
    ]);
    expect(tarjetas).toHaveLength(1);
    expect(tarjetas[0]).toMatchObject({
      id: "m1#0",
      mensajeId: "m1",
      titulo: "Evolución del precio · Merluza",
      explicacion: "La merluza ha subido un 22,9 % desde agosto.",
    });
  });

  it("mezcla IA y al instante, la más reciente primero, y respeta las quitadas", () => {
    const mensajes = [
      mensaje({ id: "m1", created_at: "2026-11-05T10:00:00Z", adjuntos: [{ tipo: "serie_precio", datos: SERIE }] }),
      mensaje({ id: "m2", created_at: "2026-11-05T10:10:00Z", adjuntos: [{ tipo: "serie_precio", datos: SERIE }] }),
    ];
    const rapidas = [rapida({ id: "r1", creadoEn: "2026-11-05T10:05:00Z" })];
    expect(tarjetasTablero(mensajes, rapidas).map((t) => t.id)).toEqual(["m2#0", "r1", "m1#0"]);
    expect(tarjetasTablero(mensajes, rapidas, new Set(["m2#0"])).map((t) => t.id)).toEqual(["r1", "m1#0"]);
  });

  it("la «Evolución de precio» al instante cuenta como gráfica de precio", () => {
    const t: Tarjeta = { origen: "rapida", id: "r1", creadoEn: "", resultado: rapida({ preguntaId: "evolucion-precio", datos: SERIE }) };
    expect(serieDeTarjeta(t)?.producto).toBe("Merluza");
    expect(tituloTarjeta(t, "Evolución de precio")).toBe("Evolución del precio · Merluza");
    const sinDatos: Tarjeta = { ...t, resultado: rapida({ preguntaId: "evolucion-precio", datos: { sin_datos: true, buscado: "rape" } }) };
    expect(serieDeTarjeta(sinDatos)).toBeNull();
    expect(tituloTarjeta(sinDatos, "Evolución de precio")).toBe("Evolución de precio");
  });
});

describe("explicación corta", () => {
  it("1-2 frases, sin markdown ni el anuncio de la gráfica", () => {
    expect(
      explicacionCorta("Aquí tienes la gráfica.\n\n- **Último:** 12,90 €/kg con Pescados Paco.\n- Mínimo 10,50 €/kg. Máximo 12,90 €/kg."),
    ).toBe("Último: 12,90 €/kg con Pescados Paco. Mínimo 10,50 €/kg.");
  });

  it("corta una frase demasiado larga", () => {
    const larga = "a".repeat(400);
    const r = explicacionCorta(larga);
    expect(r.length).toBeLessThanOrEqual(240);
    expect(r.endsWith("…")).toBe(true);
  });
});

describe("chips «pregúntale más» según el tipo de gráfica", () => {
  it("precio que sube con dos proveedores: periodo, por qué subió y quién es más barato", () => {
    const chips = chipsSeguimiento(tarjetaIa()).map((c) => c.etiqueta);
    expect(chips).toEqual(["Solo los últimos 3 meses", "¿Por qué subió?", "¿Quién es más barato?", "¿Cuánto hemos comprado?"]);
    expect(chipsSeguimiento(tarjetaIa())[0].pregunta).toMatch(/«Merluza» solo de los últimos 3 meses/);
  });

  it("precio que baja con un solo proveedor: «por qué bajó» y comparar con otro proveedor", () => {
    const chips = chipsSeguimiento(
      tarjetaIa({ ...SERIE, variacion_pct: -5, puntos: [["2026-08-01", 10.5, 0], ["2026-10-02", 9.9, 0]] }),
    ).map((c) => c.etiqueta);
    expect(chips).toContain("¿Por qué bajó?");
    expect(chips).toContain("Compáralo con otro proveedor");
    expect(chips).not.toContain("¿Por qué subió?");
  });

  it("sin variación no hay «por qué»", () => {
    const chips = chipsSeguimiento(tarjetaIa({ ...SERIE, variacion_pct: null })).map((c) => c.etiqueta);
    expect(chips.some((c) => c.startsWith("¿Por qué"))).toBe(false);
  });

  it("respuestas al instante: chips por pregunta; cargando, error o desconocida no tienen", () => {
    const t = (r: Partial<ResultadoRapido>): Tarjeta => ({ origen: "rapida", id: "r", creadoEn: "", resultado: rapida(r) });
    expect(chipsSeguimiento(t({ preguntaId: "gasto-por-mes" })).map((c) => c.etiqueta)).toContain("Compáralo con el año pasado");
    expect(chipsSeguimiento(t({ preguntaId: "top-proveedores" })).length).toBeGreaterThan(0);
    expect(chipsSeguimiento(t({ preguntaId: "gasto-por-mes", estado: "cargando" }))).toEqual([]);
    expect(chipsSeguimiento(t({ preguntaId: "gasto-por-mes", estado: "error" }))).toEqual([]);
    expect(chipsSeguimiento(t({ preguntaId: "no-existe" }))).toEqual([]);
  });
});

describe("contexto de la tarjeta seleccionada", () => {
  it("gráfica de precio: producto, unidad, proveedores, periodo, cifras y cómo regenerarla", () => {
    const c = contextoTarjeta(tarjetaIa());
    expect(c).toContain("«Merluza» (unidad kg)");
    expect(c).toContain("proveedores: Flope, Pescados Paco");
    expect(c).toContain("2 compras del 01/08/2026 al 02/10/2026");
    expect(c).toContain("último 12,90 €/kg");
    expect(c).toContain("variación +22,90 %");
    expect(c).toContain("grafico_precio");
  });

  it("respuesta al instante: su nombre y descripción", () => {
    const t: Tarjeta = { origen: "rapida", id: "r", creadoEn: "", resultado: rapida({ preguntaId: "gasto-por-mes" }) };
    expect(contextoTarjeta(t, { etiqueta: "Gasto por mes", descripcion: "Facturas de los últimos 12 meses" })).toBe(
      "respuesta al instante «Gasto por mes» (Facturas de los últimos 12 meses); calcula las cifras con tus herramientas",
    );
  });

  it("el contexto viaja al final del mensaje y se separa para enseñarlo", () => {
    const contexto = contextoTarjeta(tarjetaIa());
    const msg = componerMensaje("  ¿Por qué subió?  ", contexto);
    expect(msg.startsWith("¿Por qué subió?\n\n[Sobre la gráfica seleccionada: ")).toBe(true);
    expect(separarContexto(msg)).toEqual({ pregunta: "¿Por qué subió?", contexto });
    expect(asuntoDeContexto(contexto)).toBe("precio de Merluza");
  });

  it("sin contexto el mensaje es la pregunta tal cual; los corchetes del contexto no rompen el formato", () => {
    expect(componerMensaje("¿Y el IVA?", null)).toBe("¿Y el IVA?");
    expect(separarContexto("¿Y el IVA?")).toEqual({ pregunta: "¿Y el IVA?", contexto: null });
    const msg = componerMensaje("Hola", "con [corchetes] dentro");
    expect(separarContexto(msg)).toEqual({ pregunta: "Hola", contexto: "con corchetes dentro" });
    expect(asuntoDeContexto("respuesta al instante «Top proveedores»; …")).toBe("Top proveedores");
  });
});
