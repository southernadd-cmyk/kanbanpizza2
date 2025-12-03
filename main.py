import eventlet
eventlet.monkey_patch() # Must be first

from flask import Flask, render_template, request, send_file, jsonify
from flask_socketio import SocketIO, emit, join_room
import time
import uuid
import random
from flask_compress import Compress
from flask_sqlalchemy import SQLAlchemy
import os
import json
import redis
from sqlalchemy import text 
import requests

app = Flask(__name__)
Compress(app)

# 1. SETUP REDIS
redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379")
r = redis.from_url(redis_url, decode_responses=True)

app.config['SECRET_KEY'] = 'secret!'
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet', ping_timeout=60, ping_interval=25)

ROOM_TIMEOUT = 1800  # 30 minutes
PLAYER_TIMEOUT = 300  # 5 minutes
MAX_ROOMS = 10
MAX_PLAYERS = 5

shutdown_flag = False

# 2. DATABASE SETUP
db_password = os.environ.get("dbpass")
if db_password:
    app.config['SQLALCHEMY_DATABASE_URI'] = (
        f'postgresql://neondb_owner:{db_password}@ep-misty-unit-a2gfnnq1-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require'
    )
else:
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///high_scores.db'

app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {'pool_pre_ping': True}
db = SQLAlchemy(app)

class HighScore(db.Model):
    __tablename__ = 'high_scores'
    id = db.Column(db.Integer, primary_key=True)
    room_name = db.Column(db.String, nullable=False)
    round_number = db.Column(db.Integer, nullable=False)
    score = db.Column(db.Integer, nullable=False)
    ranking = db.Column(db.Integer, nullable=False)
    timestamp = db.Column(db.DateTime, default=db.func.now())
    __table_args__ = (db.UniqueConstraint('round_number', 'ranking', name='_round_ranking_uc'),)

with app.app_context():
    db.create_all()

# 3. REDIS HELPERS (Replaces group_games and player_group)
def get_game_state(room):
    if not room: return None
    raw = r.get(f"room:{room}")
    if raw:
        try:
            state = json.loads(raw)
            # Re-init thread placeholders (not stored in Redis)
            state["round_timer_thread"] = None
            state["debrief_timer_thread"] = None
            return state
        except:
            return None
    return None

def save_game_state(room, state):
    if not room or not state: return
    clean = state.copy()
    clean.pop("round_timer_thread", None)
    clean.pop("debrief_timer_thread", None)
    r.set(f"room:{room}", json.dumps(clean), ex=86400) # 24h expiry

def get_room_for_sid(sid):
    return r.get(f"sid:{sid}")

def set_room_for_sid(sid, room):
    r.set(f"sid:{sid}", room, ex=86400)

def remove_sid(sid):
    r.delete(f"sid:{sid}")

# 4. LOGIC HELPERS
def sanitize_game_state_for_emit(game_state):
    clean_copy = dict(game_state)
    clean_copy.pop("round_timer_thread", None)
    clean_copy.pop("debrief_timer_thread", None)
    clean_copy.pop("lead_times", None)
    clean_copy.pop("cfd_history", None)
    return clean_copy

def new_game_state(password=None):
    return {
        "players": {},
        "prepared_ingredients": [],
        "built_pizzas": [],
        "oven": [],
        "completed_pizzas": [],
        "wasted_pizzas": [],
        "round": 1,
        "max_rounds": 3,
        "current_phase": "waiting",
        "max_pizzas_in_oven": 3,
        "round_duration": 180,
        "oven_on": False,
        "oven_timer_start": None,
        "round_start_time": None,
        "debrief_duration": 120,
        "customer_orders": [],
        "pending_orders": [],
        "last_updated": time.time(),
        "lead_times": [],
        "password": password,
        "round_timer_thread": None,  
        "debrief_timer_thread": None,
        "cfd_history": []
    }

def record_cfd_snapshot(room):
    game_state = get_game_state(room)
    if not game_state: return
    elapsed = 0
    if game_state["round_start_time"]:
        elapsed = int(time.time() - game_state["round_start_time"])
    snapshot = {
        "time": elapsed,
        "built": len(game_state["built_pizzas"]),
        "oven": len(game_state["oven"]),
        "done": len(game_state["completed_pizzas"]),
        "wasted": len(game_state["wasted_pizzas"])
    }
    game_state["cfd_history"].append(snapshot)
    save_game_state(room, game_state)

