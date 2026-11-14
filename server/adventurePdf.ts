import { StringDecoder } from "node:string_decoder";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
export type SourceSection = { ref: string; text: string };
function command(
  binary: string,
  args: string[],
  signal: AbortSignal,
  max: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "prlimit",
      ["--as=268435456", "--cpu=15", "--", binary, ...args],
      { signal, stdio: ["ignore", "pipe", "pipe"] },
    );
    const decoder = new StringDecoder("utf8");
    let output = "",
      errors = "",
      size = 0;
    const fail = () => {
      child.kill("SIGKILL");
      reject(new Error("Invalid PDF."));
    };
    child.on("error", fail);
    child.stdout.on("data", (b) => {
      size += b.length;
      if (size > max) fail();
      else output += decoder.write(b);
    });
    child.stderr.on("data", (b) => {
      errors += b.toString().slice(0, 1000);
      if (errors.length > 2000) fail();
    });
    child.on("close", (code) =>
      code === 0 && !errors
        ? resolve(output)
        : reject(new Error("Invalid PDF.")),
    );
  });
}
export async function extractAdventurePdf(
  bytes: Buffer,
  signal: AbortSignal,
): Promise<SourceSection[]> {
  if (
    bytes.length > 10 * 1024 * 1024 ||
    !bytes.subarray(0, 8).toString().startsWith("%PDF-") ||
    !bytes.subarray(-1024).toString().includes("%%EOF")
  )
    throw new Error("Invalid PDF.");
  const root = await mkdtemp(join(tmpdir(), "zen-adventure-"));
  try {
    const file = join(root, "source.pdf");
    await writeFile(file, bytes, { mode: 0o600 });
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(25000)]);
    const info = await command("/usr/bin/pdfinfo", [file], bounded, 65536);
    const pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
    if (!pages || pages > 40 || !/^Encrypted:\s+no\s*$/m.test(info))
      throw new Error("Invalid PDF.");
    const text = await command(
      "/usr/bin/pdftotext",
      ["-enc", "UTF-8", "-layout", "-f", "1", "-l", String(pages), file, "-"],
      bounded,
      240000,
    );
    if (text.length > 60000 || !text.trim()) throw new Error("Invalid PDF.");
    return text
      .split("\f")
      .slice(0, pages)
      .map((text, i) => ({ ref: `page ${i + 1}`, text: text.trim() }))
      .filter((s) => s.text);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
