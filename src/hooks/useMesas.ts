import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Json } from "@/integrations/supabase/types";
// El "cero filas no es un fallo de permisos" ya está razonado y extraído en
// `guardadoPlano.ts` (commits 2c3f9ea y 1f1d06d): se reutiliza tal cual en vez
// de inventar otro vocabulario para lo mismo. Es un módulo de lógica pura —no
// importa React ni ningún componente, solo `planoUtils`, que no importa nada—,
// así que traerlo desde un hook no arrastra nada al bundle.
// PENDIENTE (fuera de este encargo): vive en `src/components/espacios/` por
// historia, no por diseño; su sitio natural es `src/lib/reservas/`.
import {
  clasificarFallo,
  type EstadoFilaMesa,
  type LecturaCeroFilas,
  type MotivoFallo,
} from "@/components/espacios/guardadoPlano";

export interface OriginalMesaData {
  id: string;
  nombre: string;
  capacidad: number;
  forma: "rectangular" | "circular";
  ancho: number;
  alto: number;
}

export interface Mesa {
  id: string;
  espacio_id: string;
  nombre: string;
  capacidad: number;
  forma: string;
  ancho: number;
  alto: number;
  pos_x: number;
  pos_y: number;
  rotacion: number;
  activa: boolean;
  is_merged: boolean;
  original_mesas: OriginalMesaData[] | null;
  etiqueta: string | null;
  created_at: string;
  updated_at: string;
  // Mesas por piezas (migración 20261008170000). Opcionales: antes de aplicarla no llegan.
  piezas?: number | null;
  picos_base?: number | null;
  picos_max?: number | null;
  piezas_max?: number | null;
  grupo_piezas?: string | null;
  crece_hacia?: string | null;
  // Sitios de la Terraza (migración 20261008200000): rango de plazas por servicio.
  plazas_min?: number | null;
  plazas_max?: number | null;
}

export interface MesaInput {
  espacio_id: string;
  nombre: string;
  capacidad?: number;
  forma?: string;
  ancho?: number;
  alto?: number;
  pos_x?: number;
  pos_y?: number;
  rotacion?: number;
  activa?: boolean;
  is_merged?: boolean;
  original_mesas?: Json | null;
  etiqueta?: string | null;
}

export interface OpcionesMesas {
  /**
   * Trae TAMBIÉN las mesas desactivadas (`activa = false`). Por defecto `false`:
   * el plano y el canvas solo quieren las mesas que están en uso.
   *
   * Lo necesita la gestión de mesas de Configuración (`GestionMesasEspacios`):
   * allí una mesa desactivada tiene que seguir viéndose para poder reactivarla
   * o borrarla — si no saliera, quedaría inaccesible desde la interfaz.
   */
  incluirInactivas?: boolean;
  /**
   * Permite montar el hook sin lanzar la consulta (mismas reglas de los hooks
   * de React: no se puede llamar condicionalmente). `EspacioForm` lo usa para
   * no pedir mesas cuando se está CREANDO un espacio que aún no existe.
   */
  habilitado?: boolean;
}

/**
 * Columnas de `mesas` (las de `Mesa`), en vez de `select("*")` (07/11/2026). Si se añade una columna
 * que haga falta en pantalla, va aquí y en `Mesa`.
 */
export const COLUMNAS_MESAS =
  "id, espacio_id, nombre, capacidad, forma, ancho, alto, pos_x, pos_y, rotacion, activa, is_merged, original_mesas, etiqueta, created_at, updated_at, piezas, picos_base, picos_max, piezas_max, grupo_piezas, crece_hacia, plazas_min, plazas_max";

/**
 * Mesas de un espacio (o de todos si no se pasa `espacioId`). Trae también
 * `is_merged` y `activa`, que hacen falta para el aforo.
 *
 * OJO con sumar `capacidad` para calcular aforo: HAY QUE EXCLUIR LAS FILAS
 * FUSIONADAS (`is_merged = true`). Sumarlas todas cuenta las mismas sillas dos
 * veces (en producción, 2026-09-27: el Salón decía 64 plazas cuando tiene 36;
 * la Terraza decía 12 sin tener ni una mesa real). La cuenta buena vive en
 * `src/lib/reservas/aforoMesas.ts` — no la repitas a mano.
 *
 * DE DÓNDE SALIERON ESAS FILAS: al fusionar, el editor de plano borraba las
 * originales sin leer el `{ error }` del DELETE, y supabase-js RESUELVE en vez
 * de rechazar cuando RLS o una clave ajena lo impiden — el borrado fallaba en
 * silencio y dejaba vivas la unión Y sus originales. Arreglado en 2c3f9ea:
 * fusionar y desagrupar ya no borran, DESACTIVAN (`activa = false`), y toda
 * escritura se verifica. Las filas duplicadas de producción siguen ahí, así
 * que el aviso de arriba sigue vigente.
 */
