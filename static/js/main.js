/**
 * PIZZA GAME CLIENT - FINAL CORRECTED VERSION
 * Features: Howler Audio, SortableJS, Restored Timer Heartbeat.
 * SAVE AS: /static/js/main.js
 */
(function() {
    'use strict';

    /* =========================================
       1. CONFIGURATION & CONSTANTS
       ========================================= */
    const CONFIG = {
        api: {
            profanity: 'https://www.purgomalum.com/service/containsprofanity?text=',
            qr: 'https://api.qrserver.com/v1/create-qr-code/?size=100x100&margin=0&data='
        },
        emojis: {
            ingredients: { "base": "🟡", "sauce": "🔴", "ham": "🥓", "pineapple": "🍍" },
            orders: {
                "ham": '<div class="emoji-wrapper"><span class="emoji">🍕</span><span class="emoji">🥓</span></div>',
                "pineapple": '<div class="emoji-wrapper"><span class="emoji">🍕</span><span class="emoji">🍍</span></div>',
                "ham & pineapple": '<div class="emoji-wrapper"><span class="emoji">🍕</span><span class="emoji">🥓</span><span class="emoji">🍍</span></div>',
                "light ham": '<div class="emoji-wrapper"><span class="emoji">🍕</span><span class="emoji">🥓</span></div>',
                "light pineapple": '<div class="emoji-wrapper"><span class="emoji">🍕</span><span class="emoji">🍍</span></div>',
                "plain": '<div class="emoji-wrapper"><span class="emoji">🍕</span></div>',
                "heavy ham": '<div class="emoji-wrapper"><span class="emoji">🍕</span><span class="emoji">🥓</span></div>',
                "heavy pineapple": '<div class="emoji-wrapper"><span class="emoji">🍕</span><span class="emoji">🍍</span></div>'
            }
        },
        debrief: {
            1: { question: "Reflect on the round: How did you identify and streamline your pizza-making process? Did the oven’s WIP limit of 3 pizzas affect your strategy?", quote: "“Working software is the primary measure of progress.”" },
            2: { question: "Reflect on the round: How did collaboration with your team impact your pizza production?", quote: "“Individuals and interactions over processes and tools.”" },
            3: { question: "Reflect on the round: How did customer orders change your priorities?", quote: "“Customer collaboration over contract negotiation.”" }
        }
    };

    /* =========================================
       2. AUDIO MANAGER (Howler.js)
       ========================================= */
    const Audio = {
        sounds: {},
        init() {
            // Only try to load sounds if Howler is loaded
            if (typeof Howl === 'undefined') return;

            const soundFiles = {
                ding: '/static/sounds/ding.mp3',
                trash: '/static/sounds/trash.mp3',
                pop: '/static/sounds/pop.mp3',
                cash: '/static/sounds/cash.mp3',
                alarm: '/static/sounds/alarm.mp3',
                order: '/static/sounds/alarm.mp3',
                oven_hum: '/static/sounds/oven.mp3'
            };

            for (const [key, path] of Object.entries(soundFiles)) {
                this.sounds[key] = new Howl({
                    src: [path],
                    volume: 0.5,
                    onloaderror: () => { /* Suppress 404 errors in console if files missing */ }
                });
            }
        },
        play(key) {
            if (this.sounds[key] && this.sounds[key].state() === 'loaded') {
                this.sounds[key].play();
            }
        },

        manageOvenSound(shouldPlay) {
            const sound = this.sounds['oven_hum'];
            if (!sound || sound.state() !== 'loaded') return;

            if (shouldPlay) {
                // Only start if not already playing to prevent echo/layering
                if (!sound.playing()) {
                    sound.fade(0, 0.3, 1000); // Smooth fade in
                    sound.play();
                }
            } else {
                if (sound.playing()) {
                    sound.fade(0.3, 0, 500); // Smooth fade out
                    setTimeout(() => sound.stop(), 500);
                }
            }
    }
        
    };

    /* =========================================
       3. STATE MANAGEMENT
       ========================================= */
    const State = {
        socket: io({ transports: ['websocket', 'polling'], reconnection: true }),
        myRoom: localStorage.getItem('myRoom') || "",
        isInitialConnect: true,
        pendingQrRoom: null,
        builderIngredients: [],
        dashboardInterval: null,
        lastCFDData: null,
        lastLeadTimeData: null,
        gameData: {},

        // Heartbeat interval for syncing time/logic
        heartbeat: null
    };

    /* =========================================
       4. UTILITIES
       ========================================= */
    const Utils = {
        async checkProfanity(text) {
            try {
                const response = await fetch(`${CONFIG.api.profanity}${encodeURIComponent(text)}`);
                const result = await response.text();
                return result === 'true';
            } catch (error) { return false; }
        },
        vibrate() { if (navigator.vibrate) navigator.vibrate(50); }
    };

    /* =========================================
       5. CHARTS MANAGER
       ========================================= */
    const Charts = {
        instances: { cfd: null, leadTime: null },
        renderLeadTime(rawLeadTimes) {
            const ctx = document.getElementById('leadTimeChart').getContext('2d');
            if (this.instances.leadTime) this.instances.leadTime.destroy();
            rawLeadTimes.sort((a, b) => a.start_time - b.start_time);
            const labels = rawLeadTimes.map((lt, index) => `Pizza ${index + 1}`);
            this.instances.leadTime = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [
                        { label: 'Completed', data: rawLeadTimes.map(lt => lt.status === "completed" ? lt.lead_time : null), borderColor: '#28a745', fill: false, spanGaps: true },
                        { label: 'Incomplete', data: rawLeadTimes.map(lt => lt.status === "incomplete" ? lt.lead_time : null), borderColor: '#dc3545', fill: false, spanGaps: true }
                    ]
                },
                options: { maintainAspectRatio: false, responsive: true, scales: { y: { beginAtZero: true } } }
            });
        },
        renderCFD(historyData) {
            const ctx = document.getElementById('cfdChart').getContext('2d');
            if (this.instances.cfd) this.instances.cfd.destroy();
            this.instances.cfd = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: historyData.map(d => d.time + "s"),
                    datasets: [
                        { label: 'Done', data: historyData.map(d => d.done), borderColor: '#28a745', backgroundColor: 'rgba(40, 167, 69, 0.5)', fill: true },
                        { label: 'In Oven', data: historyData.map(d => d.oven), borderColor: '#dc3545', backgroundColor: 'rgba(220, 53, 69, 0.5)', fill: true },
                        { label: 'Built', data: historyData.map(d => d.built), borderColor: '#ffc107', backgroundColor: 'rgba(255, 193, 7, 0.5)', fill: true }
                    ]
                },
                options: { maintainAspectRatio: false, responsive: true, scales: { y: { stacked: true, beginAtZero: true } } }
            });
        }
    };

    /* =========================================
       6. UI RENDERER
       ========================================= */
    const UI = {
        updateMessage(text) {
            const el = document.querySelector("#messages .content");
            if (el) el.innerText = text;
        },

        updateRoomLabels(room, playerCount) {
            const rLabel = document.getElementById("room-name-label");
            const pLabel = document.getElementById("player-count-label");
            if (rLabel) rLabel.innerText = `${room}`;
            if (pLabel) pLabel.innerText = `${playerCount}`;
        },

        createPizzaElement(pizza, extraLabel) {
            const container = document.createElement("div");
            container.className = "d-flex align-items-center mb-2 p-2 border rounded bg-white";
            if (pizza.status) container.classList.add(pizza.status);

            const visual = document.createElement("div");
            visual.className = "pizza-visual";
            if (pizza.ingredients && pizza.ingredients.sauce > 0) visual.classList.add("has-sauce");

            if (pizza.ingredients) {
                let toppingCount = 0;
                const addTopping = (icon) => {
                    const span = document.createElement("span");
                    span.className = `topping-icon pos-${(toppingCount % 5) + 1}`;
                    span.innerText = icon;
                    if (icon === "🥓") span.style.transform = `rotate(${Math.random() * 360}deg)`;
                    visual.appendChild(span);
                    toppingCount++;
                };
                for (let i = 0; i < (pizza.ingredients.ham || 0); i++) addTopping("🥓");
                for (let i = 0; i < (pizza.ingredients.pineapple || 0); i++) addTopping("🍍");
            }
            container.appendChild(visual);
            return container;
        },

        updateBuilderDisplay() {
            const builderDiv = document.getElementById("pizza-builder");
            if (!builderDiv) return;
            builderDiv.innerHTML = "";
            State.builderIngredients.forEach(ing => {
                const item = document.createElement("div");
                item.classList.add("ingredient");
                item.innerText = CONFIG.emojis.ingredients[ing.type] || ing.type;
                builderDiv.appendChild(item);
            });
            this.initSortable(builderDiv, 'self');
        },

        initSortable(el, type, sid = null) {
            if (typeof Sortable === 'undefined') return;

            // COMMON CONFIG FOR SMOOTH MOBILE FEEL
            const mobileConfig = {
                animation: 200,
                forceFallback: true,        // Disables native DnD (Crucial for mobile)
                fallbackClass: "sortable-fallback", // Uses CSS class for dragged item
                fallbackOnBody: true,       // Ensures item isn't clipped by overflow
                delay: 100,                 // Prevents accidental drag when scrolling
                delayOnTouchOnly: true,
                onStart: () => Utils.vibrate()
            };

            // Source: Ingredient Pool
            if(el.id === 'prepared-pool') {
                new Sortable(el, {
                    ...mobileConfig,
                    group: { name: 'shared', pull: true, put: false },
                    sort: false
                });
                return;
            }

            // Target: Builders
            new Sortable(el, {
                ...mobileConfig,
                group: 'shared',
                onAdd: (evt) => {
                    const item = evt.item;
                    const ingId = item.dataset.id;
                    const ingType = item.dataset.type;
                    
                    item.remove(); // Remove immediately from DOM, let Socket update UI

                    if (type === 'self') {
                        Game.handleDropToBuilder(ingId, ingType);
                    } else if (type === 'shared') {
                        Game.handleDropToShared(ingId, sid);
                    }
                }
            });
        },

        renderSharedBuilders(players) {
            const container = document.getElementById("pizza-builders-container");
            container.innerHTML = "";
            Object.keys(players).forEach((sid, index) => {
                const colDiv = document.createElement("div");
                colDiv.classList.add("col-md-6");
                colDiv.innerHTML = `
                    <div class="pizza-builder-container">
                        <h5>Builder #${index + 1}</h5>
                        <div class="d-flex flex-wrap pizza-builder-dropzone" id="shared-builder-${sid}">
                             ${players[sid].builder_ingredients.map(ing =>
                                `<div class="ingredient" data-id="${ing.id}" data-type="${ing.type}">${CONFIG.emojis.ingredients[ing.type] || ing.type}</div>`
                             ).join('')}
                        </div>
                        <button class="btn btn-primary btn-custom mt-2" onclick="triggerBuild('${sid}')">Submit Pizza</button>
                    </div>`;
                container.appendChild(colDiv);

                this.initSortable(colDiv.querySelector('.pizza-builder-dropzone'), 'shared', sid);
            });
        },

        updateVisibility() {
            const pizzaBuilder = document.getElementById("pizza-builder");
            const submitPizza = document.getElementById("submit-pizza");
            const buildersContainer = document.getElementById("pizza-builders-container");
            const builderHeading = document.getElementById("builder-heading");
            const gameState = State.gameData;

            const isDebrief = gameState.current_phase === "debrief";
            const isMultiRound = gameState.round > 1;

            if ((gameState.round >= 1 && isDebrief && gameState.round < gameState.max_rounds) || isMultiRound) {
                pizzaBuilder.style.display = "none";
                submitPizza.style.display = "none";
                buildersContainer.style.display = "flex";
                builderHeading.innerText = "Shared Pizza Builders";
                if (gameState.current_phase === "round" || isDebrief) {
                    this.renderSharedBuilders(gameState.players);
                }
            } else {
                pizzaBuilder.style.display = "flex";
                submitPizza.style.display = "inline-block";
                buildersContainer.style.display = "none";
                builderHeading.innerText = "Your Pizza Builder";
                this.initSortable(pizzaBuilder, 'self');
            }
        },

        refreshGameState(newState) {
            State.gameData = newState;
            this.updateRoomLabels(State.myRoom || "Unknown", Object.keys(newState.players).length);
            this.updateVisibility();

            // 1. Phases
            const gameArea = document.getElementById("game-area");
            const startBtn = document.getElementById("start-round");

            if (newState.current_phase === "round") {
                gameArea.style.display = "block";
                startBtn.style.display = "none";
            } else if (newState.current_phase === "debrief") {
                gameArea.style.display = "none";
                startBtn.style.display = "inline-block";
            } else {
                gameArea.style.display = "none";
                startBtn.style.display = "inline-block";
            }

            if (newState.oven_on) {
                if (newState.oven_timer_start) Game.startOvenTimer(newState.oven_timer_start);
                // START SOUND
                Audio.manageOvenSound(true); 
            } else {
                Game.stopOvenTimer();
                // STOP SOUND
                Audio.manageOvenSound(false);
            }

            // 2. Orders (Round 3)
            const ordersDiv = document.getElementById("customer-orders");
            if (newState.round === 3 && newState.current_phase === "round") {
                ordersDiv.style.display = "block";
                const ordersList = document.getElementById("orders-list");
                ordersList.innerHTML = "";
                newState.customer_orders.forEach(order => {
                    const card = document.createElement("div");
                    card.className = "order-card";
                    card.dataset.orderId = order.id;
                    let ingredientsText = [];
                    ['base', 'sauce', 'ham', 'pineapple'].forEach(type => {
                        if (order.ingredients[type] > 0) ingredientsText.push(`${CONFIG.emojis.ingredients[type]}x${order.ingredients[type]}`);
                    });
                    card.innerHTML = `<div class="order-id">Order: ${order.id.slice(0, 6)}</div>
                        <div class="order-ingredients">${ingredientsText.join(" ")}</div>
                        <div class="order-emoji">${CONFIG.emojis.orders[order.type] || '🍕'}</div>`;
                    ordersList.appendChild(card);
                });
                document.getElementById("order-count").innerText = newState.customer_orders.length;
            } else {
                ordersDiv.style.display = "none";
                document.getElementById("order-count").innerText = "0";
            }

            // 3. Ingredient Pool (With Sortable)
            const poolDiv = document.getElementById("prepared-pool");
            poolDiv.innerHTML = "";
            newState.prepared_ingredients.forEach(item => {
                const div = document.createElement("div");
                div.className = "ingredient";
                div.dataset.id = item.id;
                div.dataset.type = item.type;
                div.innerText = CONFIG.emojis.ingredients[item.type] || item.type;
                poolDiv.appendChild(div);
            });
            this.initSortable(poolDiv, 'pool');

            // 4. Built Pizzas
            const builtDiv = document.getElementById("built-pizzas");
            builtDiv.innerHTML = "";
            const isOvenFull = newState.oven.length >= newState.max_pizzas_in_oven;
            const isOvenOn = newState.oven_on === true;
            newState.built_pizzas.forEach(pizza => {
                const div = this.createPizzaElement(pizza, "");
                const btn = document.createElement("button");
                if (isOvenFull || isOvenOn) {
                    btn.className = "btn btn-sm btn-secondary ms-2 disabled";
                    btn.innerText = isOvenOn ? "Oven is ON" : "Oven Full";
                    btn.disabled = true;
                    div.style.opacity = "0.7";
                } else {
                    btn.className = "btn btn-sm btn-outline-primary ms-2";
                    btn.innerText = "Move to Oven";
                    btn.onclick = () => State.socket.emit('move_to_oven', { pizza_id: pizza.pizza_id });
                }
                div.appendChild(btn);
                builtDiv.appendChild(div);
            });

            // 5. Lists
            const updateList = (elementId, list, extra) => {
                const el = document.getElementById(elementId);
                el.innerHTML = "";
                list.forEach(pizza => el.appendChild(this.createPizzaElement(pizza, extra)));
            };
            updateList("oven", newState.oven, " ");
            updateList("completed", newState.completed_pizzas, " ");
            updateList("wasted", newState.wasted_pizzas, "");
        }
    };

    /* =========================================
       7. GAME ACTIONS
       ========================================= */
    const Game = {
        joinRoom(room, password) {
            State.myRoom = room;
            localStorage.setItem('myRoom', room);
            localStorage.setItem('myRoomPassword', password);
            State.socket.emit('join', { room: room, password: password });
        },

        handleDropToBuilder(ingredient_id, ingredient_type) {
            Audio.play('pop');
            State.socket.emit('take_ingredient', { ingredient_id: ingredient_id });
            if (State.gameData.round === 1) {
                State.builderIngredients.push({ id: ingredient_id, type: ingredient_type });
                UI.updateBuilderDisplay();
            }
        },

        handleDropToShared(ingredient_id, sid) {
            Audio.play('pop');
            State.socket.emit('take_ingredient', { ingredient_id: ingredient_id, target_sid: sid });
        },

        submitPizza() {
            if (State.gameData.round === 1 && State.builderIngredients.length === 0) {
                alert("No ingredients selected for pizza!");
                return;
            }
            State.socket.emit('build_pizza', {});
            State.builderIngredients = [];
            UI.updateBuilderDisplay();
        },

        toggleOven(state) {
            State.socket.emit('toggle_oven', { state: state });
        },
        
        startOvenTimer(startTimestamp) {
            // Legacy hook – server heartbeat now controls the display,
            // so we just clear any old client interval if it exists.
            if (this.ovenTimerInterval) {
                clearInterval(this.ovenTimerInterval);
                this.ovenTimerInterval = null;
            }
        },

        stopOvenTimer() {
            if (this.ovenTimerInterval) {
                clearInterval(this.ovenTimerInterval);
                this.ovenTimerInterval = null;
            }
        }
    };

    /* =========================================
       8. SOCKET LISTENERS
       ========================================= */
    function setupSocketListeners() {
        const s = State.socket;

        

        s.on('connect', () => {
            if (State.pendingQrRoom) return;
            if (State.isInitialConnect) {
                new bootstrap.Modal(document.getElementById('roomModal'), { backdrop: 'static', keyboard: false }).show();
                s.emit('request_room_list');
                State.isInitialConnect = false;
            } else if (State.myRoom) {
                const pwd = localStorage.getItem('myRoomPassword');
                if (pwd) Game.joinRoom(State.myRoom, pwd);
            }
        });

        s.on('join_error', (data) => {
            const field = document.getElementById('qrAuthModal')?.classList.contains('show') ? 'qr-password' : (data.message.includes('password') ? 'password' : 'room');
            document.getElementById(`${field}-input`).classList.add("is-invalid");
            document.getElementById(`${field}-input`).nextElementSibling.textContent = data.message;
        });

        s.on('room_list', (data) => {
            const tbody = document.getElementById('room-table-body');
            tbody.innerHTML = '';
            const rooms = Object.keys(data.rooms);
            if (rooms.length === 0) tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">No active rooms. Create one to start!</td></tr>';
            else {
                rooms.forEach(room => {
                    const count = data.rooms[room];
                    const joinUrl = `${window.location.origin}/?room=${encodeURIComponent(room)}`;
                    const qrApiUrl = `${CONFIG.api.qr}${encodeURIComponent(joinUrl)}`;
                    const row = document.createElement('tr');
                    row.innerHTML = `<td style="vertical-align:middle;"><strong>${room}</strong></td>
                        <td style="vertical-align:middle;"><span class="badge ${count >= 5 ? 'bg-danger' : 'bg-success'}">${count}/5 Players</span></td>
                        <td><img src="${qrApiUrl}" class="img-thumbnail" style="width:80px;height:80px;cursor:pointer;" onclick="window.open('${qrApiUrl.replace('100x100','400x400')}')"></td>`;
                    tbody.appendChild(row);
                });
            }
            const scoresDiv = document.getElementById('high-scores');
            scoresDiv.innerHTML = '<h3>Top Scores</h3>';
            let tableHTML = '<table class="table table-bordered"><thead><tr><th>Round</th><th>1st</th><th>2nd</th><th>3rd</th></tr></thead><tbody>';
            for (let r = 1; r <= 3; r++) {
                tableHTML += `<tr><td>Round ${r}</td>`;
                for (let rank = 1; rank <= 3; rank++) {
                    const d = data.high_scores[r] ? data.high_scores[r][rank] : null;
                    tableHTML += `<td>${d && d.room_name ? `${d.room_name} (${d.score})` : '-'}</td>`;
                }
                tableHTML += '</tr>';
            }
            scoresDiv.innerHTML += tableHTML + '</tbody></table>';
        });

        s.on('game_state', (newState) => {
            UI.refreshGameState(newState);
            bootstrap.Modal.getInstance(document.getElementById('roomModal'))?.hide();
            bootstrap.Modal.getInstance(document.getElementById('qrAuthModal'))?.hide();
            if (State.pendingQrRoom) { window.history.replaceState({}, document.title, "/"); State.pendingQrRoom = null; }
        });

        s.on('round_started', (data) => {
            Audio.play('ding');
            State.gameData.round = data.round;
            State.gameData.current_phase = "round";
            State.gameData.customer_orders = data.customer_orders;
            UI.updateMessage(`Round ${data.round} started. Duration: ${data.duration} sec`);
            bootstrap.Modal.getInstance(document.getElementById('debriefModal'))?.hide();
            UI.refreshGameState(State.gameData);
        });

        s.on('round_ended', (result) => {
            Game.stopOvenTimer();
            Audio.manageOvenSound(false);
            document.getElementById("debrief-pizzas-completed").innerText = result.completed_pizzas_count;
            document.getElementById("debrief-pizzas-wasted").innerText = result.wasted_pizzas_count;
            document.getElementById("debrief-pizzas-unsold").innerText = result.unsold_pizzas_count;
            document.getElementById("debrief-ingredients-left").innerText = result.ingredients_left_count || 0;
            document.getElementById("debrief-score").innerText = result.score;

            const r3Display = State.gameData.round === 3 ? "block" : "none";
            ["fulfilled-orders", "remaining-orders", "unmatched-pizzas"].forEach(id => document.getElementById(id).style.display = r3Display);
            if (State.gameData.round === 3) {
                document.getElementById("debrief-fulfilled-orders").innerText = result.fulfilled_orders_count || 0;
                document.getElementById("debrief-remaining-orders").innerText = result.remaining_orders_count || 0;
                document.getElementById("debrief-unmatched-pizzas").innerText = result.unmatched_pizzas_count || 0;
            }

            if (result.lead_times) State.lastLeadTimeData = result.lead_times;
            if (result.cfd_data) State.lastCFDData = result.cfd_data;

            const content = CONFIG.debrief[State.gameData.round] || CONFIG.debrief[1];
            document.getElementById("debrief-question").innerText = content.question;
            document.getElementById("debrief-quote").innerText = content.quote;

            new bootstrap.Modal(document.getElementById('debriefModal')).show();
            if (result.score > 0) { Audio.play('cash'); confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } }); }
            else Audio.play('alarm');

            UI.updateVisibility();
        });

        s.on('game_reset', (state) => {
            UI.updateMessage("Round reset. Ready for a new round.");
            bootstrap.Modal.getInstance(document.getElementById('debriefModal'))?.hide();
            UI.refreshGameState(state);
        });

        // The RESTORED Time Response Handler
        s.on('time_response', (data) => {
            const timer = document.getElementById("timer");
            if (data.phase === "debrief") timer.innerText = "DEBRIEF:\n" + data.roundTimeRemaining + " sec";
            else if (data.phase === "round") timer.innerText = "Round Time:\n" + data.roundTimeRemaining + " sec";
            else timer.innerText = "Round Time:";
            document.getElementById("oven-timer").innerText = "Oven Time:\n" + data.ovenTime + " sec";
        });

        s.on('ingredient_prepared', (item) => { Audio.play('pop'); UI.updateMessage("Prepared: " + item.type); });
        s.on('build_error', (d) => UI.updateMessage("Error: " + d.message));
        s.on('pizza_built', (p) => UI.updateMessage("Pizza built: " + p.pizza_id));
        s.on('oven_error', (d) => UI.updateMessage("Oven: " + d.message));
        s.on('pizza_moved_to_oven', (p) => UI.updateMessage("To Oven: " + p.pizza_id));
        s.on('clear_shared_builder', () => UI.renderSharedBuilders(State.gameData.players));

        s.on('oven_toggled', (data) => {
            const isOn = (data.state === "on");
            UI.updateMessage(isOn ? "Oven turned ON." : "Oven turned OFF.");
            const ovenContainer = document.getElementById("oven-container");
            isOn ? ovenContainer.classList.add("oven-active") : ovenContainer.classList.remove("oven-active");
            State.gameData.is_oven_on = isOn;
            Audio.manageOvenSound(isOn); 
        });

        s.on('new_order', (order) => { Audio.play('order'); UI.updateMessage("New Order: " + order.type); State.gameData.customer_orders.push(order); UI.refreshGameState(State.gameData); });
        s.on('order_fulfilled', (data) => { Audio.play('cash'); UI.updateMessage("Fulfilled: " + data.order_id); const el = document.querySelector(`[data-order-id="${data.order_id}"]`); if (el) el.remove(); });

        s.on('game_state_update', (update) => {
            if (update.customer_orders) State.gameData.customer_orders = update.customer_orders;
            if (update.pending_orders) State.gameData.pending_orders = update.pending_orders;
            UI.refreshGameState(State.gameData);
        });

        s.on('admin_dashboard_update', (data) => {
             const tbody = document.getElementById('facilitator-table-body');
             if (!tbody) return;
             tbody.innerHTML = '';
             data.rooms.forEach(room => {
                 const row = document.createElement('tr');
                 row.innerHTML = `<td class="text-start fw-bold">${room.room}</td><td>${room.phase}</td><td>${room.time_left}s</td><td>${room.players}</td><td>${room.completed}</td><td>${room.wasted}</td><td>${room.oven}</td><td>${room.built}</td>`;
                 tbody.appendChild(row);
             });
        });
    }

    /* =========================================
       9. INITIALIZATION
       ========================================= */
    document.addEventListener("DOMContentLoaded", () => {
        Audio.init();
        setupSocketListeners();

        // RESTORED: Heartbeat (every 1s) to drive Python logic (orders) and display timers
        State.heartbeat = setInterval(() => State.socket.emit('time_request'), 1000);

        const roomParam = new URLSearchParams(window.location.search).get('room');
        if (roomParam) {
            State.pendingQrRoom = roomParam;
            document.getElementById('qr-room-name-display').innerText = roomParam;
            new bootstrap.Modal(document.getElementById('qrAuthModal')).show();
        }

        document.getElementById("qr-join-form").addEventListener("submit", (e) => {
            e.preventDefault();
            const password = document.getElementById("qr-password-input").value.trim();
            if (password) Game.joinRoom(State.pendingQrRoom, password);
        });

        document.getElementById("join-form").addEventListener("submit", async (e) => {
            e.preventDefault();
            const rInput = document.getElementById("room-input");
            const pInput = document.getElementById("password-input");

            if (await Utils.checkProfanity(rInput.value.trim())) {
                alert("Please check your language.");
                return;
            }
            Game.joinRoom(rInput.value.trim(), pInput.value.trim());
        });

        document.getElementById("submit-pizza").addEventListener("click", Game.submitPizza);
        document.getElementById("oven-on").addEventListener("click", () => Game.toggleOven("on"));
        document.getElementById("oven-off").addEventListener("click", () => Game.toggleOven("off"));
        document.getElementById("start-round").addEventListener("click", () => State.socket.emit('start_round', {}));

        const modal = new bootstrap.Modal(document.getElementById("modal"));
        document.querySelectorAll("#instructions-btn, #instructions-btn0").forEach(btn => btn?.addEventListener("click", () => modal.show()));
        document.getElementById("modal-close")?.addEventListener("click", () => modal.hide());

        document.getElementById('leadtime-tab')?.addEventListener('shown.bs.tab', () => { if(State.lastLeadTimeData) Charts.renderLeadTime(State.lastLeadTimeData); });
        document.getElementById('cfd-tab')?.addEventListener('shown.bs.tab', () => { if(State.lastCFDData) Charts.renderCFD(State.lastCFDData); });
    });

    // Public API
    window.prepareIngredient = (type) => State.socket.emit('prepare_ingredient', { ingredient_type: type });
    window.triggerBuild = (sid) => State.socket.emit('build_pizza', { player_sid: sid });
    window.cancelQrJoin = () => { window.location.href = "/"; };
    window.openFacilitator = () => {
        bootstrap.Modal.getOrCreateInstance(document.getElementById('roomModal')).hide();
        const facEl = document.getElementById('facilitatorModal');
        new bootstrap.Modal(facEl).show();
        openUptimeModal();
        State.socket.emit('request_admin_dashboard');
        State.dashboardInterval = setInterval(() => State.socket.emit('request_admin_dashboard'), 3000);
        
    };
    window.closeFacilitator = () => {
    const facModal = bootstrap.Modal.getInstance(document.getElementById('facilitatorModal'));
    if (facModal) facModal.hide();

    // Stop the dashboard polling
    if (State.dashboardInterval) {
        clearInterval(State.dashboardInterval);
        State.dashboardInterval = null;
    }

    // Return to room form
    const roomModalEl = document.getElementById('roomModal');
    const roomModal = new bootstrap.Modal(roomModalEl, { backdrop: 'static', keyboard: false });
    roomModal.show();
};


function openUptimeModal() {
    fetch("/uptime")
        .then(res => res.json())
        .then(data => {
            const monitor = data.monitors[0]; // or loop if multiple

            const statusMap = {
                0: "Paused",
                1: "Not Checked Yet",
                2: "Up",
                8: "Seems Down",
                9: "Down"
            };

            document.getElementById("uptime-content").innerHTML = `
                <div class="card p-3">
                    <h5>${monitor.friendly_name}</h5>
                    <p>Status: <strong>${statusMap[monitor.status]}</strong></p>
                    <p>Uptime (24h): ${monitor.all_time_uptime_ratio}%</p>
                </div>
            `;
        })
        .catch(() => {
            document.getElementById("uptime-content").innerText = "Unable to load status.";
        });
}
    
})();
