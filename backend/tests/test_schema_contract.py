import re
import subprocess
import sys
from pathlib import Path

from app.schemas import protocol

ROOT = Path(__file__).resolve().parents[2]


def ts_fields() -> dict[str, list[str]]:
    src = (ROOT / "frontend" / "lib" / "protocol.ts").read_text()
    block = src[src.index("export const PROTOCOL_FIELDS"):]
    return {m.group(1): re.findall(r'"([a-z_0-9]+)"', m.group(2)) for m in re.finditer(r"(\w+): \[([^\]]*)\]", block)}


def test_typescript_mirror_matches_pydantic():
    fields = ts_fields()
    assert fields, "PROTOCOL_FIELDS not found"
    for name, ts in fields.items():
        model = getattr(protocol, name)
        assert ts == list(model.model_fields), f"{name}: TS {ts} != PY {list(model.model_fields)}"


def test_catalog_typescript_mirror_matches_pydantic():
    from app.schemas import catalog

    src = (ROOT / "frontend" / "lib" / "catalog.ts").read_text()
    block = src[src.index("export const CATALOG_FIELDS"):]
    fields = {m.group(1): re.findall(r'"([a-z_0-9]+)"', m.group(2)) for m in re.finditer(r"(\w+): \[([^\]]*)\]", block)}
    assert fields
    for name, ts in fields.items():
        assert ts == list(getattr(catalog, name).model_fields), name


def test_ts_pipeline_order_matches():
    src = (ROOT / "frontend" / "lib" / "protocol.ts").read_text()
    block = src[src.index("PIPELINE_ORDER = [") : src.index("] as const")]
    assert re.findall(r'"(\w+)"', block) == protocol.PIPELINE_ORDER


def test_exported_json_schema_is_current():
    r = subprocess.run([sys.executable, str(ROOT / "scripts" / "export_schemas.py"), "--check"], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr


def test_frontend_region_copy_matches_shared():
    gen = ROOT / "frontend" / "lib" / "generated" / "regions.json"
    if gen.exists():
        assert gen.read_text() == (ROOT / "shared" / "regions.json").read_text()


def test_extra_fields_rejected():
    import pytest
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        protocol.ClientPing.model_validate({"type": "ping", "t": 1, "evil": True})
