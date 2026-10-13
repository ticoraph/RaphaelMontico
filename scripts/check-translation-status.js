#!/usr/bin/env node
/**
 * check-translation-status.js
 *
 * Rapport de parité et de drift FR→EN pour le portfolio.
 * Compare les checksums SHA-256 du corps (hors frontmatter) des fichiers MDX
 * et du fichier messages/fr.json avec le registre data/translation-checksums.json.
 *
 * Usage:
 *   node scripts/check-translation-status.js
 *   node scripts/check-translation-status.js --json
 *   node scripts/check-translation-status.js --fail-on-drift
 *
 * Options:
 *   --json           Sortie JSON (pour CI/CD ou scripts)
 *   --fail-on-drift  Exit code 1 si des fichiers ont drifté (bloque le deploy)
 *   --update         Met à jour data/translation-checksums.json avec les checksums actuels
 *                    (à utiliser APRÈS avoir traduit manuellement)
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

// ─── Paths ────────────────────────────────────────────────────────────────────

const ROOT         = path.join(__dirname, "..");
const CONTENT_DIR  = path.join(ROOT, "frontend", "content");
const MESSAGES_DIR = path.join(ROOT, "frontend", "messages");
const CHECKSUMS_FILE = path.join(ROOT, "data", "translation-checksums.json");

const LOCALES      = ["fr", "en"];
const COLLECTIONS  = ["", "proxp", "perxp", "diplomas", "schoolprojects"]; // "" = root

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Sépare le frontmatter YAML du corps d'un fichier MDX.
 * Retourne { frontmatter: string, body: string }
 */
function parseMdx(content) {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (fmMatch) {
    return { frontmatter: fmMatch[1], body: fmMatch[2] };
  }
  return { frontmatter: "", body: content };
}

/**
 * Calcule le SHA-256 d'une chaîne (corps MDX ou JSON).
 */
function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Collecte récursivement tous les fichiers MDX d'un dossier.
 * Retourne des chemins relatifs à ROOT.
 */
function collectMdxFiles(dir, relBase) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".mdx")) {
      files.push(path.join(relBase, entry.name));
    }
  }
  return files;
}

/**
 * Charge le registre de checksums. Retourne un objet vide si le fichier n'existe pas.
 */
function loadChecksums() {
  if (!fs.existsSync(CHECKSUMS_FILE)) return { version: 1, files: {} };
  return JSON.parse(fs.readFileSync(CHECKSUMS_FILE, "utf8"));
}

/**
 * Sauvegarde le registre de checksums.
 */
function saveChecksums(registry) {
  const dir = path.dirname(CHECKSUMS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CHECKSUMS_FILE, JSON.stringify(registry, null, 2) + "\n", "utf8");
}

// ─── Core Logic ───────────────────────────────────────────────────────────────

/**
 * Construit la liste de tous les fichiers FR à surveiller.
 * Retourne [{ frPath, enPath, relFr, relEn }]
 */
function buildFileList() {
  const list = [];

  // MDX files
  for (const collection of COLLECTIONS) {
    const frDir = collection
      ? path.join(CONTENT_DIR, "fr", collection)
      : path.join(CONTENT_DIR, "fr");
    const enDir = collection
      ? path.join(CONTENT_DIR, "en", collection)
      : path.join(CONTENT_DIR, "en");
    const relBase = collection
      ? path.join("content", "fr", collection)
      : path.join("content", "fr");
    const relEnBase = collection
      ? path.join("content", "en", collection)
      : path.join("content", "en");

    const frFiles = collectMdxFiles(frDir, relBase);
    for (const relFr of frFiles) {
      const filename = path.basename(relFr);
      const relEn = path.join(relEnBase, filename);
      list.push({
        type: "mdx",
        frPath: path.join(ROOT, relFr),
        enPath: path.join(ROOT, relEn),
        relFr,
        relEn,
      });
    }
  }

  // messages/fr.json
  list.push({
    type: "json",
    frPath: path.join(MESSAGES_DIR, "fr.json"),
    enPath: path.join(MESSAGES_DIR, "en.json"),
    relFr: path.join("messages", "fr.json"),
    relEn: path.join("messages", "en.json"),
  });

  return list;
}

/**
 * Analyse un fichier et retourne son statut.
 */
