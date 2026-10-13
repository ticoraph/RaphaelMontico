#!/usr/bin/env node
/**
 * translate-fr-to-en.js
 *
 * Framework de traduction FR→EN via OpenAI.
 * Lit les fichiers MDX (ou messages/fr.json) FR, les traduit et écrit les fichiers EN.
 * Met à jour data/translation-checksums.json après chaque traduction réussie.
 *
 * Usage:
 *   node scripts/translate-fr-to-en.js --file frontend/content/fr/home.mdx
 *   node scripts/translate-fr-to-en.js --all-pending
 *   node scripts/translate-fr-to-en.js --all-pending --dry-run
 *   node scripts/translate-fr-to-en.js --file frontend/messages/fr.json
 *
 * Options:
 *   --file <path>    Traduit un fichier spécifique (chemin relatif à la racine du projet)
 *   --all-pending    Traduit tous les fichiers avec statut needs-translation ou new
 *   --dry-run        Affiche ce qui serait traduit sans écrire ni appeler l'API
 *   --show-prompt    Affiche le prompt envoyé à l'API (debug)
 *
 * Configuration (variable d'environnement ou backend/.env) :
 *   OPENAI_API_KEY=...
 */

"use strict";

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");
const https  = require("https");

// ─── Load .env (backend/.env) ──────────────────────────────────────────────────

