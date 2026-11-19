package com.superfix.repair;

import static com.superfix.config.ApiError.*;
import static com.superfix.repair.ConversationRequests.*;
import static com.superfix.repair.DiagnosticProviderClient.*;
import static com.superfix.repair.RepairData.*;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.superfix.account.AccountDto.User;
import com.superfix.account.AccountService;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.*;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/** Persists technician chat turns independently from legacy diagnostic rounds. */
@Slf4j
@Service
@RequiredArgsConstructor
class DiagnosticConversationService {
    private static final int INITIAL_CONTEXT_MAX_CHARS = 12_000;
    private static final String TRUNCATED_CONTEXT_MARKER = "[Additional historical case context was omitted to fit the request limit.]";
    record HandoffValue(String summary, String possibleCause, List<String> evidence, List<String> unresolved,
                        String source, UUID authorId, Instant savedAt) {}
    record MessageView(UUID id, long sequence, String role, UUID authorId, String text, Instant createdAt,
                       String state, String failureCode, UUID clientKey, List<Photo> attachments,
                       Map<String, Object> suggestion) {}
    record ConversationView(UUID conversationId, UUID caseId, long caseVersion, Status caseStatus,
                           boolean started, boolean imageAnalysisAvailable, int photoLimit,
                           List<Photo> photos, List<MessageView> messages, HandoffValue handoff,
                           List<IntakeUpdate> intakeUpdates, boolean contextLimited, int requestsUsed,
                           int requestLimit, UUID pendingMessageId, boolean hasMoreMessages,
                           Long nextBeforeSequence) {}
    record IntakeUpdate(UUID id, String field, String previousValue, String value, UUID sourceMessageId,
                        UUID sourcePhotoId, String evidenceQuote, Instant createdAt) {}
    record QueueJob(UUID id, UUID caseId, UUID messageId, String provider, String model, String locale) {}
    record StoredMessage(UUID id, long sequence, String role, String text, UUID replyTo, String state,
                         String failureCode, UUID clientKey, Instant createdAt, String suggestionJson,
                         String intakeSnapshot) {}

    private final RepairService repairService;
    private final RepairRepository repairs;
    private final CategoryRepository categories;
    private final AccountService accounts;
    private final DiagnosticAi ai;
    private final DiagnosticProviderClient provider;
    private final DiagnosticGuideCatalog guides;
    private final PhotoStorage photoStorage;
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final TransactionTemplate transactions;
    @Value("${superfix.ai.max-chat-requests-per-case:50}") private int requestLimit;
    @Value("${superfix.photos.max-per-case:12}") private int photoLimit;

    @Transactional(readOnly = true)
    ConversationView get(User user, UUID caseId, Long beforeSequence, int requestedLimit) {
        RepairCase repair = repairService.visible(user, repairs.findById(caseId));
        if (beforeSequence != null && beforeSequence <= 0) throw bad("invalidConversationCursor");
        return view(user, repair, beforeSequence, Math.max(1, Math.min(100, requestedLimit)));
    }

    @Transactional
    ConversationView start(User user, UUID caseId, Start input) {
        RepairCase repair = repairService.writable(user, caseId);
        var existing = conversationId(caseId, user.companyId());
        if (existing != null) return view(user, repair);
        repairService.requireVersion(repair, input.version());
        requireOpen(repair);
        if (repair.status == Status.PROCESSING) throw conflict("diagnosticInProgress");
        if (repair.status == Status.PAUSED) throw conflict("repairPaused");
        repairService.requireStatus(repair, Status.DRAFT, Status.AWAITING_ANSWERS, Status.AI_ERROR,
                Status.DIAGNOSIS_PROPOSED, Status.INCONCLUSIVE, Status.CHECKLIST);

        UUID conversationId = UUID.randomUUID();
        Instant now = Instant.now();
        jdbc.update("""
                insert into repair_conversations(id, case_id, company_id, created_at, updated_at)
                values (?, ?, ?, ?, ?)
                """, conversationId, caseId, user.companyId(), java.sql.Timestamp.from(now), java.sql.Timestamp.from(now));
        repair.diagnosticMode = "CHAT";
        if (repair.status != Status.CHECKLIST) repair.status = Status.DIAGNOSING;
        repairService.audit(user, repair, "CONVERSATION_STARTED");
        repairService.save(repair, user);

        String context = boundedInitialContext(initialContext(repair));
        if (!context.isBlank()) {
            UUID contextId = UUID.randomUUID();
            UUID messageKey = input.key();
            jdbc.update("""
                    insert into conversation_messages(id, conversation_id, case_id, company_id, sequence,
                      role, text, state, client_key, intake_snapshot, created_at)
                    values (?, ?, ?, ?, 1, 'CONTEXT', ?, 'QUEUED', ?, ?::jsonb, ?)
                    """, contextId, conversationId, caseId, user.companyId(), context, messageKey,
                    writeJson(repair.details.intake()), java.sql.Timestamp.from(now));
            queueTurn(user, repair, contextId, messageKey, locale(user), now);
        }
        return view(user, repair);
    }

