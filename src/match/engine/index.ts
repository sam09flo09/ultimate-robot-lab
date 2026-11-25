/**
 * match: the two-robot match engine (contract: src/core/match.ts).
 *   createMatchSim     two robots, one field, shared objects, scoring
 *   createIsolatedRunner  one Python runner per robot, each with its own Skulpt (hidden iframe)
 *   GAMES              the built-in match games (Silo Sprint)
 *   PRACTICE_BOTS      Team B practice programs (easy / medium)
 */
export { createMatchSim } from "./matchSim";
export { createIsolatedRunner, createIsolatedRunnerWith, iframeRealm, runnerFrameUrl, type RealmLoader, type SkRealm } from "./isolated";
export { GAMES, getGame, SILO_SPRINT, SILO_SPRINT_WORLD } from "./games";
export { PRACTICE_BOTS, practiceBot } from "./practiceBots";
