import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { notificarGuardadoYPublicacion } from "@/lib/rebuild-webs";
import { combinarAlergenos, parseAlergenos } from "@/lib/alergenos";

export interface Coctel {
  id: string;
  nombre: string | null;
  categoria: string | null;
  precio_eur: number | null;
  descripcion: string | null;
  ingredientes: string | null;
  preparacion: string | null;
  alergenos_oficiales: any;
  alergenos_notas: string | null;
  activado: boolean | null;
  orden: number | null;
  imagen_url: string | null;
  traducciones: any;
  nombre_en: string | null;
  categoria_en: string | null;
  descripcion_en: string | null;
  ingredientes_en: string | null;
  nombre_fr: string | null;
  categoria_fr: string | null;
  descripcion_fr: string | null;
  ingredientes_fr: string | null;
  touza: boolean | null;
  restaurante: boolean | null;
  featured: boolean | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface NuevoCoctel {
  nombre: string;
  categoria: string;
  precio_eur: number;
  descripcion?: string;
  ingredientes?: string;
  preparacion?: string;
  alergenos_oficiales?: any;
  alergenos_notas?: string;
}

/**
 * Deja la lista de alérgenos en el vocabulario canónico (ver
 * `src/lib/alergenos.ts`), igual que `usePlatos.ts`/`useVinos.ts`.
 */
function normalizarAlergenos(alergenos_oficiales: unknown): string[] {
  return combinarAlergenos(parseAlergenos(alergenos_oficiales));
}

/** Llama a traducir-contenido; nunca lanza. Si falla, devuelve null y el
 * caller guarda el cóctel igualmente sin traducción (ver informe, TAREA 2).
 * NOTA: "coctel" no existía como tipo en el switch de n8n (TraducirIA.json),
 * así que hasta ahora nunca se traducía NI se insertaba nada en Cocteles;
 * de ahí 0/13 cócteles traducidos. */
async function traducirCoctel(datos: {
  nombre: string;
  descripcion: string;
  ingredientes: string;
  categoria: string;
}): Promise<Record<string, unknown> | null> {
  try {
    const { data, error } = await supabase.functions.invoke("traducir-contenido", {
      body: { tipo: "coctel", datos },
    });
    if (error || !data?.ok) {
      console.error("Traducción de cóctel no disponible:", error || data?.error);
      return null;
    }
    return data.translations as Record<string, unknown>;
  } catch (err) {
    console.error("Error llamando a traducir-contenido:", err);
    return null;
  }
}

/** Avisa a rebuild-webs de que hay contenido nuevo y cuenta al usuario si el
 * cambio se ha publicado o solo se ha guardado (ver `src/lib/rebuild-webs.ts`).
 * Nunca bloquea ni rompe el guardado. */
function avisar(mensajeBase: string) {
  notificarGuardadoYPublicacion("coctel", mensajeBase);
}

/** Deriva la ruta del objeto dentro del bucket "cocteles" a partir de la
 * imagen_url pública (formato de Supabase Storage: `.../object/public/<bucket>/<ruta>`).
 * Devuelve null si no hay imagen o si la URL no encaja con ese patrón, para
 * no intentar borrar nada por error (ver informe, TAREA 2). */
function rutaStorageDesdeUrl(imagenUrl: string | null | undefined): string | null {
  if (!imagenUrl) return null;
  try {
    const sinQuery = imagenUrl.split("?")[0].split("#")[0];
    const marcador = "/object/public/cocteles/";
    const indice = sinQuery.indexOf(marcador);
    if (indice === -1) return null;
    const ruta = sinQuery.slice(indice + marcador.length);
    return ruta ? decodeURIComponent(ruta) : null;
  } catch {
    return null;
  }
}

export function useCocteles() {
  const queryClient = useQueryClient();

  const { data: cocteles, isLoading } = useQuery({
    queryKey: ["cocteles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("Cocteles")
        .select("*")
        .order("orden", { ascending: true });

      if (error) throw error;
      return data as Coctel[];
    },
  });

  const crearCoctel = useMutation({
    mutationFn: async (nuevoCoctel: NuevoCoctel) => {
      // Alérgenos en el propio INSERT (antes solo crearPlato/crearVino los
      // aceptaban aquí; Cocteles dependía de un segundo actualizarCoctel
      // desde el formulario, dejando una ventana en la que un cóctel podía
      // quedar guardado sin alérgenos declarados si ese segundo paso fallaba
      // -obligatorio por Reglamento UE 1169/2011-). Mismo criterio de
      // normalización que usePlatos.ts/useVinos.ts.
      const alergenosArray = normalizarAlergenos(nuevoCoctel.alergenos_oficiales);

      // Cocteles no traduce alérgenos (no tiene columnas alergenos_en/fr ni
      // el prompt COCTEL_SYSTEM las pide, ver traducir-contenido/prompts.ts),
      // así que no se envían a traducirCoctel.
      const traducciones = await traducirCoctel({
        nombre: nuevoCoctel.nombre,
        descripcion: nuevoCoctel.descripcion || "",
        ingredientes: nuevoCoctel.ingredientes || "",
        categoria: nuevoCoctel.categoria,
      });

      const { data, error } = await supabase
        .from("Cocteles")
        .insert([
          {
            id: crypto.randomUUID(),
            nombre: nuevoCoctel.nombre,
            categoria: nuevoCoctel.categoria,
            precio_eur: nuevoCoctel.precio_eur,
            descripcion: nuevoCoctel.descripcion || null,
            ingredientes: nuevoCoctel.ingredientes || null,
            preparacion: nuevoCoctel.preparacion || null,
            alergenos_oficiales: alergenosArray.length > 0 ? alergenosArray : null,
            alergenos_notas: nuevoCoctel.alergenos_notas || null,
            activado: true,
            orden: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...(traducciones || {}),
          } as any,
        ])
        .select()
        .single();

      if (error) throw error;

      if (!traducciones) {
        toast.warning("Cóctel guardado sin traducción automática. Revísalo más tarde en inglés/francés.");
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cocteles"] });
      avisar("Cóctel creado");
    },
    onError: (error) => {
      toast.error("Error al crear el cóctel");
      console.error(error);
    },
  });

  const actualizarCoctel = useMutation({
    mutationFn: async ({ id, ...cambios }: Partial<Coctel> & { id: string }) => {
      // Si la edición toca alérgenos, se guarda en vocabulario canónico
      // (mismo criterio que `usePlatos.ts`/`useVinos.ts`). Sin esto, el
      // EditarCoctelModal.tsx de otro agente guardaba alérgenos con un
      // vocabulario distinto al resto de la carta, y el emparejamiento por
      // sinónimos de las webs públicas (`src/lib/alergenos.ts`) podía no
      // reconocerlos.
      if ("alergenos_oficiales" in cambios) {
        const normalizados = normalizarAlergenos(cambios.alergenos_oficiales);
        cambios.alergenos_oficiales = normalizados.length > 0 ? normalizados : null;
      }

      // Retraducir SOLO si cambia nombre, descripcion, ingredientes o
      // categoria: son las únicas columnas con *_en/*_fr en Cocteles.
      // Comparamos contra el valor anterior en caché, no solo "está presente
      // en cambios", para que un guardado de precio o de imagen_url (que
      // reenvían solo esa clave) nunca llame a la función de traducción.
      const anterior = queryClient.getQueryData<Coctel[]>(["cocteles"])?.find((c) => c.id === id);

      // GUARDA: si no hay `anterior` (caché fría, invalidada, o el id aún no
      // se cargó), NO se puede rellenar con seguridad lo que falte en
      // `cambios` -quedaría en "" al traducir- ni comparar "¿cambió de
      // verdad?". Traducir con huecos machacaría nombre_en/categoria_en/
      // descripcion_en/ingredientes_en BUENOS con la traducción de un payload
      // vacío (mismo patrón de corrupción silenciosa que el motor de OCR).
      // Mejor una traducción desactualizada que una corrompida: se guarda
      // igual con `cambios`, solo se salta la retraducción.
      const tocaCampoTraducible =
        "nombre" in cambios || "descripcion" in cambios || "ingredientes" in cambios || "categoria" in cambios;
      const saltaRetraduccionSinAnterior = tocaCampoTraducible && !anterior;
      if (saltaRetraduccionSinAnterior) {
        console.warn(`useCocteles.actualizarCoctel: se salta la retraducción de "${id}" — sin estado previo en caché.`);
      }

      const cambiaTraducible = Boolean(
        anterior &&
          (("nombre" in cambios && cambios.nombre !== anterior.nombre) ||
            ("descripcion" in cambios && cambios.descripcion !== anterior.descripcion) ||
            ("ingredientes" in cambios && cambios.ingredientes !== anterior.ingredientes) ||
            ("categoria" in cambios && cambios.categoria !== anterior.categoria)),
      );

      // Traducir primero (no escribe nada), igual que en la creación. Si
      // falla, `traducciones` queda null y el guardado sigue igual (TAREA 2).
      let traducciones: Record<string, unknown> | null = null;
      if (cambiaTraducible) {
        traducciones = await traducirCoctel({
          nombre: (cambios.nombre ?? anterior?.nombre) || "",
          descripcion: (cambios.descripcion ?? anterior?.descripcion) || "",
          ingredientes: (cambios.ingredientes ?? anterior?.ingredientes) || "",
          categoria: (cambios.categoria ?? anterior?.categoria) || "",
        });
      }

      const { data, error } = await supabase
        .from("Cocteles")
        .update({ ...cambios, ...(traducciones || {}) } as any)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;

      if (saltaRetraduccionSinAnterior) {
        toast.warning(
          "Cóctel actualizado, pero no se pudo comprobar si había que retraducirlo (la lista de cócteles no estaba cargada). Vuelve a editarlo con la lista cargada para revisar el inglés/francés.",
        );
      } else if (cambiaTraducible && !traducciones) {
        toast.warning("Cóctel actualizado sin volver a traducir. Revísalo más tarde en inglés/francés.");
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cocteles"] });
      avisar("Cóctel actualizado");
    },
    onError: (error) => {
      toast.error("Error al actualizar el cóctel");
      console.error(error);
    },
  });

  const eliminarCoctel = useMutation({
    mutationFn: async (id: string) => {
      // Best-effort: borramos la foto de Storage ANTES de borrar la fila
      // (después ya no hay dónde consultar imagen_url). Si algo falla aquí
      // -no se puede derivar la ruta, o el propio borrado del objeto falla-
      // NO debe impedir que se borre el registro; solo dejamos constancia
      // por consola (ver informe, TAREA 2).
      const anterior = queryClient.getQueryData<Coctel[]>(["cocteles"])?.find((c) => c.id === id);
      const ruta = rutaStorageDesdeUrl(anterior?.imagen_url);
      if (ruta) {
        const { error: storageError } = await supabase.storage.from("cocteles").remove([ruta]);
        if (storageError) {
          console.error("No se pudo borrar la imagen del cóctel en Storage:", storageError);
        }
      } else if (anterior?.imagen_url) {
        console.warn("No se pudo derivar la ruta de Storage desde imagen_url:", anterior.imagen_url);
      }

      const { error } = await supabase
        .from("Cocteles")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cocteles"] });
      avisar("Cóctel eliminado");
    },
    onError: (error) => {
      toast.error("Error al eliminar el cóctel");
      console.error(error);
    },
  });

  const toggleActivado = useMutation({
    mutationFn: async ({ id, activado }: { id: string; activado: boolean; nombre?: string }) => {
      const { error } = await supabase
        .from("Cocteles")
        .update({ activado })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: (_data, { activado, nombre }) => {
      queryClient.invalidateQueries({ queryKey: ["cocteles"] });
      avisar(
        activado
          ? `${nombre || "Cóctel"} vuelve a estar activo`
          : `${nombre || "Cóctel"} despublicado: deja de verse en la web`,
      );
    },
    onError: (error) => {
      toast.error("Error al cambiar el estado");
      console.error(error);
    },
  });

  const toggleRestaurante = useMutation({
    mutationFn: async ({ id, restaurante }: { id: string; restaurante: boolean }) => {
      const { error } = await supabase
        .from("Cocteles")
        .update({ restaurante })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cocteles"] });
      avisar("Visibilidad en Restaurante actualizada");
    },
    onError: (error) => {
      toast.error("Error al cambiar visibilidad Restaurante");
      console.error(error);
    },
  });

  const toggleTouza = useMutation({
    mutationFn: async ({ id, touza }: { id: string; touza: boolean }) => {
      const { error } = await supabase
        .from("Cocteles")
        .update({ touza })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cocteles"] });
      avisar("Visibilidad en Touza actualizada");
    },
    onError: (error) => {
      toast.error("Error al cambiar visibilidad Touza");
      console.error(error);
    },
  });

  const categorias = cocteles
    ? Array.from(new Set(cocteles.map((c) => c.categoria).filter(Boolean)))
    : [];

  return {
    cocteles,
    isLoading,
    categorias,
    crearCoctel,
    actualizarCoctel,
    eliminarCoctel,
    toggleActivado,
    toggleRestaurante,
    toggleTouza,
  };
}
