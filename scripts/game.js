function getCombinations(array, size) {
    function* doCombination(offset, combo) {
        if (combo.length === size) {
            yield combo;
            return;
        }
        for (let i = offset; i <= array.length - size + combo.length; i++) {
            yield* doCombination(i + 1, combo.concat(array[i]));
        }
    }
    return Array.from(doCombination(0, []));
}



export class State {
	constructor(
		dice = [0, 0, 0, 0, 0], held = [false, false, false, false, false],
		scoreCard = null,
		rollsLeft = 3
	) {
		this.dice = dice;
		this.held = held;
		this.scoreCard = scoreCard || {
			"ones": null,
			"twos": null,
			"threes": null,
			"fours": null,
			"fives": null,
			"sixes": null,
			"three_of_a_kind": null,
			"four_of_a_kind": null,
			"full_house": null,
			"small_straight": null,
			"large_straight": null,
			"yahtzee": null,
			"chance": null
		};
		this.rollsLeft = rollsLeft;
	}

	isFinal() {
		return Object.values(this.scoreCard).every(value => value !== null);
	}
}


export class Action {
	constructor(actionType, details) {
		this.actionType = actionType;
		this.details = details
	}
}


export class GameEngine {
    applyAction(state, action) {
        switch (action.actionType) {
            case 'roll':
	            let newHeld = state.held.slice(); // Make a copy of the current held array
	            newHeld.fill(false); // Assume no dice are held initially

	            // Set only specified dice as held based on the indices in action.details
	            action.details.forEach(index => {
	                newHeld[index] = true;
	            });
	            state.held = newHeld;
	            return this.rollDice(state);
            case 'score':
                return this.score(state, action.details);
        }
    }

	rollDice(state) {
	    if (state.rollsLeft > 0) {
	        const newDice = state.dice.slice();
	        for (let i = 0; i < newDice.length; i++) {
	            if (!state.held[i]) {
	                newDice[i] = Math.floor(Math.random() * 6) + 1;
	            }
	        }
	        return new State(newDice, [false,false,false,false,false], {...state.scoreCard}, state.rollsLeft - 1);
	    }
	    return state;
	}

    score(state, category) {
    	// Need to add upper score board bonus
    	const newScores = { ...state.scoreCard };

        if (newScores[category] !== null) {
            console.log(`Category '${category}' already scored.`);
            return state; // Return the current state unchanged if scoring is attempted on a filled category
        }

        const score = this.calculateScore(category, state.dice);
        newScores[category] = score;

        const upperScore = this.calculateUpperScore(newScores);

        if (upperScore >= 63) {
            newScores["upper_bonus"] = (newScores["upper_bonus"] || 0) + 35;
        }

        // Return a new state with the score updated and dice reset for the next turn
        return new State([0,0,0,0,0], new Array(state.dice.length).fill(false), newScores, 3);
    }

    calculateUpperScore(scoreCard) {
        const upperCategories = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];
        return upperCategories.reduce((total, category) => {
            return total + (scoreCard[category] || 0);
        }, 0);
    }

    calculateLowerScore(scoreCard) {
        const lowerCategories = ['three_of_a_kind', 'four_of_a_kind', 'full_house', 'small_straight', 'large_straight', 'yahtzee', 'chance'];
        return lowerCategories.reduce((total, category) => {
            return total + (scoreCard[category] || 0);
        }, 0);
    }

    calculateTotalScore(scoreCard) {
        const upperScore = this.calculateUpperScore(scoreCard);
        const lowerScore = this.calculateLowerScore(scoreCard);
        const bonus = upperScore >= 63 ? 35 : 0;
        return upperScore + lowerScore + bonus;
    }


    calculateScore(category, dice) {
		const categoryValueMap = {
            'ones': 1,
            'twos': 2,
            'threes': 3,
            'fours': 4,
            'fives': 5,
            'sixes': 6
        };

        let diceCount = {};
        dice.forEach(value => {
            diceCount[value] = (diceCount[value] || 0) + 1;
        });

        if (['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'].includes(category)) {
            const targetValue = categoryValueMap[category];
            return (diceCount[targetValue] || 0) * targetValue;
        } else if (category === 'three_of_a_kind') {
            return Object.values(diceCount).some(c => c >= 3) ? dice.reduce((a, b) => a + b, 0) : 0;
        } else if (category === 'four_of_a_kind') {
            return Object.values(diceCount).some(c => c >= 4) ? dice.reduce((a, b) => a + b, 0) : 0;
        } else if (category === 'full_house') {
            const values = Object.values(diceCount);
            return values.includes(2) && values.includes(3) ? 25 : 0;
        } else if (category === 'small_straight') {
            const straights = [[1, 2, 3, 4], [2, 3, 4, 5], [3, 4, 5, 6]];
            return straights.some(s => s.every(num => dice.includes(num))) ? 30 : 0;
        } else if (category === 'large_straight') {
            const straights = [[1, 2, 3, 4, 5], [2, 3, 4, 5, 6]];
            return straights.some(s => s.every(num => dice.includes(num))) ? 40 : 0;
        } else if (category === 'yahtzee') {
            return new Set(dice).size === 1 ? 50 : 0;
        } else if (category === 'chance') {
            return dice.reduce((a, b) => a + b, 0);
        }

        return 0;
    }

	getPossibleActions(state) {
	    const actions = [];

	    if (state.isFinal()) {
	        return actions; // No actions possible if the game state is final
	    }

	    if (state.rollsLeft === 3) {
	        actions.push(new Action('roll', [])); // Can roll all dice
	    } else if (state.rollsLeft > 0) {
	        // Add action to re-roll all dice
	        actions.push(new Action('roll', []));
	        const indices = [0, 1, 2, 3, 4];
	        // Generate combinations of dice indices to roll subsets of dice
	        for (let r = 1; r <= 5; r++) {
	            actions.push(...getCombinations(indices, r).map(subset => new Action('roll', subset)));
	        }
	    } else if (state.rollsLeft === 0) {
		    for (const category in state.scoreCard) {
		        if (state.scoreCard[category] === null) {
		            actions.push(new Action('score', category));
		        }
		    }
	    }

	    return actions;
	}
}

// Webworker

