# SuperFix visual redesign — implementation plan for Luna

## Goal

Give SuperFix a polished, cohesive appearance that helps professional technicians understand the repair, find the next action, and enter information comfortably on a phone, tablet, or desktop. Retain the current repair workflow, server rules, saved cases, and offline behavior.

Start with a visual mockup of the proposed direction, then apply that direction consistently across the application. This document is the implementation brief; creating it does not change the app.

## Design direction

Use a calm, practical workshop aesthetic: deep forest green for the app shell and primary actions, warm off-white backgrounds, clean white surfaces, and restrained accent colors. Continue the existing SuperFix name and wrench mark. Use readable system fonts with a sensible fallback; do not make the interface depend on downloading fonts. Use the existing Lucide icons and pair important icons with text.

The screen should feel clear and professional, with deliberate spacing and a strong visual hierarchy. Keep the information a technician needs visible. Use cards where they create meaningful groups, and avoid large decorative areas, invented statistics, or illustrations that compete with the work.

**Suggested hierarchy:** appliance and job reference first; server status and current stage next; the active task and its primary action next; history and secondary actions remain easy to find. Use green for positive and primary actions, amber for attention, and red for errors or destructive actions. Check contrast and do not communicate meaning through color alone.

## First deliverable: visual mockup

Create a reviewable, self-contained mockup using synthetic content under `docs/design/`. Show desktop and phone layouts for:

1. The repair list, including the next action and an archived-history entry point.
2. An active repair with the progress header and a diagnostic check.
3. Review and close, including a missing requirement that links conceptually back to the repair log.

Include a small reference for colors, typography, buttons, form fields, status labels, and alerts. Show realistic appliance and repair content without actual customer information. Make the mockup viewable locally without credentials, network access, or starting the backend. Keep it clearly identified as a visual reference. Use the same direction for the implementation, and include its location in the delivery notes.

## Layout and navigation

### Application shell

- Give the desktop sidebar a clear active state, consistent icons, and comfortable spacing. Keep the existing role-specific navigation and account controls.
- On smaller screens, replace the crowded horizontal navigation with a compact accessible menu or similarly clear navigation. All links, offline access, and sign-out must remain reachable. A menu must support keyboard navigation, Escape, and returning focus to its trigger.
- Use a consistent page width and heading structure. Allow forms to use the available width without stretching text into difficult-to-read lines.
- Keep connection, sync, error, and demo notices visible and distinguish them from ordinary success messages.

### Repair header and progress

- Show the appliance, job reference, actual repair status, and demo/archived state in a compact header. Keep pause/resume available where currently allowed.
- Present **Appliance → Diagnosis → Repair work → Checklist → Review** as understandable stages. Mark current, complete, and attention-needed states with text as well as visual styling. Derive these indicators from saved server data and the existing state mapping; viewing a screen or saving only a device draft is not completion.
- Keep **History** discoverable as a separate destination rather than implying it is the next required repair stage. If later stages are shown before they are available, present them as upcoming and do not link to invalid routes.
- On phones, show the current step and a clear way to open the complete step list. The current position must remain visible without forcing horizontal scrolling. Preserve access to permitted earlier steps and the failed-verification return to diagnosis.
- Include clear Back and Continue actions. Only label an action **Save and continue** when it actually saves the current data successfully before navigating. If saving fails, retain the input and explain what happened. A local draft or queued offline operation must not be described as saved to the server.

## Screen-by-screen work

### Sign-in and account

Refresh the sign-in and password-change screens with the same branding, typography, form styles, validation, and error treatment as the rest of the product. Keep password rules, session behavior, and role-specific access unchanged. Make the layout comfortable on narrow screens without adding decorative login content that pushes the form below the fold.

### Repair list and due returns

- Improve the scan order of each repair: reference and appliance, symptom, status, next action, and last update. Keep search, filters, pagination, demo labels, and active/archived switching.
- Provide an obvious **New repair** action. Design useful loading, empty, no-search-result, and error states without hiding the current filters.
- On a phone, use readable stacked rows with comfortable touch targets and no clipped critical status or action text. Keep due-return dates and parts information legible.

### Appliance and symptoms

Make the category selection clear and easy to use. Group identification, reported symptoms, hazard information, and photos with clear headings. Keep optional fields marked, model-confirmation and fuel requirements intact, and existing image limits and handling visible when relevant. Display upload, error, and locally queued photo states clearly.

### Diagnosis

Give each diagnostic round a clear heading and separate its questions visually. Make readings, units, answer choices, reasons for unavailable checks, save, and submit actions easy to distinguish. Show processing and retry states with useful text. Style the proposal, evidence, limitations, model-specific source and review status so they can be understood at a glance, without presenting uncertain AI output as a guaranteed diagnosis. Keep the existing explicit accept, reject, continue, retry, and stop actions.

Ensure provider notices reflect the actual configured provider. The current English copy mentions OpenAI in places while the app also supports OpenRouter; use verified provider information when available, or accurate provider-neutral wording. Keep demo and reviewed-guide distinctions.

