import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { notificarGuardadoYPublicacion } from "@/lib/rebuild-webs";
import { combinarAlergenos, parseAlergenos } from "@/lib/alergenos";

export interface Vino {
  id: string;
  nombre: string | null;
  categoria: string | null;
  precio_eur: number | null;
  descripcion: string | null;
  ingredientes: string | null;
  denominacion_origen: string | null;
  ubicacion_pais: string | null;
  ubicacion_region: string | null;
  alergenos_oficiales: any;
  alergenos_inferidos: any;
  alergenos_notas: string | null;
  orden: string | null;
  activado: boolean | null;
  expanded: boolean | null;
  imagen_url: string | null;
  imagen_posicion_y: number | null;
  touza: boolean | null;
  restaurante: boolean | null;
  featured: boolean | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface NuevoVino {
  nombre: string;
  categoria: string;
  precio_eur: number;
  descripcion?: string;
  ingredientes?: string;
  denominacion_origen?: string;
  ubicacion_pais?: string;
  ubicacion_region?: string;
  alergenos_oficiales?: any;
  alergenos_notas?: string;
  orden?: string;
}

/**
 * Deja la lista de alérgenos en el vocabulario canónico (ver
 * `src/lib/alergenos.ts`), igual que hace `usePlatos.ts`. Antes de este
 * arreglo, Vinos era la única de las 4 tablas de carta cuyo hook nunca
 * normalizaba ni escribía `alergenos_oficiales`: el dato solo se podía tocar
 * por SQL directo (ver migración `20260921180000_declarar_sulfitos_vinos.sql`,
 * que documenta este mismo hueco).
 */
function normalizarAlergenos(alergenos_oficiales: unknown): string[] {
  return combinarAlergenos(parseAlergenos(alergenos_oficiales));
}

/**
 * Llama a traducir-contenido; nunca lanza. Si falla, devuelve null y el
 * caller guarda el vino igualmente sin traducción (ver informe, TAREA 2).
 *
 * OJO (TAREA 4): a diferencia de Platos/Bebidas/Cocteles, la tabla Vinos NO
 * tiene columnas descripcion_en/descripcion_fr ni denominacion_origen_en/fr.
 * El código anterior (y el propio nodo "Nueva Fila Vino" de n8n) escribía
 * descripcion_en/fr igualmente, lo que Postgrest rechaza con "column does
 * not exist" y tumbaba el UPDATE ENTERO — ninguna traducción se guardaba
 * nunca, ni siquiera nombre_en/categoria_en, que sí tienen columna. La
 * función traducir-contenido (ver prompts.ts) ya devuelve solo las columnas
 * que existen de verdad en Vinos, así que aquí no hace falta filtrar nada.
 */
async function traducirVino(datos: {
  nombre: string;
  descripcion: string;
  ingredientes: string;
  categoria: string;
  ubicacion_pais: string;
  ubicacion_region: string;
  alergenos_notas: string;
}): Promise<Record<string, unknown> | null> {
  try {
    const { data, error } = await supabase.functions.invoke("traducir-contenido", {
      body: { tipo: "vino", datos },
    });
    if (error || !data?.ok) {
      console.error("Traducción de vino no disponible:", error || data?.error);
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
  notificarGuardadoYPublicacion("vino", mensajeBase);
}

/** Deriva la ruta del objeto dentro del bucket "vinos" a partir de la
 * imagen_url pública (formato de Supabase Storage: `.../object/public/<bucket>/<ruta>`,
 * posiblemente con `?t=` de cache-busting detrás, ver `EditarVinoModal.tsx`).
 * Devuelve null si no hay imagen o si la URL no encaja con ese patrón, para
 * no intentar borrar nada por error (ver informe, TAREA 2). */
function rutaStorageDesdeUrl(imagenUrl: string | null | undefined): string | null {
  if (!imagenUrl) return null;
  try {
    const sinQuery = imagenUrl.split("?")[0].split("#")[0];
    const marcador = "/object/public/vinos/";
    const indice = sinQuery.indexOf(marcador);
    if (indice === -1) return null;
    const ruta = sinQuery.slice(indice + marcador.length);
    return ruta ? decodeURIComponent(ruta) : null;
  } catch {
    return null;
  }
}

export function useVinos() {
  const queryClient = useQueryClient();

  const { data: vinos, isLoading } = useQuery({
    queryKey: ["vinos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("Vinos")
        .select("*")
        .order("orden", { ascending: true });

      if (error) throw error;
      return data as unknown as Vino[];
    },
  });

  const crearVino = useMutation({
    mutationFn: async (nuevoVino: NuevoVino) => {
      const pais = nuevoVino.ubicacion_pais?.trim();
      const region = nuevoVino.ubicacion_region?.trim();
      if (!pais || !region) {
        throw new Error("Indica el país y la región para situar el vino en el mapa");
      }
      const alergenosArray = normalizarAlergenos(nuevoVino.alergenos_oficiales);

      // 1. Traducir primero (columnas ya filtradas a lo que existe en Vinos).
      const traducciones = await traducirVino({
        nombre: nuevoVino.nombre,
        descripcion: nuevoVino.descripcion || "",
        ingredientes: nuevoVino.ingredientes || "",
        categoria: nuevoVino.categoria,
        ubicacion_pais: pais,
        ubicacion_region: region,
        alergenos_notas: nuevoVino.alergenos_notas || "",
      });

      // 2. Insertar directamente (antes: solo esto, sin traducción — el resto
      // del flujo viejo dependía de un webhook de n8n roto). Un solo INSERT,
      // sin el UPDATE en segundo plano que fallaba por la columna inexistente.
      const { data, error } = await supabase
        .from("Vinos")
        .insert([
          {
            id: crypto.randomUUID(),
            nombre: nuevoVino.nombre,
            categoria: nuevoVino.categoria,
            precio_eur: nuevoVino.precio_eur,
            descripcion: nuevoVino.descripcion || null,
            ingredientes: nuevoVino.ingredientes || null,
            denominacion_origen: nuevoVino.denominacion_origen || null,
            ubicacion_pais: pais,
            ubicacion_region: region,
            alergenos_oficiales: alergenosArray.length > 0 ? alergenosArray : null,
            alergenos_notas: nuevoVino.alergenos_notas || null,
            orden: nuevoVino.orden ?? "0",
            activado: true,
            restaurante: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...(traducciones || {}),
          } as any,
        ])
        .select()
        .single();

      if (error) throw error;

      if (!traducciones) {
        toast.warning("Vino guardado sin traducción automática. Revísalo más tarde en inglés/francés.");
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vinos"] });
      avisar("Vino añadido");
    },
    onError: (error) => {
      toast.error("Error al añadir el vino");
      console.error(error);
    },
  });

  const actualizarVino = useMutation({
    mutationFn: async ({ id, ...cambios }: Partial<Vino> & { id: string }) => {
      // Si la edición toca alérgenos, se guarda en vocabulario canónico
      // (mismo criterio que `usePlatos.ts`).
      if ("alergenos_oficiales" in cambios) {
        const normalizados = normalizarAlergenos(cambios.alergenos_oficiales);
        cambios.alergenos_oficiales = normalizados.length > 0 ? normalizados : null;
      }

      // Retraducir SOLO si cambia un campo que de verdad alimenta alguna
      // columna *_en/*_fr de Vinos: nombre, categoria, ubicacion_pais,
      // ubicacion_region o alergenos_notas (-> alergenos_en/fr, ojo: es
      // alergenos_notas y NO alergenos_oficiales, ver `traducirVino` más
      // abajo). Vinos NO tiene descripcion_en/fr ni ingredientes_en/fr (TAREA
      // 4), así que cambiar descripcion o ingredientes NUNCA dispara
      // traducción aquí, aunque sí se le sigan pasando a `traducirVino` (la
      // función ya los ignora al mapear la respuesta). Comparamos contra el
      // valor anterior en caché, no solo "está presente en cambios", para
      // que un guardado de precio o de imagen_url/imagen_posicion_y (que
      // reenvían solo esa clave) nunca llame a la función de traducción.
      const anterior = queryClient.getQueryData<Vino[]>(["vinos"])?.find((v) => v.id === id);

      // GUARDA: si no hay `anterior` (caché fría, invalidada, o el id aún no
      // se cargó), NO se puede rellenar con seguridad lo que falte en
      // `cambios` -quedaría en "" al traducir- ni comparar "¿cambió de
      // verdad?". Traducir con huecos machacaría nombre_en/categoria_en/
      // ubicacion_pais_en/ubicacion_region_en/alergenos_en BUENOS con la
      // traducción de un payload vacío (mismo patrón de corrupción silenciosa
      // que el motor de OCR). Mejor una traducción desactualizada que una
      // corrompida: se guarda igual con `cambios`, solo se salta la
      // retraducción.
      const tocaCampoTraducible =
        "nombre" in cambios ||
        "categoria" in cambios ||
        "ubicacion_pais" in cambios ||
        "ubicacion_region" in cambios ||
        "alergenos_notas" in cambios;
      const saltaRetraduccionSinAnterior = tocaCampoTraducible && !anterior;
      if (saltaRetraduccionSinAnterior) {
        console.warn(`useVinos.actualizarVino: se salta la retraducción de "${id}" — sin estado previo en caché.`);
      }

      const cambiaTraducible = Boolean(
        anterior &&
          (("nombre" in cambios && cambios.nombre !== anterior.nombre) ||
            ("categoria" in cambios && cambios.categoria !== anterior.categoria) ||
            ("ubicacion_pais" in cambios && cambios.ubicacion_pais !== anterior.ubicacion_pais) ||
            ("ubicacion_region" in cambios && cambios.ubicacion_region !== anterior.ubicacion_region) ||
            ("alergenos_notas" in cambios && cambios.alergenos_notas !== anterior.alergenos_notas)),
      );

      // Traducir primero (no escribe nada), igual que en la creación. Si
      // falla, `traducciones` queda null y el guardado sigue igual (TAREA 2).
      let traducciones: Record<string, unknown> | null = null;
      if (cambiaTraducible) {
        traducciones = await traducirVino({
          nombre: (cambios.nombre ?? anterior?.nombre) || "",
          descripcion: (cambios.descripcion ?? anterior?.descripcion) || "",
          ingredientes: (cambios.ingredientes ?? anterior?.ingredientes) || "",
          categoria: (cambios.categoria ?? anterior?.categoria) || "",
          ubicacion_pais: (cambios.ubicacion_pais ?? anterior?.ubicacion_pais) || "",
          ubicacion_region: (cambios.ubicacion_region ?? anterior?.ubicacion_region) || "",
          alergenos_notas: (cambios.alergenos_notas ?? anterior?.alergenos_notas) || "",
        });
      }

      const { data, error } = await supabase
        .from("Vinos")
        .update({ ...cambios, ...(traducciones || {}) } as any)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;

      if (saltaRetraduccionSinAnterior) {
        toast.warning(
          "Vino actualizado, pero no se pudo comprobar si había que retraducirlo (la lista de vinos no estaba cargada). Vuelve a editarlo con la lista cargada para revisar el inglés/francés.",
        );
      } else if (cambiaTraducible && !traducciones) {
        toast.warning("Vino actualizado sin volver a traducir. Revísalo más tarde en inglés/francés.");
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vinos"] });
      avisar("Vino actualizado");
    },
    onError: (error) => {
      toast.error("Error al actualizar el vino");
      console.error(error);
    },
  });

  const eliminarVino = useMutation({
    mutationFn: async (id: string) => {
      // Best-effort: borramos la foto de Storage ANTES de borrar la fila
      // (después ya no hay dónde consultar imagen_url). Si algo falla aquí
      // -no se puede derivar la ruta, o el propio borrado del objeto falla-
      // NO debe impedir que se borre el registro; solo dejamos constancia
      // por consola (ver informe, TAREA 2).
      const anterior = queryClient.getQueryData<Vino[]>(["vinos"])?.find((v) => v.id === id);
      const ruta = rutaStorageDesdeUrl(anterior?.imagen_url);
      if (ruta) {
        const { error: storageError } = await supabase.storage.from("vinos").remove([ruta]);
        if (storageError) {
          console.error("No se pudo borrar la imagen del vino en Storage:", storageError);
        }
      } else if (anterior?.imagen_url) {
        console.warn("No se pudo derivar la ruta de Storage desde imagen_url:", anterior.imagen_url);
      }

      const { error } = await supabase
        .from("Vinos")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vinos"] });
      avisar("Vino eliminado");
    },
    onError: (error) => {
      toast.error("Error al eliminar el vino");
      console.error(error);
    },
  });

  const toggleActivado = useMutation({
    mutationFn: async ({ id, activado }: { id: string; activado: boolean; nombre?: string }) => {
      const { error } = await supabase
        .from("Vinos")
        .update({ activado })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: (_data, { activado, nombre }) => {
      queryClient.invalidateQueries({ queryKey: ["vinos"] });
      avisar(
        activado
          ? `${nombre || "Vino"} vuelve a estar activo`
          : `${nombre || "Vino"} despublicado: deja de verse en la web`,
      );
    },
    onError: (error) => {
      toast.error("Error al cambiar el estado");
      console.error(error);
    },
  });

  const toggleExpanded = useMutation({
    mutationFn: async ({ id, expanded }: { id: string; expanded: boolean; nombre?: string }) => {
      const { error } = await supabase
        .from("Vinos")
        .update({ expanded } as any)
        .eq("id", id);

      if (error) throw error;
    },
    // `expanded` se prerenderiza en la carta web, así que también hay que
    // republicar (antes no se hacía y el cambio no llegaba nunca a la web).
    onSuccess: (_data, { expanded, nombre }) => {
      queryClient.invalidateQueries({ queryKey: ["vinos"] });
      avisar(
        `${nombre || "Vino"} se mostrará ${expanded ? "expandido" : "normal"} en la carta web`,
      );
    },
    onError: (error) => {
      toast.error("Error al cambiar el estado de expandido");
      console.error(error);
    },
  });

  const toggleRestaurante = useMutation({
    mutationFn: async ({ id, restaurante }: { id: string; restaurante: boolean }) => {
      const { error } = await supabase
        .from("Vinos")
        .update({ restaurante })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vinos"] });
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
        .from("Vinos")
        .update({ touza })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vinos"] });
      avisar("Visibilidad en Touza actualizada");
    },
    onError: (error) => {
      toast.error("Error al cambiar visibilidad Touza");
      console.error(error);
    },
  });

  const categorias = vinos
    ? Array.from(new Set(vinos.map((v) => v.categoria).filter(Boolean))) as string[]
    : [];

  const denominaciones = vinos
    ? Array.from(new Set(vinos.map((v) => v.denominacion_origen).filter(Boolean))) as string[]
    : [];

  const regiones = vinos
    ? Array.from(new Set(vinos.map((v) => v.ubicacion_region).filter(Boolean))) as string[]
    : [];

  const paises = vinos
    ? Array.from(new Set(vinos.map((v) => v.ubicacion_pais).filter(Boolean))) as string[]
    : [];

  return {
    vinos,
    isLoading,
    categorias,
    denominaciones,
    regiones,
    paises,
    crearVino,
    actualizarVino,
    eliminarVino,
    toggleActivado,
    toggleExpanded,
    toggleRestaurante,
    toggleTouza,
  };
}
