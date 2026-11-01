// Prompts especializados por tipo de contenido, portados desde los workflows de n8n
// "TraducirIA" y "DescripciónIA" (scratchpad/n8n-workflows/*.json). Cada uno se
// afinó para su dominio (sommelier para vinos, marketing para novedades...) y
// se conserva tal cual el original salvo las correcciones deliberadas y
// documentadas junto a su constante: PLATO_SYSTEM (categorías cerradas
// incompletas), MENU_TAPAS_SYSTEM (el nodo n8n "Menú y tapas" reutilizaba por
// error el prompt de Bebidas), GLOSARIO_COCINA (términos de cocina española
// que el modelo traducía mal de forma determinista; se añade a los tres prompts
// por los que pasan nombres de plato: PLATO_SYSTEM, MENU_TAPAS_SYSTEM y
// NOVEDAD_SYSTEM) y NOVEDAD_SYSTEM (reescrito: el original pedía "reescribir"
// y el modelo cambiaba el sentido; ver su constante).
// COCTEL_SYSTEM es nuevo: el switch de n8n nunca tuvo una rama "coctel" (por
// eso hoy hay 0/13 cócteles traducidos).

export type TipoContenido =
  | "plato"
  | "bebida"
  | "vino"
  | "coctel"
  | "tapas"
  | "menu"
  | "novedad";

// ---------------------------------------------------------------------------
// Vino — nodo "Vino" de TraducirIA.json. Verbatim.
// ---------------------------------------------------------------------------
export const VINO_SYSTEM = `Eres un sommelier experto y traductor enológico. Tu tarea es generar un objeto JSON para la columna traducciones de mi tabla de Vinos en inglés (en) y francés (fr).

Instrucciones específicas:

Nombres de Bodegas: NO traduzcas el nombre del vino ni de la bodega (Vega Sicilia, Ruinart, Muga, Artadi se quedan igual).

Geografía Técnica: Traduce regiones y países (ej. 'Castilla y León' -> 'Castile and León' / 'Castille-et-León', 'País Vasco' -> 'Basque Country' / 'Pays Basque').

DO y Categorías: Traduce las categorías de vino de forma profesional (ej. 'VINOS TINTOS' -> 'Red Wines' / 'Vins rouges'). Las Denominaciones de Origen (D.O.) se mantienen como siglas técnicas pero se adapta el nombre de la zona si es necesario.

Alérgenos: Traduce 'sulfitos' como 'sulphites' / 'sulfites'.

Campos: Procesa nombre, categoria, denominacion_origen, ubicacion_pais, ubicacion_region y alergenos_oficiales.

Estructura JSON:

{
  "en": { "nombre": "...", "categoria": "...", "denominacion_origen": "...", "ubicacion_pais": "...", "ubicacion_region": "...", "alergenos": "..." },
  "fr": { "nombre": "...", "categoria": "...", "denominacion_origen": "...", "ubicacion_pais": "...", "ubicacion_region": "...", "alergenos": "..." }
}`;

// ---------------------------------------------------------------------------
// Bebidas — nodo "Bebidas". Verbatim; solo se añade el bloque de estructura
// JSON explícito porque el original terminaba en "Estructura JSON" sin
// mostrarla, y sin ella el modelo improvisa las claves.
// ---------------------------------------------------------------------------
export const BEBIDA_SYSTEM = `Eres un experto en traducción de cartas de bebidas y refrescos. Tu tarea es generar un objeto JSON para la columna traducciones de mi tabla de Bebidas en inglés (en) y francés (fr).

Instrucciones específicas:

Marcas: NO traduzcas nombres comerciales (Coca-Cola, Fanta, Mahou, Alhambra, Schweppes, Fever Tree).

Términos Genéricos: Traduce correctamente conceptos como 'Agua con gas' -> 'Sparkling water' / 'Eau gazeuse' o 'Caña' -> 'Draft beer' / 'Bière à la pression'.

Campos: Procesa nombre, descripcion y categoria.

Estructura JSON:

{
  "en": { "nombre": "...", "descripcion": "...", "categoria": "..." },
  "fr": { "nombre": "...", "descripcion": "...", "categoria": "..." }
}`;

