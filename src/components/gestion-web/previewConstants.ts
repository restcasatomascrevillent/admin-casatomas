// Shared constants to keep the image position selector aligned with the MobilePreview crop.

// In MobilePreview, the phone screen content has px-3, so the card width is ~ (320 - 24) = 296px.
// The image container used to be h-24 (96px). This ratio keeps the same look while making it responsive.
export const MOBILE_PREVIEW_IMAGE_ASPECT_RATIO = 296 / 96;

// Tarjeta de Novedades en la web pública (casa-tomas-story, NovedadesSection):
// la imagen mide h-44 (176px) y en móvil la tarjeta ocupa el ancho de pantalla
// menos px-4 a cada lado (~343px en un móvil de 375px). En escritorio (3
// columnas en max-w-7xl) sale ~362x176, prácticamente la misma proporción.
// El editor de novedades encuadra la foto con ESTA proporción; la de arriba
// se conserva porque la usan los selectores de la carta (ListaPlatos/Vinos).
export const NOVEDAD_CARD_IMAGE_ASPECT_RATIO = 343 / 176;
