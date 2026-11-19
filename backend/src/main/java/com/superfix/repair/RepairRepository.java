package com.superfix.repair;

import static com.superfix.repair.RepairData.Status;
import jakarta.persistence.LockModeType;
import java.util.*;
import org.springframework.data.domain.*;
import org.springframework.data.jpa.repository.*;

interface RepairRepository extends JpaRepository<RepairCase, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from RepairCase r where r.id = :id")
    Optional<RepairCase> lock(UUID id);

    Optional<RepairCase> findByCompanyIdAndClientKey(UUID companyId, UUID clientKey);

    @Query("""
            select r from RepairCase r
            where r.companyId = :company
              and (:ownerOnly = false or r.technicianId = :actor)
              and ((:archived = true and r.archivedAt is not null) or (:archived = false and r.archivedAt is null))
              and (:category is null or r.categoryCode = :category)
              and (:status is null or r.status = :status)
              and (:search is null or lower(r.jobReference) like lower(concat('%', :search, '%'))
                   or r.applianceSerialKey = lower(:search))
            """)
    Page<RepairCase> search(UUID company, UUID actor, boolean ownerOnly, boolean archived, String category,
                           Status status, String search, Pageable pageable);

    Page<RepairCase> findByCompanyIdAndApplianceIdOrderByCreatedAtDesc(UUID companyId, UUID applianceId, Pageable pageable);
    boolean existsByParentCaseIdAndCompanyId(UUID parentCaseId, UUID companyId);
}
