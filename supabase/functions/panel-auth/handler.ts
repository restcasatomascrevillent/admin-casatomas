type AuthResult = { data: { session: { access_token: string; refresh_token: string; [key: string]: unknown } | null; user: { id: string } | null }; error: { status?: number } | null };
export interface LoginDependencies {
  begin(email: string, route: string): Promise<{ id: string; permitido: boolean }>;
  finish(id: string, actor: string | null, result: string, sessionId: string | null): Promise<void>;
  signIn(email: string, password: string): Promise<AuthResult>;
  revoke(token: string): Promise<void>;
}
const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store' };
const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers });

// El intento se persiste ANTES de comprobar credenciales. Solo se entregan
// tokens después de confirmar la escritura del resultado en auditoría.
export async function handlePanelLogin(req: Request, deps: LoginDependencies): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return reply(405, { error: 'Método no permitido' });
  if (Number(req.headers.get('content-length') || 0) > 8192) return reply(413, { error: 'Petición demasiado grande' });
  const raw = await req.text();
  if (raw.length > 8192) return reply(413, { error: 'Petición demasiado grande' });
  let body: Record<string, unknown> = {};
  try { const value = JSON.parse(raw); if (value && typeof value === 'object') body = value; } catch { /* se registra el intento inválido */ }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 255) : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const route = body.ruta === '/super-admin/login' ? body.ruta : '/auth';
  let attempt: { id: string; permitido: boolean };
  try { attempt = await deps.begin(email, route); }
  catch { return reply(503, { error: 'No se pudo registrar el acceso. Inténtalo de nuevo.' }); }
  if (!attempt.permitido) return reply(429, { error: 'Demasiados intentos. Espera un minuto y vuelve a intentarlo.' });
  let issuedToken: string | undefined;
  try {
    if (!email || !password || password.length > 4096) {
      await deps.finish(attempt.id, null, 'peticion_invalida', null);
      return reply(400, { error: 'Introduce un email y una contraseña válidos.' });
    }
    let result: AuthResult;
    try { result = await deps.signIn(email, password); }
    catch {
      await deps.finish(attempt.id, null, 'error_servicio', null);
      return reply(503, { error: 'No se pudo comprobar el acceso. Inténtalo de nuevo.' });
    }
    if (result.error || !result.data.session || !result.data.user) {
      const unavailable = (result.error?.status ?? 0) >= 500;
      await deps.finish(attempt.id, null, unavailable ? 'error_servicio' : 'credenciales_invalidas', null);
      return reply(unavailable ? 503 : 401, { error: unavailable ? 'Servicio temporalmente no disponible.' : 'Email o contraseña incorrectos.' });
    }
    issuedToken = result.data.session.access_token;
    // Este JWT procede de Auth tras signInWithPassword, no del cuerpo del cliente.
    let sessionId: string | null = null;
    try { sessionId = JSON.parse(atob(issuedToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).session_id ?? null; } catch { /* proveedor sin session_id */ }
    await deps.finish(attempt.id, result.data.user.id, 'correcto', sessionId);
    return reply(200, { session: result.data.session, user: result.data.user });
  } catch {
    if (issuedToken) await deps.revoke(issuedToken).catch(() => {});
    // Permanece el intento pendiente si no se pudo escribir el resultado.
    return reply(503, { error: 'No se pudo completar el registro del acceso. Inténtalo de nuevo.' });
  }
}
