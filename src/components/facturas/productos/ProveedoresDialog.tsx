import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Merge, Pencil, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { formatCurrency, formatDateCorta } from "@/components/facturas/shared/formatters";
import { useEditarProveedor, useFusionarProveedores, useProveedores } from "@/hooks/useProveedores";
import {
  cifsDistintos,
  destinoFusionProveedorSugerido,
  filtrarProveedores,
  normalizarCif,
  type Proveedor,
} from "@/lib/facturas/proveedores";

const limpiar = (s: string) => s.replace(/\s+/g, " ").trim();

function resumenDocumentos(p: Proveedor): string {
  const partes: string[] = [];
  if (p.facturas) partes.push(`${p.facturas} factura(s) · ${formatCurrency(p.total_facturas)}`);
  if (p.albaranes) partes.push(`${p.albaranes} albarán(es) · ${formatCurrency(p.total_albaranes)}`);
  if (!partes.length) partes.push("Sin documentos");
  if (p.ultima_fecha) partes.push(`último ${formatDateCorta(p.ultima_fecha)}`);
  return partes.join(" · ");
}

function EditorProveedor({ p, onCerrar }: { p: Proveedor; onCerrar: () => void }) {
  const [nombre, setNombre] = useState(p.nombre);
  const [comercial, setComercial] = useState(p.nombre_comercial ?? "");
  const [cif, setCif] = useState(p.cif ?? "");
  const editar = useEditarProveedor();
  const nombreLimpio = limpiar(nombre);
  const sinCambios =
    nombreLimpio === p.nombre && (limpiar(comercial) || null) === (p.nombre_comercial ?? null) && normalizarCif(cif) === (p.cif ?? null);
  return (
    <form
      className="mt-2 grid gap-2 rounded-lg border bg-muted/30 p-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]"
      onSubmit={(e) => {
        e.preventDefault();
        if (!nombreLimpio || sinCambios) return;
        editar.mutate(
          { id: p.id, nombre: nombreLimpio, nombreComercial: limpiar(comercial) || null, cif: normalizarCif(cif) },
          { onSuccess: onCerrar },
        );
      }}
    >
      <div className="grid gap-1">
        <Label htmlFor={`prov-nombre-${p.id}`}>Nombre</Label>
        <Input id={`prov-nombre-${p.id}`} value={nombre} maxLength={255} onChange={(e) => setNombre(e.target.value)} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`prov-comercial-${p.id}`}>Nombre comercial</Label>
        <Input
          id={`prov-comercial-${p.id}`}
          value={comercial}
          maxLength={120}
          placeholder="Opcional"
          onChange={(e) => setComercial(e.target.value)}
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`prov-cif-${p.id}`}>CIF</Label>
        <Input id={`prov-cif-${p.id}`} value={cif} maxLength={20} placeholder="Opcional" onChange={(e) => setCif(e.target.value)} />
      </div>
      <div className="flex flex-wrap justify-end gap-2 sm:col-span-3">
        <Button type="button" variant="ghost" onClick={onCerrar}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!nombreLimpio || sinCambios || editar.isPending}>
          {editar.isPending ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </form>
  );
}

