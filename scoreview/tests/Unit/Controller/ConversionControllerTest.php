<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Controller;

use OCA\ScoreView\Controller\ConversionController;
use OCA\ScoreView\Db\ScoreConversion;
use OCA\ScoreView\Http\ArtifactResponse;
use OCA\ScoreView\Middleware\DirectAccessContext;
use OCA\ScoreView\Service\ClientFallback;
use OCA\ScoreView\Service\ConversionBackend;
use OCA\ScoreView\Service\ConversionService;
use OCA\ScoreView\Service\LocalConverter;
use OCA\ScoreView\Service\PublicShareGrant;
use OCA\ScoreView\Service\ShareConversionQuota;
use OCA\ScoreView\Service\SoundFontService;
use OCA\ScoreView\Service\UserFileResolver;
use OCP\AppFramework\Http;
use OCP\BackgroundJob\IJobList;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\NotFoundException;
use OCP\Files\SimpleFS\ISimpleFile;
use OCP\IAppConfig;
use OCP\ICache;
use OCP\ICacheFactory;
use OCP\IL10N;
use OCP\IRequest;
use OCP\IURLGenerator;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

/**
 * Hier faellt die Rechteentscheidung fuer jede Partitur - deshalb eigens geprueft.
 *
 * Drei Zusagen, die dieser Controller allein traegt:
 *
 * 1. **Keine rohe fileId wird je vertraut.** Aufgeloest wird ueber den
 *    Dateibaum der angemeldeten Nutzerin (UserFileResolver); was dort nicht
 *    auftaucht, endet als 404 - ohne Datenbankzugriff, also auch ohne die
 *    Existenz einer Konvertierung zu verraten.
 * 2. **„Neu konvertieren" braucht Schreibrecht.** Der Cache haengt an der
 *    fileId, nicht an der Nutzerin: Wer nur lesen darf, soll die Darstellung
 *    nicht fuer alle anderen verwerfen koennen.
 * 3. **Ein toter Lauf sperrt die Partitur nicht.** Stirbt der Prozess
 *    waehrend der Konvertierung, blieb der Datensatz fuer immer auf
 *    `processing`: ConvertScoreJob ueberspringt ihn, reconvert() verweigert
 *    an ihm. Beide Stellen fragen jetzt ConversionService::isStale().
 */
class ConversionControllerTest extends TestCase {
	use ScoreDoubles;

	private UserFileResolver&MockObject $fileResolver;
	private ConversionService&MockObject $conversionService;
	private ClientFallback&MockObject $clientFallback;
	private IJobList&MockObject $jobList;
	private DirectAccessContext&MockObject $directAccess;
	private ShareConversionQuota&MockObject $quota;
	private IURLGenerator&MockObject $urls;
	private IAppConfig&MockObject $appConfig;
	private SoundFontService&MockObject $soundFont;
	private ConversionBackend&MockObject $backend;
	private LocalConverter&MockObject $localConverter;
	/** @var array<string, int> */
	private array $requeueStore = [];

	protected function setUp(): void {
		$this->fileResolver = $this->resolverDouble();
		// isServable() stays real: it is the rule the artifact routes share.
		$this->conversionService = $this->getMockBuilder(ConversionService::class)
			->disableOriginalConstructor()
			->onlyMethods(array_values(array_diff(get_class_methods(ConversionService::class), ['__construct', 'isServable'])))
			->getMock();
		$this->clientFallback = $this->createMock(ClientFallback::class);
		$this->jobList = $this->createMock(IJobList::class);
		$this->directAccess = $this->createMock(DirectAccessContext::class);
		$this->quota = $this->createMock(ShareConversionQuota::class);
		// Routes as readable strings, so the bodies below can be compared.
		$this->urls = $this->createMock(IURLGenerator::class);
		$this->urls->method('linkToRoute')->willReturnCallback(
			static fn (string $route, array $p = []) => $route . '?' . http_build_query($p));
		$this->appConfig = $this->createMock(IAppConfig::class);
		$this->appConfig->method('getValueInt')->willReturnArgument(2);
		$this->appConfig->method('getValueString')->willReturnArgument(2);
		$this->soundFont = $this->createMock(SoundFontService::class);
		$this->backend = $this->createMock(ConversionBackend::class);
		$this->localConverter = $this->createMock(LocalConverter::class);
	}

