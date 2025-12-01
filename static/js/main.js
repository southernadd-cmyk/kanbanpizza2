/* =========================================
   1. GLOBAL VARIABLES & SETUP
   ========================================= */
var socket = io({ transports: ['websocket', 'polling'], reconnection: true });
var myRoom = localStorage.getItem('myRoom') || "";
var isInitialConnect = true;
var pendingQrRoom = null; 
var isOvenActive = false;
// Dashboard & Chart Globals
var dashboardInterval = null; 
var lastCFDData = null; 
var lastLeadTimeData = null;
var cfdChartInstance = null;
var leadTimeChart = null;

// Game State Globals
var builderIngredients = [];
var touchSelectedIngredient = null;
var ingredientEmoji = { "base": "🟡", "sauce": "🔴", "ham": "🥓", "pineapple": "🍍" };
var orderEmoji = {
  "ham": '<div class="emoji-wrapper"><span class="emoji">🍕</span><span class="emoji">🥓</span></div>',
  "pineapple": '<div class="emoji-wrapper"><span class="emoji">🍕</span><span class="emoji">🍍</span></div>',
  "ham & pineapple": '<div class="emoji-wrapper"><span class="emoji">🍕</span><span class="emoji">🥓</span><span class="emoji">🍍</span></div>',
  "light ham": '<div class="emoji-wrapper"><span class="emoji">🍕</span><span class="emoji">🥓</span></div>',
  "light pineapple": '<div class="emoji-wrapper"><span class="emoji">🍕</span><span class="emoji">🍍</span></div>',
  "plain": '<div class="emoji-wrapper"><span class="emoji">🍕</span></div>',
  "heavy ham": '<div class="emoji-wrapper"><span class="emoji">🍕</span><span class="emoji">🥓</span></div>',
  "heavy pineapple": '<div class="emoji-wrapper"><span class="emoji">🍕</span><span class="emoji">🍍</span></div>'
};

const debriefContent = {
  1: { question: "Reflect on the round: How did you identify and streamline your pizza-making process? Did the oven’s WIP limit of 3 pizzas affect your strategy?", quote: "“Working software is the primary measure of progress.”" },
  2: { question: "Reflect on the round: How did collaboration with your team impact your pizza production?", quote: "“Individuals and interactions over processes and tools.”" },
  3: { question: "Reflect on the round: How did customer orders change your priorities?", quote: "“Customer collaboration over contract negotiation.”" }
};

/* =========================================
   2. QR CODE & URL ENTRY LOGIC
   ========================================= */
document.addEventListener("DOMContentLoaded", function() {
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room');

  if (roomParam) {
    pendingQrRoom = roomParam; 
    document.getElementById('qr-room-name-display').innerText = roomParam;
    
    var qrModal = new bootstrap.Modal(document.getElementById('qrAuthModal'));
    qrModal.show();
    
    document.getElementById('qrAuthModal').addEventListener('shown.bs.modal', function () {
        document.getElementById('qr-password-input').focus();
    });
  }
});

document.getElementById("qr-join-form").addEventListener("submit", function(e) {
  e.preventDefault();
  const password = document.getElementById("qr-password-input").value.trim();
  if (!password) return;
  
  localStorage.setItem('myRoom', pendingQrRoom);
  localStorage.setItem('myRoomPassword', password);
  myRoom = pendingQrRoom;

  socket.emit('join', { room: pendingQrRoom, password: password });
});

window.cancelQrJoin = function() {
  window.history.pushState({}, document.title, "/");
  pendingQrRoom = null;
  bootstrap.Modal.getInstance(document.getElementById('qrAuthModal')).hide();
  var roomModal = new bootstrap.Modal(document.getElementById('roomModal'), {
      backdrop: 'static', 
      keyboard: false
  });
  roomModal.show();
  socket.emit('request_room_list');
};

/* =========================================
   3. STANDARD LOBBY LOGIC
   ========================================= */
async function checkProfanity(text) {
  try {
    const response = await fetch(`https://www.purgomalum.com/service/containsprofanity?text=${encodeURIComponent(text)}`);
    const containsProfanity = await response.text();
    return containsProfanity === 'true';
  } catch (error) {
    console.error('Profanity check failed:', error);
    return false; 
  }
}

async function filterRoomName(event) {
  event.preventDefault();
  const roomInput = document.getElementById("room-input");
  const passwordInput = document.getElementById("password-input");
  const feedback = document.getElementById("room-input-feedback");
  const roomName = roomInput.value.trim();
  const password = passwordInput.value.trim();

  if (!roomName || !password) {
    roomInput.classList.add("is-invalid");
    feedback.textContent = "Room name and password cannot be empty.";
    return;
  }

  const hasProfanity = await checkProfanity(roomName);
  if (hasProfanity) {
    roomInput.classList.add("is-invalid");
    feedback.textContent = "Room name contains inappropriate language.";
    return;
  }

  roomInput.classList.remove("is-invalid");
  feedback.textContent = "";
  myRoom = roomName;
  localStorage.setItem('myRoom', myRoom);
  localStorage.setItem('myRoomPassword', password); 
  socket.emit('join', { room: myRoom, password: password });
}

