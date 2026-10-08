import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db = new PGlite();
const admin = '10000000-0000-0000-0000-000000000001';
const target = '20000000-0000-0000-0000-000000000002';
const deleted = '30000000-0000-0000-0000-000000000003';
let checks = 0;
const check = (value, expected, name) => { assert.deepEqual(value, expected, name); checks++; };
const sql = (s, p) => db.query(s, p);
const last = async () => (await sql('select * from public.audit_log order by created_at desc, id desc limit 1')).rows[0];
await db.exec(`
 create role anon; create role authenticated; create role service_role bypassrls;
 create role supabase_auth_admin superuser;
 create schema auth;
 create table auth.users (id uuid primary key, email text);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor', true), '')::uuid $$;
 create function auth.role() returns text language sql stable as $$ select nullif(current_setting('test.role', true), '') $$;
 create table public.user_roles (id uuid default gen_random_uuid() primary key, user_id uuid references auth.users(id) on delete cascade, role text);
 create table public.user_permissions (id uuid default gen_random_uuid() primary key, user_id uuid references auth.users(id) on delete cascade, section_key text);
 create table public.super_admins (id uuid default gen_random_uuid() primary key, user_id uuid);
 ${['admin_feature_toggles','sell_users','configuracion_reservas','configuracion_web','configBotWeb','chat_web_config','gdpr_config','dashboard_config','phone_system_config','user_role_presets'].map(t=>`create table public."${t}" (id uuid default gen_random_uuid() primary key, user_id uuid, value text);`).join('\n')}
 insert into auth.users values ('${admin}', 'admin@staff.local');
`);
for (const name of ['20261007120000_audit_log.sql','20261007140000_audit_log_actor_fallback.sql']) {
 await db.exec(await readFile(`supabase/migrations/${name}`, 'utf8'));
}
await db.exec(`
 insert into public.audit_log (actor_user_id, accion) values ('${admin}', 'crear');
 insert into public.audit_log (actor_user_id, actor_email, accion) values ('${deleted}', 'old@staff.local', 'crear');
 insert into public.audit_log (actor_user_id, actor_email, accion) values ('${deleted}', ' ', 'actualizar');
 insert into public.audit_log (accion) values ('crear');
`);
await db.exec(await readFile('supabase/migrations/20261007190000_audit_log_identidad_obligatoria.sql', 'utf8'));
check((await sql('select actor_label from public.audit_log where actor_user_id=$1', [admin])).rows[0].actor_label, 'admin@staff.local', 'recover known user');
check((await sql('select actor_label from public.audit_log where actor_user_id=$1 and accion=\'actualizar\'', [deleted])).rows[0].actor_label, 'old@staff.local', 'recover deleted user from existing trace');
const historical = (await sql("select * from public.audit_log where actor_origin='historico'")).rows[0];
check(historical.actor_label, `Registro histórico · ${historical.id}`, 'unknown historical actor is not fabricated');
check((await sql("select has_function_privilege('authenticated', 'public.preparar_contexto_auditoria_auth(uuid,text,uuid,text)', 'EXECUTE') allowed")).rows[0].allowed, false, 'normal users cannot supply privileged actor context');
await db.exec(`set test.actor='${admin}'; set test.role='authenticated'; set request.headers='{"x-audit-actor-id":"${deleted}"}';
 insert into public.configuracion_web(value) values ('login-user');`);
check((await last()).actor_user_id, admin, 'authenticated actor cannot be replaced by a header');
await sql("insert into public.audit_log (actor_user_id, actor_email, actor_label, accion) values ($1, 'spoof@staff.local', 'fake', 'login')", [deleted]);
check((await last()).actor_label, 'admin@staff.local', 'access email and user id resolved on server');
await db.exec(`set test.actor=''; set test.role='service_role'; set request.headers='{"x-audit-actor-id":"${admin}","x-audit-actor-email":"fake@staff.local"}';
 insert into public.configuracion_web(value) values ('edge');`);
