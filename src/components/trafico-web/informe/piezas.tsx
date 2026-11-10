/**
 * Piezas comunes de las diapositivas de los informes mensuales (lienzo 16:9 de
 * 1280 × 720, titular con filete de oro, cifras grandes, tarjeta pizarra,
 * muestras de leyenda e insignia de variación). Las usan el informe de tráfico
 * web (./Diapositivas.tsx) y el de redes sociales
 * (src/components/rrss/metricas/informe/Diapositivas.tsx), para que los dos
 * se vean iguales. Medidas en px y estilos en línea: ver ./Diapositivas.tsx.
 */
import type { CSSProperties, ReactNode } from "react";
import { fmtVariacion } from "./formatoInforme";
import { ALTO_DIAPOSITIVA, ANCHO_DIAPOSITIVA, COLOR, PILA_FUENTES, PILA_TITULOS } from "./tema";

export const MARGEN_X = 72;

// ─── Piezas comunes ──────────────────────────────────────────────────────────
/**
 * Lienzo de una diapositiva. `web` pone al pie, abajo a la izquierda, de qué
 * web son los datos («Web de Casa Tomás» / «Web de Touza»): el informe tiene
 * las dos y cada diapositiva tiene que decir a cuál se refiere.
 */
export function Lienzo({ numero, titulo, web, children }: { numero?: number; titulo: string; web?: string; children: ReactNode }) {
  return (
    <section
      data-diapositiva={numero ?? 1}
      aria-label={titulo}
      style={{
        position: "relative",
        width: ANCHO_DIAPOSITIVA,
        height: ALTO_DIAPOSITIVA,
        boxSizing: "border-box",
        padding: `50px ${MARGEN_X}px 54px`,
        background: COLOR.papel,
        color: COLOR.pizarra,
        fontFamily: PILA_FUENTES,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        WebkitFontSmoothing: "antialiased",
      }}
    >
      {children}
      {web && (
        <span
          data-web-diapositiva={web}
          style={{
            position: "absolute",
            left: MARGEN_X,
            bottom: 22,
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            lineHeight: "18px",
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: COLOR.tenue,
          }}
        >
          <span aria-hidden style={{ display: "block", width: 14, height: 2, borderRadius: 1, background: COLOR.oro }} />
          {web}
        </span>
      )}
      {numero !== undefined && (
        <span style={{ position: "absolute", right: 28, bottom: 22, fontSize: 15, color: COLOR.pizarra }}>{numero}</span>
      )}
    </section>
  );
}

/** Filete de oro (como los de la web): encabeza el titular de cada diapositiva. */
export function Filete({ ancho = 48, style }: { ancho?: number; style?: CSSProperties }) {
  return <span aria-hidden style={{ display: "block", width: ancho, height: 3, borderRadius: 2, background: COLOR.oro, ...style }} />;
}

/** Titular con su filete de oro. `antetitulo` (en oro, encima): la web de las diapositivas de Touza. */
export function Titular({ children, ancho = 1040, antetitulo }: { children: ReactNode; ancho?: number; antetitulo?: string }) {
  return (
    <>
      {antetitulo && (
        <Etiqueta color={COLOR.oro} style={{ fontWeight: 600, marginBottom: 12 }}>
          {antetitulo}
        </Etiqueta>
      )}
      <Filete style={{ marginBottom: 16 }} />
      <h2
        style={{
          margin: 0,
          maxWidth: ancho,
          fontFamily: PILA_TITULOS,
          fontSize: 38,
          lineHeight: 1.2,
          fontWeight: 700,
          letterSpacing: "-0.01em",
          color: COLOR.pizarra,
          // Líneas equilibradas: sin una palabra suelta en la segunda línea.
          textWrap: "balance",
        } as CSSProperties}
      >
        {children}
      </h2>
    </>
  );
}

export function Etiqueta({ children, color = COLOR.pizarra, style }: { children: ReactNode; color?: string; style?: CSSProperties }) {
  return (
    <p
      style={{
        margin: 0,
        fontSize: 15,
        lineHeight: 1.35,
        fontWeight: 500,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color,
        ...style,
      }}
    >
      {children}
    </p>
  );
}

export function Explicacion({ children, color = COLOR.tenue, style }: { children: ReactNode; color?: string; style?: CSSProperties }) {
  return <p style={{ margin: 0, fontSize: 16, lineHeight: 1.4, color, ...style }}>{children}</p>;
}

export function Cifra({ children, tamano, color = COLOR.pizarra }: { children: ReactNode; tamano: number; color?: string }) {
  return (
    <p
      style={{
        margin: 0,
        fontFamily: PILA_TITULOS,
        fontSize: tamano,
        lineHeight: 1,
        fontWeight: 700,
        letterSpacing: "-0.02em",
        color,
      }}
    >
      {children}
    </p>
  );
}

export function Tarjeta({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ background: COLOR.pizarra, color: COLOR.blanco, borderRadius: 28, padding: "32px 36px", boxSizing: "border-box", ...style }}>
      {children}
    </div>
  );
}

/** Muestra de leyenda: línea corta (series de línea/área) o punto (marcador). */
export function Muestra({ color, forma = "linea" }: { color: string; forma?: "linea" | "punto" | "cuadro" }) {
  const base: CSSProperties = { display: "inline-block", flexShrink: 0, background: color };
  if (forma === "punto") return <span aria-hidden style={{ ...base, width: 14, height: 14, borderRadius: 7 }} />;
  if (forma === "cuadro") return <span aria-hidden style={{ ...base, width: 16, height: 16, borderRadius: 4 }} />;
  return <span aria-hidden style={{ ...base, width: 24, height: 4, borderRadius: 2 }} />;
}

/**
 * Insignia «+27,1 % frente a septiembre» bajo la etiqueta de una cifra: en oro
 * si sube y con borde de piedra si baja o se queda igual (nada si no hay
 * comparación válida). Blanco sobre oro: 5,1:1.
 */
export function LineaVariacion({
  variacion,
  mesAnterior,
  esMediaDiaria = false,
}: {
  variacion: { valor: number; base: "total" | "media" } | null;
  mesAnterior: string;
  esMediaDiaria?: boolean;
}) {
  if (!variacion) return null;
  const porDia = variacion.base === "media" && !esMediaDiaria ? " por día" : "";
  const sube = variacion.valor >= 0.05;
  return (
    <p style={{ margin: "8px 0 0" }}>
      <span
        style={{
          display: "inline-block",
          padding: "3px 12px",
          borderRadius: 999,
          fontSize: 16,
          lineHeight: "22px",
          fontWeight: 600,
          background: sube ? COLOR.oro : "transparent",
          color: sube ? COLOR.blanco : COLOR.pizarra,
          border: `1.5px solid ${sube ? COLOR.oro : COLOR.piedra}`,
        }}
      >
        {fmtVariacion(variacion.valor)}
        {porDia} frente a {mesAnterior}
      </span>
    </p>
  );
}
