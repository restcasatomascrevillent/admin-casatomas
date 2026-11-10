import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Send, Users, Loader2, FlaskConical, Sparkles, Save, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { SelectorPlantillaNewsletter, type SeleccionPlantilla } from "./SelectorPlantillaNewsletter";
import { EditorBloquesNewsletter } from "./EditorBloquesNewsletter";
import { DialogoCrearConIA } from "./DialogoCrearConIA";
import { DialogoGuardarPlantilla } from "./DialogoGuardarPlantilla";
import { PreviewNewsletter } from "./PreviewNewsletter";
import { useNewsletterSuscriptores } from "@/hooks/useNewsletterSuscriptores";
import { useEnviarNewsletter, useEnviarPruebaNewsletter } from "@/hooks/useEnviarNewsletter";
import { useBorrarPlantillaNewsletter, useNewsletterPlantillas, type RespuestaIA } from "@/hooks/useNewsletterPlantillas";
import { CanalEnvio } from "./SincronizacionResend";
import { textoSuscriptores } from "@/lib/newsletter/textos";
import {
  disenoDePlantilla,
  huecosPorCompletar,
  payloadDeDiseno,
  plantillaBase,
  LIMITE_INSIGNIA,
  LIMITE_PREHEADER,
  LIMITE_TITULO,
  type DisenoNewsletter,
} from "@/lib/newsletter/diseno";

