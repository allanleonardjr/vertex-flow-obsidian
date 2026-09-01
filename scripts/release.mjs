/**
 * Drafts a GitHub release for Vertex Flow.
 *
 * Usage:
 *   pnpm release                 # draft a release at the version in package.json
 *   pnpm release 1.1.0           # draft a release at 1.1.0
 *   pnpm release --build         # run the production build first, then draft
 *   pnpm release 1.1.0 --build   # build, then draft at 1.1.0
 *   pnpm release --notes "..."   # override the release notes
 *   pnpm release --dry-run       # print what it WOULD do, without creating anything
 *
 * Notes:
 *   - The version defaults to `package.json`'s `version` so the tag can't
 *     accidentally drift from the manifest. Pass an explicit version only to
 *     override (you'd usually only do this while testing).
 *   - `--notes "text"` overrides the default release notes. Omit it to use
 *     the generated default ("Release of Vertex Flow v<version>.").
 *   - Omitting `--notes` deliberately does NOT open an interactive editor, so
 *     the command stays non-interactive and scriptable.
 *   - The release tag/title use the bare version (no `v` prefix), as the
 *     Obsidian community-directory bot requires.
 *   - `main.js` and `manifest.json` (and `styles.css` when present) are
 *     attached as individual files — the bot reads these attachments, not the
 *     auto-generated source archives.
 *   - Requires `gh` to be installed and authenticated, and the repo to exist
 *     on GitHub (creates it as public if the remote isn't configured).
 *   - This only *creates* the release; it never pushes a new tag by itself
 *     beyond what `gh release create` does from the current HEAD.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

const args = process.argv.slice(2);
const shouldBuild = args.includes("--build");
const dryRun = args.includes("--dry-run");
const explicitVersion = args.find((a) => !a.startsWith("--"));
const notesArg = args.find((a) => a === "--notes");
const explicitNotes =
  notesArg !== undefined ? args[args.indexOf("--notes") + 1] : undefined;

function run(cmd, argsList, label) {
  console.log(`\n▶ ${label}`);
  const res = spawnSync(cmd, argsList, { stdio: "inherit", cwd: ROOT });
  if (res.status !== 0) {
    console.error(`✗ ${label} failed (exit ${res.status})`);
    process.exit(res.status ?? 1);
  }
}

function resolveRepo() {
  const remote = spawnSync("git", ["remote", "get-url", "origin"], { cwd: ROOT, encoding: "utf8" })
    .stdout.trim();
  const match = remote.match(/(?:github\.com[:/])([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (match) return `${match[1]}/${match[2]}`;
  return `${pkg.name}`;
}

const version = explicitVersion ?? pkg.version;

if (version !== manifest.version) {
  console.error(
    `✗ Version mismatch: package.json says ${pkg.version} and manifest.json says ${manifest.version}, ` +
      `but the requested release version is ${version}. They must all agree.`,
  );
  process.exit(1);
}

if (shouldBuild) run("pnpm", ["build"], "production build");

const repo = resolveRepo();
console.log(`\nTarget repo: ${repo}`);
console.log(`Release version: ${version}`);
console.log(`Release notes: ${explicitNotes ?? "(default)"}`);

const assets = ["main.js", "manifest.json"];
if (existsSync(join(ROOT, "styles.css"))) assets.push("styles.css");

const missing = assets.filter((a) => !existsSync(join(ROOT, a)));
if (missing.length) {
  console.error(`✗ Missing files to attach: ${missing.join(", ")}`);
  process.exit(1);
}

console.log(`Attaching: ${assets.join(", ")}`);

if (dryRun) {
  console.log(`\n(dry-run) Would run:`);
  console.log(
    `  gh release create ${version} ${assets.join(" ")} --title ${version} --notes "${explicitNotes ?? `Release of Vertex Flow v${version}.`}" --repo ${repo}`,
  );
  console.log(`\n(dry-run) No release was created.`);
  process.exit(0);
}

run(
  "gh",
  [
    "release",
    "create",
    version,
    ...assets,
    `--title`,
    version,
    `--notes`,
    explicitNotes ?? `Release of Vertex Flow v${version}.`,
  ].concat(["--repo", repo]),
  `gh release create ${version}`,
);

console.log(`\n✓ Release ${version} created.`);
