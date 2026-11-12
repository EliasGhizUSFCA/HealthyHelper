"""Classifier architectures (transfer learning via torchvision).

Lives in the serving package (not training/) so the API can rebuild a network
from a checkpoint without importing training code.
"""

from __future__ import annotations

import torch
from torch import nn

SUPPORTED_BACKBONES = ("resnet18", "resnet34", "efficientnet_b0", "mobilenet_v3_small", "small_cnn")


class SmallCNN(nn.Module):
    """Tiny CNN for unit tests and CPU-only smoke runs (no pretrained weights)."""

    def __init__(self, num_classes: int):
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(3, 16, 3, padding=1), nn.BatchNorm2d(16), nn.ReLU(inplace=True), nn.MaxPool2d(2),
            nn.Conv2d(16, 32, 3, padding=1), nn.BatchNorm2d(32), nn.ReLU(inplace=True), nn.MaxPool2d(2),
            nn.Conv2d(32, 64, 3, padding=1), nn.BatchNorm2d(64), nn.ReLU(inplace=True),
        )
        self.pool = nn.AdaptiveAvgPool2d(1)
        self.classifier = nn.Linear(64, num_classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.classifier(torch.flatten(self.pool(self.features(x)), 1))


def build_model(backbone: str, num_classes: int, pretrained: bool = False, dropout: float = 0.2) -> nn.Module:
    """Build a classifier. ``pretrained`` loads ImageNet weights (downloads on first use)."""
    from torchvision import models as tvm

    if backbone == "small_cnn":
        return SmallCNN(num_classes)
    if backbone in ("resnet18", "resnet34"):
        weights = {"resnet18": tvm.ResNet18_Weights, "resnet34": tvm.ResNet34_Weights}[backbone].DEFAULT if pretrained else None
        m = getattr(tvm, backbone)(weights=weights)
        m.fc = nn.Sequential(nn.Dropout(dropout), nn.Linear(m.fc.in_features, num_classes))
        return m
    if backbone == "efficientnet_b0":
        m = tvm.efficientnet_b0(weights=tvm.EfficientNet_B0_Weights.DEFAULT if pretrained else None)
        m.classifier = nn.Sequential(nn.Dropout(dropout), nn.Linear(m.classifier[1].in_features, num_classes))
        return m
    if backbone == "mobilenet_v3_small":
        m = tvm.mobilenet_v3_small(weights=tvm.MobileNet_V3_Small_Weights.DEFAULT if pretrained else None)
        m.classifier[-1] = nn.Linear(m.classifier[-1].in_features, num_classes)
        return m
    raise ValueError(f"unsupported backbone {backbone!r}; choose from {SUPPORTED_BACKBONES}")


def gradcam_target_layer(model: nn.Module, backbone: str) -> nn.Module:
    """Last convolutional block — the standard Grad-CAM target for each family."""
    if backbone.startswith("resnet"):
        return model.layer4[-1]
    if backbone in ("efficientnet_b0", "mobilenet_v3_small"):
        return model.features[-1]
    if backbone == "small_cnn":
        return model.features[-1]
    raise ValueError(backbone)


def head_parameters(model: nn.Module, backbone: str) -> list[nn.Parameter]:
    if backbone.startswith("resnet"):
        return list(model.fc.parameters())
    return list(model.classifier.parameters())
