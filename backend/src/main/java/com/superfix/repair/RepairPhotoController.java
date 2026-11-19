package com.superfix.repair;

import static com.superfix.repair.RepairData.*;
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
class RepairPhotoController {
    private final AccountService accounts;
    private final RepairPhotoService service;

    @PostMapping("/cases/{id}/photos")
    View upload(Principal principal, @PathVariable UUID id,
                @RequestHeader(name = "Idempotency-Key", required = false) UUID clientKey,
                @RequestParam MultipartFile file,
                @RequestParam(defaultValue = "SYMPTOM") PhotoKind kind) throws IOException {
        return service.upload(actor(principal), id, file, kind, clientKey == null ? UUID.randomUUID() : clientKey);
    }

    @DeleteMapping("/cases/{id}/photos/{photo}")
    View deletePhoto(Principal principal, @PathVariable UUID id, @PathVariable UUID photo) {
        return service.deletePhoto(actor(principal), id, photo);
    }

    @GetMapping("/cases/{id}/photos/{photo}")
    ResponseEntity<Resource> photo(Principal principal, @PathVariable UUID id, @PathVariable UUID photo) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(MediaType.IMAGE_JPEG)
                .body(service.photo(actor(principal), id, photo));
    }

    private AccountDto.User actor(Principal principal) { return accounts.technician(principal.getName()); }
}
