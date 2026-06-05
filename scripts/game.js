function getCombinations(array, size) {
    function* doCombination(offset, combo) {
        if (combo.length === size) { yield combo; return; }
        for (let i = offset; i <= array.length - size + combo.length; i++) {
            yield* doCombination(i + 1, combo.concat(array[i]));
        }
    }
    return Array.from(doCombination(0, []));
}

export const CATEGORY_ORDER = [
    'ones', 'twos', 'threes', 'fours', 'fives', 'sixes',
    'three_of_a_kind', 'four_of_a_kind', 'full_house',
    'small_straight', 'large_straight', 'yahtzee', 'chance'
];

export class State {
    constructor(dice = [0, 0, 0, 0, 0], held = [false, false, false, false, false],
                scoreCard = null, rollsLeft = 3) {
        this.dice = dice;
        this.held = held;
        this.scoreCard = scoreCard || {
            ones: null, twos: null, threes: null, fours: null, fives: null, sixes: null,
            three_of_a_kind: null, four_of_a_kind: null, full_house: null,
            small_straight: null, large_straight: null, yahtzee: null, chance: null
        };
        this.rollsLeft = rollsLeft;
    }
    isFinal() {
        return CATEGORY_ORDER.every(c => this.scoreCard[c] !== null);
    }
}

export class Action {
    constructor(actionType, details) { this.actionType = actionType; this.details = details; }
}

export class GameEngine {
    // Pure: never mutates the input state.
    applyAction(state, action) {
        switch (action.actionType) {
            case 'roll': {
                const held = [false, false, false, false, false];
                action.details.forEach(i => { held[i] = true; });        // details = indices to KEEP
                const pre = new State(state.dice, held, state.scoreCard, state.rollsLeft);
                return this.rollDice(pre);
            }
            case 'score':
                return this.score(state, action.details);
        }
    }

    rollDice(state) {                                                    // reads state.held (UI-compatible)
        if (state.rollsLeft > 0) {
            const newDice = state.dice.slice();
            for (let i = 0; i < newDice.length; i++) {
                if (!state.held[i]) newDice[i] = Math.floor(Math.random() * 6) + 1;
            }
            return new State(newDice, [false, false, false, false, false],
                             { ...state.scoreCard }, state.rollsLeft - 1);
        }
        return state;
    }

    score(state, category) {
        const newScores = { ...state.scoreCard };
        if (newScores[category] !== null) return state;                  // already scored
        newScores[category] = this.calculateScore(category, state.dice);
        // NOTE: no upper_bonus key stored; the bonus is derived in calculateTotalScore.
        return new State([0, 0, 0, 0, 0], [false, false, false, false, false], newScores, 3);
    }

    calculateUpperScore(scoreCard) {
        return ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes']
            .reduce((t, c) => t + (scoreCard[c] || 0), 0);
    }
    calculateLowerScore(scoreCard) {
        return ['three_of_a_kind', 'four_of_a_kind', 'full_house', 'small_straight',
                'large_straight', 'yahtzee', 'chance']
            .reduce((t, c) => t + (scoreCard[c] || 0), 0);
    }
    calculateTotalScore(scoreCard) {
        const upper = this.calculateUpperScore(scoreCard);
        const lower = this.calculateLowerScore(scoreCard);
        return upper + lower + (upper >= 63 ? 35 : 0);
    }

    calculateScore(category, dice) {
        const valueMap = { ones: 1, twos: 2, threes: 3, fours: 4, fives: 5, sixes: 6 };
        const count = {};
        dice.forEach(v => { count[v] = (count[v] || 0) + 1; });
        if (category in valueMap) return (count[valueMap[category]] || 0) * valueMap[category];
        if (category === 'three_of_a_kind') return Object.values(count).some(c => c >= 3) ? dice.reduce((a, b) => a + b, 0) : 0;
        if (category === 'four_of_a_kind')  return Object.values(count).some(c => c >= 4) ? dice.reduce((a, b) => a + b, 0) : 0;
        if (category === 'full_house')      { const v = Object.values(count); return v.includes(2) && v.includes(3) ? 25 : 0; }
        if (category === 'small_straight')  return [[1,2,3,4],[2,3,4,5],[3,4,5,6]].some(s => s.every(n => dice.includes(n))) ? 30 : 0;
        if (category === 'large_straight')  return [[1,2,3,4,5],[2,3,4,5,6]].some(s => s.every(n => dice.includes(n))) ? 40 : 0;
        if (category === 'yahtzee')         return new Set(dice).size === 1 ? 50 : 0;
        if (category === 'chance')          return dice.reduce((a, b) => a + b, 0);
        return 0;
    }

    getPossibleActions(state) {
        const actions = [];
        if (state.isFinal()) return actions;

        if (state.rollsLeft === 3) {
            actions.push(new Action('roll', []));                        // forced first roll; cannot score yet
            return actions;
        }
        if (state.rollsLeft > 0) {                                       // roll actions while rolls remain
            actions.push(new Action('roll', []));                        // reroll all (keep none)
            const indices = [0, 1, 2, 3, 4];
            for (let r = 1; r <= 4; r++) {                               // keep 1..4 (keep-all dropped: redundant)
                for (const subset of getCombinations(indices, r)) actions.push(new Action('roll', subset));
            }
        }
        for (const category of CATEGORY_ORDER) {                         // scoring allowed once rolled (R in {0,1,2})
            if (state.scoreCard[category] === null) actions.push(new Action('score', category));
        }
        return actions;
    }
}
