import { GameEngine, State, Action } from './game.js';
import { Chart, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, BarController } from 'https://cdn.jsdelivr.net/npm/chart.js@4.4.3/+esm'

Chart.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  BarController
);

document.addEventListener('DOMContentLoaded', () => {
    const diceElements = document.querySelectorAll('.dice-container .dice');
    const rollButton = document.getElementById('rollDiceBtn');
	const playerScoreButtons = document.querySelectorAll('#playerScoreboard .score-checkbox');

    const statusMessage = document.getElementById('gameMessage');
    const remainingRolls = document.getElementById('remainingRolls');
    const resetButton = document.getElementById('resetGameBtn');
    const holdCheckboxes = document.querySelectorAll('.hold-dice');

    let numSimulations = document.getElementById('numSimulations').value;
    let simulationDepth = document.getElementById('depth').value;
    let UCTCValue = document.getElementById('uctCValue').value;
    let pruningFactor = document.getElementById('pruningFactor').value;
    let pruningThreshold = document.getElementById('pruningThreshold').value;

    const actionsDetail = document.querySelectorAll('.action-details');

    const worker = new Worker('scripts/mctsWorker.js', { type: 'module' });

    const canvas = document.getElementById('outcomeHistogram');
    const container = document.getElementById('histogramContainer');

	let playerState = new State();
	const gameEngine = new GameEngine();
	let playerTurn = true;

    let recommendedActions;

    let currentActionIndex = 0; // Track the currently selected action

	updateDiceDisplay(playerState);
	disableScoring(playerScoreButtons);
    aiAssist();

    function toggleActionDetails(actionIndex) {
        // Update UI to reflect which action is selected
        for (let i = 1; i <= 3; i++) {
            const element = document.getElementById(`action${i}`);
            if (i === actionIndex) {
                element.classList.add('active'); // Add a class to highlight or show details
                currentActionIndex = actionIndex;
            } else {
                element.classList.remove('active');
            }
        }

        // Call to update the chart based on the selected action
        updateChartForAction(actionIndex);
    }

    function updateChartForAction(actionIndex) {
        // Fetch data corresponding to the selected action
        const actionData = recommendedActions[actionIndex - 1].scores; // Assuming topActions is globally accessible
        const labels = actionData.map((_, idx) => `Attempt ${idx + 1}`);
        createHistogram('outcomeHistogram', labels, actionData);
    }


    function createHistogram(canvasId, labels, data) {
        const ctx = document.getElementById(canvasId).getContext('2d');
        if (window.myHistogramChart) {
            window.myHistogramChart.destroy();
        }

        // Calculate frequency of each score
        let frequencyMap = new Map();
        data.forEach((value, index) => {
            if (frequencyMap.has(value)) {
                frequencyMap.set(value, frequencyMap.get(value) + 1);
            } else {
                frequencyMap.set(value, 1);
                labels.push(value); // Only push new labels for unique values
            }
        });

        // Prepare labels and corresponding frequency data
        let chartData = Array.from(frequencyMap.keys()).map(key => ({
            label: key,
            freq: frequencyMap.get(key)
        }));

        // Sort data based on the score value (labels are the scores here)
        chartData.sort((a, b) => a.label - b.label);

        window.myHistogramChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: chartData.map(data => `${data.label}`),
                datasets: [{
                    label: 'Frequency of estimated state-action value',
                    data: chartData.map(data => data.freq),
                    backgroundColor: 'rgba(33, 102, 172, 1)', // Darker blue and less transparency
                    borderColor: 'rgba(33, 102, 172, 1)', // Darker blue for the border
                    borderWidth: 1
                }]
            },
            options: {
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            precision: 0 // Ensures that the scale ticks are whole numbers
                        }
                    },
                    x: {
                        ticks: {
                            maxRotation: 90, // Rotate labels to 90 degrees
                            minRotation: 45, // Minimum rotation at 45 degrees
                            autoSkip: true, // Enable automatic label skipping
                            maxTicksLimit: 20 // Adjust as needed based on data
                        }
                    }
                },
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true
                    },
                    tooltip: {
                        enabled: true,
                        mode: 'index',
                        intersect: false
                    }
                }
            }
        });
    }

	function aiAssist() {

        if (playerState.rollsLeft === 3) {
            return;
        }

		statusMessage.textContent = "AI is thinking...";

		const gameConfig = {
	        numSimulations: numSimulations,
	        simulationDepth: simulationDepth,
	        pruningThreshold: pruningThreshold,
	        UCTCValue: UCTCValue,
	        pruningFactor: pruningFactor,
            topXActions : 3
	    };

        let stateRepresentationForWorker = playerState;

        worker.postMessage({ stateRepresentationForWorker, gameConfig });

        worker.onmessage = function(event) {
            const { topActions } = event.data;
            recommendedActions = topActions;
            console.log(topActions);
            updateAIAssistant(topActions);
            statusMessage.textContent = "AI suggestions ready.";
        };
	}


    function updateAIAssistant(topActions) {
        // Assuming topActions is an array of objects with necessary data
        topActions.forEach((action, index) => {
            console.log(action);
            let mean = action.totalScore / action.visits;
            let sampleVariance = action.scores.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) /  (action.scores.length - 1);

            const actionElement = document.getElementById(`action${index + 1}`);
            // Display action details and statistics
            actionElement.innerHTML = `
                <b>Action:</b> ${action.action.actionType} |
                <b>Details:</b> ${JSON.stringify(action.action.details)} <br>
                <b>Estimated state-action value:</b> ${mean.toFixed(2)} <br>
                <b>Standard error:</b> ${Math.sqrt(sampleVariance / action.scores.length).toFixed(2)} <br>
                <b>Sample standard deviation :</b> ${Math.sqrt(sampleVariance).toFixed(2)} <br>
                <b>Sample size:</b> ${action.visits}
            `;      
        });

        if (topActions.length < 3) {
            const actionElement = document.getElementById(`action3`);
            actionElement.innerHTML = ``;

            if (topActions.length < 2) {
                const actionElement = document.getElementById(`action2`);
                actionElement.innerHTML = ``;               
            };
        };

        toggleActionDetails(1);

    }



    // Function to update the display of dice on the page
    function updateDiceDisplay(state) {
        state.dice.forEach((value, index) => {
            diceElements[index].textContent = value;
            holdCheckboxes[index].checked = state.held[index];
        });
    }

    function updateScoreDisplay(scoreButtons, state, isHuman) {
        scoreButtons.forEach(checkbox => {
            const category = checkbox.name;
            const scoreOutput = checkbox.closest('tr').querySelector('.score-output');
            scoreOutput.textContent = state.scoreCard[category] !== null ? state.scoreCard[category] : 0;
            checkbox.checked = state.scoreCard[category] !== null; 
        });
    	// Display calculations

    	let upperScoreDisplay, lowerScoreDisplay, bonusDisplay, totalScoreDisplay;

    	if (isHuman === true) {
	   		upperScoreDisplay = document.querySelector('#playerScoreboard #upperScore');
	        lowerScoreDisplay = document.querySelector('#playerScoreboard #lowerScore');
	        bonusDisplay = document.querySelector('#playerScoreboard #bonus');
	        totalScoreDisplay = document.querySelector('#playerScoreboard #totalScore');
    	} else {
	   		upperScoreDisplay = document.querySelector('#aiScoreboard  #upperScore');
	        lowerScoreDisplay = document.querySelector('#aiScoreboard  #lowerScore');
	        bonusDisplay = document.querySelector('#aiScoreboard  #bonus');
	        totalScoreDisplay = document.querySelector('#aiScoreboard  #totalScore');    		
    	};


        const upperScore = gameEngine.calculateUpperScore(state.scoreCard);
        const lowerScore = gameEngine.calculateLowerScore(state.scoreCard);
        const bonus = upperScore >= 63 ? 35 : 0;
        const totalScore = upperScore + lowerScore + bonus;

        upperScoreDisplay.textContent = upperScore;
        lowerScoreDisplay.textContent = lowerScore;
        bonusDisplay.textContent = bonus;
        totalScoreDisplay.textContent = totalScore;
    }

    // Function to roll the dice
    function rollDice() {
        if (!playerTurn || playerState.rollsLeft === 0 || playerState.isFinal()) {
            statusMessage.textContent = "No rolls left or game over.";
            return;
        }

        playerState.held = Array.from(holdCheckboxes, checkbox => checkbox.checked)
        playerState = gameEngine.rollDice(playerState, playerState.dice.map((_, index) => !holdCheckboxes[index].checked));

        updateDiceDisplay(playerState);
        updateRollsLeftDisplay();
        statusMessage.textContent = "Dice rolled. Choose your next action.";

        if (playerState.rollsLeft === 0) {
            enableScoring(playerScoreButtons);
        } else {
            disableScoring(playerScoreButtons);
        }

    }

    function enableScoring(scoreButtons) {
        scoreButtons.forEach(button => {
            button.disabled = false;
        });
        statusMessage.textContent = "Select a score category to apply your points.";
    }

    function disableScoring(scoreButtons) {
        scoreButtons.forEach(button => {
            button.disabled = true;
        });
    }

    function handleScoreSelection(event) {
        const checkbox = event.target;
        const category = checkbox.name;
        if (!playerTurn || playerState.rollsLeft > 0 || playerState.scoreCard[category] !== null) {
            statusMessage.textContent = "Cannot score at this time or already scored.";
	        checkbox.checked = false; // Prevent checkbox from being checked
	        return;
        }

        playerState = gameEngine.score(playerState, category);
        playerState.dice.forEach((value, index) => {
            diceElements[index].textContent = value;
            holdCheckboxes[index].checked = playerState.held[index];
        });

        updateScoreDisplay(playerScoreButtons, playerState, true);
        disableScoring(playerScoreButtons); // Ensure no further scoring until next turn
        updateRollsLeftDisplay();

        //playerTurn = false;
        statusMessage.textContent = `Scored on ${category}`;
    }

    // Function to update remaining rolls display
    function updateRollsLeftDisplay() {
        remainingRolls.textContent = ` Rolls left: ${playerState.rollsLeft}`;
    }

    function resetGame() {
        playerState = new State();
        updateDiceDisplay(playerState);
        updateScoreDisplay(playerScoreButtons, playerState, true);
        disableScoring(playerScoreButtons)
        playerScoreButtons.forEach(button => {
            button.checked = false;
        });

        updateRollsLeftDisplay();
        statusMessage.textContent = "Game reset. Roll the dice to start playing!";
    }

    // Event listener for rolling dice
    rollButton.addEventListener('click', function() {
            rollDice();
            aiAssist();  // Get AI suggestions after rolling
    });

    // Event listener for resetting the game
    resetButton.addEventListener('click', resetGame);

    playerScoreButtons.forEach(button => {
        button.addEventListener('change', handleScoreSelection);
    });

    actionsDetail.forEach((actionDetail, index) => {
        actionDetail.addEventListener('click', () => toggleActionDetails(index + 1));
    });


    // Setting panel
    document.getElementById('settingsBtn').addEventListener('click', function() {
	    const settingsPanel = document.getElementById('settingsPanel');
	    if (settingsPanel.style.left === '0px') {
	        settingsPanel.style.left = '-300px';
		    numSimulations = document.getElementById('numSimulations').value;
		    simulationDepth = document.getElementById('depth').value;
		    UCTCValue = document.getElementById('uctCValue').value;
		    pruningFactor = document.getElementById('pruningFactor').value;
		    pruningThreshold = document.getElementById('pruningThreshold').value;
	    } else {
	        settingsPanel.style.left = '0px';
	    }
	});

});