check((await last()).actor_label, 'admin@staff.local', 'service role resolves canonical actor by verified UUID');
await db.exec(`set request.headers='{"x-audit-source":"automatic-task"}'; insert into public.configuracion_web(value) values ('auto');`);
check((await last()).actor_label, 'API · service_role · automatic-task', 'automatic service origin');
await db.exec(`set test.role='anon'; set request.headers='{"x-audit-actor-id":"${admin}"}'; insert into public.configuracion_web(value) values ('anon');`);
check((await last()).actor_user_id, null, 'anonymous headers ignored');
await db.exec(`set test.role=''; set request.headers=''; insert into public.configuracion_web(value) values ('sql');`);
check((await last()).actor_label, 'Base de datos · postgres', 'SQL session origin');

// Reproduce GoTrue creating defaults in its separate SQL connection.
const context = (await sql('select public.preparar_contexto_auditoria_auth($1, $2, null, $3) id', [admin, 'crear', 'new@staff.local'])).rows[0].id;
await db.exec(`create function public.test_defaults() returns trigger language plpgsql security definer as $$ begin insert into public.user_roles(user_id, role) values (NEW.id, 'staff'); return NEW; end $$;
 create trigger test_defaults after insert on auth.users for each row execute function public.test_defaults();
 set session authorization supabase_auth_admin;
 insert into auth.users values ('${target}', 'new@staff.local');
 reset session authorization;`);
check((await sql('select actor_user_id from public.audit_log where tabla=\'user_roles\' and accion=\'crear\' order by created_at desc limit 1')).rows[0].actor_user_id, admin, 'GoTrue defaults keep initiating admin');
await sql('delete from public.audit_auth_context where id=$1', [context]);
await sql('select public.preparar_contexto_auditoria_auth($1, $2, $3, null)', [admin, 'eliminar', target]);
await db.exec(`set session authorization supabase_auth_admin; delete from auth.users where id='${target}'; reset session authorization;`);
check((await sql('select actor_user_id from public.audit_log where tabla=\'user_roles\' and accion=\'eliminar\' order by created_at desc limit 1')).rows[0].actor_user_id, admin, 'GoTrue cascades keep initiating admin even after subject is deleted');
await sql('delete from public.audit_auth_context');
await sql('select public.preparar_contexto_auditoria_auth($1, $2, null, $3)', [admin, 'crear', 'expired@staff.local']);
await db.exec("update public.audit_auth_context set expires_at=clock_timestamp()-interval '1 second'");
await db.exec(`set session authorization supabase_auth_admin; insert into auth.users values ('40000000-0000-0000-0000-000000000004', 'expired@staff.local'); reset session authorization;`);
check((await sql('select actor_user_id from public.audit_log where tabla=\'user_roles\' and accion=\'crear\' order by created_at desc limit 1')).rows[0].actor_user_id, null, 'expired context cannot attribute another operation');
check((await sql("select count(*)::int n from public.audit_log where actor_label is null or btrim(actor_label)='' or actor_origin is null")).rows[0].n, 0, 'no new or historical rows with empty identity');
await db.exec(await readFile('supabase/migrations/20261007200000_audit_log_limpiar_y_exigir_identidad.sql', 'utf8'));
check((await sql('select count(*)::int n from public.audit_log')).rows[0].n, 0, 'owner-requested cleanup removes all audit rows');

