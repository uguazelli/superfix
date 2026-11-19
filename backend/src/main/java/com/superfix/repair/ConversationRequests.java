package com.superfix.repair;

import jakarta.validation.constraints.*;
import java.util.List;
import java.util.UUID;

/** Validated request bodies for the technician conversation. */
final class ConversationRequests {
    private ConversationRequests() {}

    record Start(@NotNull UUID key, @Min(0) long version) {}

    record Message(@NotNull UUID key, @Min(0) long version,
                   @Size(max = 4000) String text,
                   @NotNull @Size(max = 12) List<@NotNull UUID> photoIds) {}

    record Retry(@NotNull UUID key, @Min(0) long version) {}

    record Handoff(@NotNull UUID key, @Min(0) long version, @Size(max = 4000) String summary,
                   @Size(max = 1000) String possibleCause,
                   @Size(max = 12) List<@NotBlank @Size(max = 500) String> evidence,
                   @Size(max = 12) List<@NotBlank @Size(max = 500) String> unresolved,
                   @Pattern(regexp = "TECHNICIAN|AI_ACCEPTED|UNDETERMINED") String source) {}
}
