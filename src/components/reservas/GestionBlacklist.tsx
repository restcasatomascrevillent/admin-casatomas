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
import { Plus, Trash2, Edit, Mail, Phone, ShieldBan } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { 
  useBlacklist, 
  useCrearBlacklist, 
  useActualizarBlacklist, 
  useEliminarBlacklist,
  BlacklistEntry 
} from "@/hooks/useBlacklist";

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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead>Motivo</TableHead>
                <TableHead>Fecha</TableHead>
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
                  <TableCell className="max-w-[200px] truncate">
                    {entry.motivo || "-"}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {format(new Date(entry.created_at), "dd MMM yyyy", { locale: es })}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEdit(entry)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon">
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
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
