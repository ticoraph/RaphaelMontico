from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path

import frontmatter

from app.schemas import ChunkType, Language

LOCALES: tuple[Language, ...] = ("en", "fr")

# Mirrors the collection directories actually used by frontend/app/[locale]/**/page.tsx
# (proxp, perxp, schoolprojects, diplomas + single page home), mapped to chunk types.
_COLLECTIONS_TO_TYPE: dict[str, ChunkType] = {
    "proxp": "experience",
    "perxp": "experience",
    "schoolprojects": "project",
    "diplomas": "diploma",
}
_SINGLE_PAGES_TO_TYPE: dict[str, ChunkType] = {
    "home": "page_section",
}


@dataclass
class ParsedDocument:
    type: ChunkType
    language: Language
    title: str
    slug: str
    date: datetime | None
    tags: list[str]
    body: str
    source_path: str


def default_content_dir() -> Path:
    # backend/ingest/parser.py -> backend/ -> repo root -> frontend/content
    return Path(__file__).resolve().parent.parent.parent / "frontend" / "content"


def _parse_date(value: object) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day, tzinfo=UTC)
    if isinstance(value, str):
        # Experience entries use ranges like "06/2016-06/2022" (or an open-ended
        # "06/2016") — index them by their start date.
        candidate = value.split("-", 1)[0].strip() if "/" in value else value.strip()
        # Blog posts have a full date, experience entries often only a year-month —
        # accept both, defaulting missing parts to 1.
        for fmt in ("%Y-%m-%d", "%Y-%m", "%Y", "%m/%Y"):
            try:
                return datetime.strptime(candidate, fmt).replace(tzinfo=UTC)
            except ValueError:
                continue
        try:
            parsed = datetime.fromisoformat(candidate)
        except ValueError:
            # A malformed date shouldn't abort the whole ingestion run — the
            # document is still indexed, just without a timestamp.
            return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    raise ValueError(f"Unsupported frontmatter date value: {value!r}")


def _read_mdx(
    path: Path, fallback_slug: str, language: Language, doc_type: ChunkType, content_root: Path
) -> ParsedDocument:
    post = frontmatter.load(path)
    return ParsedDocument(
        type=doc_type,
        language=language,
        title=post.metadata.get("title") or fallback_slug,
        slug=post.metadata.get("slug") or fallback_slug,
        date=_parse_date(post.metadata.get("date")),
        tags=list(post.metadata.get("tags") or []),
        body=post.content,
        source_path=str(path.relative_to(content_root.parent)),
    )


def parse_all(content_dir: Path | None = None) -> list[ParsedDocument]:
    content_dir = content_dir or default_content_dir()
    documents: list[ParsedDocument] = []

    for locale in LOCALES:
        locale_dir = content_dir / locale
        if not locale_dir.is_dir():
            continue

        for page_name, doc_type in _SINGLE_PAGES_TO_TYPE.items():
            page_path = locale_dir / f"{page_name}.mdx"
            if page_path.is_file():
                documents.append(_read_mdx(page_path, page_name, locale, doc_type, content_dir))

        for collection_name, doc_type in _COLLECTIONS_TO_TYPE.items():
            collection_dir = locale_dir / collection_name
            if not collection_dir.is_dir():
                continue
            for mdx_path in sorted(collection_dir.glob("*.mdx")):
                documents.append(_read_mdx(mdx_path, mdx_path.stem, locale, doc_type, content_dir))

    return documents
