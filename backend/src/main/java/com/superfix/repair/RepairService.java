package com.superfix.repair;

import static com.superfix.config.ApiError.*;
import static com.superfix.repair.RepairData.*;
import static com.superfix.repair.RepairRequests.*;

import com.superfix.account.*;
import com.superfix.account.AccountDto.User;
import java.io.IOException;
import java.text.Normalizer;
import java.time.LocalDate;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.Resource;
import org.springframework.data.domain.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

@Service
@RequiredArgsConstructor
class RepairService {
    static final List<Checklist> CHECKLIST = List.of(new Checklist("tools", true),
            new Checklist("workspace", true), new Checklist("appliance", true), new Checklist("handover", false));
    private final RepairRepository repairs;
    private final ApplianceRepository appliances;
    private final RepairReturnRepository returns;
    private final CategoryRepository categories;
    private final AccountService accounts;
    private final DiagnosticAi ai;
    private final DiagnosticGuideCatalog guides;
    private final PhotoStorage photos;
    private final JdbcTemplate jdbc;

    List<Category> categories() { return categories.findAllByActiveTrueOrderBySortOrder(); }

    Page<Summary> list(User user, String category, Status status, String query, boolean archived, int page) {
        // Keep the optional search parameter non-null: PostgreSQL cannot infer
        // its type inside lower(:search) when Hibernate binds a null value.
        String search = query == null || query.isBlank() ? "" : query.strip();
        return repairs.search(user.companyId(), user.id(), user.role() == Role.TECHNICIAN, archived, category, status, search,
                PageRequest.of(Math.max(0, page), 20, Sort.by("updatedAt", "id").descending())).map(repair -> {
                    var intake = repair.details.intake();
                    var appliance = repair.applianceId == null ? null : appliances
                            .findByIdAndCompanyId(repair.applianceId, user.companyId()).orElse(null);
                    var due = returns.findFirstByCaseIdAndStatusIn(repair.id,
                            List.of(RepairReturn.State.SCHEDULED, RepairReturn.State.STARTED)).orElse(null);
                    return new Summary(repair.id, repair.jobReference, repair.categoryCode, repair.status,
                            intake.symptoms(), appliance == null ? intake.brand() : appliance.brand,
                            appliance == null ? intake.model() : appliance.model,
                            appliance == null ? intake.serialNumber() : appliance.serialNumber, repair.updatedAt,
                            repair.details.demo(), repair.technicianId, repair.parentCaseId,
                            due == null ? null : due.scheduledFor);
                });
    }

    @Transactional
    View archive(User user, UUID id, Archive input) {
        var repair = writable(user, id);
        if (repair.status == Status.CLOSED && repair.archivedAt != null) return view(user, repair);
        requireVersion(repair, input.version());
        requireStatus(repair, Status.CLOSED);
        repair.archivedAt = Instant.now();
        repair.archivedBy = user.id();
        audit(user, repair, "CASE_ARCHIVED");
        return save(repair, user);
    }

    @Transactional
    View restore(User user, UUID id, Archive input) {
        var repair = writable(user, id);
        if (repair.status == Status.CLOSED && repair.archivedAt == null) return view(user, repair);
        requireVersion(repair, input.version());
        requireStatus(repair, Status.CLOSED);
        repair.archivedAt = null;
        repair.archivedBy = null;
        audit(user, repair, "CASE_RESTORED");
        return save(repair, user);
    }

    @Transactional
    void deleteArchived(User user, UUID id, long version) {
        var repair = writable(user, id);
        requireVersion(repair, version);
        if (repair.archivedAt == null || repair.status != Status.CLOSED) throw conflict("notArchived");
        if (repairs.existsByParentCaseIdAndCompanyId(repair.id, user.companyId())) throw conflict("caseHasCallbacks");
        UUID applianceId = repair.applianceId;

        jdbc.update("delete from repair_return_parts where company_id = ? and return_id in " +
                "(select id from repair_returns where case_id = ? and company_id = ?)",
                user.companyId(), repair.id, user.companyId());
        jdbc.update("delete from repair_returns where case_id = ? and company_id = ?", repair.id, user.companyId());
        jdbc.update("delete from repair_photo_uploads where case_id = ? and company_id = ?", repair.id, user.companyId());
        jdbc.update("delete from ai_requests where case_id = ? and company_id = ?", repair.id, user.companyId());
        jdbc.update("delete from repair_assignments where case_id = ? and company_id = ?", repair.id, user.companyId());
        jdbc.update("delete from audit_events where subject_id = ? and company_id = ?", repair.id, user.companyId());
        photos.deleteCaseAfterCommit(repair.id);
        repairs.delete(repair);
        repairs.flush();
        if (applianceId != null) {
            jdbc.update("""
                    delete from appliances a where a.id = ? and a.company_id = ?
                      and not exists (select 1 from repair_cases c where c.appliance_id = a.id and c.company_id = a.company_id)
                    """, applianceId, user.companyId());
        }
    }

