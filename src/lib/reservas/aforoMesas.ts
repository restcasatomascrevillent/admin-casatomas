// ============================================================================
// CUADRE DE AFORO: CAPACIDAD DECLARADA vs SUMA DE MESAS — lógica pura (sin I/O)
// ----------------------------------------------------------------------------
// Un espacio de reserva tiene DOS cifras de aforo que deberían decir lo mismo
// y en producción no lo dicen:
//   · CAPACIDAD DECLARADA: `espacios_reserva.capacidad_maxima`, un número que
//     se escribe a mano en la pantalla de Espacios.
//   · SUMA DE MESAS: `sum(mesas.capacidad)` de las mesas REALES del espacio
//     (activas y NO fusionadas), las que el dueño coloca en el editor de plano.
//
// CUÁL MANDA HOY: la capacidad declarada, y solo ella. El trigger de aforo
// `validar_capacidad_reserva()` (migración 20260922190000_aforo_por_marca.sql)
// suma `capacidad_maxima` y con eso decide si acepta o rechaza el INSERT. Las
// mesas hoy son dibujo: no entran en ninguna validación. La regla alternativa
// ("que mande la suma de las mesas") está escrita en la migración
// `supabase/migrations/20260926120000_capacidad_efectiva_mesas.sql`, pero está
// DORMIDA y SIN APLICAR — encenderla cambiaría de golpe el aforo real del
// restaurante (ver `bloquearia` más abajo).
//
// ESTO ES SOLO INFORMACIÓN. La pantalla de Configuración de /reservas enseña
// el descuadre para que el dueño lo vea y lo arregle cuando quiera; NO bloquea
// guardar, no cambia lo que acepta la base de datos y no corrige nada solo.
//
// ────────────────────────────────────────────────────────────────────────────
// POR QUÉ SE EXCLUYEN LAS MESAS FUSIONADAS (`is_merged = true`)
// ────────────────────────────────────────────────────────────────────────────
// Hasta el 2026-09-27 este archivo sumaba TODAS las mesas activas y la cabecera
// lo justificaba diciendo que el editor de plano, al fusionar, BORRA las filas
// originales y deja solo la fila fusionada con la capacidad combinada. ESO ES
// FALSO EN PRODUCCIÓN, y por eso la tarjeta de Configuración llevaba meses
// enseñando plazas que no existen.
//
// Lo que pasa de verdad: el editor sí INTENTA borrar las originales, pero lo
// hace sin mirar el error que devuelve Supabase
// (`src/components/espacios/EditorPlanoEspacio.tsx`, líneas ~551 y ~583:
// `await supabase.from('mesas').delete().eq('id', originalId)` a pelo, sin
// desestructurar `{ error }`). supabase-js RESUELVE la promesa —no la
// rechaza— cuando RLS o una clave ajena impiden el DELETE, así que el borrado
// puede fallar EN SILENCIO mientras el editor sigue diciendo "Plano guardado
// correctamente". Resultado: en la tabla conviven la fila fusionada Y sus
// originales, y sumarlas todas cuenta las mismas sillas DOS VECES.
//
// Datos reales verificados el 2026-09-27 (20 filas en `mesas`):
//
//   Espacio   Declarada  Filas  Fusionadas  Suma de TODAS  Suma REAL
//   Comedor       50       2         0            4            4
//   Salón         50      15         7           64           36
//   Terraza       50       3         3           12            0
//
// TERRAZA ES EL CASO EXTREMO y no hay que maquillarlo: sus 3 filas son TODAS
// fusiones ("2+1", "3+4"...), así que el espacio no tiene NI UNA mesa real y
// su aforo real es 0. Las originales se perdieron al fusionarlas. Eso es
// exactamente lo que el dueño tiene que ver para volver a darlas de alta en el
// editor de plano; de ahí el estado propio `"solo_fusionadas"`, que NO es lo
// mismo que `"sin_mesas"` (plano vacío): son dos averías distintas con dos
// arreglos distintos.
//
// CRITERIO EXACTO (tiene que ser idéntico en cliente y servidor):
//   · mesa real     = `is_merged !== true` (la columna es NULLABLE: `null` y
//                     `undefined` cuentan como mesa real, igual que el
//                     `coalesce(is_merged, false) = false` de Postgres).
//   · mesa que suma = real Y `activa !== false` (columna `boolean DEFAULT true`
//                     nullable, igual que el `activa is not false` de Postgres).
// Las funciones SQL `fn_capacidad_efectiva_espacio` y
// `fn_capacidad_efectiva_marca` filtran con
// `coalesce(is_merged, false) = false and activa is not false`. Si se cambia
// uno de los dos lados HAY QUE CAMBIAR EL OTRO: la pantalla y el trigger
// tienen que dar el mismo número o volvemos al desajuste cliente/servidor que
// ya costó el bug de `20260922190000_aforo_por_marca.sql`.
//
// AGREGADO DEL RESTAURANTE: replica exactamente el filtro del trigger para la
// marca de Casa Tomás (espacio con `activa = true` + marca del espacio), porque
// el aforo se valida POR MARCA y no por espacio. Ver `calcularCuadreTotal`.
// Solo Casa Tomás admite reservas (decisión del dueño, 2026-10-01): las salas de
// otro negocio no entran (`admiteReservas`).
// ============================================================================

