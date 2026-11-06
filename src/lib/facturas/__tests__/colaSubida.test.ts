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
  puedeReintentar,
  puedeVolverASubir,
  type ResultadoProcesamiento,
  textoIndicador,
  textoResumenTanda,
  clasificarResultado,
} from "../colaSubida";
import { SigueEnServidor, SinDocumentosLargos, type EstadoTrabajo, type PlanDocumento } from "../documentoLargo";

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

describe("unir fotos como UN documento (páginas)", () => {
  const preparar = () => {
    const cola = crearColaSubida(deps());
    cola.añadirArchivos([jpg("p1.jpg"), jpg("p2.jpg"), pdf("suelto.pdf"), jpg("p3.jpg")]);
    const ids = cola.getEstado().elementos.map((e) => e.id);
    return { cola, ids };
  };

  it("une, reordena y separa sin perder fotos; no une PDF", () => {
    const { cola, ids } = preparar();
    expect(cola.unir([ids[0], ids[2]])).toEqual({ error: expect.stringMatching(/no PDF/) });
    const r = cola.unir([ids[0], ids[1], ids[3]]);
    expect("id" in r).toBe(true);
    let els = cola.getEstado().elementos;
    expect(els).toHaveLength(2);
    const grupo = els.find((e) => e.fotos)!;
    expect(grupo.nombre).toBe("p1 (3 páginas)");
    expect(grupo.fotos!.map((f) => f.name)).toEqual(["p1.jpg", "p2.jpg", "p3.jpg"]);
    cola.moverPagina(grupo.id, 2, 0);
    expect(cola.getEstado().elementos.find((e) => e.fotos)!.fotos!.map((f) => f.name)).toEqual(["p3.jpg", "p1.jpg", "p2.jpg"]);
    cola.separar(grupo.id);
    els = cola.getEstado().elementos;
    expect(els.map((e) => e.nombre)).toEqual(["p3.jpg", "p1.jpg", "p2.jpg", "suelto.pdf"]);
    expect(els.every((e) => !e.fotos)).toBe(true);
  });

  it("se envía por el camino de documento largo con una página por foto, en el orden elegido", async () => {
    const planificarGrupo = vi.fn(async (fotos: File[]) => ({
      camino: "largo" as const, origen: "imagen" as const, paginasDocumento: fotos.length, original: null,
      piezas: fotos.map((f, i) => ({ blob: f, mime: "image/jpeg" as const, pieza: "pagina" as const, pagina_doc: i + 1, franja: null, franjas_pagina: null })),
    }));
    const iniciarLargo = vi.fn(async () => ({ trabajoId: "tg", numPiezas: 2 }));
    const procesarUnico = vi.fn(async (_f: File, n: string) => ok(n));
    const cola = crearColaSubida(deps({ planificarGrupo, iniciarLargo, procesarUnico, esperar: async () => trabajo("completado", { id: "tg", num_paginas: 2 }) }));
    cola.añadirArchivos([jpg("a.jpg"), jpg("b.jpg")]);
    const [x, y] = cola.getEstado().elementos.map((e) => e.id);
    cola.unir([y, x]);
    cola.enviar();
    for (let i = 0; i < 6; i++) await vuelta();
    expect(planificarGrupo.mock.calls[0][0].map((f: File) => f.name)).toEqual(["b.jpg", "a.jpg"]);
    expect(iniciarLargo).toHaveBeenCalledTimes(1);
    expect(procesarUnico).not.toHaveBeenCalled();
    const e = cola.getEstado().elementos[0];
    expect(e.fase).toBe("terminado");
    expect(e.resultado?.success).toBe(true);
  });

  it("servidor antiguo: error claro, sin caer al camino de una página", async () => {
    const cola = crearColaSubida(deps({
      planificarGrupo: async (fotos) => ({ camino: "largo", origen: "imagen", paginasDocumento: fotos.length, piezas: [], original: null }),
      iniciarLargo: async () => { throw new SinDocumentosLargos("403"); },
    }));
    cola.añadirArchivos([jpg("a.jpg"), jpg("b.jpg")]);
    cola.unir(cola.getEstado().elementos.map((e) => e.id));
    cola.enviar();
    for (let i = 0; i < 6; i++) await vuelta();
    expect(cola.getEstado().elementos[0].resultado?.error).toMatch(/aún no admite documentos de varias fotos/);
  });
});

