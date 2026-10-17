<?php

declare(strict_types=1);

namespace OCA\ScoreView\Search;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Db\ScoreConversionMapper;
use OCP\Files\File;
use OCP\Files\IMimeTypeDetector;
use OCP\Files\IRootFolder;
use OCP\IL10N;
use OCP\IURLGenerator;
use OCP\IUser;
use OCP\Search\IProvider;
use OCP\Search\ISearchQuery;
use OCP\Search\SearchResult;
use OCP\Search\SearchResultEntry;

/**
 * Title and composer of a score in the Nextcloud search (D1, E17).
 *
 * Nextcloud's own file search finds the file name; this provider adds what
 * is printed on the score - title, subtitle, composer, lyricist - from the
 * conversion table, where markReady() put it.
 *
 * The table knows files, not people. Every hit is therefore resolved in the
 * searcher's OWN file tree, and a file that is not there drops out without a
 * trace: the provider never reveals that a score exists (S8 in spirit).
 * Because dropped rows leave gaps, it reads on in up to three rounds until
 * the page is full; the cursor is the row offset behind the last row read.
 */
class ScoreSearchProvider implements IProvider {
	/** Files has order 5 on its own pages; scores come soon after there. */
	private const ORDER_FILES = 25;
	/** Everywhere else after files, contacts and calendar. */
	private const ORDER_ELSEWHERE = 60;
	private const MIN_TERM_LENGTH = 2;
	private const ROUNDS = 3;

	public function __construct(
		private ScoreConversionMapper $mapper,
		private IRootFolder $rootFolder,
		private IURLGenerator $url,
		private IMimeTypeDetector $mimeTypes,
		private IL10N $l,
	) {
	}

	public function getId(): string {
		return Application::APP_ID;
	}

	public function getName(): string {
		return $this->l->t('Scores');
	}

	public function getOrder(string $route, array $routeParameters): ?int {
		return str_starts_with($route, 'files.') ? self::ORDER_FILES : self::ORDER_ELSEWHERE;
	}

	public function search(IUser $user, ISearchQuery $query): SearchResult {
		$term = trim($query->getTerm());
		if (mb_strlen($term) < self::MIN_TERM_LENGTH) {
			return SearchResult::complete($this->getName(), []);
		}
		$limit = max(1, $query->getLimit());
		$offset = max(0, (int)$query->getCursor());
		$userFolder = $this->rootFolder->getUserFolder($user->getUID());

		$entries = [];
		$seen = [];
		$exhausted = false;
		for ($round = 0; $round < self::ROUNDS && count($entries) < $limit && !$exhausted; $round++) {
			$rows = $this->mapper->search($term, $limit, $offset);
			$exhausted = count($rows) < $limit;
			foreach ($rows as $row) {
				if (count($entries) >= $limit) {
					// Full: the next page starts at this row.
					$exhausted = false;
					break;
				}
				$offset++;
				$fileId = $row->getFileId();
				if (isset($seen[$fileId])) {
					continue;
				}
				$seen[$fileId] = true;
				$file = null;
				foreach ($userFolder->getById($fileId) as $node) {
					if ($node instanceof File) {
						$file = $node;
						break;
					}
				}
				if ($file === null) {
					continue;
				}
				$entries[] = $this->entry($file, $row->getTitle(), $row->getComposer(), $userFolder->getRelativePath($file->getPath()) ?? $file->getName());
			}
		}

		return $exhausted
			? SearchResult::complete($this->getName(), $entries)
			: SearchResult::paginated($this->getName(), $entries, $offset);
	}

	/**
	 * The subline names the path WITH the file name: two copies of a score
	 * carry the same title and composer, and only the path tells them apart.
	 */
	private function entry(File $file, ?string $title, ?string $composer, string $path): SearchResultEntry {
		$name = $title ?? pathinfo($file->getName(), PATHINFO_FILENAME);
		$subline = implode(' · ', array_filter([$composer ?? '', $path], static fn (string $p) => $p !== ''));
		$entry = new SearchResultEntry(
			// Falls back to the mimetype icon when there is no preview, as
			// Nextcloud's own file search does.
			$this->url->linkToRouteAbsolute('core.Preview.getPreviewByFileId', ['x' => 64, 'y' => 64, 'fileId' => $file->getId(), 'mimeFallback' => 1]),
			$name,
			$subline,
			// The same entry as Files - it opens the score in the viewer (E6).
			$this->url->linkToRouteAbsolute('files.View.showFile', ['fileid' => $file->getId()]),
			$this->mimeTypes->mimeTypeIcon($file->getMimetype()),
		);
		$entry->addAttribute('fileId', (string)$file->getId());
		return $entry;
	}
}
