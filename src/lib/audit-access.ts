import { completeAuditEnabled } from "./audit-version";
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// Solo registra usuarios autenticados. No se presenta un visitante anónimo
// como una persona identificada ni se incluyen query strings con secretos.
export async function auditDeniedAccess(path: string): Promise<void> {
  try {
    if (!await completeAuditEnabled()) return;
    const { error } = await supabase.rpc('registrar_acceso_panel', {
      p_tipo: 'acceso_denegado', p_ruta: path,
    });
    if (error) throw error;
  } catch { toast.error('El acceso se ha denegado, pero no se pudo guardar en la auditoría.'); }
}