function FusionProveedores({
  seleccion,
  onVolver,
  onHecho,
}: {
  seleccion: Proveedor[];
  onVolver: () => void;
  onHecho: () => void;
}) {
  const [destino, setDestino] = useState<number | null>(() => destinoFusionProveedorSugerido(seleccion));
  const fusionar = useFusionarProveedores();
  const elegido = seleccion.find((p) => p.id === destino);
  const resto = seleccion.filter((p) => p.id !== destino);
  const documentos = resto.reduce((a, p) => a + p.documentos, 0);
  const cifs = cifsDistintos(seleccion);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto" role="group" aria-label="Fusionar proveedores">
      <p className="text-sm text-muted-foreground">
        Elige el que se queda. Sus documentos, sus nombres y su CIF pasan a él (también los documentos que lleguen después con esos
        nombres o CIF) y los demás se borran de la lista.
      </p>
      {cifs.length > 1 && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-400/70 bg-amber-50 p-2 text-sm dark:bg-amber-950/30">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
          Tienen CIF distintos ({cifs.join(", ")}): normalmente son empresas distintas. Fusiona solo si sabes que son la misma.
        </p>
      )}
      <RadioGroup value={destino === null ? "" : String(destino)} onValueChange={(v) => setDestino(Number(v))} className="gap-1">
        {seleccion.map((p) => (
          <Label
            key={p.id}
            htmlFor={`fusion-prov-${p.id}`}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 font-normal has-[:checked]:border-primary"
          >
            <RadioGroupItem id={`fusion-prov-${p.id}`} value={String(p.id)} />
            <span className="min-w-0 flex-1 truncate font-medium">{p.nombre}</span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {p.cif ?? "sin CIF"} · {p.documentos} doc.
            </span>
          </Label>
        ))}
      </RadioGroup>
      {elegido && (
        <p className="text-sm">
          Queda «{elegido.nombre}»; se le mueven {documentos} documento(s) y se borran {resto.length} proveedor(es).
        </p>
      )}
      <div className="mt-auto flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onVolver}>
          Volver
        </Button>
        <Button
          disabled={!elegido || resto.length === 0 || fusionar.isPending}
          onClick={() => {
            if (!elegido) return;
            fusionar.mutate({ origenIds: resto.map((p) => p.id), destinoId: elegido.id }, { onSuccess: onHecho });
          }}
        >
          <Merge className="mr-1 h-4 w-4" aria-hidden="true" /> {fusionar.isPending ? "Fusionando…" : "Fusionar"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Facturas › Productos › Proveedores (punto 11 del dueño, 07/10/2026): cada
 * proveedor una sola vez, con su CIF, sus documentos y los textos con que llega.
 * Con permiso de edición: renombrar (nombre, comercial, CIF) y fusionar duplicados.
 */
export function ProveedoresDialog({ puedeEditar, onCerrar }: { puedeEditar: boolean; onCerrar: () => void }) {
  const q = useProveedores();
  const [busqueda, setBusqueda] = useState("");
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set());
  const [editando, setEditando] = useState<number | null>(null);
  const [fusionando, setFusionando] = useState(false);

  const proveedores = useMemo(() => q.data?.proveedores ?? [], [q.data]);
  const visibles = useMemo(() => filtrarProveedores(proveedores, busqueda), [proveedores, busqueda]);
  const seleccionados = proveedores.filter((p) => seleccion.has(p.id));

  const alternar = (id: number) =>
    setSeleccion((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  let cuerpo: ReactNode;
  if (q.isLoading) {
    cuerpo = <p className="p-4 text-sm text-muted-foreground">Cargando proveedores…</p>;
  } else if (q.error) {
    cuerpo = <p className="p-4 text-sm text-destructive">{(q.error as { message?: string }).message ?? "No se ha podido cargar"}</p>;
  } else if (q.data?.faltaMigracion) {
    cuerpo = (
      <p className="p-4 text-sm text-muted-foreground">
        La lista de proveedores unificados aún no está activada: falta aplicar la migración 20261007180000_proveedores_unificados en
        la base de datos.
      </p>
    );
  } else if (fusionando && seleccionados.length >= 2) {
    cuerpo = (
      <FusionProveedores
        seleccion={seleccionados}
        onVolver={() => setFusionando(false)}
        onHecho={() => {
          setFusionando(false);
          setSeleccion(new Set());
        }}
      />
    );
  } else {
    cuerpo = (
      <>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por nombre, variante o CIF"
              aria-label="Buscar proveedor"
              className="pl-9"
            />
          </div>
          {puedeEditar && seleccion.size > 0 && (
            <div className="flex flex-wrap items-center gap-2" aria-label="Acciones sobre la selección">
              <span className="text-sm font-medium">{seleccion.size} seleccionado(s)</span>
              <Button size="sm" disabled={seleccion.size < 2} onClick={() => setFusionando(true)}>
                <Merge className="mr-1 h-4 w-4" aria-hidden="true" /> Fusionar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSeleccion(new Set())}>
                Quitar selección
              </Button>
            </div>
          )}
        </div>
        <ul className="min-h-0 flex-1 divide-y overflow-y-auto rounded-lg border" data-testid="lista-proveedores">
          {visibles.length === 0 && <li className="p-4 text-sm text-muted-foreground">Ningún proveedor coincide.</li>}
          {visibles.map((p) => {
            const otrasFormas = p.variantes.filter((v) => v !== p.nombre);
            return (
              <li key={p.id} className={`px-2 py-1.5 ${seleccion.has(p.id) ? "bg-primary/5" : ""}`}>
                <div className="flex items-start gap-2">
                  {puedeEditar && (
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center">
                      <Checkbox
                        checked={seleccion.has(p.id)}
                        onCheckedChange={() => alternar(p.id)}
                        aria-label={`Seleccionar ${p.nombre}`}
                      />
                    </div>
                  )}
                  <div className="min-w-0 flex-1 py-1">
                    <p className="break-words font-medium">
                      {p.nombre}
                      {p.nombre_comercial && <span className="font-normal text-muted-foreground"> · «{p.nombre_comercial}»</span>}
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {p.cif ? `CIF ${p.cif}` : "Sin CIF"}
                      {p.cifs_extra.length > 0 && ` (también ${p.cifs_extra.join(", ")})`} · {resumenDocumentos(p)}
                    </p>
                    {otrasFormas.length > 0 && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Llega como: {otrasFormas.map((v) => `«${v}»`).join(", ")}
                      </p>
                    )}
                  </div>
                  {puedeEditar && editando !== p.id && (
                    <Button variant="ghost" className="shrink-0" onClick={() => setEditando(p.id)} aria-label={`Editar ${p.nombre}`}>
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  )}
                </div>
                {editando === p.id && <EditorProveedor p={p} onCerrar={() => setEditando(null)} />}
              </li>
            );
          })}
        </ul>
        <p className="shrink-0 text-xs text-muted-foreground">
          {visibles.length} proveedor(es). Los documentos nuevos se asignan solos por CIF o por nombre; si llega uno desconocido se
          crea solo y aquí se puede fusionar con el que toque.
        </p>
      </>
    );
  }

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && onCerrar()}>
      <DialogContent className="flex max-h-[92dvh] max-w-3xl flex-col gap-3 overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>{fusionando ? `Fusionar ${seleccionados.length} proveedores` : "Proveedores"}</DialogTitle>
          <DialogDescription>
            Cada proveedor una sola vez, aunque sus facturas y albaranes lo escriban distinto. Las sumas por proveedor del chatbot y
            de Productos usan esta lista.
          </DialogDescription>
        </DialogHeader>
        {cuerpo}
      </DialogContent>
    </Dialog>
  );
}
