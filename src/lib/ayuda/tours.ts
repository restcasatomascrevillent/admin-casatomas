// ---------------------------------------------------------------------------
// Tours guiados del panel (driver.js), uno por sección.
//
// Cada paso apunta a un elemento marcado con `data-tour="<id>"` en la pantalla
// real. Si el paso dice `pestana` (el `data-tour` del botón de una pestaña, o
// la cadena pestaña › subpestaña), el tour la abre antes de enseñarlo (solo cambia de pestaña: nunca
// rellena ni guarda nada) y espera a que el elemento aparezca. Si aun así no
// está a la vista (pantalla estrecha, sin permiso, sin datos):
//   · paso `opcional`: se salta;
//   · paso normal: se enseña igual, centrado y sin resaltar nada.
// Al terminar o cerrar el tour se vuelve a la pestaña en la que estabas.
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
  /**
   * `data-tour` del botón de la pestaña que hay que abrir antes de este paso.
   * Si es una subpestaña, la cadena desde la pestaña de fuera, en orden
   * (p. ej. `[Carta, Vinos]`): así se llega también yendo hacia atrás.
   */
  pestana?: string | string[];
  /**
   * `data-tour` de un botón desplegable (con `aria-expanded`) que hay que
   * desplegar para que el elemento se vea. Solo despliega: nunca envía nada.
   */
  abrir?: string;
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

const F_CARGAR = "facturas-pestana-cargar";
const F_COMPRAS = "facturas-pestana-compras";
const F_IA = "facturas-pestana-ia";
const GW_CARTA = "gw-pestana-carta";
const GW_CARTA_VINOS = "gw-carta-vinos";
const GW_NOVEDADES = "gw-pestana-novedades";
const GW_MENUS = "gw-pestana-menus";
const GW_TAPAS = "gw-pestana-tapas";

