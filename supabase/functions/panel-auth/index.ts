import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.2';
import { handlePanelLogin } from './handler.ts';
import { ipCliente } from '../_shared/ip-cliente.ts';

Deno.serve(async (req: Request) => {
  const info = req.headers.get('x-client-info')?.split('/') ?? [];
  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: {
      'x-audit-source': 'panel-auth', 'x-audit-request-id': crypto.randomUUID(),
      'x-audit-user-agent': req.headers.get('user-agent')?.slice(0, 1024) ?? '',
      'x-audit-device-id': info[0] === 'adminpanel' ? (info[1] ?? '').slice(0, 128) : '',
      // cf-connecting-ip o ÚLTIMO salto de XFF: el límite por IP de
      // iniciar_intento_panel no se puede esquivar rotando X-Forwarded-For (CT-REM-FN-03).
      'x-audit-ip': ipCliente(req),
    } },
  });
  const auth = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return handlePanelLogin(req, {
    async begin(email, route) {
      const { data, error } = await admin.rpc('iniciar_intento_panel', { p_email: email, p_ruta: route });
      if (error || !data?.id) throw new Error('audit unavailable');
      return data;
    },
    async finish(id, actor, result, sessionId) {
      const { error } = await admin.rpc('finalizar_intento_panel', { p_id: id, p_actor: actor, p_resultado: result, p_session_id: sessionId });
      if (error) throw new Error('audit unavailable');
    },
    signIn: (email, password) => auth.auth.signInWithPassword({ email, password }),
    async revoke(token) { await admin.auth.admin.signOut(token, 'local'); },
  });
});
