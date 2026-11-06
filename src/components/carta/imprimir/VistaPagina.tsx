import { memo } from "react";
import { FAMILIA_VISTA } from "@/lib/carta-pdf/fuentes";
import { CRUZ_TOUZA, LOGO_CASA_TOMAS, MEDALLON_CASA_TOMAS, type LogoVectorial } from "@/lib/carta-pdf/logos";
import type { ColorRgb, LogoCarta, PaginaCarta } from "@/lib/carta-pdf/maquetacion";

/**
 * Una página de la carta impresa en SVG, con los mismos trazos que el PDF
 * (maquetacion.ts) y la misma fuente (registrada con FontFace al abrir el
 * diálogo). Es la vista previa: lo que se ve aquí es lo que sale en el PDF.
 */

const LOGOS: Record<LogoCarta, LogoVectorial> = {
  casaTomas: LOGO_CASA_TOMAS,
  medallon: MEDALLON_CASA_TOMAS,
  touza: CRUZ_TOUZA,
};

const color = ({ r, g, b }: ColorRgb) => `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;

const RESERVA = `"Libre Baskerville", Georgia, "Times New Roman", serif`;

interface Props {
  pagina: PaginaCarta;
  className?: string;
  /** Nombre accesible (p. ej. «Página 3 de 15»). */
  etiqueta?: string;
}

export const VistaPagina = memo(function VistaPagina({ pagina, className, etiqueta }: Props) {
  return (
    <svg
      viewBox={`0 0 ${pagina.ancho} ${pagina.alto}`}
      className={className}
      role="img"
      aria-label={etiqueta ?? `Página ${pagina.numero}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width={pagina.ancho} height={pagina.alto} fill="#fff" />
      {pagina.trazos.map((trazo, i) => {
        if (trazo.tipo === "texto") {
          return (
            <text
              key={i}
              x={trazo.x}
              y={trazo.y}
              fontFamily={`"${FAMILIA_VISTA[trazo.fuente]}", ${RESERVA}`}
              fontStyle={trazo.fuente === "italica" ? "italic" : "normal"}
              fontWeight={trazo.fuente === "seminegrita" ? 600 : 400}
              fontSize={trazo.tamano}
              letterSpacing={trazo.espaciado || undefined}
              fill={color(trazo.color)}
              xmlSpace="preserve"
              style={{ fontKerning: "normal" }}
            >
              {trazo.texto}
            </text>
          );
        }
        if (trazo.tipo === "linea") {
          return (
            <line
              key={i}
              x1={trazo.x1}
              y1={trazo.y1}
              x2={trazo.x2}
              y2={trazo.y2}
              stroke={color(trazo.color)}
              strokeWidth={trazo.grosor}
              strokeLinecap={trazo.puntos ? "round" : "butt"}
              strokeDasharray={trazo.puntos ? `0 ${trazo.puntos}` : undefined}
            />
          );
        }
        if (trazo.tipo === "rombo") {
          const { x, y, radio } = trazo;
          return <polygon key={i} points={`${x},${y - radio} ${x + radio},${y} ${x},${y + radio} ${x - radio},${y}`} fill={color(trazo.color)} />;
        }
        const logo = LOGOS[trazo.logo];
        return (
          <path
            key={i}
            d={logo.d}
            transform={`translate(${trazo.x} ${trazo.y}) scale(${trazo.ancho / logo.ancho})`}
            fill={color(trazo.color)}
            fillRule="evenodd"
          />
        );
      })}
    </svg>
  );
});
