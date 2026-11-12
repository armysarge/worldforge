# [WIP] Worldforge

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Donate-brightgreen?logo=buymeacoffee)](https://www.buymeacoffee.com/armysarge)
[![JavaScript](https://img.shields.io/badge/JavaScript-Browser-f7df1e?logo=javascript&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![WebGPU](https://img.shields.io/badge/WebGPU-Terrain%20compute-31595f)](#terrain-compute)
[![Material Web](https://img.shields.io/badge/Material%20Web-UI-5264ae?logo=materialdesign)](https://github.com/material-components/material-web)
[![Three.js](https://img.shields.io/badge/Three.js-3D%20preview-365860?logo=threedotjs)](https://threejs.org/)

[![Unreal Engine](https://img.shields.io/badge/Unreal%20Engine-R16%20%2B%20PCG-31595f?logo=unrealengine)](#unreal-engine)
[![Unity](https://img.shields.io/badge/Unity-Terrain%20%2B%20Tiles-31595f?logo=unity)](#unity)
[![Godot](https://img.shields.io/badge/Godot-RAW%20height%20data-31595f?logo=godotengine)](#godot)

Worldforge is a browser-based terrain and heightmap generator for game development. Generate islands or mainland regions with mountains, rivers, lakes, biomes, roads, settlements and resources. Inspect the world in 2D or 3D, then export terrain and map data for your engine.

I originally built Worldforge to help make the world for my game **Desolation Day**. I decided to share it so anyone building a game can use it for their own maps. The Desolation Day scenario is still included, alongside a general-purpose Sandbox.

## Map gallery

The four views show the same generated 20 km world from the **Desolation Day** scenario, using seed `harbor-fog`, the **Crescent / big bay** shape, a **1009** generation grid and **CPU** terrain compute.

| Island overview | City detail |
| --- | --- |
| ![2D map of the island, with rivers, roads and POI labels](assets/worldforge-2d-overview.jpg) | ![Zoomed 2D map showing streets, buildings and POIs](assets/worldforge-2d-city.jpg) |
| ![3D terrain overview from the coast](assets/worldforge-3d-overview.jpg) | ![3D city detail showing streets, building massing and the metro overlay](assets/worldforge-3d-city.jpg) |

## Quick start

1. Open [index.html](index.html) in a modern desktop browser. It opens on a finished world: the one in the address (a share link, or the last world of that tab), otherwise your most recently saved world, otherwise the built-in example project (a 16 km crescent island on the quick 505 grid, on a new random seed each time; the seed is shown in the Seed box and the status line). The 2D generator runs locally with no build step. The 3D view loads three.js from a CDN the first time it is opened.
2. Pick a **Preset** for a one-click starting point (farmland island, alpine island, wild archipelago, rolling countryside, mountain valleys, dry plateaus or cliff coast), or set things yourself: pick a scenario, seed, footprint, terrain type and generation grid. Use **505** for fast iteration, **1009** for a balanced grid, **2017** for finer generation, or **4033** for the most detailed simulation.
3. Click **Generate terrain**. Two bars under the toolbar show progress: **Overall** for the whole job and **Step** for the stage or file in hand. They also run during exports. The collapsible legend on the map follows the selected layer. Hover over controls for a description. When a metro network exists, **Underground metro** shows its cyan dashed alignments in 2D and 3D.
4. Pick an **Export size**, then use the export button for your engine. The generation grid drives the world simulation. A larger export adds terrain detail and resamples the existing world.

| Scenario | Generated world |
| --- | --- |
| **Sandbox** | The default. Terrain, settlements, infrastructure, resources, starting region and progression zones for a general game project. |
| **Desolation Day** | Adds seeding installations, infestation, story sites and survivor factions from the original project. |

**Places** sets how much of the world is settled.

| Places | Result |
| --- | --- |
| Full world | Towns, roads, farms, facilities and resources. The default. |
| Few places | About a third of the usual sites. |
| Random mix (per seed) | Each kind of place gets its own share from the seed; some kinds are left out entirely. |
| None (terrain only) | Terrain, rivers and lakes with only natural landmarks such as peaks and waterfalls. No roads, buildings or farmland. |

To tone the water down, **River density** at its lowest keeps only the main rivers, and **Lakes** at 0 removes every lake, natural hollows included. **Erosion** at 0 leaves slopes without gullies.

Hover over the 2D map for the position, height, slope and biome under the pointer, plus the highway, gravel road or dirt track running through it and the nearest place.

Keep the seed, scenario and settings together when reproducing a map. Terrain shaping changed in this version (rivers, gullies, farmland, road beds), so a seed from an older version gives a different map. Save the exported files for worlds you intend to keep across generator updates.

## Mainland terrain

Choose a preset under **Terrain type → Mainland**. The terrain extends to the map edge. Rivers that continue beyond the footprint are listed as `riverOutlets` in the world JSON.

| Terrain type | Landform |
| --- | --- |
| Rolling hills | Low ridges, broad valleys and gentle slopes. |
| Mountainous valleys | A winding lowland corridor between high ridges. |
| Stepped plateaus | Broad shelves above lower river valleys. |
| Coastal cliffs | A mainland coast with headlands, cliff sections and ocean along one side. |

**Erosion simulation** (Light or Strong) lets rivers cut into the base terrain and over-steep valley walls slump before lakes and rivers are laid out, giving branching valley networks and sharper ridges. It drains some natural hollows, so maps have fewer natural lakes. Off, the default, keeps existing maps unchanged. Grids above 505 are eroded at 505 and the change is interpolated back. **Elevation** scales vertical relief. **Erosion** controls how deeply catchment lines erode before river beds are carved. **Snow line** changes where snow appears in the biome and material layers. **Terrain scale** controls the size of terrain features. Higher values produce more closely spaced detail. The same seed and terrain controls work with **Satellite terrain**, **Topographic terrain**, and **Grayscale height** previews. Use the R16 or RAW export for full-precision engine height data. [Texturize Terrain Generator](https://texturize.app/generators/terrain)

## Town layouts

Settlements are laid out as surveyed towns.

- **Blocks on a grid** squared to the main road through the centre. The main street and one cross street always run. The grid is complete in the core and thins towards the edge into longer blocks and dead ends, with an uneven outline. Cities use 90 m blocks, towns 70 m.
- **Cities grow in districts**: a core on the main road and two or three districts on their own headings, each taking the ground nearest its own centre.
- **Terrain decides**: the grid gives way to rivers, steep ground and the roads already there.
- **Street bridges**: the main street, the cross street and every third street may bridge a river once, where the crossing is under about 45 m. The bridge deck runs level from bank to bank, and those streets are marked `bridge` in the world JSON.
- **A square**: towns and cities keep a block beside the centre open as a green (`square` on the settlement in the world JSON).
- **Works and yards**: the outermost street of each district carries large industrial buildings (`use: industrial` on the street).
- **Villages** are one street along the road with a few short side lanes.

Every street is joined to the road network. A highway that ends in a town is the end of that highway: towns in the middle of the highway network have it running through.

## Terrain shaping: carve or mark

The **Terrain shaping** panel sets what each kind of feature does to the ground. Regenerate after changing it.

| Feature | Options |
| --- | --- |
| Rivers, Streams | **Carve the channel**, or **Marked only**: the ground is left as it is and the river is still on the map, in the masks and exported as a spline lying on the ground. Use this when the engine cuts its own rivers (for example the Unreal Water plugin). |
| Lakes | **Carve the basin**, or **Marked only**: the export has level ground at the water line; the lake stays on the map, in the water mask and as a shore outline. |
| Roads | **Land fits the road**: the ground is cut and filled so the road keeps an even grade (8% highways, 12% roads). **Road fits the land**: the road is laid on the ground as it is and only levelled across its width, so it rises and falls with the terrain. **Marked only**: no change to the ground. |
| Buildings | **Level pad under each**, or **Marked only**: footprints stay in the data, the ground is untouched. |

Roads still bridge rivers in every mode. With rivers marked only there is no channel to span, so those crossings are simply points on the road.

## Material layers

The **Material layers** panel sets how the eight ground layers (sand, grass, farmland, forest, rock, snow, wetland, urban) are laid out. It takes effect straight away in the **Material weights** map view and in the layer weightmap exports.

- **Follow the biomes** (default) derives every layer from the biome map.
- **Height and slope rules** is the stack used by terrain editors and auto-materials: **sand** from sea level up to a height, bare **rock** where the slope passes an angle (and optionally above a height), **snow** from a height, each with a soft **blend** band. Snow lies over rock, rock over the vegetation layers, and grass, farmland, forest and wetland share what is left according to the biomes. Empty fields are automatic: sand to 6 m, rock from 32°, no rock height, snow at the world's snow line, 15 m blend.

## Drawing ridges, rivers, roads and biomes

Open **Draw ridges, rivers, roads and biomes**, pick a **Line type**, press **Draw new line** and click points on the 2D map. Double-click or press Enter to finish, Esc to cancel, Backspace to remove the last point. Press **Apply and regenerate** and the world is rebuilt around the lines: drainage, biomes, towns and the generated road network all respond to them.

| Line type | Effect | Width | Strength |
| --- | --- | --- | --- |
| Ridge | Raises a crest along the line that rises and dips and tapers out at both ends. | Width of the ridge | Height: about 25 m per step on a 10 km map, 100 m per step on a 100 km map |
| Valley | Lowers a trough. Land is never pushed below sea level. | Width of the valley | Depth, same scale as ridges |
| River course | Cuts a steadily falling valley from the higher end of the line to the lower and feeds it water, so a river runs the whole length. From the end of the line the water finds its own way downhill. | Width of the valley | 1 to 3 stream, 4 to 7 river, 8 to 10 major river |
| Road | Routed through the drawn points with the normal road rules (grades, bridges, tunnels) and built before the generated network, which then joins it. | Not used | 1 to 3 dirt track, 4 to 7 gravel road, 8 to 10 highway |

**Paint** types (forest, plains, farmland, wetland, highland, alpine rock, snow, beach) work the same way as brush strokes: every land cell under the stroke takes that biome, with **Width** as the brush width. Later strokes cover earlier ones, lakes and sea are left alone, and painted ground is not converted to farmland. Site placement, resources, material weights and PCG masks all follow the painted biomes.

To change a line, click it and drag its points; the Width and Strength sliders then edit the selected line. **Undo point**, **Delete selected** and **Clear all** do what they say. Lines are stored as part of the world's settings, as fractions of the map, so saved worlds and share links keep them and they survive a change of footprint or grid.

Roads keep off beaches: sand costs extra to build on, and the shore road between neighbouring ports and lighthouses runs set back from the water in stretches, not as a ring round every island.

A road follows the sketch where the ground allows. Across ground too steep for its class it goes round, and the panel says how far. Changing the terrain with a ridge or river also changes where towns and other sites are placed, because placement scores the new ground.

## 3D view

**3D view** draws the terrain with three.js on WebGPU, falling back to WebGL 2 where WebGPU is unavailable; the status line names the one in use. The mesh comes from the same pipeline as the heightmap exports (upsampled grid, added relief, river channels cut at mesh resolution, graded roads and building pads), so it shows what an engine will receive. **Mesh** sets the samples per side: 513, 1025 or 2049. Lighting comes from the mesh, so the map colours are drawn without their baked hillshade. Add `?webgl` to the page address to skip WebGPU if a graphics driver misbehaves.

## Terrain shaping

- **Rivers** have a flat bed as wide as the river, banks no steeper than about 1 in 5, and a depth that stays well below the width. Beds fall steadily instead of in cell-sized steps, and exports cut the channel again at export resolution from the river line, so banks come out smooth at any size.
- **Farmland** barely changes the ground: fields lose 30% of their small bumps and keep every slope. Parcels on the map are drawn in blocks with their own heading, strip width and uneven lengths.
- **Building pads** sit at the average ground level under the footprint and meet the ground over an apron no steeper than about 1 in 3. Neighbouring pads blend into each other.
- **Roads** are bedded along their smoothed centreline with a shoulder, and only gullies carrying a real stream stay open under a road.
- **Added relief** at export size fades out towards roads, streets, buildings and river channels, and is much lighter on farmland and beaches.

## River landforms

**River landforms** (on by default) shapes the land along rivers:

- **Floodplains**: flat valley floors beside gently falling lowland rivers, up to about 15 times the channel width. Valley walls and terraces are left alone. The **Floodplain** PCG mask marks them.
- **Deltas**: where a major river reaches the sea across a low coastal plain, two distributary channels branch off towards the coast. Small islands often have no river large enough.

Turn it **Off** to reproduce terrain made before this setting. **Waterfalls** are marked wherever a river drops steeply over a short distance; they are POIs with a drop height and do not change the terrain.

## Terrain compute

**Auto** uses WebGPU for the base height field, small-scale terrain relief and screening potential tunnels and viaducts. The CPU still validates each remaining structure candidate and chooses the route. The generator falls back to CPU when WebGPU is unavailable or a compute pass fails. **World statistics** shows both compute backends.

Heightmap exports, tiles and the 3D mesh also run their per-sample work on WebGPU when compute is **Auto**: the upsample of the grid and the added relief. The export status line says which backend did it, and the result matches the CPU version to under a millimetre. The CPU handles drainage and rivers, road search and grading, settlements, resources, river cutting and dip filling at export size, because each of those steps depends on the result of the one before it. Generation is also about a fifth faster on a 1009 grid and a quarter faster on 2017 than the previous version from reworked site placement, road search bookkeeping and resource packing. The background worker handles generation when Worldforge is served over HTTP or HTTPS. The browser console reports time per generation stage.

**4033** generates roughly 16.3 million samples. On a 16 km footprint, samples are about 3.97 m apart. This grid needs substantially more system memory and time, even when WebGPU is active. **8129** is an export size.

Choose **CPU** to reproduce maps made before WebGPU support. The GPU shader uses 32-bit arithmetic, so small elevation differences can change a downstream river route or placement even with the same seed. World JSON and tile manifests record the backend used.

If Auto reports **CPU fallback**, check that browser graphics acceleration is enabled. If WebGPU is unavailable when opening the HTML directly, try serving the project folder on localhost. For example, run `python -m http.server 8000 --bind 127.0.0.1` and open `http://localhost:8000`. [Chrome WebGPU troubleshooting](https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips)

### Background generation

When the project is served (for example on localhost, as above), generation runs in a Web Worker: the page stays responsive and **Cancel** stops a run immediately. Opened directly as a file, generation runs on the page and **Cancel** stops it at the next stage. Both produce the same world.

## Engine exports

| Engine | Export button | Output |
| --- | --- | --- |
| Unreal Engine | **Export Unreal package** | 16-bit R16, matching landscape layers and masks, JSON and CSV data, plus an optional editor Python script. |
| Unity | **Export Unity bundle** or **Unity heightmap** | The ZIP contains RAW height data, scale metadata, world JSON, eight matching weightmaps and an editor importer. The heightmap button exports only RAW and its settings. Both use the nearest supported resolution among 513, 1025, 2049 and 4097. |
| Godot | **Godot height data** | 16-bit little-endian RAW at the selected size and an import settings JSON. Import it with the Terrain3D add-on or read it in your own terrain system. |

The browser may ask to allow multiple downloads. Keep each RAW file beside its matching JSON. The 8-bit height PNG is for previewing elevations. Use RAW or R16 for engine terrain.

With a **4033** generation grid, select **Same as grid** to export native **4033 × 4033** height data for Unreal or the Terrain3D importer in Godot. The Unity exporter automatically resamples to **4097 × 4097**, a supported Unity Terrain resolution, while preserving the footprint. [Unreal Landscape sizes](https://dev.epicgames.com/documentation/unreal-engine/landscape-technical-guide-in-unreal-engine) · [Unity Terrain resolutions](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/TerrainData-heightmapResolution.html) · [Terrain3D RAW import](https://terrain3d.readthedocs.io/en/stable/docs/import_export.html)

### Unreal Engine

1. Export the package. The import values are at the top of the generated `.py` file and under `unreal` in the world JSON (`importSteps` lists them in order).
2. In Landscape mode choose **Manage → New → Import from File** and pick the R16. Enter the exported **Location**, **Scale**, section size and component counts, with **Flip Y Axis** off. For example, a 4033 landscape uses 63 quads per section, 2 × 2 sections per component, and 32 × 32 components.

   The Location is the **centre** of the map, because that panel places a landscape by its centre: a 10 km map uses `500000, 500000`. The Landscape actor then sits at `0, 0` (`actorLocation`), which is the north-west corner every exported coordinate is measured from, and sea level is Z = 0.

   **Open World levels on Unreal 5.7 and 5.8:** importing a heightmap straight into a World Partition level is broken in the engine. One piece of the terrain repeats with flat ground between. Import into a **Basic** level, save it, then use **Tools → Convert Level**. Unreal 5.5 and 5.6 import directly.
3. Create matching Landscape material layers and Layer Info assets, then import the weightmaps at the same dimensions as the heightmap. Use the PCG masks separately for placement or exclusion.
4. To create markers and splines, enable the Python Editor Script Plugin, open the level with the landscape and choose **Tools → Execute Python Script**. The header of the generated file lists the steps, and a `RUN` block switches each part on or off. A summary window reports what was created and what was skipped, with the reason.

   | Part | Creates |
   | --- | --- |
   | Landscape check | Confirms the landscape position and scale. It moves the landscape only in a plain level with a single landscape, never in a World Partition level. |
   | Place markers | One Target Point per place, tagged with id, type, region, zone, danger and loot. |
   | PCG volumes | A volume over each settlement and over the terrain. |
   | Roads, streets, metro | Highways, gravel roads and dirt tracks; settlement streets; metro lines. Three separate switches. |
   | Rivers | Plain splines, or Water plugin rivers when `USE_WATER_PLUGIN` is on. |
   | Area outlines | Closed splines around the coast, lake shores, forest, farmland, wetland, beach, highland and snow, for PCG, landscape layers or biome tools. |

   Splines use the Blueprint at `SPLINE_BP`, an Actor with one Spline component. Make it once: **Add → Blueprint Class → Actor**, name it `BP_WorldforgeSpline` in `/Game/Worldforge`, add a Spline component, compile and save. Without it the spline parts are skipped and the summary says so. The same outlines are in the world JSON under `areas`.

   Rivers are plain splines by default. `USE_WATER_PLUGIN = True` makes the largest ones (`MAX_WATER_RIVERS`) real Water plugin rivers; every water body re-renders the landscape water brush and holds GPU memory, so turn it on only after the rest is in and saved. For a lighter first run, set `streets` and `area outlines` to `False` in `RUN`.

[Epic's Landscape Technical Guide](https://dev.epicgames.com/documentation/unreal-engine/landscape-technical-guide-in-unreal-engine) · [Custom heightmaps and layers](https://dev.epicgames.com/documentation/unreal-engine/creating-and-using-custom-heightmaps-and-layers-in-unreal-engine)

### Unity

For the ZIP workflow, extract the bundle into the Unity project root so the files land in `Assets/Worldforge`. Run **Tools → Worldforge → Create Terrain** to build a terrain asset and scene object at the exported scale and elevation. Assign your own Terrain Layers and use the PNGs in your material workflow. **Tools → Worldforge → Export Unity Package** lets Unity create a native `.unitypackage` from the imported assets.

For a manual heightmap import:

1. Export **Unity heightmap** and create a Terrain in Unity.
2. In Terrain Settings, under the heightmap resolution controls, choose **Import Raw**. Select the exported RAW, use **16 bit** depth and **little-endian** byte order (shown as **Windows** in some versions), and use the JSON's `width` and `height` for the resolution.
3. Set Terrain Width and Length to `footprintMeters`. Set Terrain Height to `verticalRangeMeters`, then set the Terrain object's Y position to `heightMinMeters` for sea level at world Y = 0.
4. Compare a distinctive coastline with the map preview before committing to the vertical flip setting. Keep the same row orientation when mapping textures, roads and POIs. Add Terrain Layers in Unity and use the separately exported masks as inputs to your texturing or placement pipeline.

[Unity heightmap import](https://docs.unity3d.com/6000.0/Documentation/Manual/terrain-Heightmaps.html) · [TerrainData resolutions](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/TerrainData-heightmapResolution.html)

### Godot

1. Export **Godot height data**. Install a version of Terrain3D compatible with your Godot 4 project and open its `addons/terrain_3d/tools/importer.tscn` scene.
2. Choose the RAW as the height map. Enter `width` and `height` as the RAW dimensions and `heightMinMeters` and `heightMaxMeters` as the RAW elevation range. Start with import scale 1 and height offset 0, since the elevation range already restores the terrain's height and sea level.
3. Use `sampleSpacingMeters` for Terrain3D's vertex spacing. Check the region size against the add-on's limits for large files, then run the import and save the terrain data directory. Worldforge layer PNGs are separate density maps. Use Terrain3D's own control maps or materials to texture the imported terrain.

For a custom Godot terrain, decode the unsigned little-endian 16-bit samples with the formula below. Use the heights for a visible mesh and, if needed, a `HeightMapShape3D` collider. Its default horizontal spacing is 1 unit, so apply spacing and centering consistently to the mesh and collision.

[Terrain3D importer](https://terrain3d.readthedocs.io/en/stable/docs/import_export.html) · [Godot HeightMapShape3D](https://docs.godotengine.org/en/stable/classes/class_heightmapshape3d.html)

## Other exports

| Button | Output |
| --- | --- |
| **Heightmap .png (16-bit)** | The same samples as the R16 as a 16-bit grayscale PNG, which terrain tools open directly. |
| **Gaea heightmap** | A 16-bit PNG at the nearest power-of-two size (512 to 8192) and a settings JSON with the terrain width, height range in metres and sea level as a fraction of that range, plus the steps for loading it through a File node. Build at the same size and keep the same width and height in Gaea, and the result drops back onto every Worldforge coordinate, mask and spline. |
| **Vectors .geojson** | Roads (with elevation profile), bridges, viaducts, tunnels and overpasses as separate lines, rivers (bed elevation and width per vertex), streets, lakes and POIs. Coordinates are metres from the north-west corner, not geographic. |
| **Mesh .glb / .obj** | The terrain as a triangle mesh with normals, at the selected **Mesh size**. x east, y up, z south, in metres. |
| **Normal map .png** | World-space normal map at the export size. Green points north (OpenGL convention); flip green for Unreal. |
| **PCG masks** | Now also includes **Scree**, loose rock on the slopes below cliffs, and four data maps: **Data_Slope** (white is 60° or steeper), **Data_Flow** (how much water drains through, log scale), **Data_Curvature** (grey is flat, lighter is ridges, darker is hollows) and **Data_Aspect** (north-facing black, south-facing white). |

## Saved worlds and links

**Save project file** downloads the current world's settings, drawn lines and painted biomes as a small `.worldforge.json` file; **Open project file** loads one and generates it. Use these to back a world up or pass it to someone else.

**Saved worlds** keeps seeds and their settings in this browser. **Copy share link** copies a URL that recreates the current world; the address bar also updates after each generation. Links reproduce maps exactly with **CPU** compute; WebGPU can differ slightly.

## Tests

Run the `test-*.cjs` scripts with Node. `test-regression.cjs` generates fixed seeds and checks drainage, river outlets, road access, roads staying off rivers and that a seed reproduces the same world.

## Terrain tiles

Open **Terrain tiles**, choose Unreal or Unity, and pick a 2 × 2, 4 × 4, 8 × 8 or 16 × 16 grid. Turn on **Show tile grid and selection** and enter the column and row to locate a section. **Export selected tile** saves that section at the same resolution and position it would have in **Export all tiles**. Column 0 is west and row 0 is north.

Each Unreal tile is 1009 × 1009 and each Unity tile is 1025 × 1025. The neighbouring tiles share one row or column of vertices. An 8 × 8 Unreal grid on a 16 km world is equivalent to 8065 × 8065 samples, about 1.98 m apart. A 16 × 16 grid yields 16129 × 16129 samples at about 0.99 m apart. A 100 km world at the same grid size has about 6.20 m spacing.

1. **Unreal** — Extract the R16 files into one directory. In a World Partition level, select a tile in Landscape mode and accept the tiled import. Use the scale and section size in `tiles.json`. Align the northwest corner to the world origin, or use the tile's east and south offsets in metres for a single section. Compare a recognizable coast and river against the preview before applying the same orientation to other exports. For a very large grid, import and test subregions first to check landscape component counts and streaming performance. [Epic's tiled heightmap import guide](https://dev.epicgames.com/documentation/en-us/unreal-engine/importing-and-exporting-landscape-heightmaps-in-unreal-engine)
2. **Unity** — Extract the ZIP into the project root. Run **Tools → Worldforge → Create Terrain Tiles** and select the extracted `tiles.json`. The importer positions each tile at its world coordinates and connects neighbours listed in that manifest. Use **Export all tiles** when importing a complete set. [Unity's Terrain.SetNeighbors reference](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/Terrain.SetNeighbors.html)

Export partial tiles from the same generated world, with the same edits, target engine and tile grid. Tiles add procedurally generated relief to the existing world and reapply river carving and grading at export resolution. The generation grid controls drainage, shorelines and settlement placement. Fine relief can leave small depressions between samples of that underlying simulation. Layer and PCG maps are separate exports. Tile generation works through one tile at a time on the CPU and shows progress as each tile finishes. The ZIP accumulates the finished tiles, so a full 16 × 16 export can still take roughly half a gigabyte before browser overhead.

## Data and scale

- Height data is row-major. The first sample is at the northwest corner, columns increase eastward and rows increase southward. The interval between adjacent vertices is the footprint width divided by `resolution - 1`.
- Decode a RAW sample as `heightMinMeters + (sample / 65535) * verticalRangeMeters`. Both the scale and the offset matter. Sea level is 0 m.
- **World data JSON** stores POIs, roads, lakes, streets, building footprints, resources and gameplay regions in metres from the northwest corner. The CSV button supplies tables with Unreal-style centimetre coordinates.
- **Layer weightmaps**, **Water mask** and **PCG masks** follow the selected export size. Unity's RAW uses the Unity-compatible dimensions from its own JSON. Use matching world bounds when resampling masks for a material or placement tool.
- Weightmaps blend biome coverage with slope, moisture, river and built-up ground. **Material weights** previews the combined surface. The Unity bundle resamples all eight weightmaps to the same size as its heightmap.
- Road structures in the world JSON include bridge deck points in metres. Local streets include elevation profiles, buildings have a foundation elevation, and metro links contain underground XYZ points. The Unreal script can import metro alignment splines using the road spline Blueprint. Use the structure data to build your bridge meshes and tunnel interiors.
- Exported heightmaps grade dry ground under building pads and roadbeds. Fine features depend on the export's vertex spacing, and grading preserves mapped river channels, water and lake rims.
- **8129 × 8129** is supported for the heightmap (R16, 16-bit PNG, Gaea at 8192), layer weightmaps, the water mask and all PCG masks. PNGs are written row by row through the browser's own compressor, masks are computed on the generation grid and interpolated as they are written, and vector layers are drawn in strips, so no full-size RGBA image is ever held. A complete 8129 set took about two minutes and stayed under 1 GB of script memory in testing; the R16 is 132 MB. The WebGPU relief pass runs in bands at this size. The normal map and the Unity bundle are still limited by their own formats (Unity tops out at 4097).

## Editing and checking POIs

Use **Move POIs by dragging on the 2D map** and **Undo POI move** to adjust placements before exporting. Roadside facilities snap to a nearby surface street or road. Civic footprints follow their markers. City and town centers, deposits, and features tied to water or road geometry stay anchored to their generated positions. Generating another terrain clears your edits.

The **Surface access review** in World statistics lists road-oriented sites without a surface road within 100 m. The generator places civic facilities on street frontages and omits proposals it cannot place safely. Hospitals are limited to one per eligible settlement and spaced by the footprint with a 1.5 km minimum.

## Development

Open `index.html` directly from the project folder. Keep the stylesheet, `js/` and `assets/` beside it. The browser loads the local scripts in the order listed in the HTML.

| File | Responsibility |
| --- | --- |
| `index.html` | Page structure and controls |
| `styles.css` | Layout, theme and control styling |
| `js/terrain.js` | World generation and CPU routing |
| `js/baseterrain.js`, `js/roadcompute.js` and `js/exportcompute.js` | WebGPU base terrain, road structure screening and export-size relief |
| `js/map.js` | 2D rendering, the three.js 3D view, overlays, legends and map information |
| `js/exports.js` | Heightmaps, engine data, terrain tiles and import helpers |
| `js/app.js` | Startup, control events, navigation and POI editing |

Run these focused checks from the project directory with Node.js.

```sh
node test-island-shapes.cjs
node test-terrain.cjs
node test-engine-export.cjs
node test-settlements.cjs
```