document.getElementById("join-form").addEventListener("submit", filterRoomName);

/* =========================================
   4. GAMEPLAY ACTIONS
   ========================================= */

window.prepareIngredient = function(type) {
  socket.emit('prepare_ingredient', { ingredient_type: type });
};

window.allowDrop = function(ev) { ev.preventDefault(); };

window.drag = function(ev) {
  ev.dataTransfer.setData("ingredient_id", ev.target.getAttribute("data-id"));
  ev.dataTransfer.setData("ingredient_type", ev.target.dataset.type);
};

window.dropToBuilder = function(ev) {
  ev.preventDefault();
  var ingredient_id = ev.dataTransfer.getData("ingredient_id");
  var ingredient_type = ev.dataTransfer.getData("ingredient_type");
  socket.emit('take_ingredient', { ingredient_id: ingredient_id });
  if (navigator.vibrate) navigator.vibrate(50);
  
  if (state.round === 1) {
    builderIngredients.push({ id: ingredient_id, type: ingredient_type }); 
    updateBuilderDisplay();
  }
};

window.dropToSharedBuilder = function(ev, sid) {
  ev.preventDefault();
  var ingredient_id = ev.dataTransfer.getData("ingredient_id");
  socket.emit('take_ingredient', { ingredient_id: ingredient_id, target_sid: sid });
};

function updateBuilderDisplay() {
  var builderDiv = document.getElementById("pizza-builder");
  builderDiv.innerHTML = "";
  builderIngredients.forEach(function(ing) {
    var item = document.createElement("div");
    item.classList.add("ingredient");
    item.innerText = ingredientEmoji[ing.type] || ing.type;
    builderDiv.appendChild(item);
  });
}

// Button Listeners
document.getElementById("submit-pizza").addEventListener("click", function() {
  if (state.round === 1 && builderIngredients.length === 0) {
    alert("No ingredients selected for pizza!");
    return;
  }
  socket.emit('build_pizza', {}); 
  builderIngredients = []; 
  updateBuilderDisplay();
});

document.getElementById("oven-on").addEventListener("click", function() { socket.emit('toggle_oven', { state: "on" }); });
document.getElementById("oven-off").addEventListener("click", function() { socket.emit('toggle_oven', { state: "off" }); });
document.getElementById("start-round").addEventListener("click", function() { socket.emit('start_round', {}); });

/* =========================================
   5. SOCKET CONNECTION HANDLERS
   ========================================= */
socket.on('connect', function() {
  if (pendingQrRoom) return; 

  if (isInitialConnect) {
    var roomModal = new bootstrap.Modal(document.getElementById('roomModal'), {
      backdrop: 'static',
      keyboard: false
    });
    roomModal.show();
    socket.emit('request_room_list');
    isInitialConnect = false;
  } else if (myRoom) {
    const password = localStorage.getItem('myRoomPassword') || prompt("Enter the password for room " + myRoom);
    if (password) {
      localStorage.setItem('myRoomPassword', password);
      socket.emit('join', { room: myRoom, password: password });
      console.log("Reconnecting to room:", myRoom);
    }
  }
});

socket.on('disconnect', function() {
  console.log("Disconnected from server");
  updateMessage("Disconnected. Attempting to reconnect...");
});

socket.on('reconnect', function() {
  console.log("Reconnected to server");
  updateMessage("Reconnected to room " + myRoom);
});

socket.on('join_error', function(data) {
  const qrModalEl = document.getElementById('qrAuthModal');
  const isQrOpen = qrModalEl && qrModalEl.classList.contains('show');

  if (isQrOpen) {
    const passInput = document.getElementById("qr-password-input");
    const feedback = document.getElementById("qr-feedback");
    passInput.classList.add("is-invalid");
    feedback.textContent = data.message;
  } else {
    const roomInput = document.getElementById("room-input");
    const passwordInput = document.getElementById("password-input");
    const roomFeedback = document.getElementById("room-input-feedback");
    const passwordFeedback = document.getElementById("password-input-feedback");

    if (data.message.includes("password")) {
      passwordInput.classList.add("is-invalid");
      passwordFeedback.textContent = data.message;
    } else {
      roomInput.classList.add("is-invalid");
      roomFeedback.textContent = data.message;
    }
  }
});

/* =========================================
   6. ROOM LIST & QR GENERATION
   ========================================= */
