// scripts/mainnet/send.mjs's go or no-go, pure so it is tested (services/api/test/send-script.test.mjs).
// The owner sends a little NEAR and USDC to one outside account, such as the founder's own wallet for the
// dispute drill: never to the owner's own accounts, never more than the caps, never below the keeper's gas
// floor, and always with a reason, which deployments/mainnet.json keeps beside the transactions.

export const MAX_NEAR = 1;
export const MAX_USDC = 10;
/** NEAR the owner keeps spare after a send: the keeper's finalize, expire_challenge and open_claim run on it. */
export const OWNER_FLOOR_NEAR = 0.5;
/** Room for the gas of the three calls. */
const GAS_NEAR = 0.01;

const ACCOUNT = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

/**
 * @param {{ to: string, near: number, usdc: number, why: string, owner: string, usdcContract: string,
 *   recipientExists: boolean, registered: boolean, storageNear: number, ownerSpareNear: number, ownerUsdcMicro: bigint }} a
 * @returns {{ ok: true, register: boolean, nearYocto: bigint, usdcMicro: bigint, spareAfter: number } | { ok: false, why: string }}
 */
export function sendPlan(a) {
  const no = (why) => ({ ok: false, why });
  const to = String(a.to || "");
  if (!ACCOUNT.test(to)) return no(`"${to}" is not a NEAR account id`);
  if (to === a.owner || to.endsWith(`.${a.owner}`)) return no(`${to} is one of the owner's own accounts: fund those with their own scripts`);
  if (to === a.usdcContract) return no("that is the USDC contract");
  if (!a.recipientExists) return no(`${to} does not exist on mainnet`);
  const near = Number(a.near), usdc = Number(a.usdc);
  if (!(near >= 0) || !(usdc >= 0) || !(near + usdc > 0)) return no("send some NEAR (--near) or USDC (--usdc), or both");
  if (near > MAX_NEAR) return no(`at most ${MAX_NEAR} NEAR a send`);
  if (usdc > MAX_USDC) return no(`at most $${MAX_USDC} a send`);
  const why = String(a.why || "").trim();
  if (why.length < 3 || why.length > 200) return no("--why says what the money is for (3 to 200 characters): it is kept with the transactions");
  const register = usdc > 0 && !a.registered;
  const spareAfter = a.ownerSpareNear - near - (register ? a.storageNear : 0) - GAS_NEAR;
  if (spareAfter < OWNER_FLOOR_NEAR) return no(`the owner would keep ${spareAfter.toFixed(3)} NEAR spare, under the ${OWNER_FLOOR_NEAR} NEAR the keeper's gas needs`);
  const usdcMicro = BigInt(Math.round(usdc * 1e6));
  if (usdcMicro > a.ownerUsdcMicro) return no(`the owner holds $${(Number(a.ownerUsdcMicro) / 1e6).toFixed(2)} of USDC, less than $${usdc.toFixed(2)}`);
  return { ok: true, register, nearYocto: BigInt(Math.round(near * 1e6)) * 10n ** 18n, usdcMicro, spareAfter };
}
