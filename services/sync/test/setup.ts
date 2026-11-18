import { setPairingCostForTests } from '@lelap/core';

// scrypt at the real cost takes up to a second per pairing under load, past Vitest's 5 s timeout.
// packages/core keeps one test at the real cost.
setPairingCostForTests(2 ** 4);