socket.on('room_list', function(data) {
  var tbody = document.getElementById('room-table-body');
  tbody.innerHTML = '';
  var rooms = Object.keys(data.rooms);

  if (rooms.length === 0) {
    var row = document.createElement('tr');
    var cell = document.createElement('td');
    cell.colSpan = 3;
    cell.classList.add("text-center", "text-muted");
    cell.innerText = 'No active rooms. Create one to start!';
    row.appendChild(cell);
    tbody.appendChild(row);
  } else {
    rooms.forEach(function(room) {
      var row = document.createElement('tr');
      var nameCell = document.createElement('td');
      nameCell.innerHTML = `<strong>${room}</strong>`;
      nameCell.style.verticalAlign = "middle";

      var countCell = document.createElement('td');
      var count = data.rooms[room];
      var badgeClass = count >= 5 ? "bg-danger" : "bg-success";
      countCell.innerHTML = `<span class="badge ${badgeClass}">${count}/5 Players</span>`;
      countCell.style.verticalAlign = "middle";

      var qrCell = document.createElement('td');
      var baseUrl = window.location.origin;
      var joinUrl = `${baseUrl}/?room=${encodeURIComponent(room)}`;
      var qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=100x100&margin=0&data=${encodeURIComponent(joinUrl)}`;
      
      var img = document.createElement('img');
      img.src = qrApiUrl;
      img.alt = "Scan to join " + room;
      img.className = "img-thumbnail";
      img.style.width = "80px";
      img.style.height = "80px";
      img.style.cursor = "pointer";
      img.onclick = function() {
         var win = window.open(qrApiUrl.replace("100x100", "400x400"), '_blank');
         if(win) win.focus();
      };

      qrCell.appendChild(img);
      row.appendChild(nameCell);
      row.appendChild(countCell);
      row.appendChild(qrCell);
      tbody.appendChild(row);
    });
  }
  renderHighScores(data.high_scores);
});

function renderHighScores(high_scores) {
  var scoresDiv = document.getElementById('high-scores');
  scoresDiv.innerHTML = '<h3>Top Scores</h3>';
  var table = document.createElement('table');
  table.className = 'table table-bordered';
  var thead = document.createElement('thead');
  thead.innerHTML = `<tr><th>Round</th><th>1st</th><th>2nd</th><th>3rd</th></tr>`;
  table.appendChild(thead);
  var tbody = document.createElement('tbody');

  for (let round = 1; round <= 3; round++) {
    var row = document.createElement('tr');
    var roundCell = document.createElement('td');
    roundCell.innerText = `Round ${round}`;
    row.appendChild(roundCell);
    for (let rank = 1; rank <= 3; rank++) {
      var rankCell = document.createElement('td');
      var scoreData = high_scores[round] ? high_scores[round][rank] : null; 
      if (scoreData && scoreData.room_name) {
        rankCell.innerText = `${scoreData.room_name} (${scoreData.score})`;
      } else {
        rankCell.innerText = '-';
      }
      row.appendChild(rankCell);
    }
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  scoresDiv.appendChild(table);
}

/* =========================================
   7. RENDERERS (Pizza & Builders)
   ========================================= */

function renderPizza(pizza, extraLabel) {
  var container = document.createElement("div");
  container.className = "d-flex align-items-center mb-2 p-2 border rounded bg-white";
  if (pizza.status) container.classList.add(pizza.status);

  // 1. Visual Pizza
  var visual = document.createElement("div");
  visual.className = "pizza-visual";

  if (pizza.ingredients && pizza.ingredients.sauce > 0) {
    visual.classList.add("has-sauce");
  }

  if (pizza.ingredients) {
    let toppingCount = 0;
    for (let i = 0; i < (pizza.ingredients.ham || 0); i++) {
        let span = document.createElement("span");
        span.className = `topping-icon pos-${(toppingCount % 5) + 1}`;
        span.innerText = "🥓";
        span.style.transform = `rotate(${Math.random() * 360}deg)`;
        visual.appendChild(span);
        toppingCount++;
    }
    for (let i = 0; i < (pizza.ingredients.pineapple || 0); i++) {
        let span = document.createElement("span");
        span.className = `topping-icon pos-${(toppingCount % 5) + 1}`;
        span.innerText = "🍍";
        visual.appendChild(span);
        toppingCount++;
    }
  }

  container.appendChild(visual);

  // 2. Text Details
  var details = document.createElement("div");
  details.innerHTML = `<strong>ID: ${pizza.pizza_id.slice(0,4)}</strong><br><small>${extraLabel}</small>`;
  container.appendChild(details);

  return container;
}

function renderPizzaBuilders(players) {
  var container = document.getElementById("pizza-builders-container");
  container.innerHTML = "";
  Object.keys(players).forEach(function(sid, index) {
    var colDiv = document.createElement("div");
    colDiv.classList.add("col-md-6");
    var builderDiv = document.createElement("div");
    builderDiv.classList.add("pizza-builder-container");
    builderDiv.innerHTML = `<h5>Builder #${index + 1}</h5>`;
    var ingredientsDiv = document.createElement("div");
    ingredientsDiv.classList.add("d-flex", "flex-wrap", "pizza-builder-dropzone");
    ingredientsDiv.setAttribute("ondrop", `dropToSharedBuilder(event, '${sid}')`);
    ingredientsDiv.setAttribute("ondragover", "allowDrop(event)");
    players[sid]["builder_ingredients"].forEach(function(ing) {
      var item = document.createElement("div");
      item.classList.add("ingredient");
      item.innerText = ingredientEmoji[ing.type] || ing.type;
      ingredientsDiv.appendChild(item);
    });
    builderDiv.appendChild(ingredientsDiv);
    var submitBtn = document.createElement("button");
    submitBtn.className = "btn btn-primary btn-custom mt-2";
    submitBtn.innerText = "Submit Pizza";
    submitBtn.onclick = function() {
      socket.emit('build_pizza', { player_sid: sid });
    };
    builderDiv.appendChild(submitBtn);
    colDiv.appendChild(builderDiv);
    container.appendChild(colDiv);

    if ('ontouchstart' in window) {
      ingredientsDiv.addEventListener("touchend", function(ev) {
        ev.preventDefault();
        if (touchSelectedIngredient) {
          socket.emit('take_ingredient', { ingredient_id: touchSelectedIngredient.id, target_sid: sid });
          touchSelectedIngredient = null;
          var selectedItems = document.querySelectorAll('.ingredient.selected');
          selectedItems.forEach(function(el) {
            el.classList.remove('selected');
          });
        }
      });
    }
  });
}

if ('ontouchstart' in window) {
  var builderDiv = document.getElementById("pizza-builder");
  builderDiv.addEventListener("touchend", function(ev) {
    ev.preventDefault();
    if (touchSelectedIngredient && state.round === 1) {
      socket.emit('take_ingredient', { ingredient_id: touchSelectedIngredient.id });
      builderIngredients.push({ id: touchSelectedIngredient.id, type: touchSelectedIngredient.type });
      updateBuilderDisplay();
      var selectedItems = document.querySelectorAll('.ingredient.selected');
      selectedItems.forEach(function(el) {
        el.classList.remove('selected');
      });
      touchSelectedIngredient = null;
    }
  });
}

/* =========================================
   8. GAME STATE & UI UPDATES
   ========================================= */

var state = {};

// THIS IS THE FUNCTION YOU WERE MISSING
function updateVisibility() {
  const pizzaBuilder = document.getElementById("pizza-builder");
  const submitPizza = document.getElementById("submit-pizza");
  const buildersContainer = document.getElementById("pizza-builders-container");
  const builderHeading = document.getElementById("builder-heading");

  if (state.round >= 1 && state.current_phase === "debrief" && state.round < state.max_rounds) {
    pizzaBuilder.style.display = "none";
    submitPizza.style.display = "none";
    buildersContainer.style.display = "flex";
    builderHeading.innerText = "Shared Pizza Builders";
    renderPizzaBuilders(state.players);
  } else if (state.round > 1) {
    pizzaBuilder.style.display = "none";
    submitPizza.style.display = "none";
    buildersContainer.style.display = "flex";
    builderHeading.innerText = "Shared Pizza Builders";
    if (state.current_phase === "round") {
      renderPizzaBuilders(state.players);
    }
  } else {
    pizzaBuilder.style.display = "flex";
    submitPizza.style.display = "inline-block";
    buildersContainer.style.display = "none";
    builderHeading.innerText = "Your Pizza Builder";
  }
}

function updateGameState(newState) {
  state = newState;
  console.log("Game State:", state);

  const playerCount = Object.keys(state.players).length;
  updateRoomLabels(myRoom || "Unknown", playerCount);
  
  if (state.current_phase === "round") {
    document.getElementById("game-area").style.display = "block";
    document.getElementById("start-round").style.display = "none";
  } else {
    document.getElementById("game-area").style.display = "none";
    document.getElementById("start-round").style.display = "inline-block";
  }

  updateVisibility(); // Now defined!

  var ordersDiv = document.getElementById("customer-orders");
  var ordersList = document.getElementById("orders-list");
  var orderCount = document.getElementById("order-count");
  if (state.round === 3 && state.current_phase === "round") {
    ordersDiv.style.display = "block";
    ordersList.innerHTML = "";
    state.customer_orders.forEach(function(order) {
      var card = document.createElement("div");
      card.classList.add("order-card");
      card.setAttribute("data-order-id", order.id);
      
      var idDiv = document.createElement("div");
      idDiv.classList.add("order-id");
      idDiv.innerText = `Order: ${order.id.slice(0, 6)}`;
      card.appendChild(idDiv);

      var ingredientsDiv = document.createElement("div");
      ingredientsDiv.classList.add("order-ingredients");
      var ingredientsText = [];
      if (order.ingredients.base > 0) ingredientsText.push(`${ingredientEmoji["base"]}x${order.ingredients.base}`);
      if (order.ingredients.sauce > 0) ingredientsText.push(`${ingredientEmoji["sauce"]}x${order.ingredients.sauce}`);
      if (order.ingredients.ham > 0) ingredientsText.push(`${ingredientEmoji["ham"]}x${order.ingredients.ham}`);
      if (order.ingredients.pineapple > 0) ingredientsText.push(`${ingredientEmoji["pineapple"]}x${order.ingredients.pineapple}`);
      ingredientsDiv.innerText = ingredientsText.join(" ");
      card.appendChild(ingredientsDiv);

      var emojiDiv = document.createElement("div");
      emojiDiv.classList.add("order-emoji");
      emojiDiv.innerHTML = orderEmoji[order.type] || '<div class="emoji-wrapper"><span class="emoji">🍕</span></div>';
      card.appendChild(emojiDiv);
      ordersList.appendChild(card);
    });
    orderCount.innerText = state.customer_orders.length;
  } else {
    ordersDiv.style.display = "none";
    orderCount.innerText = "0";
  }

  var poolDiv = document.getElementById("prepared-pool");
  poolDiv.innerHTML = "";
  state.prepared_ingredients.forEach(function(item) {
    var div = document.createElement("div");
    div.classList.add("ingredient");
    div.setAttribute("draggable", "true");
    div.setAttribute("data-id", item.id);
    div.dataset.type = item.type;
    div.innerText = ingredientEmoji[item.type] || item.type;
    div.addEventListener("dragstart", drag);
    if ('ontouchstart' in window) {
      div.addEventListener("touchstart", function(ev) {
        ev.preventDefault();
        touchSelectedIngredient = { id: item.id, type: item.type };
        div.classList.add("selected");
      });
    }
    poolDiv.appendChild(div);
  });

// Built Pizzas
  console.log("DEBUG — Oven state:", {
    is_oven_on: state.is_oven_on,
    oven: state.oven,
    max: state.max_pizzas_in_oven
}); 
  var builtDiv = document.getElementById("built-pizzas");
  builtDiv.innerHTML = "";
  
  // FIX 1: Corrected spelling of 'length'
  const isOvenFull = state.oven.length >= state.max_pizzas_in_oven;
  
  // This reads the actual state from the server
  const isOvenOn = state.is_oven_on == true; 

  state.built_pizzas.forEach(function(pizza) {
    var div = renderPizza(pizza, "");
    var btn = document.createElement("button");

    // FIX 2: Changed 'isOvenActive' to 'isOvenOn' to use the specific round state
    if (isOvenFull || isOvenOn) {
        btn.className = "btn btn-sm btn-secondary ms-2 disabled";
        // Update text based on why it's disabled
        btn.innerText = isOvenOn ? "Oven is ON" : "Oven Full";
        btn.disabled = true;
        div.style.opacity = "0.7";
    } else {
        btn.className = "btn btn-sm btn-outline-primary ms-2";
        btn.innerText = "Move to Oven";
        btn.onclick = function() {
            socket.emit('move_to_oven', { pizza_id: pizza.pizza_id });
        };
    }
    div.appendChild(btn);
    builtDiv.appendChild(div);
  });

  // Oven
  var ovenDiv = document.getElementById("oven");
  ovenDiv.innerHTML = "";
  state.oven.forEach(function(pizza) {
    var div = renderPizza(pizza, " ");
    ovenDiv.appendChild(div);
  });

  // Completed
  var compDiv = document.getElementById("completed");
  compDiv.innerHTML = "";
  state.completed_pizzas.forEach(function(pizza) {
    var div = renderPizza(pizza, " ");
    compDiv.appendChild(div);
  });

  // Wasted
  var wastedDiv = document.getElementById("wasted");
  wastedDiv.innerHTML = "";
  state.wasted_pizzas.forEach(function(pizza) {
    var div = renderPizza(pizza, "");
    wastedDiv.appendChild(div);
  });
}

function updateMessage(text) {
  document.querySelector("#messages .content").innerText = text;
}
function updateRoomLabels(room, playerCount) {
  document.getElementById("room-name-label").innerText = `${room}`;
  document.getElementById("player-count-label").innerText = `${playerCount}`;
}
setInterval(() => { socket.emit('time_request'); }, 1000);

/* =========================================
   9. GAME EVENTS
   ========================================= */

socket.on('game_state', function(newState) {
  updateGameState(newState);
  var joinModal = bootstrap.Modal.getInstance(document.getElementById('roomModal'));
  if (joinModal) joinModal.hide();
  var qrModal = bootstrap.Modal.getInstance(document.getElementById('qrAuthModal'));
  if (qrModal) qrModal.hide();
  if (pendingQrRoom) {
      window.history.replaceState({}, document.title, "/");
      pendingQrRoom = null;
  }
});

socket.on('round_started', function(data) {
  state.round = data.round;
  state.current_phase = "round";
  state.customer_orders = data.customer_orders;
  updateMessage("Round " + data.round + " started. Duration: " + data.duration + " sec");
  document.getElementById("game-area").style.display = "block";
  document.getElementById("start-round").style.display = "none";
  var debriefModalEl = document.getElementById('debriefModal');
  var debriefModal = bootstrap.Modal.getInstance(debriefModalEl);
  if (debriefModal) { debriefModal.hide(); }
  updateGameState(state);
});

socket.on('round_ended', function(result) {
  // Update Text Stats
  document.getElementById("debrief-pizzas-completed").innerText = result.completed_pizzas_count;
  document.getElementById("debrief-pizzas-wasted").innerText = result.wasted_pizzas_count;
  document.getElementById("debrief-pizzas-unsold").innerText = result.unsold_pizzas_count;
  document.getElementById("debrief-ingredients-left").innerText = result.ingredients_left_count || 0;
  document.getElementById("debrief-score").innerText = result.score;
  
  // Store Data for Tabs (but don't render yet)
  if (result.lead_times) {
      lastLeadTimeData = result.lead_times;
  }
  if (result.cfd_data) {
      lastCFDData = result.cfd_data;
  }
  
  if (state.round === 3) {
    document.getElementById("fulfilled-orders").style.display = "block";
    document.getElementById("remaining-orders").style.display = "block";
    document.getElementById("unmatched-pizzas").style.display = "block";
    document.getElementById("debrief-fulfilled-orders").innerText = result.fulfilled_orders_count || 0;
    document.getElementById("debrief-remaining-orders").innerText = result.remaining_orders_count || 0;
    document.getElementById("debrief-unmatched-pizzas").innerText = result.unmatched_pizzas_count || 0;
  } else {
    document.getElementById("fulfilled-orders").style.display = "none";
    document.getElementById("remaining-orders").style.display = "none";
    document.getElementById("unmatched-pizzas").style.display = "none";
  }

  const content = debriefContent[state.round] || { question: "Reflect on the round.", quote: "“Continuous improvement...”" };
  document.getElementById("debrief-question").innerText = content.question;
  document.getElementById("debrief-quote").innerText = content.quote;

  var debriefModal = new bootstrap.Modal(document.getElementById('debriefModal'), {});
  debriefModal.show();
  
  if (result.score > 0) {
     confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
  }
  
  // Force reset tabs to summary
  var triggerFirstTab = document.querySelector('#debriefTabs button[data-bs-target="#tab-summary"]');
  if(triggerFirstTab) {
      var tabInstance = bootstrap.Tab.getInstance(triggerFirstTab);
      if(!tabInstance) tabInstance = new bootstrap.Tab(triggerFirstTab);
      tabInstance.show();
  }
  
  updateVisibility();
});

socket.on('game_reset', function(state) {
  updateMessage("Round reset. Ready for a new round.");
  document.getElementById("timer").innerText = "Round Time:";
  document.getElementById("start-round").style.display = "inline-block";
  var debriefModalEl = document.getElementById('debriefModal');
  var modalInstance = bootstrap.Modal.getInstance(debriefModalEl);
  if (modalInstance) { modalInstance.hide(); }
  updateGameState(state);
});

socket.on('ingredient_prepared', function(item) { updateMessage("Ingredient prepared: " + (ingredientEmoji[item.type] || item.type)); });
socket.on('build_error', function(data) { updateMessage("Build Error: " + data.message); });
socket.on('pizza_built', function(pizza) { updateMessage("Pizza built: " + pizza.pizza_id); });
socket.on('oven_error', function(data) { updateMessage("Oven Error: " + data.message); });
socket.on('pizza_moved_to_oven', function(pizza) { updateMessage("Pizza moved to oven: " + pizza.pizza_id); });
socket.on('oven_toggled', function(data) {
  var isOn = (data.state === "on");

  // 1. Update the message
  updateMessage(isOn ? "Oven turned ON." : "Oven turned OFF.");
  
  // 2. Update the visual glowing effect
  var ovenContainer = document.getElementById("oven-container");
  if (isOn) { 
      ovenContainer.classList.add("oven-active"); 
  } else { 
      ovenContainer.classList.remove("oven-active"); 
  }

  // 3. Disable/Enable the buttons based on state
  var btnOn = document.getElementById("oven-on");
  var btnOff = document.getElementById("oven-off");
  
  if (btnOn && btnOff) {
      btnOn.disabled = isOn;       // If oven is ON, disable the "On" button
      btnOff.disabled = !isOn;     // If oven is ON, enable the "Off" button
  }
  
  // Optional: Trigger a refresh of the pizza list so "Move to Oven" buttons 
  // can be disabled while baking (if your game logic requires that).
  if (typeof updateGameState === "function" && typeof state !== "undefined") {
      // Add a flag to local state to track oven status for other functions
      state.is_oven_on = isOn; 
      updateGameState(state);
  }
});
socket.on('clear_shared_builder', function(data) { renderPizzaBuilders(state.players); });
socket.on('new_order', function(order) {
  updateMessage("New order received: " + order.type);
  state.customer_orders.push(order);
  updateGameState(state); 
});
socket.on('order_fulfilled', function(data) {
  updateMessage("Order fulfilled: " + data.order_id);
  var orderElement = document.querySelector(`[data-order-id="${data.order_id}"]`);
  if (orderElement) { orderElement.remove(); document.getElementById("order-count").innerText = state.customer_orders.length; }
});
socket.on('game_state_update', function(update) {
  if (update.customer_orders) state.customer_orders = update.customer_orders;
  if (update.pending_orders) state.pending_orders = update.pending_orders;
  updateGameState(state);
});
socket.on('room_expired', function(data) {
  updateMessage(data.message);
  var roomModal = new bootstrap.Modal(document.getElementById('roomModal'), { backdrop: 'static', keyboard: false });
  roomModal.show();
  socket.emit('request_room_list');
});
socket.on('time_response', function(data) {
  if (data.phase === "debrief") { document.getElementById("timer").innerText = "DEBRIEF:\n" + data.roundTimeRemaining + " sec"; }
  else if (data.phase === "round") { document.getElementById("timer").innerText = "Round Time:\n" + data.roundTimeRemaining + " sec"; }
  else { document.getElementById("timer").innerText = "Round Time:"; }
  document.getElementById("oven-timer").innerText = "Oven Time:\n" + data.ovenTime + " sec";
});

// Modal Handlers (Instructions)
var modalEl = document.getElementById("modal");
var modal = new bootstrap.Modal(modalEl);
var instBtn = document.getElementById("instructions-btn");
if(instBtn) instBtn.addEventListener("click", () => modal.show());
var instBtn0 = document.getElementById("instructions-btn0");
if(instBtn0) instBtn0.addEventListener("click", () => modal.show());
var closeBtn = document.getElementById("modal-close");
if(closeBtn) closeBtn.addEventListener("click", () => modal.hide());

// Listeners for Chart Tabs
var ltTab = document.getElementById('leadtime-tab');
if (ltTab) {
    ltTab.addEventListener('shown.bs.tab', function (e) {
        if (lastLeadTimeData) {
            renderLeadTimeChart(lastLeadTimeData); 
        }
    });
}

var cfdTab = document.getElementById('cfd-tab');
if (cfdTab) {
    cfdTab.addEventListener('shown.bs.tab', function (e) {
        if (lastCFDData) {
            renderCFD(lastCFDData); 
        }
    });
}

/* =========================================
   10. CHARTS
   ========================================= */

// UPDATED: Now accepts raw data and processes internally
function renderLeadTimeChart(rawLeadTimes) {
    const ctx = document.getElementById('leadTimeChart').getContext('2d');
    if (leadTimeChart) { leadTimeChart.destroy(); }
    
    // Process Data
    rawLeadTimes.sort((a, b) => a.start_time - b.start_time);
    const labels = rawLeadTimes.map((lt, index) => `Pizza ${index + 1}`);
    const completedData = rawLeadTimes.map(lt => lt.status === "completed" ? lt.lead_time : null);
    const incompleteData = rawLeadTimes.map(lt => lt.status === "incomplete" ? lt.lead_time : null);

    leadTimeChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Completed',
                    data: completedData,
                    borderColor: '#28a745',
                    backgroundColor: 'rgba(40, 167, 69, 0.2)',
                    pointBackgroundColor: '#28a745',
                    fill: false, spanGaps: true
                },
                {
                    label: 'Incomplete',
                    data: incompleteData,
                    borderColor: '#dc3545', 
                    backgroundColor: 'rgba(220, 53, 69, 0.2)',
                    pointBackgroundColor: '#dc3545',
                    fill: false, spanGaps: true
                }
            ]
        },
        options: {
            maintainAspectRatio: false, // Bigger charts
            responsive: true,
            scales: {
                y: { beginAtZero: true, title: { display: true, text: 'Lead Time (Seconds)' } },
                x: { title: { display: true, text: 'Pizza Sequence' } }
            },
            plugins: { title: { display: true, text: 'Lead Times for All Pizzas' }, legend: { display: true } }
        }
    });
}

