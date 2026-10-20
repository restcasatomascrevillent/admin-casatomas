/**
 * Tests de la lógica pura del guardado del editor de plano
 * (`src/components/espacios/guardadoPlano.ts`).
 *
 * Lo que se fija aquí:
 *  - el ORDEN de las operaciones (desactivar SIEMPRE antes de insertar, porque
 *    el índice único parcial `uq_mesas_espacio_nombre_real` no deja repetir
 *    número entre mesas activas no fusionadas);
 *  - la decisión REVIVIR vs INSERTAR de las mesas que salen de un desagrupe;
 *  - que repetir el guardado converge en vez de duplicar filas;
 *  - la redacción exacta del mensaje de "esto se aplicó, esto no".
 */
import { describe, it, expect } from "vitest";
import {
  construirPlanGuardado,
  construirMensajeGuardado,
  construirMensajeLimpieza,
  clasificarFallo,
  interpretarCeroFilas,
  resolverIdFinalMesa,
  FALLO_PERMISOS,
  type DesagrupePlan,
  type MesaPlan,
  type OperacionGuardado,
  type OpDesactivar,
  type OpInsertar,
  type OpReactivar,
  type OpRepuntar,
  type ResultadoOperacion,
} from "../guardadoPlano";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ESPACIO = "e-salon";

const mesa = (id: string, nombre: string, extra: Partial<MesaPlan> = {}): MesaPlan => ({
  id,
  nombre,
  capacidad: 4,
  forma: "rectangular",
  ancho: 80,
  alto: 80,
  posX: 1,
  posY: 1,
  rotacion: 0,
  ...extra,
});

const original = (id: string, nombre: string) => ({
  id,
  nombre,
  capacidad: 4,
  forma: "rectangular" as const,
  ancho: 80,
  alto: 80,
});

const union = (id: string, nombre: string, originales: ReturnType<typeof original>[]): MesaPlan =>
  mesa(id, nombre, { capacidad: 8, ancho: 160, isMerged: true, originalMesas: originales });

const tipos = (ops: OperacionGuardado[]) => ops.map((o) => o.tipo);
const primerIndice = (ops: OperacionGuardado[], tipo: string) =>
  ops.findIndex((o) => o.tipo === tipo);
const ultimoIndice = (ops: OperacionGuardado[], tipo: string) => {
  let i = -1;
  ops.forEach((o, idx) => {
    if (o.tipo === tipo) i = idx;
  });
  return i;
};

// ─── Orden ───────────────────────────────────────────────────────────────────

