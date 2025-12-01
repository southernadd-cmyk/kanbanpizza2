/**
 * PIZZA GAME CLIENT
 * Refactored for modularity, maintainability, and ES6 standards.
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
       2. STATE MANAGEMENT
       ========================================= */
    const State = {
        socket: io({ transports: ['websocket', 'polling'], reconnection: true }),
        myRoom: localStorage.getItem('myRoom') || "",
        isInitialConnect: true,
        pendingQrRoom: null,
        builderIngredients: [],
        touchSelectedIngredient: null,
        dashboardInterval: null,
        lastCFDData: null,
        lastLeadTimeData: null,
        gameData: {} // Stores the full game state from server
    };

    /* =========================================
       3. UTILITIES
       ========================================= */
    const Utils = {
        async checkProfanity(text) {
            try {
                const response = await fetch(`${CONFIG.api.profanity}${encodeURIComponent(text)}`);
                const result = await response.text();
                return result === 'true';
            } catch (error) {
                console.error('Profanity check failed:', error);
                return false;
            }
        },

        vibrate() {
            if (navigator.vibrate) navigator.vibrate(50);
        }
    };

    /* =========================================
       4. CHARTS MANAGER
       ========================================= */
    const Charts = {
        instances: {
            cfd: null,
            leadTime: null
        },

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
                        {
                            label: 'Completed',
                            data: rawLeadTimes.map(lt => lt.status === "completed" ? lt.lead_time : null),
                            borderColor: '#28a745', backgroundColor: 'rgba(40, 167, 69, 0.2)', pointBackgroundColor: '#28a745',
                            fill: false, spanGaps: true
                        },
                        {
                            label: 'Incomplete',
                            data: rawLeadTimes.map(lt => lt.status === "incomplete" ? lt.lead_time : null),
                            borderColor: '#dc3545', backgroundColor: 'rgba(220, 53, 69, 0.2)', pointBackgroundColor: '#dc3545',
                            fill: false, spanGaps: true
                        }
                    ]
                },
                options: {
                    maintainAspectRatio: false, responsive: true,
                    scales: { y: { beginAtZero: true, title: { display: true, text: 'Lead Time (Seconds)' } }, x: { title: { display: true, text: 'Pizza Sequence' } } },
                    plugins: { title: { display: true, text: 'Lead Times for All Pizzas' }, legend: { display: true } }
                }
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
                        { label: 'Done', data: historyData.map(d => d.done), borderColor: '#28a745', backgroundColor: 'rgba(40, 167, 69, 0.5)', fill: true, tension: 0.4 },
                        { label: 'In Oven', data: historyData.map(d => d.oven), borderColor: '#dc3545', backgroundColor: 'rgba(220, 53, 69, 0.5)', fill: true, tension: 0.4 },
                        { label: 'Built (Queue)', data: historyData.map(d => d.built), borderColor: '#ffc107', backgroundColor: 'rgba(255, 193, 7, 0.5)', fill: true, tension: 0.4 }
                    ]
                },
                options: {
                    maintainAspectRatio: false, responsive: true,
                    scales: { y: { stacked: true, beginAtZero: true, title: { display: true, text: 'Number of Pizzas' } }, x: { title: { display: true, text: 'Time (Seconds)' } } },
                    plugins: { tooltip: { mode: 'index', intersect: false }, title: { display: true, text: 'Work In Progress over Time' } }
                }
            });
        }
    };

    /* =========================================
       5. UI RENDERER
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

            const details = document.createElement("div");
            details.innerHTML = `<strong>ID: ${pizza.pizza_id.slice(0, 4)}</strong><br><small>${extraLabel}</small>`;
            container.appendChild(details);

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
        },

        renderSharedBuilders(players) {
            const container = document.getElementById("pizza-builders-container");
            container.innerHTML = "";
            Object.keys(players).forEach((sid, index) => {
                const colDiv = document.createElement("div");
                colDiv.classList.add("col-md-6");

                const builderHTML = `
                    <div class="pizza-builder-container">
                        <h5>Builder #${index + 1}</h5>
                        <div class="d-flex flex-wrap pizza-builder-dropzone" 
                             ondrop="dropToSharedBuilder(event, '${sid}')" 
                             ondragover="allowDrop(event)">
                             ${players[sid].builder_ingredients.map(ing => 
                                `<div class="ingredient">${CONFIG.emojis.ingredients[ing.type] || ing.type}</div>`
                             ).join('')}
                        </div>
                        <button class="btn btn-primary btn-custom mt-2" onclick="triggerBuild('${sid}')">Submit Pizza</button>
                    </div>`;
                
                colDiv.innerHTML = builderHTML;
                container.appendChild(colDiv);

                // Touch handling for shared builders
                if ('ontouchstart' in window) {
                    const dropzone = colDiv.querySelector('.pizza-builder-dropzone');
                    dropzone.addEventListener("touchend", (ev) => {
                        ev.preventDefault();
                        if (State.touchSelectedIngredient) {
                            State.socket.emit('take_ingredient', { ingredient_id: State.touchSelectedIngredient.id, target_sid: sid });
                            State.touchSelectedIngredient = null;
                            document.querySelectorAll('.ingredient.selected').forEach(el => el.classList.remove('selected'));
                        }
                    });
                }
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
            }
        },

        refreshGameState(newState) {
            State.gameData = newState;
            console.log("Game State Updated:", newState);

            this.updateRoomLabels(State.myRoom || "Unknown", Object.keys(newState.players).length);
            this.updateVisibility();

            // 1. Phases
            const gameArea = document.getElementById("game-area");
            const startBtn = document.getElementById("start-round");
            if (newState.current_phase === "round") {
                gameArea.style.display = "block";
                startBtn.style.display = "none";
            } else {
                gameArea.style.display = "none";
                startBtn.style.display = "inline-block";
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

                    // Ingredients Text Logic
                    let ingredientsText = [];
                    ['base', 'sauce', 'ham', 'pineapple'].forEach(type => {
                        if (order.ingredients[type] > 0) ingredientsText.push(`${CONFIG.emojis.ingredients[type]}x${order.ingredients[type]}`);
                    });

                    card.innerHTML = `
                        <div class="order-id">Order: ${order.id.slice(0, 6)}</div>
                        <div class="order-ingredients">${ingredientsText.join(" ")}</div>
                        <div class="order-emoji">${CONFIG.emojis.orders[order.type] || '<div class="emoji-wrapper"><span class="emoji">🍕</span></div>'}</div>
                    `;
                    ordersList.appendChild(card);
                });
                document.getElementById("order-count").innerText = newState.customer_orders.length;
            } else {
                ordersDiv.style.display = "none";
                document.getElementById("order-count").innerText = "0";
            }

            // 3. Ingredient Pool
            const poolDiv = document.getElementById("prepared-pool");
            poolDiv.innerHTML = "";
            newState.prepared_ingredients.forEach(item => {
                const div = document.createElement("div");
                div.className = "ingredient";
                div.draggable = true;
                div.dataset.id = item.id;
                div.dataset.type = item.type;
                div.innerText = CONFIG.emojis.ingredients[item.type] || item.type;
                div.addEventListener("dragstart", Game.handleDragStart);
                
                // Touch support
                if ('ontouchstart' in window) {
                    div.addEventListener("touchstart", (ev) => {
                        ev.preventDefault();
                        State.touchSelectedIngredient = { id: item.id, type: item.type };
                        div.classList.add("selected");
                    });
                }
                poolDiv.appendChild(div);
            });

            // 4. Built Pizzas (Queue)
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

            // 5. Oven & Completed & Wasted
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
       6. GAME ACTIONS (Exposed logic)
       ========================================= */
    const Game = {
        joinRoom(room, password) {
            State.myRoom = room;
            localStorage.setItem('myRoom', room);
            localStorage.setItem('myRoomPassword', password);
            State.socket.emit('join', { room: room, password: password });
        },

        handleDragStart(ev) {
            ev.dataTransfer.setData("ingredient_id", ev.target.getAttribute("data-id"));
            ev.dataTransfer.setData("ingredient_type", ev.target.dataset.type);
        },

        handleDropToBuilder(ev) {
            ev.preventDefault();
            const ingredient_id = ev.dataTransfer.getData("ingredient_id");
            const ingredient_type = ev.dataTransfer.getData("ingredient_type");
            
            State.socket.emit('take_ingredient', { ingredient_id: ingredient_id });
            Utils.vibrate();

            if (State.gameData.round === 1) {
                State.builderIngredients.push({ id: ingredient_id, type: ingredient_type });
                UI.updateBuilderDisplay();
            }
        },

        handleDropToShared(ev, sid) {
            ev.preventDefault();
            const ingredient_id = ev.dataTransfer.getData("ingredient_id");
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
        }
    };

    /* =========================================
       7. SOCKET EVENT HANDLERS
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
                const pwd = localStorage.getItem('myRoomPassword') || prompt("Enter password for " + State.myRoom);
                if (pwd) Game.joinRoom(State.myRoom, pwd);
            }
        });

        s.on('disconnect', () => UI.updateMessage("Disconnected. Attempting to reconnect..."));
        s.on('reconnect', () => UI.updateMessage("Reconnected to room " + State.myRoom));
        
        s.on('join_error', (data) => {
            const isQrOpen = document.getElementById('qrAuthModal')?.classList.contains('show');
            if (isQrOpen) {
                document.getElementById("qr-password-input").classList.add("is-invalid");
                document.getElementById("qr-feedback").textContent = data.message;
            } else {
                const field = data.message.includes("password") ? "password" : "room";
                document.getElementById(`${field}-input`).classList.add("is-invalid");
                document.getElementById(`${field}-input-feedback`).textContent = data.message;
            }
        });

        s.on('room_list', (data) => {
            // Render Room Table
            const tbody = document.getElementById('room-table-body');
            tbody.innerHTML = '';
            const rooms = Object.keys(data.rooms);

            if (rooms.length === 0) {
                tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">No active rooms. Create one to start!</td></tr>';
            } else {
                rooms.forEach(room => {
                    const count = data.rooms[room];
                    const joinUrl = `${window.location.origin}/?room=${encodeURIComponent(room)}`;
                    const qrApiUrl = `${CONFIG.api.qr}${encodeURIComponent(joinUrl)}`;
                    
                    const row = document.createElement('tr');
                    row.innerHTML = `
                        <td style="vertical-align:middle;"><strong>${room}</strong></td>
                        <td style="vertical-align:middle;"><span class="badge ${count >= 5 ? 'bg-danger' : 'bg-success'}">${count}/5 Players</span></td>
                        <td><img src="${qrApiUrl}" class="img-thumbnail" style="width:80px;height:80px;cursor:pointer;" onclick="window.open('${qrApiUrl.replace('100x100','400x400')}')"></td>
                    `;
                    tbody.appendChild(row);
                });
            }

            // Render High Scores
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
            if (State.pendingQrRoom) {
                window.history.replaceState({}, document.title, "/");
                State.pendingQrRoom = null;
            }
        });

        s.on('round_started', (data) => {
            State.gameData.round = data.round;
            State.gameData.current_phase = "round";
            State.gameData.customer_orders = data.customer_orders;
            UI.updateMessage(`Round ${data.round} started. Duration: ${data.duration} sec`);
            bootstrap.Modal.getInstance(document.getElementById('debriefModal'))?.hide();
            UI.refreshGameState(State.gameData);
        });

        s.on('round_ended', (result) => {
            // Fill Debrief Modal
            document.getElementById("debrief-pizzas-completed").innerText = result.completed_pizzas_count;
            document.getElementById("debrief-pizzas-wasted").innerText = result.wasted_pizzas_count;
            document.getElementById("debrief-pizzas-unsold").innerText = result.unsold_pizzas_count;
            document.getElementById("debrief-ingredients-left").innerText = result.ingredients_left_count || 0;
            document.getElementById("debrief-score").innerText = result.score;
            
            // Round 3 Specifics
            const r3Display = State.gameData.round === 3 ? "block" : "none";
            ["fulfilled-orders", "remaining-orders", "unmatched-pizzas"].forEach(id => document.getElementById(id).style.display = r3Display);
            if (State.gameData.round === 3) {
                document.getElementById("debrief-fulfilled-orders").innerText = result.fulfilled_orders_count || 0;
                document.getElementById("debrief-remaining-orders").innerText = result.remaining_orders_count || 0;
                document.getElementById("debrief-unmatched-pizzas").innerText = result.unmatched_pizzas_count || 0;
            }

            // Save Chart Data
            if (result.lead_times) State.lastLeadTimeData = result.lead_times;
            if (result.cfd_data) State.lastCFDData = result.cfd_data;

            // Content & Show
            const content = CONFIG.debrief[State.gameData.round] || CONFIG.debrief[1];
            document.getElementById("debrief-question").innerText = content.question;
            document.getElementById("debrief-quote").innerText = content.quote;
            
            new bootstrap.Modal(document.getElementById('debriefModal')).show();
            if (result.score > 0) confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });

            // Reset Tab
            const tabBtn = document.querySelector('#debriefTabs button[data-bs-target="#tab-summary"]');
            if(tabBtn) bootstrap.Tab.getOrCreateInstance(tabBtn).show();

            UI.updateVisibility();
        });

        s.on('game_reset', (state) => {
            UI.updateMessage("Round reset. Ready for a new round.");
            document.getElementById("timer").innerText = "Round Time:";
            bootstrap.Modal.getInstance(document.getElementById('debriefModal'))?.hide();
            UI.refreshGameState(state);
        });

        // Small events
        s.on('ingredient_prepared', (item) => UI.updateMessage("Ingredient prepared: " + (CONFIG.emojis.ingredients[item.type] || item.type)));
        s.on('build_error', (d) => UI.updateMessage("Build Error: " + d.message));
        s.on('pizza_built', (p) => UI.updateMessage("Pizza built: " + p.pizza_id));
        s.on('oven_error', (d) => UI.updateMessage("Oven Error: " + d.message));
        s.on('pizza_moved_to_oven', (p) => UI.updateMessage("Pizza moved to oven: " + p.pizza_id));
        s.on('clear_shared_builder', () => UI.renderSharedBuilders(State.gameData.players));
        
        s.on('oven_toggled', (data) => {
            const isOn = (data.state === "on");
            UI.updateMessage(isOn ? "Oven turned ON." : "Oven turned OFF.");
            const ovenContainer = document.getElementById("oven-container");
            isOn ? ovenContainer.classList.add("oven-active") : ovenContainer.classList.remove("oven-active");
            
            const btnOn = document.getElementById("oven-on");
            const btnOff = document.getElementById("oven-off");
            if (btnOn && btnOff) {
                btnOn.disabled = isOn;
                btnOff.disabled = !isOn;
            }
            State.gameData.is_oven_on = isOn;
            UI.refreshGameState(State.gameData);
        });

        s.on('new_order', (order) => {
            UI.updateMessage("New order received: " + order.type);
            State.gameData.customer_orders.push(order);
            UI.refreshGameState(State.gameData);
        });

        s.on('order_fulfilled', (data) => {
            UI.updateMessage("Order fulfilled: " + data.order_id);
            const el = document.querySelector(`[data-order-id="${data.order_id}"]`);
            if (el) { el.remove(); document.getElementById("order-count").innerText = State.gameData.customer_orders.length; }
        });

        s.on('game_state_update', (update) => {
            if (update.customer_orders) State.gameData.customer_orders = update.customer_orders;
            if (update.pending_orders) State.gameData.pending_orders = update.pending_orders;
            UI.refreshGameState(State.gameData);
        });

        s.on('room_expired', (data) => {
            UI.updateMessage(data.message);
            new bootstrap.Modal(document.getElementById('roomModal'), { backdrop: 'static', keyboard: false }).show();
            s.emit('request_room_list');
        });

        s.on('time_response', (data) => {
            const timer = document.getElementById("timer");
            if (data.phase === "debrief") timer.innerText = "DEBRIEF:\n" + data.roundTimeRemaining + " sec";
            else if (data.phase === "round") timer.innerText = "Round Time:\n" + data.roundTimeRemaining + " sec";
            else timer.innerText = "Round Time:";
            document.getElementById("oven-timer").innerText = "Oven Time:\n" + data.ovenTime + " sec";
        });

        // Facilitator Dashboard
        s.on('admin_dashboard_update', (data) => {
            const tbody = document.getElementById('facilitator-table-body');
            if (!tbody) return;
            tbody.innerHTML = '';
            if (!data.rooms || data.rooms.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" class="text-muted">No active rooms found.</td></tr>';
                return;
            }
            data.rooms.forEach(room => {
                let badge = room.phase === 'ROUND' ? 'bg-success' : (room.phase === 'DEBRIEF' ? 'bg-warning text-dark' : 'bg-secondary');
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td class="text-start fw-bold">${room.room} <span class="badge bg-light text-dark border">R${room.round}</span></td>
                    <td><span class="badge ${badge}">${room.phase}</span></td>
                    <td class="fw-bold font-monospace">${room.time_left}s</td>
                    <td>${room.players}</td>
                    <td class="text-success fw-bold">${room.completed}</td>
                    <td class="text-danger fw-bold">${room.wasted}</td>
                    <td>${room.oven}</td>
                    <td>${room.built}</td>
                `;
                tbody.appendChild(row);
            });
        });
    }

    /* =========================================
       8. INITIALIZATION & EVENTS
       ========================================= */
    document.addEventListener("DOMContentLoaded", () => {
        setupSocketListeners();
        
        // 1. URL Params (QR Code)
        const roomParam = new URLSearchParams(window.location.search).get('room');
        if (roomParam) {
            State.pendingQrRoom = roomParam;
            document.getElementById('qr-room-name-display').innerText = roomParam;
            const modalEl = document.getElementById('qrAuthModal');
            new bootstrap.Modal(modalEl).show();
            modalEl.addEventListener('shown.bs.modal', () => document.getElementById('qr-password-input').focus());
        }

        // 2. Forms
        document.getElementById("qr-join-form").addEventListener("submit", (e) => {
            e.preventDefault();
            const password = document.getElementById("qr-password-input").value.trim();
            if (password) Game.joinRoom(State.pendingQrRoom, password);
        });

        document.getElementById("join-form").addEventListener("submit", async (e) => {
            e.preventDefault();
            const rInput = document.getElementById("room-input");
            const pInput = document.getElementById("password-input");
            const fb = document.getElementById("room-input-feedback");
            
            if (!rInput.value.trim() || !pInput.value.trim()) {
                rInput.classList.add("is-invalid");
                fb.textContent = "Fields cannot be empty.";
                return;
            }

            if (await Utils.checkProfanity(rInput.value.trim())) {
                rInput.classList.add("is-invalid");
                fb.textContent = "Appropriate language only, please.";
                return;
            }

            rInput.classList.remove("is-invalid");
            Game.joinRoom(rInput.value.trim(), pInput.value.trim());
        });

        // 3. Gameplay Buttons
        document.getElementById("submit-pizza").addEventListener("click", Game.submitPizza);
        document.getElementById("oven-on").addEventListener("click", () => Game.toggleOven("on"));
        document.getElementById("oven-off").addEventListener("click", () => Game.toggleOven("off"));
        document.getElementById("start-round").addEventListener("click", () => State.socket.emit('start_round', {}));
        
        // 4. Modals / Instructions
        const modal = new bootstrap.Modal(document.getElementById("modal"));
        document.querySelectorAll("#instructions-btn, #instructions-btn0").forEach(btn => btn?.addEventListener("click", () => modal.show()));
        document.getElementById("modal-close")?.addEventListener("click", () => modal.hide());

        // 5. Chart Tabs
        document.getElementById('leadtime-tab')?.addEventListener('shown.bs.tab', () => { if(State.lastLeadTimeData) Charts.renderLeadTime(State.lastLeadTimeData); });
        document.getElementById('cfd-tab')?.addEventListener('shown.bs.tab', () => { if(State.lastCFDData) Charts.renderCFD(State.lastCFDData); });
        
        // 6. Touch Support (Self-contained builder touch)
        const myBuilder = document.getElementById("pizza-builder");
        if ('ontouchstart' in window && myBuilder) {
            myBuilder.addEventListener("touchend", (ev) => {
                ev.preventDefault();
                if (State.touchSelectedIngredient && State.gameData.round === 1) {
                    State.socket.emit('take_ingredient', { ingredient_id: State.touchSelectedIngredient.id });
                    State.builderIngredients.push({ id: State.touchSelectedIngredient.id, type: State.touchSelectedIngredient.type });
                    UI.updateBuilderDisplay();
                    document.querySelectorAll('.ingredient.selected').forEach(el => el.classList.remove('selected'));
                    State.touchSelectedIngredient = null;
                }
            });
        }

        // 7. Facilitator Modal Events
        const facModal = document.getElementById('facilitatorModal');
        if (facModal) {
            facModal.addEventListener('hidden.bs.modal', () => {
                if (State.dashboardInterval) { clearInterval(State.dashboardInterval); State.dashboardInterval = null; }
                const lobby = document.getElementById('roomModal');
                if(lobby) { bootstrap.Modal.getOrCreateInstance(lobby).show(); State.socket.emit('request_room_list'); }
            });
        }

        // Heartbeat
        setInterval(() => State.socket.emit('time_request'), 1000);
    });

    /* =========================================
       9. EXPOSE TO WINDOW (Public API)
       ========================================= */
    // These must be exposed because HTML elements use ondrop="dropToBuilder(event)", etc.
    window.prepareIngredient = (type) => State.socket.emit('prepare_ingredient', { ingredient_type: type });
    window.allowDrop = (ev) => ev.preventDefault();
    window.drag = Game.handleDragStart;
    window.dropToBuilder = Game.handleDropToBuilder;
    window.dropToSharedBuilder = Game.handleDropToShared;
    window.triggerBuild = (sid) => State.socket.emit('build_pizza', { player_sid: sid });
    
    window.cancelQrJoin = () => {
        window.history.pushState({}, document.title, "/");
        State.pendingQrRoom = null;
        bootstrap.Modal.getInstance(document.getElementById('qrAuthModal')).hide();
        new bootstrap.Modal(document.getElementById('roomModal'), { backdrop: 'static', keyboard: false }).show();
        State.socket.emit('request_room_list');
    };

    window.openFacilitator = () => {
        bootstrap.Modal.getOrCreateInstance(document.getElementById('roomModal')).hide();
        const facEl = document.getElementById('facilitatorModal');
        if (!facEl) return;
        bootstrap.Modal.getOrCreateInstance(facEl).show();
        
        State.socket.emit('request_admin_dashboard');
        if (State.dashboardInterval) clearInterval(State.dashboardInterval);
        State.dashboardInterval = setInterval(() => {
            if (facEl.classList.contains('show')) State.socket.emit('request_admin_dashboard');
            else clearInterval(State.dashboardInterval);
        }, 3000);
    };

})();
