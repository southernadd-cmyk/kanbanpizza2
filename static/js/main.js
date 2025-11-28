/* =========================================
   GLOBAL VARIABLES & SETUP
   ========================================= */
var socket = io({ transports: ['websocket', 'polling'], reconnection: true });
var myRoom = localStorage.getItem('myRoom') || "";
var isInitialConnect = true;
var pendingQrRoom = null; // Stores room name if user scans a QR code

/* =========================================
   1. QR CODE & URL ENTRY LOGIC
   ========================================= */
document.addEventListener("DOMContentLoaded", function() {
  // Check if user scanned a QR code (URL has ?room=Name)
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room');

  if (roomParam) {
    pendingQrRoom = roomParam; // Flag that we are in "QR Mode"

    // Populate and Show the Password-Only Modal
    document.getElementById('qr-room-name-display').innerText = roomParam;
    
    var qrModal = new bootstrap.Modal(document.getElementById('qrAuthModal'));
    qrModal.show();
    
    // Focus the password input automatically
    document.getElementById('qrAuthModal').addEventListener('shown.bs.modal', function () {
        document.getElementById('qr-password-input').focus();
    });
  }
});

// Handle the "Password Only" Form Submit
document.getElementById("qr-join-form").addEventListener("submit", function(e) {
  e.preventDefault();
  const password = document.getElementById("qr-password-input").value.trim();
  
  if (!password) return;
  
  // Set global variables so reconnects work
  localStorage.setItem('myRoom', pendingQrRoom);
  localStorage.setItem('myRoomPassword', password);
  myRoom = pendingQrRoom;

  socket.emit('join', { room: pendingQrRoom, password: password });
});

// Allow user to cancel QR join and go to main lobby
window.cancelQrJoin = function() {
  // Clear URL params
  window.history.pushState({}, document.title, "/");
  pendingQrRoom = null;
  
  // Hide QR modal
  bootstrap.Modal.getInstance(document.getElementById('qrAuthModal')).hide();
  
  // Show standard Lobby Modal
  var roomModal = new bootstrap.Modal(document.getElementById('roomModal'), {
      backdrop: 'static', 
      keyboard: false
  });
  roomModal.show();
  socket.emit('request_room_list');
};

/* =========================================
   2. STANDARD LOBBY LOGIC
   ========================================= */

// Swear filter using Purgomalum API
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
  localStorage.setItem('myRoomPassword', password); // Ensure pass is saved
  socket.emit('join', { room: myRoom, password: password });
}

document.getElementById("join-form").addEventListener("submit", filterRoomName);

/* =========================================
   3. SOCKET CONNECTION HANDLERS
   ========================================= */

