# SuperFix

SuperFix is a repair workspace for professional appliance technicians. It covers refrigerators, washing machines, dryers, dishwashers, and cooktops. New repairs use an optional intake form and a conversational diagnostic assistant, followed by a repair log, final verification, a completion checklist, and feedback. Existing diagnostic rounds remain available as history and for legacy follow-up flows.

The interface is available in English, Brazilian Portuguese, and Spanish. Translation resources live in `frontend/src/app/i18n` and the technician's selected language is also sent to the assistant.

Cases also include a job reference and optional model/serial identification, symptom and model-plate photos, return visits and requested parts, callbacks, an appliance history, a case activity timeline, and technician handoff. Company administrators can link a confirmed appliance to a closed historical case without rewriting its original intake. The Due back page groups overdue, today's, and upcoming return visits.

## Project layout

- `frontend/src/app` contains the app shell, routes, global styles, and translation setup.
- `frontend/src/features` groups screens and types for sign-in, administration, and repairs.
- `frontend/src/components` holds shared UI, and `frontend/src/lib` holds the HTTP client and shared helpers.
- `backend/src/main/java/com/superfix` groups controllers, services, and persistence by domain in `account` and `repair`. Shared security and error handling live in `config`.

The standalone [SuperFix visual reference](docs/design/superfix-visual-reference.html) shows the proposed colors and sample repairs on desktop and phone. It uses synthetic content and does not need credentials or a running API.

## Start locally

Requires Docker with Compose v2.

```sh
cp .env.example .env
```

In `.env`, set a random `DATABASE_PASSWORD`, your `BOOTSTRAP_ADMIN_EMAIL`, and a random temporary `BOOTSTRAP_ADMIN_PASSWORD` with at least 8 characters and at most 72 UTF-8 bytes. Keep this file private. Then run:

```sh
docker compose up --build --wait
```

