<?php

declare(strict_types=1);

namespace OCA\ScoreView\Listener;

use OCA\ScoreView\Service\FeatureConfig;
use OCP\AppFramework\Http\EmptyFeaturePolicy;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\IRequest;
use OCP\Security\FeaturePolicy\AddFeaturePolicyEvent;

/**
 * @template-implements IEventListener<AddFeaturePolicyEvent>
 *
 * Gibt das Mikrofon in der Berechtigungsrichtlinie der Files-Seite frei -
 * fuer Aufnahme, Intonation und Mitverfolgen (S3 in docs/architecture.md).
 *
 * **Warum ueberhaupt.** Nextcloud schickt mit jeder Seite
 * `Feature-Policy: … microphone 'none'`; gemessen liefert
 * `document.featurePolicy.allowsFeature('microphone')` dort `false`, und
 * `getUserMedia` scheitert, bevor der Browser ueberhaupt fragt. Der Viewer
 * haengt per Util::addScript in der Files-Seite und hat keine eigene
 * Response, an der er die Richtlinie setzen koennte - deshalb das Ereignis.
 *
 * **Warum so eng** (S3): Die Erlaubnis des Browsers gilt je Herkunft. Nach
 * „Immer erlauben" duerfte jedes Skript auf JEDER Seite der Instanz ohne
 * Rueckfrage aufnehmen, wenn die Richtlinie es dort zuliesse. Deshalb nur,
 * wenn alle drei Bedingungen gelten:
 *
 * 1. Eine Seite, keine XHR-Antwort - Richtlinien wirken nur an Dokumenten,
 *    an JSON sind sie Rauschen.
 * 2. Mindestens eine Mikrofonfunktion ist eingeschaltet.
 * 3. Der Pfad beginnt mit `/apps/files` - dort, und nur dort, laeuft der
 *    Viewer (wie beim CSP-Listener, Listener\AddCspListener). Dashboard,
 *    Talk und alles Uebrige behalten `'none'`.
 *
 * Was bleibt: Innerhalb von Files gilt eine erteilte Erlaubnis fuer alle
 * Skripte dort - wie bei Talk, feiner geht es mit einer Richtlinie je
 * Dokument nicht.
 *
 * Die Direct-Editing-Seite der mobilen Apps setzt ihre Richtlinie selbst,
 * an der Antwort von DirectEditing\ScoreDirectEditor::open().
 */
class AddFeaturePolicyListener implements IEventListener {
	private const FILES_PATH_PREFIX = '/apps/files';

	public function __construct(
		private IRequest $request,
		private FeatureConfig $features,
	) {
	}

	public function handle(Event $event): void {
		if (!$event instanceof AddFeaturePolicyEvent) {
			return;
		}
		if ($this->isXhr() || !$this->isFilesPage() || !$this->features->usesMicrophone()) {
			return;
		}

		$policy = new EmptyFeaturePolicy();
		$policy->addAllowedMicrophoneDomain("'self'");
		$event->addPolicy($policy);
	}

	/**
	 * Woran Nextcloud selbst eine Hintergrundanfrage erkennt: `@nextcloud/axios`
	 * setzt `X-Requested-With`, OCS-Aufrufe `OCS-APIRequest`.
	 */
	private function isXhr(): bool {
		return strcasecmp($this->request->getHeader('X-Requested-With'), 'XMLHttpRequest') === 0
			|| $this->request->getHeader('OCS-APIRequest') !== '';
	}

	private function isFilesPage(): bool {
		try {
			$path = $this->request->getPathInfo();
		} catch (\Throwable) {
			// Nicht dekodierbar: sicher keine regulaere Files-Seite - im
			// Zweifel gesperrt lassen.
			return false;
		}
		if (!is_string($path)) {
			return false;
		}
		// Exakt `/apps/files` oder darunter - nicht `/apps/files_sharing`.
		return $path === self::FILES_PATH_PREFIX
			|| str_starts_with($path, self::FILES_PATH_PREFIX . '/');
	}
}
