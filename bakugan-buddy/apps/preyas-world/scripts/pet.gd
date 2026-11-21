extends Node2D
## Desktop Preyas (slice D1): a borderless, transparent, always-on-top strip
## along the bottom of the usable screen. Preyas walks, pauses, turns at the
## edges, sleeps at night and shows the brain's mood. A click opens the chat;
## right-click shows a small menu (Hide for 1 hour / Quit).

const WalkerScript := preload("res://scripts/walker.gd")
const MoodLogicScript := preload("res://scripts/mood.gd")
const SpriteDataScript := preload("res://scripts/sprite_data.gd")
const TextureBuilderScript := preload("res://scripts/texture_builder.gd")

const BRAIN_MOOD_URL := "http://127.0.0.1:8788/v1/mood"
const CHAT_URL := "http://localhost:8081"
const SCALE := 4.0
const SPRITE_SIZE := 96.0
const STRIP_HEIGHT := 180
const WALK_MARGIN := 4.0
const FRAME_SWAP_SEC := 0.5
const MOOD_POLL_SEC := 60.0
const HIDE_SECONDS := 3600.0
const FALL_SPEED := 360.0
const CLICK_SLOP := 4.0

var sprite_data
var textures := {}
var walker
var rng := RandomNumberGenerator.new()
var breathing := 0
var frame_accum := 0.0
var mood_accum := 0.0
var brain_mood := ""
var dragging := false
var falling := false
var grab_offset := Vector2.ZERO
var drag_moved := 0.0
var press_pos := Vector2.ZERO
var walk_y := 0.0
var hidden_until := 0.0
## PREYAS_DEBUG_SHOT: print geometry once and save the window's own pixels
## to user://debug-shot.png after six seconds (rendering verification aid).
var debug_time := 0.0
var debug_shot_taken := false

@onready var preyas: Sprite2D = $PreyasSprite
@onready var menu: PopupMenu = $Menu
var mood_request: HTTPRequest
var brain_token := ""
## The mood URL, defaulting to the brain; PREYAS_MOOD_URL overrides it
## (handy for testing against a mock without touching the real brain).
var mood_url := BRAIN_MOOD_URL

func _ready() -> void:
	rng.randomize()
	Engine.max_fps = 20
	OS.low_processor_usage_mode = true
	walker = WalkerScript.new()
	var override := OS.get_environment("PREYAS_MOOD_URL")
	if override != "":
		mood_url = override
	brain_token = _read_local_token()
	_setup_window()
	var json_text := FileAccess.get_file_as_string("res://data/preyas-sprite.json")
	sprite_data = SpriteDataScript.parse(json_text)
	if sprite_data == null:
		# Already pushed an error; the pet just sits idle instead of crashing.
		return
	textures = TextureBuilderScript.new().build(sprite_data)
	_setup_menu()
	_setup_mood_request()
	_refresh_texture()
	if OS.get_environment("PREYAS_DEBUG_SHOT") != "":
		var primary := DisplayServer.get_primary_screen()
		print("PreyasWorld debug: window size ", DisplayServer.window_get_size(), " pos ", DisplayServer.window_get_position(), " usable ", DisplayServer.screen_get_usable_rect(primary))
		print("PreyasWorld debug: sprite pos ", preyas.position, " walk_y ", walk_y, " walk max x ", _walk_max_x())

func _setup_window() -> void:
	var screen := DisplayServer.get_primary_screen()
	var usable := DisplayServer.screen_get_usable_rect(screen)
	var win_size := Vector2i(int(usable.size.x), STRIP_HEIGHT)
	var win_pos := Vector2i(int(usable.position.x), int(usable.position.y + usable.size.y) - STRIP_HEIGHT)
	# Project settings already request borderless/transparent/always-on-top;
	# set the flags here too so the window is right even if settings change.
	DisplayServer.window_set_flag(DisplayServer.WINDOW_FLAG_BORDERLESS, true)
	DisplayServer.window_set_flag(DisplayServer.WINDOW_FLAG_RESIZE_DISABLED, true)
	DisplayServer.window_set_flag(DisplayServer.WINDOW_FLAG_TRANSPARENT, true)
	DisplayServer.window_set_flag(DisplayServer.WINDOW_FLAG_ALWAYS_ON_TOP, true)
	DisplayServer.window_set_size(win_size)
	DisplayServer.window_set_position(win_pos)
	walk_y = float(win_size.y) - SPRITE_SIZE - WALK_MARGIN
	preyas.centered = false
	preyas.scale = Vector2(SCALE, SCALE)
	preyas.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	preyas.position = Vector2(WALK_MARGIN, walk_y)
	walker.x = WALK_MARGIN
	_update_passthrough()

