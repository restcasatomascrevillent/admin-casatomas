// ============================================================================
// MESAS POR PIEZAS — botones de la ficha de mesa y diálogo de propuesta
// ----------------------------------------------------------------------------
// Para tablet: todo se TOCA (botones de 44 px), nada se arrastra. Ninguna
// acción que coja piezas de otra mesa se hace sin pasar por la propuesta y su
// botón «Hacer». La lógica vive en `src/lib/reservas/piezasMesa.ts`.
// ============================================================================

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Link2, Minus, Plus, Rows3, Unlink } from "lucide-react";
import {
  cambiarPico,
  cambiarPlazas,
  candidatasParaJuntar,
  juntar,
  mesasDeLaUnion,
  plazasDe,
  plazasMesa,
  proponerPiezaEnFila,
  separar,
  type AjusteMesa,
  type EstadoServicio,
  type MesaPiezas,
  type Propuesta,
  type ResultadoPropuesta,
  type ReservaEnMesas,
} from "@/lib/reservas/piezasMesa";

// ─── Diálogo de propuesta ────────────────────────────────────────────────────

export interface PropuestaAbierta {
  titulo: string;
  resultado: ResultadoPropuesta;
  /** Botón secundario opcional (p. ej. «Sentar sin ajustar»). */
  extra?: { texto: string; accion: () => void };
  hacer: (p: Propuesta) => void | Promise<void>;
}

