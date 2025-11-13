import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";

interface Worker {
  id: string;
  nombre: string;
  apellidos: string;
  email: string;
  telefono: string | null;
  rol: string;
  activo: boolean;
}

export default function Trabajadores() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [filteredWorkers, setFilteredWorkers] = useState<Worker[]>([]);
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingWorker, setEditingWorker] = useState<Worker | null>(null);
  const [formData, setFormData] = useState({
    nombre: "",
    apellidos: "",
    email: "",
    telefono: "",
    rol: "camarero",
  });

  const roles = ["camarero", "jefe_sala", "host", "gerente", "cocina"];

  useEffect(() => {
    fetchWorkers();
  }, []);

  useEffect(() => {
    filterWorkers();
  }, [workers, roleFilter, statusFilter]);

  const fetchWorkers = async () => {
    const { data, error } = await supabase
      .from("trabajadores")
      .select("*")
      .order("apellidos");

    if (error) {
      toast.error("Error al cargar trabajadores");
    } else {
      setWorkers(data || []);
    }
  };

  const filterWorkers = () => {
    let filtered = [...workers];

    if (roleFilter !== "all") {
      filtered = filtered.filter((w) => w.rol === roleFilter);
    }

    if (statusFilter !== "all") {
      filtered = filtered.filter((w) =>
        statusFilter === "active" ? w.activo : !w.activo
      );
    }

    setFilteredWorkers(filtered);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (editingWorker) {
      const { error } = await supabase
        .from("trabajadores")
        .update(formData)
        .eq("id", editingWorker.id);

      if (error) {
        toast.error("Error al actualizar trabajador");
      } else {
        toast.success("Trabajador actualizado");
        fetchWorkers();
        resetForm();
      }
    } else {
      const { error } = await supabase.from("trabajadores").insert([formData]);

      if (error) {
        toast.error("Error al crear trabajador");
      } else {
        toast.success("Trabajador creado");
        fetchWorkers();
        resetForm();
      }
    }
  };

  const handleEdit = (worker: Worker) => {
    setEditingWorker(worker);
    setFormData({
      nombre: worker.nombre,
      apellidos: worker.apellidos,
      email: worker.email,
      telefono: worker.telefono || "",
      rol: worker.rol,
    });
    setDialogOpen(true);
  };

  const handleToggleStatus = async (worker: Worker) => {
    const { error } = await supabase
      .from("trabajadores")
      .update({ activo: !worker.activo })
      .eq("id", worker.id);

    if (error) {
      toast.error("Error al cambiar estado");
    } else {
      toast.success("Estado actualizado");
      fetchWorkers();
    }
  };

  const resetForm = () => {
    setFormData({
      nombre: "",
      apellidos: "",
      email: "",
      telefono: "",
      rol: "camarero",
    });
    setEditingWorker(null);
    setDialogOpen(false);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Trabajadores</h2>
            <p className="text-muted-foreground">Gestiona el personal del restaurante</p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={resetForm}>
                <Plus className="mr-2 h-4 w-4" />
                Nuevo Trabajador
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {editingWorker ? "Editar Trabajador" : "Nuevo Trabajador"}
                </DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="nombre">Nombre</Label>
                  <Input
                    id="nombre"
                    value={formData.nombre}
                    onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="apellidos">Apellidos</Label>
                  <Input
                    id="apellidos"
                    value={formData.apellidos}
                    onChange={(e) => setFormData({ ...formData, apellidos: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="telefono">Teléfono</Label>
                  <Input
                    id="telefono"
                    value={formData.telefono}
                    onChange={(e) => setFormData({ ...formData, telefono: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rol">Rol</Label>
                  <Select value={formData.rol} onValueChange={(value) => setFormData({ ...formData, rol: value })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((rol) => (
                        <SelectItem key={rol} value={rol}>
                          {rol.replace("_", " ").charAt(0).toUpperCase() + rol.replace("_", " ").slice(1)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit" className="w-full">
                  {editingWorker ? "Actualizar" : "Crear"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardHeader>
            <div className="flex gap-4">
              <div className="flex-1">
                <Label>Filtrar por Rol</Label>
                <Select value={roleFilter} onValueChange={setRoleFilter}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {roles.map((rol) => (
                      <SelectItem key={rol} value={rol}>
                        {rol.replace("_", " ").charAt(0).toUpperCase() + rol.replace("_", " ").slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1">
                <Label>Filtrar por Estado</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="active">Activos</SelectItem>
                    <SelectItem value="inactive">Inactivos</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Teléfono</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredWorkers.map((worker) => (
                  <TableRow key={worker.id}>
                    <TableCell className="font-medium">
                      {worker.nombre} {worker.apellidos}
                    </TableCell>
                    <TableCell>{worker.email}</TableCell>
                    <TableCell>{worker.telefono || "-"}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {worker.rol.replace("_", " ").charAt(0).toUpperCase() + worker.rol.replace("_", " ").slice(1)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={worker.activo ? "default" : "secondary"}>
                        {worker.activo ? "Activo" : "Inactivo"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="sm" onClick={() => handleEdit(worker)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleStatus(worker)}
                        >
                          {worker.activo ? "Desactivar" : "Activar"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
