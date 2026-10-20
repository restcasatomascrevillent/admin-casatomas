/**
 * Posición inicial de una mesa que se da de alta desde la vista de reservas
 * (`PlanoEspacio2D`, botón «Mesa»).
 *
 * POR QUÉ EXISTE
 * ----------------------------------------------------------------------------
 * `mesas.pos_x/pos_y` van en METROS (esquina superior izquierda de la caja sin
 * rotar). Esta pantalla daba de alta las mesas con `pos_x: 50, pos_y: 50`, que
 * parecen píxeles de escena (1 m = 50 px) pero se leen como 50 m: la mesa nacía
 * 50 m a la derecha y abajo, fuera de cualquier sala, y el editor de plano no
 * la mostraba. Así acabaron en el Salón las mesas "9" y "11" (ver la migración
 * 20261003100000_salon_mesas_en_metros).
 *
 * Aquí se pide el primer hueco libre del plano EN METROS, esquivando las demás
 * mesas y las paredes, igual que hace el alta del editor (`PanelLateral`).
 */
import {
  calcularRejillaMesas,
  paredesDesdeElementos,
  PIXELS_PER_METER,
  rectanguloDeMesa,
  type RectanguloOcupado,
} from "@/components/espacios/planoUtils";

/** Si no hay hueco limpio, la mesa nace aquí (dentro de cualquier plano) y se avisa. */
export const POSICION_RESPALDO_M = { x: 1, y: 1 } as const;

export interface EntradaPosicionMesaNueva {
  anchoCm: number;
  altoCm: number;
  forma: string;
  /** Tamaño del plano en metros. */
  espacio: { width: number; height: number };
  /** Mesas ya colocadas (`pos_x/pos_y` en metros, `ancho/alto` en cm). */
  mesas: readonly {
    pos_x?: number | null;
    pos_y?: number | null;
    ancho?: number | null;
    alto?: number | null;
    activa?: boolean | null;
    is_merged?: boolean | null;
  }[];
  /** `planos_espacio.configuracion.elementos` (paredes en px de escena). */
  elementos?: readonly { tipo?: string; props?: Record<string, any> }[] | null;
  pixelsPerMeter?: number;
}

export interface PosicionMesaNueva {
  /** Esquina superior izquierda, en METROS. */
  pos_x: number;
  pos_y: number;
  /** `true` si no había hueco libre y se ha usado la posición de respaldo. */
  sinHueco: boolean;
}

export function posicionInicialMesaNueva(entrada: EntradaPosicionMesaNueva): PosicionMesaNueva {
  const altoCm = entrada.forma === "circular" ? entrada.anchoCm : entrada.altoCm;
  // Las mesas inactivas o fusionadas no estorban: no se dibujan en el plano.
  const ocupadas: RectanguloOcupado[] = entrada.mesas
    .filter((m) => m.activa !== false && !m.is_merged)
    .map((m) =>
      rectanguloDeMesa({
        posX: m.pos_x ?? 0,
        posY: m.pos_y ?? 0,
        ancho: m.ancho ?? 80,
        alto: m.alto ?? 80,
      }),
    );

  const hueco = calcularRejillaMesas({
    cantidad: 1,
    anchoCm: entrada.anchoCm,
    altoCm,
    espacio: entrada.espacio,
    ocupadas,
    paredes: paredesDesdeElementos(entrada.elementos, entrada.pixelsPerMeter ?? PIXELS_PER_METER),
    omitirSinSitio: true,
  }).posiciones[0];

  return hueco
    ? { pos_x: hueco.x, pos_y: hueco.y, sinHueco: false }
    : { pos_x: POSICION_RESPALDO_M.x, pos_y: POSICION_RESPALDO_M.y, sinHueco: true };
}
