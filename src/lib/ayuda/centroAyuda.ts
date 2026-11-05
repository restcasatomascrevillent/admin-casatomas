import type { SeccionAyuda } from "./tours";

// ---------------------------------------------------------------------------
// Contenido del Centro de Ayuda (/ayuda): una ficha por sección del panel.
// Para el dueño y el personal: llano, de tú, sin palabras técnicas.
// Los pasos van en bloques con título (`grupos`), de principio a fin; la
// numeración sigue de un bloque al siguiente.
// `videoUrl` (opcional): vídeo corto de la sección. Puede ser un archivo propio
// (`/ayuda/videos/facturas.mp4`, en `public/`; se generan con
// `scripts/videos-ayuda/`) o un enlace de inserción (YouTube «embed», Vimeo,
// Loom…). Si no hay, no se enseña nada.
// ---------------------------------------------------------------------------

export interface PreguntaFrecuente {
  pregunta: string;
  respuesta: string;
}

/** Un bloque de pasos con su título («1. Subir», «2. Revisar»…). */
export interface GrupoPasos {
  titulo: string;
  pasos: string[];
}

export interface FichaAyuda {
  seccion: SeccionAyuda;
  titulo: string;
  /** Ruta de la sección (a la que lleva «Ver tour»). */
  ruta: string;
  /** Qué es, en una o dos frases. */
  queEs: string;
  /** Cómo se usa, paso a paso, en bloques. */
  grupos: GrupoPasos[];
  preguntas: PreguntaFrecuente[];
  videoUrl?: string;
}

/** Todos los pasos de una ficha, en orden (sin los títulos de bloque). */
export const pasosDeFicha = (ficha: FichaAyuda): string[] => ficha.grupos.flatMap((g) => g.pasos);