export function useMesas(espacioId?: string, opciones?: OpcionesMesas) {
  const incluirInactivas = opciones?.incluirInactivas === true;
  const habilitado = opciones?.habilitado !== false;

  return useQuery({
    // La clave lleva `incluirInactivas` para que las dos variantes no se pisen
    // en la caché (si compartieran clave, la pantalla de gestión podría acabar
    // leyendo el resultado filtrado del plano, o al revés). Todas empiezan por
    // "mesas", así que un `invalidateQueries({ queryKey: ["mesas"] })` sigue
    // invalidando ambas por prefijo.
    queryKey: incluirInactivas
      ? ["mesas", espacioId ?? "todos", "con-inactivas"]
      : espacioId
        ? ["mesas", espacioId]
        : ["mesas"],
    enabled: habilitado,
    queryFn: async () => {
      let query = supabase
        .from("mesas")
        .select(COLUMNAS_MESAS)
        .order("nombre");

      if (!incluirInactivas) {
        query = query.eq("activa", true);
      }

      if (espacioId) {
        query = query.eq("espacio_id", espacioId);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Convertir original_mesas de Json a OriginalMesaData[]
      return (data || []).map(mesa => ({
        ...mesa,
        original_mesas: mesa.original_mesas as unknown as OriginalMesaData[] | null,
      })) as Mesa[];
    },
    // Las mesas cambian poco (07/11/2026, «Hoy» con poca cobertura): antes `staleTime: 0` y cada
    // montaje (cambiar Kanban ↔ Plano, abrir un diálogo) las volvía a pedir. Lo que se guarda en ESTE
    // dispositivo invalida `["mesas"]` y se relee al momento. La gestión de mesas de Configuración
    // (`incluirInactivas`) sigue leyendo siempre de nuevo.
    staleTime: incluirInactivas ? 0 : 2 * 60_000,
  });
}

/**
 * NOMBRE DE MESA REPETIDO: traduce el choque del índice único a algo legible.
 *
 * El número de mesa vive en `mesas.nombre` (un `text`; no hay columna `numero` y
 * no se va a crear). El índice único parcial `uq_mesas_espacio_nombre_real`
 * —sobre `(espacio_id, lower(regexp_replace(btrim(nombre), '\s+', ' ', 'g')))`
 * con `where coalesce(is_merged, false) = false and coalesce(activa, true) =
 * true`— es la ÚNICA garantía real de que no se repita: la validación de
 * cliente se queda obsoleta en cuanto hay dos pestañas abiertas o dos usuarios
 * a la vez, y en producción ya hay DOS mesas "9" en el Salón por no tenerlo.
 *
 * Postgres devuelve `23505` (unique_violation) con el nombre del índice en el
 * mensaje. Sin esto, el usuario veía un "Error al crear/actualizar mesa" opaco y
 * no tenía forma de saber que el problema era el número repetido. Lo usan los DOS
 * caminos que escriben el nombre: `useCrearMesa` (el alta del editor de plano) y
 * `useActualizarMesa` (el renombrado de la tarjeta de Configuración).
 */
const esNumeroDeMesaRepetido = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown; details?: unknown };
  const texto = [e.message, e.details].filter((t) => typeof t === "string").join(" ");
  // El nombre del índice es la señal inequívoca; el código 23505 sobre `mesas`
  // solo puede venir de este índice o de la clave primaria (un choque de UUID,
  // que no pasa), así que vale como red de seguridad si el mensaje no lo trae.
  return /uq_mesas_espacio_nombre_real/i.test(texto) || e.code === "23505";
};

