import { GameEngine, State, Action } from './game.js';

document.addEventListener('DOMContentLoaded', () => {
    const diceElements = document.querySelectorAll('.dice-container .dice');
    const rollButton = document.getElementById('rollDiceBtn');
	const aiScoreButtons = document.querySelectorAll('#aiScoreboard .score-checkbox');
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

    const worker = new Worker('scripts/mctsWorker.js', { type: 'module' });

	let playerState = new State();
	let aiState = new State();
	const gameEngine = new GameEngine();
	let playerTurn = true;

	updateDiceDisplay(playerState);
	disableScoring(aiScoreButtons);
	disableScoring(playerScoreButtons);

	function aiPlay() {

		statusMessage.textContent = "AI is thinking...";

		const gameConfig = {
	        numSimulations: numSimulations,
	        simulationDepth: simulationDepth,
	        pruningThreshold: pruningThreshold,
	        UCTCValue: UCTCValue,
	        pruningFactor: pruningFactor,
            topXActions : 1
	    };

		updateDiceDisplay(aiState);

		// possibleActions = gameEngine.getPossibleActions(aiState);
		// chosenAction = possibleActions[Math.floor(Math.random()*possibleActions.length)];
		// aiState = gameEngine.applyAction(aiState, chosenAction);

        if (aiState.rollsLeft === 3) {
            aiState = gameEngine.applyAction(aiState, new Action('roll', []));
            aiPlay()
        } else {
            let stateRepresentationForWorker = aiState;
            worker.postMessage({ stateRepresentationForWorker, gameConfig });

            worker.onmessage = function(event) {
                const { topActions } = event.data;
                console.log(topActions);
                aiState = gameEngine.applyAction(aiState, topActions[0].action);

                updateDiceDisplay(aiState);
                updateScoreDisplay(aiScoreButtons, aiState, false);
                statusMessage.textContent = "AI move completed.";
                
                if (topActions[0].action.actionType === "score") {
                    playerTurn = true;
                    statusMessage.textContent = "Your turn. Roll or score.";
                } else {
                    aiPlay(); // Trigger next AI action if not scoring
                }
            };
        }
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

    	console.log(isHuman);
    	console.log(upperScoreDisplay);

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

        playerTurn = false;
        statusMessage.textContent = `Scored on ${category}. AI's turn next.`;
        aiPlay();
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

        aiState = new State();
        updateDiceDisplay(aiState);
        updateScoreDisplay(aiScoreButtons, aiState, false);
        disableScoring(aiScoreButtons)
        aiScoreButtons.forEach(button => {
            button.checked = false;
        });

        updateRollsLeftDisplay();
        statusMessage.textContent = "Game reset. Roll the dice to start playing!";
    }

    // Event listener for rolling dice
    rollButton.addEventListener('click', rollDice);

    // Event listener for resetting the game
    resetButton.addEventListener('click', resetGame);

    playerScoreButtons.forEach(button => {
        button.addEventListener('change', handleScoreSelection);
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