    View view(User user, UUID id) { return view(user, visible(user, repairs.findById(id))); }

    @Transactional
    public View create(User user, Intake input, UUID clientKey) {
        lockIdempotencyKey("case", user.companyId(), clientKey);
        var existing = repairs.findByCompanyIdAndClientKey(user.companyId(), clientKey);
        if (existing.isPresent()) return view(user, visible(user, existing));
        Intake intake = normalizedIntake(input);
        validateModel(intake);
        var repair = new RepairCase();
        repair.companyId = user.companyId();
        repair.technicianId = user.id();
        repair.createdBy = user.id();
        repair.clientKey = clientKey;
        repair.jobReference = nextJobReference();
        repair.diagnosticMode = "CHAT";
        repair.categoryCode = intake.category();
        repair.details = Detail.initial(intake, ai.mode().equals("mock"));
        var guide = guides.select(intake, ai.mode().equals("mock"));
        if (guide != null) repair.details = repair.details.procedure(guide.procedure());
        repair.applianceId = resolveAppliance(user, repair, intake);
        repair.applianceSerialKey = serialKey(intake.serialNumber());
        repairs.saveAndFlush(repair);
        audit(user, repair, "CASE_CREATED");
        return view(user, repair);
    }

    @Transactional
    public View edit(User user, UUID id, long version, Intake input) {
        var repair = writable(user, id);
        requireVersion(repair, version);
        requireStatus(repair, Status.DRAFT, Status.DIAGNOSING, Status.CHECKLIST);
        Intake intake = normalizedIntake(input);
        boolean identityChanged = !Objects.equals(repair.categoryCode, intake.category())
                || !Objects.equals(repair.details.intake().brand(), intake.brand())
                || !Objects.equals(repair.details.intake().model(), intake.model())
                || !Objects.equals(repair.details.intake().serialNumber(), intake.serialNumber());
        if (identityChanged && Boolean.TRUE.equals(intake.modelConfirmed())) {
            intake = new Intake(intake.category(), intake.symptoms(), intake.brand(), intake.model(), intake.fuel(),
                    intake.hazard(), intake.serialNumber(), false, intake.diagnosticTopic());
        }
        validateModel(intake);
        repair.categoryCode = intake.category();
        repair.details = repair.details.intake(intake);
        var guide = guides.select(intake, repair.details.demo());
        repair.details = repair.details.procedure(guide == null ? null : guide.procedure());
        if (identityChanged) repair.applianceId = null;
        repair.applianceId = resolveAppliance(user, repair, intake);
        repair.applianceSerialKey = serialKey(intake.serialNumber());
        return save(repair, user);
    }

    @Transactional
    public View callback(User user, UUID parentId, Callback input, UUID clientKey) {
        var parent = visible(user, repairs.lock(parentId));
        requireStatus(parent, Status.CLOSED);
        if (parent.archivedAt != null) throw conflict("archivedReadOnly");
        var existing = repairs.findByCompanyIdAndClientKey(user.companyId(), clientKey);
        if (existing.isPresent()) {
            var prior = visible(user, existing);
            if (!parent.id.equals(prior.parentCaseId)) throw conflict("idempotencyKeyReuse");
            return view(user, prior);
        }
        var source = parent.details.intake();
        var intake = new Intake(parent.categoryCode, input.symptoms().strip(), source.brand(), source.model(),
                input.fuel() == null ? source.fuel() : input.fuel(), input.hazard(), source.serialNumber(),
                source.modelConfirmed(), source.diagnosticTopic());
        var repair = new RepairCase();
        repair.companyId = user.companyId();
        repair.technicianId = user.id();
        repair.createdBy = user.id();
        repair.clientKey = clientKey;
        repair.jobReference = nextJobReference();
        repair.categoryCode = parent.categoryCode;
        repair.parentCaseId = parent.id;
        repair.applianceId = parent.applianceId;
        repair.applianceSerialKey = parent.applianceSerialKey;
        repair.details = Detail.initial(intake, ai.mode().equals("mock"));
        repairs.saveAndFlush(repair);
        audit(user, repair, "CALLBACK_CREATED");
        return view(user, repair);
    }

