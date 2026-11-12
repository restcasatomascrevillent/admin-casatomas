/**
 * «Crear story de Instagram» del editor de tapas (12/11/2026): vista previa de
 * la story con las tapas del formulario y «Publicar ahora» o «Programar» (a la
 * hora de los ajustes en Madrid por defecto). Plantilla (la de siempre o la
 * mejorada) y foto de fondo salen de los ajustes y se pueden cambiar aquí solo
 * para esta story. Una por semana: si la de esa semana ya está publicada, lo
 * dice y no deja publicar otra.
 */
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarClock, ImageIcon, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { VistaPreviaPieza, type ResultadoMaquetacion } from "@/components/marketing/instagram/VistaPreviaPieza";
import { CLAVE_PROGRAMACION } from "@/components/instagram/programar/useProgramacionInstagram";
import { BibliotecaFotos } from "@/components/instagram/crear/BibliotecaFotos";
import { FOTOS, baseFotosPublica, baseRecursosPanel, construirDocumento, validarPieza, type Foto } from "@/lib/instagram";
import {
  FOTO_TAPAS_POR_DEFECTO,
  enMadrid,
  instanteProgramacion,
  madridAInstante,
  piezaStoryTapas,
  problemasTapas,
  semanaDe,
  textoFecha,
  nombreDia,
  type PlantillaTapas,
} from "@/lib/instagram/tapas";
import { CLAVE_STORY_TAPAS, DEPS_STORY_TAPAS } from "./api";
import { avisarResultado } from "./automatico";
import { storyTapasManual, type ResultadoStoryTapas } from "./storyTapas";
import { useAjustesStoryTapas, useStoryTapasSemana } from "./useStoryTapas";

const BASE_FOTOS = baseFotosPublica(import.meta.env.VITE_SUPABASE_URL ?? "");
const BASE_RECURSOS = baseRecursosPanel();

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fecha: string;
  tapas: readonly string[];
}

