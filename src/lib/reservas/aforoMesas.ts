// ============================================================================
// CUADRE DE AFORO: CAPACIDAD DECLARADA vs SUMA DE MESAS — lógica pura (sin I/O)
// ----------------------------------------------------------------------------
// Un espacio de reserva tiene DOS cifras de aforo que deberían decir lo mismo
// y en producción no lo dicen:
//   · CAPACIDAD DECLARADA: `espacios_reserva.capacidad_maxima`, un número que
//     se escribe a mano en la pantalla de Espacios.
//   · SUMA DE MESAS: `sum(mesas.capacidad)` de las mesas ACTIVAS del espacio,
//     las que el dueño coloca en el editor de plano.
//
// CUÁL MANDA HOY: la capacidad declarada, y solo ella. El trigger de aforo
// `validar_capacidad_reserva()` (migración 20260922190000_aforo_por_marca.sql)
// suma `capacidad_maxima` y con eso decide si acepta o rechaza el INSERT. Las
// mesas hoy son dibujo: no entran en ninguna validación. La regla alternativa
// ("que mande la suma de las mesas") está escrita en la migración
// `supabase/migrations/20260926120000_capacidad_efectiva_mesas.sql`, pero está
// DORMIDA y SIN APLICAR — encenderla cambiaría de golpe el aforo real de los
// dos negocios (ver `bloquearia` más abajo).
//
// ESTO ES SOLO INFORMACIÓN. La pantalla de Configuración de /reservas enseña
// el descuadre para que el dueño lo vea y lo arregle cuando quiera; NO bloquea
// guardar, no cambia lo que acepta la base de datos y no corrige nada solo.
//
// DATO NO OBVIO (por qué sumar todas las mesas activas es correcto): cuando el
// editor de plano fusiona mesas, BORRA las filas originales y crea UNA sola
// fila con `is_merged = true` y la capacidad combinada — las originales quedan
// guardadas solo como JSON descriptivo en `original_mesas`, no como filas
// (`src/components/espacios/EditorPlanoEspacio.tsx`, sobre la línea 183:
// borra por id cada mesa original tras fusionarla). Por eso sumar TODAS las
// mesas activas no duplica plazas y NO hay que excluir las `is_merged`;
// excluirlas sería perder justo las mesas grandes de grupo.
//
// AGREGADO POR NEGOCIO: replica exactamente el filtro del trigger
// (activa = true + marca del espacio), porque el aforo se valida POR MARCA y
// no por espacio. Ver `calcularCuadrePorNegocio`.
// ============================================================================

import { agruparPorNegocio, marcaDeEspacio, normalizarMarca } from "./negocios";

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
}

export type EstadoCuadre = "cuadra" | "sin_mesas" | "por_debajo" | "por_encima";

export interface CuadreEspacio {
  espacioId: string;
  nombre: string;
  marca: string;
  activa: boolean;
  capacidadDeclarada: number;
  plazasMesas: number;
  mesasActivas: number;
  mesasInactivas: number;
  /** plazasMesas - capacidadDeclarada */
  diferencia: number;
  estado: EstadoCuadre;
  /** estado !== "cuadra" */
  descuadra: boolean;
}

