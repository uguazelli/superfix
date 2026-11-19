package com.superfix.repair;

import java.time.LocalDate;
import java.util.*;
import org.springframework.data.domain.*;
import org.springframework.data.jpa.repository.*;

interface RepairReturnRepository extends JpaRepository<RepairReturn, UUID> {
    Optional<RepairReturn> findFirstByCaseIdAndStatusIn(UUID caseId, Collection<RepairReturn.State> states);
    Optional<RepairReturn> findByCaseIdAndCompanyIdAndClientKey(UUID caseId, UUID companyId, UUID clientKey);
    List<RepairReturn> findByCaseIdAndCompanyIdOrderByCreatedAtDesc(UUID caseId, UUID companyId);
    @Query(value = """
            select v from RepairReturn v join RepairCase r on r.id = v.caseId and r.companyId = v.companyId
            where v.companyId = :company and (:ownerOnly = false or r.technicianId = :actor)
              and v.status = :status and v.scheduledFor between :from and :through
            order by case when v.scheduledFor < :today then 0 when v.scheduledFor = :today then 1 else 2 end,
                     case when v.scheduledFor < :today then v.scheduledFor end desc,
                     v.scheduledFor asc
            """,
            countQuery = """
            select count(v) from RepairReturn v join RepairCase r on r.id = v.caseId and r.companyId = v.companyId
            where v.companyId = :company and (:ownerOnly = false or r.technicianId = :actor)
              and v.status = :status and v.scheduledFor between :from and :through and :today is not null
            """)
    Page<RepairReturn> due(UUID company, UUID actor, boolean ownerOnly, RepairReturn.State status,
                           LocalDate from, LocalDate through, LocalDate today, Pageable pageable);
}