def save_high_score(room, round_number, score):
    with app.app_context():
        current_scores = HighScore.query.filter_by(round_number=round_number).order_by(HighScore.ranking).all()
        scores_list = [(hs.room_name, hs.score, hs.ranking) for hs in current_scores]
        scores_list.append((room, score, 0))
        scores_list.sort(key=lambda x: x[1], reverse=True)
        top_three = scores_list[:3]
        HighScore.query.filter_by(round_number=round_number).delete()
        for rank, (room_name, score_val, _) in enumerate(top_three, 1):
            db.session.add(HighScore(room_name=room_name, round_number=round_number, score=score_val, ranking=rank))
        db.session.commit()

def get_high_scores():
    scores = HighScore.query.order_by(HighScore.round_number, HighScore.ranking).all()
    result = {1: {}, 2: {}, 3: {}}
    for score in scores:
        ts = score.timestamp.strftime("%Y-%m-%d %H:%M:%S") if score.timestamp else "N/A"
        result[score.round_number][score.ranking] = {"room_name": score.room_name, "score": score.score, "timestamp": ts}
    return result

def update_player_activity(sid):
    room = get_room_for_sid(sid)
    if room:
        game_state = get_game_state(room)
        if game_state and sid in game_state["players"]:
            game_state["players"][sid]["last_activity"] = time.time()
            save_game_state(room, game_state)

def update_room_list():
    keys = r.keys("room:*")
    room_list = {}
    for key in keys:
        room_name = key.split("room:")[1]
        state = get_game_state(room_name)
        if state: room_list[room_name] = len(state["players"])
    
    try: high_scores = get_high_scores()
    except: high_scores = {}
    socketio.emit('room_list', {"rooms": room_list, "high_scores": high_scores})

def check_inactive_rooms():
    while not shutdown_flag:
        current_time = time.time()
        keys = r.keys("room:*")
        for key in keys:
            room = key.split("room:")[1]
            game_state = get_game_state(room)
            if not game_state: continue
            
            changed = False
            players_to_remove = []
            for sid, player in list(game_state["players"].items()):
                if current_time - player.get("last_activity", game_state["last_updated"]) >= PLAYER_TIMEOUT:
                    players_to_remove.append(sid)
            
            for sid in players_to_remove:
                del game_state["players"][sid]
                remove_sid(sid)
                changed = True
            
            if current_time - game_state["last_updated"] >= ROOM_TIMEOUT or not game_state["players"]:
                r.delete(key)
                update_room_list()
                continue
            
            if changed: save_game_state(room, game_state)
        eventlet.sleep(60)

eventlet.spawn(check_inactive_rooms)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/download-db')
def download_db():
    if not db_password:
        return send_file("high_scores.db", as_attachment=True, download_name="high_scores.db")
    return "Not supported", 403

# 5. SOCKET HANDLERS
@socketio.on('connect')
def on_connect(data):
    update_room_list()

@socketio.on('join')
def on_join(data):
    room = data.get("room")
    password = data.get("password")
    if not room or not password:
        emit('join_error', {"message": "Required fields missing."}, room=request.sid)
        return

    # Check existence via Redis
    if not r.exists(f"room:{room}"):
        if len(r.keys("room:*")) >= MAX_ROOMS:
            emit('join_error', {"message": "Max rooms reached."}, room=request.sid)
            return
        game_state = new_game_state(password)
    else:
        game_state = get_game_state(room)
        if game_state["password"] != password:
            emit('join_error', {"message": "Incorrect password."}, room=request.sid)
            return

    if len(game_state["players"]) >= MAX_PLAYERS:
        emit('join_error', {"message": "Room full."}, room=request.sid)
        return

    set_room_for_sid(request.sid, room)
    
    if request.sid not in game_state["players"]:
        game_state["players"][request.sid] = {"builder_ingredients": [], "last_activity": time.time()}
    else:
        game_state["players"][request.sid]["last_activity"] = time.time()

    game_state["last_updated"] = time.time()
    save_game_state(room, game_state)
    
    join_room(room)
    socketio.emit('game_state', sanitize_game_state_for_emit(game_state), room=room)
    update_room_list()

