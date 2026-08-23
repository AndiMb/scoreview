<?php
declare(strict_types=1);
/** @var array $_ */
/** @var \OCP\IL10N $l */
?>
<div id="scoreview-admin-settings" class="section">
	<h2><?php p($l->t('ScoreView')); ?></h2>
	<p><?php p($l->t('Adresse und Shared Secret des MuseScore-Sidecar-Containers (siehe sidecar/README.md).')); ?></p>

	<form id="scoreview-settings-form">
		<p>
			<label for="scoreview-sidecar-url"><?php p($l->t('Sidecar-URL')); ?></label><br>
			<input type="text" id="scoreview-sidecar-url" name="sidecarUrl"
				placeholder="http://scoreview-sidecar:8765"
				value="<?php p($_['sidecarUrl']); ?>" style="width: 320px;">
		</p>
		<p>
			<label for="scoreview-sidecar-secret"><?php p($l->t('Shared Secret')); ?></label><br>
			<input type="password" id="scoreview-sidecar-secret" name="sidecarSecret"
				placeholder="<?php p($_['sidecarSecretSet'] ? $l->t('••••••• (gesetzt, leer lassen = unverändert)') : $l->t('noch nicht gesetzt')); ?>"
				style="width: 320px;">
		</p>
		<p>
			<input type="checkbox" id="scoreview-eager-conversion" name="eagerConversion"
				<?php p($_['eagerConversion'] ? 'checked' : ''); ?>>
			<label for="scoreview-eager-conversion"><?php p($l->t('Neue/geänderte Partituren sofort konvertieren (statt erst beim ersten Öffnen)')); ?></label>
		</p>
		<p>
			<label for="scoreview-soundfont-url"><?php p($l->t('Eigene SoundFont-URL (SF2/SF3, optional)')); ?></label><br>
			<input type="text" id="scoreview-soundfont-url" name="soundFontUrl"
				placeholder="https://…/MuseScore_General.sf3"
				value="<?php p($_['soundFontUrl']); ?>" style="width: 320px;">
			<br>
			<em><?php p($l->t('Leer lassen genügt: die Wiedergabe verwendet dann das SoundFont, das der Sidecar mitbringt (MuseScore General Lite, ~40 MB), ausgeliefert über die App selbst. Nur eintragen, wenn ein anderes SoundFont klingen soll - die Adresse muss dann vom Browser aus per HTTP(S) erreichbar sein und CORS erlauben.')); ?></em>
		</p>
		<p>
			<button type="submit"><?php p($l->t('Speichern')); ?></button>
			<span id="scoreview-settings-status"></span>
		</p>
	</form>
</div>
