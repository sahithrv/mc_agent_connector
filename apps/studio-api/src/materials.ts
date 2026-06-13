export function canonicalMaterialName(value: string): string {
  const normalized = normalizeMaterialName(value);
  if (isWoodMaterial(normalized)) return "wood";
  if (isStoneMaterial(normalized)) return "stone";
  if (isFenceMaterial(normalized)) return "fence";
  if (isCropMaterial(normalized)) return "crop";
  if (isDirtMaterial(normalized)) return "dirt";
  if (isGlassMaterial(normalized)) return "glass";
  if (normalized === "charcoal") return "coal";
  return normalized;
}

export function materialNameMatches(candidate: string, required: string): boolean {
  const candidateCanonical = canonicalMaterialName(candidate);
  const requiredCanonical = canonicalMaterialName(required);
  if (candidateCanonical === requiredCanonical) return true;

  const left = normalizeMaterialName(candidate);
  const right = normalizeMaterialName(required);
  return left.includes(right) || right.includes(left);
}

export function isPlaceableMaterialName(value: string): boolean {
  return ["wood", "stone", "dirt", "fence", "glass"].includes(canonicalMaterialName(value));
}

export function normalizeMaterialName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function isWoodMaterial(value: string): boolean {
  return value === "wood"
    || value === "log"
    || value === "planks"
    || value.endsWith("_log")
    || value.endsWith("_wood")
    || value.endsWith("_planks")
    || value.endsWith("_stem")
    || value.endsWith("_hyphae")
    || value === "bamboo_block"
    || value === "bamboo_mosaic";
}

function isStoneMaterial(value: string): boolean {
  return value === "stone"
    || value === "cobblestone"
    || value.endsWith("_stone")
    || value.endsWith("_stone_bricks")
    || value.includes("stone_brick")
    || value.includes("deepslate")
    || value.includes("andesite")
    || value.includes("diorite")
    || value.includes("granite")
    || value.includes("tuff")
    || value.includes("basalt")
    || value.includes("blackstone")
    || value.includes("sandstone")
    || value === "brick"
    || value === "bricks"
    || value.endsWith("_bricks");
}

function isFenceMaterial(value: string): boolean {
  return value === "fence" || value.endsWith("_fence");
}

function isCropMaterial(value: string): boolean {
  return value === "crop"
    || value === "seed"
    || value === "seeds"
    || value.endsWith("_seeds")
    || value.includes("wheat")
    || value.includes("carrot")
    || value.includes("potato")
    || value.includes("beetroot");
}

function isDirtMaterial(value: string): boolean {
  return value === "dirt"
    || value === "grass_block"
    || value === "coarse_dirt"
    || value === "rooted_dirt"
    || value === "farmland"
    || value === "mud";
}

function isGlassMaterial(value: string): boolean {
  return value === "glass" || value.endsWith("_glass") || value.endsWith("_glass_pane");
}