describe("construirPlanGuardado — orden de las operaciones", () => {
  it("empieza por el plano y sigue con la geometría", () => {
    const ops = construirPlanGuardado({
      espacioId: ESPACIO,
      mesasCanvas: [mesa("m-1", "1"), mesa("m-2", "2")],
      pendingUnmerges: [],
    });
    expect(tipos(ops)).toEqual(["guardar-plano", "actualizar-geometria"]);
  });

  it("no emite actualizar-geometria si no hay ninguna mesa persistida que mover", () => {
    const ops = construirPlanGuardado({
      espacioId: ESPACIO,
      mesasCanvas: [mesa("mesa-temp-1", "9")],
      pendingUnmerges: [],
    });
    expect(tipos(ops)).toEqual(["guardar-plano", "insertar"]);
  });

  it("DESACTIVA antes de INSERTAR: el índice único no deja repetir número entre mesas activas", () => {
    // La unión "12+13" absorbió las filas m-12 y m-13, y a la vez se dibuja una
    // mesa nueva que reutiliza el número 12 recién liberado.
    const ops = construirPlanGuardado({
      espacioId: ESPACIO,
      mesasCanvas: [
        union("m-union", "12+13", [original("m-12", "12"), original("m-13", "13")]),
        mesa("mesa-temp-9", "12"),
      ],
      pendingUnmerges: [],
    });

    expect(ultimoIndice(ops, "desactivar")).toBeLessThan(primerIndice(ops, "insertar"));
  });

  it("orden completo: plano -> geometría -> desactivar -> reactivar -> insertar -> repuntar", () => {
    const desagrupe: DesagrupePlan = {
      mesaId: "m-union-vieja",
      nombreUnion: "5+6",
      nuevosMesaIds: ["mesa-temp-a", "mesa-temp-b"],
      originalesPorNuevoId: { "mesa-temp-a": "m-5", "mesa-temp-b": "m-6" },
    };

    const ops = construirPlanGuardado({
      espacioId: ESPACIO,
      mesasCanvas: [
        mesa("m-1", "1"),
        union("m-union", "12+13", [original("m-12", "12"), original("m-13", "13")]),
        mesa("mesa-temp-a", "5"),
        mesa("mesa-temp-b", "6"),
        mesa("mesa-grupo-nuevo", "1+2", { isMerged: true, originalMesas: [original("m-1", "1")] }),
      ],
      pendingUnmerges: [desagrupe],
    });

    const orden = ["guardar-plano", "actualizar-geometria", "desactivar", "reactivar", "insertar", "repuntar"];
    const indices = orden.map((t) => primerIndice(ops, t));
    expect(indices.every((i) => i >= 0)).toBe(true);
    expect([...indices].sort((a, b) => a - b)).toEqual(indices);

    // …y ningún tipo se intercala con otro posterior.
    for (let i = 0; i < orden.length - 1; i++) {
      expect(ultimoIndice(ops, orden[i])).toBeLessThan(primerIndice(ops, orden[i + 1]));
    }
  });

  it("repuntar va al final, después de las inserciones que crean su destino", () => {
    const ops = construirPlanGuardado({
      espacioId: ESPACIO,
      mesasCanvas: [
        mesa("mesa-temp-a", "5"),
        mesa("mesa-grupo-nuevo", "1+2", {
          isMerged: true,
          originalMesas: [original("m-1", "1"), original("m-2", "2")],
        }),
      ],
      pendingUnmerges: [],
    });
    expect(ultimoIndice(ops, "insertar")).toBeLessThan(primerIndice(ops, "repuntar"));
  });
});

// ─── Desactivación, no borrado ───────────────────────────────────────────────

describe("construirPlanGuardado — las originales absorbidas se desactivan", () => {
  it("emite una desactivación por cada original persistida de una unión", () => {
    const ops = construirPlanGuardado({
      espacioId: ESPACIO,
      mesasCanvas: [union("m-union", "12+13", [original("m-12", "12"), original("m-13", "13")])],
      pendingUnmerges: [],
    });

    const desactivaciones = ops.filter((o): o is OpDesactivar => o.tipo === "desactivar");
    expect(desactivaciones.map((d) => d.mesaId)).toEqual(["m-12", "m-13"]);
    expect(desactivaciones[0]).toMatchObject({
      nombre: "12",
      motivo: "absorbida-en-union",
      nombreRelacionado: "12+13",
    });
  });

  it("ignora las originales que nunca llegaron a BBDD (ids temporales)", () => {
    const ops = construirPlanGuardado({
      espacioId: ESPACIO,
      mesasCanvas: [
        union("m-union", "A+B", [original("mesa-temp-1", "A"), original("m-b", "B")]),
      ],
      pendingUnmerges: [],
    });
    const desactivaciones = ops.filter((o): o is OpDesactivar => o.tipo === "desactivar");
    expect(desactivaciones.map((d) => d.mesaId)).toEqual(["m-b"]);
  });

  it("la unión desagrupada también se desactiva (no se borra)", () => {
    const ops = construirPlanGuardado({
      espacioId: ESPACIO,
      mesasCanvas: [mesa("mesa-temp-a", "5")],
      pendingUnmerges: [
        { mesaId: "m-union-vieja", nombreUnion: "5+6", nuevosMesaIds: ["mesa-temp-a"] },
      ],
    });
    const desactivaciones = ops.filter((o): o is OpDesactivar => o.tipo === "desactivar");
    expect(desactivaciones).toHaveLength(1);
    expect(desactivaciones[0]).toMatchObject({
      mesaId: "m-union-vieja",
      nombre: "5+6",
      motivo: "union-desagrupada",
    });
  });

  it("una original absorbida no se actualiza también como geometría", () => {
    const ops = construirPlanGuardado({
      espacioId: ESPACIO,
      mesasCanvas: [
        union("m-union", "12+13", [original("m-12", "12"), original("m-13", "13")]),
        mesa("m-12", "12"), // el estado del Salón: la original sigue viva y visible
      ],
      pendingUnmerges: [],
    });
    const geometria = ops.find((o) => o.tipo === "actualizar-geometria");
    expect(geometria && "mesas" in geometria ? geometria.mesas.map((m) => m.id) : []).toEqual([
      "m-union",
    ]);
  });
});

