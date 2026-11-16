// Turn a reviewed element submission into an element that ships with the app:
//   npm run promote:element -- path/to/<id>.element.json [app folder, default "starter"]
// It writes src/elements/<id>.ts in the app. Add the export to `custom.elements` in the app's
// src/app.ts, and open a pull request with both changes. The element keeps running in the sandbox.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [file, app = "starter"] = process.argv.slice(2);
if (!file) {
  console.error("Usage: npm run promote:element -- <file.element.json> [app folder]");
  process.exit(1);
}
let submission;
try {
  submission = JSON.parse(readFileSync(file, "utf8"));
} catch (error) {
  console.error(`Cannot read ${file}: ${error.message}`);
  process.exit(1);
}
const element = submission?.element;
if (submission?.kind !== "werkbank-element-submission" || !/^[a-z][a-z0-9-]{1,40}$/.test(element?.id ?? "") || typeof element.source !== "string") {
  console.error("That file is not an element submission.");
  process.exit(1);
}

// What a reviewer should look at before this is merged.
console.log(`Element "${element.title}" (${element.id}), revision ${element.revision}, by ${element.author || "unknown"}`);
console.log(`Submitted ${submission.submitted} from ${submission.app}, framework ${submission.frameworkVersion}`);
console.log(`Uses the app through: ${submission.uses.api.join(", ") || "nothing"}`);
console.log(`Host functions called: ${submission.uses.hostFunctions.join(", ") || "none"}`);
const suspicious = ["fetch(", "XMLHttpRequest", "WebSocket", "<script src", "import(", "eval(", "top.", "parent."].filter((needle) => element.source.includes(needle));
console.log(suspicious.length ? `Review these: the source mentions ${suspicious.join(", ")} (the sandbox blocks them, but ask why they are there).` : "Nothing in the source reaches outside the element API.");

const name = element.id.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
const dir = join(app, "src", "elements");
mkdirSync(dir, { recursive: true });
writeFileSync(
  join(dir, `${element.id}.ts`),
  `import type { CustomElement } from "@werkbank/framework";

/** Promoted from a custom element submitted ${submission.submitted.slice(0, 10)}. It runs in the sandbox, like every element. */
export const ${name}: CustomElement = ${JSON.stringify({ ...element, status: "submitted" }, null, 2)};
`,
);
console.log(`\nWrote ${join(dir, `${element.id}.ts`)}.
Add \`${name}\` to custom.elements in ${join(app, "src", "app.ts")} and open a pull request.`);
