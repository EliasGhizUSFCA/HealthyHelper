.PHONY: setup backend frontend test test-backend test-frontend lint demo-models train-real evaluate onnx schemas docker
PY ?= python3

setup:
	$(PY) -m pip install torch==2.15.0 torchvision==0.29.2 --index-url https://download.pytorch.org/whl/cpu
	$(PY) -m pip install -r backend/requirements-dev.txt
	cd frontend && npm ci && npm run setup:assets

backend:
	cd backend && $(PY) -m uvicorn app.main:app --reload --port 8000

frontend:
	cd frontend && npm run dev

## Synthetic data + DEMO-tier models (exercise the pipeline; NOT real health models)
demo-models:
	scripts/train_demo_models.sh

## Train on your REAL collected + labelled data (Collect → Label → this). Usage: make train-real MODEL=lip_dryness
## Exports the manifest from the dataset store, then trains an EXPERIMENTAL-tier model. Add GROUP=session_id if
## fewer than 3 people contributed, TIER=validated to attempt the validation gate, EPOCHS=n, BACKBONE=...
MODEL ?= lip_dryness
TIER ?= experimental
GROUP ?= subject_id
EPOCHS ?= 20
BACKBONE ?= resnet18
train-real:
	cd backend && $(PY) -m training.export_dataset --model-id $(MODEL)
	cd backend && $(PY) -m training.train --model-id $(MODEL) --manifest ../data/runtime/dataset/manifests/$(MODEL).csv \
	  --backbone $(BACKBONE) --pretrained --tier $(TIER) --group-by $(GROUP) --epochs $(EPOCHS) --class-weighted --patience 4

## Re-run evaluation for the newest version of each model on its synthetic test split
evaluate:
	@for d in models/*/; do m=$$(basename $$d); v=$$(ls -t $$d | head -1); \
	  (cd backend && $(PY) -m evaluation.evaluate --model-dir ../models/$$m/$$v --manifest ../data/synthetic/$$m/manifest.csv); done

onnx:
	@for d in models/*/; do v=$$(ls -t $$d | head -1); $(PY) scripts/export_onnx.py --model-dir $$d$$v; done

schemas:
	$(PY) scripts/export_schemas.py

test: test-backend test-frontend
test-backend:
	cd backend && $(PY) -m pytest
test-frontend:
	cd frontend && npm test && npm run typecheck

lint:
	cd backend && ruff check .
	cd frontend && npm run lint

docker:
	docker compose up --build
