package com.superfix.repair;

import jakarta.validation.constraints.*;
import jakarta.validation.Valid;
import java.time.Instant;
import java.time.LocalDate;
import java.util.*;

final class RepairData {
    enum Status { DRAFT, PROCESSING, AWAITING_ANSWERS, AI_ERROR, DIAGNOSIS_PROPOSED, INCONCLUSIVE, DIAGNOSING, PAUSED, CHECKLIST, CLOSED }
    enum Fuel { ELECTRIC, GAS, DUAL, UNKNOWN }
    enum Type { TEXT, NUMBER, CHOICE, YES_NO, CONFIRMATION }
    enum AnswerStatus { ANSWERED, UNKNOWN, UNAVAILABLE, NOT_PERFORMED }
    enum Decision { ACCEPTED, REJECTED }
    enum Outcome { RESOLVED, UNRESOLVED, UNVERIFIED }
    enum Rating { GOOD, BAD, NOT_USED }
    enum CheckStatus { CONFIRMED, UNRESOLVED, NOT_APPLICABLE }
    enum WorkStatus { PERFORMED, NOT_PERFORMED }
    enum VerificationResult { PASSED, FAILED, NOT_PERFORMED }
    enum PhotoKind { SYMPTOM, MODEL_PLATE }

    record Intake(@Size(max = 40) String category,
                  @Size(max = 4000) String symptoms,
                  @Size(max = 120) String brand, @Size(max = 120) String model,
                  Fuel fuel, Boolean hazard,
                  @Size(max = 120) String serialNumber, Boolean modelConfirmed,
                  @Size(max = 40) String diagnosticTopic) {
        Intake {
            modelConfirmed = Boolean.TRUE.equals(modelConfirmed);
        }
    }
    record Photo(UUID id, String contentType, int size, PhotoKind kind, UUID clientKey) {}
    record Question(String id, String label, Type type, String unit, List<String> choices) {}
    record Answer(@NotNull AnswerStatus status, @Size(max = 1000) String value, @Size(max = 500) String reason) {}
    record Round(int number, List<Question> questions, Map<String, Answer> answers, boolean submitted, boolean followUpIntake) {}
    record Finding(String causeCode, String cause, List<String> evidence, String limitation, List<String> steps,
                   Decision decision, String translationKey, List<String> evidenceQuestionIds) {
        Finding {
            evidence = evidence == null ? List.of() : List.copyOf(evidence);
            steps = steps == null ? List.of() : List.copyOf(steps);
            evidenceQuestionIds = evidenceQuestionIds == null ? List.of() : List.copyOf(evidenceQuestionIds);
        }
    }
    record Check(@NotNull CheckStatus status, @Size(max = 500) String reason) {}
    record Checklist(String id, boolean alwaysRequired) {}
    record Feedback(Outcome outcome, Rating rating, String feedback, UUID author) {}
    record Part(@NotBlank @Size(max = 120) String name, @Size(max = 120) String partNumber,
                @Min(1) @Max(999) int quantity) {}
    record Reading(@NotBlank @Size(max = 120) String name, @Size(max = 24) String unit,
                   @Pattern(regexp = "-?[0-9]{1,9}(\\.[0-9]{1,6})?") String beforeValue,
                   @Pattern(regexp = "-?[0-9]{1,9}(\\.[0-9]{1,6})?") String afterValue) {
        Reading {
            beforeValue = canonicalDecimal(beforeValue);
            afterValue = canonicalDecimal(afterValue);
        }
    }
    record Verification(@NotNull VerificationResult result, @Size(max = 2000) String notes) {}
    record WorkLog(@Size(max = 1000) String confirmedFault,
                   @Pattern(regexp = "SETTINGS|INSTALLATION|CLOSURE|COMPONENT|OTHER") String confirmedCauseCode,
                   WorkStatus workStatus,
                   @Size(max = 4000) String workPerformed,
                   @NotNull @Size(max = 20) List<@NotNull @Valid Part> parts,
                   @NotNull @Size(max = 20) List<@NotNull @Valid Reading> readings,
                   @Valid Verification verification) {}
    record WorkLogEntry(WorkLog log, UUID author, Instant savedAt) {}
    record RepairAttempt(WorkLogEntry workLog, Finding finding, String issue, Map<String, Check> checks,
                         int throughRound, Instant continuedAt) {}
    record ApplianceSummary(UUID id, String category, String brand, String model, String serialNumber) {}
    record ReturnPart(UUID id, String name, String partNumber, int quantity, String status) {}
    record ReturnSummary(UUID id, UUID caseId, String jobReference, java.time.LocalDate scheduledFor,
                         String status, String reason, String nextAction, Instant startedAt,
                         Instant completedAt, List<ReturnPart> parts) {}
    record Assignment(UUID technicianId, UUID previousTechnicianId, UUID actorId, String note, Instant createdAt,
                      String technicianName, String previousTechnicianName, String actorName) {}
    record Activity(String action, UUID actorId, String actorName, Instant createdAt) {}
    record HistoryEntry(UUID id, String jobReference, Status status, String symptoms, Instant createdAt,
                        Instant updatedAt, String confirmedFault, Outcome outcome, VerificationResult verification,
                        List<Reading> readings, List<Part> usedParts, UUID technicianId, UUID parentCaseId,
                        boolean canOpen) {}
    record Detail(Intake intake, List<Photo> photos, List<Round> rounds, Finding finding, String issue,
                  Status resumeStatus, Map<String, Check> checks, WorkLogEntry workLog, Feedback feedback,
                  List<RepairAttempt> attempts, boolean demo, ProcedureRef procedure) {
        Detail {
            attempts = attempts == null ? List.of() : List.copyOf(attempts);
        }
        static Detail initial(Intake intake, boolean demo) {
            return new Detail(intake, List.of(), List.of(), null, null, null, Map.of(), null, null, List.of(), demo, null);
        }
        Detail intake(Intake update) { return new Detail(update, photos, rounds, finding, issue, resumeStatus, checks, workLog, feedback, attempts, demo, procedure); }
        Detail photos(List<Photo> update) { return new Detail(intake, update, rounds, finding, issue, resumeStatus, checks, workLog, feedback, attempts, demo, procedure); }
        Detail rounds(List<Round> update) { return new Detail(intake, photos, update, finding, issue, resumeStatus, checks, workLog, feedback, attempts, demo, procedure); }
        Detail result(Finding update, String reason) { return new Detail(intake, photos, rounds, update, reason, resumeStatus, checks, workLog, feedback, attempts, demo, procedure); }
        Detail paused(Status previous) { return new Detail(intake, photos, rounds, finding, issue, previous, checks, workLog, feedback, attempts, demo, procedure); }
        Detail checks(Map<String, Check> update) { return new Detail(intake, photos, rounds, finding, issue, resumeStatus, update, workLog, feedback, attempts, demo, procedure); }
        Detail workLog(WorkLogEntry update) { return new Detail(intake, photos, rounds, finding, issue, resumeStatus, checks, update, feedback, attempts, demo, procedure); }
        Detail closed(Feedback update) { return new Detail(intake, photos, rounds, finding, issue, resumeStatus, checks, workLog, update, attempts, demo, procedure); }
        Detail procedure(ProcedureRef update) { return new Detail(intake, photos, rounds, finding, issue, resumeStatus, checks, workLog, feedback, attempts, demo, update); }

        List<Round> currentRounds() {
            int start = attempts.isEmpty() ? 0 : attempts.getLast().throughRound();
            return rounds.subList(start, rounds.size());
        }

        boolean assistanceShown() {
            return finding != null || "insufficientEvidence".equals(issue)
                    || rounds.stream().anyMatch(round -> !round.followUpIntake())
                    || attempts.stream().anyMatch(attempt -> attempt.finding() != null
                        || "insufficientEvidence".equals(attempt.issue()));
        }

        Detail continueDiagnosis(List<Question> questions, Instant now) {
            var history = new ArrayList<>(attempts);
            history.add(new RepairAttempt(workLog, finding, issue, checks, rounds.size(), now));
            var nextRounds = new ArrayList<>(rounds);
            nextRounds.add(new Round(rounds.size() + 1, questions, Map.of(), false, true));
            return new Detail(intake, photos, List.copyOf(nextRounds), null, null, null,
                    Map.of(), null, null, history, demo, procedure);
        }

        Detail continueChatDiagnosis(Instant now) {
            var history = new ArrayList<>(attempts);
            history.add(new RepairAttempt(workLog, finding, issue, checks, rounds.size(), now));
            return new Detail(intake, photos, rounds, null, null, null, Map.of(), null, null,
                    history, demo, procedure);
        }
    }
    record View(UUID id, String jobReference, String category, Status status, long version,
                Instant createdAt, Instant updatedAt, UUID technicianId, UUID createdBy,
                UUID parentCaseId, Instant archivedAt, ApplianceSummary appliance, ReturnSummary returnVisit,
                List<ReturnSummary> returnHistory, List<HistoryEntry> applianceHistory,
                List<Assignment> assignments, List<Activity> timeline,
                Detail details, List<Checklist> checklist) {}
    record Summary(UUID id, String jobReference, String category, Status status, String symptoms,
                   String brand, String model, String serialNumber, Instant updatedAt, boolean demo,
                   UUID technicianId, UUID parentCaseId, LocalDate dueBack) {}
    record ProcedureCitation(String title, String revision, String page, String url, boolean synthetic) {}
    record ProcedureRef(String id, int revision, String model, String complaint, boolean synthetic,
                        boolean reviewed, String reviewer, String reviewedAt,
                        ProcedureCitation source, String applicabilityNote) {}
    record PilotProcedureReport(String procedureId, int revision, String model, String reviewer, String reviewedAt,
                                long closedCases, long comparableCauses, long matchingCauses,
                                long performedFirstVerifications, long passedFirstVerifications,
                                long unknownConfirmedCauses, long inconclusiveCases) {}
    private static String canonicalDecimal(String value) {
        return value == null ? null : value.replace(',', '.');
    }
}
