// Phase 2 migration test on a local PGlite replica: the live schema snapshot (baseline.sql) plus
// synthetic, production-shaped data. Never connects to the live database.
// Run: npm run test:db [-- path/to/migration.sql]
import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
// Every migration from Phase 2 on, in version order, unless specific files are passed.
const migrationsDir = new URL('../../migrations/', import.meta.url)
const MIGRATIONS = process.argv.length > 2
  ? process.argv.slice(2)
  : readdirSync(migrationsDir).filter((name) => name >= '20261030000000').sort().map((name) => new URL(name, migrationsDir))
const db = new PGlite()
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const id = { m1: U(1), m2: U(2), m3: U(3), e1: U(11), e2: U(12), e3: U(13), p1: U(21), bAdmin: U(31), bEmp: U(32), bEmp2: U(33), aSup: U(34), u9: U(41) }
const now = Date.now(), H = 3600000
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra) } }
const q = async (sql, params) => (await db.query(sql, params)).rows
async function as(uid, fn, role = 'authenticated') {
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(uid ? { sub: uid, role } : { role })])
  await db.exec(`set role ${role}`)
  try { return await fn() } finally { await db.exec('reset role') }
}
async function err(fn) { try { await fn(); return null } catch (e) { return e.code || e.message } }
const n = async (uid, sql, params) => (await as(uid, () => q(sql, params)))[0].n

await db.exec(readFileSync(new URL('./baseline.sql', import.meta.url), 'utf8'))

// --- synthetic data shaped like production ---
const user = (k, email, appRole, userRole) => db.query(
  `insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at) values ($1,$2,$3,$4, now())`,
  [id[k], email, appRole ? { role: appRole } : {}, userRole ? { role: userRole } : {}])
for (const k of ['m1', 'm2', 'm3']) await user(k, `${k}@qvrix.test`, 'manager', 'manager')
for (const k of ['e1', 'e2', 'e3']) await user(k, `${k}@qvrix.test`, null, null)
await db.exec(`
insert into departments (id, name) values ('${U(101)}','Operations'),('${U(102)}','Security'),('${U(103)}','Facilities');
insert into designations (id, name) values ('${U(111)}','Guard'),('${U(112)}','Supervisor'),('${U(113)}','Technician');
insert into shifts (id, name, start_time, end_time, department_id) values ('${U(121)}','Day','09:00','18:00','${U(101)}');
insert into sites (id, name, latitude, longitude, radius_in_meters) values
 ('${U(201)}','Site A1',12.97,77.59,200),('${U(202)}','Site A2',12.98,77.60,300),('${U(203)}','Site A3',12.99,77.61,500),
 ('${U(204)}','Site A4',13.0,77.62,150),('${U(205)}','Site A5',13.01,77.63,500);
insert into employees (id, user_id, first_name, last_name, email, department_id, designation_id, shift_id) values
 ('${U(301)}','${id.e1}','Emp','One','e1@qvrix.test','${U(101)}','${U(111)}','${U(121)}'),
 ('${U(302)}','${id.e2}','Emp','Two','e2@qvrix.test','${U(101)}','${U(111)}','${U(121)}'),
 ('${U(303)}','${id.e3}','Emp','Three','e3@qvrix.test',null,null,null),
 ('${U(304)}',null,'No','Account4','x4@qvrix.test',null,null,null),
 ('${U(305)}',null,'No','Account5','x5@qvrix.test',null,null,null),
 ('${U(306)}',null,'No','Account6','x6@qvrix.test',null,null,null);
insert into employee_sites (employee_id, site_id) values ('${U(301)}','${U(201)}'),('${U(301)}','${U(202)}'),('${U(302)}','${U(201)}'),
 ('${U(303)}','${U(203)}'),('${U(304)}','${U(204)}'),('${U(305)}','${U(205)}'),('${U(306)}','${U(201)}');
insert into presence_sessions (user_id, site_id, entry_timestamp, exit_timestamp, total_hours) values
 ('${id.e1}','${U(201)}',${now - 30 * H},${now - 22 * H},8),('${id.e1}','${U(201)}',${now - 5 * H},null,null),
 ('${id.e2}','${U(201)}',${now - 6 * H},null,null),('${id.m1}','${U(202)}',${now - 50 * H},${now - 49 * H},1);
insert into location_logs (user_id, site_id, latitude, longitude, accuracy, distance_to_site, timestamp, is_inside) values
 ('${id.e1}','${U(201)}',12.97,77.59,10,5,${now - 60000},true),('${id.m1}','${U(202)}',12.98,77.60,12,10,${now - 49 * H},true);
insert into site_visits (user_id, site_id, entry_timestamp) values ('${id.e1}','${U(201)}',${now - 5 * H});
`)
const counts = `select (select count(*) from presence_sessions)::int s, (select count(*) from location_logs)::int l,
  (select count(*) from employees)::int e, (select count(*) from employee_sites)::int a`
const before = (await q(counts))[0]

// --- apply the migration as its owner ---
for (const migration of MIGRATIONS) await db.exec(readFileSync(migration, 'utf8'))
console.log(`migrations applied: ${MIGRATIONS.length}`)

// PostgREST can only embed a related table (e.g. employees?select=departments(name)) when exactly
// one foreign key links the pair; a second one fails every such read with PGRST201.
const ambiguous = await q(`select conrelid::regclass::text as t, confrelid::regclass::text as r, count(*)::int as n
  from pg_constraint where contype = 'f' and connamespace = 'public'::regnamespace
    and confrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)
  group by 1, 2 having count(*) > 1`)
ok('every table pair has one relationship (PostgREST embeds resolve)', ambiguous.length === 0, JSON.stringify(ambiguous))

// T1 backfill and access preservation
const qvrix = (await q(`select id from organizations where slug='qvrix'`))[0].id
for (const t of ['sites', 'shifts', 'departments', 'designations', 'employees', 'employee_sites', 'presence_sessions', 'location_logs', 'site_visits', 'audit_logs'])
  ok(`backfill ${t}`, (await q(`select count(*)::int n from ${t} where organization_id is distinct from $1`, [qvrix]))[0].n === 0)
ok('no rows lost', JSON.stringify(before) === JSON.stringify((await q(counts))[0]))
ok('managers became org admins', (await q(`select count(*)::int n from organization_members where role='org_admin'`))[0].n === 3)
const m1Access = (await as(id.m1, () => q(`select public.my_console_access() a`)))[0].a
ok('m1 console access', m1Access.organizations.length === 1 && m1Access.organizations[0].role === 'org_admin', JSON.stringify(m1Access))
ok('employee has no console access', (await as(id.e1, () => q(`select public.my_console_access() a`)))[0].a.organizations.length === 0)
ok('m1 sees 5 sites', await n(id.m1, `select count(*)::int n from sites`) === 5)
ok('m1 sees 6 employees', await n(id.m1, `select count(*)::int n from employees`) === 6)
ok('e1 sees org sites', await n(id.e1, `select count(*)::int n from sites`) === 5)
ok('e1 reads only own employee row', await n(id.e1, `select count(*)::int n from employees`) === 1)
ok('e1 reads only own assignments', await n(id.e1, `select count(*)::int n from employee_sites`) === 2)
ok('e1 reads assigned shift', await n(id.e1, `select count(*)::int n from shifts`) === 1)

// T2 second organization through the platform admin RPC
await db.exec(`insert into auth.users (id,email,raw_app_meta_data,email_confirmed_at) values
 ('${id.p1}','p1@platform.test','{}',now()),('${id.bAdmin}','admin@beta.test','{}',now()),
 ('${id.bEmp}','worker@beta.test','{"role":"employee"}',now()),('${id.bEmp2}','worker2@beta.test','{}',now()),
 ('${id.aSup}','sup@qvrix.test','{}',now()),('${id.u9}','u9@unknown.test','{}',now());
 insert into platform_admins (user_id) values ('${id.p1}');`)
ok('non-platform cannot create org', await err(() => as(id.m1, () => q(`select create_organization('X','x-org')`))) === '42501')
const beta = (await as(id.p1, () => q(`select create_organization('Beta Builders','beta','Asia/Kolkata','admin@beta.test') id`)))[0].id
ok('first admin is invited, not attached', (await q(`select count(*)::int n from organization_members where organization_id=$1`, [beta]))[0].n === 0)
const bAdminAccess = (await as(id.bAdmin, () => q(`select public.my_console_access() a`)))[0].a
ok('invited admin sees the invitation, not the organization', bAdminAccess.organizations.length === 0 && bAdminAccess.invitations.length === 1 && bAdminAccess.invitations[0].role === 'org_admin', JSON.stringify(bAdminAccess))
await as(id.bAdmin, () => q(`select respond_to_console_invitation($1, true)`, [bAdminAccess.invitations[0].id]))
ok('beta admin membership after accepting', (await q(`select role from organization_members where organization_id=$1 and user_id=$2`, [beta, id.bAdmin]))[0]?.role === 'org_admin')
ok('bad timezone rejected', await err(() => as(id.p1, () => q(`select create_organization('Y','y-org','Mars/Base')`))) === '22023')
ok('platform admin sees both orgs in console', (await as(id.p1, () => q(`select public.my_console_access() a`)))[0].a.organizations.length === 2)

// T3 console-managed records stamp the caller's only organization
const bSite = (await as(id.bAdmin, () => q(`insert into sites (name, latitude, longitude, radius_in_meters) values ('Beta Yard',19.07,72.87,250) returning id, organization_id`)))[0]
ok('site stamped beta', bSite.organization_id === beta)
ok('beta admin sees 1 site', await n(id.bAdmin, `select count(*)::int n from sites`) === 1)
ok('m1 still sees 5 sites', await n(id.m1, `select count(*)::int n from sites`) === 5)
ok('cross-org site insert blocked', await err(() => as(id.bAdmin, () => q(`insert into sites (name, latitude, longitude, organization_id) values ('Sneaky',1,1,$1)`, [qvrix]))) === '42501')
ok('cross-org site update matches nothing', await n(id.bAdmin, `with u as (update sites set name='x' where organization_id='${qvrix}' returning 1) select count(*)::int n from u`) === 0)
ok('moving a site between orgs blocked', await err(() => as(id.p1, () => q(`update sites set organization_id=$1 where id=$2`, [qvrix, bSite.id]))) === '42501')
ok('same department name in another org', await err(() => as(id.bAdmin, () => q(`insert into departments (name) values ('Operations')`))) === null)
ok('platform admin with two orgs must choose', await err(() => as(id.p1, () => q(`insert into departments (name) values ('Ambiguous')`))) === '23502')
ok('cross-org department reference blocked', await err(() => as(id.bAdmin, () => q(`insert into employees (first_name,last_name,email,department_id) values ('a','b','dept@beta.test',$1)`, [U(101)]))) === '23503')

