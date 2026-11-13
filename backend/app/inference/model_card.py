"""On-disk model card / artifact metadata (models/<model_id>/<version>/model_card.json)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class ModelCard(BaseModel):
    model_id: str
    version: str
    tier: Literal["demo", "experimental", "validated"]
    feature: str
    regions: list[str]
    classes: list[str]
    positive_class: str
    backbone: str
    input_size: int
    normalization: dict[str, list[float]]
    default_threshold: float = 0.7
    task: str = "binary_feature"
    temperature: float = Field(1.0, description="Post-hoc temperature-scaling factor fitted on the validation split")
    created_at: str
    weights_file: str = "weights.pt"
    onnx_file: str | None = None
    training_summary: dict[str, Any] = Field(default_factory=dict)
    metrics: dict[str, Any] = Field(default_factory=dict)
    intended_use: str = ""
    limitations: list[str] = Field(default_factory=list)
    dataset: dict[str, Any] = Field(default_factory=dict)