import { admiteReservas, marcaDeEspacio } from "./negocios";

export interface EspacioParaCuadre {
  id: string;
  nombre: string;
  capacidad_maxima: number;
  activa?: boolean | null;
  caracteristicas?: unknown;
  marca?: string | null;
}

export interface MesaParaCuadre {
  id: string;
  espacio_id: string;
  capacidad: number | null;
  activa?: boolean | null;
  /**
   * Fila creada al juntar otras mesas en el editor de plano. NO aporta aforo:
   * sus plazas ya las aportan las mesas originales, que pueden seguir vivas en
   * la tabla (ver la cabecera). Columna NULLABLE: solo `true` es fusionada.
   */
  is_merged?: boolean | null;
}

/**
 * · `cuadra`           → las plazas reales coinciden con la capacidad declarada.
 * · `sin_mesas`        → el plano está VACÍO: ni una fila activa. Se arregla
 *                        dando de alta las mesas.
 * · `solo_fusionadas`  → hay filas activas pero TODAS son uniones: no queda ni
 *                        una mesa real, así que el aforo real es 0. Se
 *                        perdieron las originales al fusionarlas y hay que
 *                        volver a darlas de alta (caso Terraza, 2026-09-27).
 * · `por_debajo`       → las mesas reales suman MENOS que lo declarado.
 * · `por_encima`       → las mesas reales suman MÁS que lo declarado.
 */
export type EstadoCuadre = "cuadra" | "sin_mesas" | "solo_fusionadas" | "por_debajo" | "por_encima";

export interface CuadreEspacio {
  espacioId: string;
  nombre: string;
  marca: string;
  activa: boolean;
  capacidadDeclarada: number;
  /**
   * Plazas que cuentan para el aforo: suma de `capacidad` de las mesas REALES
   * (activas y NO fusionadas). Las uniones quedan fuera a propósito (ver
   * cabecera). Conserva el nombre de siempre para no romper a quien ya lo lee,
   * pero desde el 2026-09-27 la cifra es la buena, no la inflada.
   */
  plazasMesas: number;
  /**
   * Plazas de las filas FUSIONADAS activas. NO están dentro de `plazasMesas`;
   * se exponen para que la pantalla pueda explicar el salto ("Salón pasa de 64
   * a 36 porque 28 plazas estaban contadas dos veces").
   */
  plazasFusionadas: number;
  /**
   * TODAS las filas activas del espacio, uniones INCLUIDAS (`activa !== false`).
   * Es el recuento de filas que se ven en el listado, no el de mesas que suman.
   * Para hablar de aforo usa `mesasReales`.
   */
  mesasActivas: number;
  /** Filas activas que NO son uniones: las mesas de verdad. Es el subconjunto de `mesasActivas` que suma en `plazasMesas`. */
  mesasReales: number;
  /** Filas activas que SÍ son uniones (`is_merged === true`). Subconjunto de `mesasActivas`; suman en `plazasFusionadas`. */
  mesasFusionadas: number;
  /** Filas con `activa === false`, sean uniones o no. Fuera de `mesasActivas`. */
  mesasInactivas: number;
  /** plazasMesas - capacidadDeclarada */
  diferencia: number;
  estado: EstadoCuadre;
  /** estado !== "cuadra" */
  descuadra: boolean;
}

