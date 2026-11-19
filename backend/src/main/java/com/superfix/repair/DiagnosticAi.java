package com.superfix.repair;

import static com.superfix.repair.RepairData.*;
import static com.superfix.repair.DiagnosticCatalog.*;

import java.util.*;
import org.springframework.stereotype.Component;

@Component
class DiagnosticAi {
    record Result(Status status, List<Question> questions, Finding finding, String issue,
                  Integer inputTokens, Integer outputTokens,
                  DiagnosticProviderClient.ResponseTrace responseTrace, String decision,
                  String decisionReason, String modelNote) {
        Result(Status status, List<Question> questions, Finding finding, String issue,
               Integer inputTokens, Integer outputTokens) {
            this(status, questions, finding, issue, inputTokens, outputTokens, null, null, null, null);
        }
    }

    static final class EvaluationException extends Exception {
        private final DiagnosticProviderClient.ResponseTrace responseTrace;
        private final String reason;

        EvaluationException(String reason, DiagnosticProviderClient.ResponseTrace responseTrace) {
            super("AI diagnostic output did not meet the response contract");
            this.reason = reason;
            this.responseTrace = responseTrace;
        }

        DiagnosticProviderClient.ResponseTrace responseTrace() { return responseTrace; }
        String reason() { return reason; }
    }
    private final DiagnosticProviderClient providerClient;
    private final DiagnosticGuideCatalog guides;

    DiagnosticAi(DiagnosticProviderClient providerClient, DiagnosticGuideCatalog guides) {
        this.providerClient = providerClient;
        this.guides = guides;
    }

    String mode() { return providerClient.mode(); }
    String model() { return providerClient.model(); }

    Result run(String provider, String requestedModel, String locale, RepairCase repair) throws Exception {
        if (!provider.equals(mode()) || !requestedModel.equals(model())) throw new IllegalStateException("Provider configuration changed");
        var rounds = repair.details.rounds();
        var pinnedGuide = repair.details.attempts().isEmpty()
                ? guides.find(repair.details.procedure(), repair.details.demo()) : null;
        if (pinnedGuide != null) return runGuide(repair, pinnedGuide);
        if (mode().equals("mock")) {
            if (!repair.details.attempts().isEmpty()) {
                var freshEvidence = evidence(repair.details.currentRounds());
                if (freshEvidence.isEmpty() || repair.details.attempts().size() > 1) return inconclusive(null, null);
                return diagnosis("COMPONENT", List.copyOf(freshEvidence.values()), List.copyOf(freshEvidence.keySet()), null, null);
            }
            if (rounds.isEmpty()) return questions(List.of("pattern", "display"), null, null);
            if (rounds.size() == 1) {
                String measurement = switch (repair.categoryCode) {
                    case "refrigerator" -> "temperature";
                    case "cooktop" -> "recent";
                    default -> "cycle";
                };
                return questions(List.of(measurement, "settings"), null, null);
            }
            var evidence = evidence(rounds);
            if (evidence.isEmpty()) return inconclusive(null, null);
            var selected = evidence.entrySet().stream().limit(3).toList();
            return diagnosis("SETTINGS", selected.stream().map(Map.Entry::getValue).toList(),
                    selected.stream().map(Map.Entry::getKey).toList(), null, null);
        }
        return requestProviderDiagnosis(repair, requestedModel, locale);
    }

    private Result runGuide(RepairCase repair, DiagnosticGuideCatalog.Guide guide) {
        var submittedRounds = repair.details.currentRounds().stream().filter(Round::submitted).toList();
        if (submittedRounds.isEmpty()) {
            return new Result(Status.AWAITING_ANSWERS, guide.questions(), null, null, null, null);
        }
        if (submittedRounds.size() == 1) {
            if (!guide.followUpQuestions().isEmpty()) {
                return new Result(Status.AWAITING_ANSWERS, guide.followUpQuestions(), null, null, null, null);
            }
            return new Result(Status.INCONCLUSIVE, List.of(), null,
                    guide.procedure().synthetic() ? "unreviewedProcedure" : "insufficientEvidence", null, null);
        }

        var facts = evidence(submittedRounds);
        for (var branch : guide.branches()) {
            if (matches(branch, submittedRounds)) {
                return guideFinding(Status.DIAGNOSIS_PROPOSED, branch, facts, null);
            }
        }
        if (guide.fallback() != null) {
            return guideFinding(Status.INCONCLUSIVE, guide.fallback(), facts, "insufficientEvidence");
        }
        return inconclusive(null, null);
    }