// ─── Revivir vs insertar ─────────────────────────────────────────────────────

describe("construirPlanGuardado — desagrupar prefiere revivir la fila original", () => {
  const desagrupe: DesagrupePlan = {
    mesaId: "m-union-vieja",
    nombreUnion: "5+6",
    nuevosMesaIds: ["mesa-temp-a", "mesa-temp-b"],
    originalesPorNuevoId: { "mesa-temp-a": "m-5", "mesa-temp-b": "m-6" },
  };

  it("emite reactivar + un INSERT de plan B por cada hija con original conocida", () => {
    const ops = construirPlanGuardado({
      espacioId: ESPACIO,
      mesasCanvas: [mesa("mesa-temp-a", "5"), mesa("mesa-temp-b", "6")],
      pendingUnmerges: [desagrupe],
    });

    const reactivaciones = ops.filter((o): o is OpReactivar => o.tipo === "reactivar");
    expect(reactivaciones.map((r) => [r.mesaId, r.idCanvas])).toEqual([
      ["m-5", "mesa-temp-a"],
      ["m-6", "mesa-temp-b"],
    ]);

    const inserciones = ops.filter((o): o is OpInsertar => o.tipo === "insertar");
    expect(inserciones.map((i) => i.soloSiNoSeReactivo)).toEqual(["m-5", "m-6"]);
  });

  it("la reactivación devuelve la fila al estado de mesa normal (activa, sin fusión)", () => {
    const ops = construirPlanGuardado({
      espacioId: ESPACIO,
      mesasCanvas: [mesa("mesa-temp-a", "5")],
      pendingUnmerges: [desagrupe],
    });
    const reactivar = ops.find((o): o is OpReactivar => o.tipo === "reactivar")!;
    expect(reactivar.valores).toMatchObject({
      activa: true,
      nombre: "5",
      is_merged: false,
      original_mesas: null,
    });
  });

  it("INSERTA sin más cuando no se sabe de qué original salió (solo sobrevive el JSON)", () => {
    const ops = construirPlanGuardado({
      espacioId: ESPACIO,
      mesasCanvas: [mesa("mesa-temp-a", "5")],
      // Sin `originalesPorNuevoId`: el caso Terraza, donde las filas originales
      // se borraron de verdad y no hay id que revivir.
      pendingUnmerges: [{ mesaId: "m-union-vieja", nuevosMesaIds: ["mesa-temp-a"] }],
    });
    expect(ops.filter((o) => o.tipo === "reactivar")).toHaveLength(0);
    const inserciones = ops.filter((o): o is OpInsertar => o.tipo === "insertar");
    expect(inserciones).toHaveLength(1);
    expect(inserciones[0].soloSiNoSeReactivo).toBeUndefined();
  });

  it("NO revive si esa fila original sigue viva en el lienzo (se duplicaría la mesa)", () => {
    const ops = construirPlanGuardado({
      espacioId: ESPACIO,
      mesasCanvas: [
        mesa("m-5", "5"), // la original nunca se borró: se cargó como mesa propia
        mesa("mesa-temp-a", "5-bis"),
      ],
      pendingUnmerges: [
        {
          mesaId: "m-union-vieja",
          nuevosMesaIds: ["mesa-temp-a"],
          originalesPorNuevoId: { "mesa-temp-a": "m-5" },
        },
      ],
    });
    expect(ops.filter((o) => o.tipo === "reactivar")).toHaveLength(0);
    const inserciones = ops.filter((o): o is OpInsertar => o.tipo === "insertar");
    expect(inserciones.map((i) => i.nombre)).toEqual(["5-bis"]);
  });

  it("no intenta crear una hija que el usuario volvió a fusionar antes de guardar", () => {
    const ops = construirPlanGuardado({
      espacioId: ESPACIO,
      mesasCanvas: [
        // "mesa-temp-a" ya no está suelta: quedó dentro de este grupo nuevo.
        mesa("mesa-grupo-x", "5+9", {
          isMerged: true,
          originalMesas: [original("mesa-temp-a", "5"), original("m-9", "9")],
        }),
      ],
      pendingUnmerges: [desagrupe],
    });
    const inserciones = ops.filter((o): o is OpInsertar => o.tipo === "insertar");
    expect(inserciones.map((i) => i.idCanvas)).toEqual(["mesa-grupo-x"]);
    expect(ops.filter((o) => o.tipo === "reactivar")).toHaveLength(0);
  });
});

