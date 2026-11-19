package com.superfix.repair;

import static com.superfix.config.ApiError.*;
import static com.superfix.repair.RepairData.*;
import static com.superfix.repair.RepairRequests.*;
import static com.superfix.repair.RepairService.CHECKLIST;

import com.superfix.account.AccountDto.User;
import com.superfix.account.AccountService;
import java.time.Instant;
import java.util.*;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.jdbc.core.JdbcTemplate;

/** Diagnostic progress and completion of a repair. */
@Service
@RequiredArgsConstructor
class RepairWorkflowService {
    private static final int MAX_FOLLOW_UPS = 12;
    private final RepairService repairService;
    private final RepairReturnRepository returns;
    private final AccountService accounts;
    private final AiQueue queue;
    private final DiagnosticAi ai;
    private final DiagnosticConversationService conversations;
    private final JdbcTemplate jdbc;

    @Transactional
    public View draft(User user, UUID id, Draft input) {
        var repair = repairService.writable(user, id);
        repairService.requireVersion(repair, input.version());
        repairService.requireStatus(repair, Status.AWAITING_ANSWERS);
        replaceRound(repair, input.answers(), false);
        return repairService.save(repair, user);
    }

    @Transactional
    public View submit(User user, UUID id, Submit input) {
        var repair = repairService.writable(user, id);
        if (queue.duplicate(id, input.key())) return repairService.view(user, repair);
        repairService.requireVersion(repair, input.version());
        repairService.requireStatus(repair, Status.DRAFT, Status.AWAITING_ANSWERS, Status.AI_ERROR);
        if (repair.details.demo() != ai.mode().equals("mock")) throw conflict("providerChanged");
        if (repair.status == Status.AWAITING_ANSWERS) replaceRound(repair, input.answers(), true);
        if (repair.status == Status.DRAFT && needsEscalation(repair.details.intake())) {
            return inconclusive(user, repair, "safetyEscalation");
        }
        Integer limit = accounts.lockAiLimit(user.companyId());
        if (!queue.withinLimit(repair, limit)) return inconclusive(user, repair, "aiLimit");
        repair.details = repair.details.result(null, null);
        repair.status = Status.PROCESSING;
        queue.enqueue(repair, input.key(), user.locale() == null ? "en" : user.locale());
        repairService.audit(user, repair, "DIAGNOSTIC_REQUESTED");
        return repairService.save(repair, user);
    }

    @Transactional
    public View transition(User user, UUID id, String action, Change input) {
        var repair = repairService.writable(user, id);
        repairService.requireVersion(repair, input.version());
        switch (action) {
            case "pause" -> {
                repairService.requireStatus(repair, Status.DRAFT, Status.AWAITING_ANSWERS, Status.AI_ERROR, Status.DIAGNOSING, Status.DIAGNOSIS_PROPOSED,
                        Status.INCONCLUSIVE, Status.CHECKLIST);
                repair.details = repair.details.paused(repair.status);
                repair.status = Status.PAUSED;
            }
            case "resume" -> {
                repairService.requireStatus(repair, Status.PAUSED);
                repair.status = repair.details.resumeStatus();
                repair.details = repair.details.paused(null);
                startScheduledReturn(user, repair);
            }
            case "stop" -> {
                repairService.requireStatus(repair, Status.DRAFT, Status.AWAITING_ANSWERS, Status.AI_ERROR);
                return inconclusive(user, repair, "stopped");
            }
            case "continue-diagnosis" -> {
                repairService.requireStatus(repair, Status.CHECKLIST);
                var log = requireCompleteWorkLog(repair.details.workLog());
                if (log.verification().result() != VerificationResult.FAILED) throw conflict("failedVerificationRequired");
                if ("CHAT".equals(repair.diagnosticMode)) {
                    Instant now = Instant.now();
                    repair.details = repair.details.continueChatDiagnosis(now);
                    repair.status = Status.DIAGNOSING;
                    conversations.recordFailedVerificationContext(user, repair);
                } else {
                    if (needsEscalation(repair.details.intake())) throw conflict("safetyEscalation");
                    if (repair.details.demo() != ai.mode().equals("mock")) throw conflict("providerChanged");
                    Integer limit = accounts.lockAiLimit(user.companyId());
                    if (repair.details.attempts().size() >= MAX_FOLLOW_UPS || !queue.withinLimit(repair, limit)) {
                        throw conflict("followUpLimit");
                    }
                    repair.details = repair.details.continueDiagnosis(DiagnosticCatalog.FOLLOW_UP_QUESTIONS, Instant.now());
                    repair.status = Status.AWAITING_ANSWERS;
                }
            }
            case "checklist" -> {
                repairService.requireStatus(repair, Status.DIAGNOSIS_PROPOSED, Status.INCONCLUSIVE);
                if (repair.status == Status.DIAGNOSIS_PROPOSED) {
                    if (input.decision() == null) throw bad("diagnosisDecision");
                    var finding = repair.details.finding();
                    repair.details = repair.details.result(new Finding(finding.causeCode(), finding.cause(), finding.evidence(), finding.limitation(),
                            finding.steps(), input.decision(), finding.translationKey(), finding.evidenceQuestionIds()), null);
                }
                repair.status = Status.CHECKLIST;
            }
            default -> throw missing();
        }
        repairService.audit(user, repair, "CASE_" + action.toUpperCase(Locale.ROOT).replace('-', '_'));
        return repairService.save(repair, user);
    }

