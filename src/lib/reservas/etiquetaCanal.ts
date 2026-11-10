/** Nombre del canal de una reserva para enseñarlo. `presencial` = sentados sin reserva (En local). */
const ETIQUETAS: Record<string, string> = {
  telefono: "Teléfono",
  web: "Web",
  manual: "Manual",
  presencial: "En local",
};

export const etiquetaCanal = (canal: string | null | undefined): string =>
  canal ? ETIQUETAS[canal] ?? canal : "Web";