describe("otra página de una factura existente", () => {
  it("cuenta como «por decidir» y, al añadirla, como guardada", () => {
    const anadible = {
      trabajo_id: "t9", pagina: { actual: 2, total: 2 },
      existente: { id: 352, numero_documento: "P26/24306", proveedor: null, fecha: null, total: null, total_origen: null, lineas: 2, alertas: 0, alertas_graves: 0 },
      nuevo: { total: null, total_origen: null, lineas: 1, alertas: 0, proveedor: null, fecha: "2026-10-09" },
    };
    expect(clasificarResultado(ok("x", { duplicado: true, anadible }))).toBe("pendiente");
    expect(clasificarResultado(ok("x", { duplicado: true }))).toBe("duplicada");
    expect(clasificarResultado(ok("x", { paginaAnadida: true }))).toBe("sustituida");
  });
});

// ── 05/11/2026: QA de «Cargar» ───────────────────────────────────────────────

describe("UI-10: ficheros de 0 bytes", () => {
  it("se rechazan al añadirlos, con su causa para el aviso", () => {
    const cola = crearColaSubida(deps());
    const r = cola.añadirArchivos([new File([], "vacio.png", { type: "image/png" }), jpg("bien.jpg")]);
    expect(r.añadidos).toBe(1);
    expect(r.rechazados).toEqual([{ nombre: "vacio.png", motivo: expect.stringMatching(/vacío \(0 bytes\)/), causa: "vacio" }]);
    expect(cola.getEstado().elementos.map((e) => e.nombre)).toEqual(["bien.jpg"]);
  });
});

