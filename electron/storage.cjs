const fs = require("node:fs/promises");
const path = require("node:path");
async function read(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
async function save(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = file + ".tmp";
  await fs.writeFile(temp, JSON.stringify(data, null, 2));
  const h = await fs.open(temp, "r+");
  await h.sync();
  await h.close();
  try {
    await fs.copyFile(file, file + ".bak");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  await fs.rename(temp, file);
}
module.exports = { read, save };