async function reject(statement, name) {
  let failed = false;
  try { await db.exec(statement); } catch { failed = true; }
  check(failed, true, name);
}
await db.exec(`set test.actor=''; set test.role='service_role'; set request.headers='';`);
await reject("insert into public.configuracion_web(value) values ('unidentified-service')", 'missing service actor/source aborts the original operation');
check((await sql("select count(*)::int n from public.configuracion_web where value='unidentified-service'")).rows[0].n, 0, 'unauditable mutation is rolled back');
await db.exec(`set request.headers='{"x-audit-source":"admin-create-user"}';`);
await reject("insert into public.configuracion_web(value) values ('admin-without-actor')", 'manual admin source cannot substitute for the human actor');
await db.exec(`set test.role='anon'; set request.headers='{"x-audit-actor-id":"${admin}"}';`);
await reject("insert into public.configuracion_web(value) values ('anonymous')", 'anonymous mutation is rejected even with actor header');
await db.exec(`set test.role='authenticated'; set request.headers='';`);
await reject("insert into public.configuracion_web(value) values ('invalid-session')", 'authenticated role without UUID is rejected');
await db.exec(`set test.actor='${deleted}';`);
await reject("insert into public.configuracion_web(value) values ('nonexistent-actor')", 'nonexistent actor UUID is rejected');
await db.exec(`set test.actor=''; set test.role=''; set session authorization supabase_auth_admin;`);
await reject("insert into auth.users values ('50000000-0000-0000-0000-000000000005', 'missing-context@staff.local')", 'GoTrue without context cannot create unattributed defaults');
await db.exec('reset session authorization');
check((await sql("select count(*)::int n from auth.users where email='missing-context@staff.local'")).rows[0].n, 0, 'Auth user creation also rolls back');
await db.exec(`set test.actor='${admin}'; set test.role='authenticated';`);
await sql("insert into public.configuracion_web(value) values ('identified-user')");
check((await last()).actor_user_id, admin, 'authenticated mutations retain the verified actor');
await db.exec(`set test.actor=''; set test.role='service_role'; set request.headers='{"x-audit-source":"nightly-sync"}';`);
await sql("insert into public.configuracion_web(value) values ('identified-service')");
check((await last()).actor_label, 'API · service_role · nightly-sync', 'identified automatic process remains permitted');
await reject("insert into public.audit_log (accion) values ('login')", 'process account cannot record a user login');
await db.exec(`set test.role=''; set request.headers='';`);
await sql('delete from public.audit_auth_context');
await sql('select public.preparar_contexto_auditoria_auth($1, $2, null, $3)', [admin, 'crear', 'verified@staff.local']);
await db.exec(`set session authorization supabase_auth_admin; insert into auth.users values ('60000000-0000-0000-0000-000000000006', 'verified@staff.local'); reset session authorization;`);
check((await sql('select actor_user_id from public.audit_log where tabla=\'user_roles\' and accion=\'crear\' order by created_at desc limit 1')).rows[0].actor_user_id, admin, 'GoTrue with verified context works under the strict policy');
await sql('delete from public.audit_auth_context');
await sql('select public.preparar_contexto_auditoria_auth($1, $2, $3, null)', [admin, 'eliminar', '60000000-0000-0000-0000-000000000006']);
await db.exec(`set session authorization supabase_auth_admin; delete from auth.users where id='60000000-0000-0000-0000-000000000006'; reset session authorization;`);
check((await sql('select actor_user_id from public.audit_log where tabla=\'user_roles\' and accion=\'eliminar\' order by created_at desc limit 1')).rows[0].actor_user_id, admin, 'verified Auth deletion remains permitted');
check((await sql("select count(*)::int n from public.audit_log where actor_origin='historico' or actor_label is null or btrim(actor_label)='' ")).rows[0].n, 0, 'strict policy never produces blank or historical identities');
// Casos de negocio de permisos, además de los controles de identidad.
await db.exec(`alter table public.user_permissions add column can_view boolean not null default false;
 alter table public.user_permissions add column can_edit boolean not null default false;
 alter table public.user_permissions add column created_at timestamptz default now();
 alter table public.user_permissions add column updated_at timestamptz default now();
 alter table public.user_permissions add constraint permissions_user_section_unique unique(user_id, section_key);`);
await sql("insert into public.audit_log (actor_user_id, accion, tabla, detalles) values ($1, 'crear', 'user_permissions', $2)",
 [admin, JSON.stringify({ despues: { id: 'legacy-row', user_id: admin, section_key: 'legacy', can_view: true, can_edit: false } })]);
