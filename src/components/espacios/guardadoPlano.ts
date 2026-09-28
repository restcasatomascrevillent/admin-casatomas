/**
 * PLAN DE GUARDADO DEL EDITOR DE PLANO — lógica pura, sin supabase ni React.
 *
 * `EditorPlanoEspacio.handleSave` se reduce a tres pasos:
 *   1. `construirPlanGuardado(...)` -> lista ORDENADA de operaciones tipadas.
 *   2. ejecutar cada operación comprobando CUÁNTAS FILAS volvieron.
 *   3. `construirMensajeGuardado(...)` -> el texto exacto que ve el usuario.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ "REINTENTABLE" Y NO UNA TRANSACCIÓN (RPC)
 * ---------------------------------------------------------------------------
 * Lo correcto de verdad sería una función de Postgres (RPC) que envolviera
 * TODO el guardado en una única transacción: o se aplica entero o no se aplica
 * nada, con rollback real de un guardado a medias. Eso exige una migración y
 * el visto bueno del dueño de la base, que hoy NO tenemos.
 *
 * Mientras tanto, la propiedad que sí podemos garantizar desde el cliente es
 * que el guardado sea REINTENTABLE (idempotente): si falla a mitad, volver a
 * pulsar "Guardar" con el mismo estado converge al resultado correcto en vez
 * de duplicar filas. Para eso:
 *   - nada se BORRA: se desactiva (`activa = false`), que es reversible y que
 *     —según las funciones de aforo y `useMesas`— es indistinguible de una
 *     fila borrada para todos los consumidores actuales;
 *   - `desactivar` y `reactivar` son UPDATE sobre un id concreto: repetirlos no
 *     cambia el resultado;
 *   - una mesa que salió de una unión se INTENTA REACTIVAR antes de insertarla,
 *     así que un segundo intento no crea una fila nueva junto a la que el
 *     primer intento ya dejó viva;
 *   - el orden (ver abajo) impide que un INSERT choque con un nombre que aún
 *     no se ha liberado.
 * Lo que la RPC añadiría y esto NO da: deshacer los pasos que SÍ se aplicaron
 * cuando uno posterior falla. Por eso el mensaje de error tiene que decir qué
 * quedó a medias y pedir recargar (ver `construirMensajeGuardado`).
 *
 * ---------------------------------------------------------------------------
 * ORDEN OBLIGATORIO — lo impone el índice `uq_mesas_espacio_nombre_real`
 * ---------------------------------------------------------------------------
 * Ese índice es UNIQUE PARCIAL sobre
 *   (espacio_id, lower(btrim(regexp_replace(nombre,'\s+',' ','g'))))
 *   WHERE coalesce(is_merged,false) = false AND coalesce(activa,true) = true
 * o sea: las filas fusionadas y las INACTIVAS quedan FUERA del índice, y por
 * tanto desactivar una mesa LIBERA su número. De ahí el orden:
 *
 *   (a) guardar-plano
 *   (b) actualizar-geometria   (mesas que sobreviven tal cual)
 *   (c) desactivar             <- PRIMERO: libera los números
 *   (d) reactivar              (originales que vuelven de una unión)
 *   (e) insertar               (mesas nuevas y originales que ya no existen)
 *   (f) repuntar               (asignaciones_mesa)
 *
 * NUNCA insertar un nombre antes de haber desactivado la fila que lo ocupa: si
 * se invierte (c) y (e), Postgres responde 23505 (unique_violation) con el
 * nombre de ese índice.
 *
 * (f) va al final —y no antes de retirar las filas, como hacía el código
 * original— porque ya NO se borra nada: `asignaciones_mesa.mesa_id` es
 * ON DELETE CASCADE, así que un DELETE se llevaba por delante el historial de
 * reservas y había que repuntar antes; una DESACTIVACIÓN no dispara la cascada,
 * las asignaciones sobreviven y se pueden repuntar después. Y tienen que ir
 * después, porque el destino de un desagrupe puede ser una fila que solo existe
 * tras (d)/(e).
 */

import { esMesaGrupoNueva, esMesaNoPersistida, esMesaTemporal } from "./planoUtils";