/** Agregado de las salas activas de Casa Tomás (las que suman en el aforo del turno). */
export interface CuadreTotal {
  capacidadDeclarada: number;
  /** Suma de las plazas REALES de las salas activas (sin uniones). */
  plazasMesas: number;
  /** Suma de las plazas de las uniones activas. Informativo: no cuenta para el aforo. */
  plazasFusionadas: number;
  diferencia: number;
  /** Salas activas que no aportan NI UNA plaza real: plano vacío (`sin_mesas`) o solo uniones (`solo_fusionadas`). */
  espaciosSinMesas: number;
  /** Subconjunto del anterior: salas con filas activas pero todas uniones. Son las que hay que redibujar. */
  espaciosSoloFusionadas: number;
  espaciosDescuadrados: number;
  /** true si al encender la regla el restaurante se quedaría a 0 y no podría reservar nada */
  bloquearia: boolean;
}

/**
 * Plazas de una fila suelta. `mesas.capacidad` es `integer` en la base, pero
 * llega por un `select('*')` sin validar: basura, `null`, `NaN`, `Infinity` o
 * un negativo cuentan como 0. Nunca resta ni revienta — un dato sucio no puede
 * hacer desaparecer plazas de las mesas buenas ni tumbar la pantalla.
 */
const plazasDeUnaMesa = (capacidad: unknown): number => {
  const n = Number(capacidad);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
};

/**
 * ¿Está la mesa en uso? `mesas.activa` es `boolean DEFAULT true` y puede llegar
 * `null` (o no venir en el select), así que solo un `false` explícito la
 * descarta. Mismo criterio que el `activa is not false` del SQL.
 */
const mesaActiva = (mesa: MesaParaCuadre): boolean => mesa.activa !== false;

/**
 * ¿Es una unión creada en el editor de plano? La columna `mesas.is_merged` es
 * NULLABLE, así que se exige `=== true`: `null`/`undefined` (y una mesa que
 * viene de un select sin ese campo) son mesa real. Mismo criterio que el
 * `coalesce(is_merged, false) = false` del SQL.
 */
const mesaEsFusionada = (mesa: MesaParaCuadre): boolean => mesa.is_merged === true;

/** ¿Suma esta fila para el aforo? Solo las mesas reales (no unión) que están en uso. */
const mesaCuenta = (mesa: MesaParaCuadre): boolean => mesaActiva(mesa) && !mesaEsFusionada(mesa);

/**
 * Suma de plazas de las mesas REALES (activas y no fusionadas) de un espacio.
 *
 * OJO: hasta el 2026-09-27 esta función sumaba también las uniones y por eso
 * mentía (Terraza decía 12 plazas sin tener una sola mesa). Se excluyen a
 * propósito; si necesitas la cifra de las uniones usa
 * `calcularCuadreEspacio(...).plazasFusionadas`. Fuera de los tests nadie más
 * la importa hoy (comprobado con grep el 2026-09-27: el `plazasDeMesas` de
 * `PlanoEspacio2D.tsx` es otro, el de `components/reservas/asignacionPlano.ts`,
 * que suma mesas por id y no tiene nada que ver con esto).
 */