    @Transactional
    public View assign(User user, UUID id, Assign input) {
        if (user.role() != Role.COMPANY_ADMIN) throw forbidden("forbidden");
        var repair = writable(user, id);
        requireVersion(repair, input.version());
        requireStatus(repair, Status.DRAFT, Status.AWAITING_ANSWERS, Status.AI_ERROR, Status.DIAGNOSING,
                Status.DIAGNOSIS_PROPOSED, Status.INCONCLUSIVE, Status.PAUSED, Status.CHECKLIST);
        accounts.requireActiveTechnician(user.companyId(), input.technicianId());
        UUID previous = repair.technicianId;
        repair.technicianId = input.technicianId();
        jdbc.update("""
                insert into repair_assignments
                  (id, case_id, company_id, actor_id, previous_technician_id, technician_id, note, created_at)
                values (?, ?, ?, ?, ?, ?, ?, ?)
                """, UUID.randomUUID(), repair.id, repair.companyId, user.id(), previous, repair.technicianId,
                input.note() == null ? null : input.note().strip(), java.sql.Timestamp.from(Instant.now()));
        audit(user, repair, "CASE_ASSIGNED");
        return save(repair, user);
    }

    @Transactional
    public View confirmAppliance(User user, UUID id, ConfirmAppliance input) {
        if (user.role() != Role.COMPANY_ADMIN) throw forbidden("forbidden");
        var repair = writable(user, id);
        requireVersion(repair, input.version());
        requireStatus(repair, Status.CLOSED);
        if (repair.archivedAt != null) throw conflict("archivedReadOnly");
        repair.applianceId = resolveAppliance(user, repair, input.brand(), input.model(), input.serialNumber());
        repair.applianceSerialKey = serialKey(input.serialNumber());
        audit(user, repair, "HISTORICAL_APPLIANCE_LINKED");
        return save(repair, user);
    }

    List<HistoryEntry> applianceHistory(User user, UUID id) {
        var repair = visible(user, repairs.findById(id));
        return historyForCase(user, repair);
    }

    private List<HistoryEntry> historyForCase(User user, RepairCase repair) {
        if (repair.applianceId != null) return historyFor(user, repair.applianceId);
        if (repair.parentCaseId == null) return List.of(historyEntry(user, repair));
        var parent = repairs.findById(repair.parentCaseId)
                .filter(found -> found.companyId.equals(user.companyId()))
                .filter(found -> user.role() == Role.COMPANY_ADMIN || found.technicianId.equals(user.id()))
                .orElse(null);
        if (parent == null) return List.of(historyEntry(user, repair));
        if (parent.applianceId != null) return historyFor(user, parent.applianceId);
        return List.of(historyEntry(user, parent), historyEntry(user, repair));
    }

    private List<HistoryEntry> historyFor(User user, UUID applianceId) {
        Page<RepairCase> page = repairs.findByCompanyIdAndApplianceIdOrderByCreatedAtDesc(user.companyId(), applianceId,
                PageRequest.of(0, 50, Sort.by("createdAt").descending()));
        return page.getContent().stream().map(repair -> historyEntry(user, repair)).toList();
    }

    private HistoryEntry historyEntry(User user, RepairCase repair) {
        var intake = repair.details.intake();
        var work = repair.details.workLog() == null ? null : repair.details.workLog().log();
        var verification = work == null ? null : work.verification();
        var feedback = repair.details.feedback();
        return new HistoryEntry(repair.id, repair.jobReference, repair.status, intake.symptoms(), repair.createdAt,
                repair.updatedAt, work == null ? null : work.confirmedFault(), feedback == null ? null : feedback.outcome(),
                verification == null ? null : verification.result(), work == null ? List.of() : work.readings(),
                work == null ? List.of() : work.parts(), repair.technicianId, repair.parentCaseId,
                user.role() == Role.COMPANY_ADMIN || repair.technicianId.equals(user.id()));
    }