// ─── Idempotencia ────────────────────────────────────────────────────────────

describe("construirPlanGuardado — reintentar converge, no duplica", () => {
  const entrada = {
    espacioId: ESPACIO,
    mesasCanvas: [
      union("m-union", "12+13", [original("m-12", "12"), original("m-13", "13")]),
      mesa("mesa-temp-a", "5"),
    ],
    pendingUnmerges: [
      {
        mesaId: "m-union-vieja",
        nombreUnion: "5+6",
        nuevosMesaIds: ["mesa-temp-a"],
        originalesPorNuevoId: { "mesa-temp-a": "m-5" },
      },
    ],
  };

  it("el plan es determinista: el mismo estado produce el mismo plan", () => {
    expect(construirPlanGuardado(entrada)).toEqual(construirPlanGuardado(entrada));
  });

  it("todas las escrituras sobre filas existentes son UPDATE sobre un id concreto", () => {
    const ops = construirPlanGuardado(entrada);
    for (const op of ops) {
      if (op.tipo === "desactivar" || op.tipo === "reactivar") {
        expect(op.mesaId).toBeTruthy();
      }
    }
    // Repetirlas no cambia nada: `activa = false` sobre una fila ya inactiva
    // (o `activa = true` sobre una ya activa) es un no-op verificable.
    const desactivaciones = ops.filter((o): o is OpDesactivar => o.tipo === "desactivar");
    expect(desactivaciones.map((d) => d.mesaId).sort()).toEqual(["m-12", "m-13", "m-union-vieja"]);
  });

  it("el segundo intento revive la fila en vez de crear una segunda", () => {
    // Tras un fallo a medias la fila original puede haber quedado DESACTIVADA.
    // El plan sigue emitiendo reactivar primero y el INSERT solo como plan B,
    // así que no aparece una mesa "5" duplicada.
    const ops = construirPlanGuardado(entrada);
    const insertDeLaHija = ops.find(
      (o): o is OpInsertar => o.tipo === "insertar" && o.idCanvas === "mesa-temp-a",
    )!;
    expect(insertDeLaHija.soloSiNoSeReactivo).toBe("m-5");
  });
});

// ─── resolverIdFinalMesa ─────────────────────────────────────────────────────

