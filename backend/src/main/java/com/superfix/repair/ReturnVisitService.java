package com.superfix.repair;

import static com.superfix.config.ApiError.*;
import static com.superfix.repair.RepairData.*;
import static com.superfix.repair.RepairRequests.*;

import com.superfix.account.AccountDto.User;
import com.superfix.account.Role;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Scheduling and updating follow-up visits for a repair. */
@Service
@RequiredArgsConstructor
class ReturnVisitService {
    private final RepairService repairService;
    private final RepairReturnRepository returns;
    private final JdbcTemplate jdbc;

    @Transactional
    public View scheduleReturn(User user, UUID id, CreateReturn input, UUID clientKey) {
        var repair = repairService.writable(user, id);
        var existing = returns.findByCaseIdAndCompanyIdAndClientKey(id, user.companyId(), clientKey);
        if (existing.isPresent()) return repairService.view(user, repair);
        repairService.requireVersion(repair, input.version());
        if (repair.status == Status.PAUSED) {
            if (repair.details.resumeStatus() == null) throw conflict("invalidCaseState");
        } else {
            repairService.requireStatus(repair, Status.CHECKLIST);
            repair.details = repair.details.paused(repair.status);
            repair.status = Status.PAUSED;
        }
        repairService.validateClientDate(input.clientDate());
        if (input.scheduledFor().isBefore(input.clientDate())) throw bad("returnDatePast");
        if (returns.findFirstByCaseIdAndStatusIn(repair.id, List.of(RepairReturn.State.SCHEDULED, RepairReturn.State.STARTED)).isPresent()) {
            throw conflict("returnAlreadyScheduled");
        }
        var visit = new RepairReturn();
        visit.caseId = repair.id;
        visit.companyId = repair.companyId;
        visit.clientKey = clientKey;
        visit.scheduledFor = input.scheduledFor();
        visit.reason = input.reason().strip();
        visit.nextAction = input.nextAction().strip();
        visit.createdBy = user.id();
        returns.saveAndFlush(visit);
        for (Part part : input.parts()) {
            jdbc.update("""
                    insert into repair_return_parts(id, return_id, company_id, name, part_number, quantity, status)
                    values (?, ?, ?, ?, ?, ?, 'REQUESTED')
                    """, UUID.randomUUID(), visit.id, repair.companyId, part.name().strip(),
                    blank(part.partNumber()) ? null : part.partNumber().strip(), part.quantity());
        }
        repairService.audit(user, repair, "RETURN_SCHEDULED");
        return repairService.save(repair, user);
    }

    @Transactional
    public View updateReturn(User user, UUID id, UUID returnId, UpdateReturn input) {
        var repair = repairService.writable(user, id);
        if (repair.archivedAt != null) throw conflict("archivedReadOnly");
        repairService.requireVersion(repair, input.version());
        var visit = returns.findById(returnId).filter(found -> found.caseId.equals(id)
                && found.companyId.equals(user.companyId())).orElseThrow(() -> missing());
        String event;
        switch (input.status()) {
            case "SCHEDULED" -> {
                if (visit.status != RepairReturn.State.SCHEDULED) throw conflict("invalidReturnState");
                repairService.validateClientDate(input.clientDate());
                if (input.scheduledFor() == null || input.scheduledFor().isBefore(input.clientDate())) throw bad("returnDatePast");
                visit.scheduledFor = input.scheduledFor();
                if (!blank(input.reason())) visit.reason = input.reason().strip();
                if (!blank(input.nextAction())) visit.nextAction = input.nextAction().strip();
                event = "RETURN_RESCHEDULED";
            }
            case "CANCELLED" -> {
                if (visit.status != RepairReturn.State.SCHEDULED) throw conflict("invalidReturnState");
                visit.status = RepairReturn.State.CANCELLED;
                event = "RETURN_CANCELLED";
            }
            case "COMPLETED" -> {
                if (visit.status != RepairReturn.State.STARTED) throw conflict("invalidReturnState");
                visit.status = RepairReturn.State.COMPLETED;
                visit.completedAt = Instant.now();
                event = "RETURN_COMPLETED";
            }
            default -> throw bad("invalidReturnState");
        }
        repairService.audit(user, repair, event);
        return repairService.save(repair, user);
    }

    @Transactional
    public View updateReturnPart(User user, UUID caseId, UUID returnId, UUID partId, PartStatus input) {
        var repair = repairService.writable(user, caseId);
        if (repair.archivedAt != null) throw conflict("archivedReadOnly");
        repairService.requireVersion(repair, input.version());
        var visit = returns.findById(returnId).filter(found -> found.caseId.equals(caseId)
                && found.companyId.equals(user.companyId())
                && found.status == RepairReturn.State.SCHEDULED).orElseThrow(() -> missing());
        if (!Set.of("REQUESTED", "RECEIVED", "CANCELLED").contains(input.status())) throw bad("invalidPartStatus");
        int updated = jdbc.update("""
                update repair_return_parts set status = ?
                where id = ? and return_id = ? and company_id = ?
                """, input.status(), partId, visit.id, user.companyId());
        if (updated != 1) throw missing();
        repairService.audit(user, repair, "RETURN_PART_" + input.status());
        return repairService.save(repair, user);
    }

    Page<ReturnSummary> dueBack(User user, LocalDate from, LocalDate through, LocalDate today, int page) {
        repairService.validateClientDate(today);
        if (from.isAfter(through) || from.isBefore(LocalDate.of(1970, 1, 1))
                || through.isAfter(LocalDate.now().plusDays(92))) throw bad("invalidDateRange");
        var pageable = PageRequest.of(Math.max(0, page), 20);
        return returns.due(user.companyId(), user.id(), user.role() == Role.TECHNICIAN,
                RepairReturn.State.SCHEDULED, from, through, today, pageable).map(repairService::returnSummary);
    }

    private boolean blank(String value) {
        return value == null || value.isBlank();
    }
}
