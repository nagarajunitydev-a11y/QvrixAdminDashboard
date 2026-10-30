select jsonb_build_object(
 'public_tables', (select jsonb_agg(format('%I.%I',n.nspname,c.relname) order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'),
 'incoming_foreign_keys', (select jsonb_agg(jsonb_build_object('from',format('%I.%I',srcn.nspname,src.relname),'constraint',con.conname,'to',format('%I.%I',dstn.nspname,dst.relname)) order by srcn.nspname,src.relname,con.conname) from pg_constraint con join pg_class src on src.oid=con.conrelid join pg_namespace srcn on srcn.oid=src.relnamespace join pg_class dst on dst.oid=con.confrelid join pg_namespace dstn on dstn.oid=dst.relnamespace where con.contype='f' and dstn.nspname='public'),
 'user_count', (select count(*) from auth.users),
 'storage_object_count', (select count(*) from storage.objects),
 'app_counts', jsonb_build_object(
  'sites',(select count(*) from public.sites),
  'employees',(select count(*) from public.employees),
  'employee_sites',(select count(*) from public.employee_sites),
  'departments',(select count(*) from public.departments),
  'designations',(select count(*) from public.designations),
  'shifts',(select count(*) from public.shifts),
  'location_logs',(select count(*) from public.location_logs),
  'presence_sessions',(select count(*) from public.presence_sessions),
  'site_visits',(select count(*) from public.site_visits),
  'audit_logs',(select count(*) from public.audit_logs)
 )
) as preflight;
