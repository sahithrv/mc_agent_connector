export type BlueprintType = "residential" | "blacksmith" | "farm" | "watchtower";

export interface Blueprint {
  id: string;
  type: BlueprintType;
  requiredMaterials: Record<string, number>;
  schematicData: string[][][];
}

export interface BlueprintVariation extends Blueprint {
  displayName: string;
}

export type VillageRecipe = Partial<Record<BlueprintType, number>>;

export class BlueprintRegistry {
  private readonly byId = new Map<string, BlueprintVariation>();
  private readonly byType = new Map<BlueprintType, BlueprintVariation[]>();

  register(blueprint: BlueprintVariation): void {
    if (this.byId.has(blueprint.id)) {
      throw new Error(`blueprint already registered: ${blueprint.id}`);
    }

    this.byId.set(blueprint.id, cloneBlueprint(blueprint));
    const variations = this.byType.get(blueprint.type) ?? [];
    variations.push(cloneBlueprint(blueprint));
    variations.sort((left, right) => left.id.localeCompare(right.id));
    this.byType.set(blueprint.type, variations);
  }

  get(id: string): BlueprintVariation | undefined {
    const blueprint = this.byId.get(id);
    return blueprint ? cloneBlueprint(blueprint) : undefined;
  }

  list(type?: BlueprintType): BlueprintVariation[] {
    const values = type ? this.byType.get(type) ?? [] : [...this.byId.values()];
    return values.map(cloneBlueprint).sort((left, right) => left.id.localeCompare(right.id));
  }

  variationsFor(type: BlueprintType): BlueprintVariation[] {
    return this.list(type);
  }

  chooseVariation(
    type: BlueprintType,
    recentlyUsedIds: ReadonlySet<string> = new Set(),
    random: () => number = Math.random,
  ): BlueprintVariation {
    const variations = this.byType.get(type) ?? [];
    if (variations.length === 0) {
      throw new Error(`no blueprint variations registered for type: ${type}`);
    }

    const unused = variations.filter((blueprint) => !recentlyUsedIds.has(blueprint.id));
    const candidates = unused.length > 0 ? unused : variations;
    const index = Math.min(candidates.length - 1, Math.floor(random() * candidates.length));
    return cloneBlueprint(candidates[index] as BlueprintVariation);
  }

  createVillagePlan(recipe: VillageRecipe, random: () => number = Math.random): BlueprintVariation[] {
    const plan: BlueprintVariation[] = [];
    const recentlyUsed = new Set<string>();
    const entries = Object.entries(recipe) as Array<[BlueprintType, number]>;

    for (const [type, count] of entries) {
      for (let index = 0; index < count; index += 1) {
        const blueprint = this.chooseVariation(type, recentlyUsed, random);
        plan.push(blueprint);
        recentlyUsed.add(blueprint.id);
      }
    }

    return plan;
  }

  static withDefaults(): BlueprintRegistry {
    const registry = new BlueprintRegistry();
    DEFAULT_BLUEPRINTS.forEach((blueprint) => registry.register(blueprint));
    return registry;
  }
}

const DEFAULT_BLUEPRINTS: BlueprintVariation[] = [
  {
    id: "residential:gothic-house",
    type: "residential",
    displayName: "Gothic House",
    requiredMaterials: { stone: 42, wood: 30, glass: 8, torch: 4 },
    schematicData: boxSchematic("stone", "wood", "glass"),
  },
  {
    id: "residential:desert-hut",
    type: "residential",
    displayName: "Desert Hut",
    requiredMaterials: { stone: 48, wood: 12, glass: 4, torch: 2 },
    schematicData: boxSchematic("stone", "stone", "glass"),
  },
  {
    id: "residential:spruce-cabin",
    type: "residential",
    displayName: "Spruce Cabin",
    requiredMaterials: { wood: 64, glass: 6, torch: 3 },
    schematicData: boxSchematic("wood", "wood", "glass"),
  },
  {
    id: "blacksmith:stone-forge",
    type: "blacksmith",
    displayName: "Stone Forge",
    requiredMaterials: { stone: 56, furnace: 2, iron_bars: 6, coal: 8 },
    schematicData: boxSchematic("stone", "stone", "iron_bars"),
  },
  {
    id: "blacksmith:timber-smelter",
    type: "blacksmith",
    displayName: "Timber Smelter",
    requiredMaterials: { stone: 40, wood: 18, furnace: 2, coal: 8 },
    schematicData: boxSchematic("stone", "wood", "air"),
  },
  {
    id: "farm:basic-wheat",
    type: "farm",
    displayName: "Basic Farm",
    requiredMaterials: { dirt: 36, crop: 16, fence: 18, water_bucket: 1 },
    schematicData: farmSchematic("crop"),
  },
  {
    id: "farm:carrot-strip",
    type: "farm",
    displayName: "Carrot Strip",
    requiredMaterials: { dirt: 30, crop: 12, fence: 16, water_bucket: 1 },
    schematicData: farmSchematic("crop"),
  },
  {
    id: "watchtower:oak-lookout",
    type: "watchtower",
    displayName: "Oak Lookout",
    requiredMaterials: { wood: 32, ladder: 8, torch: 6, stone: 18 },
    schematicData: towerSchematic("wood", "wood"),
  },
  {
    id: "watchtower:stone-sentry",
    type: "watchtower",
    displayName: "Stone Sentry",
    requiredMaterials: { stone: 46, ladder: 8, torch: 6, wood: 10 },
    schematicData: towerSchematic("stone", "wood"),
  },
];

function boxSchematic(wall: string, roof: string, window: string): string[][][] {
  return [
    [
      [wall, wall, wall],
      [wall, "air", wall],
      [wall, wall, wall],
    ],
    [
      [wall, window, wall],
      [window, "air", window],
      [wall, "door", wall],
    ],
    [
      [roof, roof, roof],
      [roof, roof, roof],
      [roof, roof, roof],
    ],
  ];
}

function farmSchematic(crop: string): string[][][] {
  return [[
    ["fence", "fence", "fence", "fence"],
    ["fence", crop, "water", "fence"],
    ["fence", crop, crop, "fence"],
    ["fence", "fence", "fence", "fence"],
  ]];
}

function towerSchematic(column: string, platform: string): string[][][] {
  return [
    [[column]],
    [[column]],
    [[column]],
    [
      [platform, platform, platform],
      [platform, column, platform],
      [platform, platform, platform],
    ],
  ];
}

function cloneBlueprint<T extends BlueprintVariation>(blueprint: T): T {
  return {
    ...blueprint,
    requiredMaterials: { ...blueprint.requiredMaterials },
    schematicData: blueprint.schematicData.map((layer) => layer.map((row) => [...row])),
  };
}