### Repair work, checklist, and review

- Divide repair work into understandable groups: confirmed fault, work performed, parts, readings, and verification. Clearly show what is required before the work log can be saved and before the repair can close.
- Make checklist items easy to scan and select, including the confirmation that all tools and borrowed equipment are accounted for. Preserve the existing choices, reasons, and required-item rules. Do not preselect confirmations.
- Give review a concise summary of saved work, verification, checklist, and outcome. Show each missing requirement with a link to the relevant screen; keep AI rating and optional feedback visible where applicable. A disabled close action must have a nearby explanation that can be read without hovering.
- After closure, present a clear read-only summary and a visible route to history and archiving. Keep feedback and verification information available.

### History, archive, and administration

Organize the timeline, prior diagnostic rounds and attempts, photos, return visits, callbacks, appliance history, and assignment into labeled sections that can be expanded when needed. Make the archived-history entry point easy to find from the repair list and history. Preserve archive eligibility, restore, permanent-delete confirmation, callback restrictions, and current role permissions.

Apply the same system to the existing team, company, plan, and pilot-outcome screens. Keep dense data readable on desktop and available on mobile; retain the actual data, filters, and permission checks. No new reports or business features are required for this redesign.

## Implementation map

1. Inspect the current frontend and relevant API/state rules before changing the UI. Use the existing React, TypeScript, TanStack Query, Zustand, Tailwind, routing, i18n, and UI components. Avoid adding a dependency unless there is a concrete need.
2. Add a small set of named design tokens in `frontend/src/app/styles.css` for colors, text, spacing, radii, borders, and focus treatment. Refine the existing shared components in `frontend/src/components/` before styling individual pages. Keep CSS changes scoped and remove obsolete styles as screens are migrated.
3. Update the shared shell in `frontend/src/app/app.tsx`, then the repair list, intake, repair detail, completion, work log, and operations components in `frontend/src/features/repairs/`. Preserve existing routes, including `/repairs/:id` and direct step links.
4. Update authentication and administrator screens. Add or revise all interface copy in `frontend/src/app/i18n/en.ts`; keep the app ready for additional languages and avoid hardcoded new interface text.
5. Keep React Query as the source for server data and retain the current device-draft and offline synchronization mechanisms. Reuse existing mutations, permissions, and server validations. Do not trigger an AI request, close, archive, or delete merely by navigating.
6. Update the README if the navigation or local development instructions change. The visual redesign should not need database migrations or API contract changes; document any genuinely necessary exception before introducing it.

## Accessibility and interaction requirements

- Support keyboard-only use, visible focus, logical tab order, labeled controls, and meaningful page/step headings. Announce save, loading, error, and validation messages appropriately. Keep focus predictable after opening menus and changing repair steps.
- Use sufficiently contrasting text and controls. Preserve readable text at 200% zoom and show status through words or icons as well as color. Respect reduced-motion preferences.
- Aim for at least 44 × 44 px touch targets for primary interactive controls, with enough separation to avoid accidental taps.
- Check 320 px, 375–390 px, tablet, and desktop widths. Avoid page-level horizontal overflow; a data table may scroll within an explicitly indicated container. Sticky actions must not cover fields, validation messages, or device safe areas.
- Keep loading, disabled, offline, local draft, syncing, conflict, error, empty, success, paused, demo, and archived states understandable. Keep user input when requests fail or the browser is refreshed, according to existing draft behavior.

## Validation and acceptance

- Run `npm run build` in `frontend/` and any focused checks needed for changed behavior. Review the mockup and implemented screens at the widths above, including an actual narrow mobile viewport and keyboard navigation.
- Using disposable synthetic cases and an isolated mock provider, walk through creating a repair, a diagnostic round, a result, a saved work log, the checklist, review, closing, archiving, restore, and the existing delete confirmation. Exercise the failed-verification return to diagnosis and pause/resume. Do not run paid AI calls or modify the user's existing cases while validating.
- Confirm that refreshing, direct step links, device drafts, offline queued saves, sync/conflict messages, and role restrictions still behave correctly. A draft must never be displayed as a completed server save.
- Check the specific close-button scenario: an incomplete work log visibly explains what is missing and links to Repair work; a complete saved log and checklist with valid feedback allow closure under existing server rules.
- Confirm the visual redesign covers sign-in, repairs, due returns, the full repair journey, history/archiving, team, administration, and the pilot report. Verify no existing action disappears at mobile widths.
- Report what was built and checked, include mockup and implementation paths, and identify any validation that could not be performed. Do not change credentials or the user's `.env`.

## Delivery order

1. Visual reference and shared tokens.
2. Shared shell, navigation, buttons, fields, status labels, and alerts.
3. Repair list and the complete repair journey, including history and archive actions.
4. Authentication, due returns, team, administration, and reporting.
5. Responsive and accessibility review, focused functional checks, and documentation.

Budgeting, service orders, invoices, approvals, RAG, and paid-provider changes are separate future work.
