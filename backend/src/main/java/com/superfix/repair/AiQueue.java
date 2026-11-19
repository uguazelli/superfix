package com.superfix.repair;

import static com.superfix.repair.RepairData.*;

import java.time.*;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

@Slf4j
@Component
@RequiredArgsConstructor
class AiQueue {
    record Job(UUID id, UUID caseId, UUID conversationMessageId, String provider, String model, String locale) {
        DiagnosticConversationService.QueueJob conversationJob() {
            return new DiagnosticConversationService.QueueJob(id, caseId, conversationMessageId, provider, model, locale);
        }
    }
    private final JdbcTemplate jdbc;
    private final RepairRepository repairs;
    private final DiagnosticAi ai;
    private final DiagnosticConversationService conversations;
    private final TransactionTemplate transactions;

    boolean duplicate(UUID caseId, UUID key) {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "select exists(select 1 from ai_requests where case_id = ? and client_key = ?)",
                Boolean.class, caseId, key));
    }

    boolean withinLimit(RepairCase repair, Integer monthlyLimit) {
        int started = jdbc.queryForObject("select count(*) from ai_requests where case_id = ?", Integer.class, repair.id);
        if (started >= 12) return false;
        if (monthlyLimit == null) return true;
        var start = LocalDate.now(ZoneOffset.UTC).withDayOfMonth(1).atStartOfDay();
        int used = jdbc.queryForObject(
                "select count(*) from ai_requests where company_id = ? and created_at >= ?",
                Integer.class, repair.companyId, start.atOffset(ZoneOffset.UTC));
        return used < monthlyLimit;
    }

    void enqueue(RepairCase repair, UUID key, String locale) {
        jdbc.update("""
                insert into ai_requests(id, case_id, company_id, client_key, status, provider, model, contract_version, locale, created_at)
                values (?, ?, ?, ?, 'QUEUED', ?, ?, 1, ?, now())
                """, UUID.randomUUID(), repair.id, repair.companyId, key, ai.mode(), ai.model(), locale);
    }

    @Scheduled(fixedDelay = 500)
    void runNext() {
        Job job = transactions.execute(tx -> {
            var jobs = jdbc.query("""
                    select id, case_id, conversation_message_id, provider, model, locale from ai_requests where status = 'QUEUED'
                    order by created_at limit 1 for update skip locked
                    """, (row, index) -> new Job(row.getObject(1, UUID.class), row.getObject(2, UUID.class),
                    row.getObject(3, UUID.class), row.getString(4), row.getString(5), row.getString(6)));
            if (jobs.isEmpty()) return null;
            Job next = jobs.getFirst();
            jdbc.update("update ai_requests set status = 'RUNNING', started_at = now() where id = ?", next.id());
            return next;
        });
        if (job == null) return;
        if (job.conversationMessageId() != null) conversations.markRunning(job.conversationJob());
        try {
            if (job.conversationMessageId() != null) {
                conversations.process(job.conversationJob());
                return;
            }
            RepairCase repair = repairs.findById(job.caseId()).orElseThrow();
            var result = ai.run(job.provider(), job.model(), job.locale(), repair);
            complete(job, result, null, null);
        } catch (Exception error) {
            DiagnosticProviderClient.ResponseTrace trace = null;
            String reason = error.getClass().getSimpleName();
            if (error instanceof DiagnosticProviderClient.ProviderHttpException providerError) {
                log.warn("Diagnostic request {} failed (provider HTTP {})", job.id(), providerError.statusCode());
                trace = providerError.trace();
                reason = "PROVIDER_HTTP_" + providerError.statusCode();
            } else if (error instanceof DiagnosticProviderClient.ProviderResponseException responseError) {
                log.warn("Diagnostic request {} failed while reading provider output ({})", job.id(), responseError.reason());
                trace = responseError.trace();
                reason = responseError.reason();
            } else if (error instanceof DiagnosticAi.EvaluationException evaluationError) {
                log.warn("Diagnostic request {} failed validation ({})", job.id(), evaluationError.reason());
                trace = evaluationError.responseTrace();
                reason = evaluationError.reason();
            } else {
                log.warn("Diagnostic request {} failed ({})", job.id(), error.getClass().getSimpleName());
            }
            if (job.conversationMessageId() != null) conversations.fail(job.conversationJob(), reason, trace);
            else complete(job, null, trace, reason);
        }
    }

    @Scheduled(fixedDelay = 30_000)
    void recoverInterrupted() {
        var expired = jdbc.query("""
                select id, case_id, conversation_message_id, provider, model, locale from ai_requests
                where status = 'RUNNING' and started_at < now() - interval '2 minutes' limit 50
                """, (row, index) -> new Job(row.getObject(1, UUID.class), row.getObject(2, UUID.class),
                row.getObject(3, UUID.class), row.getString(4), row.getString(5), row.getString(6)));
        expired.forEach(job -> {
            if (job.conversationMessageId() != null) conversations.fail(job.conversationJob(), "INTERRUPTED_REQUEST", null);
            else complete(job, null, null, "INTERRUPTED_REQUEST");
        });
    }

    private void complete(Job job, DiagnosticAi.Result result, DiagnosticProviderClient.ResponseTrace failureTrace,
                          String failureReason) {
        transactions.executeWithoutResult(tx -> {
            var repair = repairs.lock(job.caseId()).orElseThrow();
            if (repair.status != Status.PROCESSING) return;
            var trace = result == null ? failureTrace : result.responseTrace();
            String decision = result == null ? "ERROR" : result.decision();
            String reason = result == null ? failureReason : result.decisionReason();
            int changed = jdbc.update("""
                    update ai_requests set status = ?, finished_at = now(), input_tokens = ?, output_tokens = ?,
                      diagnostic_decision = ?, diagnostic_reason = ?, model_note = ?,
                      response_text = ?, response_kind = ?, response_truncated = ?
                    where id = ? and status = 'RUNNING'
                    """, result == null ? "FAILED" : "COMPLETED", result == null ? null : result.inputTokens(),
                    result == null ? null : result.outputTokens(), decision, reason,
                    result == null ? null : result.modelNote(), trace == null ? null : trace.text(),
                    trace == null ? null : trace.kind(), trace != null && trace.truncated(), job.id());
            if (changed == 0) return;
            if (result == null) {
                repair.status = Status.AI_ERROR;
                repair.details = repair.details.result(null, "aiUnavailable");
            } else {
                repair.status = result.status();
                repair.details = repair.details.result(result.finding(), result.issue());
                if (!result.questions().isEmpty()) {
                    var rounds = new java.util.ArrayList<>(repair.details.rounds());
                    rounds.add(new Round(rounds.size() + 1, result.questions(), java.util.Map.of(), false, false));
                    repair.details = repair.details.rounds(rounds);
                }
            }
            repair.updatedAt = Instant.now();
        });
    }
}
