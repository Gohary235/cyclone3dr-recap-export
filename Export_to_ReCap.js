// =====================================================================================
//  Export to ReCap (RCS / RCP) for Leica Cyclone 3DR           v1.0
//  Author: Ahmed El-Gohary
//
//  Exports selected 3DR point clouds to Autodesk ReCap formats in one click:
//    - single .rcs file(s)  or  an .rcp project + Support folder
//    - clouds kept separate or merged into one scan
//    - optional: inspection (deviation) colours baked into RGB
//  3DR writes a temporary LAS / E57 / PTS, then Autodesk ReCap's command-line converter
//  (decap.exe) indexes it in the background with a progress window. 3DR stays free.
//
//  Requirements: Cyclone 3DR 2026.1 (tested) + Autodesk ReCap installed and licensed.
//  All temporary work happens in the "Work folder"; only finished files are moved to the
//  output folder (safe to point the output at an Autodesk Docs / ACC synced folder).
// =====================================================================================

const TITLE = "Export to ReCap (RCS / RCP)";
const DEFAULT_WORK = "C:/Temp/3DR-ReCap-Work";
const DECAP_CANDIDATES = [
    "C:/Program Files/Autodesk/Autodesk ReCap/decap.exe",
    "C:/Program Files/Autodesk/ReCap/decap.exe",
    "D:/Program Files/Autodesk/Autodesk ReCap/decap.exe"
];

