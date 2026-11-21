class_name SpriteTextureBuilder
extends RefCounted
## Builds the 18 ImageTextures (9 moods x 2 breathing frames) from a parsed
## SpriteData with nearest-neighbour filtering. Pure data in, textures out —
## no node dependencies. The sprite_data parameter is untyped on purpose:
## a script cannot name another global class without the editor's class cache,
## and this must also load in headless test runs.

const PIXEL_SIZE := 24
const HEX := "0123456789abcdef"

## Returns a Dictionary keyed "mood0" / "mood1" -> ImageTexture.
func build(sprite_data) -> Dictionary:
	var out := {}
	for mood: String in sprite_data.mood_order:
		for b in 2:
			var image := Image.create(PIXEL_SIZE, PIXEL_SIZE, false, Image.FORMAT_RGBA8)
			var rows: Array = sprite_data.frame(mood, b)
			for y in PIXEL_SIZE:
				var row: String = rows[y]
				for x in PIXEL_SIZE:
					var idx := HEX.find(row[x])
					var entry: Dictionary = sprite_data.palette[idx]
					var col := Color.TRANSPARENT
					var hex_value = entry.get("hex", null)
					if hex_value != null:
						col = Color.from_string(str(hex_value), Color.TRANSPARENT)
					image.set_pixel(x, y, col)
			var tex := ImageTexture.create_from_image(image)
			# Nearest-neighbour scaling comes from the project setting
			# rendering/textures/canvas_textures/default_texture_filter=0 plus
			# the Sprite2D's texture_filter; ImageTexture has no filter
			# property in Godot 4.7.
			out[mood + str(b)] = tex
	return out
