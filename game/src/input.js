// input.js — keyboard and mouse state, read by the simulation as plain data.
// The render loop owns the listeners; the fixed-step simulation only samples
// this object, which keeps input timing out of the game logic. Mouse movement
// is accumulated between steps and consumed exactly once by the player
// controller, so look speed never depends on frame rate.

export const input = {
  keys: new Set(),
  mouseDX: 0,
  mouseDY: 0,
  firing: false,        // left button held
  aiming: false,        // right button held (sniper scope)
  clicked: false,       // left button went down since the last step (semi-auto)
  locked: false,        // pointer lock engaged
  wheel: 0,             // accumulated wheel delta for weapon cycling
};

const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyB', 'KeyE', 'KeyG', 'KeyF',
  'Space', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Tab',
]);

export function attachInput(canvas, onFirstGesture) {
  window.addEventListener('keydown', (e) => {
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    input.keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => input.keys.delete(e.code));
  window.addEventListener('blur', () => {
    input.keys.clear();
    input.firing = false;
    input.aiming = false;
  });

  canvas.addEventListener('mousedown', (e) => {
    if (!input.locked) return;
    if (e.button === 0) {
      input.firing = true;
      input.clicked = true;
    }
    if (e.button === 2) input.aiming = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.firing = false;
    if (e.button === 2) input.aiming = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('wheel', (e) => {
    if (input.locked) input.wheel += Math.sign(e.deltaY);
  }, { passive: true });

  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === canvas;
    if (!input.locked) {
      input.firing = false;
      input.aiming = false;
      input.keys.clear();
    }
  });
  document.addEventListener('mousemove', (e) => {
    if (!input.locked) return;
    input.mouseDX += e.movementX || 0;
    input.mouseDY += e.movementY || 0;
  });
  canvas.addEventListener('click', () => {
    if (onFirstGesture) onFirstGesture();
  });
}

export function keyDown(code) {
  return input.keys.has(code);
}

// Consume the accumulated mouse delta (called once per fixed step by player.js).
export function takeMouse() {
  const dx = input.mouseDX;
  const dy = input.mouseDY;
  input.mouseDX = 0;
  input.mouseDY = 0;
  return { dx, dy };
}

export function takeClick() {
  const c = input.clicked;
  input.clicked = false;
  return c;
}

export function takeWheel() {
  const w = input.wheel;
  input.wheel = 0;
  return w;
}