export const FICHAS_AYUDA: FichaAyuda[] = [
  {
    seccion: "facturas",
    titulo: "Facturas",
    ruta: "/facturas?tab=compras",
    videoUrl: "/ayuda/videos/facturas.mp4",
    queEs:
      "Aquí se guardan las facturas y albaranes de los proveedores. Les haces una foto, la aplicación los lee sola, comprueba que cuadren y luego puedes buscar qué compraste, a quién, cuándo y a qué precio, o preguntárselo a la IA.",
    grupos: [
      {
        titulo: "Subir",
        pasos: [
          "Entra en «Cargar» y pulsa «Hacer foto» para usar la cámara, o «Elegir archivos» para escoger un PDF o una imagen. Puedes subir varios a la vez (PDF, JPG, PNG o WEBP, de hasta 10 MB cada uno).",
          "Si un documento tiene varias hojas, haz una foto a cada una, márcalas y pulsa «Unir … fotos como un documento»: se leen como páginas 1, 2, 3… (puedes cambiar el orden o separarlas). Si subes suelta una hoja que pone «página 2 de 3» de una factura que ya está, te ofrece «Añadir como página 2 a la factura…».",
          "Si subes uno que ya estaba, no se duplica: te sale un aviso en pantalla con los datos del que ya estaba y un botón para ver su foto, y además aparece en «Pendientes de decidir» y eliges «Sustituir la existente» (si la de antes estaba mal leída) o «Dejar la que hay».",
        ],
      },
      {
        titulo: "Lectura automática",
        pasos: [
          "Espera unos segundos: la aplicación lee el proveedor, el CIF, el número, la fecha, cada producto con su cantidad y precio, la base, el IVA y el total. Puedes irte a otra sección; te avisa al terminar.",
          "Arriba a la derecha de «Cargar» ves lo que cuesta este mes leer documentos y cuánto sale cada uno (céntimos). En la ficha de cada documento pone también lo que costó leerlo.",
        ],
      },
      {
        titulo: "Revisión automática y avisos",
        pasos: [
          "Ve a «Compras». El documento nuevo aparece en el mes que le toca, con su proveedor en la misma fila.",
          "Las facturas que cuadran (base + IVA = total, sin precios raros, de un proveedor que ya conocemos) se marcan solas como «Revisada auto»: no tienes que hacer nada con ellas.",
          "Si algo no encaja sale un aviso en rojo o naranja que dice qué pasa: «IVA no cuadra», «No cuadra», «Línea mal», «Precio extremo», «Precio atípico», «Total enorme», «Sin total»… Toca el aviso y te lo explica. Para ver solo esas, usa el filtro «Con avisos»; para las que nadie ha mirado, «Sin revisar».",
        ],
      },
      {
        titulo: "Comprobar y corregir",
        pasos: [
          "Toca el documento y su ficha ocupa toda la pantalla: arriba tienes los importes (y, si te regalaron algo o te hicieron descuento, cuánto vale), debajo sus líneas y, al final, la foto del papel original. «Volver a la lista» te deja la lista como estaba.",
          "Compara con el original usando el zoom: botones + y −, dos dedos o Ctrl + rueda para ampliar; arrastra para moverte; doble toque para acercar; «Girar» si salió torcida; y el botón de pantalla completa para verla en grande. «Original» (arriba) la abre en otra pestaña.",
          "Si algo está mal leído, pulsa «Editar» para corregir el proveedor, el número, la fecha o los importes, y activa «Marcar como verificada» para que pase a «Revisada». Una línea concreta se corrige con su lápiz. Al guardar, los avisos se vuelven a calcular.",
        ],
      },
      {
        titulo: "Albaranes y facturas",
        pasos: [
          "Un albarán es la nota de entrega; luego el proveedor manda la factura que los recoge. En la ficha de una factura ves sus albaranes y un cotejo producto a producto (entregado contra cobrado, sin IVA) con las diferencias en color. Con «Añadir albarán» unes uno que falte; los citados en la factura salen los primeros.",
          "En la ficha de un albarán pone «Ya facturado» (con la factura y un botón para verla) o «Sin factura todavía», con «Asociar a factura». El filtro «Albaranes sin factura» te enseña los que aún no te han facturado. En la lista, un albarán ya facturado sale tachado con «Incluido en …» y no suma, para no contarlo dos veces.",
        ],
      },
      {
        titulo: "Buscar lo que has comprado",
        pasos: [
          "Escribe en el buscador de arriba (un producto, un proveedor o un número) y elige cómo mirarlo: «Documentos», «Productos» o «Proveedores». El número de cada botón dice cuántos resultados hay.",
          "Debajo del buscador eliges el local (Todos, Casa Tomás o Touza) y el periodo (este mes, el anterior, el trimestre, el año o todo). Cambian las listas y sus totales. Las cifras y gráficas (gasto, abonos, lo regalado, proveedores con más gasto) están en la pestaña «Análisis».",
          "En «Documentos» la lista ocupa todo el ancho y va por meses (con cuántos documentos hay, cuánto suman y lo que restan los abonos). Cada fila: fecha, proveedor, número, marcas (Albarán, Abono, Touza, avisos, sin revisar…) e importe. Toca un mes para plegarlo o desplegarlo; se acuerda de cómo lo dejaste. Los abonos (devoluciones) salen en verde con «−» y tienen su filtro.",
          "En «Productos» ves cuánto gastas por categoría (toca una para filtrar), qué productos «Subieron de precio» y, al abrir uno, la gráfica de su precio por proveedor y en qué documentos aparece. Desde ahí puedes cambiarle la categoría, el nombre o unir duplicados.",
          "En «Proveedores» están ordenados por lo que les gastas. Toca uno y se despliega ahí mismo: CIF, cada cuánto pide, último pedido, qué le compras y sus facturas por meses (toca una para abrirla); otro toque lo pliega. El filtro «Con albaranes sin factura» te dice a quién reclamar facturas.",
          "Desde una ficha puedes saltar a otra (de una línea a su producto, de un documento a su proveedor) y volver con «Volver a…».",
        ],
      },
      {
        titulo: "Preguntar a la IA",
        pasos: [
          "Para preguntas como «¿cuánto gastamos en carne este mes?», ve a «Análisis». Puedes tocar una pregunta de ejemplo o escribirla con tus palabras y pulsar la flecha. Las gráficas se quedan en el tablero; toca una para preguntar sobre ella.",
          "Para lo más habitual, despliega «Al instante»: gasto de este mes, gasto por mes, mejores proveedores, productos más comprados, por revisar, con avisos, sin total, gasto por categoría, qué ha subido de precio y la evolución del precio de un producto. Salen al momento y no gastan IA.",
          "A la izquierda (en la tablet, en «Historial») quedan tus conversaciones anteriores. Arriba a la derecha ves lo que ha costado la IA este mes; si se acerca al tope, se pone en naranja o rojo.",
        ],
      },
    ],
    preguntas: [
      {
        pregunta: "¿Tengo que revisar todas las facturas?",
        respuesta:
          "No. Las que cuadran y son de un proveedor que ya conocemos se marcan solas como «Revisada auto». Solo hace falta mirar las que salen en rojo o naranja y las que pone «Sin revisar».",
      },
      {
        pregunta: "¿Qué diferencia hay entre «Revisada auto» y «Revisada»?",
        respuesta:
          "«Revisada auto» la ha dado por buena la aplicación porque todo cuadra; nadie la ha mirado. «Revisada» es que una persona la ha comprobado y ha activado «Marcar como verificada» en «Editar».",
      },
      {
        pregunta: "¿Qué significa «IVA no cuadra», «No cuadra» o «Precio extremo»?",
        respuesta:
          "Son avisos de que algo no encaja en lo que se ha leído: el IVA no da con la base, la suma de las líneas no da el total, o un precio es muy raro. Casi siempre es un número mal leído en la foto. Abre el documento, compara con la foto del final de la ficha (con zoom) y corrige con «Editar». Si tocas el aviso, te explica el detalle.",
      },
      {
        pregunta: "¿Cómo amplío la foto del papel original?",
        respuesta:
          "Abre el documento y baja hasta el final de la ficha. Usa los botones + y − de debajo de la foto, pellizca con dos dedos o mantén Ctrl y mueve la rueda del ratón. Arrastra para moverte, doble toque para acercar o volver, «Girar» si está torcida y el botón de los cuatro picos para verla a pantalla completa. «Original», arriba, la abre en otra pestaña (en los albaranes pone «Albarán»).",
      },
      {
        pregunta: "Tengo una factura de varias hojas, ¿cómo la subo?",
        respuesta:
          "En «Cargar», haz una foto a cada hoja, márcalas y pulsa «Unir … fotos como un documento». Se leen juntas como páginas 1, 2, 3… Si ya subiste la primera hoja y luego subes otra suelta, te ofrece «Añadir como página…» a esa factura: nunca la sustituye.",
      },
      {
        pregunta: "He subido la misma factura dos veces, ¿se duplica?",
        respuesta:
          "No. Si ya existe (mismo número y mismo proveedor), no se crea otra: en «Cargar» te sale en «Pendientes de decidir». Si la que había estaba mal leída, puedes pulsar «Sustituir la existente»; si no, «Dejar la que hay».",
      },
      {
        pregunta: "La foto ha salido mal leída, ¿qué hago?",
        respuesta:
          "Corrige los datos a mano con «Editar» (y cada línea con su lápiz). Si está muy mal, vuelve a hacer la foto con buena luz, recta y con el papel entero, súbela y elige «Sustituir la existente».",
      },
      {
        pregunta: "¿Qué es un «Albarán sin factura»?",
        respuesta:
          "Un albarán (la nota de entrega) que todavía no está incluido en ninguna factura del proveedor. Sirve para comprobar que luego te facturan lo que de verdad te entregaron. Cuando llega la factura, el albarán pasa a «Ya facturado». Si no se ha unido solo, ábrelo y pulsa «Asociar a factura».",
      },
      {
        pregunta: "¿Para qué sirve el cotejo de una factura?",
        respuesta:
          "Compara, producto a producto y sin IVA, lo que traían sus albaranes con lo que cobra la factura. Arriba salen las diferencias (en naranja o rojo, la más cara primero) y, plegadas, las líneas que cuadran. Si falta un albarán, añádelo con «Añadir albarán».",
      },
      {
        pregunta: "¿Cómo veo si un producto ha subido de precio?",
        respuesta:
          "En «Compras», elige «Productos» y toca «Subieron de precio». Al abrir un producto ves la gráfica de su precio con cada proveedor y en qué facturas aparece. También puedes usar «Qué ha subido de precio» o «Evolución de precio» en «Al instante», en la pestaña «Análisis».",
      },
      {
        pregunta: "¿Dónde veo el papel original?",
        respuesta:
          "Al final de la ficha del documento, con zoom. También con «Original» (en los albaranes, «Albarán»), arriba a la derecha de la ficha, que lo abre en otra pestaña.",
      },
      {
        pregunta: "¿Qué le puedo preguntar al chatbot?",
        respuesta:
          "Cualquier cosa sobre tus compras, con tus palabras. Por ejemplo: «¿Cuánto hemos gastado en octubre?», «Muéstrame todas las facturas de» y el nombre del proveedor, «¿Qué albaranes de ese proveedor hay esta semana?», «¿Qué productos hemos comprado más veces este mes?», «¿Cuánto gastamos en carne en septiembre?» o «¿Qué proveedor nos vende más caro el aceite?». Responde con los datos de tus facturas y albaranes.",
      },
      {
        pregunta: "¿Cuánto cuesta usar la IA?",
        respuesta:
          "Poco: cada pregunta al chatbot y cada documento leído cuestan céntimos. Lo ves arriba a la derecha (en «Análisis», lo del chatbot; en «Cargar», lo de leer documentos) y al tocarlo sale el detalle. Los botones de «Al instante» no gastan nada: leen tus datos directamente.",
      },
    ],
  },
  {
    seccion: "gestor-web",
    titulo: "Gestor Web",
    ruta: "/gestion-web",
    videoUrl: "/ayuda/videos/gestor-web.mp4",
    queEs:
      "Desde aquí cambias lo que ven los clientes en las webs de Casa Tomás y Touza: la carta (platos, bebidas, vinos y cócteles), las novedades, el menú del día y las tapas. Escribes en español y se traduce solo al inglés y al francés.",
    grupos: [
      {
        titulo: "Moverte por el Gestor Web",
        pasos: [
          "Elige arriba la pestaña de lo que quieres cambiar: «Carta», «Novedades», «Menús diarios» o «Tapas». Solo ves las que tienes permitidas.",
          "Escribe siempre en español: al guardar se traduce solo al inglés y al francés.",
        ],
      },
      {
        titulo: "Carta: platos, bebidas, vinos y cócteles",
        pasos: [
          "En «Carta», elige si quieres tocar platos, bebidas, vinos o cócteles (el número es cuántos hay).",
          "Para encontrar uno, escribe en el buscador (busca en el nombre y la descripción), elige una categoría o filtra por lo que está visible u oculto en Casa Tomás o en Touza.",
          "Cada tarjeta enseña el precio, la descripción, los ingredientes, los alérgenos y si se puede hacer sin gluten. El ojo enseña u oculta la foto aquí en el panel; «Foto expandida en carta web» la saca en grande en la web, y con el botón de mover eliges qué parte de la foto se ve.",
          "Los interruptores «Restaurante» (Casa Tomás) y «Touza» lo enseñan u ocultan en cada web. Ocultar no borra nada: lo puedes volver a enseñar cuando quieras.",
          "Pulsa «Añadir» para crear uno o «Editar» en uno que ya existe para cambiar el nombre, la categoría, el precio, la descripción, los ingredientes, los alérgenos, «Se puede hacer sin gluten» o la foto. Nada cambia hasta que pulsas guardar. «Eliminar» lo borra del todo (te pide confirmarlo).",
        ],
      },
      {
        titulo: "Precios",
        pasos: [
          "Para subir o bajar los precios de toda una categoría de golpe, pulsa «Ajustar precios», elige la carta (platos, bebidas o vinos) y la categoría y pon el porcentaje. Si eliges un solo plato, puedes ponerle el precio nuevo directamente.",
          "Si el cambio es muy grande, te avisa antes de aplicarlo. En «Ver historial» tienes los ajustes anteriores, la gráfica de cómo han ido cambiando los precios y la opción de volver atrás.",
        ],
      },
      {
        titulo: "Vinos con una foto",
        pasos: [
          "En «Carta», entra en «Vinos» y pulsa «Añadir vino». Pon la foto de la etiqueta de delante de la botella (en el móvil, «Hacer foto a la etiqueta»), de cerca y con luz. Mientras la foto se recorta, la IA rellena en unos segundos los campos vacíos: nombre (con la añada si se lee), categoría, D.O., uva, región, país y una descripción. Lo que ya hayas escrito no lo cambia. Si el vino ya existe, en «Editar» tienes el botón «Leer etiqueta con IA».",
          "El precio no se rellena solo: debajo te sale un precio «Sugerido» (calculado con los precios de tu carta), que puedes poner con «Usar», y lo que cuesta más o menos en tiendas. Revisa todo, corrige lo que haga falta y pulsa guardar. Hasta que no guardas, no se añade nada a la carta.",
          "Si tienes varias botellas, pulsa «Varias botellas» y ve haciendo una foto por botella («Hacer foto» y luego «Otra foto»), o elígelas de la galería. Se leen solas mientras sigues; cuando una pone «Listo · toca para revisar», tócala, revísala y guárdala. Las que ya están pasan a «Guardado».",
          "Un vino no se guarda sin su origen: país, región y la categoría con su denominación (el mapa de la carta lo necesita). Si la IA no lo saca claro, el formulario te avisa de lo que falta y no guarda hasta que lo completes.",
          "En cada vino, «Restaurante» lo publica en la carta de la web de Casa Tomás y «Touza» en la de Touza; con los dos apagados no sale en ninguna. Los marcados «Origen por confirmar» no se pueden publicar hasta completar su origen: el filtro «Origen por confirmar» los junta para corregirlos con «Editar».",
        ],
      },
      {
        titulo: "Novedades",
        pasos: [
          "A la izquierda tienes las novedades guardadas, en el mismo orden que en la web: cámbialo con las flechas. Toca una para editarla o la papelera para borrarla.",
          "Pulsa «Nueva novedad», elige el tipo y escribe el título y la descripción. Si prefieres, escribe unas ideas, pulsa «Redactar con IA» y elige el tono: te propone un texto que revisas y aceptas con «Usar este texto».",
          "Añade si quieres una foto, una etiqueta para la tarjeta, un icono y puntos destacados.",
          "En «Publicación» decides si está «Visible en la web», si es «Destacada» (sale la primera) y entre qué fechas se ve («Mostrar desde» y «Hasta», opcional).",
          "A la derecha ves cómo queda en el móvil mientras escribes. Al guardar se ve en la web al momento.",
        ],
      },
      {
        titulo: "Menú del día y tapas",
        pasos: [
          "En «Menús diarios», el interruptor de arriba enseña u oculta el menú en la web de Casa Tomás (por ejemplo, en vacaciones). Lo guardado no se borra.",
          "Elige la fecha y añade los platos por secciones: «De la carta» los busca entre tus platos y copia solos sus alérgenos, su foto y su traducción; «A mano» sirve para los que no están en la carta (también les puedes poner alérgenos y foto). Pulsa «Guardar y publicar».",
          "Los días ya guardados salen en la lista de arriba: toca uno para cambiarlo, o «Eliminar» para quitarlo en los tres idiomas. A la derecha ves cómo se leerá en la web.",
          "«Tapas» funciona igual: su propio interruptor, la fecha y una tapa por línea.",
        ],
      },
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
        pregunta: "¿Cómo pongo los alérgenos o «sin gluten»?",
        respuesta:
          "Pulsa «Editar» en el plato, marca sus alérgenos y, si se puede preparar sin gluten, activa «Se puede hacer sin gluten». Guarda. En el menú del día, los platos «De la carta» los copian solos; a los «A mano» se los pones tú.",
      },
      {
        pregunta: "Me he equivocado subiendo precios, ¿lo puedo deshacer?",
        respuesta:
          "Sí. Abre «Ajustar precios» › «Ver historial»: ahí están los ajustes anteriores y puedes restaurar los precios de antes.",
      },
      {
        pregunta: "¿Cómo oculto el menú del día cuando cerramos o estamos de vacaciones?",
        respuesta:
          "En «Menús diarios» (o «Tapas»), apaga el interruptor «Mostrar … en la web de Casa Tomás». Lo que tengas guardado no se borra.",
      },
      {
        pregunta: "Me he equivocado en una novedad ya publicada, ¿qué hago?",
        respuesta:
          "Tócala en la lista para editarla, corrige y guarda. Si prefieres quitarla un tiempo, desactiva «Visible en la web». Para que caduque sola, ponle una fecha en «Hasta».",
      },
      {
        pregunta: "¿Cuesta dinero «Redactar con IA»?",
        respuesta:
          "Un poco (céntimos cada vez). No se publica nada hasta que tú aceptas el texto con «Usar este texto» y guardas.",
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
