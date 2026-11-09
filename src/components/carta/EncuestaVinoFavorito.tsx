import { useId, useMemo, useState } from "react";
import { Download, Gift, Loader2, Trash2, Trophy, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useCanAccessSection } from "@/hooks/useUserRole";
import {
  fechaCorta,
  hoyEnMadrid,
  participantesCsv,
  PREMIO_MAX,
  TEXTO_PARA_ABRIR,
  validarPremioFecha,
  recuentoPorVino,
  sortearGanador,
  useEncuestaVinos,
  type VotoVino,
} from "@/hooks/useEncuestaVinos";

/**
 * Gestor Web › Carta › Vinos: «Vota tu vino favorito y entra en el sorteo»
 * (04/11/2026, petición del dueño). Una sola franja con el interruptor y el
 * botón de resultados, para no alargar la lista de vinos. En la web, al entrar
 * en la carta de vinos sale un aviso de 3 segundos con el botón «Votar».
 *
 * Con solo «Ver» en la carta (06/11/2026, decisión del dueño): se lee si la votación
 * está abierta, sin interruptor ni «Resultados» (los votos llevan nombre y contacto:
 * la base de datos solo se los da a quien puede editar la carta).
 */
export function EncuestaVinoFavorito() {
  const id = useId();
  const [verResultados, setVerResultados] = useState(false);
  const { canAccess: puedeEditar } = useCanAccessSection("gestor_carta", "edit");
  const { activa, premio, fin, puedeAbrir, guardarPremioFecha, disponible, cargando, error, cambiarActiva, votos, vaciar } =
    useEncuestaVinos({ cargarVotos: verResultados });
  // Borrador de los campos: null = sin tocar (se ve lo guardado).
  const [borradorPremio, setBorradorPremio] = useState<string | null>(null);
  const [borradorFin, setBorradorFin] = useState<string | null>(null);
  const valorPremio = borradorPremio ?? premio;
  const valorFin = borradorFin ?? fin ?? "";
  const hayCambios = borradorPremio !== null || borradorFin !== null;
  const errorForm = hayCambios ? validarPremioFecha(valorPremio, valorFin) : null;
  const plazoPasado = fin !== null && fin < hoyEnMadrid();
  const guardar = () =>
    guardarPremioFecha.mutate(
      { premio: valorPremio, fin: valorFin },
      { onSuccess: () => { setBorradorPremio(null); setBorradorFin(null); } },
    );

  const aviso = cargando
    ? "Cargando..."
    : error
      ? "No se pudo cargar la configuración."
      : !disponible
        ? "Falta aplicar la actualización de la votación en la base de datos."
        : null;

  return (
    <Card data-tour="gw-carta-encuesta">
      <CardContent className="space-y-1 px-4 py-2.5">
        {!puedeEditar ? (
          <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
              <Trophy className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span>Votación «Vota tu vino favorito y gana un sorteo» en la web</span>
            </p>
            {!aviso && (
              <Badge variant={activa ? "default" : "secondary"} data-testid="estado-votacion">
                {activa ? "Abierta en la web" : "Cerrada"}
              </Badge>
            )}
          </div>
        ) : (
          <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <Label htmlFor={id} className="flex min-w-0 cursor-pointer items-center gap-2">
              <Trophy className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span>Votación «Vota tu vino favorito y gana un sorteo» en la web</span>
            </Label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-10"
                disabled={!disponible}
                onClick={() => setVerResultados(true)}
              >
                <Users className="mr-2 h-4 w-4" aria-hidden="true" />
                Resultados
              </Button>
              <Switch
                id={id}
                checked={activa}
                disabled={!disponible || cambiarActiva.isPending || (!activa && !puedeAbrir)}
                aria-describedby={!activa && !puedeAbrir ? `${id}-ayuda` : undefined}
                onCheckedChange={(valor) => cambiarActiva.mutate(valor)}
              />
            </div>
          </div>
        )}
        {aviso && <p className="text-xs text-muted-foreground">{aviso}</p>}
        {!aviso && !puedeEditar && premio && fin && (
          <dl className="grid gap-x-4 gap-y-1 pb-1 text-sm sm:grid-cols-[auto_1fr]" data-testid="premio-fecha-lectura">
            <dt className="text-muted-foreground">Premio</dt>
            <dd className="break-words">{premio}</dd>
            <dt className="text-muted-foreground">Último día para votar</dt>
            <dd>{fechaCorta(fin)}</dd>
          </dl>
        )}
        {!aviso && puedeEditar && (
          <div className="space-y-2 pb-1 pt-2">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-start">
              <div className="space-y-1">
                <Label htmlFor={`${id}-premio`}>Premio</Label>
                <Input
                  id={`${id}-premio`}
                  className="h-11"
                  value={valorPremio}
                  maxLength={PREMIO_MAX}
                  disabled={activa || guardarPremioFecha.isPending}
                  onChange={(e) => setBorradorPremio(e.target.value)}
                  placeholder="Por ejemplo: una cena para dos"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${id}-fin`}>Último día para votar</Label>
                <Input
                  id={`${id}-fin`}
                  type="date"
                  className="h-11"
                  value={valorFin}
                  disabled={activa || guardarPremioFecha.isPending}
                  onChange={(e) => setBorradorFin(e.target.value)}
                />
              </div>
            </div>
            {activa ? (
              <p className="text-xs text-muted-foreground" data-testid="aviso-cambiar">
                Para cambiar el premio o el último día, cierra antes la votación.
                {plazoPasado ? " El último día ya pasó: la web no admite más votos." : ""}
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" className="h-11" disabled={!hayCambios || guardarPremioFecha.isPending} onClick={guardar}>
                  {guardarPremioFecha.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                  Guardar
                </Button>
                {errorForm && (
                  <p role="alert" className="text-xs text-destructive">{errorForm}</p>
                )}
              </div>
            )}
            {!activa && !puedeAbrir && (
              <p id={`${id}-ayuda`} className="text-xs text-muted-foreground" data-testid="ayuda-abrir">
                {TEXTO_PARA_ABRIR}
              </p>
            )}
          </div>
        )}
      </CardContent>

      {puedeEditar && (
        <ResultadosDialog
          open={verResultados}
          onOpenChange={setVerResultados}
          votos={votos.data ?? []}
          cargando={votos.isLoading}
          error={votos.isError}
          puedeEditar={puedeEditar}
          vaciando={vaciar.isPending}
          onVaciar={() => vaciar.mutate()}
        />
      )}
    </Card>
  );
}

function ResultadosDialog({
  open,
  onOpenChange,
  votos,
  cargando,
  error,
  puedeEditar,
  vaciando,
  onVaciar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  votos: VotoVino[];
  cargando: boolean;
  error: boolean;
  puedeEditar: boolean;
  vaciando: boolean;
  onVaciar: () => void;
}) {
  const recuento = useMemo(() => recuentoPorVino(votos), [votos]);
  const [ganador, setGanador] = useState<VotoVino | null>(null);
  const [confirmarVaciar, setConfirmarVaciar] = useState(false);
  const maximo = recuento[0]?.votos ?? 0;

  const descargar = () => {
    // BOM para que Excel lea bien las tildes.
    const blob = new Blob(["﻿" + participantesCsv(votos)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `votacion-vino-favorito-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(abierto) => {
          onOpenChange(abierto);
          if (!abierto) setGanador(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-primary" aria-hidden="true" />
              Vino favorito: resultados
            </DialogTitle>
            <DialogDescription>
              Una participación por email o teléfono. Los datos son solo para el sorteo: vacía la votación al
              terminarlo.
            </DialogDescription>
          </DialogHeader>

          {cargando ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <p className="text-sm text-destructive">No se pudieron cargar los votos.</p>
          ) : votos.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Todavía no ha votado nadie.</p>
          ) : (
            <div className="space-y-5">
              <div className="flex items-center gap-2 text-sm">
                <Badge variant="secondary">{votos.length}</Badge>
                {votos.length === 1 ? "participante" : "participantes"}
              </div>

              <ol className="space-y-2" aria-label="Votos por vino">
                {recuento.map((r, i) => (
                  <li key={r.vino} className="space-y-1">
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 [overflow-wrap:anywhere]">
                        <span className="mr-1 text-muted-foreground">{i + 1}.</span>
                        {r.vino}
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums">{r.votos}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${(r.votos / maximo) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ol>

              {ganador && (
                <div role="status" className="rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
                  <p className="flex items-center gap-2 font-semibold">
                    <Gift className="h-4 w-4 text-primary" aria-hidden="true" />
                    Ganador: {ganador.nombre}
                  </p>
                  <p className="mt-1 [overflow-wrap:anywhere]">{ganador.contacto}</p>
                  <p className="text-xs text-muted-foreground">Votó: {ganador.vino_nombre}</p>
                </div>
              )}

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Button type="button" className="h-11" onClick={() => setGanador(sortearGanador(votos))}>
                  <Gift className="mr-2 h-4 w-4" aria-hidden="true" />
                  {ganador ? "Sortear otra vez" : "Sortear ganador"}
                </Button>
                <Button type="button" variant="outline" className="h-11" onClick={descargar}>
                  <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                  Descargar lista
                </Button>
                {puedeEditar && (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 text-destructive"
                    disabled={vaciando}
                    onClick={() => setConfirmarVaciar(true)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                    Vaciar
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmarVaciar} onOpenChange={setConfirmarVaciar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Vaciar la votación?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borran los {votos.length} votos con sus nombres y contactos. No se puede deshacer: descarga antes la
              lista si la necesitas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                onVaciar();
                setGanador(null);
              }}
            >
              Vaciar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