    View view(User user, RepairCase repair) {
        var appliance = repair.applianceId == null ? null : appliances
                .findByIdAndCompanyId(repair.applianceId, user.companyId())
                .map(found -> new ApplianceSummary(found.id, found.categoryCode, found.brand, found.model, found.serialNumber))
                .orElse(null);
        var returnHistory = returns.findByCaseIdAndCompanyIdOrderByCreatedAtDesc(repair.id, user.companyId()).stream()
                .map(this::returnSummary).toList();
        var activeReturn = returnHistory.stream().filter(visit ->
                visit.status().equals(RepairReturn.State.SCHEDULED.name()) ||
                        visit.status().equals(RepairReturn.State.STARTED.name())).findFirst().orElse(null);
        var history = historyForCase(user, repair);
        var assignments = jdbc.query("""
                select a.technician_id, a.previous_technician_id, a.actor_id, a.note, a.created_at,
                       assigned.name, previous.name, actor.name
                from repair_assignments a
                join accounts assigned on assigned.id = a.technician_id and assigned.company_id = a.company_id
                left join accounts previous on previous.id = a.previous_technician_id and previous.company_id = a.company_id
                join accounts actor on actor.id = a.actor_id and actor.company_id = a.company_id
                where a.case_id = ? and a.company_id = ? order by a.created_at
                """, (row, index) -> new Assignment(row.getObject(1, UUID.class),
                row.getObject(2, UUID.class), row.getObject(3, UUID.class), row.getString(4),
                row.getTimestamp(5).toInstant(), row.getString(6), row.getString(7), row.getString(8)),
                repair.id, user.companyId());
        var timeline = jdbc.query("""
                select e.action, e.actor_id, actor.name, e.created_at from audit_events e
                join accounts actor on actor.id = e.actor_id and actor.company_id = e.company_id
                where e.company_id = ? and e.subject_id = ? order by e.created_at desc limit 100
                """, (row, index) -> new Activity(row.getString(1), row.getObject(2, UUID.class),
                row.getString(3), row.getTimestamp(4).toInstant()), user.companyId(), repair.id);
        return new View(repair.id, repair.jobReference, repair.categoryCode, repair.status, repair.version,
                repair.createdAt, repair.updatedAt, repair.technicianId, repair.createdBy, repair.parentCaseId, repair.archivedAt,
                appliance, activeReturn, returnHistory, history, assignments, timeline,
                repair.details, CHECKLIST);
    }

    ReturnSummary returnSummary(RepairReturn visit) {
        var repair = repairs.findById(visit.caseId).orElseThrow(() -> missing());
        var parts = jdbc.query("""
                select id, name, part_number, quantity, status from repair_return_parts
                where return_id = ? and company_id = ? order by name, id
                """, (row, index) -> new ReturnPart(row.getObject(1, UUID.class), row.getString(2),
                row.getString(3), row.getInt(4), row.getString(5)), visit.id, visit.companyId);
        return new ReturnSummary(visit.id, visit.caseId, repair.jobReference, visit.scheduledFor,
                visit.status.name(), visit.reason, visit.nextAction, visit.startedAt, visit.completedAt, parts);
    }

    private UUID resolveAppliance(User user, RepairCase repair, Intake intake) {
        if (!Boolean.TRUE.equals(intake.modelConfirmed()) || blank(intake.model()) || blank(repair.categoryCode)) return null;
        return resolveAppliance(user, repair, intake.brand(), intake.model(), intake.serialNumber());
    }

