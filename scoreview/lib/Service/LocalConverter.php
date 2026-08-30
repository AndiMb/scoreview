<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Db\ScoreConversion;
use OCP\IAppConfig;
use OCP\ITempManager;
use Psr\Log\LoggerInterface;

/**
 * Der zweite Konvertierungsweg: MuseScore 4.7.4 als WebAssembly, ausgefuehrt
 * von der Node-Laufzeit des Servers (siehe docs/architecture.md E3). Kein
 * Container, kein X-Server, kein HTTP - ein Kindprozess je Partitur.
 *
 * Die eigentliche Arbeit macht `converter/convert.mjs`; diese Klasse startet
 * ihn, bewacht ihn und liest die Artefakte zurueck. Sie kennt bewusst nichts
 * vom Wasm-Modul dahinter (scoreview-engine): was der Konverter erzeugt, ist
 * die Cache-Form der App und damit exakt das, was auch der Sidecar liefert.
 *
 * **Ein Prozess je Partitur, und das ist kein Versehen.** Die Wasm-Instanz
 * ueber mehrere Konvertierungen zu halten, hiesse einen langlebigen Dienst zu
 * betreiben - genau das ist der Sidecar, und PHP hat dafuer keinen Ort: jeder
 * Lauf von ConvertScoreJob ist ein eigener Prozess. Der Prozessabbau raeumt
 * die Instanz vollstaendig ab und braucht keinen Zustand; bezahlt wird das
 * mit dem Anlauf je Partitur - Wasm-Instanziierung samt vorgeladenem
 * Ressourcenpaket (Schriften, SMuFL-Metadaten).
 */
class LocalConverter {
	/**
	 * Harte Obergrenze fuer einen Konvertierungslauf. Grosszuegig gegenueber
	 * dem Gemessenen (0,7-2,9 s je Partitur, siehe docs/limits.md): die Grenze
	 * soll einen haengenden Prozess einfangen, nicht eine langsame Maschine
	 * bestrafen.
	 */
	private const DEFAULT_TIMEOUT_SECONDS = 120;

	/**
	 * Wo nach `node` gesucht wird, wenn die Einstellung `node_path` leer ist.
	 * Der nackte Name steht zuerst: proc_open() sucht ihn ueber PATH, was auf
	 * einem gepflegten System die richtige Antwort ist. Die absoluten Pfade
	 * danach fangen den haeufigen Fall ab, dass PHP-FPM mit einem
	 * ausgeduennten PATH laeuft und `node` deshalb nur scheinbar fehlt.
	 */
	private const NODE_CANDIDATES = [
		'node',
		'/usr/bin/node',
		'/usr/local/bin/node',
		'/opt/homebrew/bin/node',
		'/snap/bin/node',
	];

	public function __construct(
		private IAppConfig $appConfig,
		private ITempManager $tempManager,
		private LoggerInterface $logger,
	) {
	}

	/**
	 * Konvertiert eine .mscz und gibt die Artefakte in der Form zurueck, die
	 * ConversionService::markReady() erwartet.
	 *
	 * @param string $msczPath Pfad zu einer lesbaren .mscz im Dateisystem
	 * @return array{pages: string[], midi: string, timing: string, measures: string, meta: string}
	 * @throws LocalConverterException
	 */
	public function convert(string $msczPath): array {
		$outDir = $this->tempManager->getTemporaryFolder('scoreview-out');
		if ($outDir === false) {
			throw new LocalConverterException('Kein temporaeres Verzeichnis fuer die Konvertierung verfuegbar.');
		}

		$this->run([$msczPath, $outDir]);

		return $this->readArtifacts($outDir);
	}