    @Transactional
    ConversationView message(User user, UUID caseId, Message input) {
        RepairCase repair = repairService.writable(user, caseId);
        UUID priorId = messageIdByKey(caseId, input.key());
        if (priorId != null) return view(user, repair);
        repairService.requireVersion(repair, input.version());
        requireOpen(repair);
        repairService.requireStatus(repair, Status.DIAGNOSING, Status.CHECKLIST);
        UUID conversationId = conversationId(caseId, user.companyId());
        if (conversationId == null) throw conflict("conversationNotStarted");
        if (hasActiveTurn(caseId)) throw conflict("conversationTurnPending");
        String text = input.text() == null ? "" : input.text().strip();
        if (text.isBlank() && input.photoIds().isEmpty()) throw bad("conversationMessageRequired");
        if (text.length() > 4000) throw bad("conversationMessageTooLong");
        if (input.photoIds().size() > photoLimit) throw bad("photoCount");
        var selected = selectedPhotos(repair, input.photoIds());

        long sequence = nextSequence(caseId);
        UUID messageId = UUID.randomUUID();
        Instant now = Instant.now();
        jdbc.update("""
                insert into conversation_messages(id, conversation_id, case_id, company_id, sequence,
                  role, author_id, text, state, client_key, intake_snapshot, created_at)
                values (?, ?, ?, ?, ?, 'TECHNICIAN', ?, ?, 'QUEUED', ?, ?::jsonb, ?)
                """, messageId, conversationId, caseId, user.companyId(), sequence, user.id(), text,
                input.key(), writeJson(repair.details.intake()), java.sql.Timestamp.from(now));
        selected.forEach(photo -> jdbc.update("""
                insert into conversation_message_photos(message_id, photo_id, case_id, company_id)
                values (?, ?, ?, ?)
                """, messageId, photo.id(), caseId, user.companyId()));
        queueTurn(user, repair, messageId, input.key(), locale(user), now);
        jdbc.update("update repair_conversations set updated_at = ? where id = ?",
                java.sql.Timestamp.from(now), conversationId);
        return view(user, repair);
    }

    @Transactional
    ConversationView retry(User user, UUID caseId, UUID messageId, Retry input) {
        RepairCase repair = repairService.writable(user, caseId);
        repairService.requireVersion(repair, input.version());
        requireOpen(repair);
        repairService.requireStatus(repair, Status.DIAGNOSING, Status.CHECKLIST);
        if (!existsMessage(caseId, messageId, "TECHNICIAN")) throw missing();
        if (hasActiveTurn(caseId)) throw conflict("conversationTurnPending");
        if (hasAssistantReply(caseId, messageId)) throw conflict("conversationAlreadyAnswered");
        String state = jdbc.queryForObject("select state from conversation_messages where id = ? and case_id = ?",
                String.class, messageId, caseId);
        if (!"FAILED".equals(state)) throw conflict("conversationRetryUnavailable");
        jdbc.update("update conversation_messages set state = 'QUEUED', failure_code = null where id = ?", messageId);
        queueTurn(user, repair, messageId, input.key(), locale(user), Instant.now());
        return view(user, repair);
    }

    @Transactional
    ConversationView continueToWork(User user, UUID caseId, Handoff input) {
        RepairCase repair = repairService.writable(user, caseId);
        var savedHandoffKeys = jdbc.query("select handoff_key from repair_conversations where case_id = ? and company_id = ?",
                (row, index) -> row.getObject(1, UUID.class), caseId, user.companyId());
        UUID lastHandoffKey = savedHandoffKeys.isEmpty() ? null : savedHandoffKeys.getFirst();
        if (Objects.equals(lastHandoffKey, input.key())) return view(user, repair);
        repairService.requireVersion(repair, input.version());
        requireOpen(repair);
        if (repair.status == Status.PAUSED) throw conflict("repairPaused");
        repairService.requireStatus(repair, Status.DIAGNOSING, Status.CHECKLIST, Status.DRAFT,
                Status.AWAITING_ANSWERS, Status.AI_ERROR, Status.DIAGNOSIS_PROPOSED, Status.INCONCLUSIVE);
        UUID conversationId = conversationId(caseId, user.companyId());
        if (conversationId == null) {
            Instant now = Instant.now();
            conversationId = UUID.randomUUID();
            jdbc.update("insert into repair_conversations(id, case_id, company_id, created_at, updated_at) values (?, ?, ?, ?, ?)",
                    conversationId, caseId, user.companyId(), java.sql.Timestamp.from(now), java.sql.Timestamp.from(now));
        }
        repair.diagnosticMode = "CHAT";
        String source = input.source() == null ? "UNDETERMINED" : input.source();
        var value = new HandoffValue(clean(input.summary()), clean(input.possibleCause()), safeList(input.evidence()),
                safeList(input.unresolved()), source, user.id(), Instant.now());
        jdbc.update("update repair_conversations set handoff = ?::jsonb, handoff_key = ?, handoff_author = ?, handoff_saved_at = ?, updated_at = ? where case_id = ? and company_id = ?",
                writeJson(value), input.key(), user.id(), java.sql.Timestamp.from(value.savedAt()), java.sql.Timestamp.from(value.savedAt()),
                caseId, user.companyId());
        if (repair.status != Status.CHECKLIST) repair.status = Status.CHECKLIST;
        repairService.audit(user, repair, "CONVERSATION_CONTINUED_TO_WORK");
        repairService.save(repair, user);
        return view(user, repair);
    }

