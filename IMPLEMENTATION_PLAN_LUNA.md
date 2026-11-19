# SuperFix — implementation plan for Luna

For Luna's current assignment covering model-specific diagnostics, return visits and parts tracking, appliance history and team handoff, and offline drafts, follow the [field repairs implementation plan](docs/LUNA_FIELD_REPAIRS_PLAN.md).

## 1. Goal

Build a responsive web application that helps professional appliance technicians investigate a problem, record checks and measurements, receive a proposed diagnosis and repair guidance, and complete a final checklist. The application must preserve the repair history and collect feedback on the AI's help.

This is the original brief for the initial application. The [README](README.md) describes the running system.

## 2. Agreed scope and assumptions

- Initial categories: refrigerators, washing machines, dryers, dishwashers, and cooktops (the requested “top cooker”). Store categories as data so more can be added without changing the database schema.
- English is the only initial language. All interface text must use an internationalization framework, including validation, errors, units, and checklist text. Persist the language used for each AI interaction so other languages can be added later.
- The users are professional technicians. The platform administrator creates companies and users. A company may have multiple employees under one plan. No self-service registration, payment processing, or online subscription billing in the first version.
- A solo technician can be represented by a company with one user. A platform administrator assigns a plan and controls active accounts; plan limits are enforced by the server.
- Initial plan proposal: an active/inactive status, a maximum number of active users, and an optional monthly limit on AI requests. Limits and plan names are configurable, not hard-coded. Exact commercial packages remain a product decision.
- A technician can save and resume a repair. Company administrators can see their company's repairs; technicians see their own unless the company administrator grants broader access. Platform administrators manage accounts and plans; support access to repair content requires an explicit, audited authorization mechanism, not implicit cross-company access.
- First release is an assisted diagnostic tool, not a guarantee of a correct diagnosis. Production use requires review by qualified appliance and safety professionals and validation of representative scenarios.

## 3. Technician journey

1. Sign in. Start a repair or resume an existing one.
2. Choose an appliance category. Enter symptoms, optional brand/model and other identifying details, and optionally upload photos. Minimize customer information and do not require it for diagnosis.
3. Submit the case. The server sends the relevant repair context to the configured AI provider. Show progress and a recoverable error if the service is unavailable.
4. Render the returned questions and checks as accessible forms, potentially across several screens. Support text, numeric measurement with unit, single choice, yes/no, and confirmation; allow “unknown,” “not available,” and “not performed” with an optional reason. Never treat skipped checks as passed. Persist answers and allow correction before submission.
5. Submit the current round. The server stores the results, calls the AI again, and presents further checks, a proposed diagnosis, or an inconclusive/escalation result. Repeat until the case is ready or the technician stops. Include a visible way to pause, resume, or mark the diagnosis inconclusive.
6. Present proposed causes, supporting and missing evidence, limitations, and suggested repair steps. The model's self-reported confidence is not proof of correctness or a calibrated probability. The technician makes the final decision; absence of sufficient evidence must lead to more checks or an inconclusive outcome.
7. After the work, present a mandatory completion checklist. It includes a check that all technician tools, equipment, and materials have been retrieved from the customer's premises, plus relevant work-area and appliance checks. The technician confirms each item explicitly; an unresolved item requires a reason and prevents marking the job complete. The checklist is not a substitute for a safety inspection.
8. Record whether the repair actually resolved the symptom (resolved / unresolved / unverified), and collect a good/bad rating of the AI assistance and optional written feedback. Keep repair outcome separate from AI rating. Allow the technician to close an unresolved case with a clear outcome after completing the checklist; do not require a positive result or rating to report failure.

## 4. Diagnostic safety and AI boundaries

- Appliance repairs may involve mains electricity, charged capacitors, gas, refrigerants, water and moving parts. Require applicable safety guidance and explicit prerequisites before proposing a potentially hazardous check. Stop and escalate when a safe method or necessary information is unavailable. Do not invent device-specific specifications, wiring, manufacturer instructions, or measured values.
- Create a reviewed safety policy and category-specific hazard rules independent of the AI prompt. Until reviewed, keep AI-generated technical instructions behind a development/controlled-pilot feature flag; the app may demonstrate flows with clearly labeled synthetic scenarios. Require qualified review before enabling real-world guidance.
- AI output is untrusted input. Use a versioned structured response contract; validate schema, field bounds, supported form types, and policy rules on the server before displaying it. Reject malformed or unsafe output, log metadata, and allow retry or escalation. Defend against instructions embedded in symptoms or images. Never silently interpret a model refusal as a diagnosis.
- The model can suggest the next action, but backend state and explicit validation control transitions. Bound question count, response sizes, calls per case, retries, and total duration. When limits or quota are reached, preserve work and present an actionable inconclusive state; do not loop indefinitely.
- Configure provider and model on the server. Use OpenAI's Responses API with a configurable vision-capable model and structured outputs, supported by a mock provider for local development and automated tests. Keep prompts and response schema versioned. Never put the API key in the frontend, source control, logs, or sample configuration.
- Send only case information needed for the current request. Tell users that submitted text and photos are sent to the AI provider. Review current provider retention and data settings before deployment. Avoid storing raw provider payloads and sensitive details in logs.
- Use synthetic, professionally reviewed scenarios to evaluate whether the system asks appropriate questions, handles unknown inputs, recognizes hazards and uncertainty, and refrains from unsupported conclusions. A mock run proves the workflow, not diagnostic accuracy.

