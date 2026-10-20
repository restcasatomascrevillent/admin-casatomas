import { describe, expect, it, vi } from 'vitest';
import { handlePanelLogin, type LoginDependencies } from '../../../supabase/functions/panel-auth/handler';
const request = (body = { email: 'User@test.local', password: 'private-password' }) => new Request('https://edge.test/panel-auth', { method: 'POST', body: JSON.stringify(body) });
function deps(): LoginDependencies {
  return { begin: vi.fn().mockResolvedValue({ id: 'attempt', permitido: true }),
    finish: vi.fn().mockResolvedValue(undefined), revoke: vi.fn().mockResolvedValue(undefined),
    signIn: vi.fn().mockResolvedValue({ data: { user: { id: 'verified-user' }, session: { access_token: 'issued', refresh_token: 'refresh' } }, error: null }) };
}
describe('gateway de acceso auditado', () => {
  it('persiste un intento antes de comprobar la contraseña y resuelve una sola fila', async () => {
    const d = deps(); const response = await handlePanelLogin(request(), d);
    expect(response.status).toBe(200);
    expect(d.begin).toHaveBeenCalledWith('user@test.local', '/auth');
    expect(vi.mocked(d.begin).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(d.signIn).mock.invocationCallOrder[0]);
    expect(d.finish).toHaveBeenCalledWith('attempt', 'verified-user', 'correcto', null);
    expect(JSON.stringify(vi.mocked(d.finish).mock.calls)).not.toContain('private-password');
  });
  it('correo inventado o contraseña errónea queda sin atribuir al titular', async () => {
    const d = deps(); vi.mocked(d.signIn).mockResolvedValue({ data: { session: null, user: null }, error: { status: 400 } });
    expect((await handlePanelLogin(request(), d)).status).toBe(401);
    expect(d.finish).toHaveBeenCalledWith('attempt', null, 'credenciales_invalidas', null);
  });
  it('un fallo de auditoría previo no llega a validar credenciales', async () => {
    const d = deps(); vi.mocked(d.begin).mockRejectedValue(new Error('db down'));
    const response = await handlePanelLogin(request(), d);
    expect(response.status).toBe(503); expect(d.signIn).not.toHaveBeenCalled();
  });
  it('un fallo de auditoría final no entrega tokens y revoca la sesión emitida', async () => {
    const d = deps(); vi.mocked(d.finish).mockRejectedValue(new Error('db down'));
    const response = await handlePanelLogin(request(), d);
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('refresh');
    expect(d.revoke).toHaveBeenCalledWith('issued');
  });
  it('un fallo de Auth queda separado de credenciales inválidas', async () => {
    const d = deps(); vi.mocked(d.signIn).mockRejectedValue(new Error('offline'));
    expect((await handlePanelLogin(request(), d)).status).toBe(503);
    expect(d.finish).toHaveBeenCalledWith('attempt', null, 'error_servicio', null);
  });
  it('el límite del servidor detiene la autenticación y devuelve 429', async () => {
    const d = deps(); vi.mocked(d.begin).mockResolvedValue({ id: 'attempt', permitido: false });
    expect((await handlePanelLogin(request(), d)).status).toBe(429); expect(d.signIn).not.toHaveBeenCalled();
  });
  it('ignora identidades y dispositivos ficticios del body', async () => {
    const d = deps(); await handlePanelLogin(new Request('https://edge.test/panel-auth', { method: 'POST', body: JSON.stringify({ email: 'user@test.local', password: 'pw', actor: 'victim', device_id: 'fake', ruta: '/super-admin/login' }) }), d);
    expect(d.finish).toHaveBeenCalledWith('attempt', 'verified-user', 'correcto', null);
    expect(d.begin).toHaveBeenCalledWith('user@test.local', '/super-admin/login');
  });
});
