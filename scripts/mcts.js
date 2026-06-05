// Decision/chance-node MCTS for Yahtzee, matching the corrected Python implementation.
// Re-roll actions become ChanceNodes that RESAMPLE the dice on every visit and route
// outcomes by resulting state, so a roll action's value is the expectation over outcomes
// (not a single frozen sample). Score actions are deterministic DecisionNode children.
import { Action, CATEGORY_ORDER } from './game.js';

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// Canonical key for transposition: sorted dice (permutations collapse) + scorecard + rollsLeft.
function stateKey(state) {
    const dice = state.dice.slice().sort((a, b) => a - b).join(',');
    const card = CATEGORY_ORDER.map(c => state.scoreCard[c]).join(',');
    return `${dice}|${card}|${state.rollsLeft}`;
}

class MCTSNode {
    constructor(gameEngine, parent = null, incomingAction = null) {
        this.gameEngine = gameEngine;
        this.parent = parent;
        this.incomingAction = incomingAction;
        this.visits = 0;
        this.valueSum = 0;       // sum of RAW rollout scores (so valueSum/visits is mean points)
        this.scores = [];        // raw rollout scores (for the assistant's histogram / SE)
    }
    getValueEstimate() { return this.visits === 0 ? Infinity : this.valueSum / this.visits; }
    update(result) { this.visits++; this.valueSum += result; this.scores.push(result); }
}

export class DecisionNode extends MCTSNode {
    constructor(state, gameEngine, incomingAction = null, parent = null, cParam = 1.414) {
        super(gameEngine, parent, incomingAction);
        this.state = state;
        this.cParam = cParam;
        this.children = new Map();                       // Action -> ChanceNode | DecisionNode
        this.untriedActions = gameEngine.getPossibleActions(state);
        shuffle(this.untriedActions);                    // avoid biased fixed expansion order
    }

    isFullyExpanded() { return this.untriedActions.length === 0; }

    expand() {
        const action = this.untriedActions.pop();
        if (action.actionType === 'roll') {
            const chance = new ChanceNode(this, action);
            this.children.set(action, chance);
            return chance.selectOutcome().child;         // first sampled outcome = fresh leaf
        }
        // score: deterministic transition
        const nextState = this.gameEngine.applyAction(this.state, action);
        const child = new DecisionNode(nextState, this.gameEngine, action, this, this.cParam);
        this.children.set(action, child);
        return child;
    }

    // UCT with per-node min-max value normalisation, so cParam is scale-invariant.
    uctSelectChild() {
        const children = [...this.children.values()];
        const visited = children.filter(c => c.visits > 0).map(c => c.getValueEstimate());
        const vMin = visited.length ? Math.min(...visited) : 0;
        const vMax = visited.length ? Math.max(...visited) : 1;
        const vRange = (vMax - vMin) || 1;

        let best = null, bestScore = -Infinity;
        for (const c of children) {
            const s = (c.visits === 0)
                ? Infinity
                : (c.getValueEstimate() - vMin) / vRange
                  + this.cParam * Math.sqrt(Math.log(this.visits) / c.visits);
            if (s > bestScore) { bestScore = s; best = c; }
        }
        return best;
    }
}

export class ChanceNode extends MCTSNode {
    constructor(parentDecision, incomingAction) {
        super(parentDecision.gameEngine, parentDecision, incomingAction);
        this.state = parentDecision.state;               // pre-roll state we keep rolling from
        this.cParam = parentDecision.cParam;
        this.children = new Map();                        // stateKey -> DecisionNode (transposition)
    }

    selectOutcome() {
        const nextState = this.gameEngine.applyAction(this.state, this.incomingAction);
        const key = stateKey(nextState);
        let child = this.children.get(key);
        if (!child) {
            child = new DecisionNode(nextState, this.gameEngine, null, this, this.cParam);
            this.children.set(key, child);
            return { child, isNew: true };
        }
        return { child, isNew: false };
    }
}

export class MCTS {
    constructor(root, gameEngine, simulationDepth = 100, numSimulations = 1000, topXActions = 1) {
        this.root = root;
        this.gameEngine = gameEngine;
        this.simulationDepth = simulationDepth;
        this.numSimulations = numSimulations;
        this.topXActions = topXActions;
    }

    // Tree policy: descend to a fresh leaf, alternating decision (UCT) and chance (sampling) nodes.
    select(node) {
        let current = node, depth = 0;
        while (depth < this.simulationDepth) {
            if (current instanceof ChanceNode) {
                const { child, isNew } = current.selectOutcome();
                current = child;
                if (isNew) break;
            } else {
                if (current.state.isFinal()) break;
                if (current.untriedActions.length > 0) { current = current.expand(); break; }
                current = current.uctSelectChild();
            }
            depth++;
        }
        return current;
    }

    rollout(state) {
        let cur = state;
        while (!cur.isFinal()) {
            const acts = this.gameEngine.getPossibleActions(cur);
            cur = this.gameEngine.applyAction(cur, acts[Math.floor(Math.random() * acts.length)]);
        }
        return this.gameEngine.calculateTotalScore(cur.scoreCard);
    }

    backpropagate(node, result) {
        while (node !== null) { node.update(result); node = node.parent; }
    }

    decideMove() {
        const rootActions = this.gameEngine.getPossibleActions(this.root.state);
        if (rootActions.length <= 1) {                                   // forced move: skip the search
            const a = rootActions[0] || new Action('roll', []);
            return [{ action: a, totalScore: 0, visits: 0, scores: [] }];
        }

        for (let i = 0; i < this.numSimulations; i++) {
            const leaf = this.select(this.root);
            const result = this.rollout(leaf.state);
            this.backpropagate(leaf, result);
        }

        // Contract preserved for the UI: totalScore is the SUM of raw scores, so
        // totalScore / visits = mean final score; scores is the raw distribution.
        return [...this.root.children.entries()]
            .filter(([, c]) => c.visits > 0)
            .sort((x, y) => y[1].getValueEstimate() - x[1].getValueEstimate())
            .slice(0, this.topXActions)
            .map(([action, c]) => ({
                action,
                totalScore: c.valueSum,
                visits: c.visits,
                scores: c.scores
            }));
    }
}