describe("resolverIdFinalMesa", () => {
  it("traduce un id temporal por su id real recién insertado", () => {
    const real = resolverIdFinalMesa("mesa-temp-a", [], new Map([["mesa-temp-a", "m-nueva"]]));
    expect(real).toBe("m-nueva");
  });

  it("devuelve el id tal cual si la mesa sigue viva en el lienzo", () => {
    expect(resolverIdFinalMesa("m-5", [mesa("m-5", "5")], new Map())).toBe("m-5");
  });

  it("sigue la cadena hasta el grupo que absorbió la mesa", () => {
    const grupo = mesa("mesa-grupo-x", "5+9", {
      isMerged: true,
      originalMesas: [original("mesa-temp-a", "5")],
    });
    const real = resolverIdFinalMesa(
      "mesa-temp-a",
      [grupo],
      new Map([["mesa-grupo-x", "m-grupo-real"]]),
    );
    expect(real).toBe("m-grupo-real");
  });

  it("no se cuelga si hay un ciclo", () => {
    const a = mesa("mesa-grupo-a", "A", {
      isMerged: true,
      originalMesas: [original("mesa-grupo-b", "B")],
    });
    const b = mesa("mesa-grupo-b", "B", {
      isMerged: true,
      originalMesas: [original("mesa-grupo-a", "A")],
    });
    expect(resolverIdFinalMesa("mesa-grupo-z", [a, b], new Map())).toBe("mesa-grupo-z");
  });
});

// ─── clasificarFallo ─────────────────────────────────────────────────────────

describe("clasificarFallo", () => {
  it("reconoce el 42501 de RLS", () => {
    expect(clasificarFallo({ code: "42501", message: "denied" })).toEqual({ clase: "permisos" });
  });

  it("reconoce el mensaje de row-level security aunque no traiga código", () => {
    expect(
      clasificarFallo({ message: 'new row violates row-level security policy for table "mesas"' }),
    ).toEqual({ clase: "permisos" });
  });

  it("deja pasar cualquier otro error con su mensaje", () => {
    expect(clasificarFallo({ code: "23505", message: "duplicate key value" })).toEqual({
      clase: "error",
      mensaje: "duplicate key value",
    });
  });
});

// ─── Mensaje al usuario ──────────────────────────────────────────────────────

