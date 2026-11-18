import { setPairingCostForTests } from '../src/sync/crypto';

// scrypt at the real cost takes up to a second per pairing under load, past Vitest's 5 s timeout
// for tests that pair several times. One test in src/sync/sync.test.ts keeps the real cost.
export const TEST_PAIRING_COST = 2 ** 4;

setPairingCostForTests(TEST_PAIRING_COST);
