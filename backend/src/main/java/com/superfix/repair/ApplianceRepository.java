package com.superfix.repair;

import java.util.*;
import org.springframework.data.jpa.repository.JpaRepository;

interface ApplianceRepository extends JpaRepository<Appliance, UUID> {
    Optional<Appliance> findByIdAndCompanyId(UUID id, UUID companyId);
    Optional<Appliance> findFirstByCompanyIdAndCategoryCodeAndBrandKeyAndModelKeyAndSerialKey(
            UUID companyId, String categoryCode, String brandKey, String modelKey, String serialKey);
}
