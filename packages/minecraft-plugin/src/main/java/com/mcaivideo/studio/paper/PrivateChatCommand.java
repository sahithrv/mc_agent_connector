package com.mcaivideo.studio.paper;

import java.util.logging.Level;
import java.util.logging.Logger;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

final class PrivateChatCommand implements CommandExecutor {
    enum Channel {
        AI("ai_private_chat", "ai", "ai", "mcas.aichat", "AI"),
        HUMAN_TEAM("human_team_chat", "human-team", "human-team", "mcas.teamchat", "team");

        private final String eventType;
        private final String visibility;
        private final String channelName;
        private final String permission;
        private final String label;

        Channel(String eventType, String visibility, String channelName, String permission, String label) {
            this.eventType = eventType;
            this.visibility = visibility;
            this.channelName = channelName;
            this.permission = permission;
            this.label = label;
        }
    }

    private final BackendClient backend;
    private final Channel channel;
    private final Logger logger;

    PrivateChatCommand(BackendClient backend, Channel channel, Logger logger) {
        this.backend = backend;
        this.channel = channel;
        this.logger = logger;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage("Only players can use this command.");
            return true;
        }

        // Permission controls who can originate private bridge messages. The backend still owns final visibility filtering.
        if (!player.hasPermission(channel.permission)) {
            sender.sendMessage("You do not have permission to use this private channel.");
            return true;
        }

        if (args.length == 0) {
            sender.sendMessage("Usage: /" + label + " <message>");
            return true;
        }

        String content = String.join(" ", args).trim();
        if (content.isEmpty()) {
            sender.sendMessage("Message cannot be empty.");
            return true;
        }

        // This never calls Player#chat or broadcast APIs, so private command text cannot leak to public chat.
        try {
            backend.forward(BridgeEvent.privateChat(
                player,
                channel.eventType,
                channel.visibility,
                channel.channelName,
                content
            ));
        } catch (RuntimeException error) {
            logger.log(Level.WARNING, "Failed to queue private chat for MC AI Studio backend.", error);
        }
        logger.info("[" + channel.label + " private chat] " + player.getName() + ": " + content);
        sender.sendMessage("Sent " + channel.label + " private message.");
        return true;
    }
}
