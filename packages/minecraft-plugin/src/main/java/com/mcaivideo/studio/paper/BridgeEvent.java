package com.mcaivideo.studio.paper;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.bukkit.Location;
import org.bukkit.entity.Player;

record BridgeEvent(
    String eventId,
    String type,
    PlayerSnapshot actor,
    PlayerSnapshot target,
    LocationSnapshot location,
    String visibility,
    int severity,
    Map<String, Object> payload,
    String timestamp
) {
    static BridgeEvent server(
        String type,
        Player actor,
        Player target,
        Location location,
        String visibility,
        int severity,
        Map<String, Object> payload
    ) {
        return new BridgeEvent(
            UUID.randomUUID().toString(),
            type,
            actor == null ? null : PlayerSnapshot.from(actor),
            target == null ? null : PlayerSnapshot.from(target),
            location == null ? null : LocationSnapshot.from(location),
            visibility,
            severity,
            payload,
            Instant.now().toString()
        );
    }

    static BridgeEvent privateChat(Player sender, String eventType, String visibility, String channel, String content) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("channel", channel);
        payload.put("content", content);

        PlayerSnapshot senderSnapshot = PlayerSnapshot.from(sender);
        if (senderSnapshot.teamId() != null) {
            payload.put("teamId", senderSnapshot.teamId());
        }

        return new BridgeEvent(
            UUID.randomUUID().toString(),
            eventType,
            senderSnapshot,
            null,
            LocationSnapshot.from(sender.getLocation()),
            visibility,
            2,
            payload,
            Instant.now().toString()
        );
    }

    String toJson(String serverId) {
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("schemaVersion", "v1");
        root.put("serverId", serverId);
        root.put("eventId", eventId);
        root.put("type", type);
        if (actor != null) {
            root.put("actor", actor.toMap());
        }
        if (target != null) {
            root.put("target", target.toMap());
        }
        if (location != null) {
            root.put("location", location.toMap());
        }
        root.put("visibility", visibility);
        root.put("severity", severity);
        root.put("payload", payload);
        root.put("timestamp", timestamp);
        return JsonWriter.object(root);
    }
}
