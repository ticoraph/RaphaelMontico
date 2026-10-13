#!/usr/bin/env node
/**
 * Fails if the FR and EN content trees don't have the same number of
 * .mdx pages, collection by collection. Run before the frontend deploy
 * so a missing translation blocks the build instead of shipping silently.
 *
 * Usage: node tests/check-content-parity.js
 */
const fs = require("fs");
const path = require("path");

const CONTENT_DIR = path.join(__dirname, "..", "frontend", "content");
const LOCALES = ["en", "fr"];

function countMdxFiles(dir) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir, { withFileTypes: true }).filter(
    (entry) => entry.isFile() && entry.name.endsWith(".mdx"),
  ).length;
}

function listCollections(localeDir) {
  if (!fs.existsSync(localeDir)) return [];
  return fs
    .readdirSync(localeDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function main() {
  const localeDirs = Object.fromEntries(
    LOCALES.map((locale) => [locale, path.join(CONTENT_DIR, locale)]),
  );

  const collections = [
    ...new Set(LOCALES.flatMap((locale) => listCollections(localeDirs[locale]))),
  ].sort();

  // "root" covers standalone pages like home.mdx, living directly under each locale dir.
  const rows = ["root", ...collections].map((collection) => {
    const counts = Object.fromEntries(
      LOCALES.map((locale) => {
        const dir =
          collection === "root" ? localeDirs[locale] : path.join(localeDirs[locale], collection);
        return [locale, countMdxFiles(dir)];
      }),
    );
    return { collection, counts };
  });

  const mismatches = rows.filter((row) => {
    const counts = LOCALES.map((locale) => row.counts[locale]);
    return new Set(counts).size > 1;
  });

  const header = `${"Collection".padEnd(20)}${LOCALES.map((l) => l.toUpperCase().padEnd(6)).join("")}`;
  console.log(header);
  console.log("-".repeat(header.length));
  for (const row of rows) {
    const flag = mismatches.includes(row) ? "  <-- mismatch" : "";
    console.log(
      `${row.collection.padEnd(20)}${LOCALES.map((l) => String(row.counts[l]).padEnd(6)).join("")}${flag}`,
    );
  }

  if (mismatches.length > 0) {
    console.error(
      `\n${mismatches.length} collection(s) have a different number of pages between locales.`,
    );
    process.exit(1);
  }

  console.log("\nFR/EN page counts match for every collection.");
}

main();