	/**
	 * Gegenstueck zu SidecarClient::runSelfTest(): eine echte Konvertierung
	 * der mitgelieferten Minipartitur, geprueft auf die Zusagen aus M2/M4/M7.
	 * Antwortform absichtlich identisch, damit die Admin-Seite fuer beide
	 * Wege denselben Bericht anzeigen kann.
	 *
	 * @return array{ok: bool, error?: string, problems?: string[], details?: array}
	 */
	public function runSelfTest(): array {
		try {
			$output = $this->run(['--selftest']);
		} catch (LocalConverterException $e) {
			return ['ok' => false, 'error' => $e->getMessage()];
		}
		$result = json_decode($output, true);
		if (!is_array($result) || !isset($result['ok'])) {
			return ['ok' => false, 'error' => 'Antwort des lokalen Konverters ohne ok-Feld: ' . substr($output, 0, 200)];
		}
		return $result;
	}

	/**
	 * Ist der lokale Weg ueberhaupt lauffaehig? Beantwortet die drei Fragen
	 * getrennt, die von aussen alle nur als "Konvertierung schlaegt fehl"
	 * sichtbar waeren: darf PHP Prozesse starten, gibt es ein `node`, und
	 * liegt das Engine-Paket (scoreview-engine) neben dem Konverter.
	 *
	 * @return array{available: bool, procOpen: bool, nodePath: ?string, nodeVersion: ?string, converterInstalled: bool, error: ?string}
	 */
	public function describe(): array {
		$procOpen = $this->canStartProcesses();
		$nodePath = $procOpen ? $this->findNode() : null;
		$nodeVersion = $nodePath !== null ? $this->nodeVersion($nodePath) : null;
		$installed = $this->isConverterInstalled();

		$error = null;
		if (!$procOpen) {
			$error = 'PHP darf keine Prozesse starten (proc_open ist per disable_functions gesperrt).';
		} elseif ($nodePath === null) {
			$error = 'Keine Node.js-Laufzeit gefunden. Pfad in den Einstellungen eintragen.';
		} elseif (!$installed) {
			$error = 'Das Engine-Paket (scoreview-engine) fehlt neben dem Konverter (converter/node_modules).';
		}

		return [
			'available' => $error === null,
			'procOpen' => $procOpen,
			'nodePath' => $nodePath,
			'nodeVersion' => $nodeVersion,
			'converterInstalled' => $installed,
			'error' => $error,
		];
	}

	/** Verzeichnis des mitgelieferten Konverters (App-Paket, nicht konfigurierbar). */
	public function getConverterDir(): string {
		return dirname(__DIR__, 2) . '/converter';
	}

	private function isConverterInstalled(): bool {
		return is_file($this->getConverterDir() . '/convert.mjs')
			&& is_dir($this->getConverterDir() . '/node_modules/scoreview-engine');
	}

	/**
	 * proc_open() ist auf geteiltem Hosting oft per `disable_functions`
	 * gesperrt - dann ist der lokale Weg dort schlicht nicht moeglich, und
	 * das soll als eigene Aussage erscheinen statt als Konvertierungsfehler.
	 */
	private function canStartProcesses(): bool {
		return function_exists('proc_open') && function_exists('proc_get_status');
	}

	private function findNode(): ?string {
		$configured = trim($this->appConfig->getValueString(Application::APP_ID, 'node_path'));
		if ($configured !== '') {
			return $this->nodeVersion($configured) !== null ? $configured : null;
		}
		foreach (self::NODE_CANDIDATES as $candidate) {
			if ($this->nodeVersion($candidate) !== null) {
				return $candidate;
			}
		}
		return null;
	}

	/** `node --version` als Lebendtest - ein vorhandener Pfad allein sagt nichts. */
	private function nodeVersion(string $nodePath): ?string {
		try {
			$output = $this->execute([$nodePath, '--version'], $this->getConverterDir(), 15);
		} catch (LocalConverterException) {
			return null;
		}
		$version = trim($output['stdout']);
		return ($output['exitCode'] === 0 && str_starts_with($version, 'v')) ? $version : null;
	}

