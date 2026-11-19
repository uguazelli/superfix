package com.superfix.repair;

import static com.superfix.config.ApiError.forbidden;
import static com.superfix.repair.RepairData.PilotProcedureReport;

import com.superfix.account.AccountDto.User;
import com.superfix.account.Role;
import java.util.*;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Aggregates outcomes from closed, reviewed procedures. */
@Service
@RequiredArgsConstructor
class PilotOutcomeService {
    private final JdbcTemplate jdbc;

    List<PilotProcedureReport> pilotOutcomes(User user) {
        if (user.role() != Role.COMPANY_ADMIN) throw forbidden("forbidden");
        record PilotCase(String id, int revision, String model, String reviewer, String reviewedAt,
                         String suggested, String confirmed, String firstVerification, boolean inconclusive) {}
        class Totals {
            String model;
            String reviewer;
            String reviewedAt;
            long closedCases;
            long comparableCauses;
            long matchingCauses;
            long performedFirstVerifications;
            long passedFirstVerifications;
            long unknownConfirmedCauses;
            long inconclusiveCases;
        }
        var cases = jdbc.query("""
                select details->'procedure'->>'id' as procedure_id,
                       coalesce(details->'procedure'->>'revision', '0')::integer as revision,
                       details->'procedure'->>'model' as model,
                       details->'procedure'->>'reviewer' as reviewer,
                       details->'procedure'->>'reviewedAt' as reviewed_at,
                       case when jsonb_array_length(coalesce(details->'attempts', '[]'::jsonb)) > 0
                         then details->'attempts'->0->'finding'->>'causeCode'
                         else details->'finding'->>'causeCode' end as suggested,
                       details->'workLog'->'log'->>'confirmedCauseCode' as confirmed,
                       case when jsonb_array_length(coalesce(details->'attempts', '[]'::jsonb)) > 0
                         then details->'attempts'->0->'workLog'->'log'->'verification'->>'result'
                         else details->'workLog'->'log'->'verification'->>'result' end as first_verification,
                       (details->>'issue' = 'insufficientEvidence' or exists (
                         select 1 from jsonb_array_elements(coalesce(details->'attempts', '[]'::jsonb)) as attempt(value)
                         where attempt.value->>'issue' = 'insufficientEvidence')) as inconclusive
                from repair_cases
                where company_id = ? and status = 'CLOSED'
                  and details->>'demo' is distinct from 'true'
                  and details->'procedure'->>'synthetic' is distinct from 'true'
                  and details->'procedure'->>'reviewed' = 'true'
                  and details->'procedure'->>'id' is not null
                """, (row, index) -> new PilotCase(row.getString("procedure_id"), row.getInt("revision"),
                row.getString("model"), row.getString("reviewer"), row.getString("reviewed_at"),
                row.getString("suggested"), row.getString("confirmed"), row.getString("first_verification"),
                row.getBoolean("inconclusive")), user.companyId());
        var totals = new TreeMap<String, Totals>();
        var identities = new HashMap<String, String[]>();
        for (PilotCase item : cases) {
            String key = item.id() + ":" + item.revision();
            var total = totals.computeIfAbsent(key, ignored -> new Totals());
            total.model = item.model();
            total.reviewer = item.reviewer();
            total.reviewedAt = item.reviewedAt();
            total.closedCases++;
            if (blank(item.confirmed())) total.unknownConfirmedCauses++;
            if (!blank(item.confirmed()) && !blank(item.suggested())) {
                total.comparableCauses++;
                if (item.confirmed().equals(item.suggested())) total.matchingCauses++;
            }
            if ("PASSED".equals(item.firstVerification()) || "FAILED".equals(item.firstVerification())) {
                total.performedFirstVerifications++;
                if ("PASSED".equals(item.firstVerification())) total.passedFirstVerifications++;
            }
            if (item.inconclusive()) total.inconclusiveCases++;
            identities.put(key, new String[]{item.id(), Integer.toString(item.revision())});
        }
        return totals.entrySet().stream().map(entry -> {
            String[] identity = identities.get(entry.getKey());
            Totals total = entry.getValue();
            return new PilotProcedureReport(identity[0], Integer.parseInt(identity[1]), total.model, total.reviewer,
                    total.reviewedAt, total.closedCases, total.comparableCauses, total.matchingCauses,
                    total.performedFirstVerifications, total.passedFirstVerifications,
                    total.unknownConfirmedCauses, total.inconclusiveCases);
        }).toList();
    }

    private boolean blank(String value) {
        return value == null || value.isBlank();
    }
}
