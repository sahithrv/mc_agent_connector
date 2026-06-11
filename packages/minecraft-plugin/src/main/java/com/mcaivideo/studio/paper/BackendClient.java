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
            request = HttpRequest.newBuilder(URI.create(config.backendBaseUrl() + config.eventPath()))
                .timeout(Duration.ofMillis(config.timeoutMs()))
                .header("Content-Type", "application/json")
                .header(SHARED_SECRET_HEADER, config.sharedSecret())
                .POST(HttpRequest.BodyPublishers.ofString(event.toJson(config.serverId()), StandardCharsets.UTF_8))
                .build();
        } catch (RuntimeException error) {
            logger.log(Level.WARNING, "Invalid MC AI Studio backend URL; event was not forwarded.", error);
            return;
        }

        httpClient.sendAsync(request, HttpResponse.BodyHandlers.discarding())
            .orTimeout(config.timeoutMs() + 500L, TimeUnit.MILLISECONDS)
            .whenComplete((response, error) -> {
                if (error != null) {
                    logger.log(Level.WARNING, "Failed to forward Minecraft event " + event.type(), error);
                    return;
                }

                if (response.statusCode() >= 400) {
                    logger.warning(
                        "MC AI Studio backend rejected event "
                            + event.type()
                            + " with HTTP "
                            + response.statusCode()
                    );
                }
            });
    }
}
