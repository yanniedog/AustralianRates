#!/usr/bin/env node
/**
 * Keeps local Git Graph readable: prune stale remote-tracking refs and remove
 * local branches whose upstream was deleted (e.g. after squash merge + remote delete).
 *
 * Usage: node scripts/git-graph-hygiene.mjs [--dry-run] [--no-set-fetch-prune]
 *
 * Skips branches checked out in any worktree or the current branch.
 */

import { execFileSync } from "node:child_process";
import process from "node:process";

const dryRun = process.argv.includes("--dry-run");
const noSetFetchPrune = process.argv.includes("--no-set-fetch-prune");

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

function git(args, inherit = false) {
  const out = execFileSync("git", args, {
    encoding: "utf8",
    cwd: root,
    stdio: inherit ? "inherit" : "pipe",
  });
  // With stdio inherit, Node may return null (no captured stdout).
  if (out == null) return "";
  return String(out).trimEnd();
}

function gitTry(args) {
  try {
    execFileSync("git", args, { encoding: "utf8", cwd: root, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function gitConfigGet(name) {
  try {
    return execFileSync("git", ["config", "--get", name], {
      encoding: "utf8",
      cwd: root,
      stdio: "pipe",
    }).trim();
  } catch {
    return "";
  }
}

function worktreeProtectedBranches() {
  const out = git(["worktree", "list", "--porcelain"]);
  const protectedSet = new Set();
  for (const block of out.split(/\n\n+/)) {
    const lines = block.split("\n");
    for (const line of lines) {
      if (line.startsWith("branch ")) {
        const ref = line.slice("branch ".length).trim();
        if (ref.startsWith("refs/heads/")) {
          protectedSet.add(ref.slice("refs/heads/".length));
        }
      }
    }
  }
  return protectedSet;
}

function goneLocalBranches() {
  const out = git(["branch", "-vv"]);
  const names = [];
  for (const rawLine of out.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const gone = /: gone]/.test(line);
    if (!gone) continue;
    let rest = line;
    if (rest.startsWith("* ")) rest = rest.slice(2);
    else if (rest.startsWith("+ ")) rest = rest.slice(2);
    const name = rest.split(/\s+/)[0];
    if (name && !name.startsWith("(")) {
      names.push(name);
    }
  }
  return names;
}

function main() {
  if (!noSetFetchPrune) {
    const cur = gitConfigGet("fetch.prune");
    if (cur !== "true") {
      if (dryRun) {
        process.stdout.write("Would set: git config fetch.prune true\n");
      } else {
        gitTry(["config", "fetch.prune", "true"]);
        process.stdout.write("Set fetch.prune=true for this repository.\n");
      }
    }
  }

  if (dryRun) {
    process.stdout.write("Would run: git fetch origin --prune\n");
  } else {
    git(["fetch", "origin", "--prune"], true);
  }

  const protectedBranches = worktreeProtectedBranches();
  const current = git(["branch", "--show-current"]).trim();

  for (const b of goneLocalBranches()) {
    if (protectedBranches.has(b) || b === current) {
      process.stdout.write(`Skip delete (in use): ${b}\n`);
      continue;
    }
    if (dryRun) {
      process.stdout.write(`Would delete local branch (upstream gone): ${b}\n`);
    } else if (gitTry(["branch", "-D", b])) {
      process.stdout.write(`Deleted local branch (upstream gone): ${b}\n`);
    } else {
      process.stderr.write(`Could not delete ${b}\n`);
    }
  }

  process.stdout.write("git-graph-hygiene: done.\n");
}

main();
