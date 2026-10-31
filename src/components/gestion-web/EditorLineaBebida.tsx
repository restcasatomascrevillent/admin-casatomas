// ---------------------------------------------------------------------------
// Una bebida del maridaje de un plato o de la cata (historia 4093221d).
//
// - `EditorLineaBebida`: nombre (editable solo si se escribió a mano),
//   descripción corta (ADR-10) y sulfitos según ADR-9 / E6:
//     · vino de la carta → solo texto, no se edita;
//     · bebida de la carta → casilla, desmarcada al elegirla;
//     · a mano → casilla, con el valor que dio el botón con el que se añadió.
//   Y Quitar (y Cambiar, si quien lo usa sabe cambiarla).
// - `ElegirLineaBebida`: cómo se crea una línea. De la carta (buscador) o a
//   mano con «Vino, cava o champagne» (sulfitos marcados) u «Otra bebida»
//   (desmarcados). Después ya se edita con `EditorLineaBebida`.
// ---------------------------------------------------------------------------

import { useId } from "react";
import { PenLine, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BebidaDeCarta, VinoDeCarta } from "@/hooks/useBebidasParaMenu";
import {
  ETIQUETA_LINEA_LIBRE,
  conSulfitos,
  conservarTraduccionesLinea,
  lineaLibre,
  sulfitosEditables,
  textoSulfitosCarta,
  type ClaseLineaLibre,
  type LineaBebidaNovedad,
  type OrigenLineaBebida,
} from "@/lib/menu-novedad";
import { SelectorBebidaCarta } from "./SelectorBebidaCarta";

/** Longitud máxima de la descripción corta (la web la pinta en una línea). */
export const MAX_DESCRIPCION_LINEA = 80;

const ETIQUETA_ORIGEN: Record<OrigenLineaBebida, string> = {
  vino: "Vino de la carta",
  bebida: "Bebida de la carta",
  libre: "Escrita a mano",
};

const nombreVisible = (linea: LineaBebidaNovedad) => linea.nombre.trim() || "bebida sin nombre";

export interface EditorLineaBebidaProps {
  linea: LineaBebidaNovedad;
  onChange: (linea: LineaBebidaNovedad) => void;
  onQuitar: () => void;
  /** Si se pasa, sale el botón «Cambiar» (elegir otra bebida en su lugar). */
  onCambiar?: () => void;
  /** Título del bloque, p. ej. «Bebida del maridaje» o «Bebida 2 de la cata». */
  titulo?: string;
  disabled?: boolean;
}

