from datetime import UTC, date, datetime
from pathlib import Path

from ingest.parser import _parse_date, parse_all


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def test_parses_singleton_page_and_collection_entry(tmp_path):
    content_dir = tmp_path / "content"
    _write(content_dir / "en" / "home.mdx", '---\ntitle: "Home page"\n---\n\nBio text.')
    _write(
        content_dir / "en" / "diplomas" / "hello.mdx",
        '---\ntitle: "Hello"\nslug: "hello"\ndate: "2024-03-05"\n'
        'tags: ["a", "b"]\n---\n\nBody text.',
    )

    docs = {doc.source_path: doc for doc in parse_all(content_dir)}

    home = docs["content/en/home.mdx"]
    assert home.type == "page_section"
    assert home.title == "Home page"
    assert home.slug == "home"  # no frontmatter slug -> falls back to the filename
    assert home.date is None
    assert home.body == "Bio text."

    entry = docs["content/en/diplomas/hello.mdx"]
    assert entry.type == "diploma"
    assert entry.title == "Hello"
    assert entry.tags == ["a", "b"]
    assert entry.date == datetime(2024, 3, 5, tzinfo=UTC)


def test_maps_each_collection_folder_to_its_chunk_type(tmp_path):
    content_dir = tmp_path / "content"
    _write(content_dir / "en" / "proxp" / "job.mdx", '---\ntitle: "Job"\n---\n\nBody.')
    _write(content_dir / "en" / "perxp" / "side.mdx", '---\ntitle: "Side"\n---\n\nBody.')
    _write(content_dir / "en" / "schoolprojects" / "p.mdx", '---\ntitle: "P"\n---\n\nBody.')
    _write(content_dir / "en" / "diplomas" / "d.mdx", '---\ntitle: "D"\n---\n\nBody.')
    _write(content_dir / "en" / "home.mdx", '---\ntitle: "Home"\n---\n\nBody.')

    docs = {doc.source_path: doc for doc in parse_all(content_dir)}

    assert docs["content/en/proxp/job.mdx"].type == "experience"
    assert docs["content/en/perxp/side.mdx"].type == "experience"
    assert docs["content/en/schoolprojects/p.mdx"].type == "project"
    assert docs["content/en/diplomas/d.mdx"].type == "diploma"
    assert docs["content/en/home.mdx"].type == "page_section"


def test_parses_proxp_entry_with_date_range(tmp_path):
    content_dir = tmp_path / "content"
    _write(
        content_dir / "en" / "proxp" / "geodis.mdx",
        '---\ntitle: "Geodis"\nslug: "geodis"\ndate: "06/2016-06/2022"\n---\n\nBody.',
    )

    (doc,) = parse_all(content_dir)

    assert doc.type == "experience"
    assert doc.date == datetime(2016, 6, 1, tzinfo=UTC)


def test_skips_missing_locale_and_collection_directories(tmp_path):
    content_dir = tmp_path / "content"
    _write(content_dir / "en" / "diplomas" / "only.mdx", '---\ntitle: "Only"\n---\n\nBody.')
    # No "fr" locale at all, and no other collections under "en" either.

    docs = parse_all(content_dir)

    assert len(docs) == 1
    assert docs[0].title == "Only"


def test_parse_date_accepts_full_date_string():
    assert _parse_date("2024-03-05") == datetime(2024, 3, 5, tzinfo=UTC)


def test_parse_date_defaults_missing_day_for_year_month_string():
    # Real placeholder content uses this for experience entries, e.g. "2024-01".
    assert _parse_date("2024-03") == datetime(2024, 3, 1, tzinfo=UTC)


def test_parse_date_defaults_missing_month_and_day_for_year_only_string():
    assert _parse_date("2024") == datetime(2024, 1, 1, tzinfo=UTC)


def test_parse_date_uses_start_of_month_year_range():
    # proxp frontmatter uses ranges like "06/2016-06/2022".
    assert _parse_date("06/2016-06/2022") == datetime(2016, 6, 1, tzinfo=UTC)


def test_parse_date_accepts_bare_month_year_string():
    assert _parse_date("06/2016") == datetime(2016, 6, 1, tzinfo=UTC)


def test_parse_date_returns_none_for_unparseable_string():
    # A malformed date must not abort ingestion — the doc is indexed without one.
    assert _parse_date("since forever") is None


def test_parse_date_returns_none_for_missing_value():
    assert _parse_date(None) is None


def test_parse_date_accepts_a_yaml_native_date_object():
    assert _parse_date(date(2024, 3, 5)) == datetime(2024, 3, 5, tzinfo=UTC)