// ─── Entrada ─────────────────────────────────────────────────────────────────

/** Forma mínima de una mesa original guardada en el JSON `mesas.original_mesas`. */
export interface MesaOriginalPlan {
  id: string;
  nombre: string;
  capacidad: number;
  forma: "rectangular" | "circular";
  ancho: number;
  alto: number;
}

/**
 * Forma mínima de una mesa del lienzo. Es un subconjunto estructural de
 * `MesaCanvas` (EditorPlanoEspacio) a propósito: este módulo no debe depender
 * de un .tsx para poder probarse sin React.
 */
export interface MesaPlan {
  id: string;
  nombre: string;
  capacidad: number;
  forma: "rectangular" | "circular";
  /** Centímetros. */
  ancho: number;
  /** Centímetros. */
  alto: number;
  /** Metros. */
  posX: number;
  /** Metros. */
  posY: number;
  rotacion?: number;
  isMerged?: boolean;
  originalMesas?: MesaOriginalPlan[];
  etiqueta?: string | null;
}

/** Desagrupe pendiente de aplicar en BBDD al pulsar "Guardar". */
export interface DesagrupePlan {
  /** Fila (persistida) de la mesa fusionada que el usuario desagrupó. */
  mesaId: string;
  /** Nombre de esa unión, para poder explicarla en los mensajes. */
  nombreUnion?: string;
  /** Ids (temporales) que las mesas resultantes tienen en el lienzo. */
  nuevosMesaIds: string[];
  /**
   * id temporal de cada hija -> id de la fila ORIGINAL de la que salió.
   * Lo rellena `EditorPlanoEspacio` en el momento del desagrupe, emparejando
   * por posición las mesas que devuelve `CanvasPlano.unmergeMesa` con el
   * `originalMesas` de la unión. Sin este mapa la hija es indistinguible de
   * una mesa nueva y solo se puede insertar.
   */
  originalesPorNuevoId?: Record<string, string>;
}

export interface EntradaPlanGuardado {
  espacioId: string;
  mesasCanvas: MesaPlan[];
  pendingUnmerges: DesagrupePlan[];
}

// ─── Operaciones ─────────────────────────────────────────────────────────────

/** Columnas de geometría que el guardado refresca en una mesa que sobrevive. */
export interface GeometriaFila {
  pos_x: number;
  pos_y: number;
  ancho: number;
  alto: number;
  rotacion: number;
  is_merged: boolean;
  original_mesas: MesaOriginalPlan[] | null;
  etiqueta: string | null;
}

/** Fila completa tal cual se inserta en `mesas`. */
export interface FilaMesaNueva extends GeometriaFila {
  espacio_id: string;
  nombre: string;
  capacidad: number;
  forma: "rectangular" | "circular";
  activa: true;
}

/** Valores del UPDATE que devuelve a la vida una mesa original. */
export interface ValoresReactivacion extends GeometriaFila {
  activa: true;
  nombre: string;
  capacidad: number;
  forma: "rectangular" | "circular";
}

export interface OpGuardarPlano {
  tipo: "guardar-plano";
}

export interface MesaGeometria {
  id: string;
  nombre: string;
  valores: GeometriaFila;
}

export interface OpActualizarGeometria {
  tipo: "actualizar-geometria";
  mesas: MesaGeometria[];
}

export interface OpDesactivar {
  tipo: "desactivar";
  /** Fila a desactivar. */
  mesaId: string;
  nombre: string;
  motivo: "absorbida-en-union" | "union-desagrupada";
  /**
   * La "otra mitad" del problema si esto falla: para una original absorbida,
   * el nombre de la unión que la absorbió; para una unión desagrupada, nada.
   */
  nombreRelacionado?: string;
}

export interface OpReactivar {
  tipo: "reactivar";
  /** Fila persistida que hay que volver a poner activa. */
  mesaId: string;
  /** Id TEMPORAL que esa mesa tiene ahora en el lienzo (hay que renombrarlo). */
  idCanvas: string;
  nombre: string;
  valores: ValoresReactivacion;
}

