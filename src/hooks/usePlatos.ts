import { normalizarUnidadPlato } from "@/lib/unidades-platos";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { borrarFotoSiNoSeUsa } from "@/lib/storage-carta";
import { toast } from "sonner";
import {
  combinarAlergenos,
  parseAlergenos,
  validarDeclaracionAlergenos,
} from "@/lib/alergenos";
import { notificarGuardadoYPublicacion } from "@/lib/rebuild-webs";
import {
  cambiosDeOrden,
  categoriasOrdenadas,
  consultarSiguienteOrden,
  guardarOrdenEnTabla,
  ordenarPorOrden,
} from "@/lib/orden-carta";

export interface Plato {
  id: string;
  nombre: string | null;
  categoria: string | null;
  precio_eur: number | null;
  descripcion: string | null;
  sin_gluten_disponible?: boolean | null;
  ingredientes: string | null;
  unidad: string | null;
  alergenos_oficiales: any;
  alergenos_inferidos: any;
  alergenos_notas: string | null;
  /** Posición dentro de la categoría (1, 2, 3…). Texto en BD hasta la migración
   * 20261101090000_carta_orden_entero; el panel lo trata siempre como número. */
  orden: string | number | null;
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

export interface NuevoPlato {
  nombre: string;
  categoria: string;
  precio_eur: number;
  descripcion?: string;
  sin_gluten_disponible?: boolean;
  ingredientes?: string;
  unidad?: string;
  alergenos_oficiales?: any;
  alergenos_notas?: string;
  /** Si no se indica, el plato va al final de su categoría. */
  orden?: number;
}

/**
 * Deja la lista de alérgenos en el vocabulario canónico (ver
 * `src/lib/alergenos.ts`): acepta snake_case antiguo, acentos, mayúsculas y
 * singular/plural, y devuelve siempre la misma forma sin duplicados. Es la
 * última barrera antes de escribir en BD, para que ningún formulario cuele
 * `frutos_cascara` junto a `frutos de cáscara`.
 */
function normalizarAlergenos(alergenos_oficiales: unknown): string[] {
  return combinarAlergenos(parseAlergenos(alergenos_oficiales));
}

/** Llama a traducir-contenido; nunca lanza. Si falla, devuelve null y el
 * caller guarda el plato igualmente sin traducción (ver informe, TAREA 2). */
async function traducirPlato(datos: {
  nombre: string;
  descripcion: string;
  ingredientes: string;
  categoria: string;
  alergenos: string[];
}): Promise<Record<string, unknown> | null> {
  try {
    const { data, error } = await supabase.functions.invoke(
      "traducir-contenido",
      {
        body: { tipo: "plato", datos },
      },
    );
    if (error || !data?.ok) {
      console.error("Traducción de plato no disponible:", error || data?.error);
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
  notificarGuardadoYPublicacion("plato", mensajeBase);
}

/** Firma canónica (orden alfabético, deduplicada) de una lista de alérgenos,
 * para comparar "¿cambió de verdad el conjunto?" sin que un mero reordenado
 * (p. ej. checkboxes repintadas en otro orden) dispare una retraducción. */
function alergenosKey(valor: unknown): string {
  return normalizarAlergenos(valor).slice().sort().join("|");
}

/** Deriva la ruta del objeto dentro del bucket "platos" a partir de la
 * imagen_url pública (formato de Supabase Storage: `.../object/public/<bucket>/<ruta>`,
 * posiblemente con `?t=` de cache-busting detrás, ver `EditarPlatoModal.tsx`).
 * Devuelve null si no hay imagen o si la URL no encaja con ese patrón, para
 * no intentar borrar nada por error (ver informe, TAREA 2). */
function rutaStorageDesdeUrl(
  imagenUrl: string | null | undefined,
): string | null {
  if (!imagenUrl) return null;
  try {
    const sinQuery = imagenUrl.split("?")[0].split("#")[0];
    const marcador = "/object/public/platos/";
    const indice = sinQuery.indexOf(marcador);
    if (indice === -1) return null;
    const ruta = sinQuery.slice(indice + marcador.length);
    return ruta ? decodeURIComponent(ruta) : null;
  } catch {
    return null;
  }
}

export function usePlatos() {
  const queryClient = useQueryClient();

  const { data: platos, isLoading } = useQuery({
    queryKey: ["platos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("Platos")
        .select("*")
        // Orden estable: si hay orden duplicado o null, evitamos reordenamientos al refrescar
        .order("orden", { ascending: true })
        .order("id", { ascending: true });

      if (error) throw error;
      // La BD ordena `orden` como texto ("10" antes que "2") mientras no se
      // aplique la migración a entero: aquí se reordena por número (estable,
      // así que a igual orden se respeta el desempate por id de la consulta).
      return ordenarPorOrden(
        ((data ?? []) as unknown as Plato[]).map((plato) => ({
          ...plato,
          unidad: normalizarUnidadPlato(plato.unidad),
        })),
      );
    },
  });

  const crearPlato = useMutation({
    mutationFn: async (nuevoPlato: NuevoPlato) => {
      const alergenosArray = validarDeclaracionAlergenos(
        normalizarAlergenos(nuevoPlato.alergenos_oficiales),
      );

      // 1. Traducir primero (no escribe nada; solo devuelve las columnas *_en/*_fr).
      const traducciones = await traducirPlato({
        nombre: nuevoPlato.nombre,
        descripcion: nuevoPlato.descripcion || "",
        ingredientes: nuevoPlato.ingredientes || "",
        categoria: nuevoPlato.categoria,
        alergenos: alergenosArray,
      });

      // 2. Al final de su categoría (mayor orden + 1), salvo que se indique.
      const orden =
        nuevoPlato.orden ??
        (await consultarSiguienteOrden(
          "Platos",
          nuevoPlato.categoria,
          queryClient.getQueryData<Plato[]>(["platos"]),
        ));

      // 3. El panel escribe su propia carta directamente contra Supabase (RLS detrás).
      const { data, error } = await supabase
        .from("Platos")
        .insert([
          {
            id: crypto.randomUUID(),
            nombre: nuevoPlato.nombre,
            categoria: nuevoPlato.categoria,
            precio_eur: nuevoPlato.precio_eur,
            descripcion: nuevoPlato.descripcion || null,
            ...(nuevoPlato.sin_gluten_disponible === true
              ? { sin_gluten_disponible: true }
              : {}),
            ingredientes: nuevoPlato.ingredientes || null,
            unidad: normalizarUnidadPlato(nuevoPlato.unidad),
            alergenos_oficiales:
              alergenosArray.length > 0 ? alergenosArray : null,
            alergenos_notas: nuevoPlato.alergenos_notas || null,
            orden,
            activado: true,
            expanded: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...(traducciones || {}),
          } as any,
        ])
        .select()
        .single();

      if (error) throw error;

      if (!traducciones) {
        toast.warning(
          "Plato guardado sin traducción automática. Revísala más tarde en inglés/francés.",
        );
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platos"] });
      avisar("Plato creado");
    },
    onError: (error) => {
      toast.error("Error al crear el plato");
      console.error(error);
    },
  });

  const actualizarPlato = useMutation({
    mutationFn: async ({ id, ...cambios }: Partial<Plato> & { id: string }) => {
      if ("unidad" in cambios)
        cambios.unidad = normalizarUnidadPlato(cambios.unidad);
      // Si la edición toca alérgenos, se guarda en vocabulario canónico.
      if ("alergenos_oficiales" in cambios) {
        const normalizados = validarDeclaracionAlergenos(
          normalizarAlergenos(cambios.alergenos_oficiales),
        );
        cambios.alergenos_oficiales =
          normalizados.length > 0 ? normalizados : null;
      }

      // Retraducir SOLO si cambia un campo que de verdad alimenta alguna
      // columna *_en/*_fr de Platos: nombre, descripcion, categoria o
      // alergenos_oficiales (-> alergenos_en/fr). `ingredientes` NO tiene
      // columna traducida en esta tabla (ver `traducir-contenido/prompts.ts`),
      // así que cambiarlo no dispara traducción. Comparamos contra el valor
      // anterior en caché (no contra "está presente en cambios") para que un
      // guardado de precio o de imagen_url/imagen_posicion_y (que reenvían
      // solo esa clave) nunca llame a la función de traducción.
      const anterior = queryClient
        .getQueryData<Plato[]>(["platos"])
        ?.find((p) => p.id === id);

      // Antes de aplicar la migración la columna no viene en select('*').
      // Una edición normal con la casilla apagada sigue guardándose.
      if (
        cambios.sin_gluten_disponible === false &&
        anterior &&
        anterior.sin_gluten_disponible === undefined
      ) {
        delete cambios.sin_gluten_disponible;
      }

      // GUARDA: si no hay `anterior` (caché fría, invalidada, o el id aún no
      // se cargó), NO se puede rellenar con seguridad lo que falte en
      // `cambios` -quedaría en "" o [] al traducir- ni comparar "¿cambió de
      // verdad?". Traducir con huecos machacaría nombre_en/categoria_en/
      // descripcion_en/alergenos_en BUENOS con la traducción de un payload
      // vacío (mismo patrón de corrupción silenciosa que el motor de OCR).
      // Mejor una traducción desactualizada que una corrompida: se guarda
      // igual con `cambios`, solo se salta la retraducción.
      const tocaCampoTraducible =
        "nombre" in cambios ||
        "descripcion" in cambios ||
        "categoria" in cambios ||
        "alergenos_oficiales" in cambios;
      const saltaRetraduccionSinAnterior = tocaCampoTraducible && !anterior;
      if (saltaRetraduccionSinAnterior) {
        console.warn(
          `usePlatos.actualizarPlato: se salta la retraducción de "${id}" — sin estado previo en caché.`,
        );
      }

      // Cambio de categoría: el plato pasa al final de la nueva (si no, se
      // quedaría con la posición que tenía en la otra, en medio de la lista).
      if (
        anterior &&
        "categoria" in cambios &&
        cambios.categoria &&
        cambios.categoria !== anterior.categoria &&
        !("orden" in cambios)
      ) {
        cambios.orden = await consultarSiguienteOrden(
          "Platos",
          cambios.categoria,
          queryClient.getQueryData<Plato[]>(["platos"]),
          id,
        );
      }

      const cambiaTraducible = Boolean(
        anterior &&
          (("nombre" in cambios && cambios.nombre !== anterior.nombre) ||
            ("descripcion" in cambios &&
              cambios.descripcion !== anterior.descripcion) ||
            ("categoria" in cambios &&
              cambios.categoria !== anterior.categoria) ||
            ("alergenos_oficiales" in cambios &&
              alergenosKey(cambios.alergenos_oficiales) !==
                alergenosKey(anterior.alergenos_oficiales))),
      );

      // Traducir primero (no escribe nada), igual que en la creación. Si
      // falla, `traducciones` queda null y el guardado sigue igual (TAREA 2).
      let traducciones: Record<string, unknown> | null = null;
      if (cambiaTraducible) {
        traducciones = await traducirPlato({
          nombre: (cambios.nombre ?? anterior?.nombre) || "",
          descripcion: (cambios.descripcion ?? anterior?.descripcion) || "",
          ingredientes: (cambios.ingredientes ?? anterior?.ingredientes) || "",
          categoria: (cambios.categoria ?? anterior?.categoria) || "",
          alergenos: normalizarAlergenos(
            cambios.alergenos_oficiales ?? anterior?.alergenos_oficiales,
          ),
        });
      }

      const { data, error } = await supabase
        .from("Platos")
        .update({ ...cambios, ...(traducciones || {}) } as any)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;

      if (saltaRetraduccionSinAnterior) {
        toast.warning(
          "Plato actualizado, pero no se pudo comprobar si había que retraducirlo (la lista de platos no estaba cargada). Vuelve a editarlo con la lista cargada para revisar el inglés/francés.",
        );
      } else if (cambiaTraducible && !traducciones) {
        toast.warning(
          "Plato actualizado sin volver a traducir. Revísalo más tarde en inglés/francés.",
        );
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platos"] });
      avisar("Plato actualizado");
    },
    onError: (error) => {
      toast.error("Error al actualizar el plato");
      console.error(error);
    },
  });

  const eliminarPlato = useMutation({
    mutationFn: async (id: string) => {
      // La URL de la foto se toma de la caché ANTES de borrar la fila. La
      // fila se borra primero: si falla, la foto sigue intacta (antes se
      // borraba la foto y, si la fila no se borraba, la ficha seguía en la
      // carta con la imagen rota). La foto se borra después, best-effort y
      // solo si ninguna otra ficha la usa.
      const anterior = queryClient
        .getQueryData<Plato[]>(["platos"])
        ?.find((p) => p.id === id);

      const { data: borradas, error } = await supabase
        .from("Platos")
        .delete()
        .eq("id", id)
        .select("id");

      if (error) throw error;
      // Con RLS, un DELETE sin permiso no da error: afecta a 0 filas.
      if (!borradas?.length) throw new Error("El plato no se ha eliminado: puede que ya no exista o que no tengas permiso.");

      const ruta = rutaStorageDesdeUrl(anterior?.imagen_url);
      if (ruta) {
        await borrarFotoSiNoSeUsa({ tabla: "Platos", bucket: "platos", ruta, excluirId: id });
      } else if (anterior?.imagen_url) {
        console.warn("No se pudo derivar la ruta de Storage desde imagen_url:", anterior.imagen_url);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platos"] });
      avisar("Plato eliminado");
    },
    onError: (error) => {
      toast.error("Error al eliminar el plato");
      console.error(error);
    },
  });

  const toggleActivado = useMutation({
    mutationFn: async ({
      id,
      activado,
    }: {
      id: string;
      activado: boolean;
      nombre?: string;
    }) => {
      const { error } = await supabase
        .from("Platos")
        .update({ activado })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: (_data, { activado, nombre }) => {
      queryClient.invalidateQueries({ queryKey: ["platos"] });
      avisar(
        activado
          ? `${nombre || "Plato"} vuelve a estar activo`
          : `${nombre || "Plato"} despublicado: deja de verse en la web`,
      );
    },
    onError: (error) => {
      toast.error("Error al cambiar el estado");
      console.error(error);
    },
  });

  const toggleExpanded = useMutation({
    mutationFn: async ({
      id,
      expanded,
    }: {
      id: string;
      expanded: boolean;
      nombre?: string;
    }) => {
      const { error } = await supabase
        .from("Platos")
        .update({ expanded })
        .eq("id", id);

      if (error) throw error;
    },
    // `expanded` se prerenderiza en la carta web, así que también hay que
    // republicar (antes no se hacía y el cambio no llegaba nunca a la web).
    onSuccess: (_data, { expanded, nombre }) => {
      queryClient.invalidateQueries({ queryKey: ["platos"] });
      avisar(
        `${nombre || "Plato"} se mostrará ${expanded ? "expandido" : "normal"} en la carta web`,
      );
    },
    onError: (error) => {
      toast.error("Error al cambiar el estado de expandido");
      console.error(error);
    },
  });

  /**
   * Guarda el orden de una categoría: `idsEnOrden` pasa a ser 1, 2, 3… (solo
   * se escriben los que cambian) y se republica la web, como cualquier otro
   * cambio de la carta.
   */
  const guardarOrden = useMutation({
    mutationFn: async ({ idsEnOrden }: { categoria: string; idsEnOrden: string[] }) => {
      const actuales = queryClient.getQueryData<Plato[]>(["platos"]) ?? [];
      const cambios = cambiosDeOrden(actuales, idsEnOrden);
      await guardarOrdenEnTabla("Platos", cambios);
      return cambios.length;
    },
    onSuccess: (escritos, { categoria }) => {
      queryClient.invalidateQueries({ queryKey: ["platos"] });
      if (escritos > 0) avisar(`Orden de «${categoria}» guardado`);
    },
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey: ["platos"] });
      toast.error(error instanceof Error ? error.message : "No se ha podido guardar el orden");
      console.error(error);
    },
  });

  const toggleRestaurante = useMutation({
    mutationFn: async ({
      id,
      restaurante,
    }: {
      id: string;
      restaurante: boolean;
    }) => {
      const { error } = await supabase
        .from("Platos")
        .update({ restaurante })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platos"] });
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
        .from("Platos")
        .update({ touza })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platos"] });
      avisar("Visibilidad en Touza actualizada");
    },
    onError: (error) => {
      toast.error("Error al cambiar visibilidad Touza");
      console.error(error);
    },
  });

  // Alfabéticas: así no cambian de sitio al reordenar los platos.
  const categorias = categoriasOrdenadas(platos);

  const unidades = platos
    ? Array.from(new Set(platos.map((p) => normalizarUnidadPlato(p.unidad))))
    : [];

  return {
    platos,
    isLoading,
    categorias,
    unidades,
    crearPlato,
    actualizarPlato,
    eliminarPlato,
    toggleActivado,
    toggleExpanded,
    guardarOrden,
    toggleRestaurante,
    toggleTouza,
  };
}
