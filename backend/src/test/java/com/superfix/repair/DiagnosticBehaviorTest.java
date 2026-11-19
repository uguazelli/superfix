package com.superfix.repair;

import static com.superfix.repair.RepairData.*;
import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class DiagnosticBehaviorTest {
    private final ObjectMapper json = new ObjectMapper().findAndRegisterModules();
    private DiagnosticAi diagnostic;

    @BeforeEach
    void setUp() throws Exception {
        var provider = new DiagnosticProviderClient(json, null, "mock", "", "", "", "", false);
        diagnostic = new DiagnosticAi(provider, new DiagnosticGuideCatalog(json));
    }

    @Test
    void demoAsksInitialQuestionsThenProposesCauseFromSavedEvidence() throws Exception {
        var repair = new RepairCase();
        repair.categoryCode = "refrigerator";
        var intake = new Intake("refrigerator", "warm", "", "", Fuel.UNKNOWN, false, "", false, "");
        repair.details = Detail.initial(intake, true);
        var initial = diagnostic.run("mock", "fixture-1", "pt-BR", repair);
        assertEquals(Status.AWAITING_ANSWERS, initial.status());
        assertEquals(List.of("pattern", "display"), initial.questions().stream().map(Question::id).toList());

        var first = new Round(1, initial.questions(), Map.of(
                "pattern", new Answer(AnswerStatus.ANSWERED, "Continuously", ""),
                "display", new Answer(AnswerStatus.ANSWERED, "E1", "")), true, false);
        repair.details = repair.details.rounds(List.of(first));
        var next = diagnostic.run("mock", "fixture-1", "pt-BR", repair);
        assertEquals(List.of("temperature", "settings"), next.questions().stream().map(Question::id).toList());
        var second = new Round(2, next.questions(), Map.of(
                "temperature", new Answer(AnswerStatus.ANSWERED, "8.5", ""),
                "settings", new Answer(AnswerStatus.ANSWERED, "yes", "")), true, false);
        repair.details = repair.details.rounds(List.of(first, second));
        var result = diagnostic.run("mock", "fixture-1", "pt-BR", repair);
        assertEquals(Status.DIAGNOSIS_PROPOSED, result.status());
        assertEquals("SETTINGS", result.finding().causeCode());
        assertEquals(List.of("pattern", "display", "temperature"), result.finding().evidenceQuestionIds());
    }

    @Test
    void oldFindingJsonWithoutLocalizationFieldsRemainsReadable() throws Exception {
        var finding = json.readValue("""
                {"causeCode":"SETTINGS","cause":"Saved cause","evidence":["Saved fact"],
                 "limitation":"Saved limitation","steps":["Saved step"],"decision":null}
                """, Finding.class);
        assertEquals("Saved cause", finding.cause());
        assertTrue(finding.evidenceQuestionIds().isEmpty());
        assertNull(finding.translationKey());
    }

    @Test
    void providerConfigurationMustMatchQueuedRequest() {
        var repair = new RepairCase();
        assertThrows(IllegalStateException.class, () -> diagnostic.run("openrouter", "old-model", "en", repair));
    }
}
