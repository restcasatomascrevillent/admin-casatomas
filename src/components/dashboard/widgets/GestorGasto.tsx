import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Receipt, CreditCard, Calendar, TrendingUp } from "lucide-react";

const conceptos = [
  {
    nombre: "Licencia OficiososIA - Plan Pro",
    descripcion: "Acceso completo al panel de gestión",
    precio: 149.00,
    periodicidad: "Mensual",
    estado: "activo",
  },
  {
    nombre: "Módulo Chatbot IA",
    descripcion: "Asistente virtual para reservas y consultas",
    precio: 49.00,
    periodicidad: "Mensual",
    estado: "activo",
  },
  {
    nombre: "Procesamiento de Facturas IA",
    descripcion: "OCR + extracción automática de datos",
    precio: 29.00,
    periodicidad: "Mensual",
    estado: "activo",
  },
  {
    nombre: "Newsletter",
    descripcion: "Envío de campañas y newsletters",
    precio: 19.00,
    periodicidad: "Mensual",
    estado: "activo",
  },
  {
    nombre: "Soporte Premium",
    descripcion: "Soporte prioritario 24/7",
    precio: 0,
    periodicidad: "Incluido",
    estado: "incluido",
  },
];

export function GestorGasto() {
  const totalMensual = conceptos.reduce((sum, c) => sum + c.precio, 0);
  const proximoPago = new Date();
  proximoPago.setDate(1);
  proximoPago.setMonth(proximoPago.getMonth() + 1);

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-accent/10">
              <Receipt className="h-5 w-5 text-accent" />
            </div>
            <div>
              <CardTitle className="text-lg">Gestor de Gasto — OficiososIA</CardTitle>
              <CardDescription>Resumen de tu suscripción y servicios contratados</CardDescription>
            </div>
          </div>
          <Badge variant="outline" className="text-xs border-accent text-accent">
            Plan Pro
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Resumen rápido */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
            <CreditCard className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Total mensual</p>
              <p className="text-lg font-bold text-foreground">{totalMensual.toFixed(2)} €</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Próximo pago</p>
              <p className="text-sm font-semibold text-foreground">
                {proximoPago.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Total anual estimado</p>
              <p className="text-lg font-bold text-foreground">{(totalMensual * 12).toFixed(2)} €</p>
            </div>
          </div>
        </div>

        <Separator />

        {/* Desglose de conceptos */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">Desglose de servicios</p>
          {conceptos.map((concepto, i) => (
            <div
              key={i}
              className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/30 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{concepto.nombre}</p>
                <p className="text-xs text-muted-foreground truncate">{concepto.descripcion}</p>
              </div>
              <div className="flex items-center gap-3 ml-3 shrink-0">
                <Badge
                  variant={concepto.estado === "incluido" ? "secondary" : "default"}
                  className="text-xs"
                >
                  {concepto.periodicidad}
                </Badge>
                <span className="text-sm font-semibold text-foreground w-20 text-right">
                  {concepto.precio > 0 ? `${concepto.precio.toFixed(2)} €` : "Gratis"}
                </span>
              </div>
            </div>
          ))}
        </div>

        <Separator />

        <div className="flex items-center justify-between pt-1">
          <p className="text-sm text-muted-foreground">
            Facturación gestionada por <span className="font-semibold text-foreground">OficiososIA</span>
          </p>
          <p className="text-lg font-bold text-foreground">{totalMensual.toFixed(2)} €/mes</p>
        </div>
      </CardContent>
    </Card>
  );
}