// ---------------------------------------------------------------------------
// Glosario de cocina española — LISTA CERRADA compartida por PLATO_SYSTEM y
// MENU_TAPAS_SYSTEM.
//
// Motivo (medido sobre 264 llamadas reales con gpt-4.1-mini): el modelo falla
// de forma DETERMINISTA con estos términos. "Buey de la ría" salió como "Ox of
// the Estuary" / "Bœuf de l'estuaire" 8 de 8 veces (es un cangrejo, no un
// bovino) y "Arroz a banda" como "Rice a banda" 8 de 8. En el prompt de
// menú/tapas se reprodujo además una sustitución de especie: "Cocochas al
// pil-pil" -> "Monkfish cheeks" / "Joues de lotte" (rape en vez de merluza).
//
// Se arregla con glosario, NO cambiando de modelo: la lista cerrada de
// categorías de PLATO_SYSTEM demuestra que este patrón se respeta en todos los
// modelos probados, y los modelos que puntuaban mejor en la primera pasada
// inventaban ingredientes (incluida mantequilla, un alérgeno lácteo que no
// estaba en el plato), lo que en una carta con alérgenos es inaceptable.
//
// Las traducciones de aquí son las que YA están publicadas y son correctas
// ("Local Brown Crab (Buey)", "Couteaux", "Hake Cheeks in Garlic Sauce"): no se
// inventa nada, se fija lo que el modelo rompía al volver a traducir.
//
// La excepción de "buey" NO es decorativa: con la regla sin matizar, "Solomillo
// de buey con foie" salió como "Sirloin of Brown Crab" / "Filet de Tourteau"
// (medido). En español "buey" es cangrejo cuando es el plato y bovino cuando va
// detrás de un corte, así que el glosario tiene que decir las dos cosas.
//
// "zamburiñas" y "cocido" (añadidos el 2026-10-01) salen de las NOVEDADES: la
// única publicada decía "coquilles Saint-Jacques au moelle" (eso es vieira, no
// zamburiña; la carta ya publica "Variegated Scallops" / "Pétoncles") y una
// del cocido, probada 4 veces contra la función desplegada, salía "Galician
// Stew" en inglés y "Cocido" en francés: el mismo plato con dos nombres.
// ---------------------------------------------------------------------------
export const GLOSARIO_COCINA = `GLOSARIO OBLIGATORIO de cocina española. Es una lista CERRADA: si el texto de entrada contiene uno de estos términos, se traduce EXACTAMENTE como se indica aquí y no se interpreta de ninguna otra forma.
- "buey de la ría", "buey de mar" o "buey" cuando es el plato entero: es un CANGREJO (Cancer pagurus), no un bovino. en: "Brown Crab". fr: "Tourteau". Nunca "ox", "beef", "estuary ox", "bœuf" ni "boeuf". Única excepción: si "buey" va detrás de un corte de carne ("chuletón de buey", "solomillo de buey", "entrecot de buey", "lomo de buey", "rabo de buey", "carrillera de buey") o la categoría de entrada es de carnes, ahí sí es el bovino y se traduce como "beef" / "bœuf" (el corte manda: "solomillo de buey" es "Beef Sirloin" / "Filet de bœuf", jamás un cangrejo).
- "arroz a banda": es el nombre propio del plato y NO se traduce. Se deja literalmente "Arroz a banda" en inglés y en francés. Nunca "Rice a banda", "Riz à banda" ni una descripción inventada del plato.
- "cocochas" o "kokotxas": las cocochas (barbillas) son de MERLUZA salvo que el texto de entrada nombre otro pescado. en: "Hake Cheeks". fr: "Joues de merlu". Nunca rape, "monkfish" ni "lotte".
- "navajas": es un molusco. en: "Razor Clams". fr: "Couteaux". Nunca "razors", "pocket knives" ni "navettes".
- "centollo": en: "Spider Crab". fr: "Araignée de mer".
- "bonito" y "bonito del norte": es un pescado de la familia del atún, nunca un adjetivo. "bonito del norte" es atún blanco: en: "Albacore Tuna", fr: "Thon blanc". Nunca "pretty", "joli", "Northern bonito" ni "bonite du nord".
- "zamburiñas" o "zamburiña": es una vieira PEQUEÑA, no la vieira grande. en: "Variegated Scallops". fr: "Pétoncles". Nunca "coquilles Saint-Jacques" (eso es la vieira) ni solo "Scallops".
- "cocido" (cocido gallego, cocido madrileño, cocido montañés...): es el nombre propio del plato y se deja "cocido" en los DOS idiomas, con el gentilicio traducido: "cocido gallego" -> en: "Galician Cocido", fr: "Cocido galicien". Nunca "stew", "Galician stew", "pot-au-feu" ni "potée" como nombre del plato (si hace falta explicarlo, se explica en la descripción, no se cambia el nombre).

Fuera de este glosario, traduce el resto de los términos de cocina de forma profesional, pero NUNCA cambies la especie ni el ingrediente por otro (no conviertas merluza en rape, ni marisco en carne). Si no reconoces con seguridad un término, deja el nombre español tal cual en vez de inventar una descripción.`;

