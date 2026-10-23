import assert from 'node:assert/strict'
import { loadEnv } from 'vite'
const env = loadEnv('test',process.cwd(),'VITE_')
const url = env.VITE_SUPABASE_URL
const key = env.VITE_SUPABASE_ANON_KEY
const tokens = Object.fromEntries(['A_ADMIN','B_ADMIN','A_MANAGER','A_SUPERVISOR','A_EMPLOYEE'].map(role=>[role,process.env[`CREWTRAXA_TEST_${role}_TOKEN`]]))
const A=process.env.CREWTRAXA_TEST_ORG_A, B=process.env.CREWTRAXA_TEST_ORG_B, siteB=process.env.CREWTRAXA_TEST_SITE_B
if(!url||!key||!A||!B||!siteB||Object.values(tokens).some(value=>!value)){ console.error('Live tests NOT RUN: configure two dedicated test organizations, their site IDs, and all test user JWTs as documented in docs/multi-organization.md. No service-role key is used.');process.exit(1) }
let checks=0
async function request(token,path,options={}) {
 const response=await fetch(`${url}/rest/v1/${path}`,{...options,headers:{apikey:key,Authorization:`Bearer ${token}`,'Content-Type':'application/json',Prefer:'return=representation',...options.headers}})
 return {response,body:await response.json()}
}
for(const [token,org] of [[tokens.A_ADMIN,A],[tokens.B_ADMIN,B]]) {
 const {response,body}=await request(token,`organizations?id=eq.${org}&select=id,name`)
 assert.ok(response.ok&&body.length===1&&body[0].name.startsWith('Crewtraxa isolation test '),'Refusing live tests outside dedicated Crewtraxa isolation test organizations');checks++
}
const bSite=await request(tokens.B_ADMIN,`sites?id=eq.${siteB}&organization_id=eq.${B}&select=id,name`)
assert.ok(bSite.response.ok&&bSite.body.length===1,'B test site must exist')
for(const [role,token] of Object.entries(tokens).filter(([role])=>role.startsWith('A_'))) {
 for(const table of ['employees','sites','departments','designations','shifts','employee_sites','presence_sessions','location_logs','audit_logs','organization_memberships','organization_invitations','organization_site_access']) {
  const {response,body}=await request(token,`${table}?organization_id=eq.${B}&select=*`)
  assert.ok(response.ok,`${role}: ${table} should return a filtered result`);assert.deepEqual(body,[],`${role}: cross-organization rows leaked in ${table}`);checks++
 }
 // No-op updates detect unauthorized write access without changing a fixture's value.
 const patch=await request(token,`sites?id=eq.${siteB}&organization_id=eq.${B}`,{method:'PATCH',body:JSON.stringify({name:bSite.body[0].name})})
 assert.ok(patch.response.status===403||(patch.response.ok&&patch.body.length===0),`${role}: cross-organization update authorized`);checks++
 const inserted=await request(token,'sites',{method:'POST',body:JSON.stringify({organization_id:B,name:'Crewtraxa isolation test unauthorized insert',latitude:0,longitude:0})})
 assert.ok(!inserted.response.ok,`${role}: cross-organization insert authorized`);checks++
 const rpc=await request(token,'rpc/manage_organization_member',{method:'POST',body:JSON.stringify({org:B,member:'00000000-0000-4000-8000-000000000099',member_role:'organization_admin',member_status:'active'})})
 assert.equal(rpc.response.status,403,`${role}: cross-organization membership RPC authorized`);checks++
}
console.log(`PASS: ${checks} live Supabase REST/RPC isolation checks using dedicated test organizations. Employee-device/offline end-to-end testing is still separate.`)
