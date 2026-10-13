export type SkillGroup = { title: string; items: string[] };
export type SkillStage = { title: string; groups: SkillGroup[] };
export type SkillsSection = {
  title: string;
  intro: string;
  /** Pipeline stages, in reading order. */
  stages: SkillStage[];
  /** Cross-cutting layer (last `###` of the section), drawn under the pipeline. */
  foundation: SkillStage;
};

/**
 * Splits a page body at its first `## ` heading and reads that section as a skills map.
 *
 * The section is plain Markdown on purpose (the RAG ingestion chunks it by heading, so
 * the chatbot can answer questions about skills) and follows a fixed shape:
 *
 *   ## Section title
 *   intro paragraph
 *   ### Stage            (every `###` but the last = a pipeline column)
 *   #### Category
 *   - Item · Item · Item
 *   ### Foundation       (the last `###` = the transversal band)
 *
 * Returns `skills: null` when the section doesn't match that shape, so callers can
 * fall back to rendering the whole body as ordinary Markdown.
 */
export function splitSkillsSection(markdown: string): {
  before: string;
  skills: SkillsSection | null;
} {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => /^## /.test(line));
  if (start === -1) return { before: markdown, skills: null };

  const before = lines.slice(0, start).join("\n");
  const title = lines[start].replace(/^## /, "").trim();
  const introLines: string[] = [];
  const stages: SkillStage[] = [];

  for (const raw of lines.slice(start + 1)) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith("### ")) {
      stages.push({ title: line.slice(4).trim(), groups: [] });
    } else if (line.startsWith("#### ")) {
      const stage = stages[stages.length - 1];
      if (!stage) return { before: markdown, skills: null };
      stage.groups.push({ title: line.slice(5).trim(), items: [] });
    } else if (line.startsWith("- ")) {
      const group = stages[stages.length - 1]?.groups.at(-1);
      if (!group) return { before: markdown, skills: null };
      group.items.push(
        ...line
          .slice(2)
          .split(" · ")
          .map((item) => item.trim())
          .filter(Boolean),
      );
    } else if (stages.length === 0) {
      introLines.push(line);
    } else {
      return { before: markdown, skills: null };
    }
  }

  const valid =
    stages.length >= 2 &&
    stages.every((s) => s.groups.length > 0 && s.groups.every((g) => g.items.length > 0));
  if (!valid) return { before: markdown, skills: null };

  const foundation = stages[stages.length - 1];
  return {
    before,
    skills: { title, intro: introLines.join(" "), stages: stages.slice(0, -1), foundation },
  };
}