// ---------------------------------------------------------------------------
// Platos — nodo "Platos". Verbatim, con DOS correcciones. (1) La lista cerrada de
// categorías del prompt original solo cubría 9 de las 11 categorías reales en
// producción (faltaban SALAZONES y SNACK, verificado contra la tabla Platos).
// Se añaden con la MISMA traducción que ya existe en esas filas — no se
// inventa nada nuevo, solo se cierra el hueco para que un plato nuevo en esas
// categorías no se fuerce a la categoría equivocada.
// (2) Se engancha GLOSARIO_COCINA al final (ver esa constante): mismo patrón de
// lista cerrada que ya funciona con las categorías.
// ---------------------------------------------------------------------------
export const PLATO_SYSTEM = `Eres un experto en traducción gastronómica profesional. Devuelve únicamente JSON válido, sin markdown, sin \`\`\`json, sin texto adicional. Con los datos de entrada (nombre, descripcion, categoria, alergenos) genera exactamente este objeto con este esquema y estas claves: {"nombre": string, "descripcion": string|null, "traducciones": {"en": {"name": string, "description": string|null, "category": string, "allergens": string[]}, "fr": {"name": string, "description": string|null, "category": string, "allergens": string[]}}}. Debes traducir SIEMPRE el nombre a inglés y francés en traducciones.en.name y traducciones.fr.name, y si descripcion no es null también traducirla en traducciones.en.description y traducciones.fr.description. La categoría debe ser exactamente una de estas en inglés: Rice Dishes, Meats, Salads, Hot Starters, Cold Starters, Shellfish, Today's Specials, Fish, Desserts, Salt-cured Fish, Snacks, y en francés la correspondiente exacta: Plats de riz, Viandes, Salades, Entrées chaudes, Entrées froides, Fruits de mer, Suggestions du jour, Poissons, Desserts, Salaisons, Snacks. No inventes ingredientes ni alérgenos; usa los alérgenos de entrada y tradúcelos solo si ya vienen traducidos en el input, y si el alérgeno Gluten aparece en cualquier idioma debe escribirse exactamente como gluten tanto en inglés como en francés sin traducirlo ni cambiar mayúsculas.

${GLOSARIO_COCINA}`;

