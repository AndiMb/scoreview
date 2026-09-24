<?php

declare(strict_types=1);

namespace OCA\ScoreView\Middleware;

/**
 * Womit sich die laufende Anfrage ausgewiesen hat - gesetzt von
 * DirectAccessMiddleware, gelesen von den Controllern, die danach
 * unterscheiden muessen (Controller\SetlistController).
 *
 * **Warum ein eigener Traeger.** Fuer die meisten Routen ist die Art des
 * Ausweises gleichgueltig: Die Nutzerin ist gesetzt, ihr Dateibaum
 * entscheidet. Beim Schreiben einer Setliste nicht (S2): Mit
 * einem Token darf nur hinein, was um die offene Partitur herum liegt,
 * sonst liesse sich die Erlaubnis fuer eine Datei ueber eine selbst
 * angelegte Liste und die Ausgabe von Begleit-Token auf alle ausweiten.
 * Der Controller braucht dafuer die Datei des Direct-Editing-Tokens - und
 * die kennt nur die Middleware.
 *
 * Middleware und Controller muessen dafuer dieselbe Instanz sehen. Darauf
 * verlaesst sich die App nicht stillschweigend: AppInfo\Application
 * registriert die Klasse ausdruecklich als geteilten Dienst, und wer nach dem
 * Ausweis unterscheidet, fragt zuerst resolved() - hat die Middleware diese
 * Instanz nicht gesehen (anders verdrahtet, Route ohne Attribut), gilt das als
 * Fehler und nicht als Sitzung. SESSION als Voreinstellung heisst „keine
 * Grenze"; ein Fehler in der Verdrahtung darf nicht darauf hinauslaufen.
 */
class DirectAccessContext {
	public const SESSION = 'session';
	public const DIRECT = 'direct';
	public const COMPANION = 'companion';

	private string $mode = self::SESSION;
	private ?int $originFileId = null;
	private ?string $directDigest = null;
	private bool $resolved = false;

	/** Die Middleware hat eine angemeldete Sitzung festgestellt. */
	public function setSession(): void {
		$this->mode = self::SESSION;
		$this->originFileId = null;
		$this->directDigest = null;
		$this->resolved = true;
	}

	/**
	 * @param int $originFileId die Datei des Direct-Editing-Tokens
	 * @param string $directDigest CompanionTokenService::digest() des Tokens -
	 *                             nie das Token selbst, es soll ueber diese
	 *                             Anfrage hinaus nirgends liegen
	 */
	public function setToken(string $mode, int $originFileId, string $directDigest): void {
		$this->mode = $mode;
		$this->originFileId = $originFileId;
		$this->directDigest = $directDigest;
		$this->resolved = true;
	}

	/**
	 * Ob die Middleware diese Anfrage eingeordnet hat. Nur dann ist mode()
	 * eine Aussage - sonst ist es die Voreinstellung.
	 */
	public function resolved(): bool {
		return $this->resolved;
	}

	public function mode(): string {
		return $this->mode;
	}

	/** Ob die Anfrage per Token kam, gleich welcher Art. */
	public function isToken(): bool {
		return $this->mode !== self::SESSION;
	}

	public function originFileId(): ?int {
		return $this->originFileId;
	}

	public function directDigest(): ?string {
		return $this->directDigest;
	}
}
