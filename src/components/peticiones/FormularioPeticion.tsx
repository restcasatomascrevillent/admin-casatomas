import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { ImagePlus, Loader2, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { mensajeUsuario } from "@/lib/mensaje-usuario";
import { useCrearPeticion } from "@/hooks/usePeticiones";
import type { Peticion } from "@/lib/peticiones";
import { validarPeticion, type ErroresPeticion } from "./utilidades";
import {
  MAX_DESCRIPCION,
  MAX_TITULO,
  MODULOS_PETICION,
  PRIORIDADES,
  caminoDeRuta,
  moduloDeRuta,
  type PrioridadPeticion,
} from "../../../supabase/functions/_shared/peticiones";

interface Props {
  /** Página del panel en la que estaba el usuario (con su `?tab=`); propone el módulo. */
  ruta: string | null;
  onEnviada?: (p: Peticion) => void;
}

/**
 * «Nueva petición» (13/11/2026): título, prioridad, módulo afectado, descripción y captura opcional. La página
 * en la que estaba y el dispositivo se guardan solos. Controles de 48 px (se usa desde el móvil y la tablet).
 */
export function FormularioPeticion({ ruta, onEnviada }: Props) {
  const id = useId();
  const crear = useCrearPeticion();
  const [titulo, setTitulo] = useState("");
  const [prioridad, setPrioridad] = useState<PrioridadPeticion>("normal");
  const [modulo, setModulo] = useState<string>(() => moduloDeRuta(ruta) ?? "");
  const [descripcion, setDescripcion] = useState("");
  const [captura, setCaptura] = useState<File | null>(null);
  const [errores, setErrores] = useState<ErroresPeticion>({});
  const ficheroRef = useRef<HTMLInputElement>(null);
  const vistaPrevia = useMemo(() => (captura && typeof URL.createObjectURL === "function" ? URL.createObjectURL(captura) : null), [captura]);
  useEffect(() => () => {
    if (vistaPrevia) URL.revokeObjectURL(vistaPrevia);
  }, [vistaPrevia]);

  const camino = caminoDeRuta(ruta);
  const ayudaPrioridad = PRIORIDADES.find((p) => p.valor === prioridad)?.ayuda;

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const nuevos = validarPeticion({ titulo, modulo, descripcion, captura });
    setErrores(nuevos);
    if (Object.keys(nuevos).length) {
      const primero = (["titulo", "modulo", "descripcion", "captura"] as const).find((k) => nuevos[k]);
      if (primero) document.getElementById(`${id}-${primero}`)?.focus();
      return;
    }
    crear.mutate(
      { titulo, prioridad, modulo, descripcion, captura, ruta },
      {
        onSuccess: (p) => {
          toast.success("Petición enviada. Aquí verás cómo va.");
          setTitulo("");
          setDescripcion("");
          setCaptura(null);
          setPrioridad("normal");
          setErrores({});
          onEnviada?.(p);
        },
        onError: (err) => toast.error(mensajeUsuario(err, "No se ha podido enviar la petición. Prueba otra vez en un momento.")),
      },
    );
  };

  const error = (k: keyof ErroresPeticion) =>
    errores[k] ? (
      <p id={`${id}-${k}-error`} className="text-sm text-destructive" role="alert">
        {errores[k]}
      </p>
    ) : null;

  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-5" aria-label="Nueva petición" data-testid="formulario-peticion">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor={`${id}-titulo`} className="text-base">Título</Label>
          <span className="text-xs text-muted-foreground" aria-hidden="true">{titulo.trim().length}/{MAX_TITULO}</span>
        </div>
        <Input
          id={`${id}-titulo`}
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          maxLength={MAX_TITULO}
          placeholder="Ej.: No puedo cambiar la hora de una reserva"
          className="h-12 pointer-coarse:h-12 text-base"
          aria-invalid={!!errores.titulo}
          aria-describedby={errores.titulo ? `${id}-titulo-error` : undefined}
          autoComplete="off"
        />
        {error("titulo")}
      </div>

      <fieldset className="space-y-2">
        <legend className="text-base font-medium">Prioridad</legend>
        <div role="radiogroup" aria-label="Prioridad" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PRIORIDADES.map((p) => {
            const activa = p.valor === prioridad;
            return (
              <button
                key={p.valor}
                type="button"
                role="radio"
                aria-checked={activa}
                onClick={() => setPrioridad(p.valor)}
                className={cn(
                  "h-12 rounded-md border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  activa
                    ? p.valor === "urgente"
                      ? "border-destructive bg-destructive text-destructive-foreground"
                      : "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-background hover:bg-muted",
                )}
              >
                {p.etiqueta}
              </button>
            );
          })}
        </div>
        {ayudaPrioridad && <p className="text-sm text-muted-foreground">{ayudaPrioridad}{prioridad === "urgente" ? " (le llega un aviso al responsable)." : "."}</p>}
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor={`${id}-modulo`} className="text-base">Módulo afectado</Label>
        <select
          id={`${id}-modulo`}
          value={modulo}
          onChange={(e) => setModulo(e.target.value)}
          className="h-12 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          aria-invalid={!!errores.modulo}
          aria-describedby={errores.modulo ? `${id}-modulo-error` : undefined}
        >
          <option value="" disabled>Elige una parte del panel</option>
          {MODULOS_PETICION.map((m) => (
            <option key={m.clave} value={m.clave}>{m.etiqueta}</option>
          ))}
        </select>
        {error("modulo")}
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor={`${id}-descripcion`} className="text-base">Descripción</Label>
          <span className="text-xs text-muted-foreground" aria-hidden="true">{descripcion.trim().length}/{MAX_DESCRIPCION}</span>
        </div>
        <Textarea
          id={`${id}-descripcion`}
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          maxLength={MAX_DESCRIPCION}
          rows={6}
          placeholder="Qué estabas haciendo, qué esperabas que pasara y qué ha pasado. O qué te gustaría poder hacer."
          className="min-h-[160px] text-base"
          aria-invalid={!!errores.descripcion}
          aria-describedby={errores.descripcion ? `${id}-descripcion-error` : undefined}
        />
        {error("descripcion")}
      </div>

      <div className="space-y-2">
        <span className="text-base font-medium" id={`${id}-captura-titulo`}>Captura de pantalla <span className="font-normal text-muted-foreground">(opcional)</span></span>
        <input
          ref={ficheroRef}
          id={`${id}-captura`}
          type="file"
          accept="image/*"
          className="sr-only"
          aria-labelledby={`${id}-captura-titulo`}
          onChange={(e) => {
            setCaptura(e.target.files?.[0] ?? null);
            setErrores((prev) => ({ ...prev, captura: undefined }));
            e.target.value = "";
          }}
        />
        {captura ? (
          <div className="flex items-center gap-3 rounded-md border p-2">
            {vistaPrevia && <img src={vistaPrevia} alt="" className="h-14 w-14 shrink-0 rounded object-cover" />}
            <span className="min-w-0 flex-1 truncate text-sm">{captura.name}</span>
            <Button type="button" variant="ghost" className="h-12 gap-2" onClick={() => setCaptura(null)}>
              <X className="h-4 w-4" aria-hidden="true" /> Quitar
            </Button>
          </div>
        ) : (
          <Button type="button" variant="outline" className="h-12 w-full gap-2 sm:w-auto" onClick={() => ficheroRef.current?.click()}>
            <ImagePlus className="h-5 w-5" aria-hidden="true" /> Añadir captura
          </Button>
        )}
        {error("captura")}
      </div>

      <p className="text-xs text-muted-foreground">
        Se guarda también {camino ? <>la página en la que estabas (<span className="font-mono">{camino}</span>)</> : "la página en la que estabas"} y el tipo de dispositivo, para entenderlo mejor.
      </p>

      <Button type="submit" className="h-12 w-full gap-2 text-base sm:w-auto sm:self-start" disabled={crear.isPending}>
        {crear.isPending ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Send className="h-5 w-5" aria-hidden="true" />}
        {crear.isPending ? "Enviando…" : "Enviar petición"}
      </Button>
    </form>
  );
}