export function plazasDeMesas(mesas: readonly MesaParaCuadre[], espacioId: string): number {
  return (mesas ?? [])
    .filter((m) => m && m.espacio_id === espacioId && mesaCuenta(m))
    .reduce((s, m) => s + plazasDeUnaMesa(m.capacidad), 0);
}

export function calcularCuadreEspacio(espacio: EspacioParaCuadre, mesas: readonly MesaParaCuadre[]): CuadreEspacio {
  const propias = (mesas ?? []).filter((m) => m && m.espacio_id === espacio.id);
  const activas = propias.filter(mesaActiva);
  const fusionadas = activas.filter(mesaEsFusionada);
  const reales = activas.filter((m) => !mesaEsFusionada(m));
  const capacidadDeclarada = plazasDeUnaMesa(espacio.capacidad_maxima);
  const plazasMesas = reales.reduce((s, m) => s + plazasDeUnaMesa(m.capacidad), 0);
  const plazasFusionadas = fusionadas.reduce((s, m) => s + plazasDeUnaMesa(m.capacidad), 0);
  const diferencia = plazasMesas - capacidadDeclarada;

  // "No hay mesas reales" manda sobre el resto: un espacio sin mesas reales no
  // está "por debajo" (no le faltan unas pocas plazas), es que no hay de dónde
  // sacar aforo. Se separa en dos estados porque el arreglo es distinto:
  //   · `sin_mesas`       → ni una fila: hay que dibujar el plano entero.
  //   · `solo_fusionadas` → hay filas, pero todas son uniones cuyas originales
  //                         se perdieron: hay que volver a dar de alta las
  //                         mesas y rehacer las uniones.
  // Los dos son los únicos casos que pueden dejar un negocio a 0 (`bloquearia`).
  const estado: EstadoCuadre =
    reales.length === 0
      ? activas.length === 0
        ? "sin_mesas"
        : "solo_fusionadas"
      : diferencia > 0
        ? "por_encima"
        : diferencia < 0
          ? "por_debajo"
          : "cuadra";

  return {
    espacioId: espacio.id,
    nombre: espacio.nombre,
    // Mismo criterio que el trigger: espacio sin etiqueta de marca = Casa Tomás.
    marca: marcaDeEspacio(espacio),
    // `espacios_reserva.activa` es `boolean DEFAULT true` pero NULLABLE, y aquí
    // se exige `=== true` (no `!== false`) a propósito: la base de datos trata un
    // espacio con `activa IS NULL` como apagado en los DOS sitios que deciden
    // sobre él — el `WHERE activa = true` del trigger `validar_capacidad_reserva`
    // y el `USING (activa = true)` de su política RLS. Si aquí contara como
    // activo, el resumen prometería plazas que el trigger no
    // concedería: exactamente el desajuste cliente/servidor que ya costó el bug
    // de `20260922190000_aforo_por_marca.sql`. Las MESAS sí usan `!== false`
    // (ver `mesaActiva`), porque ahí el SQL filtra con `activa is not false`.
    activa: espacio.activa === true,
    capacidadDeclarada,
    plazasMesas,
    plazasFusionadas,
    mesasActivas: activas.length,
    mesasReales: reales.length,
    mesasFusionadas: fusionadas.length,
    mesasInactivas: propias.length - activas.length,
    diferencia,
    estado,
    descuadra: estado !== "cuadra",
  };
}

/** Un cuadre por espacio, en el mismo orden en que llegan los espacios. */
export function calcularCuadres(
  espacios: readonly EspacioParaCuadre[],
  mesas: readonly MesaParaCuadre[],
): CuadreEspacio[] {
  return (espacios ?? []).filter(Boolean).map((e) => calcularCuadreEspacio(e, mesas));
}

