package com.superfix.repair;

import static com.superfix.repair.RepairData.*;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Validated request bodies accepted by the repair API. */
final class RepairRequests {
    private RepairRequests() {}

    record Close(@NotNull Outcome outcome, @NotNull Rating rating, @Size(max = 2000) String feedback) {}

    record SaveWorkLog(@Min(0) long version, @NotNull @Valid WorkLog log) {}

    record Submit(@NotNull UUID key, @Min(0) long version,
                  @Size(max = 8) Map<String, @NotNull @Valid Answer> answers) {}

    record Draft(@Min(0) long version, @NotNull @Size(max = 8) Map<String, @NotNull @Valid Answer> answers) {}

    record Change(@Min(0) long version, Decision decision) {}

    record Archive(@Min(0) long version) {}

    record Assign(@Min(0) long version, @NotNull UUID technicianId, @Size(max = 1000) String note) {}

    record CreateReturn(@Min(0) long version, @NotNull java.time.LocalDate scheduledFor,
                        @NotNull java.time.LocalDate clientDate, @NotBlank @Size(max = 1000) String reason,
                        @NotBlank @Size(max = 1000) String nextAction, @NotNull @Size(max = 20) List<@NotNull @Valid Part> parts) {}

    record UpdateReturn(@Min(0) long version, @NotBlank String status, @NotNull java.time.LocalDate clientDate,
                        java.time.LocalDate scheduledFor,
                        @Size(max = 1000) String reason, @Size(max = 1000) String nextAction) {}

    record PartStatus(@Min(0) long version, @NotBlank String status) {}

    record Callback(@NotBlank @Size(max = 4000) String symptoms, @NotNull Boolean hazard,
                    Fuel fuel) {}

    record ConfirmAppliance(@Min(0) long version, @Size(max = 120) String brand,
                            @NotBlank @Size(max = 120) String model, @Size(max = 120) String serialNumber,
                            @NotNull @jakarta.validation.constraints.AssertTrue Boolean confirmed) {}

    record Checks(@Min(0) long version, @NotNull @Size(max = 10) Map<String, @NotNull @Valid Check> checks) {}
}
