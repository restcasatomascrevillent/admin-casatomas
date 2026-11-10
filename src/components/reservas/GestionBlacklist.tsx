import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Plus, Trash2, Edit, Mail, Phone, ShieldBan, ShieldCheck, CalendarOff } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  useBlacklist,
  useCrearBlacklist,
  useActualizarBlacklist,
  useEliminarBlacklist,
  BlacklistEntry
} from "@/hooks/useBlacklist";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { SugerenciasBlacklist } from "./SugerenciasBlacklist";

/**
 * Pestaña Blacklist de Reservas: sugerencias pendientes y la lista negra. Añadir, editar y quitar
 * entradas exige «Editar» en Reservas; con solo «Ver» se consulta y esos botones no salen
 * (06/11/2026, decisión del dueño: se ocultan, no se desactivan; la etiqueta «Solo lectura» la pone
 * la página).
 */
export function GestionBlacklist() {
  const { canAccess: puedeEditar } = useCanAccessSection("reservas", "edit");
  const { data: blacklist, isLoading } = useBlacklist();
  const crearBlacklist = useCrearBlacklist();
  const actualizarBlacklist = useActualizarBlacklist();
  const eliminarBlacklist = useEliminarBlacklist();

  const [openDialog, setOpenDialog] = useState(false);
  const [editingEntry, setEditingEntry] = useState<BlacklistEntry | null>(null);
  const [formData, setFormData] = useState({
    tipo: "email" as "email" | "telefono",
    valor: "",
    nombre: "",
    motivo: "",
  });

  const resetForm = () => {
    setFormData({ tipo: "email", valor: "", nombre: "", motivo: "" });
    setEditingEntry(null);
  };

  const handleOpenChange = (open: boolean) => {
    setOpenDialog(open);
    if (!open) resetForm();
  };

  const handleEdit = (entry: BlacklistEntry) => {
    setEditingEntry(entry);
    setFormData({
      tipo: entry.tipo,
      valor: entry.valor,
      nombre: entry.nombre || "",
      motivo: entry.motivo || "",
    });
    setOpenDialog(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.valor.trim()) return;

    const payload = {
      tipo: formData.tipo,
      valor: formData.valor.trim().toLowerCase(),
      nombre: formData.nombre.trim() || null,
      motivo: formData.motivo.trim() || null,
    };

    if (editingEntry) {
      await actualizarBlacklist.mutateAsync({ id: editingEntry.id, ...payload });
    } else {
      await crearBlacklist.mutateAsync(payload);
    }
    
    handleOpenChange(false);
  };

  const handleDelete = async (id: string) => {
    await eliminarBlacklist.mutateAsync(id);
  };

  // Acciones con texto y 48 px (10/11/2026, dueño: «botones claros»): «Editar» y «Quitar», del mismo
  // tamaño; quitar sigue pidiendo confirmación.
  const accionesEntrada = (entry: NonNullable<typeof blacklist>[number]) => !puedeEditar ? null : (
    <div className="flex flex-wrap justify-end gap-2">
      <Button
        variant="outline"
        className="h-12 gap-2 px-4 text-base"
        onClick={() => handleEdit(entry)}
        aria-label={`Editar la entrada ${entry.valor}`}
      >
        <Edit className="h-5 w-5" aria-hidden="true" />
        Editar
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="outline"
            className="h-12 gap-2 px-4 text-base text-destructive hover:text-destructive"
            aria-label={`Eliminar ${entry.valor} de la lista negra`}
          >
            <Trash2 className="h-5 w-5" aria-hidden="true" />
            Quitar
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar de la lista negra?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción permitirá que este {entry.tipo === "email" ? "email" : "teléfono"} pueda realizar reservas nuevamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => handleDelete(entry.id)}>
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldBan className="h-5 w-5" />
            Lista Negra
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4 text-muted-foreground">Cargando...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* El sistema propone (ausencias detectadas por el cron diario), una
          persona decide. Va encima de la tabla: son las que necesitan
          revisión ahora, la tabla de abajo es el registro ya resuelto. */}
      <SugerenciasBlacklist />

      <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-xl">
              <ShieldBan className="h-6 w-6" />
              Lista Negra
            </CardTitle>
            <CardDescription className="text-base">
              {puedeEditar ? "Gestiona emails y teléfonos bloqueados para reservas" : "Emails y teléfonos bloqueados para reservas"}
            </CardDescription>
          </div>
          {puedeEditar && (
            <Dialog open={openDialog} onOpenChange={handleOpenChange}>
              <DialogTrigger asChild>
                <Button className="h-12 px-5 text-base">
                  <Plus className="mr-2 h-5 w-5" />
                  Añadir
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>
                    {editingEntry ? "Editar entrada" : "Añadir a lista negra"}
                  </DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="reservas-legible space-y-4">
                  <div className="space-y-2">
                    <Label>Tipo</Label>
                    <Select
                      value={formData.tipo}
                      onValueChange={(value: "email" | "telefono") =>
                        setFormData({ ...formData, tipo: value })
                      }
                      disabled={!!editingEntry}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="email">Email</SelectItem>
                        <SelectItem value="telefono">Teléfono</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>{formData.tipo === "email" ? "Email" : "Teléfono"}</Label>
                    <Input
                      type={formData.tipo === "email" ? "email" : "tel"}
                      value={formData.valor}
                      onChange={(e) => setFormData({ ...formData, valor: e.target.value })}
                      placeholder={formData.tipo === "email" ? "ejemplo@email.com" : "+34 600 000 000"}
                      disabled={!!editingEntry}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Nombre (opcional)</Label>
                    <Input
                      value={formData.nombre}
                      onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                      placeholder="Nombre del cliente"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Motivo (opcional)</Label>
                    <Textarea
                      value={formData.motivo}
                      onChange={(e) => setFormData({ ...formData, motivo: e.target.value })}
                      placeholder="Razón por la que está en la lista negra"
                      rows={3}
                    />
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" className="h-12 px-5 text-base" onClick={() => handleOpenChange(false)}>
                      Cancelar
                    </Button>
                    <Button type="submit" className="h-12 px-5 text-base" disabled={!formData.valor.trim()}>
                      {editingEntry ? "Guardar" : "Añadir"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {!blacklist || blacklist.length === 0 ? (
          <div className="py-8 text-center text-lg text-muted-foreground">
            No hay entradas en la lista negra
          </div>
        ) : (
          <>
          {/* Tablet vertical / portátil pequeño: tarjetas (las columnas no caben y «Acciones» quedaba
              fuera de la vista). Desde el 10/11/2026 con letra de 17-18 px, como la Lista. */}
          <div className="space-y-3 xl:hidden">
            {blacklist.map((entry) => (
              <div key={entry.id} className="space-y-2 rounded-lg border p-4 text-[17px]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="text-lg font-semibold">{entry.nombre || "Sin nombre"}</p>
                    <p className="flex flex-wrap items-center gap-2">
                      <TipoEntrada tipo={entry.tipo} />
                      <span className="break-all font-mono">{entry.valor}</span>
                    </p>
                  </div>
                  {accionesEntrada(entry)}
                </div>
                {entry.motivo && <p className="whitespace-pre-wrap text-muted-foreground">{entry.motivo}</p>}
                <DatosEntrada entry={entry} />
              </div>
            ))}
          </div>

          {/* Escritorio: tabla como la de la Lista (10/11/2026, dueño: «letra más grande, botones
              claros»). Cinco columnas en vez de siete: el tipo va junto al valor y la fecha de alta y
              la aprobación bajan debajo del motivo. Filas de ~72 px con texto de 17-18 px. */}
          <div className="hidden xl:block">
          <Table className="text-[17px]">
            <TableHeader>
              <TableRow>
                <TableHead className="h-12 text-base font-semibold text-foreground">Nombre</TableHead>
                <TableHead className="h-12 text-base font-semibold text-foreground">Email o teléfono</TableHead>
                <TableHead className="h-12 text-base font-semibold text-foreground">Motivo</TableHead>
                <TableHead className="h-12 text-base font-semibold text-foreground">Caduca</TableHead>
                {puedeEditar && <TableHead className="h-12 text-right text-base font-semibold text-foreground">Acciones</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {blacklist.map((entry) => (
                <TableRow key={entry.id} className="h-[72px]">
                  <TableCell className="py-3 text-lg font-semibold">{entry.nombre || "Sin nombre"}</TableCell>
                  <TableCell className="py-3">
                    <span className="flex flex-wrap items-center gap-2">
                      <TipoEntrada tipo={entry.tipo} />
                      <span className="break-all font-mono">{entry.valor}</span>
                    </span>
                  </TableCell>
                  <TableCell className="max-w-[22rem] py-3">
                    <p className="line-clamp-2" title={entry.motivo || undefined}>{entry.motivo || "—"}</p>
                    <p className="mt-0.5 text-[15px] text-muted-foreground">
                      Desde {format(new Date(entry.created_at), "dd MMM yyyy", { locale: es })}
                      {entry.aprobada_en && <> · aprobada el {format(new Date(entry.aprobada_en), "dd MMM yyyy", { locale: es })}</>}
                    </p>
                  </TableCell>
                  <TableCell className="py-3"><InsigniaCaducidad caducaEl={entry.caduca_el} /></TableCell>
                  {puedeEditar && (
                    <TableCell className="py-3 text-right">
                      {accionesEntrada(entry)}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
          </>
        )}
      </CardContent>
      </Card>
    </div>
  );
}

/** «Email» o «Teléfono», insignia de 14 px. */
function TipoEntrada({ tipo }: { tipo: BlacklistEntry["tipo"] }) {
  return (
    <Badge variant="outline" className="gap-1 px-2 py-0.5 text-sm font-medium">
      {tipo === "email" ? <Mail className="h-4 w-4" aria-hidden="true" /> : <Phone className="h-4 w-4" aria-hidden="true" />}
      {tipo === "email" ? "Email" : "Teléfono"}
    </Badge>
  );
}

function InsigniaCaducidad({ caducaEl }: { caducaEl: string | null | undefined }) {
  return caducaEl ? (
    <Badge variant="outline" className="gap-1 border-amber-400 px-2 py-0.5 text-sm font-medium text-amber-800 dark:text-amber-300">
      <ShieldCheck className="h-4 w-4" aria-hidden="true" />
      {format(new Date(`${caducaEl}T00:00:00`), "dd MMM yyyy", { locale: es })}
    </Badge>
  ) : (
    <Badge variant="outline" className="gap-1 px-2 py-0.5 text-sm font-medium text-muted-foreground">
      <CalendarOff className="h-4 w-4" aria-hidden="true" />
      Sin caducidad
    </Badge>
  );
}

/** Alta, aprobación y caducidad de una entrada (vista en tarjetas). */
function DatosEntrada({ entry }: { entry: BlacklistEntry }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[15px] text-muted-foreground">
      <span>Desde {format(new Date(entry.created_at), "dd MMM yyyy", { locale: es })}</span>
      {entry.aprobada_en && (
        <span className="flex items-center gap-1">
          <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
          Aprobada el {format(new Date(entry.aprobada_en), "dd MMM yyyy", { locale: es })}
        </span>
      )}
      <InsigniaCaducidad caducaEl={entry.caduca_el} />
    </div>
  );
}
