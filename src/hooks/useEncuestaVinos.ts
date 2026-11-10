import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { mensajeUsuario } from "@/lib/mensaje-usuario";
import { QUERY_KEY_CONFIGURACION_WEB, useConfiguracionWeb } from "@/hooks/useConfiguracionWeb";

// ----------------------------------------------------------------------------
// «Vota tu vino favorito y entra en el sorteo» (04/11/2026, petición del dueño).
// El interruptor es configuracion_web.encuesta_vinos_activa (lo cambia quien
// escribe en «Gestor carta», con la RLS de siempre de la tabla) y los votos van
// en votos_vino_favorito (migración 20261104141000). La web lee el interruptor
// cada vez que se abre la carta de vinos: no hace falta republicarla.
// 20/11/2026: el premio (encuesta_vinos_premio) y el último día para votar
// (encuesta_vinos_fin, incluido, hora de Madrid) salen de aquí y los muestran las
// bases legales de la web; sin ellos la base de datos no deja abrir la votación
// (migración 20261120100000).
// ----------------------------------------------------------------------------

export type VotoVino = Pick<Tables<"votos_vino_favorito">, "id" | "vino_id" | "vino_nombre" | "nombre" | "contacto" | "idioma" | "created_at">;

export const QUERY_KEY_VOTOS_VINO = ["votosVinoFavorito"] as const;

export const TEXTO_PARA_ABRIR = "Para abrir la votación, pon el premio y el último día para votar. Las bases legales de la web los muestran.";

export const PREMIO_MIN = 3;
export const PREMIO_MAX = 200;

/** Fecha de hoy en España (AAAA-MM-DD): el último día para votar se cuenta en hora de Madrid. */
export function hoyEnMadrid(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(ahora);
}

/** «2026-12-31» → «31/12/2026». */
export function fechaCorta(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Mensaje de error si el premio o el último día no valen para guardarse; null si valen. */
export function validarPremioFecha(premio: string, fin: string, hoy: string = hoyEnMadrid()): string | null {
  const texto = premio.trim();
  if (texto.length < PREMIO_MIN) return `Escribe el premio (al menos ${PREMIO_MIN} letras).`;
  if (texto.length > PREMIO_MAX) return `El premio no puede pasar de ${PREMIO_MAX} caracteres.`;
  if (!FECHA_ISO.test(fin) || Number.isNaN(Date.parse(`${fin}T00:00:00Z`))) return "Elige el último día para votar.";
  if (fin < hoy) return "El último día para votar no puede ser anterior a hoy.";
  return null;
}

export interface RecuentoVino {
  vino: string;
  votos: number;
}

/** Votos por vino, de más a menos (empate: por nombre). */
export function recuentoPorVino(votos: readonly Pick<VotoVino, "vino_nombre">[]): RecuentoVino[] {
  const cuenta = new Map<string, number>();
  for (const v of votos) cuenta.set(v.vino_nombre, (cuenta.get(v.vino_nombre) ?? 0) + 1);
  return [...cuenta]
    .map(([vino, n]) => ({ vino, votos: n }))
    .sort((a, b) => b.votos - a.votos || a.vino.localeCompare(b.vino, "es"));
}

/** Ganador del sorteo entre todos los participantes, al azar (crypto si existe). */
export function sortearGanador<T>(participantes: readonly T[], azar: () => number = aleatorio): T | null {
  if (participantes.length === 0) return null;
  return participantes[Math.min(participantes.length - 1, Math.floor(azar() * participantes.length))];
}

function aleatorio(): number {
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] / 2 ** 32;
  }
  return Math.random();
}

