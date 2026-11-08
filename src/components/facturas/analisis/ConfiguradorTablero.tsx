// «Personalizar el tablero» de Facturas › Análisis (06/11/2026), tipo widgets:
//
//   · TU TABLERO: las cifras y los módulos, en orden. Se reordenan arrastrando
//     desde el asa (ratón, dedo o teclado: Espacio y flechas) o con
//     «Subir»/«Bajar» y se quitan con «×». Los módulos fijos se mueven pero no se quitan.
//     Desde el 07/11/2026 (Análisis en una pantalla) cada módulo vive en su
//     vista (lo dice su descripción) y ya no hay tamaños ni vista previa; las
//     cifras que no son de las cuatro de arriba salen en la vista «Gasto».
//   · AÑADIR: el catálogo con un interruptor por cifra y por módulo.
//   · «Restablecer» vuelve al tablero de siempre; nada se aplica hasta
//     «Guardar» (se guarda en la cuenta: dashboard_config).
// En pantallas estrechas «Tu tablero» y «Añadir» van en dos pestañas.
import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Loader2, RotateCcw, X } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ListaOrdenable } from "@/components/ui/lista-ordenable";
import { cn } from "@/lib/utils";
import { VISTAS, VISTA_DE_MODULO } from "@/lib/facturas/vistasAnalisis";
import {
  activarCifra,
  activarModulo,
  CIFRAS,
  CONFIG_TABLERO_POR_DEFECTO,
  infoCifra,
  infoModulo,
  MAX_CIFRAS,
  mismaConfig,
  MODULOS,
  moverCifra,
  moverEnLista,
  moverModulo,
  type ConfigTablero,
  type IdCifra,
  type IdModulo,
} from "@/lib/facturas/widgetsTablero";
import { DIALOGO_GRANDE, FOCO, Segmentado } from "./piezas";
import { useFocoAlCerrar } from "./desplazar";

interface Props {
  abierto: boolean;
  config: ConfigTablero;
  onCerrar: () => void;
  onGuardar: (c: ConfigTablero) => Promise<unknown> | void;
}

/** La vista donde sale un módulo («Gasto», «Proveedores»…). */
const nombreVista = (id: IdModulo): string => {
  const v = VISTA_DE_MODULO[id] ?? (id === "subidas" ? "precios" : id === "ahorro" ? "ahorro" : id === "familias" ? "gasto" : "gasto");
  return VISTAS.find((x) => x.id === v)?.etiqueta ?? v;
};

export function ConfiguradorTablero({ abierto, config, onCerrar, onGuardar }: Props) {
  const focoAlCerrar = useFocoAlCerrar(abierto);
  return (
    <Dialog open={abierto} onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent
        data-testid="configurador-tablero"
        onCloseAutoFocus={focoAlCerrar}
        className={cn(DIALOGO_GRANDE, "sm:h-[min(90dvh,52rem)] sm:w-[min(94vw,68rem)]")}
      >
        {abierto && <Contenido config={config} onCerrar={onCerrar} onGuardar={onGuardar} />}
      </DialogContent>
    </Dialog>
  );
}

const BOTON_ICONO = cn(
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30 pointer-coarse:h-11 pointer-coarse:w-11",
  FOCO,
);

