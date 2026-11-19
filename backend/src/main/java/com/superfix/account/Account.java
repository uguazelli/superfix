package com.superfix.account;

import jakarta.persistence.*;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Entity
@Table(name = "accounts")
@Getter
@NoArgsConstructor
class Account {
    @Id UUID id = UUID.randomUUID();
    String email;
    String name;
    String passwordHash;
    @Enumerated(EnumType.STRING) Role role;
    UUID companyId;
    String locale;
    boolean active = true;
    boolean mustChangePassword;
}
