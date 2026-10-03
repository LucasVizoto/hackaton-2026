package br.cocapec.recebimento.demo;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.io.OutputStream;
import java.util.Arrays;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;

/** Saves bytes fetched by the authenticated web client to the user's chosen document. */
@CapacitorPlugin(name = "PrivateAttachment")
public class PrivateAttachmentPlugin extends Plugin {
    private static final int MAX_BYTES = 10 * 1024 * 1024;
    private static final int MAX_BASE64_LENGTH = 4 * ((MAX_BYTES + 2) / 3);
    private static final String SAVE_ERROR = "Não foi possível salvar o anexo. Tente novamente.";
    private final AtomicBoolean saving = new AtomicBoolean(false);
    private volatile byte[] pendingBytes;

    @PluginMethod
    public void save(PluginCall call) {
        String encoded = call.getString("base64");
        // Capacitor may persist call metadata while DocumentsUI is open. Keep the
        // attachment out of the saved instance-state Bundle and retained call data.
        call.getData().remove("base64");
        if (!saving.compareAndSet(false, true)) {
            call.reject(SAVE_ERROR);
            return;
        }
        try {
            if (encoded == null || encoded.isEmpty() || encoded.length() > MAX_BASE64_LENGTH) {
                throw new IllegalArgumentException();
            }
            pendingBytes = Base64.decode(encoded, Base64.NO_WRAP);
            if (pendingBytes.length == 0 || pendingBytes.length > MAX_BYTES) {
                throw new IllegalArgumentException();
            }

            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.putExtra(Intent.EXTRA_LOCAL_ONLY, true);
            intent.setType(safeMimeType(call.getString("mimeType", "application/octet-stream")));
            intent.putExtra(Intent.EXTRA_TITLE, safeFilename(call.getString("filename", "anexo")));
            getBridge().executeOnMainThread(() -> {
                try {
                    startActivityForResult(call, intent, "saveResult");
                } catch (RuntimeException ignored) {
                    releaseBytes();
                    call.reject(SAVE_ERROR);
                }
            });
        } catch (RuntimeException ignored) {
            releaseBytes();
            call.reject(SAVE_ERROR);
        }
    }

    @ActivityCallback
    private void saveResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            releaseBytes();
            return;
        }
        if (result.getResultCode() == Activity.RESULT_CANCELED) {
            releaseBytes();
            resolveSaved(call, false);
            return;
        }
        Intent data = result.getData();
        Uri destination = data == null ? null : data.getData();
        byte[] bytes = pendingBytes;
        if (
            result.getResultCode() != Activity.RESULT_OK ||
            destination == null ||
            !"content".equals(destination.getScheme()) ||
            bytes == null ||
            bytes.length > MAX_BYTES
        ) {
            releaseBytes();
            call.reject(SAVE_ERROR);
            return;
        }
        // Provider I/O stays off the main thread.
        getBridge().execute(() -> {
            boolean written = false;
            try (OutputStream stream = getContext().getContentResolver().openOutputStream(destination, "w")) {
                if (stream == null) {
                    throw new IOException();
                }
                stream.write(bytes);
                stream.flush();
                written = true;
            } catch (IOException | RuntimeException ignored) {
                written = false;
            } finally {
                releaseBytes();
            }
            if (written) {
                resolveSaved(call, true);
            } else {
                call.reject(SAVE_ERROR);
            }
        });
    }

    private static String safeFilename(String value) {
        String name = value.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}\\p{Cf}]", "_")
            .replaceAll("^\\.+", "").trim();
        if (name.isEmpty()) {
            return "anexo";
        }
        if (name.length() <= 128) {
            return name;
        }
        int dot = name.lastIndexOf('.');
        String extension = dot >= 0 && name.length() - dot <= 10 ? name.substring(dot) : "";
        return name.substring(0, 128 - extension.length()) + extension;
    }

    private static String safeMimeType(String value) {
        String mime = value.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
        return switch (mime) {
            case "application/pdf", "application/xml", "text/xml" -> mime;
            default -> "application/octet-stream";
        };
    }

    private static void resolveSaved(PluginCall call, boolean saved) {
        JSObject result = new JSObject();
        result.put("saved", saved);
        call.resolve(result);
    }

    private void releaseBytes() {
        byte[] bytes = pendingBytes;
        pendingBytes = null;
        if (bytes != null) {
            Arrays.fill(bytes, (byte) 0);
        }
        saving.set(false);
    }
}
