package com.mcaivideo.studio.paper;

import java.util.LinkedHashMap;
import java.util.Map;
import org.bukkit.Location;
import org.bukkit.World;

record LocationSnapshot(double x, double y, double z, String world) {
    static LocationSnapshot from(Location location) {
        World world = location.getWorld();
        return new LocationSnapshot(
            location.getX(),
            location.getY(),
            location.getZ(),
            world == null ? null : world.getName()
        );
    }

    Map<String, Object> toMap() {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("x", x);
        value.put("y", y);
        value.put("z", z);
        if (world != null) {
            value.put("world", world);
        }
        return value;
    }
}