	/**
	 * Startet convert.mjs mit den gegebenen Argumenten und gibt dessen
	 * stdout zurueck.
	 *
	 * @param string[] $arguments
	 * @throws LocalConverterException
	 */
	private function run(array $arguments): string {
		if (!$this->canStartProcesses()) {
			throw new LocalConverterException(
				'PHP darf keine Prozesse starten (proc_open gesperrt) - der lokale Konvertierungsweg ist auf dieser Instanz nicht moeglich.',
				errorCode: ScoreConversion::ERROR_LOCAL_UNAVAILABLE,
			);
		}
		$node = $this->findNode();
		if ($node === null) {
			throw new LocalConverterException(
				'Keine lauffaehige Node.js-Laufzeit gefunden (Einstellungen, Feld "Pfad zu node").',
				errorCode: ScoreConversion::ERROR_LOCAL_UNAVAILABLE,
			);
		}
		if (!$this->isConverterInstalled()) {
			throw new LocalConverterException(
				'Der mitgelieferte Konverter ist unvollstaendig: ' . $this->getConverterDir() . '/node_modules fehlt.',
				errorCode: ScoreConversion::ERROR_LOCAL_UNAVAILABLE,
			);
		}

		$timeout = $this->appConfig->getValueInt(Application::APP_ID, 'local_timeout', self::DEFAULT_TIMEOUT_SECONDS);
		if ($timeout <= 0) {
			$timeout = self::DEFAULT_TIMEOUT_SECONDS;
		}

		$command = [$node, $this->getConverterDir() . '/convert.mjs'];
		// Zusatzfonts fuer CJK-Liedtexte, falls eingerichtet. Bewusst ein
		// Verzeichnis AUSSERHALB der App: Das ausgelieferte App-Verzeichnis ist
		// signiert, dort abgelegte Dateien liessen Nextclouds
		// Integritaetspruefung dauerhaft Alarm schlagen.
		$fontDir = trim($this->appConfig->getValueString(Application::APP_ID, 'cjk_font_dir'));
		if ($fontDir !== '') {
			$command[] = '--fonts';
			$command[] = $fontDir;
		}

		$result = $this->execute(
			array_merge($command, $arguments),
			$this->getConverterDir(),
			$timeout,
		);

		if ($result['timedOut']) {
			throw new LocalConverterException(
				sprintf('Lokale Konvertierung nach %d s abgebrochen.', $timeout),
				errorCode: ScoreConversion::ERROR_TIMEOUT,
			);
		}
		if ($result['exitCode'] !== 0) {
			// stderr traegt hier den Stacktrace aus convert.mjs UND die
			// Qt-Meldungen von MuseScore (convert.mjs leitet stdout dorthin
			// um) - fuer die Fehlersuche ist genau das die Spur, im
			// Fehlertext der Oberflaeche waere es Rauschen.
			$this->logger->error('ScoreView: lokaler Konverter beendet mit {code}: {stderr}', [
				'code' => $result['exitCode'],
				'stderr' => substr($result['stderr'], -4000),
			]);
			throw new LocalConverterException(
				'Lokale Konvertierung fehlgeschlagen: ' . $this->lastLine($result['stderr']),
				errorCode: ScoreConversion::ERROR_CONVERSION_FAILED,
			);
		}
		return $result['stdout'];
	}

