import type { CSSProperties } from "react";
import { generarFontFaces, type MarcaId } from "@/lib/instagram/tokens";
import { CSS_FAMILIA, ESTILOS, ESTILOS_IDS, previaCss, sumarTratamientos, TRATAMIENTO_NEUTRO, type ComposicionMarca, type EstiloId, type FamiliaMotor } from "@/lib/rrss/estilos";
import { cn } from "@/lib/utils";

const fuente = (f: FamiliaMotor): CSSProperties => {
  const c = CSS_FAMILIA[f];
  return { fontFamily: c.familia, fontWeight: c.peso, fontStyle: c.estilo };
};

/** Rótulo de muestra con la composición del estilo (aproximada): mismo reparto que el motor. */
function RotuloMuestra({ c }: { c: ComposicionMarca }) {
  const centro = c.alinear === "centro";
  const titular: CSSProperties = {
    ...fuente(c.titular),
    color: c.colorTexto,
    textTransform: c.mayusculasTitular ? "uppercase" : "none",
    // 12 px como mínimo aunque la tarjeta sea estrecha.
    fontSize: `max(14px, ${(c.escalaTitular * 100 * 1.6).toFixed(1)}cqw)`,
    lineHeight: 1.1,
  };
  const ante: CSSProperties = { ...fuente(c.antetitulo), color: c.colorAcento, fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase" };
  const cta: CSSProperties = { ...fuente(c.antetitulo), background: c.colorAcento, color: c.colorSobreAcento, fontSize: 12, borderRadius: 999, padding: "3px 10px", display: "inline-block" };
  const alinear = centro ? "text-center items-center" : "text-left items-start";

  switch (c.tipo) {
    case "degradado":
      return (
        <div className={cn("absolute inset-x-0 bottom-0 flex flex-col gap-1 p-3 pt-10", alinear)} style={{ background: `linear-gradient(to top, ${c.colorFondo}, rgba(0,0,0,0))` }}>
          <span style={ante}>Temporada</span>
          <span style={titular}>Arroz del señorito</span>
        </div>
      );
    case "banda":
      return (
        <div className={cn("absolute inset-x-0 bottom-[12%] flex flex-col gap-1 px-3 py-2", alinear)} style={{ background: c.colorFondo }}>
          <span style={ante}>Temporada</span>
          <span style={titular}>Arroz del señorito</span>
        </div>
      );
    case "bloque":
      return (
        <div className="absolute bottom-[10%] left-0 flex max-w-[85%] flex-col gap-1 p-3 text-left" style={{ background: c.colorFondo }}>
          <span style={titular}>Arroz del señorito</span>
          <span style={{ ...fuente(c.texto), color: c.colorTexto, fontSize: 12 }}>Ya en carta</span>
        </div>
      );
    case "cartel":
      return (
        <div className={cn("absolute inset-0 flex flex-col justify-center gap-2 p-3", alinear)} style={{ background: c.colorFondo }}>
          <span style={ante}>Evento</span>
          <span style={{ ...titular, fontSize: `max(16px, ${(c.escalaTitular * 100 * 1.8).toFixed(1)}cqw)` }}>Arroz del señorito</span>
          <span style={cta}>Reserva</span>
        </div>
      );
    case "minimo":
      return (
        <div className={cn("absolute inset-x-0 bottom-0 flex flex-col gap-0.5 p-3", alinear)}>
          <span style={{ ...titular, textShadow: "0 1px 6px rgba(255,255,255,0.45)" }}>Arroz del señorito</span>
        </div>
      );
    case "marco":
      return (
        <>
          <div className="pointer-events-none absolute inset-[6%] border-2" style={{ borderColor: c.colorAcento }} />
          <div className={cn("absolute inset-x-[6%] bottom-[6%] flex flex-col gap-1 px-3 py-2", alinear)} style={{ background: c.colorFondo }}>
            <span style={ante}>Casa</span>
            <span style={titular}>Arroz del señorito</span>
          </div>
        </>
      );
  }
}

interface PreviaProps {
  estilo: EstiloId;
  marca: MarcaId;
  src?: string;
  ancho: number;
  alto: number;
}

export function PreviaEstilo({ estilo, marca, src, ancho, alto }: PreviaProps) {
  const e = ESTILOS[estilo];
  const tr = sumarTratamientos(TRATAMIENTO_NEUTRO, e.tratamiento[marca]);
  const p = previaCss(tr);
  return (
    <div className="relative w-full overflow-hidden rounded-md bg-muted" style={{ aspectRatio: `${ancho} / ${alto}`, containerType: "inline-size" }}>
      {src ? (
        <img src={src} alt="" data-testid={`imagen-estilo:${estilo}`} data-filtro={p.filter} className="absolute inset-0 h-full w-full object-cover" style={{ filter: p.filter }} />
      ) : (
        <div data-testid={`imagen-estilo:${estilo}`} data-filtro={p.filter} className="absolute inset-0" style={{ filter: p.filter, background: "linear-gradient(135deg,#c9a46a 0%,#8a5a35 55%,#3b2a1c 100%)" }} />
      )}
      {p.vineta > 0 && <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,${(0.8 * p.vineta).toFixed(2)}) 100%)` }} />}
      {p.mate > 0 && <div className="absolute inset-0" style={{ background: `rgba(255,255,255,${(0.12 * p.mate).toFixed(3)})` }} />}
      <RotuloMuestra c={e.composicion[marca]} />
    </div>
  );
}

interface Props {
  estilo: EstiloId;
  marca: MarcaId;
  /** Primera foto del trabajo (o el póster del primer vídeo). */
  src?: string;
  ancho: number;
  alto: number;
  onEstilo: (e: EstiloId) => void;
}

export function PasoEstilo({ estilo, marca, src, ancho, alto, onEstilo }: Props) {
  return (
    <div className="space-y-3">
      <style>{generarFontFaces(marca, { baseRecursos: "/instagram" })}</style>
      <p className="text-sm text-muted-foreground">
        {src ? "Así se vería cada estilo sobre tu primera foto." : "Sube una foto para ver cada estilo sobre ella; mientras, se ve sobre una imagen de muestra."}
      </p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3" role="group" aria-label="Estilo visual">
        {ESTILOS_IDS.map((id) => {
          const e = ESTILOS[id];
          const activo = id === estilo;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={activo}
              data-testid={`estilo:${id}`}
              onClick={() => onEstilo(id)}
              className={cn(
                "flex flex-col gap-2 rounded-lg border p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                activo ? "border-primary ring-2 ring-primary" : "border-border hover:bg-muted",
              )}
            >
              <PreviaEstilo estilo={id} marca={marca} src={src} ancho={ancho} alto={alto} />
              <span className="text-sm font-medium">{e.nombre}</span>
              <span className="text-xs text-muted-foreground">{e.descripcion}</span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">Vista previa aproximada: el resultado lo hace el motor.</p>
    </div>
  );
}
