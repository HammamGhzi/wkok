param(
  [Parameter(Mandatory=$true)][string]$Path
)

$bytes = [System.IO.File]::ReadAllBytes($Path)
$lines = [System.IO.File]::ReadAllLines($Path, [System.Text.Encoding]::UTF8)

$defects = @()

# 1. CJK / Cyrillic / Hangul in source
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -match '[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u0400-\u04ff]') {
    $defects += [pscustomobject]@{ Line = $i+1; Kind = 'CJK/Cyrillic'; Text = $lines[$i] }
  }
}

# 2. Character census: allow only Latin-1 / typographic punctuation
$allowed = @(
  0x2018,0x2019,0x201C,0x201D,  # curly single/double quotes
  0x2013,0x2014,                # en dash, em dash
  0x2026,                       # ellipsis
  0x00B0,                       # degree
  0x00D7,0x00F7,                # multiply, divide
  0x2265,0x2264,0x2260,         # >=, <=, !=
  0x2212,                       # minus sign
  0x00A0,                       # nbsp
  0x2192,                       # right arrow
  0x2248,                       # almost equal
  0x2011,                       # non-breaking hyphen
  0x2705,                       # check mark
  0x274C,                       # cross mark
  0x00B7                        # middle dot
  0x2022                        # bullet
  0x00B2,0x00B3,0x00B9          # superscript 2,3,1
  0x00AB,0x00BB                 # guillemets
  0x2032,0x2033                 # prime, double prime
  0x2039,0x203A                 # single guillemets
  0x00B1                        # plus-minus
  0x2260,0x2265,0x2264,0x2248   # != >= <= ~=
  0x03B1,0x03B2,0x03B3,0x03B4   # greek (statistics)
  0x00B5                        # micro
  0x2033                        # double prime
  0x201A                        # single low quote
  0x201E                        # double low quote
  0x2010,0x2015                 # horizontal bar, horizontal ellipsis
  0x2215                        # division slash
  0x25A0,0x25CF                 # black square, black circle
  0x25B6,0x25C0                 # triangles
  0x2261,                       # identical to
  0x00A7,                       # section sign
  0xD83D,0xDCBE,                # emoji U+1F4BE (memo)
  0xD83D,0xDCE9,                # emoji U+1F4E9 (envelope)
  0xD83D,0xDCAC,                # emoji U+1F4AC (speech bubble)
  0xD83D,0xDE00,0xD83D,0xDE01,0xD83D,0xDE02,0xD83D,0xDE03,  # smileys
  0xD83D,0xDC4F,                # thumbs up
  0xD83D,0xDD15,                # writing hand
  0x26A0                        # warning sign
)
$oddChars = @()
for ($i = 0; $i -lt $lines.Count; $i++) {
  foreach ($ch in $lines[$i].ToCharArray()) {
    $code = [int]$ch
    if ($code -gt 127 -and $allowed -notcontains $code) {
      $oddChars += ("L{0} U+{1:X4} '{2}'" -f ($i+1), $code, $ch)
    }
  }
}
$odd = $oddChars.Count
if ($odd -gt 0) {
  $oddChars | Select-Object -First 25 | ForEach-Object { Write-Output ("  ODDCHAR $_") }
}

# 3. Known glue / truncation markers seen in this project
$glue = @('textcolor','PRInstant','Pearce','Exercise','endlessly','Shore-',
          'ituPR','ALat','kanal komunikasi, bukan kanal komunikasi',
          'melakukan hal inis','nggak bisa nggak bisa','melakukan hal inis')
for ($i = 0; $i -lt $lines.Count; $i++) {
  foreach ($g in $glue) {
    if ($lines[$i].Contains($g)) {
      $defects += [pscustomobject]@{ Line = $i+1; Kind = "Glue[$g]"; Text = $lines[$i] }
    }
  }
}

# 4. Doubled adjacent words / phrases (my replace-chain failure mode)
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -match '\b(\w{4,})\s+\1\b') {
    $defects += [pscustomobject]@{ Line = $i+1; Kind = 'DoubledWord'; Text = $lines[$i] }
  }
  # same 3-word phrase appearing twice on one line
  $w = ($lines[$i] -split '\s+') | Where-Object { $_ -match '\w{3,}' }
  for ($j = 0; $j -le $w.Count - 6; $j++) {
    $a = "$($w[$j]) $($w[$j+1]) $($w[$j+2])"
    $b = "$($w[$j+3]) $($w[$j+4]) $($w[$j+5])"
    if ($a -eq $b) {
      $defects += [pscustomobject]@{ Line = $i+1; Kind = 'DoubledPhrase'; Text = $lines[$i] }
      break
    }
  }
}

# 5. Unclosed markdown table rows
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i].StartsWith('|') -and -not $lines[$i].StartsWith('|---') -and -not $lines[$i].Contains('| ---')) {
    if (-not $lines[$i].TrimEnd().EndsWith('|')) {
      $defects += [pscustomobject]@{ Line = $i+1; Kind = 'UnclosedTableRow'; Text = $lines[$i] }
    }
  }
}

Write-Output "FILE      : $Path"
Write-Output "BYTES     : $($bytes.Length)"
Write-Output "LINES     : $($lines.Count)"
Write-Output "NON-STDPNT: $odd"
Write-Output "DEFECTS   : $($defects.Count)"
if ($defects.Count -gt 0) {
  Write-Output "---"
  $defects | ForEach-Object { Write-Output ("L{0} [{1}] {2}" -f $_.Line, $_.Kind, $_.Text) }
  exit 1
}
Write-Output "CLEAN"
exit 0
