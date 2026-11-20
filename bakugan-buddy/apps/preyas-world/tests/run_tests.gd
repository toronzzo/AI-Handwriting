extends SceneTree
## Preyas World test runner.
##
## Run (from the repo root):
##   Godot --headless --path apps/preyas-world --script res://tests/run_tests.gd
##
## Exit code 0 when every check passes, 1 otherwise. The tests only touch the
## pure scripts (walker, mood mapping, night check, sprite JSON parsing), so
## they also work headless.

const WalkerScript := preload("res://scripts/walker.gd")
const MoodLogicScript := preload("res://scripts/mood.gd")
const SpriteDataScript := preload("res://scripts/sprite_data.gd")

var checks := 0
var failures := 0

## A deterministic rng stand-in: walker.gd only calls randf() on it.
class FakeRng:
	extends RefCounted

	var value := 0.99

	func randf() -> float:
		return value

func _init() -> void:
	_walking_tests()
	_mood_tests()
	_sprite_tests()
	print("")
	print("checks: %d, failures: %d" % [checks, failures])
	quit(0 if failures == 0 else 1)

func check(cond: bool, name: String) -> void:
	checks += 1
	if cond:
		print("ok    ", name)
	else:
		failures += 1
		printerr("FAIL  ", name)

func _walking_tests() -> void:
	var steady := FakeRng.new() # randf() = 0.99 -> never pauses

	var w := WalkerScript.new()
	w.x = 100.0
	w.advance(1.0, 96.0, 4.0, 1000.0, steady)
	check(w.phase == WalkerScript.PHASE_WALKING, "walker starts walking")
	check(absf(w.x - (100.0 + w.speed)) < 0.0001, "walker moves right by one second of speed")

	var w_left := WalkerScript.new()
	w_left.x = 100.0
	w_left.direction = -1.0
	w_left.advance(1.0, 96.0, 4.0, 1000.0, steady)
	check(w_left.x < 100.0, "walker moves left with negative direction")

	var w_right := WalkerScript.new()
	w_right.x = 190.0
	w_right.advance(1.0, 96.0, 4.0, 200.0, steady)
	check(w_right.direction == -1.0, "turns around at the right edge")
	check(w_right.x == 200.0 - 96.0, "sits at the right edge after turning")

	var w_edge := WalkerScript.new()
	w_edge.x = 10.0
	w_edge.direction = -1.0
	w_edge.advance(1.0, 96.0, 4.0, 1000.0, steady)
	check(w_edge.direction == 1.0, "turns around at the left edge")
	check(w_edge.x == 4.0, "sits at the left edge after turning")

	var eager := FakeRng.new() # randf() = 0.0 -> pause of exactly 1.5 s
	eager.value = 0.0
	var w_pause := WalkerScript.new()
	w_pause.x = 100.0
	w_pause.advance(1.0, 96.0, 4.0, 1000.0, eager)
	check(w_pause.phase == WalkerScript.PHASE_PAUSED, "pauses on a lucky roll")
	var frozen: float = w_pause.x
	w_pause.advance(1.0, 96.0, 4.0, 1000.0, eager)
	check(w_pause.phase == WalkerScript.PHASE_PAUSED and w_pause.x == frozen, "stands still while paused")
	w_pause.advance(0.6, 96.0, 4.0, 1000.0, eager)
	check(w_pause.phase == WalkerScript.PHASE_WALKING, "resumes walking after the pause")

	var w_drag := WalkerScript.new()
	w_drag.drag_to(5000.0, 96.0, 4.0, 400.0)
	check(w_drag.x == 400.0 - 96.0, "drag clamps to the right edge")
	w_drag.drag_to(-50.0, 96.0, 4.0, 400.0)
	check(w_drag.x == 4.0, "drag clamps to the left edge")
	w_drag.set_sleeping(true)
	w_drag.end_drag()
	check(w_drag.phase == WalkerScript.PHASE_WALKING, "drop resumes walking")
	check(w_drag.x == 4.0, "drop keeps the drop position")

	var w_sleep := WalkerScript.new()
	w_sleep.x = 50.0
	w_sleep.set_sleeping(true)
	check(w_sleep.phase == WalkerScript.PHASE_SLEEPING, "set_sleeping(true) puts him to sleep")
	var before: float = w_sleep.x
	for i in 10:
		w_sleep.advance(1.0, 96.0, 4.0, 1000.0, steady)
	check(w_sleep.x == before and w_sleep.phase == WalkerScript.PHASE_SLEEPING, "no walking while sleeping")
	w_sleep.set_sleeping(false)
	check(w_sleep.phase == WalkerScript.PHASE_WALKING, "waking resumes walking")
	w_sleep.advance(1.0, 96.0, 4.0, 1000.0, steady)
	check(w_sleep.x > before, "walks again after waking")

func _mood_tests() -> void:
	check(MoodLogicScript.is_night(23), "23:00 is night")
	check(MoodLogicScript.is_night(0), "00:00 is night")
	check(MoodLogicScript.is_night(6), "06:00 is night")
	check(not MoodLogicScript.is_night(7), "07:00 is day")
	check(not MoodLogicScript.is_night(12), "12:00 is day")
	check(not MoodLogicScript.is_night(22), "22:00 is day")
	check(MoodLogicScript.visible_mood("happy", 2) == "sleepy", "night forces sleepy")
	check(MoodLogicScript.visible_mood("battle", 23) == "sleepy", "sleepy wins over any brain mood")
	check(MoodLogicScript.visible_mood("happy", 12) == "happy", "brain mood shows by day")
	check(MoodLogicScript.visible_mood("", 12) == "neutral", "missing brain mood is neutral")
	check(MoodLogicScript.visible_mood("banana", 12) == "neutral", "unknown brain mood is neutral")
	check(MoodLogicScript.sprite_mood("sleepy") == "sad", "sleepy renders the sad pose")
	check(MoodLogicScript.sprite_mood("excited") == "excited", "other moods map straight through")

func _sprite_tests() -> void:
	var json_text := FileAccess.get_file_as_string("res://data/preyas-sprite.json")
	check(json_text != "", "sprite JSON file is readable")
	var sd = SpriteDataScript.parse(json_text)
	check(sd != null, "sprite JSON parses")
	if sd == null:
		return
	check(sd.mood_order.size() == 9, "nine moods in the export")
	check(sd.palette.size() == 16, "16 palette entries")
	check(sd.palette[0].get("transparent") == true, "palette index 0 is transparent")
	for mood in sd.mood_order:
		var f0: Array = sd.frame(mood, 0)
		var f1: Array = sd.frame(mood, 1)
		check(f0.size() == 24, mood + " frame has 24 rows")
		check(f0 != f1, mood + " breathing frames differ")
	check(sd.frame("neutral", 0).size() == 24, "frame lookup works")
	check(SpriteDataScript.parse("not json") == null, "bad JSON rejected")
	check(SpriteDataScript.parse("{}") == null, "empty object rejected")
	check(SpriteDataScript.parse('{"size": 12}') == null, "wrong size rejected")