@socketio.on('disconnect')
def on_disconnect():
    sid = request.sid
    room = get_room_for_sid(sid)
    if room:
        game_state = get_game_state(room)
        if game_state and sid in game_state["players"]:
            del game_state["players"][sid]
            game_state["last_updated"] = time.time()
            save_game_state(room, game_state)
            socketio.emit('game_state', sanitize_game_state_for_emit(game_state), room=room)
            if len(game_state["players"]) == 0:
                r.delete(f"room:{room}")
        remove_sid(sid)
        update_room_list()

@socketio.on('time_request')
def on_time_request():
    sid = request.sid
    room = get_room_for_sid(sid)
    if not room: return
    game_state = get_game_state(room)
    if not game_state: return

    update_player_activity(sid)
    current_time = time.time()
    
    # Fail-safe check for timer expiry
    if game_state["current_phase"] == "round" and game_state["round_start_time"]:
        elapsed = current_time - game_state["round_start_time"]
        if elapsed >= game_state["round_duration"]:
            end_round(room)
            return
        
        # Round 3 Orders
        if game_state["round"] == 3 and game_state["pending_orders"]:
            orders = [o for o in game_state["pending_orders"] if o["arrival_time"] <= elapsed][:10]
            if orders:
                game_state["customer_orders"].extend(orders)
                for o in orders:
                    game_state["pending_orders"].remove(o)
                    socketio.emit('new_order', o, room=room)
                game_state["last_updated"] = current_time
                save_game_state(room, game_state)
                socketio.emit('game_state_update', {"customer_orders": game_state["customer_orders"]}, room=room)

    elif game_state["current_phase"] == "debrief" and game_state.get("debrief_start_time"):
        if (current_time - game_state["debrief_start_time"]) >= game_state["debrief_duration"]:
            reset_round(room)
            return

    # Helper calculations for response (not critical for logic but good for sync)
    rt = 0
    if game_state["current_phase"] == "round" and game_state["round_start_time"]:
        rt = max(0, int(game_state["round_duration"] - (current_time - game_state["round_start_time"])))
    elif game_state["current_phase"] == "debrief":
        rt = max(0, int(game_state["debrief_duration"] - (current_time - game_state.get("debrief_start_time", 0))))
    
    ot = 0
    if game_state["oven_on"]:
        ot = int(current_time - game_state["oven_timer_start"])

    socketio.emit('time_response', {"roundTimeRemaining": rt, "ovenTime": ot, "phase": game_state["current_phase"]}, room=room)

@socketio.on('prepare_ingredient')
def on_prepare_ingredient(data):
    room = get_room_for_sid(request.sid)
    if not room: return
    game_state = get_game_state(room)
    if not game_state or game_state["current_phase"] != "round": return

    item = {"id": str(uuid.uuid4())[:8], "type": data.get("ingredient_type"), "prepared_by": request.sid, "prepared_at": time.time()}
    game_state["prepared_ingredients"].append(item)
    game_state["last_updated"] = time.time()
    save_game_state(room, game_state)
    socketio.emit('ingredient_prepared', item, room=room)
    socketio.emit('game_state', sanitize_game_state_for_emit(game_state), room=room)

@socketio.on('take_ingredient')
def on_take_ingredient(data):
    room = get_room_for_sid(request.sid)
    if not room: return
    game_state = get_game_state(room)
    if not game_state or game_state["current_phase"] != "round": return

    ing_id = data.get("ingredient_id")
    taken = next((x for x in game_state["prepared_ingredients"] if x["id"] == ing_id), None)
    
    if taken:
        game_state["prepared_ingredients"].remove(taken)
        target = data.get("target_sid") if (game_state["round"] > 1 and data.get("target_sid")) else request.sid
        if target in game_state["players"]:
            game_state["players"][target]["builder_ingredients"].append(taken)
            save_game_state(room, game_state)
            socketio.emit('ingredient_removed', {"ingredient_id": ing_id}, room=room)
            socketio.emit('game_state', sanitize_game_state_for_emit(game_state), room=room)

