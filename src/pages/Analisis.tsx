import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BuscadorPreciosMercado } from "@/components/analisis/BuscadorPreciosMercado";

export default function Analisis() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Análisis</h2>
          <p className="text-muted-foreground">Métricas y análisis de datos</p>
        </div>
        
        <div className="grid gap-6 md:grid-cols-2">
          <BuscadorPreciosMercado />
          
          <Card>
            <CardHeader>
              <CardTitle>Dashboard de Análisis</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                Próximamente: gráficos y métricas de rendimiento
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
