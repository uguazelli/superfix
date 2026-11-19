package com.superfix.repair;

import static com.superfix.config.ApiError.bad;
import static com.superfix.repair.RepairData.Photo;
import static com.superfix.repair.RepairData.PhotoKind;

import java.awt.image.BufferedImage;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import javax.imageio.ImageIO;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.*;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.*;
import org.springframework.web.multipart.MultipartFile;

@Slf4j
@Component
class PhotoStorage {
    private final Path root;

    PhotoStorage(@Value("${superfix.photos-path}") String path) throws IOException {
        root = Files.createDirectories(Path.of(path).toAbsolutePath().normalize());
    }

    Photo put(UUID caseId, MultipartFile file, PhotoKind kind) throws IOException {
        if (file.isEmpty() || file.getSize() > 5_242_880) throw bad("photoLimit");
        var image = decode(file);
        UUID id = UUID.randomUUID();
        Path path = path(caseId, id);
        Files.createDirectories(path.getParent());
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCompletion(int status) {
                if (status != STATUS_COMMITTED) {
                    try { Files.deleteIfExists(path); }
                    catch (IOException ignored) { /* An unreferenced image remains inaccessible. */ }
                }
            }
        });
        byte[] bytes;
        try (var output = new ByteArrayOutputStream()) {
            ImageIO.write(image, "jpeg", output);
            bytes = output.toByteArray();
        }
        if (bytes.length > 5_242_880) throw bad("photoLimit");
        Files.write(path, bytes, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
        return new Photo(id, "image/jpeg", bytes.length, kind, null);
    }

    void deleteAfterCommit(UUID caseId, UUID id) {
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                try { Files.deleteIfExists(path(caseId, id)); }
                catch (IOException e) { log.warn("Could not remove unreferenced photo {}", id); }
            }
        });
    }

    void deleteCaseAfterCommit(UUID caseId) {
        Path directory = root.resolve(caseId.toString()).normalize();
        if (!directory.startsWith(root) || directory.equals(root)) throw new IllegalArgumentException("Invalid case photo path");
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                if (!Files.exists(directory)) return;
                try (var paths = Files.walk(directory)) {
                    for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) Files.deleteIfExists(path);
                } catch (IOException e) {
                    log.warn("Could not remove photos for deleted case {}", caseId);
                }
            }
        });
    }

    Resource resource(UUID caseId, UUID id) { return new FileSystemResource(path(caseId, id)); }

    String dataUrl(UUID caseId, Photo photo) throws IOException {
        return "data:" + photo.contentType() + ";base64," +
                Base64.getEncoder().encodeToString(Files.readAllBytes(path(caseId, photo.id())));
    }

    private Path path(UUID caseId, UUID id) { return root.resolve(caseId.toString()).resolve(id + ".jpg"); }

    private BufferedImage decode(MultipartFile file) throws IOException {
        try (var imageStream = ImageIO.createImageInputStream(file.getInputStream())) {
            if (imageStream == null) throw bad("invalidPhoto");
            var readers = ImageIO.getImageReaders(imageStream);
            if (!readers.hasNext()) throw bad("invalidPhoto");
            var reader = readers.next();
            try {
                if (!Set.of("JPEG", "PNG").contains(reader.getFormatName().toUpperCase(Locale.ROOT))) throw bad("invalidPhoto");
                reader.setInput(imageStream, true, true);
                int width = reader.getWidth(0);
                int height = reader.getHeight(0);
                if ((long) width * height > 30_000_000L) throw bad("photoLimit");
                BufferedImage source = reader.read(0);
                double scale = Math.min(1d, 1600d / Math.max(width, height));
                var rendered = new BufferedImage(Math.max(1, (int) (width * scale)),
                        Math.max(1, (int) (height * scale)), BufferedImage.TYPE_INT_RGB);
                var graphics = rendered.createGraphics();
                try {
                    graphics.setColor(java.awt.Color.WHITE);
                    graphics.fillRect(0, 0, rendered.getWidth(), rendered.getHeight());
                    graphics.setRenderingHint(java.awt.RenderingHints.KEY_INTERPOLATION,
                            java.awt.RenderingHints.VALUE_INTERPOLATION_BILINEAR);
                    graphics.drawImage(source, 0, 0, rendered.getWidth(), rendered.getHeight(), null);
                } finally { graphics.dispose(); }
                return rendered;
            } finally { reader.dispose(); }
        } catch (javax.imageio.IIOException malformed) {
            throw bad("invalidPhoto");
        }
    }
}