/// T4 verified identity: links need proof from the account holder or the server, never the inviting organization
await db.query(`update auth.users set raw_app_meta_data = jsonb_build_object('role', 'employee', 'organization_id', $1::text) where id = $2`, [beta, id.bEmp])
const bEmpRow = (await as(id.bAdmin, () => q(`insert into employees (first_name,last_name,email) values ('Beta','Worker','worker@beta.test') returning id, user_id`)))[0]
ok('server-assigned employee auto-linked in its organization', bEmpRow.user_id === id.bEmp)
const bEmp2Row = (await as(id.bAdmin, () => q(`insert into employees (first_name,last_name,email) values ('Beta','Worker2','WORKER2@beta.test') returning id, user_id`)))[0]
ok('account without server assignment not auto-linked', bEmp2Row.user_id === null)
// Takeover attempts: another organization invites accounts that belong elsewhere.
await db.query(`insert into auth.users (id,email,raw_app_meta_data,email_confirmed_at) values ($1,'qvrix.new@qvrix.test',$2,now())`, [U(53), { role: 'employee', organization_id: qvrix }])
const hijack = (await as(id.bAdmin, () => q(`insert into employees (first_name,last_name,email) values ('Taken','Over','qvrix.new@qvrix.test') returning id, user_id`)))[0]
ok('another organization cannot auto-claim an assigned account', hijack.user_id === null)
const managerProfile = (await as(id.bAdmin, () => q(`insert into employees (first_name,last_name,email) values ('Qvrix','Manager','m1@qvrix.test') returning id, user_id`)))[0]
ok('another organization cannot claim a manager account', managerProfile.user_id === null)
ok('managers cannot list account candidates', await err(() => as(id.bAdmin, () => q(`select * from employee_account_candidates($1)`, [beta]))) === '42501')
ok('managers cannot link accounts', await err(() => as(id.bAdmin, () => q(`select link_employee_account($1)`, [hijack.id]))) === '42501')
ok('m1 has not been moved into beta', await n(id.m1, `select count(*)::int n from sites`) === 5 && (await q(`select count(*)::int n from employees where user_id=$1`, [id.m1]))[0].n === 0)
ok('same email allowed in another organization (no reservation)', await err(() => as(id.m1, () => q(`insert into employees (first_name,last_name,email) values ('Q','Worker2','worker2@beta.test')`))) === null)
// The account holder chooses which invitation to accept.
const invitations = await as(id.bEmp2, () => q(`select * from my_employee_invitations()`))
ok('account holder sees invitations by organization name', invitations.map((row) => row.organization_name).join() === 'Beta Builders,Qvrix', JSON.stringify(invitations))
ok('nobody sees invitations for another email', (await as(id.e1, () => q(`select * from my_employee_invitations()`))).length === 0)
ok('cannot accept an invitation for another email', await err(() => as(id.bEmp2, () => q(`select accept_employee_invitation($1)`, [hijack.id]))) === '42501')
ok('accepting links the chosen organization', (await as(id.bEmp2, () => q(`select accept_employee_invitation($1) o`, [bEmp2Row.id])))[0].o === beta)
ok('profile now linked', (await q(`select user_id from employees where id=$1`, [bEmp2Row.id]))[0].user_id === id.bEmp2)
const qvrixInvite = invitations.find((row) => row.organization_id === qvrix)
ok('second invitation refused once linked', await err(() => as(id.bEmp2, () => q(`select accept_employee_invitation($1)`, [qvrixInvite.employee_id]))) === '23505')
ok('no invitations after linking', (await as(id.bEmp2, () => q(`select * from my_employee_invitations()`))).length === 0)
// Platform operator override.
await db.query(`insert into auth.users (id,email,raw_app_meta_data,email_confirmed_at) values ($1,'ops@beta.test','{}',now())`, [U(54)])
const opsRow = (await as(id.bAdmin, () => q(`insert into employees (first_name,last_name,email) values ('Ops','Lead','ops@beta.test') returning id`)))[0]
const cands = await as(id.p1, () => q(`select * from employee_account_candidates($1)`, [beta]))
ok('platform candidates carry no sign-in data', cands.some((row) => row.employee_id === opsRow.id) && cands.every((row) => !('last_sign_in_at' in row)), JSON.stringify(cands))
ok('platform admin links an account', (await as(id.p1, () => q(`select link_employee_account($1) u`, [opsRow.id])))[0].u === U(54))
ok('second link refused', await err(() => as(id.p1, () => q(`select link_employee_account($1)`, [opsRow.id]))) === '23505')
ok('direct user_id edit blocked', await err(() => as(id.bAdmin, () => q(`update employees set user_id=$1 where id=$2`, [id.u9, hijack.id]))) === '42501')
ok('direct user_id insert blocked', await err(() => as(id.bAdmin, () => q(`insert into employees (first_name,last_name,email,user_id) values ('a','b','c@beta.test',$1)`, [id.u9]))) === '42501')
ok('case-insensitive duplicate email blocked within an organization', await err(() => as(id.bAdmin, () => q(`insert into employees (first_name,last_name,email) values ('a','b','Worker@Beta.test')`))) === '23505')
ok('profile edit keeps link', (await as(id.bAdmin, () => q(`update employees set phone='123' where id=$1 returning user_id`, [bEmpRow.id])))[0].user_id === id.bEmp)
await as(id.bAdmin, () => q(`insert into employees (first_name,last_name,email) values ('Late','Account','late@beta.test'),('Wrong','Org','wrong@beta.test')`))
await db.query(`insert into auth.users (id,email,raw_app_meta_data,email_confirmed_at) values ($1,'late@beta.test',$2,now())`, [U(51), { role: 'employee', organization_id: beta }])
ok('auth trigger links a later account assigned to this organization', (await q(`select user_id from employees where email='late@beta.test'`))[0].user_id === U(51))
await db.query(`insert into auth.users (id,email,raw_app_meta_data,email_confirmed_at) values ($1,'wrong@beta.test',$2,now())`, [U(55), { role: 'employee', organization_id: qvrix }])
ok('auth trigger ignores a profile in another organization', (await q(`select user_id from employees where email='wrong@beta.test'`))[0].user_id === null)
await db.query(`insert into auth.users (id,email,raw_app_meta_data,email_confirmed_at) values ($1,'nobody@nowhere.test','{"role":"employee"}',now())`, [U(52)])
ok('no placeholder profile created', (await q(`select count(*)::int n from employees where email='nobody@nowhere.test'`))[0].n === 0)

// T5 field activity: stamping, cross-org rejection, attendance integrity
ok('beta worker sees only beta sites', await n(id.bEmp, `select count(*)::int n from sites`) === 1)
const t0 = now - 2 * H
const s1 = (await as(id.bEmp, () => q(`insert into presence_sessions (user_id, site_id, entry_timestamp, total_hours) values ($1,$2,$3,99) returning organization_id, total_hours`, [id.bEmp, bSite.id, t0])))[0]
ok('session stamped beta, hours derived', s1.organization_id === beta && s1.total_hours === null, JSON.stringify(s1))
ok('cross-org session rejected (retryable)', await err(() => as(id.bEmp, () => q(`insert into presence_sessions (user_id, site_id, entry_timestamp) values ($1,$2,$3)`, [id.bEmp, U(201), t0]))) === '42501')
ok('idempotent re-upload', await err(() => as(id.bEmp, () => q(`insert into presence_sessions (user_id, site_id, entry_timestamp) values ($1,$2,$3) on conflict (user_id, site_id, entry_timestamp) do nothing`, [id.bEmp, bSite.id, t0]))) === null)
ok('entry time immutable', await err(() => as(id.bEmp, () => q(`update presence_sessions set entry_timestamp=$1 where user_id=$2`, [t0 - H, id.bEmp]))) === '42501')
const exit = (await as(id.bEmp, () => q(`update presence_sessions set exit_timestamp=$1, total_hours=50 where user_id=$2 and site_id=$3 and entry_timestamp=$4 returning total_hours, closed_by`, [t0 + 2 * H, id.bEmp, bSite.id, t0])))[0]
ok('checkout accepted, hours derived', exit.total_hours === 2 && exit.closed_by === 'employee', JSON.stringify(exit))
ok('checkout retry with same value', await err(() => as(id.bEmp, () => q(`update presence_sessions set exit_timestamp=$1 where user_id=$2 and entry_timestamp=$3`, [t0 + 2 * H, id.bEmp, t0]))) === null)
ok('completed checkout immutable', await err(() => as(id.bEmp, () => q(`update presence_sessions set exit_timestamp=$1 where user_id=$2 and entry_timestamp=$3`, [t0 + 5 * H, id.bEmp, t0]))) === '42501')
ok('exit before entry rejected', await err(() => as(id.bEmp, () => q(`insert into presence_sessions (user_id, site_id, entry_timestamp, exit_timestamp) values ($1,$2,$3,$4)`, [id.bEmp, bSite.id, t0 + 9 * H, t0 + 8 * H]))) === '23514')
const ll = (await as(id.e1, () => q(`insert into location_logs (user_id, site_id, latitude, longitude, accuracy, distance_to_site, timestamp, is_inside) values ($1,$2,1,1,5,3,$3,true) returning organization_id`, [id.e1, U(201), now])))[0]
ok('old Android payload stamped', ll.organization_id === qvrix)
ok('site-less log for linked employee', (await as(id.e1, () => q(`insert into location_logs (user_id, latitude, longitude, accuracy, distance_to_site, timestamp, is_inside) values ($1,1,1,5,3,$2,false) returning organization_id`, [id.e1, now + 1])))[0].organization_id === qvrix)
ok('spoofed organization ignored', (await as(id.e1, () => q(`insert into location_logs (user_id, latitude, longitude, accuracy, distance_to_site, timestamp, is_inside, organization_id) values ($1,1,1,5,3,$2,false,$3) returning organization_id`, [id.e1, now + 2, beta])))[0].organization_id === qvrix)
ok('unlinked account with no site rejected (retryable)', await err(() => as(id.u9, () => q(`insert into location_logs (user_id, latitude, longitude, accuracy, distance_to_site, timestamp, is_inside) values ($1,1,1,5,3,$2,false)`, [id.u9, now]))) === '42501')
ok('unlinked account at a site is accepted', (await as(id.u9, () => q(`insert into presence_sessions (user_id, site_id, entry_timestamp) values ($1,$2,$3) returning organization_id`, [id.u9, U(203), now - H])))[0].organization_id === qvrix)
ok('site visit hours derived', (await as(id.e1, () => q(`update site_visits set exit_timestamp=$1, duration_hours=99 where user_id=$2 returning duration_hours`, [now - 3 * H, id.e1])))[0].duration_hours === 2)
ok('site visit exit immutable', await err(() => as(id.e1, () => q(`update site_visits set exit_timestamp=$1 where user_id=$2`, [now - 2 * H, id.e1]))) === '42501')
ok('employee cannot fake heartbeat', (await as(id.e1, () => q(`update presence_sessions set last_heartbeat=$1 where user_id=$2 and exit_timestamp is null returning last_heartbeat`, [now, id.e1])))[0].last_heartbeat === null)
ok('employee cannot touch others', await n(id.e1, `with u as (update presence_sessions set exit_timestamp=${now} where user_id='${id.e2}' returning 1) select count(*)::int n from u`) === 0)

