import { execFileSync } from "node:child_process";

let tracked = "";
try {
  tracked = execFileSync("git", ["ls-files", ".env", "spike/.env"], { encoding: "utf8" }).trim();
} catch (error) {
  console.error(`Could not run git ls-files: ${error.message}`);
  process.exit(1);
}
if (tracked.length > 0) {
  console.error(`Secret file tracked by git: ${tracked}. Run: git rm --cached ${tracked} and rotate the keys.`);
  process.exit(1);
}
console.log(".env is not tracked.");