export const TOURS: Record<SeccionAyuda, PasoTour[]> = {
  facturas: [
    {
      titulo: "Facturas y albaranes",
      texto:
        "Aquí guardas todas las facturas y albaranes de los proveedores. Les haces una foto, la aplicación los lee sola, revisa que cuadren y luego puedes buscar qué compraste, a quién y a qué precio. Te enseñamos lo importante en un par de minutos: el recorrido va abriendo cada pestaña solo.",
    },
    // --- Cargar ---
    {
      elemento: F_CARGAR,
      pestana: F_CARGAR,
      titulo: "1. Subir una factura",
      texto:
        "En «Cargar» subes las facturas y los albaranes. La aplicación lee sola el proveedor, la fecha, los productos, los precios y el IVA. Tarda unos segundos y puedes seguir trabajando mientras: te avisa al terminar.",
      lado: "bottom",
    },
    {
      elemento: "facturas-cargar-botones",
      pestana: F_CARGAR,
      titulo: "Foto o archivo",
      texto:
        "«Hacer foto» abre la cámara de la tablet; «Elegir archivos» te deja escoger un PDF o una imagen. Puedes subir varios a la vez. Si un documento tiene varias hojas, haz una foto a cada una, márcalas y pulsa «Unir … fotos como un documento»: se leen como páginas 1, 2, 3… Si subes uno que ya estaba, no se duplica: te pregunta si lo sustituyes o dejas el que hay.",
      opcional: true,
      lado: "bottom",
    },
    {
      elemento: "facturas-coste-lectura",
      pestana: F_CARGAR,
      titulo: "Lo que cuesta leerlas",
      texto:
        "Aquí ves lo que lleva gastado este mes la lectura de documentos con IA y cuánto sale cada uno (céntimos). Tócalo para ver el detalle.",
      opcional: true,
      lado: "left",
    },
    // --- Compras ---
    {
      elemento: F_COMPRAS,
      pestana: F_COMPRAS,
      titulo: "2. Ver lo que has comprado",
      texto:
        "En «Compras» está todo lo que se ha leído: facturas, albaranes, productos y proveedores. Es la pestaña que más vas a usar.",
      lado: "bottom",
    },
    {
      elemento: "facturas-buscar",
      pestana: F_COMPRAS,
      titulo: "Buscar",
      texto:
        "Escribe lo que buscas: un producto («aceite»), un proveedor o un número de factura. Busca en todo a la vez.",
      opcional: true,
      lado: "bottom",
    },
    {
      elemento: "facturas-modos",
      pestana: F_COMPRAS,
      titulo: "Tres formas de mirar",
      texto:
        "«Documentos» enseña las facturas y albaranes. «Productos», lo que compras, cuánto gastas por categoría, qué ha subido de precio y cómo ha cambiado cada precio. «Proveedores», de más a menos gasto; toca uno y se despliega con sus datos y sus facturas por meses. El número indica cuántos resultados hay para lo que has buscado.",
      opcional: true,
      lado: "bottom",
    },
    {
      elemento: "facturas-local-periodo",
      pestana: F_COMPRAS,
      titulo: "Local y periodo",
      texto:
        "Elige de qué local quieres ver las compras (Casa Tomás, Touza o los dos) y de qué periodo: este mes, el anterior, el trimestre, el año o todo. Cambian las listas y sus totales.",
      opcional: true,
      lado: "bottom",
    },
    {
      elemento: "facturas-filtros",
      pestana: F_COMPRAS,
      titulo: "Filtros rápidos",
      texto:
        "Toca un filtro para ver solo una parte: solo facturas, solo albaranes, los albaranes que aún no tienen factura, los abonos, los que tienen avisos o los que nadie ha revisado todavía.",
      opcional: true,
      lado: "bottom",
    },
    {
      elemento: "facturas-lista",
      pestana: F_COMPRAS,
      titulo: "La lista, ordenada por meses",
      texto:
        "La lista ocupa todo el ancho, por meses (con cuántos documentos hay, cuánto suman y lo que restan los abonos). Cada fila: fecha, proveedor, número, marcas e importe. Toca un mes para plegarlo o desplegarlo. Un albarán que ya está en una factura sale tachado y no suma, para no contarlo dos veces.",
      opcional: true,
      lado: "top",
    },
    {
      elemento: "facturas-ficha",
      pestana: F_COMPRAS,
      titulo: "Avisos y revisión automática",
      texto:
        "Toca un documento y su ficha ocupa toda la pantalla; «Volver a la lista» te devuelve a la lista tal como estaba. Si algo no cuadra sale un aviso en rojo o naranja que dice qué pasa: «IVA no cuadra», «Precio extremo», «Sin total»… (tócalo y te lo explica). Las que cuadran se marcan solas como «Revisada auto»: solo tienes que mirar las que tienen avisos y las que pone «Sin revisar».",
      opcional: true,
      lado: "left",
    },
    {
      elemento: "facturas-ficha-acciones",
      pestana: F_COMPRAS,
      titulo: "Ver, corregir o preguntar",
      texto:
        "«Original» abre la foto o el PDF en otra pestaña. «Editar» corrige la cabecera (proveedor, número, fecha, importes) y tiene el interruptor «Marcar como verificada»; las líneas se corrigen con el lápiz de cada una. «IA» le pregunta al asistente por este documento.",
      opcional: true,
      lado: "left",
    },
    {
      elemento: "facturas-ficha-vinculo",
      pestana: F_COMPRAS,
      titulo: "Albaranes y facturas, unidos",
      texto:
        "En una factura ves los albaranes que recoge y un cotejo producto a producto: lo entregado contra lo cobrado, con las diferencias en color. En un albarán ves en qué factura está o, si aún no tiene, «Asociar a factura».",
      opcional: true,
      lado: "left",
    },
    {
      elemento: "facturas-original",
      pestana: F_COMPRAS,
      titulo: "El papel original, con zoom",
      texto:
        "Al final de la ficha está la foto del documento. Amplía con los botones + y −, con dos dedos o con Ctrl + rueda; arrastra para moverte, doble toque para acercar, gírala si salió torcida o ábrela a pantalla completa. Así comparas lo leído con el papel sin salir de aquí.",
      opcional: true,
      lado: "left",
    },
    // --- IA (solo se señala: el tour nunca envía preguntas, cuestan dinero) ---
    {
      elemento: F_IA,
      pestana: F_IA,
      titulo: "3. Análisis con gráficas",
      texto:
        "En «Análisis» le preguntas a la aplicación por tus compras, con tus palabras, y las gráficas se quedan en un tablero. Responde con los datos de tus facturas y albaranes. Te enseñamos sus partes.",
      lado: "bottom",
    },
    {
      elemento: "facturas-gasto-ia",
      pestana: F_IA,
      titulo: "Lo que cuesta la IA",
      texto:
        "Aquí arriba ves lo que ha costado este mes preguntar al asistente (suelen ser céntimos). Tócalo para ver el detalle. Si se acerca al tope de gasto, se pone en naranja o en rojo.",
      opcional: true,
      lado: "bottom",
    },
    {
      elemento: "facturas-ia-historial",
      pestana: F_IA,
      titulo: "Tus conversaciones",
      texto:
        "Aquí se guardan los análisis que ya has hecho, con su fecha. Toca uno para volver a él con sus gráficas y seguir donde lo dejaste. «Nuevo» empieza de cero.",
      opcional: true,
      lado: "bottom",
    },
    {
      elemento: "facturas-ia-tablero",
      pestana: F_IA,
      titulo: "El tablero de gráficas",
      texto:
        "Cada gráfica que pidas se queda aquí como una tarjeta, la más nueva arriba. Toca una para seleccionarla: lo siguiente que preguntes irá sobre ella. Debajo tienes botones para preguntar más («solo los últimos 3 meses», «¿por qué subió?»). La X la quita.",
      opcional: true,
      lado: "right",
    },
    {
      elemento: "facturas-ia-sugerencias",
      pestana: F_IA,
      titulo: "Preguntas de ejemplo",
      texto:
        "Si no sabes por dónde empezar, toca una de estas: «¿Cuánto hemos gastado en octubre?», las facturas de un proveedor, sus albaranes de esta semana o lo que más compráis. Se pregunta sola al tocarla.",
      opcional: true,
      lado: "top",
    },
    {
      elemento: "facturas-ia-al-instante",
      pestana: F_IA,
      abrir: "facturas-ia-al-instante-abrir",
      titulo: "Al instante",
      texto:
        "Son las respuestas rápidas: salen al momento, sin escribir y sin gastar IA. Gasto de este mes, gasto por mes, mejores proveedores, productos más comprados, documentos por revisar, con avisos o sin total, gasto por categoría, qué ha subido de precio y la evolución del precio de un producto.",
      opcional: true,
      lado: "top",
    },
    {
      elemento: "facturas-ia-pregunta",
      pestana: F_IA,
      titulo: "Escribe tu pregunta",
      texto:
        "Para todo lo demás, escríbela aquí con tus palabras y pulsa la flecha para enviarla. Por ejemplo: «¿Cuánto gastamos en carne en septiembre?» o «¿Qué proveedor nos vende más caro el aceite?».",
      opcional: true,
      lado: "top",
    },
    PASO_FINAL,
  ],

  "gestor-web": [
    {
      elemento: "gw-intro",
      titulo: "Gestor Web",
      texto:
        "Desde aquí cambias lo que se ve en las webs de Casa Tomás y Touza: la carta, las novedades, el menú del día y las tapas. Lo que guardas aquí es lo que ven los clientes. El recorrido va abriendo cada pestaña solo.",
      lado: "bottom",
    },
    // --- Carta ---
    {
      elemento: GW_CARTA,
      pestana: GW_CARTA,
      titulo: "Carta",
      texto: "Platos, bebidas, vinos y cócteles: precios, descripciones, alérgenos, fotos y en qué web se ven.",
      opcional: true,
      lado: "bottom",
    },
    {
      elemento: "gw-carta-secciones",
      pestana: GW_CARTA,
      titulo: "Secciones de la carta",
      texto: "Elige qué quieres tocar: platos, bebidas, vinos o cócteles. El número es cuántos hay.",
      opcional: true,
      lado: "bottom",
    },
    {
      elemento: "gw-carta-acciones",
      pestana: GW_CARTA,
      titulo: "Añadir y subir precios",
      texto:
        "«Añadir» crea uno nuevo; se escribe en español y se traduce solo al inglés y al francés. «Ajustar precios» sube o baja de golpe una categoría entera (en %) o cambia el precio de uno solo, y en «Ver historial» ves los ajustes anteriores y cómo han ido cambiando los precios.",
      opcional: true,
      lado: "bottom",
    },
    {
      elemento: "gw-carta-filtros",
      pestana: GW_CARTA,
      titulo: "Buscar y filtrar",
      texto:
        "Busca por nombre o descripción, elige una categoría (en Vinos, el tipo y la denominación, como en la carta de la web) o filtra por lo que se ve u oculta en cada web.",
      opcional: true,
      lado: "bottom",
    },
    {
      elemento: "gw-carta-plato",
      pestana: GW_CARTA,
      titulo: "Cada plato",
      texto:
        "Cada tarjeta enseña la foto, el precio, los alérgenos y si se puede hacer sin gluten. Los interruptores «Restaurante» y «Touza» lo enseñan u ocultan en cada web al momento (ocultar no borra). «Foto» enseña la foto que tiene (o «Sin foto») y deja cambiarla o añadirla sin abrir la ficha; «Editar» abre su ficha; «Eliminar» lo borra del todo (te pide confirmarlo). El ojo enseña u oculta la foto aquí en el panel; «Foto expandida en carta web» la saca en grande en la web, y con el botón de mover eliges qué parte de la foto se ve.",
      opcional: true,
      lado: "right",
    },
    // --- Carta › Vinos (solo se señala: el tour nunca abre la cámara ni sube fotos) ---
    {
      elemento: GW_CARTA_VINOS,
      pestana: [GW_CARTA, GW_CARTA_VINOS],
      titulo: "Vinos con una foto",
      texto:
        "En «Vinos» puedes dar de alta una botella sin escribir: le haces una foto a la etiqueta y la ficha se rellena sola.",
      opcional: true,
      lado: "bottom",
    },
    {
      elemento: "gw-carta-vinos-foto",
      pestana: [GW_CARTA, GW_CARTA_VINOS],
      titulo: "Añadir vino con foto",
      texto:
        "En «Añadir vino» pon la foto de la etiqueta de delante (en el móvil, «Hacer foto a la etiqueta»), de cerca y con luz. Mientras se recorta la botella, la IA rellena el nombre, la categoría, la D.O., la uva, la región y una descripción, y te sugiere un precio; lo que ya hayas escrito no lo toca. Lo revisas y guardas tú. «Varias botellas» sirve para hacer una foto tras otra y revisarlas después. Cada foto usa la IA.",
      opcional: true,
      lado: "bottom",
    },
    // --- Novedades ---
    {
      elemento: GW_NOVEDADES,
      pestana: GW_NOVEDADES,
      titulo: "Novedades",
      texto: "Las tarjetas de «Novedades» de la web de Casa Tomás: un plato nuevo, un evento, una oferta… Los cambios se ven al momento.",
      opcional: true,
      lado: "bottom",
    },
    {
      elemento: "gw-novedades-lista",
      pestana: GW_NOVEDADES,
      titulo: "Las que ya tienes",
      texto:
        "Aquí están las guardadas, en el mismo orden que en la web: cámbialo con las flechas. Toca una para editarla o la papelera para borrarla. Arriba te dice cuántas se ven ahora mismo.",
      opcional: true,
      lado: "right",
    },
    {
      elemento: "gw-novedades-nueva",
      pestana: GW_NOVEDADES,
      titulo: "Nueva novedad",
      texto:
        "Aquí se crea una nueva (o se edita la que toques en la lista; «Cancelar edición» vuelve a una nueva). Va por pestañas: Texto, Imagen, Botones y menú y Publicación. Escribe un título y unas ideas y, si quieres, pulsa «Redactar con IA» y elige el tono: te propone un texto que revisas antes de usarlo. Puedes añadir una foto, una etiqueta, un icono y puntos destacados.",
      opcional: true,
      lado: "left",
    },
    {
      elemento: "gw-novedades-publicacion",
      pestana: GW_NOVEDADES,
      titulo: "Cuándo y cómo se ve",
      texto:
        "«Visible en la web» la enseña u oculta; «Destacada» la pone la primera; «Mostrar desde» y «Hasta» deciden entre qué fechas aparece (por ejemplo, un evento que caduca solo).",
      opcional: true,
      lado: "top",
    },
    {
      elemento: "gw-novedades-vista",
      pestana: GW_NOVEDADES,
      titulo: "Así se ve en el móvil",
      texto: "Mientras escribes, aquí ves cómo quedará en el móvil de los clientes, antes de guardarla.",
      opcional: true,
      lado: "left",
    },
    // --- Menús diarios ---
    {
      elemento: GW_MENUS,
      pestana: GW_MENUS,
      titulo: "Menús diarios",
      texto: "El menú del día de cada fecha, que sale en la sección «Espacios» de la web de Casa Tomás.",
      opcional: true,
      lado: "bottom",
    },
    {
      elemento: "gw-menu-interruptor",
      pestana: GW_MENUS,
      titulo: "Mostrar u ocultar en la web",
      texto:
        "Con este interruptor enseñas u ocultas el botón en la web de Casa Tomás (por ejemplo, en vacaciones). Lo guardado no se borra.",
      opcional: true,
      lado: "bottom",
    },
    {
      elemento: "gw-menu-lista",
      pestana: GW_MENUS,
      titulo: "Los ya guardados",
      texto: "Los menús de cada día que ya has guardado. Toca uno para cambiarlo; «Eliminar» lo quita en los tres idiomas.",
      opcional: true,
      lado: "right",
    },
    {
      elemento: "gw-menu-formulario",
      pestana: GW_MENUS,
      titulo: "Escribir el del día",
      texto:
        "Elige la fecha y añade los platos por secciones: «De la carta» los busca entre tus platos y copia solos sus alérgenos, su foto y su traducción; «A mano» sirve para los que no están en la carta (también les puedes poner alérgenos y foto). «Guardar y publicar» lo sube y lo traduce al inglés y al francés.",
      opcional: true,
      lado: "top",
    },
    {
      elemento: "gw-menu-vista",
      pestana: GW_MENUS,
      titulo: "Así se leerá en la web",
      texto: "Aquí ves cómo quedará el menú en la web mientras lo escribes.",
      opcional: true,
      lado: "left",
    },
    // --- Tapas ---
    {
      elemento: GW_TAPAS,
      pestana: GW_TAPAS,
      titulo: "Tapas",
      texto: "Las tapas del día para cada fecha. Funciona igual que el menú: con su propio interruptor para la web y su lista de días guardados.",
      opcional: true,
      lado: "bottom",
    },
    {
      elemento: "gw-menu-formulario",
      pestana: GW_TAPAS,
      titulo: "Escribir las tapas",
      texto: "Elige la fecha y escribe una tapa por línea. Al guardar se traducen solas al inglés y al francés; a la derecha ves cómo quedan.",
      opcional: true,
      lado: "top",
    },
    PASO_FINAL,
  ],
};

