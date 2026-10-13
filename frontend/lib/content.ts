import fs from "fs";
import path from "path";
import matter from "gray-matter";

const CONTENT_DIR = path.join(process.cwd(), "content");

export type ContentFrontmatter = {
  title: string;
  slug: string;
  date?: string;
  order?: number;
  tags?: string[];
  subtitle?: string;
  overview?: string;
};

export type ContentItem = ContentFrontmatter & {
  content: string;
};

function readMdxFile(filePath: string, fallbackSlug: string): ContentItem {
  const raw = fs.readFileSync(filePath, "utf8");
  const { data, content } = matter(raw);

  return {
    title: data.title ?? fallbackSlug,
    slug: data.slug ?? fallbackSlug,
    date: data.date,
    order: data.order,
    tags: data.tags,
    subtitle: data.subtitle,
    overview: data.overview,
    content,
  };
}

function parseDateBound(part?: string): number {
  if (!part) return 0;
  const [mm, yyyy] = part.trim().split("/");
  const month = parseInt(mm, 10);
  const year = parseInt(yyyy, 10);
  if (Number.isNaN(month) || Number.isNaN(year)) return 0;
  return year * 100 + month;
}

function parseDateStart(date?: string): number {
  if (!date) return 0;
  return parseDateBound(date.split("-")[0]);
}

export function getCollection(locale: string, collection: string): ContentItem[] {
  const dir = path.join(CONTENT_DIR, locale, collection);
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".mdx"))
    .map((file) => readMdxFile(path.join(dir, file), file.replace(/\.mdx$/, "")))
    .sort((a, b) => {
      const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return parseDateStart(b.date) - parseDateStart(a.date);
    });
}

export function getCollectionItem(
  locale: string,
  collection: string,
  slug: string,
): ContentItem | null {
  const filePath = path.join(CONTENT_DIR, locale, collection, `${slug}.mdx`);
  if (!fs.existsSync(filePath)) return null;
  return readMdxFile(filePath, slug);
}

export function getSinglePage(locale: string, page: string): ContentItem | null {
  const filePath = path.join(CONTENT_DIR, locale, `${page}.mdx`);
  if (!fs.existsSync(filePath)) return null;
  return readMdxFile(filePath, page);
}