function analyzeFile(entry, registry) {
  const { type, frPath, enPath, relFr, relEn } = entry;

  // Les relFr/relEn sont relatifs à frontend/ (ex: "content/fr/home.mdx")
  const frAbsPath = path.join(ROOT, "frontend", relFr);
  const enAbsPath = path.join(ROOT, "frontend", relEn);

  if (!fs.existsSync(frAbsPath)) {
    return { ...entry, status: "error", error: "FR file not found" };
  }

  // Calcul du checksum courant (fichier entier — frontmatter inclus, Option A)
  const rawContent = fs.readFileSync(frAbsPath, "utf8");
  const currentChecksum = sha256(rawContent);

  const enExists = fs.existsSync(enAbsPath);
  const registryEntry = registry.files[relFr];
  const savedChecksum = registryEntry?.checksum;
  const translatedAt  = registryEntry?.translatedAt ?? null;

  let status;
  if (!enExists && !registryEntry) {
    status = "new";
  } else if (!enExists) {
    status = "new";
  } else if (!registryEntry) {
    status = "unregistered"; // EN existe mais pas dans le registre
  } else if (currentChecksum !== savedChecksum) {
    status = "needs-translation";
  } else {
    status = "up-to-date";
  }

  return {
    ...entry,
    status,
    currentChecksum,
    savedChecksum: savedChecksum ?? null,
    translatedAt,
    enExists,
  };
}

// ─── Formatters ───────────────────────────────────────────────────────────────

const STATUS_ICON = {
  "up-to-date":       "✅",
  "needs-translation":"🔴",
  "new":              "🆕",
  "unregistered":     "⚠️ ",
  "error":            "❌",
};

const STATUS_LABEL = {
  "up-to-date":       "up-to-date",
  "needs-translation":"needs-translation",
  "new":              "new (no EN)",
  "unregistered":     "unregistered",
  "error":            "error",
};

function formatDate(iso) {
  if (!iso) return "—";
  return iso.split("T")[0];
}

function printTable(results) {
  const COL1 = 55;
  const COL2 = 22;
  const COL3 = 14;

  const header = `${"File (FR)".padEnd(COL1)}${"Status".padEnd(COL2)}${"Last translated".padEnd(COL3)}`;
  console.log("\n" + header);
  console.log("─".repeat(header.length));

  for (const r of results) {
    const icon  = STATUS_ICON[r.status]  ?? "?";
    const label = STATUS_LABEL[r.status] ?? r.status;
    const date  = formatDate(r.translatedAt);
    const file  = r.relFr.length > COL1 - 2 ? "…" + r.relFr.slice(-(COL1 - 3)) : r.relFr;
    console.log(`${file.padEnd(COL1)}${(icon + " " + label).padEnd(COL2)}${date.padEnd(COL3)}`);
  }
  console.log();
}

// ─── --update mode ────────────────────────────────────────────────────────────

/**
 * Met à jour le registre de checksums pour les fichiers up-to-date.
 * Usage: après traduction manuelle, marquer les fichiers comme traduits.
 * Note: saute les fichiers EN dont la taille est < 50% du FR (probablement des stubs anciens).
 */