function loadDotEnv() {
  const envFiles = [
    path.join(__dirname, "..", "backend", ".env"),
  ];
  for (const envFile of envFiles) {
    if (!fs.existsSync(envFile)) continue;
    const lines = fs.readFileSync(envFile, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

loadDotEnv();

// ─── Paths ────────────────────────────────────────────────────────────────────

const ROOT           = path.join(__dirname, "..");
const CONTENT_DIR    = path.join(ROOT, "frontend", "content");
const MESSAGES_DIR   = path.join(ROOT, "frontend", "messages");
const CHECKSUMS_FILE = path.join(ROOT, "data", "translation-checksums.json");

const COLLECTIONS = ["", "proxp", "perxp", "diplomas", "schoolprojects"];

// ─── Checksums ────────────────────────────────────────────────────────────────

function loadChecksums() {
  if (!fs.existsSync(CHECKSUMS_FILE)) return { version: 1, files: {} };
  return JSON.parse(fs.readFileSync(CHECKSUMS_FILE, "utf8"));
}

function saveChecksums(registry) {
  const dir = path.dirname(CHECKSUMS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  registry.updatedAt = new Date().toISOString();
  fs.writeFileSync(CHECKSUMS_FILE, JSON.stringify(registry, null, 2) + "\n", "utf8");
}

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

// ─── MDX Parsing ─────────────────────────────────────────────────────────────

/**
 * Sépare le frontmatter YAML du corps MDX.
 * Retourne { frontmatter: string, body: string, hasFrontmatter: boolean }
 */
function parseMdx(content) {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (fmMatch) {
    return { frontmatter: fmMatch[1], body: fmMatch[2], hasFrontmatter: true };
  }
  return { frontmatter: "", body: content, hasFrontmatter: false };
}

/**
 * Reconstruit un fichier MDX à partir du frontmatter traduit et du corps traduit.
 */
function rebuildMdx(frontmatter, translatedBody) {
  if (!frontmatter) return translatedBody;
  return `---\n${frontmatter}\n---\n${translatedBody}`;
}

/**
 * Parse un frontmatter YAML en objet clé/valeur simple.
 * Gère les champs scalaires (string) et les tableaux.
 */
function parseFrontmatterFields(fmStr) {
  const fields = {};
  const lines = fmStr.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const scalarMatch = line.match(/^(\w+):\s*"?(.*?)"?\s*$/);
    const arrayStartMatch = line.match(/^(\w+):\s*\[/);
    const multilineArrayMatch = line.match(/^(\w+):\s*$/);
    if (arrayStartMatch || (scalarMatch && line.includes("["))) {
      // Tableau sur une ligne : tags: ["a", "b"]
      fields[scalarMatch?.[1] ?? arrayStartMatch[1]] = { raw: line, type: "raw" };
    } else if (multilineArrayMatch && lines[i + 1]?.trim().startsWith("-")) {
      // Tableau multiligne
      const key = multilineArrayMatch[1];
      let raw = line;
      i++;
      while (i < lines.length && lines[i].trim().startsWith("-")) {
        raw += "\n" + lines[i];
        i++;
      }
      fields[key] = { raw, type: "raw" };
      continue;
    } else if (scalarMatch && scalarMatch[1]) {
      fields[scalarMatch[1]] = { value: scalarMatch[2], type: "scalar" };
    }
    i++;
  }
  return fields;
}

/**
 * Traduit les champs textuels du frontmatter (title, subtitle, overview)
 * via OpenAI, en préservant les champs techniques (slug, tags, date, order).
 * Retourne la chaîne frontmatter reconstruite.
 */
async function translateFrontmatter(apiKey, frFrontmatter) {
  // Champs à traduire
  const TRANSLATABLE = ["title", "subtitle", "overview"];

  // Extraire les valeurs FR à traduire
  const toTranslate = {};
  const fields = parseFrontmatterFields(frFrontmatter);
  for (const key of TRANSLATABLE) {
    if (fields[key] && fields[key].type === "scalar" && fields[key].value) {
      toTranslate[key] = fields[key].value;
    }
  }

  if (Object.keys(toTranslate).length === 0) return frFrontmatter;

  const prompt = `Translate these French strings to English for a professional IT/AI portfolio.
Return ONLY a JSON object with the same keys and translated values.
Do not translate technical terms (LLM, RAG, MLOps, Citrix, VMware, RNCP, etc.).
Do not translate proper nouns (company names, city names, person names).
Do not add explanations.

Input JSON:
${JSON.stringify(toTranslate, null, 2)}

Output JSON:`;

  const response = await callOpenAI(apiKey, prompt);
  const cleaned = response.replace(/^```(?:json)?\r?\n?/, "").replace(/\r?\n?```$/, "").trim();

  let translated;
  try {
    translated = JSON.parse(cleaned);
  } catch (e) {
    console.warn("  ⚠️  Frontmatter translation parse error — keeping original.");
    return frFrontmatter;
  }

  // Reconstruire le frontmatter en remplaçant les valeurs traduites
  let result = frFrontmatter;
  for (const key of TRANSLATABLE) {
    if (translated[key]) {
      // Remplace la ligne "key: "valeur"" ou "key: valeur"
      result = result.replace(
        new RegExp(`^(${key}:\\s*)"?.*?"?\\s*$`, "m"),
        `$1"${translated[key].replace(/"/g, "'")}"`,
      );
    }
  }
  return result;
}

// ─── File Discovery ───────────────────────────────────────────────────────────

function collectMdxFiles(dir, relBase) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".mdx"))
    .map((e) => path.join(relBase, e.name));
}

function buildFileList() {
  const list = [];

  for (const collection of COLLECTIONS) {
    const frDir  = collection
      ? path.join(CONTENT_DIR, "fr", collection)
      : path.join(CONTENT_DIR, "fr");
    const relBase = collection
      ? path.join("content", "fr", collection)
      : path.join("content", "fr");
    const relEnBase = collection
      ? path.join("content", "en", collection)
      : path.join("content", "en");

    for (const relFr of collectMdxFiles(frDir, relBase)) {
      list.push({
        type: "mdx",
        relFr,
        relEn: path.join(relEnBase, path.basename(relFr)),
      });
    }
  }

  // messages/fr.json
  list.push({
    type: "json",
    relFr: path.join("messages", "fr.json"),
    relEn: path.join("messages", "en.json"),
  });

  return list;
}

function getPendingFiles(registry) {
  const all = buildFileList();
  return all.filter(({ relFr, relEn }) => {
    const frPath = path.join(ROOT, "frontend", relFr);
    const enPath = path.join(ROOT, "frontend", relEn);
    if (!fs.existsSync(frPath)) return false;

    const rawContent = fs.readFileSync(frPath, "utf8");
    const entry = registry.files[relFr];
    const savedChecksum = entry?.checksum;

    // Checksum sur le fichier entier (frontmatter inclus, Option A)
    const currentChecksum = sha256(rawContent);

    const enExists = fs.existsSync(enPath);
    return !enExists || !savedChecksum || currentChecksum !== savedChecksum;
  });
}

// ─── OpenAI API ───────────────────────────────────────────────────────────────

const OPENAI_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-6-luna";
const OPENAI_API_URL = "https://api.openai.com/v1/responses";

/**
 * Appelle l'API OpenAI (Responses) pour traduire un texte.
 */
function callOpenAI(apiKey, prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: OPENAI_MODEL,
      input: prompt,
      max_output_tokens: 8192,
      reasoning: { effort: "none" }, // Traduction : pas de raisonnement, plus rapide et moins cher
    });

    const url = new URL(OPENAI_API_URL);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        Authorization: `Bearer ${apiKey}`,
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(`OpenAI API error: ${parsed.error.message}`));
            return;
          }
          const text = (parsed.output || [])
            .filter((item) => item.type === "message")
            .flatMap((item) => item.content || [])
            .filter((part) => part.type === "output_text")
            .map((part) => part.text)
            .join("");
          if (!text) {
            reject(new Error("OpenAI returned empty response: " + data));
            return;
          }
          resolve(text.trim());
        } catch (e) {
          reject(new Error("Failed to parse OpenAI response: " + data));
        }
      });
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