// T6 isolation of reads
ok('m1 cannot see beta sessions', await n(id.m1, `select count(*)::int n from presence_sessions where organization_id=$1`, [beta]) === 0)
ok('beta admin sees beta sessions only', await n(id.bAdmin, `select count(distinct organization_id)::int n from presence_sessions`) === 1)
ok('beta admin sees no qvrix logs', await n(id.bAdmin, `select count(*)::int n from location_logs`) === 0)
ok('online view isolated', await n(id.bAdmin, `select count(*)::int n from employee_online_status where organization_id <> $1`, [beta]) === 0)
ok('outside-site view isolated', await n(id.bAdmin, `select count(*)::int n from employees_outside_site`) === 0)
ok('organizations isolated', await n(id.m1, `select count(*)::int n from organizations`) === 1 && await n(id.p1, `select count(*)::int n from organizations`) === 2)
ok('worker sees own org only', await n(id.bEmp, `select count(*)::int n from organizations`) === 1)
const unl = await as(id.m1, () => q(`select user_id, email, organization_id from unlinked_devices`))
ok('unlinked account routed to its site org', unl.length === 1 && unl[0].user_id === id.u9 && unl[0].organization_id === qvrix, JSON.stringify(unl))
ok('other org cannot see that unlinked account', await n(id.bAdmin, `select count(*)::int n from unlinked_devices`) === 0)
ok('employees cannot see unlinked accounts', await n(id.e1, `select count(*)::int n from unlinked_devices`) === 0)
ok('cross-org assignment blocked', await err(() => as(id.bAdmin, () => q(`insert into employee_sites (employee_id, site_id) values ($1,$2)`, [bEmpRow.id, U(201)]))) === '42501')
ok('same-org assignment allowed', await err(() => as(id.bAdmin, () => q(`insert into employee_sites (employee_id, site_id) values ($1,$2)`, [bEmpRow.id, bSite.id]))) === null)
ok('anon sees nothing', (await as(null, () => q(`select count(*)::int n from sites`), 'anon'))[0].n === 0)
ok('anon cannot read organizations', await err(() => as(null, () => q(`select count(*) from organizations`), 'anon')) === '42501')

/// T7 Console roles by invitation: no account probing, no attachment without consent
const invite = (uid, org, email, role) => as(uid, () => q(`select invite_organization_member($1,$2,$3) id`, [org, email, role]))
const supInvite = (await invite(id.m1, qvrix, 'sup@qvrix.test', 'supervisor'))[0].id
const unknownInvite = await err(() => invite(id.m1, qvrix, 'nobody-here@unknown.test', 'manager'))
const knownInvite = await err(() => invite(id.m1, qvrix, 'E2@Qvrix.test', 'manager'))
ok('same response whether or not the email has an account', unknownInvite === null && knownInvite === null)
ok('invitation email stored normalized', (await q(`select count(*)::int n from organization_invitations where email='e2@qvrix.test'`))[0].n === 1)
ok('an invitation grants nothing', (await q(`select count(*)::int n from organization_members where user_id in ($1,$2)`, [id.e2, id.aSup]))[0].n === 0)
ok('invitee has no Console access before accepting', (await as(id.e2, () => q(`select public.my_console_access() a`)))[0].a.organizations.length === 0)
const pending = await as(id.m1, () => q(`select * from list_organization_invitations($1)`, [qvrix]))
ok('pending list shows only what the admin typed', pending.length === 3 && pending.every((row) => !('user_id' in row) && !('last_sign_in_at' in row)), JSON.stringify(pending))
ok('invitees are not listed as members', !(await as(id.m1, () => q(`select * from list_organization_members($1)`, [qvrix]))).some((row) => row.email === 'e2@qvrix.test'))
ok('other organizations cannot read the invitations', await err(() => as(id.bAdmin, () => q(`select * from list_organization_invitations($1)`, [qvrix]))) === '42501' && await n(id.bAdmin, `select count(*)::int n from organization_invitations where organization_id = $1`, [qvrix]) === 0)
ok('other organizations cannot invite', await err(() => invite(id.bAdmin, qvrix, 'x@qvrix.test', 'manager')) === '42501')
ok('employees cannot invite', await err(() => invite(id.e1, qvrix, 'x@qvrix.test', 'manager')) === '42501')
ok('invalid email rejected', await err(() => invite(id.m1, qvrix, 'not-an-email', 'manager')) === '22023')
ok('existing members cannot be re-invited', await err(() => invite(id.m1, qvrix, 'M2@qvrix.test', 'supervisor')) === '23505')
ok('old attach-by-email function removed', await err(() => as(id.m1, () => q(`select set_organization_member($1,'e3@qvrix.test','manager')`, [qvrix]))) === '42883')
const e2Invites = await as(id.e2, () => q(`select * from my_console_invitations()`))
ok('invitee sees the invitation with the organization name', e2Invites.length === 1 && e2Invites[0].organization_name === 'Qvrix' && e2Invites[0].role === 'manager', JSON.stringify(e2Invites))
ok('nobody else sees it', (await as(id.e1, () => q(`select * from my_console_invitations()`))).length === 0)
ok('cannot accept an invitation for another email', await err(() => as(id.e1, () => q(`select respond_to_console_invitation($1, true)`, [e2Invites[0].id]))) === '42501')
await as(id.e2, () => q(`select respond_to_console_invitation($1, false)`, [e2Invites[0].id]))
ok('declining grants nothing and closes the invitation', (await q(`select count(*)::int n from organization_members where user_id=$1`, [id.e2]))[0].n === 0 && (await as(id.e2, () => q(`select * from my_console_invitations()`))).length === 0)
ok('a declined invitation cannot be accepted', await err(() => as(id.e2, () => q(`select respond_to_console_invitation($1, true)`, [e2Invites[0].id]))) === '42501')
await invite(id.m1, qvrix, 'e2@qvrix.test', 'manager')
const e2Again = (await as(id.e2, () => q(`select * from my_console_invitations()`)))[0]
ok('accepting creates the membership', (await as(id.e2, () => q(`select respond_to_console_invitation($1, true) o`, [e2Again.id])))[0].o === qvrix
  && (await q(`select role from organization_members where user_id=$1 and organization_id=$2`, [id.e2, qvrix]))[0]?.role === 'manager')
ok('accepted invitation cannot be reused', await err(() => as(id.e2, () => q(`select respond_to_console_invitation($1, true)`, [e2Again.id]))) === '42501')
ok('accepted member is listed', (await as(id.m1, () => q(`select * from list_organization_members($1)`, [qvrix]))).some((row) => row.email === 'e2@qvrix.test'))
ok('managers cannot invite (admins only)', await err(() => invite(id.e2, qvrix, 'x@qvrix.test', 'supervisor')) === '42501')
const e3Invite = (await invite(id.m1, qvrix, 'e3@qvrix.test', 'supervisor'))[0].id
await db.query(`update organization_invitations set expires_at = now() - interval '1 day' where id=$1`, [e3Invite])
ok('expired invitations are hidden and refused', (await as(id.e3, () => q(`select * from my_console_invitations()`))).length === 0
  && await err(() => as(id.e3, () => q(`select respond_to_console_invitation($1, true)`, [e3Invite]))) === '42501')
ok('other organizations cannot revoke', await err(() => as(id.bAdmin, () => q(`select revoke_organization_invitation($1)`, [e3Invite]))) === '42501')
await as(id.m1, () => q(`select revoke_organization_invitation($1)`, [e3Invite]))
ok('admins revoke open invitations', (await q(`select revoked_at is not null r from organization_invitations where id=$1`, [e3Invite]))[0].r === true)
await as(id.aSup, () => q(`select respond_to_console_invitation($1, true)`, [supInvite]))
ok('role changes only for existing members', await err(() => as(id.m1, () => q(`select set_organization_member_role($1,$2,'manager')`, [qvrix, U(53)]))) === 'P0002')
ok('admins change a member role', await err(() => as(id.m1, () => q(`select set_organization_member_role($1,$2,'supervisor')`, [qvrix, id.e2]))) === null
  && (await q(`select role from organization_members where user_id=$1 and organization_id=$2`, [id.e2, qvrix]))[0].role === 'supervisor')
ok('invitations are audited', (await q(`select count(*)::int n from audit_logs where table_name='organization_invitations' and organization_id=$1`, [qvrix]))[0].n >= 5)
// Roles: supervisors read, cannot write; last admin protected
ok('supervisor reads attendance', await n(id.aSup, `select count(*)::int n from presence_sessions`) > 0)
ok('supervisor cannot create sites', await err(() => as(id.aSup, () => q(`insert into sites (name, latitude, longitude, organization_id) values ('No',1,1,$1)`, [qvrix]))) === '42501')
ok('supervisor cannot read audit', await n(id.aSup, `select count(*)::int n from audit_logs`) === 0)
ok('supervisor cannot invite', await err(() => invite(id.aSup, qvrix, 'x@qvrix.test', 'supervisor')) === '42501')
ok('last beta admin protected', await err(() => as(id.bAdmin, () => q(`select deactivate_organization_member($1,$2)`, [beta, id.bAdmin]))) === '22023')
ok('last admin cannot demote self', await err(() => as(id.bAdmin, () => q(`select set_organization_member_role($1,$2,'manager')`, [beta, id.bAdmin]))) === '22023')
ok('members listed with email', (await as(id.m1, () => q(`select * from list_organization_members($1)`, [qvrix]))).some(r => r.email === 'sup@qvrix.test'))
ok('org admin renames own org', await err(() => as(id.bAdmin, () => q(`update organizations set name='Beta Builders Pvt Ltd' where id=$1`, [beta]))) === null)
ok('org admin cannot rename other org', await n(id.bAdmin, `with u as (update organizations set name='x' where id='${qvrix}' returning 1) select count(*)::int n from u`) === 0)

// T8 audit trail
ok('audit cannot be forged', await err(() => as(id.m1, () => q(`insert into audit_logs (action, table_name, organization_id) values ('X','sites',$1)`, [qvrix]))) !== null)
ok('site changes audited with org', await n(id.bAdmin, `select count(*)::int n from audit_logs where table_name='sites' and organization_id=$1`, [beta]) === 1)
ok('m1 cannot see beta audit', await n(id.m1, `select count(*)::int n from audit_logs where organization_id=$1`, [beta]) === 0)
ok('checkout audited', (await q(`select count(*)::int n from audit_logs where table_name='presence_sessions' and user_id=$1`, [id.bEmp]))[0].n >= 1)
ok('assignment audited', (await q(`select count(*)::int n from audit_logs where table_name='employee_sites' and organization_id=$1`, [beta]))[0].n === 1)

