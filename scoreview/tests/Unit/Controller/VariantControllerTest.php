<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Controller;

use OCA\ScoreView\BackgroundJob\ConvertScoreJob;
use OCA\ScoreView\Controller\VariantController;
use OCA\ScoreView\Db\ScoreConversion;
use OCA\ScoreView\Db\ScoreVariant;
use OCA\ScoreView\Service\ConversionBackend;
use OCA\ScoreView\Service\ConversionService;
use OCA\ScoreView\Service\UserFileResolver;
use OCA\ScoreView\Service\VariantService;
use OCP\AppFramework\Http;
use OCP\Files\Node;
use OCP\Files\SimpleFS\ISimpleFile;
use OCP\IL10N;
use OCP\IRequest;
use OCP\IURLGenerator;
use OCP\IUser;
use OCP\IUserSession;
use OCP\Security\RateLimiting\ILimiter;
use OCP\Security\RateLimiting\IRateLimitExceededException;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

/**
 * The variant routes (docs/architecture.md E19):
 *
 * 1. Access as for the base - unresolvable file or unknown key is a 404.
 * 2. A variant needs a ready base and a source the score has.
 * 3. Only a run is rate limited (S4), not reading a cached variant.
 * 4. A ready answer has the base's shape; its MIDI is the base's, its etag
 *    the file's - notes made in a variant are stored against the base.
 * 5. The sidecar path engraves no variants and says so with a code.
 */
class VariantControllerTest extends TestCase {
	private UserFileResolver&MockObject $fileResolver;
	private ConversionService&MockObject $conversionService;
	private VariantService&MockObject $variantService;
	private ConversionBackend&MockObject $backend;
	private ConvertScoreJob&MockObject $job;
	private ILimiter&MockObject $limiter;
	private IURLGenerator&MockObject $urls;

	protected function setUp(): void {
		$this->fileResolver = $this->createMock(UserFileResolver::class);
		$this->conversionService = $this->createMock(ConversionService::class);
		$this->variantService = $this->createMock(VariantService::class);
		$this->backend = $this->createMock(ConversionBackend::class);
		$this->backend->method('supportsVariants')->willReturn(true);
		$this->job = $this->createMock(ConvertScoreJob::class);
		$this->limiter = $this->createMock(ILimiter::class);
		$this->urls = $this->createMock(IURLGenerator::class);
		$this->urls->method('linkToRoute')->willReturnCallback(
			static fn (string $route, array $p) => $route . ':' . ($p['key'] ?? '') . ':' . $p['name'] . ':' . $p['v']);
	}

	private function controller(): VariantController {
		$session = $this->createMock(IUserSession::class);
		$session->method('getUser')->willReturn($this->createMock(IUser::class));
		$l = $this->createMock(IL10N::class);
		$l->method('t')->willReturnArgument(0);
		return new VariantController(
			$this->createMock(IRequest::class),
			$this->fileResolver,
			$this->conversionService,
			$this->variantService,
			$this->backend,
			$this->job,
			$this->limiter,
			$session,
			$this->urls,
			$l,
		);
	}

	private function withFile(): void {
		$node = $this->createMock(Node::class);
		$node->method('getEtag')->willReturn('e1');
		$this->fileResolver->method('resolveOwnNode')->willReturn($node);
	}

	private function withReadyBase(array $meta = ['excerpts' => [['id' => 0]], 'parts' => [['id' => '3']]]): void {
		$base = new ScoreConversion();
		$base->setEtag('e1');
		$base->setStatus(ScoreConversion::STATUS_READY);
		$base->setUpdatedAt((new \DateTime())->setTimestamp(1000));
		$this->conversionService->method('find')->willReturn($base);
		$this->conversionService->method('isCurrentFormat')->willReturn(true);
		$file = $this->createMock(ISimpleFile::class);
		$file->method('getContent')->willReturn(json_encode($meta));
		$this->conversionService->method('getMetaJsonFile')->willReturn($file);
	}

	private function readyVariant(string $key): ScoreVariant {
		$v = new ScoreVariant();
		$v->setEtag('e1');
		$v->setVariant($key);
		$v->setStatus(ScoreConversion::STATUS_READY);
		$v->setPageCount(2);
		$v->setUpdatedAt((new \DateTime())->setTimestamp(2000));
		return $v;
	}

