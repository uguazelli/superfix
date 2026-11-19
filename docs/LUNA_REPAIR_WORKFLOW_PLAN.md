# SuperFix repair workflow redesign — plan for Luna

## Objective

Replace the long repair detail page with a clear, resumable sequence of focused screens. A technician should always know the current status, the next action, what has been saved, and why an action is unavailable. Preserve existing cases, server validations, permissions, diagnostic safety rules, and offline drafts.

## Technician journey

1. **Repairs:** Show the job reference, appliance, status, last update, and a clear next-action label. Provide search, filters, new repair, and archived history. Opening a repair resumes its current actionable screen.
2. **Appliance and symptoms:** Choose category, enter symptoms and optional identification details, and add optional photos. Save the intake before starting the diagnostic. Clearly distinguish saved changes from unsaved edits.
3. **Diagnostic checks:** Show one diagnostic round at a time, including measurements and units, unknown/not performed choices, and reasons. Show submitted rounds as read-only history. Submit an entire round explicitly; while processing show progress and keep saved answers. Offer retry, pause, or stop where the server permits.
4. **Diagnostic result:** Show the proposal or inconclusive result, supporting evidence, limitations, and available guidance. Explain any model-specific source and review status. Let the technician accept or reject a proposal or continue from an inconclusive result as the current API allows. Never imply a guaranteed diagnosis.
5. **Repair work and verification:** Record work performed or not performed, relevant notes, parts and readings, and the final verification result and notes. Save the work log. If verification fails, offer the existing option to continue diagnosis; returning from that loop must preserve prior attempts.
6. **Completion checklist:** Present each confirmation separately, including accounting for all tools, even those borrowed from the customer. Require explicit responses; unresolved required items prevent closing. Save checklist changes before proceeding.
7. **Review and close:** Summarize work, verification, checklist, outcome, AI rating and optional feedback. Show a specific list of unmet requirements with links back to the relevant screen. Derive or offer outcomes consistent with the saved verification result. Enable close only when the server's requirements are satisfied; then display the closed summary.
8. **Closed and archived:** Show a concise summary with history, timeline, photos and return/callback information available on demand. Provide **Archive repair** for closed cases; archived history offers restore and permanent delete to authorized users, with a clear confirmation and existing callback restrictions.

## Navigation and status

- Use nested routes under `/repairs/:id`, for example `overview`, `intake`, `diagnosis`, `work`, `checklist`, `review`, and `history`. Keep `/repairs/:id` as a compatible entry point that selects the current action from server state. Existing bookmarks must still work.
- Add a responsive step indicator: Appliance → Diagnosis → Work → Checklist → Review → Closed. Show completed, current, and upcoming states with text as well as icons. A diagnostic loop may revisit Diagnosis; do not present the process as strictly linear when it is not.
- Keep the server status visible separately from the step indicator. Map every existing status explicitly: `DRAFT` → intake; `PROCESSING`, `AWAITING_ANSWERS`, `AI_ERROR`, `DIAGNOSIS_PROPOSED`, `INCONCLUSIVE` → diagnosis with distinct labels and actions; `CHECKLIST` → work/checklist/review based on saved data; `PAUSED` → paused with resume and the saved underlying stage; `CLOSED` → closed summary; `archivedAt` → archived badge and summary. The UI must not invent a new persisted server status.
- Since `CHECKLIST` covers several screens, derive readiness from saved work log and checklist data. A screen being visited or a local draft must not count as completed. State which step needs attention, and keep completed sections accessible for review where permitted.
- Provide Back and Continue actions with clear save behavior. Do not discard unsaved work on route changes, refresh, browser back, or handoff. Show local draft, saving, saved, offline, conflict, and error states accurately. Warn before discarding unsaved changes when persistence cannot protect them. Preserve existing offline sync, conflict resolution and idempotency semantics.
- Put secondary actions (case details, history, photos, return visits, team assignment, pause) in a clearly labeled menu or secondary panel, appropriate to status and role. On small screens use a compact step indicator and a single primary action without hiding status or validation errors.

## Implementation tasks

1. **Inventory and design:** Review the actual routes, `repair-detail-page.tsx`, `repair-completion.tsx`, `repair-work-log.tsx`, `repair-operations.tsx`, draft hooks, API contracts and current state transitions. Document the current behavior and create a state-to-screen table including pause, provider error, inconclusive diagnosis, failed verification and archived cases.
2. **Shared case shell:** Extract case loading, polling, cache updates, authorization, mutation handling, offline conflict handling, status header and step navigation into shared components/hooks. Use TanStack Query as the server-data source and the existing draft mechanism for edits. Avoid duplicating request logic or creating competing sources of truth.
3. **Focused screens:** Extract intake/photos, diagnostic rounds/results, work log, checklist, review/close, and closed/history views into feature components and routes. Reuse existing forms and operations; preserve field constraints, photo handling, category translations, AI demo labeling, and approved guidance rules. Add all new copy to i18n English resources.
4. **Completion guidance:** Centralize frontend readiness checks matching the backend rules in `RepairService`. Explicitly identify missing work status, description when work was performed, verification result and notes, unsaved log, each missing or unresolved required checklist item, unsaved checklist, and connection/sync problems. AI rating and outcome selections must be validated visibly on submit. Backend validation remains authoritative, including version conflicts.
5. **Navigation safety:** Persist drafts through route unmounts, protect unsaved feedback while navigating, and handle stale data, concurrent edits, expired sessions, retries and duplicate submissions. On a server rejection, show an actionable error and retain inputs. Never automatically close, archive, delete or make a new AI call when navigating.
6. **History and operations:** Move timeline, prior rounds, attempts, photos, appliance history, returns, callbacks, assignment, archive/restore and permanent deletion into discoverable secondary sections. Preserve the existing technician/company-admin access rules, archive eligibility and deletion confirmation. History remains read-only where the server requires it.
7. **Documentation:** Update the README with the new flow, navigation, saved versus draft behavior, archive/delete steps and local Compose commands. Update API documentation only if an API contract actually changes. No migration should be needed for a frontend-only redesign; if a backend change proves necessary, document compatibility and migration explicitly.

## Validation and acceptance

- Run the frontend build and appropriate focused checks. Exercise the journey in a browser using disposable cases and the mock provider; do not submit real customer data or trigger paid model calls for validation.
- A new case can progress through intake, multiple question rounds, result, work, checklist, review and close. At each stage the screen, status, next action and saved state agree with the server.
- An incomplete work log or checklist produces a specific, visible explanation and a link to fix it. A completed, saved log and checklist allow closing with a valid outcome and AI rating. Resolved, unresolved and unverified outcomes follow the current verification rules.
- Check pause/resume, processing and failure/retry, inconclusive result, failed verification followed by diagnosis, returning to an earlier step, refresh, direct links, concurrent changes, offline drafts and reconnect conflict. No entered data is silently lost and no diagnostic request is duplicated.
- Check existing cases and legacy URLs, demo versus live labels, role restrictions, archived history, restore and delete confirmation, callback restrictions, return visits and assignment. Test both desktop and narrow mobile layouts, keyboard navigation, focus after route changes and error messages, and screen-reader labels.
- Verify Compose starts and health checks pass with the user's configured provider; never print, replace, or commit credentials. Report what was checked and any remaining limitations.

## Delivery order

Implement the case shell and status mapping first, then diagnostic screens, work/checklist/review, and finally history and secondary actions. Deliver a coherent flow at each stage and verify existing cases before removing the old combined view. Keep budgeting, service orders, invoices, approvals and RAG outside this redesign.
