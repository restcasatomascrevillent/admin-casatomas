import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json, Tables } from "@/integrations/supabase/types";
import { notificarGuardadoYPublicacion } from "@/lib/rebuild-webs";
import { mensajeUsuario } from "@/lib/mensaje-usuario";
import { HORARIO_POR_DEFECTO, leerHorario, resumenHorario, type HorarioWeb } from "@/lib/horario-web";

export type ConfiguracionWeb = Tables<"configuracion_web">;

/** Webs públicas con interruptor propio de fotos de platos. */
export type WebPublica = "casa_tomas" | "touza";
export type BotonMenuTapas = "menu" | "tapas";

export const QUERY_KEY_CONFIGURACION_WEB = ["configuracionWeb"] as const;

type CambioFotos =
  | Pick<ConfiguracionWeb, "mostrar_fotos_platos_casa_tomas">
  | Pick<ConfiguracionWeb, "mostrar_fotos_platos_touza">;

const cambioFotos = (web: WebPublica, mostrar: boolean): CambioFotos =>
  web === "casa_tomas" ? { mostrar_fotos_platos_casa_tomas: mostrar } : { mostrar_fotos_platos_touza: mostrar };

const NOMBRE_WEB: Record<WebPublica, string> = {
  casa_tomas: "Casa Tomás",
  touza: "Touza",
};

// ----------------------------------------------------------------------------
// configuracion_web la crea 20261001113700_configuracion_web_fotos_platos.sql,
// que aplica el dueño a mano. Mientras no esté aplicada, PostgREST responde
// "Could not find the table ... in the schema cache" (PGRST205) — en Postgres
// puro 42P01. Eso NO es un error de la pantalla: se expone como
// `noDisponible` y la UI deja los interruptores deshabilitados con una nota
// discreta (mismo patrón que useProteccionBotWeb.ts).
// ----------------------------------------------------------------------------
export function esErrorTablaConfiguracionWebFaltante(error: unknown): boolean {
  const mensaje = String((error as { message?: string } | null)?.message ?? "");
  const codigo = String((error as { code?: string } | null)?.code ?? "");
  return codigo === "PGRST205" || codigo === "42P01" || /configuracion_web/.test(mensaje);
}

interface DatosConfiguracionWeb {
  noDisponible: boolean;
  config: ConfiguracionWeb | null;
}

async function fetchConfiguracionWeb(): Promise<DatosConfiguracionWeb> {
  const { data, error } = await supabase.from("configuracion_web").select("*").eq("id", true).maybeSingle();
  if (error) {
    if (esErrorTablaConfiguracionWebFaltante(error)) return { noDisponible: true, config: null };
    throw error;
  }
  return { noDisponible: false, config: data };
}

