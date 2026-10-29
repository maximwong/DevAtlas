import { build } from "rolldown";
await build({ input: "src/automation.ts", platform: "node", output: { file: "electron/operations.cjs", format: "cjs" } });