export interface CuadreNegocio {
  marca: string;
  capacidadDeclarada: number;
  plazasMesas: number;
  diferencia: number;
  espaciosSinMesas: number;
  espaciosDescuadrados: number;
  /** true si al encender la regla ese negocio se quedaría a 0 y no podría reservar nada */
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
 * ¿Cuenta la mesa? `mesas.activa` es `boolean DEFAULT true` y puede llegar
 * `null` (o no venir en el select), así que solo un `false` explícito la
 * descarta.
 */
const mesaCuenta = (mesa: MesaParaCuadre): boolean => mesa.activa !== false;

/** Suma de plazas de las mesas ACTIVAS de un espacio. */
export function plazasDeMesas(mesas: readonly MesaParaCuadre[], espacioId: string): number {
  return (mesas ?? [])
    .filter((m) => m && m.espacio_id === espacioId && mesaCuenta(m))
    .reduce((s, m) => s + plazasDeUnaMesa(m.capacidad), 0);
}

export function calcularCuadreEspacio(espacio: EspacioParaCuadre, mesas: readonly MesaParaCuadre[]): CuadreEspacio {
  const propias = (mesas ?? []).filter((m) => m && m.espacio_id === espacio.id);
  const activas = propias.filter(mesaCuenta);
  const capacidadDeclarada = plazasDeUnaMesa(espacio.capacidad_maxima);
  const plazasMesas = activas.reduce((s, m) => s + plazasDeUnaMesa(m.capacidad), 0);
  const diferencia = plazasMesas - capacidadDeclarada;

  // "Sin mesas" manda sobre el resto: un espacio sin mesas activas no está
  // "por debajo" (no le faltan unas pocas plazas), es que el plano está vacío.
  // Es el único caso que se arregla con el editor de plano y el único que
  // puede dejar un negocio entero a 0 (ver `bloquearia`).
  const estado: EstadoCuadre =
    activas.length === 0 ? "sin_mesas" : diferencia > 0 ? "por_encima" : diferencia < 0 ? "por_debajo" : "cuadra";

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
    // activo, el resumen por negocio prometería plazas que el trigger no
    // concedería: exactamente el desajuste cliente/servidor que ya costó el bug
    // de `20260922190000_aforo_por_marca.sql`. Las MESAS sí usan `!== false`
    // (ver `mesaCuenta`), porque ahí nadie filtra con `= true`.
    activa: espacio.activa === true,
    capacidadDeclarada,
    plazasMesas,
    mesasActivas: activas.length,
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
 * Agregado por negocio, en el orden de `NEGOCIOS_PANEL` (Casa Tomás, Touza y
 * las marcas desconocidas al final, por orden alfabético).
 *
 * SOLO SUMA LOS ESPACIOS ACTIVOS, a propósito: el agregado tiene que medir
 * EXACTAMENTE lo que mide el trigger `validar_capacidad_reserva()`, que hace
 * la suma con `WHERE activa = true AND
 * COALESCE(caracteristicas->>'marca','casa_tomas') = v_marca`. Un espacio
 * apagado no aporta aforo hoy y tampoco lo aportaría con la regla encendida,
 * así que contarlo aquí inventaría un descuadre que no existe.
 */
export function calcularCuadrePorNegocio(cuadres: readonly CuadreEspacio[]): CuadreNegocio[] {
  const activos = (cuadres ?? []).filter((c) => c && c.activa === true);
  return agruparPorNegocio(activos, (c) => normalizarMarca(c.marca)).map(({ negocio, items }) => {
    const capacidadDeclarada = items.reduce((s, c) => s + c.capacidadDeclarada, 0);
    const plazasMesas = items.reduce((s, c) => s + c.plazasMesas, 0);
    return {
      marca: negocio.marca,
      capacidadDeclarada,
      plazasMesas,
      diferencia: plazasMesas - capacidadDeclarada,
      espaciosSinMesas: items.filter((c) => c.estado === "sin_mesas").length,
      espaciosDescuadrados: items.filter((c) => c.descuadra).length,
      // POR QUÉ SE MIDE POR NEGOCIO Y NO POR ESPACIO: el trigger suma por
      // MARCA. Un solo espacio a 0 mesas no bloquea nada mientras sus hermanos
      // de la misma marca aporten plazas (el aforo del negocio sigue > 0). Pero
      // si TODA la marca está a 0, con la regla encendida el trigger calcularía
      // capacidad total = 0 y rechazaría (23514) CUALQUIER reserva de ese
      // negocio: teléfono, web y panel se quedarían sin poder reservar.
      bloquearia: plazasMesas === 0 && capacidadDeclarada > 0,
    };
  });
}

/** Frase corta para la insignia de la pantalla ("Sin mesas dadas de alta", "Sobran 14 plazas"...). */
export function textoEstadoCuadre(cuadre: CuadreEspacio): string {
  switch (cuadre.estado) {
    case "sin_mesas":
      return "Sin mesas dadas de alta";
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