function updateRegistry(results, registry) {
  let updated = 0;
  let skipped = 0;
  for (const r of results) {
    if (r.status === "error") continue;
    if (!registry.files[r.relFr]) {
      registry.files[r.relFr] = {};
    }
    // On ne marque "up-to-date" que si le fichier EN existe
    const enAbsPath = path.join(ROOT, "frontend", r.relEn);
    const frAbsPath = path.join(ROOT, "frontend", r.relFr);
    if (fs.existsSync(enAbsPath)) {
      const frContent = fs.readFileSync(frAbsPath, "utf8");
      const enContent = fs.readFileSync(enAbsPath, "utf8");
      const frSize = frContent.length;
      const enSize = enContent.length;

      // Vérification 1 : taille — EN < 50% du FR → stub probable
      if (enSize < frSize * 0.5) {
        console.warn(`  ⚠️  ${r.relFr} : EN (${enSize}B) est < 50% du FR (${frSize}B) — probablement un stub. Ignoré.`);
        skipped++;
        continue;
      }

      // Vérification 2 : images — FR contient des images mais EN n'en a aucune → désynchronisé
      const frImages = (frContent.match(/!\[/g) || []).length;
      const enImages = (enContent.match(/!\[/g) || []).length;
      if (frImages > 0 && enImages === 0) {
        console.warn(`  ⚠️  ${r.relFr} : FR contient ${frImages} image(s) absente(s) de l'EN — désynchronisé. Ignoré.`);
        skipped++;
        continue;
      }
      registry.files[r.relFr] = {
        checksum: r.currentChecksum,
        translatedAt: new Date().toISOString(),
        enFile: r.relEn,
        status: "up-to-date",
      };
      updated++;
    }
  }
  registry.updatedAt = new Date().toISOString();
  saveChecksums(registry);
  return { updated, skipped };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const outputJson  = args.includes("--json");
  const failOnDrift = args.includes("--fail-on-drift");
  const doUpdate    = args.includes("--update");
  // --accept file1 file2 ... (tous les args qui ne commencent pas par --)
  const doAccept    = args.includes("--accept");
  const acceptFiles = doAccept
    ? args.slice(args.indexOf("--accept") + 1).filter((a) => !a.startsWith("--"))
    : [];

  const registry = loadChecksums();
  const fileList = buildFileList();
  const results  = fileList.map((entry) => analyzeFile(entry, registry));

  const drifted = results.filter((r) =>
    ["needs-translation", "new", "unregistered"].includes(r.status)
  );
  const errors  = results.filter((r) => r.status === "error");

  // ── --accept : force-enregistre des fichiers spécifiques sans vérifications ──
  if (doAccept) {
    if (acceptFiles.length === 0) {
      console.error("❌ --accept requiert au moins un fichier.");
      console.error("   Usage : node scripts/check-translation-status.js --accept content/fr/proxp/access.mdx ...");
      process.exit(1);
    }
    let accepted = 0;
    for (const rawPath of acceptFiles) {
      // Normalise : enlève le préfixe frontend/ si présent
      let relFr = rawPath.replace(/\\/g, "/");
      if (relFr.startsWith("frontend/")) relFr = relFr.slice("frontend/".length);

      const frAbsPath = path.join(ROOT, "frontend", relFr);
      if (!fs.existsSync(frAbsPath)) {
        console.warn(`  ⚠️  Introuvable : ${relFr}`);
        continue;
      }
      const rawContent = fs.readFileSync(frAbsPath, "utf8");
      const currentChecksum = sha256(rawContent);
      const relEn = relFr.replace(/^content\/fr\//, "content/en/");

      registry.files[relFr] = {
        checksum: currentChecksum,
        translatedAt: registry.files[relFr]?.translatedAt ?? new Date().toISOString(),
        enFile: relEn,
        status: "up-to-date",
        acceptedAt: new Date().toISOString(),
        acceptNote: "Marqué manuellement (changement non-textuel)",
      };
      console.log(`  ✅ Accepté : ${relFr}`);
      accepted++;
    }
    registry.updatedAt = new Date().toISOString();
    saveChecksums(registry);
    console.log(`\n${accepted} fichier(s) marqué(s) comme up-to-date.`);
    return;
  }

  // ── --update mode ──
  if (doUpdate) {
    const { updated, skipped } = updateRegistry(results, registry);
    console.log(`✅ Registre mis à jour : ${updated} fichier(s) enregistré(s)${skipped > 0 ? `, ${skipped} stub(s) ignoré(s)` : ""} dans ${CHECKSUMS_FILE}`);
    return;
  }

  // ── JSON output ──
  if (outputJson) {
    const output = {
      timestamp: new Date().toISOString(),
      summary: {
        total: results.length,
        upToDate: results.filter((r) => r.status === "up-to-date").length,
        needsTranslation: results.filter((r) => r.status === "needs-translation").length,
        new: results.filter((r) => r.status === "new").length,
        unregistered: results.filter((r) => r.status === "unregistered").length,
        errors: errors.length,
      },
      files: results.map((r) => ({
        frFile: r.relFr,
        enFile: r.relEn,
        status: r.status,
        translatedAt: r.translatedAt,
        checksumMatch: r.currentChecksum === r.savedChecksum,
      })),
    };
    console.log(JSON.stringify(output, null, 2));
  } else {
    // ── Pretty print ──
    console.log("📋  Rapport de parité FR/EN — " + new Date().toLocaleString("fr-FR"));
    printTable(results);

    const upToDate = results.filter((r) => r.status === "up-to-date").length;
    const needsTr  = results.filter((r) => r.status === "needs-translation").length;
    const newFiles = results.filter((r) => r.status === "new").length;
    const unreg    = results.filter((r) => r.status === "unregistered").length;

    console.log(`Résumé : ${upToDate} ✅ à jour | ${needsTr} 🔴 à traduire | ${newFiles} 🆕 nouveaux | ${unreg} ⚠️  non enregistrés | ${errors.length} ❌ erreurs`);

    if (drifted.length > 0) {
      console.log(`\n💡 Pour traduire les fichiers en attente :`);
      console.log(`   node scripts/translate-fr-to-en.js --all-pending`);
      console.log(`   node scripts/translate-fr-to-en.js --file <chemin/fr/fichier.mdx>`);
    } else {
      console.log("\n🎉 Tous les fichiers FR sont synchronisés avec leur traduction EN.");
    }

    if (errors.length > 0) {
      console.error(`\n❌ Erreurs :`);
      for (const e of errors) console.error(`   ${e.relFr} : ${e.error}`);
    }
  }

  if (failOnDrift && drifted.length > 0) {
    process.exit(1);
  }
}

main();
