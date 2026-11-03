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
import { SugerenciasBlacklist } from "./SugerenciasBlacklist";

export function GestionBlacklist() {
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

  const accionesEntrada = (entry: NonNullable<typeof blacklist>[number]) => (
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEdit(entry)}
                        aria-label={`Editar la entrada ${entry.valor}`}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`Eliminar ${entry.valor} de la lista negra`}>
                            <Trash2 className="h-4 w-4 text-destructive" />
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
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldBan className="h-5 w-5" />
              Lista Negra
            </CardTitle>
            <CardDescription>
              Gestiona emails y teléfonos bloqueados para reservas
            </CardDescription>
          </div>
          <Dialog open={openDialog} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Añadir
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {editingEntry ? "Editar entrada" : "Añadir a lista negra"}
                </DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
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
                  <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                    Cancelar
                  </Button>
                  <Button type="submit" disabled={!formData.valor.trim()}>
                    {editingEntry ? "Guardar" : "Añadir"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {!blacklist || blacklist.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No hay entradas en la lista negra
          </div>
        ) : (
          <>
          {/* Tablet vertical / portátil pequeño: tarjetas. Siete columnas no caben y «Acciones» quedaba
              a la derecha, fuera de la vista; el motivo se cortaba sin forma de leerlo entero. */}
          <div className="space-y-3 xl:hidden">
            {blacklist.map((entry) => (
              <div key={entry.id} className="space-y-2 rounded-lg border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <Badge variant="outline" className="gap-1">
                      {entry.tipo === "email" ? <Mail className="h-3 w-3" /> : <Phone className="h-3 w-3" />}
                      {entry.tipo === "email" ? "Email" : "Teléfono"}
                    </Badge>
                    <p className="break-all font-mono text-sm">{entry.valor}</p>
                    {entry.nombre && <p className="text-sm">{entry.nombre}</p>}
                  </div>
                  {accionesEntrada(entry)}
                </div>
                {entry.motivo && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{entry.motivo}</p>}
                {entry.aprobada_en && (
                  <p className="flex items-center gap-1 text-[11px] pointer-coarse:text-xs text-muted-foreground">
                    <ShieldCheck className="h-3 w-3 shrink-0" />
                    Aprobada el {format(new Date(entry.aprobada_en), "dd MMM yyyy", { locale: es })}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>Desde {format(new Date(entry.created_at), "dd MMM yyyy", { locale: es })}</span>
                  {entry.caduca_el ? (
                    <Badge variant="outline" className="gap-1 border-amber-300 font-normal text-amber-700 dark:text-amber-400">
                      <ShieldCheck className="h-3 w-3" />
                      Caduca {format(new Date(`${entry.caduca_el}T00:00:00`), "dd MMM yyyy", { locale: es })}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
                      <CalendarOff className="h-3 w-3" />
                      Sin caducidad
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="hidden xl:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead>Motivo</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Caduca</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {blacklist.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>
                    <Badge variant="outline" className="gap-1">
                      {entry.tipo === "email" ? (
                        <Mail className="h-3 w-3" />
                      ) : (
                        <Phone className="h-3 w-3" />
                      )}
                      {entry.tipo === "email" ? "Email" : "Teléfono"}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{entry.valor}</TableCell>
                  <TableCell>{entry.nombre || "-"}</TableCell>
                  <TableCell className="max-w-[200px]">
                    <p className="truncate">{entry.motivo || "-"}</p>
                    {entry.aprobada_en && (
                      <p className="text-[11px] pointer-coarse:text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <ShieldCheck className="h-3 w-3 shrink-0" />
                        Aprobada el {format(new Date(entry.aprobada_en), "dd MMM yyyy", { locale: es })}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {format(new Date(entry.created_at), "dd MMM yyyy", { locale: es })}
                  </TableCell>
                  <TableCell className="text-sm">
                    {entry.caduca_el ? (
                      <Badge variant="outline" className="text-amber-700 dark:text-amber-400 border-amber-300 font-normal gap-1">
                        <ShieldCheck className="h-3 w-3" />
                        {format(new Date(`${entry.caduca_el}T00:00:00`), "dd MMM yyyy", { locale: es })}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground font-normal gap-1">
                        <CalendarOff className="h-3 w-3" />
                        Sin caducidad
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {accionesEntrada(entry)}
                  </TableCell>
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
