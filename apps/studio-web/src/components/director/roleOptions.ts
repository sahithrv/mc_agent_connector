export const DIRECTOR_ROLE_OPTIONS = [
  "Leader",
  "Guard",
  "Farmer",
  "Miner",
  "Builder",
  "Scout",
  "Medic",
  "Diplomat",
  "Merchant",
  "Traitor",
  "Jester",
  "Maniac",
  "Scientist",
  "Coder",
  "Spy",
  "Saboteur",
  "Informant",
  "Courier",
  "Strategist",
  "Quartermaster",
] as const;

export const directorRoleSelectData = DIRECTOR_ROLE_OPTIONS.map((role) => ({
  value: role,
  label: role,
}));