export interface OpInsertar {
  tipo: "insertar";
  /** Id temporal en el lienzo (hay que renombrarlo al id real tras insertar). */
  idCanvas: string;
  nombre: string;
  valores: FilaMesaNueva;
  /**
   * Si está presente, este INSERT es el PLAN B de la reactivación de esa fila:
   * solo se ejecuta si la reactivación no encontró ninguna fila que tocar
   * (caso Terraza — la original se borró de verdad y solo queda el JSON).
   */
  soloSiNoSeReactivo?: string;
}

export interface OpRepuntar {
  tipo: "repuntar";
  /** Mesa cuyas asignaciones_mesa hay que mover. */
  origenId: string;
  nombreOrigen: string;
  /** Destino expresado con el id que tiene EN EL LIENZO: puede ser temporal. */
  destinoIdCanvas: string;
}

export type OperacionGuardado =
  | OpGuardarPlano
  | OpActualizarGeometria
  | OpDesactivar
  | OpReactivar
  | OpInsertar
  | OpRepuntar;

// ─── Construcción del plan ───────────────────────────────────────────────────

const geometriaDe = (mesa: MesaPlan): GeometriaFila => ({
  pos_x: mesa.posX,
  pos_y: mesa.posY,
  ancho: mesa.ancho,
  alto: mesa.alto,
  rotacion: mesa.rotacion ?? 0,
  is_merged: mesa.isMerged || false,
  original_mesas: mesa.originalMesas ?? null,
  etiqueta: mesa.etiqueta ?? null,
});

const filaNuevaDe = (mesa: MesaPlan, espacioId: string): FilaMesaNueva => ({
  espacio_id: espacioId,
  nombre: mesa.nombre,
  capacidad: mesa.capacidad,
  forma: mesa.forma,
  activa: true,
  ...geometriaDe(mesa),
});

const valoresReactivacionDe = (mesa: MesaPlan): ValoresReactivacion => ({
  activa: true,
  nombre: mesa.nombre,
  capacidad: mesa.capacidad,
  forma: mesa.forma,
  ...geometriaDe(mesa),
  // Una original que vuelve de una unión deja de ser (o de pertenecer a) una
  // fusión: si se quedara con is_merged/original_mesas del JSON anterior se
  // saldría del índice único y volvería a poder duplicar su número.
  is_merged: false,
  original_mesas: null,
});

/**
 * Traduce el estado del lienzo a la lista ORDENADA de escrituras que hay que
 * hacer. Ver la cabecera del fichero para el porqué del orden.
 */
