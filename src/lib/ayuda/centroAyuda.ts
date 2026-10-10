import type { SeccionAyuda } from "./tours";

// ---------------------------------------------------------------------------
// Contenido del Centro de Ayuda (/ayuda): una ficha por sección del panel.
// Para el dueño y el personal: llano, de tú, sin palabras técnicas.
// `videoUrl` (opcional): vídeo corto de la sección. Puede ser un archivo propio
// (`/ayuda/videos/facturas.webm`, en `public/`; se generan con
// `scripts/videos-ayuda/`) o un enlace de inserción (YouTube «embed», Vimeo,
// Loom…). Si no hay, no se enseña nada.
// ---------------------------------------------------------------------------

export interface PreguntaFrecuente {
  pregunta: string;
  respuesta: string;
}

export interface FichaAyuda {
  seccion: SeccionAyuda;
  titulo: string;
  /** Ruta de la sección (a la que lleva «Ver tour»). */
  ruta: string;
  /** Qué es, en una o dos frases. */
  queEs: string;
  /** Cómo se usa, paso a paso. */
  pasos: string[];
  preguntas: PreguntaFrecuente[];
  videoUrl?: string;
}

export const FICHAS_AYUDA: FichaAyuda[] = [
  {
    seccion: "facturas",
    titulo: "Facturas",
    ruta: "/facturas?tab=compras",
    videoUrl: "/ayuda/videos/facturas.webm",
    queEs:
      "Aquí se guardan las facturas y albaranes de los proveedores. Les haces una foto, la aplicación los lee sola y luego puedes buscar qué compraste, a quién, cuándo y a qué precio, o preguntárselo a la IA.",
    pasos: [
      "Entra en «Cargar» y pulsa el botón de la cámara para hacer una foto, o el de archivos para elegir un PDF o una imagen. Puedes subir varios a la vez (PDF, JPG, PNG o WEBP, de hasta 10 MB cada uno).",
      "Espera unos segundos: la aplicación lee el proveedor, la fecha, los productos, las cantidades, los precios y el IVA. Puedes irte a otra sección; te avisa al terminar.",
      "Ve a «Compras». El documento nuevo aparece en el mes que le toca, dentro de su proveedor.",
      "Fíjate en las etiquetas. Las facturas que cuadran se marcan solas como «Revisada auto»: no tienes que hacer nada con ellas. Solo tienes que mirar las que salen en rojo o naranja (por ejemplo «IVA no cuadra» o «Precio extremo») y las que pone «Sin revisar».",
      "Para revisar una, ábrela y pulsa «Ver original» para comparar con el papel. Si algo está mal leído, pulsa «Editar», corrígelo y activa «Marcar como verificada»: pasará a «Revisada».",
      "Para buscar, escribe en el buscador de arriba (un producto, un proveedor o un número) y elige si quieres ver Documentos, Productos o Proveedores. Los filtros («Con avisos», «Sin revisar», «Albaranes sin factura»…) te dejan ver solo una parte.",
      "Para preguntas como «¿cuánto gastamos en carne este mes?», ve a «IA». Puedes tocar una pregunta de ejemplo, usar los botones de «Al instante» (responden al momento, sin escribir) o escribirla con tus palabras. A la izquierda (en la tablet, en «Historial») quedan tus conversaciones anteriores.",
    ],
    preguntas: [
      {
        pregunta: "¿Tengo que revisar todas las facturas?",
        respuesta:
          "No. Las que cuadran y son de un proveedor que ya conocemos se marcan solas como «Revisada auto». Solo hace falta mirar las que salen en rojo o naranja y las que pone «Sin revisar».",
      },
      {
        pregunta: "¿Qué significa «IVA no cuadra», «No cuadra» o «Precio extremo»?",
        respuesta:
          "Son avisos de que algo no encaja en lo que se ha leído: el IVA no da con la base, la suma de las líneas no da el total, o un precio es muy raro. Casi siempre es un número mal leído en la foto. Abre el documento, pulsa «Ver original», compara y corrige con «Editar». Si tocas el aviso, te explica el detalle.",
      },
      {
        pregunta: "He subido la misma factura dos veces, ¿se duplica?",
        respuesta:
          "No. Si ya existe, no se crea otra: en «Cargar» te sale en «Pendientes de decidir». Si la que había estaba mal leída, puedes pulsar «Sustituir la existente»; si no, «Dejar la que hay».",
      },
      {
        pregunta: "La foto ha salido mal leída, ¿qué hago?",
        respuesta:
          "Corrige los datos a mano con «Editar». Si está muy mal, vuelve a hacer la foto con buena luz, recta y con el papel entero, súbela y elige «Sustituir la existente».",
      },
      {
        pregunta: "¿Qué es un «Albarán sin factura»?",
        respuesta:
          "Un albarán (la nota de entrega) que todavía no está incluido en ninguna factura del proveedor. Sirve para comprobar que luego te facturan lo que de verdad te entregaron. Cuando llega la factura, el albarán pasa a «Ya facturado».",
      },
      {
        pregunta: "¿Dónde veo el papel original?",
        respuesta: "Abre el documento y pulsa «Ver original» (en los albaranes, «Ver albarán»).",
      },
      {
        pregunta: "¿Qué le puedo preguntar al chatbot?",
        respuesta:
          "Cualquier cosa sobre tus compras, con tus palabras. Por ejemplo: «¿Cuánto hemos gastado en octubre?», «Muéstrame todas las facturas de» y el nombre del proveedor, «¿Qué albaranes de ese proveedor hay esta semana?», «¿Qué productos hemos comprado más veces este mes?», «¿Cuánto gastamos en carne en septiembre?» o «¿Qué proveedor nos vende más caro el aceite?». Responde con los datos de tus facturas y albaranes. Para lo más habitual (gasto del mes, mejores proveedores, documentos por revisar, qué ha subido de precio…) usa los botones de «Al instante»: salen al momento y no gastan IA. Arriba a la derecha ves cuánto ha costado este mes usar la IA.",
      },
    ],
  },
  {
    seccion: "gestor-web",
    titulo: "Gestor Web",
    ruta: "/gestion-web",
    videoUrl: "/ayuda/videos/gestor-web.webm",
    queEs:
      "Desde aquí cambias lo que ven los clientes en las webs de Casa Tomás y Touza: la carta (platos, bebidas, vinos y cócteles), las novedades, el menú del día y las tapas.",
    pasos: [
      "Elige arriba la pestaña de lo que quieres cambiar: «Carta», «Novedades», «Menús diarios» o «Tapas». Solo ves las que tienes permitidas.",
      "En «Carta», elige si quieres tocar platos, bebidas, vinos o cócteles. Pulsa «Añadir» para crear uno o «Editar» en uno que ya existe para cambiar su precio, descripción, alérgenos o foto.",
      "En cada plato tienes interruptores para mostrarlo u ocultarlo en la web de Casa Tomás o en la de Touza. Ocultar no borra nada: lo puedes volver a enseñar cuando quieras.",
      "Para subir o bajar los precios de toda una categoría de golpe, usa «Ajustar precios».",
      "Meter vinos con una foto: en «Carta», entra en «Vinos» y pulsa «Añadir botella con foto». Hazle la foto a la etiqueta de delante de la botella, de cerca y con luz. En unos segundos se abre la ficha ya rellena: nombre (con la añada si se lee), categoría, D.O., uva, región, país y una descripción. La foto se recorta sola y queda como foto del vino.",
      "El precio no se rellena solo: debajo te sale un precio «Sugerido» (calculado con los precios de tu carta), que puedes poner con «Usar», y lo que cuesta más o menos en tiendas. Revisa todo, corrige lo que haga falta y pulsa guardar. Hasta que no guardas, no se añade nada a la carta.",
      "Si tienes varias botellas, pulsa «Varias botellas» y ve haciendo una foto por botella («Hacer foto» y luego «Otra foto»), o elígelas de la galería. Se leen solas mientras sigues; cuando una pone «Listo · toca para revisar», tócala, revísala y guárdala. Las que ya están pasan a «Guardado».",
      "En «Novedades», pulsa «Nueva novedad», escribe el título y la descripción (o unas ideas y «Redactar con IA»), añade una foto si quieres y elige si se ve en la web y entre qué fechas. A la derecha ves cómo queda en el móvil.",
      "En «Menús diarios» y «Tapas», elige la fecha, escribe el menú o las tapas (una por línea) y guarda.",
      "Escribe siempre en español: al guardar se traduce solo al inglés y al francés.",
    ],
    preguntas: [
      {
        pregunta: "¿Cuándo se ven los cambios en la web?",
        respuesta:
          "Las novedades se ven al momento. En la carta, el menú y las tapas puede tardar un poco en aparecer; si pasado un rato no lo ves, recarga la web.",
      },
      {
        pregunta: "¿Cómo quito un plato de la web sin borrarlo?",
        respuesta:
          "Apaga su interruptor de «Restaurante» (Casa Tomás) o de «Touza». Sigue guardado y lo puedes volver a encender cuando quieras.",
      },
      {
        pregunta: "¿Tengo que escribir en inglés y en francés?",
        respuesta: "No. Escribe solo en español; la traducción se hace sola al guardar.",
      },
      {
        pregunta: "¿Cómo oculto el menú del día cuando cerramos o estamos de vacaciones?",
        respuesta:
          "En «Menús diarios» (o «Tapas»), apaga el interruptor «Mostrar … en la web de Casa Tomás». Lo que tengas guardado no se borra.",
      },
      {
        pregunta: "Me he equivocado en una novedad ya publicada, ¿qué hago?",
        respuesta:
          "Tócala en la lista para editarla, corrige y guarda. Si prefieres quitarla un tiempo, desactiva «Visible en la web».",
      },
      {
        pregunta: "Vinos con foto: ¿qué foto le hago?",
        respuesta:
          "A la etiqueta de delante de una sola botella: de cerca, recta, con buena luz y sin reflejos. No sirve una foto de la carta de vinos ni de varias botellas juntas; para eso usa «Varias botellas» y haz una foto a cada una. Cada foto usa la IA (y busca el precio en tiendas), así que cuesta unos céntimos: no hagas fotos de prueba de más.",
      },
      {
        pregunta: "Vinos con foto: ¿y si lee algo mal?",
        respuesta:
          "No pasa nada: nada se guarda hasta que tú pulsas guardar. Corrige en la ficha lo que esté mal y luego guarda. Si no ha leído casi nada (te avisa si no encuentra el nombre), cierra y repite la foto más cerca y con más luz, o añádelo a mano con «Añadir». En «Varias botellas», si una sale «No se pudo leer», pulsa el botón de reintentar o quítala con la X.",
      },
      {
        pregunta: "No veo alguna pestaña, ¿por qué?",
        respuesta: "Cada persona ve solo las partes que tiene permitidas. Si necesitas otra, pídeselo al encargado.",
      },
    ],
  },
];

/** ¿Es un archivo de vídeo (se enseña con <video>) y no un enlace de inserción (<iframe>)? */
export const esArchivoVideo = (url: string): boolean => /\.(webm|mp4|m4v|ogv|mov)(\?.*)?$/i.test(url);
