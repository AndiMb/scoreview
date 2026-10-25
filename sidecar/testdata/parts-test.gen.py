# Writes the MusicXML of parts-test.mscz (see README.md): four parts
# (S, A, Clarinet in Bb, Piano), 24 measures 4/4, repeat with volta 5-9, line
# break before 7, clarinet rest 14-21, tempo and voltas in the first part only.
# Usage: python parts-test.gen.py <out.musicxml>
import sys
import xml.sax.saxutils as su
N = 24
REST = range(14, 22)
LYR = "Kom-men wir zum Lied hin-aus, sin-gen froh von Haus zu Haus".replace(",", "").split()
# split into syllables with hyphen info
syl = []
for w in "Kom-men wir zum Lied hin-aus sin-gen froh von Haus zu Haus".split():
    parts = w.split("-")
    for i, p in enumerate(parts):
        if len(parts) == 1: s = "single"
        elif i == 0: s = "begin"
        elif i == len(parts) - 1: s = "end"
        else: s = "middle"
        syl.append((p, s))
SOP = ["C5", "D5", "E5", "F5", "G5", "F5", "E5", "D5"]
ALT = ["A4", "Bb4", "C5", "C5", "C5", "A4", "G4", "Bb4"]
CLA = ["G4", "A4"]  # written pitch for Bb clarinet sounding F/G -> written a tone higher
PIA_R = [["F4", "A4", "C5"], ["Bb3", "D4", "F4"], ["C4", "E4", "G4"], ["F4", "A4", "C5"]]
PIA_L = ["F2", "Bb2", "C3", "F2"]

def pitch(p):
    step = p[0]; alter = ""; octv = p[-1]
    if len(p) == 3: alter = "<alter>%d</alter>" % (-1 if p[1] == "b" else 1)
    return "<pitch><step>%s</step>%s<octave>%s</octave></pitch>" % (step, alter, octv)

def note(p, dur, typ, chord=False, lyric=None, staff=None, voice=1):
    s = "<note>" + ("<chord/>" if chord else "") + pitch(p) + "<duration>%d</duration><voice>%d</voice><type>%s</type>" % (dur, voice, typ)
    if staff: s += "<staff>%d</staff>" % staff
    if lyric:
        s += '<lyric number="1"><syllabic>%s</syllabic><text>%s</text></lyric>' % (lyric[1], su.escape(lyric[0]))
    return s + "</note>"

def rest(dur, typ, staff=None, voice=1, measure=False):
    r = '<rest measure="yes"/>' if measure else "<rest/>"
    s = "<note>%s<duration>%d</duration><voice>%d</voice>" % (r, dur, voice)
    if not measure: s += "<type>%s</type>" % typ
    if staff: s += "<staff>%d</staff>" % staff
    return s + "</note>"

def barline_extras(m, endings=True):
    left = right = ""
    if m == 5: left = '<barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>'
    if m == 8:
        left = '<barline location="left"><ending number="1" type="start">1.</ending></barline>' if endings else ''
        right = '<barline location="right"><bar-style>light-heavy</bar-style>%s<repeat direction="backward"/></barline>' % ('<ending number="1" type="stop"/>' if endings else '')
    if m == 9 and endings:
        left = '<barline location="left"><ending number="2" type="start">2.</ending></barline>'
        right = '<barline location="right"><ending number="2" type="discontinue"/></barline>'
    if m == N: right = '<barline location="right"><bar-style>light-heavy</bar-style></barline>'
    return left, right

def attrs(m, extra):
    if m != 1: return ""
    return "<attributes><divisions>1</divisions><key><fifths>-1</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time>%s</attributes>" % extra

def print_el(m):
    return '<print new-system="yes"/>' if m == 7 else ""

def vocal(name_notes, with_lyrics, tempo=False):
    out = []; k = 0
    for m in range(1, N + 1):
        left, right = barline_extras(m, endings=tempo)
        body = print_el(m) + left + attrs(m, "<clef><sign>G</sign><line>2</line></clef>")
        if m == 1 and tempo:
            body += '<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>96</per-minute></metronome></direction-type><sound tempo="96"/></direction>'
        if m == N:
            body += note(name_notes[0], 4, "whole", lyric=(syl[k % len(syl)] if with_lyrics else None))
            k += 1
        else:
            for i in range(4):
                p = name_notes[(m + i) % len(name_notes)]
                body += note(p, 1, "quarter", lyric=(syl[k % len(syl)] if with_lyrics else None))
                k += 1
        out.append('<measure number="%d">%s%s</measure>' % (m, body, right))
    return "".join(out)

def clarinet():
    out = []
    for m in range(1, N + 1):
        left, right = barline_extras(m, endings=False)
        body = print_el(m) + left + attrs(m, "<clef><sign>G</sign><line>2</line></clef><transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>").replace("<fifths>-1</fifths>", "<fifths>1</fifths>")
        if m in REST:
            body += rest(4, "whole", measure=True)
        else:
            body += note(CLA[m % 2], 2, "half") + note(CLA[(m + 1) % 2], 2, "half")
        out.append('<measure number="%d">%s%s</measure>' % (m, body, right))
    return "".join(out)

def piano():
    out = []
    for m in range(1, N + 1):
        left, right = barline_extras(m, endings=False)
        body = print_el(m) + left + attrs(m, "<staves>2</staves><clef number=\"1\"><sign>G</sign><line>2</line></clef><clef number=\"2\"><sign>F</sign><line>4</line></clef>")
        ch = PIA_R[m % 4]
        body += note(ch[0], 4, "whole", staff=1) + "".join(note(p, 4, "whole", chord=True, staff=1) for p in ch[1:])
        body += "<backup><duration>4</duration></backup>"
        body += note(PIA_L[m % 4], 4, "whole", staff=2, voice=5)
        out.append('<measure number="%d">%s%s</measure>' % (m, body, right))
    return "".join(out)

parts = [
    ("P1", "Sopran", "Voice", vocal(SOP, True, tempo=True)),
    ("P2", "Alt", "Voice", vocal(ALT, True)),
    ("P3", "Klarinette in B", "Clarinet", clarinet()),
    ("P4", "Klavier", "Piano", piano()),
]
plist = "".join('<score-part id="%s"><part-name>%s</part-name><score-instrument id="%s-I1"><instrument-name>%s</instrument-name></score-instrument></score-part>' % (i, n, i, ins) for i, n, ins, _ in parts)
body = "".join('<part id="%s">%s</part>' % (i, mm) for i, _, _, mm in parts)
doc = ('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n'
       '<score-partwise version="4.0"><work><work-title>Stimmen-Test</work-title></work>'
       '<identification><creator type="composer">ScoreView</creator><rights>CC0 1.0 - erstellt fuer die ScoreView-Tests</rights></identification>'
       '<part-list>%s</part-list>%s</score-partwise>\n') % (plist, body)
open(sys.argv[1] if len(sys.argv) > 1 else "parts-test.musicxml", "w", encoding="utf-8").write(doc)
print("ok", len(doc))
