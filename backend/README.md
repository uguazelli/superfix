# SuperFix backend

The backend is a Spring Boot application using Java 21 and PostgreSQL. The main packages follow business areas:

- `account`: sign-in sessions, accounts, companies, plans and their repositories. `SessionController` handles the signed-in user's session and password; `AccountController` handles administration.
- `repair`: repair cases, diagnostic workflow, photos, return visits, history, and persistence. Controllers contain HTTP routes; services implement the operations and rules.
- `config`: security and API error handling.

## Where to start

| Task | Main code |
| --- | --- |
| Create, edit, archive, or view repairs | `RepairController`, `RepairService` |
| Submit answers, change repair status, or close a case | `RepairWorkflowController`, `RepairWorkflowService` |
| Manage return visits | `ReturnVisitController`, `ReturnVisitService` |
| Upload and retrieve photos | `RepairPhotoController`, `RepairPhotoService`, `PhotoStorage` |
| Review pilot outcomes | `PilotOutcomeService` |
| Follow a diagnostic request | `AiQueue`, `DiagnosticAi` |
| Read or update diagnostic chat | `DiagnosticConversationController`, `DiagnosticConversationService`, `ConversationRequests` |
| Change generic diagnostic questions or suggestions | `DiagnosticCatalog` |
| Change OpenAI or OpenRouter request handling | `DiagnosticProviderClient` |
| Add or review a model-specific guide | `DiagnosticGuideCatalog` and `src/main/resources/diagnostic-guides` |
| Change API request validation | `RepairRequests`, `AccountDto` |
| Understand saved repair data | `RepairData`, `RepairCase` |

`RepairData` types are also stored as JSON in existing repairs. Keep field names and support for missing older fields when changing these types. API endpoints and client-facing error codes are documented in `../docs/openapi.yaml`.

## Diagnostic lifecycle

Legacy diagnostic rounds save answers and queue a diagnostic request. `AiQueue` executes it asynchronously. `DiagnosticAi` chooses an applicable model guide, demo behavior, or the configured AI provider. Legacy provider results use fixed question and cause identifiers; the backend validates those identifiers and selects the corresponding catalog text. Existing cases retain those rounds and findings as history.

### Conversational diagnosis

New cases are marked `CHAT`; existing cases are backfilled as `LEGACY` and only switch to chat when a technician explicitly starts it. `DiagnosticConversationController` exposes the case-scoped transcript and actions; GET supports `beforeSequence` cursor pagination, with 40 messages by default and a maximum page size of 100. `DiagnosticConversationService` stores conversation turns separately from `repair_cases.details`, serializes provider requests through `AiQueue`, and tracks message state independently from the repair stage. A chat can remain open in the `DIAGNOSING` stage or resume while a case is in `CHECKLIST`; the technician can move into repair work even when a turn is still pending or failed.

Migration `V9__conversational_diagnosis.sql` adds company/case-scoped conversation, message, photo-reference, handoff, and automatic-intake-update records. Text field extraction is accepted only when it cites a technician-owned message, includes an exact excerpt found in that message, and the relevant value has not changed since the provider request was queued. When image analysis is enabled, identity extraction can cite a photo selected on the current technician message; the API validates that attachment belongs to that message and case, and the UI links the photo for review. Image text is model-read rather than OCR-verified. Appliance identity changes clear model confirmation and do not link a confirmed appliance record. Additional symptoms append to the existing report; explicit corrections may replace the field while preserving chat history. Message text is persisted before provider queueing; retries reuse the saved technician message. `AI_MAX_CHAT_REQUESTS_PER_CASE` defaults to 50 and counts prior legacy AI requests on the same case. Company monthly plan limits still apply.

The chat provider response uses structured JSON containing the assistant text, extraction candidates with source IDs and quotes, and an optional uncertain cause suggestion. The backend validates text excerpts against the cited message and validates photo ownership against the cited message. For OpenAI, the client uses Responses with `store: false`; for OpenRouter, it uses Chat Completions with `provider.require_parameters=true`. Set `AI_IMAGE_ANALYSIS_ENABLED=true` only when the configured model route accepts image input; it is false by default. With it off, uploaded photos stay stored and are not included in provider calls. A suspected hazard or an unconfirmed gas/dual/unknown fuel type for a dryer or cooktop receives a localized deterministic safety response without calling the model. Initial legacy context includes saved observations, unanswered checks, attempts, measurements, and verification where present; it is bounded and visibly marked when truncated.

The conversation and all field-update evidence are removed through case-scoped foreign-key cascades when an archived repair is permanently deleted. Closed and archived cases remain readable; late provider responses cannot reopen them. Offline chat text and selected photos stay in per-user device drafts and are never submitted automatically on reconnect.

On a failed final verification, **Continue diagnosis** snapshots the work and checklist into attempt history. Chat-mode cases return to the same conversation with the failed verification and saved work added as context, without making an AI call until the technician sends a new message. Legacy cases retain their existing fixed follow-up questions.

### Diagnostic response traces

Live provider requests save a bounded diagnostic trace on `ai_requests`: the exact assistant output (or provider response body when parsing fails), the model's short note, and whether the backend accepted or rejected the result. The capture is limited to 16,384 characters and is stored in Postgres rather than written to application logs. It does not include the request prompt or photos. New migrations apply automatically at startup; previously completed requests do not have a trace.

To inspect a request for a job reference, run this from the project root:

```sh
docker compose exec -T db psql -U superfix -d superfix -c "
select a.created_at, a.provider, a.model, a.status, a.diagnostic_decision,
       a.diagnostic_reason, a.model_note, a.response_kind, a.response_truncated,
       a.response_text
from ai_requests a
join repair_cases c on c.id = a.case_id
where c.job_reference = 'SF-00010005'
order by a.created_at desc;
"
```

`DIAGNOSIS_REJECTED` identifies a backend validation rule that prevented a proposed cause. `INCONCLUSIVE` with `MODEL_SELECTED_INCONCLUSIVE` means the model itself chose that action; `model_note` describes its evidence gap. For a provider error, `diagnostic_reason` gives the HTTP status or response-validation error.

The technician's account and company determine access to a case. State changes use version checks; some creation operations also use idempotency keys. Maintain those checks and their transaction boundaries when moving code. Photo deletion uses transaction-aware cleanup in `PhotoStorage`.

## Run and verify

From the project root, use `docker compose up --build` to start the application. Configure the provider and credentials through `.env` as described in the project README. Backend unit checks run during the Docker build via Maven; locally, run `mvn test` from this directory using Java 21.

Flyway migrations are in `src/main/resources/db/migration`. Add a new migration for schema changes rather than editing migrations that may already have been applied.
