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
			<button type="submit"><?php p($l->t('Speichern')); ?></button>
			<span id="scoreview-settings-status"></span>
		</p>
	</form>
</div>