	private function controller(): ConversionController {
		$l = $this->createMock(IL10N::class);
		$l->method('t')->willReturnArgument(0);
		return new ConversionController(
			$this->createMock(IRequest::class),
			$this->fileResolver,
			$this->conversionService,
			$this->clientFallback,
			$this->localConverter,
			$this->jobList,
			$this->urls,
			$this->appConfig,
			$l,
			$this->soundFont,
			$this->backend,
			$this->cacheFactory ?? $this->noCache(),
			$this->directAccess,
			$this->quota,
		);
	}

	private ?ICacheFactory $cacheFactory = null;

	private function noCache(): ICacheFactory {
		$factory = $this->createMock(ICacheFactory::class);
		$factory->method('isAvailable')->willReturn(false);
		return $factory;
	}

	/** A memory cache that behaves like one - for the requeue throttle. */
	private function withCache(): void {
		$this->requeueStore = [];
		$store = &$this->requeueStore;
		$cache = $this->createMock(ICache::class);
		$cache->method('get')->willReturnCallback(function (string $key) use (&$store) {
			return $store[$key] ?? null;
		});
		$cache->method('set')->willReturnCallback(function (string $key, $value) use (&$store) {
			$store[$key] = $value;
			return true;
		});
		$this->cacheFactory = $this->createMock(ICacheFactory::class);
		$this->cacheFactory->method('isAvailable')->willReturn(true);
		$this->cacheFactory->method('createDistributed')->willReturn($cache);
	}

	/** @return File&MockObject */
	private function node(bool $schreibbar = true, bool $folderWritable = true): File {
		$node = $this->scoreDouble();
		$node->method('getId')->willReturn(42);
		$node->method('getEtag')->willReturn('etag1');
		$node->method('getSize')->willReturn(1234);
		$node->method('isUpdateable')->willReturn($schreibbar);
		$parent = $this->createMock(Folder::class);
		$parent->method('isCreatable')->willReturn($folderWritable);
		$node->method('getParent')->willReturn($parent);
		return $node;
	}

	private function datensatz(string $status): ScoreConversion {
		$conversion = new ScoreConversion();
		$conversion->setFileId(42);
		$conversion->setEtag('etag1');
		$conversion->setStatus($status);
		$conversion->setUpdatedAt(new \DateTime());
		return $conversion;
	}

	/** Was markError() an der Entity tut - der Controller verlaesst sich darauf. */
	private function markErrorSchreibtInDieEntity(): callable {
		return static function (ScoreConversion $c, string $message, string $code) {
			$c->setStatus(ScoreConversion::STATUS_ERROR);
			$c->setErrorMessage($message);
			$c->setErrorCode($code);
		};
	}

	// --- Zusage 1: keine rohe fileId ---------------------------------------

	/**
	 * @return array<string, array{string}>
	 */
	public static function endpunkte(): array {
		return [
			'Status' => ['status'],
			'Neu konvertieren' => ['reconvert'],
		];
	}

	#[DataProvider('endpunkte')]
	public function testEineNichtAufloesbareDateiEndetAls404(string $methode): void {
		$this->fileResolver->method('resolveOwnNode')->willReturn(null);
		// Es darf gar nicht erst in der Datenbank nachgesehen werden - sonst
		// haette die Antwortzeit gesagt, ob es zu dieser fileId etwas gibt.
		$this->conversionService->expects($this->never())->method('find');

		$response = $this->controller()->$methode(42);

		$this->assertSame(Http::STATUS_NOT_FOUND, $response->getStatus());
	}

	// --- Zusage 2: Schreibrecht --------------------------------------------

	public function testNeuKonvertierenBrauchtSchreibrecht(): void {
		$this->fileResolver->method('resolveOwnNode')->willReturn($this->node(schreibbar: false));
		$this->conversionService->expects($this->never())->method('deleteAllForFile');
		$this->jobList->expects($this->never())->method('add');

		$response = $this->controller()->reconvert(42);

		$this->assertSame(Http::STATUS_FORBIDDEN, $response->getStatus());
	}