// ---------------------------------------------------------------------------
// Novedades — REESCRITO el 2026-10-01 (antes: nodo "Novedades" de n8n, verbatim).
//
// El original pedía "adaptar" y "reescribir los textos como si hubieran sido
// creados originalmente en cada idioma", sin glosario. Medido contra la
// función desplegada con una novedad del cocido (4 de 4 llamadas):
//   · "Llega el cocido gallego" -> "Le Cocido Galicien est de Retour": cambia
//     el sentido ("llega" no es "vuelve") y usa mayúsculas inglesas en francés.
//   · Inglés "Galician Stew" y francés "Cocido": el mismo plato con dos nombres.
// Y la única novedad publicada traduce "zamburiñas" como "coquilles
// Saint-Jacques au moelle osseuse" (especie equivocada y error de género).
// Ahora: fidelidad primero (mismos hechos, mismo sentido), tono natural sin
// inventar, nombres de plato coherentes con la carta (GLOSARIO_COCINA) y la
// MISMA forma de salida (bullets/tags: mismo número y orden), que mapResponse
// valida para no guardar nunca una traducción a medias.
// ---------------------------------------------------------------------------
export const NOVEDAD_SYSTEM = `Eres un traductor nativo profesional especializado en comunicación gastronómica para Casa Tomás, un restaurante de Crevillent (Alicante, España). Traduces del español al inglés (en) y al francés (fr) las novedades que se publican en su web (platos nuevos, eventos, promociones, avisos).

Reglas obligatorias:
- FIDELIDAD ante todo: cada traducción dice exactamente lo mismo que el original. No añadas, quites ni cambies información ni el sentido (si el original dice que algo "llega", no digas que "vuelve"; si no dice "tradicional", no lo añadas). Puedes reordenar la frase para que suene natural a un nativo, pero sin inventar.
- Copia sin cambiar las cifras, precios, fechas, días, horas y rangos horarios; tradúcelos solo de formato si es obligatorio en el idioma (p. ej. "18€" -> "€18" en inglés).
- Ingredientes y alérgenos: tradúcelos tal cual, sin cambiar ninguno por otro.
- Nombres propios: "Casa Tomás", "Touza" y "Crevillent" se escriben siempre tal cual.
- Nombres de platos: aplica el glosario de abajo. Un plato se llama IGUAL en inglés y en francés (o los dos traducidos o los dos en español); si no tiene una traducción reconocida, deja el nombre español en ambos idiomas.
- Mayúsculas: en francés, el título va en minúscula salvo la primera palabra y los nombres propios ("Le cocido galicien arrive", nunca "Le Cocido Galicien Arrive"). En inglés puedes usar mayúsculas de título.
- Siglas y palabras en mayúsculas: las siglas (QA, DJ, IVA, DO...) se copian siempre en mayúsculas, también en francés. Si el original escribe una palabra o el título entero en MAYÚSCULAS, la traducción lo mantiene en MAYÚSCULAS ("QA PRUEBA cata" -> "QA TEST tasting" / "QA TEST dégustation", nunca "Qa test dégustation").
- En francés, dirígete al cliente de "vous".
- "bullets" y "tags": devuelve el MISMO número de elementos que la entrada y en el mismo orden, uno traducido por cada uno original.
- Si un campo de entrada viene vacío, devuélvelo vacío ("" o []).

${GLOSARIO_COCINA}

Devuelve únicamente un objeto JSON válido, sin markdown, sin explicaciones y sin texto adicional, usando exactamente esta estructura:

{
"traducciones": {
"en": {
"title": "",
"description": "",
"badge": "",
"bullets": [],
"tags": []
},
"fr": {
"title": "",
"description": "",
"badge": "",
"bullets": [],
"tags": []
}
}
}`;

