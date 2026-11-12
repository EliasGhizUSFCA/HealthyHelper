"""Tiny lexical retriever over the curated educational knowledge base.

Deliberately simple and inspectable (BM25-like token overlap + boosts for docs
linked to accepted observations). Swappable for a vector store behind the same
``retrieve`` signature.
"""

from __future__ import annotations

import json
import math
import re
from functools import lru_cache
from pathlib import Path

from app.schemas.protocol import RetrievedDoc

_KB = Path(__file__).parent / "knowledge" / "educational.json"
_TOKEN = re.compile(r"[a-z]+")


@lru_cache
def knowledge_base() -> dict:
    return json.loads(_KB.read_text())


def _tokens(s: str) -> set[str]:
    return set(_TOKEN.findall(s.lower()))


def retrieve(query: str, evidence_keys: set[str], k: int = 3) -> list[tuple[dict, RetrievedDoc]]:
    kb = knowledge_base()
    q = _tokens(query)
    n_docs = len(kb["docs"])
    df: dict[str, int] = {}
    for d in kb["docs"]:
        for t in set(d["keywords"]):
            df[t] = df.get(t, 0) + 1
    scored = []
    for d in kb["docs"]:
        kw = set(d["keywords"])
        lex = sum(math.log(1 + n_docs / df[t]) for t in q & kw)
        boost = 2.0 * len(evidence_keys & set(d["features"]))
        score = lex + boost
        if score > 0:
            scored.append((score, d))
    scored.sort(key=lambda x: -x[0])
    return [(d, RetrievedDoc(doc_id=d["doc_id"], title=d["title"], score=round(s, 3), review_status=kb["review_status"])) for s, d in scored[:k]]
