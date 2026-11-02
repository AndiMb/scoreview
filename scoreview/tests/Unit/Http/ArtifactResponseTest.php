<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Http;

use OCA\ScoreView\Http\ArtifactResponse;
use OCP\AppFramework\Http\IOutput;
use OCP\IRequest;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Pages and JSON artifacts go out gzip-compressed because the stock web
 * server config does not compress these types; what must hold is that the
 * browser gets exactly the bytes of the artifact back, and that a client
 * refusing gzip gets them as they are.
 */
class ArtifactResponseTest extends TestCase {
	private function request(string $acceptEncoding): IRequest {
		$request = $this->createMock(IRequest::class);
		$request->method('getHeader')->willReturnCallback(fn (string $name) => $name === 'Accept-Encoding' ? $acceptEncoding : '');
		return $request;
	}

	/** @return resource */
	private function handle(string $content) {
		$handle = fopen('php://memory', 'w+b');
		fwrite($handle, $content);
		rewind($handle);
		return $handle;
	}

	/** getHeaders() needs the server - the header is in the field. */
	private function header(ArtifactResponse $response, string $name): ?string {
		return (new \ReflectionProperty(\OCP\AppFramework\Http\Response::class, 'headers'))->getValue($response)[$name] ?? null;
	}

	private function send(ArtifactResponse $response): string {
		$body = '';
		$output = $this->createMock(IOutput::class);
		$output->method('setOutput')->willReturnCallback(function ($out) use (&$body): void {
			$body .= $out;
		});
		$response->callback($output);
		return $body;
	}

	public function testCompressesASvgPageAndKeepsItsBytes(): void {
		// More than one read chunk, so the streaming path is exercised.
		$svg = '<svg xmlns="http://www.w3.org/2000/svg">' . str_repeat('<path d="M0 0L10 10"/>', 10000) . '</svg>';
		$response = new ArtifactResponse($this->handle($svg), 'image/svg+xml', $this->request('gzip, deflate, br'), strlen($svg));

		$this->assertTrue($response->isCompressed());
		$this->assertSame('gzip', $this->header($response, 'Content-Encoding'));
		$this->assertSame('Accept-Encoding', $this->header($response, 'Vary'));
		$body = $this->send($response);
		$this->assertLessThan(strlen($svg) / 5, strlen($body));
		$this->assertSame($svg, gzdecode($body));
	}

	public function testSendsAsIsWhenTheClientRefusesGzip(): void {
		$json = json_encode(['measures' => range(1, 2000)]);
		$response = new ArtifactResponse($this->handle($json), 'application/json', $this->request('identity'), strlen($json));

		$this->assertFalse($response->isCompressed());
		$this->assertNull($this->header($response, 'Content-Encoding'));
		$this->assertSame($json, $this->send($response));
	}

	public function testLeavesSmallAndBinaryArtifactsAlone(): void {
		$this->assertFalse((new ArtifactResponse($this->handle('{}'), 'application/json', $this->request('gzip'), 2))->isCompressed());
		$this->assertFalse((new ArtifactResponse($this->handle(str_repeat('x', 5000)), 'application/octet-stream', $this->request('gzip'), 5000))->isCompressed());
	}

	public static function acceptEncodings(): array {
		return [
			'browser' => ['gzip, deflate, br, zstd', true],
			'with quality' => ['br;q=1.0, gzip;q=0.8', true],
			'refused' => ['gzip;q=0, *;q=1', false],
			'star' => ['*', true],
			'star refused' => ['*;q=0', false],
			'none' => ['', false],
			'identity only' => ['identity', false],
			'upper case' => ['GZIP', true],
		];
	}

	#[DataProvider('acceptEncodings')]
	public function testReadsAcceptEncoding(string $header, bool $expected): void {
		$this->assertSame($expected, ArtifactResponse::acceptsGzip($header));
	}
}