export function CreadorNewsletter() {
  const [diseno, setDiseno] = useState<DisenoNewsletter | null>(null);
  const [seleccion, setSeleccion] = useState<SeleccionPlantilla>(null);
  const [origen, setOrigen] = useState<"manual" | "ia">("manual");
  const [avisosIA, setAvisosIA] = useState<string[] | null>(null);
  const [dialogoIA, setDialogoIA] = useState(false);
  const [dialogoGuardar, setDialogoGuardar] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const { totalSuscriptores } = useNewsletterSuscriptores();
  const { plantillas: guardadas } = useNewsletterPlantillas();
  const { mutate: borrarPlantilla } = useBorrarPlantillaNewsletter();
  const { mutate: enviarNewsletter, isPending } = useEnviarNewsletter();
  const { mutate: enviarPrueba, isPending: enviandoPrueba } = useEnviarPruebaNewsletter();

  const resultado = useMemo(() => (diseno ? payloadDeDiseno(diseno) : null), [diseno]);
  const huecos = useMemo(() => (diseno ? huecosPorCompletar(diseno) : []), [diseno]);
  const valido = !!resultado?.ok;

  const cargar = (d: DisenoNewsletter, sel: SeleccionPlantilla, o: "manual" | "ia", avisos: string[] | null = null) => {
    setDiseno(d);
    setSeleccion(sel);
    setOrigen(o);
    setAvisosIA(avisos);
  };

  const cambiar = (parcial: Partial<DisenoNewsletter>) => setDiseno((d) => (d ? { ...d, ...parcial } : d));

  const alPropuestaIA = (r: RespuestaIA) => {
    cargar(r.propuesta, null, "ia", r.avisos);
    toast.success("Propuesta de la IA cargada. Revísala y cámbiala a tu gusto antes de enviarla.");
  };

  const handleEnviar = () => {
    if (!resultado) return;
    if (resultado.ok === false) {
      toast.error(resultado.error);
      return;
    }
    setShowConfirm(true);
  };

  const confirmarEnvio = () => {
    if (!resultado?.ok) return;
    enviarNewsletter(resultado.payload, {
      onSuccess: () => {
        setDiseno(null);
        setSeleccion(null);
        setAvisosIA(null);
        setShowConfirm(false);
      },
      onError: () => setShowConfirm(false),
    });
  };

  const probar = () => {
    if (!resultado) return;
    if (resultado.ok === false) {
      toast.error(resultado.error);
      return;
    }
    enviarPrueba(resultado.payload);
  };

  return (
    <>
      {/* Desde `lg` (tablet apaisada y escritorio) las dos columnas van lado a
          lado y llenan el alto de la pestaña (Marketing.tsx lo calcula): cada
          una hace su propio scroll. Por debajo van apiladas y desplaza la
          pestaña entera. */}
      <div className="grid gap-4 lg:flex-1 lg:min-h-0 lg:grid-cols-2 lg:grid-rows-[minmax(0,1fr)]">
        {/* Columna del formulario */}
        <div className="space-y-4 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
          <Card>
            <CardHeader className="flex flex-col gap-3 space-y-0 p-4 pb-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1.5">
                <CardTitle>Crear newsletter</CardTitle>
                <CardDescription>Elige una plantilla o deja que la IA la redacte, revisa el texto y mira cómo queda.</CardDescription>
              </div>
              <Button type="button" className="h-11 shrink-0" onClick={() => setDialogoIA(true)}>
                <Sparkles className="mr-2 h-4 w-4" />
                Crear con IA
              </Button>
            </CardHeader>
            <CardContent className="space-y-4 p-4 pt-2">
              <div className="space-y-2">
                <Label>Plantilla</Label>
                <SelectorPlantillaNewsletter
                  seleccion={seleccion}
                  guardadas={guardadas}
                  onBase={(tipo) => cargar(disenoDePlantilla(plantillaBase(tipo)), { base: tipo }, "manual")}
                  onGuardada={(p) => cargar(disenoDePlantilla(p), { guardada: p.id }, p.origen)}
                  onBorrar={(p) => {
                    borrarPlantilla(p.id);
                    if (seleccion && "guardada" in seleccion && seleccion.guardada === p.id) setSeleccion(null);
                  }}
                />
              </div>

              {avisosIA && (
                <Alert className="border-accent/40 bg-accent/5">
                  <Sparkles className="h-4 w-4 !text-accent" />
                  <AlertTitle>Propuesta de la IA cargada</AlertTitle>
                  <AlertDescription className="space-y-1">
                    <p>Revisa el texto: es un borrador. No se envía nada hasta que pulses «Enviar» y lo confirmes.</p>
                    {avisosIA.length > 0 && (
                      <ul className="list-disc pl-4">
                        {avisosIA.map((a) => <li key={a}>{a}</li>)}
                      </ul>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              {diseno && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="titulo">Asunto</Label>
                    <Input
                      id="titulo"
                      placeholder="Asunto del correo"
                      value={diseno.titulo}
                      maxLength={LIMITE_TITULO}
                      onChange={(e) => cambiar({ titulo: e.target.value })}
                      className="h-11 text-base md:text-base"
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                    <div className="space-y-2">
                      <Label htmlFor="insignia">Etiqueta</Label>
                      <Input id="insignia" value={diseno.insignia} maxLength={LIMITE_INSIGNIA} placeholder={plantillaBase(diseno.tipo).insignia}
                        onChange={(e) => cambiar({ insignia: e.target.value })} className="h-11 text-base md:text-sm" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="preheader">Texto junto al asunto</Label>
                      <Input id="preheader" value={diseno.preheader} maxLength={LIMITE_PREHEADER} placeholder="Lo que se lee en la bandeja de entrada"
                        onChange={(e) => cambiar({ preheader: e.target.value })} className="h-11 text-base md:text-sm" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Contenido</Label>
                    <EditorBloquesNewsletter bloques={diseno.bloques} onChange={(bloques) => cambiar({ bloques })} />
                  </div>

                  {resultado && resultado.ok === false && (
                    <p className="flex items-start gap-2 text-sm text-destructive" role="status">
                      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                      {resultado.error}
                    </p>
                  )}

                  <Button type="button" variant="outline" className="h-11 w-full" onClick={() => setDialogoGuardar(true)} disabled={!valido}>
                    <Save className="mr-2 h-4 w-4" />
                    Guardar como plantilla
                  </Button>
                </>
              )}

              {/* Cómo saldrá el envío (NEWSLETTER_CANAL: directo o por lista, Broadcast de Resend Marketing) */}
              <CanalEnvio />

              <div className="flex items-start gap-2 text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg">
                <Users className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  Al enviarla, le llegará a <strong className="text-foreground">{textoSuscriptores(totalSuscriptores)}</strong> de
                  verdad. Antes puedes mandarte una prueba.
                </span>
              </div>

              <Button className="h-12 w-full" size="lg" onClick={handleEnviar} disabled={!valido || isPending}>
                {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                Enviar a {textoSuscriptores(totalSuscriptores)}
              </Button>

              {/* Prueba por Resend Marketing: solo a la dirección de prueba, nunca a clientes */}
              <div className="space-y-1">
                <Button className="h-11 w-full" variant="outline" onClick={probar} disabled={!valido || isPending || enviandoPrueba} aria-describedby="ayuda-prueba">
                  {enviandoPrueba ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FlaskConical className="h-4 w-4 mr-2" />}
                  Enviar prueba (no llega a clientes)
                </Button>
                <p id="ayuda-prueba" className="text-xs text-muted-foreground text-center">
                  La prueba se envía solo a una dirección de pruebas del equipo; ningún cliente la recibe.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Columna de la vista previa: desde `lg` la tarjeta llena la columna y el correo se desplaza dentro */}
        <div className="lg:flex lg:min-h-0 lg:flex-col">
          <Label className="mb-3 block shrink-0">Vista previa del email</Label>
          <PreviewNewsletter diseno={diseno} />
        </div>
      </div>

      <DialogoCrearConIA abierto={dialogoIA} onAbiertoChange={setDialogoIA} actual={diseno} onPropuesta={alPropuestaIA} />
      {diseno && (
        <DialogoGuardarPlantilla
          abierto={dialogoGuardar}
          onAbiertoChange={setDialogoGuardar}
          diseno={diseno}
          origen={origen}
          onGuardada={(p) => setSeleccion({ guardada: p.id })}
        />
      )}

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Enviar la newsletter a {textoSuscriptores(totalSuscriptores)}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>Es un envío real: «{diseno?.titulo}» le llegará a {textoSuscriptores(totalSuscriptores)} y no se puede deshacer.</p>
                {huecos.length > 0 && (
                  <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-destructive">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>Quedan huecos sin completar ({huecos.join(", ")}). Revísalos antes de enviar.</span>
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending} className="h-11">Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmarEnvio} disabled={isPending} className="h-11">
              {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Sí, enviar a todos
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
