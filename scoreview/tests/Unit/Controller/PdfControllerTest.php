<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Controller;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Controller\PdfController;
use OCA\ScoreView\Middleware\Attribute\DirectTokenOrSession;
use OCA\ScoreView\Middleware\DirectAccessContext;
use OCA\ScoreView\Service\FeatureConfig;
use OCA\ScoreView\Service\RequestBodyReader;
use OCA\ScoreView\Service\SiblingFileException;
use OCA\ScoreView\Service\SiblingFileService;
use OCA\ScoreView\Service\UserFileResolver;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\AnonRateLimit;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\AppFramework\Http\Attribute\UserRateLimit;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\Node;
use OCP\IAppConfig;
use OCP\IL10N;
use OCP\IRequest;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

/**
 * The upload of a score's PDF file (A1b, E16): what a mistake here would
 * do - probe other people's files (404), write without permission (403),
 * read huge bodies (413), store anything as .pdf (415), overwrite silently
 * (409). The folder logic is SiblingFileServiceTest's.
 */
class PdfControllerTest extends TestCase {
	private UserFileResolver&MockObject $fileResolver;
	private SiblingFileService&MockObject $files;
	private RequestBodyReader&MockObject $body;
	private IRequest&MockObject $request;
	private DirectAccessContext $access;
	private Folder&MockObject $parent;

	protected function setUp(): void {
		$this->fileResolver = $this->createMock(UserFileResolver::class);
		$this->files = $this->createMock(SiblingFileService::class);
		$this->body = $this->createMock(RequestBodyReader::class);
		$this->request = $this->createMock(IRequest::class);
		$this->access = new DirectAccessContext();
		$this->access->setSession();
		$this->parent = $this->createMock(Folder::class);
	}

	private function controller(): PdfController {
		$l = $this->createMock(IL10N::class);
		$l->method('t')->willReturnArgument(0);
		$appConfig = $this->createMock(IAppConfig::class);
		$appConfig->method('getValueInt')->willReturnArgument(2);
		return new PdfController($this->request, $this->fileResolver, $this->files, new FeatureConfig($appConfig), $this->body, $this->access, $l);
	}

	private function score(bool $writable = true): File {
		$this->parent->method('isCreatable')->willReturn($writable);
		$file = $this->createMock(File::class);
		$file->method('getMimetype')->willReturn(Application::MSCZ_MIMETYPE);
		$file->method('getName')->willReturn('Aequale_No_1.mscz');
		$file->method('getParent')->willReturn($this->parent);
		return $file;
	}

	private function signedIn(?Node $file): void {
		$this->fileResolver->method('currentUserId')->willReturn('anna');
		$this->fileResolver->method('resolveOwnNode')->willReturn($file);
	}

	/** @return resource */
	private function stream(string $content) {
		$s = fopen('php://temp', 'r+');
		fwrite($s, $content);
		rewind($s);
		return $s;
	}

	public function testSavesNextToTheScoreWithTheGivenName(): void {
		$this->signedIn($this->score());
		$this->body->method('readToStream')->willReturn($this->stream("%PDF-1.4\n"));
		$this->files->expects($this->once())->method('save')
			->with($this->parent, 'anna', $this->anything(), 'Aequale No. 1', '.pdf', false)
			->willReturn(['fileId' => 9, 'name' => 'Aequale No. 1.pdf', 'path' => '/Chor/Aequale No. 1.pdf']);

		$response = $this->controller()->create(42, 'Aequale No. 1');

		$this->assertSame(Http::STATUS_CREATED, $response->getStatus());
		$this->assertSame('Aequale No. 1.pdf', $response->getData()['name']);
	}

	public function testWithoutANameTheScoreNameIsUsed(): void {
		$this->signedIn($this->score());
		$this->body->method('readToStream')->willReturn($this->stream('%PDF-1.4'));
		$this->files->expects($this->once())->method('save')
			->with($this->anything(), 'anna', $this->anything(), 'Aequale_No_1', '.pdf', true)
			->willReturn(['fileId' => 9, 'name' => 'Aequale_No_1.pdf', 'path' => '/Aequale_No_1.pdf']);

		$this->assertSame(Http::STATUS_CREATED, $this->controller()->create(42, '', true)->getStatus());
	}

