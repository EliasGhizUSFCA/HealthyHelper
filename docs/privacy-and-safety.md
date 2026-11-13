# Privacy & Safety

AI Health Mirror is a wellness-education and portfolio project. **It is not a medical device, makes no
diagnostic claims, and has not been assessed for HIPAA, GDPR-health-data, or medical-device compliance.**

## Data handling

| Data | Default | With opt-in | Retention | Deletion |
|---|---|---|---|---|
| Camera frames | Processed in the browser only; never recorded | — | none | n/a |
| Facial landmarks | Browser memory only | Sent with a snapshot | snapshot lifetime | with snapshot |
| Region crops (≤160 px) | **Not sent** | Sent over WebSocket after the user starts analysis ("Start camera & analysis" on the Mirror, or the "Send small cropped face regions…" checkbox elsewhere) | processed in memory, discarded after inference; never written to disk or logs | n/a |
| Derived scores / observations | — | Held in server memory per session | TTL (`SESSION_TTL_S`, default 1 h) | `DELETE /api/sessions/{id}` |
| Snapshots (aligned crops + metadata) | **Not stored** | Separate explicit consent dialog per snapshot; consent text version + time recorded | until deleted | `DELETE /api/history/{history_id}` removes DB rows **and** files (tested) |
| Chat text | Not logged (`LOG_SENSITIVE_CONTENT=false`) | — | request lifetime | n/a |
| Mirror/Lab/snapshot images for training | **Never** used for training | — | — | — |
| Training crops (Collect page) | **Not collected** | Separate research consent; crops ≤ 256 px of each region + optional self-reported conditions, linked to a random contributor ID | until withdrawn or deleted | Withdraw on `/collect` → `DELETE /api/dataset/contributors/{id}` removes all crops, labels and the consent record (tested). Retrain or delete models trained on them. |

| Apparent-age estimate | Off until the camera is started | On the Health Mirror, "Start camera & analysis" turns on analysis and the age switch (both visible as switches next to the button, with a one-line notice of what is sent); turning a switch off is remembered in the browser. Elsewhere (Beauty, Lab) it is an explicit opt-in toggle. A whole-face crop is sent only while it is on | not stored anywhere; never sent to the LLM | n/a |
| Confirmed age range | – | Chosen by the user after an estimate (or directly) | browser memory for the tab only | closing the tab |
| Product recommendation requests | – | Concern/preferences the user selects | not stored | n/a |
| Data sent to the retailer | **None** | — | — | The catalogue job requests public product pages only; recommendations run on the local catalogue. Product images are loaded by the browser from the retailer's CDN, so the retailer can see a viewer's IP address and that an image was requested (no other data). |

Additional controls:
* Labels and model outputs describe appearance ("visible spots"), never conditions ("acne"); the validator blocks
  condition names such as acne, rosacea or dermatitis being attributed to the user.
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

## Age, products and appearance

* Apparent age is a broad range with an uncertainty span and a disclaimer; it is never used for identity,
  access decisions, health statements or rankings. Only a range the user confirms can affect recommendations,
  and only to exclude products marketed with anti-aging/peel claims for a confirmed under-18 range.
* Recommendations are user-directed (the user picks a concern or makeup goal); visual observations are used
  only if the user ticks them. Validators block "you need makeup / hide your …", attractiveness or age
  comments, product efficacy claims ("cures", "treats acne"), invented prices and products outside the
  retrieved set. Product text is labelled as retailer/brand marketing.
* The AR preview is off until the user selects a colour and turns it on, and is labelled as a simulation.

## Known limitations

* Keyword triage can miss paraphrases and can over-trigger; it is a safety net, not a classifier of urgency.
* The validator's grounding check is heuristic (sentence-level region + feature + visual-claim words).
* The educational knowledge base is project-authored and not clinically reviewed.