describe("construirMensajeGuardado", () => {
  const ok = (operacion: OperacionGuardado): ResultadoOperacion => ({ operacion, estado: "ok" });

  it("solo dice 'Plano guardado correctamente' si NADA falló", () => {
    const resultado = construirMensajeGuardado([
      ok({ tipo: "guardar-plano" }),
      ok({
        tipo: "desactivar",
        mesaId: "m-12",
        nombre: "12",
        motivo: "absorbida-en-union",
        nombreRelacionado: "12+13",
      }),
    ]);
    expect(resultado).toEqual({ exito: true, mensaje: "Plano guardado correctamente" });
  });

  it("enumera lo aplicado, lo que falló y en qué queda el espacio", () => {
    const geometria: OperacionGuardado = {
      tipo: "actualizar-geometria",
      mesas: ["1", "2", "3", "4"].map((n) => ({
        id: `m-${n}`,
        nombre: n,
        valores: {
          pos_x: 0,
          pos_y: 0,
          ancho: 80,
          alto: 80,
          rotacion: 0,
          is_merged: false,
          original_mesas: null,
          etiqueta: null,
        },
      })),
    };
    const desactivar: OpDesactivar = {
      tipo: "desactivar",
      mesaId: "m-7",
      nombre: "7",
      motivo: "absorbida-en-union",
      nombreRelacionado: "7+8",
    };

    const { exito, mensaje } = construirMensajeGuardado([
      ok({ tipo: "guardar-plano" }),
      ok(geometria),
      { operacion: desactivar, estado: "fallo", fallo: FALLO_PERMISOS },
    ]);

    expect(exito).toBe(false);
    expect(mensaje).toBe(
      "Se guardó el plano y se movieron 4 mesas, pero no se pudo desactivar la mesa 7 (permisos). " +
        "Las mesas 7 y 7+8 conviven ahora (el aforo cuenta sus plazas dos veces): " +
        "recarga la página antes de volver a guardar.",
    );
  });

  it("avisa de los pasos que ni siquiera se llegaron a ejecutar", () => {
    const desactivar: OpDesactivar = {
      tipo: "desactivar",
      mesaId: "m-7",
      nombre: "7",
      motivo: "union-desagrupada",
    };
    const insertar: OpInsertar = {
      tipo: "insertar",
      idCanvas: "mesa-temp-a",
      nombre: "9",
      valores: {
        espacio_id: ESPACIO,
        nombre: "9",
        capacidad: 4,
        forma: "rectangular",
        activa: true,
        pos_x: 0,
        pos_y: 0,
        ancho: 80,
        alto: 80,
        rotacion: 0,
        is_merged: false,
        original_mesas: null,
        etiqueta: null,
      },
    };

    const { mensaje } = construirMensajeGuardado([
      ok({ tipo: "guardar-plano" }),
      { operacion: desactivar, estado: "fallo", fallo: { clase: "error", mensaje: "timeout" } },
      { operacion: insertar, estado: "pendiente" },
    ]);

    expect(mensaje).toContain("no se pudo desactivar la mesa 7 (timeout)");
    expect(mensaje).toContain("queda 1 paso sin aplicar");
    expect(mensaje).toContain("La unión 7 sigue activa junto a las mesas que acabas de separar");
    expect(mensaje).toContain("recarga la página antes de volver a guardar");
  });

  it("no inventa logros cuando no se aplicó nada", () => {
    const { mensaje } = construirMensajeGuardado([
      { operacion: { tipo: "guardar-plano" }, estado: "fallo", fallo: FALLO_PERMISOS },
    ]);
    expect(mensaje).toBe(
      "No se pudo guardar el plano (permisos). El plano se ha quedado como estaba: " +
        "recarga la página antes de volver a guardar.",
    );
  });

  it("una reactivación 'omitida' no cuenta como mesa recuperada", () => {
    const reactivar: OpReactivar = {
      tipo: "reactivar",
      mesaId: "m-5",
      idCanvas: "mesa-temp-a",
      nombre: "5",
      valores: {
        activa: true,
        nombre: "5",
        capacidad: 4,
        forma: "rectangular",
        pos_x: 0,
        pos_y: 0,
        ancho: 80,
        alto: 80,
        rotacion: 0,
        is_merged: false,
        original_mesas: null,
        etiqueta: null,
      },
    };
    const repuntar: OpRepuntar = {
      tipo: "repuntar",
      origenId: "m-union-vieja",
      nombreOrigen: "5+6",
      destinoIdCanvas: "mesa-temp-a",
    };

    const { mensaje } = construirMensajeGuardado([
      ok({ tipo: "guardar-plano" }),
      { operacion: reactivar, estado: "omitida" },
      { operacion: repuntar, estado: "fallo", fallo: FALLO_PERMISOS },
    ]);

    expect(mensaje).not.toContain("se recuperó");
    expect(mensaje).toContain("no se pudieron mover las reservas de la mesa 5+6 (permisos)");
  });
});
// ─── Mensaje de "Limpiar" ────────────────────────────────────────────────────

