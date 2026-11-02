import { useState, type ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { esFotoCarta } from "./rutasFotoCarta";

export interface FotoTarjeta {
  url: string;
  /** Texto alternativo (el nombre del elemento). */
  alt: string;
  /** Si se pasa, la foto es un botón que la abre en grande. */
  onAbrir?: () => void;
  /** Nombre accesible del botón de «abrir en grande». */
  etiquetaAbrir?: string;
}

interface TarjetaCartaLateralProps {
  className?: string;
  /**
   * Foto que se enseña en la columna lateral. `null` cuando el elemento no tiene
   * foto o el ojo la tiene oculta: la tarjeta queda como siempre, sin hueco de foto.
   */
  foto: FotoTarjeta | null;
  /** Categoría (la etiqueta discreta). */
  categoria: ReactNode;
  /** Nombre (el `h3`). */
  titulo: ReactNode;
  /** Botones de la foto (ajustar posición y ojo): junto a la categoría, o junto al nombre sin foto. */
  controlesFoto: ReactNode;
  /** Descripción, ingredientes, origen y precio: van junto a la foto. */
  info: ReactNode;
  /** Alérgenos y notas: a todo el ancho, debajo de la foto. */
  infoExtra?: ReactNode;
  /** Interruptores de visibilidad y de foto expandida. */
  controles: ReactNode;
  /** Foto / Editar / Eliminar. */
  acciones: ReactNode;
}

/**
 * Las fotos de carta son 3:4 (900×1200): botella al ~80 % del alto y ~25 % del ancho,
 * centrada sobre cartulina kraft. Igual que en la web (CartaVinos): marco 3:5 con
 * `object-cover`; con un marco igual o más estrecho que 3:4, `cover` solo recorta
 * cartulina de los lados, nunca la botella en alto. Las fotos antiguas (otras
 * proporciones) van enteras con `object-contain` sobre fondo oscuro.
 */
const MARCO_CARTA = "aspect-[3/5] bg-[#cdae77]";
const MARCO_ANTIGUA = "aspect-[3/4] bg-[#1a1612]";

/**
 * Tarjeta de la carta (vinos, bebidas, cócteles) con la foto en una columna
 * lateral para que se vea la botella entera sin alargar la tarjeta:
 *
 *   con foto:  [ foto | categoría + ojo / nombre / descripción y precio ]
 *              [ alérgenos · interruptores · Foto / Editar / Eliminar    ]
 *   sin foto:  [ categoría + nombre | ojo ] interruptores, descripción… (como siempre)
 *
 * La parte de arriba (foto + texto) deja el ancho de la columna de texto para el
 * nombre y el precio; los interruptores y los botones, que necesitan 44 px de
 * alto y su texto entero, quedan debajo, a todo el ancho de la tarjeta.
 */
export function TarjetaCartaLateral({
  className,
  foto,
  categoria,
  titulo,
  controlesFoto,
  info,
  infoExtra,
  controles,
  acciones,
}: TarjetaCartaLateralProps) {
  // Si la foto no carga (borrada del Storage, ruta rota) se vuelve a la tarjeta sin foto.
  const [urlRota, setUrlRota] = useState<string | null>(null);
  const fotoVisible = foto && foto.url !== urlRota ? foto : null;
  const claseTarjeta = cn("overflow-hidden transition-opacity duration-300 hover:shadow-lg", className);

  if (!fotoVisible) {
    return (
      <Card className={claseTarjeta}>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              {categoria}
              {titulo}
            </div>
            <div className="flex flex-shrink-0 items-center gap-1">{controlesFoto}</div>
          </div>
          {controles}
          {info}
          {infoExtra}
          {acciones}
        </CardContent>
      </Card>
    );
  }

  const esCarta = esFotoCarta(fotoVisible.url);
  const imagen = (
    <img
      src={fotoVisible.url}
      alt={fotoVisible.alt}
      width={900}
      height={1200}
      loading="lazy"
      decoding="async"
      className={cn("absolute inset-0 h-full w-full", esCarta ? "object-cover" : "object-contain")}
      onError={() => setUrlRota(fotoVisible.url)}
    />
  );

  return (
    <Card className={claseTarjeta}>
      <div className="flex items-stretch gap-3 p-3">
        {/* El marco no tiene contenido en flujo: su alto sale del aspect-ratio (mínimo) o de la
            columna de texto si es más alta, así que no hay salto de maquetación al cargar. */}
        <div
          data-testid="foto-lateral"
          data-foto={esCarta ? "carta" : "antigua"}
          className={cn(
            "relative w-[30%] min-w-[5.5rem] max-w-28 shrink-0 overflow-hidden rounded-md border border-border/60",
            esCarta ? MARCO_CARTA : MARCO_ANTIGUA,
          )}
        >
          {fotoVisible.onAbrir ? (
            <button
              type="button"
              onClick={fotoVisible.onAbrir}
              aria-label={fotoVisible.etiquetaAbrir ?? `Ver la foto de ${fotoVisible.alt} en grande`}
              title={fotoVisible.etiquetaAbrir ?? `Ver la foto de ${fotoVisible.alt} en grande`}
              className="absolute inset-0 block h-full w-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              {imagen}
            </button>
          ) : (
            imagen
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {/* Los botones de la foto (44 px) comparten fila con la categoría y se salen un poco del
              relleno para no engordar la tarjeta; el nombre queda debajo, a todo el ancho. */}
          <div className="-mr-1.5 -mt-1.5 flex items-center justify-between gap-1">
            <div className="min-w-0 flex-1">{categoria}</div>
            <div className="flex shrink-0 items-center">{controlesFoto}</div>
          </div>
          {titulo}
          <div className="mt-auto space-y-2">{info}</div>
        </div>
      </div>

      <div className="space-y-3 px-3 pb-3">
        {infoExtra}
        {controles}
        {acciones}
      </div>
    </Card>
  );
}