describe("UI-1: un trabajo que tarda NO es un fallo y su reintento sigue EL MISMO trabajo", () => {
  const sinFin = () => new Promise<EstadoTrabajo>(() => {});

  it("pasado el tiempo normal: «Sigue en el servidor» (en marcha, no fallido)", async () => {
    let aviso: ((t: EstadoTrabajo | null, info?: { lento: boolean }) => void) | undefined;
    const cola = crearColaSubida(deps({
      iniciarUnico: async () => ({ trabajoId: "t1", numPiezas: 1 }),
      esperar: (_id, onCambio) => { aviso = onCambio; return sinFin(); },
    }));
    cola.añadirArchivos([pdf("lento.pdf")]);
    cola.enviar();
    await vuelta();
    aviso!(trabajo("pagina1", { num_paginas: 1 }), { lento: true });
    const e = cola.getEstado().elementos[0];
    expect(e).toMatchObject({ fase: "procesando", lento: true });
    expect(e.progreso).toMatch(/^Sigue en el servidor/);
    expect(cuentaActivos(cola.getEstado())).toBe(1);
  });

  it("si se deja de mirar (SigueEnServidor), queda «sigue en el servidor» y «Reintentar» llama a ocr_reintentar_trabajo con EL MISMO trabajo, sin subir ni crear otro", async () => {
    const iniciarUnico = vi.fn(async () => ({ trabajoId: "t1", numPiezas: 1 }));
    const reintentarTrabajo = vi.fn(async () => ({ disponible: true, ok: true, estado: "pagina1" }));
    let vez = 0;
    const esperar = vi.fn(async () => {
      vez += 1;
      if (vez === 1) throw new SigueEnServidor(trabajo("pagina1"));
      return trabajo("completado", { num_paginas: 1 });
    });
    const cola = crearColaSubida(deps({ iniciarUnico, esperar, reintentarTrabajo }));
    cola.añadirArchivos([pdf("colgado.pdf")]);
    cola.enviar();
    await vuelta();
    let e = cola.getEstado().elementos[0];
    expect(e.resultado).toMatchObject({ success: false, sigueEnServidor: true });
    expect(clasificarResultado(e.resultado)).toBe("en_servidor");
    expect(puedeReintentar(e)).toBe(true);

    expect(cola.reintentar(e.id)).toBe(1);
    await vuelta();
    await vuelta();
    expect(reintentarTrabajo).toHaveBeenCalledWith("t1");
    expect(iniciarUnico).toHaveBeenCalledTimes(1); // nunca otro trabajo
    expect(esperar).toHaveBeenLastCalledWith("t1", expect.any(Function));
    e = cola.getEstado().elementos[0];
    expect(e).toMatchObject({ fase: "terminado", trabajoId: "t1", resultado: { success: true } });
  });

  it("un trabajo FALLIDO con fichero: reanuda en el servidor (estado «reanudado»), no lo vuelve a subir", async () => {
    const iniciarUnico = vi.fn(async () => ({ trabajoId: "t1", numPiezas: 1 }));
    const reintentarTrabajo = vi.fn(async () => ({ disponible: true, ok: true, estado: "reanudado" }));
    let vez = 0;
    const esperar = vi.fn(async () => (++vez === 1 ? trabajo("fallido", { error: "OpenAI no responde" }) : trabajo("completado")));
    const cola = crearColaSubida(deps({ iniciarUnico, esperar, reintentarTrabajo }));
    cola.añadirArchivos([pdf("f.pdf")]);
    cola.enviar();
    await vuelta();
    cola.reintentar();
    await vuelta();
    await vuelta();
    expect(iniciarUnico).toHaveBeenCalledTimes(1);
    expect(cola.getEstado().elementos[0].resultado?.success).toBe(true);
  });

  it("si el servidor ya no tiene los ficheros: lo explica y ofrece volver a subir (eso sí es un trabajo nuevo)", async () => {
    const iniciarUnico = vi.fn(async () => ({ trabajoId: `t${iniciarUnico.mock.calls.length}`, numPiezas: 1 }));
    const reintentarTrabajo = vi.fn(async () => ({ disponible: true, ok: false, motivo: "Los ficheros ya no están: vuelve a subir el documento" }));
    let vez = 0;
    const esperar = vi.fn(async () => (++vez === 1 ? trabajo("fallido") : trabajo("completado")));
    const cola = crearColaSubida(deps({ iniciarUnico, esperar, reintentarTrabajo }));
    cola.añadirArchivos([pdf("f.pdf")]);
    cola.enviar();
    await vuelta();
    const id = cola.getEstado().elementos[0].id;
    cola.reintentar(id);
    await vuelta();
    let e = cola.getEstado().elementos[0];
    expect(e.resultado).toMatchObject({ success: false, ficherosAusentes: true, error: "Los ficheros ya no están: vuelve a subir el documento" });
    expect(puedeReintentar(e)).toBe(false);
    expect(puedeVolverASubir(e)).toBe(true);
    expect(cola.volverASubir(id)).toBe(1);
    await vuelta();
    e = cola.getEstado().elementos[0];
    expect(iniciarUnico).toHaveBeenCalledTimes(2);
    expect(e.resultado?.success).toBe(true);
  });

  it("servidor sin la RPC: un FALLIDO con fichero se vuelve a subir como antes; uno que seguía en marcha solo se vuelve a mirar", async () => {
    const iniciarUnico = vi.fn(async () => ({ trabajoId: "t1", numPiezas: 1 }));
    const reintentarTrabajo = vi.fn(async () => ({ disponible: false, ok: false }));
    const esperar = vi.fn(async () => trabajo("fallido"));
    const cola = crearColaSubida(deps({ iniciarUnico, esperar, reintentarTrabajo }));
    cola.añadirArchivos([pdf("f.pdf")]);
    cola.enviar();
    await vuelta();
    cola.reintentar();
    await vuelta();
    await vuelta();
    expect(iniciarUnico).toHaveBeenCalledTimes(2);

    // Adoptado (sin fichero) que «sigue en el servidor»: solo se vuelve a mirar el mismo.
    const esperar2 = vi.fn(async (): Promise<EstadoTrabajo> => { throw new SigueEnServidor(null); });
    const cola2 = crearColaSubida(deps({ esperar: esperar2, reintentarTrabajo }));
    cola2.adoptar([trabajo("paginas", { id: "t7" })]);
    await vuelta();
    const e = cola2.getEstado().elementos[0];
    expect(e.resultado?.sigueEnServidor).toBe(true);
    cola2.reintentar(e.id);
    await vuelta();
    expect(esperar2).toHaveBeenCalledTimes(2);
    expect(esperar2).toHaveBeenLastCalledWith("t7", expect.any(Function));
  });
});

