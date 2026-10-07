import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = ["src", "tests", "scripts"];
const offenders = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(ts|mts)$/.test(name)) inspect(path);
  }
}

function inspect(path) {
  const lines = readFileSync(path, "utf8").split("\n");
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) offenders.push(`${path}:${index + 1}`);
  });
}

for (const root of roots) {
  try { walk(root); } catch (error) { if (error.code !== "ENOENT") throw error; }
}
if (offenders.length > 0) {
  console.error("Comments found. Rename or split the code so it explains itself:\n" + offenders.join("\n"));
  process.exit(1);
}
console.log("No comments found.");
