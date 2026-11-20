class_name Walker
extends RefCounted
## Pure walking logic: slow walking along a horizontal line, occasional pauses,
## turning around at the edges, dragging and night sleep.
## No node dependencies — only numbers and an rng object with randf().

const PHASE_WALKING := "walking"
const PHASE_PAUSED := "paused"
const PHASE_SLEEPING := "sleeping"

## Sprite left edge, in window points.
var x := 96.0
## +1 walks right, -1 walks left.
var direction := 1.0
var phase := PHASE_WALKING
## Walking speed in points per second.
var speed := 16.0
## Seconds left in the current pause, or time since the last pause roll.
var phase_timer := 0.0

## Advance by `dt` seconds. `width` is the sprite width in points; `min_x` and
## `max_x` bound the sprite's left edge. `rng` only needs a randf() method.
func advance(dt: float, width: float, min_x: float, max_x: float, rng) -> void:
	match phase:
		PHASE_SLEEPING:
			return
		PHASE_PAUSED:
			phase_timer -= dt
			if phase_timer <= 0.0:
				phase = PHASE_WALKING
			return
		PHASE_WALKING:
			phase_timer += dt
			if phase_timer >= 1.0:
				phase_timer = 0.0
				# About one pause per eight seconds of walking, 1.5-4 s each.
				if rng.randf() < 0.125:
					phase = PHASE_PAUSED
					phase_timer = 1.5 + rng.randf() * 2.5
					return
			x += direction * speed * dt
			_turn_at_edges(width, min_x, max_x)

## Drag the sprite so its left edge sits at `new_x`, clamped to the walkway.
func drag_to(new_x: float, width: float, min_x: float, max_x: float) -> void:
	x = clampf(new_x, min_x, maxf(min_x, max_x - width))
	phase_timer = 0.0

## Drop: go back to walking from the drop point.
func end_drag() -> void:
	phase = PHASE_WALKING
	phase_timer = 0.0

## Enter or leave night sleep. Waking resumes walking.
func set_sleeping(sleeping: bool) -> void:
	if sleeping:
		phase = PHASE_SLEEPING
		phase_timer = 0.0
	elif phase == PHASE_SLEEPING:
		phase = PHASE_WALKING

func _turn_at_edges(width: float, min_x: float, max_x: float) -> void:
	if max_x <= min_x:
		return
	if x + width > max_x:
		x = max_x - width
		direction = -1.0
	elif x < min_x:
		x = min_x
		direction = 1.0