export function EditorLineaBebida({
  linea,
  onChange,
  onQuitar,
  onCambiar,
  titulo = "Bebida",
  disabled = false,
}: EditorLineaBebidaProps) {
  const id = useId();
  const idNombre = `${id}-nombre`;
  const idDescripcion = `${id}-descripcion`;
  const idSulfitos = `${id}-sulfitos`;
  const idAyudaSulfitos = `${id}-ayuda-sulfitos`;
  const aMano = linea.origen === "libre";
  const nombreVacio = aMano && linea.nombre.trim() === "";

  // Un cambio en el castellano invalida la traducción que ya no dice lo mismo.
  const cambiar = (siguiente: LineaBebidaNovedad) => onChange(conservarTraduccionesLinea(linea, siguiente));

  return (
    <fieldset className="min-w-0 rounded-md border bg-card p-3 space-y-3" disabled={disabled}>
      <legend className="sr-only">
        {titulo}: {nombreVisible(linea)}
      </legend>

      <div className="flex flex-wrap items-start justify-between gap-2">
        {/* Sin min-w-0: la insignia no se encoge (a 390 px se partía en tres
            líneas); si no cabe junto a los botones, son ellos los que bajan. */}
        <div className="flex-1 space-y-1">
          <p className="text-xs font-medium text-muted-foreground" aria-hidden="true">
            {titulo}
          </p>
          <Badge variant="secondary" className="shrink-0 whitespace-nowrap font-normal" data-testid="origen-linea">
            {ETIQUETA_ORIGEN[linea.origen]}
          </Badge>
        </div>
        <div className="flex shrink-0 gap-1">
          {onCambiar && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-11 px-3"
              onClick={onCambiar}
              aria-label={`Cambiar «${nombreVisible(linea)}»`}
            >
              <PenLine className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
              Cambiar
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-11 w-11 text-muted-foreground hover:text-destructive focus-visible:text-destructive"
            onClick={onQuitar}
            aria-label={`Quitar «${nombreVisible(linea)}»`}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={idNombre}>Nombre</Label>
          {aMano ? (
            <>
              <Input
                id={idNombre}
                value={linea.nombre}
                onChange={(e) => cambiar({ ...linea, nombre: e.target.value })}
                placeholder="p. ej. Cava brut nature"
                className="h-11"
                aria-invalid={nombreVacio || undefined}
                aria-describedby={nombreVacio ? `${idNombre}-aviso` : undefined}
              />
              {nombreVacio && (
                <p id={`${idNombre}-aviso`} className="text-xs text-muted-foreground">
                  Sin nombre no se guarda.
                </p>
              )}
            </>
          ) : (
            // De la carta: el nombre (y su traducción) se copian tal cual (E5).
            <Input id={idNombre} value={linea.nombre} readOnly className="h-11 bg-muted/40" />
          )}
        </div>

        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={idDescripcion}>Descripción corta (opcional)</Label>
          <Input
            id={idDescripcion}
            value={linea.descripcion ?? ""}
            onChange={(e) => cambiar({ ...linea, descripcion: e.target.value === "" ? null : e.target.value })}
            placeholder="p. ej. Bien frío"
            maxLength={MAX_DESCRIPCION_LINEA}
            className="h-11"
          />
        </div>
      </div>

      {sulfitosEditables(linea) ? (
        <div className="space-y-1">
          {/* La etiqueta entera es la zona táctil: 44 px de alto. */}
          <div className="flex min-h-11 items-center gap-3">
            <Checkbox
              id={idSulfitos}
              checked={linea.sulfitos}
              onCheckedChange={(marcado) => onChange(conSulfitos(linea, marcado === true))}
              aria-describedby={linea.origen === "bebida" ? idAyudaSulfitos : undefined}
              className="h-5 w-5"
            />
            <Label htmlFor={idSulfitos} className="flex min-h-11 flex-1 cursor-pointer items-center">
              Contiene sulfitos
            </Label>
          </div>
          {linea.origen === "bebida" && (
            <p id={idAyudaSulfitos} className="text-xs text-muted-foreground">
              La carta de bebidas no indica alérgenos: márcalo si la lleva.
            </p>
          )}
        </div>
      ) : (
        // E6: en un vino de la carta los sulfitos vienen de sus alérgenos y no se tocan.
        <p className="text-sm text-muted-foreground" data-testid="sulfitos-carta">
          {textoSulfitosCarta(linea)}
        </p>
      )}
    </fieldset>
  );
}

export interface ElegirLineaBebidaProps {
  vinos: VinoDeCarta[];
  bebidas: BebidaDeCarta[];
  cargando: boolean;
  error?: boolean;
  onElegir: (linea: LineaBebidaNovedad) => void;
  /** Nombre del grupo para lectores de pantalla, p. ej. «Añadir bebida a la cata». */
  titulo?: string;
  disabled?: boolean;
}

const CLASES_LIBRES: readonly ClaseLineaLibre[] = ["vino", "otra"];

export function ElegirLineaBebida({
  vinos,
  bebidas,
  cargando,
  error = false,
  onElegir,
  titulo = "Añadir bebida",
  disabled = false,
}: ElegirLineaBebidaProps) {
  return (
    <div role="group" aria-label={titulo} className="flex min-w-0 flex-wrap items-center gap-2">
      <SelectorBebidaCarta
        vinos={vinos}
        bebidas={bebidas}
        cargando={cargando}
        error={error}
        onElegir={onElegir}
        disabled={disabled}
      />
      <span className="text-xs text-muted-foreground">o a mano:</span>
      {CLASES_LIBRES.map((clase) => (
        <Button
          key={clase}
          type="button"
          variant="outline"
          size="sm"
          className="h-11 px-3"
          disabled={disabled}
          onClick={() => onElegir(lineaLibre(clase))}
        >
          {ETIQUETA_LINEA_LIBRE[clase]}
        </Button>
      ))}
    </div>
  );
}
