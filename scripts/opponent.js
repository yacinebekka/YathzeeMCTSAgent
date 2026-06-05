import { GameEngine, State, Action } from './game.js';

document.addEventListener('DOMContentLoaded', () => {
    const diceElements = document.querySelectorAll('.dice-container .dice');
    const rollButton = document.getElementById('rollDiceBtn');
    const aiScoreButtons = document.querySelectorAll('#aiScoreboard .score-checkbox');
    const playerScoreButtons = document.querySelectorAll('#playerScoreboard .score-checkbox');

    const statusMessage = document.getElementById('gameMessage');
    const aiReasoning = document.getElementById('aiReasoning');
    const remainingRolls = document.getElementById('remainingRolls');
    const resetButton = document.getElementById('resetGameBtn');
    const holdCheckboxes = document.querySelectorAll('.hold-dice');
    const thinkingIndicator = document.getElementById('thinkingIndicator');
    const decisionTimeEl = document.getElementById('decisionTime');

    // --- Config (parsed as numbers, updated live) ---
    let numSimulations = Number(document.getElementById('strength').value);
    let UCTCValue = Number(document.getElementById('uctCValue').value);
    document.getElementById('strength').addEventListener('change', e => { numSimulations = Number(e.target.value); });
    document.getElementById('uctCValue').addEventListener('change', e => { UCTCValue = Number(e.target.value); });

    const worker = new Worker('scripts/mctsWorker.js', { type: 'module' });

    let playerState = new State();
    let aiState = new State();
    const gameEngine = new GameEngine();
    let playerTurn = true;

    updateDiceDisplay(playerState);
    disableScoring(aiScoreButtons);
    disableScoring(playerScoreButtons);

    // ---- Busy / thinking state ----
    function setBusy(busy) {
        thinkingIndicator.classList.toggle('hidden', !busy);
        rollButton.disabled = busy;
        resetButton.disabled = busy;
        if (busy) disableScoring(playerScoreButtons);
    }

    function prettyCategory(c) {
        return c.replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase());
    }

    function describeAIAction(action, before) {
        if (action.actionType === 'score') {
            const pts = gameEngine.calculateScore(action.details, before.dice);
            return `AI scored ${prettyCategory(action.details)} for ${pts}.`;
        }
        if (!action.details || action.details.length === 0) return 'AI re-rolled all dice.';
        const kept = action.details.map(i => before.dice[i]).sort((a, b) => a - b);
        return `AI kept ${kept.join(', ')} and re-rolled the rest.`;
    }

    function aiPlay() {
        setBusy(true);
        statusMessage.textContent = 'AI is thinking...';
        updateDiceDisplay(aiState);

        if (aiState.rollsLeft === 3) {                       // forced first roll, no search
            aiState = gameEngine.applyAction(aiState, new Action('roll', []));
            aiPlay();
            return;
        }

        const gameConfig = { numSimulations, simulationDepth: 100, UCTCValue, topXActions: 1 };
        const t0 = performance.now();
        worker.postMessage({ stateRepresentationForWorker: aiState, gameConfig });

        worker.onmessage = function (event) {
            const { topActions } = event.data;
            const action = topActions[0].action;
            const before = aiState;

            decisionTimeEl.textContent = `Last decision: ${Math.round(performance.now() - t0)} ms`;
            aiReasoning.textContent = describeAIAction(action, before);

            aiState = gameEngine.applyAction(before, action);
            updateDiceDisplay(aiState);
            updateScoreDisplay(aiScoreButtons, aiState, false);

            if (action.actionType === 'score') {
                playerTurn = true;
                setBusy(false);
                statusMessage.textContent = 'Your turn. Roll or score.';
                checkGameOver();
            } else {
                aiPlay();                                    // continue the AI's turn
            }
        };
    }

    function updateDiceDisplay(state) {
        state.dice.forEach((value, index) => {
            diceElements[index].textContent = value;
            holdCheckboxes[index].checked = state.held[index];
        });
    }

    function updateScoreDisplay(scoreButtons, state, isHuman) {
        scoreButtons.forEach(checkbox => {
            const scoreOutput = checkbox.closest('tr').querySelector('.score-output');
            scoreOutput.textContent = state.scoreCard[checkbox.name] !== null ? state.scoreCard[checkbox.name] : 0;
            checkbox.checked = state.scoreCard[checkbox.name] !== null;
        });
        const board = isHuman ? '#playerScoreboard' : '#aiScoreboard';
        const upperScore = gameEngine.calculateUpperScore(state.scoreCard);
        const lowerScore = gameEngine.calculateLowerScore(state.scoreCard);
        const bonus = upperScore >= 63 ? 35 : 0;
        document.querySelector(`${board} #upperScore`).textContent = upperScore;
        document.querySelector(`${board} #lowerScore`).textContent = lowerScore;
        document.querySelector(`${board} #bonus`).textContent = bonus;
        document.querySelector(`${board} #totalScore`).textContent = upperScore + lowerScore + bonus;
    }

    function rollDice() {
        if (!playerTurn || playerState.rollsLeft === 0 || playerState.isFinal()) {
            statusMessage.textContent = 'No rolls left or game over.';
            return;
        }
        playerState.held = Array.from(holdCheckboxes, cb => cb.checked);
        playerState = gameEngine.rollDice(playerState);
        updateDiceDisplay(playerState);
        updateRollsLeftDisplay();
        statusMessage.textContent = 'Dice rolled. Choose your next action.';
        if (playerState.rollsLeft === 0) enableScoring(playerScoreButtons);
        else disableScoring(playerScoreButtons);
    }

    function enableScoring(scoreButtons) {
        scoreButtons.forEach(b => { b.disabled = false; });
        statusMessage.textContent = 'Select a score category to apply your points.';
    }
    function disableScoring(scoreButtons) {
        scoreButtons.forEach(b => { b.disabled = true; });
    }

    function handleScoreSelection(event) {
        const checkbox = event.target;
        const category = checkbox.name;
        if (!playerTurn || playerState.rollsLeft > 0 || playerState.scoreCard[category] !== null) {
            statusMessage.textContent = 'Cannot score at this time or already scored.';
            checkbox.checked = false;
            return;
        }
        playerState = gameEngine.score(playerState, category);
        updateDiceDisplay(playerState);
        updateScoreDisplay(playerScoreButtons, playerState, true);
        disableScoring(playerScoreButtons);
        updateRollsLeftDisplay();

        playerTurn = false;
        statusMessage.textContent = `Scored on ${prettyCategory(category)}. AI's turn next.`;
        if (playerState.isFinal() && aiState.isFinal()) { checkGameOver(); return; }
        aiPlay();
    }

    function updateRollsLeftDisplay() {
        remainingRolls.textContent = ` Rolls left: ${playerState.rollsLeft}`;
    }

    // ---- End of game ----
    function checkGameOver() {
        if (!(playerState.isFinal() && aiState.isFinal())) return;
        const p = gameEngine.calculateTotalScore(playerState.scoreCard);
        const a = gameEngine.calculateTotalScore(aiState.scoreCard);
        const title = p > a ? 'You win! \uD83C\uDF89' : (a > p ? 'AI wins' : "It's a tie");
        document.getElementById('endGameTitle').textContent = title;
        document.getElementById('endGameDetail').textContent = `Final score \u2014 You: ${p}, AI: ${a}`;
        document.getElementById('endGameModal').classList.remove('hidden');
    }

    function resetGame() {
        playerState = new State();
        aiState = new State();
        playerTurn = true;
        updateDiceDisplay(playerState);
        updateScoreDisplay(playerScoreButtons, playerState, true);
        updateScoreDisplay(aiScoreButtons, aiState, false);
        disableScoring(playerScoreButtons);
        disableScoring(aiScoreButtons);
        playerScoreButtons.forEach(b => { b.checked = false; });
        aiScoreButtons.forEach(b => { b.checked = false; });
        updateRollsLeftDisplay();
        aiReasoning.textContent = '';
        setBusy(false);
        document.getElementById('endGameModal').classList.add('hidden');
        statusMessage.textContent = 'Game reset. Roll the dice to start playing!';
    }

    rollButton.addEventListener('click', rollDice);
    resetButton.addEventListener('click', resetGame);
    document.getElementById('playAgainBtn').addEventListener('click', resetGame);
    playerScoreButtons.forEach(b => b.addEventListener('change', handleScoreSelection));

    document.getElementById('settingsBtn').addEventListener('click', function () {
        const panel = document.getElementById('settingsPanel');
        panel.style.left = (panel.style.left === '0px') ? '-300px' : '0px';
    });
});