	public function testSomeoneElsesFileIsA404BeforeAnythingIsRead(): void {
		$this->signedIn(null);
		$this->body->expects($this->never())->method('readToStream');
		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->create(42)->getStatus());
	}

	public function testOnlyNextToAScore(): void {
		$this->signedIn($this->createMock(Folder::class));
		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->create(42)->getStatus());
	}

	public function testNoWritePermissionIsA403BeforeTheBodyIsRead(): void {
		$this->signedIn($this->score(false));
		$this->body->expects($this->never())->method('readToStream');
		$this->assertSame(Http::STATUS_FORBIDDEN, $this->controller()->create(42)->getStatus());
	}

	public function testACompanionTokenCreatesNothing(): void {
		$this->access->setToken(DirectAccessContext::COMPANION, 42, str_repeat('a', 32));
		$this->signedIn($this->score());
		$this->body->expects($this->never())->method('readToStream');
		$this->assertSame(Http::STATUS_FORBIDDEN, $this->controller()->create(42)->getStatus());
	}

	public function testTooLargeByHeader(): void {
		$this->signedIn($this->score());
		$this->request->method('getHeader')->with('Content-Length')->willReturn((string)(51 * 1048576));
		$this->body->expects($this->never())->method('readToStream');
		$this->assertSame(Http::STATUS_REQUEST_ENTITY_TOO_LARGE, $this->controller()->create(42)->getStatus());
	}

	public function testTooLargeWhileReading(): void {
		$this->signedIn($this->score());
		$this->body->expects($this->once())->method('readToStream')->with(50 * 1048576)->willReturn(null);
		$this->assertSame(Http::STATUS_REQUEST_ENTITY_TOO_LARGE, $this->controller()->create(42)->getStatus());
	}

	public function testNotAPdf(): void {
		$this->signedIn($this->score());
		$this->body->method('readToStream')->willReturn($this->stream('<svg xmlns="http://www.w3.org/2000/svg"/>'));
		$this->files->expects($this->never())->method('save');
		$this->assertSame(Http::STATUS_UNSUPPORTED_MEDIA_TYPE, $this->controller()->create(42)->getStatus());
	}

	public function testExistingFileIsA409WithAFreeName(): void {
		$this->signedIn($this->score());
		$this->body->method('readToStream')->willReturn($this->stream('%PDF-1.4'));
		$this->files->method('save')->willThrowException(new SiblingFileException(SiblingFileException::EXISTS, 'Ave (2).pdf'));
		$response = $this->controller()->create(42, 'Ave');
		$this->assertSame(Http::STATUS_CONFLICT, $response->getStatus());
		$this->assertSame('exists', $response->getData()['reason']);
		$this->assertSame('Ave (2).pdf', $response->getData()['suggested']);
	}

	public static function errors(): array {
		return [
			'no permission' => [SiblingFileException::FORBIDDEN, Http::STATUS_FORBIDDEN],
			'quota full' => [SiblingFileException::STORAGE_FULL, Http::STATUS_INSUFFICIENT_STORAGE],
			'busy' => [SiblingFileException::BUSY, Http::STATUS_SERVICE_UNAVAILABLE],
			'unusable' => [SiblingFileException::INVALID, Http::STATUS_BAD_REQUEST],
		];
	}

	#[DataProvider('errors')]
	public function testErrorsAreMapped(string $reason, int $status): void {
		$this->signedIn($this->score());
		$this->body->method('readToStream')->willReturn($this->stream('%PDF-1.7'));
		$this->files->method('save')->willThrowException(new SiblingFileException($reason));
		$this->assertSame($status, $this->controller()->create(42)->getStatus());
	}

	public function testRouteAttributes(): void {
		$m = new \ReflectionMethod(PdfController::class, 'create');
		$this->assertNotEmpty($m->getAttributes(DirectTokenOrSession::class));
		$this->assertNotEmpty($m->getAttributes(PublicPage::class));
		$this->assertNotEmpty($m->getAttributes(UserRateLimit::class));
		$this->assertNotEmpty($m->getAttributes(AnonRateLimit::class));
	}
}
