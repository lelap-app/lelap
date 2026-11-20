import { libraryBooks } from '@lelap/core';

import { db } from './db';

/** Every book the Library shows, reread only where a book changed (M126); one for the app. */
export const bookReader = libraryBooks(db);
