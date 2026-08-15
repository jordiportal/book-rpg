// Estado del juego: stats, inventario, economía, tiempo, progreso
// Basado en el sistema del libro (異世界迷宮でハーレムを)

export const GAME_CONSTANTS = {
  // Objetivo del volumen 1: comprar a Roxanne
  ROXANNE_PRICE: 420000,
  DAYS_TO_BUY: 5,
  STARTING_MONEY: 0,
  // Moneda
  CURRENCY: 'ナール',
  // Trabajos disponibles
  JOBS: ['無職', '英雄', '探索者', '戦士', '剣士', '商人', '盗賊', '魔法使い'],
  // Armas
  WEAPONS: ['デュランダル', '短剣', '剣', '杖', '弓'],
  // Habilidades
  SKILLS: ['鑑定', '二つ名', '再設定', '経験値増加']
};

export function createInitialState() {
  return {
    player: {
      name: '加賀道夫',
      level: 1,
      exp: 0,
      expToNext: 100,
      hp: 100,
      maxHp: 100,
      mp: 50,
      maxMp: 50,
      job: '無職',
      jobs: ['無職'],
      weapon: 'なし',
      skills: ['鑑定'],
      bonusPoints: 99,
      // Atributos
      str: 10,
      vit: 10,
      agi: 10,
      dex: 10,
      int: 10,
      luck: 10
    },
    money: GAME_CONSTANTS.STARTING_MONEY,
    inventory: [],
    location: '最初の村', // 最初の村 | ベイル | 迷宮
    day: 1,
    daysRemaining: GAME_CONSTANTS.DAYS_TO_BUY,
    reputation: 0,
    // Progreso de la historia
    flags: {
      metRoxanne: false,
      boughtRoxanne: false,
      clearedBandits: false,
      exploredLabyrinth: false
    },
    log: []
  };
}

// Añade una entrada al log del juego
export function addLog(state, entry) {
  state.log.push({ time: new Date().toISOString(), entry });
  if (state.log.length > 100) state.log.shift();
}

// Subir de nivel (simple: exp necesaria crece)
export function gainExp(state, amount) {
  state.player.exp += amount;
  let leveled = false;
  while (state.player.exp >= state.player.expToNext) {
    state.player.exp -= state.player.expToNext;
    state.player.level += 1;
    state.player.expToNext = Math.floor(state.player.expToNext * 1.5);
    // Subir stats
    state.player.maxHp += 10;
    state.player.hp = state.player.maxHp;
    state.player.maxMp += 5;
    state.player.mp = state.player.maxMp;
    state.player.str += 2;
    state.player.vit += 2;
    state.player.agi += 1;
    state.player.dex += 1;
    state.player.int += 1;
    state.player.luck += 1;
    leveled = true;
  }
  return leveled;
}

// Cambiar de trabajo (el libro permite múltiples trabajos)
export function addJob(state, job) {
  if (!state.player.jobs.includes(job)) {
    state.player.jobs.push(job);
    state.player.job = job;
  }
}

// Avanzar un día (el objetivo tiene límite de 5 días)
export function advanceDay(state) {
  state.day += 1;
  state.daysRemaining = Math.max(0, GAME_CONSTANTS.DAYS_TO_BUY - (state.day - 1));
}

// Ganar dinero
export function gainMoney(state, amount) {
  state.money += amount;
}

// Comprar a Roxanne
export function canBuyRoxanne(state) {
  return state.money >= GAME_CONSTANTS.ROXANNE_PRICE;
}
