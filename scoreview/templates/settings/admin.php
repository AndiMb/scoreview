<?php
declare(strict_types=1);
/** @var array $_ */
/** @var \OCP\IL10N $l */
?>
<div id="scoreview-admin-settings" class="section">
	<h2><?php p($l->t('ScoreView')); ?></h2>
	<p><?php p($l->t('Address and shared secret of the MuseScore sidecar container (see sidecar/README.md).')); ?></p>

	<form id="scoreview-settings-form">
		<p>
			<label for="scoreview-sidecar-url"><?php p($l->t('Sidecar URL')); ?></label><br>
			<input type="text" id="scoreview-sidecar-url" name="sidecarUrl"
				placeholder="http://scoreview-sidecar:8765"
				value="<?php p($_['sidecarUrl']); ?>" style="width: 320px;">
		</p>
		<p>
			<label for="scoreview-sidecar-secret"><?php p($l->t('Shared secret')); ?></label><br>
			<input type="password" id="scoreview-sidecar-secret" name="sidecarSecret"
				placeholder="<?php p($_['sidecarSecretSet'] ? $l->t('••••••• (set, leave empty = unchanged)') : $l->t('not set yet')); ?>"
				style="width: 320px;">
		</p>
		<p>
			<input type="checkbox" id="scoreview-eager-conversion" name="eagerConversion"
				<?php p($_['eagerConversion'] ? 'checked' : ''); ?>>
			<label for="scoreview-eager-conversion"><?php p($l->t('Convert new/changed scores immediately (instead of on first open)')); ?></label>
		</p>
		<p>
			<label for="scoreview-soundfont-url"><?php p($l->t('Custom SoundFont URL (SF2/SF3, optional)')); ?></label><br>
			<input type="text" id="scoreview-soundfont-url" name="soundFontUrl"
				placeholder="https://…/MuseScore_General.sf3"
				value="<?php p($_['soundFontUrl']); ?>" style="width: 320px;">
			<br>
			<em><?php p($l->t('Leave empty: playback then uses the SoundFont that the sidecar brings along (MuseScore General Lite, ~40 MB), delivered by the app itself. Only fill in if a different SoundFont should be used - that address must then be reachable via HTTP(S) from the browser and allow CORS.')); ?></em>
		</p>
		<p>
			<button type="submit"><?php p($l->t('Save')); ?></button>
			<span id="scoreview-settings-status"></span>
		</p>
	</form>
</div>
