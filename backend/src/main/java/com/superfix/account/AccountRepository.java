package com.superfix.account;

import java.util.*;
import org.springframework.data.domain.*;
import org.springframework.data.jpa.repository.JpaRepository;

interface AccountRepository extends JpaRepository<Account, UUID> {
    Optional<Account> findByEmail(String email);
    Page<Account> findByCompanyId(UUID companyId, Pageable page);
    List<Account> findByCompanyIdAndActiveTrueOrderByName(UUID companyId);
    long countByCompanyIdAndActiveTrue(UUID companyId);
    boolean existsByRole(Role role);
}