/**
 * Construit le prompt système pour la traduction MDX FR→EN.
 */
function buildMdxPrompt(frBody) {
  return `You are a professional French-to-English translator specializing in technical IT/AI portfolio content.

TASK: Translate the following MDX (Markdown with JSX) content from French to English.

STRICT RULES:
1. Translate ONLY the visible text — do NOT modify:
   - MDX/JSX components (e.g., <br />, <Component />, <Tag prop="value">)
   - Markdown syntax (**, *, ##, >, [], (), ---, etc.)
   - Links href values, image src paths
   - Code blocks (content between \`\`\` or \` \`)
   - HTML attributes and their values
2. Preserve ALL technical terms as-is (no translation needed):
   - Product/technology names: Citrix, VMware, XenApp, XenDesktop, VDI, PVS, MCS, FSLogix, WEM, Active Directory, Windows Server, etc.
   - AI/ML terms: LLM, RAG, MLOps, LoRA, QLoRA, Fine-tuning, PyTorch, Hugging Face, LangChain, LangGraph, MLflow, FastAPI, Streamlit, Evidently, etc.
   - Cloud: AWS, GCP, S3, CloudFront, ECS, Fargate, IAM, Cloud Run, Artifact Registry, Secret Manager
   - Other: Docker, GitHub Actions, CI/CD, VLAN, VDI, PostgreSQL, pgvector, FAISS, REST API
3. Certifications and diplomas: translate descriptions but keep certification codes as-is (RNCP, etc.)
4. Proper nouns (company names, person names, city names) are NOT translated
5. Return ONLY the translated content — no preamble, no explanation, no markdown code fence wrapping

INPUT (French MDX body):
${frBody}

OUTPUT (English translation):`;
}

/**
 * Construit le prompt pour la traduction messages/fr.json → messages/en.json.
 */
function buildJsonPrompt(frJson, existingEnJson) {
  return `You are a professional French-to-English translator for a multilingual Next.js web application.

TASK: Translate the French i18n JSON file to English.

STRICT RULES:
1. Return ONLY valid JSON — no preamble, no explanation, no markdown code fence
2. Keep the EXACT same JSON structure and all keys unchanged
3. Translate only the string VALUES
4. Preserve placeholders like {name}, {count}, etc. exactly as-is
5. Keep technical terms as-is: LLM, RAG, MLOps, AI, etc.
6. The tone should be professional and natural English

EXISTING ENGLISH VERSION (for reference, may be outdated):
${existingEnJson}

FRENCH VERSION TO TRANSLATE:
${frJson}

OUTPUT (English JSON):`;
}

// ─── Translation Logic ────────────────────────────────────────────────────────

