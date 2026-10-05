import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  crearColaSubida,
  cuentaActivos,
  debeAvisarEnCampana,
  type DepsCola,
  hayEnNavegador,
  nombreUnico,
  progresoTanda,
  type ResultadoProcesamiento,
  textoIndicador,
  textoResumenTanda,
  clasificarResultado,
} from "../colaSubida";
import { SinDocumentosLargos, type EstadoTrabajo, type PlanDocumento } from "../documentoLargo";

const pdf = (nombre: string, bytes = 10) => new File(["x".repeat(bytes)], nombre, { type: "application/pdf" });
const jpg = (nombre: string) => new File(["x"], nombre, { type: "image/jpeg" });

/** Promesa que el test resuelve cuando quiere. */
function diferida<T>() {
  let resolver!: (v: T) => void;
  let rechazar!: (e: unknown) => void;
  const promesa = new Promise<T>((ok, ko) => { resolver = ok; rechazar = ko; });
  return { promesa, resolver, rechazar };
}

const vuelta = () => new Promise((r) => setTimeout(r, 0));

const ok = (nombre: string, extra: Partial<ResultadoProcesamiento> = {}): ResultadoProcesamiento => ({
  nombre, success: true, tipo: "factura", alertas: [], archivoGuardado: true, duplicado: false, ...extra,
});

const trabajo = (estado: string, extra: Partial<EstadoTrabajo> = {}): EstadoTrabajo => ({
  id: "t1", estado, num_paginas: 5, nombre_original: "luga.jpg", error: null,
  resultado: { success: true, tipo: "factura", webhookResponse: { tipo: "factura" }, alertas: [] },
  factura_id: 54, updated_at: "", ocr_trabajo_paginas: [], ...extra,
});

function deps(extra: Partial<DepsCola> = {}): DepsCola {
  return {
    planificar: async () => ({ camino: "unico" }),
    iniciarLargo: async () => ({ trabajoId: "t1", numPiezas: 5 }),
    esperar: async () => trabajo("completado"),
    procesarUnico: async (_f, nombre) => ok(nombre),
    crearPreview: () => "",
    revocarPreview: () => {},
    ...extra,
  };
}

describe("añadirArchivos", () => {
  it("rechaza tipos y tamaños no permitidos y da nombre único a las fotos «image.jpg» de la cámara", () => {
    const cola = crearColaSubida(deps());
    const grande = new File([new Uint8Array(11 * 1024 * 1024)], "enorme.pdf", { type: "application/pdf" });
    const r = cola.añadirArchivos([jpg("image.jpg"), jpg("image.jpg"), new File(["x"], "a.txt", { type: "text/plain" }), grande]);
    expect(r.añadidos).toBe(2);
    expect(r.rechazados.map((x) => x.nombre)).toEqual(["a.txt", "enorme.pdf"]);
    const nombres = cola.getEstado().elementos.map((e) => e.nombre);
    expect(new Set(nombres).size).toBe(2);
    expect(nombres[1]).toMatch(/^foto-.*-2\.jpg$/);
    expect(cola.getEstado().elementos.every((e) => e.fase === "seleccionado")).toBe(true);
  });

  it("nombreUnico respeta el nombre si está libre", () => {
    expect(nombreUnico(pdf("f.pdf"), new Set())).toBe("f.pdf");
    expect(nombreUnico(pdf("f.pdf"), new Set(["f.pdf"]))).toBe("f-2.pdf");
  });
});

