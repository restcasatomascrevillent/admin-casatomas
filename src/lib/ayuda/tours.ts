// ---------------------------------------------------------------------------
// Tours guiados del panel (driver.js), uno por sección.
//
// Cada paso apunta a un elemento marcado con `data-tour="<id>"` en la pantalla
// real. Si el elemento no está en pantalla al lanzar el tour (otra pestaña,
// pantalla estrecha, sin permiso):
//   · paso `opcional`: se salta;
//   · paso normal: se enseña igual, centrado y sin resaltar nada.
//
// Para añadir una sección: un id en `SeccionAyuda`, sus pasos en `TOURS`, los
// `data-tour` en sus componentes y un <BotonAyuda seccion="..." /> en su
// cabecera. Su ficha del Centro de Ayuda va en `centroAyuda.ts`.
// Texto: para el dueño y el personal; llano, de tú, sin palabras técnicas.
// ---------------------------------------------------------------------------

export type SeccionAyuda = "facturas" | "gestor-web";

export type LadoPaso = "top" | "right" | "bottom" | "left";

export interface PasoTour {
  /** Valor de `data-tour` del elemento a resaltar. Sin él, el paso sale centrado. */
  elemento?: string;
  titulo: string;
  texto: string;
  /** Si el elemento no está a la vista, el paso se salta en vez de salir centrado. */
  opcional?: boolean;
  lado?: LadoPaso;
}

/** Marca del botón «?» de cada cabecera (lo pone `BotonAyuda`). */
export const TOUR_BOTON_AYUDA = "boton-ayuda";

const PASO_FINAL: PasoTour = {
  elemento: TOUR_BOTON_AYUDA,
  titulo: "¿Quieres repasarlo?",
  texto:
    "Pulsa este botón «?» siempre que quieras volver a ver este recorrido. En «Ayuda», en el menú de la izquierda, tienes además las preguntas más frecuentes.",
  lado: "bottom",
};