## 5. Architecture and technology

- Frontend: React, TypeScript, TanStack Query for server state, Zustand for small client-only state, Tailwind CSS, shadcn/ui, React Router, and an i18n library. Forms must work well on phones and be keyboard accessible.
- Backend: Java with Spring Boot, Spring Security, Spring Data JPA, Jakarta Validation, Jackson, Lombok, MapStruct, SLF4J, and database migrations using Flyway. Use a supported Java LTS and compatible stable dependency versions at implementation time. Keep application services, persistence, API DTOs, AI integration, and security boundaries separate without premature microservices.
- Database: PostgreSQL. Use UUID identifiers, migrations, database constraints, UTC timestamps, appropriate indexes and explicit transaction boundaries. Test migrations from an empty database and an existing prior version.
- Images: store image metadata in PostgreSQL and files in a persistent, non-public Docker volume in development; use a storage interface so managed object storage can be introduced later. Validate file type and size, limit upload count, use generated filenames, authorize downloads and avoid exposing local paths. Preserve uploads across container recreation.
- Deployment: Docker Compose services for frontend, backend, and PostgreSQL, with health checks, service readiness, persistent database and image volumes, environment-based configuration, and a documented one-command startup. Do not publish the database port by default. The frontend serves the app and proxies API requests. Document production changes such as HTTPS, real secrets management, backup/restore, rate limits and monitoring.

## 6. Multi-tenancy, security and plans

- Model a platform user, company, company membership and role, plan, and company subscription/plan assignment. Roles: platform administrator, company administrator, and technician. Centralize authorization and verify tenant ownership on every company-scoped query, including image access, exports and indirect references. Test cross-company access with separate users and companies.
- Use Spring Security and adaptive password hashing. Use secure, HttpOnly, SameSite session cookies with server-side sessions and CSRF protection for same-origin deployments; require HTTPS and secure cookies in production. Handle session expiration, logout, account disablement, login throttling and credential reset/initial provisioning. Do not ship a fixed default password; document a secure bootstrap flow for the first platform admin.
- An admin creates a company, assigns a plan, and provisions users through an administrator-managed temporary credential or reset mechanism. Require a password change at first login. Specify a secure delivery process; no email service is assumed.
- Enforce active user limits during account creation, activation and plan changes. If a plan is downgraded below current usage, preserve data and reject the change until resolved, with a clear message. Store server-side AI usage events per company; reserve/check quota atomically before each model attempt and document how failed attempts count. On quota exhaustion, allow history and checklist access and explain why another AI call cannot start.
- Audit account, membership, role and plan changes, and record who performed key repair transitions. Avoid credentials, full AI prompts, customer identifiers and photo contents in operational logs.

## 7. Core data model

Use migrations, foreign keys and tenant-aware constraints where practical. Suggested initial entities:

- `User`: identity, password hash, status, preferred language, timestamps.
- `Company`, `Membership`: company and user association, role, active status.
- `Plan`, `CompanyPlan`: configuration, assignment, status, active-user and optional AI usage limits.
- `ApplianceCategory`: stable code, translation key, active flag, display order.
- `RepairCase`: company, assigned technician, category, symptoms, optional appliance details, status, version, timestamps and outcome.
- `RepairAttachment`: case, storage key, content type, size, uploader and timestamp.
- `DiagnosticRound`, `DiagnosticQuestion`, `DiagnosticAnswer`: round sequence, versioned validated AI response, typed questions, measurements/units, answer status, author and timestamps. Store the actual questions shown and answers given so future prompt changes do not rewrite history.
- `Diagnosis`: proposed causes, supporting/missing evidence, recommended steps, uncertainty, technician decision and version.
- `ChecklistTemplate`, `ChecklistItem`, `ChecklistResponse`: versioned checklist items and explicit per-case confirmations or unresolved reasons. Include the tools-retrieval item in every completed case.
- `RepairFeedback`: AI rating, optional comment, repair outcome and submitter.
- `AiRequest`: case, company, provider/model, prompt/schema version, status, timestamps, token usage when available, estimated cost when available, and correlation ID. Avoid duplicate billing or transitions on retry.
- `AuditEvent`: actor, company, action, subject, timestamp and minimal metadata.

Use a practical state machine such as `DRAFT → AWAITING_ANSWERS → PROCESSING → AWAITING_ANSWERS | DIAGNOSIS_PROPOSED | INCONCLUSIVE → CHECKLIST → CLOSED`, plus pause/resume. Define allowed transitions explicitly. Do not hold database transactions open while waiting for an AI response. Use optimistic locking and idempotency keys for submits, durable request status, and a recovery procedure for interrupted processing. A technician may stop the diagnostic phase and proceed to close with an unresolved outcome.

## 8. API and interface

