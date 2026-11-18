// What the line over the score says about automatic page turning
// (useScoreFollower.js): readable from the music stand, so a few words per
// state. Pure, with the translation passed in, so the wording per state is
// testable without Nextcloud and the viewer only shows the result.

/**
 * @param {object} follower
 * @param {string} follower.error the follower's error, if any - it wins
 * @param {boolean} follower.active whether it listens at all
 * @param {string} follower.phase 'waiting' | 'following' | 'unsure' | 'lost' | ...
 * @param {boolean} follower.held waiting because the singer asked it to (Wait)
 * @param {(text: string) => string} t the app's translate wrapper
 * @return {string} empty when there is nothing to show
 */
export function followerStatusText({ error, active, phase, held }, t) {
	if (error) {
		return error
	}
	if (!active) {
		return ''
	}
	switch (phase) {
		case 'waiting':
			return held
				? t('Waiting - tap the note where you start again')
				: t('Listening - tap the note where the singing starts')
		case 'following':
		case 'unsure':
			return t('Following')
		case 'lost':
			return t('Lost the place - tap the note where you are')
		default:
			return t('Listening - tap the note where the singing starts')
	}
}
