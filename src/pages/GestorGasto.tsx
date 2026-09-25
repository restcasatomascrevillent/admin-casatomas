import { SuperAdminLayout } from "@/components/SuperAdminLayout";
import { GestorGasto as GestorGastoWidget } from "@/components/dashboard/widgets/GestorGasto";

export default function GestorGasto() {
  return (
    <SuperAdminLayout>
      <div className="space-y-6">
        {/* Sin título "Gestor de Gasto" (2026-09-25): ya lo dice la pestaña
            activa del menú lateral. Se conserva el subtítulo: aclara que esto
            es la factura que le pasa OficiososIA al restaurante, no un gasto
            del propio restaurante — no es obvio solo con el nombre. */}
        <p className="text-muted-foreground">Previsualización de tu facturación con OficiososIA</p>
        <GestorGastoWidget />
      </div>
    </SuperAdminLayout>
  );
}
