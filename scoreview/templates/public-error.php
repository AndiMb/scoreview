<?php
declare(strict_types=1);
/**
 * A public link that does not open the score (Controller\PageController::
 * publicViewer). Rendered by the server, without the viewer bundle: nothing
 * of the app loads for a link that does not open.
 *
 * @var array{message: string} $_
 */
?>
<div class="scoreview-public-error" role="alert" style="margin: auto; padding: 2em; text-align: center; max-inline-size: 40em;">
	<p><?php p($_['message']); ?></p>
</div>
