/**
 * Cajón «Pedir un vídeo o una pieza» (maqueta, pantalla Encargos): qué
 * necesita (vídeo, post o story), marca, para cuándo, fotos (el selector de
 * siempre: Drive, carta o subir), estilo o plantilla, la idea, el texto y
 * quién lo hace (automático u Oficiosos). Muestra las condiciones (plazo,
 * rondas y cupo) de instagram_encargos_ajustes. Guarda con
 * instagram_encargo_guardar y envía con instagram_encargo_enviar; si es
 * automático, genera la pieza al momento (automatico.ts).
 */
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Bot, Clapperboard, Image as ImageIcon, Loader2, Send, Smartphone, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { baseFotosPublica, plantillasVisibles, type MarcaId } from "@/lib/instagram";
import type { BaseReel } from "@/lib/instagram/reels";
import { SelectorFoto } from "@/components/marketing/instagram/SelectorFoto";
import { useFotosInstagram } from "@/components/marketing/instagram/useFotosInstagram";
import { CLAVE_ENCARGOS, llamarRpc, mensajeErrorEncargo } from "./api";
import { basesDeMarca, generarAutomatico } from "./automatico";
import {
  datosParaGuardar,
  ESTILOS_OFICIOSOS,
  fechaCorta,
  formularioVacio,
  hoyMadrid,
  problemasFormulario,
  sumarDiasLaborables,
  type AjustesEncargos,
  type DatosFormulario,
  type Encargo,
  type FormatoEncargo,
} from "./logica";

const BASE_FOTOS = baseFotosPublica(import.meta.env.VITE_SUPABASE_URL ?? "");

const FORMATOS: ReadonlyArray<{ v: FormatoEncargo; nombre: string; icono: typeof Clapperboard }> = [
  { v: "reel", nombre: "Vídeo", icono: Clapperboard },
  { v: "post", nombre: "Post", icono: ImageIcon },
  { v: "story", nombre: "Story", icono: Smartphone },
];

interface Props {
  abierto: boolean;
  onAbierto: (v: boolean) => void;
  /** Para editar un borrador o un rechazado (con sus fotos ya cargadas). */
  inicial?: { encargo: Encargo; datos: DatosFormulario } | null;
  ajustes: AjustesEncargos;
  /** Al guardar o enviar: el id del encargo (para abrir su ficha). */
  onHecho?: (id: string) => void;
  /** Datos de partida de un encargo NUEVO (p. ej. «Pedir foto a Oficiosos» desde Campañas o el Estudio). */
  datosIniciales?: Partial<DatosFormulario> | null;
}

function Radio<T extends string>({ valor, opciones, onCambio, etiqueta }: { valor: T; opciones: ReadonlyArray<{ v: T; nombre: string }>; onCambio: (v: T) => void; etiqueta: string }) {
  return (
    <div role="radiogroup" aria-label={etiqueta} className="flex w-full rounded-md border p-0.5">
      {opciones.map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={valor === o.v}
          onClick={() => onCambio(o.v)}
          className={cn("flex-1 rounded px-2 py-1.5 text-sm transition-colors pointer-coarse:min-h-11", valor === o.v ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
        >
          {o.nombre}
        </button>
      ))}
    </div>
  );
}