// ---------------------------------------------------------------------------
// Menú del día / Tapas — NUEVO. El nodo "Menú y tapas" de n8n reutilizaba
// literalmente el prompt de Bebidas ("mi tabla de Bebidas", "Agua con gas"...)
// pegado por error; además esa rama nunca escribía en la tabla correcta
// (insertaba en menus_diarios incluso para tapas) y la rama de tapas ni
// siquiera respondía al webhook (nodo Vuelta6 sin conexión de entrada). Aquí
// se sustituye por un prompt propio para el dominio real: menú del día y
// listas de tapas. Lleva también GLOSARIO_COCINA al final: por aquí pasan
// nombres de plato escritos a mano Y, si la consulta de la carta falla en el
// editor del menú del día, los platos enlazados que ya tenían traducción buena
// (EditorMenuTapasWeb.tsx: `necesitaTraduccion` se cumple para todos cuando
// `platosPorId` viene vacío, y la fila en/fr se sobrescribe con lo que salga).
// ---------------------------------------------------------------------------
export const MENU_TAPAS_SYSTEM = `Eres un traductor gastronómico profesional para la carta de un restaurante español. Traduces al inglés (en) y al francés (fr) el contenido del menú del día o de la lista de tapas, con un lenguaje natural y apetitoso propio de una carta de restaurante, no literal.

No traduzcas nombres de marcas comerciales si aparecen. Traduce los nombres de platos y técnicas culinarias de forma profesional y reconocible para un cliente extranjero (ej. 'Carrillera' -> 'Braised beef cheek' / 'Joue de bœuf braisée').

La entrada puede venir en dos formatos:
1. Tres campos de un menú del día: primero, segundo, postre.
2. Una lista de tapas, una por línea.

Devuelve ÚNICAMENTE un objeto JSON válido, sin markdown ni texto adicional, que refleje la MISMA FORMA que la entrada:
- Si la entrada trae primero/segundo/postre: {"en": {"primero": "...", "segundo": "...", "postre": "..."}, "fr": {"primero": "...", "segundo": "...", "postre": "..."}}
- Si la entrada es una lista de tapas: {"en": ["...", "..."], "fr": ["...", "..."]}

No añadas platos ni elimines ninguno. Mantén el mismo número de elementos que la entrada.

${GLOSARIO_COCINA}`;

// ---------------------------------------------------------------------------
// Cóctel — NUEVO. El switch de "Elección Tipo" en TraducirIA.json solo tenía
// ramas para menu/plato/bebida/vino/novedad/bot/tapas: "coctel" jamás hizo
// match, así que ni traducía ni insertaba nada (de ahí 0/13 cócteles
// traducidos, y por qué useCocteles.ts nunca escribía en la tabla Cocteles).
// Categorías reales verificadas en la tabla: clasicos, autor, sin-alcohol.
// ---------------------------------------------------------------------------
export const COCTEL_SYSTEM = `Eres un experto en mixología y traducción de cartas de coctelería. Tu tarea es generar un objeto JSON con la traducción al inglés (en) y al francés (fr) de un cóctel de la carta.

Instrucciones específicas:

Nombres de cóctel: NO traduzcas nombres de cócteles internacionalmente reconocidos ni nombres propios o de autor (ej. Mojito, Negroni, Dry Martini, Old Fashioned se quedan igual). Si el nombre es una descripción en español inventada por la casa, tradúcelo de forma natural y atractiva.

Marcas: NO traduzcas nombres comerciales de bebidas espirituosas, licores o mezcladores (Angostura, Cointreau, Campari, Bacardí, Absolut, Schweppes...).

Categoría: debe devolverse exactamente así según el valor de entrada — "clasicos" -> "Classics" (en) / "Classiques" (fr); "autor" -> "Signature" (en) / "Signature" (fr); "sin-alcohol" -> "Non-Alcoholic" (en) / "Sans alcool" (fr). Si el valor no coincide con ninguno de esos, tradúcelo de forma profesional manteniendo el sentido.

Campos: Procesa nombre, categoria, descripcion e ingredientes.

Devuelve ÚNICAMENTE este JSON, sin markdown ni texto adicional:
{
  "en": { "nombre": "...", "categoria": "...", "descripcion": "...", "ingredientes": "..." },
  "fr": { "nombre": "...", "categoria": "...", "descripcion": "...", "ingredientes": "..." }
}`;