export function useConfiguracionWeb() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: QUERY_KEY_CONFIGURACION_WEB,
    queryFn: fetchConfiguracionWeb,
  });

  const cambiarFotosPlatos = useMutation({
    mutationFn: async ({ web, mostrar }: { web: WebPublica; mostrar: boolean }) => {
      // Fila única (id = true), por eso el filtro fijo.
      const { data, error } = await supabase
        .from("configuracion_web")
        .update(cambioFotos(web, mostrar))
        .eq("id", true)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      // Sin fila devuelta = la RLS no dejó actualizar (sin permiso de Carta) o
      // la fila no existe: no fingir que se guardó.
      if (!data) throw new Error("No tienes permiso para cambiar la carta de la web.");
      return data;
    },
    onMutate: async ({ web, mostrar }) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY_CONFIGURACION_WEB });
      const previo = queryClient.getQueryData<DatosConfiguracionWeb>(QUERY_KEY_CONFIGURACION_WEB);
      if (previo?.config) {
        queryClient.setQueryData<DatosConfiguracionWeb>(QUERY_KEY_CONFIGURACION_WEB, {
          ...previo,
          config: { ...previo.config, ...cambioFotos(web, mostrar) },
        });
      }
      return { previo };
    },
    onError: (error: Error, _variables, contexto) => {
      if (contexto?.previo) queryClient.setQueryData(QUERY_KEY_CONFIGURACION_WEB, contexto.previo);
      toast.error("No se pudo cambiar las fotos de los platos", {
        description: esErrorTablaConfiguracionWebFaltante(error)
          ? "Falta aplicar la migración en la base de datos."
          : error.message,
      });
    },
    onSuccess: (_data, { web, mostrar }) => {
      // Las webs son estáticas (SSG): el cambio solo se ve al republicarlas.
      // Mismo aviso que al guardar un plato (`usePlatos.ts`), con el mismo
      // origen "plato" que republica las dos webs.
      notificarGuardadoYPublicacion(
        "plato",
        `Fotos de platos ${mostrar ? "activadas" : "desactivadas"} en ${NOMBRE_WEB[web]}`,
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY_CONFIGURACION_WEB });
    },
  });

  const config = query.data?.config ?? null;

  const cambiarBotonMenuTapas = useMutation({
    mutationFn: async ({ boton, mostrar }: { boton: BotonMenuTapas; mostrar: boolean }) => {
      // La RPC solo cambia estos dos campos con el permiso de «Gestión web».
      // No amplía el acceso a los ajustes de fotos de la pestaña Carta.
      const { error } = await supabase.rpc("configuracion_web_visibilidad_menu_tapas", {
        p_seccion: boton,
        p_mostrar: mostrar,
      });
      if (error) throw error;
    },
    onMutate: async ({ boton, mostrar }) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY_CONFIGURACION_WEB });
      const previo = queryClient.getQueryData<DatosConfiguracionWeb>(QUERY_KEY_CONFIGURACION_WEB);
      const campo = boton === "menu" ? "mostrar_menu_dia_casa_tomas" : "mostrar_tapas_casa_tomas";
      if (previo?.config) queryClient.setQueryData(QUERY_KEY_CONFIGURACION_WEB, {
        ...previo, config: { ...previo.config, [campo]: mostrar },
      });
      return { previo };
    },
    onError: (error: Error, _variables, contexto) => {
      if (contexto?.previo) queryClient.setQueryData(QUERY_KEY_CONFIGURACION_WEB, contexto.previo);
      toast.error("No se pudo cambiar la visibilidad en la web", { description: mensajeUsuario(error) });
    },
    onSuccess: (_data, { boton, mostrar }) => {
      notificarGuardadoYPublicacion(boton, `${boton === "menu" ? "Menú del día" : "Tapas"} ${mostrar ? "visible" : "oculto"} en Casa Tomás`);
    },
    onSettled: () => { queryClient.invalidateQueries({ queryKey: QUERY_KEY_CONFIGURACION_WEB }); },
  });

  // Carta de Bebidas en la web (20261124110000, 11/11/2026): apagada por defecto. La web la lee al
  // construirse y cada minuto; se republica igualmente para que el HTML estático no la traiga.
  const cambiarCartaBebidas = useMutation({
    mutationFn: async (mostrar: boolean) => {
      const { data, error } = await supabase
        .from("configuracion_web")
        .update({ mostrar_carta_bebidas_casa_tomas: mostrar })
        .eq("id", true)
        .select("mostrar_carta_bebidas_casa_tomas")
        .maybeSingle();
      if (error) throw error;
      // Sin fila devuelta = la RLS no dejó actualizar (sin «Editar» en la carta): no fingir que se guardó.
      if (!data) throw new Error("No tienes permiso para cambiar la carta de la web.");
      return data;
    },
    onMutate: async (mostrar) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY_CONFIGURACION_WEB });
      const previo = queryClient.getQueryData<DatosConfiguracionWeb>(QUERY_KEY_CONFIGURACION_WEB);
      if (previo?.config) {
        queryClient.setQueryData<DatosConfiguracionWeb>(QUERY_KEY_CONFIGURACION_WEB, {
          ...previo,
          config: { ...previo.config, mostrar_carta_bebidas_casa_tomas: mostrar },
        });
      }
      return { previo };
    },
    onError: (error: Error, _mostrar, contexto) => {
      if (contexto?.previo) queryClient.setQueryData(QUERY_KEY_CONFIGURACION_WEB, contexto.previo);
      toast.error("No se pudo cambiar la carta de bebidas en la web", { description: mensajeUsuario(error) });
    },
    onSuccess: (_data, mostrar) => {
      notificarGuardadoYPublicacion("bebida", `Carta de bebidas ${mostrar ? "activada" : "desactivada"} en la web`);
    },
    onSettled: () => { queryClient.invalidateQueries({ queryKey: QUERY_KEY_CONFIGURACION_WEB }); },
  });

  // Días y horas de cada botón (20261104142000). La web lo lee al vuelo (cada
  // minuto): no hace falta republicarla. `null` = volver a lo de siempre.
  const cambiarHorarioMenuTapas = useMutation({
    mutationFn: async ({ boton, horario }: { boton: BotonMenuTapas; horario: HorarioWeb | null }) => {
      const { error } = await supabase.rpc("configuracion_web_horario_menu_tapas", {
        p_seccion: boton,
        p_horario: horario as unknown as Json,
      });
      if (error) throw error;
    },
    onSuccess: (_data, { boton, horario }) => {
      const nombre = boton === "menu" ? "Menú del día" : "Tapas";
      toast.success(`Horario de «${nombre}» guardado`, {
        description: `${resumenHorario(horario ?? HORARIO_POR_DEFECTO[boton])}. La web lo aplica en un minuto.`,
      });
    },
    onError: (error: Error) => toast.error("No se pudo guardar el horario", { description: mensajeUsuario(error) }),
    onSettled: () => { queryClient.invalidateQueries({ queryKey: QUERY_KEY_CONFIGURACION_WEB }); },
  });

  return {
    config,
    /** Por defecto (sin fila o sin tabla) las fotos se ven: es lo que hacen las webs. */
    mostrarFotosPlatos: {
      casa_tomas: config?.mostrar_fotos_platos_casa_tomas ?? true,
      touza: config?.mostrar_fotos_platos_touza ?? true,
    } satisfies Record<WebPublica, boolean>,
    noDisponible: query.data?.noDisponible ?? false,
    isLoading: query.isLoading,
    isError: query.isError,
    cambiarFotosPlatos,
    mostrarBotonesMenuTapas: {
      menu: config?.mostrar_menu_dia_casa_tomas ?? true,
      tapas: config?.mostrar_tapas_casa_tomas ?? true,
    },
    botonesMenuTapasDisponibles: typeof config?.mostrar_menu_dia_casa_tomas === "boolean"
      && typeof config?.mostrar_tapas_casa_tomas === "boolean",
    cambiarBotonMenuTapas,
    horariosMenuTapas: {
      menu: leerHorario(config?.horario_menu_dia_casa_tomas, "menu"),
      tapas: leerHorario(config?.horario_tapas_casa_tomas, "tapas"),
    } satisfies Record<BotonMenuTapas, HorarioWeb>,
    /** La columna existe (migración aplicada): `undefined` si no, `null` si está sin guardar. */
    horariosDisponibles: config !== null && config.horario_menu_dia_casa_tomas !== undefined,
    cambiarHorarioMenuTapas,
    /** Carta de Bebidas en la web: apagada por defecto (también sin la columna o sin la fila). */
    mostrarCartaBebidas: config?.mostrar_carta_bebidas_casa_tomas === true,
    /** La columna existe (migración 20261124110000 aplicada). */
    cartaBebidasDisponible: typeof config?.mostrar_carta_bebidas_casa_tomas === "boolean",
    cambiarCartaBebidas,
  };
}
