"""Redaction for anything displayed in traces or (optionally) logged."""

from __future__ import annotations

import re

_PATTERNS = [
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), "[email]"),
    (re.compile(r"(?<!\d)(?:\+?\d[\d\s().-]{7,}\d)(?!\d)"), "[phone]"),
    (re.compile(r"data:image/[a-z]+;base64,[A-Za-z0-9+/=]+"), "[image]"),
    (re.compile(r"\b(sk-[A-Za-z0-9_-]{8,})\b"), "[secret]"),
    (re.compile(r"\b\d{3}-\d{2}-\d{4}\b"), "[id-number]"),
]


def redact(text: str) -> str:
    for pat, rep in _PATTERNS:
        text = pat.sub(rep, text)
    return text
