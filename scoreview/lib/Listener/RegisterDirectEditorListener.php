<?php

declare(strict_types=1);

namespace OCA\ScoreView\Listener;

use OCA\ScoreView\DirectEditing\ScoreDirectEditor;
use OCP\DirectEditing\RegisterDirectEditorEvent;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;

/**
 * @template-implements IEventListener<RegisterDirectEditorEvent>
 *
 * Das Ereignis wird von zwei Stellen des Kerns ausgeloest - vom OCS-Endpunkt,
 * an dem die mobilen Apps die Editorliste holen, und vom Controller, der die
 * Editorseite ausliefert (OCA\Files\Controller\DirectEditingViewController).
 * Deshalb gehoert die Registrierung nach register(), nicht nach boot().
 */
class RegisterDirectEditorListener implements IEventListener {
	public function __construct(
		private ScoreDirectEditor $editor,
	) {
	}

	public function handle(Event $event): void {
		if (!$event instanceof RegisterDirectEditorEvent) {
			return;
		}
		$event->register($this->editor);
	}
}
