package com.superfix.repair;

import jakarta.persistence.*;
import lombok.Getter;

@Getter
@Entity
@Table(name = "categories")
class Category {
    @Id String code;
    String label;
    boolean active;
    int sortOrder;
}