func _walk_max_x() -> float:
	return float(DisplayServer.window_get_size().x) - SPRITE_SIZE - WALK_MARGIN

## Mouse passthrough: clicks go through the whole strip except the rectangle
## Preyas currently occupies. Updated every time he moves.
func _update_passthrough() -> void:
	var top_left := preyas.position
	var bottom_right := preyas.position + Vector2(SPRITE_SIZE, SPRITE_SIZE)
	var poly := PackedVector2Array([
		top_left,
		Vector2(bottom_right.x, top_left.y),
		bottom_right,
		Vector2(top_left.x, bottom_right.y),
	])
	DisplayServer.window_set_mouse_passthrough(poly)

func _process(delta: float) -> void:
	if sprite_data == null:
		return
	if not get_tree().root.visible:
		if hidden_until > 0.0 and Time.get_unix_time_from_system() >= hidden_until:
			hidden_until = 0.0
			get_tree().root.visible = true
			mood_accum = 0.0
		return
	var now := Time.get_datetime_dict_from_system()
	var hour: int = now.hour
	var night := MoodLogicScript.is_night(hour)
	walker.set_sleeping(night)
	if falling:
		var y := preyas.position.y + FALL_SPEED * delta
		if y >= walk_y:
			y = walk_y
			falling = false
		preyas.position.y = y
		walker.drag_to(preyas.position.x, SPRITE_SIZE, WALK_MARGIN, _walk_max_x())
	elif not dragging and not night:
		walker.advance(delta, SPRITE_SIZE, WALK_MARGIN, _walk_max_x(), rng)
		preyas.position.x = walker.x
	frame_accum += delta
	if frame_accum >= FRAME_SWAP_SEC:
		frame_accum = 0.0
		breathing = 1 - breathing
		_refresh_texture()
	mood_accum += delta
	if mood_accum >= MOOD_POLL_SEC:
		mood_accum = 0.0
		_poll_mood()
	if OS.get_environment("PREYAS_DEBUG_SHOT") != "" and not debug_shot_taken:
		debug_time += delta
		if debug_time >= 6.0:
			debug_shot_taken = true
			var shot: Image = get_viewport().get_texture().get_image()
			var shot_path := "user://debug-shot.png"
			shot.save_png(shot_path)
			print("PreyasWorld debug: viewport shot saved to ", ProjectSettings.globalize_path(shot_path))
	_update_passthrough()

func _refresh_texture() -> void:
	var now := Time.get_datetime_dict_from_system()
	var visible := MoodLogicScript.visible_mood(brain_mood, now.hour)
	var sprite_mood := MoodLogicScript.sprite_mood(visible)
	var tex = textures.get(sprite_mood + str(breathing))
	if tex != null:
		preyas.texture = tex

