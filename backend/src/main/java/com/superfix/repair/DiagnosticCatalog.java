package com.superfix.repair;

import static com.superfix.repair.RepairData.Question;
import static com.superfix.repair.RepairData.Type;

import java.util.List;
import java.util.Map;

/** Fixed questions and result text shared by demo and provider diagnostics. */
final class DiagnosticCatalog {
    private DiagnosticCatalog() {}

    static final List<Question> FOLLOW_UP_QUESTIONS = List.of(
            question("followUpSameConditions",
                    "Did the original symptom return under the same conditions?",
                    Type.YES_NO, null, List.of()),
            question("followUpObservation",
                    "What changed or persisted after this repair attempt?",
                    Type.TEXT, null, List.of()));

    static final Map<String, Question> QUESTIONS = Map.of(
            "pattern", question("pattern",
                    "When is the symptom noticeable?",
                    Type.CHOICE, null,
                    List.of("At startup", "During normal operation", "Intermittently", "Continuously")),
            "display", question("display",
                    "What error code or indicator is already visible on the display?",
                    Type.TEXT, null, List.of()),
            "recent", question("recent",
                    "Did the symptom start after a change in settings or installation?",
                    Type.YES_NO, null, List.of()),
            "temperature", question("temperature",
                    "Enter an already recorded compartment temperature.",
                    Type.NUMBER, "°C", List.of()),
            "cycle", question("cycle",
                    "How many minutes into the cycle did the symptom first occur?",
                    Type.NUMBER, "min", List.of()),
            "settings", question("settings",
                    "Confirm whether you have compared the current settings with the operator manual.",
                    Type.CONFIRMATION, null, List.of()));

    static final Map<String, String> CAUSES = Map.of(
            "SETTINGS", "The recorded pattern suggests a settings or cycle selection issue.",
            "INSTALLATION", "The recorded pattern suggests an installation or operating condition issue.",
            "CLOSURE", "The recorded pattern suggests a door, lid, or seal issue.",
            "COMPONENT", "The recorded pattern suggests a component fault that needs manufacturer-specific verification.");

    static final Map<String, List<String>> STEPS = Map.of(
            "SETTINGS", List.of(
                    "Compare the recorded settings and selected mode with the operator manual for the exact model.",
                    "Use the documented normal operating settings and record whether the symptom persists."),
            "INSTALLATION", List.of(
                    "Compare the visible installation conditions with the manufacturer’s requirements for this model.",
                    "Document any discrepancy and use the manufacturer’s service procedure for further work."),
            "CLOSURE", List.of(
                    "Compare the visible closure condition with the manufacturer’s instructions for this model.",
                    "Use the model’s service documentation to confirm the cause and the correct repair."),
            "COMPONENT", List.of(
                    "Use the recorded error or symptom to locate the corresponding manufacturer service procedure.",
                    "Confirm the faulty component using that procedure before selecting a repair or ordering parts."));

    private static Question question(String id, String label, Type type, String unit, List<String> choices) {
        return new Question(id, label, type, unit, choices);
    }
}