	public function testAnUnresolvableFileIs404(): void {
		$this->fileResolver->method('resolveOwnNode')->willReturn(null);
		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->status(42, 'full~phone~w~0')->getStatus());
	}

	public function testAKeyOutsideTheGrammarIs404(): void {
		$this->withFile();
		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->status(42, 'full~orig~w~0')->getStatus());
		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->status(42, 'ex01~orig~w~0')->getStatus());
	}

	public function testABaseThatIsNotReadyIsAConflict(): void {
		$this->withFile();
		$this->conversionService->method('find')->willReturn(null);
		$this->assertSame(Http::STATUS_CONFLICT, $this->controller()->status(42, 'full~phone~w~0')->getStatus());
	}

	public function testASourceTheScoreLacksIs404(): void {
		$this->withFile();
		$this->withReadyBase();
		$this->job->expects($this->never())->method('convertVariant');
		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->status(42, 'ex1~orig~w~0')->getStatus());
		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->status(42, 'part9~orig~w~0')->getStatus());
	}

	public function testTheSidecarPathSaysItCannot(): void {
		$this->backend = $this->createMock(ConversionBackend::class);
		$this->backend->method('supportsVariants')->willReturn(false);
		$this->withFile();
		$this->withReadyBase();
		$response = $this->controller()->status(42, 'full~phone~w~0');
		$this->assertSame(ScoreVariant::ERROR_UNSUPPORTED, $response->getData()['errorCode']);
	}

	public function testACachedVariantIsServedWithoutARunAndWithoutTheLimiter(): void {
		$this->withFile();
		$this->withReadyBase();
		$this->variantService->method('find')->willReturn($this->readyVariant('part3~phone~w~-2'));
		$this->variantService->method('isCurrent')->willReturn(true);
		$this->limiter->expects($this->never())->method('registerUserRequest');
		$this->job->expects($this->never())->method('convertVariant');

		$data = $this->controller()->status(42, 'part3~phone~w~-2')->getData();

		$this->assertSame('ready', $data['status']);
		$this->assertSame(2, $data['files']['pageCount']);
		$this->assertSame('scoreview.variant.artifact:part3~phone~w~-2:page-1:e1-2000', $data['files']['pages'][0]);
		// The base's MIDI under the base's version, and the file's etag.
		$this->assertSame('scoreview.conversion.artifact::midi:e1-1000', $data['files']['midi']);
		$this->assertSame('e1', $data['files']['etag']);
	}

	public function testAMissingVariantIsEngravedInTheRequest(): void {
		$this->withFile();
		$this->withReadyBase();
		$this->variantService->method('find')->willReturn(null);
		$claimed = $this->readyVariant('ex0~orig~w~0');
		$this->variantService->method('claim')->willReturn($claimed);
		$this->variantService->method('isCurrent')->willReturn(true);
		$this->limiter->expects($this->once())->method('registerUserRequest')
			->with('scoreview-variant', VariantController::RUNS_PER_HOUR, 3600);
		$this->job->expects($this->once())->method('convertVariant')->with($this->anything(), $claimed);

		$this->assertSame('ready', $this->controller()->status(42, 'ex0~orig~w~0')->getData()['status']);
	}

	public function testAVariantClaimedByAnotherRequestIsPending(): void {
		$this->withFile();
		$this->withReadyBase();
		$this->variantService->method('find')->willReturn(null);
		$this->variantService->method('claim')->willReturn(null);
		$this->job->expects($this->never())->method('convertVariant');
		$this->assertSame('pending', $this->controller()->status(42, 'full~phone~w~0')->getData()['status']);
	}

	public function testTooManyRunsAreRefused(): void {
		$this->withFile();
		$this->withReadyBase();
		$this->variantService->method('find')->willReturn(null);
		$this->limiter->method('registerUserRequest')->willThrowException($this->createMock(IRateLimitExceededException::class));
		$this->job->expects($this->never())->method('convertVariant');
		$response = $this->controller()->status(42, 'full~phone~w~0');
		$this->assertSame(Http::STATUS_TOO_MANY_REQUESTS, $response->getStatus());
		$this->assertSame('rate_limited', $response->getData()['errorCode']);
	}

	public function testAFreshErrorIsReportedNotRetried(): void {
		$this->withFile();
		$this->withReadyBase();
		$failed = $this->readyVariant('full~phone~w~0');
		$failed->setStatus(ScoreConversion::STATUS_ERROR);
		$failed->setErrorCode(ScoreConversion::ERROR_CONVERSION_FAILED);
		$this->variantService->method('find')->willReturn($failed);
		$this->variantService->method('mayRetry')->willReturn(false);
		$this->job->expects($this->never())->method('convertVariant');
		$this->assertSame('conversion_failed', $this->controller()->status(42, 'full~phone~w~0')->getData()['errorCode']);
	}

	public function testArtifactsOfAnUnfinishedVariantAre404(): void {
		$this->withFile();
		$this->variantService->method('find')->willReturn(null);
		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->artifact(42, 'full~phone~w~0', 'page-1')->getStatus());
	}
}