	/**
	 * Ein Kindprozess mit Zeitgrenze, ohne Shell.
	 *
	 * Bewusst mit Array-Kommando: damit geht es an execvp() statt durch
	 * `/bin/sh`, und ein Dateiname mit Anfuehrungszeichen oder Semikolon ist
	 * ein Dateiname und keine Befehlskette. Die Zeitgrenze wird selbst
	 * gefuehrt, weil PHP keine mitbringt - ohne sie haengt ein blockierter
	 * MuseScore-Lauf den Cron-Durchgang der Instanz auf.
	 *
	 * @param string[] $command
	 * @return array{stdout: string, stderr: string, exitCode: int, timedOut: bool}
	 * @throws LocalConverterException
	 */
	private function execute(array $command, string $cwd, int $timeoutSeconds): array {
		$descriptors = [
			0 => ['pipe', 'r'],
			1 => ['pipe', 'w'],
			2 => ['pipe', 'w'],
		];
		$process = @proc_open($command, $descriptors, $pipes, $cwd);
		if (!is_resource($process)) {
			throw new LocalConverterException('Konnte den Konverterprozess nicht starten: ' . implode(' ', $command));
		}

		fclose($pipes[0]);
		stream_set_blocking($pipes[1], false);
		stream_set_blocking($pipes[2], false);

		$stdout = '';
		$stderr = '';
		$deadline = microtime(true) + $timeoutSeconds;
		$timedOut = false;

		while (true) {
			$read = [$pipes[1], $pipes[2]];
			$write = null;
			$except = null;
			// Kurzes Fenster statt eines langen Blocks: so bleibt die
			// Zeitgrenze auch dann wirksam, wenn der Prozess gar nichts mehr
			// schreibt.
			if (@stream_select($read, $write, $except, 0, 200000) > 0) {
				foreach ($read as $stream) {
					$chunk = fread($stream, 65536);
					if ($chunk === false || $chunk === '') {
						continue;
					}
					if ($stream === $pipes[1]) {
						$stdout .= $chunk;
					} else {
						$stderr .= $chunk;
					}
				}
			}

			$status = proc_get_status($process);
			if (!$status['running']) {
				// Nachlesen, was zwischen dem letzten Lesen und dem Ende noch
				// in den Puffern lag - sonst fehlt ausgerechnet die
				// Fehlermeldung eines schnell gescheiterten Laufs.
				$stdout .= (string)stream_get_contents($pipes[1]);
				$stderr .= (string)stream_get_contents($pipes[2]);
				break;
			}
			if (microtime(true) > $deadline) {
				$timedOut = true;
				proc_terminate($process, 9);
				break;
			}
		}

		fclose($pipes[1]);
		fclose($pipes[2]);
		$exitCode = proc_close($process);

		return [
			'stdout' => $stdout,
			'stderr' => $stderr,
			'exitCode' => $timedOut ? -1 : $exitCode,
			'timedOut' => $timedOut,
		];
	}

	/**
	 * Liest, was convert.mjs geschrieben hat.
	 *
	 * @return array{pages: string[], midi: string, timing: string, measures: string, meta: string}
	 * @throws LocalConverterException
	 */
	private function readArtifacts(string $outDir): array {
		$pages = [];
		// Nach Nummer durchzaehlen statt eine Verzeichnisauflistung zu
		// sortieren: `page-10.svg` stuende dort vor `page-2.svg`, und eine
		// falsch sortierte Partitur waere im Viewer nur als vertauschte
		// Seiten sichtbar.
		for ($number = 1; ; $number++) {
			$path = $outDir . '/page-' . $number . '.svg';
			if (!is_file($path)) {
				break;
			}
			$pages[] = $this->readFile($path);
		}
		if ($pages === []) {
			throw new LocalConverterException(
				'Die lokale Konvertierung erzeugte keine SVG-Seite.',
				errorCode: ScoreConversion::ERROR_NO_PAGES,
			);
		}

		return [
			'pages' => $pages,
			'midi' => $this->readFile($outDir . '/score.mid'),
			'timing' => $this->readFile($outDir . '/timing.json'),
			'measures' => $this->readFile($outDir . '/measures.json'),
			'meta' => $this->readFile($outDir . '/meta.json'),
		];
	}

	/** @throws LocalConverterException */
	private function readFile(string $path): string {
		$content = @file_get_contents($path);
		if ($content === false) {
			throw new LocalConverterException('Erwartetes Artefakt fehlt: ' . basename($path));
		}
		return $content;
	}

	/** Die letzte nicht leere Zeile - bei einem Node-Stacktrace die Ursache. */
	private function lastLine(string $text): string {
		$lines = array_values(array_filter(array_map('trim', explode("\n", $text)), static fn (string $line) => $line !== ''));
		return $lines === [] ? 'keine Fehlerausgabe' : end($lines);
	}
}
