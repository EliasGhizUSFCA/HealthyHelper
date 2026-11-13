"""Experiment tracking: MLflow when installed, otherwise a local JSON tracker with the same API."""

from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path
from typing import Any


class JsonTracker:
    backend = "json"

    def __init__(self, root: Path, experiment: str, run_name: str):
        self.run_id = f"{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}"
        self.dir = root / experiment / self.run_id
        self.dir.mkdir(parents=True, exist_ok=True)
        (self.dir / "meta.json").write_text(json.dumps({"run_name": run_name, "started": time.time()}))
        self._metrics = (self.dir / "metrics.jsonl").open("a")

    def log_params(self, params: dict[str, Any]) -> None:
        (self.dir / "params.json").write_text(json.dumps(params, indent=2, default=str))

    def log_metrics(self, metrics: dict[str, float], step: int | None = None) -> None:
        self._metrics.write(json.dumps({"step": step, "t": time.time(), **metrics}) + "\n")
        self._metrics.flush()

    def log_artifact(self, path: Path) -> None:
        (self.dir / "artifacts.txt").open("a").write(str(path) + "\n")

    def end(self) -> None:
        self._metrics.close()


class MlflowTracker:
    backend = "mlflow"

    def __init__(self, tracking_uri: str, experiment: str, run_name: str):
        import mlflow

        self.mlflow = mlflow
        mlflow.set_tracking_uri(tracking_uri)
        mlflow.set_experiment(experiment)
        self.run = mlflow.start_run(run_name=run_name)
        self.run_id = self.run.info.run_id

    def log_params(self, params: dict[str, Any]) -> None:
        self.mlflow.log_params({k: (json.dumps(v) if isinstance(v, (list, dict)) else v) for k, v in params.items()})

    def log_metrics(self, metrics: dict[str, float], step: int | None = None) -> None:
        self.mlflow.log_metrics(metrics, step=step)

    def log_artifact(self, path: Path) -> None:
        self.mlflow.log_artifact(str(path))

    def end(self) -> None:
        self.mlflow.end_run()


def make_tracker(kind: str, root: Path, experiment: str, run_name: str):
    if kind in ("auto", "mlflow"):
        try:
            import mlflow  # noqa: F401

            root.mkdir(parents=True, exist_ok=True)
            uri = os.getenv("MLFLOW_TRACKING_URI", f"sqlite:///{(root / 'mlflow.db').resolve()}")
            return MlflowTracker(uri, experiment, run_name)
        except Exception as exc:  # noqa: BLE001 - tracking must never block training
            if kind == "mlflow":
                raise
            print(f"[tracking] MLflow unavailable ({type(exc).__name__}: {str(exc)[:120]}); using JSON tracker")
    return JsonTracker(root / "jsonruns", experiment, run_name)