    @Transactional
    public View checks(User user, UUID id, Checks input) {
        var repair = repairService.writable(user, id);
        repairService.requireVersion(repair, input.version());
        repairService.requireStatus(repair, Status.CHECKLIST);
        for (var entry : input.checks().entrySet()) {
            var item = CHECKLIST.stream().filter(check -> check.id().equals(entry.getKey())).findFirst()
                    .orElseThrow(() -> bad("invalidChecklist"));
            var response = entry.getValue();
            if ((item.alwaysRequired() && response.status() == CheckStatus.NOT_APPLICABLE) ||
                    (response.status() != CheckStatus.CONFIRMED &&
                            (response.reason() == null || response.reason().isBlank()))) throw bad("invalidChecklist");
        }
        repair.details = repair.details.checks(Map.copyOf(input.checks()));
        return repairService.save(repair, user);
    }

    @Transactional
    public View saveWorkLog(User user, UUID id, SaveWorkLog input) {
        var repair = repairService.writable(user, id);
        repairService.requireVersion(repair, input.version());
        repairService.requireStatus(repair, Status.CHECKLIST);
        var log = input.log();
        if (log.workStatus() == WorkStatus.NOT_PERFORMED && !log.parts().isEmpty()) throw bad("partsWithoutWork");
        if (log.readings().stream().anyMatch(reading -> reading.beforeValue() == null && reading.afterValue() == null)) {
            throw bad("readingRequired");
        }
        repair.details = repair.details.workLog(new WorkLogEntry(log, user.id(), Instant.now()));
        repairService.audit(user, repair, "REPAIR_LOG_SAVED");
        return repairService.save(repair, user);
    }

    @Transactional
    public View close(User user, UUID id, long version, Close input) {
        var repair = repairService.writable(user, id);
        repairService.requireVersion(repair, version);
        repairService.requireStatus(repair, Status.CHECKLIST);
        for (Checklist item : CHECKLIST) {
            var response = repair.details.checks().get(item.id());
            if (response == null || response.status() == CheckStatus.UNRESOLVED ||
                    (item.alwaysRequired() && response.status() != CheckStatus.CONFIRMED)) throw conflict("checklistIncomplete");
        }
        validateWorkLog(repair.details.workLog(), input.outcome());
        boolean chatAssistanceShown = Boolean.TRUE.equals(jdbc.queryForObject("""
                select exists(select 1 from conversation_messages where case_id = ? and role = 'ASSISTANT')
                """, Boolean.class, repair.id));
        if ((input.rating() == Rating.NOT_USED) == (repair.details.assistanceShown() || chatAssistanceShown)) throw bad("ratingRequired");
        repair.details = repair.details.closed(new Feedback(input.outcome(), input.rating(), input.feedback(), user.id()));
        repair.status = Status.CLOSED;
        completeStartedReturn(user, repair);
        repairService.audit(user, repair, "CASE_CLOSED");
        return repairService.save(repair, user);
    }

