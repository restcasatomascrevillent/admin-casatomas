import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { notificarGuardadoYPublicacion } from "@/lib/rebuild-webs";
import { combinarAlergenos, parseAlergenos } from "@/lib/alergenos";
import { borrarFotoSiNoSeUsa } from "@/lib/storage-carta";
import {
  cambiosDeOrden,
  categoriasOrdenadas,
  consultarSiguienteOrden,
  guardarOrdenEnTabla,
  ordenarPorOrden,
} from "@/lib/orden-carta";
import { MENSAJE_CATEGORIA_PENDIENTE, mensajeNoPublicarSinOrigen, origenVinoClaro } from "@/lib/origen-vino";
import { esCategoriaOrigenPendiente } from "@/lib/tipos-vino";
import { vinoPublicado, type CartasVino } from "@/components/carta/publicacionVino";

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
  alergenos_oficiales: unknown;
  alergenos_inferidos: unknown;
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
  /** Se sirve por copas y su precio (20261104140000_vinos_copeo_y_parker). */
  copeo?: boolean | null;
  precio_copa_eur?: number | null;
  /**
   * Puntos Parker / Wine Advocate que enseña la web y su añada (08/11/2026: los
   * calcula la BD desde vinos_puntuacion_parker, solo verificadas y de la
   * añada que se sirve; no se escriben desde el panel). Texto: «94», «94+», «93–95».
   */
  puntuacion_parker?: number | null;
  puntuacion_parker_anada?: number | null;
  puntuacion_parker_texto?: string | null;
  /** Añada que se sirve y «sin añada» (NV) (20261118100000). */
  anada?: number | null;
  sin_anada?: boolean | null;
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
  alergenos_oficiales?: unknown;
  alergenos_notas?: string;
  /** Si no se indica, el vino va al final de su categoría. */
  orden?: number;
  copeo?: boolean;
  precio_copa_eur?: number | null;
  anada?: number | null;
  sin_anada?: boolean;
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

/**
 * Aviso de un fallo al guardar: si es la regla del origen (la del panel o la
 * del trigger de la BD, ambas en castellano), su mensaje tal cual, que dice qué
 * falta; si no, el genérico.
 */
