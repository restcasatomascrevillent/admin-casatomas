import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { notificarGuardadoYPublicacion } from "@/lib/rebuild-webs";

export interface Bebida {
  id: string;
  nombre: string | null;
  categoria: string | null;
  precio_eur: number | null;
  descripcion: string | null;
  tamano: string | null;
  orden: number | null;
  activado: boolean | null;
  imagen_url: string | null;
  touza: boolean | null;
  restaurante: boolean | null;
  featured: boolean | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface NuevaBebida {
  nombre: string;
  categoria: string;
  precio_eur: number;
  descripcion?: string;
  tamano?: string;
  orden?: number;
}

/** Llama a traducir-contenido; nunca lanza. Si falla, devuelve null y el
 * caller guarda la bebida igualmente sin traducción (ver informe, TAREA 2). */
async function traducirBebida(datos: {
  nombre: string;
  descripcion: string;
  categoria: string;
}): Promise<Record<string, unknown> | null> {
  try {
    const { data, error } = await supabase.functions.invoke("traducir-contenido", {
      body: { tipo: "bebida", datos },
    });
    if (error || !data?.ok) {
      console.error("Traducción de bebida no disponible:", error || data?.error);
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
  notificarGuardadoYPublicacion("bebida", mensajeBase);
}

/** Deriva la ruta del objeto dentro del bucket "bebidas" a partir de la
 * imagen_url pública (formato de Supabase Storage: `.../object/public/<bucket>/<ruta>`).
 * Devuelve null si no hay imagen o si la URL no encaja con ese patrón, para
 * no intentar borrar nada por error (ver informe, TAREA 2). */
function rutaStorageDesdeUrl(imagenUrl: string | null | undefined): string | null {
  if (!imagenUrl) return null;
  try {
    const sinQuery = imagenUrl.split("?")[0].split("#")[0];
    const marcador = "/object/public/bebidas/";
    const indice = sinQuery.indexOf(marcador);
    if (indice === -1) return null;
    const ruta = sinQuery.slice(indice + marcador.length);
    return ruta ? decodeURIComponent(ruta) : null;
  } catch {
    return null;
  }
}

export function useBebidas() {
  const queryClient = useQueryClient();

  const { data: bebidas, isLoading } = useQuery({
    queryKey: ["bebidas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("Bebidas")
        .select("*")
        .order("orden", { ascending: true });

      if (error) throw error;
      return data as Bebida[];
    },
  });

  const crearBebida = useMutation({
    mutationFn: async (nuevaBebida: NuevaBebida) => {
      const traducciones = await traducirBebida({
        nombre: nuevaBebida.nombre,
        descripcion: nuevaBebida.descripcion || "",
        categoria: nuevaBebida.categoria,
      });

      const { data, error } = await supabase
        .from("Bebidas")
        .insert([
          {
            id: crypto.randomUUID(),
            nombre: nuevaBebida.nombre,
            categoria: nuevaBebida.categoria,
            precio_eur: nuevaBebida.precio_eur,
            // El formulario pide descripción y hasta ahora no se escribía
            // nunca: se perdía en cada alta (y la web la muestra).
            descripcion: nuevaBebida.descripcion || null,
            tamano: nuevaBebida.tamano || null,
            orden: nuevaBebida.orden ?? 0,
            activado: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...(traducciones || {}),
          } as any,
        ])
        .select()
        .single();

      if (error) throw error;

      if (!traducciones) {
        toast.warning("Bebida guardada sin traducción automática. Revísala más tarde en inglés/francés.");
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bebidas"] });
      avisar("Bebida creada");
    },
    onError: (error) => {
      toast.error("Error al crear la bebida");
      console.error(error);
    },
  });

  const actualizarBebida = useMutation({
    mutationFn: async ({ id, ...cambios }: Partial<Bebida> & { id: string }) => {
      // Retraducir SOLO si cambia nombre, descripcion o categoria: son las
      // únicas columnas con *_en/*_fr en Bebidas. Comparamos contra el valor
      // anterior en caché, no solo "está presente en cambios", para que un
      // guardado de precio o de imagen_url (que reenvían solo esa clave)
      // nunca llame a la función de traducción.
      const anterior = queryClient.getQueryData<Bebida[]>(["bebidas"])?.find((b) => b.id === id);

      // GUARDA: si no hay `anterior` (caché fría, invalidada, o el id aún no
      // se cargó), NO se puede rellenar con seguridad lo que falte en
      // `cambios` -quedaría en "" al traducir- ni comparar "¿cambió de
      // verdad?". Traducir con huecos machacaría nombre_en/categoria_en/
      // descripcion_en BUENOS con la traducción de un payload vacío (mismo
      // patrón de corrupción silenciosa que el motor de OCR). Mejor una
      // traducción desactualizada que una corrompida: se guarda igual con
      // `cambios`, solo se salta la retraducción.
      const tocaCampoTraducible = "nombre" in cambios || "descripcion" in cambios || "categoria" in cambios;
      if (tocaCampoTraducible && !anterior) {
        console.warn(`useBebidas.actualizarBebida: se salta la retraducción de "${id}" — sin estado previo en caché.`);
      }

      const cambiaTraducible = Boolean(
        anterior &&
          (("nombre" in cambios && cambios.nombre !== anterior.nombre) ||
            ("descripcion" in cambios && cambios.descripcion !== anterior.descripcion) ||
            ("categoria" in cambios && cambios.categoria !== anterior.categoria)),
      );

      // Traducir primero (no escribe nada), igual que en la creación. Si
      // falla, `traducciones` queda null y el guardado sigue igual (TAREA 2).
      let traducciones: Record<string, unknown> | null = null;
      if (cambiaTraducible) {
        traducciones = await traducirBebida({
          nombre: (cambios.nombre ?? anterior?.nombre) || "",
          descripcion: (cambios.descripcion ?? anterior?.descripcion) || "",
          categoria: (cambios.categoria ?? anterior?.categoria) || "",
        });
      }

      const { data, error } = await supabase
        .from("Bebidas")
        .update({ ...cambios, ...(traducciones || {}) } as any)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;

      if (cambiaTraducible && !traducciones) {
        toast.warning("Bebida actualizada sin volver a traducir. Revísala más tarde en inglés/francés.");
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bebidas"] });
      avisar("Bebida actualizada");
    },
    onError: (error) => {
      toast.error("Error al actualizar la bebida");
      console.error(error);
    },
  });

  const eliminarBebida = useMutation({
    mutationFn: async (id: string) => {
      // Best-effort: borramos la foto de Storage ANTES de borrar la fila
      // (después ya no hay dónde consultar imagen_url). Si algo falla aquí
      // -no se puede derivar la ruta, o el propio borrado del objeto falla-
      // NO debe impedir que se borre el registro; solo dejamos constancia
      // por consola (ver informe, TAREA 2).
      const anterior = queryClient.getQueryData<Bebida[]>(["bebidas"])?.find((b) => b.id === id);
      const ruta = rutaStorageDesdeUrl(anterior?.imagen_url);
      if (ruta) {
        const { error: storageError } = await supabase.storage.from("bebidas").remove([ruta]);
        if (storageError) {
          console.error("No se pudo borrar la imagen de la bebida en Storage:", storageError);
        }
      } else if (anterior?.imagen_url) {
        console.warn("No se pudo derivar la ruta de Storage desde imagen_url:", anterior.imagen_url);
      }

      const { error } = await supabase
        .from("Bebidas")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bebidas"] });
      avisar("Bebida eliminada");
    },
    onError: (error) => {
      toast.error("Error al eliminar la bebida");
      console.error(error);
    },
  });

  const toggleActivado = useMutation({
    mutationFn: async ({ id, activado }: { id: string; activado: boolean; nombre?: string }) => {
      const { error } = await supabase
        .from("Bebidas")
        .update({ activado })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: (_data, { activado, nombre }) => {
      queryClient.invalidateQueries({ queryKey: ["bebidas"] });
      avisar(
        activado
          ? `${nombre || "Bebida"} vuelve a estar activa`
          : `${nombre || "Bebida"} despublicada: deja de verse en la web`,
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
        .from("Bebidas")
        .update({ restaurante })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bebidas"] });
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
        .from("Bebidas")
        .update({ touza })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bebidas"] });
      avisar("Visibilidad en Touza actualizada");
    },
    onError: (error) => {
      toast.error("Error al cambiar visibilidad Touza");
      console.error(error);
    },
  });

  const categorias = bebidas
    ? Array.from(new Set(bebidas.map((b) => b.categoria).filter(Boolean)))
    : [];

  return {
    bebidas,
    isLoading,
    categorias,
    crearBebida,
    actualizarBebida,
    eliminarBebida,
    toggleActivado,
    toggleRestaurante,
    toggleTouza,
  };
}
