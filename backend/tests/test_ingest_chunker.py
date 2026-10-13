from ingest.chunker import chunk_markdown


def test_returns_single_whole_document_chunk_when_no_headings():
    chunks = chunk_markdown("Just a short paragraph, no headings.")

    assert len(chunks) == 1
    assert chunks[0].section is None
    assert chunks[0].content == "Just a short paragraph, no headings."


def test_returns_empty_list_for_blank_body():
    assert chunk_markdown("   \n\n  ") == []


def test_splits_on_headings_and_keeps_preamble_as_its_own_chunk():
    body = "Intro text.\n\n## First\nFirst body.\n\n## Second\nSecond body."

    chunks = chunk_markdown(body)

    assert [c.section for c in chunks] == [None, "First", "Second"]
    assert chunks[0].content == "Intro text."
    assert chunks[1].content == "First\nFirst body."
    assert chunks[2].content == "Second\nSecond body."


def test_skips_sections_left_empty_after_their_heading():
    body = "## Empty\n\n## NotEmpty\nSome text."

    chunks = chunk_markdown(body)

    assert [c.section for c in chunks] == ["NotEmpty"]


def test_no_preamble_chunk_when_body_starts_with_a_heading():
    body = "## Only\nBody."

    chunks = chunk_markdown(body)

    assert len(chunks) == 1
    assert chunks[0].section == "Only"