export function construirPlanGuardado(entrada: EntradaPlanGuardado): OperacionGuardado[] {
  const { espacioId, mesasCanvas, pendingUnmerges } = entrada;
  const operaciones: OperacionGuardado[] = [];

  // (a) El plano en sí. No lleva datos: el ORDEN y el hecho de que sea un paso
  //     con éxito/fallo propio es lo único que necesita el plan; la fila la
  //     escribe `handleSave` con su propio hook.
  operaciones.push({ tipo: "guardar-plano" });

  // Originales absorbidos por una unión que está en el lienzo.
  const absorbidas = new Map<string, { nombre: string; union: string }>();
  for (const mesa of mesasCanvas) {
    if (!mesa.isMerged || !mesa.originalMesas) continue;
    for (const original of mesa.originalMesas) {
      if (esMesaNoPersistida(original.id)) continue;
      if (!absorbidas.has(original.id)) {
        absorbidas.set(original.id, { nombre: original.nombre, union: mesa.nombre });
      }
    }
  }

  const unionesDesagrupadas = new Set(pendingUnmerges.map((p) => p.mesaId));

  // (b) Geometría de las mesas persistidas que siguen en el lienzo tal cual.
  const geometria = mesasCanvas
    .filter(
      (mesa) =>
        !esMesaNoPersistida(mesa.id) &&
        !absorbidas.has(mesa.id) &&
        !unionesDesagrupadas.has(mesa.id),
    )
    .map((mesa) => ({ id: mesa.id, nombre: mesa.nombre, valores: geometriaDe(mesa) }));
  if (geometria.length > 0) {
    operaciones.push({ tipo: "actualizar-geometria", mesas: geometria });
  }

  // (c) Desactivaciones — SIEMPRE antes de reactivar/insertar (liberan números).
  for (const [mesaId, info] of absorbidas) {
    operaciones.push({
      tipo: "desactivar",
      mesaId,
      nombre: info.nombre,
      motivo: "absorbida-en-union",
      nombreRelacionado: info.union,
    });
  }
  for (const pendiente of pendingUnmerges) {
    operaciones.push({
      tipo: "desactivar",
      mesaId: pendiente.mesaId,
      nombre: pendiente.nombreUnion ?? "fusionada",
      motivo: "union-desagrupada",
    });
  }

  // Hijas de un desagrupe que sabemos de qué fila original salieron.
  const originalDeHija = new Map<string, string>();
  for (const pendiente of pendingUnmerges) {
    for (const [idCanvas, originalId] of Object.entries(pendiente.originalesPorNuevoId ?? {})) {
      if (!originalId || esMesaNoPersistida(originalId)) continue;
      originalDeHija.set(idCanvas, originalId);
    }
  }
  const idsEnLienzo = new Set(mesasCanvas.map((m) => m.id));

  const reactivaciones: OpReactivar[] = [];
  const inserciones: OpInsertar[] = [];

  for (const mesa of mesasCanvas) {
    if (esMesaTemporal(mesa.id)) {
      const originalId = originalDeHija.get(mesa.id);
      // Si la fila original SIGUE viva en el lienzo con su id real (el estado
      // del Salón: al fusionar nunca se borraron las originales, así que se
      // cargan como mesas propias), reactivarla duplicaría la mesa en el
      // lienzo y le pondría un nombre que ya está desambiguado con "-bis".
      // En ese caso la hija es, a todos los efectos, una mesa nueva.
      const originalYaEnLienzo = !!originalId && idsEnLienzo.has(originalId);

      if (originalId && !originalYaEnLienzo) {
        reactivaciones.push({
          tipo: "reactivar",
          mesaId: originalId,
          idCanvas: mesa.id,
          nombre: mesa.nombre,
          valores: valoresReactivacionDe(mesa),
        });
        inserciones.push({
          tipo: "insertar",
          idCanvas: mesa.id,
          nombre: mesa.nombre,
          valores: filaNuevaDe(mesa, espacioId),
          soloSiNoSeReactivo: originalId,
        });
      } else {
        inserciones.push({
          tipo: "insertar",
          idCanvas: mesa.id,
          nombre: mesa.nombre,
          valores: filaNuevaDe(mesa, espacioId),
        });
      }
    } else if (esMesaGrupoNueva(mesa.id)) {
      inserciones.push({
        tipo: "insertar",
        idCanvas: mesa.id,
        nombre: mesa.nombre,
        valores: { ...filaNuevaDe(mesa, espacioId), is_merged: true },
      });
    }
  }

  // (d) y (e).
  operaciones.push(...reactivaciones, ...inserciones);

  // (f) Asignaciones. Se resuelven contra el id FINAL del destino, que solo se
  //     conoce tras ejecutar (d)/(e) — de ahí que vayan las últimas.
  for (const mesa of mesasCanvas) {
    if (!mesa.isMerged || !mesa.originalMesas) continue;
    for (const original of mesa.originalMesas) {
      if (esMesaNoPersistida(original.id)) continue;
      operaciones.push({
        tipo: "repuntar",
        origenId: original.id,
        nombreOrigen: original.nombre,
        destinoIdCanvas: mesa.id,
      });
    }
  }
  for (const pendiente of pendingUnmerges) {
    const primera = pendiente.nuevosMesaIds[0];
    if (!primera) continue;
    operaciones.push({
      tipo: "repuntar",
      origenId: pendiente.mesaId,
      nombreOrigen: pendiente.nombreUnion ?? "fusionada",
      destinoIdCanvas: primera,
    });
  }

  return operaciones;
}

/**
 * Id real en BBDD de una mesa del lienzo. Puede no estar en `idTemporalAReal`
 * ni sobrevivir tal cual en `mesasCanvas` si el usuario la volvió a fusionar
 * ANTES de guardar (desagrupar -> re-fusionar en la misma edición): en ese caso
 * quedó absorbida como "original" dentro de otro grupo, así que se sigue la
 * cadena hasta el grupo que sí sobrevive.
 */
