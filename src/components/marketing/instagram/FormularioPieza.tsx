import { Minus, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SelectorSubrayado } from "@/components/panel/SelectorSubrayado";
import { cn } from "@/lib/utils";
import {
  CAMPOS_PIEZA,
  MARCAS_IDS,
  plantillasDe,
  type CampoPieza,
  type FormatoId,
  type MarcaId,
  type Plantilla,
} from "@/lib/instagram";
import { contarCaracteres, contarPalabras, MAX_PALABRAS_TITULAR } from "./contadores";
import { AYUDA_CAMPO, NOMBRE_CAMPO, type Borrador } from "./pieza";
import { NOMBRE_MARCA_CORTO } from "./HistorialPiezas";
import { SelectorFoto } from "./SelectorFoto";

export const NOMBRE_FORMATO: Record<FormatoId, string> = { post: "Post 4:5", story: "Story 9:16" };

type CampoTexto = Exclude<CampoPieza, "lista" | "foto">;

interface Props {
  borrador: Borrador;
  plantilla: Plantilla | undefined;
  onCambio: (cambio: Partial<Borrador>) => void;
  onMarca: (m: MarcaId) => void;
  onPlantilla: (id: string) => void;
  onCargarEjemplo?: () => void;
  hayEjemplos: boolean;
  /** Campos que nombra algún problema: se marcan en rojo. */
  conProblema: Set<CampoPieza>;
  baseFotos: string;
}

function Contador({ n, max, id }: { n: number; max?: number; id: string }) {
  if (!max) return <span id={id} className="tabular-nums">{n}</span>;
  return (
    <span id={id} className={cn("tabular-nums", n > max && "font-medium text-destructive")}>
      {n}/{max}
    </span>
  );
}

