class_name SpriteData
extends RefCounted
## The exported pixel art: palette plus nine moods, two frames each.
## Parsed from `res://data/preyas-sprite.json`, which the repo's
## `scripts/export-sprite.mjs` generates from the mobile app's art sources.
## Pure parsing and validation — no node dependencies.
##
## Note: GDScript cannot name its own class inside its own script, so the
## parse method returns untyped and builds the instance via load().

const PIXEL_SIZE := 24
const HEX := "0123456789abcdef"

var size := PIXEL_SIZE
var mood_order: Array = []
var palette: Array = []
var frames: Dictionary = {}

## Parse and validate the exported JSON. Returns the SpriteData, or null
## (with a pushed error) on any problem, so a broken export fails loudly
## instead of showing garbage.
static func parse(text: String):
	var json := JSON.new()
	if json.parse(text) != OK:
		push_error("PreyasWorld: sprite JSON is not valid JSON")
		return null
	if typeof(json.data) != TYPE_DICTIONARY:
		push_error("PreyasWorld: sprite JSON root is not an object")
		return null
	var data: Dictionary = json.data
	if int(data.get("size", 0)) != PIXEL_SIZE:
		push_error("PreyasWorld: sprite size must be %d" % PIXEL_SIZE)
		return null
	var order: Array = data.get("moodOrder", [])
	if typeof(order) != TYPE_ARRAY or order.size() != 9:
		push_error("PreyasWorld: moodOrder must list nine moods")
		return null
	var pals: Array = data.get("palette", [])
	if typeof(pals) != TYPE_ARRAY or pals.size() != 16:
		push_error("PreyasWorld: palette must have 16 entries")
		return null
	for i in pals.size():
		var entry: Dictionary = pals[i]
		if int(entry.get("index", -1)) != i:
			push_error("PreyasWorld: palette entry %d has a wrong index" % i)
			return null
		var hex_value = entry.get("hex", null)
		if (i == 0) != (hex_value == null):
			push_error("PreyasWorld: palette entry 0 must be the only transparent one")
			return null
	var frame_map: Dictionary = data.get("frames", {})
	if typeof(frame_map) != TYPE_DICTIONARY or frame_map.size() != 9:
		push_error("PreyasWorld: frames must cover nine moods")
		return null
	for mood: String in order:
		var pair: Array = frame_map.get(mood, [])
		if pair.size() != 2:
			push_error("PreyasWorld: mood %s must have two breathing frames" % mood)
			return null
		for f in 2:
			var rows: Array = pair[f]
			if rows.size() != PIXEL_SIZE:
				push_error("PreyasWorld: mood %s frame %d must have 24 rows" % [mood, f])
				return null
			for row: String in rows:
				if row.length() != PIXEL_SIZE:
					push_error("PreyasWorld: mood %s frame %d has a bad row width" % [mood, f])
					return null
				for ch in row:
					if HEX.find(ch) == -1:
						push_error("PreyasWorld: mood %s frame %d has a bad digit '%s'" % [mood, f, ch])
						return null
	var sd = load("res://scripts/sprite_data.gd").new()
	sd.mood_order = order.duplicate()
	sd.palette = pals.duplicate(true)
	sd.frames = frame_map.duplicate(true)
	return sd

## The rows of one breathing frame (0 = breath in, 1 = breath out) for a mood.
## Empty on unknown moods (validated data always has neutral).
func frame(mood: String, breathing: int) -> Array:
	var pair: Array = frames.get(mood, frames.get("neutral", []))
	if pair.size() != 2:
		return []
	return pair[breathing % 2]
