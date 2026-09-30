EXPORT TO RECAP (RCS / RCP) FOR LEICA CYCLONE 3DR            v1.0
Author: Ahmed El-Gohary
====================================================================

One click from Cyclone 3DR point clouds to Autodesk ReCap files:
  - single .rcs file(s), or an .rcp project + Support folder
  - clouds kept separate, or merged into one scan
  - optional: inspection (deviation) colours baked into RGB, so the
    RCS shows the same colour map as 3DR
  - 3DR is only busy while it writes a temporary file; ReCap indexes
    in the background with its own progress window


REQUIREMENTS
------------
  - Leica Cyclone 3DR 2026.1 (tested). Other versions: untested.
  - Autodesk ReCap installed AND licensed on the same PC.
    The script uses ReCap's command-line converter (decap.exe), which
    ships with ReCap and only runs with a valid ReCap licence.
  - Windows (uses built-in PowerShell and robocopy).


INSTALL
-------
  1. Copy this folder anywhere on your PC (e.g. Documents\3DR Scripts).
  2. In 3DR: Script tab > Run Script > open Export_to_ReCap.js.
  3. Optional: in the script editor click the star to add it to your
     Favorite Scripts, and use ReCap_Export_icon.png as its icon.


USE
---
  1. Select the cloud(s) in the 3DR tree (or run with nothing selected
     and click the clouds in the 3D view, ESC when done).
  2. Run the script. In the dialog choose:
       Output            RCS file(s) only  |  RCP project + Support folder
       Clouds            Separate          |  Combined (merged into one scan)
       Output folder     where the finished files go
       Name              used for the merged scan / RCP project
       Temporary format  LAS (fastest) | E57 | PTS (text, like XYZ)
       Bake inspection   ticked automatically if a cloud has inspection
     Under "Settings" (first run only - remembered afterwards):
       Work folder       local drive with free space for temporary files
                         (default C:\Temp\3DR-ReCap-Work)
       ReCap converter   found automatically; browse to decap.exe only if
                         ReCap is installed in a non-standard location
  3. Click OK. After the temporary file is written, 3DR is free again.
     A "ReCap export" window shows progress and turns green when done.


WHERE THINGS GO
---------------
  - All temporary work happens in the Work folder. Only the finished
    .rcs (or .rcp + Support folder) is moved to the Output folder, so
    it is safe to point the output at an Autodesk Docs / ACC synced
    folder (Desktop Connector) - only final files get uploaded.
  - .rcp projects are written with relative scan paths (like projects
    saved from ReCap itself), so the .rcp + Support folder can be moved
    or opened from ACC on another PC. Always keep them together.
  - A small log per export stays in the Work folder
    (<name>_<date>_log.txt). The progress window's "Open log" button
    opens it if something fails.


TROUBLESHOOTING
---------------
  "decap.exe was not found"
      Install Autodesk ReCap, or browse to decap.exe under Settings.
  Progress window says "Failed"
      Open the log. The most common cause is no valid ReCap licence
      (sign in to ReCap once and check the licence), or no disk space
      in the Work folder.
  Nothing appears in the output folder
      The work files are kept in Work folder\job_<date> when a step
      fails, so nothing is lost. Check the log for the reason.
  Large clouds
      Temporary files can be 10-20 GB per cloud. Point the Work folder
      at a fast local drive with plenty of space. Baking inspection
      colours briefly needs extra RAM (a temporary copy of each cloud).


NOTES
-----
  - Your 3DR clouds are never modified. Colour baking and merging are
    done on temporary copies.
  - Existing files with the same name in the output folder are
    replaced (you are asked first for the merged scan / RCP project).
  - Cyclone 3DR is a product of Leica Geosystems. Autodesk ReCap and
    DeCap are products of Autodesk. This script is an independent tool
    and is not affiliated with or endorsed by either company.

Provided as-is, without warranty. Test on non-critical data first.


VERSION HISTORY
---------------
  1.0   First shareable release: auto-detects ReCap, configurable
        work/output folders, RCS/RCP, separate/merged, LAS/E57/PTS,
        inspection colour baking, progress window, ACC-safe output,
        relative paths in .rcp.