export function FormularioPieza({
  borrador,
  plantilla,
  onCambio,
  onMarca,
  onPlantilla,
  onCargarEjemplo,
  hayEjemplos,
  conProblema,
  baseFotos,
}: Props) {
  const admitidos = new Set<CampoPieza>(plantilla?.admitidos ?? []);
  const obligatorio = (c: CampoPieza) =>
    c === "titular" ? !plantilla?.titularOpcional : (plantilla?.obligatorios ?? []).includes(c);
  const limite = (c: CampoPieza) => plantilla?.limites?.[c];
  const plantillas = plantillasDe(borrador.marca);
  const maxFilas = limite("lista") ?? 8;

  const campoTexto = (campo: CampoTexto) => {
    const id = `ig-${campo}`;
    const valor = borrador[campo];
    const max = limite(campo);
    const largo = campo === "cita";
    const palabras = campo === "titular" ? contarPalabras(valor) : 0;
    const problema = conProblema.has(campo);
    const etiquetaOpcional = !obligatorio(campo);
    const props = {
      id,
      value: valor,
      onChange: (e: { target: { value: string } }) => onCambio({ [campo]: e.target.value } as Partial<Borrador>),
      "aria-invalid": problema || undefined,
      "aria-describedby": `${id}-ayuda ${id}-contador`,
      className: cn(problema && "border-destructive focus-visible:ring-destructive"),
    };
    return (
      <div key={campo} className="space-y-1">
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor={id} className={cn(problema && "text-destructive")}>
            {NOMBRE_CAMPO[campo]}
            {etiquetaOpcional && <span className="ml-1 font-normal text-muted-foreground">(opcional)</span>}
          </Label>
          <span className="text-xs text-muted-foreground">
            {campo === "titular" && (
              <>
                <span className={cn("tabular-nums", palabras > MAX_PALABRAS_TITULAR && "font-medium text-destructive")} data-testid="contador-palabras">
                  {palabras}/{MAX_PALABRAS_TITULAR} palabras
                </span>
                {" · "}
              </>
            )}
            <Contador n={contarCaracteres(valor)} max={max} id={`${id}-contador`} />
          </span>
        </div>
        {largo ? <Textarea rows={3} {...props} /> : <Input {...props} />}
        {AYUDA_CAMPO[campo] && (
          <p id={`${id}-ayuda`} className="text-xs text-muted-foreground">
            {campo === "titular" && plantilla?.titularOpcional ? "Opcional si pones una cita (hace falta uno de los dos). Máximo 6 palabras." : AYUDA_CAMPO[campo]}
          </p>
        )}
        {campo === "titular" && palabras > MAX_PALABRAS_TITULAR && (
          <p className="text-xs text-destructive">El titular tiene {palabras} palabras: déjalo en {MAX_PALABRAS_TITULAR} como mucho.</p>
        )}
      </div>
    );
  };

  const campoLista = () => {
    const filas = borrador.lista;
    const problema = conProblema.has("lista");
    const cambiarFila = (i: number, parte: "etiqueta" | "valor", v: string) =>
      onCambio({ lista: filas.map((f, j) => (j === i ? { ...f, [parte]: v } : f)) });
    return (
      <fieldset key="lista" aria-labelledby="ig-lista-titulo" aria-invalid={problema || undefined} className={cn("space-y-1.5 rounded-md", problema && "ring-2 ring-destructive ring-offset-2")}>
        <div className="flex items-baseline justify-between gap-2">
          {/* No es <legend>: tiene que ir junto al contador (un legend solo vale como primer hijo). */}
          <span id="ig-lista-titulo" className={cn("text-sm font-medium", problema && "text-destructive")}>
            {NOMBRE_CAMPO.lista}
            {!obligatorio("lista") && <span className="ml-1 font-normal text-muted-foreground">(opcional)</span>}
          </span>
          <span className={cn("text-xs tabular-nums text-muted-foreground", filas.length > maxFilas && "font-medium text-destructive")}>
            {filas.length}/{maxFilas} filas
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{AYUDA_CAMPO.lista}</p>
        {filas.map((f, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <Input
              aria-label={`Fila ${i + 1}: nombre`}
              placeholder="Nombre"
              value={f.etiqueta}
              onChange={(e) => cambiarFila(i, "etiqueta", e.target.value)}
              className="min-w-0 flex-[3]"
            />
            <Input
              aria-label={`Fila ${i + 1}: valor`}
              placeholder="Valor"
              value={f.valor ?? ""}
              onChange={(e) => cambiarFila(i, "valor", e.target.value)}
              className="min-w-0 flex-[2]"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Quitar la fila ${i + 1}`}
              onClick={() => onCambio({ lista: filas.filter((_, j) => j !== i) })}
              className="shrink-0 pointer-coarse:h-11 pointer-coarse:w-11"
            >
              <Minus className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onCambio({ lista: [...filas, { etiqueta: "", valor: "" }] })}
          disabled={filas.length >= maxFilas}
          className="pointer-coarse:min-h-11"
        >
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
          Añadir fila
        </Button>
      </fieldset>
    );
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label id="ig-marca-etiqueta">Marca</Label>
        <SelectorSubrayado
          aria-labelledby="ig-marca-etiqueta"
          valor={borrador.marca}
          onCambio={(v) => onMarca(v as MarcaId)}
          opciones={MARCAS_IDS.map((m) => ({ valor: m, etiqueta: NOMBRE_MARCA_CORTO[m] }))}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="ig-plantilla">Plantilla</Label>
        <Select value={borrador.plantilla} onValueChange={onPlantilla}>
          <SelectTrigger id="ig-plantilla" className="pointer-coarse:min-h-11">
            <SelectValue placeholder="Elige una plantilla" />
          </SelectTrigger>
          <SelectContent>
            {plantillas.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {plantilla && <p className="text-xs text-muted-foreground">{plantilla.descripcion}</p>}
      </div>

      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="space-y-1">
          <Label id="ig-formato-etiqueta">Formato</Label>
          <SelectorSubrayado
            aria-labelledby="ig-formato-etiqueta"
            valor={borrador.formato}
            onCambio={(v) => onCambio({ formato: v as FormatoId })}
            opciones={(plantilla?.formatos ?? ["post"]).map((f) => ({ valor: f, etiqueta: NOMBRE_FORMATO[f] }))}
          />
        </div>
        {onCargarEjemplo && (
          <Button type="button" variant="ghost" size="sm" onClick={onCargarEjemplo} disabled={!hayEjemplos} className="pointer-coarse:min-h-11">
            <Sparkles className="mr-1 h-4 w-4" aria-hidden="true" />
            Cargar ejemplo
          </Button>
        )}
      </div>

      {CAMPOS_PIEZA.filter((c) => admitidos.has(c)).map((campo) =>
        campo === "foto" ? (
          <SelectorFoto
            key="foto"
            marca={borrador.marca}
            formato={borrador.formato}
            plantilla={plantilla}
            valor={borrador.foto}
            onCambio={(foto) => onCambio({ foto })}
            baseFotos={baseFotos}
            conProblema={conProblema.has("foto")}
          />
        ) : campo === "lista" ? (
          campoLista()
        ) : (
          campoTexto(campo)
        ),
      )}
    </div>
  );
}
