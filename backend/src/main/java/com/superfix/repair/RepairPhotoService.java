package com.superfix.repair;

import static com.superfix.config.ApiError.*;
import static com.superfix.repair.RepairData.*;

import com.superfix.account.AccountDto.User;
import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.Resource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.beans.factory.annotation.Value;

/** Stores and retrieves the photos attached to a repair. */
@Service
@RequiredArgsConstructor
class RepairPhotoService {
    private final RepairService repairService;
    private final RepairRepository repairs;
    private final PhotoStorage photos;
    private final JdbcTemplate jdbc;
    @Value("${superfix.photos.max-per-case:12}") private int photoLimit;

    @Transactional(rollbackFor = IOException.class)
    public View upload(User user, UUID id, MultipartFile file, PhotoKind kind, UUID clientKey) throws IOException {
        var repair = repairService.writable(user, id);
        var prior = jdbc.query("""
                select photo_id from repair_photo_uploads where case_id = ? and company_id = ? and client_key = ?
                """, (row, index) -> row.getObject(1, UUID.class), id, user.companyId(), clientKey);
        if (!prior.isEmpty()) return repairService.view(user, repair);
        repairService.requireStatus(repair, Status.DRAFT, Status.DIAGNOSING, Status.CHECKLIST);
        var attachments = new ArrayList<>(repair.details.photos());
        if (attachments.size() >= photoLimit) throw bad("photoCount");
        var storedPhoto = photos.put(id, file, kind);
        var photo = new Photo(storedPhoto.id(), storedPhoto.contentType(), storedPhoto.size(), kind, clientKey);
        attachments.add(photo);
        repair.details = repair.details.photos(List.copyOf(attachments));
        jdbc.update("""
                insert into repair_photo_uploads(id, case_id, company_id, client_key, photo_id, created_at)
                values (?, ?, ?, ?, ?, ?)
                """, UUID.randomUUID(), id, user.companyId(), clientKey, photo.id(),
                java.sql.Timestamp.from(Instant.now()));
        return repairService.save(repair, user);
    }

    @Transactional
    public View deletePhoto(User user, UUID id, UUID photoId) {
        var repair = repairService.writable(user, id);
        repairService.requireStatus(repair, Status.DRAFT, Status.DIAGNOSING, Status.CHECKLIST);
        if (Boolean.TRUE.equals(jdbc.queryForObject("select exists(select 1 from conversation_message_photos where case_id = ? and photo_id = ?)",
                Boolean.class, id, photoId))) throw conflict("photoInUse");
        var remaining = repair.details.photos().stream().filter(photo -> !photo.id().equals(photoId)).toList();
        if (remaining.size() == repair.details.photos().size()) throw missing();
        repair.details = repair.details.photos(remaining);
        photos.deleteAfterCommit(id, photoId);
        return repairService.save(repair, user);
    }

    Resource photo(User user, UUID id, UUID photoId) {
        var repair = repairService.visible(user, repairs.findById(id));
        if (repair.details.photos().stream().noneMatch(photo -> photo.id().equals(photoId))) throw missing();
        var resource = photos.resource(id, photoId);
        if (!resource.exists()) throw missing();
        return resource;
    }

}