export const selectorTour = (id: string): string => `[data-tour="${id}"]`;

/** Pestañas que hay que abrir, en orden, antes de un paso (de fuera a dentro). */
export const cadenaPestanas = (paso: PasoTour): string[] =>
  paso.pestana === undefined ? [] : Array.isArray(paso.pestana) ? paso.pestana : [paso.pestana];

/** Botones de pestaña principales (las de fuera) distintos que usa un tour, en orden. */
export const pestanasDelTour = (pasos: PasoTour[]): string[] =>
  Array.from(new Set(pasos.map((p) => cadenaPestanas(p)[0]).filter((p): p is string => Boolean(p))));

/**
 * Espera (sondeando) a que `buscar()` devuelva algo, como mucho `maxMs`.
 * Devuelve lo encontrado o null si no aparece a tiempo.
 */
export function esperarA<E>(buscar: () => E | null, maxMs: number, cadaMs = 50): Promise<E | null> {
  return new Promise((resolver) => {
    const inicio = Date.now();
    const mirar = () => {
      const encontrado = buscar();
      if (encontrado) return resolver(encontrado);
      if (Date.now() - inicio >= maxMs) return resolver(null);
      window.setTimeout(mirar, cadaMs);
    };
    mirar();
  });
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

// Cambio de pestaña hecho por el tour (no por el usuario). Las pantallas que
// guardan la pestaña en la URL lo miran para no apilar historial: si no, al
// acabar el tour «Atrás» recorre todas las pestañas que enseñó.
let pestanaPorTour = false;

/** Ejecuta `cambiar` marcándolo como cambio de pestaña del tour (Radix avisa en el mismo `mousedown`). */
export function cambiarPestanaComoTour(cambiar: () => void): void {
  pestanaPorTour = true;
  try {
    cambiar();
  } finally {
    pestanaPorTour = false;
  }
}

/** ¿El cambio de pestaña en curso lo está haciendo el tour? */
export const esCambioDePestanaDelTour = (): boolean => pestanaPorTour;