function avisarFallo(error: unknown, generico: string) {
  const mensaje =
    error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : "";
  toast.error(/origen|denominación|el país y la región/i.test(mensaje) ? mensaje : generico);
  console.error(error);
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
      // Orden numérico en cliente (en BD `orden` es texto hasta la migración).
      return ordenarPorOrden(data as unknown as Vino[]);
    },
  });

  const crearVino = useMutation({
    mutationFn: async (nuevoVino: NuevoVino) => {
      const pais = nuevoVino.ubicacion_pais?.trim();
      const region = nuevoVino.ubicacion_region?.trim();
      if (!pais || !region) {
        throw new Error("Indica el país y la región para situar el vino en el mapa");
      }
      // Origen claro también en la categoría (04/11/2026): nada de «… — ORIGEN PENDIENTE».
      if (esCategoriaOrigenPendiente(nuevoVino.categoria)) {
        throw new Error(MENSAJE_CATEGORIA_PENDIENTE);
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
      // Al final de su categoría (mayor orden + 1), salvo que se indique.
      const orden =
        nuevoVino.orden ??
        (await consultarSiguienteOrden("Vinos", nuevoVino.categoria, queryClient.getQueryData<Vino[]>(["vinos"])));

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
            orden,
            // Copa y añada solo si vienen (20261104140000, 20261118100000): sin
            // ellos el alta sigue funcionando aunque las columnas aún no existan.
            // La puntuación Parker no se escribe aquí: la calcula la BD.
            ...(nuevoVino.copeo !== undefined ? { copeo: nuevoVino.copeo } : {}),
            ...(nuevoVino.precio_copa_eur !== undefined ? { precio_copa_eur: nuevoVino.precio_copa_eur } : {}),
            ...(nuevoVino.anada !== undefined ? { anada: nuevoVino.anada } : {}),
            ...(nuevoVino.sin_anada !== undefined ? { sin_anada: nuevoVino.sin_anada } : {}),
            // Publicado en las dos cartas (activado = restaurante OR touza; la
            // BD lo recalcula, ver guardarCartas).
            restaurante: true,
            touza: true,
            activado: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...(traducciones || {}),
            // `orden` es entero en BD; los tipos generados aún dicen texto.
          } as unknown as TablesInsert<"Vinos">,
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
    onError: (error) => avisarFallo(error, "Error al añadir el vino"),
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

      // Cambio de categoría: el vino pasa al final de la nueva.
      if (
        anterior &&
        "categoria" in cambios &&
        cambios.categoria &&
        cambios.categoria !== anterior.categoria &&
        !("orden" in cambios)
      ) {
        cambios.orden = await consultarSiguienteOrden(
          "Vinos",
          cambios.categoria,
          queryClient.getQueryData<Vino[]>(["vinos"]),
          id,
        );
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
        .update({ ...cambios, ...(traducciones || {}) } as unknown as TablesUpdate<"Vinos">)
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
    onError: (error) => avisarFallo(error, "Error al actualizar el vino"),
  });

  const eliminarVino = useMutation({
    mutationFn: async (id: string) => {
      // La URL de la foto se toma de la caché ANTES de borrar la fila. La
      // fila se borra primero: si falla, la foto sigue intacta (antes se
      // borraba la foto y, si la fila no se borraba, el vino seguía en la
      // carta con la imagen rota). La foto se borra después, best-effort y
      // solo si ninguna otra ficha la usa (la Magnum comparte la de la
      // botella normal).
      const anterior = queryClient.getQueryData<Vino[]>(["vinos"])?.find((v) => v.id === id);

      const { data: borradas, error } = await supabase
        .from("Vinos")
        .delete()
        .eq("id", id)
        .select("id");

      if (error) throw error;
      // Con RLS, un DELETE sin permiso no da error: afecta a 0 filas.
      if (!borradas?.length) throw new Error("El vino no se ha eliminado: puede que ya no exista o que no tengas permiso.");

      const ruta = rutaStorageDesdeUrl(anterior?.imagen_url);
      if (ruta) {
        await borrarFotoSiNoSeUsa({ tabla: "Vinos", bucket: "vinos", ruta, excluirId: id });
      } else if (anterior?.imagen_url) {
        console.warn("No se pudo derivar la ruta de Storage desde imagen_url:", anterior.imagen_url);
      }
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

  /**
   * Guarda el orden de una categoría: `idsEnOrden` pasa a ser 1, 2, 3… (solo
   * se escriben los que cambian) y se republica la web.
   */
  const guardarOrden = useMutation({
    mutationFn: async ({ idsEnOrden }: { categoria: string; idsEnOrden: string[] }) => {
      const actuales = queryClient.getQueryData<Vino[]>(["vinos"]) ?? [];
      const cambios = cambiosDeOrden(actuales, idsEnOrden);
      await guardarOrdenEnTabla("Vinos", cambios);
      return cambios.length;
    },
    onSuccess: (escritos, { categoria }) => {
      queryClient.invalidateQueries({ queryKey: ["vinos"] });
      if (escritos > 0) avisar(`Orden de «${categoria}» guardado`);
    },
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey: ["vinos"] });
      toast.error(error instanceof Error ? error.message : "No se ha podido guardar el orden");
      console.error(error);
    },
  });

  const toggleExpanded = useMutation({
    mutationFn: async ({ id, expanded }: { id: string; expanded: boolean; nombre?: string }) => {
      const { error } = await supabase
        .from("Vinos")
        .update({ expanded })
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

  /**
   * «Restaurante» y «Touza» son los únicos interruptores de publicación de un
   * vino (04/11/2026): se guardan los dos como se ven en la tarjeta y
   * `activado` = restaurante OR touza. La BD lo recalcula igual (trigger de la
   * migración 20261104100000); se manda también para que el panel funcione
   * aunque la BD aún no tenga la migración. Para encender una carta hace falta
   * el origen claro (país, región y denominación; la BD también lo exige).
   */
  const guardarCartas = async (id: string, cartas: CartasVino, enciende: boolean) => {
    const anterior = queryClient.getQueryData<Vino[]>(["vinos"])?.find((v) => v.id === id);
    if (enciende && anterior && !origenVinoClaro(anterior)) {
      throw new Error(mensajeNoPublicarSinOrigen(anterior));
    }
    const { error } = await supabase
      .from("Vinos")
      .update({ ...cartas, activado: vinoPublicado(cartas) })
      .eq("id", id);

    if (error) throw error;
  };

  const toggleRestaurante = useMutation({
    /** `touza`: cómo está la otra carta en la tarjeta (se guarda tal cual). */
    mutationFn: async ({ id, restaurante, touza }: { id: string; restaurante: boolean; touza: boolean }) =>
      guardarCartas(id, { restaurante, touza }, restaurante),
    onSuccess: (_data, { restaurante }) => {
      queryClient.invalidateQueries({ queryKey: ["vinos"] });
      avisar(restaurante ? "Publicado en la carta de Casa Tomás" : "Quitado de la carta de Casa Tomás");
    },
    onError: (error) => avisarFallo(error, "Error al cambiar la carta de Casa Tomás"),
  });

  const toggleTouza = useMutation({
    /** `restaurante`: cómo está la otra carta en la tarjeta (se guarda tal cual). */
    mutationFn: async ({ id, touza, restaurante }: { id: string; touza: boolean; restaurante: boolean }) =>
      guardarCartas(id, { restaurante, touza }, touza),
    onSuccess: (_data, { touza }) => {
      queryClient.invalidateQueries({ queryKey: ["vinos"] });
      avisar(touza ? "Publicado en la carta de Touza" : "Quitado de la carta de Touza");
    },
    onError: (error) => avisarFallo(error, "Error al cambiar la carta de Touza"),
  });

  // Alfabéticas: así no cambian de sitio al reordenar.
  const categorias = categoriasOrdenadas(vinos);

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
    guardarOrden,
    toggleExpanded,
    toggleRestaurante,
    toggleTouza,
  };
}