function renderCFD(historyData) {
    const ctx = document.getElementById('cfdChart').getContext('2d');
    if (cfdChartInstance) cfdChartInstance.destroy();

    const labels = historyData.map(d => d.time + "s");
    const dataDone = historyData.map(d => d.done);
    const dataOven = historyData.map(d => d.oven); 
    const dataBuilt = historyData.map(d => d.built); 
    
    cfdChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Done',
                    data: dataDone,
                    borderColor: '#28a745',
                    backgroundColor: 'rgba(40, 167, 69, 0.5)',
                    fill: true, tension: 0.4
                },
                {
                    label: 'In Oven',
                    data: dataOven,
                    borderColor: '#dc3545',
                    backgroundColor: 'rgba(220, 53, 69, 0.5)', 
                    fill: true, tension: 0.4
                },
                {
                    label: 'Built (Queue)',
                    data: dataBuilt,
                    borderColor: '#ffc107',
                    backgroundColor: 'rgba(255, 193, 7, 0.5)', 
                    fill: true, tension: 0.4
                }
            ]
        },
        options: {
            maintainAspectRatio: false, // Bigger charts
            responsive: true,
            scales: {
                y: { stacked: true, beginAtZero: true, title: { display: true, text: 'Number of Pizzas' } },
                x: { title: { display: true, text: 'Time (Seconds)' } }
            },
            plugins: {
                tooltip: { mode: 'index', intersect: false },
                title: { display: true, text: 'Work In Progress over Time' }
            }
        }
    });
}