describe("camino de una página", () => {
  it("envía, avisa de cada documento y una sola vez al acabar la tanda", async () => {
    const d = diferida<ResultadoProcesamiento>();
    const alTerminar = vi.fn();
    const alAcabarTanda = vi.fn();
    const cola = crearColaSubida(deps({ procesarUnico: () => d.promesa, alTerminar, alAcabarTanda }));
    cola.añadirArchivos([pdf("a.pdf")]);
    expect(cola.enviar()).toBe(1);
    await vuelta();
    const e = cola.getEstado().elementos[0];
    expect(e.fase).toBe("enviando");
    // Mientras la llamada está abierta el documento depende del navegador.
    expect(hayEnNavegador(cola.getEstado())).toBe(true);
    expect(cuentaActivos(cola.getEstado())).toBe(1);
    expect(progresoTanda(cola.getEstado())).toEqual({ hechos: 0, total: 1 });

    d.resolver(ok("a.pdf", { alertas: [{ mensaje: "Total raro" } as never] }));
    await vuelta();
    expect(cola.getEstado().elementos[0].fase).toBe("terminado");
    expect(alTerminar).toHaveBeenCalledTimes(1);
    expect(alAcabarTanda).toHaveBeenCalledTimes(1);
    expect(alAcabarTanda.mock.calls[0][0]).toMatchObject({ total: 1, porClase: { avisos: 1, guardada: 0 } });
    expect(hayEnNavegador(cola.getEstado())).toBe(false);
    expect(progresoTanda(cola.getEstado())).toBeNull();
  });

  it("un error se queda como fallido con el fichero y se puede reintentar", async () => {
    let intentos = 0;
    const cola = crearColaSubida(deps({
      procesarUnico: async (_f, nombre) => {
        intentos += 1;
        if (intentos === 1) throw new Error("Failed to fetch");
        return ok(nombre);
      },
    }));
    cola.añadirArchivos([pdf("a.pdf")]);
    cola.enviar();
    await vuelta();
    const e = cola.getEstado().elementos[0];
    expect(e.resultado).toMatchObject({ success: false, error: "Failed to fetch" });
    expect(cola.reintentar()).toBe(1);
    await vuelta();
    expect(cola.getEstado().elementos[0].resultado?.success).toBe(true);
  });

  it("procesa como mucho `maxSimultaneos` a la vez; se pueden añadir más mientras tanto", async () => {
    const pendientes: ReturnType<typeof diferida<ResultadoProcesamiento>>[] = [];
    const cola = crearColaSubida(deps({
      maxSimultaneos: 2,
      procesarUnico: () => {
        const d = diferida<ResultadoProcesamiento>();
        pendientes.push(d);
        return d.promesa;
      },
    }));
    cola.añadirArchivos([pdf("a.pdf"), pdf("b.pdf"), pdf("c.pdf")]);
    cola.enviar();
    await vuelta();
    expect(pendientes).toHaveLength(2);
    expect(cola.getEstado().elementos.map((e) => e.fase)).toEqual(["enviando", "enviando", "en_cola"]);
    // Añadir y enviar otro con la tanda en marcha: se suma a la misma tanda.
    cola.añadirArchivos([pdf("d.pdf")]);
    cola.enviar();
    expect(progresoTanda(cola.getEstado())).toEqual({ hechos: 0, total: 4 });
    pendientes[0].resolver(ok("a.pdf"));
    await vuelta();
    expect(pendientes).toHaveLength(3);
  });
});

describe("camino largo (trabajos en el servidor)", () => {
  const plan: PlanDocumento = {
    camino: "largo", origen: "imagen", paginasDocumento: 1,
    piezas: [1, 2, 3, 4, 5].map((n) => ({ blob: new Blob(["x"]), mime: "image/jpeg" as const, pieza: "franja" as const, pagina_doc: 1, franja: n, franjas_pagina: 5 })),
  };

  it("sube los trozos (en el navegador) y luego solo sondea (en el servidor)", async () => {
    const subida = diferida<{ trabajoId: string; numPiezas: number }>();
    const fin = diferida<EstadoTrabajo>();
    let avisoCambio: ((t: EstadoTrabajo | null) => void) | undefined;
    const cola = crearColaSubida(deps({
      planificar: async () => plan,
      iniciarLargo: async (_f, _p, onProgreso) => {
        onProgreso(2, 6);
        return subida.promesa;
      },
      esperar: (_id, onCambio) => {
        avisoCambio = onCambio;
        return fin.promesa;
      },
    }));
    cola.añadirArchivos([jpg("luga.jpg")]);
    cola.enviar();
    await vuelta();
    let e = cola.getEstado().elementos[0];
    expect(e.fase).toBe("subiendo");
    expect(e.progreso).toBe("Subiendo trozo 2 de 6…");
    expect(hayEnNavegador(cola.getEstado())).toBe(true);

    subida.resolver({ trabajoId: "t1", numPiezas: 5 });
    await vuelta();
    e = cola.getEstado().elementos[0];
    expect(e.fase).toBe("procesando");
    expect(e.trabajoId).toBe("t1");
    // Ya está en el servidor: cerrar la pestaña no lo pierde.
    expect(hayEnNavegador(cola.getEstado())).toBe(false);
    expect(cuentaActivos(cola.getEstado())).toBe(1);

    avisoCambio!(trabajo("pagina1"));
    expect(cola.getEstado().elementos[0].progreso).toBe("Leyendo el trozo 1 de 5…");
    fin.resolver(trabajo("completado"));
    await vuelta();
    expect(cola.getEstado().elementos[0]).toMatchObject({ fase: "terminado", resultado: { success: true, piezas: 5 } });
  });

  it("si el servidor aún no admite documentos largos, va por el camino de una página", async () => {
    const procesarUnico = vi.fn(async (_f: File, nombre: string) => ok(nombre));
    const cola = crearColaSubida(deps({
      planificar: async () => plan,
      iniciarLargo: async () => { throw new SinDocumentosLargos("403"); },
      procesarUnico,
    }));
    cola.añadirArchivos([jpg("luga.jpg")]);
    cola.enviar();
    await vuelta();
    expect(procesarUnico).toHaveBeenCalledTimes(1);
    expect(cola.getEstado().elementos[0].resultado?.success).toBe(true);
  });

  it("un trabajo fallido se pinta como fallido con el error del servidor", async () => {
    const cola = crearColaSubida(deps({
      planificar: async () => plan,
      esperar: async () => trabajo("fallido", { error: "tiempo agotado (15 min) sin terminar" }),
    }));
    cola.añadirArchivos([jpg("luga.jpg")]);
    cola.enviar();
    await vuelta();
    expect(cola.getEstado().elementos[0].resultado).toMatchObject({ success: false, error: "tiempo agotado (15 min) sin terminar" });
  });

  it("adopta los trabajos que siguen en el servidor tras recargar, sin repetirlos", async () => {
    const fin = diferida<EstadoTrabajo>();
    const alTerminar = vi.fn();
    const cola = crearColaSubida(deps({ esperar: () => fin.promesa, alTerminar }));
    expect(cola.adoptar([trabajo("paginas")])).toBe(1);
    expect(cola.adoptar([trabajo("paginas")])).toBe(0);
    const e = cola.getEstado().elementos[0];
    expect(e).toMatchObject({ fase: "procesando", file: null, trabajoId: "t1", nombre: "luga.jpg" });
    expect(hayEnNavegador(cola.getEstado())).toBe(false);
    fin.resolver(trabajo("duplicado", {
      resultado: { success: true, duplicado: true, sustituible: { trabajo_id: "t1", existente: { id: 54 }, nuevo: {} } },
    }));
    await vuelta();
    expect(alTerminar).toHaveBeenCalledTimes(1);
    expect(clasificarResultado(cola.getEstado().elementos[0].resultado)).toBe("pendiente");
  });
});

