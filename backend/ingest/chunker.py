import re
from dataclasses import dataclass

_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$", re.MULTILINE)


@dataclass
class TextChunk:
    section: str | None
    content: str


def chunk_markdown(body: str) -> list[TextChunk]:
    """Heading-aware split: one chunk per top-level-or-deeper section. Falls back
    to a single whole-document chunk when there are no headings at all (true today
    for the short placeholder content; real articles are expected to have headings,
    which is also what lets `section` carry a meaningful value)."""
    body = body.strip()
    if not body:
        return []

    headings = list(_HEADING_RE.finditer(body))
    if not headings:
        return [TextChunk(section=None, content=body)]

    chunks: list[TextChunk] = []

    preamble = body[: headings[0].start()].strip()
    if preamble:
        chunks.append(TextChunk(section=None, content=preamble))

    for index, match in enumerate(headings):
        section_title = match.group(2).strip()
        start = match.end()
        end = headings[index + 1].start() if index + 1 < len(headings) else len(body)
        section_body = body[start:end].strip()
        if section_body:
            chunks.append(
                TextChunk(section=section_title, content=f"{section_title}\n{section_body}")
            )

    return chunks
