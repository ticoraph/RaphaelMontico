from fastapi import APIRouter, Depends

from app.db.retriever import get_last_updated
from app.deps import SessionDep
from app.rate_limit import limit_index_status
from app.schemas import IndexStatusResponse

router = APIRouter(prefix="/api", tags=["index"])


@router.get(
    "/index-status", response_model=IndexStatusResponse, dependencies=[Depends(limit_index_status)]
)
async def index_status(session: SessionDep) -> IndexStatusResponse:
    return IndexStatusResponse(last_updated=await get_last_updated(session))