    private boolean matches(DiagnosticGuideCatalog.GuideBranch branch, List<Round> rounds) {
        for (var condition : branch.whenAnswers().entrySet()) {
            Answer answer = null;
            for (Round round : rounds) {
                Answer candidate = round.answers().get(condition.getKey());
                if (candidate != null && candidate.status() == AnswerStatus.ANSWERED) answer = candidate;
            }
            if (answer == null || !condition.getValue().contains(answer.value())) return false;
        }
        return true;
    }

    private Result guideFinding(Status status, DiagnosticGuideCatalog.GuideBranch branch,
                                Map<String, String> facts, String issue) {
        var supporting = branch.evidence().stream().map(facts::get).filter(Objects::nonNull).toList();
        var supportingIds = branch.evidence().stream().filter(facts::containsKey).toList();
        var finding = new Finding(branch.causeCode(), branch.cause(), supporting,
                branch.limitation(), branch.steps(), null, branch.translationKey(), supportingIds);
        return new Result(status, List.of(), finding, issue, null, null);
    }

    private Result requestProviderDiagnosis(RepairCase repair, String requestedModel, String locale) throws Exception {
        var rounds = repair.details.rounds();
        var intake = repair.details.intake();
        var allowed = new TreeSet<>(QUESTIONS.keySet());
        if (!repair.categoryCode.equals("refrigerator")) allowed.remove("temperature");
        if (!Set.of("washer", "dryer", "dishwasher").contains(repair.categoryCode)) allowed.remove("cycle");
        rounds.forEach(round -> round.questions().forEach(q -> allowed.remove(q.id())));
        var context = new LinkedHashMap<String, Object>();
        var diagnosticIntake = new LinkedHashMap<String, Object>();
        diagnosticIntake.put("category", intake.category());
        diagnosticIntake.put("symptoms", intake.symptoms());
        diagnosticIntake.put("brand", intake.brand());
        diagnosticIntake.put("model", intake.model());
        diagnosticIntake.put("fuel", intake.fuel());
        diagnosticIntake.put("hazard", intake.hazard());
        diagnosticIntake.put("modelConfirmed", intake.modelConfirmed());
        diagnosticIntake.put("diagnosticTopic", intake.diagnosticTopic());
        context.put("intake", diagnosticIntake);
        context.put("rounds", rounds);
        context.put("availableQuestions", allowed);
        context.put("technicianLocale", locale);
        if (!repair.details.attempts().isEmpty()) {
            var previousAttempt = repair.details.attempts().getLast();
            context.put("previousWorkAndFailedTest", previousAttempt.workLog().log());
            context.put("previousSuggestion", previousAttempt.finding());
            context.put("currentAttemptFirstRound", previousAttempt.throughRound() + 1);
        }
        var providerResponse = providerClient.request(repair, requestedModel, context);
        var trace = providerResponse.trace();
        if (providerResponse.refused()) {
            return inconclusive(null, null, trace, "PROVIDER_REFUSAL", "PROVIDER_REFUSED", null);
        }
        var reply = providerResponse.reply();
        Integer in = providerResponse.inputTokens();
        Integer out = providerResponse.outputTokens();
        if (reply == null || reply.questionIds() == null || reply.evidence() == null ||
                reply.note() == null || reply.note().isBlank() || reply.note().length() > 500) {
            throw new EvaluationException("MISSING_OR_INVALID_REQUIRED_FIELDS", trace);
        }
        return switch (reply.action()) {
            case "ASK" -> {
                var ids = new LinkedHashSet<>(reply.questionIds());
                if (ids.isEmpty() || ids.size() > 3 || ids.size() != reply.questionIds().size() ||
                        !allowed.containsAll(ids) || !"NONE".equals(reply.cause()) || !reply.evidence().isEmpty()) {
                    throw new EvaluationException("INVALID_QUESTION_SELECTION", trace);
                }
                yield questions(List.copyOf(ids), in, out, trace, "ASK", "MODEL_REQUESTED_MORE_EVIDENCE", reply.note());
            }
            case "DIAGNOSE" -> {
                var facts = evidence(rounds);
                var ids = new LinkedHashSet<>(reply.evidence());
                boolean hasFreshEvidence = repair.details.attempts().isEmpty()
                        || ids.stream().anyMatch(evidence(repair.details.currentRounds())::containsKey);
                String rejectionReason = null;
                if (!CAUSES.containsKey(reply.cause())) rejectionReason = "UNSUPPORTED_CAUSE";
                else if (!reply.questionIds().isEmpty()) rejectionReason = "DIAGNOSIS_INCLUDED_QUESTIONS";
                else if (ids.size() < 2 || ids.size() > 6) rejectionReason = "INVALID_EVIDENCE_COUNT";
                else if (!facts.keySet().containsAll(ids)) rejectionReason = "UNKNOWN_EVIDENCE_ID";
                else if (!hasFreshEvidence) rejectionReason = "NO_CURRENT_ATTEMPT_EVIDENCE";
                if (rejectionReason != null) {
                    yield inconclusive(in, out, trace, "DIAGNOSIS_REJECTED", rejectionReason, reply.note());
                }
                yield diagnosis(reply.cause(), ids.stream().map(facts::get).toList(), List.copyOf(ids), in, out,
                        trace, "DIAGNOSIS_ACCEPTED", "VALIDATION_PASSED", reply.note());
            }
            case "INCONCLUSIVE" -> inconclusive(in, out, trace, "INCONCLUSIVE", "MODEL_SELECTED_INCONCLUSIVE", reply.note());
            default -> throw new EvaluationException("UNEXPECTED_DIAGNOSTIC_ACTION", trace);
        };
    }

