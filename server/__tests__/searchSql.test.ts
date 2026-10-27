import { beforeAll, afterAll, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { readFileSync } from "node:fs";
const db = new PGlite({ extensions: { vector } });
const a = "00000000-0000-0000-0000-000000000001",
  b = "00000000-0000-0000-0000-000000000002";
beforeAll(async () => {
  await db.exec(
    `CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE TABLE auth.users(id uuid PRIMARY KEY);INSERT INTO auth.users VALUES('${a}'),('${b}');CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;`,
  );
  await db.exec(readFileSync("supabase-schema.sql", "utf8"));
  const sql = readFileSync("supabase-schema-update.sql", "utf8");
  await db.exec(sql);
  await db.exec(sql);
  await db.exec(
    "GRANT SELECT,INSERT,UPDATE,DELETE ON tasks,meetings,vault_items TO authenticated;GRANT USAGE ON SCHEMA extensions TO authenticated,service_role;",
  );
}, 30000);
afterAll(() => db.close());
it("queues note chunks automatically, preserves unchanged vectors, and removes deleted sources", async () => {
  const id = "10000000-0000-0000-0000-000000000001";
  await db.query(
    "INSERT INTO tasks(id,user_id,title,note) VALUES($1,$2,'Plan',$3)",
    [id, a, "hello ".repeat(500)],
  );
  const rows = (
    await db.query<any>(
      "SELECT * FROM embeddings WHERE source_id=$1 ORDER BY chunk_index",
      [id],
    )
  ).rows;
  expect(rows).toHaveLength(2);
  expect(rows[0].content.length).toBeLessThanOrEqual(2000);
  const emb = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
  await db.exec("SET ROLE service_role");
  expect(
    (
      await db.query<any>(
        "SELECT save_search_embedding($1,$2,$3,0,$4,$5,$6) AS saved",
        [a, "task", id, rows[0].revision, "model", JSON.stringify(emb)],
      )
    ).rows[0].saved,
  ).toBe(true);
  await db.exec("RESET ROLE");
  await db.query("UPDATE tasks SET status='done' WHERE id=$1", [id]);
  expect(
    (
      await db.query<any>(
        "SELECT model FROM embeddings WHERE source_id=$1 AND chunk_index=0",
        [id],
      )
    ).rows[0].model,
  ).toBe("model");
  await db.query("UPDATE tasks SET note='New notes' WHERE id=$1", [id]);
  const changed = (
    await db.query<any>("SELECT * FROM embeddings WHERE source_id=$1", [id])
  ).rows;
  expect(changed).toHaveLength(1);
  expect(changed[0].embedding).toBeNull();
  expect(changed[0].revision).not.toBe(rows[0].revision);
  await db.exec("SET ROLE service_role");
  expect(
    (
      await db.query<any>(
        "SELECT save_search_embedding($1,$2,$3,0,$4,$5,$6) AS saved",
        [a, "task", id, rows[0].revision, "model", JSON.stringify(emb)],
      )
    ).rows[0].saved,
  ).toBe(false);
  await db.exec("RESET ROLE");
  await db.query("DELETE FROM tasks WHERE id=$1", [id]);
  expect(
    (await db.query("SELECT * FROM embeddings WHERE source_id=$1", [id])).rows,
  ).toHaveLength(0);
});
it("isolates search results by account and refuses forged index writes and ownership changes", async () => {
  const idA = "20000000-0000-0000-0000-000000000001",
    idB = "20000000-0000-0000-0000-000000000002";
  await db.query(
    "INSERT INTO meetings(id,user_id,person_name,subject,notes) VALUES($1,$2,'Alex','Launch','Launch Friday'),($3,$4,'Private B','Secret','Never share')",
    [idA, a, idB, b],
  );
  const v = JSON.stringify(
    Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0)),
  );
  await db.query(
    "UPDATE embeddings SET embedding=$1::extensions.vector,model=$2",
    [v, "space"],
  );
  await db.exec("SET ROLE authenticated");
  await db.query("SELECT set_config('test.uid',$1,false)", [a]);
  expect(
    (await db.query<any>("SELECT user_id FROM embeddings")).rows.every(
      (row) => row.user_id === a,
    ),
  ).toBe(true);
  const result = (
    await db.query<any>("SELECT * FROM match_search_notes($1,$2)", [v, "space"])
  ).rows;
  expect(result).toHaveLength(1);
  expect(result[0].source_id).toBe(idA);
  expect(result[0].score).toBeCloseTo(1);
  await expect(
    db.query("UPDATE embeddings SET model='forged'"),
  ).rejects.toThrow("permission denied");
  await expect(
    db.query("SELECT sync_search_document($1,$2)", [
      "task",
      JSON.stringify({ id: idA, user_id: a, note: "spoof" }),
    ]),
  ).rejects.toThrow("permission denied");
  await expect(
    db.query(
      "SELECT save_search_embedding($1,'meeting',$2,0,gen_random_uuid(),'space',$3)",
      [a, idA, v],
    ),
  ).rejects.toThrow("permission denied");
  expect(
    (
      await db.query("SELECT * FROM match_search_notes($1,$2)", [
        v,
        "different-model",
      ])
    ).rows,
  ).toHaveLength(0);
  await db.query("SELECT set_config('test.uid',$1,false)", [b]);
  expect(
    (
      await db.query<any>("SELECT * FROM match_search_notes($1,$2)", [
        v,
        "space",
      ])
    ).rows[0].source_id,
  ).toBe(idB);
  await db.exec("RESET ROLE; SET ROLE anon");
  await expect(db.query("SELECT * FROM embeddings")).rejects.toThrow(
    "permission denied",
  );
  await db.exec("RESET ROLE");
  await db.query("UPDATE meetings SET user_id=$1 WHERE id=$2", [b, idA]);
  expect(
    (
      await db.query(
        "SELECT * FROM embeddings WHERE user_id=$1 AND source_id=$2",
        [a, idA],
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await db.query<any>(
        "SELECT embedding FROM embeddings WHERE user_id=$1 AND source_id=$2",
        [b, idA],
      )
    ).rows[0].embedding,
  ).toBeNull();
});
it("indexes vault metadata and lecture summaries, backfills idempotently, and cascades with account deletion", async () => {
  await db.query(
    "INSERT INTO vault_items(user_id,type,name,detail,url) VALUES($1,'link','Roadmap','Launch requirements','https://example.com')",
    [a],
  );
  const cards = JSON.stringify(
    Array.from({ length: 10 }, () => ({
      question: "Q",
      answer: "A",
      known: null,
    })),
  );
  await db.query(
    "INSERT INTO lectures(user_id,title,duration_seconds,transcript,summary,key_points,flashcards) VALUES($1,'Energy',120,'DO NOT INDEX THIS TRANSCRIPT','ATP carries energy','[\"ATP\"]',$2)",
    [a, cards],
  );
  const lecture = (
    await db.query<any>("SELECT * FROM embeddings WHERE source_type='lecture'")
  ).rows[0];
  expect(lecture.content).toContain("ATP carries energy");
  expect(lecture.content).not.toContain("TRANSCRIPT");
  await db.exec(readFileSync("supabase-schema-update.sql", "utf8"));
  expect(
    (
      await db.query<any>(
        "SELECT revision FROM embeddings WHERE source_type='lecture'",
      )
    ).rows[0].revision,
  ).toBe(lecture.revision);
  await db.query("DELETE FROM auth.users WHERE id=$1", [a]);
  expect(
    (await db.query("SELECT * FROM embeddings WHERE user_id=$1", [a])).rows,
  ).toHaveLength(0);
});
it("accepts pgvector installed in public and rejects dimension mismatches before any save", async () => {
  const alternate = new PGlite({ extensions: { vector } });
  try {
    await alternate.exec(
      `CREATE SCHEMA auth;CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT null::uuid $$;CREATE EXTENSION vector WITH SCHEMA public;`,
    );
    await alternate.exec(readFileSync("supabase-schema.sql", "utf8"));
    await alternate.exec(readFileSync("supabase-schema-update.sql", "utf8"));
    expect(
      (
        await alternate.query<any>(
          "SELECT format_type(atttypid,atttypmod) AS type FROM pg_attribute WHERE attrelid='embeddings'::regclass AND attname='embedding'",
        )
      ).rows[0].type,
    ).toBe("vector(1024)");
    await expect(
      alternate.query(
        "SELECT save_search_embedding(gen_random_uuid(),'task',gen_random_uuid(),0,gen_random_uuid(),'space',$1)",
        [JSON.stringify([1, 0])],
      ),
    ).rejects.toThrow("1024-dimensional");
  } finally {
    await alternate.close();
  }
}, 30000);
