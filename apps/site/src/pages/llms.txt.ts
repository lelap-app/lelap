import type { APIRoute } from 'astro';

import { llmsIndex, renderDocs, textResponse } from '../lib/llms';

export const GET: APIRoute = async () => textResponse(llmsIndex(await renderDocs()));
