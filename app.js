/**
 * Fergus Buffet flow - Core Application Logic
 * Implements real-time sync via BroadcastChannel and localStorage persistence.
 */

// WebSocket instance reference for network synchronization
let socket = null;
const wsProtocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
const wsUrl = wsProtocol + window.location.host;

// Sound synthesis fallback using Web Audio API in case external assets are blocked
const playOrderSound = () => {
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    
    osc.connect(gain);
    gain.connect(audioContext.destination);
    
    // Nice double chime
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, audioContext.currentTime); // D5
    gain.gain.setValueAtTime(0.1, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15);
    
    osc.frequency.setValueAtTime(880, audioContext.currentTime + 0.15); // A5
    gain.gain.setValueAtTime(0.1, audioContext.currentTime + 0.15);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.4);
    
    osc.start(audioContext.currentTime);
    osc.stop(audioContext.currentTime + 0.4);
  } catch (e) {
    console.warn('Audio context playback failed or blocked:', e);
  }
};

// Default table layout coordinates (used if no layout exists in localStorage)
const DEFAULT_TABLES = (() => {
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
      
      // First 3 tables are capacity 6. All others are capacity 4.
      const capacity = tableCount <= 3 ? 6 : 4;
      const shape = 'square';
      const width = capacity === 6 ? 100 : 70;
      const height = 70;
      
      const x = startX + c * stepX;
      const y = startY + r * stepY;
      
      tables.push({
        id: 't' + tableCount,
        name: `Mesa ${tableCount}`,
        capacity: capacity,
        shape: shape,
        width: width,
        height: height,
        x: x,
        y: y,
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
  return tables;
})();

// Default Waitlist entries for immediate demonstration
const DEFAULT_WAITLIST = [
  { id: 'w1', name: 'Habitación 105', pax: 4, priority: 'high', notes: 'Requiere trona para bebé', time: '18:42' },
  { id: 'w2', name: 'Habitación A02', pax: 2, priority: 'vip', notes: 'Mesa cerca de la ventana', time: '18:48' },
  { id: 'w3', name: 'Habitación 004', pax: 5, priority: 'normal', notes: 'Notas: Ninguna', time: '18:52' }
];

// Default Buffet items (used if no items exist in localStorage)
const DEFAULT_BUFFET_ITEMS = [
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

// App State Management
let state = {
  tables: [],
  waitlist: [],
  orders: [],
  leftGuestsCount: 0,
  replenishments: [],
  buffetItems: [],
  enteredRooms: []
};

// Load State from storage or initialize with defaults
const loadState = () => {
  const localTables = localStorage.getItem('bf_tables');
  const localWaitlist = localStorage.getItem('bf_waitlist');
  const localOrders = localStorage.getItem('bf_orders');
  const localLeftCount = localStorage.getItem('bf_left_count');
  const localReps = localStorage.getItem('bf_replenishments');
  const localBuffetItems = localStorage.getItem('bf_buffet_items');
  const localEnteredRooms = localStorage.getItem('bf_entered_rooms');

  const parsedTables = localTables ? JSON.parse(localTables) : null;
  state.tables = (parsedTables && parsedTables.length === 53) ? parsedTables : DEFAULT_TABLES;
  state.waitlist = localWaitlist ? JSON.parse(localWaitlist) : DEFAULT_WAITLIST;
  state.orders = localOrders ? JSON.parse(localOrders) : [];
  state.leftGuestsCount = localLeftCount ? parseInt(localLeftCount) : 0;
  state.replenishments = localReps ? JSON.parse(localReps) : [];
  state.buffetItems = localBuffetItems ? JSON.parse(localBuffetItems) : DEFAULT_BUFFET_ITEMS;
  state.enteredRooms = localEnteredRooms ? JSON.parse(localEnteredRooms) : [];
};

// Save State to localStorage and broadcast to server
const saveAndSyncState = (source = 'app') => {
  localStorage.setItem('bf_tables', JSON.stringify(state.tables));
  localStorage.setItem('bf_waitlist', JSON.stringify(state.waitlist));
  localStorage.setItem('bf_orders', JSON.stringify(state.orders));
  localStorage.setItem('bf_left_count', (state.leftGuestsCount || 0).toString());
  localStorage.setItem('bf_replenishments', JSON.stringify(state.replenishments));
  localStorage.setItem('bf_buffet_items', JSON.stringify(state.buffetItems));
  localStorage.setItem('bf_entered_rooms', JSON.stringify(state.enteredRooms));
  
  // Send state update via WebSocket
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'STATE_UPDATE',
      source: source,
      state: state
    }));
  }

  renderApp();
};

// Initialize WebSocket connection for real-time network sync
const connectWebSocket = () => {
  // If we are running off the file:// protocol, fallback to local only (no WebSocket possible)
  if (window.location.protocol === 'file:') {
    console.warn('Ejecutando desde archivo local (file://). Sincronización de red deshabilitada.');
    const statusDot = document.getElementById('sync-status');
    if (statusDot) {
      statusDot.innerHTML = '<span class="sync-dot" style="background-color: var(--text-muted); box-shadow: none;"></span> Solo Local (Offline)';
    }
    return;
  }

  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    console.log('WebSocket: Conectado al servidor de sincronización.');
    const statusDot = document.getElementById('sync-status');
    if (statusDot) {
      statusDot.innerHTML = '<span class="sync-dot"></span> Sincronizado';
      statusDot.style.color = '';
    }
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'STATE_INIT' || data.type === 'STATE_UPDATE') {
        state = data.state;
        
        // Cache to localStorage as local fallback
        localStorage.setItem('bf_tables', JSON.stringify(state.tables));
        localStorage.setItem('bf_waitlist', JSON.stringify(state.waitlist));
        localStorage.setItem('bf_orders', JSON.stringify(state.orders));
        localStorage.setItem('bf_left_count', (state.leftGuestsCount || 0).toString());
        localStorage.setItem('bf_replenishments', JSON.stringify(state.replenishments));
        localStorage.setItem('bf_buffet_items', JSON.stringify(state.buffetItems));
        localStorage.setItem('bf_entered_rooms', JSON.stringify(state.enteredRooms));

        // Play chime alert on specific views
        if (data.source === 'order_submitted' && currentRole === 'cocina') {
          playOrderSound();
        }
        if (data.source === 'restock_requested' && currentRole === 'cocina') {
          playOrderSound();
        }
        
        renderApp();
      }
    } catch (err) {
      console.error('Error parseando datos WebSocket:', err);
    }
  };

  socket.onclose = () => {
    console.warn('WebSocket: Conexión perdida. Reintentando en 3 segundos...');
    const statusDot = document.getElementById('sync-status');
    if (statusDot) {
      statusDot.innerHTML = '<span class="sync-dot" style="background-color: var(--color-rose); box-shadow: 0 0 8px var(--color-rose); animation: pulse-glow 1s infinite alternate;"></span> Desconectado';
      statusDot.style.color = 'var(--color-rose)';
    }
    setTimeout(connectWebSocket, 3000);
  };

  socket.onerror = (err) => {
    console.error('WebSocket Error:', err);
  };
};

// Navigation / Role View controller
let currentRole = 'puerta';
const views = ['puerta', 'sala', 'cocina', 'admin'];