func _input(event: InputEvent) -> void:
	if sprite_data == null or menu.visible:
		return
	if event is InputEventMouseMotion:
		if dragging:
			var p: Vector2 = (event as InputEventMouseMotion).position - grab_offset
			p.x = clampf(p.x, WALK_MARGIN, _walk_max_x())
			p.y = clampf(p.y, WALK_MARGIN, walk_y)
			preyas.position = p
			walker.drag_to(p.x, SPRITE_SIZE, WALK_MARGIN, _walk_max_x())
			drag_moved += ((event as InputEventMouseMotion).position - press_pos).length()
			press_pos = (event as InputEventMouseMotion).position
			_update_passthrough()
			get_viewport().set_input_as_handled()
		return
	if event is InputEventMouseButton:
		var mb := event as InputEventMouseButton
		var inside := _sprite_rect().has_point(mb.position)
		if mb.button_index == MOUSE_BUTTON_LEFT:
			if mb.pressed:
				if inside:
					dragging = true
					falling = false
					grab_offset = mb.position - preyas.position
					press_pos = mb.position
					drag_moved = 0.0
					get_viewport().set_input_as_handled()
			else:
				if dragging:
					dragging = false
					if drag_moved >= CLICK_SLOP:
						_drop_pet()
					else:
						OS.shell_open(CHAT_URL)
					get_viewport().set_input_as_handled()
		elif mb.button_index == MOUSE_BUTTON_RIGHT and mb.pressed and inside:
			_show_menu(mb.position)
			get_viewport().set_input_as_handled()

func _sprite_rect() -> Rect2:
	return Rect2(preyas.position, Vector2(SPRITE_SIZE, SPRITE_SIZE))

func _drop_pet() -> void:
	# Falls back down to the walk line and keeps walking.
	falling = true
	walker.end_drag()
	var now := Time.get_datetime_dict_from_system()
	if MoodLogicScript.is_night(now.hour):
		walker.set_sleeping(true)

func _setup_menu() -> void:
	menu.add_item("Hide for 1 hour", 1)
	menu.add_separator()
	menu.add_item("Quit", 2)
	menu.id_pressed.connect(_on_menu_id)

func _on_menu_id(id: int) -> void:
	if id == 1:
		_hide_for_an_hour()
	elif id == 2:
		get_tree().quit()

func _show_menu(local_pos: Vector2) -> void:
	menu.position = Vector2i(get_window().position) + Vector2i(local_pos)
	menu.popup()

func _hide_for_an_hour() -> void:
	hidden_until = Time.get_unix_time_from_system() + HIDE_SECONDS
	DisplayServer.window_set_mouse_passthrough(PackedVector2Array())
	get_tree().root.visible = false

func _setup_mood_request() -> void:
	mood_request = HTTPRequest.new()
	mood_request.timeout = 2.0
	add_child(mood_request)
	mood_request.request_completed.connect(_on_mood_response)
	_poll_mood()

func _read_local_token() -> String:
	var token_file := OS.get_environment("PREYAS_TOKEN_FILE")
	if token_file == "":
		var data_root := OS.get_environment("BAKUGAN_DATA_DIR")
		if data_root == "":
			data_root = "/Volumes/Agent/BakuganBuddy"
		token_file = data_root.path_join("memory/local-token")
	if not FileAccess.file_exists(token_file):
		print("PreyasWorld: pair a device before enabling brain mood polling.")
		return ""
	var token := FileAccess.get_file_as_string(token_file).strip_edges()
	var token_pattern := RegEx.new()
	token_pattern.compile("^[A-Za-z0-9_-]{16,128}$")
	if token_pattern.search(token) == null:
		print("PreyasWorld: local pairing token is invalid; mood polling is disabled.")
		return ""
	return token

## GET only — the pet never writes anything to the brain.
func _poll_mood() -> void:
	if brain_token != "" and mood_request.get_http_client_status() == HTTPClient.STATUS_DISCONNECTED:
		mood_request.request(mood_url, ["X-Preyas-Token: " + brain_token], HTTPClient.METHOD_GET)

func _on_mood_response(result: int, response_code: int, headers: PackedStringArray, body: PackedByteArray) -> void:
	var mood := ""
	if result == HTTPRequest.RESULT_SUCCESS and response_code == 200:
		var json := JSON.new()
		if json.parse(body.get_string_from_utf8()) == OK and typeof(json.data) == TYPE_DICTIONARY:
			var candidate: String = str(json.data.get("mood", ""))
			if candidate in MoodLogicScript.CANONICAL_MOODS:
				mood = candidate
	brain_mood = mood
	print("PreyasWorld mood: ", mood if mood != "" else "neutral (brain off)")
	_refresh_texture()
