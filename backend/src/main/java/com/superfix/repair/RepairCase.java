package com.superfix.repair;

import static com.superfix.repair.RepairData.*;
import jakarta.persistence.*;
import java.time.Instant;
import java.util.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "repair_cases")
class RepairCase {
    @Id UUID id = UUID.randomUUID();
    UUID companyId;
    UUID technicianId;
    UUID createdBy;
    UUID applianceId;
    UUID parentCaseId;
    Instant archivedAt;
    UUID archivedBy;
    UUID clientKey;
    String jobReference;
    String applianceSerialKey;
    String categoryCode;
    String diagnosticMode = "LEGACY";
    @Enumerated(EnumType.STRING) Status status = Status.DRAFT;
    @Version Long version;
    Instant createdAt = Instant.now();
    Instant updatedAt = createdAt;
    @JdbcTypeCode(SqlTypes.JSON) Detail details;

    View view() {
        return new View(id, jobReference, categoryCode, status, version, createdAt, updatedAt, technicianId,
                createdBy, parentCaseId, archivedAt, null, null, List.of(), List.of(), List.of(), List.of(), details, RepairService.CHECKLIST);
    }

}
