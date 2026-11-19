package com.superfix.repair;

import jakarta.persistence.*;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Entity
@Table(name = "repair_returns")
@Getter
@NoArgsConstructor
class RepairReturn {
    enum State { SCHEDULED, STARTED, COMPLETED, CANCELLED }

    @Id UUID id = UUID.randomUUID();
    UUID caseId;
    UUID companyId;
    UUID clientKey;
    LocalDate scheduledFor;
    @Enumerated(EnumType.STRING) State status = State.SCHEDULED;
    String reason;
    String nextAction;
    UUID createdBy;
    Instant createdAt = Instant.now();
    Instant startedAt;
    Instant completedAt;
}
