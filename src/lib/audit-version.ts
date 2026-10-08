import { supabase } from '@/integrations/supabase/client';

// main puede publicarse antes que Supabase. La versión se habilita con la
// última migración, después de desplegar panel-auth. Un error de red no se
// interpreta como servidor antiguo: en ese caso no se abre una sesión nueva.
export async function completeAuditEnabled(): Promise<boolean> {
  const { data, error } = await supabase.rpc('version_auditoria_panel');
  if (error?.code === 'PGRST202') return false;
  if (error) throw new Error('No se pudo comprobar el registro de accesos. Inténtalo de nuevo.');
  return data === 2;
}
