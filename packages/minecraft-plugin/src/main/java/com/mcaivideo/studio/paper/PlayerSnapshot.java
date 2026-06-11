package com.mcaivideo.studio.paper;

import java.util.LinkedHashMap;
import java.util.Map;
import org.bukkit.entity.Player;
import org.bukkit.scoreboard.Team;

record PlayerSnapshot(String uuid, String username, String teamId, boolean recorder) {
    static PlayerSnapshot from(Player player) {
        Team team = player.getScoreboard().getEntryTeam(player.getName());
        return new PlayerSnapshot(
            player.getUniqueId().toString(),
            player.getName(),
            team == null ? null : team.getName(),
            player.hasPermission("mcas.recorder")
        );
    }

    Map<String, Object> toMap() {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("uuid", uuid);
        value.put("username", username);
        if (teamId != null) {
            value.put("teamId", teamId);
        }
        value.put("isRecorder", recorder);
        return value;
    }
}
