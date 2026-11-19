package com.superfix.account;

import jakarta.persistence.*;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Entity
@Table(name = "companies")
@Getter
@NoArgsConstructor
class Company {
    @Id UUID id = UUID.randomUUID();
    String name;
    UUID planId;
    boolean active = true;
}