// ---------- helpers
const win  = p => p.replace(/\//g, "\\");
const unix = p => String(p || "").replace(/\\/g, "/").replace(/\/+$/, "");
const exists = p => { try { return !!p && new SFile(p).Exists(); } catch (e) { return false; } };
const safeName = n => ((n || "Cloud").replace(/[\\\/:*?"<>|%^&!']/g, "_").trim().replace(/[. ]+$/, "")) || "Cloud";
const q   = s => "\"" + s + "\"";                                   // cmd quoting
const psq = s => "'" + String(s).replace(/'/g, "''") + "'";         // PowerShell single-quoted
function stop(msg, sev) { SDialog.Message(msg, sev === undefined ? SDialog.Error : sev, TITLE); throw new Error(msg); }
function ask(msg, buttons) { return SDialog.Message(msg, buttons, SDialog.Instruction, TITLE).ErrorCode; }
// Create a folder and any missing parents (MkDir only creates one level)
function mkdirs(path) {
    if (unix(path).startsWith("//")) return exists(path) || MkDir(unix(path));   // network share: parent must exist
    const parts = unix(path).split("/");
    let cur = parts.shift();                                        // drive, e.g. "F:"
    for (const p of parts) { cur += "/" + p; if (!exists(cur)) MkDir(cur); }
    return MkDir(unix(path));                                        // true if created or already there
}

// ---------- 1. Clouds
let clouds = SCloud.FromSel();
if (!clouds.length) {
    SDialog.Message("No clouds selected in the tree.\n\nClick the clouds to export in the 3D view, one by one.\nPress ESC when you are done.", SDialog.Instruction, TITLE);
    clouds = [];
    for (;;) {
        const r = SCloud.FromClick();
        if (r.ErrorCode === 2) break;                               // ESC
        if (r.ErrorCode !== 0 || !r.Cloud) continue;
        if (clouds.indexOf(r.Cloud) < 0) { clouds.push(r.Cloud); Print("Picked: " + r.Cloud.GetName().trim()); }
    }
}
if (!clouds.length) stop("No clouds chosen - nothing to export.", SDialog.Warning);
const names = clouds.map(c => c.GetName().trim());

// ---------- 2. Options
const TYPE_CHOICES = ["RCS file(s) only", "RCP project + Support folder"];
const MODE_CHOICES = ["Separate - one scan per cloud", "Combined - merge all clouds into one scan"];
const FMT_CHOICES  = ["LAS (fastest, binary)", "E57", "PTS (ASCII, like XYZ)"];
const FMT_EXT      = [".las", ".e57", ".pts"];
const anyInspection = clouds.some(c => typeof c.HasInspection === "function" && c.HasInspection());
const foundDecap = DECAP_CANDIDATES.find(exists) || "";

let asRcp, combined, outDir, workRoot, baseName, decap = foundDecap, fmt = 0, bake = anyInspection;

const dlg = SDialog.New(TITLE);
const rich = ["AddChoices", "AddFileSelector", "AddTextField"].every(m => typeof dlg[m] === "function");

if (rich) {
    dlg.AddText(clouds.length + " cloud(s):\n  " + names.join("\n  "), SDialog.Info);
    dlg.AddChoices({ id: "type", name: "Output", choices: TYPE_CHOICES, style: SDialog.RadioButtons, saveValue: true });
    dlg.AddChoices({ id: "mode", name: "Clouds", choices: MODE_CHOICES, style: SDialog.RadioButtons, saveValue: true });
    dlg.AddFileSelector({ id: "out", name: "Output folder", mode: SDialog.EMode.OpenDirectory, saveValue: true,
        tooltip: "Finished files land here. Can be an Autodesk Docs / ACC synced folder." });
    dlg.AddTextField({ id: "name", name: "Name (combined scan / RCP project)", value: safeName(names[0]) + (clouds.length > 1 ? "_combined" : ""), canBeEmpty: false });
    dlg.AddChoices({ id: "fmt", name: "Temporary format", choices: FMT_CHOICES, style: SDialog.ComboBox, saveValue: true });
    if (typeof dlg.AddBoolean === "function")
        dlg.AddBoolean({ id: "bake", name: "Bake inspection colours into RGB" + (anyInspection ? "" : " (no inspection on these clouds)"), value: anyInspection, readOnly: !anyInspection });
    if (typeof dlg.BeginGroup === "function") dlg.BeginGroup("Settings");
    dlg.AddFileSelector({ id: "work", name: "Work folder (temporary files)", mode: SDialog.EMode.OpenDirectory, value: DEFAULT_WORK, saveValue: true,
        tooltip: "Local drive with free space - temporary LAS files can be several GB. Do NOT use a synced/cloud folder." });
    dlg.AddFileSelector({ id: "decap", name: "ReCap converter (decap.exe)", mode: SDialog.EMode.Open, extensions: "decap.exe (decap.exe)", value: foundDecap, saveValue: true,
        tooltip: "Found automatically in a standard ReCap install. Browse only if ReCap is installed elsewhere." });

    const r = dlg.Run();
    if (r.ErrorCode !== 0) stop("Cancelled.", SDialog.Info);
    const idx = (v, list) => typeof v === "number" ? v : list.indexOf(v);
    asRcp    = idx(r.type, TYPE_CHOICES) === 1;
    combined = idx(r.mode, MODE_CHOICES) === 1;
    outDir   = unix(r.out);
    workRoot = unix(r.work || DEFAULT_WORK);
    baseName = safeName(r.name);
    fmt      = Math.max(0, idx(r.fmt, FMT_CHOICES));
    if (typeof r.bake === "boolean") bake = r.bake && anyInspection;
    if (r.decap && exists(unix(r.decap))) decap = unix(r.decap);
} else {
    // Fallback for 3DR builds whose SDialog exposes only the basics
    const t = ask(clouds.length + " cloud(s) chosen.\n\nWhat do you want to create?", TYPE_CHOICES.concat(["Cancel"]));
    if (t < 0 || t === 2) stop("Cancelled.", SDialog.Info);
    asRcp = t === 1; combined = false;
    if (clouds.length > 1) {
        const m = ask("Keep the clouds separate or merge them into one scan?", MODE_CHOICES.concat(["Cancel"]));
        if (m < 0 || m === 2) stop("Cancelled.", SDialog.Info);
        combined = m === 1;
    }
    const fm = ask("Temporary format for the ReCap conversion:", FMT_CHOICES.concat(["Cancel"]));
    if (fm < 0 || fm === 3) stop("Cancelled.", SDialog.Info);
    fmt = fm;
    if (anyInspection) bake = ask("Some clouds carry inspection (deviation) colours.\nBake them into RGB so the RCS shows the same colours?", ["Yes - bake colours", "No - keep real colours"]) === 0;
    const f = GetOpenFolder("Output folder (finished files)", "");
    if (!f) stop("Cancelled.", SDialog.Info);
    outDir = unix(f); workRoot = DEFAULT_WORK;
    baseName = safeName(names[0]) + (combined ? "_combined" : "");
}
if (clouds.length === 1) combined = false;

// ---------- validation
if (!decap || !exists(decap)) {
    const pick = GetOpenFileName("Locate Autodesk ReCap's decap.exe", "decap.exe (decap.exe)", "C:/Program Files/Autodesk");
    if (!pick || !exists(unix(pick))) stop("Autodesk ReCap's converter (decap.exe) was not found.\n\nInstall Autodesk ReCap (with a valid licence) or browse to decap.exe in the Settings section.");
    decap = unix(pick);
}
if (!outDir) stop("Please choose an output folder.", SDialog.Warning);
if (workRoot.toLowerCase() === outDir.toLowerCase()) stop("The work folder must be different from the output folder.", SDialog.Warning);
if (!mkdirs(outDir))   stop("Cannot create the output folder:\n" + outDir);
if (!mkdirs(workRoot)) stop("Cannot create the work folder:\n" + workRoot + "\n\nChoose another one under Settings.");

const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
const job   = workRoot + "/job_" + stamp;                 // everything temporary lives here
if (!MkDir(job)) stop("Cannot create:\n" + job);
const project = baseName;

if (asRcp ? exists(outDir + "/" + project + ".rcp") : (combined && exists(outDir + "/" + project + ".rcs")))
    if (ask("\"" + project + (asRcp ? ".rcp" : ".rcs") + "\" already exists in the output folder.\nReplace it?", ["Replace", "Cancel"]) !== 0) stop("Cancelled.", SDialog.Info);

// ---------- 3. Temporary export (3DR is busy only here)
function prepared(i) {                                        // the cloud to export (baked copy if requested)
    const c = clouds[i];
    if (!(bake && c.HasInspection())) return { cloud: c, temp: false };
    Print("Baking inspection colours " + (i + 1) + "/" + clouds.length + ": " + names[i]);
    const cv = c.ConvertInspectionToColor();                   // temporary copy - original untouched
    if (cv.ErrorCode !== 0 || !cv.Cloud) stop("Could not bake inspection colours for:\n" + names[i]);
    return { cloud: cv.Cloud, temp: true };
}
function writeTemp(cloud, n) {
    const file = job + "/" + n + FMT_EXT[fmt];
    Print("Writing temporary " + FMT_EXT[fmt] + ": " + n);
    let err;
    if (fmt === 0)      err = SSurveyingFormat.ExportLASLAZ(cloud, file).ErrorCode;
    else if (fmt === 1) err = SSurveyingFormat.ExportE57([cloud], [], file).ErrorCode;
    else                err = cloud.Save(file).ErrorCode;
    if (err !== 0) stop(FMT_EXT[fmt] + " export failed for:\n" + n + " (code " + err + ")");
    return win(file);
}

const inFiles = [];
if (combined) {
    // merge inside 3DR, then hand ReCap a single file (ReCap's own --unify proved unreliable)
    const parts = clouds.map((c, i) => prepared(i));
    Print("Merging " + parts.length + " clouds...");
    const m = SCloud.Merge(parts.map(p => p.cloud));
    if (m.ErrorCode !== 0 || !m.Cloud) stop("Could not merge the clouds.");
    parts.forEach(p => { if (p.temp) p.cloud.Clear(); });
    inFiles.push(writeTemp(m.Cloud, project));
    m.Cloud.Clear();
} else {
    const used = {};
    for (let i = 0; i < clouds.length; i++) {
        let n = safeName(names[i]);
        if (used[n]) { used[n]++; n += "_" + used[n]; } else used[n] = 1;
        const p = prepared(i);
        inFiles.push(writeTemp(p.cloud, n));
        if (p.temp) p.cloud.Clear();
    }
}

// ---------- 4. Background converter (.bat): DeCap in the work folder, then move results to output
const support = win(job + "/" + project + " Support");
const log = win(workRoot + "/" + project + "_" + stamp + "_log.txt");
const RC = "robocopy";                                        // built into Windows; copes with moves across drives
const rcOpts = "/MOVE /NFL /NDL /NJH /NJS /NP /R:2 /W:2";

const L = ["@echo off", "echo %date% %time% START > " + q(log)];
L.push(q(win(decap)) + " --importWithLicense " + q(win(job)) + " " + q(project) + " " + inFiles.map(q).join(" ") + " >> " + q(log) + " 2>&1");
L.push("if exist " + q(support + "\\*.rcs") + " goto ok");
L.push("echo %date% %time% FAIL - ReCap produced no scan. Work files kept: " + q(win(job)) + " >> " + q(log));
L.push("exit /b 1");
L.push(":ok");
// ReCap's converter stores only absolute scan paths in the .rcp. This helper rewrites them for the final
// location and adds the relative paths ReCap itself writes, so the project can be moved / opened from ACC.
const fixer = workRoot + "/fixrcp_" + stamp + ".ps1";
if (asRcp) {
    const fx = new SFile(fixer);
    if (!fx.Open(SFile.WriteOnly)) stop("Cannot write " + fixer);
    fx.Write(String.raw`param([string]$Rcp, [string]$Proj, [string]$OldDir)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$newDir = Split-Path -Parent $Rcp
$olds = @($OldDir, ($OldDir -replace '\\','/'))
$zip = [IO.Compression.ZipFile]::Open($Rcp, 'Update')
try {
  foreach ($e in @($zip.Entries | Where-Object { $_.Name -like '*.xml' })) {
    $sr = New-Object IO.StreamReader($e.Open()); $x = $sr.ReadToEnd(); $sr.Close()
    foreach ($o in $olds) { $x = $x.Replace($o, $newDir) }
    $x = [regex]::Replace($x, '\s*<RelativePath Value="[^"]*"\s*/>', '')
    $x = [regex]::Replace($x, '<Path Value="([^"]*[\\/])([^\\/"]+\.rcs)"\s*/>', { param($m) $m.Value + '<RelativePath Value=".\' + $Proj + ' Support\' + $m.Groups[2].Value + '" />' })
    $name = $e.FullName; $e.Delete()
    $ne = $zip.CreateEntry($name); $sw = New-Object IO.StreamWriter($ne.Open(), (New-Object Text.UTF8Encoding($false))); $sw.Write($x); $sw.Close()
  }
} finally { $zip.Dispose() }
'RCP paths updated: ' + $Rcp
` + "\r\n");
    fx.Close();
    L.push(RC + " " + q(support) + " " + q(win(outDir + "/" + project + " Support")) + " /E " + rcOpts + " >> " + q(log));
    L.push(RC + " " + q(win(job)) + " " + q(win(outDir)) + " " + q(project + ".rcp") + " " + rcOpts + " >> " + q(log));
    L.push("if not exist " + q(win(outDir + "/" + project + ".rcp")) + " goto movefail");
    L.push("powershell -NoProfile -ExecutionPolicy Bypass -File " + q(win(fixer)) + " " + q(win(outDir + "/" + project + ".rcp")) + " " + q(project) + " " + q(win(job)) + " >> " + q(log) + " 2>&1");
    L.push("del " + q(win(fixer)));
} else if (combined) {
    L.push("for %%F in (" + q(support + "\\*.rcs") + ") do ren \"%%F\" " + q(project + ".rcs"));
    L.push(RC + " " + q(support) + " " + q(win(outDir)) + " " + q(project + ".rcs") + " " + rcOpts + " >> " + q(log));
    L.push("if not exist " + q(win(outDir + "/" + project + ".rcs")) + " goto movefail");
} else {
    L.push(RC + " " + q(support) + " " + q(win(outDir)) + " *.rcs " + rcOpts + " >> " + q(log));
}
// never delete the work folder unless every scan has really left it
L.push("if exist " + q(support + "\\*.rcs") + " goto movefail");
L.push("rmdir /s /q " + q(win(job)));
L.push("echo %date% %time% DONE >> " + q(log));
L.push("goto end");
L.push(":movefail");
L.push("echo %date% %time% FAIL - could not move the result to the output folder. Files kept in: " + q(win(job)) + " >> " + q(log));
L.push(":end");
L.push("del \"%~f0\"");

const bat = workRoot + "/run_" + stamp + ".bat";
const bf = new SFile(bat);
if (!bf.Open(SFile.WriteOnly)) stop("Cannot write " + bat);
bf.Write(L.join("\r\n") + "\r\n");
bf.Close();

// ---------- 5. Progress window (separate process that follows the log; 3DR stays free)
let what;
if (asRcp) what = project + ".rcp + Support folder" + (combined ? " (1 merged scan)" : " (" + clouds.length + " scan(s))");
else       what = combined ? project + ".rcs (merged)" : clouds.length + " .rcs file(s)";
const PS = [
    "$Log = " + psq(log), "$N = " + (combined ? 1 : clouds.length), "$Title = " + psq(project), "$What = " + psq(what), "$OutDir = " + psq(win(outDir)),
    String.raw`Add-Type -Name W -Namespace C -MemberDefinition '[DllImport("kernel32.dll")] public static extern System.IntPtr GetConsoleWindow(); [DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int n);'
[void][C.W]::ShowWindow([C.W]::GetConsoleWindow(), 0)
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$f = New-Object Windows.Forms.Form
$f.Text = 'ReCap export - ' + $Title
$f.ClientSize = New-Object Drawing.Size(460, 170)
$f.StartPosition = 'CenterScreen'; $f.FormBorderStyle = 'FixedDialog'; $f.MaximizeBox = $false
$f.Font = New-Object Drawing.Font('Segoe UI', 9)
$hdr = New-Object Windows.Forms.Label; $hdr.Location = '15,12'; $hdr.Size = '430,20'; $hdr.Text = $What; $f.Controls.Add($hdr)
$lbl = New-Object Windows.Forms.Label; $lbl.Location = '15,38'; $lbl.Size = '430,20'; $lbl.Text = 'Starting ReCap...'; $f.Controls.Add($lbl)
$bar = New-Object Windows.Forms.ProgressBar; $bar.Location = '15,62'; $bar.Size = '430,22'; $bar.Minimum = 0; $bar.Maximum = 100; $f.Controls.Add($bar)
$sub = New-Object Windows.Forms.Label; $sub.Location = '15,90'; $sub.Size = '430,20'; $sub.ForeColor = 'DimGray'; $f.Controls.Add($sub)
$btn = New-Object Windows.Forms.Button; $btn.Location = '15,125'; $btn.Size = '110,30'; $btn.Text = 'Open folder'; $btn.Enabled = $false; $f.Controls.Add($btn)
$cls = New-Object Windows.Forms.Button; $cls.Location = '335,125'; $cls.Size = '110,30'; $cls.Text = 'Hide'; $f.Controls.Add($cls)
$script:openLog = $false
$start = Get-Date
$t = New-Object Windows.Forms.Timer; $t.Interval = 1000
$t.Add_Tick({
  $el = (Get-Date) - $start
  $sub.Text = 'Elapsed ' + $el.ToString('hh\:mm\:ss') + '   -   you can keep working in 3DR'
  if (-not (Test-Path -LiteralPath $Log)) { return }
  $c = @(Get-Content -LiteralPath $Log -ErrorAction SilentlyContinue)
  if ($c | Where-Object { $_ -cmatch '\sDONE\s*$' }) {
    $t.Stop(); $bar.Value = 100; $lbl.Text = 'Done - export finished.'; $lbl.ForeColor = 'DarkGreen'
    $btn.Enabled = $true; $cls.Text = 'Close'; $f.Activate(); return }
  if ($c | Where-Object { $_ -cmatch '\sFAIL\s-' }) {
    $t.Stop(); $lbl.Text = 'Failed - see the log for details.'; $lbl.ForeColor = 'Firebrick'
    $btn.Text = 'Open log'; $btn.Enabled = $true; $script:openLog = $true; $cls.Text = 'Close'; $f.Activate(); return }
  $p = $c | Where-Object { $_ -match '^\[P\]\[\d+ \d+\]' } | Select-Object -Last 1
  if ($p -and ($p -match '^\[P\]\[(\d+) (\d+)\]')) {
    $i = [int]$matches[1]; $pc = [int]$matches[2]
    $bar.Value = [math]::Min(99, [int]((($i - 1) + $pc / 100) / $N * 100))
    if ($i -ge $N -and $pc -ge 100) { $lbl.Text = 'Finalising and moving to output...' } else { $lbl.Text = 'Indexing scan ' + $i + ' of ' + $N + '  -  ' + $pc + '%' }
  } elseif ($c | Where-Object { $_ -match 'Initializing Licensing' }) { $lbl.Text = 'Checking ReCap licence...' }
})
$btn.Add_Click({ if ($script:openLog) { Start-Process notepad.exe $Log } else { Start-Process explorer.exe $OutDir } })
$cls.Add_Click({ $f.Close() })
$f.Add_Shown({ $f.WindowState = 'Normal'; $f.TopMost = $true; $f.Activate(); $f.TopMost = $false })
$t.Start()
[void]$f.ShowDialog()
Remove-Item -LiteralPath $PSCommandPath -ErrorAction SilentlyContinue`
].join("\r\n");

const ps1 = workRoot + "/progress_" + stamp + ".ps1";
const pf = new SFile(ps1);
if (!pf.Open(SFile.WriteOnly)) stop("Cannot write " + ps1);
pf.Write(PS + "\r\n");
pf.Close();

const rc = Execute("powershell.exe", ["-NoProfile", "-Command",
    "Start-Process -WindowStyle Hidden -FilePath " + psq(win(bat)) + "; " +
    "Start-Process powershell.exe -WindowStyle Normal -ArgumentList " + psq("-NoProfile -ExecutionPolicy Bypass -STA -File \"" + win(ps1) + "\"")]);
if (rc !== 0) stop("Could not start the ReCap conversion (code " + rc + ").");
Print("ReCap conversion started - progress window open. 3DR is free.");
