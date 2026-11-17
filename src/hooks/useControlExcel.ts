/**
 * Super Admin › Gestor Gasto › «Control (Excel)»: el estado del cliente de este
 * panel en el Excel de control de OficiosOsIA (Google Drive) y sus cambios.
 * Todo pasa por la Edge Function `control-excel`
 * (supabase/functions/control-excel/control.ts, que es quien manda en el
 * contrato): el navegador nunca habla con Drive ni ve credenciales.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ErrorNegocio } from "@/lib/mensaje-usuario";

export interface FichaCliente {
  estado: string;
  /** «AAAA-MM-DD». */
  desde: string | null;
  instalacionPactada: number | null;
  cuotaPactada: number | null;
  diaCobro: number | null;
  notas: string;
}

export interface Cobro {
  /** Fila del Excel: identifica el movimiento. */
  fila: number;
  fechaPrevista: string | null;
  fechaCobro: string | null;
  tipo: string;
  detalle: string;
  pactado: number | null;
  cobrado: number | null;
  pendiente: number;
  /** «Pendiente», «Parcial», «Cobrado» o «Revisar importe». */
  estado: string;
  recibidoPor: string;
  metodo: string;
  notas: string;
  /** Aviso del Excel («Falta fecha cobro»…) o «». */
  comprobar: string;
}

export interface Gasto {
  fila: number;
  fecha: string | null;
  proveedor: string;
  tipo: string;
  detalle: string;
  importe: number | null;
  pagadoPor: string;
  /** «Sí», «No» o «» (sin decidir). */
  repercutir: string;
  metodo: string;
  notas: string;
  comprobar: string;
}

export interface ResumenCliente {
  cobradoTotal: number;
  instalacionCobrada: number;
  instalacionPendiente: number;
  cuotasCobradas: number;
  reembolsosCobrados: number;
  otrosCobrados: number;
  pendienteCobro: number;
  cobrosPendientes: number;
  gastosRepercutibles: number;
  costesPorRecuperar: number;
  gastosTotal: number;
  avisos: number;
}

export interface ListasControl {
  estados: string[];
  tiposCobro: string[];
  receptores: string[];
  metodos: string[];
  tiposGasto: string[];
  pagadores: string[];
  metodosGasto: string[];
  repercutir: string[];
}

export interface EstadoControl {
  ok: true;
  disponible: true;
  cliente: string;
  archivo: { id: string; nombre: string; modificado: string | null; url: string };
  /** Se devuelve al guardar: si el Excel cambió entretanto, la función responde 409. */
  revision: string;
  soloLectura: boolean;
  cuentaGoogle?: string | null;
  ficha: FichaCliente;
  cobros: Cobro[];
  gastos: Gasto[];
  resumen: ResumenCliente;
  listas: ListasControl;
  filasLibres: { cobros: number; gastos: number };
}

export type MotivoNoDisponible = "sin_config" | "sin_acceso" | "solo_lectura" | "sin_cliente" | "formato";

export interface ControlNoDisponible {
  ok: true;
  disponible: false;
  motivo: MotivoNoDisponible;
  mensaje: string;
  cliente: string;
  cuentaGoogle?: string | null;
}

export type ResultadoControl = EstadoControl | ControlNoDisponible;

export type CobroEntrada = Omit<Cobro, "fila" | "pendiente" | "estado" | "comprobar"> & { fila?: number };
export type GastoEntrada = Omit<Gasto, "fila" | "comprobar"> & { fila?: number };

/** Un cambio en el Excel (la revisión la pone el hook). */
export type CambioControl =
  | { accion: "guardar_ficha"; ficha: FichaCliente }
  | { accion: "guardar_cobro"; cobro: CobroEntrada }
  | { accion: "borrar_cobro"; fila: number }
  | { accion: "guardar_gasto"; gasto: GastoEntrada }
  | { accion: "borrar_gasto"; fila: number };

/** Error de la función, con su texto ya pensado para la persona. */
export class ErrorControlExcel extends ErrorNegocio {
  readonly codigo: string;
  readonly estado: number;
  constructor(mensaje: string, codigo: string, estado: number) {
    super(mensaje);
    this.name = "ErrorControlExcel";
    this.codigo = codigo;
    this.estado = estado;
  }
  /** El Excel cambió (o esa fila ya no es la que era): hay que recargar. */
  get hayQueRecargar(): boolean {
    return this.codigo === "conflicto" || this.codigo === "fila_ajena";
  }
}

export const CLAVE_CONTROL_EXCEL = ["super-admin", "control-excel"] as const;

async function errorDeFuncion(error: unknown): Promise<ErrorControlExcel> {
  const e = error as { name?: string; context?: { status?: number; json?: () => Promise<{ error?: string; mensaje?: string }> } };
  if (e?.name === "FunctionsFetchError" || e?.name === "FunctionsRelayError") {
    return new ErrorControlExcel("No se pudo contactar con la función «control-excel» (¿está desplegada en este proyecto?).", "sin_funcion", 0);
  }
  const estado = e?.context?.status ?? 0;
  const cuerpo = await e?.context?.json?.().catch(() => null);
  if (cuerpo && typeof cuerpo.mensaje === "string" && cuerpo.mensaje) return new ErrorControlExcel(cuerpo.mensaje, cuerpo.error ?? "error", estado);
  if (estado === 401) return new ErrorControlExcel("Tu sesión ha caducado: vuelve a entrar.", "sin_sesion", estado);
  if (estado === 403) return new ErrorControlExcel("Solo un super admin puede ver el control del Excel.", "sin_permiso", estado);
  if (estado === 404) return new ErrorControlExcel("La función «control-excel» no está desplegada en este proyecto.", "sin_funcion", estado);
  return new ErrorControlExcel("No se pudo completar la operación sobre el Excel. Inténtalo de nuevo.", "error", estado);
}

/** Llama a la función. Lanza `ErrorControlExcel` si no responde con un estado. */
export async function pedirControlExcel(cuerpo: Record<string, unknown>): Promise<ResultadoControl> {
  const { data, error } = await supabase.functions.invoke<ResultadoControl>("control-excel", { body: cuerpo });
  if (error) throw await errorDeFuncion(error);
  if (!data || data.ok !== true || typeof data.disponible !== "boolean") {
    throw new ErrorControlExcel("La función «control-excel» ha devuelto una respuesta inesperada.", "error", 0);
  }
  return data;
}

export function useControlExcel(habilitado = true) {
  return useQuery({
    queryKey: CLAVE_CONTROL_EXCEL,
    queryFn: () => pedirControlExcel({ accion: "leer" }),
    enabled: habilitado,
    staleTime: 60_000,
    // Cada lectura baja el Excel de Drive: se recarga con el botón, no al volver a la ventana.
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/** Guarda un cambio con la revisión de lo que hay en pantalla y deja en caché el estado que devuelve. */
export function useCambiarControlExcel() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: async (cambio: CambioControl) => {
      const actual = cliente.getQueryData<ResultadoControl>(CLAVE_CONTROL_EXCEL);
      if (!actual?.disponible) throw new ErrorControlExcel("Recarga el Excel antes de guardar.", "conflicto", 409);
      return pedirControlExcel({ ...cambio, revision: actual.revision });
    },
    onSuccess: (resultado) => cliente.setQueryData(CLAVE_CONTROL_EXCEL, resultado),
  });
}