describe("una página en segundo plano (trabajo de una pieza)", () => {
  const unico = (estado: string, extra: Partial<EstadoTrabajo> = {}) => trabajo(estado, { num_paginas: 1, nombre_original: "a.pdf", ...extra });

  it("sube el fichero (en el navegador) y luego solo sondea (en el servidor), sin hablar de trozos", async () => {
    const subida = diferida<{ trabajoId: string; numPiezas: number }>();
    const fin = diferida<EstadoTrabajo>();
    let avisoCambio: ((t: EstadoTrabajo | null) => void) | undefined;
    const procesarUnico = vi.fn(async (_f: File, nombre: string) => ok(nombre));
    const cola = crearColaSubida(deps({
      iniciarUnico: () => subida.promesa,
      esperar: (_id, onCambio) => {
        avisoCambio = onCambio;
        return fin.promesa;
      },
      procesarUnico,
    }));
    cola.añadirArchivos([pdf("a.pdf")]);
    cola.enviar();
    await vuelta();
    let e = cola.getEstado().elementos[0];
    expect(e).toMatchObject({ fase: "subiendo", progreso: "Subiendo…" });
    // Mientras se sube, cerrar la pestaña lo perdería.
    expect(hayEnNavegador(cola.getEstado())).toBe(true);

    subida.resolver({ trabajoId: "u1", numPiezas: 1 });
    await vuelta();
    e = cola.getEstado().elementos[0];
    expect(e).toMatchObject({ fase: "procesando", trabajoId: "u1" });
    expect(e.piezas).toBeUndefined();
    // Ya está en el servidor: los 10-40 s de lectura no dependen de la pestaña.
    expect(hayEnNavegador(cola.getEstado())).toBe(false);

    avisoCambio!(unico("pagina1"));
    expect(cola.getEstado().elementos[0].progreso).toBe("Leyendo el documento…");
    avisoCambio!(unico("consolidando"));
    expect(cola.getEstado().elementos[0].progreso).toBe("Comprobando importes y guardando…");
    fin.resolver(unico("completado"));
    await vuelta();
    e = cola.getEstado().elementos[0];
    expect(e).toMatchObject({ fase: "terminado", resultado: { success: true } });
    expect(e.resultado?.piezas).toBeUndefined();
    expect(procesarUnico).not.toHaveBeenCalled();
  });

  it("si el servidor aún no lo admite (versión antigua), va por el camino síncrono de siempre", async () => {
    const procesarUnico = vi.fn(async (_f: File, nombre: string) => ok(nombre));
    const esperar = vi.fn();
    const cola = crearColaSubida(deps({
      iniciarUnico: async () => { throw new SinDocumentosLargos("Un documento de una sola pieza va por el camino normal"); },
      esperar,
      procesarUnico,
    }));
    cola.añadirArchivos([pdf("a.pdf")]);
    cola.enviar();
    await vuelta();
    expect(procesarUnico).toHaveBeenCalledTimes(1);
    expect(esperar).not.toHaveBeenCalled();
    expect(cola.getEstado().elementos[0].resultado?.success).toBe(true);
  });

  it("otro error al subir deja el documento como fallido (con el fichero para reintentar)", async () => {
    const procesarUnico = vi.fn();
    const cola = crearColaSubida(deps({
      iniciarUnico: async () => { throw new Error("No se pudo subir a.pdf: Payload too large"); },
      procesarUnico,
    }));
    cola.añadirArchivos([pdf("a.pdf")]);
    cola.enviar();
    await vuelta();
    expect(procesarUnico).not.toHaveBeenCalled();
    expect(cola.getEstado().elementos[0]).toMatchObject({
      fase: "terminado", resultado: { success: false, error: "No se pudo subir a.pdf: Payload too large" },
    });
    expect(cola.getEstado().elementos[0].file).toBeTruthy();
  });

  it("un duplicado de una página queda «por decidir» (sale de ocr_trabajos)", async () => {
    const cola = crearColaSubida(deps({
      iniciarUnico: async () => ({ trabajoId: "u2", numPiezas: 1 }),
      esperar: async () => unico("duplicado", {
        id: "u2",
        resultado: { success: true, duplicado: true, sustituible: { trabajo_id: "u2", existente: { id: 77 }, nuevo: {} } },
      }),
    }));
    cola.añadirArchivos([pdf("a.pdf")]);
    cola.enviar();
    await vuelta();
    expect(clasificarResultado(cola.getEstado().elementos[0].resultado)).toBe("pendiente");
  });

  it("lo que ya está en el servidor no ocupa hueco: la tanda se sube entera sin esperar a que se lea", async () => {
    const fines = [diferida<EstadoTrabajo>(), diferida<EstadoTrabajo>(), diferida<EstadoTrabajo>()];
    let n = 0;
    const alAcabarTanda = vi.fn();
    const cola = crearColaSubida(deps({
      maxSimultaneos: 1,
      iniciarUnico: async () => ({ trabajoId: `u${n}`, numPiezas: 1 }),
      esperar: () => fines[n++].promesa,
      alAcabarTanda,
    }));
    cola.añadirArchivos([pdf("a.pdf"), pdf("b.pdf"), pdf("c.pdf")]);
    cola.enviar();
    for (let i = 0; i < 6; i += 1) await vuelta();
    expect(cola.getEstado().elementos.map((e) => e.fase)).toEqual(["procesando", "procesando", "procesando"]);
    expect(hayEnNavegador(cola.getEstado())).toBe(false);
    fines.forEach((f) => f.resolver(unico("completado")));
    for (let i = 0; i < 3; i += 1) await vuelta();
    expect(cola.getEstado().elementos.every((e) => e.fase === "terminado")).toBe(true);
    expect(alAcabarTanda).toHaveBeenCalledTimes(1);
    expect(alAcabarTanda.mock.calls[0][0]).toMatchObject({ total: 3 });
  });

  it("al recargar adopta también los de una página, sin hablar de trozos", () => {
    const cola = crearColaSubida(deps({ esperar: () => new Promise(() => {}) }));
    cola.adoptar([unico("pagina1")]);
    expect(cola.getEstado().elementos[0]).toMatchObject({ fase: "procesando", progreso: "Leyendo el documento…" });
    expect(cola.getEstado().elementos[0].piezas).toBeUndefined();
  });
});

