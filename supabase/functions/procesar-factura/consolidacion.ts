// ============================================================================
//  consolidacion.ts · Une las piezas de un documento largo (04b §1.8)
// ----------------------------------------------------------------------------
//  Determinista y PURO (sin modelo, sin red, sin Deno). Entrada: las piezas
//  cerradas de un trabajo (páginas y/o franjas). Salida: un DocumentoExtraido
//  con sus líneas en orden (pagina, orden, albaran_ref), los avisos y, si hay
//  algún fallo LOCALIZADO en una pieza que aún no se ha releído, la lista de
//  relecturas a pedir (una ronda por trabajo, una relectura por pieza).
//
//  Fronteras:
//   · Entre FRANJAS de la misma imagen: siempre hay solape (unos renglones
//     se ven en las dos). Se buscan las filas repetidas alineando el final de
//     la franja anterior con el principio de la siguiente con una comparación
//     DIFUSA (nombre parecido + algún número igual, albarán compatible), que
//     NO depende de que los totales se hayan leído idénticos en las dos, y
//     admite un hueco (una fila que una franja vio y la otra dio por cortada).
//   · Entre PÁGINAS: solo filas partidas (unir) y solape de fotos estricto
//     (≥ 2 filas idénticas, o 1 con ancla textual). Nunca se deduplica fuera
//     de la frontera: el mismo producto repetido son filas distintas.
// ============================================================================

import {
  type AlertaValidacion,
  aplicarRecuentoVerificado,
  comprobarCuadre,
  descuadresComoAlertas,
  deducirImportes,
  type DocumentoExtraido,
  type LineaExtraida,
  type OrigenImporte,
  retirarImportesNoImpresos,
  toleranciaCabecera,
} from "./esquema.ts";
import { esCifCliente, esNombreCliente, normalizarCif, normalizarDatos } from "./extraccion.ts";
import {
  bloqueRepetido,
  cuadraPorPeso,
  type LineaPagina,
  lineasProducto,
  type MotivoRelectura,
  motivosLocales,
  type PaginaCerrada,
  type ResultadoPagina,
} from "./pagina.ts";

export interface LineaConsolidada extends LineaExtraida {
  pagina: number;
  orden: number;
  albaran_ref: string | null;
}

export interface EstadisticasConsolidacion {
  piezas: number;
  franjas: number;
  duplicados_frontera: number;
  duplicados_solape_franjas: number;
  filas_partidas_unidas: number;
  filas_arrastre_quitadas: number;
  filas_bucle_quitadas: number;
  albaran_heredado: { pieza: number; albaran_ref: string; lineas: number }[];
  cabecera_completada_desde: Record<string, number>;
  reordenado: boolean;
}

export interface ResultadoConsolidacion {
  documento: DocumentoExtraido & { productos: LineaConsolidada[] };
  alertas: AlertaValidacion[];
  relecturas: { pagina_id: number; motivo: MotivoRelectura[] }[];
  stats: EstadisticasConsolidacion;
  /** Verificador del pie de la pieza de la que sale el pie (o null). */
  verificacionPie: PaginaCerrada["verificacion_pie"];
  /** Si true, NO se deduce ningún total (p. ej. una pieza de otro documento). */
  bloquearDeduccion: boolean;
  paginasDocumento: number;
  porPieza: {
    numero: number;
    pieza: string;
    extraidas: number;
    contadas: number | null;
    quitadas_solape: number;
    relecturas: number;
  }[];
}

// ─── Comparación de filas ────────────────────────────────────────────────────

const esNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function normalizarNombre(s: string | null | undefined): string {
  return String(s ?? "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function bigramas(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = s.replace(/ /g, "");
  for (let i = 0; i < t.length - 1; i++) {
    const b = t.slice(i, i + 2);
    m.set(b, (m.get(b) ?? 0) + 1);
  }
  return m;
}

/** Coeficiente de Dice sobre bigramas (0..1). Tolera letras mal leídas. */
export function similitudNombre(a: string, b: string): number {
  const x = normalizarNombre(a), y = normalizarNombre(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const bx = bigramas(x), by = bigramas(y);
  let comunes = 0, nx = 0, ny = 0;
  for (const v of bx.values()) nx += v;
  for (const v of by.values()) ny += v;
  for (const [k, v] of bx) comunes += Math.min(v, by.get(k) ?? 0);
  return nx + ny === 0 ? 0 : (2 * comunes) / (nx + ny);
}

function nombresCompatibles(a: string, b: string): boolean {
  const x = normalizarNombre(a), y = normalizarNombre(b);
  if (!x || !y) return false;
  if (x.length >= 6 && y.length >= 6 && (x.startsWith(y) || y.startsWith(x))) return true;
  return similitudNombre(x, y) >= 0.72;
}

function casi(a: number | null, b: number | null, rel = 0.015): boolean {
  if (!esNum(a) || !esNum(b)) return false;
  return Math.abs(a - b) <= Math.max(0.011, Math.abs(b) * rel);
}

const normAlb = (s: string | null) => (s ? s.toUpperCase().replace(/[^A-Z0-9]/g, "") : null);

/**
 * ¿Son la MISMA fila impresa, leída dos veces (una en cada franja)? Difusa a
 * propósito: el mismo renglón leído en dos recortes puede salir con un dígito
 * distinto. Exige nombre compatible y que al menos un número coincida
 * (cantidad, precio o total), y que no se contradigan los albaranes.
 */
export function mismaFila(
  a: LineaPagina | LineaExtraida | LineaConsolidada,
  b: LineaPagina | LineaExtraida | LineaConsolidada,
  mirarAlbaran = true,
): boolean {
  // Nombre leído distinto en cada recorte pero los TRES números idénticos y no
  // triviales: es la misma fila.
  const tresIguales = esNum(a.total) && Math.abs(a.total) >= 1 && casi(a.total, b.total) &&
    casi(a.precio_unitario, b.precio_unitario) && casi(a.cantidad, b.cantidad);
  if (!nombresCompatibles(a.nombre, b.nombre) && !(tresIguales && similitudNombre(a.nombre, b.nombre) >= 0.3)) {
    return false;
  }
  const albA = normAlb((a as LineaPagina).albaran_ref ?? null);
  const albB = normAlb((b as LineaPagina).albaran_ref ?? null);
  if (mirarAlbaran && albA && albB && albA !== albB) return false;
  const pares: [number | null, number | null][] = [
    [a.cantidad, b.cantidad],
    [a.precio_unitario, b.precio_unitario],
    [a.total, b.total],
  ];
  const comparables = pares.filter(([x, y]) => esNum(x) && esNum(y));
  if (comparables.length === 0) return true;
  const iguales = comparables.filter(([x, y]) => casi(x, y)).length;
  // Si las dos traen total y difieren más de un 25 %, no son la misma fila
  // aunque coincida la cantidad (dos entregas del mismo producto).
  if (esNum(a.total) && esNum(b.total) && Math.abs(a.total - b.total) > Math.max(1, Math.abs(b.total) * 0.25)) {
    return false;
  }
  return iguales >= 1;
}

/** Igualdad ESTRICTA (fronteras entre páginas): nombre normalizado, cantidad,
 *  total y albarán idénticos. */
function filaIdentica(a: LineaPagina, b: LineaPagina): boolean {
  return normalizarNombre(a.nombre) === normalizarNombre(b.nombre) &&
    (a.cantidad === b.cantidad) &&
    ((a.total === null && b.total === null) || (esNum(a.total) && esNum(b.total) && Math.abs(a.total - b.total) < 0.005)) &&
    normAlb(a.albaran_ref) === normAlb(b.albaran_ref);
}

/**
 * Filas del principio de `cur` que repiten el final de `prev` (solape de
 * franjas). Alineación monótona de las últimas `ventana` filas de prev con las
 * primeras `ventana` de cur, permitiendo UN hueco en cada lado (una fila que
 * una franja vio entera y la otra dio por cortada, o que el modelo saltó).
 * Condiciones para aceptar: la primera fila de cur casa con algo (o la
 * segunda, si la primera es un hueco), las casadas son contiguas salvo un
 * hueco, y lo casado llega al final de prev (salvo un hueco).
 * Devuelve los índices de `cur` que sobran.
 */
export function solapeFranjas(
  prev: (LineaPagina | LineaConsolidada)[],
  cur: LineaPagina[],
  ventana = 6,
): number[] {
  if (prev.length === 0 || cur.length === 0) return [];
  // En una franja, el albarán de las filas de arriba puede salir mal: la
  // franja no ve la cabecera del albarán, que se quedó en la anterior (Luga:
  // JAMÓN es del V/ 781.528 y la franja siguiente lo pone en el V/ 783.241).
  // Así que aquí NO se exige que el albarán coincida.
  const igual = (x: LineaPagina | LineaConsolidada, y: LineaPagina) => mismaFila(x, y, false);
  const S = prev.slice(-ventana);
  const P = cur.slice(0, ventana);

  // Para cada inicio i en S (fila de prev que casa con la primera casada de cur),
  // recorre en paralelo con hasta un hueco por lado.
  let mejor: number[] = [];
  let mejorPenal = Infinity;
  for (let i = 0; i < S.length; i++) {
    for (let j0 = 0; j0 <= Math.min(1, P.length - 1); j0++) {
      if (!igual(S[i], P[j0])) continue;
      const casadasCur = [j0];
      let si = i + 1, pj = j0 + 1, huecosS = 0, huecosP = j0;
      while (si < S.length && pj < P.length) {
        if (igual(S[si], P[pj])) { casadasCur.push(pj); si++; pj++; continue; }
        if (huecosS === 0 && si + 1 < S.length && igual(S[si + 1], P[pj])) { huecosS++; si++; continue; }
        if (huecosP <= 1 && pj + 1 < P.length && igual(S[si], P[pj + 1])) { huecosP++; pj++; continue; }
        break;
      }
      // Lo casado tiene que llegar al final de prev (admitimos que prev tenga
      // UNA fila más al final que cur no vio, p. ej. cortada en cur).
      const restoS = S.length - si;
      // Con 3+ filas casadas la alineación es segura aunque prev traiga hasta
      // 2 filas más al final (una inventada o una que cur dio por cortada).
      const maxResto = casadasCur.length >= 3 ? 2 : 1;
      if (restoS > maxResto || (restoS === maxResto && huecosS > 0 && maxResto === 1)) continue;
      // Una fila de cur ANTERIOR a la primera casada está en lo alto de la
      // franja, dentro del solape: geométricamente es una fila que prev ya
      // tiene (justo antes de S[i]) aunque se haya leído con otro nombre
      // («FR.COM. BUENAPINTA» = «FR. COSTILLA … -Buenapinta-»). Se da por
      // repetida si casa en importe con la fila de prev que le toca.
      if (j0 === 1 && i >= 1 && casi(S[i - 1].total, P[0].total) && esNum(P[0].total)) casadasCur.unshift(0);
      // Gana la alineación con más filas casadas; en empate, la que llega al
      // final exacto de prev y empieza en la primera fila de cur.
      const penal = restoS + huecosS + huecosP;
      if (casadasCur.length > mejor.length || (casadasCur.length === mejor.length && penal < mejorPenal)) {
        mejor = casadasCur;
        mejorPenal = penal;
      }
    }
  }
  return mejor;
}

/** Frontera entre PÁGINAS (no franjas): solape de fotos estricto. */
function solapePaginas(prev: LineaPagina[], cur: LineaPagina[], anclaTextual: boolean): number {
  let k = 0;
  for (let kk = Math.min(5, prev.length, cur.length); kk >= 1; kk--) {
    let ok = true;
    for (let j = 0; j < kk; j++) if (!filaIdentica(prev[prev.length - kk + j], cur[j])) { ok = false; break; }
    if (ok) { k = kk; break; }
  }
  if (k >= 2 || (k === 1 && anclaTextual)) return k;
  return 0;
}

const RE_ARRASTRE = /^(suma y sigue|suma anterior|viene de|a trasladar|carried forward|brought forward|suma y sigue\.?)\b/i;

const RE_ILEGIBLE = /\b(no legible|ilegible|cortad[ao]|fila incompleta|continua en|contin[uú]a)\b/i;

/** Marcador que pone el modelo para una fila cortada por el borde («PRODUCTO NO
 *  LEGIBLE / CONTINÚA…») sin ningún importe: no es una fila del papel. */
export function esFilaFantasma(l: LineaPagina): boolean {
  return RE_ILEGIBLE.test(l.nombre) && !esNum(l.total) && !esNum(l.precio_unitario);
}

function esArrastre(l: LineaPagina): boolean {
  if (l.es_fila_arrastre) return true;
  const sinDatos = !esNum(l.precio_unitario) && (l.cantidad === 0 || !esNum(l.cantidad));
  return RE_ARRASTRE.test(l.nombre.trim()) && sinDatos;
}

// ─── Cabecera ────────────────────────────────────────────────────────────────

function prioridadEtiqueta(et: string | null): number {
  if (!et) return 1;
  if (/albaranes|pedido|s\/?\s*ref|su ref|referencia|cliente/i.test(et)) return 0;
  if (/factura|invoice|albar[aá]n\b|n[º°o.]|num/i.test(et)) return 2;
  return 1;
}

const normNumDoc = (s: string | null) => (s ? s.toUpperCase().replace(/[^A-Z0-9]/g, "") : "");

// ─── consolidar ──────────────────────────────────────────────────────────────

export function consolidar(piezasEntrada: PaginaCerrada[], rondaRelectura = 0): ResultadoConsolidacion {
  const alertas: AlertaValidacion[] = [];
  const stats: EstadisticasConsolidacion = {
    piezas: piezasEntrada.length,
    franjas: piezasEntrada.filter((p) => p.pieza === "franja").length,
    duplicados_frontera: 0,
    duplicados_solape_franjas: 0,
    filas_partidas_unidas: 0,
    filas_arrastre_quitadas: 0,
    filas_bucle_quitadas: 0,
    albaran_heredado: [],
    cabecera_completada_desde: {},
    reordenado: false,
  };

  // ── Paso 0: orden y piezas que faltan ──
  let piezas = [...piezasEntrada].sort((a, b) => a.numero - b.numero);
  const soloPaginas = piezas.every((p) => p.pieza === "pagina");
  if (soloPaginas && piezas.length > 1) {
    const impresos = piezas.map((p) => p.resultado?.pagina_visible.numero_impreso ?? null);
    const todos = impresos.every((n) => n !== null);
    const esPermutacion = todos && [...impresos].sort((a, b) => a! - b!).every((n, i) => n === i + 1);
    const distintoOrden = impresos.some((n, i) => n !== null && n !== i + 1);
    if (distintoOrden) {
      alertas.push({
        codigo: "orden_paginas_discordante",
        severidad: "media",
        mensaje: esPermutacion
          ? "Las páginas se subieron en un orden distinto al que traen impreso; se han reordenado según su numeración."
          : "La numeración impresa de alguna página no coincide con el orden de subida; NO se ha reordenado.",
        detalle: { orden_subido: piezas.map((p) => p.numero), numeracion_impresa: impresos, reordenado: esPermutacion },
      });
      if (esPermutacion) {
        piezas = [...piezas].sort((a, b) =>
          (a.resultado!.pagina_visible.numero_impreso!) - (b.resultado!.pagina_visible.numero_impreso!)
        );
        stats.reordenado = true;
      }
    }
  }
  const validas = piezas.filter((p) => p.estado === "completada" && p.resultado);
  for (const p of piezas.filter((x) => !(x.estado === "completada" && x.resultado))) {
    alertas.push({
      codigo: "pagina_no_procesada",
      severidad: "alta",
      mensaje: `La pieza ${p.numero} (${p.pieza === "franja" ? `franja ${p.franja}` : `página ${p.pagina_doc}`}) no se ` +
        `ha podido leer tras varios intentos: sus filas NO están en el documento y el total no se puede deducir.`,
      detalle: { pieza: p.numero, pagina_doc: p.pagina_doc, franja: p.franja },
    });
  }
  const paginasDocumento = Math.max(1, ...piezas.map((p) => p.pagina_doc));
  const totalImpreso = Math.max(0, ...validas.map((p) => p.resultado!.pagina_visible.total_impreso ?? 0));
  const ultimaValida = validas[validas.length - 1];
  const ultimaTienePie = !!ultimaValida && piezaTienePie(ultimaValida.resultado!);
  let paginaFaltante = false;
  if (soloPaginas && totalImpreso > paginasDocumento) paginaFaltante = true;
  if (soloPaginas && ultimaValida && ultimaValida.resultado!.continua_en_otra_pagina && !ultimaTienePie) {
    paginaFaltante = true;
  }
  if (paginaFaltante) {
    alertas.push({
      codigo: "pagina_faltante",
      severidad: "alta",
      mensaje: `Parece que falta alguna página del documento (impreso: ${totalImpreso || "?"} páginas; subidas: ` +
        `${paginasDocumento}). El total no se puede deducir con páginas de menos.`,
      detalle: { paginas_impresas: totalImpreso || null, paginas_subidas: paginasDocumento },
    });
  }

  // ── Paso 1: cabecera ──
  const cab = elegirCabecera(validas, alertas, stats);

  // ── Paso 2: líneas ──
  const lineas: LineaConsolidada[] = [];
  const porPieza: ResultadoConsolidacion["porPieza"] = [];
  let albaranAbierto: string | null = null;
  type Anterior = { p: PaginaCerrada; filas: LineaPagina[] };
  let anterior = null as Anterior | null;
  let orden = 0;
  for (const p of validas) {
    const r = p.resultado!;
    const todas = r.lineas;
    let ls = todas.filter((l) => {
      if (esArrastre(l)) { stats.filas_arrastre_quitadas++; return false; }
      if (p.pieza === "franja" && esFilaFantasma(l)) return false;
      return true;
    });
    // Bucle del modelo: un bloque de 4+ filas idénticas repetido en la misma
    // imagen se quita (y se avisa). Ver bloqueRepetido en pagina.ts.
    for (let vuelta = 0; vuelta < 3; vuelta++) {
      const b = bloqueRepetido(ls);
      if (!b) break;
      alertas.push({
        codigo: "bloque_repetido_eliminado",
        severidad: "media",
        mensaje: `La lectura de la pieza ${p.numero} repetía ${b.largo} filas seguidas idénticas (mismo producto, ` +
          `cantidad e importe): se han quitado por ser una repetición de la lectura, no del papel. Revísalas.`,
        detalle: { pieza: p.numero, filas: ls.slice(b.desde, b.desde + b.largo).map((l) => ({ nombre: l.nombre, total: l.total })) },
      });
      stats.filas_bucle_quitadas += b.largo;
      ls = [...ls.slice(0, b.desde), ...ls.slice(b.desde + b.largo)];
    }
    const extraidas = ls.length;
    let quitadas = 0;

    if (anterior && anterior.filas.length > 0 && ls.length > 0) {
      const mismaImagen = p.pieza === "franja" && anterior.p.pieza === "franja" && p.pagina_doc === anterior.p.pagina_doc;
      if (mismaImagen) {
        // Se compara con la COLA de lo ya consolidado (la secuencia real del
        // documento), no solo con las filas nuevas de la franja anterior: si
        // esa franja era corta, su borde inferior incluye filas de la previa.
        const cola = lineas.slice(-6);
        const sobran = new Set(solapeFranjas(cola, ls));
        if (sobran.size > 0) {
          quitadas = sobran.size;
          stats.duplicados_solape_franjas += sobran.size;
          // Si la copia de la franja siguiente trae el albarán que a la que se
          // queda le faltaba, se completa.
          ls.filter((_, i) => sobran.has(i)).forEach((q) => {
            const destino = [...cola].reverse().find((x) => mismaFila(x, q, false));
            if (destino && !destino.albaran_ref && q.albaran_ref) destino.albaran_ref = q.albaran_ref;
          });
          ls = ls.filter((_, i) => !sobran.has(i));
        }
      } else {
        // A) Fila partida entre páginas.
        const prevL = anterior.filas[anterior.filas.length - 1];
        const cur = ls[0];
        const partida = prevL.partida === "continua_en_siguiente" || cur.partida === "continua_de_anterior" ||
          r.primera_fila.partida_desde_pagina_anterior ||
          anterior.p.resultado!.ultima_fila.continua_en_pagina_siguiente;
        if (partida) {
          const unida = unirPartida(prevL, cur);
          if (unida) {
            const ult = lineas[lineas.length - 1];
            if (ult) Object.assign(ult, { ...unida, pagina: ult.pagina, orden: ult.orden, albaran_ref: ult.albaran_ref ?? unida.albaran_ref });
            ls = ls.slice(1);
            stats.filas_partidas_unidas++;
          } else {
            alertas.push({
              codigo: "fila_partida_ambigua",
              severidad: "media",
              mensaje: `La fila «${prevL.nombre}» parece continuar en la página siguiente («${cur.nombre}»), pero las dos ` +
                `mitades traen números distintos: se han dejado como dos filas. Revísalas.`,
              detalle: { pieza: p.numero, anterior: prevL, siguiente: cur },
            });
          }
        }
        // B) Solape de fotos entre páginas.
        const ancla = !!r.primera_fila.texto_literal &&
          normalizarNombre(r.primera_fila.texto_literal) ===
            normalizarNombre(anterior.p.resultado!.ultima_fila.texto_literal);
        const k = solapePaginas(anterior.filas, ls, ancla);
        if (k > 0) {
          alertas.push({
            codigo: "duplicado_frontera_eliminado",
            severidad: "media",
            mensaje: `Las ${k} primera(s) fila(s) de la página ${p.pagina_doc} repetían el final de la anterior ` +
              `(fotos solapadas) y se han quitado. Comprueba que no eran entregas distintas.`,
            detalle: { pieza: p.numero, filas_quitadas: ls.slice(0, k).map((l) => ({ nombre: l.nombre, total: l.total })) },
          });
          ls = ls.slice(k);
          quitadas = k;
          stats.duplicados_frontera += k;
        }
      }
    }

    // Albarán: hereda el abierto hasta la primera fila con albarán propio.
    let heredadas = 0;
    for (const l of ls) {
      if (l.albaran_ref) break;
      if (albaranAbierto) { l.albaran_ref = albaranAbierto; heredadas++; }
    }
    if (heredadas > 0 && albaranAbierto) {
      stats.albaran_heredado.push({ pieza: p.numero, albaran_ref: albaranAbierto, lineas: heredadas });
    }
    const ultimoVisto = [...ls].reverse().find((l) => l.albaran_ref)?.albaran_ref ?? null;
    albaranAbierto = r.albaran_abierto_al_final.ref ?? ultimoVisto ?? albaranAbierto;

    for (const l of ls) {
      lineas.push({
        nombre: l.nombre,
        cantidad: l.cantidad,
        unidad: l.unidad,
        peso_kg: l.peso_kg,
        base_precio: l.base_precio,
        precio_unitario: l.precio_unitario,
        total: l.total,
        bonificada: l.bonificada,
        pagina: Math.min(20, Math.max(1, p.pagina_doc)),
        orden: orden++,
        albaran_ref: l.albaran_ref,
      });
    }
    porPieza.push({
      numero: p.numero,
      pieza: p.pieza,
      extraidas,
      contadas: p.recuento && esNum(p.recuento.filas_tabla) ? Math.round(p.recuento.filas_tabla) : null,
      quitadas_solape: quitadas,
      relecturas: p.relecturas,
    });
    // La «anterior» para la siguiente frontera son las filas de ESTA pieza tal
    // como quedaron (si todas eran repetidas, se conserva la anterior).
    const filasPrevias: LineaPagina[] = anterior ? anterior.filas : [];
    anterior = { p, filas: ls.length > 0 ? ls : filasPrevias };
  }

  // ── Paso 3: pie ──
  const conPie = validas.filter((p) => piezaTienePie(p.resultado!));
  let piePieza: PaginaCerrada | null = null;
  let pieFusionado: ResultadoPagina["pie"] | null = null;
  if (conPie.length > 0) {
    piePieza = conPie[conPie.length - 1];
    // En FRANJAS el bloque de totales puede quedar partido entre dos franjas
    // (una ve la base, la siguiente el total): se fusiona campo a campo, cada
    // uno con su cita, quedándose con el de la franja más baja que lo traiga.
    if (soloFranjasDeUnaImagen(validas)) {
      const f: ResultadoPagina["pie"] = { ...piePieza.resultado!.pie };
      for (const campo of ["subtotal", "iva", "total"] as const) {
        const lit = `${campo}_literal` as const;
        const de = [...conPie].reverse().find((p) => esNum(p.resultado!.pie[campo]));
        f[campo] = de ? de.resultado!.pie[campo] : null;
        f[lit] = de ? de.resultado!.pie[lit] : null;
      }
      pieFusionado = f;
    }
    // Solo es raro si DESPUÉS del pie hay más filas de producto (una franja
    // final en blanco por debajo del pie es lo normal).
    const filasDespues = validas.some((p) => p.numero > piePieza!.numero && lineasProducto(p.resultado!).length > 0);
    if (filasDespues) {
      alertas.push({
        codigo: "pie_fuera_de_ultima_pagina",
        severidad: "media",
        mensaje: `El bloque de totales no está en la última pieza sino en la ${piePieza.numero}.`,
        detalle: { pieza: piePieza.numero },
      });
    }
    const totales = new Set(conPie.map((p) => p.resultado!.pie.total).filter(esNum).map((t) => t.toFixed(2)));
    if (totales.size > 1 && !pieFusionado) {
      alertas.push({
        codigo: "cabecera_contradictoria",
        severidad: "media",
        mensaje: `Hay varios totales impresos distintos (${[...totales].join(" / ")}): se usa el de la pieza más alta.`,
        detalle: { campo: "total", valores: [...totales] },
      });
    }
  }
  const pie = pieFusionado ?? piePieza?.resultado!.pie ?? null;

  // ── Paso 5: arrastres ──
  let acumulada = 0;
  let salidaAnterior: number | null = null;
  for (const p of validas) {
    const r = p.resultado!;
    const sumaPieza = lineasProducto(r).reduce((a, l) => a + (esNum(l.total) ? l.total : 0), 0);
    acumulada += sumaPieza;
    if (r.arrastre_entrada.presente && esNum(r.arrastre_entrada.importe) && salidaAnterior !== null &&
      Math.abs(r.arrastre_entrada.importe - salidaAnterior) > toleranciaCabecera(salidaAnterior)) {
      alertas.push({
        codigo: "arrastre_inconsistente",
        severidad: "media",
        mensaje: `La pieza ${p.numero} arrastra ${r.arrastre_entrada.importe} y la anterior dejó ${salidaAnterior}.`,
        detalle: { pieza: p.numero, entrada: r.arrastre_entrada.importe, salida_anterior: salidaAnterior },
      });
    }
    if (r.arrastre_salida.presente && esNum(r.arrastre_salida.importe)) {
      const imp = r.arrastre_salida.importe;
      const tol = toleranciaCabecera(imp);
      if (Math.abs(imp - sumaPieza) > tol && Math.abs(imp - acumulada) > tol) {
        alertas.push({
          codigo: "arrastre_inconsistente",
          severidad: "media",
          mensaje: `La pieza ${p.numero} imprime «suma y sigue» ${imp} y sus líneas suman ${sumaPieza.toFixed(2)} ` +
            `(acumulado ${acumulada.toFixed(2)}).`,
          detalle: { pieza: p.numero, arrastre: imp, suma_pieza: sumaPieza, acumulada },
        });
      }
      salidaAnterior = imp;
    }
  }

  // ── Paso 4: documento y recuento ──
  const quitadasTotal = stats.duplicados_frontera + stats.duplicados_solape_franjas + stats.filas_partidas_unidas;
  const vistasPorPieza = validas.map((p) => {
    const ext = porPieza.find((x) => x.numero === p.numero)?.extraidas ?? lineasProducto(p.resultado!).length;
    const c = p.recuento && esNum(p.recuento.filas_tabla) ? Math.round(p.recuento.filas_tabla) : null;
    return { p, ext, contadas: c, vistas: Math.max(ext, c ?? 0) };
  });
  const faltanPorPieza = vistasPorPieza.filter((v) => v.contadas !== null && v.contadas > v.ext);
  const filasTablaDoc = vistasPorPieza.reduce((a, v) => a + v.vistas, 0) - quitadasTotal;

  if (faltanPorPieza.length > 0) {
    const contadas = filasTablaDoc;
    alertas.push({
      codigo: "recuento_filas_discordante",
      severidad: "alta",
      mensaje: `Una segunda lectura, hecha SOLO para contar, ve más filas de las extraídas en ` +
        `${faltanPorPieza.length} pieza(s) (${faltanPorPieza.map((v) => `pieza ${v.p.numero}: ${v.contadas} contadas, ` +
          `${v.ext} extraídas`).join("; ")}). El documento tendría ~${contadas} filas y se han guardado ` +
        `${lineas.length}: el total NO se deduce de la suma. Contrasta con el papel.`,
      detalle: {
        filas_contadas: contadas,
        lineas_extraidas: lineas.length,
        por_pagina: vistasPorPieza.map((v) => ({
          pieza: v.p.numero,
          pagina_doc: v.p.pagina_doc,
          franja: v.p.franja,
          contadas: v.contadas,
          extraidas: v.ext,
          primera_fila: v.p.resultado!.primera_fila.texto_literal,
          ultima_fila: v.p.resultado!.ultima_fila.texto_literal,
        })),
        origen: "contador_filas",
      },
    });
  }

  const deOtroDocumento = validas.filter((p) => piezaDeOtroDocumento(p.resultado!, cab.numero_documento));
  for (const p of deOtroDocumento) {
    alertas.push({
      codigo: "pagina_de_otro_documento",
      severidad: "alta",
      mensaje: `La pieza ${p.numero} lleva otro número de documento («${p.resultado!.cabecera_visible.numero_documento}» ` +
        `frente a «${cab.numero_documento}»): puede ser de otra factura. No se deduce el total.`,
      detalle: { pieza: p.numero, numero_documento: p.resultado!.cabecera_visible.numero_documento },
    });
  }
  for (const p of validas) {
    const r = p.resultado!;
    const vacia = lineasProducto(r).length === 0 && !piezaTienePie(r) &&
      !r.cabecera_visible.numero_documento && !r.cabecera_visible.proveedor &&
      (!p.recuento || !esNum(p.recuento.filas_tabla) || p.recuento.filas_tabla === 0);
    if (vacia && p.pieza === "pagina") {
      alertas.push({
        codigo: "pagina_sin_contenido",
        severidad: "media",
        mensaje: `La página ${p.pagina_doc} no tiene cabecera, ni filas, ni pie legibles.`,
        detalle: { pieza: p.numero },
      });
    }
  }

  const sinImportes = validas.length > 0 && validas.every((p) => p.resultado!.sin_importes);
  const observaciones = [...new Set(validas.map((p) => p.resultado!.observaciones).filter(Boolean))].join(" · ") || null;
  const resumen = ultimaValida?.resultado!.resumen ?? validas.find((p) => p.resultado!.resumen)?.resultado!.resumen ?? null;

  const documento: DocumentoExtraido & { productos: LineaConsolidada[] } = {
    tipo: cab.tipo,
    proveedor: cab.proveedor,
    cif: cab.cif,
    numero_documento: cab.numero_documento ?? "",
    fecha: cab.fecha,
    sin_importes: sinImportes,
    continua_en_otra_pagina: paginaFaltante || piezas.some((p) => p.estado !== "completada"),
    filas_tabla: validas.length > 0 ? Math.max(filasTablaDoc, 0) : null,
    productos: lineas,
    subtotal_literal: pie?.subtotal_literal ?? null,
    subtotal: pie?.subtotal ?? null,
    iva_literal: pie?.iva_literal ?? null,
    iva: pie?.iva ?? null,
    total_literal: pie?.total_literal ?? null,
    total: pie?.total ?? null,
    observaciones,
    resumen,
  };

  // ── Paso 6: relecturas (una ronda por trabajo, una por pieza) ──
  const relecturas: ResultadoConsolidacion["relecturas"] = [];
  if (rondaRelectura === 0) {
    for (const p of validas) {
      if (p.relecturas > 0) continue;
      const m = motivosLocales(p.resultado!, p.recuento, null);
      if (m.length > 0) relecturas.push({ pagina_id: p.pagina_id, motivo: m });
    }
  }

  return {
    documento,
    alertas,
    relecturas,
    stats,
    verificacionPie: piePieza?.verificacion_pie ?? null,
    bloquearDeduccion: deOtroDocumento.length > 0,
    paginasDocumento,
    porPieza,
  };
}

function soloFranjasDeUnaImagen(ps: PaginaCerrada[]): boolean {
  return ps.length > 0 && ps.every((p) => p.pieza === "franja" && p.pagina_doc === ps[0].pagina_doc);
}

function piezaTienePie(r: ResultadoPagina): boolean {
  if (r.pie.tabla_totales_vacia && !esNum(r.pie.total)) return false;
  return esNum(r.pie.total) || esNum(r.pie.subtotal) || esNum(r.pie.iva);
}

function piezaDeOtroDocumento(r: ResultadoPagina, numero: string | null): boolean {
  const n = r.cabecera_visible.numero_documento;
  if (!n || !numero) return false;
  if (prioridadEtiqueta(r.cabecera_visible.numero_etiqueta_literal) < 2) return false;
  return normNumDoc(n) !== normNumDoc(numero);
}

function unirPartida(prev: LineaPagina, cur: LineaPagina): LineaPagina | null {
  const campos = ["cantidad", "precio_unitario", "total", "peso_kg"] as const;
  for (const c of campos) {
    const a = prev[c], b = cur[c];
    // cantidad 0 o null en una mitad = la mitad sin números
    const aVacio = !esNum(a) || (c === "cantidad" && a === 0);
    const bVacio = !esNum(b) || (c === "cantidad" && b === 0);
    if (!aVacio && !bVacio && Math.abs((a as number) - (b as number)) > 0.005) return null;
  }
  const na = normalizarNombre(prev.nombre), nb = normalizarNombre(cur.nombre);
  const nombre = na.startsWith(nb) ? prev.nombre : nb.startsWith(na) ? cur.nombre : `${prev.nombre} ${cur.nombre}`.trim();
  const tomar = <K extends typeof campos[number]>(c: K) =>
    (esNum(prev[c]) && !(c === "cantidad" && prev[c] === 0)) ? prev[c] : cur[c];
  return {
    ...prev,
    nombre,
    cantidad: (tomar("cantidad") as number) ?? 0,
    precio_unitario: tomar("precio_unitario"),
    total: tomar("total"),
    peso_kg: tomar("peso_kg"),
    importe_literal: prev.importe_literal ?? cur.importe_literal,
    albaran_ref: prev.albaran_ref ?? cur.albaran_ref,
    partida: "no",
  };
}

interface CabeceraElegida {
  tipo: "factura" | "albaran";
  proveedor: string | null;
  cif: string | null;
  numero_documento: string | null;
  fecha: string | null;
}

function elegirCabecera(
  validas: PaginaCerrada[],
  alertas: AlertaValidacion[],
  stats: EstadisticasConsolidacion,
): CabeceraElegida {
  const cabs = validas.map((p) => ({ n: p.numero, c: p.resultado!.cabecera_visible }));

  // tipo: manda el TÍTULO de cualquier pieza (Luga: «FACTURA» solo en la p2).
  let tipo: "factura" | "albaran" = "factura";
  const titulos = cabs.map((x) => x.c.titulo_literal ?? "").join(" | ");
  if (/factura|invoice/i.test(titulos)) tipo = "factura";
  else if (/albar[aá]n|nota de entrega|delivery/i.test(titulos)) tipo = "albaran";
  else tipo = cabs.find((x) => x.c.tipo)?.c.tipo ?? "factura";

  // numero: mejor etiqueta primero; en empate, la pieza más baja.
  const candidatosNum = cabs
    .filter((x) => x.c.numero_documento)
    .map((x) => ({ ...x, prio: prioridadEtiqueta(x.c.numero_etiqueta_literal) }))
    .sort((a, b) => b.prio - a.prio || a.n - b.n);
  // Los demás campos se buscan primero en la pieza de la que sale el número
  // (el bloque de cabecera de verdad) y luego en el resto, en orden. Luga: la
  // «Fecha Emisión» del pie de la p1 sale antes que la fecha de la cabecera.
  const piezaCab = candidatosNum[0]?.n;
  const ordenCab = piezaCab ? [...cabs.filter((x) => x.n === piezaCab), ...cabs.filter((x) => x.n !== piezaCab)] : cabs;
  const primero = <T>(f: (c: typeof cabs[number]) => T | null, campo: string): T | null => {
    for (const x of ordenCab) {
      const v = f(x);
      if (v !== null && v !== undefined && v !== "") {
        if (x.n !== cabs[0]?.n) stats.cabecera_completada_desde[campo] = x.n;
        return v;
      }
    }
    return null;
  };

  const numero = candidatosNum[0]?.c.numero_documento ?? null;
  if (candidatosNum[0] && candidatosNum[0].n !== cabs[0]?.n) stats.cabecera_completada_desde.numero_documento = candidatosNum[0].n;
  const numerosDistintos = new Set(candidatosNum.filter((x) => x.prio >= 2).map((x) => normNumDoc(x.c.numero_documento)));

  const proveedor = primero((x) => (x.c.proveedor && !esNombreCliente(x.c.proveedor) ? x.c.proveedor : null), "proveedor");
  const cif = primero((x) => (x.c.cif && !esCifCliente(x.c.cif) ? x.c.cif : null), "cif");
  const fecha = primero((x) => (x.c.fecha && /^\d{4}-\d{2}-\d{2}$/.test(x.c.fecha) ? x.c.fecha : null), "fecha");

  const contradicciones: Record<string, string[]> = {};
  const cifs = new Set(cabs.map((x) => x.c.cif).filter((c) => c && !esCifCliente(c)).map((c) => normalizarCif(c)));
  if (cifs.size > 1) contradicciones.cif = [...cifs];
  if (numerosDistintos.size > 1) contradicciones.numero_documento = [...numerosDistintos];
  const fechas = new Set(cabs.map((x) => x.c.fecha).filter(Boolean));
  // Fechas distintas entre FRANJAS de una misma imagen son lo normal (fecha de
  // factura, de albarán, de emisión, de vencimiento): solo cuentan entre páginas.
  if (fechas.size > 1 && !soloFranjasDeUnaImagen(validas)) contradicciones.fecha = [...fechas] as string[];
  if (Object.keys(contradicciones).length > 0) {
    alertas.push({
      codigo: "cabecera_contradictoria",
      severidad: "media",
      mensaje: `Las piezas del documento no coinciden en: ${Object.keys(contradicciones).join(", ")}. Se ha usado ` +
        `el valor de la pieza más baja (o el de la etiqueta de factura para el número).`,
      detalle: { valores_por_pagina: contradicciones },
    });
  }
  return { tipo, proveedor, cif, numero_documento: numero, fecha };
}

// ─── Del documento consolidado al que se guarda ─────────────────────────────

export interface DocumentoConsolidadoListo {
  datos: ReturnType<typeof normalizarDatos>;
  alertasPrevias: Record<string, unknown>[];
  totalOrigen: OrigenImporte | null;
}

/**
 * Mismo orden que el camino síncrono (index.ts v101 :1326-1361): retirar los
 * importes del pie que no se citan, deducir el total y normalizar. El
 * recuento ya viene aplicado por la consolidación (alerta por pieza), así que
 * aquí NO se llama a aplicarRecuentoVerificado con un recuento global.
 * Lanza si ninguna pieza trae número de documento (como normalizarDatos).
 */
export function prepararDocumentoConsolidado(c: ResultadoConsolidacion): DocumentoConsolidadoListo {
  if (!c.documento.numero_documento) {
    throw new Error(
      "Ninguna página del documento trae un número de factura o albarán legible: no se puede guardar. " +
        "Sube la página de la cabecera o una foto mejor.",
    );
  }
  // Descuadres del documento consolidado (mismo validador que el camino de
  // una página). Los de recuento ya los ha puesto la consolidación por pieza.
  const yaPuestos = new Set(c.alertas.map((a) => a.codigo));
  const descuadres = comprobarCuadre(c.documento).filter((d) =>
    !yaPuestos.has(d.codigo) && !["lineas_incompletas", "recuento_filas_ausente"].includes(d.codigo) &&
    // Línea facturada por kilos (columna de peso aparte): peso × precio = importe.
    !(d.codigo === "descuadre_linea" && cuadraPorPeso(c.documento.productos[Number(d.detalle?.indice)]))
  );
  const { datos: citado, retiradas, discordancias } = retirarImportesNoImpresos(c.documento, c.verificacionPie);
  // Sin recuento extra: aplicarRecuentoVerificado con null no toca nada, se
  // llama para dejar constancia de que el contrato es el mismo.
  const { datos: contado } = aplicarRecuentoVerificado(citado, null);
  const { datos: deducido, deduccion } = c.bloquearDeduccion
    ? { datos: contado, deduccion: null }
    : deducirImportes(contado);
  const datos = normalizarDatos(deducido);
  const totalOrigen: OrigenImporte | null = datos.total === null ? null : deduccion ? "deducido" : "leido";
  const alertasPrevias = [
    ...c.alertas,
    ...descuadresComoAlertas(descuadres, "pre-guardado"),
    ...retiradas.map((r) => r.alerta),
    ...discordancias,
    ...(deduccion ? [deduccion.alerta] : []),
  ].map((a) => ({ ...a, detalle: { ...(a.detalle ?? {}), origen: (a.detalle as Record<string, unknown> | undefined)?.origen ?? "multipagina" } })) as unknown as Record<string, unknown>[];
  return { datos, alertasPrevias, totalOrigen };
}