// T9 devices
const inst = '11111111-2222-4333-8444-555555555555', hw = 'a'.repeat(64)
const d1 = (await as(id.bEmp, () => q(`select register_device($1,$2,'android','Samsung','SM-A145','14','1.4.0',14,'tracking') r`, [inst, hw])))[0].r
ok('device registered active', d1.status === 'active' && d1.is_holder === true, JSON.stringify(d1))
ok('heartbeat keeps one device', (await as(id.bEmp, () => q(`select register_device($1,$2) r`, [inst, hw])))[0].r.device_id === d1.device_id)
ok('employee sees own device', await n(id.bEmp, `select count(*)::int n from devices`) === 1)
const d2 = (await as(id.bEmp2, () => q(`select register_device($1) r`, [inst])))[0].r
ok('other account on same phone needs review', d2.status === 'pending_review' && d2.is_holder === false, JSON.stringify(d2))
ok('mismatch event recorded', await n(id.bAdmin, `select count(*)::int n from device_events where event_type='account_mismatch'`) === 1)
ok('repeat login does not duplicate the event', (await as(id.bEmp2, () => q(`select register_device($1) r`, [inst]))) && await n(id.bAdmin, `select count(*)::int n from device_events where event_type='account_mismatch'`) === 1)
ok('other org cannot see device', await n(id.m1, `select count(*)::int n from devices`) === 0)
ok('other org cannot approve', await err(() => as(id.m1, () => q(`select review_device_reassignment($1,true)`, [d1.device_id]))) === '42501')
ok('supervisor cannot approve', await err(() => as(id.aSup, () => q(`select review_device_reassignment($1,true)`, [d1.device_id]))) === '42501')
await as(id.bAdmin, () => q(`select review_device_reassignment($1,true,'handover')`, [d1.device_id]))
const dev = (await q(`select user_id, employee_id, status, pending_user_id from devices where id=$1`, [d1.device_id]))[0]
ok('approved reassignment', dev.user_id === id.bEmp2 && dev.employee_id === bEmp2Row.id && dev.status === 'active' && dev.pending_user_id === null, JSON.stringify(dev))
const hist = (await q(`select count(*)::int n, count(ended_at)::int ended from device_assignments where device_id=$1`, [d1.device_id]))[0]
ok('assignment history kept', hist.n === 2 && hist.ended === 1, JSON.stringify(hist))
const re = (await as(id.bEmp2, () => q(`select register_device($1,$2) r`, ['99999999-2222-4333-8444-555555555555', hw])))[0].r
ok('reinstall recognised by hardware hash', re.device_id === d1.device_id && re.is_holder, JSON.stringify(re))
const ud = (await as(id.u9, () => q(`select register_device($1) r`, ['77777777-2222-4333-8444-555555555555'])))[0].r
ok('unlinked account device pending', ud.status === 'pending_review')
ok('unlinked device visible to site org', await n(id.m1, `select count(*)::int n from devices`) === 1)
ok('devices not writable directly', await err(() => as(id.bAdmin, () => q(`update devices set status='active'`))) === '42501')
await as(id.bAdmin, () => q(`select assign_device($1,$2,'company phone')`, [d1.device_id, bEmpRow.id]))
ok('admin assignment', (await q(`select user_id from devices where id=$1`, [d1.device_id]))[0].user_id === id.bEmp)
await as(id.bAdmin, () => q(`select set_device_status($1,'revoked','lost')`, [d1.device_id]))
ok('revoked device stays revoked on login', (await as(id.bEmp, () => q(`select register_device($1) r`, ['99999999-2222-4333-8444-555555555555'])))[0].r.status === 'revoked')
ok('revoked device cannot be assigned', await err(() => as(id.bAdmin, () => q(`select assign_device($1,$2)`, [d1.device_id, bEmpRow.id]))) === '22023')
ok('bad install id rejected', await err(() => as(id.bEmp, () => q(`select register_device('Device 39235d6e')`))) === '22023')
ok('anon cannot register', await err(() => as(null, () => q(`select register_device($1)`, [inst]), 'anon')) === '42501')
ok('device events isolated', await n(id.m1, `select count(*)::int n from device_events where organization_id=$1`, [beta]) === 0)

// T10 maintenance RPCs stay inside the caller's organizations
await db.query(`update presence_sessions set last_heartbeat=null`)
const closed = (await as(id.bAdmin, () => q(`select mark_stale_sessions_exited(15) n`)))[0].n
ok('beta admin closes only beta sessions', closed === 0 && (await q(`select count(*)::int n from presence_sessions where organization_id=$1 and exit_timestamp is null`, [qvrix]))[0].n >= 2)
const t1 = now - 4 * H
await as(id.bEmp, () => q(`insert into presence_sessions (user_id, site_id, entry_timestamp) values ($1,$2,$3)`, [id.bEmp, bSite.id, t1]))
ok('stale close counts', (await as(id.bAdmin, () => q(`select mark_stale_sessions_exited(15) n`)))[0].n === 1)
ok('stale close marked', (await q(`select closed_by from presence_sessions where user_id=$1 and entry_timestamp=$2`, [id.bEmp, t1]))[0].closed_by === 'auto_stale')
const real = (await as(id.bEmp, () => q(`update presence_sessions set exit_timestamp=$1 where user_id=$2 and entry_timestamp=$3 returning closed_by, total_hours`, [t1 + 3 * H, id.bEmp, t1])))[0]
ok('real checkout replaces auto close', real.closed_by === 'employee' && real.total_hours === 3, JSON.stringify(real))
ok('employees cannot run maintenance', await err(() => as(id.e1, () => q(`select mark_stale_sessions_exited(15)`))) === '42501')

// T11 people management: employee codes, employment type, archive and restore
const upd = (uid, set, empId) => as(uid, () => q(`update employees set ${set} where id=$1 returning *`, [empId]))
ok('employee code set', await err(() => upd(id.m1, `employee_code='EMP-001', employment_type='contract'`, U(304))) === null)
ok('employee code unique per org ignoring case', await err(() => upd(id.m1, `employee_code='emp-001'`, U(305))) === '23505')
ok('same employee code allowed in another org', await err(() => upd(id.bAdmin, `employee_code='EMP-001'`, bEmp2Row.id)) === null)
ok('malformed employee code rejected', await err(() => upd(id.m1, `employee_code=' bad code'`, U(305))) === '23514')
ok('unknown employment type rejected', await err(() => upd(id.m1, `employment_type='freelance'`, U(305))) === '23514')
ok('archived_by cannot be forged', (await upd(id.m1, `archived_by='${id.m2}'`, U(305)))[0].archived_by === null)
const archived = (await upd(id.m1, `archived_at='2000-01-01'`, U(306)))[0]
ok('archive stamps server time, actor and inactive', archived.archived_by === id.m1 && !archived.is_active
  && new Date(archived.archived_at).getFullYear() > 2000, JSON.stringify(archived))
ok('archived profile cannot be reactivated directly', await err(() => upd(id.m1, `is_active=true`, U(306))) === '22023')
ok('archive record cannot be rewritten', (await upd(id.m1, `archived_at='2001-01-01', archived_by='${id.m2}'`, U(306)))[0].archived_by === id.m1)
const restored = (await upd(id.m1, `archived_at=null, is_active=true`, U(306)))[0]
ok('restore clears archive and reactivates', restored.archived_at === null && restored.archived_by === null && restored.is_active)
ok('employees cannot be created archived', await err(() => as(id.m1, () => q(`insert into employees (first_name,last_name,email,archived_at) values ('a','b','arch@qvrix.test',now())`))) === '22023')
await q(`insert into presence_sessions (user_id, site_id, entry_timestamp, organization_id) values ($1,$2,$3,$4)`, [id.e3, U(203), now - H, qvrix])
ok('archive blocked while on site', await err(() => upd(id.m1, `archived_at=now()`, U(303))) === '22023')
await q(`update presence_sessions set exit_timestamp=$1 where user_id=$2 and exit_timestamp is null`, [now, id.e3])
ok('archive allowed after check-out', (await upd(id.m1, `archived_at=now()`, U(303)))[0]?.archived_by === id.m1)
ok('archived employee still sees own profile, marked inactive', await n(id.e3, `select count(*)::int n from employees where not is_active and archived_at is not null`) === 1)
ok('archived employee loses site access', await n(id.e3, `select count(*)::int n from sites`) === 0)
ok('other org cannot archive', (await upd(id.bAdmin, `archived_at=now()`, U(305))).length === 0)
ok('supervisor cannot archive', (await upd(id.aSup, `archived_at=now()`, U(305))).length === 0)
ok('archive audited', (await q(`select count(*)::int n from audit_logs where table_name='employees' and record_id=$1 and new_values->>'archived_at' is not null`, [U(303)]))[0].n >= 1)

// T12 work schedules, holiday calendars and the time-tracking policy
const dayShift = (await q(`select * from shifts where id=$1`, [U(121)]))[0]
ok('existing shift becomes a fixed Monday-to-Friday schedule', dayShift.schedule_type === 'fixed'
  && JSON.stringify(dayShift.working_days) === '[1,2,3,4,5]' && dayShift.breaks.length === 0 && !dayShift.is_default
  && dayShift.start_time === '09:00:00', JSON.stringify(dayShift))
ok('department link carried over to the department', (await q(`select shift_id from departments where id=$1`, [U(101)]))[0].shift_id === U(121))
const asM1 = (sql, params) => as(id.m1, () => q(sql, params))
const night = (await asM1(`insert into shifts (name, start_time, end_time, working_days, day_times, breaks, day_split_time,
    overtime_daily_after_minutes, overtime_daily_rate, overtime_double_after_minutes, overtime_double_rate,
    overtime_weekly_after_minutes, overtime_weekly_rate, overtime_holiday_rate)
  values ('Night','22:00','06:00','{6,1,1,2,3,4,5}','{"6":{"start":"22:00","end":"02:00"}}',
    '[{"name":"Meal","minutes":30,"paid":false,"start":"01:00","end":"03:00"},{"name":"Tea","minutes":10,"paid":true}]',
    '12:00',540,1.5,720,2,2880,1.5,2) returning *`))[0]
ok('night schedule saved in the organization, working days sorted and unique', night.organization_id === qvrix
  && JSON.stringify(night.working_days) === '[1,2,3,4,5,6]' && night.breaks.length === 2, JSON.stringify(night.working_days))
