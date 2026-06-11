package com.mcaivideo.studio.paper;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.logging.Level;
import java.util.logging.Logger;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.AsyncPlayerChatEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;

final class EventForwarder implements Listener {
    private final BackendClient backend;
    private final Logger logger;

    EventForwarder(BackendClient backend, Logger logger) {
        this.backend = backend;
        this.logger = logger;
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onPlayerJoin(PlayerJoinEvent event) {
        forward(BridgeEvent.server(
            "player_join",
            event.getPlayer(),
            null,
            event.getPlayer().getLocation(),
            "recorder",
            1,
            Map.of()
        ));
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onPlayerLeave(PlayerQuitEvent event) {
        forward(BridgeEvent.server(
            "player_leave",
            event.getPlayer(),
            null,
            event.getPlayer().getLocation(),
            "recorder",
            1,
            Map.of()
        ));
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onPlayerDeath(PlayerDeathEvent event) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("deathMessage", event.getDeathMessage());

        forward(BridgeEvent.server(
            "player_death",
            event.getEntity(),
            event.getEntity().getKiller(),
            event.getEntity().getLocation(),
            "recorder",
            5,
            payload
        ));
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onPlayerDamage(EntityDamageEvent event) {
        if (!(event.getEntity() instanceof Player player)) {
            return;
        }

        Player target = null;
        Entity damager = null;
        if (event instanceof EntityDamageByEntityEvent byEntity) {
            damager = byEntity.getDamager();
            if (damager instanceof Player damagerPlayer) {
                target = damagerPlayer;
            }
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("cause", event.getCause().name());
        payload.put("damage", event.getDamage());
        payload.put("finalDamage", event.getFinalDamage());
        if (damager != null) {
            payload.put("damagerType", damager.getType().name());
        }

        forward(BridgeEvent.server(
            "player_damage",
            player,
            target,
            player.getLocation(),
            "recorder",
            4,
            payload
        ));
    }

    @SuppressWarnings("deprecation")
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onPlayerChat(AsyncPlayerChatEvent event) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("message", event.getMessage());

        forward(BridgeEvent.server(
            "player_chat",
            event.getPlayer(),
            null,
            event.getPlayer().getLocation(),
            "public",
            1,
            payload
        ));
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onBlockBreak(BlockBreakEvent event) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("blockType", event.getBlock().getType().name());

        forward(BridgeEvent.server(
            "block_break",
            event.getPlayer(),
            null,
            event.getBlock().getLocation(),
            "recorder",
            2,
            payload
        ));
    }

    private void forward(BridgeEvent event) {
        try {
            backend.forward(event);
        } catch (RuntimeException error) {
            logger.log(Level.WARNING, "Failed to queue Minecraft event " + event.type(), error);
        }
    }
}