const legacyId = (await last()).id;
await db.exec(await readFile('supabase/migrations/20261007210000_audit_log_cambios_permisos.sql', 'utf8'));
const legacy = (await sql('select * from public.audit_log where id=$1', [legacyId])).rows[0];
check(legacy.accion, 'actualizar', 'previous permission INSERT is reclassified as an access change');
check(legacy.actor_user_id, admin, 'backfill preserves original actor');
check(legacy.detalles.permiso_antes.can_view, false, 'previous permission grant gains effective denied baseline');
check(legacy.detalles.despues.id, 'legacy-row', 'backfill keeps physical snapshot');
await db.exec(`set test.actor='${admin}'; set test.role='authenticated'; set request.headers='';`);
const count = async () => (await sql('select count(*)::int n from public.audit_log')).rows[0].n;
await sql('insert into public.user_permissions(user_id,section_key,can_view,can_edit) values($1,$2,true,false)', [admin,'reservas']);
check((await last()).accion, 'actualizar', 'granting a missing permission is a change, never user creation');
check((await last()).detalles.operacion_permiso, 'conceder', 'grant operation retained');
check((await last()).detalles.permiso_antes.can_view, false, 'new grant before effective state denied');
check((await last()).detalles.permiso_despues.can_view, true, 'new grant after effective state allowed');
let baseline = await count();
await sql('insert into public.user_permissions(user_id,section_key,can_view,can_edit,updated_at) values($1,$2,true,false,clock_timestamp()) on conflict(user_id,section_key) do update set can_view=excluded.can_view,can_edit=excluded.can_edit,updated_at=excluded.updated_at', [admin,'reservas']);
check(await count(), baseline, 'saving an unchanged permission writes no audit event');
await sql('update public.user_permissions set can_edit=true, updated_at=clock_timestamp() where user_id=$1 and section_key=$2', [admin,'reservas']);
check(await count(), baseline+1, 'changing edit permission writes exactly one event');
check((await last()).accion, 'actualizar', 'edit privilege mutation is a change');
await sql('delete from public.user_permissions where user_id=$1 and section_key=$2', [admin,'reservas']);
check((await last()).accion, 'actualizar', 'removing a permission is a change, not deleting the user');
check((await last()).detalles.permiso_despues.can_view, false, 'revocation after effective state denied');
baseline = await count();
await sql('insert into public.user_permissions(user_id,section_key,can_view,can_edit) values($1,$2,false,false)', [admin,'disabled']);
check(await count(), baseline, 'materializing denied row does not change access');
await sql('delete from public.user_permissions where user_id=$1 and section_key=$2', [admin,'disabled']);
check(await count(), baseline, 'removing already denied row does not change access');
await sql("insert into public.configuracion_web(value) values ('true-creation')");
check((await last()).accion, 'crear', 'actual creation outside permissions keeps its creation label');
const webId = (await last()).registro_id;
baseline = await count();
await sql('update public.configuracion_web set value=value where id=$1',[webId]);
check(await count(), baseline, 'unchanged generic update also generates no event');
await db.exec(`set test.actor=''; set test.role='service_role'; set request.headers='';`);
await reject(`insert into public.user_permissions(user_id,section_key,can_view) values ('${admin}', 'unaudited', true)`, 'permission grant without actor still rejected');
await db.exec(`set test.role=''; set request.headers='';`);
await sql('delete from public.audit_auth_context');
await sql('select public.preparar_contexto_auditoria_auth($1, $2, null, $3)', [admin, 'crear', 'new-permission-test@staff.local']);
await db.exec(`create or replace function public.test_defaults() returns trigger language plpgsql security definer as $$ begin
 insert into public.user_roles(user_id, role) values (NEW.id, 'staff');
 insert into public.user_permissions(user_id, section_key, can_view, can_edit) values (NEW.id, 'dashboard', true, false);
 return NEW; end $$;
 set session authorization supabase_auth_admin;
 insert into auth.users values ('70000000-0000-0000-0000-000000000007', 'new-permission-test@staff.local');
 reset session authorization;`);
const createdPerm = (await sql("select * from public.audit_log where tabla='user_permissions' and detalles->'despues'->>'user_id'=$1 order by created_at desc limit 1", ['70000000-0000-0000-0000-000000000007'])).rows[0];
check(createdPerm.actor_user_id, admin, 'semantic classification preserves GoTrue creation context');
check(createdPerm.accion, 'actualizar', 'new user permission assignment is an access change');
await sql('delete from public.audit_auth_context');
await sql('select public.preparar_contexto_auditoria_auth($1, $2, $3, null)', [admin, 'eliminar', '70000000-0000-0000-0000-000000000007']);
await db.exec(`set session authorization supabase_auth_admin; delete from auth.users where id='70000000-0000-0000-0000-000000000007'; reset session authorization;`);
const removedPerm = (await sql("select * from public.audit_log where tabla='user_permissions' and detalles->'antes'->>'user_id'=$1 order by created_at desc limit 1", ['70000000-0000-0000-0000-000000000007'])).rows[0];
check(removedPerm.actor_user_id, admin, 'semantic classification preserves GoTrue deletion context');
check((await sql("select count(*)::int n from public.audit_log where tabla='user_permissions' and accion<>'actualizar'")).rows[0].n, 0, 'permissions never produce creation or user-deletion events');


