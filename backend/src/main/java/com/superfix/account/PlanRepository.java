package com.superfix.account;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

interface PlanRepository extends JpaRepository<Plan, UUID> {}