/* =========================================
   11. FACILITATOR DASHBOARD LOGIC
   ========================================= */

// 1. Function to Open Modal (Attached to Window for HTML access)
window.openFacilitator = function() {
    // A. Close the Lobby (Room) Modal if it's open
    var lobbyEl = document.getElementById('roomModal');
    if (lobbyEl) {
        var lobbyInstance = bootstrap.Modal.getOrCreateInstance(lobbyEl);
        lobbyInstance.hide();
    }

    // B. Get the Facilitator Modal
    var facEl = document.getElementById('facilitatorModal');
    if (!facEl) {
        console.error("Facilitator modal not found!");
        return;
    }
    
    // C. Open Facilitator Modal
    var facInstance = bootstrap.Modal.getOrCreateInstance(facEl);
    facInstance.show();
    
    // D. Request Data immediately
    socket.emit('request_admin_dashboard');
    
    // E. Start Polling (Clear existing first to be safe)
    if (dashboardInterval) clearInterval(dashboardInterval);
    
    dashboardInterval = setInterval(() => {
        // Only poll if modal is actually visible
        if (facEl.classList.contains('show')) {
            socket.emit('request_admin_dashboard');
        } else {
            clearInterval(dashboardInterval);
        }
    }, 3000);
};

// 2. Handle Data from Server
socket.on('admin_dashboard_update', function(data) {
    const tbody = document.getElementById('facilitator-table-body');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    if (!data.rooms || data.rooms.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-muted">No active rooms found.</td></tr>';
        return;
    }

    data.rooms.forEach(room => {
        const row = document.createElement('tr');
        
        let phaseBadge = 'bg-secondary';
        if (room.phase === 'ROUND') phaseBadge = 'bg-success';
        if (room.phase === 'DEBRIEF') phaseBadge = 'bg-warning text-dark';

        row.innerHTML = `
            <td class="text-start fw-bold">${room.room} <span class="badge bg-light text-dark border">R${room.round}</span></td>
            <td><span class="badge ${phaseBadge}">${room.phase}</span></td>
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

// 3. Listener: When Facilitator closes, Re-open Lobby
var facModalEl = document.getElementById('facilitatorModal');
if (facModalEl) {
    facModalEl.addEventListener('hidden.bs.modal', function () {
        // Stop the polling timer
        if (dashboardInterval) {
            clearInterval(dashboardInterval);
            dashboardInterval = null;
        }
        
        // Re-open the Lobby Modal
        var lobbyEl = document.getElementById('roomModal');
        if (lobbyEl) {
            var lobbyInstance = bootstrap.Modal.getOrCreateInstance(lobbyEl);
            lobbyInstance.show();
            // Refresh the room list
            socket.emit('request_room_list');
        }
    });
}
