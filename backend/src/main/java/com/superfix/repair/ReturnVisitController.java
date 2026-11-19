package com.superfix.repair;

import static com.superfix.repair.RepairData.*;
import static com.superfix.repair.RepairRequests.*;
import com.superfix.account.*;
import jakarta.validation.Valid;
import java.io.IOException;
import java.security.Principal;
import java.time.LocalDate;
import java.util.*;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.Resource;
import org.springframework.data.domain.Page;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
class ReturnVisitController {
    private final AccountService accounts;
    private final ReturnVisitService service;

    @PostMapping("/cases/{id}/returns")
    View returnVisit(Principal principal, @PathVariable UUID id,
                     @RequestHeader(name = "Idempotency-Key", required = false) UUID clientKey,
                     @Valid @RequestBody CreateReturn input) {
        return service.scheduleReturn(actor(principal), id, input, clientKey == null ? UUID.randomUUID() : clientKey);
    }

    @PatchMapping("/cases/{id}/returns/{returnId}")
    View updateReturn(Principal principal, @PathVariable UUID id, @PathVariable UUID returnId,
                      @Valid @RequestBody UpdateReturn input) {
        return service.updateReturn(actor(principal), id, returnId, input);
    }

    @PatchMapping("/cases/{id}/returns/{returnId}/parts/{partId}")
    View updateReturnPart(Principal principal, @PathVariable UUID id, @PathVariable UUID returnId,
                          @PathVariable UUID partId, @Valid @RequestBody PartStatus input) {
        return service.updateReturnPart(actor(principal), id, returnId, partId, input);
    }

    @GetMapping("/returns")
    Page<ReturnSummary> dueBack(Principal principal, @RequestParam LocalDate from,
                                @RequestParam LocalDate through, @RequestParam LocalDate today,
                                @RequestParam(defaultValue = "0") int page) {
        return service.dueBack(actor(principal), from, through, today, page);
    }

    private AccountDto.User actor(Principal principal) { return accounts.technician(principal.getName()); }
}
