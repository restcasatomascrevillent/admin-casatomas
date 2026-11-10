# Newsletter: plantillas por bloques y «Crear con IA» (10/11/2026)

Petición del dueño: «Mejorar las plantillas de los correos de la newsletter siguiendo la estética actual y añadir nuevas y botón para crear nuevas con redacción por IA y presentación por IA».

## Cómo está hecho

- **Bloques** (`supabase/functions/_shared/newsletter/bloques.ts`, código puro): un correo es una lista de bloques (texto, foto, caja destacada, lista de platos, fecha y lugar, botón, cita, separador, firma). Todo es texto plano que se escapa al pintarlo; los botones solo admiten `https://` o `tel:`, las fotos solo `https://`. Ahí están también las 8 plantillas de partida (las 3 de siempre + menú de temporada, evento, novedades de la carta, cheques regalo y «en blanco»).
- **Pintado** (`supabase/functions/enviar-newsletter/plantillas.ts`): la misma función para el correo real y la vista previa del panel. Estética de la web y de los correos de reserva (crema, tarjeta de 600 px con filete dorado, logo de la web, Libre Baskerville, pie gris pizarra). Tablas y estilos en línea, condicional `mso` para Outlook, preheader, ajustes de móvil y colores de modo oscuro. El pie de baja sigue siendo obligatorio.
- **Envío**: `enviar-newsletter` acepta además `bloques`, `insignia` y `preheader`. El panel manda siempre `mensaje` (versión de texto), así que con la función anterior desplegada sale al menos el texto con el título.
- **Plantillas guardadas**: tabla `newsletter_plantillas` (migración `20261122153700`), leer con «Ver» en Marketing, guardar y borrar con «Editar».
- **«Crear con IA»**: Edge Function `newsletter-ia`. Redacta y propone los bloques; no envía ni guarda nada. Clave del servidor (`OPENAI_API_KEY`), modelo elegible en Super Admin › Servicios › Modelos (por defecto `NEWSLETTER_IA_MODEL` o `gpt-5.6-luna`), gasto en «Gasto IA» y tope de 40 propuestas por usuario y día (`newsletter_ia_peticiones`). La propuesta se limpia en el servidor: fotos solo de la galería, botones solo a la web del restaurante, aviso de precios o porcentajes que no estaban en la petición y de huecos `[por completar]`.

## Pruebas

`npm test` (plantillas, bloques, newsletter-ia y el creador del panel) y `npm run test:newsletter-plantillas:db` (migración, RLS, tope y rollback en PGlite). Capturas: `node tests/e2e-movil/newsletter.capturas.mjs` (ver su cabecera); las del PR están en `capturas/`.