	/**
	 * Die Anzeigehilfe `canReconvert` muss dieselbe Bedingung tragen wie die
	 * Pruefung in reconvert() - sonst stuende der Knopf an einer nur
	 * geliehenen Partitur und endete jedes Mal in einem 403.
	 */
	public function testCanReconvertFolgtDemSchreibrecht(): void {
		$this->fileResolver->method('resolveOwnNode')->willReturn($this->node(schreibbar: false));
		$this->conversionService->method('find')->willReturn($this->datensatz(ScoreConversion::STATUS_READY));
		$this->conversionService->method('isCurrentFormat')->willReturn(true);
		$this->conversionService->method('isCurrent')->willReturn(true);
		$this->conversionService->method('getPageCount')->willReturn(1);

		$response = $this->controller()->status(42);

		$this->assertFalse($response->getData()['canReconvert']);
	}

	// --- Zusage 3: ein toter Lauf sperrt nicht -----------------------------

	public function testEinToterLaufWirdBeimStatusAlsFehlerGemeldet(): void {
		$this->fileResolver->method('resolveOwnNode')->willReturn($this->node());
		$tot = $this->datensatz(ScoreConversion::STATUS_PROCESSING);
		$this->conversionService->method('find')->willReturn($tot);
		$this->conversionService->method('isStale')->with($tot)->willReturn(true);
		$this->conversionService->expects($this->once())
			->method('markError')
			->with($tot, $this->anything(), ScoreConversion::ERROR_STALE)
			->willReturnCallback($this->markErrorSchreibtInDieEntity());

		$response = $this->controller()->status(42);

		$this->assertSame(ScoreConversion::STATUS_ERROR, $response->getData()['status']);
		$this->assertSame(ScoreConversion::ERROR_STALE, $response->getData()['errorCode']);
	}

	/**
	 * Ein toter Lauf ist KEIN Grund, die Instanz fuer unfaehig zu erklaeren:
	 * Das Urteil von ClientFallback gilt instanzweit und fuenf Minuten lang -
	 * ein einzelner Neustart wuerde sonst jede Partitur der Instanz in den
	 * Browser schicken. Statt dessen wird ein neuer Versuch eingereiht.
	 */
	public function testEinToterLaufSchicktNichtInDenBrowser(): void {
		$this->fileResolver->method('resolveOwnNode')->willReturn($this->node());
		$this->conversionService->method('find')->willReturn($this->datensatz(ScoreConversion::STATUS_PROCESSING));
		$this->conversionService->method('isStale')->willReturn(true);
		$this->conversionService->method('markError')->willReturnCallback($this->markErrorSchreibtInDieEntity());
		$this->clientFallback->expects($this->once())
			->method('noteConversionError')
			->with(ScoreConversion::ERROR_STALE)
			->willReturn(false);
		$this->jobList->expects($this->once())->method('add');

		$response = $this->controller()->status(42);

		$this->assertSame(ScoreConversion::STATUS_ERROR, $response->getData()['status']);
	}

	#[DataProvider('laufendeZustaende')]
	public function testEinFrischerLaufBleibtUnberuehrt(string $status): void {
		$this->fileResolver->method('resolveOwnNode')->willReturn($this->node());
		$this->conversionService->method('find')->willReturn($this->datensatz($status));
		$this->conversionService->method('isStale')->willReturn(false);
		$this->conversionService->expects($this->never())->method('markError');

		$response = $this->controller()->status(42);

		$this->assertSame($status, $response->getData()['status']);
	}

	public function testRepeatedPollsQueueTheConversionOncePerInterval(): void {
		$this->withCache();
		$this->fileResolver->method('resolveOwnNode')->willReturn($this->node());
		$this->fileResolver->method('currentUserId')->willReturn('anna');
		$this->conversionService->method('find')->willReturn(null);
		$this->clientFallback->method('reason')->willReturn(null);
		$this->jobList->expects($this->once())->method('add');

		$controller = $this->controller();
		for ($i = 0; $i < 5; $i++) {
			$this->assertSame(ScoreConversion::STATUS_PENDING, $controller->status(42)->getData()['status']);
		}
	}