socket.on('connect', function() {
  // IF user is currently on the QR Password screen, DO NOT open the main lobby
  if (pendingQrRoom) {
     return; 
  }

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
  // Check if we are using the QR Modal or the Main Modal
  const qrModalEl = document.getElementById('qrAuthModal');
  const isQrOpen = qrModalEl && qrModalEl.classList.contains('show');

  if (isQrOpen) {
    // Show error in the Password-Only Modal
    const passInput = document.getElementById("qr-password-input");
    const feedback = document.getElementById("qr-feedback");
    passInput.classList.add("is-invalid");
    feedback.textContent = data.message;
  } else {
    // Show error in the Main Lobby Modal
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
   4. ROOM LIST & QR GENERATION (TABLE)
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

      // 1. Room Name
      var nameCell = document.createElement('td');
      nameCell.innerHTML = `<strong>${room}</strong>`;
      nameCell.style.verticalAlign = "middle";

      // 2. Players Count
      var countCell = document.createElement('td');
      var count = data.rooms[room];
      var badgeClass = count >= 5 ? "bg-danger" : "bg-success";
      countCell.innerHTML = `<span class="badge ${badgeClass}">${count}/5 Players</span>`;
      countCell.style.verticalAlign = "middle";

      // 3. QR Code (IN THE TABLE)
      var qrCell = document.createElement('td');
      
      // Calculate URL: Current domain + ?room=RoomName (NO Password)
      var baseUrl = window.location.origin;
      var joinUrl = `${baseUrl}/?room=${encodeURIComponent(room)}`;
      
      // Generate Image
      var qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=100x100&margin=0&data=${encodeURIComponent(joinUrl)}`;
      
      var img = document.createElement('img');
      img.src = qrApiUrl;
      img.alt = "Scan to join " + room;
      img.className = "img-thumbnail";
      img.style.width = "80px";
      img.style.height = "80px";
      img.style.cursor = "pointer";
      img.title = "Click to enlarge";
      
      // Click to enlarge logic
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
   5. GAME STATE & UI UPDATES
   ========================================= */

var builderIngredients = [];
var touchSelectedIngredient = null;
var ingredientEmoji = {
  "base": "🟡",
  "sauce": "🔴",
  "ham": "🥓",
  "pineapple": "🍍"
};
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
  1: {
    question: "Reflect on the round: How did you identify and streamline your pizza-making process? Did the oven’s WIP limit of 3 pizzas affect your strategy?",
    quote: "“Working software is the primary measure of progress.” – Agile Manifesto. In this case, think of 'working software' as successfully baked pizzas!"
  },
  2: {
    question: "Reflect on the round: How did collaboration with your team impact your pizza production? Did sharing builders help or hinder your flow?",
    quote: "“Individuals and interactions over processes and tools.” – Agile Manifesto. Collaboration is key to adapting and improving!"
  },
  3: {
    question: "Reflect on the round: How did customer orders change your priorities? Were you able to balance order fulfillment with minimizing waste?",
    quote: "“Customer collaboration over contract negotiation.” – Agile Manifesto. Meeting customer needs drives success!"
  }
};

function updateMessage(text) {
  document.querySelector("#messages .content").innerText = text;
}

function updateRoomLabels(room, playerCount) {
  document.getElementById("room-name-label").innerText = `${room}`;
  document.getElementById("player-count-label").innerText = `${playerCount}`;
}

setInterval(() => {
  socket.emit('time_request');
}, 1000);

socket.on('game_state', function(newState) {
  updateGameState(newState);
  
  // Close the Main Lobby Modal
  var joinModal = bootstrap.Modal.getInstance(document.getElementById('roomModal'));
  if (joinModal) joinModal.hide();
  
  // Close the QR Password Modal
  var qrModal = bootstrap.Modal.getInstance(document.getElementById('qrAuthModal'));
  if (qrModal) qrModal.hide();
  
  // Clean the URL (remove ?room=X) so refresh doesn't trigger logic again
  if (pendingQrRoom) {
      window.history.replaceState({}, document.title, "/");
      pendingQrRoom = null;
  }
});

// Instructions Modal Logic
var modalEl = document.getElementById("modal");
var modal = new bootstrap.Modal(modalEl);
var instBtn = document.getElementById("instructions-btn");
if(instBtn) instBtn.addEventListener("click", () => modal.show());

var instBtn0 = document.getElementById("instructions-btn0");
if(instBtn0) instBtn0.addEventListener("click", () => modal.show());

var closeBtn = document.getElementById("modal-close");
if(closeBtn) closeBtn.addEventListener("click", () => modal.hide());

socket.on('time_response', function(data) {
  if (data.phase === "debrief") {
    document.getElementById("timer").innerText = "DEBRIEF:\n" + data.roundTimeRemaining + " sec";
  } else if (data.phase === "round") {
    document.getElementById("timer").innerText = "Round Time:\n" + data.roundTimeRemaining + " sec";
  } else {
    document.getElementById("timer").innerText = "Round Time:";
  }
  document.getElementById("oven-timer").innerText = "Oven Time:\n" + data.ovenTime + " sec";
});

function allowDrop(ev) { ev.preventDefault(); }
function drag(ev) {
  ev.dataTransfer.setData("ingredient_id", ev.target.getAttribute("data-id"));
  ev.dataTransfer.setData("ingredient_type", ev.target.dataset.type);
}
function dropToBuilder(ev) {
  ev.preventDefault();
  var ingredient_id = ev.dataTransfer.getData("ingredient_id");
  var ingredient_type = ev.dataTransfer.getData("ingredient_type");
  socket.emit('take_ingredient', { ingredient_id: ingredient_id });
  if (navigator.vibrate) navigator.vibrate(50); 
  if (state.round === 1) {
    builderIngredients.push({ id: ingredient_id, type: ingredient_type }); 
    updateBuilderDisplay();
  }
}

document.getElementById("submit-pizza").addEventListener("click", function() {
  if (state.round === 1 && builderIngredients.length === 0) {
    alert("No ingredients selected for pizza!");
    return;
  }
  socket.emit('build_pizza', {}); 
  builderIngredients = []; 
  updateBuilderDisplay();
});

function dropToSharedBuilder(ev, sid) {
  ev.preventDefault();
  var ingredient_id = ev.dataTransfer.getData("ingredient_id");
  var ingredient_type = ev.dataTransfer.getData("ingredient_type");
  socket.emit('take_ingredient', { ingredient_id: ingredient_id, target_sid: sid });
}
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
function prepareIngredient(type) {
  socket.emit('prepare_ingredient', { ingredient_type: type });
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

var state = {};
function updateGameState(newState) {
  state = newState;
  console.log("Game State:", state);

  const playerCount = Object.keys(state.players).length;
  updateRoomLabels(myRoom || "Unknown", playerCount);
  if (state.lead_times) {
        prepareChartData(state.lead_times);
    }
  if (state.current_phase === "round") {
    document.getElementById("game-area").style.display = "block";
    document.getElementById("start-round").style.display = "none";
  } else {
    document.getElementById("game-area").style.display = "none";
    document.getElementById("start-round").style.display = "inline-block";
  }

  updateVisibility();

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
        var previouslySelected = document.querySelectorAll('.ingredient.selected');
        previouslySelected.forEach(function(el) {
          el.classList.remove('selected');
        });
        touchSelectedIngredient = { id: item.id, type: item.type };
        div.classList.add("selected");
      });
    }
    poolDiv.appendChild(div);
  });

function renderPizza(pizza, extraLabel) {
  var container = document.createElement("div");
  container.className = "d-flex align-items-center mb-2 p-2 border rounded bg-white";
  if (pizza.status) container.classList.add(pizza.status); // keeps red/green tint

  // 1. Create the Visual Pizza Div
  var visual = document.createElement("div");
  visual.className = "pizza-visual";

  // Check Base & Sauce
  if (pizza.ingredients && pizza.ingredients.sauce > 0) {
    visual.classList.add("has-sauce");
  }

  // Render Toppings
  if (pizza.ingredients) {
    let toppingCount = 0;

    // Add Ham
    for (let i = 0; i < (pizza.ingredients.ham || 0); i++) {
        let span = document.createElement("span");
        span.className = `topping-icon pos-${(toppingCount % 5) + 1}`;
        span.innerText = "🥓";
        // slight random offset to look organic
        span.style.transform = `rotate(${Math.random() * 360}deg)`;
        visual.appendChild(span);
        toppingCount++;
    }

    // Add Pineapple
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

  var builtDiv = document.getElementById("built-pizzas");
  builtDiv.innerHTML = "";
  state.built_pizzas.forEach(function(pizza) {
    var div = renderPizza(pizza, "");
    var btn = document.createElement("button");
    btn.className = "btn btn-sm btn-outline-primary ms-2";
    btn.innerText = "Move to Oven";
    btn.onclick = function() {
      socket.emit('move_to_oven', { pizza_id: pizza.pizza_id });
    };
    div.appendChild(btn);
    builtDiv.appendChild(div);
  });

  var ovenDiv = document.getElementById("oven");
  ovenDiv.innerHTML = "";
  state.oven.forEach(function(pizza) {
    var div = renderPizza(pizza, " ");
    ovenDiv.appendChild(div);
  });

  var compDiv = document.getElementById("completed");
  compDiv.innerHTML = "";
  state.completed_pizzas.forEach(function(pizza) {
    var div = renderPizza(pizza, " ");
    compDiv.appendChild(div);
  });

  var wastedDiv = document.getElementById("wasted");
  wastedDiv.innerHTML = "";
  state.wasted_pizzas.forEach(function(pizza) {
    var div = renderPizza(pizza, "");
    wastedDiv.appendChild(div);
  });
}

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

socket.on('round_started', function(data) {
  state.round = data.round;
  state.current_phase = "round";
  state.customer_orders = data.customer_orders;
  updateMessage("Round " + data.round + " started. Duration: " + data.duration + " sec");
  document.getElementById("game-area").style.display = "block";
  document.getElementById("start-round").style.display = "none";
  var debriefModalEl = document.getElementById('debriefModal');
  var debriefModal = bootstrap.Modal.getInstance(debriefModalEl);
  if (debriefModal) {
    debriefModal.hide();
  }
  updateGameState(state);
});

socket.on('round_ended', function(result) {
  document.getElementById("debrief-pizzas-completed").innerText = result.completed_pizzas_count;
  document.getElementById("debrief-pizzas-wasted").innerText = result.wasted_pizzas_count;
  document.getElementById("debrief-pizzas-unsold").innerText = result.unsold_pizzas_count;
  document.getElementById("debrief-ingredients-left").innerText = result.ingredients_left_count || 0;
  document.getElementById("debrief-score").innerText = result.score;
  if (result.lead_times) {
    prepareChartData(result.lead_times);
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

  const content = debriefContent[state.round] || {
    question: "Reflect on the round.",
    quote: "“Continuous improvement is better than delayed perfection.” – Agile principle."
  };
  document.getElementById("debrief-question").innerText = content.question;
  document.getElementById("debrief-quote").innerText = content.quote;

  var debriefModal = new bootstrap.Modal(document.getElementById('debriefModal'), {});
  debriefModal.show();
  updateVisibility();
});

socket.on('game_reset', function(state) {
  updateMessage("Round reset. Ready for a new round.");
  document.getElementById("timer").innerText = "Round Time:";
  document.getElementById("start-round").style.display = "inline-block";
  var debriefModalEl = document.getElementById('debriefModal');
  var modalInstance = bootstrap.Modal.getInstance(debriefModalEl);
  if (modalInstance) {
    modalInstance.hide();
  }
  updateGameState(state);
});

socket.on('ingredient_prepared', function(item) {
  updateMessage("Ingredient prepared: " + (ingredientEmoji[item.type] || item.type));
});
socket.on('build_error', function(data) {
  updateMessage("Build Error: " + data.message);
});
socket.on('pizza_built', function(pizza) {
  updateMessage("Pizza built: " + pizza.pizza_id);
});
socket.on('oven_error', function(data) {
  updateMessage("Oven Error: " + data.message);
});
socket.on('pizza_moved_to_oven', function(pizza) {
  updateMessage("Pizza moved to oven: " + pizza.pizza_id);
});
socket.on('oven_toggled', function(data) {
  updateMessage((data.state === "on") ? "Oven turned ON." : "Oven turned OFF.");
  var ovenContainer = document.getElementById("oven-container");
  if (data.state === "on") {
    ovenContainer.classList.add("oven-active");
  } else {
    ovenContainer.classList.remove("oven-active");
  }
});
socket.on('clear_shared_builder', function(data) {
  renderPizzaBuilders(state.players);
});
socket.on('new_order', function(order) {
  updateMessage("New order received: " + order.type);
  state.customer_orders.push(order);
  var ordersList = document.getElementById("orders-list");
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
  document.getElementById("order-count").innerText = state.customer_orders.length;
});
socket.on('order_fulfilled', function(data) {
  updateMessage("Order fulfilled: " + data.order_id);
  var orderElement = document.querySelector(`[data-order-id="${data.order_id}"]`);
  if (orderElement) {
    orderElement.remove();
    document.getElementById("order-count").innerText = state.customer_orders.length;
  }
});

document.getElementById("oven-on").addEventListener("click", function() {
  socket.emit('toggle_oven', { state: "on" });
});
document.getElementById("oven-off").addEventListener("click", function() {
  socket.emit('toggle_oven', { state: "off" });
});
document.getElementById("start-round").addEventListener("click", function() {
  socket.emit('start_round', {});
});
window.addEventListener("beforeunload", function () {
  socket.disconnect();
});

socket.on('game_state_update', function(update) {
  if (update.customer_orders) state.customer_orders = update.customer_orders;
  if (update.pending_orders) state.pending_orders = update.pending_orders;
  updateGameState(state);
});

socket.on('room_expired', function(data) {
  updateMessage(data.message);
  var roomModal = new bootstrap.Modal(document.getElementById('roomModal'), {
    backdrop: 'static',
    keyboard: false
  });
  roomModal.show();
  socket.emit('request_room_list');
});

let leadTimeChart;

function prepareChartData(leadTimes) {
    leadTimes.sort((a, b) => a.start_time - b.start_time);
    const labels = leadTimes.map((lt, index) => `Pizza ${index + 1}`);
    const completedData = leadTimes.map(lt => lt.status === "completed" ? lt.lead_time : null);
    const incompleteData = leadTimes.map(lt => lt.status === "incomplete" ? lt.lead_time : null);
    renderLeadTimeChart(labels, completedData, incompleteData);
}

function renderLeadTimeChart(labels, completedData, incompleteData) {
    const ctx = document.getElementById('leadTimeChart').getContext('2d');
    if (leadTimeChart) {
        leadTimeChart.destroy();
    }
    leadTimeChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Completed Pizzas',
                    data: completedData,
                    borderColor: 'rgba(75, 192, 75, 1)',
                    backgroundColor: 'rgba(75, 192, 75, 0.2)',
                    pointBackgroundColor: 'rgba(75, 192, 75, 1)',
                    pointBorderColor: 'rgba(75, 192, 75, 1)',
                    fill: false,
                    spanGaps: true
                },
                {
                    label: 'Incomplete Pizzas',
                    data: incompleteData,
                    borderColor: 'rgba(255, 99, 132, 1)', 
                    backgroundColor: 'rgba(255, 99, 132, 0.2)',
                    pointBackgroundColor: 'rgba(255, 99, 132, 1)',
                    pointBorderColor: 'rgba(255, 99, 132, 1)',
                    fill: false,
                    spanGaps: true
                }
            ]
        },
        options: {
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'Lead Time (Seconds)' }
                },
                x: {
                    title: { display: true, text: 'Pizza Sequence' }
                }
            },
            plugins: {
                title: { display: true, text: 'Lead Times for All Pizzas' },
                legend: { display: true }
            }
        }
    });
}
