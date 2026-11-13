# Performance measurements

Measured with `scripts/bench_ws.py` (synthetic crops, one frame in flight — same flow control as the
browser) against a local backend. **Environment: 4-vCPU cloud container, CPU only, no GPU, TORCH_THREADS=2,
4 DEMO ResNet-18 models at 128×128.** These numbers are specific to that machine; re-run the script on
your hardware. Browser-side numbers (camera FPS, landmark latency) are measured live in Model Lab and depend
on the client device, so none are claimed here.

## PyTorch runtime — 7 regions (all four models; eyes ×2, skin ×3 batched)

```
frames=100 regions=7 return_inputs=False
round-trip ms: p50=77.2 p95=102.5 max=125.2  → sustainable ≈ 12.6 inferences/s
  cv_inference[eye_redness]                p50=  16.87 ms  p95=  26.85 ms
  cv_inference[lip_dryness]                p50=  10.71 ms  p95=  17.91 ms
  cv_inference[nasal_redness]              p50=  10.34 ms  p95=  15.10 ms
  cv_inference[skin_flaking]               p50=  21.35 ms  p95=  29.80 ms
  image_quality                            p50=   3.91 ms  p95=   6.64 ms
  preprocessing                            p50=   2.94 ms  p95=   4.63 ms
  structured_observations                  p50=   0.10 ms  p95=   0.16 ms
```

## ONNX Runtime — same workload (`INFERENCE_RUNTIME=onnx`, intra-op threads pinned to 2)

```
frames=100 regions=7 return_inputs=False
round-trip ms: p50=68.1 p95=130.8 max=157.1  → sustainable ≈ 13.0 inferences/s
  cv_inference[eye_redness]                p50=  14.89 ms  p95=  28.54 ms
  cv_inference[lip_dryness]                p50=   6.93 ms  p95=  22.11 ms
  cv_inference[nasal_redness]              p50=   9.59 ms  p95=  16.31 ms
  cv_inference[skin_flaking]               p50=  20.30 ms  p95=  49.16 ms
  image_quality                            p50=   3.83 ms  p95=   6.65 ms
  preprocessing                            p50=   3.02 ms  p95=   6.97 ms
  structured_observations                  p50=   0.11 ms  p95=   0.17 ms
```

## PyTorch — single region (lips only)

```
frames=50 regions=1 return_inputs=False
round-trip ms: p50=13.5 p95=20.1 max=25.3  → sustainable ≈ 68.9 inferences/s
  cv_inference[lip_dryness]                p50=  10.22 ms  p95=  14.83 ms
  image_quality                            p50=   0.67 ms  p95=   0.75 ms
  preprocessing                            p50=   0.43 ms  p95=   0.51 ms
  structured_observations                  p50=   0.04 ms  p95=   0.05 ms
```

Notes
* Round-trip includes JSON/base64 transfer over localhost, JPEG decode, quality gate, preprocessing,
  inference and serialization. `cv_inference[...]` is the batched forward pass per model.
* ONNX Runtime initially ran *slower* than torch because its default thread pool used every core while two
  inference workers ran concurrently; pinning `intra_op_num_threads` fixed it. Oversubscription is the main
  CPU-latency risk.
* With `return_inputs` (Model Lab previews) each prediction also carries a JPEG + PNG preview, which adds
  encode cost and payload size; the Health Mirror UI leaves it off.
* The default sampling rate in the UI (2 Hz) is well below the sustainable rate above, leaving headroom
  for multiple clients and Grad-CAM requests (single-worker pool, off the hot path).