const shiftErr = (cols, vals) => err(() => asM1(`insert into shifts (name, start_time, end_time, ${cols}) values ('X','09:00','18:00', ${vals})`))
ok('flexible schedule needs daily hours', await shiftErr(`schedule_type`, `'flexible'`) === '23514')
ok('flexible schedule with daily hours', await shiftErr(`schedule_type, daily_minutes`, `'flexible', 480`) === null)
ok('weekly flexible schedule with weekly hours', await err(() => asM1(`insert into shifts (name, start_time, end_time, schedule_type, weekly_minutes) values ('Weekly','08:00','20:00','weekly_flexible',2400)`)) === null)
ok('fixed schedule cannot carry a daily target', await shiftErr(`daily_minutes`, `480`) === '23514')
ok('unknown schedule type rejected', await shiftErr(`schedule_type`, `'rota'`) === '23514')
ok('weekday outside 1-7 rejected', await shiftErr(`working_days`, `'{1,8}'`) === '23514')
ok('a schedule needs a working day', await shiftErr(`working_days`, `'{}'`) === '23514')
ok('own hours only on working days', await shiftErr(`day_times`, `'{"7":{"start":"10:00","end":"14:00"}}'`) === '22023')
ok('malformed day hours rejected', await shiftErr(`day_times`, `'{"1":{"start":"9am","end":"14:00"}}'`) === '22023')
ok('flexible schedules cannot set per-day hours', await shiftErr(`schedule_type, daily_minutes, day_times`, `'flexible', 480, '{"1":{"start":"10:00","end":"14:00"}}'`) === '22023')
ok('start and end must differ', await err(() => asM1(`insert into shifts (name, start_time, end_time) values ('Zero','09:00','09:00')`)) === '22023')
for (const [label, breaks] of [
  ['zero-minute break', '[{"name":"Lunch","minutes":0,"paid":false}]'],
  ['minutes as text', '[{"name":"Lunch","minutes":"30","paid":false}]'],
  ['break without paid flag', '[{"name":"Lunch","minutes":30}]'],
  ['break with an unknown field', '[{"name":"Lunch","minutes":30,"paid":false,"note":"x"}]'],
  ['break start without end', '[{"name":"Lunch","minutes":30,"paid":false,"start":"13:00"}]'],
  ['break that is not an object', '["Lunch"]'],
  ['breaks that are not a list', '{"name":"Lunch"}'],
  ['six breaks', JSON.stringify(Array.from({ length: 6 }, (_, i) => ({ name: `B${i}`, minutes: 5, paid: true })))],
]) ok(`rejected: ${label}`, await shiftErr(`breaks`, `'${breaks}'`) === '22023')
ok('unpaid breaks must leave working time', await err(() => asM1(`insert into shifts (name, start_time, end_time, breaks) values ('Short','09:00','10:00','[{"name":"Lunch","minutes":60,"paid":false}]')`)) === '22023')
ok('paid breaks may fill the day', await err(() => asM1(`insert into shifts (name, start_time, end_time, breaks) values ('Paid','09:00','10:00','[{"name":"Rest","minutes":60,"paid":true}]')`)) === null)
ok('automatic break needs both values', await shiftErr(`auto_break_minutes`, `30`) === '23514')
ok('automatic break saved', await shiftErr(`auto_break_minutes, auto_break_after_minutes`, `30, 360`) === null)
ok('double overtime needs daily overtime', await shiftErr(`overtime_double_after_minutes, overtime_double_rate`, `720, 2`) === '23514')
ok('double overtime starts after daily overtime', await shiftErr(`overtime_daily_after_minutes, overtime_daily_rate, overtime_double_after_minutes, overtime_double_rate`, `540, 1.5, 540, 2`) === '23514')
ok('overtime rate limited to 5x', await shiftErr(`overtime_holiday_rate`, `6`) === '23514')
ok('supervisor cannot create schedules', await err(() => as(id.aSup, () => q(`insert into shifts (name, start_time, end_time, organization_id) values ('No','09:00','18:00',$1)`, [qvrix]))) === '42501')
await asM1(`update shifts set is_default = true where id=$1`, [night.id])
await asM1(`update shifts set is_default = true where name='Weekly'`)
ok('a new default takes over from the previous one', (await q(`select name from shifts where organization_id=$1 and is_default`, [qvrix])).map((r) => r.name).join() === 'Weekly')
const updatedAt = (await q(`select updated_at from shifts where id=$1`, [night.id]))[0].updated_at
ok('schedule edits stamp updated_at', new Date(updatedAt).getTime() > new Date(night.updated_at).getTime())
ok('one schedule can be the default for several departments', await err(() => asM1(`update departments set shift_id=$1 where id in ($2,$3)`, [night.id, U(102), U(103)])) === null)
ok('a schedule in use by a department cannot be deleted', await err(() => asM1(`delete from shifts where id=$1`, [night.id])) === '23503')
const betaDept = (await q(`select id from departments where organization_id=$1 limit 1`, [beta]))[0].id
ok('department cannot use another organization schedule', await err(() => as(id.bAdmin, () => q(`update departments set shift_id=$1 where id=$2`, [U(121), betaDept]))) === '23503')

// Holiday calendars
const dateIn = (days) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10)
const national = (await asM1(`insert into holiday_calendars (name, is_default) values ('National', true) returning *`))[0]
const state = (await asM1(`insert into holiday_calendars (name) values ('Karnataka') returning *`))[0]
ok('calendar stamped with the organization', national.organization_id === qvrix && state.organization_id === qvrix)
ok('calendar names unique ignoring case', await err(() => asM1(`insert into holiday_calendars (name) values (' national ')`)) === '23505')
const holiday = (await asM1(`insert into holidays (calendar_id, holiday_date, name) values ($1,$2,'Founders Day'),($1,$3,'Harvest'),($1,$4,'Old'),($1,$5,'Far'),($1,$6,'Last week') returning organization_id`,
  [national.id, dateIn(2), dateIn(60), dateIn(-40), dateIn(400), dateIn(-10)]))[0]
ok('holiday takes its calendar organization', holiday.organization_id === qvrix)
await asM1(`insert into holidays (calendar_id, holiday_date, name) values ($1,$2,'State Day')`, [state.id, dateIn(5)])
ok('one holiday per calendar and date', await err(() => asM1(`insert into holidays (calendar_id, holiday_date, name) values ($1,$2,'Again')`, [national.id, dateIn(2)])) === '23505')
ok('another organization cannot add holidays to this calendar', await err(() => as(id.bAdmin, () => q(`insert into holidays (calendar_id, holiday_date, name) values ($1,$2,'Sneaky')`, [national.id, dateIn(3)]))) === '42501')
ok('another organization cannot see the calendars', await n(id.bAdmin, `select count(*)::int n from holiday_calendars`) === 0 && await n(id.bAdmin, `select count(*)::int n from holidays`) === 0)
ok('supervisor reads holidays', await n(id.aSup, `select count(*)::int n from holidays`) === 6)
ok('supervisor cannot add holidays', await err(() => as(id.aSup, () => q(`insert into holidays (calendar_id, holiday_date, name) values ($1,$2,'No')`, [national.id, dateIn(9)]))) === '42501')
ok('employees do not read calendars directly', await n(id.e1, `select count(*)::int n from holiday_calendars`) === 0 && await n(id.e1, `select count(*)::int n from holidays`) === 0)
ok('employee cannot use another organization calendar', await err(() => as(id.bAdmin, () => q(`update employees set holiday_calendar_id=$1 where id=$2`, [national.id, bEmpRow.id]))) === '23503')
const spare = (await asM1(`insert into holiday_calendars (name, is_default) values ('Spare', true) returning id`))[0].id
ok('default calendar handed over', (await q(`select name from holiday_calendars where organization_id=$1 and is_default`, [qvrix])).map((r) => r.name).join() === 'Spare')
await asM1(`insert into holidays (calendar_id, holiday_date, name) values ($1,$2,'Spare Day')`, [spare, dateIn(7)])
await asM1(`update holiday_calendars set is_default = true where id=$1`, [national.id])
await asM1(`delete from holiday_calendars where id=$1`, [spare])
ok('deleting an unused calendar removes its holidays', (await q(`select count(*)::int n from holidays where calendar_id=$1`, [spare]))[0].n === 0)

// Effective rules through my_work_rules()
const rules = async (uid) => (await as(uid, () => q(`select my_work_rules() r`)))[0].r
let r1 = await rules(id.e1)
ok('employee schedule comes first', r1.schedule?.id === U(121) && r1.schedule.source === 'employee' && !('organization_id' in r1.schedule), JSON.stringify(r1.schedule))
ok('default holiday calendar applies, limited to the coming year and the last month',
  r1.holiday_calendar?.source === 'organization' && r1.holidays.map((h) => h.name).join() === 'Last week,Founders Day,Harvest', JSON.stringify(r1.holidays))
ok('no policy yet means everything off', r1.policy.source === 'default' && r1.policy.require_inside_site === false && r1.policy.early_clock_in_minutes === null)
ok('organization time zone included', r1.timezone === 'Asia/Kolkata')
await asM1(`update employees set shift_id=null where id=$1`, [U(302)])
ok('department schedule when the employee has none', (await rules(id.e2)).schedule?.source === 'department' && (await rules(id.e2)).schedule.id === U(121))
await asM1(`update departments set shift_id=null where id=$1`, [U(101)])
ok('organization default when neither has one', (await rules(id.e2)).schedule?.name === 'Weekly' && (await rules(id.e2)).schedule.source === 'organization')
await asM1(`update departments set holiday_calendar_id=$1 where id=$2`, [state.id, U(101)])
r1 = await rules(id.e1)
ok('department calendar replaces the default', r1.holiday_calendar?.name === 'Karnataka' && r1.holiday_calendar.source === 'department' && r1.holidays.map((h) => h.name).join() === 'State Day')
await asM1(`update employees set holiday_calendar_id=$1 where id=$2`, [national.id, U(301)])
ok('employee calendar comes first', (await rules(id.e1)).holiday_calendar?.source === 'employee')
ok('a calendar in use cannot be deleted', await err(() => asM1(`delete from holiday_calendars where id=$1`, [national.id])) === '23503')
ok('no schedule and no calendar when the organization has none', await (async () => {
  const rb = await rules(id.bEmp)
  return rb.schedule === null && rb.holiday_calendar === null && rb.holidays.length === 0
})())
await as(id.bAdmin, () => q(`insert into shifts (name, start_time, end_time, is_default) values ('Beta Day','08:00','17:00', true)`))
ok('each organization has its own default', (await rules(id.bEmp)).schedule?.name === 'Beta Day'
  && (await q(`select count(*)::int n from shifts where organization_id=$1 and is_default`, [qvrix]))[0].n === 1)
ok('archived employees get no rules', await rules(id.e3) === null)
ok('accounts without an employee profile get no rules', await rules(id.u9) === null)
ok('anon cannot read rules', await err(() => as(null, () => q(`select my_work_rules()`), 'anon')) === '42501')
ok('rules for other employees are not callable', await err(() => as(id.m1, () => q(`select work_rules_for_employee($1)`, [U(302)]))) === '42501')