    void recordFailedVerificationContext(User user, RepairCase repair) {
        UUID conversationId = conversationId(repair.id, user.companyId());
        if (conversationId == null) {
            Instant now = Instant.now();
            conversationId = UUID.randomUUID();
            jdbc.update("insert into repair_conversations(id, case_id, company_id, created_at, updated_at) values (?, ?, ?, ?, ?)",
                    conversationId, repair.id, user.companyId(), java.sql.Timestamp.from(now), java.sql.Timestamp.from(now));
        }
        String context = "The technician chose to continue diagnosis after the recorded final verification failed. "
                + "Prior work, readings, checklist responses, and attempt history below are historical records."
                + "\n" + boundedInitialContext(initialContext(repair));
        Instant now = Instant.now();
        jdbc.update("""
                insert into conversation_messages(id, conversation_id, case_id, company_id, sequence,
                  role, text, state, intake_snapshot, created_at)
                values (?, ?, ?, ?, ?, 'CONTEXT', ?, 'SAVED', ?::jsonb, ?)
                """, UUID.randomUUID(), conversationId, repair.id, user.companyId(), nextSequence(repair.id),
                context, writeJson(repair.details.intake()), java.sql.Timestamp.from(now));
        jdbc.update("update repair_conversations set updated_at = ? where id = ?",
                java.sql.Timestamp.from(now), conversationId);
    }

    void markRunning(QueueJob job) {
        jdbc.update("update conversation_messages set state = 'RUNNING' where id = ? and state = 'QUEUED'", job.messageId());
    }

    void process(QueueJob job) throws Exception {
        RepairCase repair = repairs.findById(job.caseId()).orElseThrow();
        if (repair.status == Status.CLOSED || repair.archivedAt != null) {
            fail(job, "CASE_CLOSED", null);
            return;
        }
        var turn = jdbc.query("select id, role, text from conversation_messages where id = ? and case_id = ?",
                (row, index) -> new PromptMessage(row.getString(2), row.getString(3), row.getObject(1, UUID.class)),
                job.messageId(), job.caseId());
        if (turn.isEmpty()) throw new IllegalStateException("Missing saved conversation message");
        var messages = promptHistory(job.caseId());
        var currentPhotoIds = jdbc.query("select photo_id from conversation_message_photos where message_id = ? and case_id = ?",
                (row, index) -> row.getObject(1, UUID.class), job.messageId(), job.caseId());
        var selected = repair.details.photos().stream().filter(photo -> currentPhotoIds.contains(photo.id())).toList();
        boolean limited = contextLimited(job.caseId());
        if (hasCaseContext(repair)) messages.add(0, new PromptMessage("CONTEXT", caseContext(repair), null));
        var response = provider.requestConversation(repair, job.model(), job.locale(), messages, selected,
                job.messageId(), limited);
        persistSuccess(job, repair, response);
    }

    void fail(QueueJob job, String reason, ResponseTrace trace) {
        transactions.executeWithoutResult(tx -> {
            var repair = repairs.lock(job.caseId()).orElse(null);
            boolean closed = repair == null || repair.status == Status.CLOSED || repair.archivedAt != null;
            String outcome = closed ? "CANCELLED" : "ERROR";
            String failure = closed ? "CASE_CLOSED" : reason == null ? "AI_UNAVAILABLE" : safeFailure(reason);
            updateTrace(job.id(), null, null, outcome, failure, trace);
            jdbc.update("update conversation_messages set state = ?, failure_code = ? where id = ? and state in ('QUEUED','RUNNING')",
                    closed ? "CANCELLED" : "FAILED", failure, job.messageId());
        });
    }

    private void persistSuccess(QueueJob job, RepairCase original, ConversationResponse response) {
        transactions.executeWithoutResult(tx -> {
            var repair = repairs.lock(job.caseId()).orElseThrow();
            var message = jdbc.query("""
                    select state, sequence, intake_snapshot::text from conversation_messages
                    where id = ? and case_id = ? for update
                    """, (row, index) -> new Object[]{row.getString(1), row.getLong(2), row.getString(3)},
                    job.messageId(), job.caseId());
            if (message.isEmpty()) return;
            String state = (String) message.getFirst()[0];
            if (!Set.of("QUEUED", "RUNNING").contains(state)) return;
            if (repair.status == Status.CLOSED || repair.archivedAt != null) {
                jdbc.update("update conversation_messages set state = 'CANCELLED', failure_code = 'CASE_CLOSED' where id = ?", job.messageId());
                updateTrace(job.id(), response.inputTokens(), response.outputTokens(), "CANCELLED", "CASE_CLOSED", response.trace());
                return;
            }
            UUID existingReply = jdbc.query("select id from conversation_messages where case_id = ? and reply_to_message_id = ?",
                    (row, index) -> row.getObject(1, UUID.class), job.caseId(), job.messageId()).stream().findFirst().orElse(null);
            if (existingReply != null) return;
            var reply = response.reply();
            UUID assistantId = UUID.randomUUID();
            long next = nextSequence(job.caseId());
            Instant now = Instant.now();
            String suggestion = writeJson(reply.suggestion());
            jdbc.update("""
                    insert into conversation_messages(id, conversation_id, case_id, company_id, sequence,
                      role, text, state, reply_to_message_id, suggestion, created_at)
                    select ?, id, case_id, company_id, ?, 'ASSISTANT', ?, 'ANSWERED', ?, ?::jsonb, ?
                    from repair_conversations where case_id = ? and company_id = ?
                    """, assistantId, next, reply.assistantMessage().strip(), job.messageId(), suggestion,
                    java.sql.Timestamp.from(now), job.caseId(), repair.companyId);
            jdbc.update("update conversation_messages set state = 'ANSWERED', failure_code = null where id = ?", job.messageId());
            updateTrace(job.id(), response.inputTokens(), response.outputTokens(), "COMPLETED", null, response.trace());
            applyExtractedFields(repair, (String) message.getFirst()[2], reply.extractedFields(), job.id(), job.messageId());
            jdbc.update("update repair_conversations set updated_at = ? where case_id = ? and company_id = ?",
                    java.sql.Timestamp.from(now), job.caseId(), repair.companyId);
        });
    }

