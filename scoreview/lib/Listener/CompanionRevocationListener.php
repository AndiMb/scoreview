<?php

declare(strict_types=1);

namespace OCA\ScoreView\Listener;

use OCA\ScoreView\Service\CompanionTokenService;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\User\Events\PasswordUpdatedEvent;
use OCP\User\Events\UserChangedEvent;

/**
 * @template-implements IEventListener<PasswordUpdatedEvent|UserChangedEvent>
 *
 * Widerruft alle Begleit-Token einer Nutzerin, indem ihre Epoche steigt
 * (Service\CompanionTokenService, S1 in docs/architecture.md).
 *
 * Zwei Anlaesse, weil es genau fuer diese beiden ein Ereignis gibt, das in
 * Nextcloud 31 bis 35 verlaesslich feuert:
 *
 * - **Passwortwechsel** (PasswordUpdatedEvent): Wer sein Passwort aendert,
 *   weil er einen Verlust vermutet, erwartet, dass danach nichts Altes mehr
 *   gilt.
 * - **Deaktivieren** (UserChangedEvent mit `enabled` = false - ein eigenes
 *   Ereignis dafuer gibt es nicht): Die Middleware lehnt deaktivierte
 *   Konten ohnehin bei jeder Anfrage ab; die Epoche sorgt dafuer, dass
 *   Token aus der Zeit davor auch nach dem Wiederaktivieren nicht wieder
 *   aufleben.
 *
 * **Bewusst nicht:** „Alle Geraete abmelden". Dafuer gibt es kein Ereignis.
 * Das naechstliegende, TokenInvalidatedEvent (erst ab Nextcloud 32), feuert
 * je einzelnem Anmeldetoken - auch bei jeder gewoehnlichen Abmeldung im
 * Browser - und wuerde damit der Chorsaengerin mitten im Konzert die
 * Setliste abschiessen, weil sie sich am Rechner abgemeldet hat. Es haelfe
 * auch nicht: Die Wurzel eines Begleiters ist das Direct-Editing-Token, und
 * das haengt an keinem Anmeldetoken; die Seite holte sich sofort neue.
 */
class CompanionRevocationListener implements IEventListener {
	public function __construct(
		private CompanionTokenService $companions,
	) {
	}

	public function handle(Event $event): void {
		if ($event instanceof PasswordUpdatedEvent) {
			$this->companions->bumpEpoch($event->getUser()->getUID());
			return;
		}
		if ($event instanceof UserChangedEvent
			&& $event->getFeature() === 'enabled'
			&& $event->getValue() === false) {
			$this->companions->bumpEpoch($event->getUser()->getUID());
		}
	}
}