// Time-tracking policy: admins only
await db.query(`insert into auth.users (id,email,raw_app_meta_data,email_confirmed_at) values ($1,'mgr@qvrix.test','{}',now())`, [U(56)])
await q(`insert into organization_members (organization_id, user_id, role) values ($1,$2,'manager')`, [qvrix, U(56)])
ok('managers cannot set the policy', await err(() => as(U(56), () => q(`insert into time_tracking_policies (early_clock_in_minutes, organization_id) values (15,$1)`, [qvrix]))) === '42501')
const orgPolicy = (await asM1(`insert into time_tracking_policies (early_clock_in_minutes, require_inside_site, auto_clock_out_after_minutes, updated_by) values (15, true, 720, $1) returning *`, [id.m2]))[0]
ok('policy stamped with the organization and the real editor', orgPolicy.organization_id === qvrix && orgPolicy.updated_by === id.m1)
ok('one organization policy', await err(() => asM1(`insert into time_tracking_policies (early_clock_in_minutes) values (5)`)) === '23505')
ok('policy values checked', await err(() => asM1(`insert into time_tracking_policies (department_id, auto_clock_out_after_minutes) values ($1, 10)`, [U(102)])) === '23514')
r1 = await rules(id.e1)
ok('organization policy applies', r1.policy.source === 'organization' && r1.policy.early_clock_in_minutes === 15 && r1.policy.require_inside_site === true)
await asM1(`insert into time_tracking_policies (department_id, block_outside_schedule) values ($1, true)`, [U(101)])
r1 = await rules(id.e1)
ok('department policy replaces it whole', r1.policy.source === 'department' && r1.policy.block_outside_schedule === true && r1.policy.early_clock_in_minutes === null)
ok('one policy per department', await err(() => asM1(`insert into time_tracking_policies (department_id) values ($1)`, [U(101)])) === '23505')
ok('managers cannot change it', await n(U(56), `with u as (update time_tracking_policies set early_clock_in_minutes=0 returning 1) select count(*)::int n from u`) === 0)
ok('supervisors read the policy', await n(id.aSup, `select count(*)::int n from time_tracking_policies`) === 2)
ok('other organizations cannot see it', await n(id.bAdmin, `select count(*)::int n from time_tracking_policies`) === 0)
ok('department policy cannot name another organization department', await err(() => as(id.bAdmin, () => q(`insert into time_tracking_policies (department_id) values ($1)`, [U(101)]))) === '23503')
ok('employees do not read policies directly', await n(id.e1, `select count(*)::int n from time_tracking_policies`) === 0)
ok('schedule, calendar and policy changes audited', (await q(`select count(distinct table_name)::int n from audit_logs
  where organization_id=$1 and table_name in ('shifts','holiday_calendars','holidays','time_tracking_policies')`, [qvrix]))[0].n === 4)

// T13 timesheets and corrections, on fixed past weeks in India time (UTC+05:30)
const ist = (date, hm) => new Date(`${date}T${hm}:00+05:30`).getTime()
await db.query(`insert into auth.users (id,email,raw_app_meta_data,email_confirmed_at) values ($1,'ts@qvrix.test','{}',now()),($2,'night@qvrix.test','{}',now())`, [U(60), U(61)])
const tsShift = (await asM1(`insert into shifts (name, start_time, end_time, working_days, day_times, breaks,
    auto_break_minutes, auto_break_after_minutes, overtime_daily_after_minutes, overtime_daily_rate,
    overtime_double_after_minutes, overtime_double_rate, overtime_weekly_after_minutes, overtime_weekly_rate,
    overtime_rest_day_rate, overtime_holiday_rate)
  values ('TS Day','09:00','18:00','{1,2,3,4,5,6}','{"6":{"start":"09:00","end":"13:00"}}',
    '[{"name":"Lunch","minutes":60,"paid":false,"start":"13:00","end":"14:00"},{"name":"Tea","minutes":15,"paid":true}]',
    30, 360, 540, 1.5, 600, 2, 1200, 1.5, 2, 2.5) returning id`))[0].id
const tsCal = (await asM1(`insert into holiday_calendars (name) values ('TS Cal') returning id`))[0].id
await asM1(`insert into holidays (calendar_id, holiday_date, name) values ($1,'2026-10-22','Test Holiday')`, [tsCal])
const tsEmp = U(360), nightEmp = U(361)
await q(`insert into employees (id, user_id, first_name, last_name, email, organization_id, shift_id, holiday_calendar_id, created_at) values
  ($1,$2,'Time','Sheet','ts@qvrix.test',$3,$4,$5,'2026-01-01'), ($6,$7,'Night','Guard','night@qvrix.test',$3,$8,$5,'2026-01-01')`,
  [tsEmp, U(60), qvrix, tsShift, tsCal, nightEmp, U(61), night.id])
for (const [day, from, to, site] of [
  ['2026-10-19', '08:30', '18:10', U(201)], ['2026-10-20', '09:20', '21:30', U(201)],
  ['2026-10-21', '09:00', '12:00', U(201)], ['2026-10-21', '11:00', '15:00', U(202)],
  ['2026-10-22', '10:00', '14:00', U(201)], ['2026-10-24', '09:00', '13:00', U(201)],
  ['2026-10-25', '10:00', '12:00', U(201)], ['2026-10-26', '09:00', null, U(201)],
  ['2026-10-27', '09:00', '17:00', U(201)], ['2026-10-28', '09:00', '18:00', U(201)],
  ['2026-10-30', '06:00', '12:30', U(201)],
]) await q(`insert into presence_sessions (user_id, site_id, entry_timestamp, exit_timestamp) values ($1,$2,$3,$4)`,
  [U(60), site, ist(day, from), to ? ist(day, to) : null])
await q(`insert into presence_sessions (user_id, site_id, entry_timestamp, exit_timestamp) values ($1,$2,$3,$4)`,
  [U(61), U(201), ist('2026-10-19', '22:00'), ist('2026-10-20', '06:00')])
const sessionAt = async (day, hm) => (await q(`select id from presence_sessions where user_id=$1 and entry_timestamp=$2`, [U(60), ist(day, hm)]))[0].id
const sheet = async (uid, from, to, ids = [tsEmp], org = qvrix) => Object.fromEntries((await as(uid, () =>
  q(`select t.*, t.work_date::text as day from timesheet_days($1,$2,$3,$4) t`, [org, from, to, ids]))).map((d) => [d.day, d]))
// tracked, break, payroll, planned, regular, daily, double, weekly, rest day, holiday, late, early out
const figures = (d) => [d.tracked_minutes, d.break_minutes, d.payroll_minutes, d.planned_minutes, d.regular_minutes,
  d.overtime_daily_minutes, d.overtime_double_minutes, d.overtime_weekly_minutes, d.overtime_rest_day_minutes,
  d.overtime_holiday_minutes, d.late_minutes, d.early_out_minutes].join()
const added = (await asM1(`select add_time_entry($1,$2,'2026-10-24 14:00','2026-10-24 16:00','Worked at the office after the site visit') id`, [tsEmp, U(201)]))[0].id
const w1 = await sheet(id.m1, '2026-10-19', '2026-10-25')
ok('one row per day', Object.keys(w1).length === 7)
ok('early arrival: lunch window deducted, early check-in flagged', figures(w1['2026-10-19']) === '580,60,520,480,520,0,0,0,0,0,0,0'
  && w1['2026-10-19'].flags.includes('early_check_in'), figures(w1['2026-10-19']) + ' ' + w1['2026-10-19'].flags)
ok('late, and capped at 12 h by the automatic check-out; daily and double overtime', figures(w1['2026-10-20']) === '720,60,660,480,540,60,60,0,0,0,20,0'
  && w1['2026-10-20'].flags.includes('late') && w1['2026-10-20'].flags.includes('auto_check_out'), figures(w1['2026-10-20']) + ' ' + w1['2026-10-20'].flags)
ok('overlapping sessions counted once; weekly overtime starts on the day past 20 h', figures(w1['2026-10-21']) === '360,60,300,480,140,0,0,160,0,0,0,180'
  && w1['2026-10-21'].flags.includes('overlap') && w1['2026-10-21'].flags.includes('early_out'), figures(w1['2026-10-21']) + ' ' + w1['2026-10-21'].flags)
ok('holiday work at the holiday rate', figures(w1['2026-10-22']) === '240,60,180,0,0,0,0,0,0,180,0,0'
  && w1['2026-10-22'].day_type === 'holiday' && w1['2026-10-22'].holiday_name === 'Test Holiday', figures(w1['2026-10-22']))
ok('no check-in on a working day is absent', w1['2026-10-23'].flags.includes('absent') && w1['2026-10-23'].payroll_minutes === 0 && w1['2026-10-23'].planned_minutes === 480)
ok('Saturday half day with an added entry, all weekly overtime', figures(w1['2026-10-24']) === '360,0,360,180,0,0,0,360,0,0,0,0'
  && w1['2026-10-24'].flags.includes('manual') && w1['2026-10-24'].entry_count === 2, figures(w1['2026-10-24']))
ok('rest-day work at the rest-day rate', figures(w1['2026-10-25']) === '120,0,120,0,0,0,0,0,120,0,0,0' && w1['2026-10-25'].day_type === 'rest', figures(w1['2026-10-25']))
const nightDay = (await sheet(id.m1, '2026-10-19', '2026-10-19', [nightEmp]))['2026-10-19']
ok('night shift stays on the day it started; meal window falls after midnight', nightDay.tracked_minutes === 480
  && nightDay.break_minutes === 30 && nightDay.late_minutes === 0 && nightDay.first_in.getTime() === ist('2026-10-19', '22:00'), JSON.stringify(nightDay))

// Corrections
const tue = await sessionAt('2026-10-27', '09:00'), wed = await sessionAt('2026-10-28', '09:00')
await asM1(`select edit_time_entry($1, null, null, '2026-10-27 09:00', '2026-10-27 18:00', 'Forgot to check out at the end of the day')`, [tue])
await asM1(`select remove_time_entry($1, null, 'Checked in on a colleague''s phone by mistake')`, [wed])
let w2 = await sheet(id.m1, '2026-10-26', '2026-10-30')
ok('open session closed by the policy after 12 h', figures(w2['2026-10-26']) === '720,60,660,480,540,60,60,0,0,0,0,0'
  && w2['2026-10-26'].flags.includes('auto_check_out'), figures(w2['2026-10-26']) + ' ' + w2['2026-10-26'].flags)
ok('corrected session uses the manager times', w2['2026-10-27'].tracked_minutes === 540 && w2['2026-10-27'].payroll_minutes === 480
  && w2['2026-10-27'].flags.includes('manual'), figures(w2['2026-10-27']))
ok('removed session no longer counts', w2['2026-10-28'].payroll_minutes === 0 && w2['2026-10-28'].flags.includes('absent'))
ok('automatic break on a long day without lunch; weekly overtime by Friday', figures(w2['2026-10-30']) === '390,30,360,480,180,0,0,180,0,0,0,330'
  && w2['2026-10-30'].flags.includes('early_check_in'), figures(w2['2026-10-30']))
const entries = await as(id.m1, () => q(`select * from timesheet_entries($1,$2,'2026-10-26','2026-10-30')`, [qvrix, tsEmp]))
const corrected = entries.find((e) => e.session_id === tue)
ok('entries show what the app recorded beside the correction', corrected.status === 'corrected'
  && Number(corrected.recorded_end) === ist('2026-10-27', '17:00') && Number(corrected.end_at) === ist('2026-10-27', '18:00'), JSON.stringify(corrected))
ok('removed and open entries are listed with their state', entries.find((e) => e.session_id === wed)?.status === 'removed'
  && entries.find((e) => e.status === 'recorded' && e.end_at === null)?.end_state === 'auto_check_out')
