import type { APIRoute } from 'astro';

import { llmsFull, renderDocs, textResponse } from '../lib/llms';

export const GET: APIRoute = async () => textResponse(llmsFull(await renderDocs()));
