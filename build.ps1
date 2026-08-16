$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$tpl   = [System.IO.File]::ReadAllText((Join-Path $dir 'template.html'))
$three = [System.IO.File]::ReadAllText((Join-Path $dir 'three.min.js'))
$game  = [System.IO.File]::ReadAllText((Join-Path $dir 'game.js'))
$out = $tpl.Replace('<!-- THREE -->', '<script>' + $three + '</script>').Replace('<!-- GAME -->', '<script>' + $game + '</script>')
[System.IO.File]::WriteAllText((Join-Path $dir 'index.html'), $out, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ("OK  index.html = " + [math]::Round((Get-Item (Join-Path $dir 'index.html')).Length / 1KB) + " KB")