    private void applyExtractedFields(RepairCase repair, String snapshotJson, List<ExtractedField> fields,
                                      UUID requestId, UUID requestMessageId) {
        if (fields == null || fields.isEmpty() || snapshotJson == null) return;
        Intake snapshot;
        try { snapshot = json.readValue(snapshotJson, Intake.class); }
        catch (Exception ignored) { return; }
        Intake current = repair.details.intake();
        String category = current.category();
        String brand = current.brand();
        String model = current.model();
        String serial = current.serialNumber();
        String symptoms = current.symptoms();
        boolean changed = false;
        boolean identityChanged = false;
        var seen = new HashSet<String>();
        var updates = new ArrayList<IntakeUpdate>();
        for (ExtractedField field : fields) {
            if (field == null || field.field() == null || field.value() == null || field.sourceMessageId() == null
                    || field.evidenceQuote() == null || field.evidenceQuote().isBlank()
                    || !Set.of("SET", "APPEND").contains(field.operation())) continue;
            UUID sourceId;
            try { sourceId = UUID.fromString(field.sourceMessageId()); } catch (IllegalArgumentException error) { continue; }
            String sourceText = jdbc.query("select text from conversation_messages where id = ? and case_id = ? and role = 'TECHNICIAN'",
                    (row, index) -> row.getString(1), sourceId, repair.id).stream().findFirst().orElse(null);
            if (sourceText == null) continue;
            UUID sourcePhotoId = null;
            if (field.sourcePhotoId() == null) {
                if (!sourceText.contains(field.evidenceQuote())) continue;
            } else {
                try { sourcePhotoId = UUID.fromString(field.sourcePhotoId()); } catch (IllegalArgumentException error) { continue; }
                if (!provider.imageAnalysisEnabled() || !sourceId.equals(requestMessageId)
                        || "symptoms".equals(field.field()) || !photoAttachedToMessage(repair, sourceId, sourcePhotoId)) continue;
            }
            String value = field.value().strip();
            String evidence = field.evidenceQuote().strip();
            if (value.isBlank() || value.length() > 4000 || evidence.isBlank() || evidence.length() > 500) continue;
            if (!"symptoms".equals(field.field()) && !"SET".equals(field.operation())) continue;
            if (seen.contains(field.field())) continue;
            switch (field.field()) {
                case "category" -> {
                    if (!Objects.equals(current.category(), snapshot.category()) || value.length() > 40
                            || categories.findById(value).filter(c -> c.active).isEmpty()) continue;
                    category = value;
                    identityChanged |= !Objects.equals(current.category(), category);
                }
                case "brand" -> {
                    if (!Objects.equals(current.brand(), snapshot.brand()) || value.length() > 120) continue;
                    brand = value;
                    identityChanged |= !Objects.equals(current.brand(), brand);
                }
                case "model" -> {
                    if (!Objects.equals(current.model(), snapshot.model()) || value.length() > 120) continue;
                    model = value;
                    identityChanged |= !Objects.equals(current.model(), model);
                }
                case "serialNumber" -> {
                    if (!Objects.equals(current.serialNumber(), snapshot.serialNumber()) || value.length() > 120) continue;
                    serial = value;
                    identityChanged |= !Objects.equals(current.serialNumber(), serial);
                }
                case "symptoms" -> {
                    if (!Objects.equals(current.symptoms(), snapshot.symptoms()) || value.length() > 4000) continue;
                    if ("APPEND".equals(field.operation()) && current.symptoms() != null && !current.symptoms().isBlank()) {
                        String existing = current.symptoms().strip();
                        if (existing.toLowerCase(Locale.ROOT).contains(value.toLowerCase(Locale.ROOT))) continue;
                        symptoms = existing + "\n" + value;
                        if (symptoms.length() > 4000) continue;
                    } else {
                        symptoms = value;
                    }
                }
                default -> { continue; }
            }
            seen.add(field.field());
            String previous = switch (field.field()) {
                case "category" -> current.category();
                case "brand" -> current.brand();
                case "model" -> current.model();
                case "serialNumber" -> current.serialNumber();
                case "symptoms" -> current.symptoms();
                default -> null;
            };
            String updatedValue = switch (field.field()) {
                case "category" -> category;
                case "brand" -> brand;
                case "model" -> model;
                case "serialNumber" -> serial;
                case "symptoms" -> symptoms;
                default -> null;
            };
            if (!Objects.equals(previous, updatedValue)) {
                changed = true;
                updates.add(new IntakeUpdate(UUID.randomUUID(), field.field(), previous, updatedValue,
                        sourceId, sourcePhotoId, evidence, Instant.now()));
            }
        }
        if (!changed) return;
        Intake updated = new Intake(category, symptoms, brand, model, current.fuel(), current.hazard(), serial,
                identityChanged ? false : current.modelConfirmed(), current.diagnosticTopic());
        repair.categoryCode = category;
        repair.details = repair.details.intake(updated);
        var guide = guides.select(updated, repair.details.demo());
        repair.details = repair.details.procedure(guide == null ? null : guide.procedure());
        if (identityChanged) repair.applianceId = null;
        repair.applianceSerialKey = serialKey(serial);
        repair.updatedAt = Instant.now();
        repairs.flush();
        for (IntakeUpdate update : updates) {
            jdbc.update("""
                    insert into conversation_intake_updates(id, case_id, company_id, field_code, previous_value,
                      current_value, source_message_id, source_photo_id, evidence_quote, ai_request_id, created_at)
                    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, update.id(), repair.id, repair.companyId, update.field(), update.previousValue(), update.value(),
                    update.sourceMessageId(), update.sourcePhotoId(), update.evidenceQuote(), requestId,
                    java.sql.Timestamp.from(update.createdAt()));
        }
    }

    private boolean photoAttachedToMessage(RepairCase repair, UUID messageId, UUID photoId) {
        return Boolean.TRUE.equals(jdbc.queryForObject("""
                select exists(select 1 from conversation_message_photos
                  where message_id = ? and photo_id = ? and case_id = ? and company_id = ?)
                """, Boolean.class, messageId, photoId, repair.id, repair.companyId));
    }

    private void queueTurn(User user, RepairCase repair, UUID messageId, UUID key, String locale, Instant now) {
        String safetyMessage = provider.safetyMessage(repair, locale);
        if (safetyMessage != null) {
            UUID assistantId = UUID.randomUUID();
            jdbc.update("""
                    insert into conversation_messages(id, conversation_id, case_id, company_id, sequence,
                      role, text, state, reply_to_message_id, suggestion, created_at)
                    select ?, id, case_id, company_id, ?, 'ASSISTANT', ?, 'ANSWERED', ?, ?::jsonb, ?
                    from repair_conversations where case_id = ? and company_id = ?
                    """, assistantId, nextSequence(repair.id), safetyMessage, messageId,
                    writeJson(new Suggestion("", List.of(), "")), java.sql.Timestamp.from(now), repair.id, user.companyId());
            jdbc.update("update conversation_messages set state = 'ANSWERED' where id = ?", messageId);
            jdbc.update("update repair_conversations set updated_at = ? where case_id = ? and company_id = ?",
                    java.sql.Timestamp.from(now), repair.id, user.companyId());
            return;
        }
        if (repair.details.demo() != ai.mode().equals("mock")) {
            jdbc.update("update conversation_messages set state = 'FAILED', failure_code = 'PROVIDER_CHANGED' where id = ?", messageId);
            return;
        }
        Integer monthlyLimit = accounts.lockAiLimit(user.companyId());
        int used = jdbc.queryForObject("select count(*) from ai_requests where case_id = ?", Integer.class, repair.id);
        if (used >= requestLimit) {
            jdbc.update("update conversation_messages set state = 'FAILED', failure_code = 'AI_LIMIT' where id = ?", messageId);
            return;
        }
        if (monthlyLimit != null && !withinMonthlyLimit(repair.companyId, monthlyLimit)) {
            jdbc.update("update conversation_messages set state = 'FAILED', failure_code = 'COMPANY_AI_LIMIT' where id = ?", messageId);
            return;
        }
        UUID requestId = UUID.randomUUID();
        jdbc.update("""
                insert into ai_requests(id, case_id, company_id, client_key, status, provider, model,
                  contract_version, locale, created_at, conversation_message_id)
                values (?, ?, ?, ?, 'QUEUED', ?, ?, 2, ?, ?, ?)
                """, requestId, repair.id, repair.companyId, key, ai.mode(), ai.model(), locale,
                java.sql.Timestamp.from(now), messageId);
        jdbc.update("update conversation_messages set ai_request_id = ? where id = ?", requestId, messageId);
    }

    private boolean withinMonthlyLimit(UUID companyId, int limit) {
        var monthStart = LocalDate.now(ZoneOffset.UTC).withDayOfMonth(1).atStartOfDay().atOffset(ZoneOffset.UTC);
        Integer used = jdbc.queryForObject("select count(*) from ai_requests where company_id = ? and created_at >= ?",
                Integer.class, companyId, monthStart);
        return used == null || used < limit;
    }

    private void updateTrace(UUID requestId, Integer inputTokens, Integer outputTokens, String decision,
                             String reason, ResponseTrace trace) {
        jdbc.update("""
                update ai_requests set status = ?, finished_at = now(), input_tokens = ?, output_tokens = ?,
                  diagnostic_decision = ?, diagnostic_reason = ?, response_text = ?, response_kind = ?, response_truncated = ?
                where id = ? and status = 'RUNNING'
                """, "CANCELLED".equals(decision) ? "CANCELLED" : "COMPLETED".equals(decision) ? "COMPLETED" : "FAILED",
                inputTokens, outputTokens, decision, reason, trace == null ? null : trace.text(),
                trace == null ? null : trace.kind(), trace != null && trace.truncated(), requestId);
    }

    private ConversationView view(User user, RepairCase repair) {
        return view(user, repair, null, 40);
    }

    private ConversationView view(User user, RepairCase repair, Long beforeSequence, int pageSize) {
        UUID conversationId = conversationId(repair.id, user.companyId());
        HandoffValue handoff = null;
        List<MessageView> messages = List.of();
        UUID pending = null;
        boolean limited = false;
        boolean hasMoreMessages = false;
        Long nextBeforeSequence = null;
        List<IntakeUpdate> intakeUpdates = List.of();
        if (conversationId != null) {
            var handoffValues = jdbc.query("select handoff::text from repair_conversations where id = ?",
                    (row, index) -> row.getString(1), conversationId);
            handoff = readHandoff(handoffValues.isEmpty() ? null : handoffValues.getFirst());
            String messageSql = """
                    select id, sequence, role, text, reply_to_message_id, state, failure_code, client_key,
                      created_at, suggestion::text, intake_snapshot::text
                    from conversation_messages where conversation_id = ?
                    """ + (beforeSequence == null ? "" : " and sequence < ?") + " order by sequence desc limit ?";
            var stored = beforeSequence == null
                    ? jdbc.query(messageSql, (row, index) -> new StoredMessage(row.getObject(1, UUID.class), row.getLong(2), row.getString(3),
                    row.getString(4), row.getObject(5, UUID.class), row.getString(6), row.getString(7),
                    row.getObject(8, UUID.class), row.getTimestamp(9).toInstant(), row.getString(10), row.getString(11)),
                    conversationId, pageSize)
                    : jdbc.query(messageSql, (row, index) -> new StoredMessage(row.getObject(1, UUID.class), row.getLong(2), row.getString(3),
                    row.getString(4), row.getObject(5, UUID.class), row.getString(6), row.getString(7),
                    row.getObject(8, UUID.class), row.getTimestamp(9).toInstant(), row.getString(10), row.getString(11)),
                    conversationId, beforeSequence, pageSize);
            Collections.reverse(stored);
            if (!stored.isEmpty()) {
                long oldestSequence = stored.getFirst().sequence();
                hasMoreMessages = Boolean.TRUE.equals(jdbc.queryForObject("""
                        select exists(select 1 from conversation_messages where conversation_id = ? and sequence < ?)
                        """, Boolean.class, conversationId, oldestSequence));
                if (hasMoreMessages) nextBeforeSequence = oldestSequence;
            }
            var attachmentIds = jdbc.query("""
                    select message_id, photo_id from conversation_message_photos where case_id = ? and company_id = ?
                    """, (row, index) -> Map.entry(row.getObject(1, UUID.class), row.getObject(2, UUID.class)),
                    repair.id, user.companyId());
            var photoById = repair.details.photos().stream().collect(Collectors.toMap(Photo::id, p -> p));
            Map<UUID, List<Photo>> byMessage = attachmentIds.stream().collect(Collectors.groupingBy(Map.Entry::getKey,
                    Collectors.mapping(entry -> photoById.get(entry.getValue()), Collectors.filtering(Objects::nonNull, Collectors.toList()))));
            messages = stored.stream().map(item -> new MessageView(item.id(), item.sequence(), item.role(), null,
                    item.text(), item.createdAt(), item.state(), item.failureCode(), item.clientKey(),
                    byMessage.getOrDefault(item.id(), List.of()), readMap(item.suggestionJson()))).toList();
            intakeUpdates = jdbc.query("""
                    select id, field_code, previous_value, current_value, source_message_id, source_photo_id,
                      evidence_quote, created_at
                    from conversation_intake_updates where case_id = ? and company_id = ? order by created_at, id
                    """, (row, index) -> new IntakeUpdate(row.getObject(1, UUID.class), row.getString(2), row.getString(3),
                    row.getString(4), row.getObject(5, UUID.class), row.getObject(6, UUID.class), row.getString(7), row.getTimestamp(8).toInstant()),
                    repair.id, user.companyId());
            pending = jdbc.query("""
                    select id from conversation_messages where conversation_id = ?
                      and role in ('TECHNICIAN', 'CONTEXT') and state in ('QUEUED', 'RUNNING')
                    order by sequence desc limit 1
                    """, (row, index) -> row.getObject(1, UUID.class), conversationId).stream().findFirst().orElse(null);
            limited = contextLimited(repair.id);
        }
        int used = jdbc.queryForObject("select count(*) from ai_requests where case_id = ?", Integer.class, repair.id);
        return new ConversationView(conversationId, repair.id, repair.version, repair.status, conversationId != null,
                provider.imageAnalysisEnabled(), photoLimit, repair.details.photos(), messages, handoff,
                intakeUpdates, limited, used, requestLimit, pending, hasMoreMessages, nextBeforeSequence);
    }

    private List<PromptMessage> promptHistory(UUID caseId) {
        var all = jdbc.query("""
                select id, role, text from conversation_messages where case_id = ?
                  and state not in ('CANCELLED') order by sequence
                """, (row, index) -> new PromptMessage(row.getString(2), row.getString(3), row.getObject(1, UUID.class)), caseId);
        var selected = new ArrayList<PromptMessage>();
        int charCount = 0;
        for (int index = all.size() - 1; index >= 0; index--) {
            PromptMessage message = all.get(index);
            int length = message.text() == null ? 0 : message.text().length();
            if (selected.size() >= 24 || charCount + length > 24000) break;
            selected.add(message);
            charCount += length;
        }
        Collections.reverse(selected);
        return selected;
    }

    private boolean contextLimited(UUID caseId) {
        Integer count = jdbc.queryForObject("select count(*) from conversation_messages where case_id = ?", Integer.class, caseId);
        Integer chars = jdbc.queryForObject("select coalesce(sum(length(text)),0) from conversation_messages where case_id = ?", Integer.class, caseId);
        boolean historicalContextLimited = Boolean.TRUE.equals(jdbc.queryForObject("""
                select exists(select 1 from conversation_messages where case_id = ? and role = 'CONTEXT'
                  and position(? in text) > 0)
                """, Boolean.class, caseId, TRUNCATED_CONTEXT_MARKER));
        return count != null && count > 24 || chars != null && chars > 24000 || historicalContextLimited;
    }

    private boolean hasCaseContext(RepairCase repair) {
        var intake = repair.details.intake();
        return clean(intake.category()) != null || clean(intake.symptoms()) != null || clean(intake.brand()) != null
                || clean(intake.model()) != null || clean(intake.serialNumber()) != null || intake.fuel() != null
                || intake.hazard() != null || !repair.details.rounds().isEmpty() || !repair.details.attempts().isEmpty()
                || repair.details.finding() != null || repair.details.workLog() != null;
    }

    private String initialContext(RepairCase repair) {
        if (!hasCaseContext(repair)) return "";
        StringBuilder context = new StringBuilder("Existing repair information:");
        append(context, "Appliance", repair.categoryCode);
        append(context, "Symptoms", repair.details.intake().symptoms());
        append(context, "Brand", repair.details.intake().brand());
        append(context, "Model", repair.details.intake().model());
        append(context, "Serial number", repair.details.intake().serialNumber());
        if (repair.details.intake().fuel() != null) append(context, "Fuel", repair.details.intake().fuel().name());
        append(context, "Hazard status", repair.details.intake().hazard() == null ? "Unknown" : repair.details.intake().hazard()
                ? "Suspected hazard reported; not yet verified safe" : "No suspected hazard reported; this is not a safety clearance");
        appendRecentAttempts(context, repair.details.attempts());
        if (repair.details.workLog() != null) appendWorkLog(context, "Current saved repair work", repair.details.workLog().log());
        if (!repair.details.rounds().isEmpty()) {
            context.append("\nPrevious diagnostic checks (historical; unanswered values remain unanswered):");
            for (Round round : repair.details.rounds()) {
                for (Question question : round.questions()) {
                    Answer answer = round.answers().get(question.id());
                    context.append("\n- ").append(question.label()).append(": ");
                    context.append(answer == null ? "Not answered" : answer.status() == AnswerStatus.ANSWERED
                            ? answer.value() : answer.status() + (clean(answer.reason()) == null ? "" : " — " + answer.reason()));
                }
            }
        }
        if (repair.details.finding() != null) append(context, "Previous unconfirmed suggestion", repair.details.finding().cause());
        return context.toString();
    }

    private String boundedInitialContext(String context) {
        if (context.length() <= INITIAL_CONTEXT_MAX_CHARS) return context;
        int end = INITIAL_CONTEXT_MAX_CHARS - TRUNCATED_CONTEXT_MARKER.length() - 1;
        int lineEnd = context.lastIndexOf('\n', end);
        if (lineEnd > INITIAL_CONTEXT_MAX_CHARS / 2) end = lineEnd;
        if (end > 0 && Character.isHighSurrogate(context.charAt(end - 1))) end--;
        return context.substring(0, end).stripTrailing() + "\n" + TRUNCATED_CONTEXT_MARKER;
    }

    private void appendRecentAttempts(StringBuilder context, List<RepairAttempt> attempts) {
        if (attempts == null || attempts.isEmpty()) return;
        context.append("\nPrevious repair attempts (historical; suggestions are not confirmed):");
        for (int index = attempts.size() - 1; index >= 0; index--) {
            RepairAttempt attempt = attempts.get(index);
            context.append("\nAttempt through diagnostic round ").append(attempt.throughRound()).append(':');
            if (attempt.finding() != null) append(context, "Prior suggestion", attempt.finding().cause());
            append(context, "Prior diagnostic issue", attempt.issue());
            if (attempt.workLog() != null) appendWorkLog(context, "Work in this attempt", attempt.workLog().log());
            if (attempt.checks() != null && !attempt.checks().isEmpty()) {
                attempt.checks().forEach((name, check) -> context.append("\n- Checklist ").append(name).append(": ")
                        .append(check.status()).append(clean(check.reason()) == null ? "" : " — " + check.reason()));
            }
        }
    }

    private void appendWorkLog(StringBuilder context, String title, WorkLog log) {
        context.append("\n").append(title).append(':');
        append(context, "Confirmed fault recorded by technician", log.confirmedFault());
        append(context, "Work status", log.workStatus() == null ? null : log.workStatus().name());
        append(context, "Work performed", log.workPerformed());
        if (!log.parts().isEmpty()) append(context, "Parts", log.parts().stream()
                .map(part -> part.name() + (part.partNumber() == null ? "" : " (" + part.partNumber() + ")") + " x" + part.quantity())
                .collect(Collectors.joining(", ")));
        if (!log.readings().isEmpty()) append(context, "Recorded measurements", log.readings().stream()
                .map(reading -> reading.name() + ": " + Objects.toString(reading.beforeValue(), "not recorded")
                        + " → " + Objects.toString(reading.afterValue(), "not recorded")
                        + (reading.unit() == null ? "" : " " + reading.unit()))
                .collect(Collectors.joining("; ")));
        if (log.verification() != null) append(context, "Final verification", log.verification().result()
                + (clean(log.verification().notes()) == null ? "" : " — " + log.verification().notes()));
    }

    private String caseContext(RepairCase repair) {
        var intake = repair.details.intake();
        return "Current structured case details (technician-editable): " + writeJson(intake)
                + "\nHistorical checks and work are included in the conversation context message when present.";
    }

    private void append(StringBuilder builder, String label, String value) {
        if (clean(value) != null) builder.append("\n").append(label).append(": ").append(value.strip());
    }

    private List<Photo> selectedPhotos(RepairCase repair, List<UUID> ids) {
        if (ids == null || ids.isEmpty()) return List.of();
        if (ids.stream().distinct().count() != ids.size()) throw bad("invalidPhoto");
        var selected = new ArrayList<Photo>();
        for (UUID id : ids) selected.add(repair.details.photos().stream().filter(photo -> photo.id().equals(id))
                .findFirst().orElseThrow(() -> bad("invalidPhoto")));
        return List.copyOf(selected);
    }

    private boolean hasActiveTurn(UUID caseId) {
        return Boolean.TRUE.equals(jdbc.queryForObject("select exists(select 1 from conversation_messages where case_id = ? and role in ('TECHNICIAN','CONTEXT') and state in ('QUEUED','RUNNING'))",
                Boolean.class, caseId));
    }

    private boolean existsMessage(UUID caseId, UUID messageId, String role) {
        return Boolean.TRUE.equals(jdbc.queryForObject("select exists(select 1 from conversation_messages where id = ? and case_id = ? and role = ?)",
                Boolean.class, messageId, caseId, role));
    }

    private boolean hasAssistantReply(UUID caseId, UUID messageId) {
        return Boolean.TRUE.equals(jdbc.queryForObject("select exists(select 1 from conversation_messages where case_id = ? and reply_to_message_id = ?)",
                Boolean.class, caseId, messageId));
    }

    private UUID messageIdByKey(UUID caseId, UUID key) {
        return jdbc.query("select id from conversation_messages where case_id = ? and client_key = ?",
                (row, index) -> row.getObject(1, UUID.class), caseId, key).stream().findFirst().orElse(null);
    }

    private UUID conversationId(UUID caseId, UUID companyId) {
        return jdbc.query("select id from repair_conversations where case_id = ? and company_id = ?",
                (row, index) -> row.getObject(1, UUID.class), caseId, companyId).stream().findFirst().orElse(null);
    }

    private long nextSequence(UUID caseId) {
        Long value = jdbc.queryForObject("select coalesce(max(sequence),0) + 1 from conversation_messages where case_id = ?", Long.class, caseId);
        return value == null ? 1 : value;
    }

    private String locale(User user) { return user.locale() == null || user.locale().isBlank() ? "en" : user.locale(); }

    private void requireOpen(RepairCase repair) {
        if (repair.status == Status.CLOSED || repair.archivedAt != null) throw conflict("archivedReadOnly");
    }

    private String clean(String value) { return value == null || value.isBlank() ? null : value.strip(); }
    private List<String> safeList(List<String> value) { return value == null ? List.of() : value.stream().map(this::clean).filter(Objects::nonNull).toList(); }
    private String serialKey(String value) { return value == null || value.isBlank() ? null : value.strip().toLowerCase(Locale.ROOT); }
    private String safeFailure(String value) { return value != null && value.matches("[A-Z0-9_]{1,80}") ? value : "AI_UNAVAILABLE"; }

    private String writeJson(Object value) {
        try { return json.writeValueAsString(value); }
        catch (Exception error) { throw new IllegalStateException("Could not serialize conversation data", error); }
    }

    private HandoffValue readHandoff(String value) {
        if (value == null) return null;
        try { return json.readValue(value, HandoffValue.class); }
        catch (Exception ignored) { return null; }
    }

    private Map<String, Object> readMap(String value) {
        if (value == null) return null;
        try { return json.readValue(value, new TypeReference<>() {}); }
        catch (Exception ignored) { return null; }
    }
}
