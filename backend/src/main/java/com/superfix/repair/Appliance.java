package com.superfix.repair;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Entity
@Table(name = "appliances")
@Getter
@NoArgsConstructor
class Appliance {
    @Id UUID id = UUID.randomUUID();
    UUID companyId;
    String categoryCode;
    String brand;
    String model;
    String serialNumber;
    String brandKey;
    String modelKey;
    String serialKey;
    UUID createdBy;
    Instant createdAt = Instant.now();
}