function Contenido({ config, onCerrar, onGuardar }: Omit<Props, "abierto">) {
  const [borrador, setBorrador] = useState<ConfigTablero>(config);
  const [pestana, setPestana] = useState<"tablero" | "anadir">("tablero");
  const [guardando, setGuardando] = useState(false);
  const cambiado = !mismaConfig(borrador, config);
  const esPorDefecto = mismaConfig(borrador, CONFIG_TABLERO_POR_DEFECTO);
  const inactivasCifras = CIFRAS.filter((c) => !borrador.cifras.includes(c.id));
  const inactivosModulos = MODULOS.filter((m) => !m.fijo && !borrador.modulos.some((x) => x.id === m.id));

  const guardar = async () => {
    setGuardando(true);
    try {
      await onGuardar(borrador);
    } finally {
      setGuardando(false);
    }
    onCerrar();
  };

  const quitarCifra = (id: IdCifra) => setBorrador((c) => activarCifra(c, id, false));
  const quitarModulo = (id: IdModulo) => setBorrador((c) => activarModulo(c, id, false));

  return (
    <>
      <div className="flex shrink-0 items-start gap-3 border-b border-border/70 px-4 pb-3 pt-4 sm:px-6">
        <div className="min-w-0 flex-1">
          <DialogTitle className="text-lg font-semibold leading-tight tracking-tight sm:text-xl">Personalizar el tablero</DialogTitle>
          <DialogDescription className="mt-0.5 text-sm text-muted-foreground">
            Elige qué módulos salen en cada vista y qué cifras de más salen en «Gasto». Se guarda en tu cuenta.
          </DialogDescription>
        </div>
        <DialogClose className={cn("-mr-2 -mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground", FOCO)} aria-label="Cerrar">
          <X className="h-5 w-5" aria-hidden />
        </DialogClose>
      </div>

      <div className="@container flex min-h-0 flex-1 flex-col">
        {/* Pestañas solo en estrecho: en ancho se ven las dos columnas. */}
        <div className="shrink-0 border-b border-border/70 px-4 py-2 @[48rem]:hidden sm:px-6">
          <Segmentado<"tablero" | "anadir">
            etiqueta="Qué ver"
            valor={pestana}
            onCambio={setPestana}
            opciones={[
              { valor: "tablero", etiqueta: `Tu tablero (${borrador.cifras.length + borrador.modulos.length})` },
              { valor: "anadir", etiqueta: `Añadir (${inactivasCifras.length + inactivosModulos.length})` },
            ]}
            className="w-full [&>button]:flex-1"
          />
        </div>

        <div className="grid min-h-0 flex-1 @[48rem]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          {/* ── Tu tablero ── */}
          <section
            aria-labelledby="config-tu-tablero"
            className={cn("min-h-0 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6", pestana !== "tablero" && "hidden @[48rem]:block")}
          >
            <h3 id="config-tu-tablero" className="sr-only @[48rem]:not-sr-only @[48rem]:mb-3 @[48rem]:text-sm @[48rem]:font-semibold">
              Tu tablero
            </h3>

            <Subtitulo>Cifras de «Gasto»</Subtitulo>
            {borrador.cifras.length === 0 ? (
              <Vacio>Sin cifras arriba. Añádelas desde «Añadir».</Vacio>
            ) : (
              <ListaOrdenable
                ids={borrador.cifras}
                nombre={(id) => infoCifra(id as IdCifra).titulo}
                onMover={(d, h) => setBorrador((c) => ({ ...c, cifras: moverEnLista(c.cifras, d, h) }))}
                aria-label="Cifras de «Gasto», en orden"
                className="space-y-1"
              >
                {(id, i, { asa }) => {
                  const info = infoCifra(id as IdCifra);
                  return (
                    <Fila asa={asa} titulo={info.titulo} descripcion={info.descripcion}>
                      <SubirBajar
                        nombre={info.titulo}
                        primero={i === 0}
                        ultimo={i === borrador.cifras.length - 1}
                        onMover={(p) => setBorrador((c) => moverCifra(c, id as IdCifra, p))}
                      />
                      <button type="button" className={BOTON_ICONO} aria-label={`Quitar «${info.titulo}»`} onClick={() => quitarCifra(id as IdCifra)}>
                        <X className="h-4 w-4" aria-hidden />
                      </button>
                    </Fila>
                  );
                }}
              </ListaOrdenable>
            )}

            <Subtitulo className="mt-5">Módulos</Subtitulo>
            <ListaOrdenable
              ids={borrador.modulos.map((m) => m.id)}
              nombre={(id) => infoModulo(id as IdModulo).titulo}
              onMover={(d, h) => setBorrador((c) => ({ ...c, modulos: moverEnLista(c.modulos, d, h) }))}
              aria-label="Módulos, en orden"
              className="space-y-1"
            >
              {(id, i, { asa }) => {
                const m = borrador.modulos[i];
                const info = infoModulo(id as IdModulo);
                return (
                  <Fila asa={asa} titulo={info.titulo} descripcion={info.fijo ? "Fijo: se puede mover, no quitar" : `${info.descripcion} · en «${nombreVista(info.id)}»`}>
                    <SubirBajar
                      nombre={info.titulo}
                      primero={i === 0}
                      ultimo={i === borrador.modulos.length - 1}
                      onMover={(p) => setBorrador((c) => moverModulo(c, m.id, p))}
                    />
                    {info.fijo ? (
                      <span className="inline-flex h-9 w-9 shrink-0 pointer-coarse:w-11" aria-hidden />
                    ) : (
                      <button type="button" className={BOTON_ICONO} aria-label={`Quitar «${info.titulo}»`} onClick={() => quitarModulo(m.id)}>
                        <X className="h-4 w-4" aria-hidden />
                      </button>
                    )}
                  </Fila>
                );
              }}
            </ListaOrdenable>


          </section>

          {/* ── Añadir ── */}
          <section
            aria-labelledby="config-anadir"
            className={cn(
              "min-h-0 overflow-y-auto overscroll-contain border-border/70 bg-muted/20 px-4 py-4 @[48rem]:border-l sm:px-6",
              pestana !== "anadir" && "hidden @[48rem]:block",
            )}
          >
            <h3 id="config-anadir" className="sr-only @[48rem]:not-sr-only @[48rem]:mb-3 @[48rem]:text-sm @[48rem]:font-semibold">
              Añadir o quitar
            </h3>
            <Subtitulo>Cifras</Subtitulo>
            <ul className="space-y-1" aria-label="Catálogo de cifras">
              {CIFRAS.map((c) => {
                const activa = borrador.cifras.includes(c.id);
                const lleno = !activa && borrador.cifras.length >= MAX_CIFRAS;
                return (
                  <ItemCatalogo
                    key={c.id}
                    titulo={c.titulo}
                    descripcion={lleno ? `Caben ${MAX_CIFRAS} cifras: quita otra antes.` : c.descripcion}
                    activo={activa}
                    disabled={lleno}
                    onCambio={(v) => setBorrador((x) => activarCifra(x, c.id, v))}
                  />
                );
              })}
            </ul>
            <Subtitulo className="mt-5">Módulos</Subtitulo>
            <ul className="space-y-1" aria-label="Catálogo de módulos">
              {MODULOS.filter((m) => !m.fijo).map((m) => (
                <ItemCatalogo
                  key={m.id}
                  titulo={m.titulo}
                  descripcion={m.descripcion}
                  activo={borrador.modulos.some((x) => x.id === m.id)}
                  onCambio={(v) => setBorrador((x) => activarModulo(x, m.id, v))}
                />
              ))}
            </ul>
          </section>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border/70 bg-background px-4 py-3 sm:px-6">
        <Button
          type="button"
          variant="ghost"
          className="h-11 gap-1.5 px-3"
          onClick={() => setBorrador(CONFIG_TABLERO_POR_DEFECTO)}
          disabled={esPorDefecto}
          aria-label="Restablecer el tablero de siempre"
          title="Vuelve al tablero por defecto: las cifras de decisión, las cuatro preguntas y el resto de módulos"
        >
          <RotateCcw className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">Restablecer</span>
        </Button>
        <span className="mr-auto" />
        <DialogClose asChild>
          <Button type="button" variant="outline" className="h-11">
            Cancelar
          </Button>
        </DialogClose>
        <Button type="button" className="h-11 min-w-28 gap-1.5" onClick={() => void guardar()} disabled={!cambiado || guardando}>
          {guardando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Guardar
        </Button>
      </div>
    </>
  );
}

// ─── Piezas ─────────────────────────────────────────────────────────────────

const Subtitulo = ({ children, className }: { children: ReactNode; className?: string }) => (
  <h4 className={cn("mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground", className)}>{children}</h4>
);

const Vacio = ({ children }: { children: ReactNode }) => <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">{children}</p>;

/** Fila de la lista ordenable: asa, nombre y descripción, y sus controles (que bajan de línea si no caben). */
function Fila({ asa, titulo, descripcion, children }: { asa: ReactNode; titulo: string; descripcion: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1 rounded-lg border border-border/70 bg-card py-1 pl-1 pr-1.5">
      {asa}
      <div className="min-w-0 flex-1 basis-24 py-1">
        <p className="truncate text-sm font-medium text-foreground" title={titulo}>
          {titulo}
        </p>
        {/* La descripción, solo si hay sitio (en el móvil ya está en «Añadir»). */}
        <p className="hidden truncate text-xs text-muted-foreground @[30rem]:block" title={descripcion}>
          {descripcion}
        </p>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">{children}</div>
    </div>
  );
}

function SubirBajar({ nombre, primero, ultimo, onMover }: { nombre: string; primero: boolean; ultimo: boolean; onMover: (p: -1 | 1) => void }) {
  return (
    <>
      <button type="button" className={BOTON_ICONO} aria-label={`Subir «${nombre}»`} disabled={primero} onClick={() => onMover(-1)}>
        <ArrowUp className="h-4 w-4" aria-hidden />
      </button>
      <button type="button" className={BOTON_ICONO} aria-label={`Bajar «${nombre}»`} disabled={ultimo} onClick={() => onMover(1)}>
        <ArrowDown className="h-4 w-4" aria-hidden />
      </button>
    </>
  );
}

function ItemCatalogo({
  titulo,
  descripcion,
  activo,
  disabled,
  onCambio,
}: {
  titulo: string;
  descripcion: string;
  activo: boolean;
  disabled?: boolean;
  onCambio: (v: boolean) => void;
}) {
  return (
    <li className="flex items-center gap-3 rounded-lg border border-border/60 bg-card px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{titulo}</p>
        <p className="text-xs text-muted-foreground">{descripcion}</p>
      </div>
      <Switch checked={activo} disabled={disabled} onCheckedChange={onCambio} aria-label={`Mostrar «${titulo}»`} />
    </li>
  );
}

