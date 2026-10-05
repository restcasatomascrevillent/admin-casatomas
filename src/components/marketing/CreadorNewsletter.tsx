import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Send, Users, Loader2, FlaskConical } from "lucide-react";
import { SelectorTipoNewsletter, TipoNewsletter } from "./SelectorTipoNewsletter";
import { PreviewNewsletter } from "./PreviewNewsletter";
import { SelectorImagenGaleria } from "./SelectorImagenGaleria";
import { useNewsletterSuscriptores } from "@/hooks/useNewsletterSuscriptores";
import { useEnviarNewsletter, useEnviarPruebaNewsletter } from "@/hooks/useEnviarNewsletter";
import { CanalEnvio } from "./SincronizacionResend";
import { textoSuscriptores } from "@/lib/newsletter/textos";

export function CreadorNewsletter() {
  const [tipo, setTipo] = useState<TipoNewsletter | null>(null);
  const [titulo, setTitulo] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [imagenUrl, setImagenUrl] = useState<string | undefined>();
  const [showConfirm, setShowConfirm] = useState(false);

  const { totalSuscriptores } = useNewsletterSuscriptores();
  const { mutate: enviarNewsletter, isPending } = useEnviarNewsletter();
  const { mutate: enviarPrueba, isPending: enviandoPrueba } = useEnviarPruebaNewsletter();

  const handleSeleccionarTipo = (nuevoTipo: TipoNewsletter, tituloDefault: string, mensajeDefault: string) => {
    setTipo(nuevoTipo);
    setTitulo(tituloDefault);
    setMensaje(mensajeDefault);
  };

  const handleEnviar = () => {
    if (!tipo || !titulo || !mensaje) return;
    setShowConfirm(true);
  };

  const confirmarEnvio = () => {
    if (!tipo) return;
    
    enviarNewsletter({
      tipo,
      titulo,
      mensaje,
      imagen_url: imagenUrl,
    }, {
      onSuccess: () => {
        // Reset form
        setTipo(null);
        setTitulo('');
        setMensaje('');
        setImagenUrl(undefined);
        setShowConfirm(false);
      },
      onError: () => {
        setShowConfirm(false);
      }
    });
  };

  const isFormValid = tipo && titulo.trim() && mensaje.trim();

  return (
    <>
      <div className="grid gap-6 xl:grid-cols-2">
        {/* Left Column - Form */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Crear newsletter</CardTitle>
              <CardDescription>
                Elige el tipo, escribe el texto y revisa cómo queda en la vista previa.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Type Selector */}
              <div className="space-y-2">
                <Label>Tipo de comunicación</Label>
                <SelectorTipoNewsletter
                  tipoSeleccionado={tipo}
                  onSeleccionar={handleSeleccionarTipo}
                />
              </div>

              {/* Title */}
              <div className="space-y-2">
                <Label htmlFor="titulo">Título</Label>
                <Input
                  id="titulo"
                  placeholder="Título de la newsletter"
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  disabled={!tipo}
                  className="h-11 text-base md:text-base"
                />
              </div>

              {/* Message */}
              <div className="space-y-2">
                <Label htmlFor="mensaje">Mensaje</Label>
                <Textarea
                  id="mensaje"
                  placeholder="Escribe el mensaje de la newsletter..."
                  value={mensaje}
                  onChange={(e) => setMensaje(e.target.value)}
                  disabled={!tipo}
                  rows={6}
                  className="text-base md:text-base"
                />
              </div>

              {/* Image Selector */}
              <SelectorImagenGaleria
                imagenSeleccionada={imagenUrl}
                onSeleccionar={setImagenUrl}
              />

              {/* Cómo saldrá el envío (NEWSLETTER_CANAL: directo o por lista, Broadcast de Resend Marketing) */}
              <CanalEnvio />

              {/* Recipients Count */}
              <div className="flex items-start gap-2 text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg">
                <Users className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  Al enviarla, le llegará a <strong className="text-foreground">{textoSuscriptores(totalSuscriptores)}</strong> de
                  verdad. Antes puedes mandarte una prueba.
                </span>
              </div>

              {/* Send Button */}
              <Button
                className="h-12 w-full"
                size="lg"
                onClick={handleEnviar}
                disabled={!isFormValid || isPending}
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                Enviar a {textoSuscriptores(totalSuscriptores)}
              </Button>

              {/* Prueba por Resend Marketing: solo a la dirección de prueba, nunca a clientes */}
              <div className="space-y-1">
                <Button
                  className="h-11 w-full"
                  variant="outline"
                  onClick={() => tipo && enviarPrueba({ tipo, titulo, mensaje, imagen_url: imagenUrl })}
                  disabled={!isFormValid || isPending || enviandoPrueba}
                  aria-describedby="ayuda-prueba"
                >
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

        {/* Right Column - Preview */}
        <div>
          <div className="xl:sticky xl:top-6">
            <Label className="mb-3 block">Vista previa del email</Label>
            <PreviewNewsletter
              tipo={tipo}
              titulo={titulo}
              mensaje={mensaje}
              imagenUrl={imagenUrl}
            />
          </div>
        </div>
      </div>

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Enviar la newsletter a {textoSuscriptores(totalSuscriptores)}?</AlertDialogTitle>
            <AlertDialogDescription>
              Es un envío real: «{titulo}» le llegará a {textoSuscriptores(totalSuscriptores)} y no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending} className="h-11">Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmarEnvio} disabled={isPending} className="h-11">
              {isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Sí, enviar a todos
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