export function DialogoCrearStoryTapas({ open, onOpenChange, fecha, tapas }: Props) {
  const qc = useQueryClient();
  const { ajustes } = useAjustesStoryTapas();
  const semana = fecha ? semanaDe(fecha) : null;
  const { data: filaSemana } = useStoryTapasSemana(open ? semana : null);
  const [plantilla, setPlantilla] = useState<PlantillaTapas>("ct-tapas");
  const [foto, setFoto] = useState<string>(FOTO_TAPAS_POR_DEFECTO);
  const [hora, setHora] = useState("12:00");
  const [turnos, setTurnos] = useState<string | null>(null);
  const [eligiendoFoto, setEligiendoFoto] = useState(false);
  const [fotoLista, setFotoLista] = useState<Foto | null>(null);
  const [errorFoto, setErrorFoto] = useState<string | null>(null);
  const [maquetacion, setMaquetacion] = useState<ResultadoMaquetacion | null>(null);
  const [enviando, setEnviando] = useState<"publicar" | "programar" | null>(null);
  const [resultado, setResultado] = useState<ResultadoStoryTapas | null>(null);

  // Al abrir: lo de los ajustes y los turnos del jueves.
  useEffect(() => {
    if (!open) return;
    setResultado(null);
    setEligiendoFoto(false);
    if (ajustes) {
      setPlantilla(ajustes.plantilla);
      setFoto(ajustes.foto ?? FOTO_TAPAS_POR_DEFECTO);
      setHora(ajustes.hora);
    }
    void DEPS_STORY_TAPAS.turnos().then(setTurnos).catch(() => setTurnos(null));
  }, [open, ajustes]);

  // La foto de Drive o de la carta se copia al bucket para la vista previa (la del catálogo no hace falta).
  useEffect(() => {
    if (!open) return;
    const estatica = FOTOS.find((f) => f.id === foto);
    if (estatica) {
      setFotoLista(estatica);
      setErrorFoto(null);
      return;
    }
    let vivo = true;
    setFotoLista(null);
    DEPS_STORY_TAPAS.prepararFoto(foto)
      .then((p) => {
        if (!vivo || !p) return;
        const ruta = /tmp\/[^?#]+$/.exec(p.url)?.[0] ?? "";
        setFotoLista({ id: foto, marca: "casa-tomas", ruta, ancho: p.ancho, alto: p.alto, tipo: null, aptaPost: true, aptaStory: true, descripcion: "" });
        setErrorFoto(null);
      })
      .catch((e: Error) => vivo && setErrorFoto(e.message || "No se pudo cargar la foto"));
    return () => {
      vivo = false;
    };
  }, [open, foto]);

  const pieza = useMemo(() => piezaStoryTapas({ dia: fecha, tapas, plantilla, foto, turnos }), [fecha, tapas, plantilla, foto, turnos]);
  const problemas = useMemo(() => problemasTapas(tapas, plantilla, plantilla === "ct-tapas" && !!turnos), [tapas, plantilla, turnos]);
  const documento = useMemo(() => {
    if (!fotoLista || problemas.length) return null;
    const v = validarPieza(pieza, { fotos: [...FOTOS, fotoLista] });
    if (!v.ok) return null;
    return construirDocumento(v.datos, { baseRecursos: BASE_RECURSOS, baseFotos: BASE_FOTOS, fotos: [...FOTOS, fotoLista] });
  }, [pieza, fotoLista, problemas]);

  const publicada = filaSemana?.estado === "publicada";
  const yaProgramada = filaSemana?.estado === "programada" && filaSemana.programada_para;
  const instante = useMemo(() => {
    const objetivo = madridAInstante(fecha, hora);
    return objetivo.getTime() > Date.now() + 10 * 60_000 ? objetivo : instanteProgramacion(fecha, hora).instante;
  }, [fecha, hora]);
  const bloqueado = !!enviando || publicada || problemas.length > 0 || !documento || (maquetacion?.errores.length ?? 0) > 0;

  const enviar = async (modo: "publicar" | "programar") => {
    setEnviando(modo);
    const r = await storyTapasManual({ fecha, tapas, plantilla, foto, turnos, programarPara: modo === "programar" ? instante : null }, DEPS_STORY_TAPAS);
    setEnviando(null);
    setResultado(r);
    avisarResultado(r, false);
    void qc.invalidateQueries({ queryKey: CLAVE_STORY_TAPAS });
    void qc.invalidateQueries({ queryKey: CLAVE_PROGRAMACION });
    if (r.estado === "programada" || r.estado === "publicada") onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !enviando && onOpenChange(v)}>
      <DialogContent className="flex max-h-[92vh] max-w-3xl flex-col gap-3 overflow-hidden">
        <DialogHeader>
          <DialogTitle>Story de Instagram del {nombreDia(fecha).toLowerCase()} de tapas</DialogTitle>
          <DialogDescription>
            {textoFecha(fecha)} · {tapas.length} {tapas.length === 1 ? "tapa" : "tapas"}. Se publica en la cuenta de Casa Tomás, una por semana.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto sm:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
          <VistaPreviaPieza
            documento={documento}
            formato="story"
            onMaquetacion={setMaquetacion}
            vacio={errorFoto ?? (problemas.length ? problemas.join(" ") : "Preparando la vista previa…")}
            className="mx-auto w-full max-w-[240px]"
          />
          <div className="min-w-0 space-y-4">
            {publicada && (
              <Alert>
                <AlertDescription>La story de tapas de esta semana ya está publicada: no se publica otra.</AlertDescription>
              </Alert>
            )}
            {yaProgramada && !publicada && (
              <p className="text-sm text-muted-foreground">
                Ya hay una programada para esta semana: si publicas o programas aquí, se rehace con estas tapas (no salen dos).
              </p>
            )}
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Plantilla</p>
              <ToggleGroup type="single" variant="outline" className="justify-start" value={plantilla} onValueChange={(v) => v && setPlantilla(v as PlantillaTapas)}>
                <ToggleGroupItem value="ct-tapas" className="h-11 px-3">Mejorada</ToggleGroupItem>
                <ToggleGroupItem value="ct-tapas-clasica" className="h-11 px-3">La de siempre</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <div className="space-y-1.5">
              <Button type="button" variant="outline" className="h-11" onClick={() => setEligiendoFoto((v) => !v)}>
                <ImageIcon className="mr-2 h-4 w-4" /> {eligiendoFoto ? "Cerrar la biblioteca" : "Cambiar la foto de fondo"}
              </Button>
              {eligiendoFoto && (
                <div className="max-h-72 overflow-y-auto rounded-md border p-2">
                  <BibliotecaFotos
                    marca="casa-tomas"
                    formato="story"
                    elegidas={[foto]}
                    onAlternar={(id) => {
                      setFoto(id);
                      setEligiendoFoto(false);
                    }}
                    onSubida={(id) => setFoto(id)}
                    baseFotos={BASE_FOTOS}
                  />
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hora-story-tapas">Programar a las (hora de España)</Label>
              <Input id="hora-story-tapas" type="time" step={300} className="h-11 w-36" value={hora} onChange={(e) => setHora(e.target.value || "12:00")} />
              <p className="text-xs text-muted-foreground">
                Saldrá el {enMadrid(instante).dia.split("-").reverse().join("/")} a las {enMadrid(instante).hora}.
              </p>
            </div>
            {maquetacion?.errores.length ? (
              <p role="alert" className="text-sm text-destructive">{maquetacion.errores.join(" ")}</p>
            ) : null}
            {resultado?.estado === "error" && <p role="alert" className="text-sm text-destructive">{resultado.mensaje}</p>}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" className="h-11" disabled={bloqueado} onClick={() => void enviar("programar")}>
            {enviando === "programar" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarClock className="mr-2 h-4 w-4" />}
            Programar
          </Button>
          <Button type="button" className="h-11" disabled={bloqueado} onClick={() => void enviar("publicar")}>
            {enviando === "publicar" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Publicar ahora
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
