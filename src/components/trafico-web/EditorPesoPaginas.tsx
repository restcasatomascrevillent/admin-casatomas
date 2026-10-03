import { useState, type FormEvent } from "react";
import { Loader2, Pencil, Scale, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import {
  NOMBRE_PROYECTO,
  PROYECTOS_TRAFICO,
  useBorrarPesoPagina,
  useGuardarPesoPagina,
  usePesoPaginas,
  type PesoPagina,
  type ProyectoTrafico,
} from "@/hooks/useTraficoWeb";
import { fmtBytes, fmtFechaHora } from "./formato";

interface Borrador {
  proyecto: ProyectoTrafico;
  ruta: string;
  kb: string;
  nota: string;
}

const VACIO: Borrador = { proyecto: "casa-tomas-story", ruta: "", kb: "", nota: "" };

const mensaje = (e: unknown) => (e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String(e.message) : String(e));

/** Editor de `peso_paginas`. Solo se monta si el usuario puede editar la sección `trafico_web`. */
export function EditorPesoPaginas() {
  const [abierto, setAbierto] = useState(false);
  const [borrador, setBorrador] = useState<Borrador>(VACIO);
  const { data, isLoading, isError, error, refetch } = usePesoPaginas();
  const guardar = useGuardarPesoPagina();
  const borrar = useBorrarPesoPagina();

  const editar = (p: PesoPagina) =>
    setBorrador({
      proyecto: p.proyecto as ProyectoTrafico,
      ruta: p.ruta,
      kb: String(Math.round(p.bytes_por_visita / 1000)),
      nota: p.nota ?? "",
    });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const ruta = borrador.ruta.trim();
    const kb = Number(borrador.kb.replace(",", "."));
    if (!ruta || (ruta !== "*" && !ruta.startsWith("/"))) {
      toast.error("La ruta debe empezar por «/» (o ser «*» para el peso medio de la web).");
      return;
    }
    if (!Number.isFinite(kb) || kb <= 0) {
      toast.error("El peso debe ser un número de KB mayor que 0.");
      return;
    }
    guardar.mutate(
      { proyecto: borrador.proyecto, ruta, bytes_por_visita: kb * 1000, nota: borrador.nota.trim() || null },
      {
        onSuccess: () => {
          toast.success(`Peso guardado para ${ruta}`);
          setBorrador({ ...VACIO, proyecto: borrador.proyecto });
        },
        onError: (err) => toast.error(`No se ha podido guardar: ${mensaje(err)}`),
      },
    );
  };

  const onBorrar = (p: PesoPagina) => {
    if (!window.confirm(`¿Borrar el peso de ${p.ruta}? Pasará a usar el peso medio de la web.`)) return;
    borrar.mutate(
      { proyecto: p.proyecto as ProyectoTrafico, ruta: p.ruta },
      {
        onSuccess: () => toast.success(`Peso de ${p.ruta} borrado`),
        onError: (err) => toast.error(`No se ha podido borrar: ${mensaje(err)}`),
      },
    );
  };

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-11 gap-2 px-4">
          <Scale className="h-4 w-4" aria-hidden />
          Pesos por página
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Peso transferido por visita</DialogTitle>
          <DialogDescription>
            Se usa para ESTIMAR el Fast Data Transfer (visitas × peso). La ruta «*» es el peso medio de cada web y se aplica
            a las páginas sin peso propio. Medido en la primera visita (sin caché), en KB decimales.
          </DialogDescription>
        </DialogHeader>

        {isError ? (
          <EstadoErrorCarga titulo="los pesos por página" error={error} onReintentar={() => refetch()} />
        ) : isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Web</TableHead>
                  <TableHead>Ruta</TableHead>
                  <TableHead className="text-right">Peso</TableHead>
                  <TableHead className="hidden sm:table-cell">Actualizado</TableHead>
                  <TableHead className="w-[100px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data ?? []).map((p) => (
                  <TableRow key={`${p.proyecto}|${p.ruta}`}>
                    <TableCell className="text-xs">{NOMBRE_PROYECTO[p.proyecto as ProyectoTrafico] ?? p.proyecto}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {p.ruta === "*" ? "* (media)" : p.ruta}
                      {/* La nota se lee escrita: antes solo salía en un `title` (hover). */}
                      {p.nota && <span className="block max-w-[16rem] whitespace-normal font-sans text-xs text-muted-foreground">{p.nota}</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs">{fmtBytes(p.bytes_por_visita)}</TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                      {fmtFechaHora(p.actualizado_en)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-11 w-11" onClick={() => editar(p)} aria-label={`Editar ${p.ruta}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {p.ruta !== "*" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-11 w-11 text-destructive"
                            onClick={() => onBorrar(p)}
                            disabled={borrar.isPending}
                            aria-label={`Borrar ${p.ruta}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-3 rounded-md border border-border/60 bg-muted/20 p-3">
          <p className="text-sm font-medium">Añadir o modificar</p>
          <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr_0.8fr]">
            <div className="space-y-1">
              <Label htmlFor="peso-proyecto" className="text-xs">
                Web
              </Label>
              <Select
                value={borrador.proyecto}
                onValueChange={(v) => setBorrador((b) => ({ ...b, proyecto: v as ProyectoTrafico }))}
              >
                <SelectTrigger id="peso-proyecto" className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROYECTOS_TRAFICO.map((p) => (
                    <SelectItem key={p} value={p}>
                      {NOMBRE_PROYECTO[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="peso-ruta" className="text-xs">
                Ruta
              </Label>
              <Input
                id="peso-ruta"
                placeholder="/carta"
                value={borrador.ruta}
                onChange={(e) => setBorrador((b) => ({ ...b, ruta: e.target.value }))}
                className="h-11 font-mono text-base md:text-base"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                maxLength={2048}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="peso-kb" className="text-xs">
                Peso (KB)
              </Label>
              <Input
                id="peso-kb"
                inputMode="decimal"
                placeholder="450"
                value={borrador.kb}
                onChange={(e) => setBorrador((b) => ({ ...b, kb: e.target.value }))}
                className="h-11 text-base md:text-base"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="peso-nota" className="text-xs">
              Nota (opcional)
            </Label>
            <Input
              id="peso-nota"
              placeholder="Cómo y cuándo se midió"
              value={borrador.nota}
              onChange={(e) => setBorrador((b) => ({ ...b, nota: e.target.value }))}
              className="h-11 text-base md:text-base"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" className="h-11 px-4" onClick={() => setBorrador(VACIO)}>
              Limpiar
            </Button>
            <Button type="submit" size="sm" disabled={guardar.isPending} className="h-11 gap-2 px-5">
              {guardar.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Guardar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