export function resolverIdFinalMesa(
  id: string,
  mesasCanvas: MesaPlan[],
  idTemporalAReal: ReadonlyMap<string, string>,
  visitados: Set<string> = new Set(),
): string {
  if (visitados.has(id)) return id; // corta si hubiera un ciclo
  visitados.add(id);
  const real = idTemporalAReal.get(id);
  if (real) return real;
  if (mesasCanvas.some((m) => m.id === id)) return id; // sigue viva tal cual
  const grupoQueLaAbsorbio = mesasCanvas.find(
    (m) => m.isMerged && m.originalMesas?.some((o) => o.id === id),
  );
  if (grupoQueLaAbsorbio) {
    return resolverIdFinalMesa(grupoQueLaAbsorbio.id, mesasCanvas, idTemporalAReal, visitados);
  }
  return id;
}

/**
 * Reescribe los desagrupes pendientes con los ids REALES que las mesas hijas
 * acaban de recibir (al insertarse o al reactivarse su fila original).
 *
 * Hace falta para que REINTENTAR un guardado a medias funcione: si los
 * pendientes siguieran hablando en ids temporales, el segundo intento no
 * encontraría a sus hijas —ya renombradas en el lienzo— y repuntaría las
 * reservas hacia un id que no existe.
 */
export function aplicarRenombradosADesagrupes(
  pendientes: DesagrupePlan[],
  idTemporalAReal: ReadonlyMap<string, string>,
): DesagrupePlan[] {
  if (idTemporalAReal.size === 0 || pendientes.length === 0) return pendientes;
  return pendientes.map((pendiente) => ({
    ...pendiente,
    nuevosMesaIds: pendiente.nuevosMesaIds.map((id) => idTemporalAReal.get(id) ?? id),
    originalesPorNuevoId: pendiente.originalesPorNuevoId
      ? Object.fromEntries(
          Object.entries(pendiente.originalesPorNuevoId).map(([idCanvas, originalId]) => [
            idTemporalAReal.get(idCanvas) ?? idCanvas,
            originalId,
          ]),
        )
      : undefined,
  }));
}

// ─── Resultado de la ejecución ───────────────────────────────────────────────

export type MotivoFallo =
  /** RLS: o error 42501, o la fila existe y sigue sin dejarse escribir. */
  | { clase: "permisos" }
  /** La fila ya no está en la BBDD (otra sesión la borró). */
  | { clase: "desaparecida" }
  | { clase: "error"; mensaje: string };

export interface ResultadoOperacion {
  operacion: OperacionGuardado;
  /**
   * - `ok`: aplicada y verificada.
   * - `omitida`: no hacía falta (una reactivación que no encontró fila, o el
   *   INSERT de plan B cuando la reactivación sí la encontró).
   * - `fallo`: no se aplicó (o no se pudo verificar que se aplicara).
   * - `pendiente`: no se llegó a ejecutar porque una anterior falló.
   */
  estado: "ok" | "omitida" | "fallo" | "pendiente";
  fallo?: MotivoFallo;
  /** Para `actualizar-geometria`: las mesas concretas que no volvieron. */
  mesasFallidas?: string[];
}

/**
 * Traduce lo que devuelve supabase-js a un motivo legible.
 *
 * OJO con el caso de CERO FILAS: cuando RLS deniega un UPDATE/DELETE, supabase
 * responde `{ data: [], error: null }` — no hay error que comprobar. Por eso
 * todas las escrituras del guardado piden `.select('id')` y cuentan lo que
 * vuelve, y por eso este helper tiene un camino explícito para ese caso.
 */
export function clasificarFallo(error: unknown): MotivoFallo {
  if (!error || typeof error !== "object") {
    return { clase: "error", mensaje: String(error ?? "error desconocido") };
  }
  const e = error as { code?: unknown; message?: unknown };
  const mensaje = typeof e.message === "string" ? e.message : "error desconocido";
  if (e.code === "42501" || /row[- ]level security/i.test(mensaje)) {
    return { clase: "permisos" };
  }
  return { clase: "error", mensaje };
}

