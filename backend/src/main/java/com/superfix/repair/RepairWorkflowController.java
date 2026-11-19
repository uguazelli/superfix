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
class RepairWorkflowController {
    private final AccountService accounts;
    private final RepairWorkflowService service;

    @PutMapping("/cases/{id}/answers")
    View draft(Principal principal, @PathVariable UUID id, @Valid @RequestBody Draft input) {
        return service.draft(actor(principal), id, input);
    }

    @PostMapping("/cases/{id}/diagnostic")
    View diagnostic(Principal principal, @PathVariable UUID id, @Valid @RequestBody Submit input) {
        return service.submit(actor(principal), id, input);
    }

    @PostMapping("/cases/{id}/transition/{action}")
    View transition(Principal principal, @PathVariable UUID id, @PathVariable String action, @Valid @RequestBody Change input) {
        return service.transition(actor(principal), id, action, input);
    }

    @PutMapping("/cases/{id}/checklist")
    View checks(Principal principal, @PathVariable UUID id, @Valid @RequestBody Checks input) {
        return service.checks(actor(principal), id, input);
    }

    @PutMapping("/cases/{id}/work-log")
    View workLog(Principal principal, @PathVariable UUID id, @Valid @RequestBody SaveWorkLog input) {
        return service.saveWorkLog(actor(principal), id, input);
    }

    @PostMapping("/cases/{id}/close")
    View close(Principal principal, @PathVariable UUID id, @RequestParam long version, @Valid @RequestBody Close input) {
        return service.close(actor(principal), id, version, input);
    }

    private AccountDto.User actor(Principal principal) { return accounts.technician(principal.getName()); }
}
