import { beforeAll, afterAll, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const db = new PGlite();
const a = "00000000-0000-0000-0000-000000000001",
  b = "00000000-0000-0000-0000-000000000002",
  page = "10000000-0000-0000-0000-000000000001",
  initial = "20000000-0000-0000-0000-000000000001",
  edit = "20000000-0000-0000-0000-000000000002",
  restore = "20000000-0000-0000-0000-000000000003";
beforeAll(async () => {
  await db.exec(
    `CREATE SCHEMA auth;CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE TABLE auth.users(id uuid PRIMARY KEY);INSERT INTO auth.users VALUES('${a}'),('${b}');CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;`,
  );
  await db.exec(readFileSync("supabase-schema.sql", "utf8"));
  const migration = readFileSync("supabase-schema-update.sql", "utf8");
  await db.exec(migration);
  await db.exec(migration);
  await db.exec("SET ROLE authenticated");
  await db.query("SELECT set_config('test.uid',$1,false)", [a]);
}, 30000);
afterAll(() => db.close());
const snapshot = async () =>
  (await db.query<any>("SELECT space_current_snapshot($1) AS value", [page]))
    .rows[0].value;
const save = (version = edit, expected = initial) =>
  db.query<any>(
    "SELECT save_space_edit($1,$2,$3,'<main>Timer</main>','main{padding:1rem}','console.log(1)','Build a timer','Done','allowed-model','Added a timer to help you focus.') AS value",
    [page, expected, version],
  );
it("creates private pages with a first immutable version and idempotent creation replay", async () => {
  for (let i = 0; i < 2; i++)
    await db.query("SELECT create_space_page($1,$2,$3,$4)", [
      page,
      "study-hub",
      "Study Hub",
      initial,
    ]);
  const data = await snapshot();
  expect(data.page.slug).toBe("study-hub");
  expect(data.page.permissions).toEqual({ tasks: false, events: false });
  expect(data.version.id).toBe(initial);
  expect(
    (await db.query("SELECT * FROM space_page_versions")).rows,
  ).toHaveLength(1);
  await expect(
    db.query(
      "SELECT create_space_page(gen_random_uuid(),$1,$2,gen_random_uuid())",
      ["study-hub", "Duplicate"],
    ),
  ).rejects.toThrow();
});
it("records edits atomically, revokes grants, deduplicates retries and rejects stale branches", async () => {
  await db.query("SELECT set_space_permissions($1,$2,true,false)", [
    page,
    initial,
  ]);
  expect(
    (
      await db.query<any>(
        "SELECT space_bridge_permission($1,$2,'tasks') AS allowed",
        [page, initial],
      )
    ).rows[0].allowed,
  ).toBe(true);
  await save();
  await save();
  expect(
    (await db.query("SELECT * FROM space_page_versions")).rows,
  ).toHaveLength(2);
  const data = await snapshot();
  expect(data.version.kind).toBe("ai");
  expect(data.version.html).toContain("Timer");
  expect(data.page.permissions).toEqual({ tasks: false, events: false });
  await expect(save("20000000-0000-0000-0000-000000000099")).rejects.toThrow(
    "Page changed",
  );
  expect(
    (
      await db.query<any>(
        "SELECT space_bridge_permission($1,$2,'tasks') AS allowed",
        [page, initial],
      )
    ).rows[0].allowed,
  ).toBe(false);
  await expect(
    db.query("UPDATE space_page_versions SET js=$1", ["tamper"]),
  ).rejects.toThrow("permission denied");
  await expect(
    db.query("UPDATE space_pages SET permissions='{}'"),
  ).rejects.toThrow("permission denied");
});
it("stores immutable explanations against the exact base and rolls back oversized explanations", async()=>{
  const data=await snapshot();
  expect(data.version.explanation).toBe('Added a timer to help you focus.');
  expect(data.version.parent_version_id).toBe(initial);
  await expect(db.query("SELECT save_space_edit($1,$2,gen_random_uuid(),'','','','edit','done','model',$3)",[page,edit,'x'.repeat(1201)])).rejects.toThrow();
  expect((await snapshot()).version.id).toBe(edit);
  await db.query("SELECT set_config('test.uid',$1,false)",[b]);
  expect((await db.query('SELECT explanation FROM space_page_versions WHERE page_id=$1',[page])).rows).toHaveLength(0);
  await db.query("SELECT set_config('test.uid',$1,false)",[a]);
});
it("restores any saved version as a new save point and revokes old permissions", async () => {
  await db.query("SELECT set_space_permissions($1,$2,true,true)", [page, edit]);
  for (let i = 0; i < 2; i++)
    await db.query("SELECT restore_space_version($1,$2,$3,$4)", [
      page,
      edit,
      initial,
      restore,
    ]);
  const data = await snapshot();
  expect(data.version.kind).toBe("restore");
  expect(data.version.parent_version_id).toBe(edit);
  expect(data.version.explanation).toContain("Restored");
  expect(data.version.restored_from).toBe(initial);
  expect(data.version.html).toContain("Your space");
  expect(data.page.permissions).toEqual({ tasks: false, events: false });
  expect(
    (await db.query("SELECT * FROM space_page_versions")).rows,
  ).toHaveLength(3);
  await expect(
    db.query("SELECT set_space_permissions($1,$2,true,true)", [page, edit]),
  ).rejects.toThrow("Page changed");
  expect(
    (
      await db.query<any>(
        "SELECT space_bridge_permission($1,$2,'constructor') AS allowed",
        [page, restore],
      )
    ).rows[0].allowed,
  ).toBe(false);
});
it("rejects oversized code without adding history or changing current state", async () => {
  await expect(
    db.query(
      "SELECT save_space_edit($1,$2,gen_random_uuid(),$3,'','','edit','done','model')",
      [page, restore, "x".repeat(24001)],
    ),
  ).rejects.toThrow();
  expect((await snapshot()).page.current_version_id).toBe(restore);
  expect(
    (await db.query("SELECT * FROM space_page_versions")).rows,
  ).toHaveLength(3);
});
it("persists private widget sizes/order without changing code, history or grants", async () => {
  const second="10000000-0000-0000-0000-000000000002";
  await db.query("SELECT create_space_page($1,'second','Second',gen_random_uuid())",[second]);
  await db.query("SELECT set_space_permissions($1,$2,true,false)",[page,restore]);
  const change=(id:string,action:string)=>db.query<any>("SELECT * FROM change_space_widget($1,$2)",[id,action]);
  await change(page,'small'); await change(second,'medium'); await change(second,'earlier');
  let rows=(await db.query<any>("SELECT * FROM space_pages WHERE dashboard_size IS NOT NULL ORDER BY dashboard_order,id")).rows;
  expect(rows.map(row=>row.id)).toEqual([second,page]);
  expect(rows.map(row=>row.dashboard_size)).toEqual(['medium','small']);
  await change(page,'medium');
  expect((await snapshot()).page.permissions).toEqual({tasks:true,events:false});
  expect((await snapshot()).page.current_version_id).toBe(restore);
  expect((await db.query("SELECT * FROM space_page_versions WHERE page_id=$1",[page])).rows).toHaveLength(3);
  await expect(change(page,'large')).rejects.toThrow('Invalid widget');
  await db.query("SELECT set_config('test.uid',$1,false)",[b]);
  await expect(change(page,'unpin')).rejects.toThrow('Page not found');
  await db.exec('RESET ROLE; SET ROLE anon');
  await expect(change(page,'small')).rejects.toThrow('permission denied');
  await db.exec('RESET ROLE; SET ROLE authenticated');
  await db.query("SELECT set_config('test.uid',$1,false)",[a]);
  await change(page,'unpin');
  expect((await snapshot()).page.dashboard_size).toBeNull();
});
it("isolates owners and anonymous access, permits per-user slugs and cascades page/history deletion", async () => {
  await db.query("SELECT set_config('test.uid',$1,false)", [b]);
  expect((await db.query("SELECT * FROM space_pages")).rows).toHaveLength(0);
  expect(
    (await db.query("SELECT * FROM space_page_versions")).rows,
  ).toHaveLength(0);
  expect(await snapshot()).toBeNull();
  await expect(save()).rejects.toThrow("Page not found");
  await expect(
    db.query("SELECT set_space_permissions($1,$2,true,true)", [page, restore]),
  ).rejects.toThrow("Page not found");
  await db.query(
    "SELECT create_space_page(gen_random_uuid(),'study-hub','B page',gen_random_uuid())",
  );
  expect((await db.query("SELECT * FROM space_pages")).rows).toHaveLength(1);
  await db.exec("RESET ROLE;SET ROLE anon");
  await expect(db.query("SELECT * FROM space_pages")).rejects.toThrow(
    "permission denied",
  );
  await expect(
    db.query("SELECT space_current_snapshot($1)", [page]),
  ).rejects.toThrow("permission denied");
  await db.exec("RESET ROLE");
  await db.query("DELETE FROM auth.users WHERE id=$1", [a]);
  expect(
    (await db.query("SELECT * FROM space_pages WHERE user_id=$1", [a])).rows,
  ).toHaveLength(0);
  expect(
    (await db.query("SELECT * FROM space_page_versions WHERE user_id=$1", [a]))
      .rows,
  ).toHaveLength(0);
});
