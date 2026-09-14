<?php
declare(strict_types=1);
/**
 * Nur der Montageknoten der eigenstaendigen Seite - den Inhalt baut
 * js/scoreview-standalone.js (src/standalone.js). Ein Inline-<script> waere
 * hier chancenlos: Nextclouds CSP blockt es ohne Nonce, ein per
 * Util::addScript geladenes Bundle bekommt sie automatisch.
 *
 * Ausgeliefert wird diese Seite ausschliesslich unter
 * /apps/files/directEditing/{token} (siehe DirectEditing\ScoreDirectEditor) -
 * sie hat bewusst keine eigene Route.
 */
?>
<div id="scoreview-standalone"></div>
