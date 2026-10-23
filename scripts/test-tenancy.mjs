import { PGlite } from '@electric-sql/pglite'
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const db = new PGlite({ extensions: { uuid_ossp } })
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
let checks = 0
const query = async (text, params=[]) => (await db.query(text,params)).rows
const asUser = async (user,text,params=[]) => db.transaction(async tx => {
 await tx.query(`select set_config('request.jwt.claim.sub',$1,true)`,[user])
 await tx.exec('set local role authenticated')
 return (await tx.query(text,params)).rows
})
async function denied(user,text,params=[]) { await assert.rejects(asUser(user,text,params)); checks++ }
async function count(user,table,org,expected) { const rows=await asUser(user,`select * from public.${table} where organization_id=$1`,[org]); assert.equal(rows.length,expected,table); checks++ }
try {
 await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}'); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`)
 for(const file of ['20260820000000_admin_schema.sql','20260821000000_employee_sites_fixes.sql']) await db.exec(await readFile('supabase/migrations/'+file,'utf8'))
 for(let n=1;n<=10;n++)await query(`insert into auth.users values($1,$2,now(),$3)`,[id(n),`user${n}@example.test`,{role:'manager'}])
 await query(`insert into public.sites(id,name,latitude,longitude) values($1,'Legacy site',10,20)`,[id(200)])
 await query(`insert into public.employees(id,user_id,first_name,last_name,email) values($1,$2,'Legacy','Employee','user4@example.test')`,[id(300),id(4)])
 await query(`insert into public.employee_sites(employee_id,site_id) values($1,$2)`,[id(300),id(200)])
 await query(`insert into public.location_logs(user_id,site_id,latitude,longitude,accuracy,distance_to_site,timestamp,is_inside) values($1,$2,10,20,5,0,1000,true)`,[id(4),id(200)])
 await db.exec(await readFile('supabase/migrations/20261023000000_organizations.sql','utf8'))
 await db.exec(await readFile('supabase/migrations/20261023010000_organization_management.sql','utf8'))
 // Validate the owner diagnostic against the migrated catalog, including SQL syntax.
 await db.exec(await readFile('supabase/diagnose-organization-access.sql','utf8'))
 const membershipColumns = await query(`select column_name from information_schema.columns where table_schema='public' and table_name='organization_memberships' order by ordinal_position`)
 assert.deepEqual(membershipColumns.map(row=>row.column_name), ['organization_id','user_id','role','status','created_at','updated_at']); checks++
 assert.equal((await query(`select relrowsecurity as enabled from pg_class where oid='public.organization_memberships'::regclass`))[0].enabled,true); checks++
 for(const [role,privilege,expected] of [['authenticated','SELECT',true],['authenticated','INSERT',false],['authenticated','UPDATE',false],['authenticated','DELETE',false],['anon','SELECT',false]]) {
  assert.equal((await query(`select has_table_privilege($1,'public.organization_memberships',$2) as allowed`,[role,privilege]))[0].allowed,expected); checks++
 }
 // Match the console's select=*&user_id=eq.<authenticated UUID> query.
 const ownMemberships = await asUser(id(4),'select * from public.organization_memberships where user_id=$1',[id(4)])
 assert.equal(ownMemberships.length,1); assert.equal(ownMemberships[0].user_id,id(4)); checks++
 assert.equal((await query('select organization_id from public.sites where id=$1',[id(200)]))[0].organization_id,id(1)); checks++
 assert.equal((await query('select role from organization_memberships where user_id=$1',[id(1)]))[0].role,'employee'); checks++
 const A=id(100),B=id(101),siteA=id(201),siteB=id(202),hiddenSite=id(203),empA=id(301),empB=id(302),hiddenEmployee=id(303)
 // Execute the actual owner bootstrap twice: no duplicate admin or membership rows.
 await query(`select set_config('crewtraxa.bootstrap_user_id',$1,false)`,[id(1)])
 const bootstrap = await readFile('supabase/bootstrap-super-admin.sql','utf8')
 await db.exec(bootstrap)
 await db.exec(bootstrap)
 assert.equal((await query('select count(*)::int as n from crewtraxa_private.platform_admins'))[0].n,1); checks++
 assert.equal((await query('select count(*)::int as n from organization_memberships where user_id=$1',[id(1)]))[0].n,1); checks++
 assert.equal((await asUser(id(1),'select is_platform_admin() as allowed'))[0].allowed,true); checks++
 assert.equal((await asUser(id(2),'select is_platform_admin() as allowed'))[0].allowed,false); checks++
 // A newly registered identity has no membership even if it forges role metadata.
 await query(`insert into auth.users values($1,'outsider@example.test',now(),'{"role":"platform_super_admin"}')`,[id(11)])
 assert.equal((await asUser(id(11),'select is_platform_admin() as allowed'))[0].allowed,false); checks++
 assert.equal((await asUser(id(11),'select * from organizations')).length,0); checks++
 assert.equal((await asUser(id(11),'select * from organization_memberships')).length,0); checks++
 await denied(id(11),'select validate_organization_selection($1)',[id(1)])
 await denied(id(11),'insert into crewtraxa_private.platform_admins(user_id) values($1)',[id(11)])
 // Exercise the organization lifecycle and first membership through real RPCs.
 const created = (await asUser(id(1),`select to_jsonb(save_organization(null,'Lifecycle test','active','UTC')) as organization`))[0].organization
 await denied(id(11),`select save_organization(null,'Unauthorized','active','UTC')`)
 await asUser(id(1),`select manage_organization_member($1,$2,'organization_admin','active')`,[created.id,id(2)]); checks++
 assert.equal((await asUser(id(2),'select validate_organization_selection($1) as role',[created.id]))[0].role,'organization_admin'); checks++
 await denied(id(2),`select save_organization($1,'Forbidden edit','active','UTC')`,[created.id])
 await denied(id(2),`select manage_organization_member($1,$2,'employee','active')`,[created.id,id(2)])
 await denied(id(2),`select manage_organization_member($1,$2,'platform_super_admin','active')`,[created.id,id(11)])
 await denied(id(2),`select manage_organization_member($1,$2,'employee','active')`,[created.id,id(999)])
 await query(`insert into auth.users(id,email) values($1,'unverified@example.test')`,[id(12)])
 await denied(id(2),`select manage_organization_member($1,$2,'employee','active')`,[created.id,id(12)])
 await asUser(id(2),`select manage_organization_member($1,$2,'employee','active')`,[created.id,id(11)]); checks++
 await asUser(id(2),`select manage_organization_member($1,$2,'employee','suspended')`,[created.id,id(11)])
 await denied(id(11),'select validate_organization_selection($1)',[created.id])
 await asUser(id(2),`select manage_organization_member($1,$2,'employee','active')`,[created.id,id(11)])
 assert.equal((await asUser(id(11),'select validate_organization_selection($1) as role',[created.id]))[0].role,'employee'); checks++
 await asUser(id(1),`select save_organization($1,'Renamed lifecycle test','suspended','Asia/Kolkata')`,[created.id]); checks++
 await denied(id(2),'select validate_organization_selection($1)',[created.id])
 const reactivated = (await asUser(id(1),`select to_jsonb(save_organization($1,'Renamed lifecycle test','active','Asia/Kolkata')) as organization`,[created.id]))[0].organization
 assert.equal(reactivated.name,'Renamed lifecycle test'); checks++
 assert.equal((await asUser(id(2),'select validate_organization_selection($1) as role',[created.id]))[0].role,'organization_admin'); checks++
 await query(`insert into organizations(id,name) values($1,'Organization A'),($2,'Organization B')`,[A,B])
 for(const [org,user,role] of [[A,2,'organization_admin'],[A,3,'manager'],[A,4,'employee'],[A,5,'supervisor'],[A,8,'employee'],[B,6,'organization_admin'],[B,7,'employee'],[B,4,'employee']]) await query(`insert into organization_memberships(organization_id,user_id,role) values($1,$2,$3)`,[org,id(user),role])
 await query(`insert into sites(id,organization_id,name,latitude,longitude) values($1,$2,'Site A',10,20),($3,$4,'Site B',30,40),($5,$2,'Unassigned site A',11,21)`,[siteA,A,siteB,B,hiddenSite])
 await query(`insert into employees(id,organization_id,user_id,first_name,last_name,email) values($1,$2,$3,'Employee','A','a@example.test'),($4,$5,$6,'Employee','B','b@example.test'),($7,$2,$8,'Hidden','A','hidden@example.test'),($9,$5,$3,'Employee','AB','ab@example.test')`,[empA,A,id(4),empB,B,id(7),hiddenEmployee,id(8),id(304)])
 await query(`insert into employee_sites(organization_id,employee_id,site_id) values($1,$2,$3),($4,$5,$6),($1,$7,$8),($4,$9,$6)`,[A,empA,siteA,B,empB,siteB,hiddenEmployee,hiddenSite,id(304)])
 for(const user of [3,5])await query(`insert into organization_site_access values($1,$2,$3)`,[A,id(user),siteA])
 for(const [org,user,site] of [[A,4,siteA],[B,7,siteB]]) {
  await query(`insert into location_logs(organization_id,user_id,site_id,latitude,longitude,accuracy,distance_to_site,timestamp,is_inside) values($1,$2,$3,10,20,5,0,1000,true)`,[org,id(user),site])
  await query(`insert into presence_sessions(organization_id,user_id,site_id,entry_timestamp) values($1,$2,$3,1000)`,[org,id(user),site])
 }
 for(const user of [2,3,4,5]) {
  await count(id(user),'sites',B,user===4?1:0)
  await count(id(user),'employees',B,user===4?1:0)
  await count(id(user),'location_logs',B,0)
  await denied(id(user),`insert into sites(organization_id,name,latitude,longitude) values($1,'Injected',0,0)`,[B])
  const changed=await asUser(id(user),`update sites set name='Injected' where id=$1 returning id`,[siteB]); assert.equal(changed.length,0); checks++
 }
 await count(id(3),'sites',A,1); await count(id(5),'employees',A,1); await count(id(4),'employees',A,1)
 assert.equal((await asUser(id(5),`update sites set name='Supervisor write' where id=$1 returning id`,[siteA])).length,0); checks++
 await denied(id(4),`update organization_memberships set role='organization_admin' where user_id=$1`,[id(4)])
 await denied(id(4),`select manage_organization_member($1,$2,'organization_admin','active')`,[A,id(4)])
 await denied(id(2),`select manage_organization_member($1,$2,'organization_admin','active')`,[B,id(2)])
 await denied(id(3),`update employees set user_id=$1 where id=$2`,[id(3),empA])
 await asUser(id(3),`update employees set first_name='Managed' where id=$1`,[empA]); checks++
 await denied(id(2),`insert into employee_sites(organization_id,employee_id,site_id) values($1,$2,$3)`,[A,empA,siteB])
 const packet=`insert into location_logs(organization_id,user_id,site_id,latitude,longitude,accuracy,distance_to_site,timestamp,is_inside) values($1,$2,$3,10,20,5,0,2000,true) returning organization_id`
 await denied(id(4),packet,[B,id(4),siteA]); await denied(id(4),packet,[A,id(7),siteA])
 const inferred=await asUser(id(4),packet,[null,id(4),siteA]); assert.equal(inferred[0].organization_id,A); checks++
 await denied(id(4),packet,[null,id(4),null]); await asUser(id(4),packet,[A,id(4),null]); checks++
 const started=await asUser(id(4),`insert into presence_sessions(user_id,site_id,entry_timestamp) values($1,$2,5000) returning id,organization_id`,[id(4),siteA]); assert.equal(started[0].organization_id,A); checks++
 const closed=await asUser(id(4),`update presence_sessions set exit_timestamp=3605000,total_hours=1,is_synced=true where id=$1 returning organization_id,total_hours`,[started[0].id]); assert.equal(closed[0].organization_id,A); assert.equal(closed[0].total_hours,1); checks++
 await denied(id(4),`update presence_sessions set organization_id=$1 where id=$2`,[B,started[0].id])
 await denied(id(4),`update presence_sessions set site_id=$1 where id=$2`,[siteB,started[0].id])
 await denied(id(1),`select save_organization(null,'Bad branding','active','UTC','{}', '{"display_name":{}}')`)
 await denied(id(1),`select save_organization(null,'Unreadable branding','active','UTC','{}', '{"accent_color":"#ffffff"}')`)
 await denied(id(1),`select save_organization(null,'Bad time zone','active','Invalid/TimeZone')`)
 await denied(id(3),`select list_organization_members($1)`,[A])
 assert.equal((await asUser(id(2),`select count(*)::int as total from list_organization_members($1)`,[A]))[0].total,5); checks++
 // JWT metadata role spoofing cannot bypass membership or scope.
 assert.equal((await asUser(id(4),`select organization_role($1) role`,[A]))[0].role,'employee'); checks++
 await denied(id(4),`select save_organization(null,'Spoofed','active','UTC')`)
 await query(`insert into employees(organization_id,first_name,last_name,email) values($1,'Invited','Employee','user9@example.test')`,[A])
 const invite=(await asUser(id(2),`select create_organization_invitation($1,'user9@example.test','supervisor') invite`,[A]))[0].invite
 await denied(id(8),`select accept_organization_invitation($1)`,[invite.token])
 assert.equal((await asUser(id(9),`select accept_organization_invitation($1) org`,[invite.token]))[0].org,A); checks++
 assert.equal((await query(`select user_id from employees where organization_id=$1 and email='user9@example.test'`,[A]))[0].user_id,id(9)); checks++
 await denied(id(9),`select accept_organization_invitation($1)`,[invite.token])
 await denied(id(2),`select manage_organization_member($1,$2,'employee','active')`,[A,id(2)])
 await denied(id(2),`select set_organization_site_access($1,$2,$3,true)`,[A,id(5),siteB])
 await asUser(id(2),`select manage_organization_member($1,$2,'supervisor','suspended')`,[A,id(5)])
 await count(id(5),'sites',A,0); await denied(id(5),`select validate_organization_selection($1)`,[A])
 await asUser(id(1),`select save_organization($1,'Organization B','suspended','UTC')`,[B]); checks++
 await count(id(6),'sites',B,0); await count(id(1),'sites',B,0)
 await denied(id(6),`select validate_organization_selection($1)`,[B])
 await asUser(id(1),`select save_organization($1,'Organization B','active','UTC')`,[B]); checks++
 await count(id(1),'sites',B,1)
 const revokedIssuerInvite=(await asUser(id(6),`select create_organization_invitation($1,'user10@example.test','employee') invite`,[B]))[0].invite
 await asUser(id(1),`select manage_organization_member($1,$2,'organization_admin','active')`,[B,id(1)])
 await asUser(id(1),`select manage_organization_member($1,$2,'employee','suspended')`,[B,id(6)])
 await denied(id(10),`select accept_organization_invitation($1)`,[revokedIssuerInvite.token])
 for(const user of [2,3,5]) { assert.equal((await asUser(id(user),`delete from location_logs where organization_id=$1 returning id`,[B])).length,0); checks++ }
 await count(id(7),'location_logs',B,1)
 await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role anon'); await tx.query('select * from sites')})); checks++
 console.log(`PASS: ${checks} real PostgreSQL RLS/constraint/RPC checks; two organizations; all five roles; backfill; scope; spoofing; invites; suspension; legacy offline packets; Start/End Shift. No live Supabase access was used.`)
} catch(e) { console.error('FAIL:',e.message,e.detail||''); process.exitCode=1 } finally { await db.close() }
