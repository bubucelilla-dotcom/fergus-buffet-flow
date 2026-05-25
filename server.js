const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const STATE_FILE = path.join(__dirname, 'state.json');

// --- PROGRAMMATIC DEFAULT STATE GENERATION (Aligns with app.js) ---
const getInitialState = () => {
  const tables = [];
  let tableCount = 1;
  const cols = 9;
  const startX = 40;
  const startY = 40;
  const stepX = 110;
  const stepY = 100;

  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < cols; c++) {
      if (tableCount > 53) break;
      
      const capacity = tableCount <= 3 ? 6 : 4;
      const shape = 'square';
      const width = capacity === 6 ? 100 : 70;
      const height = 70;
      
      tables.push({
        id: 't' + tableCount,
        name: `Mesa ${tableCount}`,
        capacity: capacity,
        shape: shape,
        width: width,
        height: height,
        x: startX + c * stepX,
        y: startY + r * stepY,
        status: 'available',
        guestName: '',
        guestPax: 0,
        guestTime: '',
        guestNotes: '',
        orders: []
      });
      tableCount++;
    }
  }

  const waitlist = [
    { id: 'w1', name: 'Habitación 105', pax: 4, priority: 'high', notes: 'Requiere trona para bebé', time: '18:42' },
    { id: 'w2', name: 'Habitación A02', pax: 2, priority: 'vip', notes: 'Mesa cerca de la ventana', time: '18:48' },
    { id: 'w3', name: 'Habitación 004', pax: 5, priority: 'normal', notes: 'Notas: Ninguna', time: '18:52' }
  ];

  const buffetItems = [
    "Sushi Roll de Salmón",
    "Noodles con Pollo Yakisoba",
    "Entrecot a la Parrilla",
    "Gyozas de Cerdo",
    "Patatas Bravas",
    "Croquetas de Jamón",
    "Hamburguesas Smash",
    "Tarta de Queso",
    "Bao de Pulled Pork",
    "Ensalada César"
  ];

  return {
    tables,
    waitlist,
    orders: [],
    leftGuestsCount: 0,
    replenishments: [],
    buffetItems,
    enteredRooms: ['105', 'A02', '004'] // Initial waitlisted rooms tracked
  };
};

// Global Server State
let state = {};

// Load State from file on startup
const loadState = () => {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const fileData = fs.readFileSync(STATE_FILE, 'utf8');
      state = JSON.parse(fileData);
      console.log('Servidor: Estado cargado con éxito desde state.json');
    } else {
      state = getInitialState();
      saveState();
      console.log('Servidor: Inicializado estado por defecto.');
    }
  } catch (err) {
    console.error('Error cargando el estado local, inicializando por defecto:', err);
    state = getInitialState();
  }
};

// Save State to file
const saveState = () => {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('Error guardando el archivo state.json:', err);
  }
};

loadState();

// Serve static web app files
app.use(express.static(__dirname));

// Direct route for main index page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Broadcast helper (sends message to all connected clients except the sender)
const broadcast = (data, senderWs) => {
  const rawMsg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client !== senderWs) {
      client.send(rawMsg);
    }
  });
};

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`Cliente conectado desde la IP: ${ip} (Conexiones activas: ${wss.clients.size})`);

  // Send current state immediately on connection
  ws.send(JSON.stringify({
    type: 'STATE_INIT',
    state: state
  }));

  // Handle incoming messages from clients
  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message);
      
      if (msg.type === 'STATE_UPDATE') {
        // Update server state
        state = msg.state;
        saveState();

        // Broadcast updated state to all OTHER clients
        broadcast({
          type: 'STATE_UPDATE',
          source: msg.source,
          state: state
        }, ws);
      }
    } catch (err) {
      console.error('Error procesando mensaje WebSocket:', err);
    }
  });

  ws.on('close', () => {
    console.log(`Cliente desconectado (Conexiones activas: ${wss.clients.size})`);
  });

  ws.on('error', (err) => {
    console.error('WebSocket Error:', err);
  });
});

// Ping interval to keep WebSocket connections alive (anti-idle cloud timeouts)
setInterval(() => {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.ping();
    }
  });
}, 25000);

// Start server listening
server.listen(PORT, '0.0.0.0', () => {
  console.log('====================================================');
  console.log(` Fergus Buffet flow - Servidor Activo `);
  console.log(` Puerto: ${PORT} `);
  console.log(` Acceso Local (Wi-Fi): http://localhost:${PORT} `);
  console.log('====================================================');
});