await db.exec(
  "alter table auth.users add column encrypted_password text; alter table auth.users add column last_sign_in_at timestamptz;"+
  "create schema storage; create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);"+
  "create table public.\"Platos\"(id bigint primary key,nombre text,precio numeric,updated_at timestamptz);"+
  "create table public.reservas(id bigint primary key,estado text);"+
  "create table public.facturas(id bigint primary key,importe numeric);"+
  "create table public.cheques_regalo(id bigint primary key,canjeado boolean);"+
  "create table public.asignaciones_mesa(id bigint primary key,reserva_id bigint,mesa_id bigint);"+
  "create table public.profiles(id uuid primary key references auth.users(id) on delete cascade,nombre text);"+
  "create table public.documentos_usuario(id bigint primary key,propietario uuid references auth.users(id) on delete cascade);"+
  "create table public.configuracion_compuesta(sitio text,idioma text,valor text,primary key(sitio,idioma));"
);
await db.exec(await readFile('supabase/migrations/20261007213000_audit_preparar_servidor.sql','utf8'));
await db.exec(await readFile('supabase/migrations/20261007220000_audit_log_panel_completo.sql','utf8'));
await db.exec("set test.actor='"+admin+"'; set test.role='authenticated'; set request.headers='{\"x-audit-request-id\":\"request-panel\"}';");
for(const [table,columns,values,mutation] of [
 ['Platos','id,nombre,precio',"1,'Plato',10","precio=12"],
 ['reservas','id,estado',"1,'pendiente'","estado='confirmada'"],
 ['facturas','id,importe','1,100','importe=120'],
 ['cheques_regalo','id,canjeado','1,false','canjeado=true']
]) {
 await sql('insert into public."'+table+'"('+columns+') values('+values+')');
 let entry=(await sql('select * from public.audit_log where tabla=$1 order by created_at desc,id desc limit 1',[table])).rows[0];
 check(entry.accion,'crear',table+' actual entity creation');
 check(entry.actor_user_id,admin,table+' creation actor');
 await sql('update public."'+table+'" set '+mutation+' where id=1');
 entry=(await sql('select * from public.audit_log where tabla=$1 order by created_at desc,id desc limit 1',[table])).rows[0];
 check(entry.accion,'actualizar',table+' update');
 check(entry.detalles.request_id,'request-panel',table+' request linkage');
 const beforeCount=await count();
 await sql('update public."'+table+'" set id=id where id=1');
 check(await count(),beforeCount,table+' no phantom no-op');
 await sql('delete from public."'+table+'" where id=1');
 entry=(await sql('select * from public.audit_log where tabla=$1 order by created_at desc,id desc limit 1',[table])).rows[0];
 check(entry.accion,'eliminar',table+' deletion');
 check(entry.actor_user_id,admin,table+' deletion actor');
}
await sql("insert into public.asignaciones_mesa values(1,8,9)");
check((await last()).accion,'actualizar','assignment is a business change');
check((await last()).detalles.operacion_asignacion,'asignar','assignment operation');
await sql("insert into public.configuracion_compuesta values('web','es','a')");
check(JSON.parse((await last()).registro_id),{sitio:'web',idioma:'es'},'composite primary key identifies entity');
check((await sql("select public.fn_audit_sanitizar($1::jsonb) clean",[JSON.stringify({password:'private',nested:{api_key:'secret',name:'ok'},list:[{access_token:'hidden'}]})])).rows[0].clean,
 {password:'[oculto]',nested:{api_key:'[oculto]',name:'ok'},list:[{access_token:'[oculto]'}]},'recursive secret redaction');
