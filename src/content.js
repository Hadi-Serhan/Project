// Enemy types + simple wave recipe. Easy to tweak or later move to JSON.

export const ENEMY_TYPES = {
  grunt:  { speed: 70,  hp: 22,  coreDamage: 5,  radius: 10, color: '#9aa',    baseGold: 6,  attackPeriod: 1.0, boss: false },
  runner: { speed: 120, hp: 16,  coreDamage: 6,  radius: 9,  color: '#a9d1ff', baseGold: 7,  attackPeriod: 0.9, boss: false },
  tank:   { speed: 45,  hp: 80,  coreDamage: 12, radius: 12, color: '#c9a76a', baseGold: 14, attackPeriod: 1.2, boss: false },
  boss:   { speed: 50,  hp: 420, coreDamage: 20, radius: 20, color: '#d86be0', baseGold: 120, attackPeriod: 0.8, boss: true }
};

export function waveRecipe(wave) {
  // Decide spawns for a wave. Returns array of { type, count, cadenceMul }
  const packs = [{ type: 'grunt', count: 8 + Math.floor(wave*1.5), cadenceMul: 1.0 }];
  if (wave % 2 === 0) packs.push({ type: 'runner', count: 4 + Math.floor(wave*1.0), cadenceMul: 0.85 });
  if (wave % 3 === 0) packs.push({ type: 'tank',   count: 2 + Math.floor(wave*0.6), cadenceMul: 1.25 });
  if (wave % 5 === 0) packs.push({ type: 'boss',   count: 1, cadenceMul: 0.5, boss: true });
  return packs;
}
