import { beforeAll, afterAll, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { emptyAdventureRun } from "../../src/game/systems/adaptation";
const db = new PGlite(),
  a = "00000000-0000-0000-0000-000000000001",
  b = "00000000-0000-0000-0000-000000000002",
  id = "11111111-1111-4111-8111-111111111111";
beforeAll(async () => {
  await db.exec(
    `CREATE SCHEMA auth;CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE TABLE auth.users(id uuid PRIMARY KEY);INSERT INTO auth.users VALUES('${a}'),('${b}');CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('test.uid',true),'')::uuid$$;GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;`,
  );
  await db.exec(readFileSync("supabase-schema.sql", "utf8"));
  const migration = readFileSync("supabase-schema-update.sql", "utf8");
  await db.exec(migration);
  await db.exec(migration);
  await db.exec(
    `SET ROLE service_role;INSERT INTO adventures(id,user_id,title,spec,answers,source_refs) VALUES('${id}','${a}','Private lesson','{}','{}','[]');`,
  );
}, 30000);
afterAll(() => db.close());
it("uses an owner-checked atomic revision guard and rejects stale writes", async () => {
  const args = [a, id, 0, JSON.stringify(emptyAdventureRun()), "[]"];
  expect(
    (
      await db.query<any>(
        "SELECT commit_adventure_run($1,$2,$3,$4,$5) AS ok",
        args,
      )
    ).rows[0].ok,
  ).toBe(true);
  expect(
    (
      await db.query<any>(
        "SELECT commit_adventure_run($1,$2,$3,$4,$5) AS ok",
        args,
      )
    ).rows[0].ok,
  ).toBe(false);
  await expect(
    db.query("SELECT commit_adventure_run($1,$2,0,$3,$4)", [
      b,
      id,
      JSON.stringify(emptyAdventureRun()),
      "[]",
    ]),
  ).rejects.toThrow("Adventure not found");
});
it("allows own safe reads only, blocks forged learning/receipts and all client RPC writes", async () => {
  await db.exec(
    `SET ROLE authenticated;SELECT set_config('test.uid','${a}',false)`,
  );
  expect(
    (await db.query("SELECT run FROM adventure_progress")).rows,
  ).toHaveLength(1);
  for (const sql of [
    "SELECT receipts FROM adventure_progress",
    "SELECT * FROM adventure_progress",
    "UPDATE adventure_progress SET run='{}'",
    "DELETE FROM adventure_progress",
    `SELECT commit_adventure_run('${a}','${id}',1,'{}','[]')`,
  ])
    await expect(db.exec(sql)).rejects.toThrow();
  await db.exec(`SELECT set_config('test.uid','${b}',false)`);
  expect(
    (await db.query("SELECT run FROM adventure_progress")).rows,
  ).toHaveLength(0);
  await db.exec("SET ROLE anon");
  await expect(db.exec("SELECT run FROM adventure_progress")).rejects.toThrow();
  await db.exec(`RESET ROLE;DELETE FROM auth.users WHERE id='${a}'`);
  expect(
    (await db.query("SELECT id FROM adventure_progress")).rows,
  ).toHaveLength(0);
});