await sql("insert into storage.objects(bucket_id,name) values('platos','foto.png')");
check((await last()).tabla,'storage.objects','file uploads audited');
check((await last()).actor_user_id,admin,'file upload initiator');
await db.exec("set test.actor=''; set test.role='service_role'; set request.headers='';");
await reject("insert into public.reservas values(2,'pendiente')",'unidentified service cannot mutate newly covered table');
await db.exec("set request.headers='{\"x-audit-source\":\"ocr-trabajo\"}';");
await sql('insert into public.facturas values(2,300)');
check((await last()).actor_label,'API · service_role · ocr-trabajo','identified worker origin');
await db.exec("set request.headers='{\"x-audit-source\":\"procesar-factura\",\"x-audit-actor-id\":\""+admin+"\",\"x-audit-request-id\":\"rpc-request\"}';");
await sql("select public.registrar_accion_auditoria_panel('correo/prueba',$1::jsonb)",[JSON.stringify({resultado:'completada',codigo_http:200,password:'not-kept'})]);
check((await last()).actor_user_id,admin,'external action canonical user');
check((await last()).accion,'ejecutar','external actions are not misrepresented as data changes');
check((await last()).detalles.request_id,'rpc-request','external action correlated');
check((await last()).detalles.password,undefined,'external action discards unapproved body fields');
await db.exec("set test.actor='"+admin+"'; set test.role='authenticated';");
await reject("select public.registrar_accion_auditoria_panel('fake','{}')",'client cannot forge privileged action');
await sql('insert into public.super_admins(user_id) values($1)',[admin]);
const coverage=(await sql('select * from public.listar_tablas_auditoria_panel()')).rows.map(x=>x.tabla);
for(const table of ['Platos','reservas','facturas','cheques_regalo','storage.objects','auth.users','acciones_servidor'])check(coverage.includes(table),true,'filter includes '+table);
await db.exec("set test.actor=''; set test.role=''; set request.headers='';");
await sql('delete from public.audit_auth_context');
const authTarget='80000000-0000-0000-0000-000000000008';
await sql('select public.preparar_contexto_auditoria_auth($1,$2,null,$3)',[admin,'crear','full-auth@staff.local']);
await db.exec("set session authorization supabase_auth_admin; insert into auth.users(id,email,encrypted_password) values('"+authTarget+"','full-auth@staff.local','never-show-hash'); reset session authorization;");
const newUser=(await sql("select * from public.audit_log where tabla='auth.users' and registro_id=$1 order by created_at desc,id desc limit 1",[authTarget])).rows[0];
check(newUser.accion,'crear','only actual user creation labeled creation');
check(newUser.actor_user_id,admin,'Auth root keeps creator');
check(JSON.stringify(newUser.detalles).includes('never-show-hash'),false,'Auth hash never persisted');
await db.exec("set test.actor='"+admin+"'; set test.role='authenticated';");
await sql('insert into public.profiles values($1,$2)',[authTarget,'Perfil']);
await sql('insert into public.documentos_usuario values(1,$1)',[authTarget]);
await db.exec("set test.actor=''; set test.role='';");
await sql('delete from public.audit_auth_context');
await sql('select public.preparar_contexto_auditoria_auth($1,$2,$3,null)',[admin,'actualizar',authTarget]);
await db.exec("set session authorization supabase_auth_admin; update auth.users set encrypted_password='new-hash' where id='"+authTarget+"'; reset session authorization;");
const password=(await sql("select * from public.audit_log where tabla='auth.users' and accion='actualizar' order by created_at desc,id desc limit 1")).rows[0];
check(password.actor_user_id,admin,'password initiator');
check(password.detalles.credenciales_actualizadas,true,'password change is recorded without secrets');
check(JSON.stringify(password.detalles).includes('new-hash'),false,'new password hash never persisted');
baseline=await count();
await db.exec("set session authorization supabase_auth_admin; update auth.users set last_sign_in_at=now() where id='"+authTarget+"'; reset session authorization;");
check(await count(),baseline,'token/session housekeeping not a credential change');
await sql('delete from public.audit_auth_context');
await sql('select public.preparar_contexto_auditoria_auth($1,$2,$3,null)',[admin,'eliminar',authTarget]);
await db.exec("set session authorization supabase_auth_admin; delete from auth.users where id='"+authTarget+"'; reset session authorization;");
for(const table of ['auth.users','profiles','documentos_usuario']) {
 const removed=(await sql('select * from public.audit_log where tabla=$1 and accion=\'eliminar\' order by created_at desc,id desc limit 1',[table])).rows[0];
 check(removed.actor_user_id,admin,table+' cascade initiator retained');
}
await db.exec("set test.actor='"+admin+"'; set test.role='authenticated'; set request.headers=''; create table public.nueva_tabla(id int primary key,valor text);");
await sql("insert into public.nueva_tabla values(1,'covered')");
check((await last()).tabla,'nueva_tabla','new tables are audited automatically, without a manual install');
check((await sql("select count(*)::int n from public.audit_log where actor_label is null or btrim(actor_label)='' or actor_origin='historico'")).rows[0].n,0,'all events identified across every entry point');
// Accesos desde todos los dispositivos: intentos y usuarios no se confunden.
await db.exec("set test.actor=''; set test.role=''; set request.headers='';");
await db.exec(await readFile('supabase/migrations/20261008080000_audit_accesos_dispositivos.sql','utf8'));
const requestHeaders = { 'x-audit-source':'panel-auth', 'x-audit-request-id':'login-request-1',
 'x-audit-device-id':'phone-1', 'x-audit-user-agent':'iPhone Safari', 'x-audit-ip':'203.0.113.25' };
