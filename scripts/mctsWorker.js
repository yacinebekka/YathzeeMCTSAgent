import { GameEngine, State, Action } from './game.js';

self.onmessage = function(event) {
    let { stateRepresentationForWorker, gameConfig } = event.data;  // Ensure that the main thread sends aiStateData
    const { numSimulations, simulationDepth, pruningThreshold, UCTCValue, pruningFactor, topXActions } = gameConfig;

    // Output incoming data for debugging
    console.log("Received from main thread:", event.data);
    console.log(stateRepresentationForWorker);
    console.log(topXActions);

    // Initialize the game engine and state from passed data
    const gameEngine = new GameEngine(); // Create a new instance assuming it can be initialized without parameters
    stateRepresentationForWorker = new State(stateRepresentationForWorker.dice, stateRepresentationForWorker.held, stateRepresentationForWorker.scoreCard, stateRepresentationForWorker.rollsLeft);

    // Create the root node for MCTS
    const rootNode = new Node(stateRepresentationForWorker, gameEngine, null, null, UCTCValue, pruningFactor);
    const mcts = new MCTS(rootNode, gameEngine, simulationDepth, numSimulations, pruningThreshold, topXActions);
    
    // Execute decision-making process
    const topActions = mcts.decideMove();

    console.log(topActions);

    // Send the result back to the main thread
    self.postMessage({ topActions });
};


class Node {
    constructor(state, gameEngine, parent = null, action = null, C = 1.414, pruningFactor = 0.2) {
        this.parent = parent;
        this.action = action;
        this.state = state;
        this.children = [];
        this.visits = 0;
        this.totalScore = 0;
        this.scores = [];
        this.gameEngine = gameEngine;
        this.untriedActions = this.gameEngine.getPossibleActions(this.state);
        this.C = C; // Exploration parameter
        this.pruningFactor = pruningFactor;
    }

    expand() {
        if (this.untriedActions.length > 0) {
            const action = this.untriedActions.pop();
            const nextState = this.gameEngine.applyAction(this.state, action);
            const newNode = new Node(nextState, this.gameEngine, this, action, this.C, this.pruningFactor);
            this.children.push(newNode);
            return newNode;
        }
        return null;
    }

    update(score) {
        this.visits++;
        this.totalScore += (score / 400); // normalize score
        this.scores.push(score);
    }

    uctSelectChild() {
        if (this.visits === 0) {
            throw new Error("Cannot select from an unvisited node");
        }
         
        return this.children.reduce((prev, curr) => {
            return (prev.getUCTValue() > curr.getUCTValue()) ? prev : curr;
        });
    }

    getUCTValue() {
        if (this.visits === 0) {
            return Infinity; // Encourage exploration of unvisited nodes
        }
        return (this.totalScore / this.visits) + this.C * Math.sqrt(Math.log(this.parent.visits) / this.visits);
    }

    pruneChildren() {
        if (this.children.length === 0) {
            return;
        }

        const maxVisits = Math.max(...this.children.map(child => child.visits));
        const visitThreshold = maxVisits * this.pruningFactor; // Prune children with visits less than 20% of the maximum

        this.children = this.children.filter(child => child.visits >= visitThreshold);
    }
}


class MCTS {
    constructor(root, gameEngine, simulationDepth = 250, numSimulations = 1000, pruningThreshold = 100, topXActions = 1) {
        this.root = root;
        this.gameEngine = gameEngine;
        this.simulationDepth = simulationDepth;
        this.numSimulations = numSimulations;
        this.pruningThreshold = pruningThreshold;
        this.topXActions = topXActions;
    }

    simulate(node) {
        let currentDepth = 0;
        let currentNode = node;
        while (!currentNode.state.isFinal() && currentDepth < this.simulationDepth) {
            if (currentNode.untriedActions.length > 0) {
                return currentNode.expand();
            } else {
                currentNode = currentNode.uctSelectChild();
            }
            currentDepth++;
        }
        return currentNode;
    }

    rollout(state) {
        let currentState = state;
        while (!currentState.isFinal()) {
            const possibleActions = this.gameEngine.getPossibleActions(currentState);
            const action = possibleActions[Math.floor(Math.random() * possibleActions.length)]
            currentState = this.gameEngine.applyAction(currentState, action);
        }
        return this.gameEngine.calculateTotalScore(currentState.scoreCard)
    }

    decideMove() {
        if (this.root.state.rollsLeft === 3) {
            return new Action('roll', []);  // Directly return an action if no rolls have been made.
        }

        for (let i = 0; i < this.numSimulations; i++) {
            let node = this.simulate(this.root);
            let result = this.rollout(node.state);
            while (node !== null) {
                node.update(result);
                node = node.parent;
            }

            if (this.pruningThreshold !== 0 && i % this.pruningThreshold === 0) {
                this.root.pruneChildren();
            }
        }

        // Sort children based on the expected score and select top X
        let topActions = this.root.children
            .sort((a, b) => (b.totalScore / b.visits) - (a.totalScore / a.visits))
            .slice(0, this.topXActions) // Assuming you want the top 3 actions
            .map(node => ({
                action: node.action,
                totalScore: (node.totalScore * 400),
                visits: node.visits,
                scores: node.scores // Assuming you handle histogram creation elsewhere
            }));


        return topActions; // Return array of top actions with detailed stats
    }
}