ok('removing twice is refused', await err(() => asM1(`select remove_time_entry($1, null, 'Again')`, [wed])) === '22023')
await asM1(`select restore_time_entry($1, 'Was a real visit after all')`, [wed])
w2 = await sheet(id.m1, '2026-10-26', '2026-10-30')
ok('restored session counts again', w2['2026-10-28'].payroll_minutes === 480 && !w2['2026-10-28'].flags.includes('absent'))
ok('nothing left to restore', await err(() => asM1(`select restore_time_entry($1, 'Again')`, [wed])) === '22023')
const edited = (await asM1(`select edit_time_entry(null, $1, null, '2026-10-24 14:00', '2026-10-24 17:00', 'Stayed until five') id`, [added]))[0].id
const chain = await q(`select id, supersedes_id, voided_at is not null as voided, void_reason from time_entry_corrections where id in ($1,$2)`, [added, edited])
ok('editing an added entry voids it and links the new one', chain.find((c) => c.id === added).voided
  && chain.find((c) => c.id === edited).supersedes_id === added && !chain.find((c) => c.id === edited).voided, JSON.stringify(chain))
ok('an old version cannot be edited', await err(() => asM1(`select edit_time_entry(null, $1, null, '2026-10-24 14:00', '2026-10-24 15:00', 'Stale edit')`, [added])) === '22023')
ok('the timesheet follows the latest version', (await sheet(id.m1, '2026-10-24', '2026-10-24'))['2026-10-24'].tracked_minutes === 420)
await asM1(`select remove_time_entry(null, $1, 'Entered for the wrong person')`, [edited])
ok('withdrawn entry no longer counts', (await sheet(id.m1, '2026-10-24', '2026-10-24'))['2026-10-24'].tracked_minutes === 240)
ok('history keeps every version', (await q(`select count(*)::int n from time_entry_corrections where employee_id=$1`, [tsEmp]))[0].n === 4
  && (await q(`select count(*)::int n from time_entry_corrections where employee_id=$1 and voided_at is null`, [tsEmp]))[0].n === 1)
const addErr = (start, end, reason = 'A valid reason') => err(() => asM1(`select add_time_entry($1,$2,$3,$4,$5)`, [tsEmp, U(201), start, end, reason]))
ok('reason required', await addErr('2026-10-29 09:00', '2026-10-29 10:00', 'x') === '22023')
ok('end after start', await addErr('2026-10-29 10:00', '2026-10-29 09:00') === '22023')
ok('at most 24 hours', await addErr('2026-10-29 09:00', '2026-10-30 10:00') === '22023')
ok('not in the future', await addErr('2099-01-01 09:00', '2099-01-01 10:00') === '22023')
ok('site from another organization refused', await err(() => asM1(`select add_time_entry($1,$2,'2026-10-29 09:00','2026-10-29 10:00','Wrong site')`, [tsEmp, bSite.id])) === '23503')
ok('supervisors cannot correct', await err(() => as(id.aSup, () => q(`select add_time_entry($1,$2,'2026-10-29 09:00','2026-10-29 10:00','Not allowed')`, [tsEmp, U(201)]))) === '42501')
ok('other organizations cannot correct', await err(() => as(id.bAdmin, () => q(`select add_time_entry($1,$2,'2026-10-29 09:00','2026-10-29 10:00','Not allowed')`, [tsEmp, U(201)]))) === '42501'
  && await err(() => as(id.bAdmin, () => q(`select remove_time_entry($1, null, 'Not allowed')`, [tue]))) === '42501')
ok('corrections cannot be written directly', await err(() => asM1(`insert into time_entry_corrections (organization_id, employee_id, kind, start_at, end_at, reason) values ($1,$2,'add',now() - interval '2 hours',now() - interval '1 hour','Direct')`, [qvrix, tsEmp])) === '42501')
ok('corrections readable by supervisors, not other organizations', await n(id.aSup, `select count(*)::int n from time_entry_corrections`) === 4
  && await n(id.bAdmin, `select count(*)::int n from time_entry_corrections`) === 0)
ok('corrections audited', (await q(`select count(*)::int n from audit_logs where table_name='time_entry_corrections' and organization_id=$1`, [qvrix]))[0].n >= 7)

// Who can read timesheets
ok('supervisors read timesheets', Object.keys(await sheet(id.aSup, '2026-10-19', '2026-10-25')).length === 7)
ok('other organizations cannot', await err(() => sheet(id.bAdmin, '2026-10-19', '2026-10-25')) === '42501')
ok('employees cannot read the team timesheet', await err(() => sheet(U(60), '2026-10-19', '2026-10-25')) === '42501')
ok('anon cannot', await err(() => as(null, () => q(`select * from timesheet_days($1,'2026-10-19','2026-10-25')`, [qvrix]), 'anon')) === '42501')
ok('range limited to 63 days', await err(() => sheet(id.m1, '2026-01-01', '2026-10-25')) === '22023' && await err(() => sheet(id.m1, '2026-10-25', '2026-10-19')) === '22023')
ok('internal calculation not callable', await err(() => asM1(`select * from compute_timesheet($1,'2026-10-19','2026-10-25',null)`, [qvrix])) === '42501')
const mine = await as(U(60), () => q(`select * from my_timesheet('2026-10-19','2026-10-25')`))
ok('employees read their own timesheet', mine.length === 7 && mine.every((d) => d.employee_id === tsEmp) && mine.reduce((s, d) => s + d.payroll_minutes, 0) === 2020)
ok('and their own entries', (await as(U(60), () => q(`select * from my_timesheet_entries('2026-10-26','2026-10-30')`))).some((e) => e.status === 'corrected'))
ok('accounts without an employee profile have no timesheet', await err(() => as(id.u9, () => q(`select * from my_timesheet('2026-10-19','2026-10-25')`))) === '42501')
await q(`update employees set created_at='2026-01-01' where id=$1`, [U(303)])
const teamOn = async (day) => (await as(id.m1, () => q(`select distinct employee_id from timesheet_days($1,$2,$2)`, [qvrix, day]))).map((r) => r.employee_id)
const tomorrow = new Date(Date.now() + 5.5 * H + 24 * H).toISOString().slice(0, 10)
ok('whole-team timesheet keeps archived employees for days before they left, not after', (await teamOn('2026-10-19')).includes(U(303))
  && !(await teamOn(tomorrow)).includes(U(303)) && (await teamOn(tomorrow)).includes(tsEmp))

// Nobody is absent before they joined
const joiners = await q(`insert into employees (first_name, last_name, email, organization_id, shift_id, hire_date, created_at) values
  ('New','Joiner','joiner@qvrix.test',$1,$2,null,now()), ('Mid','Week','midweek@qvrix.test',$1,$2,'2026-10-21','2026-01-01') returning id`, [qvrix, tsShift])
const joinerDays = async (empId) => Object.keys(await sheet(id.m1, '2026-10-19', '2026-10-25', [empId]))
ok('an employee added today has no earlier days', (await joinerDays(joiners[0].id)).length === 0)
ok('days before the hire date are left out', (await joinerDays(joiners[1].id)).join() === '2026-10-21,2026-10-22,2026-10-23,2026-10-24,2026-10-25')
await asM1(`select add_time_entry($1, null, '2026-10-19 09:00', '2026-10-19 12:00', 'Trial day before joining')`, [joiners[1].id])
ok('a day with recorded time is shown even before the hire date', (await joinerDays(joiners[1].id))[0] === '2026-10-19')

// Open sessions without a policy, and sessions in progress
await q(`insert into presence_sessions (user_id, site_id, entry_timestamp) values ($1,$2,$3)`, [id.bEmp, bSite.id, ist('2026-10-20', '08:00')])
const betaDay = (await sheet(id.bAdmin, '2026-10-20', '2026-10-20', [bEmpRow.id], beta))['2026-10-20']
ok('open session with no automatic check-out is reported, not counted', betaDay.flags.includes('missing_check_out')
  && betaDay.tracked_minutes === 0 && !betaDay.flags.includes('absent'), JSON.stringify(betaDay))
const istToday = new Date(Date.now() + 5.5 * H).toISOString().slice(0, 10)
const istYesterday = new Date(Date.now() + 5.5 * H - 24 * H).toISOString().slice(0, 10)
const live = Object.values(await sheet(id.m1, istYesterday, istToday, [U(301)])).find((d) => d.flags.includes('in_progress'))
ok('a session in progress counts up to now', live && live.tracked_minutes >= 290 && live.tracked_minutes <= 310 && live.last_out === null, JSON.stringify(live))

// T14 self-service organizations and setup progress
const access = async (uid) => (await as(uid, () => q(`select public.my_console_access() a`)))[0].a
const createOrg = (uid, name, tz = 'Asia/Kolkata', country = 'in') => as(uid, () => q(`select create_my_organization($1,$2,$3) id`, [name, tz, country]))
ok('organizations that already existed are set up', (await q(`select onboarding_step, onboarding_completed_at is not null as done from organizations where id=$1`, [qvrix]))[0].done)
ok('a platform-created organization starts setup', (await q(`select onboarding_step from organizations where id=$1`, [beta]))[0].onboarding_step === 'company')
await db.query(`insert into auth.users (id,email,raw_app_meta_data,email_confirmed_at) values
  ($1,'owner@acme.test','{}',now()), ($2,'pending@acme.test','{}',null), ($3,'second@acme.test','{}',now())`, [U(70), U(71), U(72)])
ok('unconfirmed accounts cannot create an organization', (await access(U(71))).can_create_organization === false
  && await err(() => createOrg(U(71), 'Pending Co')) === '42501')
ok('a confirmed account without a role can', (await access(U(70))).can_create_organization === true)
ok('confirmed members and employees may create their own organization', (await access(id.m1)).can_create_organization === true
  && (await access(id.e1)).can_create_organization === true && (await access(U(60))).can_create_organization === true)
ok('platform admins use the platform organization tool', (await access(id.p1)).can_create_organization === false)
const personalOrg = (await createOrg(U(60), 'Side Business'))[0].id
ok('employee creation grants admin only in the new organization',
  (await q(`select organization_id from organization_members where user_id=$1 and is_active`, [U(60)])).every(row => row.organization_id === personalOrg)
  && (await q(`select organization_id from employees where user_id=$1`, [U(60)]))[0].organization_id === qvrix)
ok('a former, archived employee can', (await access(id.e3)).can_create_organization === true)
ok('a name is required', await err(() => createOrg(U(70), ' x ')) === '22023')
ok('the time zone is checked', await err(() => createOrg(U(70), 'Acme Facilities', 'Mars/Base')) === '22023')
const acme = (await createOrg(U(70), 'Acme Facilities'))[0].id
const acmeRow = (await q(`select * from organizations where id=$1`, [acme]))[0]
ok('creator becomes the admin of a new organization', acmeRow.slug === 'acme-facilities' && acmeRow.created_by === U(70)
  && acmeRow.country_code === 'IN' && acmeRow.onboarding_step === 'company' && acmeRow.onboarding_completed_at === null
  && (await q(`select role from organization_members where organization_id=$1 and user_id=$2`, [acme, U(70)]))[0]?.role === 'org_admin')
const ownerAccess = await access(U(70))
ok('access lists the new organization with its setup step', ownerAccess.organizations.length === 1
  && ownerAccess.organizations[0].role === 'org_admin' && ownerAccess.organizations[0].onboarding_step === 'company'
  && ownerAccess.can_create_organization === false, JSON.stringify(ownerAccess))