@socketio.on('build_pizza')
def on_build_pizza(data):
    room = get_room_for_sid(request.sid)
    if not room: return
    game_state = get_game_state(room)
    if not game_state or game_state["current_phase"] != "round": return

    target = request.sid if game_state["round"] == 1 else data.get("player_sid", request.sid)
    if target not in game_state["players"]: return
    
    ingredients = game_state["players"][target]["builder_ingredients"]
    if not ingredients: return

    counts = {"base": 0, "sauce": 0, "ham": 0, "pineapple": 0}
    for i in ingredients: 
        if i["type"] in counts: counts[i["type"]] += 1

    pid = str(uuid.uuid4())[:8]
    start_t = min(i["prepared_at"] for i in ingredients)
    pizza = {"pizza_id": pid, "team": room, "built_at": time.time(), "baking_time": 0, "ingredients": counts, "build_start_time": start_t}

    # Validation
    valid = True
    if game_state["round"] < 3:
        valid = counts["base"] == 1 and counts["sauce"] == 1 and ((counts["ham"] == 4 and counts["pineapple"] == 0) or (counts["ham"] == 2 and counts["pineapple"] == 2))
        if not valid:
            pizza["status"] = "invalid"
            pizza["emoji"] = '<div class="emoji-wrapper"><span class="emoji">🍕</span><span class="emoji">🚫</span></div>'
            game_state["wasted_pizzas"].append(pizza)
            game_state["lead_times"].append({"pizza_id": pid, "lead_time": time.time() - start_t, "start_time": start_t, "status": "incomplete"})
            socketio.emit('build_error', {"message": "Invalid Combo!"}, room=request.sid)
        else:
            pizza["type"] = "bacon" if counts["ham"] == 4 else "pineapple"
            pizza["emoji"] = '<div class="emoji-wrapper"><span class="emoji">🍕</span><span class="emoji">🥓</span></div>' if pizza["type"] == "bacon" else '<div class="emoji-wrapper"><span class="emoji">🍕</span><span class="emoji">🍍</span></div>'
            game_state["built_pizzas"].append(pizza)
            socketio.emit('pizza_built', pizza, room=room)
    else:
        order = next((o for o in game_state["customer_orders"] if o["ingredients"]["base"] == counts["base"] and o["ingredients"]["sauce"] == counts["sauce"] and o["ingredients"]["ham"] == counts["ham"] and o["ingredients"]["pineapple"] == counts["pineapple"]), None)
        if order:
            pizza["type"] = order["type"]
            pizza["order_id"] = order["id"]
            pizza["emoji"] = '<div class="emoji-wrapper"><span class="emoji">🍕</span><span class="emoji">✅</span></div>'
            game_state["customer_orders"].remove(order)
            game_state["built_pizzas"].append(pizza)
            socketio.emit('order_fulfilled', {"order_id": order["id"]}, room=room)
            socketio.emit('pizza_built', pizza, room=room)
        else:
            pizza["status"] = "unmatched"
            pizza["emoji"] = '<div class="emoji-wrapper"><span class="emoji">🍕</span><span class="emoji">❓</span></div>'
            game_state["wasted_pizzas"].append(pizza)
            socketio.emit('build_error', {"message": "No matching order!"}, room=request.sid)

    game_state["players"][target]["builder_ingredients"] = []
    if game_state["round"] > 1: socketio.emit('clear_shared_builder', {"player_sid": target}, room=room)
    save_game_state(room, game_state)
    socketio.emit('game_state', sanitize_game_state_for_emit(game_state), room=room)

@socketio.on('move_to_oven')
def on_move_to_oven(data):
    room = get_room_for_sid(request.sid)
    if not room: return
    game_state = get_game_state(room)
    if not game_state: return

    if game_state["oven_on"]:
        emit('oven_error', {"message": "Oven is ON!"}, room=request.sid)
        return

    pid = data.get("pizza_id")
    pizza = next((p for p in game_state["built_pizzas"] if p["pizza_id"] == pid), None)
    
    if not pizza or len(game_state["oven"]) >= game_state["max_pizzas_in_oven"]:
        emit('oven_error', {"message": "Oven full/Error."}, room=request.sid)
        return

    game_state["built_pizzas"].remove(pizza)
    pizza["oven_start"] = time.time()
    game_state["oven"].append(pizza)
    save_game_state(room, game_state)
    socketio.emit('pizza_moved_to_oven', pizza, room=room)
    socketio.emit('game_state', sanitize_game_state_for_emit(game_state), room=room)

