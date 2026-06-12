package com.mcaivideo.studio.paper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.logging.Level;
import java.util.logging.Logger;

final class BackendClient {
    private static final String SHARED_SECRET_HEADER = "X-MCAS-Plugin-Secret";

    private final BridgeConfig config;
    private final Logger logger;
    private final HttpClient httpClient;
    private final AtomicBoolean missingSecretLogged = new AtomicBoolean(false);

    BackendClient(BridgeConfig config, Logger logger) {
        this.config = config;
        this.logger = logger;
        this.httpClient = HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(Duration.ofMillis(config.timeoutMs()))
            .build();
    }

    void forward(BridgeEvent event) {
        if (!config.forwardingEnabled()) {
            return;
        }

        if (config.sharedSecret().isBlank()) {
            if (missingSecretLogged.compareAndSet(false, true)) {
                logger.warning("MC AI Studio bridge forwarding disabled: backend.shared-secret is empty.");
            }
            return;
        }

        HttpRequest request;
        try {
            URI uri = URI.create(config.backendBaseUrl() + config.eventPath());
            request = HttpRequest.newBuilder(uri)
                .version(HttpClient.Version.HTTP_1_1)
                .timeout(Duration.ofMillis(config.timeoutMs()))
                .header("Content-Type", "application/json")
                .header(SHARED_SECRET_HEADER, config.sharedSecret())
                .POST(HttpRequest.BodyPublishers.ofString(event.toJson(config.serverId()), StandardCharsets.UTF_8))
                .build();
        } catch (RuntimeException error) {
            logger.log(Level.WARNING, "Invalid MC AI Studio backend URL; event was not forwarded.", error);
            return;
        }

        send(request, event, true);
    }

    private void send(HttpRequest request, BridgeEvent event, boolean allowRetry) {
        httpClient.sendAsync(request, HttpResponse.BodyHandlers.discarding())
            .orTimeout(config.timeoutMs() + 500L, TimeUnit.MILLISECONDS)
            .whenComplete((response, error) -> {
                if (error != null) {
                    if (allowRetry && isRetryable(error)) {
                        send(request, event, false);
                        return;
                    }
                    logger.warning(
                        "Failed to forward Minecraft event "
                            + event.type()
                            + ": "
                            + rootMessage(error)
                    );
                    return;
                }

                if (response.statusCode() >= 400) {
                    logger.warning(
                        "MC AI Studio backend rejected event "
                            + event.type()
                            + " with HTTP "
                            + response.statusCode()
                    );
                } else {
                    logger.fine(
                        "Forwarded Minecraft event "
                            + event.type()
                            + " to "
                            + request.uri()
                    );
                }
            });
    }

    private boolean isRetryable(Throwable error) {
        Throwable root = rootCause(error);
        return root instanceof java.io.IOException
            || root instanceof java.net.ConnectException
            || root instanceof java.net.http.HttpTimeoutException;
    }

    private String rootMessage(Throwable error) {
        Throwable root = rootCause(error);
        return root.getClass().getSimpleName() + ": " + root.getMessage();
    }

    private Throwable rootCause(Throwable error) {
        Throwable current = error;
        while (current.getCause() != null) {
            current = current.getCause();
        }
        return current;
    }
}