await sql("select set_config('request.headers',$1,false)",[JSON.stringify(requestHeaders)]);
await db.exec("set test.role='service_role';");
const attempt = (await sql("select public.iniciar_intento_panel('unknown@staff.local','/auth') data")).rows[0].data;
check(attempt.permitido,true,'unknown account attempt recorded before authenticating');
let event=(await sql('select * from public.audit_log where id=$1',[attempt.id])).rows[0];
check(event.actor_user_id,null,'attempt never borrows account UUID');
check(event.actor_origin,'intento','explicit unverified identity');
check(event.device_id,'phone-1','attempt stores device');
check(event.ip_address,'203.0.113.25','attempt stores transport IP');
check(event.accion,'intento_login','pending outcome not falsely successful');
await sql('select public.finalizar_intento_panel($1,null,$2,null)',[attempt.id,'credenciales_invalidas']);
event=(await sql('select * from public.audit_log where id=$1',[attempt.id])).rows[0];
check(event.accion,'login_fallido','unknown email failed attempt retained');
check(event.actor_email,null,'unverified email is not a verified actor_email');
check((await sql('select count(*)::int n from public.audit_log where id=$1',[attempt.id])).rows[0].n,1,'one row per attempt/result');
await reject(`select public.finalizar_intento_panel('${attempt.id}','${admin}','correcto',null)`,'completed attempt cannot be overwritten');
const known=(await sql("select public.iniciar_intento_panel('admin@staff.local','/auth') data")).rows[0].data;
await sql('select public.finalizar_intento_panel($1,null,$2,null)',[known.id,'credenciales_invalidas']);
check((await sql('select actor_user_id from public.audit_log where id=$1',[known.id])).rows[0].actor_user_id,null,'wrong password for a known email still not attributed to owner');
const ok=(await sql("select public.iniciar_intento_panel('admin@staff.local','/auth') data")).rows[0].data;
await sql('select public.finalizar_intento_panel($1,$2,$3,$4)',[ok.id,admin,'correcto','session-phone']);
event=(await sql('select * from public.audit_log where id=$1',[ok.id])).rows[0];
check(event.accion,'login','verified access finalizes same attempt');
check(event.actor_email,'admin@staff.local','canonical verified email retained');
check(event.session_id,'session-phone','auth session linked');
const mismatch=(await sql("select public.iniciar_intento_panel('someone@staff.local','/auth') data")).rows[0].data;
await reject(`select public.finalizar_intento_panel('${mismatch.id}','${admin}','correcto',null)`,'unrelated account cannot finalize attempt');
await db.exec("set test.role='authenticated'; set test.actor='"+admin+"';");
await reject("select public.iniciar_intento_panel('fake@staff.local','/auth')",'browser cannot fabricate trusted login attempts');
check((await sql("select has_function_privilege('anon','public.iniciar_intento_panel(text,text)','EXECUTE') allowed")).rows[0].allowed,false,'anonymous public cannot invoke trusted gateway RPC');
check((await sql("select has_function_privilege('authenticated','public.finalizar_intento_panel(uuid,uuid,text,text)','EXECUTE') allowed")).rows[0].allowed,false,'user cannot forge login success');
await db.exec(`set request.headers='{"x-client-info":"adminpanel/laptop-2/request-laptop","user-agent":"Windows Chrome","x-forwarded-for":"203.0.113.26","x-audit-actor-id":"${target}"}'; set request.jwt.claims='{"session_id":"session-laptop"}';`);
await sql("select public.registrar_acceso_panel('acceso','/dashboard?secret=remove')");
event=await last();
check(event.actor_user_id,admin,'restored session identity is resolved on server');
check(event.device_id,'laptop-2','second device remains distinct from phone');
check(event.session_id,'session-laptop','second device keeps its session');
check(event.detalles.ruta,'/dashboard','access never retains query-string secrets');
await sql("select public.registrar_acceso_panel('acceso_denegado','/super-admin')");
check((await last()).accion,'acceso_denegado','denied access visible for verified user');
await reject("select public.registrar_acceso_panel('crear','/')",'access RPC cannot fabricate mutation');
await sql("insert into public.nueva_tabla values(2,'device metadata')");
check((await last()).device_id,'laptop-2','mutations also carry device context');
await db.exec("set test.actor=''; set test.role='service_role';");
await sql("select set_config('request.headers',$1,false)",[JSON.stringify({...requestHeaders,'x-audit-request-id':'limited','x-audit-ip':'203.0.113.99'})]);
for(let i=0;i<30;i++) await sql("select public.iniciar_intento_panel('attempt@staff.local','/auth')");
const limited=(await sql("select public.iniciar_intento_panel('attempt@staff.local','/auth') data")).rows[0].data;
check(limited.permitido,false,'server rate limit blocks more than 30 attempts/minute');
check((await sql('select accion from public.audit_log where id=$1',[limited.id])).rows[0].accion,'login_fallido','rate-limited attempts remain visible');
check((await sql("select count(*)::int n from public.audit_log where actor_label is null or btrim(actor_label)='' ")).rows[0].n,0,'no blank identities after attempted or completed access');
await db.exec("set test.actor='"+admin+"'; set test.role='authenticated'; set request.headers='';");
await sql('insert into public.super_admins(user_id) values($1)',[admin]);
const vapi=(await sql('select public.auditar_prompt_vapi() id')).rows[0].id;
await sql("select public.auditar_prompt_vapi($1,'completada')",[vapi]);
check((await sql('select detalles from public.audit_log where id=$1',[vapi])).rows[0].detalles.resultado,'completada','external VAPI action retains outcome');
await reject(`select public.auditar_prompt_vapi('${vapi}','fallida')`,'external action cannot be finalized twice');
check((await sql('select public.version_auditoria_panel() version')).rows[0].version,2,'readiness is enabled only by final migration');
// RLS real, no solo filtros de la interfaz: el super admin ve a todos y un
// usuario normal no puede leer ni fabricar registros de otra persona.
await db.exec('grant usage on schema auth to authenticated; grant select on public.super_admins,public.audit_log to authenticated; grant insert,update on public.audit_log to authenticated;');
const totalAudit=await count();
await db.exec('set role authenticated');
check(await count(),totalAudit,'super admin can read records from every actor/device');
await db.exec("set test.actor='99999999-0000-0000-0000-000000000009';");
check(await count(),0,'ordinary account cannot read any audit records');
await reject("insert into public.audit_log(accion,actor_user_id) values('login','"+admin+"')",'client cannot insert fake login of a verified account');
await db.exec('reset role');
console.log(checks+' PostgreSQL checks passed');
await db.close();
