import { beforeAll, afterAll, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const db = new PGlite(),
  a = "00000000-0000-0000-0000-000000000001",
  b = "00000000-0000-0000-0000-000000000002";
beforeAll(async () => {
  await db.exec(
    `CREATE SCHEMA auth;CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE TABLE auth.users(id uuid PRIMARY KEY);INSERT INTO auth.users VALUES('${a}'),('${b}');CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('test.uid',true),'')::uuid$$;GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;`,
  );
  await db.exec(readFileSync("supabase-schema.sql", "utf8"));
  const migration = readFileSync("supabase-schema-update.sql", "utf8");
  await db.exec(migration);
  await db.exec(migration);
  await db.exec(
    `SET ROLE service_role;INSERT INTO adventures(user_id,title,spec,answers,source_refs) VALUES('${a}','Private lesson','{}','{"secret":"1101"}','[]');SET ROLE authenticated;SELECT set_config('test.uid','${a}',false);`,
  );
}, 30000);
afterAll(() => db.close());
it("allows safe own reads, rejects SELECT star/answers and all browser writes", async () => {
  expect(
    (await db.query("SELECT title,spec FROM adventures")).rows,
  ).toHaveLength(1);
  for (const sql of [
    "SELECT answers FROM adventures",
    "SELECT * FROM adventures",
    "UPDATE adventures SET title='x'",
    "DELETE FROM adventures",
    `INSERT INTO adventures(user_id,title,spec,answers,source_refs) VALUES('${a}','x','{}','{}','[]')`,
  ])
    await expect(db.exec(sql)).rejects.toThrow();
});
it("isolates users and anonymous callers, cascades account deletion", async () => {
  await db.exec(`SELECT set_config('test.uid','${b}',false)`);
  expect((await db.query("SELECT id FROM adventures")).rows).toHaveLength(0);
  await db.exec("SET ROLE anon");
  await expect(db.exec("SELECT id FROM adventures")).rejects.toThrow();
  await db.exec(`RESET ROLE;DELETE FROM auth.users WHERE id='${a}'`);
  expect((await db.query("SELECT id FROM adventures")).rows).toHaveLength(0);
});