describe("construirMensajeLimpieza", () => {
  it("solo celebra si cayeron todas las que había", () => {
    expect(construirMensajeLimpieza({ mesasEsperadas: 4, mesasEliminadas: 4 })).toEqual({
      exito: true,
      mensaje: "Plano y mesas eliminados correctamente",
    });
  });

  it("un espacio sin mesas se limpia sin más", () => {
    expect(construirMensajeLimpieza({ mesasEsperadas: 0, mesasEliminadas: 0 }).exito).toBe(true);
  });

  it("con error dice cuántas mesas siguen ahí", () => {
    expect(construirMensajeLimpieza({ mesasEsperadas: 4, fallo: FALLO_PERMISOS })).toEqual({
      exito: false,
      mensaje:
        "No se ha podido limpiar el plano (permisos). Las 4 mesas del espacio siguen ahí: " +
        "recarga la página antes de volver a intentarlo.",
    });
  });

  it("cero filas sin error NO es un éxito: es RLS denegando en silencio", () => {
    const { exito, mensaje } = construirMensajeLimpieza({ mesasEsperadas: 4, mesasEliminadas: 0 });
    expect(exito).toBe(false);
    expect(mensaje).toBe(
      "No se ha eliminado ninguna de las 4 mesas del espacio (permisos). " +
        "El plano sigue como estaba: recarga la página antes de volver a intentarlo.",
    );
  });

  it("un borrado parcial dice cuántas cayeron y cuántas quedan", () => {
    const { exito, mensaje } = construirMensajeLimpieza({ mesasEsperadas: 4, mesasEliminadas: 3 });
    expect(exito).toBe(false);
    expect(mensaje).toBe(
      "Se eliminaron 3 de 4 mesas, pero 1 mesa sigue en el espacio (permisos). " +
        "El plano ha quedado a medio limpiar: recarga la página antes de volver a intentarlo.",
    );
  });
});

// ─── "Cero filas" no es "sin permisos" ───────────────────────────────────────

describe("interpretarCeroFilas", () => {
  describe("desactivar", () => {
    it("la fila ya no existe -> la desactivación ya está cumplida (caso Terraza)", () => {
      expect(interpretarCeroFilas("desactivar", { existe: false })).toBe("fila-ausente");
    });

    it("la fila existe y ya estaba inactiva -> nada que hacer", () => {
      expect(interpretarCeroFilas("desactivar", { existe: true, activa: false })).toBe("ya-cumplida");
    });

    it("la fila existe, está activa y aun así no se deja tocar -> eso sí es RLS", () => {
      expect(interpretarCeroFilas("desactivar", { existe: true, activa: true })).toBe("denegada");
    });
  });

  describe("reactivar", () => {
    it("la fila no está -> toca INSERTAR (el plan B del plan)", () => {
      expect(interpretarCeroFilas("reactivar", { existe: false })).toBe("fila-ausente");
    });

    it("la fila está: reactivar escribe nombre y geometría, así que 0 filas es un rechazo", () => {
      expect(interpretarCeroFilas("reactivar", { existe: true, activa: false })).toBe("denegada");
      expect(interpretarCeroFilas("reactivar", { existe: true, activa: true })).toBe("denegada");
    });
  });

  it("si no se puede confirmar, se lee de la forma pesimista", () => {
    expect(interpretarCeroFilas("desactivar", null)).toBe("sin-confirmar");
    expect(interpretarCeroFilas("reactivar", null)).toBe("sin-confirmar");
  });
});

describe("construirMensajeGuardado — una mesa que ya no existe no se culpa a los permisos", () => {
  it("dice 'ya no existe' y que el lienzo está desfasado", () => {
    const geometria: OperacionGuardado = {
      tipo: "actualizar-geometria",
      mesas: [
        {
          id: "m-7",
          nombre: "7",
          valores: {
            pos_x: 0,
            pos_y: 0,
            ancho: 80,
            alto: 80,
            rotacion: 0,
            is_merged: false,
            original_mesas: null,
            etiqueta: null,
          },
        },
      ],
    };
    const { exito, mensaje } = construirMensajeGuardado([
      { operacion: { tipo: "guardar-plano" }, estado: "ok" },
      {
        operacion: geometria,
        estado: "fallo",
        fallo: { clase: "desaparecida" },
        mesasFallidas: ["7"],
      },
    ]);
    expect(exito).toBe(false);
    expect(mensaje).toContain("no se pudo mover la mesa 7 (ya no existe)");
    expect(mensaje).toContain("Otra sesión las ha borrado");
    expect(mensaje).not.toContain("permisos");
  });
});