@socketio.on('toggle_oven')
def toggle_oven(data):
    room = get_room_for_sid(request.sid)
    if not room: return
    game_state = get_game_state(room)
    if not game_state: return

    state = data.get("state")
    now = time.time()

    if state == "on" and not game_state["oven_on"]:
        game_state["oven_on"] = True
        game_state["oven_timer_start"] = now
        save_game_state(room, game_state)
        socketio.emit('oven_toggled', {"state": "on"}, room=room)
    elif state == "off" and game_state["oven_on"]:
        elapsed = now - game_state["oven_timer_start"]
        for p in game_state["oven"]:
            p["baking_time"] += elapsed
            p["completed_at"] = now
            lt = now - p["build_start_time"]
            status = "incomplete"
            
            if p["baking_time"] < 30:
                p["status"] = "undercooked"
                game_state["wasted_pizzas"].append(p)
            elif 30 <= p["baking_time"] <= 45:
                p["status"] = "cooked"
                status = "completed"
                game_state["completed_pizzas"].append(p)
            else:
                p["status"] = "burnt"
                game_state["wasted_pizzas"].append(p)
            
            game_state["lead_times"].append({"pizza_id": p["pizza_id"], "lead_time": lt, "status": status, "start_time": p["build_start_time"]})
        
        game_state["oven"] = []
        game_state["oven_on"] = False
        save_game_state(room, game_state)
        socketio.emit('oven_toggled', {"state": "off"}, room=room)
    socketio.emit('game_state', sanitize_game_state_for_emit(game_state), room=room)

@socketio.on('start_round')
def on_start_round(data):
    room = get_room_for_sid(request.sid)
    if not room: return
    game_state = get_game_state(room)
    if not game_state or game_state["current_phase"] != "waiting": return

    game_state["current_phase"] = "round"
    game_state["round_start_time"] = time.time()
    game_state["prepared_ingredients"] = []
    game_state["built_pizzas"] = []
    game_state["oven"] = []
    game_state["completed_pizzas"] = []
    game_state["wasted_pizzas"] = []
    game_state["oven_on"] = False
    game_state["customer_orders"] = []
    game_state["pending_orders"] = []
    
    for sid in game_state["players"]: game_state["players"][sid]["builder_ingredients"] = []
    if game_state["round"] == 3: game_state["pending_orders"] = generate_customer_orders(game_state["round_duration"])

    save_game_state(room, game_state)
    socketio.emit('game_state', sanitize_game_state_for_emit(game_state), room=room)
    socketio.emit('round_started', {"round": game_state["round"], "duration": game_state["round_duration"], "customer_orders": game_state["customer_orders"]}, room=room)
    
    eventlet.spawn(round_timer, game_state["round_duration"], room)

def round_timer(duration, room):
    # Optional background task for CFD snapshots
    steps = int(duration / 5)
    for _ in range(steps):
        if shutdown_flag: return
        eventlet.sleep(5)
        record_cfd_snapshot(room)
    remainder = duration % 5
    if remainder > 0: eventlet.sleep(remainder)
    end_round(room)