// ---------------------------------------------------------------------------
// Helpers de normalización de entrada
// ---------------------------------------------------------------------------

/** alergenos_oficiales es jsonb en Platos/Cocteles/Vinos pero el CONTENIDO
 * varía: array de strings en Platos, string JSON-encoded en Vinos. Esta
 * función acepta cualquiera de las dos formas (o un objeto {id: boolean} de
 * checkboxes) y siempre devuelve un array de strings limpio. */
export function normalizarAlergenos(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string" && v.trim() !== "");
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "[]") return [];
    // Puede venir como "a, b, c" o como un JSON-string "[\"a\",\"b\"]"
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return normalizarAlergenos(parsed);
    } catch {
      // no era JSON, tratar como lista separada por comas
    }
    return trimmed.split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => Boolean(v))
      .map(([k]) => k);
  }
  return [];
}

const toStr = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const nullIfEmpty = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};
const strArray = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);

/**
 * Qué campos de una novedad tienen texto en español pero llegan vacíos (o con
 * otro número de elementos) en la respuesta del modelo. Lista vacía = completa.
 * Misma regla que `camposSinTraducir` en el panel
 * (src/lib/traduccion-novedad.ts): si se cambia una, cambiar la otra.
 */
export function camposNovedadSinTraducir(
  datos: Record<string, unknown>,
  respuesta: Record<"en" | "fr", Record<string, unknown>>,
): string[] {
  const faltan: string[] = [];
  const lleno = (v: unknown) => typeof v === "string" && v.trim() !== "";
  const noVacios = (v: unknown) => strArray(v).filter((x) => x.trim() !== "");
  const textos: [string, unknown][] = [
    ["title", datos.titulo ?? datos.nombre],
    ["description", datos.descripcion],
    ["badge", datos.badge_text],
  ];
  const listas: [string, unknown][] = [
    ["bullets", datos.bullets],
    ["tags", datos.tags],
  ];
  for (const idioma of ["en", "fr"] as const) {
    const bloque = respuesta[idioma] ?? {};
    for (const [clave, original] of textos) {
      if (lleno(original) && !lleno(bloque[clave])) faltan.push(`${idioma}.${clave}`);
    }
    for (const [clave, original] of listas) {
      const esperados = noVacios(original).length;
      if (esperados > 0 && noVacios(bloque[clave]).length !== esperados) faltan.push(`${idioma}.${clave}`);
    }
  }
  return faltan;
}

// ---------------------------------------------------------------------------
// Construcción del mensaje de usuario + mapeo de la respuesta a columnas de
// base de datos, por tipo. El mapeo es a propósito distinto por tabla: cada
// uno solo incluye las columnas *_en/*_fr que REALMENTE existen en esa tabla
// (ver TAREA 4 — Vinos no tiene descripcion_en/fr ni denominacion_origen_en/fr,
// así que esos campos del prompt de Vino se piden al modelo pero no se
// escriben en ningún lado).
// ---------------------------------------------------------------------------

export interface PromptSpec {
  system: string;
  userMessage: string;
  /** Traduce la respuesta cruda del modelo (ya parseada de JSON) a un objeto
   * plano listo para hacer `.update()`/`.insert()` con las columnas reales. */
  mapResponse: (raw: unknown) => Record<string, unknown>;
}

