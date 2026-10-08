# Patch IDs Report

2026-10-07. Saved patches used to refer to modules by type name, params by name and ports by number. They now use permanent ids. This report covers why, what changed, how the existing patches were converted, and how the result was checked. The rules for working with ids are in Patch IDs in `ARCHITECTURE.md`.

## Summary

Every module class has a permanent `uid`, and every param and port has an `id` that only has to be unique within its module. Patches save these and never a name or port number, so modules, params and ports can be renamed or reordered without breaking saved patches. All 13 existing patches were converted: the 11 in `workflows/` and the 2 in the lichen-patches repo. In headless Chromium, the build from before the change and the new build saved the same state for all 13 (see Verification). The only differences were values that knob cables change every frame.

## Why

Module names have changed often: ZGRASS became GRASS, Film became FilmGrain, TV became TVLines, and two renames were rolled back (Cyberlace to Cyberlaced and back, Glitch to TVGlitch and back). The old `RENAMED` table couldn't express a rollback, because its own rules forbade registering a name that was already in the table and forbade removing an entry.

Params and ports had the same problem one level down. Renaming a param silently lost its saved value and left any cable to it pointing at nothing. Inserting a port moved every saved cable after it onto the wrong port.

There is no user base yet, so the format was changed outright. The app has no fallback for the old format, and patches from before ids are converted with a tool.

## The format

| What | Saved before | Saved now |
| --- | --- | --- |
| Module | `"type": "Comparator"` | `"uid": "ae58281c"`, plus `"type"` for readability; loading ignores it |
| Param value | `"params": { "threshold": 0.33 }` | `"params": { "280d": 0.33 }` |
| Video cable | `fromPort` and `toPort` as port numbers | `fromPort` and `toPort` as port ids |
| Knob cable | `fromPort` as a port number, `paramName` | `fromPort` as a port id, `param` as a param id |

- **Module uid:** 8 random hex digits, declared as `static uid` on the class.
- **Param and port id:** 4 random hex digits, declared as `id` next to the name. Params, inputs and outputs share one namespace per module.
- **Why random:** numbering params 1, 2, 3 would tempt someone to reuse a deleted param's number, which would load old saved values into an unrelated new param.

Only `ConnectionGraph.toJSON()` and `fromJSON()` deal with ids. At runtime everything still uses names and port numbers.

## Code changes

| File | Change |
| --- | --- |
| `js/moduleRegistry.js` | `registerModule()` (`:13`) requires the class's own `static uid` and rejects duplicates. `checkIds()` (`:24`) checks a type's param and port ids the first time `createModule()` (`:38`) builds it. New `createModuleByUid()` (`:48`) for loading. The `RENAMED` table is removed. |
| `js/graph.js` | `toJSON()` (`:158`) writes ids. `fromJSON()` (`:196`) maps them back to names and port numbers, skipping values for removed params (`:216`) and dropping cables to removed ports or params (`:230`). |
| `js/ui.js` | `fromJSON()` (`:2605`) builds modules by uid. |
| `js/modules/*Module.js` | All 63 modules got a `static uid`, and their 252 params and 121 ports got an `id`. |
| `js/modules/audiofx/EffectRack.js` | `EffectMenu.params()` (`:79`) declares its three params with fixed ids, `effect` `7c56`, `fxA` `7df9` and `fxB` `3c06`, shared by SlowscanJam and Twoscilloscope. |
| `js/modules/Module.js` | A comment (`:18`) pointing at the id declarations. |
| `tools/convert-workflows.mjs`, `tools/legacy-ids.json` | The converter and its frozen table (see Migration). |
| `ARCHITECTURE.md` | New Patch IDs section. Renaming a Module and Adding a New Module are rewritten, and the key files list is updated. |

## What happens on load

| Case | Result |
| --- | --- |
| Module, param or port renamed | Loads with its saved values and cables |
| Port moved to a new position | Cables follow it |
| Param added since the patch was saved | Gets its declared value (unchanged from before) |
| Param removed | Its saved value is skipped |
| Cable to a removed port or param | Dropped with a console warning |
| Module removed (unknown uid) | Load aborted: `Unknown module uid: <uid> (saved as <type>)` |
| Patch from before ids | Load aborted with a message pointing at `tools/convert-workflows.mjs` |