export const TOURS: Record<SeccionAyuda, PasoTour[]> = {
  facturas: [
    {
      titulo: "Facturas y albaranes",
      texto:
        "Aquí guardas todas las facturas y albaranes de los proveedores. Les haces una foto, la aplicación los lee sola y luego puedes buscar qué compraste, a quién y a qué precio. Te enseñamos lo importante en un minuto.",
    },
    {
      elemento: "facturas-pestana-cargar",
      titulo: "1. Subir una factura",
      texto:
        "En «Cargar» haces una foto con la tablet o eliges un PDF o una imagen. Puedes subir varias a la vez. La aplicación lee sola el proveedor, la fecha, los productos, los precios y el IVA. Tarda unos segundos y puedes seguir trabajando mientras: te avisa al terminar.",
      lado: "bottom",
    },
    {
      elemento: "facturas-pestana-compras",
      titulo: "2. Ver lo que has comprado",
      texto:
        "En «Compras» está todo lo que se ha leído: facturas, albaranes, productos y proveedores. Es la pestaña que más vas a usar.",
      lado: "bottom",
    },
    {
      elemento: "facturas-buscar",
      titulo: "Buscar",
      texto:
        "Escribe lo que buscas: un producto («aceite»), un proveedor o un número de factura. Busca en todo a la vez.",
      opcional: true,
      lado: "bottom",
    },
    {
      elemento: "facturas-modos",
      titulo: "Tres formas de mirar",
      texto:
        "«Documentos» enseña las facturas y albaranes; «Productos», lo que compras y cómo cambia su precio; «Proveedores», cuánto le compras a cada uno. El número indica cuántos resultados hay.",
      opcional: true,
      lado: "bottom",
    },
    {
      elemento: "facturas-filtros",
      titulo: "Filtros rápidos",
      texto:
        "Toca un filtro para ver solo una parte: solo facturas, solo albaranes, los albaranes que aún no tienen factura, los que tienen avisos o los que nadie ha revisado todavía.",
      opcional: true,
      lado: "bottom",
    },
    {
      elemento: "facturas-lista",
      titulo: "La lista y sus avisos",
      texto:
        "Los documentos van por meses y, dentro, por proveedor. Si algo no cuadra sale un aviso en rojo o naranja que dice qué pasa: «IVA no cuadra», «Precio extremo», «Sin total»… Las facturas que cuadran se marcan solas («Revisada auto»); solo tienes que mirar las que salen en rojo y las que pone «Sin revisar».",
      opcional: true,
      lado: "right",
    },
    {
      elemento: "facturas-ficha",
      titulo: "La ficha del documento",
      texto:
        "Toca un documento para abrir su ficha. Con «Ver original» ves la foto o el PDF tal cual se subió. Con «Editar» corriges lo que se haya leído mal y, si está bien, activas «Marcar como verificada» para que pase a «Revisada». En los albaranes ves también a qué factura pertenecen.",
      opcional: true,
      lado: "left",
    },
    {
      elemento: "facturas-pestana-ia",
      titulo: "3. Preguntar a la IA",
      texto:
        "En «IA» le preguntas con tus palabras, como a una persona: «¿Cuánto gastamos en carne en septiembre?» o «¿Qué proveedor nos vende más caro el aceite?». Responde con los datos de tus facturas.",
      lado: "bottom",
    },
    PASO_FINAL,
  ],

  "gestor-web": [
    {
      elemento: "gw-intro",
      titulo: "Gestor Web",
      texto:
        "Desde aquí cambias lo que se ve en las webs de Casa Tomás y Touza: la carta, las novedades, el menú del día y las tapas. Lo que guardas aquí es lo que ven los clientes.",
      lado: "bottom",
    },
    {
      elemento: "gw-pestana-carta",
      titulo: "Carta",
      texto: "Platos, bebidas, vinos y cócteles: precios, descripciones, alérgenos, fotos y en qué web se ven.",
      opcional: true,
      lado: "bottom",
    },
    {
      elemento: "gw-pestana-novedades",
      titulo: "Novedades",
      texto: "Las tarjetas de «Novedades» de la web de Casa Tomás: un plato nuevo, un evento, una oferta…",
      opcional: true,
      lado: "bottom",
    },
    {
      elemento: "gw-pestana-menus",
      titulo: "Menús diarios",
      texto: "El menú del día: primero, segundo y postre para cada fecha.",
      opcional: true,
      lado: "bottom",
    },
    {
      elemento: "gw-pestana-tapas",
      titulo: "Tapas",
      texto: "Las tapas del día, una por línea, para cada fecha.",
      opcional: true,
      lado: "bottom",
    },
    // --- Carta (solo si estás en esa pestaña) ---
    {
      elemento: "gw-carta-secciones",
      titulo: "Secciones de la carta",
      texto: "Elige qué quieres tocar: platos, bebidas, vinos o cócteles. El número es cuántos hay.",
      opcional: true,
      lado: "bottom",
    },
    {
      elemento: "gw-carta-acciones",
      titulo: "Añadir y subir precios",
      texto:
        "«Añadir» crea uno nuevo; se escribe en español y se traduce solo al inglés y al francés. «Ajustar precios» sube o baja de golpe los precios de una categoría entera.",
      opcional: true,
      lado: "bottom",
    },
    {
      elemento: "gw-carta-filtros",
      titulo: "Buscar y filtrar",
      texto:
        "Busca por nombre o filtra por categoría y por lo que se ve u oculta en cada web. En cada plato tienes interruptores para mostrarlo u ocultarlo en Casa Tomás o en Touza, y los botones «Editar» y «Eliminar».",
      opcional: true,
      lado: "bottom",
    },
    // --- Novedades ---
    {
      elemento: "gw-novedades-nueva",
      titulo: "Nueva novedad",
      texto:
        "Pulsa aquí para crear una. Escribe un título y unas ideas, y si quieres pulsa «Redactar con IA» para que te deje el texto bonito. Puedes añadir una foto.",
      opcional: true,
      lado: "bottom",
    },
    {
      elemento: "gw-novedades-publicacion",
      titulo: "Cuándo se ve",
      texto:
        "Decide si se ve en la web, si sale la primera (destacada) y entre qué fechas. Al quitar «Visible en la web» se guarda sin enseñarse.",
      opcional: true,
      lado: "top",
    },
    {
      elemento: "gw-novedades-vista",
      titulo: "Así queda en el móvil",
      texto: "Aquí ves cómo quedará la tarjeta en el móvil de un cliente antes de guardarla.",
      opcional: true,
      lado: "left",
    },
    // --- Menús diarios y tapas ---
    {
      elemento: "gw-menu-interruptor",
      titulo: "Mostrar u ocultar en la web",
      texto:
        "Con este interruptor enseñas u ocultas el botón en la web de Casa Tomás (por ejemplo, en vacaciones). Lo guardado no se borra.",
      opcional: true,
      lado: "bottom",
    },
    {
      elemento: "gw-menu-formulario",
      titulo: "Escribir el del día",
      texto:
        "Elige la fecha, escribe en español y guarda: se traduce solo al inglés y al francés. Para cambiar uno ya guardado, tócalo en la lista de arriba.",
      opcional: true,
      lado: "top",
    },
    PASO_FINAL,
  ],
};

export const selectorTour = (id: string): string => `[data-tour="${id}"]`;

/**
 * Pasos que se enseñan, con el elemento ya resuelto. `buscar` devuelve el
 * elemento visible para un id (o null). Un paso opcional sin elemento se
 * salta; uno normal sin elemento se enseña centrado.
 */
export function resolverPasos<E>(
  pasos: PasoTour[],
  buscar: (id: string) => E | null,
): { paso: PasoTour; elemento: E | null }[] {
  const resultado: { paso: PasoTour; elemento: E | null }[] = [];
  for (const paso of pasos) {
    const elemento = paso.elemento ? buscar(paso.elemento) : null;
    if (paso.elemento && !elemento && paso.opcional) continue;
    resultado.push({ paso, elemento });
  }
  return resultado;
}

/** Clave de localStorage: «ya ha visto el tour» por sección y usuario. */
export const claveTourVisto = (seccion: SeccionAyuda, usuarioId?: string | null): string =>
  `ayuda:tour-visto:${seccion}:${usuarioId ?? "anonimo"}`;

/** Estado que se pasa al navegar (`navigate(ruta, { state })`) para lanzar el tour al llegar. */
export interface EstadoLanzarTour {
  lanzarTour: SeccionAyuda;
}

export const esEstadoLanzarTour = (estado: unknown): estado is EstadoLanzarTour =>
  typeof estado === "object" &&
  estado !== null &&
  typeof (estado as { lanzarTour?: unknown }).lanzarTour === "string" &&
  (estado as { lanzarTour: string }).lanzarTour in TOURS;
