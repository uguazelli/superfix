package com.superfix.account;

import jakarta.persistence.*;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Entity
@Table(name = "plans")
@Getter
@NoArgsConstructor
class Plan {
    @Id UUID id = UUID.randomUUID();
    String name;
    int maxUsers;
    Integer monthlyAiLimit;
    boolean active = true;
}