describe("UI-9: adoptar trabajos parados", () => {
  it("uno que pasó su límite se enseña como «Parado en el servidor» y NO cuenta como procesando ni avisa", () => {
    const ahora = Date.parse("2026-11-05T12:00:00Z");
    const alTerminar = vi.fn();
    const esperar = vi.fn(() => new Promise<EstadoTrabajo>(() => {}));
    const cola = crearColaSubida(deps({ esperar, alTerminar, ahora: () => ahora }));
    const n = cola.adoptar([
      trabajo("paginas", { id: "vivo", updated_at: "2026-11-05T11:59:00Z", limite_at: "2026-11-05T12:10:00Z" }),
      trabajo("pagina1", { id: "ayer", nombre_original: "colgado-de-ayer.jpg", num_paginas: 1, updated_at: "2026-11-04T16:00:00Z" }),
    ]);
    expect(n).toBe(2);
    const [vivo, parado] = cola.getEstado().elementos;
    expect(vivo).toMatchObject({ fase: "procesando", trabajoId: "vivo" });
    expect(parado).toMatchObject({ fase: "terminado", trabajoId: "ayer", tanda: 0, resultado: { success: false, parado: true } });
    expect(parado.resultado?.error).toMatch(/^Parado en el servidor/);
    expect(cuentaActivos(cola.getEstado())).toBe(1);
    expect(esperar).toHaveBeenCalledTimes(1); // al parado no se le sondea
    expect(alTerminar).not.toHaveBeenCalled();
    expect(progresoTanda(cola.getEstado())).toEqual({ hechos: 0, total: 1 });
  });
});

