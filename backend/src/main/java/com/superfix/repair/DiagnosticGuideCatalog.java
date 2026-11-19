package com.superfix.repair;

import static com.superfix.repair.RepairData.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.text.Normalizer;
import java.util.*;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.stereotype.Component;

@Component
class DiagnosticGuideCatalog {
    record Guide(String category, ProcedureRef procedure, List<String> modelAliases,
                 List<Question> questions, List<Question> followUpQuestions,
                 List<GuideBranch> branches, GuideBranch fallback) {
        Guide {
            category = category == null ? "refrigerator" : category;
            modelAliases = modelAliases == null ? List.of() : List.copyOf(modelAliases);
            questions = questions == null ? List.of() : List.copyOf(questions);
            followUpQuestions = followUpQuestions == null ? List.of() : List.copyOf(followUpQuestions);
            branches = branches == null ? List.of() : List.copyOf(branches);
        }
    }

    record GuideBranch(Map<String, List<String>> whenAnswers, String causeCode, String cause,
                       List<String> evidence, String limitation, List<String> steps, String translationKey) {
        GuideBranch {
            var conditions = new LinkedHashMap<String, List<String>>();
            if (whenAnswers != null) whenAnswers.forEach((id, values) -> conditions.put(id,
                    values == null ? List.of() : List.copyOf(values)));
            whenAnswers = Collections.unmodifiableMap(conditions);
            evidence = evidence == null ? List.of() : List.copyOf(evidence);
            steps = steps == null ? List.of() : List.copyOf(steps);
        }
    }

    private record GuideKey(String id, int revision) {}

    private final Map<GuideKey, Guide> guides;

    DiagnosticGuideCatalog(ObjectMapper json) throws IOException {
        var loaded = new LinkedHashMap<GuideKey, Guide>();
        Resource[] resources = new PathMatchingResourcePatternResolver()
                .getResources("classpath*:diagnostic-guides/*.json");
        Arrays.sort(resources, Comparator.comparing(Resource::getFilename));
        for (Resource resource : resources) {
            Guide guide;
            try (var input = resource.getInputStream()) {
                guide = json.readValue(input, Guide.class);
            }
            validate(guide, resource.getFilename());
            var key = new GuideKey(guide.procedure().id(), guide.procedure().revision());
            if (loaded.putIfAbsent(key, guide) != null) {
                throw new IllegalStateException("Duplicate diagnostic guide " + key);
            }
        }
        guides = Map.copyOf(loaded);
    }

    Guide select(Intake intake, boolean demo) {
        if (intake == null || !Boolean.TRUE.equals(intake.modelConfirmed())) return null;
        String model = normalize(intake.model());
        return guides.values().stream()
                .filter(guide -> guide.category().equals(intake.category()))
                .filter(guide -> guide.procedure().complaint().equals(intake.diagnosticTopic()))
                .filter(guide -> allowed(guide, demo))
                .filter(guide -> guide.modelAliases().stream().map(DiagnosticGuideCatalog::normalize).anyMatch(model::equals))
                .max(Comparator.comparingInt(guide -> guide.procedure().revision())).orElse(null);
    }

    Guide find(ProcedureRef reference, boolean demo) {
        if (reference == null) return null;
        Guide guide = guides.get(new GuideKey(reference.id(), reference.revision()));
        return guide != null && guide.procedure().equals(reference) && allowed(guide, demo) ? guide : null;
    }

    private boolean allowed(Guide guide, boolean demo) {
        return demo || (!guide.procedure().synthetic() && guide.procedure().reviewed());
    }

    private static String normalize(String model) {
        return model == null ? "" : Normalizer.normalize(model.strip(), Normalizer.Form.NFC).toUpperCase(Locale.ROOT);
    }

    private static void validate(Guide guide, String filename) {
        if (guide == null || guide.procedure() == null) invalid(filename, "missing procedure metadata");
        var procedure = guide.procedure();
        if (blank(guide.category()) || blank(procedure.id()) || procedure.revision() < 1 ||
                blank(procedure.model()) || blank(procedure.complaint())) invalid(filename, "incomplete procedure identity");
        if (guide.modelAliases().isEmpty() || guide.modelAliases().stream().anyMatch(DiagnosticGuideCatalog::blank) ||
                guide.modelAliases().stream().map(DiagnosticGuideCatalog::normalize).distinct().count() != guide.modelAliases().size() ||
                !guide.modelAliases().stream().map(DiagnosticGuideCatalog::normalize)
                        .anyMatch(normalize(procedure.model())::equals)) invalid(filename, "invalid model aliases");
        if (guide.questions().isEmpty()) invalid(filename, "no intake questions");
        if (procedure.synthetic() && procedure.reviewed()) invalid(filename, "synthetic procedure cannot be reviewed");
        if (!procedure.synthetic()) {
            var source = procedure.source();
            if (blank(procedure.applicabilityNote()) || source == null || source.synthetic() || blank(source.title()) || blank(source.revision()) ||
                    blank(source.page()) || source.url() == null || !source.url().startsWith("https://")) {
                invalid(filename, "manufacturer source and applicability metadata are required");
            }
        }
        if (procedure.reviewed() && (procedure.synthetic() || blank(procedure.reviewer()) ||
                blank(procedure.reviewedAt()) || procedure.source() == null)) invalid(filename, "review metadata is incomplete");

        var questions = new LinkedHashMap<String, Question>();
        for (Question question : concat(guide.questions(), guide.followUpQuestions())) {
            if (question == null || blank(question.id()) || blank(question.label()) || question.type() == null ||
                    questions.putIfAbsent(question.id(), question) != null) invalid(filename, "invalid or duplicate question");
            if (question.type() == Type.CHOICE && (question.choices() == null || question.choices().isEmpty())) {
                invalid(filename, "choice question has no choices");
            }
        }
        for (GuideBranch branch : concat(guide.branches(), guide.fallback() == null ? List.of() : List.of(guide.fallback()))) {
            if (branch == null || blank(branch.translationKey()) || blank(branch.causeCode()) || blank(branch.cause()) || blank(branch.limitation()) ||
                    branch.evidence().isEmpty() || branch.steps().isEmpty()) invalid(filename, "incomplete outcome branch");
            for (var condition : branch.whenAnswers().entrySet()) {
                var question = questions.get(condition.getKey());
                if (question == null || question.type() != Type.CHOICE || condition.getValue().isEmpty() ||
                        !question.choices().containsAll(condition.getValue())) invalid(filename, "branch has invalid answer condition");
            }
            if (!questions.keySet().containsAll(branch.evidence())) invalid(filename, "branch cites an unknown question");
        }
        for (GuideBranch branch : guide.branches()) {
            if (branch.whenAnswers().isEmpty()) invalid(filename, "match branch has no condition");
        }
    }

    private static <T> List<T> concat(List<T> first, List<T> second) {
        var combined = new ArrayList<T>(first);
        combined.addAll(second);
        return combined;
    }

    private static boolean blank(String value) { return value == null || value.isBlank(); }

    private static void invalid(String filename, String reason) {
        throw new IllegalStateException("Invalid diagnostic guide " + filename + ": " + reason);
    }
}