    private void startScheduledReturn(User user, RepairCase repair) {
        returns.findFirstByCaseIdAndStatusIn(repair.id, List.of(RepairReturn.State.SCHEDULED))
                .ifPresent(visit -> {
                    visit.status = RepairReturn.State.STARTED;
                    visit.startedAt = Instant.now();
                    repairService.audit(user, repair, "RETURN_STARTED");
                });
    }

    private void completeStartedReturn(User user, RepairCase repair) {
        returns.findFirstByCaseIdAndStatusIn(repair.id, List.of(RepairReturn.State.STARTED))
                .ifPresent(visit -> {
                    visit.status = RepairReturn.State.COMPLETED;
                    visit.completedAt = Instant.now();
                    repairService.audit(user, repair, "RETURN_COMPLETED");
                });
    }

    private WorkLog requireCompleteWorkLog(WorkLogEntry entry) {
        if (entry == null) throw conflict("repairLogIncomplete");
        var log = entry.log();
        var verification = log.verification();
        if (log.workStatus() == null || verification == null || blank(verification.notes())
                || (log.workStatus() == WorkStatus.PERFORMED && blank(log.workPerformed()))) {
            throw conflict("repairLogIncomplete");
        }
        return log;
    }

    private void validateWorkLog(WorkLogEntry entry, Outcome outcome) {
        var log = requireCompleteWorkLog(entry);
        boolean matches = switch (log.verification().result()) {
            case PASSED -> outcome == Outcome.RESOLVED;
            case FAILED -> outcome == Outcome.UNRESOLVED;
            case NOT_PERFORMED -> outcome == Outcome.UNVERIFIED || outcome == Outcome.UNRESOLVED;
        };
        if (!matches) throw conflict("outcomeVerificationMismatch");
    }

    private boolean needsEscalation(Intake intake) {
        if (Boolean.TRUE.equals(intake.hazard())) return true;
        if (!"dryer".equals(intake.category()) && !"cooktop".equals(intake.category())) return false;
        return intake.fuel() != Fuel.ELECTRIC;
    }

    private View inconclusive(User user, RepairCase repair, String reason) {
        repair.status = Status.INCONCLUSIVE;
        repair.details = repair.details.result(null, reason);
        repairService.audit(user, repair, "CASE_INCONCLUSIVE");
        return repairService.save(repair, user);
    }

    private void replaceRound(RepairCase repair, Map<String, Answer> answers, boolean submitted) {
        if (answers == null) throw bad("invalidAnswers");
        var rounds = new ArrayList<>(repair.details.rounds());
        var round = rounds.getLast();
        var valid = new LinkedHashMap<String, Answer>();
        for (Question question : round.questions()) {
            var answer = answers.get(question.id());
            if (answer == null) {
                if (submitted) throw bad("answerRequired");
                continue;
            }
            String value = answer.value() == null ? "" : answer.value().strip();
            if (question.type() == Type.NUMBER) value = value.replace(',', '.');
            if (answer.status() == AnswerStatus.ANSWERED) {
                if (value.isBlank() || !validValue(question, value)) throw bad("invalidAnswers");
            } else if (!value.isBlank()) throw bad("invalidAnswers");
            valid.put(question.id(), new Answer(answer.status(), value, answer.reason()));
        }
        if (valid.size() != answers.size()) throw bad("invalidAnswers");
        rounds.set(rounds.size() - 1, new Round(round.number(), round.questions(), Map.copyOf(valid), submitted, round.followUpIntake()));
        repair.details = repair.details.rounds(List.copyOf(rounds));
    }

    private boolean validValue(Question question, String value) {
        return switch (question.type()) {
            case TEXT -> true;
            case NUMBER -> value.matches("-?[0-9]{1,9}(\\.[0-9]{1,6})?");
            case CHOICE -> question.choices().contains(value);
            case YES_NO, CONFIRMATION -> List.of("yes", "no").contains(value);
        };
    }

    private boolean blank(String value) {
        return value == null || value.isBlank();
    }
}