export function DialogoPropuestaPiezas({
  propuesta,
  ocupado,
  onCerrar,
}: {
  propuesta: PropuestaAbierta | null;
  ocupado: boolean;
  onCerrar: () => void;
}) {
  const [verOtras, setVerOtras] = useState(false);
  const cerrar = () => {
    setVerOtras(false);
    onCerrar();
  };
  const lista = propuesta?.resultado.propuestas ?? [];
  const primera = lista[0];

  return (
    <Dialog open={!!propuesta} onOpenChange={(abierto) => !abierto && cerrar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{propuesta?.titulo}</DialogTitle>
          <DialogDescription className="text-base text-foreground">
            {primera ? primera.texto : (propuesta?.resultado.motivo ?? "")}
          </DialogDescription>
        </DialogHeader>

        {verOtras && lista.length > 1 && (
          <ul className="max-h-60 space-y-2 overflow-y-auto">
            {lista.slice(1).map((p) => (
              <li key={p.texto}>
                <Button
                  variant="outline"
                  className="h-auto min-h-11 w-full justify-start whitespace-normal py-2 text-left touch-manipulation"
                  disabled={ocupado}
                  onClick={async () => {
                    await propuesta?.hacer(p);
                    setVerOtras(false);
                  }}
                >
                  {p.texto}
                </Button>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button variant="ghost" className="h-11 touch-manipulation" onClick={cerrar} disabled={ocupado}>
            Cancelar
          </Button>
          {propuesta?.extra && (
            <Button
              variant="outline"
              className="h-11 touch-manipulation"
              disabled={ocupado}
              onClick={() => {
                propuesta.extra?.accion();
                setVerOtras(false);
              }}
            >
              {propuesta.extra.texto}
            </Button>
          )}
          {lista.length > 1 && !verOtras && (
            <Button variant="outline" className="h-11 touch-manipulation" onClick={() => setVerOtras(true)}>
              Ver otras opciones
            </Button>
          )}
          {primera && (
            <Button
              className="h-11 touch-manipulation px-6"
              disabled={ocupado}
              onClick={async () => {
                await propuesta?.hacer(primera);
                setVerOtras(false);
              }}
            >
              Hacer
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Botones de la ficha de mesa ─────────────────────────────────────────────

export function PanelPiezasMesa({
  mesa,
  mesas,
  estado,
  reservas,
  hayServicio,
  ocupado,
  onGuardar,
  onProponer,
}: {
  mesa: MesaPiezas;
  mesas: MesaPiezas[];
  estado: EstadoServicio;
  reservas: ReservaEnMesas[];
  /** Falso con «Todo el día»: los ajustes son de comida o de cena. */
  hayServicio: boolean;
  ocupado: boolean;
  onGuardar: (cambios: AjusteMesa[], mensaje: string) => void | Promise<void>;
  onProponer: (p: PropuestaAbierta) => void;
}) {
  const [eligiendoJunta, setEligiendoJunta] = useState(false);
  const e = estado.get(mesa.id);
  if (!e) return null;

  const nombres = new Map(mesas.map((m) => [m.id, m.nombre]));
  const union = mesasDeLaUnion(estado, mesa.id);
  const junta = union.length > 1;
  const cambiada = e.piezas !== mesa.piezas || e.picos !== mesa.picos;
  const candidatas = candidatasParaJuntar(mesa, mesas, estado);
  const masPico = cambiarPico(mesa, estado, 1);
  const menosPico = cambiarPico(mesa, estado, -1);

  const piezasTxt = (n: number) => (n === 1 ? "1 pieza" : `${n} piezas`);
  const resumen = `${piezasTxt(e.piezas)}${e.picos ? ` + ${e.picos === 1 ? "pico" : `${e.picos} picos`}` : ""} · ${plazasDe(e)} plazas`;
  const otrasDeLaUnion = union.filter((id) => id !== mesa.id).map((id) => nombres.get(id)).join(", ");

  const botonesJuntar = (
    <>
      <Button
        variant="outline"
        className="h-11 touch-manipulation"
        disabled={ocupado || candidatas.length === 0}
        onClick={() => setEligiendoJunta((v) => !v)}
      >
        <Link2 className="mr-1 h-4 w-4" /> Juntar con…
      </Button>
      <Button
        variant="outline"
        className="h-11 touch-manipulation"
        disabled={ocupado || (!junta && !cambiada && e.plazas == null)}
        onClick={() => onGuardar(separar(mesa, mesas, estado), `${mesa.nombre} vuelve a su forma`)}
      >
        <Unlink className="mr-1 h-4 w-4" /> Separar
      </Button>
    </>
  );
  const listaJuntar = eligiendoJunta && candidatas.length > 0 && (
    <div className="flex flex-wrap gap-2">
      {candidatas.map((c) => (
        <Button
          key={c.id}
          variant="secondary"
          className="h-11 min-w-11 touch-manipulation"
          disabled={ocupado}
          onClick={async () => {
            await onGuardar(juntar(mesa, c, estado), `${mesa.nombre} junta con ${c.nombre}`);
            setEligiendoJunta(false);
          }}
        >
          {c.nombre}
        </Button>
      ))}
    </div>
  );

  // SITIO (Terraza): sin piezas ni pico; plazas a mano entre su mínimo y su máximo.
  if (mesa.sitio) {
    const plazas = plazasMesa(mesa, e);
    if (!hayServicio) {
      return (
        <div className="rounded-md bg-muted/60 p-2 text-xs text-muted-foreground">
          Sitio de {mesa.sitio.min} a {mesa.sitio.max} plazas. Elige Comida o Cena para ajustarlo en ese servicio.
        </div>
      );
    }
    const menos = cambiarPlazas(mesa, estado, -1);
    const mas = cambiarPlazas(mesa, estado, 1);
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 rounded-md bg-muted/60 p-2">
          <Button
            variant="outline"
            size="icon"
            className="h-11 w-11 touch-manipulation"
            aria-label="Una plaza menos"
            disabled={ocupado || !menos}
            onClick={() => menos && onGuardar([menos], `${mesa.nombre}: ${plazas - 1} plazas`)}
          >
            <Minus className="h-4 w-4" />
          </Button>
          <div className="text-center">
            <p className="text-lg font-semibold tabular-nums">{plazas} plazas</p>
            <p className="text-xs text-muted-foreground">
              de {mesa.sitio.min} a {mesa.sitio.max}
              {junta && ` · junta con ${otrasDeLaUnion}`}
            </p>
          </div>
          <Button
            variant="outline"
            size="icon"
            className="h-11 w-11 touch-manipulation"
            aria-label="Una plaza más"
            disabled={ocupado || !mas}
            onClick={() => mas && onGuardar([mas], `${mesa.nombre}: ${plazas + 1} plazas`)}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2">{botonesJuntar}</div>
        {listaJuntar}
      </div>
    );
  }

  if (!hayServicio) {
    return (
      <div className="rounded-md bg-muted/60 p-2 text-xs text-muted-foreground">
        {piezasTxt(mesa.piezas)} en el plano base. Elige Comida o Cena para ajustar piezas y picos de ese servicio.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="rounded-md bg-muted/60 p-2 text-sm">
        <p className="font-medium tabular-nums">{resumen}</p>
        {(cambiada || junta) && (
          <p className="text-xs text-muted-foreground">
            Plano base: {piezasTxt(mesa.piezas)}
            {mesa.picos ? " + pico" : ""} · {plazasDe(mesa)} plazas
            {junta && ` · junta con ${otrasDeLaUnion}`}
          </p>
        )}
      </div>

      {!mesa.redonda && (
        <div className="grid grid-cols-2 gap-2">
          {menosPico && e.picos > 0 ? (
            <Button
              variant="outline"
              className="h-11 touch-manipulation"
              disabled={ocupado}
              onClick={() => onGuardar([menosPico], `${mesa.nombre}: pico quitado`)}
            >
              <Minus className="mr-1 h-4 w-4" /> Pico
            </Button>
          ) : (
            <Button
              variant="outline"
              className="h-11 touch-manipulation"
              disabled={ocupado || !masPico}
              onClick={() => masPico && onGuardar([masPico], `${mesa.nombre}: pico puesto`)}
            >
              <Plus className="mr-1 h-4 w-4" /> Pico
            </Button>
          )}
          <Button
            variant="outline"
            className="h-11 touch-manipulation"
            disabled={ocupado || junta || e.piezas >= mesa.piezasMax || mesa.grupo === null}
            onClick={() =>
              onProponer({
                titulo: `Mesa en fila para la ${mesa.nombre}`,
                resultado: proponerPiezaEnFila({ mesas, estado, reservas, mesaId: mesa.id }),
                hacer: (p) => onGuardar(p.cambios, `${mesa.nombre}: ${p.texto}`),
              })
            }
          >
            <Rows3 className="mr-1 h-4 w-4" /> Mesa en fila
          </Button>
          {botonesJuntar}
        </div>
      )}

      {listaJuntar}
    </div>
  );
}