export function buildPromptSpec(tipo: TipoContenido, datos: Record<string, unknown>): PromptSpec {
  switch (tipo) {
    case "vino": {
      const userMessage = `Nombre:${toStr(datos.nombre)}\nDescripción:${toStr(datos.descripcion)}\nCategoria:${toStr(datos.categoria)}\nUbicacion_pais:${toStr(datos.ubicacion_pais)}\nUbicación_region:${toStr(datos.ubicacion_region)}\nALergenos: ${toStr(datos.alergenos_notas)}`;
      return {
        system: VINO_SYSTEM,
        userMessage,
        mapResponse: (raw) => {
          const r = (raw ?? {}) as Record<string, any>;
          const en = r.en ?? {};
          const fr = r.fr ?? {};
          // Nota: sin descripcion_en/fr ni denominacion_origen_en/fr — esas
          // columnas no existen en Vinos (ver informe, TAREA 4).
          return {
            nombre_en: nullIfEmpty(en.nombre),
            categoria_en: nullIfEmpty(en.categoria),
            alergenos_en: nullIfEmpty(en.alergenos),
            ubicacion_pais_en: nullIfEmpty(en.ubicacion_pais),
            ubicacion_region_en: nullIfEmpty(en.ubicacion_region),
            nombre_fr: nullIfEmpty(fr.nombre),
            categoria_fr: nullIfEmpty(fr.categoria),
            alergenos_fr: nullIfEmpty(fr.alergenos),
            ubicacion_pais_fr: nullIfEmpty(fr.ubicacion_pais),
            ubicacion_region_fr: nullIfEmpty(fr.ubicacion_region),
          };
        },
      };
    }

    case "bebida": {
      const userMessage = `Nombre: ${toStr(datos.nombre)}\nDescripcion: ${toStr(datos.descripcion)}\nCategoria: ${toStr(datos.categoria)}`;
      return {
        system: BEBIDA_SYSTEM,
        userMessage,
        mapResponse: (raw) => {
          const r = (raw ?? {}) as Record<string, any>;
          const en = r.en ?? {};
          const fr = r.fr ?? {};
          return {
            nombre_en: nullIfEmpty(en.nombre),
            categoria_en: nullIfEmpty(en.categoria),
            descripcion_en: nullIfEmpty(en.descripcion),
            nombre_fr: nullIfEmpty(fr.nombre),
            categoria_fr: nullIfEmpty(fr.categoria),
            descripcion_fr: nullIfEmpty(fr.descripcion),
          };
        },
      };
    }

    case "plato": {
      const alergenos = normalizarAlergenos(datos.alergenos ?? datos.alergenos_oficiales);
      const userMessage = `Nombre: ${toStr(datos.nombre)}\nDescripción: ${toStr(datos.descripcion)}\nCategoria:  ${toStr(datos.categoria)}\nAlergenos: ${alergenos.join(", ")}`;
      return {
        system: PLATO_SYSTEM,
        userMessage,
        mapResponse: (raw) => {
          const r = (raw ?? {}) as Record<string, any>;
          const en = r.traducciones?.en ?? {};
          const fr = r.traducciones?.fr ?? {};
          const allergensEn = strArray(en.allergens);
          const allergensFr = strArray(fr.allergens);
          return {
            nombre_en: nullIfEmpty(en.name),
            categoria_en: nullIfEmpty(en.category),
            descripcion_en: nullIfEmpty(en.description),
            alergenos_en: allergensEn.length ? allergensEn.join(", ") : null,
            nombre_fr: nullIfEmpty(fr.name),
            categoria_fr: nullIfEmpty(fr.category),
            descripcion_fr: nullIfEmpty(fr.description),
            alergenos_fr: allergensFr.length ? allergensFr.join(", ") : null,
          };
        },
      };
    }

    case "coctel": {
      const userMessage = `Nombre: ${toStr(datos.nombre)}\nDescripcion: ${toStr(datos.descripcion)}\nIngredientes: ${toStr(datos.ingredientes)}\nCategoria: ${toStr(datos.categoria)}`;
      return {
        system: COCTEL_SYSTEM,
        userMessage,
        mapResponse: (raw) => {
          const r = (raw ?? {}) as Record<string, any>;
          const en = r.en ?? {};
          const fr = r.fr ?? {};
          return {
            nombre_en: nullIfEmpty(en.nombre),
            categoria_en: nullIfEmpty(en.categoria),
            descripcion_en: nullIfEmpty(en.descripcion),
            ingredientes_en: nullIfEmpty(en.ingredientes),
            nombre_fr: nullIfEmpty(fr.nombre),
            categoria_fr: nullIfEmpty(fr.categoria),
            descripcion_fr: nullIfEmpty(fr.descripcion),
            ingredientes_fr: nullIfEmpty(fr.ingredientes),
          };
        },
      };
    }

    case "novedad": {
      const userMessage = `Título:${toStr(datos.titulo ?? datos.nombre)}\nDescripción:${toStr(datos.descripcion)}\nBadge:${toStr(datos.badge_text)}\nBullets:${JSON.stringify(datos.bullets ?? [])}\nTags: ${JSON.stringify(datos.tags ?? [])}`;
      return {
        system: NOVEDAD_SYSTEM,
        userMessage,
        mapResponse: (raw) => {
          const r = (raw ?? {}) as Record<string, any>;
          const en = r.traducciones?.en ?? {};
          const fr = r.traducciones?.fr ?? {};
          // Antes se devolvía lo que hubiera, aunque faltase un idioma entero:
          // la función contestaba ok:true con nulls, el panel lo guardaba como
          // "traducido" y en una edición machacaba la traducción buena anterior.
          // Lanzar aquí hace que index.ts responda ok:false y el panel avise.
          const faltan = camposNovedadSinTraducir(datos, { en, fr });
          if (faltan.length > 0) {
            throw new Error(`Traducción de la novedad incompleta: ${faltan.join(", ")}`);
          }
          return {
            titulo_en: nullIfEmpty(en.title),
            descripcion_en: nullIfEmpty(en.description),
            badge_text_en: nullIfEmpty(en.badge),
            bullets_en: strArray(en.bullets),
            tags_en: strArray(en.tags),
            titulo_fr: nullIfEmpty(fr.title),
            descripcion_fr: nullIfEmpty(fr.description),
            badge_text_fr: nullIfEmpty(fr.badge),
            bullets_fr: strArray(fr.bullets),
            tags_fr: strArray(fr.tags),
          };
        },
      };
    }

    case "tapas": {
      const items = Array.isArray(datos.tapas) ? (datos.tapas as unknown[]).map(toStr).filter(Boolean) : [];
      const userMessage = `Lista de tapas (una por línea):\n${items.join("\n")}`;
      return {
        system: MENU_TAPAS_SYSTEM,
        userMessage,
        mapResponse: (raw) => {
          const r = (raw ?? {}) as Record<string, any>;
          return {
            tapas_en: strArray(r.en),
            tapas_fr: strArray(r.fr),
          };
        },
      };
    }

    case "menu": {
      const userMessage = `Primero: ${toStr(datos.primero)}\nSegundo: ${toStr(datos.segundo)}\nPostre: ${toStr(datos.postre)}`;
      return {
        system: MENU_TAPAS_SYSTEM,
        userMessage,
        mapResponse: (raw) => {
          const r = (raw ?? {}) as Record<string, any>;
          const en = r.en ?? {};
          const fr = r.fr ?? {};
          return {
            menu_en: {
              primero: toStr(en.primero),
              segundo: toStr(en.segundo),
              postre: toStr(en.postre),
            },
            menu_fr: {
              primero: toStr(fr.primero),
              segundo: toStr(fr.segundo),
              postre: toStr(fr.postre),
            },
          };
        },
      };
    }

    default: {
      // Nunca debería llegar aquí: el caller (index.ts) valida `tipo` antes.
      throw new Error(`Tipo de contenido no soportado: ${tipo}`);
    }
  }
}