	private function asVisitor(): void {
		$this->directAccess->method('shareGrant')->willReturn(new PublicShareGrant('owner', null, false, 'dig'));
		$this->fileResolver->method('attributionUserId')->willReturn('owner');
		$this->fileResolver->method('resolveOwnNode')->willReturn($this->node());
		$this->clientFallback->method('reason')->willReturn(null);
	}

	/**
	 * "Hide download" closes the source file, and the browser fallback (E7)
	 * needs exactly that file - so where the fallback would apply, a
	 * visitor gets a reason instead of a `client` answer whose source then
	 * fails with 403, or a spinner that never ends.
	 */
	public function testVisitorPendingWithHiddenDownloadIsSourceHidden(): void {
		$this->directAccess->method('shareGrant')->willReturn(new PublicShareGrant('owner', null, true, 'dig'));
		$this->fileResolver->method('resolveOwnNode')->willReturn($this->node());
		$this->clientFallback->method('reason')->willReturn(ScoreConversion::ERROR_LOCAL_UNAVAILABLE);
		$this->conversionService->method('find')->willReturn(null);
		$this->jobList->expects($this->never())->method('add');

		$data = $this->controller()->status(42)->getData();
		$this->assertSame(['status' => 'error', 'errorCode' => ClientFallback::SOURCE_HIDDEN], $data);
	}

	public function testVisitorWithDownloadAllowedStillConvertsInTheBrowser(): void {
		$this->directAccess->method('shareGrant')->willReturn(new PublicShareGrant('owner', null, false, 'dig'));
		$this->fileResolver->method('resolveOwnNode')->willReturn($this->node());
		$this->clientFallback->method('reason')->willReturn(ScoreConversion::ERROR_LOCAL_UNAVAILABLE);
		$this->conversionService->method('find')->willReturn(null);

		$this->assertSame(ClientFallback::STATUS_CLIENT, $this->controller()->status(42)->getData()['status']);
	}

	public function testHiddenDownloadAlsoStopsTheFallbackAfterAnInfrastructureError(): void {
		$this->directAccess->method('shareGrant')->willReturn(new PublicShareGrant('owner', null, true, 'dig'));
		$this->fileResolver->method('resolveOwnNode')->willReturn($this->node());
		$conversion = $this->datensatz(ScoreConversion::STATUS_ERROR);
		$conversion->setErrorCode(ScoreConversion::ERROR_SIDECAR_UNREACHABLE);
		$this->conversionService->method('find')->willReturn($conversion);
		$this->conversionService->method('isStale')->willReturn(false);
		$this->clientFallback->method('noteConversionError')->willReturn(true);

		$this->assertSame(ClientFallback::SOURCE_HIDDEN, $this->controller()->status(42)->getData()['errorCode']);
	}

	public function testVisitorIsNotOfferedAReconversion(): void {
		// The share owner may write the file, the visitor may not: the
		// reconvert route refuses the link (share_not_allowed), so the
		// viewer must not offer the button in the first place.
		$this->asVisitor();
		$this->conversionService->method('find')->willReturn($this->datensatz(ScoreConversion::STATUS_READY));
		$this->conversionService->method('isCurrent')->willReturn(true);
		$this->conversionService->method('getPageCount')->willReturn(1);
		$this->assertFalse($this->controller()->status(42)->getData()['canReconvert']);
	}

	public function testVisitorStatusQueuesUnderShareOwner(): void {
		$this->asVisitor();
		$this->conversionService->method('find')->willReturn(null);
		$this->quota->expects($this->once())->method('consume')->willReturn(true);
		$this->jobList->expects($this->once())->method('add')
			->with($this->anything(), ['userId' => 'owner', 'fileId' => 42]);
		$this->assertSame(ScoreConversion::STATUS_PENDING, $this->controller()->status(42)->getData()['status']);
	}

	public function testVisitorStatusOnRunningConversionDoesNotConsume(): void {
		$this->asVisitor();
		$this->conversionService->method('find')->willReturn($this->datensatz(ScoreConversion::STATUS_PROCESSING));
		$this->conversionService->method('isStale')->willReturn(false);
		$this->quota->expects($this->never())->method('consume');
		$this->jobList->expects($this->never())->method('add');
		$this->controller()->status(42);
	}

