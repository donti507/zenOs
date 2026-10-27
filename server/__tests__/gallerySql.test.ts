import {beforeAll,afterAll,expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
const db=new PGlite();const a='00000000-0000-0000-0000-000000000001',b='00000000-0000-0000-0000-000000000002',c='00000000-0000-0000-0000-000000000003',d='00000000-0000-0000-0000-000000000004';
const page='10000000-0000-0000-0000-000000000001',version='20000000-0000-0000-0000-000000000001',copy='10000000-0000-0000-0000-000000000002',copyVersion='20000000-0000-0000-0000-000000000002';let published:string,child:string;
beforeAll(async()=>{
 await db.exec(`CREATE SCHEMA auth;CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE TABLE auth.users(id uuid PRIMARY KEY);INSERT INTO auth.users VALUES('${a}'),('${b}'),('${c}'),('${d}');CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;`);
 await db.exec(readFileSync('supabase-schema.sql','utf8'));const migration=readFileSync('supabase-schema-update.sql','utf8');await db.exec(migration);await db.exec(migration);
 await db.exec(`SET ROLE authenticated;SELECT set_config('test.uid','${a}',false)`);await db.query("SELECT create_space_page($1,'original','Private title',$2)",[page,version]);await db.query('SELECT set_space_permissions($1,$2,true,true)',[page,version]);await db.exec('RESET ROLE;SET ROLE service_role');
},30000);
afterAll(()=>db.close());
const publish=(owner=a,pageId=page,versionId=version)=>db.query<any>("SELECT publish_space_gallery($1,$2,$3,'Public timer','A useful timer','Alice') AS id",[owner,pageId,versionId]);
const report=(user:string)=>db.query('SELECT report_space_gallery($1,$2,\'unsafe\')',[user,published]);
it('publishes only an owned exact snapshot and keeps all private metadata separate',async()=>{
 await expect(publish(b)).rejects.toThrow('Page not found');await expect(publish(a,page,copyVersion)).rejects.toThrow('Page changed');
 published=(await publish()).rows[0].id;
 const row=(await db.query<any>('SELECT * FROM space_gallery_pages WHERE id=$1',[published])).rows[0];expect(row.html).toContain('Your space');expect(row).not.toHaveProperty('permissions');expect(row).not.toHaveProperty('prompt');expect(row.user_id).toBe(a);
 expect((await publish()).rows[0].id).toBe(published);
});
it('remixes atomically with canonical credit and no grants, deduplicates retries and creates a visible lineage',async()=>{
 for(let i=0;i<2;i++){
  const data=(await db.query<any>("SELECT remix_space_gallery($1,$2,$3,'my-copy','My copy',$4) AS value",[b,published,copy,copyVersion])).rows[0].value;
  expect(data.page.permissions).toEqual({tasks:false,events:false});expect(data.page.remix_source).toEqual({id:published,title:'Public timer',author:'Alice'});expect(data.version.html).toContain('Your space');expect(data.version.prompt).toBe('');
 }
 expect((await db.query('SELECT * FROM space_page_versions WHERE page_id=$1',[copy])).rows).toHaveLength(1);
 child=(await publish(b,copy,copyVersion)).rows[0].id;
 const nodes=(await db.query<any>('SELECT * FROM space_gallery_tree($1)',[child])).rows;expect(nodes.map(row=>row.id)).toEqual([published,child]);
 const grandchild=(await db.query<any>("SELECT remix_space_gallery($1,$2,gen_random_uuid(),'third','Third',gen_random_uuid()) AS value",[c,child])).rows[0].value;expect(grandchild.page.remix_source.id).toBe(child);expect(grandchild.page.remix_source.original.id).toBe(published);
 expect((await db.query<any>('SELECT parent_id,remix_credit FROM space_gallery_pages WHERE id=$1',[child])).rows[0]).toMatchObject({parent_id:published,remix_credit:{author:'Alice'}});
});
it('hides on three distinct reports atomically, counts retries once and prevents owner bypass',async()=>{
 await report(b);await report(b);expect((await db.query<any>('SELECT report_count FROM space_gallery_pages WHERE id=$1',[published])).rows[0].report_count).toBe(1);
 await Promise.all([report(c),report(d)]);const row=(await db.query<any>('SELECT * FROM space_gallery_pages WHERE id=$1',[published])).rows[0];expect(row).toMatchObject({report_count:3,moderation:'hidden'});
 await report(d);await db.query('SELECT withdraw_space_gallery($1,$2)',[a,published]);await expect(publish()).rejects.toThrow('moderation review');
 await expect(db.query("SELECT remix_space_gallery($1,$2,gen_random_uuid(),'blocked','Blocked',gen_random_uuid())",[b,published])).rejects.toThrow('not found');
 const tree=(await db.query<any>('SELECT * FROM space_gallery_tree($1)',[child])).rows;expect(tree.map(row=>row.id)).toEqual([child]);
});
it('restores after review without re-publishing withdrawn content and resets reporting for a new review cycle',async()=>{
 await db.query("SELECT moderate_space_gallery($1,'restore')",[published]);const row=(await db.query<any>('SELECT * FROM space_gallery_pages WHERE id=$1',[published])).rows[0];expect(row).toMatchObject({moderation:'visible',published:false,report_count:0,review_epoch:1});
 await publish();await report(b);expect((await db.query<any>('SELECT report_count FROM space_gallery_pages WHERE id=$1',[published])).rows[0].report_count).toBe(1);
});
it('denies anonymous and authenticated RPC/write escalation, isolates private copies and reporter identities',async()=>{
 await db.exec(`RESET ROLE;SET ROLE authenticated;SELECT set_config('test.uid','${b}',false)`);
 const rows=(await db.query<any>('SELECT * FROM space_gallery_pages')).rows;expect(rows.every(row=>row.user_id===b)).toBe(true);
 const reports=(await db.query<any>('SELECT * FROM space_gallery_reports')).rows;expect(reports.every(row=>row.user_id===b)).toBe(true);
 await expect(db.query("SELECT moderate_space_gallery($1,'restore')",[published])).rejects.toThrow('permission denied');await expect(publish(b)).rejects.toThrow('permission denied');await expect(db.query('UPDATE space_gallery_pages SET moderation=\'visible\'')).rejects.toThrow('permission denied');
 await db.exec('RESET ROLE;SET ROLE anon');await expect(db.query('SELECT * FROM space_gallery_pages')).rejects.toThrow('permission denied');await expect(db.query('SELECT * FROM space_gallery_tree($1)',[published])).rejects.toThrow('permission denied');await db.exec('RESET ROLE;SET ROLE service_role');
});
it('deletes published code permanently while retaining private copies, and cascades account records',async()=>{
 await db.query("SELECT moderate_space_gallery($1,'delete')",[published]);const row=(await db.query<any>('SELECT * FROM space_gallery_pages WHERE id=$1',[published])).rows[0];expect(row).toMatchObject({html:'',css:'',js:'',moderation:'deleted',published:false});
 await expect(db.query("SELECT moderate_space_gallery($1,'restore')",[published])).rejects.toThrow('not found');await expect(publish()).rejects.toThrow('moderation review');
 expect((await db.query<any>('SELECT html FROM space_page_versions WHERE id=$1',[copyVersion])).rows[0].html).toContain('Your space');
 await db.exec('RESET ROLE');await db.query('DELETE FROM auth.users WHERE id=$1',[a]);expect((await db.query('SELECT * FROM space_gallery_pages WHERE user_id=$1',[a])).rows).toHaveLength(0);expect((await db.query('SELECT * FROM space_gallery_reports WHERE gallery_id=$1',[published])).rows).toHaveLength(0);
});
