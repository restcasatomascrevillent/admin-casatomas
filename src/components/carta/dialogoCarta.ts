/**
 * Los diálogos de la carta con foto (alta, edición y «Foto» de la tarjeta) NO
 * se cierran al tocar fuera: solo con «Cancelar», la X o Escape.
 *
 * Por qué: al volver del selector de fotos o de la cámara del móvil, el toque
 * con el que se eligió la foto puede llegar a la página como un toque «fuera»
 * del diálogo (o caer encima de un aviso de sonner, que también está fuera), y
 * Radix lo cerraba: se perdía la foto elegida y todo lo escrito en la ficha.
 * Va en `onInteractOutside` (cubre toque y foco fuera) del `DialogContent`.
 */
export function noCerrarAlTocarFuera(evento: Event): void {
  evento.preventDefault();
}