export function useCrearMesa() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (mesa: MesaInput) => {
      const { data, error } = await supabase
        .from("mesas")
        .insert(mesa)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["mesas"] });
    },
    onError: (error) => {
      // El alta es por donde entra el choque en la práctica: el editor de plano
      // crea mesas desde tres sitios (panel lateral, dibujando en el lienzo y el
      // alta en rango de hasta 40 de golpe, que inserta una a una y para en el
      // primer fallo). El texto está redactado para que también se entienda leído
      // en medio de un lote: dice que ESA mesa no se creó, sin dar por hecho que
      // fuera la única.
      toast.error(
        esNumeroDeMesaRepetido(error)
          ? "Ya hay una mesa con ese número en este espacio: esa mesa no se ha creado. Usa otro número."
          : "Error al crear mesa",
      );
      console.error(error);
    },
  });
}

export function useActualizarMesa() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Mesa> & { id: string }) => {
      // Convertir original_mesas a Json para Supabase
      const dbUpdates = {
        ...updates,
        original_mesas: updates.original_mesas as unknown as Json | null,
      };
      const { data, error } = await supabase
        .from("mesas")
        .update(dbUpdates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mesas"] });
    },
    onError: (error) => {
      toast.error(
        esNumeroDeMesaRepetido(error)
          ? "Ya hay una mesa con ese número en este espacio. Usa otro número."
          : "Error al actualizar mesa",
      );
      console.error(error);
    },
  });
}

export function useActualizarMesasSilent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (mesas: Array<Partial<Mesa> & { id: string }>) => {
      const updates = mesas.map(({ id, ...data }) => {
        // Convertir original_mesas a Json para Supabase
        const dbData = {
          ...data,
          original_mesas: data.original_mesas as unknown as Json | null,
        };
        return supabase.from("mesas").update(dbData).eq("id", id);
      });
      const results = await Promise.all(updates);
      // Promise.all no rechaza si Supabase devuelve { error } dentro de una respuesta
      // resuelta con éxito (no lanza) — sin este check, un fallo de update pasaba
      // desapercibido y el llamador creía que la posición/fusión se había guardado.
      const failed = results.find((r) => r.error);
      if (failed?.error) throw failed.error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mesas"] });
    },
  });
}

// ─── Borrado de una mesa: qué significa "cero filas" ─────────────────────────

/**
 * Lo que devuelve el borrado verificado. No es decorativo: hasta hoy el hook
 * decía "Mesa eliminada correctamente" sin comprobar NADA, y desde la
 * migración `20260928120000_mesas_asignaciones_rls_por_seccion.sql` (aplicada
 * en producción) escribir en `mesas` exige `can_write_section('reservas')` —
 * así que ese mensaje pasó de inexacto a directamente falso para quien no
 * tenga la sección.
 */
export type ResultadoEliminarMesa =
  /** El DELETE devolvió la fila: se borró de verdad. */
  | "eliminada"
  /** Cero filas Y la fila ya no está: otra sesión se adelantó. No es un fallo. */
  | "ya-no-estaba";

/**
 * "CERO FILAS" TAMPOCO ES "SIN PERMISOS" EN UN BORRADO.
 *
 * Mismo criterio que `interpretarCeroFilas` (`guardadoPlano.ts`), que es donde
 * está razonado a fondo: un `delete … .eq('id', X).select('id')` que devuelve
 * `[]` NO trae error —supabase-js resuelve, no rechaza— y puede significar
 * tres cosas. Para un borrado solo importa si la fila sigue estando:
 *
 *                           borrar
 *   la fila no está         ya cumplido (otra sesión la borró antes)
 *   existe, activa=false    DENEGADA (desactivada no es borrada)
 *   existe, activa=true     DENEGADA de verdad
 *   no se puede leer        pesimista: denegada
 *
 * No se llama a `interpretarCeroFilas` directamente porque su unión de
 * operaciones es `"desactivar" | "reactivar"` y no tiene caso `"borrar"`. La
 * tabla de arriba coincide con la de `"reactivar"`, pero pasar ese literal
 * desde un DELETE se leería como un error. Cuando `guardadoPlano.ts` no esté
 * ocupado, lo limpio es añadir ahí `"borrar"` y retirar esta función.
 *
 * MISMO LÍMITE CONOCIDO que allí: si una política ocultara la fila también al
 * SELECT, "borrada" e "invisible" son indistinguibles desde el cliente y esto
 * lo leería como cumplido. Hoy no pasa —`useMesas` acaba de leer esa misma
 * fila para pintar el plano— y la RLS de `mesas` usa `can_read_section` para
 * el SELECT y `can_write_section` para el DELETE, que hoy miran lo mismo.
 */
