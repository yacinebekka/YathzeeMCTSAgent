// Thin worker glue: parse the message, run MCTS, post the top actions.
import { GameEngine, State } from './game.js';
import { DecisionNode, MCTS } from './mcts.js';

self.onmessage = function (event) {
    const { stateRepresentationForWorker: s, gameConfig } = event.data;

    const numSimulations  = Number(gameConfig.numSimulations) || 1000;
    const simulationDepth = Number(gameConfig.simulationDepth) || 100;
    const topXActions     = Number(gameConfig.topXActions) || 1;
    const cRaw            = Number(gameConfig.UCTCValue);
    const cParam          = Number.isFinite(cRaw) ? cRaw : 1.414;

    const gameEngine = new GameEngine();
    const state = new State(s.dice, s.held, s.scoreCard, s.rollsLeft);

    const root = new DecisionNode(state, gameEngine, null, null, cParam);
    const mcts = new MCTS(root, gameEngine, simulationDepth, numSimulations, topXActions);

    self.postMessage({ topActions: mcts.decideMove() });
};