export function FormularioEncargo({ abierto, onAbierto, inicial, ajustes, onHecho, datosIniciales }: Props) {
  const vacio = (): DatosFormulario => ({ ...formularioVacio(datosIniciales?.marca), ...(datosIniciales ?? {}) });
  const qc = useQueryClient();
  const [d, setD] = useState<DatosFormulario>(() => inicial?.datos ?? vacio());
  const [ocupado, setOcupado] = useState<null | "guardar" | "enviar">(null);
  const [errores, setErrores] = useState<string[]>([]);
  const hoy = hoyMadrid();

  useEffect(() => {
    if (abierto) {
      setD(inicial?.datos ?? vacio());
      setErrores([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- los datos de partida se toman al abrir
  }, [abierto, inicial]);

  const cambiar = (c: Partial<DatosFormulario>) => setD((x) => ({ ...x, ...c }));
  const { fotos: catalogo } = useFotosInstagram(d.marca);
  // Sin las clásicas (salvo la que ya lleve el encargo), por papel: la portada primero.
  const plantillas = useMemo(() => plantillasVisibles(d.marca, d.formato === "story" ? "story" : "post", d.plantilla), [d.marca, d.formato, d.plantilla]);
  const bases = useMemo(() => basesDeMarca(d.marca), [d.marca]);
  const entregaPrevista = sumarDiasLaborables(hoy, ajustes.plazo_dias_laborables);

  // Al cambiar marca o formato, plantilla y base que valgan.
  useEffect(() => {
    if (d.modo !== "automatico") return;
    if (d.formato !== "reel" && !plantillas.some((p) => p.id === d.plantilla)) cambiar({ plantilla: plantillas[0]?.id ?? "" });
    if (d.formato === "reel" && !bases.some((b) => b.id === d.base_reel)) cambiar({ base_reel: bases[0]?.id ?? "libre" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al cambiar marca, formato o modo
  }, [d.marca, d.formato, d.modo]);

  const alternarFoto = (id: string) => {
    setD((x) => {
      if (x.fotos.some((f) => f.id === id)) return { ...x, fotos: x.fotos.filter((f) => f.id !== id) };
      const foto = catalogo.find((f) => f.id === id);
      const miniatura = foto?.urlCarta && /^https:\/\//.test(foto.urlCarta) ? foto.urlCarta : null;
      return { ...x, fotos: [...x.fotos, { id, nombre: foto?.descripcion?.slice(0, 120) || id, miniatura }].slice(0, 20) };
    });
  };

  async function guardar(enviar: boolean) {
    const problemas = enviar ? problemasFormulario(d, hoy) : d.titulo.trim() ? [] : ["Ponle un título."];
    setErrores(problemas);
    if (problemas.length) return;
    setOcupado(enviar ? "enviar" : "guardar");
    try {
      const g = await llamarRpc("instagram_encargo_guardar", { p_id: inicial?.encargo.id ?? null, p_datos: datosParaGuardar(d) }, { avisar: false });
      const id = g.encargo?.id ?? inicial?.encargo.id;
      if (!id) throw new Error("El servidor no devolvió el encargo");
      if (enviar) {
        const env = await llamarRpc("instagram_encargo_enviar", { p_id: id });
        if (d.modo === "automatico" && env.encargo) {
          toast.info("Generando la pieza…");
          try {
            await generarAutomatico(qc, env.encargo, d.fotos);
            toast.success(d.formato === "reel" ? "Lo estamos montando: te avisamos cuando esté para revisar" : "Pieza generada: ya la puedes revisar");
          } catch (e) {
            toast.error("El encargo está enviado, pero no se pudo generar la pieza", { description: `${mensajeErrorEncargo(e)} Vuelve a intentarlo desde la ficha.` });
          }
        } else {
          toast.success(`Encargo enviado a Oficiosos: entrega prevista el ${fechaCorta(env.encargo?.fecha_entrega_prevista ?? entregaPrevista)}`);
        }
      } else {
        toast.success("Borrador guardado");
      }
      await qc.invalidateQueries({ queryKey: CLAVE_ENCARGOS });
      onAbierto(false);
      onHecho?.(id);
    } catch (e) {
      setErrores([mensajeErrorEncargo(e)]);
    } finally {
      setOcupado(null);
    }
  }

  return (
    <Sheet open={abierto} onOpenChange={onAbierto}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg" data-testid="formulario-encargo">
        <SheetHeader className="border-b p-4">
          <SheetTitle>{inicial ? "Editar el encargo" : "Pedir un vídeo o una pieza"}</SheetTitle>
          <SheetDescription>Llega al tablero de Encargos y te avisamos cuando esté para revisar.</SheetDescription>
        </SheetHeader>
        <form className="flex-1 space-y-4 overflow-y-auto overscroll-contain p-4" onSubmit={(e) => e.preventDefault()}>
          <div className="space-y-1.5">
            <span className="text-sm font-medium" id="enc-que">Qué necesitas</span>
            <div role="radiogroup" aria-labelledby="enc-que" className="grid grid-cols-3 gap-2">
              {FORMATOS.map((f) => (
                <button
                  key={f.v}
                  type="button"
                  role="radio"
                  aria-checked={d.formato === f.v}
                  onClick={() => cambiar({ formato: f.v })}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-md border p-2 text-sm transition-colors pointer-coarse:min-h-11",
                    d.formato === f.v ? "border-primary bg-primary/5 font-medium" : "hover:bg-muted",
                  )}
                >
                  <f.icono className="h-5 w-5" aria-hidden="true" />
                  {f.nombre}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <span className="text-sm font-medium">Marca</span>
              <Radio<MarcaId>
                etiqueta="Marca"
                valor={d.marca}
                opciones={[{ v: "casa-tomas", nombre: "Casa Tomás" }, { v: "touza", nombre: "Touza" }]}
                onCambio={(marca) => cambiar({ marca, fotos: [] })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="enc-fecha">Para cuándo</Label>
              <Input id="enc-fecha" type="date" min={hoy} value={d.fecha_deseada} onChange={(e) => cambiar({ fecha_deseada: e.target.value })} />
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="text-sm font-medium" id="enc-modo">Quién lo hace</span>
            <div role="radiogroup" aria-labelledby="enc-modo" className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  { v: "automatico", icono: Bot, nombre: "Automático", texto: "Lo monta el estudio con tus fotos y la plantilla. Listo en unos minutos." },
                  {
                    v: "oficiosos",
                    icono: UserRound,
                    nombre: "Encargo a Oficiosos",
                    texto: `Lo hace una persona del equipo. Plazo: ${ajustes.plazo_dias_laborables} días laborables.`,
                  },
                ] as const
              ).map((o) => (
                <button
                  key={o.v}
                  type="button"
                  role="radio"
                  aria-checked={d.modo === o.v}
                  onClick={() => cambiar({ modo: o.v })}
                  className={cn("rounded-md border p-2 text-left text-xs transition-colors", d.modo === o.v ? "border-primary bg-primary/5" : "hover:bg-muted")}
                >
                  <strong className="mb-0.5 flex items-center gap-1.5 text-sm">
                    <o.icono className="h-4 w-4" aria-hidden="true" />
                    {o.nombre}
                  </strong>
                  <span className="text-muted-foreground">{o.texto}</span>
                </button>
              ))}
            </div>
            {d.modo === "oficiosos" && (
              <p className="rounded-md bg-muted/60 p-2 text-xs text-muted-foreground" data-testid="condiciones-encargo">
                Condiciones: entrega en {ajustes.plazo_dias_laborables} días laborables (si lo envías hoy, el {fechaCorta(entregaPrevista)}),{" "}
                {ajustes.rondas_incluidas} {ajustes.rondas_incluidas === 1 ? "ronda" : "rondas"} de cambios incluidas y{" "}
                {ajustes.cupo_mensual ? `${ajustes.cupo_mensual} encargos al mes` : "sin límite de encargos al mes"}.
                {d.fecha_deseada && d.fecha_deseada < entregaPrevista && " Ojo: la fecha que pides es antes del plazo estándar."}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="enc-titulo">Título</Label>
            <Input id="enc-titulo" maxLength={120} value={d.titulo} onChange={(e) => cambiar({ titulo: e.target.value })} placeholder="Ej.: Setas de temporada" />
          </div>

          {d.modo === "automatico" ? (
            d.formato === "reel" ? (
              <div className="space-y-1.5">
                <Label htmlFor="enc-base">Reel base</Label>
                <select id="enc-base" className="h-10 w-full rounded-md border bg-background px-2 text-sm" value={d.base_reel} onChange={(e) => cambiar({ base_reel: e.target.value as BaseReel })}>
                  {bases.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.nombre}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="enc-plantilla">Plantilla</Label>
                <select id="enc-plantilla" className="h-10 w-full rounded-md border bg-background px-2 text-sm" value={d.plantilla} onChange={(e) => cambiar({ plantilla: e.target.value })}>
                  {plantillas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">El título hace de titular (6 palabras como mucho) y se usa la primera foto.</p>
              </div>
            )
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="enc-estilo">Estilo o plantilla</Label>
              <select id="enc-estilo" className="h-10 w-full rounded-md border bg-background px-2 text-sm" value={d.estilo} onChange={(e) => cambiar({ estilo: e.target.value })}>
                <option value="">Sin preferencia</option>
                {ESTILOS_OFICIOSOS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="enc-idea">La idea</Label>
            <Textarea id="enc-idea" rows={3} maxLength={4000} value={d.idea} onChange={(e) => cambiar({ idea: e.target.value })} placeholder="Qué quieres contar, qué debe salir, cómo acaba…" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="enc-texto">Texto de la publicación (opcional)</Label>
            <Textarea id="enc-texto" rows={2} maxLength={2200} value={d.texto} onChange={(e) => cambiar({ texto: e.target.value })} />
          </div>

          <div className="space-y-1.5">
            <span className="text-sm font-medium">
              Fotos <span className="font-normal text-muted-foreground">({d.fotos.length} elegidas)</span>
            </span>
            {d.fotos.length > 0 && (
              <ul className="flex flex-wrap gap-1.5" aria-label="Fotos elegidas">
                {d.fotos.map((f) => (
                  <li key={f.id} className="flex max-w-full items-center gap-1 rounded-full border bg-muted/40 py-0.5 pl-1 pr-1.5 text-xs">
                    {f.miniatura ? <img src={f.miniatura} alt="" className="h-6 w-6 rounded-full object-cover" /> : <ImageIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
                    <span className="max-w-[12rem] truncate">{f.nombre || f.id}</span>
                    <button type="button" onClick={() => alternarFoto(f.id)} aria-label={`Quitar ${f.nombre || f.id}`} className="rounded-full p-0.5 hover:bg-muted">
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <SelectorFoto marca={d.marca} formato={d.formato === "post" ? "post" : "story"} valor="" onCambio={alternarFoto} baseFotos={BASE_FOTOS} />
          </div>

          {errores.length > 0 && (
            <ul role="alert" className="space-y-0.5 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive" data-testid="errores-encargo">
              {errores.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </form>
        <SheetFooter className="flex-row justify-end gap-2 border-t p-3">
          <Button type="button" variant="ghost" onClick={() => onAbierto(false)} disabled={!!ocupado}>
            Cancelar
          </Button>
          <Button type="button" variant="outline" onClick={() => void guardar(false)} disabled={!!ocupado}>
            {ocupado === "guardar" && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />}
            Guardar borrador
          </Button>
          <Button type="button" onClick={() => void guardar(true)} disabled={!!ocupado}>
            {ocupado === "enviar" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="mr-1 h-4 w-4" aria-hidden="true" />}
            Enviar encargo
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
