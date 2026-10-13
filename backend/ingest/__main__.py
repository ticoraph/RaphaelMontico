import asyncio
import logging

from app.db.base import dispose_engine, session_scope
from app.providers.registry import get_embedding_provider
from ingest.pipeline import run_ingestion

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ingest")


async def main() -> None:
    embedding_provider = get_embedding_provider()
    async with session_scope() as session:
        result = await run_ingestion(session, embedding_provider)
    logger.info(
        "Ingestion complete: %s documents, %s chunks", result["documents"], result["chunks"]
    )
    await dispose_engine()


if __name__ == "__main__":
    asyncio.run(main())
