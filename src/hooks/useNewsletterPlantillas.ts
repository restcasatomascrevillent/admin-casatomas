import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { mensajeErrorFuncion } from "@/hooks/useEnviarNewsletter";
import { textoErrorCliente } from "@/lib/newsletter/textos";
import {
  esTipoNewsletter,
  validarBloques,
  type DisenoNewsletter,
  type PlantillaGuardada,
  type TipoNewsletter,
} from "@/lib/newsletter/diseno";

// Sin tipos generados para newsletter_plantillas (migración 20261122153700).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const CLAVE = ["newsletter-plantillas"] as const;
const COLUMNAS = "id,nombre,descripcion,tipo,titulo,insignia,preheader,bloques,origen,created_at,updated_at";

/** Una fila que no valida (editada a mano en la base de datos) no se ofrece: no se podría enviar. */
export function filaAPlantilla(f: Record<string, unknown>): PlantillaGuardada | null {
  const v = validarBloques(f.bloques);
  if (!v.ok || typeof f.id !== "string" || typeof f.nombre !== "string") return null;
  return {
    id: f.id,
    nombre: f.nombre,
    descripcion: typeof f.descripcion === "string" ? f.descripcion : "",
    tipo: esTipoNewsletter(f.tipo) ? f.tipo : "personalizada",
    titulo: typeof f.titulo === "string" ? f.titulo : "",
    insignia: typeof f.insignia === "string" ? f.insignia : "",
    preheader: typeof f.preheader === "string" ? f.preheader : "",
    bloques: v.bloques,
    origen: f.origen === "ia" ? "ia" : "manual",
    created_at: String(f.created_at ?? ""),
    updated_at: String(f.updated_at ?? ""),
  };
}

/** Plantillas guardadas. Si la tabla aún no existe (migración sin aplicar), lista vacía y `disponible: false`. */
export function useNewsletterPlantillas() {
  const consulta = useQuery({
    queryKey: CLAVE,
    queryFn: async (): Promise<{ plantillas: PlantillaGuardada[]; disponible: boolean }> => {
      const { data, error } = await db.from("newsletter_plantillas").select(COLUMNAS).order("updated_at", { ascending: false }).limit(100);
      if (error) {
        if (/does not exist|Could not find the table|PGRST205|42P01/i.test(`${error.code ?? ""} ${error.message ?? ""}`)) return { plantillas: [], disponible: false };
        throw new Error(error.message);
      }
      return { plantillas: ((data ?? []) as Record<string, unknown>[]).map(filaAPlantilla).filter((p): p is PlantillaGuardada => !!p), disponible: true };
    },
    staleTime: 60_000,
  });
  return {
    plantillas: consulta.data?.plantillas ?? [],
    disponible: consulta.data?.disponible ?? true,
    cargando: consulta.isLoading,
  };
}

export interface NuevaPlantilla {
  nombre: string;
  diseno: DisenoNewsletter;
  origen: "manual" | "ia";
}

export function useGuardarPlantillaNewsletter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ nombre, diseno, origen }: NuevaPlantilla): Promise<PlantillaGuardada> => {
      const v = validarBloques(diseno.bloques);
      if (v.ok === false) throw new Error(v.error);
      const fila = {
        nombre: nombre.trim().slice(0, 80),
        tipo: diseno.tipo,
        titulo: diseno.titulo.trim().slice(0, 150),
        insignia: diseno.insignia.trim().slice(0, 40),
        preheader: diseno.preheader.trim().slice(0, 150),
        bloques: v.bloques,
        origen,
      };
      const { data, error } = await db.from("newsletter_plantillas").insert(fila).select(COLUMNAS).single();
      if (error) {
        if (/does not exist|Could not find the table|PGRST205|42P01/i.test(`${error.code ?? ""} ${error.message ?? ""}`)) {
          throw new Error("Guardar plantillas todavía no está disponible. Avisa al equipo técnico.");
        }
        if (/row-level security|permission/i.test(error.message ?? "")) throw new Error("No tienes permiso para guardar plantillas.");
        throw new Error(error.message);
      }
      const p = filaAPlantilla(data as Record<string, unknown>);
      if (!p) throw new Error("La plantilla guardada no es válida");
      return p;
    },
    onSuccess: (p) => {
      toast.success(`Plantilla «${p.nombre}» guardada.`);
      qc.invalidateQueries({ queryKey: CLAVE });
    },
    onError: (e: Error) => toast.error(`No se pudo guardar la plantilla. ${e.message}`),
  });
}

export function useBorrarPlantillaNewsletter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("newsletter_plantillas").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Plantilla borrada.");
      qc.invalidateQueries({ queryKey: CLAVE });
    },
    onError: (e: Error) => toast.error(`No se pudo borrar la plantilla. ${e.message}`),
  });
}

// ── «Crear con IA» ──────────────────────────────────────────────────────────

export type TonoIA = "cercano" | "elegante" | "festivo" | "informativo";

export interface PeticionIA {
  descripcion: string;
  tipo: TipoNewsletter | null;
  tono: TonoIA;
  imagenes: string[];
  /** Diseño actual, para «mejorar» en vez de empezar de cero. */
  base: DisenoNewsletter | null;
}

export interface RespuestaIA {
  propuesta: DisenoNewsletter;
  avisos: string[];
  modelo: string;
}

/** Llama a la Edge Function newsletter-ia. Solo PROPONE: no envía ni guarda nada. */
export function useCrearNewsletterIA() {
  return useMutation({
    mutationFn: async (p: PeticionIA): Promise<RespuestaIA> => {
      const { data, error } = await supabase.functions.invoke("newsletter-ia", {
        body: { descripcion: p.descripcion, tipo: p.tipo, tono: p.tono, imagenes: p.imagenes, base: p.base },
      });
      if (error) throw new Error(await mensajeErrorFuncion(error, "La IA no está disponible ahora mismo"));
      const r = data as { ok?: boolean; error?: string; propuesta?: Record<string, unknown>; avisos?: unknown; modelo?: string } | null;
      if (!r?.ok || !r.propuesta) throw new Error(r?.error || "La IA no devolvió ninguna propuesta");
      const v = validarBloques(r.propuesta.bloques);
      if (v.ok === false) throw new Error(`La propuesta de la IA no es válida: ${v.error}`);
      const tipo = esTipoNewsletter(r.propuesta.tipo) ? r.propuesta.tipo : p.tipo ?? "personalizada";
      return {
        propuesta: {
          tipo,
          titulo: String(r.propuesta.titulo ?? ""),
          insignia: String(r.propuesta.insignia ?? ""),
          preheader: String(r.propuesta.preheader ?? ""),
          bloques: v.bloques,
        },
        avisos: Array.isArray(r.avisos) ? r.avisos.filter((a): a is string => typeof a === "string") : [],
        modelo: r.modelo ?? "",
      };
    },
    onError: (e: Error) => {
      console.error("newsletter-ia:", e.message);
      toast.error(`La IA no ha podido redactar el correo. ${textoErrorCliente(e.message, "La IA no está disponible ahora mismo. Inténtalo más tarde.")}`);
    },
  });
}