Open [SuperFix](http://localhost:8088). Sign in as the bootstrap administrator, choose a new password, then sign in again. Create a plan, create a company under that plan, and add a technician or company administrator. Give that person their temporary password via a secure channel. The bootstrap credentials are used only when no platform administrator exists. Remove the bootstrap password from `.env` and recreate the API container after initial setup.

The web port and bind address are configurable through `APP_PORT` and `APP_BIND`. PostgreSQL, the API, and photos are internal to Compose. Database rows and photos are stored in named volumes. `docker compose down` retains them.

## Diagnose a repair

The default `AI_PROVIDER=mock` uses synthetic chat replies and marks cases as demo. Use synthetic symptoms and images in this mode. A typical run is:

1. Create a repair. Appliance type, symptoms, model, fuel, and hazard status can be left unknown; photos are optional.
2. Start the conversation. Saved intake details and earlier diagnostic checks are included once. An empty intake opens a local welcome prompt without making an AI call.
3. Send one observation, question, or measurement at a time. The assistant can ask a focused follow-up, and the technician can attach selected case photos. Clearly stated appliance type, brand, model, serial number, and symptom updates are copied into the case form with a visible source message. If image analysis is enabled, clearly legible identity text can be suggested from a selected photo and linked for technician review; it is not independently OCR-verified. Model confirmation is never automatic. Additional symptoms are appended; an explicit correction can replace the form value while the original message stays in history.
4. Continue to repair work at any time, including while the assistant is responding, after an inconclusive answer, or when no diagnosis is available. Review and edit the handoff before continuing; a possible cause is not recorded as a confirmed fault. Return to Diagnosis during work to resume the same conversation.
5. Save the repair log, work performed, parts or measurements, and a final verification result or reason it was not performed. Confirm the completion checklist, including tools from the customer. Record an outcome that matches the verification, rate assistance if an assistant reply was shown, and close the case.

After a failed test, select **Continue diagnosis** to save the attempt in history. New chat-mode repairs return to the same conversation with the failed verification and recorded work added as context; the next turn is still sent only when the technician submits it. Legacy cases keep their existing follow-up checks. The next attempt has a fresh repair log and checklist.

The repair list can search by job reference or exact serial number. A company administrator can reassign an open case to an active technician in the same company. From a closed repair, create a callback draft; it has its own job reference and links to the original repair. A return visit can be scheduled from the checklist, with requested parts tracked separately from parts actually used. Resuming the paused case starts that visit, and closing it records the completed return.

## Repair screens and progress

Open repairs at `/repairs/{id}` to resume the appropriate screen. The repair header keeps the server status visible, while the progress links show completed, current, next, and attention-needed stages. Diagnostic cases open at **Diagnosis**; new drafts open at **Appliance & symptoms**. Cases in the completion stage open at the first unfinished saved section: **Repair work**, **Completion checklist**, or **Review & close**. A paused repair keeps its saved stage and offers a resume action. Older `/repairs/{id}` links continue to work.

The work log, checklist, and close review have separate screens. Unsaved work, chat composer text, and selected photos are retained as device drafts while navigating or refreshing. Offline chat drafts are not submitted automatically when connectivity returns. Review lists missing requirements with links to the relevant screen. Close is available only when the saved verification, checklist, AI rating (when an assistant reply was shown), and online state meet the server rules. Use **History** for prior checks, attempts, timeline, photos, return visits, and archive controls. Close a repair before archiving it; authorized users can restore an archived repair or permanently delete it from History, subject to callback restrictions.

Previously opened repairs and form drafts are stored in the browser's IndexedDB for offline work. The app shell and static assets are cached by a service worker; authenticated API responses are not cached. Offline changes queue for sync when connectivity returns. Conflicts are kept on-device for review. The latest `/auth/me` response bounds offline access, and signing out warns before clearing unsynced work. Use offline access only on a device you trust.

Company administrators can see cases in their own company. Technicians see their own cases. Plans can set seat and monthly AI request limits. The request limit resets at the start of the month in UTC and includes queued and failed attempts. Chat has a configurable per-case request limit (default 50); it also counts earlier requests on converted legacy cases. Interrupted or malformed calls surface as retryable errors and preserve submitted messages. Continue to repair work remains available when an AI limit is reached.

Company administrators can open **Pilot outcomes** to review closed non-demo cases grouped by reviewed procedure revision. Cause matching and passed first-verification figures include denominators; cases without a technician-confirmed cause and inconclusive cases are counted separately.

## Live AI providers

The default `AI_PROVIDER=mock` uses synthetic conversation replies and marks cases as demo. To use OpenAI, set `AI_PROVIDER=openai`, `OPENAI_API_KEY`, and `OPENAI_MODEL`. To use OpenRouter, set `AI_PROVIDER=openrouter`, `OPENROUTER_API_KEY`, and `OPENROUTER_MODEL` in `.env`. OpenRouter model IDs use the `provider/model` form. The application uses the OpenAI Responses API for OpenAI and OpenRouter Chat Completions for OpenRouter. Both use structured JSON output plus server-side validation. OpenRouter routes can differ in supported parameters, so `provider.require_parameters=true` makes unsupported structured-output requests fail instead of silently dropping the schema. Recreate the API container after changing provider settings. Existing demo cases stay marked demo; new repairs created in live mode use the configured provider.

When the technician sends a chat turn, the server sends the recent case context and only the photos explicitly selected for that turn. OpenAI Responses requests set `store: false`. OpenRouter model support depends on the selected model/provider route. `AI_IMAGE_ANALYSIS_ENABLED` defaults to `false`; when disabled, photos remain attached to the repair but are not sent for image analysis. Set it to `true` only when the configured route supports image input. For example, OpenRouter currently lists `deepseek/deepseek-v4.1-flash-1017` as accepting image input and structured output; verify the current model catalog before relying on those capabilities. The AI returns possibilities and a free-form next question rather than selecting from the old fixed diagnostic catalog. Reported hazards and unknown fuel on cooktops or dryers get a deterministic safety notice without sending that turn to the provider. Initial case context includes recent recorded work and verification, and is bounded; the UI indicates when context is limited. Review representative diagnostic scenarios with qualified professionals before a technician pilot.

For unexpected live AI results, the backend stores the bounded model response and validation decision with each new provider request. See [backend/README.md](backend/README.md#diagnostic-response-traces) for the local query to inspect them.

For the refrigerator warm complaint, the only model-specific guide currently bundled is a synthetic, unreviewed training fixture. It asks for already recorded fresh-food and freezer readings, then ends inconclusively; it contains no diagnosis thresholds or repair steps. Add a real family only after selecting the covered models, manufacturer manual revision, and qualified reviewer. Until then, the generic workflow displays a coverage notice and asks technicians to verify findings against the exact model documentation.

[OpenAI Responses API structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs) · [OpenRouter structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs) · [OpenRouter model catalog](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties)

The [OpenAPI contract](docs/openapi.yaml) documents the API routes and request shapes.

## Verification

```sh
(cd frontend && npm ci && npm run build)
(cd backend && mvn verify)
```

The smoke test uses a fresh Compose project in mock mode. Use a private environment file with distinct test credentials and an unused `APP_PORT`. Export `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` from that file, then run:

```sh
SUPERFIX_URL=http://127.0.0.1:18088 python3 scripts/smoke.py
```

For a shared deployment, use HTTPS with secure session cookies, restricted access to secrets, and a backup schedule covering both the database and photo volume. To make a consistent backup, stop the API during the backup window, use `pg_dump` for PostgreSQL and archive the photos volume, then test restoration in an isolated Compose project.