describe("UI-11: cancelar un documento enviado", () => {
  it("en cola: se quita sin subir nada; lo que va por el camino síncrono no se cancela", async () => {
    const d = diferida<ResultadoProcesamiento>();
    const cola = crearColaSubida(deps({
      maxSimultaneos: 1,
      procesarUnico: () => d.promesa,
      iniciarUnico: async () => { throw new SinDocumentosLargos("antiguo"); },
    }));
    cola.añadirArchivos([pdf("a.pdf"), pdf("b.pdf")]);
    cola.enviar();
    await vuelta();
    const b = cola.getEstado().elementos[1];
    expect(b.fase).toBe("en_cola");
    expect(await cola.cancelar(b.id)).toEqual({ ok: true });
    expect(cola.getEstado().elementos.map((e) => e.nombre)).toEqual(["a.pdf"]);
    const a = cola.getEstado().elementos[0];
    expect(a.fase).toBe("enviando");
    expect(await cola.cancelar(a.id)).toEqual({ ok: false, motivo: expect.stringMatching(/no se puede cancelar/) });
    d.resolver(ok("a.pdf"));
    await vuelta();
  });

  it("subiendo: se corta ANTES de crear el trabajo (no se lee ni se paga) y no avisa", async () => {
    const subida = diferida<void>();
    const crear = vi.fn();
    const alTerminar = vi.fn();
    const cola = crearColaSubida(deps({
      alTerminar,
      iniciarUnico: async (_f, onProgreso) => {
        await subida.promesa; // la subida a Storage tarda
        onProgreso(1, 1); // lanza si se canceló
        crear();
        return { trabajoId: "t1", numPiezas: 1 };
      },
    }));
    cola.añadirArchivos([pdf("lento.pdf")]);
    cola.enviar();
    await vuelta();
    const e = cola.getEstado().elementos[0];
    expect(e.fase).toBe("subiendo");
    expect(hayEnNavegador(cola.getEstado())).toBe(true);
    expect(await cola.cancelar(e.id)).toEqual({ ok: true });
    expect(cola.getEstado().elementos).toHaveLength(0);
    expect(hayEnNavegador(cola.getEstado())).toBe(false);
    subida.resolver();
    await vuelta();
    expect(crear).not.toHaveBeenCalled();
    expect(alTerminar).not.toHaveBeenCalled();
    expect(cola.getEstado().elementos).toHaveLength(0);
  });

  it("leyéndose en el servidor: llama a ocr_descartar_trabajo; si el servidor no deja (consolidando), lo dice y sigue", async () => {
    const descartarTrabajo = vi.fn()
      .mockResolvedValueOnce({ disponible: true, ok: false, motivo: "Ya se está guardando: no se puede cancelar" })
      .mockResolvedValueOnce({ disponible: true, ok: true, estado: "cancelado" });
    const fin = diferida<EstadoTrabajo>();
    const alTerminar = vi.fn();
    const cola = crearColaSubida(deps({
      alTerminar, descartarTrabajo,
      iniciarUnico: async () => ({ trabajoId: "t1", numPiezas: 1 }),
      esperar: () => fin.promesa,
    }));
    cola.añadirArchivos([pdf("a.pdf")]);
    cola.enviar();
    await vuelta();
    const e = cola.getEstado().elementos[0];
    expect(e.fase).toBe("procesando");
    expect(await cola.cancelar(e.id)).toEqual({ ok: false, motivo: "Ya se está guardando: no se puede cancelar" });
    expect(cola.getEstado().elementos).toHaveLength(1);
    expect(await cola.cancelar(e.id)).toEqual({ ok: true });
    expect(descartarTrabajo).toHaveBeenLastCalledWith("t1");
    expect(cola.getEstado().elementos).toHaveLength(0);
    fin.resolver(trabajo("cancelado"));
    await vuelta();
    expect(alTerminar).not.toHaveBeenCalled();
  });

  it("leyéndose y sin la RPC: no se cancela (se explica)", async () => {
    const cola = crearColaSubida(deps({
      descartarTrabajo: async () => ({ disponible: false, ok: false }),
      iniciarUnico: async () => ({ trabajoId: "t1", numPiezas: 1 }),
      esperar: () => new Promise(() => {}),
    }));
    cola.añadirArchivos([pdf("a.pdf")]);
    cola.enviar();
    await vuelta();
    const r = await cola.cancelar(cola.getEstado().elementos[0].id);
    expect(r).toEqual({ ok: false, motivo: expect.stringMatching(/no se puede cancelar/) });
    expect(cola.getEstado().elementos).toHaveLength(1);
  });

  it("parado en el servidor: «quitar» lo descarta en el servidor", async () => {
    const descartarTrabajo = vi.fn(async () => ({ disponible: true, ok: true }));
    const cola = crearColaSubida(deps({ descartarTrabajo, ahora: () => Date.parse("2026-11-05T12:00:00Z") }));
    cola.adoptar([trabajo("pagina1", { id: "ayer", updated_at: "2026-11-04T10:00:00Z" })]);
    expect(await cola.cancelar(cola.getEstado().elementos[0].id)).toEqual({ ok: true });
    expect(descartarTrabajo).toHaveBeenCalledWith("ayer");
    expect(cola.getEstado().elementos).toHaveLength(0);
  });
});

describe("UI-4: «Dejar la que hay» marca la fila del duplicado", () => {
  it("deja de ofrecer sustituir/añadir y cuenta como «ya existía»", async () => {
    const sustituible = { trabajo_id: "t1", existente: { id: 54 }, nuevo: {} } as never;
    const cola = crearColaSubida(deps({ procesarUnico: async (_f, n) => ok(n, { duplicado: true, sustituible }) }));
    cola.añadirArchivos([pdf("d.pdf")]);
    cola.enviar();
    await vuelta();
    expect(clasificarResultado(cola.getEstado().elementos[0].resultado)).toBe("pendiente");
    cola.marcarDescartado("t1");
    const r = cola.getEstado().elementos[0].resultado;
    expect(r).toMatchObject({ descartado: true, sustituible: null });
    expect(clasificarResultado(r)).toBe("duplicada");
  });
});
