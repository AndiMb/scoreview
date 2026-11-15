<?php
declare(strict_types=1);
/**
 * Nur der Montageknoten der eigenstaendigen Seite - den Inhalt baut
 * js/scoreview-standalone.js (src/standalone.js). Ein Inline-<script> waere
 * hier chancenlos: Nextclouds CSP blockt es ohne Nonce, ein per
 * Util::addScript geladenes Bundle bekommt sie automatisch.
 *
 * Ausgeliefert wird diese Seite fuer die mobilen Apps unter
 * /apps/files/directEditing/{token} (siehe DirectEditing\ScoreDirectEditor) -
 * dafuer hat sie bewusst keine eigene Route. The second delivery is the page
 * for visitors of a public link, /apps/scoreview/public/{token}/{fileId}
 * (Controller\PageController::publicViewer): the same viewer in guest mode.
 */
?>
<div id="scoreview-standalone"></div>
