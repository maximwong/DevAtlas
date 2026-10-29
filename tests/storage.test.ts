// @ts-nocheck
import { it, expect } from "vitest";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { read, save } = createRequire(import.meta.url)(
  "../electron/storage.cjs",
);
it("文件保存重新读取及最近备份", async () => {
  const dir = await mkdtemp(join(tmpdir(), "devatlas-"));
  try {
    const file = join(dir, "workspace.json");
    expect(await read(file)).toBe(null);
    await save(file, { schemaVersion: 1, value: 1 });
    await save(file, { schemaVersion: 1, value: 2 });
    expect((await read(file)).value).toBe(2);
    expect(JSON.parse(await readFile(file + ".bak", "utf8")).value).toBe(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
