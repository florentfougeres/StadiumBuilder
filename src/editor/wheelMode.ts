/**
 * What the scroll wheel does in the viewport. Mice and trackpads cannot always be told apart
 * (macOS reports every wheel like a trackpad), so the choice can be forced and is remembered.
 */
export type WheelMode = 'auto' | 'zoom' | 'pan';

const KEY = 'stadiumforge.wheelMode';

function read(): WheelMode {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'zoom' || v === 'pan' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

let mode: WheelMode = read();

export const getWheelMode = (): WheelMode => mode;

export function setWheelMode(next: WheelMode): void {
  mode = next;
  try {
    window.localStorage.setItem(KEY, next);
  } catch {
    // Blocked storage: the choice lasts for this visit only.
  }
}
