# Privacy & Safety

AI Health Mirror is a wellness-education and portfolio project. **It is not a medical device, makes no
diagnostic claims, and has not been assessed for HIPAA, GDPR-health-data, or medical-device compliance.**

## Data handling

| Data | Default | With opt-in | Retention | Deletion |
|---|---|---|---|---|
| Camera frames | Processed in the browser only; never recorded | — | none | n/a |
| Facial landmarks | Browser memory only | Sent with a snapshot | snapshot lifetime | with snapshot |
| Region crops (≤160 px) | **Not sent** | Sent over WebSocket after the user ticks "Send small cropped face regions…" | processed in memory, discarded after inference; never written to disk or logs | n/a |
| Derived scores / observations | — | Held in server memory per session | TTL (`SESSION_TTL_S`, default 1 h) | `DELETE /api/sessions/{id}` |
| Snapshots (aligned crops + metadata) | **Not stored** | Separate explicit consent dialog per snapshot; consent text version + time recorded | until deleted | `DELETE /api/history/{history_id}` removes DB rows **and** files (tested) |
| Chat text | Not logged (`LOG_SENSITIVE_CONTENT=false`) | — | request lifetime | n/a |
| Training | User images are **never** used for training | — | — | — |

Additional controls:
* Visible camera-active indicator and stop button; camera starts only on an explicit click.
* The history id is a random pseudonymous UUID generated in the browser — no accounts, names or emails.
* A logging filter drops any record containing base64 image data (defence in depth; tested).
* Traces shown in Model Lab are redacted (emails, phone numbers, image payloads, key-like strings).
* LLM API keys live only in the backend environment.
* Use HTTPS/WSS in deployment (Vercel provides TLS; terminate TLS in front of the backend).
* Diagnostic export from Model Lab excludes images unless the user explicitly ticks a box.

## Safety design

1. **Appearance, not conditions.** The models classify *visible appearance* of a region. The LLM prompt and a
   deterministic validator forbid diagnostic language ("you are dehydrated", "you have X").
2. **Abstention first.** Quality gates (client + server) and calibrated thresholds produce `abstained` /
   `inconclusive`; aggregation requires several agreeing frames before anything is shown as observed.
3. **Demo honesty.** Demo-tier models (synthetic training data) are badged everywhere, and the validator
   requires the assistant to disclose demo status whenever it mentions such an observation.
4. **Deterministic urgent routing.** `app/safety/triage.py` matches urgent complaints (severe eye pain,
   sudden vision change, chemical exposure, facial droop, lip/throat swelling or breathing difficulty, chest
   pain/fainting, self-harm, rapidly spreading skin redness) **before** any LLM call and returns a
   predetermined response from `app/safety/reviewed_responses.json`. These texts are project-authored and
   marked `pending clinical review` — a qualified clinician must review them before real deployment.
5. **Grounding validation.** Every reply is checked: no diagnostic language, no health scores,
   referenced observations must be accepted evidence, visual claims must map to accepted positive evidence,
   demo disclosure, professional referral for diagnosis requests. One retry with feedback, then a grounded
   template fallback.
6. **No health score.** Nothing in the system aggregates observations into an overall score.
7. **Explainability caveat.** Grad-CAM heatmaps are labelled as approximate attributions.
8. **Longitudinal caveat.** Visual differences are presented with explicit caveats and lighting
   comparability flags, never as improvement or deterioration.

## Known limitations

* Keyword triage can miss paraphrases and can over-trigger; it is a safety net, not a classifier of urgency.
* The validator's grounding check is heuristic (sentence-level region + feature + visual-claim words).
* The educational knowledge base is project-authored and not clinically reviewed.