async function translateFile(entry, registry, opts = {}) {
  const { relFr, relEn, type } = entry;
  const { dryRun = false, showPrompt = false } = opts;

  // Chemins absolus dans le dossier frontend
  const frAbsPath = path.join(ROOT, "frontend", relFr);
  const enAbsPath = path.join(ROOT, "frontend", relEn);

  if (!fs.existsSync(frAbsPath)) {
    console.error(`  ❌ Fichier FR introuvable : ${frAbsPath}`);
    return false;
  }

  const rawFr = fs.readFileSync(frAbsPath, "utf8");
  const existingEn = fs.existsSync(enAbsPath) ? fs.readFileSync(enAbsPath, "utf8") : "";

  // Checksum sur le fichier entier (frontmatter inclus, Option A)
  const currentChecksum = sha256(rawFr);

  if (type === "mdx") {
    const { frontmatter, body } = parseMdx(rawFr);
    const prompt = buildMdxPrompt(body);

    if (showPrompt) {
      console.log("\n── PROMPT ──────────────────────────────────────────\n");
      console.log(prompt.slice(0, 500) + "\n...(truncated)");
      console.log("────────────────────────────────────────────────────\n");
    }

    if (dryRun) {
      console.log(`  [DRY-RUN] Traduirait ${relFr} → ${relEn} (${body.length} chars)`);
      if (frontmatter) console.log(`  [DRY-RUN] Frontmatter conservé tel quel.`);
      return true;
    }

    console.log(`  🔄 Traduction en cours via OpenAI…`);
    const [translatedBody, translatedFm] = await Promise.all([
      callOpenAI(process.env.OPENAI_API_KEY, prompt),
      translateFrontmatter(process.env.OPENAI_API_KEY, frontmatter),
    ]);

    // Nettoyage du corps : retirer les éventuels blocs ``` qu'OpenAI ajouterait
    const cleaned = translatedBody
      .replace(/^```(?:mdx|markdown)?\r?\n?/, "")
      .replace(/\r?\n?```$/, "")
      .trim();

    const finalContent = rebuildMdx(translatedFm, "\n" + cleaned + "\n");

    // Écrire le fichier EN
    const enDir = path.dirname(enAbsPath);
    if (!fs.existsSync(enDir)) fs.mkdirSync(enDir, { recursive: true });
    fs.writeFileSync(enAbsPath, finalContent, "utf8");

  } else {
    // JSON (messages/fr.json)
    const prompt = buildJsonPrompt(rawFr, existingEn);

    if (showPrompt) {
      console.log("\n── PROMPT ──────────────────────────────────────────\n");
      console.log(prompt);
      console.log("────────────────────────────────────────────────────\n");
    }

    if (dryRun) {
      console.log(`  [DRY-RUN] Traduirait ${relFr} → ${relEn}`);
      return true;
    }

    console.log(`  🔄 Traduction JSON en cours via OpenAI…`);
    const translatedJson = await callOpenAI(process.env.OPENAI_API_KEY, prompt);

    // Nettoyage des éventuels blocs markdown
    const cleaned = translatedJson
      .replace(/^```(?:json)?\r?\n?/, "")
      .replace(/\r?\n?```$/, "")
      .trim();

    // Valider le JSON
    try {
      JSON.parse(cleaned);
    } catch (e) {
      console.error(`  ❌ La réponse OpenAI n'est pas un JSON valide :`);
      console.error(cleaned.slice(0, 300));
      return false;
    }

    fs.writeFileSync(enAbsPath, cleaned + "\n", "utf8");
  }

  // Mettre à jour le registre de checksums
  if (!registry.files[relFr]) registry.files[relFr] = {};
  registry.files[relFr] = {
    checksum: currentChecksum,
    translatedAt: new Date().toISOString(),
    enFile: relEn,
    status: "up-to-date",
  };
  saveChecksums(registry);

  console.log(`  ✅ Traduit → ${relEn}`);
  return true;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args          = process.argv.slice(2);
  const fileArg       = args.includes("--file")            ? args[args.indexOf("--file") + 1]  : null;
  const allPending    = args.includes("--all-pending");
  const fixFrontmatter = args.includes("--fix-frontmatter");
  const dryRun        = args.includes("--dry-run");
  const showPrompt    = args.includes("--show-prompt");

  if (!fileArg && !allPending && !fixFrontmatter) {
    console.log(`
Usage:
  node scripts/translate-fr-to-en.js --file frontend/content/fr/<fichier>.mdx
  node scripts/translate-fr-to-en.js --all-pending
  node scripts/translate-fr-to-en.js --all-pending --dry-run
  node scripts/translate-fr-to-en.js --fix-frontmatter
  node scripts/translate-fr-to-en.js --file frontend/messages/fr.json

Options:
  --file <path>       Traduit un fichier FR spécifique (relatif à la racine du projet)
  --all-pending       Traduit tous les fichiers en attente (needs-translation ou new)
  --fix-frontmatter   Patche uniquement le frontmatter (title/subtitle/overview) des EN existants
  --dry-run           Affiche ce qui serait traduit sans appeler l'API
  --show-prompt       Affiche le prompt envoyé à l'API (debug)
`);
    process.exit(0);
  }

  // Vérification de la clé API
  if (!dryRun && !process.env.OPENAI_API_KEY) {
    console.error("❌ OPENAI_API_KEY non définie.");
    console.error("   Ajoutez-la dans backend/.env :");
    console.error("   OPENAI_API_KEY=votre_clé_ici");
    process.exit(1);
  }

  const registry = loadChecksums();

  // ── --fix-frontmatter : patche les EN existants dont le frontmatter est en FR ──
  if (fixFrontmatter) {
    const allFiles = buildFileList().filter((e) => e.type === "mdx");
    const TRANSLATABLE_KEYS = ["title", "subtitle", "overview"];
    const frDetect = /[àâäéèêëîïôöùûüçœæ]/i;

    let fixed = 0;
    let skipped = 0;

    for (const { relFr, relEn } of allFiles) {
      const enAbsPath = path.join(ROOT, "frontend", relEn);
      const frAbsPath = path.join(ROOT, "frontend", relFr);
      if (!fs.existsSync(enAbsPath) || !fs.existsSync(frAbsPath)) continue;

      const enRaw = fs.readFileSync(enAbsPath, "utf8");
      const { frontmatter: enFm, body: enBody } = parseMdx(enRaw);
      if (!enFm) { skipped++; continue; }

      // Détecter si des champs translatables contiennent encore du FR
      const enFields = parseFrontmatterFields(enFm);
      const hasFrText = TRANSLATABLE_KEYS.some((k) =>
        enFields[k]?.type === "scalar" && frDetect.test(enFields[k].value ?? "")
      );

      if (!hasFrText) { skipped++; continue; }

      const frRaw = fs.readFileSync(frAbsPath, "utf8");
      const { frontmatter: frFm } = parseMdx(frRaw);

      console.log(`\n📄 ${relEn} — frontmatter FR détecté`);
      if (dryRun) {
        console.log(`  [DRY-RUN] Traduirait le frontmatter`);
        fixed++;
        continue;
      }

      const translatedFm = await translateFrontmatter(process.env.OPENAI_API_KEY, frFm);
      const finalContent = rebuildMdx(translatedFm, enBody);
      fs.writeFileSync(enAbsPath, finalContent, "utf8");
      console.log(`  ✅ Frontmatter mis à jour`);
      fixed++;
    }

    console.log(`\n─────────────────────────────────────────`);
    if (dryRun) {
      console.log(`[DRY-RUN] ${fixed} fichier(s) auraient eu leur frontmatter traduit.`);
    } else {
      console.log(`Terminé : ${fixed} frontmatter(s) mis à jour ✅  |  ${skipped} déjà OK ⏭️`);
    }
    return;
  }

  if (fileArg) {
    // Normalise le chemin relatif : enlève "frontend/" s'il est inclus
    let relFr = fileArg.replace(/\\/g, "/");
    if (relFr.startsWith("frontend/")) relFr = relFr.slice("frontend/".length);

    // Détermine le relEn correspondant
    const relEn = relFr.replace(/^content\/fr\//, "content/en/");
    const type  = relFr.endsWith(".json") ? "json" : "mdx";
    const entry = { relFr, relEn, type };

    console.log(`\n📄 Fichier : ${relFr}`);
    await translateFile(entry, registry, { dryRun, showPrompt });

  } else if (allPending) {
    const pending = getPendingFiles(registry);

    if (pending.length === 0) {
      console.log("\n🎉 Aucun fichier en attente de traduction !");
      return;
    }

    console.log(`\n📋 ${pending.length} fichier(s) à traduire :\n`);
    for (const entry of pending) {
      console.log(`  • ${entry.relFr}`);
    }
    console.log();

    let success = 0;
    let errors  = 0;

    for (const entry of pending) {
      console.log(`\n📄 [${pending.indexOf(entry) + 1}/${pending.length}] ${entry.relFr}`);
      try {
        const ok = await translateFile(entry, registry, { dryRun, showPrompt });
        if (ok) success++;
        else errors++;
      } catch (e) {
        console.error(`  ❌ Erreur : ${e.message}`);
        errors++;
      }
    }

    console.log(`\n─────────────────────────────────────────`);
    if (dryRun) {
      console.log(`[DRY-RUN] ${success} fichier(s) auraient été traduits.`);
    } else {
      console.log(`Terminé : ${success} traduit(s) ✅  |  ${errors} erreur(s) ❌`);
      if (success > 0) {
        console.log(`\n💡 Pensez à vérifier les traductions dans frontend/content/en/`);
        console.log(`   puis lancez : node scripts/check-translation-status.js`);
      }
    }
  }
}

main().catch((err) => {
  console.error("❌ Erreur fatale :", err.message);
  process.exit(1);
});
