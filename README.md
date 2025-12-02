# Kanban Pizza 🍕
Kanban Pizza is a collaborative, multiplayer game that simulates a pizza-making workflow using Kanban principles. Built with Flask and SocketIO, it runs as a web application where players work together to prepare ingredients, build pizzas, and fulfill customer orders across three rounds of increasing complexity.

**Play it live at:** [kanbanpizzagame.onrender.com](https://kanbanpizzagame.onrender.com)

## Features
- **Three Rounds**:  
  - **Round 1**: Individual pizza building with simple rules (WIP limits & Batch size).  
  - **Round 2**: Collaborative building using shared pizza builders.  
  - **Round 3**: Match 15 customer orders with varied ingredient combos (Value Stream management).
    
- **Real-Time Gameplay**: 
  - Powered by **Flask-SocketIO** for instant state synchronization across all clients.
  - **Client-Side Prediction**: Local timers and logic reduce server load and latency.

- **Rich User Experience**:
  - **Mobile Optimized**: Smooth drag-and-drop interactions using **SortableJS**.
  - **Audio Feedback**: Sound effects for game events using **Howler.js**.
  - **Confetti**: Visual rewards for high scores.
  
- **Analytics & Debrief**:  
  - **Lead Time Chart**: Tracks how long each pizza took from the first ingredient created to baking.
  - **Cumulative Flow Diagram (CFD)**: Visualizes the flow of work and bottlenecks over time.
  - **High Scores**: Persistent leaderboard (SQLite/PostgreSQL).

# Kanban/Agile Principles

| Round | Description | Kanban Principles | Agile Principles |
|-------|-------------|-------------------|------------------|
| **1** | **Workflow Visualization and WIP Limits**<br>Teams visualize their workflow and implement Work-In-Progress (WIP) limits to optimize production. | - Visualize the workflow<br>- Limit Work in Progress (WIP) | - Simplicity—the art of maximizing the amount of work not done<br>- Continuous attention to technical excellence |
| **2** | **Enhanced Collaboration**<br>Teams utilize shared pizza builders, emphasizing collaboration to improve efficiency and quality. | - Manage flow<br>- Make process policies explicit | - Individuals and interactions over processes and tools<br>- Business people and developers must work together daily throughout the project |
| **3** | **Customer Orders and Flow Management**<br>Teams handle specific customer orders, adapting their processes to manage flow and meet customer demands effectively. | - Implement feedback loops<br>- Improve collaboratively and experimentally | - Responding to change over following a plan<br>- At regular intervals, the team reflects on how to become more effective, then tunes and adjusts its behavior accordingly |

## Prerequisites
- Python 3.8+  
- Git  
- A web browser (Chrome, Firefox, Safari)

## Setup Instructions
1. **Clone the Repository**:  
   `git clone https://github.com/adamclement-exe/kanbanpizza.git`
   `cd kanbanpizza`

2. **Create a Virtual Environment**:  
   `python -m venv venv`
   
   *On Unix/Linux/Mac:*
   `source venv/bin/activate`
   
   *On Windows:* 
   `venv\Scripts\activate`

3. **Install Dependencies**:  
   `pip install -r requirements.txt`
   
4. **Run the Application**:  
   `python main.py`

5. **Open your browser** to `http://localhost:5000`.

## How to Play
1. **Join a Room**: Enter a room name and password on the welcome screen. Use the generated QR code to invite mobile players.
2. **Round 1**: Prepare ingredients (base, sauce, ham, pineapple) individually. Build and bake pizzas meeting specific criteria (1 base, 1 sauce, 4 ham or 2 ham + 2 pineapple).
3. **Round 2**: Collaborate using shared builders to optimize production and clear bottlenecks.
4. **Round 3**: Fulfill 15 specific customer orders shown as Kanban cards (e.g., "Order: abc123", "🟡x1 🔴x1 🥓x4", "🍕🥓"). Match ingredients exactly to avoid waste.
5. **Debrief Phase**: After rounds end, view the **Scoreboard**, **Lead Time Chart**, and **CFD Chart**.
6. **Scoring**: Earn points for completed pizzas and fulfilled orders; lose points for waste (burnt/raw) or unmatched pizzas.

## Deployment on Render
This project is optimized for Render. To deploy your own instance:
1. **Fork this Repository** to your GitHub account.
2. **Create a New Web Service on Render**: Connect your forked repo. 
   - **Runtime**: Python 3
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `gunicorn --worker-class eventlet -w 1 main:app`
3. **Environment Variables**:
   - `SECRET_KEY`: (Any random string)
   - `dbpass`: (Optional) Connection string for PostgreSQL. If omitted, uses SQLite (data resets on restart).
4. **Deploy**: Render will build and deploy.

> **Note:** Because this app uses In-Memory storage for active game states (unless Redis is configured), it is set to use 1 worker (`-w 1`) to ensure all players in a room connect to the same process.

## Tech Stack
- **Backend**: Python, Flask, Flask-SocketIO, SQLAlchemy.
- **Frontend**: Vanilla JavaScript (ES6 Modules), Bootstrap 5.
- **Libraries**: 
  - `SortableJS` (Drag & Drop)
  - `Howler.js` (Audio)
  - `Chart.js` (Analytics)
  - `Canvas-Confetti` (Visuals)
  
### File Structure:
- `static/js/main.js` – Core game logic (Socket listeners, UI updates).
- `static/css/main.css` – Styling, animations, and responsive adjustments.
- `main.py` – Server entry point, socket event handlers, and game state logic.
- `templates/index.html` – Single page application structure.

## How to Contribute
1. **Fork and clone the repo**.
2. **Make changes** and test locally.
3. **Submit a pull request**.

## License
This project is open-source under the MIT License. Feel free to use, modify, and share!

![logo](https://raw.githubusercontent.com/adamclement-exe/kanbanpizza/326d4322bd2236181951d0e9289dceb2cac1b640/static/logo.svg)
