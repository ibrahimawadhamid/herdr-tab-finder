<#
Tab finder for Herdr: install, update or remove it (Windows; also works in PowerShell on macOS and Linux).

  .\install.ps1               install or update (your config.json and notes.json are always kept)
  .\install.ps1 -Bind         also add a shortcut that opens it as a popup: ctrl-shift-g (cmd-e on macOS),
                              only if the key is free; keys.json is backed up first
  .\install.ps1 -Uninstall    remove it, and its shortcut (add -Purge to remove config.json and notes.json)
  .\install.ps1 -Version      print the version this script installs

Without the files beside it, it downloads its own release from GitHub:
  & ([scriptblock]::Create((irm https://raw.githubusercontent.com/ibrahimawadhamid/herdr-tab-finder/main/install.ps1)))

Options: -AppHome <Herdr's folder>  -Name <folder name, when "Tab finder" is taken>
         -Ref <release tag or branch to download>  -Url <a .tar.gz or .zip to use instead, e.g. a mirror>
Exit codes: 0 done, 1 failed, 2 bad option.
#>
[CmdletBinding()]
param(
  [switch]$Bind,
  [switch]$Uninstall,
  [switch]$Purge,
  [switch]$Version,
  [string]$AppHome = "",
  [string]$Name = "",
  [string]$Ref = "",
  [string]$Url = ""
)
$ErrorActionPreference = "Stop"
$TfVersion = "1.1.0"
$Repo = "ibrahimawadhamid/herdr-tab-finder"
$Marker = "Tab finder for Herdr"

function Say([string]$Text) { [Console]::Out.WriteLine($Text) }
# Errors end the run through one handler at the bottom: a .ps1 file exits with the code, while the
# downloaded one-liner (a scriptblock at your prompt) only sets $LASTEXITCODE, so your window stays open.
function Fail([string]$Text, [int]$Code = 1) { [Console]::Error.WriteLine("tab finder: $Text"); throw "TF_EXIT:$Code" }
function Write-Utf8([string]$Path, [string]$Text) {
  [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding $false))
}

$TfCode = 0
try {
if ($Version) { Say $TfVersion; return }
if ($Purge -and -not $Uninstall) { Fail "-Purge goes with -Uninstall" 2 }
if ($Bind -and $Uninstall) { Fail "-Bind and -Uninstall don't go together" 2 }

# Herdr's folder: -AppHome, else $env:HERDR_APP_HOME, else the first that exists of
# $env:XDG_CONFIG_HOME\herdr-app, ~\.config\herdr-app and $env:APPDATA\herdr-app.
if (-not $AppHome) { $AppHome = $env:HERDR_APP_HOME }
if (-not $AppHome) {
  $candidates = @()
  if ($env:XDG_CONFIG_HOME) { $candidates += (Join-Path $env:XDG_CONFIG_HOME "herdr-app") }
  $candidates += (Join-Path (Join-Path $HOME ".config") "herdr-app")
  if ($env:APPDATA) { $candidates += (Join-Path $env:APPDATA "herdr-app") }
  foreach ($c in $candidates) { if (Test-Path -LiteralPath $c -PathType Container) { $AppHome = $c; break } }
  if (-not $AppHome) { Fail "no Herdr app folder found (looked in: $($candidates -join ', ')). Open Herdr once first, or pass -AppHome." }
}
if (-not (Test-Path -LiteralPath $AppHome -PathType Container)) { Fail "no Herdr app folder at $AppHome. Open Herdr once first, or pass -AppHome." }
if (-not $Name) { $Name = if ($env:TAB_FINDER_NAME) { $env:TAB_FINDER_NAME } else { "Tab finder" } }
if ($Name -match '[\\/]' -or $Name.StartsWith(".") -or -not $Name.Trim()) { Fail "-Name must be a plain folder name" 2 }
$Dest = Join-Path (Join-Path $AppHome "mods") $Name
$Keys = Join-Path $AppHome "keys.json"
$IsMac = $false
if (Get-Variable -Name IsMacOS -ErrorAction SilentlyContinue) { $IsMac = [bool]$IsMacOS }
$Key = if ($IsMac) { "cmd-e" } else { "ctrl-shift-g" }
$Action = "mod.open:$Name"

function Test-OwnMod([string]$Dir) {
  $main = Join-Path $Dir "main.js"
  return (Test-Path -LiteralPath $main) -and ((Get-Content -LiteralPath $main -Raw) -match [regex]::Escape($Marker))
}

# Add the shortcut when its key is free, or remove shortcuts that open this mod. keys.json is backed up,
# and the backup is kept only when something changed.
function Edit-KeyBinding([string]$Mode) {
  if (-not (Test-Path -LiteralPath $Keys)) { Say "No keys.json in $AppHome, so no shortcut was changed."; return }
  try { $data = Get-Content -LiteralPath $Keys -Raw | ConvertFrom-Json } catch { Say "keys.json isn't valid JSON; leaving it alone."; return }
  if ($null -eq $data -or $data -isnot [psobject]) { Say "keys.json isn't an object; leaving it alone."; return }
  $changed = $false
  if ($Mode -eq "remove") {
    foreach ($section in @($data.PSObject.Properties)) {
      if ($section.Value -isnot [psobject]) { continue }
      foreach ($b in @($section.Value.PSObject.Properties)) {
        if ($b.Value -eq $Action) { $section.Value.PSObject.Properties.Remove($b.Name); Say "Removed the shortcut $($b.Name)."; $changed = $true }
      }
    }
  } else {
    foreach ($section in @($data.PSObject.Properties)) {
      if ($section.Value -isnot [psobject]) { continue }
      $hit = $section.Value.PSObject.Properties[$Key]
      if ($hit) {
        if ($hit.Value -eq $Action) { Say "$Key already opens Tab finder."; return }
        Say "$Key is already used for '$($hit.Value)' ($($section.Name)); leaving keys.json alone. Pick another key and add `"<key>`": `"$Action`" to `"global`" yourself."
        return
      }
    }
    if (-not $data.PSObject.Properties["global"]) { $data | Add-Member -NotePropertyName "global" -NotePropertyValue ([pscustomobject]@{}) }
    $data.global | Add-Member -NotePropertyName $Key -NotePropertyValue $Action
    Say "Added $Key to open Tab finder."
    $changed = $true
  }
  if (-not $changed) { return }
  $stamp = Get-Date -Format "yyyyMMddHHmmss"
  $backup = "$Keys.bak-tabfinder-$stamp"; $n = 1
  while (Test-Path -LiteralPath $backup) { $n++; $backup = "$Keys.bak-tabfinder-$stamp-$n" }
  Copy-Item -LiteralPath $Keys -Destination $backup
  # A keys.json that links elsewhere (dotfiles) is written where it lives, keeping the link.
  $real = $Keys
  try {
    $it = Get-Item -LiteralPath $Keys -Force
    if ($it.LinkType -and $it.Target) {
      $t = @($it.Target)[0]
      if (-not [IO.Path]::IsPathRooted($t)) { $t = Join-Path (Split-Path -Parent $Keys) $t }
      $real = $t
    }
  } catch { $real = $Keys }
  $tmp = "$real.tf-new"
  Write-Utf8 $tmp (($data | ConvertTo-Json -Depth 20) + "`n")
  Move-Item -LiteralPath $tmp -Destination $real -Force
  Say "keys.json was backed up to $backup."
  if ($Mode -eq "add") { Say "Note: once keys.json is edited, Herdr treats it as yours and stops adding new default shortcuts to it." }
}

if ($Uninstall) {
  if (-not (Test-Path -LiteralPath $Dest -PathType Container)) { Fail "Tab finder isn't installed at $Dest" }
  if ((Test-Path -LiteralPath (Join-Path $Dest "main.js")) -and -not (Test-OwnMod $Dest)) { Fail "$Dest holds a different mod; leaving it alone" }
  Remove-Item -LiteralPath (Join-Path $Dest "icons") -Recurse -Force -ErrorAction SilentlyContinue
  foreach ($f in @("main.js", "mod.json", "jsconfig.json")) { Remove-Item -LiteralPath (Join-Path $Dest $f) -Force -ErrorAction SilentlyContinue }
  Get-ChildItem -LiteralPath $Dest -Filter "*.d.ts" -ErrorAction SilentlyContinue | Remove-Item -Force
  if ($Purge) { foreach ($f in @("config.json", "notes.json")) { Remove-Item -LiteralPath (Join-Path $Dest $f) -Force -ErrorAction SilentlyContinue } }
  if (@(Get-ChildItem -LiteralPath $Dest -Force).Count -eq 0) { Remove-Item -LiteralPath $Dest -Force; Say "Removed $Dest." }
  else { Say "Removed Tab finder from $Dest; kept your own files there." }
  Edit-KeyBinding "remove"
  Say "Favorites, mutes and recent tabs stay in Herdr's shared.json (keys tabfinder.*); delete them there while Herdr is closed if you like."
  return
}

# Where the files come from: beside this script, else a download of this version's release.
$Src = ""
if ($PSScriptRoot) { $Src = Join-Path (Join-Path $PSScriptRoot "mods") "Tab finder" }
$Tmp = $null
try {
  if (-not $Src -or -not (Test-Path -LiteralPath (Join-Path $Src "main.js"))) {
    if (-not $Ref) { $Ref = if ($env:TAB_FINDER_REF) { $env:TAB_FINDER_REF } else { "v$TfVersion" } }
    if (-not $Url) { $Url = if ($env:TAB_FINDER_URL) { $env:TAB_FINDER_URL } else { "https://github.com/$Repo/archive/$Ref.zip" } }
    $Tmp = Join-Path ([IO.Path]::GetTempPath()) ("tabfinder-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $Tmp | Out-Null
    $archive = Join-Path $Tmp ("tf" + $(if ($Url -match '\.zip$') { ".zip" } else { ".tar.gz" }))
    # Windows PowerShell 5.1 on older .NET may not offer TLS 1.2 by default, which GitHub requires.
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { Write-Verbose "TLS 1.2 is already the default here." }
    Say "Downloading Tab finder ($Ref)..."
    try { Invoke-WebRequest -Uri $Url -OutFile $archive -UseBasicParsing } catch { Fail "couldn't download $Url" }
    $out = Join-Path $Tmp "x"; New-Item -ItemType Directory -Path $out | Out-Null
    try {
      if ($archive.EndsWith(".zip")) { Expand-Archive -LiteralPath $archive -DestinationPath $out }
      else { & tar -xzf $archive -C $out; if ($LASTEXITCODE -ne 0) { throw "tar failed" } }
    } catch { Fail "the download isn't a valid archive" }
    $found = Get-ChildItem -LiteralPath $out -Recurse -Filter "main.js" | Where-Object { $_.Directory.Name -eq "Tab finder" -and $_.Directory.Parent.Name -eq "mods" } | Select-Object -First 1
    if (-not $found) { Fail "the download has no mods/Tab finder/main.js" }
    $Src = $found.Directory.FullName
  }
  foreach ($need in @("main.js", "mod.json", "icons")) { if (-not (Test-Path -LiteralPath (Join-Path $Src $need))) { Fail "mods/Tab finder/ is incomplete" } }

  # A folder whose main.js is someone else's is a different mod; one with no main.js is what an uninstall
  # left behind (your config.json and notes.json), so it is reused.
  if ((Test-Path -LiteralPath $Dest) -and ((Test-Path -LiteralPath $Dest -PathType Leaf) -or ((Test-Path -LiteralPath (Join-Path $Dest "main.js")) -and -not (Test-OwnMod $Dest)))) {
    Fail "`"$Name`" is already a different mod in $(Join-Path $AppHome 'mods'). Install under another name: .\install.ps1 -Name `"Tab finder 2`""
  } elseif (Test-Path -LiteralPath (Join-Path $Dest "main.js")) {
    Say "Updating Tab finder in $Dest (your config.json and notes.json stay as they are)."
  } else {
    Say "Installing Tab finder into $Dest"
  }

  # First every file is copied next to its final place (a failed copy changes nothing installed), then
  # each moves in; main.js goes last, so Herdr reloads it with its icons already there.
  New-Item -ItemType Directory -Path (Join-Path $Dest "icons") -Force | Out-Null
  $moves = @()
  foreach ($svg in Get-ChildItem -LiteralPath (Join-Path $Src "icons") -Filter "*.svg") { $moves += ,@($svg.FullName, (Join-Path (Join-Path $Dest "icons") $svg.Name)) }
  $moves += ,@((Join-Path $Src "mod.json"), (Join-Path $Dest "mod.json"))
  $moves += ,@((Join-Path $Src "main.js"), (Join-Path $Dest "main.js"))
  try {
    foreach ($m in $moves) { Copy-Item -LiteralPath $m[0] -Destination "$($m[1]).tf-new" -Force }
  } catch {
    foreach ($m in $moves) { Remove-Item -LiteralPath "$($m[1]).tf-new" -Force -ErrorAction SilentlyContinue }
    Fail "couldn't copy the files into $Dest ($($_.Exception.Message))"
  }
  foreach ($m in $moves) { Move-Item -LiteralPath "$($m[1]).tf-new" -Destination $m[1] -Force }
  foreach ($f in @("config.json", "notes.json")) { if (Test-Path -LiteralPath (Join-Path $Dest $f)) { Say "Kept your $f." } }

  $checker = Get-Command herdr-app -ErrorAction SilentlyContinue
  if ($checker) {
    $old = $env:HERDR_APP_HOME; $env:HERDR_APP_HOME = $AppHome
    # Windows PowerShell 5.1 turns a native program's stderr into an error under "Stop"; this is only a check.
    $eap = $ErrorActionPreference; $ErrorActionPreference = "Continue"
    try { & $checker.Source check $Dest *> $null; if ($LASTEXITCODE -eq 0) { Say "Checked: it loads." } else { Say "Warning: herdr-app check didn't pass. Run: herdr-app check `"$Dest`"" } }
    catch { Say "Warning: herdr-app check couldn't run. Run: herdr-app check `"$Dest`"" }
    finally { $env:HERDR_APP_HOME = $old; $ErrorActionPreference = $eap }
  }

  if ($Bind) { Edit-KeyBinding "add" }
} finally {
  if ($Tmp) { Remove-Item -LiteralPath $Tmp -Recurse -Force -ErrorAction SilentlyContinue }
}

Say ""
Say "Done. Tab finder $TfVersion is installed. To use it:"
if ($Bind) { Say "  * Press $Key anywhere in Herdr for the popup." }
else { Say "  * For a shortcut, run: .\install.ps1 -Bind   (adds $Key, only if it's free)" }
Say "  * Or keep it as a tab:  herdr-app do tab.new '{`"name`":`"Find a tab`",`"mod`":`"$Name`"}'"
Say "  * Or open it once:      herdr-app do mod.open '{`"name`":`"$Name`"}'"
} catch {
  $TfCode = 1
  if ("$($_.Exception.Message)" -match '^TF_EXIT:(\d+)$') { $TfCode = [int]$Matches[1] }
  else { [Console]::Error.WriteLine("tab finder: $($_.Exception.Message)") }
}
if ($TfCode -ne 0) {
  if ($PSCommandPath) { exit $TfCode }
  $global:LASTEXITCODE = $TfCode
}
