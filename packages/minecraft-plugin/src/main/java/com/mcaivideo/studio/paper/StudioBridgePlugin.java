package com.mcaivideo.studio.paper;

import org.bukkit.command.PluginCommand;
import org.bukkit.plugin.java.JavaPlugin;

public final class StudioBridgePlugin extends JavaPlugin {
    @Override
    public void onEnable() {
        saveDefaultConfig();

        BridgeConfig config = BridgeConfig.from(getConfig());
        BackendClient backend = new BackendClient(config, getLogger());

        registerCommand("aichat", new PrivateChatCommand(
            backend,
            PrivateChatCommand.Channel.AI,
            getLogger()
        ));
        registerCommand("teamchat", new PrivateChatCommand(
            backend,
            PrivateChatCommand.Channel.HUMAN_TEAM,
            getLogger()
        ));
        getServer().getPluginManager().registerEvents(new EventForwarder(backend, getLogger()), this);

        getLogger().info(
            "MC AI Studio bridge enabled; backend is optional and events forward to "
                + config.backendBaseUrl()
                + config.eventPath()
        );
    }

    private void registerCommand(String name, PrivateChatCommand executor) {
        PluginCommand command = getCommand(name);
        if (command == null) {
            getLogger().warning("Command /" + name + " was not registered in plugin.yml.");
            return;
        }
        command.setExecutor(executor);
    }
}