describe("marcarSustituida y limpiar", () => {
  it("la fila del duplicado pasa a «sustituida» y «Limpiar terminados» la quita", async () => {
    const cola = crearColaSubida(deps({
      procesarUnico: async (_f, nombre) => ok(nombre, { duplicado: true, sustituible: { trabajo_id: "t9" } as never }),
    }));
    cola.añadirArchivos([pdf("a.pdf")]);
    cola.enviar();
    await vuelta();
    cola.marcarSustituida("t9");
    expect(clasificarResultado(cola.getEstado().elementos[0].resultado)).toBe("sustituida");
    cola.limpiarTerminados();
    expect(cola.getEstado().elementos).toHaveLength(0);
  });
});

describe("textos", () => {
  it("indicador, resumen de la campana y cuándo avisar en ella", () => {
    expect(textoIndicador(2, 1)).toBe("2 procesando · 1 por decidir");
    expect(textoIndicador(0, 0)).toBe("");
    expect(textoResumenTanda({
      tanda: 1, total: 5,
      porClase: { guardada: 2, sustituida: 0, avisos: 1, sin_original: 0, pendiente: 1, duplicada: 0, fallida: 1 },
    })).toBe("2 guardadas · 1 con avisos · 1 por decidir (ya existían) · 1 fallida");
    expect(debeAvisarEnCampana("/facturas", "?tab=cargar", false)).toBe(false);
    expect(debeAvisarEnCampana("/facturas", "?tab=cargar", true)).toBe(true);
    expect(debeAvisarEnCampana("/reservas", "", false)).toBe(true);
  });
});
