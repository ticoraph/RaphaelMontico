# Traduction FR → EN — Guide d'utilisation

Ce document décrit le système de parité et de traduction FR→EN du portfolio.
Il couvre la détection des dérives de contenu, la traduction automatique via OpenAI (`OPENAI_CHAT_MODEL`)
et l'intégration en CI/CD.

---

## 🗂️ Fichiers du système

| Fichier | Rôle |
|---|---|
| `scripts/check-translation-status.js` | Rapport de parité FR/EN — lecture seule |
| `scripts/translate-fr-to-en.js` | Framework de traduction FR→EN via OpenAI (`OPENAI_CHAT_MODEL`) |
| `data/translation-checksums.json` | Registre des checksums de chaque fichier FR |

---

## 🧠 Principe de fonctionnement

La source de vérité est toujours le **contenu FR**. Le workflow est :

1. Tu modifies (ou crées) une page FR
2. Un checksum SHA-256 du **corps** du fichier est calculé et comparé au registre
3. Si le checksum a changé → le fichier est marqué `needs-translation`
4. Tu lances la traduction → OpenAI (`OPENAI_CHAT_MODEL`) traduit le contenu et met à jour le registre

> **Granularité du checksum pour les MDX** : le fichier **entier** est pris en compte (frontmatter YAML inclus). Un changement de `title:` ou `subtitle:` déclenche une re-traduction.

### Statuts possibles

| Icône | Statut | Signification |
|---|---|---|
| ✅ | `up-to-date` | Le FR n'a pas changé depuis la dernière traduction |
| 🔴 | `needs-translation` | Le corps FR a été modifié |
| 🆕 | `new` | Fichier FR sans homologue EN |
| ⚠️ | `unregistered` | Fichier EN existant mais absent du registre |
| ❌ | `error` | Fichier FR introuvable |

---

## ⚙️ Configuration

Ajouter la clé API dans **`backend/.env`** (le même fichier que celui du backend) :

```bash
OPENAI_API_KEY=ta_clé_ici
```

> Le script charge automatiquement `backend/.env` (`OPENAI_API_KEY`, `OPENAI_CHAT_MODEL`). Une variable déjà définie dans l'environnement a priorité.
> La clé dans l'un des trois suffit.

---

## 🔁 Workflow quotidien

### 1. Modifier ou créer une page FR

```bash
# Éditer une page existante
vim frontend/content/fr/home.mdx

# Ou créer un nouveau fichier
vim frontend/content/fr/perxp/mon-projet.mdx
```

### 2. Vérifier les dérives

```bash
node scripts/check-translation-status.js
```

Exemple de sortie :

```
📋  Rapport de parité FR/EN — 31/07/2026

File (FR)                                              Status                Last translated
────────────────────────────────────────────────────────────────────────────────────────────
content/fr/home.mdx                                    🔴 needs-translation  2026-07-25
content/fr/perxp/mon-projet.mdx                        🆕 new (no EN)        —
content/fr/cv.mdx                                      ✅ up-to-date          2026-07-31

Résumé : 1 ✅ à jour | 1 🔴 à traduire | 1 🆕 nouveaux
```

### 3. Traduire les fichiers en attente

**Traduire un fichier spécifique :**
```bash
node scripts/translate-fr-to-en.js --file frontend/content/fr/home.mdx
```

**Traduire tous les fichiers en attente d'un coup :**
```bash
node scripts/translate-fr-to-en.js --all-pending
```

**Prévisualiser sans appeler l'API (dry-run) :**
```bash
node scripts/translate-fr-to-en.js --all-pending --dry-run
```

### 4. Vérifier après traduction

```bash
node scripts/check-translation-status.js
# → tout doit être ✅ up-to-date
```

---

## 📋 Référence des options

### `check-translation-status.js`

```
node scripts/check-translation-status.js [options]
```

| Option | Description |
|---|---|
| *(aucune)* | Rapport lisible en console |
| `--json` | Sortie JSON (pour CI/CD ou scripts) |
| `--fail-on-drift` | Exit code 1 si des fichiers ont drifté |
| `--update` | Enregistre les checksums actuels dans le registre |
| `--accept <fichiers>` | Force l'enregistrement de fichiers sans traduction (ex: changement de lien) |

### `translate-fr-to-en.js`

```
node scripts/translate-fr-to-en.js [options]
```

| Option | Description |
|---|---|
| `--file <chemin>` | Traduit un seul fichier (chemin relatif à la racine) |
| `--all-pending` | Traduit tous les fichiers `needs-translation` ou `new` |
| `--fix-frontmatter`| Patche uniquement le frontmatter (`title`, `subtitle`, `overview`) des EN existants |
| `--dry-run` | Affiche ce qui serait traduit sans appeler l'API |
| `--show-prompt` | Debug : affiche le prompt envoyé à OpenAI |

---

## 🚀 Intégration CI/CD

Pour bloquer le déploiement si une traduction est manquante, ajouter dans le workflow GitHub Actions :

```yaml
- name: Check FR/EN translation parity
  run: node scripts/check-translation-status.js --fail-on-drift
```

---

## 📄 Fichiers couverts

Le système surveille automatiquement :

| Collection | Dossier FR | Dossier EN |
|---|---|---|
| Pages racine | `frontend/content/fr/*.mdx` | `frontend/content/en/*.mdx` |
| Parcours pro | `frontend/content/fr/proxp/` | `frontend/content/en/proxp/` |
| Projets perso | `frontend/content/fr/perxp/` | `frontend/content/en/perxp/` |
| Projets académiques | `frontend/content/fr/schoolprojects/` | `frontend/content/en/schoolprojects/` |
| Diplômes | `frontend/content/fr/diplomas/` | `frontend/content/en/diplomas/` |
| Chaînes i18n | `frontend/messages/fr.json` | `frontend/messages/en.json` |

---

## 🔧 Cas particuliers

### Ajouter une nouvelle collection de contenu

Ouvrir `scripts/check-translation-status.js` et `scripts/translate-fr-to-en.js`,
puis ajouter le nom du dossier dans le tableau `COLLECTIONS` en haut des deux fichiers :

```js
const COLLECTIONS = ["", "proxp", "perxp", "diplomas", "schoolprojects", "ma-nouvelle-collection"];
```

### Après une traduction manuelle

Si tu traduis un fichier EN manuellement sans passer par le script, enregistre son checksum dans le registre pour éviter qu'il apparaisse comme `needs-translation` :

```bash
node scripts/check-translation-status.js --update
```

### Comportement de la traduction OpenAI

- Le **frontmatter YAML** : `title`, `subtitle` et `overview` **sont traduits**. Les autres champs (`slug`, `tags`, `date`) sont conservés tels quels.
- Les **termes techniques** ne sont pas traduits : LLM, RAG, MLOps, LoRA, QLoRA, Fine-tuning, Citrix, VMware, XenApp, Docker, FastAPI, etc.
- Les **noms propres** (entreprises, villes, personnes) ne sont pas traduits
- La **syntaxe MDX** (composants JSX, balises, liens) est préservée intacte
- Les **blocs de code** ne sont pas traduits