	public function testVisitorPollOfAnAlreadyQueuedJobDoesNotConsume(): void {
		$this->asVisitor();
		$this->conversionService->method('find')->willReturn(null);
		$this->jobList->method('has')->willReturn(true);
		$this->quota->expects($this->never())->method('consume');
		$this->controller()->status(42);
	}

	public function testVisitorStatusOnReadyConversionDoesNotConsume(): void {
		$this->asVisitor();
		$this->conversionService->method('find')->willReturn($this->datensatz(ScoreConversion::STATUS_READY));
		$this->conversionService->method('isCurrent')->willReturn(true);
		$this->conversionService->method('getPageCount')->willReturn(1);
		$this->quota->expects($this->never())->method('consume');
		$this->jobList->expects($this->never())->method('add');
		$this->assertSame(ScoreConversion::STATUS_READY, $this->controller()->status(42)->getData()['status']);
	}

	public function testVisitorRetryUsesTheLinkKeyAndConsumesOncePerInterval(): void {
		$this->withCache();
		$this->asVisitor();
		$this->conversionService->method('find')->willReturn($this->datensatz(ScoreConversion::STATUS_ERROR));
		$this->conversionService->method('isStale')->willReturn(false);
		$this->quota->expects($this->once())->method('consume')->willReturn(true);
		$this->jobList->expects($this->once())->method('add');

		$controller = $this->controller();
		$controller->status(42);
		$controller->status(42);
		$this->assertSame(['42:share:dig' => 1], $this->requeueStore);
	}

	public function testVisitorRetryOverQuotaIs429(): void {
		$this->withCache();
		$this->asVisitor();
		$this->conversionService->method('find')->willReturn($this->datensatz(ScoreConversion::STATUS_ERROR));
		$this->conversionService->method('isStale')->willReturn(false);
		$this->quota->method('consume')->willReturn(false);
		$this->jobList->expects($this->never())->method('add');
		$response = $this->controller()->status(42);
		$this->assertSame(Http::STATUS_TOO_MANY_REQUESTS, $response->getStatus());
		$this->assertSame('share_quota', $response->getData()['errorCode']);
	}

	public function testVisitorQuotaExceededIs429(): void {
		$this->asVisitor();
		$this->conversionService->method('find')->willReturn(null);
		$this->quota->method('consume')->willReturn(false);
		$this->jobList->expects($this->never())->method('add');
		$response = $this->controller()->status(42);
		$this->assertSame(Http::STATUS_TOO_MANY_REQUESTS, $response->getStatus());
		$this->assertSame(['status' => 'error', 'errorCode' => 'share_quota'], $response->getData());
	}

	public function testSessionStatusNeverTouchesTheShareQuota(): void {
		$this->fileResolver->method('resolveOwnNode')->willReturn($this->node());
		$this->fileResolver->method('attributionUserId')->willReturn('anna');
		$this->clientFallback->method('reason')->willReturn(null);
		$this->conversionService->method('find')->willReturn(null);
		$this->quota->expects($this->never())->method('consume');
		$this->jobList->expects($this->once())->method('add')->with($this->anything(), ['userId' => 'anna', 'fileId' => 42]);
		$this->controller()->status(42);
	}

	public function testReconvertQueuesEvenRightAfterAPoll(): void {
		$this->withCache();
		$this->fileResolver->method('resolveOwnNode')->willReturn($this->node());
		$this->fileResolver->method('currentUserId')->willReturn('anna');
		$this->conversionService->method('find')->willReturn(null);
		$this->clientFallback->method('reason')->willReturn(null);
		$this->jobList->expects($this->exactly(2))->method('add');

		$controller = $this->controller();
		$controller->status(42);
		$controller->reconvert(42);
	}

	public function testNeuKonvertierenVerwirftEinenTotenLauf(): void {
		$this->fileResolver->method('resolveOwnNode')->willReturn($this->node());
		$this->conversionService->method('find')->willReturn($this->datensatz(ScoreConversion::STATUS_PROCESSING));
		$this->conversionService->method('isStale')->willReturn(true);
		$this->conversionService->expects($this->once())->method('deleteAllForFile')->with(42);
		$this->jobList->expects($this->once())->method('add');

		$response = $this->controller()->reconvert(42);

		$this->assertSame(ScoreConversion::STATUS_PENDING, $response->getData()['status']);
	}