/** CSV para descargar la lista de participantes (separador «;», como espera Excel en español). */
export function participantesCsv(votos: readonly VotoVino[]): string {
  const celda = (t: string) => `"${t.replace(/"/g, '""')}"`;
  const filas = votos.map((v) =>
    [new Date(v.created_at).toLocaleString("es-ES", { timeZone: "Europe/Madrid" }), v.nombre, v.contacto, v.vino_nombre, v.idioma]
      .map((t) => celda(String(t)))
      .join(";"),
  );
  return ["Fecha;Nombre;Contacto;Vino;Idioma", ...filas].join("\n");
}

export function useEncuestaVinos({ cargarVotos }: { cargarVotos: boolean }) {
  const queryClient = useQueryClient();
  const { config, isLoading: cargandoConfig, isError: errorConfig } = useConfiguracionWeb();

  const disponible = typeof config?.encuesta_vinos_activa === "boolean";
  const activa = config?.encuesta_vinos_activa === true;
  const premio = config?.encuesta_vinos_premio?.trim() ?? "";
  const fin = config?.encuesta_vinos_fin ?? null;
  // Se puede abrir con premio y con un último día que no haya pasado (hora de Madrid).
  const puedeAbrir = premio.length >= PREMIO_MIN && fin !== null && fin >= hoyEnMadrid();

  const votos = useQuery({
    queryKey: QUERY_KEY_VOTOS_VINO,
    enabled: cargarVotos && disponible,
    queryFn: async (): Promise<VotoVino[]> => {
      const { data, error } = await supabase
        .from("votos_vino_favorito")
        .select("id, vino_id, vino_nombre, nombre, contacto, idioma, created_at")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const cambiarActiva = useMutation({
    mutationFn: async (valor: boolean) => {
      if (valor && !puedeAbrir) throw new Error(TEXTO_PARA_ABRIR);
      const { data, error } = await supabase
        .from("configuracion_web")
        .update({ encuesta_vinos_activa: valor })
        .eq("id", true)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      // Sin fila devuelta = la RLS no dejó (sin «Gestor carta» con editar).
      if (!data) throw new Error("No tienes permiso para cambiar la carta de la web.");
    },
    onSuccess: (_d, valor) => {
      toast.success(valor ? "Votación abierta: ya sale en la carta de vinos de la web" : "Votación cerrada: ya no sale en la web");
    },
    onError: (error: Error) => toast.error("No se pudo cambiar la votación", { description: mensajeUsuario(error) }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY_CONFIGURACION_WEB }),
  });

  const guardarPremioFecha = useMutation({
    mutationFn: async ({ premio: p, fin: f }: { premio: string; fin: string }) => {
      const mensaje = validarPremioFecha(p, f);
      if (mensaje) throw new Error(mensaje);
      const { data, error } = await supabase
        .from("configuracion_web")
        .update({ encuesta_vinos_premio: p.trim(), encuesta_vinos_fin: f })
        .eq("id", true)
        // Con la votación abierta no se cambian (las bases ya los enseñan).
        .eq("encuesta_vinos_activa", false)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("No se pudo guardar. Comprueba que la votación está cerrada y que puedes editar la carta.");
    },
    onSuccess: () => toast.success("Premio y último día guardados"),
    onError: (error: Error) => toast.error("No se pudieron guardar el premio y la fecha", { description: mensajeUsuario(error) }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY_CONFIGURACION_WEB }),
  });

  const vaciar = useMutation({
    mutationFn: async () => {
      // PostgREST no deja un DELETE sin filtro: este abarca todas las filas.
      const { error } = await supabase.from("votos_vino_favorito").delete().gte("created_at", "1970-01-01");
      if (error) throw error;
    },
    onSuccess: () => toast.success("Votación vaciada: empieza de cero"),
    onError: (error: Error) => toast.error("No se pudieron borrar los votos", { description: mensajeUsuario(error) }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY_VOTOS_VINO }),
  });

  return {
    activa,
    premio,
    fin,
    puedeAbrir,
    guardarPremioFecha,
    disponible,
    cargando: cargandoConfig,
    error: errorConfig,
    cambiarActiva,
    votos,
    vaciar,
  };
}