The app also checks ids as it starts and builds modules:
- **At startup:** `registerModule()` throws on a class without its own uid, so a subclass can't pass with its parent's. It also throws on a malformed uid or one another class already has.
- **On first build of each type:** `createModule()` throws on a param or port id that is missing, malformed or already used in the module.

## Rules

From Patch IDs in `ARCHITECTURE.md`:
1. Never edit an id once it is committed, and never reuse one, even one whose param or module was deleted.
2. An id names what a saved value means. When a param's value changes meaning, for example a new range or unit or drop-down options reordered or removed, give it a new id. Do the same when a port changes between video and control. Old patches then load the declared value instead of a number that now means something else. Appending a drop-down option keeps the meaning.

## Migration

`tools/convert-workflows.mjs` converts patches in place, and leaves alone any file that already has ids. If it can't map a module type, param, port or node in a file, it reports that and doesn't write the file. It reads `tools/legacy-ids.json`: every module's type name, param names and port order as they were when ids were added (63 modules, 252 params, 121 ports). Old patches use those names, so the table must never be regenerated from later code.

All 13 patches converted without an unmapped entry:
- **This repo:** `alien_structure`, `burning_edges`, `electric_lake`, `electric_lake_2`, `feedback_chroma`, `feedback_lines`, `rainbow`, `sandstorm`, `stained_glass`, `tunnel_camera` and `undersea`, all in `workflows/`.
- **lichen-patches:** `electric-head` and `twinkly-fire`.

A second run reports each file as already having ids and leaves it unchanged.

## Verification

1. **The build from before the change against the new build.** Each original patch was loaded through a share-link hash into the previous build (`HEAD` at the time), served locally in headless Chromium, and saved with Ctrl+S. Each converted patch was loaded and saved the same way in the new build. The old build's save was then run through the converter and compared with the new build's save:

   | Patch | Nodes | Video cables | Knob cables | Result |
   | --- | --- | --- | --- | --- |
   | alien_structure | 10 | 9 | 0 | Identical |
   | burning_edges | 19 | 20 | 2 | Identical except 2 cable-driven values |
   | electric-head | 10 | 10 | 0 | Identical |
   | electric_lake | 9 | 9 | 0 | Identical |
   | electric_lake_2 | 14 | 13 | 1 | Identical except 1 cable-driven value |
   | feedback_chroma | 10 | 11 | 0 | Identical |
   | feedback_lines | 10 | 9 | 5 | Identical except 5 cable-driven values |
   | rainbow | 10 | 10 | 0 | Identical |
   | sandstorm | 10 | 9 | 1 | Identical except 1 cable-driven value |
   | stained_glass | 12 | 12 | 0 | Identical |
   | tunnel_camera | 14 | 15 | 3 | Identical except 3 cable-driven values |
   | twinkly-fire | 11 | 10 | 1 | Identical except 1 cable-driven value |
   | undersea | 8 | 8 | 0 | Identical |

   - **Cable-driven values:** every difference was in a param driven by a knob cable. Those change every frame, so the two builds saved them at different moments.
   - **Counts:** node and cable counts matched the source files in both builds, so no patch silently failed to load.
   - **Params added on resave:** both builds wrote out params added since the patches were made. That's existing behavior.
   - **Console:** neither build logged an error. The old build logged one WebGL performance warning.
2. **All modules.** All 63 module types were built in the new build in the browser, and every one passed the id check.
3. **Rename test.** A Node test with stand-in modules saved a patch, then renamed both modules, renamed a param, removed a param, and inserted a new port ahead of the existing ones before loading it back. The renamed param kept its value, the video and knob cables followed their ports and param to their new positions, and the removed param's cable was dropped with a warning. The same test confirmed that a duplicate, missing or inherited uid, an id shared within a module, a patch from before ids and an unknown uid all throw.

The scripts for these checks were one-offs and are not in the repo.

## Known limits

- **Param keys are opaque.** Params in a patch file are keyed by id, so they can't be told apart by reading the file. Each node still carries a readable `type`.
- **Old share links don't load.** Share links made before this change fail with the message pointing at the converter, and the converter only reads files.
- **A module rename still touches code.** It no longer affects saved patches, but it still means updating 89 type-name comparisons on 45 lines of `js/ui.js` and `js/main.js`, as well as `MODULE_CATEGORIES` and `MODULE_COLORS`.
- **Ids can't detect a change of meaning.** A param that keeps its id but changes what its value means loads the old number without any error. Rule 2 covers this.