	/**
	 * Der Gegenfall, und der Grund, warum die Pruefung ueberhaupt bedingt
	 * ist: Waehrend ein Job laeuft, darf nichts verworfen werden - sonst
	 * schriebe er sein Ergebnis auf eine geloeschte Zeile.
	 */
	#[DataProvider('laufendeZustaende')]
	public function testNeuKonvertierenVerschontEinenLaufendenJob(string $status): void {
		$this->fileResolver->method('resolveOwnNode')->willReturn($this->node());
		$this->conversionService->method('find')->willReturn($this->datensatz($status));
		$this->conversionService->method('isStale')->willReturn(false);
		$this->conversionService->expects($this->never())->method('deleteAllForFile');
		$this->jobList->expects($this->never())->method('add');

		$response = $this->controller()->reconvert(42);

		$this->assertSame($status, $response->getData()['status']);
	}

	/**
	 * @return array<string, array{string}>
	 */
	public static function laufendeZustaende(): array {
		return [
			'eingereiht' => [ScoreConversion::STATUS_PENDING],
			'in Arbeit' => [ScoreConversion::STATUS_PROCESSING],
		];
	}

	// --- A folder is no score (issue #51) -----------------------------------

	public function testAFolderIdQueuesNothing(): void {
		$this->fileResolver->method('resolveOwnNode')->willReturn($this->createMock(Folder::class));
		$this->conversionService->expects($this->never())->method('find');
		$this->jobList->expects($this->never())->method('add');

		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->status(42)->getStatus());
	}

	// --- The ready path (issue #63) -----------------------------------------

	private function ready(bool $current = true): ScoreConversion {
		$conversion = $this->datensatz(ScoreConversion::STATUS_READY);
		$conversion->setUpdatedAt(new \DateTime('@1790000000'));
		$conversion->setFormatVersion(ConversionService::CURRENT_FORMAT_VERSION);
		$conversion->setBackend(ConversionBackend::LOCAL);
		$this->conversionService->method('find')->willReturn($conversion);
		$this->conversionService->method('isCurrentFormat')->willReturn(true);
		$this->conversionService->method('isCurrent')->willReturn($current);
		return $conversion;
	}

	/**
	 * Everything the viewer builds its page from (E3): the artifact URLs with
	 * the conversion's version, the SoundFont, whether variants can be
	 * engraved, whether practice tracks may go next to the score.
	 */
	public function testTheReadyBodyCarriesWhatTheViewerNeeds(): void {
		$this->fileResolver->method('resolveOwnNode')->willReturn($this->node());
		$conversion = $this->ready();
		$this->conversionService->method('getPageCount')->willReturn(2);
		$this->soundFont->method('expectedVersion')->willReturn('sf7');
		$this->backend->method('supportsVariants')->willReturn(true);
		$this->jobList->expects($this->never())->method('add');

		$data = $this->controller()->status(42)->getData();

		$v = ArtifactResponse::version($conversion);
		$artifact = fn (string $name) => 'scoreview.conversion.artifact?' . http_build_query(['fileId' => 42, 'name' => $name, 'v' => $v]);
		$this->assertSame('ready', $data['status']);
		$this->assertSame([
			'pageCount' => 2,
			'pages' => [$artifact('page-1'), $artifact('page-2')],
			'midi' => $artifact('midi'),
			'timingJson' => $artifact('timing'),
			'measuresJson' => $artifact('measures'),
			'metaJson' => $artifact('meta'),
			'etag' => 'etag1',
		], $data['files']);
		$this->assertSame('scoreview.sound_font.get?v=sf7', $data['soundFontUrl']);
		$this->assertSame(['supported' => true], $data['variants']);
		$this->assertTrue($data['canWriteFolder']);
		$this->assertTrue($data['canReconvert']);
		$this->assertSame(['backend' => ConversionBackend::LOCAL], $data['renderer']);
	}

	public function testAConfiguredSoundFontAddressWins(): void {
		$this->appConfig = $this->createMock(IAppConfig::class);
		$this->appConfig->method('getValueString')->willReturnCallback(
			fn (string $app, string $key, string $default = '') => $key === 'soundfont_url' ? ' https://cdn.example/a.sf3 ' : $default);
		$this->fileResolver->method('resolveOwnNode')->willReturn($this->node(folderWritable: false));
		$this->ready();
		$this->conversionService->method('getPageCount')->willReturn(1);

		$data = $this->controller()->status(42)->getData();
		$this->assertSame('https://cdn.example/a.sf3', $data['soundFontUrl']);
		$this->assertFalse($data['canWriteFolder']);
	}

	public function testReadyButNotCurrentIsConvertedAgain(): void {
		$this->fileResolver->method('resolveOwnNode')->willReturn($this->node());
		$this->fileResolver->method('attributionUserId')->willReturn('anna');
		$this->ready(current: false);
		$this->clientFallback->method('reason')->willReturn(null);
		$this->conversionService->expects($this->never())->method('getPageCount');
		$this->jobList->expects($this->once())->method('add')->with($this->anything(), ['userId' => 'anna', 'fileId' => 42]);

		$this->assertSame(['status' => 'pending'], $this->controller()->status(42)->getData());
	}

	public function testReadyWithAMissingCacheFolderIsConvertedAgain(): void {
		$this->fileResolver->method('resolveOwnNode')->willReturn($this->node());
		$this->ready();
		$this->clientFallback->method('reason')->willReturn(null);
		$this->conversionService->method('getPageCount')->willThrowException(new NotFoundException());
		$this->jobList->expects($this->once())->method('add');

		$response = $this->controller()->status(42);
		$this->assertSame(Http::STATUS_OK, $response->getStatus());
		$this->assertSame(['status' => 'pending'], $response->getData());
	}

	// --- The client answer (E7) ----------------------------------------------

	public function testTheClientAnswerHasEverythingToConvertInTheBrowser(): void {
		$this->fileResolver->method('resolveOwnNode')->willReturn($this->node(folderWritable: false));
		$this->conversionService->method('find')->willReturn(null);
		$this->clientFallback->method('reason')->willReturn(ScoreConversion::ERROR_LOCAL_UNAVAILABLE);
		$this->localConverter->method('engineVersion')->willReturn('4.7.7-engine.1');
		$this->soundFont->method('expectedVersion')->willReturn('');
		$this->jobList->expects($this->never())->method('add');

		$this->assertSame([
			'status' => ClientFallback::STATUS_CLIENT,
			'reason' => ScoreConversion::ERROR_LOCAL_UNAVAILABLE,
			'sourceUrl' => 'scoreview.conversion.source?fileId=42&v=etag1',
			'engineUrl' => 'scoreview.engine.get?version=4.7.7-engine.1&name=scoreview.mjs',
			'maxBytes' => 10485760,
			// "Not fetched yet" is a version of its own, never an empty v.
			'soundFontUrl' => 'scoreview.sound_font.get?v=0',
			'canWriteFolder' => false,
			'etag' => 'etag1',
			'canReconvert' => true,
		], $this->controller()->status(42)->getData());
	}

	// --- Error texts stay with members (issue #44) ---------------------------

	private function failed(): void {
		$this->fileResolver->method('resolveOwnNode')->willReturn($this->node());
		$conversion = $this->datensatz(ScoreConversion::STATUS_ERROR);
		$conversion->setErrorCode(ScoreConversion::ERROR_CONVERSION_FAILED);
		$conversion->setErrorMessage('node /var/www/html/apps/scoreview/converter/convert.mjs exited with 1');
		$this->conversionService->method('find')->willReturn($conversion);
		$this->conversionService->method('isStale')->willReturn(false);
		$this->quota->method('consume')->willReturn(true);
	}

	public function testAVisitorGetsTheErrorCodeButNotTheText(): void {
		$this->directAccess->method('shareGrant')->willReturn(new PublicShareGrant('owner', null, false, 'dig'));
		$this->failed();

		$data = $this->controller()->status(42)->getData();
		$this->assertSame(ScoreConversion::ERROR_CONVERSION_FAILED, $data['errorCode']);
		$this->assertArrayNotHasKey('error', $data);
	}

	public function testAMemberKeepsTheErrorText(): void {
		$this->failed();

		$data = $this->controller()->status(42)->getData();
		$this->assertSame('node /var/www/html/apps/scoreview/converter/convert.mjs exited with 1', $data['error']);
	}

	// --- artifact() and source() (issue #63) ---------------------------------

	/** getHeaders() needs the server - the header is in the field. */
	private function header(Http\Response $response, string $name): ?string {
		return (new \ReflectionProperty(Http\Response::class, 'headers'))->getValue($response)[$name] ?? null;
	}

	public function testAnArtifactIsAnImmutableAttachmentUnderTheFilesEtag(): void {
		$this->fileResolver->method('resolveOwnNode')->willReturn($this->node());
		$conversion = $this->ready();
		$file = $this->createMock(ISimpleFile::class);
		$file->method('read')->willReturn(fopen('php://memory', 'rb'));
		$file->method('getSize')->willReturn(0);
		$this->conversionService->method('getArtifact')->with(42, 'etag1', 'page-1')->willReturn([$file, 'image/svg+xml']);

		$response = $this->controller()->artifact(42, 'page-1');

		$this->assertInstanceOf(ArtifactResponse::class, $response);
		$this->assertSame('etag1', $response->getETag());
		$this->assertSame($conversion->getUpdatedAt(), $response->getLastModified());
		$this->assertSame('attachment', $this->header($response, 'Content-Disposition'));
		$this->assertSame('image/svg+xml', $this->header($response, 'Content-Type'));
		$this->assertStringContainsString('immutable', (string)$this->header($response, 'Cache-Control'));
	}

	public function testAnArtifactOfAnUnfinishedConversionIs404(): void {
		$this->fileResolver->method('resolveOwnNode')->willReturn($this->node());
		$this->conversionService->method('find')->willReturn($this->datensatz(ScoreConversion::STATUS_PROCESSING));
		$this->conversionService->expects($this->never())->method('getArtifact');

		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->artifact(42, 'page-1')->getStatus());
	}

	public function testAnArtifactOfAnOlderFormatIs404(): void {
		$this->fileResolver->method('resolveOwnNode')->willReturn($this->node());
		$this->conversionService->method('find')->willReturn($this->datensatz(ScoreConversion::STATUS_READY));
		$this->conversionService->method('isCurrentFormat')->willReturn(false);

		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->artifact(42, 'page-1')->getStatus());
	}

	public function testAnUnknownArtifactIs404(): void {
		$this->fileResolver->method('resolveOwnNode')->willReturn($this->node());
		$this->ready();
		$this->conversionService->method('getArtifact')->willThrowException(new NotFoundException());

		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->artifact(42, 'secrets')->getStatus());
	}

	public function testAnArtifactOfAFolderIs404(): void {
		$this->fileResolver->method('resolveOwnNode')->willReturn($this->createMock(Folder::class));
		$this->conversionService->expects($this->never())->method('find');

		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->artifact(42, 'page-1')->getStatus());
	}

	public function testTheSourceIsTheScoreAsAnImmutableAttachment(): void {
		$node = $this->node();
		$node->method('fopen')->willReturn(fopen('php://memory', 'rb'));
		$this->fileResolver->method('resolveOwnNode')->willReturn($node);

		$response = $this->controller()->source(42);

		$this->assertSame(Http::STATUS_OK, $response->getStatus());
		$this->assertSame('application/x-musescore', $this->header($response, 'Content-Type'));
		$this->assertSame('attachment', $this->header($response, 'Content-Disposition'));
		$this->assertSame('1234', $this->header($response, 'Content-Length'));
		$this->assertSame('etag1', $response->getETag());
		$this->assertStringContainsString('immutable', (string)$this->header($response, 'Cache-Control'));
	}

	public function testAnUnreadableSourceIs404(): void {
		$node = $this->node();
		$node->method('fopen')->willThrowException(new \RuntimeException('storage gone'));
		$this->fileResolver->method('resolveOwnNode')->willReturn($node);

		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->source(42)->getStatus());
	}

	public function testTheSourceOfAFolderIs404(): void {
		$this->fileResolver->method('resolveOwnNode')->willReturn($this->createMock(Folder::class));

		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->source(42)->getStatus());
	}
}
