package com.superfix.account;

import jakarta.persistence.LockModeType;
import java.util.*;
import org.springframework.data.jpa.repository.*;

interface CompanyRepository extends JpaRepository<Company, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from Company c where c.id = :id")
    Optional<Company> lock(UUID id);
}
