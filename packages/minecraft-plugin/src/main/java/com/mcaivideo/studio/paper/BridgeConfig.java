package com.mcaivideo.studio.paper;

import org.bukkit.configuration.file.FileConfiguration;

record BridgeConfig(
    String backendBaseUrl,
    String eventPath,
    String sharedSecret,
    int timeoutMs,
    String serverId,
    boolean forwardingEnabled
) {
    static BridgeConfig from(FileConfiguration config) {
        String baseUrl = value(config, "backend.base-url", "http://127.0.0.1:3000").trim();
        while (baseUrl.endsWith("/")) {
            baseUrl = baseUrl.substring(0, baseUrl.length() - 1);
        }

        String eventPath = value(config, "backend.event-path", "/plugin/events").trim();
        if (!eventPath.startsWith("/")) {
            eventPath = "/" + eventPath;
        }

        return new BridgeConfig(
            baseUrl,
            eventPath,
            value(config, "backend.shared-secret", "").trim(),
            Math.max(250, config.getInt("backend.timeout-ms", 1500)),
            value(config, "backend.server-id", "local-paper").trim(),
            config.getBoolean("forwarding.enabled", true)
        );
    }

    private static String value(FileConfiguration config, String path, String fallback) {
        String value = config.getString(path);
        return value == null || value.isBlank() ? fallback : value;
    }
}