export const FALLO_PERMISOS: MotivoFallo = { clase: "permisos" };
export const FALLO_DESAPARECIDA: MotivoFallo = { clase: "desaparecida" };

// ─── Qué significa "cero filas" ──────────────────────────────────────────────

/** Lo que dice el `select` de confirmación sobre una fila de `mesas`. */
export type EstadoFilaMesa = { existe: false } | { existe: true; activa: boolean };

export type LecturaCeroFilas =
  /** La fila existe y ya estaba como la queríamos dejar: no hay nada que hacer. */
  | "ya-cumplida"
  /** La fila no está: para desactivar es un no-op; para reactivar toca INSERTAR. */
  | "fila-ausente"
  /** La fila está, no está como la queremos, y aun así no se deja escribir. */
  | "denegada"
  /** No se ha podido comprobar: se lee de la forma pesimista. */
  | "sin-confirmar";

/**
 * "CERO FILAS" NO ES SINÓNIMO DE "SIN PERMISOS".
 *
 * Un `update … .eq('id', X).select('id')` que devuelve `[]` significa que
 * ninguna fila casó con el WHERE, y eso puede ser tres cosas distintas:
 *   1. la fila ya no existe;
 *   2. la fila existe y ya está como la queríamos dejar;
 *   3. la fila existe, NO está como la queremos, y RLS rechaza la escritura.
 *
 * Tratarlas todas como (3) hacía IMPOSIBLE guardar la Terraza: sus mesas
 * originales se borraron de verdad, sus ids solo sobreviven dentro del JSON
 * `original_mesas`, y el plan emite una desactivación por cada una. Esa
 * desactivación no puede fallar — ya está cumplida de sobra — pero el guardado
 * abortaba culpando a los permisos y el espacio que intentábamos reparar era el
 * único que no se podía salvar.
 *
 * El llamador resuelve el empate con un `select('id, activa')` sobre esa misma
 * fila y pasa aquí lo que vea (`null` si ni eso se pudo leer).
 *
 * LÍMITE CONOCIDO: si una política de RLS ocultara la fila también al SELECT,
 * "no existe" y "no me dejas verla" son indistinguibles desde el cliente y esto
 * la daría por cumplida. No es el caso hoy —el editor acaba de leer todas estas
 * filas con `useMesas`—, pero una RPC transaccional (la que haría falta para la
 * atomicidad de verdad) también cerraría este hueco.
 */
export function interpretarCeroFilas(
  operacion: "desactivar" | "reactivar",
  fila: EstadoFilaMesa | null,
): LecturaCeroFilas {
  if (fila === null) return "sin-confirmar";
  if (!fila.existe) return "fila-ausente";
  // Reactivar no escribe solo `activa`: también el nombre y la geometría. Que
  // la fila esté ahí (activa o no) significa que ese UPDATE debería haberla
  // tocado, así que cero filas solo puede ser un rechazo.
  if (operacion === "reactivar") return "denegada";
  return fila.activa ? "denegada" : "ya-cumplida";
}

// ─── Mensaje para el usuario ─────────────────────────────────────────────────

const MENSAJE_EXITO = "Plano guardado correctamente";

