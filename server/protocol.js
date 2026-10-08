// Wire format shared by the world (server/hub.js) and the game (src/net/net.js).
export const PROTOCOL = 3;

// One car in a world snapshot: a flat array of numbers, indices below.
//   age      ms between the moment the state was true (sender's clock, in server time)
//            and the snapshot; snapshot time - age = when the state was true
//   angVel   world-space angular velocity (rad/s); acc = horizontal acceleration (m/s²)
//   wheels   4 codes for tyre effects: -1 airborne, else surface*1000 + spin*100 + slip
export const S = {
  id: 0,
  age: 1,
  pos: 2, // x y z
  quat: 5, // x y z w
  vel: 9, // x y z
  angVel: 12, // x y z
  acc: 15, // x z
  steer: 17,
  flags: 18, // 1 brake · 2 lights · 4 reverse · 8 racing
  rpm: 19,
  gear: 20,
  wheels: 21, // 4 codes
};
export const STATE_LEN = 25;

// How often a car may send its state: as fast as 30 Hz in a small world, less as the world
// fills, keeping a world under the ~1,000 messages/s a Durable Object handles well.
export const sendRateFor = (players) => Math.max(10, Math.min(30, Math.floor(900 / Math.max(1, players))));
