"""Export the wire-protocol JSON Schema to shared/schemas/protocol.schema.json.

    python scripts/export_schemas.py          # write
    python scripts/export_schemas.py --check  # exit 1 if stale (used in CI/tests)
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from pydantic import BaseModel  # noqa: E402

from app.schemas import catalog, protocol  # noqa: E402

OUT = ROOT / "shared" / "schemas" / "protocol.schema.json"


def build() -> str:
    models = {n: m for mod in (protocol, catalog) for n, m in vars(mod).items()
              if isinstance(m, type) and issubclass(m, BaseModel) and m.__module__ == mod.__name__ and not n.startswith("_")}
    defs = {n: m.model_json_schema(ref_template="#/$defs/{model}") for n, m in sorted(models.items())}
    flat: dict = {}
    for n, s in defs.items():
        for k, v in s.pop("$defs", {}).items():
            flat[k] = v
        flat[n] = s
    doc = {"$schema": "https://json-schema.org/draft/2020-12/schema", "title": "AI Health Mirror wire protocol",
           "version": protocol.PROTOCOL_VERSION, "$defs": dict(sorted(flat.items()))}
    return json.dumps(doc, indent=2, sort_keys=True) + "\n"


if __name__ == "__main__":
    content = build()
    if "--check" in sys.argv:
        if not OUT.exists() or OUT.read_text() != content:
            print("protocol.schema.json is stale — run python scripts/export_schemas.py", file=sys.stderr)
            sys.exit(1)
        print("schema up to date")
    else:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(content)
        print(f"wrote {OUT}")