ok('one organization per account', await err(() => createOrg(U(70), 'Acme Two')) === '42501')
const twin = (await createOrg(U(72), 'Acme Facilities!'))[0].id
ok('the same name gets its own identifier', /^acme-facilities-[0-9a-f]{5}$/.test((await q(`select slug from organizations where id=$1`, [twin]))[0].slug))
const asOwner = (sql, params) => as(U(70), () => q(sql, params))
ok('the admin saves company details and progress', await err(() => asOwner(`update organizations set industry='facility_management', team_size='11-50', onboarding_step='schedule' where id=$1`, [acme])) === null)
ok('unknown industry rejected', await err(() => asOwner(`update organizations set industry='space' where id=$1`, [acme])) === '23514')
ok('the creator cannot be rewritten', await err(() => asOwner(`update organizations set created_by=$2 where id=$1`, [acme, U(72)])) === '42501')
ok('other organizations cannot change it', await n(id.m1, `with u as (update organizations set onboarding_step='done' where id='${acme}' returning 1) select count(*)::int n from u`) === 0)
ok('other organizations cannot see it', await n(id.m1, `select count(*)::int n from organizations where id='${acme}'`) === 0)
const acmeShift = (await asOwner(`insert into shifts (name, start_time, end_time, is_default) values ('General','09:00','18:00',true) returning organization_id`))[0]
const acmeSite = (await asOwner(`insert into sites (name, latitude, longitude, radius_in_meters) values ('Acme HQ',12.9,77.6,300) returning organization_id`))[0]
await asOwner(`insert into time_tracking_policies (auto_clock_out_after_minutes) values (720)`)
await asOwner(`insert into employees (first_name, last_name, email) values ('Ravi','Kumar','ravi@acme.test')`)
ok('setup records land in the new organization', acmeShift.organization_id === acme && acmeSite.organization_id === acme
  && (await q(`select count(*)::int n from employees where organization_id=$1`, [acme]))[0].n === 1)
ok('the invited employee sees the new organization by name', (await (async () => {
  await db.query(`insert into auth.users (id,email,raw_app_meta_data,email_confirmed_at) values ($1,'ravi@acme.test','{}',now())`, [U(73)])
  return (await as(U(73), () => q(`select organization_name from my_employee_invitations()`))).map((r) => r.organization_name)
})()).includes('Acme Facilities'))
ok('finishing setup', (await asOwner(`update organizations set onboarding_step='done', onboarding_completed_at=now() where id=$1 returning onboarding_completed_at`, [acme]))[0].onboarding_completed_at !== null)
ok('creation audited in the new organization', (await q(`select count(*)::int n from audit_logs where table_name in ('organizations','organization_members') and organization_id=$1`, [acme]))[0].n >= 2)
ok('anon cannot create organizations', await err(() => as(null, () => q(`select create_my_organization('Anon Co','Asia/Kolkata')`), 'anon')) === '42501')
ok('the eligibility check is not callable directly', await err(() => as(U(72), () => q(`select can_create_organization()`))) === '42501')

// T15 access guidance: only the caller's server-verified status is exposed.
ok('a linked employee may create an organization without a blocking error', (await access(id.e1)).access_block_reason === null)
ok('an unconfirmed account gets email guidance', (await access(U(71))).access_block_reason === 'confirm_email')
await db.query(`insert into auth.users (id,email,raw_app_meta_data,email_confirmed_at)
  values ($1,'brand-new@acme.test','{}',now())`, [U(74)])
ok('a new confirmed account has no access blocker', (await access(U(74))).access_block_reason === null
  && (await access(U(74))).can_create_organization === true)
ok('a pending employee invitation does not mislabel an unlinked account', (await access(U(73))).access_block_reason === null)
await db.query(`update organization_members set is_active=false where organization_id=$1 and user_id=$2`, [acme, U(70)])
ok('an owner whose membership was removed gets restoration guidance', (await access(U(70))).access_block_reason === 'organization_unavailable'
  && (await access(U(70))).organizations.length === 0 && (await access(U(70))).can_create_organization === false)
await db.query(`update organization_members set is_active=true where organization_id=$1 and user_id=$2`, [acme, U(70)])
ok('restoring membership restores the workspace', (await access(U(70))).organizations.some(o => o.id === acme))
ok('anonymous callers cannot inspect account access', await err(() => as(null, () => q(`select my_console_access()`), 'anon')) === '42501')

// T16 personal member access and web attendance. Synthetic accounts, never a live email override.
await db.query(`insert into auth.users (id,email,raw_app_meta_data,email_confirmed_at) values
  ($1,'web-member@acme.test','{}',now()),($2,'outsider@acme.test','{}',now())`, [U(80), U(81)])
const memberEmployee = (await q(`insert into employees (organization_id,user_id,first_name,last_name,email)
  values ($1,$2,'Web','Member','web-member@acme.test') returning id`, [acme, U(80)]))[0].id
const acmeSiteId = (await q(`select id from sites where organization_id=$1 limit 1`, [acme]))[0].id
await q(`insert into employee_sites (employee_id,site_id) values ($1,$2)`, [memberEmployee, acmeSiteId])
const webClock = (uid, action, site = acmeSiteId, lat = 12.9, lng = 77.6, accuracy = 5) =>
  as(uid, () => q(`select web_clock($1,$2,$3,$4,$5) id`, [action, site, lat, lng, accuracy]))
const memberRows = await as(U(80), () => q(`select e.id,o.name from employees e join organizations o on o.id=e.organization_id where e.user_id=$1 and e.is_active`, [U(80)]))
ok('a member reads their profile and organization without a console role', memberRows.length === 1 && memberRows[0].id === memberEmployee)
ok('a member cannot read the team employee directory', await n(U(80), `select count(*)::int n from employees`) === 1)
ok('an outsider cannot clock in', await err(() => webClock(U(81), 'in')) === '42501')
ok('a member cannot clock into a foreign site', await err(() => webClock(U(80), 'in', U(201))) === '42501')
ok('location is required', await err(() => webClock(U(80), 'in', acmeSiteId, null)) === '22023')
ok('invalid GPS is rejected', await err(() => webClock(U(80), 'in', acmeSiteId, 100)) === '22023')
ok('nonfinite GPS is rejected', await err(() => webClock(U(80), 'in', acmeSiteId, 'NaN')) === '22023')
await q(`update time_tracking_policies set require_inside_site=true where organization_id=$1`, [acme])
ok('outside a required fence is rejected', await err(() => webClock(U(80), 'in', acmeSiteId, 13.5)) === '42501')
ok('uncertain accuracy extending beyond the fence is rejected', await err(() => webClock(U(80), 'in', acmeSiteId, 12.9, 77.6, 1000)) === '42501')
await q(`update time_tracking_policies set lock_to_registered_device=true where organization_id=$1`, [acme])
ok('registered-device policy requires the employee app', await err(() => webClock(U(80), 'in')) === '42501')
await q(`update time_tracking_policies set lock_to_registered_device=false, block_outside_schedule=true where organization_id=$1`, [acme])
await q(`update shifts set working_days=array[1]::smallint[] where organization_id=$1`, [acme])
// A schedule starting next week cannot allow today's clock-in, including overnight/early windows.
await q(`update shifts set working_days=array[((extract(isodow from now() at time zone 'Asia/Kolkata')::int + 2) % 7) + 1]::smallint[] where organization_id=$1`, [acme])
ok('outside the work schedule is rejected', await err(() => webClock(U(80), 'in')) === '42501')
await q(`update shifts set working_days=array[1,2,3,4,5,6,7]::smallint[], day_times='{}', day_split_time='00:00',
  start_time=((now() at time zone 'Asia/Kolkata') - interval '1 hour')::time,
  end_time=((now() at time zone 'Asia/Kolkata') + interval '1 hour')::time where organization_id=$1`, [acme])
ok('the current fixed schedule window permits clock-in', await err(() => webClock(U(80), 'in')) === null)
await webClock(U(80), 'out')
await q(`update shifts set start_time=((now() at time zone 'Asia/Kolkata') + interval '2 hours')::time,
  end_time=((now() at time zone 'Asia/Kolkata') + interval '3 hours')::time where organization_id=$1`, [acme])
await q(`update time_tracking_policies set early_clock_in_minutes=10 where organization_id=$1`, [acme])
ok('early clock-in before the configured window is rejected', await err(() => webClock(U(80), 'in')) === '42501')
await q(`update time_tracking_policies set early_clock_in_minutes=180 where organization_id=$1`, [acme])
ok('the configured early clock-in window permits attendance', await err(() => webClock(U(80), 'in')) === null)
await webClock(U(80), 'out')
await q(`update time_tracking_policies set early_clock_in_minutes=null where organization_id=$1`, [acme])
await q(`update time_tracking_policies set block_outside_schedule=false where organization_id=$1`, [acme])
const webId = (await webClock(U(80), 'in'))[0].id
const webRow = (await q(`select * from presence_sessions where id=$1`, [webId]))[0]
ok('web clock-in records the caller with server time', webRow.user_id === U(80) && webRow.organization_id === acme && webRow.site_id === acmeSiteId
  && Math.abs(Number(webRow.entry_timestamp) - Date.now()) < 30000)
ok('web clock-in records a GPS observation', (await q(`select count(*)::int n from location_logs where user_id=$1 and site_id=$2 and timestamp=$3`, [U(80), acmeSiteId, webRow.entry_timestamp]))[0].n >= 1)
ok('duplicate clock-in is rejected', await err(() => webClock(U(80), 'in')) === '22023')
await q(`update presence_sessions set last_heartbeat=0 where id=$1`, [webId])
ok('web heartbeat keeps only the caller shift active', await err(() => webClock(U(80), 'heartbeat', null, null, null, null)) === null
  && (await q(`select last_heartbeat from presence_sessions where id=$1`, [webId]))[0].last_heartbeat > 0)
ok('an outsider cannot heartbeat another member shift', await err(() => webClock(U(81), 'heartbeat', null, null, null, null)) === '42501')
await q(`delete from employee_sites where employee_id=$1`, [memberEmployee])
await q(`update time_tracking_policies set lock_to_registered_device=true where organization_id=$1`, [acme])
ok('clock-out works after site removal or a device policy change', await err(() => webClock(U(80), 'out', null, null, null, null)) === null)
const closedWeb = (await q(`select exit_timestamp,closed_by,total_hours from presence_sessions where id=$1`, [webId]))[0]
ok('web clock-out computes hours and attributes the caller', closedWeb.exit_timestamp !== null && closedWeb.closed_by === 'employee' && closedWeb.total_hours >= 0)
ok('a member cannot read another member session', await n(U(81), `select count(*)::int n from presence_sessions where id=${webId}`) === 0)
ok('web attendance denies anonymous calls', await err(() => as(null, () => q(`select web_clock('in')`), 'anon')) === '42501')
await q(`update employees set is_active=false where id=$1`, [memberEmployee])
ok('archived members cannot record web attendance', await err(() => webClock(U(80), 'in')) === '42501')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
