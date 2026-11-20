class_name MoodLogic
extends RefCounted
## Pure mood mapping and the night check. No node dependencies.
## The nine canonical moods are shared with the mobile app and the brain.

const CANONICAL_MOODS := ["neutral", "happy", "excited", "angry", "sad", "surprised", "thinking", "listening", "battle"]
const SLEEPY := "sleepy"

## Night is 23:00 through 06:59 local time. During the night Preyas sleeps.
static func is_night(hour: int) -> bool:
	return hour >= 23 or hour < 7

## The visible mood for a brain-reported mood and a local hour.
## Night always wins; a missing, unreachable or unknown brain mood is neutral.
static func visible_mood(brain_mood: String, hour: int) -> String:
	if is_night(hour):
		return SLEEPY
	if brain_mood in CANONICAL_MOODS:
		return brain_mood
	return "neutral"

## The sprite pose to render. There is no separate "sleepy" art, so the sleepy
## pose reuses the sad pose (body sunk low) — no new art is drawn.
static func sprite_mood(visible: String) -> String:
	if visible == SLEEPY:
		return "sad"
	return visible