function interpretarCeroFilasBorrado(fila: EstadoFilaMesa | null): LecturaCeroFilas {
  if (fila === null) return "sin-confirmar";
  return fila.existe ? "denegada" : "fila-ausente";
}

/**
 * Desempata el "cero filas" leyendo la fila. Copia deliberada de
 * `leerEstadoFilaMesa` en `EditorPlanoEspacio.tsx` (mismo nombre a propósito):
 * está dentro del componente y no se puede importar.
 * `null` = ni siquiera se pudo leer, así que toca ser pesimista.
 */
async function leerEstadoFilaMesa(mesaId: string): Promise<EstadoFilaMesa | null> {
  const { data, error } = await supabase
    .from("mesas")
    .select("id, activa")
    .eq("id", mesaId)
    .maybeSingle();
  if (error) return null;
  if (!data) return { existe: false };
  // `coalesce(activa, true)`: la columna es nullable y null cuenta como activa
  // (es lo que hacen el índice único parcial y las funciones de aforo).
  return { existe: true, activa: data.activa !== false };
}

/**
 * Fallo del borrado, con el motivo ya clasificado. Se lanza (no se devuelve)
 * a propósito: los tres llamantes —`PanelLateral.handleDeleteMesa`,
 * `EditorPlanoEspacio.handleDeleteSelected` y
 * `PlanoEspacio2D.confirmarBorrarMesa`— hacen `await mutateAsync(id)` y, si no
 * salta, quitan la mesa del lienzo. Si un borrado denegado resolviera, la mesa
 * desaparecería de la pantalla y seguiría viva en la BBDD.
 */
export class ErrorEliminarMesa extends Error {
  readonly fallo: MotivoFallo;

  constructor(fallo: MotivoFallo) {
    super(motivoLegibleEliminarMesa(fallo));
    this.name = "ErrorEliminarMesa";
    this.fallo = fallo;
  }
}

/** Mismo vocabulario que `motivoLegible` en `guardadoPlano.ts`. */
function motivoLegibleEliminarMesa(fallo: MotivoFallo): string {
  if (fallo.clase === "permisos") return "permisos";
  if (fallo.clase === "desaparecida") return "ya no existe";
  return fallo.mensaje;
}

export function useEliminarMesa() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<ResultadoEliminarMesa> => {
      // COMPROBAR `{ error }` NO BASTA. Un DELETE denegado por RLS se resuelve
      // con `{ data: [], error: null }`: sin excepción, sin error y sin filas.
      // La única forma de enterarse es pedir `.select('id')` y mirar si vuelve
      // la fila que se quería borrar. Ese agujero es el que dejó la BBDD de
      // producción rota el 2026-09-27 por el lado del editor de plano.
      const { data, error } = await supabase
        .from("mesas")
        .delete()
        .eq("id", id)
        .select("id");
      if (error) throw new ErrorEliminarMesa(clasificarFallo(error));
      if ((data?.length ?? 0) > 0) return "eliminada";

      const lectura = interpretarCeroFilasBorrado(await leerEstadoFilaMesa(id));
      if (lectura === "fila-ausente") return "ya-no-estaba";
      // `denegada` y `sin-confirmar` se juntan en "permisos", igual que en el
      // guardado del plano: ante la duda, pesimista. Nada que no se pueda
      // confirmar se da por bueno.
      throw new ErrorEliminarMesa({ clase: "permisos" });
    },
    onSuccess: (resultado) => {
      queryClient.invalidateQueries({ queryKey: ["mesas"] });
      if (resultado === "eliminada") {
        toast.success("Mesa eliminada correctamente");
        return;
      }
      // La mesa ya no estaba: el objetivo se cumple igual y los llamantes
      // hacen bien en quitarla del lienzo, pero decir "eliminada correctamente"
      // sería atribuirse un borrado ajeno.
      toast.warning(
        "Esa mesa ya no existía: otra sesión la había borrado antes. " +
          "Se ha quitado del plano igualmente.",
      );
    },
    onError: (error) => {
      const fallo = error instanceof ErrorEliminarMesa ? error.fallo : clasificarFallo(error);
      toast.error(
        `No se ha podido eliminar la mesa (${motivoLegibleEliminarMesa(fallo)}). ` +
          "Sigue ahí: recarga la página antes de volver a intentarlo.",
      );
      console.error(error);
    },
  });
}