const switchView = (role) => {
  if (!views.includes(role)) return;
  currentRole = role;

  // Toggle active class on navigation buttons
  document.querySelectorAll('.role-selector button').forEach(btn => {
    if (btn.dataset.role === role) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Toggle active class on views
  document.querySelectorAll('.view-section').forEach(section => {
    if (section.id === `view-${role}`) {
      section.classList.add('active');
    } else {
      section.classList.remove('active');
    }
  });

  // Clear selected editor properties on view switch
  if (role !== 'admin') {
    selectedEditorTableId = null;
    document.getElementById('table-properties-form').classList.add('hidden');
    document.getElementById('editor-properties-empty').classList.remove('hidden');
  }

  renderApp();
};

// Seating Flow: Keep track of selected waitlist client at Door
let selectedWaitlistGuestId = null;

// Temporary order basket for Sala Modal
let currentBasket = [];
let activeDetailTableId = null;

// Admin Layout Editor Selection state
let selectedEditorTableId = null;

// ==========================================
// RENDER FUNCTIONS
// ==========================================

const renderApp = () => {
  updateBadges();

  switch (currentRole) {
    case 'puerta':
      renderDoorView();
      break;
    case 'sala':
      renderSalaView();
      if (document.getElementById('modal-replenish').classList.contains('active')) {
        renderReplenishSelector();
      }
      break;
    case 'cocina':
      renderKitchenView();
      break;
    case 'admin':
      renderAdminView();
      break;
  }
};

// Update Header Notification Badges
const updateBadges = () => {
  const waitlistCount = state.waitlist.length;
  const badgeWait = document.getElementById('badge-waitlist');
  badgeWait.textContent = waitlistCount;
  badgeWait.style.display = waitlistCount > 0 ? 'inline-flex' : 'none';

  // Count active pending and preparing kitchen items (including replenishments)
  const activeOrdersCount = state.orders.filter(o => o.status !== 'served').length;
  const activeRepsCount = state.replenishments.filter(r => r.status !== 'replenished').length;
  const badgeKit = document.getElementById('badge-kitchen');
  badgeKit.textContent = activeOrdersCount + activeRepsCount;
  badgeKit.style.display = (activeOrdersCount + activeRepsCount) > 0 ? 'inline-flex' : 'none';

  // Waitlist count inside Door View
  const waitlistCountText = document.getElementById('waitlist-count');
  if (waitlistCountText) {
    waitlistCountText.textContent = `${waitlistCount} habitación${waitlistCount !== 1 ? 'es' : ''} en espera`;
  }
  
  // Kitchen stats inside Kitchen View
  const kitchenPendingText = document.getElementById('kitchen-pending-count');
  if (kitchenPendingText) {
    const pendingOrders = state.orders.filter(o => o.status === 'pending' || o.status === 'preparing').length;
    const pendingReps = state.replenishments.filter(r => r.status === 'pending' || r.status === 'preparing').length;
    kitchenPendingText.textContent = pendingOrders + pendingReps;
  }

  // Calculate guest pax totals
  const enteredPax = state.tables.reduce((sum, t) => sum + (t.guestPax || 0), 0);
  const waitingPax = state.waitlist.reduce((sum, g) => sum + (g.pax || 0), 0);
  const leftPax = state.leftGuestsCount || 0;

  // Update large scoreboard counters in Kitchen View (Vista Principal)
  const enteredLarge = document.getElementById('kitchen-entered-large');
  const waitingLarge = document.getElementById('kitchen-waiting-large');
  const leftLarge = document.getElementById('kitchen-left-large');

  if (enteredLarge) enteredLarge.textContent = enteredPax;
  if (waitingLarge) waitingLarge.textContent = waitingPax;
  if (leftLarge) leftLarge.textContent = leftPax;
};

// --- PUERTA VIEW RENDER ---
const renderDoorView = () => {
  const waitlistList = document.getElementById('waitlist-list');
  const tablesContainer = document.getElementById('door-tables-container');
  
  // Render Waitlist
  if (state.waitlist.length === 0) {
    waitlistList.innerHTML = `
      <div class="empty-state">
        <i class="fa-regular fa-face-smile"></i>
        <p>No hay clientes en espera.</p>
      </div>
    `;
  } else {
    waitlistList.innerHTML = state.waitlist.map(guest => {
      const isSelected = selectedWaitlistGuestId === guest.id;
      return `
        <div class="waitlist-item ${isSelected ? 'selected' : ''}" data-id="${guest.id}">
          <div class="waitlist-details">
            <div class="guest-title">
              ${guest.name} 
              <span class="guest-tag tag-${guest.priority}">${guest.priority.toUpperCase()}</span>
            </div>
            <div class="guest-meta">
              <span><i class="fa-solid fa-users"></i> ${guest.pax} pax</span>
              <span><i class="fa-solid fa-clock"></i> Espera: ${guest.time}</span>
              ${guest.notes ? `<span><i class="fa-solid fa-comment"></i> ${guest.notes}</span>` : ''}
            </div>
          </div>
          <div class="waitlist-actions">
            <button class="circle-btn circle-btn-danger btn-delete-waitlist" data-id="${guest.id}" title="Eliminar">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Attach click events to waitlist items for selection and deletion
    waitlistList.querySelectorAll('.waitlist-item').forEach(item => {
      item.addEventListener('click', (e) => {
        // Prevent trigger if trash button is clicked
        if (e.target.closest('.btn-delete-waitlist')) return;
        
        const guestId = item.dataset.id;
        if (selectedWaitlistGuestId === guestId) {
          selectedWaitlistGuestId = null;
        } else {
          selectedWaitlistGuestId = guestId;
        }
        renderApp();
      });
    });

    waitlistList.querySelectorAll('.btn-delete-waitlist').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const guestId = btn.dataset.id;
        const guest = state.waitlist.find(g => g.id === guestId);
        if (guest) {
          const roomNum = guest.name.replace('Habitación ', '').replace('Hab. ', '').trim();
          state.enteredRooms = state.enteredRooms.filter(r => r !== roomNum);
        }
        state.waitlist = state.waitlist.filter(g => g.id !== guestId);
        if (selectedWaitlistGuestId === guestId) selectedWaitlistGuestId = null;
        saveAndSyncState();
      });
    });
  }

  // Render Door seating assistance table grid (Compact)
  tablesContainer.innerHTML = state.tables.map(table => {
    let statusClass = `table-${table.status}`;
    let isSelectable = selectedWaitlistGuestId && table.status === 'available';
    
    // Create tooltip description
    let tooltip = `${table.name} (Capacidad: ${table.capacity} pax) - ${getSpanishStatus(table.status)}`;
    if (table.guestName) {
      tooltip += ` - ${table.guestName} (${table.guestPax} pax)`;
    }

    return `
      <div class="door-table-item-compact ${statusClass} ${isSelectable ? 'selectable-glow' : ''}" data-id="${table.id}" title="${tooltip}">
        <span class="compact-table-name">${table.name.replace('Mesa ', '')}</span>
        <span class="compact-table-cap"><i class="fa-solid fa-chair" style="font-size:8px;"></i> ${table.capacity}</span>
      </div>
    `;
  }).join('');

  // Seating click trigger
  tablesContainer.querySelectorAll('.door-table-item-compact').forEach(item => {
    item.addEventListener('click', () => {
      const tableId = item.dataset.id;
      const table = state.tables.find(t => t.id === tableId);
      
      if (selectedWaitlistGuestId && table.status === 'available') {
        const guest = state.waitlist.find(g => g.id === selectedWaitlistGuestId);
        
        // Seat guest
        table.status = 'seated';
        table.guestName = guest.name;
        table.guestPax = guest.pax;
        table.guestTime = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        table.guestNotes = guest.notes;
        table.orders = [];

        // Remove from waiting queue
        state.waitlist = state.waitlist.filter(g => g.id !== selectedWaitlistGuestId);
        selectedWaitlistGuestId = null;
        
        saveAndSyncState();
      } else {
        // Quick visual warning or open Table details directly
        switchView('sala');
        openTableDetails(tableId);
      }
    });
  });
};

// --- SALA VIEW RENDER ---
const renderSalaView = () => {
  const canvas = document.getElementById('floor-plan-sala');
  canvas.innerHTML = '';

  state.tables.forEach(table => {
    const tDiv = document.createElement('div');
    tDiv.className = `floor-table shape-${table.shape} ${table.status}`;
    tDiv.style.left = `${table.x}px`;
    tDiv.style.top = `${table.y}px`;
    tDiv.style.width = `${table.width}px`;
    tDiv.style.height = `${table.height}px`;
    tDiv.dataset.id = table.id;

    // Warning indicators
    let hasAlert = false;
    if (table.status === 'seated' || table.status === 'eating') {
      // Check if table has orders and check if cooking is delayed
      const tableOrders = state.orders.filter(o => o.tableId === table.id && o.status !== 'served');
      hasAlert = tableOrders.some(order => {
        const elapsedMin = Math.floor((Date.now() - order.timestamp) / 60000);
        return order.status !== 'ready' && elapsedMin > 10; // Red alert if waiting more than 10 mins
      });
    }

    if (hasAlert) {
      tDiv.classList.add('attention');
    }

    // Badge showing pending order items count
    const pendingItemsCount = state.orders
      .filter(o => o.tableId === table.id && o.status !== 'served')
      .reduce((acc, order) => acc + order.items.filter(i => i.status !== 'served').length, 0);

    let badgeHTML = '';
    if (pendingItemsCount > 0) {
      badgeHTML = `<span class="table-badge">${pendingItemsCount}</span>`;
    }

    tDiv.innerHTML = `
      ${badgeHTML}
      <span class="table-label">${table.name}</span>
      <span class="table-pax"><i class="fa-solid fa-user-friends"></i> Cap: ${table.capacity}</span>
      ${table.guestName ? `
        <span class="table-pax-count">
          <i class="fa-solid fa-users text-gradient-blue"></i> ${table.guestPax}
        </span>
      ` : ''}
    `;

    tDiv.addEventListener('click', () => {
      openTableDetails(table.id);
    });

    canvas.appendChild(tDiv);
  });

  // Render visual alerts for ready replenishments
  renderSalaReplenishAlerts();
};

const renderSalaReplenishAlerts = () => {
  const banner = document.getElementById('sala-replenish-ready-banner');
  if (!banner) return;

  const readyReps = state.replenishments.filter(r => r.status === 'ready');

  if (readyReps.length === 0) {
    banner.classList.add('hidden');
    banner.innerHTML = '';
    return;
  }

  banner.classList.remove('hidden');
  banner.innerHTML = readyReps.map(rep => `
    <div class="glass-card" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 20px; border-color: var(--color-rose); background: rgba(255, 8, 68, 0.05); box-shadow: 0 0 15px rgba(255, 8, 68, 0.15); animation: pulse-border 2s infinite alternate; border-radius: 12px; gap: 15px;">
      <span style="font-size: 14px; font-weight: 600; color: var(--text-primary);">
        <i class="fa-solid fa-bell fa-bounce" style="color: var(--color-rose); margin-right: 8px;"></i> 
        ¡REPOSICIÓN LISTA! El plato <strong style="color: var(--color-cyan); text-transform: uppercase;">${rep.name}</strong> está listo en cocina. Recógelo y colócalo en el buffet.
      </span>
      <button type="button" class="btn btn-success btn-small btn-confirm-placed" data-id="${rep.id}" style="padding: 6px 12px; font-size: 11px; flex-shrink: 0;">
        <i class="fa-solid fa-circle-check"></i> Colocado en Buffet
      </button>
    </div>
  `).join('');

  // Attach event handlers
  banner.querySelectorAll('.btn-confirm-placed').forEach(btn => {
    btn.addEventListener('click', () => {
      const repId = btn.dataset.id;
      const rep = state.replenishments.find(r => r.id === repId);
      if (rep) {
        rep.status = 'replenished';
        saveAndSyncState();
      }
    });
  });
};

// --- KITCHEN VIEW RENDER ---
const renderKitchenView = () => {
  const colPending = document.getElementById('list-kitchen-pending');
  const colPreparing = document.getElementById('list-kitchen-preparing');
  const colReady = document.getElementById('list-kitchen-ready');

  colPending.innerHTML = '';
  colPreparing.innerHTML = '';
  colReady.innerHTML = '';

  const activeOrders = state.orders.filter(o => o.status !== 'served');
  const activeReps = state.replenishments.filter(r => r.status !== 'replenished');

  if (activeOrders.length === 0 && activeReps.length === 0) {
    const placeholder = `<div class="empty-state"><i class="fa-solid fa-circle-check"></i><p>Sin comandas ni reposiciones</p></div>`;
    colPending.innerHTML = placeholder;
    colPreparing.innerHTML = placeholder;
    colReady.innerHTML = placeholder;
    
    // Reset column header counters
    const countPendingEl = document.getElementById('col-count-pending');
    const countPreparingEl = document.getElementById('col-count-preparing');
    const countReadyEl = document.getElementById('col-count-ready');
    if (countPendingEl) countPendingEl.textContent = '0';
    if (countPreparingEl) countPreparingEl.textContent = '0';
    if (countReadyEl) countReadyEl.textContent = '0';
    return;
  }

  // Render Table Orders
  activeOrders.forEach(order => {
    const elapsedMinutes = Math.floor((Date.now() - order.timestamp) / 60000);
    const orderCard = document.createElement('div');
    orderCard.className = `order-card priority-${order.priority || 'normal'}`;
    orderCard.dataset.id = order.id;

    // Format items list HTML
    const itemsHTML = order.items.map(item => `
      <li class="order-item-row">
        <span><span class="order-item-qty">${item.qty}x</span> <span class="order-item-name">${item.name}</span></span>
        <span class="status-badge" style="font-size: 9px; padding: 2px 6px;">${getSpanishItemStatus(item.status)}</span>
      </li>
    `).join('');

    let actionButton = '';
    if (order.status === 'pending') {
      actionButton = `
        <button class="btn btn-warning btn-small btn-start-order" data-id="${order.id}">
          <i class="fa-solid fa-fire-burner"></i> Cocinar
        </button>
      `;
    } else if (order.status === 'preparing') {
      actionButton = `
        <button class="btn btn-success btn-small btn-ready-order" data-id="${order.id}">
          <i class="fa-solid fa-circle-check"></i> Listo
        </button>
      `;
    } else if (order.status === 'ready') {
      actionButton = `
        <button class="btn btn-primary btn-small btn-serve-order" data-id="${order.id}">
          <i class="fa-solid fa-concierge-bell"></i> Servido
        </button>
      `;
    }

    // Danger class if waiting too long
    const elapsedClass = elapsedMinutes > 10 ? 'late' : '';
    const elapsedText = elapsedMinutes > 10 ? `${elapsedMinutes} min (Retrasado)` : `${elapsedMinutes} min`;

    orderCard.innerHTML = `
      <div class="order-header-flex">
        <span class="order-table-title">${order.tableName}</span>
        <span class="order-time">${new Date(order.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      <ul class="order-items-list">
        ${itemsHTML}
      </ul>
      <div class="order-footer-flex">
        <span class="order-elapsed ${elapsedClass}">
          <i class="fa-regular fa-clock"></i> ${elapsedText}
        </span>
        ${actionButton}
      </div>
    `;

    // Append to corresponding column
    if (order.status === 'pending') {
      colPending.appendChild(orderCard);
    } else if (order.status === 'preparing') {
      colPreparing.appendChild(orderCard);
    } else if (order.status === 'ready') {
      colReady.appendChild(orderCard);
    }
  });

  // Render Buffet Replenishments
  activeReps.forEach(rep => {
    const elapsedMinutes = Math.floor((Date.now() - rep.timestamp) / 60000);
    const repCard = document.createElement('div');
    repCard.className = `order-card replenishment-card`;
    repCard.style.borderLeft = `4px solid var(--color-rose)`;
    repCard.dataset.id = rep.id;

    let actionButton = '';
    if (rep.status === 'pending') {
      actionButton = `
        <button class="btn btn-warning btn-small btn-start-rep" data-id="${rep.id}">
          <i class="fa-solid fa-fire-burner"></i> Cocinar
        </button>
      `;
    } else if (rep.status === 'preparing') {
      actionButton = `
        <button class="btn btn-success btn-small btn-ready-rep" data-id="${rep.id}">
          <i class="fa-solid fa-circle-check"></i> Listo
        </button>
      `;
    } else if (rep.status === 'ready') {
      actionButton = `
        <button class="btn btn-primary btn-small btn-complete-rep" data-id="${rep.id}">
          <i class="fa-solid fa-circle-check"></i> Repuesto
        </button>
      `;
    }

    const elapsedClass = elapsedMinutes > 5 ? 'late' : '';
    const elapsedText = elapsedMinutes > 5 ? `${elapsedMinutes} min (Retrasado)` : `${elapsedMinutes} min`;

    repCard.innerHTML = `
      <div class="order-header-flex" style="border-bottom: 1px dashed rgba(255, 8, 68, 0.2); padding-bottom: 6px; margin-bottom: 8px;">
        <span class="order-table-title" style="color: var(--color-rose); font-size: 14px;"><i class="fa-solid fa-arrows-rotate"></i> REPOSICIÓN</span>
        <span class="order-time">${new Date(rep.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      <ul class="order-items-list" style="margin-bottom: 10px;">
        <li class="order-item-row" style="font-weight: 700; font-size: 14px; color: var(--text-primary);">
          <span><span class="order-item-qty" style="color: var(--color-rose);">1x</span> ${rep.name}</span>
        </li>
      </ul>
      <div class="order-footer-flex">
        <span class="order-elapsed ${elapsedClass}">
          <i class="fa-regular fa-clock"></i> ${elapsedText}
        </span>
        ${actionButton}
      </div>
    `;

    // Append to corresponding column
    if (rep.status === 'pending') {
      colPending.appendChild(repCard);
    } else if (rep.status === 'preparing') {
      colPreparing.appendChild(repCard);
    } else if (rep.status === 'ready') {
      colReady.appendChild(repCard);
    }
  });

  // Attach table order button triggers
  colPending.querySelectorAll('.btn-start-order').forEach(btn => {
    btn.addEventListener('click', () => {
      const orderId = btn.dataset.id;
      const order = state.orders.find(o => o.id === orderId);
      if (order) {
        order.status = 'preparing';
        order.items.forEach(i => i.status = 'preparing');
        // Update table status to eating if it was only seated
        const table = state.tables.find(t => t.id === order.tableId);
        if (table && table.status === 'seated') {
          table.status = 'eating';
        }
        saveAndSyncState();
      }
    });
  });

  colPreparing.querySelectorAll('.btn-ready-order').forEach(btn => {
    btn.addEventListener('click', () => {
      const orderId = btn.dataset.id;
      const order = state.orders.find(o => o.id === orderId);
      if (order) {
        order.status = 'ready';
        order.items.forEach(i => i.status = 'ready');
        saveAndSyncState();
        playOrderSound(); // Play notification chime on checkout
      }
    });
  });

  colReady.querySelectorAll('.btn-serve-order').forEach(btn => {
    btn.addEventListener('click', () => {
      const orderId = btn.dataset.id;
      const order = state.orders.find(o => o.id === orderId);
      if (order) {
        order.status = 'served';
        order.items.forEach(i => i.status = 'served');
        
        // Push order references to the table history
        const table = state.tables.find(t => t.id === order.tableId);
        if (table) {
          table.orders.push({
            timestamp: order.timestamp,
            items: order.items
          });
        }
        
        saveAndSyncState();
      }
    });
  });

  // Attach replenishment button triggers
  document.querySelectorAll('.btn-start-rep').forEach(btn => {
    btn.addEventListener('click', () => {
      const repId = btn.dataset.id;
      const rep = state.replenishments.find(r => r.id === repId);
      if (rep) {
        rep.status = 'preparing';
        saveAndSyncState();
      }
    });
  });

  document.querySelectorAll('.btn-ready-rep').forEach(btn => {
    btn.addEventListener('click', () => {
      const repId = btn.dataset.id;
      const rep = state.replenishments.find(r => r.id === repId);
      if (rep) {
        rep.status = 'ready';
        saveAndSyncState();
        playOrderSound();
      }
    });
  });

  document.querySelectorAll('.btn-complete-rep').forEach(btn => {
    btn.addEventListener('click', () => {
      const repId = btn.dataset.id;
      const rep = state.replenishments.find(r => r.id === repId);
      if (rep) {
        rep.status = 'replenished';
        saveAndSyncState();
      }
    });
  });

  // Update column badges
  const pendingCount = state.orders.filter(o => o.status === 'pending').length + state.replenishments.filter(r => r.status === 'pending').length;
  const preparingCount = state.orders.filter(o => o.status === 'preparing').length + state.replenishments.filter(r => r.status === 'preparing').length;
  const readyCount = state.orders.filter(o => o.status === 'ready').length + state.replenishments.filter(r => r.status === 'ready').length;

  const countPendingEl = document.getElementById('col-count-pending');
  const countPreparingEl = document.getElementById('col-count-preparing');
  const countReadyEl = document.getElementById('col-count-ready');

  if (countPendingEl) countPendingEl.textContent = pendingCount;
  if (countPreparingEl) countPreparingEl.textContent = preparingCount;
  if (countReadyEl) countReadyEl.textContent = readyCount;
};

// --- ADMIN LAYOUT EDITOR VIEW RENDER ---
const renderAdminView = () => {
  const canvas = document.getElementById('floor-plan-editor');
  canvas.innerHTML = '';

  state.tables.forEach(table => {
    const tDiv = document.createElement('div');
    tDiv.className = `floor-table shape-${table.shape} ${selectedEditorTableId === table.id ? 'selected-edit' : ''}`;
    tDiv.style.left = `${table.x}px`;
    tDiv.style.top = `${table.y}px`;
    tDiv.style.width = `${table.width}px`;
    tDiv.style.height = `${table.height}px`;
    tDiv.dataset.id = table.id;

    tDiv.innerHTML = `
      <span class="table-label">${table.name}</span>
      <span class="table-pax"><i class="fa-solid fa-chair"></i> Cap: ${table.capacity}</span>
    `;

    // Click handler for properties panel
    tDiv.addEventListener('mousedown', (e) => {
      selectEditorTable(table.id);
    });

    // Touch support for mobile layouts
    tDiv.addEventListener('touchstart', (e) => {
      selectEditorTable(table.id);
    }, {passive: true});

    // Attach Drag and Drop handlers
    makeDraggable(tDiv, table);

    canvas.appendChild(tDiv);
  });

  // Render buffet menu items in admin panel
  renderAdminBuffetItems();
};

// Selection of table in admin panel
const selectEditorTable = (tableId) => {
  selectedEditorTableId = tableId;
  
  // Highlight table
  document.querySelectorAll('#floor-plan-editor .floor-table').forEach(div => {
    if (div.dataset.id === tableId) {
      div.classList.add('selected-edit');
    } else {
      div.classList.remove('selected-edit');
    }
  });

  // Populate properties form
  const table = state.tables.find(t => t.id === tableId);
  if (table) {
    document.getElementById('editor-properties-empty').classList.add('hidden');
    const form = document.getElementById('table-properties-form');
    form.classList.remove('hidden');

    document.getElementById('edit-table-id').value = table.id;
    document.getElementById('edit-table-name').value = table.name;
    document.getElementById('edit-table-capacity').value = table.capacity;
    document.getElementById('edit-table-shape').value = table.shape;
    document.getElementById('edit-table-width').value = table.width || 80;
    document.getElementById('edit-table-height').value = table.height || 80;
  }
};

// ==========================================
// DRAG AND DROP LOGIC (WITH SNAP TO GRID & TOUCH SUPPORT)
// ==========================================
const makeDraggable = (element, tableModel) => {
  let active = false;
  let currentX;
  let currentY;
  let initialX;
  let initialY;
  let xOffset = tableModel.x;
  let yOffset = tableModel.y;

  const dragStart = (e) => {
    // If it's a touch event, grab coordinates from targetTouches
    let clientX, clientY;
    if (e.type === "touchstart") {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    initialX = clientX - xOffset;
    initialY = clientY - yOffset;

    if (e.target === element || element.contains(e.target)) {
      active = true;
    }
  };

  const dragEnd = () => {
    initialX = currentX;
    initialY = currentY;
    active = false;
    
    if (currentX !== undefined && currentY !== undefined) {
      tableModel.x = xOffset;
      tableModel.y = yOffset;
      saveAndSyncState('layout_drag');
    }
  };

  const drag = (e) => {
    if (!active) return;
    e.preventDefault();

    let clientX, clientY;
    if (e.type === "touchmove") {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    currentX = clientX - initialX;
    currentY = clientY - initialY;

    // Grid snapping (10px increments)
    xOffset = Math.round(currentX / 10) * 10;
    yOffset = Math.round(currentY / 10) * 10;

    // Prevent dragging off canvas boundaries
    const canvas = document.getElementById('floor-plan-editor');
    const maxX = canvas.clientWidth - element.offsetWidth;
    const maxY = canvas.clientHeight - element.offsetHeight;

    xOffset = Math.max(0, Math.min(xOffset, maxX));
    yOffset = Math.max(0, Math.min(yOffset, maxY));

    element.style.left = `${xOffset}px`;
    element.style.top = `${yOffset}px`;
  };

  // Mouse listeners
  element.addEventListener('mousedown', dragStart, false);
  window.addEventListener('mouseup', dragEnd, false);
  window.addEventListener('mousemove', drag, false);

  // Touch listeners (Android optimization)
  element.addEventListener('touchstart', dragStart, {passive: false});
  window.addEventListener('touchend', dragEnd, false);
  window.addEventListener('touchmove', drag, {passive: false});
};

// ==========================================
// MODALS LOGIC
// ==========================================

const openTableDetails = (tableId) => {
  activeDetailTableId = tableId;
  const table = state.tables.find(t => t.id === tableId);
  if (!table) return;

  const modal = document.getElementById('modal-table-detail');
  
  // Update header text and details
  document.getElementById('detail-table-title').innerHTML = `<i class="fa-solid fa-chair text-gradient-blue"></i> ${table.name} <span style="font-size: 13px; color: var(--text-secondary); font-weight: normal; margin-left: 10px;">(Capacidad: ${table.capacity} pax)</span>`;
  
  const statusBadge = document.getElementById('detail-table-status');
  statusBadge.textContent = getSpanishStatus(table.status);
  statusBadge.className = `status-badge status-${table.status}`;

  // Reset order basket
  currentBasket = [];
  renderBasket();

  // Load contextual visibility depending on table state
  const occupancyInfo = document.getElementById('detail-occupancy-info');
  const availableInfo = document.getElementById('detail-available-info');
  
  // Footer buttons
  const btnDirty = document.getElementById('btn-table-action-dirty');
  const btnClean = document.getElementById('btn-table-action-clean');
  const btnCheckout = document.getElementById('btn-table-action-checkout');

  // Hide all by default
  btnDirty.classList.add('hidden');
  btnClean.classList.add('hidden');
  btnCheckout.classList.add('hidden');

  if (table.status === 'available') {
    occupancyInfo.classList.add('hidden');
    availableInfo.classList.remove('hidden');
    
    // Default values for quick occupancy form
    document.getElementById('quick-guest-name').value = '';
    document.getElementById('selected-quick-room-label').textContent = 'Seleccionar...';
    document.getElementById('selected-quick-room-label').style.color = '';
    
    // Set pax buttons to match table capacity as default (up to 10)
    const qkPaxGroup = document.getElementById('pax-selector-quick');
    if (qkPaxGroup) {
      qkPaxGroup.querySelectorAll('.pax-btn').forEach(b => b.classList.remove('active'));
      const cap = Math.min(10, table.capacity || 2);
      const defBtn = qkPaxGroup.querySelector(`[data-val="${cap}"]`) || qkPaxGroup.querySelector('[data-val="2"]');
      if (defBtn) defBtn.classList.add('active');
      document.getElementById('quick-guest-pax').value = cap;
    }
  } else {
    availableInfo.classList.add('hidden');
    occupancyInfo.classList.remove('hidden');

    // Populate active client data
    document.getElementById('detail-guest-name').textContent = table.guestName || 'Sin Hab.';
    document.getElementById('detail-guest-pax').textContent = `${table.guestPax} personas`;
    document.getElementById('detail-guest-time').textContent = table.guestTime || '--:--';
    document.getElementById('detail-guest-notes').textContent = table.guestNotes || 'Ninguno';

    // Show orders history
    renderOrdersHistory(table);

    // Show context buttons
    if (table.status === 'seated' || table.status === 'eating') {
      btnDirty.classList.remove('hidden');
      btnCheckout.classList.remove('hidden');
    } else if (table.status === 'dirty') {
      btnClean.classList.remove('hidden');
    }
  }

  modal.classList.add('active');
};

const closeTableDetails = () => {
  document.getElementById('modal-table-detail').classList.remove('active');
  activeDetailTableId = null;
};

// Render order history of the table in Modal
const renderOrdersHistory = (table) => {
  const historyDiv = document.getElementById('detail-orders-history');
  
  // Get active orders currently in the kitchen queue for this table
  const activeQueueOrders = state.orders.filter(o => o.tableId === table.id && o.status !== 'served');
  
  // Combine served history and active kitchen orders
  let html = '';

  if (activeQueueOrders.length === 0 && table.orders.length === 0) {
    historyDiv.innerHTML = `<div class="empty-state" style="padding: 10px;"><p style="font-size: 12px;">No hay pedidos registrados.</p></div>`;
    return;
  }

  // Render active orders (yellow/blue colors based on kitchen status)
  if (activeQueueOrders.length > 0) {
    html += `<h6 style="color: var(--color-cyan); margin: 6px 0; font-size: 11px; font-weight: 700; text-transform: uppercase;">En Preparación / Cola:</h6>`;
    activeQueueOrders.forEach((order, index) => {
      html += `
        <div class="history-order-round" style="border-left-color: var(--status-eating);">
          <div class="history-round-header">
            <span>Pedido #${index + 1} (${getSpanishStatus(order.status)})</span>
            <span>${new Date(order.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <ul class="history-items-list">
            ${order.items.map(item => `
              <li class="history-item status-${item.status}">
                <span>${item.qty}x ${item.name}</span>
                <span>${getSpanishItemStatus(item.status)}</span>
              </li>
            `).join('')}
          </ul>
        </div>
      `;
    });
  }

  // Render served buffet orders
  if (table.orders && table.orders.length > 0) {
    html += `<h6 style="color: var(--status-available); margin: 8px 0 6px 0; font-size: 11px; font-weight: 700; text-transform: uppercase;">Servidos en Mesa:</h6>`;
    table.orders.forEach((order, index) => {
      html += `
        <div class="history-order-round" style="border-left-color: var(--status-available);">
          <div class="history-round-header">
            <span>Ronda #${index + 1} (Completado)</span>
            <span>${new Date(order.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <ul class="history-items-list">
            ${order.items.map(item => `
              <li class="history-item" style="color: var(--text-secondary);">
                <span>${item.qty}x ${item.name}</span>
                <span>Entregado ✔</span>
              </li>
            `).join('')}
          </ul>
        </div>
      `;
    });
  }

  historyDiv.innerHTML = html;
};

// Render draft items in basket (not sent to kitchen yet)
const renderBasket = () => {
  const basketList = document.getElementById('basket-items-list');
  const basketBlock = document.getElementById('pending-basket');

  if (currentBasket.length === 0) {
    basketBlock.classList.add('hidden');
    basketList.innerHTML = '';
    return;
  }

  basketBlock.classList.remove('hidden');
  basketList.innerHTML = currentBasket.map((item, idx) => `
    <li class="basket-item">
      <span><strong>${item.qty}x</strong> ${item.name} <span style="font-size: 10px; color: var(--text-muted);">(${item.category})</span></span>
      <div class="basket-item-actions">
        <button type="button" class="circle-btn btn-delete-basket-item" data-index="${idx}" style="width:24px; height:24px; font-size:10px;">
          <i class="fa-solid fa-times"></i>
        </button>
      </div>
    </li>
  `).join('');

  basketList.querySelectorAll('.btn-delete-basket-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index);
      currentBasket.splice(idx, 1);
      renderBasket();
    });
  });
};

// ==========================================
// FORM SUBMISSIONS & ACTIONS
// ==========================================

// Add guest to waitlist (Puerta View)
document.getElementById('waitlist-form').addEventListener('submit', (e) => {
  e.preventDefault();
  
  const name = document.getElementById('guest-name').value.trim();
  const pax = parseInt(document.getElementById('guest-pax').value);
  const priority = document.getElementById('guest-priority').value;
  const notes = document.getElementById('guest-notes').value.trim();
  
  if (!name) return;

  const newGuest = {
    id: 'w_' + Date.now(),
    name: name,
    pax: pax,
    priority: priority,
    notes: notes,
    time: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  };

  state.waitlist.push(newGuest);
  
  // Track this room number as registered
  const roomNum = name.replace('Habitación ', '').replace('Hab. ', '').trim();
  if (roomNum && !state.enteredRooms.includes(roomNum)) {
    state.enteredRooms.push(roomNum);
  }
  
  // Reset form
  e.target.reset();
  document.getElementById('selected-room-label').textContent = 'Tocar para seleccionar...';
  document.getElementById('selected-room-label').style.color = '';
  document.getElementById('guest-name').value = '';
  
  // Reset pax buttons to default 2
  const wlPaxGroup = document.getElementById('pax-selector-waitlist');
  if (wlPaxGroup) {
    wlPaxGroup.querySelectorAll('.pax-btn').forEach(b => b.classList.remove('active'));
    const defBtn = wlPaxGroup.querySelector('[data-val="2"]');
    if (defBtn) defBtn.classList.add('active');
    document.getElementById('guest-pax').value = 2;
  }
  
  saveAndSyncState();
});

// Quick Seat form inside table details modal (Sala View)
document.getElementById('quick-seat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!activeDetailTableId) return;

  const table = state.tables.find(t => t.id === activeDetailTableId);
  const name = document.getElementById('quick-guest-name').value.trim();
  const pax = parseInt(document.getElementById('quick-guest-pax').value);

  if (table && name) {
    table.status = 'seated';
    table.guestName = name;
    table.guestPax = pax;
    table.guestTime = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    table.guestNotes = 'Ingreso Rápido';
    table.orders = [];

    // Track this room number as registered
    const roomNum = name.replace('Habitación ', '').replace('Hab. ', '').trim();
    if (roomNum && !state.enteredRooms.includes(roomNum)) {
      state.enteredRooms.push(roomNum);
    }

    // Reset quick room label
    document.getElementById('selected-quick-room-label').textContent = 'Seleccionar...';
    document.getElementById('selected-quick-room-label').style.color = '';
    document.getElementById('quick-guest-name').value = '';
    
    // Reset quick pax buttons to default 2
    const qkPaxGroup = document.getElementById('pax-selector-quick');
    if (qkPaxGroup) {
      qkPaxGroup.querySelectorAll('.pax-btn').forEach(b => b.classList.remove('active'));
      const defBtn = qkPaxGroup.querySelector('[data-val="2"]');
      if (defBtn) defBtn.classList.add('active');
      document.getElementById('quick-guest-pax').value = 2;
    }

    closeTableDetails();
    saveAndSyncState();
  }
});

// Add single item to current basket (Modal)
document.getElementById('btn-add-dish-item').addEventListener('click', () => {
  const name = document.getElementById('input-dish-name').value.trim();
  const qty = parseInt(document.getElementById('input-dish-qty').value);
  const category = document.getElementById('select-dish-category').value;

  if (!name) return;

  // Check if item already exists in current draft basket
  const existing = currentBasket.find(i => i.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    existing.qty += qty;
  } else {
    currentBasket.push({
      name: name,
      qty: qty,
      category: category
    });
  }

  // Clear inputs (keep category selected)
  document.getElementById('input-dish-name').value = '';
  document.getElementById('input-dish-qty').value = 1;

  renderBasket();
});

// Submit entire order to kitchen
document.getElementById('btn-submit-order-round').addEventListener('click', () => {
  if (!activeDetailTableId || currentBasket.length === 0) return;

  const table = state.tables.find(t => t.id === activeDetailTableId);
  if (!table) return;

  // Add order to global kitchen list
  const newOrder = {
    id: 'o_' + Date.now(),
    tableId: table.id,
    tableName: table.name,
    timestamp: Date.now(),
    priority: table.guestNotes.toLowerCase().includes('vip') ? 'vip' : 'normal',
    status: 'pending',
    items: currentBasket.map(item => ({
      name: item.name,
      qty: item.qty,
      category: item.category,
      status: 'pending'
    }))
  };

  state.orders.push(newOrder);

  // Set table status to eating
  table.status = 'eating';

  closeTableDetails();
  
  // Broadcast with 'order_submitted' label to trigger sound alert on other tabs
  saveAndSyncState('order_submitted');
});

// Table action: Request cleaning
document.getElementById('btn-table-action-dirty').addEventListener('click', () => {
  if (!activeDetailTableId) return;
  const table = state.tables.find(t => t.id === activeDetailTableId);
  if (table) {
    table.status = 'dirty';
    closeTableDetails();
    saveAndSyncState();
  }
});

// Table action: Clean table
document.getElementById('btn-table-action-clean').addEventListener('click', () => {
  if (!activeDetailTableId) return;
  const table = state.tables.find(t => t.id === activeDetailTableId);
  if (table) {
    table.status = 'available';
    table.guestName = '';
    table.guestPax = 0;
    table.guestTime = '';
    table.guestNotes = '';
    table.orders = [];
    
    closeTableDetails();
    saveAndSyncState();
  }
});

// Table action: Bill & Checkout (Leaves table dirty)
document.getElementById('btn-table-action-checkout').addEventListener('click', () => {
  if (!activeDetailTableId) return;
  const table = state.tables.find(t => t.id === activeDetailTableId);
  if (table) {
    table.status = 'dirty';
    
    // Record checkout metrics
    state.leftGuestsCount = (state.leftGuestsCount || 0) + (table.guestPax || 0);
    
    // Clear dining session properties, but table remains dirty
    table.guestName = '';
    table.guestPax = 0;
    table.guestTime = '';
    table.guestNotes = '';
    
    // Cancel any active kitchen orders that might be pending for this table
    state.orders = state.orders.filter(o => o.tableId !== table.id || o.status === 'served');

    closeTableDetails();
    saveAndSyncState();
  }
});

// Modal close button
document.getElementById('btn-close-detail').addEventListener('click', closeTableDetails);

// Increment/Decrement quantity triggers
document.getElementById('qty-plus').addEventListener('click', () => {
  const qtyInput = document.getElementById('input-dish-qty');
  qtyInput.value = parseInt(qtyInput.value) + 1;
});
document.getElementById('qty-minus').addEventListener('click', () => {
  const qtyInput = document.getElementById('input-dish-qty');
  const val = parseInt(qtyInput.value);
  if (val > 1) {
    qtyInput.value = val - 1;
  }
});

// ==========================================
// ADMIN LAYOUT EDITOR CONTROLLER ACTIONS
// ==========================================

// Add table trigger
document.getElementById('btn-add-table').addEventListener('click', () => {
  const canvas = document.getElementById('floor-plan-editor');
  const count = state.tables.length + 1;
  
  const newTable = {
    id: 't_' + Date.now(),
    name: `Mesa ${count}`,
    capacity: 4,
    shape: 'square',
    width: 90,
    height: 90,
    x: 400, // Spawn in center area of editor
    y: 200,
    status: 'available',
    guestName: '',
    guestPax: 0,
    guestTime: '',
    guestNotes: '',
    orders: []
  };

  state.tables.push(newTable);
  selectedEditorTableId = newTable.id;
  renderApp();
  selectEditorTable(newTable.id);
});

// Save Admin changes
document.getElementById('btn-save-layout').addEventListener('click', () => {
  saveAndSyncState();
  
  // Show standard alert
  const saveBtn = document.getElementById('btn-save-layout');
  const oldHTML = saveBtn.innerHTML;
  saveBtn.innerHTML = `<i class="fa-solid fa-circle-check"></i> ¡Guardado!`;
  saveBtn.classList.remove('btn-glow-purple');
  saveBtn.style.background = 'var(--status-available)';
  saveBtn.style.color = 'var(--bg-darkest)';
  
  setTimeout(() => {
    saveBtn.innerHTML = oldHTML;
    saveBtn.classList.add('btn-glow-purple');
    saveBtn.style.background = '';
    saveBtn.style.color = '';
  }, 1500);
});

// Reset Shift / Service
document.getElementById('btn-reset-shift').addEventListener('click', () => {
  if (confirm('¿Estás seguro de que deseas reiniciar el servicio? Esto borrará la lista de espera, desocupará todas las mesas, cancelará los pedidos activos de cocina y restablecerá el historial de habitaciones de este pase.')) {
    state.waitlist = [];
    state.orders = [];
    state.replenishments = [];
    state.leftGuestsCount = 0;
    state.enteredRooms = [];
    
    // Reset table status to available
    state.tables.forEach(t => {
      t.status = 'available';
      t.guestName = '';
      t.guestPax = 0;
      t.guestTime = '';
      t.guestNotes = '';
      t.orders = [];
    });

    saveAndSyncState();
    alert('Servicio reiniciado con éxito.');
  }
});

// Properties Form edits updates model in real-time
const updateTablePropertiesFromForm = () => {
  if (!selectedEditorTableId) return;
  const table = state.tables.find(t => t.id === selectedEditorTableId);
  if (!table) return;

  table.name = document.getElementById('edit-table-name').value;
  table.capacity = parseInt(document.getElementById('edit-table-capacity').value);
  table.shape = document.getElementById('edit-table-shape').value;
  table.width = parseInt(document.getElementById('edit-table-width').value) || 80;
  table.height = parseInt(document.getElementById('edit-table-height').value) || 80;

  // Redraw canvas with new dimensions
  renderAdminView();
};

document.getElementById('edit-table-name').addEventListener('input', updateTablePropertiesFromForm);
document.getElementById('edit-table-capacity').addEventListener('input', updateTablePropertiesFromForm);
document.getElementById('edit-table-shape').addEventListener('change', updateTablePropertiesFromForm);
document.getElementById('edit-table-width').addEventListener('input', updateTablePropertiesFromForm);
document.getElementById('edit-table-height').addEventListener('input', updateTablePropertiesFromForm);

// Delete table
document.getElementById('btn-delete-table').addEventListener('click', () => {
  if (!selectedEditorTableId) return;
  
  if (confirm('¿Estás seguro de que deseas eliminar esta mesa?')) {
    state.tables = state.tables.filter(t => t.id !== selectedEditorTableId);
    selectedEditorTableId = null;
    document.getElementById('table-properties-form').classList.add('hidden');
    document.getElementById('editor-properties-empty').classList.remove('hidden');
    renderApp();
  }
});

// ==========================================
// UTILITY TRANSLATORS
// ==========================================
const getSpanishStatus = (status) => {
  switch (status) {
    case 'available': return 'Disponible';
    case 'seated': return 'Sentados';
    case 'eating': return 'Comiendo';
    case 'dirty': return 'Sucia';
    default: return status;
  }
};

const getSpanishItemStatus = (status) => {
  switch (status) {
    case 'pending': return 'En Cola ⏳';
    case 'preparing': return 'Preparando 🍳';
    case 'ready': return 'Listo 🛎';
    case 'served': return 'Entregado ✔';
    default: return status;
  }
};

// ==========================================
// HOTEL ROOM SELECTION ENGINE (214 ROOMS)
// ==========================================
const HOTEL_ROOMS = (() => {
  const rooms = [];
  // 001 a 010
  for (let i = 1; i <= 10; i++) {
    rooms.push(i.toString().padStart(3, '0'));
  }
  // A01 a A15
  for (let i = 1; i <= 15; i++) {
    rooms.push('A' + i.toString().padStart(2, '0'));
  }
  // 101 a 139
  for (let i = 101; i <= 139; i++) {
    rooms.push(i.toString());
  }
  // 201 a 245
  for (let i = 201; i <= 245; i++) {
    rooms.push(i.toString());
  }
  // 301 a 341
  for (let i = 301; i <= 341; i++) {
    rooms.push(i.toString());
  }
  // 401 a 441
  for (let i = 401; i <= 441; i++) {
    rooms.push(i.toString());
  }
  // 501 a 523
  for (let i = 501; i <= 523; i++) {
    rooms.push(i.toString());
  }
  return rooms;
})();

let activeRoomTarget = 'waitlist'; // 'waitlist' | 'quickseat'

const openRoomPicker = (target) => {
  activeRoomTarget = target;
  document.getElementById('room-search-filter').value = '';
  renderRoomsGrid();
  document.getElementById('modal-room-selector').classList.add('active');
};

const renderRoomsGrid = () => {
  const grid = document.getElementById('rooms-selector-grid');
  grid.innerHTML = '';
  
  const query = document.getElementById('room-search-filter').value.trim().toLowerCase();
  
  // Find which rooms are currently active (seated/eating or waiting)
  const activeRooms = new Set();
  
  // Active seated / eating tables
  state.tables.forEach(t => {
    if (t.guestName && t.status !== 'available' && t.status !== 'dirty') {
      const num = t.guestName.replace('Habitación ', '').replace('Hab. ', '').trim();
      activeRooms.add(num);
    }
  });
  
  // Active waitlisted guest rooms
  state.waitlist.forEach(g => {
    if (g.name) {
      const num = g.name.replace('Habitación ', '').replace('Hab. ', '').trim();
      activeRooms.add(num);
    }
  });

  const enteredRoomsSet = new Set(state.enteredRooms || []);

  // Filter rooms by query
  const filteredRooms = HOTEL_ROOMS.filter(r => r.includes(query));
  
  if (filteredRooms.length === 0) {
    grid.innerHTML = `<div style="grid-column: span 5; text-align: center; color: var(--text-secondary); padding: 30px;"><i class="fa-solid fa-hotel" style="font-size:24px; margin-bottom:10px; display:block; opacity:0.5;"></i>No se encontraron habitaciones.</div>`;
    return;
  }

  filteredRooms.forEach(roomNum => {
    const isCurrentlyActive = activeRooms.has(roomNum);
    const hasAlreadyEntered = enteredRoomsSet.has(roomNum);
    
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn`;
    btn.style.padding = '12px 8px';
    btn.style.fontSize = '12px';
    btn.style.flexDirection = 'column';
    btn.style.display = 'flex';
    btn.style.alignItems = 'center';
    btn.style.justifyContent = 'center';
    btn.style.gap = '2px';
    
    if (isCurrentlyActive || hasAlreadyEntered) {
      btn.disabled = true;
      let label = 'Ya Entró';
      
      if (isCurrentlyActive) {
        const inWaitlist = state.waitlist.some(g => {
          const num = g.name.replace('Habitación ', '').replace('Hab. ', '').trim();
          return num === roomNum;
        });
        label = inWaitlist ? 'En Espera' : 'En Buffet';
      }
      
      btn.innerHTML = `<strong>${roomNum}</strong><span style="font-size: 8px; opacity: 0.7;">${label}</span>`;
      btn.style.background = 'rgba(255, 8, 68, 0.12)';
      btn.style.color = 'var(--color-rose)';
      btn.style.border = '1px solid rgba(255, 8, 68, 0.25)';
    } else {
      btn.innerHTML = `<strong>${roomNum}</strong><span style="font-size: 8px; color: var(--status-available);">Libre</span>`;
      btn.style.background = 'rgba(255, 255, 255, 0.03)';
      btn.style.border = '1px solid rgba(255, 255, 255, 0.08)';
      btn.style.color = 'var(--text-primary)';
      
      btn.addEventListener('click', () => {
        selectRoomNumber(roomNum);
      });
    }
    
    grid.appendChild(btn);
  });
};

const selectRoomNumber = (roomNumber) => {
  const labelText = `Habitación ${roomNumber}`;
  
  if (activeRoomTarget === 'waitlist') {
    document.getElementById('guest-name').value = labelText;
    document.getElementById('selected-room-label').textContent = labelText;
    document.getElementById('selected-room-label').style.color = 'var(--text-primary)';
  } else if (activeRoomTarget === 'quickseat') {
    document.getElementById('quick-guest-name').value = labelText;
    document.getElementById('selected-quick-room-label').textContent = labelText;
    document.getElementById('selected-quick-room-label').style.color = 'var(--text-primary)';
  }
  
  // Close rooms modal
  document.getElementById('modal-room-selector').classList.remove('active');
};

// Setup and bind click events for segmented pax buttons
const initPaxSelectors = () => {
  // Waitlist Pax selector setup
  const wlPaxGroup = document.getElementById('pax-selector-waitlist');
  if (wlPaxGroup) {
    wlPaxGroup.querySelectorAll('.pax-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        wlPaxGroup.querySelectorAll('.pax-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('guest-pax').value = btn.dataset.val;
      });
    });
  }

  // Quick seat Pax selector setup
  const qkPaxGroup = document.getElementById('pax-selector-quick');
  if (qkPaxGroup) {
    qkPaxGroup.querySelectorAll('.pax-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        qkPaxGroup.querySelectorAll('.pax-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('quick-guest-pax').value = btn.dataset.val;
      });
    });
  }
};

// Bind click events for room picker modal and replenishment modal
window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-close-rooms').addEventListener('click', () => {
    document.getElementById('modal-room-selector').classList.remove('active');
  });

  // Filter input event
  document.getElementById('room-search-filter').addEventListener('input', renderRoomsGrid);

  // Open button triggers
  document.getElementById('btn-open-room-picker').addEventListener('click', () => {
    openRoomPicker('waitlist');
  });

  document.getElementById('btn-open-quick-room-picker').addEventListener('click', () => {
    openRoomPicker('quickseat');
  });

  // Replenishment modal triggers
  const btnOpenRep = document.getElementById('btn-open-replenish-modal');
  if (btnOpenRep) {
    btnOpenRep.addEventListener('click', () => {
      document.getElementById('modal-replenish').classList.add('active');
      renderReplenishSelector();
    });
  }

  const btnCloseRep = document.getElementById('btn-close-replenish');
  if (btnCloseRep) {
    btnCloseRep.addEventListener('click', () => {
      document.getElementById('modal-replenish').classList.remove('active');
    });
  }
});

// ==========================================
// BUFFET REPLENISHMENT SYSTEM
// ==========================================

const renderAdminBuffetItems = () => {
  const container = document.getElementById('admin-dish-list');
  if (!container) return;

  if (!state.buffetItems || state.buffetItems.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: var(--text-secondary); padding: 15px; font-size: 12px; opacity: 0.6;">
        <i class="fa-solid fa-utensils" style="margin-right: 6px;"></i> No hay platos registrados
      </div>
    `;
    return;
  }

  container.innerHTML = state.buffetItems.map(dish => `
    <div class="dish-item" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; gap: 8px;">
      <span style="font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">${dish}</span>
      <button type="button" class="btn-delete-dish circle-btn" data-dish="${dish}" style="width: 24px; height: 24px; font-size: 10px; color: var(--color-rose); background: rgba(255,8,68,0.1); border-color: rgba(255,8,68,0.2); flex-shrink: 0;" title="Eliminar">
        <i class="fa-solid fa-trash-can"></i>
      </button>
    </div>
  `).join('');

  // Attach delete events
  container.querySelectorAll('.btn-delete-dish').forEach(btn => {
    btn.addEventListener('click', () => {
      const dishName = btn.dataset.dish;
      state.buffetItems = state.buffetItems.filter(d => d !== dishName);
      
      // Clean up corresponding active replenishments for this dish
      state.replenishments = state.replenishments.filter(r => r.name !== dishName);
      
      saveAndSyncState();
    });
  });
};

const renderReplenishSelector = () => {
  const container = document.getElementById('replenish-selector-list');
  if (!container) return;

  if (!state.buffetItems || state.buffetItems.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 20px;">
        <i class="fa-solid fa-utensils"></i>
        <p>No hay platos en el buffet hoy. Configúralos en la sección Admin.</p>
      </div>
    `;
    return;
  }

  const activeReps = {};
  state.replenishments.forEach(rep => {
    if (rep.status !== 'replenished') {
      activeReps[rep.name] = rep.status;
    }
  });

  container.innerHTML = state.buffetItems.map(item => {
    const activeStatus = activeReps[item];
    let btnHTML = '';

    if (activeStatus === 'pending') {
      btnHTML = `<span class="status-badge" style="background: rgba(255, 159, 28, 0.15); color: var(--status-eating); border: 1px solid rgba(255,159,28,0.3); font-size:11px; padding:6px 12px; display:inline-block;"><i class="fa-solid fa-clock"></i> Pendiente</span>`;
    } else if (activeStatus === 'preparing') {
      btnHTML = `<span class="status-badge" style="background: rgba(79, 172, 254, 0.15); color: var(--status-seated); border: 1px solid rgba(79,172,254,0.3); font-size:11px; padding:6px 12px; display:inline-block;"><i class="fa-solid fa-fire-burner"></i> Preparando</span>`;
    } else {
      btnHTML = `
        <button type="button" class="btn btn-secondary btn-small btn-request-restock" data-item="${item}" style="padding: 6px 12px; font-size: 11px; background: rgba(255, 8, 68, 0.08); border-color: rgba(255, 8, 68, 0.2); color: var(--text-primary);">
          <i class="fa-solid fa-bullhorn" style="color: var(--color-rose);"></i> Solicitar Reposición
        </button>
      `;
    }

    return `
      <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.02); padding: 12px 16px; border: 1px solid var(--border-light); border-radius: 10px;">
        <span style="font-weight: 600; font-size: 14px;">${item}</span>
        <div>${btnHTML}</div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.btn-request-restock').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.dataset.item;
      requestRestock(item);
    });
  });
};

const requestRestock = (itemName) => {
  const newRep = {
    id: 'rep_' + Date.now(),
    name: itemName,
    status: 'pending',
    timestamp: Date.now()
  };

  state.replenishments.push(newRep);
  saveAndSyncState('restock_requested');
  renderReplenishSelector();
};



// Bind form submit for admin buffet menu editor
window.addEventListener('DOMContentLoaded', () => {
  const addDishForm = document.getElementById('admin-add-dish-form');
  if (addDishForm) {
    addDishForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('admin-new-dish-name');
      const dishName = input.value.trim();
      
      if (dishName) {
        // Prevent duplicates
        if (!state.buffetItems.includes(dishName)) {
          state.buffetItems.push(dishName);
          input.value = '';
          saveAndSyncState();
        } else {
          alert('Este plato ya existe en la lista.');
        }
      }
    });
  }
});

// ==========================================
// APP INITIALIZATION
// ==========================================

const init = () => {
  // Bind role selector clicks
  document.querySelectorAll('.role-selector button').forEach(button => {
    button.addEventListener('click', () => {
      const role = button.dataset.role;
      switchView(role);
    });
  });

  // Initialize pax selectors logic
  initPaxSelectors();

  // Load local state and render initial view
  loadState();
  connectWebSocket();
  renderApp();

  // Run periodic updates (every 10 seconds) to tick elapsed time in Kitchen
  setInterval(() => {
    if (currentRole === 'cocina' || currentRole === 'sala') {
      renderApp();
    } else {
      updateBadges();
    }
  }, 10000);

  // Register service worker for PWA offline accessibility
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
      .then(reg => console.log('Service Worker registrado correctamente.', reg.scope))
      .catch(err => console.warn('Fallo al registrar Service Worker:', err));
  }
};

// Start application
window.addEventListener('DOMContentLoaded', init);
