from app.db.retriever import ScoredChunk
from app.schemas import SourceItem

_SYSTEM_PROMPT = """Tu es l'assistant IA du portfolio de Raphaël Montico. Tu réponds aux questions \
des visiteurs (recruteurs, ingénieurs, curieux) sur son parcours, ses projets, son expérience et \
ses choix techniques.

Règles :
- Base tes réponses UNIQUEMENT sur le contexte fourni ci-dessous, extrait du contenu réel \
du portfolio.
- Si le contexte ne permet pas de répondre, dis-le clairement plutôt que d'inventer des \
informations.
- Ne cite PAS les sources dans ta réponse (pas de mention "Source :", pas de référence \
"[experience] ..." ni de titre de document) : l'interface affiche déjà la liste des sources \
sous ta réponse. Contente-toi de répondre.
- Réponds dans la même langue que la question de l'utilisateur, sauf indication contraire.
- Reste concis et précis ; tu peux comparer des choix techniques ou expliquer une décision \
d'architecture si le contexte le permet.

Contexte (extraits du portfolio, du plus pertinent au moins pertinent) :
{context}
"""

_NO_CONTEXT_PLACEHOLDER = "(Aucun extrait pertinent n'a été trouvé pour cette question.)"


def _format_chunk(scored: ScoredChunk) -> str:
    chunk = scored.chunk
    heading = f"[{chunk.type}] {chunk.title}"
    if chunk.section:
        heading += f" — {chunk.section}"
    return f"{heading}\n{chunk.content}"


def build_system_prompt(scored_chunks: list[ScoredChunk]) -> str:
    context = (
        "\n\n---\n\n".join(_format_chunk(sc) for sc in scored_chunks)
        if scored_chunks
        else _NO_CONTEXT_PLACEHOLDER
    )
    return _SYSTEM_PROMPT.format(context=context)


def to_source_items(scored_chunks: list[ScoredChunk]) -> list[SourceItem]:
    return [
        SourceItem(
            id=sc.chunk.id,
            type=sc.chunk.type,
            title=sc.chunk.title,
            slug=sc.chunk.slug,
            section=sc.chunk.section,
            source_path=sc.chunk.source_path,
            score=sc.score,
        )
        for sc in scored_chunks
    ]