Use `/api/v1`, REST and JSON. Define an OpenAPI contract alongside implementation and standard error responses that do not expose internal details. Core endpoints should cover:

- Sign-in, current user, password change and logout.
- Platform management of companies, plans and users; company administrator management of company memberships within assigned limits.
- Active appliance categories.
- Case creation/list/detail, edits, pause/resume, status transitions, and authorized attachment upload/download.
- Start/submit a diagnostic round, get processing state and retry safely; retrieve the full case history and current proposed diagnosis.
- Checklist retrieval and responses, repair outcome, feedback and case closure.

Provide loading, empty, validation, unauthorized, quota, offline/network error, and retry states. Keep the last saved data visible after an AI failure. Use pagination on lists, and support basic filtering by status and category.

## 9. Delivery phases and acceptance criteria

### Phase 0 — foundation

- Initialize frontend/backend projects, migrations, Compose, environment examples, CI, formatting and README. Add mock provider and synthetic data without real credentials or sensitive records.
- Acceptance: documented clean setup starts all services; health checks pass; database and uploaded files survive container recreation; frontend can reach backend; backend and frontend checks run in CI.

### Phase 1 — accounts and plans

- Implement secure login, bootstrap, company and user management, roles, plan assignment, seat enforcement and tenant isolation.
- Acceptance: two companies cannot access each other's cases or files; company administrators can manage only their company; disabled users cannot sign in; seat and downgrade rules are enforced server-side.

### Phase 2 — repair intake and persistence

- Seed the five categories and build mobile-friendly case creation, optional photos, case list and resume flow. Add translations infrastructure with English resources.
- Acceptance: users can create a case in each category, upload and securely retrieve photos, restart services and resume the same case. Unsupported or oversized uploads are rejected.

### Phase 3 — guided diagnostic loop

- Implement the validated AI contract, mock provider, typed forms, durable rounds, state machine, concurrency handling, error recovery and bounded loop. Add OpenAI provider with configurable model/key and text/image input; no key is required for mock mode.
- Acceptance: a deterministic mock scenario executes at least two rounds with mixed answer types, including an unknown measurement, and reaches a proposed diagnosis; a separate scenario ends inconclusively. Malformed output, unsafe requests, provider timeout, duplicate submissions, restart during processing and quota exhaustion are handled without losing answers or producing duplicate state transitions. With a user-provided key, an opt-in live smoke test verifies integration without claiming clinical accuracy.

### Phase 4 — completion and feedback

- Implement proposed diagnosis display, actual outcome, required checklist, tools-retrieval confirmation, feedback and history.
- Acceptance: no case can close without explicitly addressing every required checklist item; unresolved checklist items prevent closure. An unresolved repair can still close after checklist completion, and rating/feedback remain independent from repair outcome.

### Phase 5 — readiness and pilot

- Execute professional safety and scenario review, privacy review, accessibility and responsive checks, backup/restore exercise, tenant/security tests, dependency review, and operator documentation. Review AI costs, limits, logging and provider settings.
- Acceptance: controlled pilot only after reviewers approve the safety rules, scenario results and operational controls; known issues and residual risks are documented. Release flag remains off for real-world guidance until approval.

## 10. Test strategy

- Backend unit and integration tests: validation, roles, tenant isolation, plans/quotas, diagnostic transitions, response schema, safety rules, checklist closure, image authorization and migrations. Use a real PostgreSQL test instance for database behavior.
- Frontend tests: form types and units, unknown/skipped answers, translations, responsive behavior and error/retry states.
- End-to-end tests: sign in, create case, multiple diagnostic rounds, resume after restart, checklist, feedback, and denied cross-company access. Use deterministic mock AI and test data.
- Separate opt-in OpenAI smoke test from deterministic CI; do not require secrets or incur model costs for normal tests. Review and measure safety and diagnosis quality with a curated, expert-reviewed evaluation set; record failures and track changes between prompt/model versions.

## 11. Future work — explicitly out of scope now

- Retrieval-augmented generation from validated past repairs and trusted documents. Design future ingestion around consent, tenant isolation, de-identification, source provenance and expert review; feedback or AI output is not automatically verified repair knowledge.
- AI-assisted estimates, service orders, invoices, customer approval and online billing. Do not build these flows in the first release; avoid making core data models depend on their eventual design.
- Self-service account signup and subscription payment integration.

## 12. Implementation notes for Luna

- Deliver working vertical slices in the order above, with migrations and tests for each. Keep credentials in environment variables and document all startup commands and configuration in the README.
- Do not use a client-side-only authorization check, fabricated AI confidence, or an LLM response as an authorization or state transition decision.
- Ask for a product decision when one changes the security model, commercial terms or safety behavior. Use the assumptions above for ordinary implementation choices and keep them visible in the README.
- Clarify whether “cooktops” includes gas appliances before enabling real-world repair guidance; until then handle gas as a hazard requiring escalation and expert-reviewed procedures.

## References

- OpenAI API platform: https://platform.openai.com/overview
- OpenAI Responses API migration guide: https://platform.openai.com/docs/assistants/migration
- OpenAI API pricing: https://platform.openai.com/pricing/
