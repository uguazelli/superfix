package com.superfix.account;

import jakarta.validation.constraints.*;
import java.util.UUID;

public final class AccountDto {
    static final int MIN_PASSWORD_LENGTH = 8;

    private AccountDto() {}

    public record User(UUID id, String email, String name, Role role, UUID companyId,
                       boolean active, boolean mustChangePassword, String locale) {}
    public record Team(UUID id, String name, UUID planId, boolean active) {}
    public record Tier(UUID id, String name, int maxUsers, Integer monthlyAiLimit, boolean active) {}

    public record NewUser(@NotBlank @Email @Size(max = 254) String email, @NotBlank @Size(max = 120) String name,
                          @NotBlank @Size(min = MIN_PASSWORD_LENGTH, max = 72) String password, @NotNull Role role,
                          UUID companyId) {}
    public record TeamInput(@NotBlank @Size(max = 120) String name, @NotNull UUID planId,
                            @NotNull Boolean active) {}
    public record TierInput(@NotBlank @Size(max = 80) String name, @Min(1) @Max(10000) int maxUsers,
                            @Min(1) Integer monthlyAiLimit) {}
    public record ActiveInput(@NotNull Boolean active) {}
    public record LocaleInput(@NotBlank @Pattern(regexp = "en|pt-BR|es") String locale) {}
    public record NewPassword(@NotBlank String currentPassword, @NotBlank @Size(min = MIN_PASSWORD_LENGTH, max = 72) String password) {}
    public record TemporaryPassword(@NotBlank @Size(min = MIN_PASSWORD_LENGTH, max = 72) String password) {}
}