    private Map<String,String> evidence(List<Round> rounds) {
        var evidence = new LinkedHashMap<String,String>();
        for (Round round : rounds) {
            if (!round.submitted()) continue;
            for (Question question : round.questions()) {
                Answer answer = round.answers().get(question.id());
                if (answer != null && answer.status() == AnswerStatus.ANSWERED) {
                    evidence.put(question.id(), question.label() + " " + answer.value()
                            + (question.unit() == null ? "" : " " + question.unit()));
                }
            }
        }
        return evidence;
    }

    private Result questions(List<String> ids, Integer in, Integer out) {
        return new Result(Status.AWAITING_ANSWERS, ids.stream().map(QUESTIONS::get).toList(), null, null, in, out);
    }

    private Result questions(List<String> ids, Integer in, Integer out,
                             DiagnosticProviderClient.ResponseTrace trace, String decision,
                             String reason, String note) {
        return new Result(Status.AWAITING_ANSWERS, ids.stream().map(QUESTIONS::get).toList(), null, null,
                in, out, trace, decision, reason, note);
    }

    private Result diagnosis(String code, List<String> evidence, List<String> evidenceQuestionIds, Integer in, Integer out) {
        var finding = new Finding(code, CAUSES.get(code), evidence,
                "Confirm the cause against the exact model and service documentation before carrying out a repair.",
                STEPS.get(code), null, null, evidenceQuestionIds);
        return new Result(Status.DIAGNOSIS_PROPOSED, List.of(), finding, null, in, out);
    }

    private Result diagnosis(String code, List<String> evidence, List<String> evidenceQuestionIds, Integer in, Integer out,
                             DiagnosticProviderClient.ResponseTrace trace, String decision,
                             String reason, String note) {
        var finding = new Finding(code, CAUSES.get(code), evidence,
                "Confirm the cause against the exact model and service documentation before carrying out a repair.",
                STEPS.get(code), null, null, evidenceQuestionIds);
        return new Result(Status.DIAGNOSIS_PROPOSED, List.of(), finding, null,
                in, out, trace, decision, reason, note);
    }

    private Result inconclusive(Integer in, Integer out) {
        return new Result(Status.INCONCLUSIVE, List.of(), null, "insufficientEvidence", in, out);
    }

    private Result inconclusive(Integer in, Integer out, DiagnosticProviderClient.ResponseTrace trace,
                                String decision, String reason, String note) {
        return new Result(Status.INCONCLUSIVE, List.of(), null, "insufficientEvidence",
                in, out, trace, decision, reason, note);
    }

}