def end_round(room):
    game_state = get_game_state(room)
    if not game_state or game_state["current_phase"] != "round": return

    now = time.time()
    if game_state["oven_on"]:
        elapsed = now - game_state["oven_timer_start"]
        for p in game_state["oven"]:
            p["baking_time"] += elapsed
            p["completed_at"] = now
            p["status"] = "undercooked"
            game_state["wasted_pizzas"].append(p)
            game_state["lead_times"].append({"pizza_id": p["pizza_id"], "lead_time": now - p["build_start_time"], "status": "incomplete", "start_time": p["build_start_time"]})
        game_state["oven"] = []
        game_state["oven_on"] = False
        socketio.emit('oven_toggled', {"state": "off"}, room=room)

    completed = len(game_state["completed_pizzas"])
    wasted = len(game_state["wasted_pizzas"])
    unsold = len(game_state["built_pizzas"])
    leftover = len(game_state["prepared_ingredients"])
    
    score = 0
    if game_state["round"] < 3:
        score = (completed * 10) - (wasted * 10) - (unsold * 5) - leftover
    else:
        fulfilled = sum(1 for p in game_state["completed_pizzas"] if "order_id" in p)
        unmatched = sum(1 for p in game_state["completed_pizzas"] if "order_id" not in p)
        remaining = len(game_state["customer_orders"])
        score = (fulfilled * 20) - (unmatched * 10) - (wasted * 10) - (unsold * 5) - leftover - (remaining * 15)

    result = {
        "completed_pizzas_count": completed, "wasted_pizzas_count": wasted, "unsold_pizzas_count": unsold,
        "ingredients_left_count": leftover, "score": score, "lead_times": game_state["lead_times"], "cfd_data": game_state["cfd_history"]
    }
    if game_state["round"] == 3:
        result["fulfilled_orders_count"] = fulfilled if 'fulfilled' in locals() else 0
        result["remaining_orders_count"] = remaining if 'remaining' in locals() else 0
        result["unmatched_pizzas_count"] = unmatched if 'unmatched' in locals() else 0

    game_state["current_phase"] = "debrief"
    game_state["debrief_start_time"] = now
    game_state["cfd_history"] = []
    
    save_game_state(room, game_state)
    save_high_score(room, game_state["round"], score)
    
    socketio.emit('game_state', sanitize_game_state_for_emit(game_state), room=room)
    socketio.emit('round_ended', result, room=room)
    
    eventlet.spawn(debrief_timer, game_state["debrief_duration"], room)

def generate_customer_orders(round_duration):
    order_types = [
        {"type": "ham", "ingredients": {"base": 1, "sauce": 1, "ham": 4, "pineapple": 0}},
        {"type": "pineapple", "ingredients": {"base": 1, "sauce": 1, "ham": 0, "pineapple": 4}},
        {"type": "ham & pineapple", "ingredients": {"base": 1, "sauce": 1, "ham": 2, "pineapple": 2}},
        {"type": "light ham", "ingredients": {"base": 1, "sauce": 1, "ham": 1, "pineapple": 0}},
        {"type": "light pineapple", "ingredients": {"base": 1, "sauce": 1, "ham": 0, "pineapple": 1}},
        {"type": "plain", "ingredients": {"base": 1, "sauce": 1, "ham": 0, "pineapple": 0}},
        {"type": "heavy ham", "ingredients": {"base": 1, "sauce": 1, "ham": 6, "pineapple": 0}},
        {"type": "heavy pineapple", "ingredients": {"base": 1, "sauce": 1, "ham": 0, "pineapple": 6}}
    ]
    orders = []
    max_time = round_duration - 45
    for i in range(15):
        order = {"id": str(uuid.uuid4())[:8], **random.choice(order_types)}
        order["arrival_time"] = (i * (max_time / 14))
        orders.append(order)
    return orders

# ... inside main.py ...

@app.route('/health')
def health_check():
    """
    1. Tells Render the app is running.
    2. Pings Redis to keep the connection pool active.
    3. Pings DB to keep the connection active.
    """
    status = {
        "app": "running",
        "redis": "unknown",
        "db": "unknown"
    }
    http_code = 200

    # 1. Check Redis Connection
    try:
        if r.ping():
            status["redis"] = "connected"
    except Exception as e:
        status["redis"] = f"error: {str(e)}"
        http_code = 500

    # 2. Check Database Connection (Optional but recommended)
    try:
        db.session.execute(db.text("SELECT 1"))
        status["db"] = "connected"
    except Exception as e:
        status["db"] = f"error: {str(e)}"
        # We don't change http_code to 500 here to avoid failing deployment
        # if DB is just momentarily slow, but you can if strictness is needed.

    return status, http_code

API_KEY = "m801914576-7ef2800a65d3fd982d1cc109"   # Use a read-only key

@app.route("/uptime")
def uptime_status():
    url = "https://api.uptimerobot.com/v2/getMonitors"

    payload = {
        "api_key": API_KEY,
        "format": "json",
        "logs": 1
    }

    headers = {
        "Content-Type": "application/json"
    }

    r = requests.post(url, json=payload, headers=headers)
    data = r.json()

    return jsonify(data)

if __name__ == '__main__':
    socketio.run(app)





