/**
 * Simple car physics - bicycle model (Ackermann steering approximation)
 * Designed for automatic transmission learning simulation
 */

const PHYSICS = {
  MAX_SPEED: 80,          // km/h
  MAX_REVERSE_SPEED: 20,  // km/h
  MAX_STEERING_ANGLE: 35, // degrees (front wheel max)
  WHEELBASE: 2.7,         // meters (distance front/rear axle)
  CAR_LENGTH: 4.5,        // meters
  CAR_WIDTH: 1.9,         // meters

  // Acceleration / braking
  THROTTLE_FORCE: 12,     // m/s^2 full throttle
  BRAKE_FORCE: 18,        // m/s^2 full brake
  ENGINE_BRAKE: 2,        // m/s^2 engine drag when throttle=0
  FRICTION: 1.5,          // general friction
  CREEP_SPEED: 2.5,       // km/h - auto creep when D/R, no throttle, no brake

  // Pixels per meter scale for canvas rendering
  SCALE: 20,
};

function createCar(x = 0, y = 0) {
  return {
    x,            // world position (meters)
    y,
    heading: 0,   // degrees, 0 = facing up (north)
    speed: 0,     // m/s (signed: positive = forward, negative = reverse)
    gear: 'P',    // P R N D
    throttle: 0,  // 0-1
    brake: 0,     // 0-1
    steeringAngle: 0,  // front wheel angle degrees (-35 to +35)
    engineOn: true,
  };
}

function toRad(deg) { return deg * Math.PI / 180; }
function toDeg(rad) { return rad * 180 / Math.PI; }
function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

/**
 * Update car state by dt seconds.
 * Returns new state (mutates in place for performance).
 */
function updatePhysics(car, dt) {
  if (!car.engineOn) {
    // Engine off: coast to stop
    car.speed = dampToZero(car.speed, PHYSICS.FRICTION * dt);
    moveBySpeed(car, dt);
    return car;
  }

  const gear = car.gear;

  // --- Determine acceleration ---
  let accel = 0;

  if (gear === 'P') {
    // Park: locked
    car.speed = 0;
    return car;
  }

  if (gear === 'N') {
    // Neutral: coasts
    accel = -(PHYSICS.FRICTION + PHYSICS.ENGINE_BRAKE) * Math.sign(car.speed);
    if (Math.abs(car.speed) < 0.1) car.speed = 0;
  }

  const maxSpeed = PHYSICS.MAX_SPEED / 3.6;         // convert to m/s
  const maxReverse = PHYSICS.MAX_REVERSE_SPEED / 3.6;

  if (gear === 'D') {
    if (car.brake > 0) {
      // Braking
      accel = -PHYSICS.BRAKE_FORCE * car.brake * Math.sign(car.speed || 1);
    } else if (car.throttle > 0) {
      // Accelerating forward
      if (car.speed >= 0) {
        // Driving forward
        const speedRatio = car.speed / maxSpeed;
        accel = PHYSICS.THROTTLE_FORCE * car.throttle * (1 - speedRatio * 0.8);
      } else {
        // Was reversing, brake first
        accel = PHYSICS.BRAKE_FORCE * car.throttle;
      }
    } else {
      // No input: creep + engine brake
      const creep = PHYSICS.CREEP_SPEED / 3.6;
      if (car.speed < creep) {
        accel = PHYSICS.THROTTLE_FORCE * 0.08; // gentle creep
      } else {
        accel = -PHYSICS.ENGINE_BRAKE;
      }
    }
  }

  if (gear === 'R') {
    if (car.brake > 0) {
      accel = PHYSICS.BRAKE_FORCE * car.brake * Math.sign(car.speed || -1);
    } else if (car.throttle > 0) {
      if (car.speed <= 0) {
        const speedRatio = Math.abs(car.speed) / maxReverse;
        accel = -PHYSICS.THROTTLE_FORCE * car.throttle * (1 - speedRatio * 0.8);
      } else {
        accel = -PHYSICS.BRAKE_FORCE * car.throttle;
      }
    } else {
      const creep = PHYSICS.CREEP_SPEED / 3.6;
      if (car.speed > -creep) {
        accel = -PHYSICS.THROTTLE_FORCE * 0.08;
      } else {
        accel = PHYSICS.ENGINE_BRAKE;
      }
    }
  }

  car.speed += accel * dt;

  // Clamp speed
  if (gear === 'D' || gear === 'N') {
    car.speed = clamp(car.speed, -maxReverse, maxSpeed);
  } else if (gear === 'R') {
    car.speed = clamp(car.speed, -maxReverse, maxSpeed * 0.1);
  }

  // Stop at near-zero when braking
  if (car.brake > 0 && Math.abs(car.speed) < 0.05) {
    car.speed = 0;
  }

  moveBySpeed(car, dt);
  return car;
}

/**
 * Bicycle model: update position and heading based on speed and steering angle.
 * The rear axle is used as the reference point.
 */
function moveBySpeed(car, dt) {
  if (Math.abs(car.speed) < 0.001) return;

  const L = PHYSICS.WHEELBASE;
  const steerRad = toRad(car.steeringAngle);
  const headingRad = toRad(car.heading);

  if (Math.abs(car.steeringAngle) < 0.5) {
    // Straight line
    car.x += Math.sin(headingRad) * car.speed * dt;
    car.y -= Math.cos(headingRad) * car.speed * dt;
  } else {
    // Turning radius based on bicycle model
    const turningRadius = L / Math.tan(steerRad);
    const angularVelocity = car.speed / turningRadius; // rad/s
    const dHeading = toDeg(angularVelocity * dt);

    car.heading += dHeading;
    car.heading = ((car.heading % 360) + 360) % 360;

    const newHeadingRad = toRad(car.heading);
    // Use arc movement (more accurate than single step)
    car.x += turningRadius * (Math.cos(headingRad - Math.PI / 2) - Math.cos(newHeadingRad - Math.PI / 2));
    car.y += turningRadius * (Math.sin(headingRad - Math.PI / 2) - Math.sin(newHeadingRad - Math.PI / 2));
  }
}

function dampToZero(val, amount) {
  if (Math.abs(val) <= amount) return 0;
  return val - Math.sign(val) * amount;
}

/**
 * Calculate the predicted trajectory arc for visualization.
 * Returns array of {x, y} points (world coordinates).
 */
function getTrajectoryPoints(car, steps = 30, stepDt = 0.15) {
  const points = [];
  // Clone car for simulation
  const sim = { ...car };

  for (let i = 0; i < steps; i++) {
    points.push({ x: sim.x, y: sim.y });
    // Move with current speed (don't apply throttle, just project movement)
    const simSpeed = sim.speed !== 0 ? sim.speed : (sim.gear === 'D' ? 3 : sim.gear === 'R' ? -3 : 0);
    if (simSpeed === 0) break;
    const simCar = { ...sim, speed: simSpeed };
    moveBySpeed(simCar, stepDt);
    sim.x = simCar.x;
    sim.y = simCar.y;
    sim.heading = simCar.heading;
  }
  return points;
}

module.exports = { createCar, updatePhysics, getTrajectoryPoints, PHYSICS };
