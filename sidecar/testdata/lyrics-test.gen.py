# Erzeugt lyrics-test.mscz aus keys-marks-test.mscz (im selben Verzeichnis):
# zwei Stimmen (Sopran, Bass), Takt 1-2 dreimal wiederholt mit drei Strophen,
# Takt 3 Schluss "A-men". Selbst erstellt, frei - siehe README.md.
#
#   python lyrics-test.gen.py
import zipfile, re
src = zipfile.ZipFile('keys-marks-test.mscz')
orig = [src.read(n) for n in src.namelist() if n.endswith('.mscx')][0].decode('utf-8')
part_tpl = re.search(r'    <Part id="1">.*?</Part>\n', orig, re.S).group(0)

# (pitch, tpc) je Viertel; Silben je Strophe: (text, syllabic)
SOP = [[(67,15),(69,17),(71,19),(72,14)], [(74,16),(72,14),(71,19),(69,17)], [(67,15),(67,15),(67,15),(67,15)]]
BAS = [[(48,14),(50,16),(52,18),(53,13)], [(55,15),(53,13),(52,18),(50,16)], [(48,14),(48,14),(48,14),(48,14)]]
# 3 Strophen fuer Takt 1-2 (8 Silben), Schluss Takt 3 (4 Silben, nur Strophe 1)
SOP_TXT = [
  [('Hal','begin'),('le','middle'),('lu','middle'),('ja','end'),('sin','begin'),('get','end'),('dem','single'),('Herrn','single')],
  [('Lo','begin'),('bet','end'),('ihn','single'),('mit','single'),('Psal','begin'),('men','end'),('und','single'),('Klang','single')],
  [('Eh','begin'),('re','end'),('sei','single'),('dem','single'),('Va','begin'),('ter','end'),('al','begin'),('lein','end')],
]
BAS_TXT = [
  [('Bass','single'),('eins','single'),('ru','begin'),('fen','end'),('lau','begin'),('te','end'),('Tö','begin'),('ne','end')],
  [('Bass','single'),('zwei','single'),('sin','begin'),('gen','end'),('lei','begin'),('se','end'),('Wei','begin'),('se','end')],
  [('Bass','single'),('drei','single'),('en','begin'),('det','end'),('fro','begin'),('he','end'),('Rei','begin'),('se','end')],
]
SCHLUSS = {'S': [('A','single'),('men','single'),('A','begin'),('men','end')], 'B': [('A','single'),('men','single'),('A','begin'),('men','end')]}

def lyric(no, text, syl):
    s = '            <Lyrics>\n'
    if no: s += f'              <no>{no}</no>\n'
    if syl != 'single': s += f'              <syllabic>{syl}</syllabic>\n'
    return s + f'              <text>{text}</text>\n            </Lyrics>\n'

def chord(p, tpc, lyrics):
    return ('          <Chord>\n            <durationType>quarter</durationType>\n' + ''.join(lyrics) +
            f'            <Note>\n              <pitch>{p}</pitch>\n              <tpc>{tpc}</tpc>\n              </Note>\n          </Chord>\n')

def staff(sid, notes, txt, schluss, clef):
    out = f'    <Staff id="{sid}">\n'
    if sid == 1:
        out += ('      <VBox>\n        <height>10</height>\n        <Text>\n          <style>title</style>\n'
                '          <text>ScoreView Lyrics Test</text>\n          </Text>\n      </VBox>\n')
    for m in range(3):
        out += '      <Measure>\n'
        if m == 0: out += '        <startRepeat/>\n'
        if m == 1: out += '        <endRepeat>3</endRepeat>\n'
        out += '        <voice>\n'
        if m == 0:
            out += (f'          <Clef>\n            <concertClefType>{clef}</concertClefType>\n            <transposingClefType>{clef}</transposingClefType>\n            <isHeader>1</isHeader>\n          </Clef>\n'
                    '          <KeySig>\n            <concertKey>0</concertKey>\n            </KeySig>\n'
                    '          <TimeSig>\n            <sigN>4</sigN>\n            <sigD>4</sigD>\n          </TimeSig>\n')
        for i, (p, tpc) in enumerate(notes[m]):
            if m < 2:
                ly = [lyric(v, *txt[v][m*4+i]) for v in range(3)]
            else:
                ly = [lyric(0, *schluss[i])]
            out += chord(p, tpc, ly)
        if m == 2: out += '          <BarLine>\n            <subtype>end</subtype>\n            </BarLine>\n'
        out += '          </voice>\n        </Measure>\n'
    return out + '      </Staff>\n'

def part(pid, name, clef):
    p = part_tpl.replace('<Part id="1">', f'<Part id="{pid}">')
    p = re.sub(r'<eid>[^<]*</eid>\s*', '', p)
    p = p.replace('<trackName>Test</trackName>', f'<trackName>{name}</trackName>').replace('<longName>Test</longName>', f'<longName>{name}</longName>')
    p = p.replace('<StaffType group="pitched">', f'<StaffType group="pitched">').replace('<Staff>', f'<Staff id="{pid}">', 1)
    p = p.replace('<program value="0"/>', '<program value="52"/>')
    if clef == 'F':
        p = p.replace('</StaffType>\n', '</StaffType>\n        <defaultClef>F</defaultClef>\n', 1)
    return p

head = orig.split('    <Part id="1">')[0].replace('ScoreView Repeat/Volta/D.C. Test', 'ScoreView Lyrics Test')
head = re.sub(r'    <eid>[^<]*</eid>\n', '', head, count=1)
body = (part(1, 'Sopran', 'G') + part(2, 'Bass', 'F') +
        staff(1, SOP, SOP_TXT, SCHLUSS['S'], 'G') + staff(2, BAS, BAS_TXT, SCHLUSS['B'], 'F'))
mscx = head + body + '    </Score>\n  </museScore>\n'
with zipfile.ZipFile('lyrics-test.mscz', 'w', zipfile.ZIP_DEFLATED) as z:
    for n in src.namelist():
        if n.endswith('.mscx'): z.writestr('lyrics-test.mscx', mscx)
        elif n == 'META-INF/container.xml': z.writestr(n, src.read(n).decode().replace('m1-test.mscx', 'lyrics-test.mscx'))
        elif n.startswith('Thumbnails'): continue
        else: z.writestr(n, src.read(n))
print('ok', len(mscx))