const unir = (partes: string[]): string => {
  if (partes.length === 0) return "";
  if (partes.length === 1) return partes[0];
  return `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
};

const capitalizar = (texto: string): string =>
  texto.length === 0 ? texto : texto[0].toUpperCase() + texto.slice(1);

const motivoLegible = (fallo?: MotivoFallo): string => {
  if (!fallo) return "error desconocido";
  if (fallo.clase === "permisos") return "permisos";
  if (fallo.clase === "desaparecida") return "ya no existe";
  return fallo.mensaje;
};

function fraseHecha(resultados: ResultadoOperacion[]): string[] {
  const ok = resultados.filter((r) => r.estado === "ok");
  const frases: string[] = [];

  if (ok.some((r) => r.operacion.tipo === "guardar-plano")) {
    frases.push("se guardó el plano");
  }

  const geometria = ok.find((r) => r.operacion.tipo === "actualizar-geometria");
  if (geometria) {
    const n = (geometria.operacion as OpActualizarGeometria).mesas.length;
    frases.push(n === 1 ? "se movió 1 mesa" : `se movieron ${n} mesas`);
  }

  const desactivadas = ok.filter((r) => r.operacion.tipo === "desactivar");
  if (desactivadas.length === 1) {
    frases.push(`se desactivó la mesa ${(desactivadas[0].operacion as OpDesactivar).nombre}`);
  } else if (desactivadas.length > 1) {
    frases.push(`se desactivaron ${desactivadas.length} mesas`);
  }

  const reactivadas = ok.filter((r) => r.operacion.tipo === "reactivar");
  if (reactivadas.length === 1) {
    frases.push(`se recuperó la mesa ${(reactivadas[0].operacion as OpReactivar).nombre}`);
  } else if (reactivadas.length > 1) {
    frases.push(`se recuperaron ${reactivadas.length} mesas`);
  }

  const creadas = ok.filter((r) => r.operacion.tipo === "insertar");
  if (creadas.length === 1) {
    frases.push(`se creó la mesa ${(creadas[0].operacion as OpInsertar).nombre}`);
  } else if (creadas.length > 1) {
    frases.push(`se crearon ${creadas.length} mesas`);
  }

  const repuntadas = ok.filter((r) => r.operacion.tipo === "repuntar");
  if (repuntadas.length === 1) {
    frases.push(
      `se movieron las reservas de la mesa ${(repuntadas[0].operacion as OpRepuntar).nombreOrigen}`,
    );
  } else if (repuntadas.length > 1) {
    frases.push(`se movieron las reservas de ${repuntadas.length} mesas`);
  }

  return frases;
}

function fraseFallo(resultado: ResultadoOperacion): string {
  const motivo = motivoLegible(resultado.fallo);
  const op = resultado.operacion;
  switch (op.tipo) {
    case "guardar-plano":
      return `no se pudo guardar el plano (${motivo})`;
    case "actualizar-geometria": {
      const nombres = resultado.mesasFallidas ?? op.mesas.map((m) => m.nombre);
      return nombres.length === 1
        ? `no se pudo mover la mesa ${nombres[0]} (${motivo})`
        : `no se pudieron mover las mesas ${unir(nombres)} (${motivo})`;
    }
    case "desactivar":
      return `no se pudo desactivar la mesa ${op.nombre} (${motivo})`;
    case "reactivar":
      return `no se pudo recuperar la mesa ${op.nombre} (${motivo})`;
    case "insertar":
      return `no se pudo crear la mesa ${op.nombre} (${motivo})`;
    case "repuntar":
      return `no se pudieron mover las reservas de la mesa ${op.nombreOrigen} (${motivo})`;
  }
}

/** En qué estado queda el espacio por culpa de ese fallo. */
function consecuencia(resultado: ResultadoOperacion): string {
  const op = resultado.operacion;
  switch (op.tipo) {
    case "guardar-plano":
      return "El plano se ha quedado como estaba";
    case "actualizar-geometria":
      return resultado.fallo?.clase === "desaparecida"
        ? "Otra sesión las ha borrado: el plano que tienes en pantalla está desfasado"
        : "Esas mesas siguen en su posición anterior";
    case "desactivar":
      return op.motivo === "absorbida-en-union"
        ? `Las mesas ${op.nombre} y ${op.nombreRelacionado ?? "la unión"} conviven ahora (el aforo cuenta sus plazas dos veces)`
        : `La unión ${op.nombre} sigue activa junto a las mesas que acabas de separar (el aforo cuenta sus plazas dos veces)`;
    case "reactivar":
      return `La mesa ${op.nombre} sigue sin estar en uso`;
    case "insertar":
      return `La mesa ${op.nombre} no se ha creado`;
    case "repuntar":
      return `Las reservas de la mesa ${op.nombreOrigen} siguen apuntando a una mesa que ya no está en uso`;
  }
}

/**
 * Texto exacto que ve el usuario. Nunca dice "guardado correctamente" si algo
 * falló, y siempre enumera lo que SÍ se aplicó: un guardado a medias no se
 * puede deshacer desde el cliente (ver la cabecera), así que la única salida es
 * que el usuario sepa qué mirar y recargue antes de volver a guardar.
 */
export function construirMensajeGuardado(resultados: ResultadoOperacion[]): {
  exito: boolean;
  mensaje: string;
} {
  const fallos = resultados.filter((r) => r.estado === "fallo");
  if (fallos.length === 0) {
    return { exito: true, mensaje: MENSAJE_EXITO };
  }

  const hechas = fraseHecha(resultados);
  const frasesFallo = fallos.map(fraseFallo);

  const inicio =
    hechas.length > 0
      ? `${capitalizar(unir(hechas))}, pero ${unir(frasesFallo)}.`
      : `${capitalizar(unir(frasesFallo))}.`;

  const pendientes = resultados.filter((r) => r.estado === "pendiente").length;
  const corte =
    pendientes > 0
      ? ` El guardado se detuvo ahí: ${pendientes === 1 ? "queda 1 paso" : `quedan ${pendientes} pasos`} sin aplicar.`
      : "";

  const cola = `${consecuencia(fallos[0])}: recarga la página antes de volver a guardar.`;

  return { exito: false, mensaje: `${inicio}${corte} ${cola}` };
}

// ─── Mensaje de "Limpiar" ────────────────────────────────────────────────────

const mesasTexto = (n: number): string => (n === 1 ? "1 mesa" : `${n} mesas`);

/**
 * Texto de la acción "Limpiar" (borrado de TODAS las mesas del espacio).
 *
 * Es la acción más destructiva del editor —`asignaciones_mesa.mesa_id` es
 * ON DELETE CASCADE, así que se lleva por delante el historial de reservas— y
 * hasta ahora solo comprobaba `{ error }`. Un DELETE denegado por RLS se
 * resuelve con `{ data: [], error: null }`: ni excepción, ni error, ni filas.
 * Por eso el llamador pide `.select('id')` y compara lo que vuelve con las
 * mesas que contó para el diálogo de confirmación, y por eso aquí hay una rama
 * explícita para "se borraron menos de las que había".
 *
 * `mesasEliminadas` va sin definir cuando la respuesta trajo error: en ese caso
 * no sabemos cuántas cayeron, solo que la operación no se puede dar por buena.
 */
export function construirMensajeLimpieza(entrada: {
  mesasEsperadas: number;
  mesasEliminadas?: number;
  fallo?: MotivoFallo;
}): { exito: boolean; mensaje: string } {
  const { mesasEsperadas, mesasEliminadas, fallo } = entrada;
  const recarga = "recarga la página antes de volver a intentarlo.";

  if (fallo) {
    const motivo = motivoLegible(fallo);
    if (mesasEsperadas === 0) {
      return { exito: false, mensaje: `No se ha podido limpiar el plano (${motivo}): ${recarga}` };
    }
    const siguen =
      mesasEsperadas === 1
        ? "La mesa del espacio sigue ahí"
        : `Las ${mesasEsperadas} mesas del espacio siguen ahí`;
    return {
      exito: false,
      mensaje: `No se ha podido limpiar el plano (${motivo}). ${siguen}: ${recarga}`,
    };
  }

  const eliminadas = mesasEliminadas ?? 0;
  if (eliminadas >= mesasEsperadas) {
    return { exito: true, mensaje: "Plano y mesas eliminados correctamente" };
  }

  // Menos filas de las contadas y sin error: solo puede venir de RLS.
  if (eliminadas === 0) {
    const ninguna =
      mesasEsperadas === 1
        ? "No se ha eliminado la mesa del espacio (permisos)."
        : `No se ha eliminado ninguna de las ${mesasEsperadas} mesas del espacio (permisos).`;
    return { exito: false, mensaje: `${ninguna} El plano sigue como estaba: ${recarga}` };
  }

  const restantes = mesasEsperadas - eliminadas;
  return {
    exito: false,
    mensaje:
      `Se eliminaron ${eliminadas} de ${mesasEsperadas} mesas, ` +
      `pero ${mesasTexto(restantes)} ${restantes === 1 ? "sigue" : "siguen"} en el espacio (permisos). ` +
      `El plano ha quedado a medio limpiar: ${recarga}`,
  };
}
