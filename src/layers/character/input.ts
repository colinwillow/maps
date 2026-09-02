const RAD = Math.PI / 180;

/**
 * Turn a thumb-stick push into a world direction, RELATIVE TO THE CAMERA.
 *
 * This is the whole bug that made walking feel inverted. The stick was mapped
 * straight to compass directions — screen-down meant south — which is only
 * true while the camera faces north. In street view the camera swings round
 * behind the character, so "push up" walked him north no matter which way he
 * was facing: sideways at best, backwards when he happened to face south.
 *
 * In a third-person game the stick is always relative to the CAMERA: up is
 * away from you, down is toward you, whatever the compass says. MapLibre's
 * bearing is the heading the top of the screen points at, so the pushed
 * direction's heading is simply bearing + the angle of the push on screen.
 *
 * dx is screen-right, dy is screen-DOWN (as pointer events report it).
 */
export function stickToWorld(
  dx: number,
  dy: number,
  mapBearingDeg: number,
): { east: number; south: number } {
  const magnitude = Math.min(1, Math.hypot(dx, dy));
  if (magnitude < 1e-6) return { east: 0, south: 0 };

  // Screen angle of the push, measured like a compass: up is 0, right is 90.
  const pushAngle = Math.atan2(dx, -dy) / RAD;
  const heading = (mapBearingDeg + pushAngle) * RAD;

  return {
    east: Math.sin(heading) * magnitude,
    south: -Math.cos(heading) * magnitude,
  };
}
