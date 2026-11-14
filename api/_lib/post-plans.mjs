// A post's plan (which of its lines can be checked, and the planner's estimate for each), kept in the
// store. Every function instance starts with an empty memory, so without this each one asked NEAR AI
// Cloud again for the same post, and a slow answer showed a post as unpriced that had been priced a
// minute before. The plan for a post's text doesn't change, so it is written once and read by all.
import { createHash } from "node:crypto";

export const planDoc = (key) => `post-plans/${createHash("sha256").update(key).digest("hex")}.json`;

/** @param {{ getDoc(name: string): Promise<{ value: any }|null>, putDoc(name: string, value: any): Promise<any> }} state */
export function postPlanStore(state, { now = Date.now } = {}) {
  return {
    /** The labels stored for this plan key, or null. */
    async get(key) {
      const d = await state.getDoc(planDoc(key));
      return Array.isArray(d?.value?.labels) ? d.value.labels : null;
    },
    /** Written once: a second instance that priced the same post at the same moment leaves the first copy. */
    async put(key, labels) {
      try { await state.putDoc(planDoc(key), { labels, at: now() }); } catch (e) {
        if (await state.getDoc(planDoc(key)).catch(() => null)) return;
        throw e;
      }
    },
  };
}
