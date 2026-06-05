import { GameEngine, State, Action } from './game.js';
import { Chart, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, BarController } from 'https://cdn.jsdelivr.net/npm/chart.js@4.4.3/+esm';

Chart.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, BarController);

document.addEventListener('DOMContentLoaded', () => {
    const diceElements = document.querySelectorAll('.dice-container .dice');
    const diceBoxes = document.querySelectorAll('.dice-container .dice-box');
    const rollButton = document.getElementById('rollDiceBtn');
    const playerScoreButtons = document.querySelectorAll('#playerScoreboard .score-checkbox');

    const statusMessage = document.getElementById('gameMessage');
    const remainingRolls = document.getElementById('remainingRolls');
    const resetButton = document.getElementById('resetGameBtn');
    const holdCheckboxes = document.querySelectorAll('.hold-dice');
    const thinkingIndicator = document.getElementById('thinkingIndicator');
    const decisionTimeEl = document.getElementById('decisionTime');
    const banner = document.getElementById('recommendationBanner');

    // --- Config (numbers, live) ---
    let numSimulations = Number(document.getElementById('strength').value);
    let UCTCValue = Number(document.getElementById('uctCValue').value);
    document.getElementById('strength').addEventListener('change', e => { numSimulations = Number(e.target.value); });
    document.getElementById('uctCValue').addEventListener('change', e => { UCTCValue = Number(e.target.value); });

    const actionsDetail = document.querySelectorAll('.action-details');
    const worker = new Worker('scripts/mctsWorker.js', { type: 'module' });

    let playerState = new State();
    const gameEngine = new GameEngine();
    let recommendedActions;
    let currentActionIndex = 0;

    updateDiceDisplay(playerState);
    disableScoring(playerScoreButtons);
    aiAssist();

    function prettyCategory(c) { return c.replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase()); }

    function describeAction(action) {
        if (action.actionType === 'score') return `Score in ${prettyCategory(action.details)}`;
        if (!action.details || action.details.length === 0) return 'Re-roll all dice';
        const kept = action.details.map(i => playerState.dice[i]).sort((a, b) => a - b);
        return `Keep ${kept.join(', ')} and re-roll the rest`;
    }

    // ---- Busy / thinking ----
    function setBusy(busy) {
        thinkingIndicator.classList.toggle('hidden', !busy);
        rollButton.disabled = busy;
        resetButton.disabled = busy;
        if (busy) disableScoring(playerScoreButtons);
        else restoreControls();
    }
    function restoreControls() {
        rollButton.disabled = false;
        resetButton.disabled = false;
        if (playerState.rollsLeft === 0 && !playerState.isFinal()) enableScoring(playerScoreButtons);
        else disableScoring(playerScoreButtons);
    }

    // ---- Recommendation highlight ----
    function clearRecommendation() {
        diceBoxes.forEach(b => b.classList.remove('recommended'));
        document.querySelectorAll('#playerScoreboard tr.recommended-category')
            .forEach(tr => tr.classList.remove('recommended-category'));
        banner.classList.add('hidden');
    }
    function highlightRecommendation(action, mean) {
        clearRecommendation();
        if (!action) return;
        if (action.actionType === 'roll') {
            const keep = new Set(action.details || []);
            diceBoxes.forEach((box, i) => { if (keep.has(i)) box.classList.add('recommended'); });
        } else if (action.actionType === 'score') {
            const cb = document.querySelector(`#playerScoreboard .score-checkbox[name="${action.details}"]`);
            if (cb) cb.closest('tr').classList.add('recommended-category');
        }
        banner.textContent = `Recommended: ${describeAction(action)} \u2014 expected final score \u2248 ${mean.toFixed(0)}`;
        banner.classList.remove('hidden');
    }

    function toggleActionDetails(actionIndex) {
        for (let i = 1; i <= 3; i++) {
            const el = document.getElementById(`action${i}`);
            if (i === actionIndex) { el.classList.add('active'); currentActionIndex = actionIndex; }
            else el.classList.remove('active');
        }
        updateChartForAction(actionIndex);
    }

    function updateChartForAction(actionIndex) {
        const a = recommendedActions[actionIndex - 1];
        if (a) createHistogram('outcomeHistogram', a.scores);
    }

    function createHistogram(canvasId, data) {
        const ctx = document.getElementById(canvasId).getContext('2d');
        if (window.myHistogramChart) window.myHistogramChart.destroy();

        const frequency = new Map();
        data.forEach(v => frequency.set(v, (frequency.get(v) || 0) + 1));
        const chartData = [...frequency.entries()]
            .map(([label, freq]) => ({ label, freq }))
            .sort((a, b) => a.label - b.label);

        window.myHistogramChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: chartData.map(d => `${d.label}`),
                datasets: [{
                    label: 'Simulations ending at this final score',
                    data: chartData.map(d => d.freq),
                    backgroundColor: 'rgba(33, 102, 172, 1)',
                    borderColor: 'rgba(33, 102, 172, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                scales: {
                    y: { beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: 'Frequency' } },
                    x: { ticks: { maxRotation: 90, minRotation: 45, autoSkip: true, maxTicksLimit: 20 },
                         title: { display: true, text: 'Final game score' } }
                },
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: true }, tooltip: { enabled: true, mode: 'index', intersect: false } }
            }
        });
    }

    function aiAssist() {
        if (playerState.rollsLeft === 3) { clearRecommendation(); return; }   // forced first roll; nothing to advise

        setBusy(true);
        statusMessage.textContent = 'AI is thinking...';
        const gameConfig = { numSimulations, simulationDepth: 100, UCTCValue, topXActions: 3 };
        const t0 = performance.now();
        worker.postMessage({ stateRepresentationForWorker: playerState, gameConfig });

        worker.onmessage = function (event) {
            recommendedActions = event.data.topActions;
            decisionTimeEl.textContent = `Last decision: ${Math.round(performance.now() - t0)} ms`;
            updateAIAssistant(recommendedActions);
            setBusy(false);
            statusMessage.textContent = 'AI suggestions ready.';
        };
    }

    function updateAIAssistant(topActions) {
        topActions.forEach((action, index) => {
            const mean = action.totalScore / action.visits;
            const variance = action.scores.length > 1
                ? action.scores.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (action.scores.length - 1) : 0;
            const sd = Math.sqrt(variance);
            const se = sd / Math.sqrt(action.scores.length || 1);
            const lo = (mean - 1.96 * se).toFixed(0);
            const hi = (mean + 1.96 * se).toFixed(0);

            document.getElementById(`action${index + 1}`).innerHTML = `
                <span class="action-title"><b>${index + 1}. ${describeAction(action.action)}</b></span><br>
                <b>Expected final score:</b> ${mean.toFixed(1)}
                <span class="action-ci">(95% CI ${lo}\u2013${hi})</span><br>
                <b>Spread (SD):</b> ${sd.toFixed(1)} &nbsp;|&nbsp;
                <b>Simulations:</b> ${action.visits}
            `;
        });
        for (let i = topActions.length; i < 3; i++) document.getElementById(`action${i + 1}`).innerHTML = '';

        const best = topActions[0];
        if (best) highlightRecommendation(best.action, best.totalScore / best.visits);
        toggleActionDetails(1);
    }

    function updateDiceDisplay(state) {
        state.dice.forEach((value, index) => {
            diceElements[index].textContent = value;
            holdCheckboxes[index].checked = state.held[index];
        });
    }

    function updateScoreDisplay(scoreButtons, state) {
        scoreButtons.forEach(checkbox => {
            const scoreOutput = checkbox.closest('tr').querySelector('.score-output');
            scoreOutput.textContent = state.scoreCard[checkbox.name] !== null ? state.scoreCard[checkbox.name] : 0;
            checkbox.checked = state.scoreCard[checkbox.name] !== null;
        });
        const upperScore = gameEngine.calculateUpperScore(state.scoreCard);
        const lowerScore = gameEngine.calculateLowerScore(state.scoreCard);
        const bonus = upperScore >= 63 ? 35 : 0;
        document.querySelector('#playerScoreboard #upperScore').textContent = upperScore;
        document.querySelector('#playerScoreboard #lowerScore').textContent = lowerScore;
        document.querySelector('#playerScoreboard #bonus').textContent = bonus;
        document.querySelector('#playerScoreboard #totalScore').textContent = upperScore + lowerScore + bonus;
    }

    function rollDice() {
        if (playerState.rollsLeft === 0 || playerState.isFinal()) {
            statusMessage.textContent = 'No rolls left or game over.';
            return;
        }
        playerState.held = Array.from(holdCheckboxes, cb => cb.checked);
        playerState = gameEngine.rollDice(playerState);
        clearRecommendation();
        updateDiceDisplay(playerState);
        updateRollsLeftDisplay();
        statusMessage.textContent = 'Dice rolled. Choose your next action.';
        if (playerState.rollsLeft === 0) enableScoring(playerScoreButtons);
        else disableScoring(playerScoreButtons);
    }

    function enableScoring(scoreButtons) { scoreButtons.forEach(b => { b.disabled = false; }); }
    function disableScoring(scoreButtons) { scoreButtons.forEach(b => { b.disabled = true; }); }

    function handleScoreSelection(event) {
        const checkbox = event.target;
        const category = checkbox.name;
        if (playerState.rollsLeft > 0 || playerState.scoreCard[category] !== null) {
            statusMessage.textContent = 'Cannot score at this time or already scored.';
            checkbox.checked = false;
            return;
        }
        playerState = gameEngine.score(playerState, category);
        clearRecommendation();
        updateDiceDisplay(playerState);
        updateScoreDisplay(playerScoreButtons, playerState);
        disableScoring(playerScoreButtons);
        updateRollsLeftDisplay();
        statusMessage.textContent = `Scored on ${prettyCategory(category)}. Roll to start the next turn.`;
    }

    function updateRollsLeftDisplay() {
        remainingRolls.textContent = ` Rolls left: ${playerState.rollsLeft}`;
    }

    function resetGame() {
        playerState = new State();
        clearRecommendation();
        updateDiceDisplay(playerState);
        updateScoreDisplay(playerScoreButtons, playerState);
        disableScoring(playerScoreButtons);
        playerScoreButtons.forEach(b => { b.checked = false; });
        updateRollsLeftDisplay();
        setBusy(false);
        statusMessage.textContent = 'Game reset. Roll the dice to start playing!';
    }

    rollButton.addEventListener('click', () => { rollDice(); aiAssist(); });
    resetButton.addEventListener('click', resetGame);
    playerScoreButtons.forEach(b => b.addEventListener('change', handleScoreSelection));
    actionsDetail.forEach((el, index) => el.addEventListener('click', () => toggleActionDetails(index + 1)));

    document.getElementById('settingsBtn').addEventListener('click', function () {
        const panel = document.getElementById('settingsPanel');
        panel.style.left = (panel.style.left === '0px') ? '-300px' : '0px';
    });
});