    private UUID resolveAppliance(User user, RepairCase repair, String brand, String model, String serialNumber) {
        String brandKey = identityKey(brand);
        String modelKey = identityKey(model);
        String serialKey = identityKey(serialNumber);
        if (!serialKey.isBlank()) {
            UUID id = UUID.randomUUID();
            var inserted = jdbc.query("""
                    insert into appliances(id, company_id, category_code, brand, model, serial_number,
                                           brand_key, model_key, serial_key, created_by, created_at)
                    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    on conflict (company_id, category_code, brand_key, model_key, serial_key)
                      where serial_key is not null do nothing
                    returning id
                    """, (row, index) -> row.getObject(1, UUID.class), id, user.companyId(), repair.categoryCode,
                    blank(brand) ? null : brand.strip(), model.strip(), serialNumber.strip(), brandKey, modelKey,
                    serialKey, user.id(), java.sql.Timestamp.from(Instant.now()));
            if (!inserted.isEmpty()) return inserted.getFirst();
            return appliances.findFirstByCompanyIdAndCategoryCodeAndBrandKeyAndModelKeyAndSerialKey(
                    user.companyId(), repair.categoryCode, brandKey, modelKey, serialKey)
                    .orElseThrow(() -> conflict("dataConflict")).id;
        }
        var appliance = new Appliance();
        appliance.companyId = user.companyId();
        appliance.categoryCode = repair.categoryCode;
        appliance.brand = blank(brand) ? null : brand.strip();
        appliance.model = model.strip();
        appliance.serialNumber = null;
        appliance.brandKey = brandKey;
        appliance.modelKey = modelKey;
        appliance.serialKey = null;
        appliance.createdBy = user.id();
        return appliances.saveAndFlush(appliance).id;
    }

    private void validateModel(Intake intake) {
        if (Boolean.TRUE.equals(intake.modelConfirmed()) && blank(intake.model())) throw bad("confirmedModelRequired");
        if (Boolean.TRUE.equals(intake.modelConfirmed()) && blank(intake.category())) throw bad("confirmedModelRequired");
        if ("refrigerator-warm".equals(intake.diagnosticTopic()) && !"refrigerator".equals(intake.category())) {
            throw bad("invalidDiagnosticTopic");
        }
    }

    private Intake normalizedIntake(Intake input) {
        String category = clean(input.category());
        String symptoms = input.symptoms() == null ? "" : input.symptoms().strip();
        if (category != null) requireCategory(category);
        return new Intake(category, symptoms, clean(input.brand()), clean(input.model()), input.fuel(), input.hazard(),
                clean(input.serialNumber()), input.modelConfirmed(), clean(input.diagnosticTopic()));
    }

    private String clean(String value) { return value == null || value.isBlank() ? null : value.strip(); }

    private String nextJobReference() {
        Long next = jdbc.queryForObject("select nextval('repair_job_reference_seq')", Long.class);
        return String.format(Locale.ROOT, "SF-%08d", next);
    }

    void validateClientDate(LocalDate date) {
        LocalDate serverDate = LocalDate.now();
        if (date.isBefore(serverDate.minusDays(1)) || date.isAfter(serverDate.plusDays(1))) throw bad("invalidDateRange");
    }

    private void lockIdempotencyKey(String kind, UUID companyId, UUID key) {
        jdbc.queryForObject("select pg_advisory_xact_lock(hashtextextended(?, 0)) is null", Boolean.class,
                kind + ":" + companyId + ":" + key);
    }

    private String serialKey(String serialNumber) {
        String key = identityKey(serialNumber);
        return key.isBlank() ? null : key;
    }

    private String identityKey(String value) {
        if (value == null) return "";
        return Normalizer.normalize(value.strip(), Normalizer.Form.NFC).toLowerCase(Locale.ROOT);
    }

    private boolean blank(String text) {
        return text == null || text.isBlank();
    }

    RepairCase writable(User user, UUID id) {
        return visible(user, repairs.lock(id));
    }

    RepairCase visible(User user, Optional<RepairCase> found) {
        return found.filter(repair -> repair.companyId.equals(user.companyId()))
                .filter(repair -> user.role() == Role.COMPANY_ADMIN || repair.technicianId.equals(user.id()))
                .orElseThrow(() -> missing());
    }

    void requireVersion(RepairCase repair, long version) {
        if (repair.version != version) throw conflict("staleCase");
    }

    void requireStatus(RepairCase repair, Status... allowed) {
        if (!Arrays.asList(allowed).contains(repair.status)) throw conflict("invalidCaseState");
    }

    private void requireCategory(String category) {
        if (category == null || categories.findById(category).filter(c -> c.active).isEmpty()) throw bad("invalidCategory");
    }

    View save(RepairCase repair, User user) {
        repair.updatedAt = Instant.now();
        repairs.flush();
        return view(user, repair);
    }

    void audit(User user, RepairCase repair, String action) {
        accounts.audit(user.id(), repair.companyId, repair.id, action);
    }
}