/**
 * Agregado del restaurante: las salas ACTIVAS de Casa Tomás. `null` si no hay
 * ninguna. Las salas de otro negocio no entran (`admiteReservas`: Touza no
 * admite reservas desde el 2026-10-01).
 *
 * SOLO SUMA LOS ESPACIOS ACTIVOS, a propósito: el agregado tiene que medir
 * EXACTAMENTE lo que mide el trigger `validar_capacidad_reserva()`, que hace
 * la suma con `WHERE activa = true AND
 * COALESCE(caracteristicas->>'marca','casa_tomas') = v_marca`. Un espacio
 * apagado no aporta aforo hoy y tampoco lo aportaría con la regla encendida,
 * así que contarlo aquí inventaría un descuadre que no existe.
 *
 * Y suma PLAZAS REALES (`plazasMesas`, sin uniones), igual que
 * `fn_capacidad_efectiva_marca`. Desde que se excluyen las fusionadas
 * `bloquearia` salta MÁS a menudo —Terraza aporta 0 donde antes aportaba 12—
 * y eso es correcto: mide lo que pasaría de verdad al encender la regla.
 */
export function calcularCuadreTotal(cuadres: readonly CuadreEspacio[]): CuadreTotal | null {
  const items = (cuadres ?? []).filter((c) => c && c.activa === true && admiteReservas(c.marca));
  if (items.length === 0) return null;
  const capacidadDeclarada = items.reduce((s, c) => s + c.capacidadDeclarada, 0);
  const plazasMesas = items.reduce((s, c) => s + c.plazasMesas, 0);
  const plazasFusionadas = items.reduce((s, c) => s + c.plazasFusionadas, 0);
  return {
    capacidadDeclarada,
    plazasMesas,
    plazasFusionadas,
    diferencia: plazasMesas - capacidadDeclarada,
    // Cuenta los DOS estados sin mesas reales (plano vacío y solo uniones):
    // para el aforo son lo mismo, cero plazas. `espaciosSoloFusionadas`
    // separa los que además hay que redibujar.
    espaciosSinMesas: items.filter((c) => c.estado === "sin_mesas" || c.estado === "solo_fusionadas").length,
    espaciosSoloFusionadas: items.filter((c) => c.estado === "solo_fusionadas").length,
    espaciosDescuadrados: items.filter((c) => c.descuadra).length,
    // POR QUÉ SE MIDE EN EL TOTAL Y NO POR ESPACIO: el trigger suma por MARCA.
    // Un solo espacio a 0 mesas no bloquea nada mientras sus hermanos aporten
    // plazas (el aforo sigue > 0). Pero si TODAS las salas están a 0, con la
    // regla encendida el trigger calcularía capacidad total = 0 y rechazaría
    // (23514) CUALQUIER reserva: teléfono, web y panel se quedarían sin poder
    // reservar. `plazasMesas` son PLAZAS REALES: unas salas que solo tengan
    // uniones bloquearían igual que sin mesas, porque
    // `fn_capacidad_efectiva_marca` también las excluye.
    bloquearia: plazasMesas === 0 && capacidadDeclarada > 0,
  };
}

/** Frase corta para la insignia de la pantalla ("Sin mesas dadas de alta", "Sobran 14 plazas"...). */
export function textoEstadoCuadre(cuadre: CuadreEspacio): string {
  switch (cuadre.estado) {
    case "sin_mesas":
      return "Sin mesas dadas de alta";
    case "solo_fusionadas": {
      const n = cuadre.mesasFusionadas;
      return n === 1
        ? "Sin mesas reales: su única mesa es una unión"
        : `Sin mesas reales: sus ${n} mesas son uniones`;
    }
    case "por_debajo": {
      const n = -cuadre.diferencia;
      return n === 1 ? "Falta 1 plaza por dar de alta" : `Faltan ${n} plazas por dar de alta`;
    }
    case "por_encima": {
      const n = cuadre.diferencia;
      return n === 1
        ? "Sobra 1 plaza sobre la capacidad declarada"
        : `Sobran ${n} plazas sobre la capacidad declarada`;
    }
    default:
      return "Cuadra";
  }
}
