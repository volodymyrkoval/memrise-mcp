/** Input schemas shared by several tools; each value is the API's own key, so no mapping is needed. */
import { z } from 'zod';

export const stateSchema = z.enum(['any', 'fully_learned_or_known']);
