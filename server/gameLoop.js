const { createCar, updatePhysics, getTrajectoryPoints } = require('./physics');

const TICK_RATE = 60; // Hz
const TICK_MS = 1000 / TICK_RATE;

class GameRoom {
  constructor(roomId, io) {
    this.roomId = roomId;
    this.io = io;
    this.clients = {}; // socketId -> { role: 'dashboard'|'wheel' }
    this.car = createCar(0, 0);
    this.interval = null;
    this.lastTick = Date.now();
  }

  addClient(socketId, role) {
    this.clients[socketId] = { role };
    if (Object.keys(this.clients).length === 1) {
      this.start();
    }
  }

  removeClient(socketId) {
    delete this.clients[socketId];
    if (Object.keys(this.clients).length === 0) {
      this.stop();
    }
  }

  handleInput(role, data) {
    if (role === 'wheel') {
      if (data.type === 'steering') {
        this.car.steeringAngle = Math.max(-35, Math.min(35, data.angle));
      }
    }
    if (role === 'dashboard') {
      if (data.type === 'throttle') {
        this.car.throttle = Math.max(0, Math.min(1, data.value));
      }
      if (data.type === 'brake') {
        this.car.brake = Math.max(0, Math.min(1, data.value));
      }
      if (data.type === 'gear') {
        const allowed = ['P', 'R', 'N', 'D'];
        if (allowed.includes(data.value)) {
          // Gear change rules: can't shift R<->D at speed
          const speed = Math.abs(this.car.speed);
          const cur = this.car.gear;
          const next = data.value;
          const isDangerous =
            (cur === 'R' && next === 'D' && speed > 1) ||
            (cur === 'D' && next === 'R' && speed > 1);
          if (!isDangerous) {
            this.car.gear = next;
          }
        }
      }
    }
  }

  start() {
    this.lastTick = Date.now();
    this.interval = setInterval(() => this.tick(), TICK_MS);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  tick() {
    const now = Date.now();
    const dt = (now - this.lastTick) / 1000;
    this.lastTick = now;

    updatePhysics(this.car, dt);

    const trajectory = getTrajectoryPoints(this.car);

    this.io.to(this.roomId).emit('state', {
      car: {
        x: this.car.x,
        y: this.car.y,
        heading: this.car.heading,
        speed: this.car.speed,
        gear: this.car.gear,
        steeringAngle: this.car.steeringAngle,
        throttle: this.car.throttle,
        brake: this.car.brake,
      },
      trajectory,
    });
  }
}

class GameManager {
  constructor(io) {
    this.io = io;
    this.rooms = {}; // roomId -> GameRoom
  }

  getOrCreate(roomId) {
    if (!this.rooms[roomId]) {
      this.rooms[roomId] = new GameRoom(roomId, this.io);
    }
    return this.rooms[roomId];
  }

  cleanup(roomId) {
    const room = this.rooms[roomId];
    if (room && Object.keys(room.clients).length === 0) {
      room.stop();
      delete this.rooms[roomId];
    }
  }
}

module.exports = { GameManager };
